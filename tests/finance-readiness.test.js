const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-finance-'));
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
  assert.equal(approvalJob.counts.draftInvoices, 1);
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
