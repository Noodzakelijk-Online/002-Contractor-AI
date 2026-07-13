const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-finance-'));
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');

const { ContractorOperatingLedger } = require('../operating-ledger');
const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  return { response, body };
}

test('finance readiness API coordinates invoice, payment, cost and handoff work', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'Finance Client',
      clientPhone: '+31 6 55555555',
      address: 'Prinsengracht 25, Amsterdam',
      service: 'bathroom renovation',
      title: 'Finance readiness bathroom closeout',
      description: 'Completed bathroom renovation needing invoice, payment and bookkeeping handoff.',
      status: 'completed',
      priority: 'high',
      progressPercent: 100,
      estimatedCost: 3000,
      contractValue: 3000,
      estimatedHours: 18,
      targetCompletion: '2026-07-03T16:00:00.000Z'
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const initialFinance = await request(baseUrl, '/api/ledger/finance?mode=invoice&limit=100');
  assert.equal(initialFinance.response.status, 200);
  const invoiceReady = initialFinance.body.jobs.find(job => job.jobId === jobId);
  assert.ok(invoiceReady);
  assert.equal(invoiceReady.financeStatus, 'invoice_ready');
  assert.equal(invoiceReady.flags.invoiceReady, true);
  assert.equal(invoiceReady.counts.invoices, 0);
  assert.equal(invoiceReady.money.contractValue, 3000);
  assert.equal(invoiceReady.money.quotedNetValue, 3000);
  assert.equal(invoiceReady.money.quotedGrossValue, 3630);
  assert.equal(invoiceReady.money.invoicedNetValue, 0);
  assert.equal(invoiceReady.money.invoiceDraftAmount, 3000);
  assert.equal(invoiceReady.money.uninvoicedNetValue, 3000);
  assert.ok(invoiceReady.money.uninvoicedValue >= 3000);
  assert.ok(invoiceReady.nextActions.some(action => action.type === 'draft_invoice'));
  assert.ok(initialFinance.body.summary.invoiceReady >= 1);

  const timeLog = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/time-logs`, {
    method: 'POST',
    body: JSON.stringify({ workDate: '2026-07-03', hours: 12, rate: 45, notes: 'Closeout labor.' })
  });
  assert.equal(timeLog.response.status, 201);

  const expense = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/expenses`, {
    method: 'POST',
    body: JSON.stringify({ category: 'materials', amount: 420, vendor: 'Bouwmaat', notes: 'Final fixtures.' })
  });
  assert.equal(expense.response.status, 201);

  const invoice = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/invoices`, {
    method: 'POST',
    body: JSON.stringify({ amount: 3000, taxAmount: 630, total: 3630, peppolReady: true })
  });
  assert.equal(invoice.response.status, 201);
  assert.ok(invoice.body.invoice.approvalId);

  const approvalQueue = await request(baseUrl, '/api/ledger/finance?mode=approval&limit=100');
  assert.equal(approvalQueue.response.status, 200);
  const approvalJob = approvalQueue.body.jobs.find(job => job.jobId === jobId);
  assert.ok(approvalJob);
  assert.equal(approvalJob.financeStatus, 'approval_required');
  assert.equal(approvalJob.flags.approvalRequired, true);
  assert.equal(approvalJob.flags.invoiceReady, false);
  assert.equal(approvalJob.counts.draftInvoices, 1);
  assert.equal(approvalJob.money.invoicedNetValue, 3000);
  assert.equal(approvalJob.money.invoiceDraftAmount, 0);
  assert.ok(approvalJob.counts.pendingApprovals >= 1);
  assert.ok(approvalJob.nextActions.some(action => action.type === 'review_finance_approval'));

  const resolvedInvoice = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(invoice.body.invoice.approvalId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance QA', reason: 'Invoice checked.' })
  });
  assert.equal(resolvedInvoice.response.status, 200);
  assert.equal(resolvedInvoice.body.approval.status, 'approved');

  const payment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/payments`, {
    method: 'POST',
    body: JSON.stringify({ status: 'awaiting_payment', amount: 3630, dueAt: '2026-07-10T12:00:00.000Z', method: 'bank_transfer' })
  });
  assert.equal(payment.response.status, 201);

  const paymentQueue = await request(baseUrl, '/api/ledger/finance?mode=payment&limit=100');
  assert.equal(paymentQueue.response.status, 200);
  const paymentJob = paymentQueue.body.jobs.find(job => job.jobId === jobId);
  assert.ok(paymentJob);
  assert.equal(paymentJob.financeStatus, 'payment_follow_up');
  assert.equal(paymentJob.flags.paymentFollowUp, true);
  assert.equal(paymentJob.counts.openPayments, 1);
  assert.ok(paymentJob.money.unpaidValue >= 3630);
  assert.ok(paymentJob.nextActions.some(action => action.type === 'record_payment_follow_up'));

  const budget = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/budget-lines`, {
    method: 'POST',
    body: JSON.stringify({ status: 'draft', costCode: 'FIN-100', description: 'Finance readiness baseline', budgetAmount: 3000, forecastAmount: 3000 })
  });
  assert.equal(budget.response.status, 201);

  const handoff = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/finance-handoffs`, {
    method: 'POST',
    body: JSON.stringify({ status: 'draft', targetSystem: 'FAB', packageType: 'job_finance' })
  });
  assert.equal(handoff.response.status, 201);
  assert.equal(handoff.body.financeHandoff.status, 'draft');

  const handoffQueue = await request(baseUrl, '/api/ledger/finance?mode=handoff&limit=100');
  assert.equal(handoffQueue.response.status, 200);
  assert.ok(handoffQueue.body.summary.financeHandoffValue >= 3630);
  assert.ok(handoffQueue.body.jobs.some(job =>
    job.jobId === jobId
    && job.flags.handoffReady
    && job.nextActions.some(action => action.type === 'prepare_finance_handoff')
  ));
});

