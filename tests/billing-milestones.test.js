const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-billing-api-'));
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');

const { ContractorOperatingLedger } = require('../operating-ledger');
const app = require('../server');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-billing-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function contractJob(ledger, suffix = 'one', contractValue = 1000) {
  return ledger.createIntake({
    client: { name: `Billing Client ${suffix}`, email: `billing-${suffix}@example.test`, country: 'NL' },
    title: `Staged billing ${suffix}`,
    status: 'completed',
    progressPercent: 100,
    contractValue,
    estimatedCost: contractValue * 0.7,
    assignAutomatically: false
  }, { actor: 'billing-test' });
}

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  return { response, body };
}

test('billing milestones remain contract-bounded and bind exact values to one invoice', t => {
  const ledger = temporaryLedger(t);
  const job = contractJob(ledger);
  const rejected = ledger.createBillingMilestone(job.id, {
    title: 'Initial deposit',
    amount: 400,
    taxRate: 21,
    plannedIssueAt: '2026-01-10T09:00:00.000Z',
    dueAt: '2026-02-09T23:59:59.000Z'
  }, { actor: 'office' });
  assert.equal(rejected.status, 'pending_approval');
  assert.equal(rejected.sequenceNumber, 1);
  assert.equal(rejected.data.externalCommitments, 0);
  assert.equal(rejected.approval.targetType, 'billing_milestone');
  assert.equal(rejected.approval.approvalType, 'billing_schedule');
  assert.match(rejected.approval.decision.primaryEffect, /billing milestone 1/i);
  assert.ok(rejected.approval.decision.safeguards.some(item => item.includes('Does not create, issue, deliver')));

  assert.throws(
    () => ledger.createBillingMilestone(job.id, {
      title: 'Contract overrun',
      amount: 700,
      plannedIssueAt: '2026-02-10T09:00:00.000Z',
      dueAt: '2026-03-12T23:59:59.000Z'
    }),
    error => error.code === 'billing_milestone_contract_exceeded'
      && error.details.contractValue === 1000
      && error.details.availableAmount === 600
  );

  ledger.resolveApproval(rejected.approvalId, {
    status: 'rejected',
    resolvedBy: 'owner',
    reason: 'Replace this with the agreed completion milestone.'
  });
  const milestone = ledger.createBillingMilestone(job.id, {
    title: 'Completion payment',
    amount: 1000,
    taxRate: 21,
    plannedIssueAt: '2026-01-15T09:00:00.000Z',
    dueAt: '2026-02-14T23:59:59.000Z'
  }, { actor: 'office' });
  assert.equal(milestone.sequenceNumber, 2);
  ledger.resolveApproval(milestone.approvalId, {
    status: 'approved',
    resolvedBy: 'owner',
    reason: 'Contract value and billing date checked.'
  });

  const finance = ledger.listFinanceReadiness({ mode: 'invoice', limit: 100 });
  const financeJob = finance.jobs.find(item => item.jobId === job.id);
  const draftAction = financeJob.nextActions.find(action => action.type === 'draft_invoice');
  assert.equal(financeJob.money.plannedBillingValue, 1000);
  assert.equal(financeJob.money.dueBillingValue, 1000);
  assert.equal(draftAction.billingMilestoneId, milestone.id);
  assert.equal(draftAction.amount, 1000);
  assert.equal(draftAction.taxRate, 21);

  assert.throws(
    () => ledger.createInvoice(job.id, { billingMilestoneId: milestone.id, amount: 999 }),
    error => error.code === 'billing_milestone_invoice_mismatch'
  );
  const invoice = ledger.createInvoice(job.id, { billingMilestoneId: milestone.id }, { actor: 'office' });
  assert.equal(invoice.amount, 1000);
  assert.equal(invoice.taxAmount, 210);
  assert.equal(invoice.total, 1210);
  assert.equal(invoice.dueAt, milestone.dueAt);
  assert.equal(invoice.data.billingMilestoneId, milestone.id);

  let retainedMilestone = ledger.getJobDetail(job.id, { includeAudit: false }).billingMilestones[1];
  assert.equal(retainedMilestone.status, 'invoicing');
  assert.equal(retainedMilestone.invoiceId, invoice.id);
  assert.throws(
    () => ledger.createInvoice(job.id, { billingMilestoneId: milestone.id }),
    error => error.code === 'billing_milestone_already_invoiced' && error.details.invoiceId === invoice.id
  );

  ledger.resolveApproval(invoice.approvalId, {
    status: 'rejected',
    resolvedBy: 'owner',
    reason: 'Buyer reference needs correction.'
  });
  const rejectedInvoice = ledger.getJobDetail(job.id, { includeAudit: false }).invoices.find(item => item.id === invoice.id);
  retainedMilestone = ledger.getJobDetail(job.id, { includeAudit: false }).billingMilestones[1];
  assert.equal(rejectedInvoice.status, 'rejected');
  assert.equal(retainedMilestone.status, 'approved');
  assert.equal(retainedMilestone.invoiceId, null);

  const replacement = ledger.createInvoice(job.id, { billingMilestoneId: milestone.id }, { actor: 'office' });
  assert.notEqual(replacement.id, invoice.id);
  assert.equal(replacement.amount, 1000);
  assert.equal(ledger.diagnose().valid, true);
});

