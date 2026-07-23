const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-autonomous-finance-'));
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');

const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  return { response, body };
}

test('autonomous cycle plans approved contract billing before deriving an invoice', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'Autonomous Finance Client',
      clientPhone: '+31 6 44444444',
      address: 'Weteringschans 44, Amsterdam',
      service: 'garden renovation',
      title: 'Autonomous invoice closeout',
      description: 'Completed garden renovation needing invoice draft and approval.',
      status: 'completed',
      priority: 'medium',
      riskLevel: 'normal',
      progressPercent: 100,
      estimatedCost: 2400,
      contractValue: 2400,
      estimatedHours: 20,
      targetCompletion: '2026-07-03T16:00:00.000Z'
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const financeBefore = await request(baseUrl, '/api/ledger/finance?mode=invoice&limit=100');
  assert.equal(financeBefore.response.status, 200);
  assert.ok(financeBefore.body.jobs.some(job =>
    job.jobId === jobId
    && job.flags.invoiceReady === true
    && job.nextActions.some(action => action.type === 'draft_invoice')
  ));

  const dryRun = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, actor: 'autonomous-finance-test' })
  });
  assert.equal(dryRun.response.status, 200);
  const previewAction = dryRun.body.preview.find(action =>
    action.type === 'create_billing_milestone'
    && action.jobId === jobId
  );
  assert.ok(previewAction);
  assert.equal(previewAction.suggestedAmount, 2400);
  assert.equal(dryRun.body.preview.some(action => action.type === 'draft_invoice' && action.jobId === jobId), false);

  const milestoneCycle = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({
      dryRun: false,
      actor: 'autonomous-finance-test',
      actionTypes: ['create_billing_milestone'],
      jobIds: [jobId],
      maxActions: 1,
      now: '2026-07-15T10:00:00.000Z'
    })
  });
  assert.equal(milestoneCycle.response.status, 200);
  const milestoneApplied = milestoneCycle.body.applied.find(action =>
    action.type === 'create_billing_milestone'
    && action.jobId === jobId
  );
  assert.ok(milestoneApplied);
  assert.equal(milestoneApplied.status, 'pending_approval');
  assert.ok(milestoneApplied.billingMilestoneId);
  assert.ok(milestoneApplied.approvalId);
  assert.equal(milestoneCycle.body.summary.externalCommitments, 0);

  const milestoneApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(milestoneApplied.approvalId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance QA', reason: 'Billing plan checked against the contract.' })
  });
  assert.equal(milestoneApproval.response.status, 200);

  const invoicePreview = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, actionTypes: ['draft_invoice'], jobIds: [jobId], maxActions: 1 })
  });
  const invoicePreviewAction = invoicePreview.body.preview.find(action =>
    action.type === 'draft_invoice'
    && action.jobId === jobId
  );
  assert.ok(invoicePreviewAction);
  assert.equal(invoicePreviewAction.billingMilestoneId, milestoneApplied.billingMilestoneId);
  assert.equal(invoicePreviewAction.suggestedAmount, 2400);
  assert.equal(invoicePreviewAction.suggestedTotal, 2904);

  const invoiceCycle = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({
      dryRun: false,
      actor: 'autonomous-finance-test',
      actionTypes: ['draft_invoice'],
      jobIds: [jobId],
      maxActions: 1,
      now: '2026-07-15T11:00:00.000Z'
    })
  });
  assert.equal(invoiceCycle.response.status, 200);
  const applied = invoiceCycle.body.applied.find(action => action.type === 'draft_invoice' && action.jobId === jobId);
  assert.ok(applied);
  assert.equal(applied.status, 'drafted');
  assert.equal(applied.billingMilestoneId, milestoneApplied.billingMilestoneId);
  assert.ok(applied.invoiceId);
  assert.ok(applied.approvalId);
  assert.equal(invoiceCycle.body.summary.externalCommitments, 0);

  const detail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(detail.response.status, 200);
  const invoice = detail.body.job.invoices.find(item => item.id === applied.invoiceId);
  assert.ok(invoice);
  assert.equal(invoice.status, 'draft');
  assert.equal(invoice.amount, 2400);
  assert.equal(invoice.taxAmount, 504);
  assert.equal(invoice.total, 2904);
  assert.equal(invoice.data.billingMilestoneId, milestoneApplied.billingMilestoneId);
  assert.equal(invoice.data.peppolReady, true);
  assert.match(invoice.data.notes, /Approval required before issuing/);
  assert.equal(invoice.approvalId, applied.approvalId);
  assert.equal(detail.body.job.billingMilestones[0].status, 'invoicing');
  assert.equal(detail.body.job.billingMilestones[0].invoiceId, invoice.id);
  assert.ok(detail.body.job.audit.some(event => event.action === 'autonomous_create_billing_milestone'));
  assert.ok(detail.body.job.audit.some(event => event.action === 'autonomous_draft_invoice'));

  const approvals = await request(baseUrl, '/api/ledger/approvals?status=pending&limit=100');
  assert.equal(approvals.response.status, 200);
  assert.ok(approvals.body.approvals.some(approval =>
    approval.id === applied.approvalId
    && approval.targetType === 'invoice'
    && approval.approvalType === 'invoice_issue'
  ));

  const approvalQueue = await request(baseUrl, '/api/ledger/finance?mode=approval&limit=100');
  assert.equal(approvalQueue.response.status, 200);
  assert.ok(approvalQueue.body.jobs.some(job =>
    job.jobId === jobId
    && job.flags.approvalRequired === true
    && job.counts.draftInvoices === 1
  ));
});