test('finance controls clear follow-up queues and retain exact approval outcomes without duplicates', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const futureFollowUp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'Finance Control Client',
      title: 'Finance control lifecycle',
      service: 'commercial fit-out',
      status: 'completed',
      progressPercent: 100,
      contractValue: 2400,
      estimatedCost: 2400,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const invalidCosts = await request(baseUrl, `/api/ledger/jobs/${jobId}/finance-costs`, {
    method: 'POST',
    body: JSON.stringify({ timeLog: { hours: 0 }, expense: { amount: 0 } })
  });
  assert.equal(invalidCosts.response.status, 400);

  const costs = await request(baseUrl, `/api/ledger/jobs/${jobId}/finance-costs`, {
    method: 'POST',
    body: JSON.stringify({
      timeLog: { workDate: new Date().toISOString().slice(0, 10), hours: 5, rate: 52, notes: 'Verified closeout labor.' },
      expense: { category: 'materials', amount: 185, vendor: 'Bouwmaat', receiptRef: 'COST-185', notes: 'Verified retained receipt.' }
    })
  });
  assert.equal(costs.response.status, 201);
  assert.equal(costs.body.costs.timeLog.hours, 5);
  assert.equal(costs.body.costs.expense.amount, 185);
  assert.equal(costs.body.job.timeLogs.length, 1);
  assert.equal(costs.body.job.expenses.length, 1);

  const invoice = await request(baseUrl, `/api/ledger/jobs/${jobId}/invoices`, {
    method: 'POST',
    body: JSON.stringify({ amount: 2400, taxAmount: 504, total: 2904, dueAt: futureFollowUp })
  });
  assert.equal(invoice.response.status, 201);
  const invoiceApproval = await request(baseUrl, `/api/ledger/approvals/${invoice.body.invoice.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance Control QA', reason: 'Invoice evidence checked.' })
  });
  assert.equal(invoiceApproval.response.status, 200);

  const untrackedQueue = await request(baseUrl, '/api/ledger/finance?mode=payment&limit=100');
  const untrackedJob = untrackedQueue.body.jobs.find(job => job.jobId === jobId);
  assert.ok(untrackedJob);
  assert.ok(untrackedJob.nextActions.some(action => (
    action.type === 'record_payment_follow_up'
    && action.paymentId === null
    && action.invoiceId === invoice.body.invoice.id
  )));

  const initialFollowUp = await request(baseUrl, `/api/ledger/jobs/${jobId}/payments/follow-up`, {
    method: 'POST',
    body: JSON.stringify({
      invoiceId: invoice.body.invoice.id,
      status: 'follow_up_recorded',
      amount: 2904,
      nextFollowUpAt: futureFollowUp,
      followUpChannel: 'internal',
      notes: 'Collection plan recorded internally; no reminder was delivered.'
    })
  });
  assert.equal(initialFollowUp.response.status, 201);
  assert.equal(initialFollowUp.body.payment.status, 'awaiting_payment');
  assert.equal(initialFollowUp.body.payment.data.externalDelivery, false);
  assert.equal(initialFollowUp.body.payment.data.followUpHistory.length, 1);
  const paymentId = initialFollowUp.body.payment.id;

  const clearedQueue = await request(baseUrl, '/api/ledger/finance?mode=payment&limit=100');
  assert.equal(clearedQueue.body.jobs.some(job => job.jobId === jobId), false);

  const repeatedFollowUp = await request(baseUrl, `/api/ledger/jobs/${jobId}/payments/${paymentId}/follow-up`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'follow_up_recorded',
      nextFollowUpAt: futureFollowUp,
      notes: 'Second internal collection note linked to the same receivable.'
    })
  });
  assert.equal(repeatedFollowUp.response.status, 201);
  assert.equal(repeatedFollowUp.body.payment.id, paymentId);
  assert.equal(repeatedFollowUp.body.payment.data.followUpHistory.length, 2);
  assert.equal(repeatedFollowUp.body.job.payments.length, 1);

  const writeOff = await request(baseUrl, `/api/ledger/jobs/${jobId}/payments/${paymentId}/follow-up`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'written_off',
      reference: 'WRITE-OFF-CONTROL-1',
      notes: 'Write-off evidence retained for explicit owner review.'
    })
  });
  assert.equal(writeOff.response.status, 201);
  assert.equal(writeOff.body.payment.status, 'pending_confirmation');
  assert.ok(writeOff.body.payment.approvalId);

  const writeOffApproval = await request(baseUrl, `/api/ledger/approvals/${writeOff.body.payment.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance Control QA', reason: 'Write-off authority and evidence checked.' })
  });
  assert.equal(writeOffApproval.response.status, 200);
  const writtenOffDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  const writtenOffPayment = writtenOffDetail.body.job.payments.find(payment => payment.id === paymentId);
  assert.equal(writtenOffPayment.status, 'written_off');
  assert.equal(writtenOffPayment.paidAt, null);

  const draftHandoff = await request(baseUrl, `/api/ledger/jobs/${jobId}/finance-handoffs`, {
    method: 'POST',
    body: JSON.stringify({ status: 'draft', targetSystem: 'FAB', notes: 'Initial internal package.' })
  });
  assert.equal(draftHandoff.response.status, 201);

  const preparedHandoff = await request(baseUrl, `/api/ledger/jobs/${jobId}/finance-handoffs/prepare`, {
    method: 'POST',
    body: JSON.stringify({ targetSystem: 'FAB', exportFormat: 'json', notes: 'Regenerated package for approver review.' })
  });
  assert.equal(preparedHandoff.response.status, 201);
  assert.equal(preparedHandoff.body.financeHandoff.id, draftHandoff.body.financeHandoff.id);
  assert.equal(preparedHandoff.body.financeHandoff.status, 'pending_approval');
  assert.ok(preparedHandoff.body.financeHandoff.approvalId);

  const repeatedHandoff = await request(baseUrl, `/api/ledger/jobs/${jobId}/finance-handoffs/prepare`, {
    method: 'POST',
    body: JSON.stringify({ targetSystem: 'FAB', exportFormat: 'json', notes: 'Repeated preparation request.' })
  });
  assert.equal(repeatedHandoff.response.status, 201);
  assert.equal(repeatedHandoff.body.financeHandoff.id, preparedHandoff.body.financeHandoff.id);
  assert.equal(repeatedHandoff.body.financeHandoff.approval.id, preparedHandoff.body.financeHandoff.approval.id);
  assert.equal(repeatedHandoff.body.financeHandoff.reused, true);
  assert.equal(repeatedHandoff.body.job.financeHandoffs.length, 1);
});

test('finance handoff creation rolls back when approval persistence fails', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-finance-atomicity-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });

  try {
    const job = ledger.createIntake({
      title: 'Atomic finance handoff',
      client: { name: 'Atomic Finance Client' },
      assignAutomatically: false
    });
    const originalCreateApproval = ledger.createApproval.bind(ledger);
    ledger.createApproval = () => {
      throw new Error('Injected approval persistence failure');
    };

    assert.throws(
      () => ledger.createFinanceHandoff(job.id, {
        status: 'approved',
        targetSystem: 'FAB',
        requiresApproval: true
      }),
      /Injected approval persistence failure/
    );
    assert.equal(
      Number(ledger.db.prepare('SELECT COUNT(*) AS count FROM finance_handoffs WHERE job_id = ?').get(job.id).count),
      0
    );
    assert.equal(
      Number(ledger.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE job_id = ? AND action = 'create_finance_handoff'").get(job.id).count),
      0
    );

    ledger.createApproval = originalCreateApproval;
  } finally {
    ledger.close();
  }
});