test('rejected finance approvals leave no pending records without a pending decision', t => {
  const ledger = temporaryLedger(t);
  const job = contractJob(ledger, 'rollback', 2500);
  const controls = [
    ledger.createBudgetLine(job.id, { status: 'approved', budgetAmount: 2000, forecastAmount: 2000 }),
    ledger.createPurchaseOrder(job.id, { status: 'approved', supplier: 'Rollback Supplier', amount: 300 }),
    ledger.createDrawRequest(job.id, { status: 'submitted', requestedAmount: 500 }),
    ledger.createLienWaiver(job.id, { status: 'received', amount: 500, documentRef: 'WAIVER-EVIDENCE-1' }),
    ledger.createFinanceHandoff(job.id, { status: 'ready', amount: 2500, targetSystem: 'FAB' })
  ];

  for (const control of controls) {
    assert.equal(control.status, 'pending_approval');
    assert.ok(control.approvalId);
    ledger.resolveApproval(control.approvalId, {
      status: 'rejected',
      resolvedBy: 'owner',
      reason: 'Control evidence is incomplete.'
    });
  }

  const detail = ledger.getJobDetail(job.id, { includeAudit: false });
  assert.equal(detail.budgetLines[0].status, 'rejected');
  assert.equal(detail.purchaseOrders[0].status, 'rejected');
  assert.equal(detail.drawRequests[0].status, 'rejected');
  assert.equal(detail.lienWaivers[0].status, 'rejected');
  assert.equal(detail.financeHandoffs[0].status, 'rejected');
  assert.equal(detail.approvals.filter(approval => approval.status === 'pending' && controls.some(control => control.approvalId === approval.id)).length, 0);
});

test('billing milestone API and autonomous cycle are approval-gated and idempotent', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'Autonomous Billing Client',
      title: 'Autonomous staged billing',
      status: 'completed',
      progressPercent: 100,
      contractValue: 1200,
      estimatedCost: 800,
      assignAutomatically: false,
      targetCompletion: '2026-01-01T16:00:00.000Z'
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const firstCycle = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({
      dryRun: false,
      actor: 'billing-autonomy-test',
      actionTypes: ['create_billing_milestone'],
      jobIds: [jobId],
      maxActions: 1,
      now: '2026-07-15T10:00:00.000Z'
    })
  });
  assert.equal(firstCycle.response.status, 200);
  assert.equal(firstCycle.body.applied.length, 1);
  assert.equal(firstCycle.body.applied[0].status, 'pending_approval');
  assert.equal(firstCycle.body.summary.externalCommitments, 0);

  const secondCycle = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: false, actionTypes: ['create_billing_milestone'], jobIds: [jobId], maxActions: 1, now: '2026-07-15T11:00:00.000Z' })
  });
  assert.equal(secondCycle.response.status, 200);
  assert.equal(secondCycle.body.applied.length, 0);

  const detail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.job.billingMilestones.length, 1);
  const milestone = detail.body.job.billingMilestones[0];
  assert.equal(milestone.status, 'pending_approval');
  assert.equal(milestone.data.externalCommitments, 0);

  const approval = await request(baseUrl, `/api/ledger/approvals/${milestone.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'owner', reason: 'Billing plan checked.' })
  });
  assert.equal(approval.response.status, 200);

  const dryRun = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, actionTypes: ['draft_invoice'], jobIds: [jobId], maxActions: 1 })
  });
  assert.equal(dryRun.response.status, 200);
  assert.equal(dryRun.body.preview.length, 1);
  assert.equal(dryRun.body.preview[0].billingMilestoneId, milestone.id);
  assert.equal(dryRun.body.preview[0].suggestedAmount, 1200);
  assert.equal(dryRun.body.preview[0].suggestedTotal, 1452);

  const invoiceCycle = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: false, actionTypes: ['draft_invoice'], jobIds: [jobId], maxActions: 1, now: '2026-07-15T12:00:00.000Z' })
  });
  assert.equal(invoiceCycle.response.status, 200);
  assert.equal(invoiceCycle.body.applied.length, 1);
  assert.equal(invoiceCycle.body.applied[0].billingMilestoneId, milestone.id);
  assert.equal(invoiceCycle.body.summary.externalCommitments, 0);

  const after = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  const invoice = after.body.job.invoices.find(item => item.id === invoiceCycle.body.applied[0].invoiceId);
  assert.equal(invoice.data.billingMilestoneId, milestone.id);
  assert.equal(invoice.amount, 1200);
  assert.equal(after.body.job.billingMilestones[0].status, 'invoicing');
});