test('autonomous finance does not draft a handoff while retained costs require review', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'Autonomous Cost Review Client',
      title: `Autonomous cost review ${Date.now()}`,
      service: 'commercial renovation',
      status: 'in_progress',
      progressPercent: 50,
      estimatedCost: 2000,
      contractValue: 3000,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  const budget = await request(baseUrl, `/api/ledger/jobs/${jobId}/budget-lines`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'baseline',
      costCode: 'AUTO-REVIEW-100',
      description: 'Autonomous review baseline',
      budgetAmount: 2000,
      forecastAmount: 2000
    })
  });
  assert.equal(budget.response.status, 201);
  const budgetApproval = await request(baseUrl, `/api/ledger/approvals/${budget.body.budgetLine.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Autonomous Finance QA', reason: 'Cost basis checked.' })
  });
  assert.equal(budgetApproval.response.status, 200);
  const unreviewedExpense = await request(baseUrl, `/api/ledger/jobs/${jobId}/expenses`, {
    method: 'POST',
    body: JSON.stringify({ category: 'materials', amount: 250, costCode: 'AUTO-REVIEW-100', vendor: 'Unreviewed supplier' })
  });
  assert.equal(unreviewedExpense.response.status, 201);

  const finance = await request(baseUrl, `/api/ledger/finance?mode=cost_review&jobIds=${encodeURIComponent(jobId)}`);
  assert.equal(finance.response.status, 200);
  const row = finance.body.jobs.find(item => item.jobId === jobId);
  assert.ok(row);
  assert.equal(row.financeStatus, 'cost_review_required');
  assert.equal(row.flags.handoffReady, false);
  assert.equal(row.nextActions.some(action => action.type === 'review_cost_evidence'), true);
  assert.equal(row.nextActions.some(action => action.type === 'prepare_finance_handoff'), false);

  const dryRun = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({
      dryRun: true,
      actionTypes: ['create_finance_handoff'],
      jobIds: [jobId]
    })
  });
  assert.equal(dryRun.response.status, 200);
  assert.equal(dryRun.body.preview.some(action => action.type === 'create_finance_handoff' && action.jobId === jobId), false);
});

test('autonomous cycle freezes a current cost forecast without creating an external commitment', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'Autonomous Forecast Client',
      title: 'Autonomous cost forecast',
      service: 'commercial renovation',
      address: 'Singel 12, Amsterdam',
      status: 'in_progress',
      progressPercent: 40,
      estimatedCost: 5000,
      contractValue: 7500,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  const budget = await request(baseUrl, `/api/ledger/jobs/${jobId}/budget-lines`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'baseline',
      costCode: 'AUTO-100',
      description: 'Autonomous forecast baseline',
      budgetAmount: 5000,
      forecastAmount: 4800
    })
  });
  assert.equal(budget.response.status, 201);
  const budgetApproval = await request(baseUrl, `/api/ledger/approvals/${budget.body.budgetLine.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Forecast QA', reason: 'Budget basis checked.' })
  });
  assert.equal(budgetApproval.response.status, 200);
  const time = await request(baseUrl, `/api/ledger/jobs/${jobId}/time-logs`, {
    method: 'POST',
    body: JSON.stringify({ workDate: '2026-07-16', hours: 10, rate: 60, costCode: 'AUTO-100', notes: 'Verified labor.' })
  });
  assert.equal(time.response.status, 201);

  const dryRun = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, actionTypes: ['prepare_cost_forecast'], jobIds: [jobId] })
  });
  assert.equal(dryRun.response.status, 200);
  const preview = dryRun.body.preview.find(action => action.type === 'prepare_cost_forecast' && action.jobId === jobId);
  assert.ok(preview);
  assert.equal(preview.budget, 5000);
  assert.equal(preview.forecast, 4800);

  const cycle = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({
      dryRun: false,
      actor: 'autonomous-forecast-test',
      actionTypes: ['prepare_cost_forecast'],
      jobIds: [jobId],
      maxActions: 1
    })
  });
  assert.equal(cycle.response.status, 200);
  const applied = cycle.body.applied.find(action => action.type === 'prepare_cost_forecast' && action.jobId === jobId);
  assert.ok(applied);
  assert.equal(applied.status, 'pending_approval');
  assert.match(applied.forecastNumber, /^FC-\d{4}-\d{6}$/);
  assert.ok(applied.costForecastId);
  assert.ok(applied.approvalId);
  assert.equal(cycle.body.summary.externalCommitments, 0);

  const replayGuard = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, actionTypes: ['prepare_cost_forecast'], jobIds: [jobId] })
  });
  assert.equal(replayGuard.body.preview.length, 0);
  const approval = await request(baseUrl, `/api/ledger/approvals/${applied.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Forecast QA', reason: 'Current source-linked forecast checked.' })
  });
  assert.equal(approval.response.status, 200);

  const forecast = await request(baseUrl, `/api/ledger/jobs/${jobId}/cost-forecast`);
  assert.equal(forecast.response.status, 200);
  assert.equal(forecast.body.forecast.snapshotCurrent, true);
  assert.equal(forecast.body.forecast.activeSnapshot.id, applied.costForecastId);
  assert.equal(forecast.body.forecast.activeSnapshot.data.approval.approvalId, applied.approvalId);
});
