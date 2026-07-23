const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-finance-'));
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');
process.env.CONTRACTOR_AI_VERIFIED_INTEGRATIONS = 'finance_test_provider';

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

function weekStart(value = new Date()) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
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

  const worker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Finance readiness installer', role: 'Installer', status: 'available', hourlyRate: 45 })
  });
  assert.equal(worker.response.status, 201);
  const timeLog = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/time-logs`, {
    method: 'POST',
    body: JSON.stringify({
      workerId: worker.body.worker.id,
      workerName: worker.body.worker.name,
      workDate: '2026-07-03',
      hours: 12,
      rate: 45,
      notes: 'Closeout labor.'
    })
  });
  assert.equal(timeLog.response.status, 201);
  const timesheet = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(worker.body.worker.id)}/timesheets`, {
    method: 'POST',
    body: JSON.stringify({ periodStart: '2026-06-29' })
  });
  assert.equal(timesheet.response.status, 201);
  const timesheetApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(timesheet.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance QA', reason: 'Worker, hours, week, rate, and job allocation checked.' })
  });
  assert.equal(timesheetApproval.response.status, 200);
  const expense = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/expense-receipts`, {
    method: 'POST',
    body: JSON.stringify({
      entryKey: `finance-readiness-expense-${Date.now()}`,
      expenseDate: '2026-07-03',
      category: 'materials',
      totalAmount: 420,
      taxAmount: 0,
      taxTreatment: 'exempt',
      paymentMethod: 'company_card',
      vendor: 'Bouwmaat',
      receiptReference: 'FINANCE-READINESS-420',
      notes: 'Final fixtures.'
    })
  });
  assert.equal(expense.response.status, 201);
  const expenseApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(expense.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance QA', reason: 'Receipt, amount, tax treatment, and job allocation checked.' })
  });
  assert.equal(expenseApproval.response.status, 200);

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
    body: JSON.stringify({ status: 'baseline', costCode: 'FIN-100', description: 'Finance readiness baseline', budgetAmount: 3000, forecastAmount: 3000 })
  });
  assert.equal(budget.response.status, 201);
  const budgetApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(budget.body.budgetLine.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance QA', reason: 'Cost budget and forecast basis checked.' })
  });
  assert.equal(budgetApproval.response.status, 200);

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

  const organization = await request(baseUrl, '/api/ledger/organization', {
    method: 'PUT',
    body: JSON.stringify({
      legalName: 'Finance Control Contractor B.V.',
      registrationNumber: '12345678',
      vatNumber: 'NL123456789B01',
      email: 'finance-control@example.test',
      address: 'Controlstraat 1',
      postalCode: '3511 AA',
      city: 'Utrecht',
      country: 'NL',
      iban: 'NL91ABNA0417164300',
      defaultPaymentTermsDays: 30,
      defaultQuoteValidityDays: 30
    })
  });
  assert.equal(organization.response.status, 200);

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

  const worker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Finance control installer', role: 'Installer', status: 'available', hourlyRate: 52 })
  });
  assert.equal(worker.response.status, 201);
  const workDate = new Date().toISOString().slice(0, 10);
  const costs = await request(baseUrl, `/api/ledger/jobs/${jobId}/finance-costs`, {
    method: 'POST',
    body: JSON.stringify({
      timeLog: {
        workerId: worker.body.worker.id,
        workerName: worker.body.worker.name,
        workDate,
        hours: 5,
        rate: 52,
        notes: 'Verified closeout labor.'
      },
      expense: {
        entryKey: `finance-control-expense-${Date.now()}`,
        expenseDate: workDate,
        category: 'materials',
        amount: 185,
        totalAmount: 185,
        taxAmount: 0,
        taxTreatment: 'exempt',
        paymentMethod: 'company_card',
        vendor: 'Bouwmaat',
        receiptReference: 'COST-185',
        notes: 'Verified retained receipt.'
      }
    })
  });
  assert.equal(costs.response.status, 201);
  assert.equal(costs.body.costs.timeLog.hours, 5);
  assert.equal(costs.body.costs.expense.amount, 185);
  assert.equal(costs.body.job.timeLogs.length, 1);
  assert.equal(costs.body.job.expenses.length, 1);

  const blockedHandoff = await request(baseUrl, `/api/ledger/jobs/${jobId}/finance-handoffs/prepare`, {
    method: 'POST',
    body: JSON.stringify({ targetSystem: 'FAB' })
  });
  assert.equal(blockedHandoff.response.status, 409);
  assert.equal(blockedHandoff.body.error.code, 'finance_handoff_cost_review_required');

  const expenseApproval = await request(baseUrl, `/api/ledger/approvals/${costs.body.costs.expense.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance Control QA', reason: 'Receipt, tax treatment, and job allocation checked.' })
  });
  assert.equal(expenseApproval.response.status, 200);
  const timesheet = await request(baseUrl, `/api/ledger/workers/${worker.body.worker.id}/timesheets`, {
    method: 'POST',
    body: JSON.stringify({ periodStart: weekStart(workDate) })
  });
  assert.equal(timesheet.response.status, 201);
  const timesheetApproval = await request(baseUrl, `/api/ledger/approvals/${timesheet.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance Control QA', reason: 'Worker, hours, rate, and job allocation checked.' })
  });
  assert.equal(timesheetApproval.response.status, 200);
  const costBudget = await request(baseUrl, `/api/ledger/jobs/${jobId}/budget-lines`, {
    method: 'POST',
    body: JSON.stringify({ status: 'baseline', costCode: 'FIN-CONTROL-100', description: 'Finance control cost basis', budgetAmount: 2400, forecastAmount: 2400 })
  });
  assert.equal(costBudget.response.status, 201);
  const costBudgetApproval = await request(baseUrl, `/api/ledger/approvals/${costBudget.body.budgetLine.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance Control QA', reason: 'Approved cost basis checked.' })
  });
  assert.equal(costBudgetApproval.response.status, 200);

  const invoice = await request(baseUrl, `/api/ledger/jobs/${jobId}/invoices`, {
    method: 'POST',
    body: JSON.stringify({
      amount: 2400,
      taxRate: 21,
      taxAmount: 504,
      total: 2904,
      dueAt: futureFollowUp,
      structuredExportRequested: false,
      buyerLegalName: 'Finance Control Client',
      buyerAddress: 'Clientstraat 2',
      buyerCity: 'Utrecht',
      buyerCountry: 'NL'
    })
  });
  assert.equal(invoice.response.status, 201);
  const invoiceApproval = await request(baseUrl, `/api/ledger/approvals/${invoice.body.invoice.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance Control QA', reason: 'Invoice evidence checked.' })
  });
  assert.equal(invoiceApproval.response.status, 200);

  const issuePackage = await request(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoice.body.invoice.id}/issue-package`, {
    method: 'POST', body: JSON.stringify({ actor: 'finance-control-test' })
  });
  assert.equal(issuePackage.response.status, 201);
  const deliveryApproval = await request(baseUrl, `/api/ledger/approvals/${issuePackage.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance Control QA', reason: 'Invoice attachment and recipient checked.' })
  });
  assert.equal(deliveryApproval.response.status, 200);
  const delivery = await request(baseUrl, `/api/ledger/communications/${issuePackage.body.communication.id}/delivery-receipt`, {
    method: 'POST',
    body: JSON.stringify({ integration: 'finance_test_provider', providerMessageId: 'finance-control-message' })
  });
  assert.equal(delivery.response.status, 200);

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
  const trackedReceivable = clearedQueue.body.jobs.find(job => job.jobId === jobId);
  assert.ok(trackedReceivable);
  assert.equal(trackedReceivable.flags.paymentOutstanding, true);
  assert.equal(trackedReceivable.flags.paymentFollowUp, false);
  assert.ok(trackedReceivable.nextActions.some(action => (
    action.type === 'record_payment_reconciliation'
    && action.paymentId === paymentId
    && action.availableAmount === 2904
  )));

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

  const rejectedReceipt = await request(baseUrl, `/api/ledger/jobs/${jobId}/payments/${paymentId}/follow-up`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'received',
      amount: 1000,
      reference: 'REJECTED-BANK-MATCH-1',
      method: 'bank_transfer',
      notes: 'Candidate bank match retained for approver review.'
    })
  });
  assert.equal(rejectedReceipt.response.status, 201);
  assert.equal(rejectedReceipt.body.payment.status, 'pending_confirmation');
  assert.equal(rejectedReceipt.body.payment.amount, 1000);
  const rejectedReceiptDecision = await request(baseUrl, `/api/ledger/approvals/${rejectedReceipt.body.payment.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'rejected', resolvedBy: 'Finance Control QA', reason: 'Bank match belonged to another invoice.' })
  });
  assert.equal(rejectedReceiptDecision.response.status, 200);
  const restoredPaymentDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  const restoredPayment = restoredPaymentDetail.body.job.payments.find(payment => payment.id === paymentId);
  assert.equal(restoredPayment.status, 'awaiting_payment');
  assert.equal(restoredPayment.amount, 2904);
  assert.equal(restoredPayment.reference, null);
  assert.equal(restoredPayment.reconciliationKey, null);

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
  assert.equal(writtenOffDetail.body.job.invoices.find(item => item.id === invoice.body.invoice.id).status, 'settled');
  const settledQueue = await request(baseUrl, '/api/ledger/finance?mode=payment&limit=100');
  assert.equal(settledQueue.body.jobs.some(job => job.jobId === jobId), false);

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

  const revisedBudget = await request(baseUrl, `/api/ledger/jobs/${jobId}/budget-lines`, {
    method: 'POST',
    body: JSON.stringify({ status: 'baseline', costCode: 'FIN-CONTROL-200', description: 'Approved cost-basis revision', budgetAmount: 100, forecastAmount: 100 })
  });
  assert.equal(revisedBudget.response.status, 201);
  const revisedBudgetApproval = await request(baseUrl, `/api/ledger/approvals/${revisedBudget.body.budgetLine.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance Control QA', reason: 'Approved cost-basis revision checked.' })
  });
  assert.equal(revisedBudgetApproval.response.status, 200);
  const staleHandoffApproval = await request(baseUrl, `/api/ledger/approvals/${preparedHandoff.body.financeHandoff.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance Control QA', reason: 'Attempt approval against stale cost basis.' })
  });
  assert.equal(staleHandoffApproval.response.status, 409);
  assert.equal(staleHandoffApproval.body.error.code, 'finance_handoff_cost_basis_stale');

  const refreshedHandoff = await request(baseUrl, `/api/ledger/jobs/${jobId}/finance-handoffs/prepare`, {
    method: 'POST',
    body: JSON.stringify({ targetSystem: 'FAB', exportFormat: 'json', notes: 'Regenerated after approved cost-basis revision.' })
  });
  assert.equal(refreshedHandoff.response.status, 201);
  assert.equal(refreshedHandoff.body.financeHandoff.id, preparedHandoff.body.financeHandoff.id);
  assert.notEqual(refreshedHandoff.body.financeHandoff.approval.id, preparedHandoff.body.financeHandoff.approval.id);
  assert.equal(refreshedHandoff.body.financeHandoff.reused, false);
  assert.equal(refreshedHandoff.body.financeHandoff.package.costForecast.sourceHash, refreshedHandoff.body.financeHandoff.data.costForecastSourceHash);
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
    const budget = ledger.createBudgetLine(job.id, {
      status: 'baseline',
      costCode: 'ATOMIC-100',
      description: 'Atomic handoff cost basis',
      budgetAmount: 1000,
      forecastAmount: 1000
    });
    ledger.resolveApproval(budget.approval.id, {
      status: 'approved',
      resolvedBy: 'Atomic finance approver',
      reason: 'Cost basis checked before handoff preparation.'
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

test('legacy finance handoffs without a cost-source hash require a current replacement approval', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-finance-unbound-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  try {
    const job = ledger.createIntake({
      title: 'Unbound finance handoff',
      client: { name: 'Unbound Finance Client' },
      assignAutomatically: false
    });
    const budget = ledger.createBudgetLine(job.id, {
      status: 'baseline',
      costCode: 'UNBOUND-100',
      description: 'Approved finance handoff basis',
      budgetAmount: 1000,
      forecastAmount: 1000
    });
    ledger.resolveApproval(budget.approval.id, {
      status: 'approved',
      resolvedBy: 'Finance approver',
      reason: 'Cost basis checked.'
    });
    const prepared = ledger.prepareFinanceHandoff(job.id, { targetSystem: 'FAB' });
    const handoffRow = ledger.db.prepare('SELECT data_json FROM finance_handoffs WHERE id = ?').get(prepared.id);
    const handoffData = JSON.parse(handoffRow.data_json);
    delete handoffData.costForecastSourceHash;
    ledger.db.prepare('UPDATE finance_handoffs SET data_json = ? WHERE id = ?')
      .run(JSON.stringify(handoffData), prepared.id);

    assert.throws(
      () => ledger.resolveApproval(prepared.approval.id, {
        status: 'approved',
        resolvedBy: 'Finance approver',
        reason: 'Attempt to approve an unbound package.'
      }),
      error => error.code === 'finance_handoff_cost_basis_stale'
    );

    const refreshed = ledger.prepareFinanceHandoff(job.id, { targetSystem: 'FAB' });
    assert.equal(refreshed.id, prepared.id);
    assert.equal(refreshed.reused, false);
    assert.notEqual(refreshed.approval.id, prepared.approval.id);
    assert.equal(refreshed.package.costForecast.sourceHash, refreshed.data.costForecastSourceHash);
  } finally {
    ledger.close();
  }
});

test('invoice payment reconciliation reserves balances and rejects duplicate references and overpayments', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const organization = await request(baseUrl, '/api/ledger/organization', {
    method: 'PUT',
    body: JSON.stringify({
      legalName: 'Reconciliation Contractor B.V.',
      registrationNumber: '12345678',
      vatNumber: 'NL123456789B01',
      email: 'reconciliation@example.test',
      address: 'Ledgerstraat 1',
      postalCode: '3511 AA',
      city: 'Utrecht',
      country: 'NL',
      iban: 'NL91ABNA0417164300'
    })
  });
  assert.equal(organization.response.status, 200);

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Partial receivable reconciliation',
      client: {
        name: 'Reconciliation Client',
        email: 'client-reconciliation@example.test',
        address: 'Klantstraat 10',
        city: 'Utrecht',
        country: 'NL'
      },
      address: 'Klantstraat 10',
      city: 'Utrecht',
      country: 'NL',
      status: 'completed',
      progressPercent: 100,
      contractValue: 1000,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  const invoice = await request(baseUrl, `/api/ledger/jobs/${jobId}/invoices`, {
    method: 'POST',
    body: JSON.stringify({
      amount: 1000,
      taxRate: 21,
      taxAmount: 210,
      total: 1210,
      dueAt: '2026-08-15T12:00:00.000Z',
      buyerAddress: 'Klantstraat 10',
      buyerCity: 'Utrecht',
      buyerCountry: 'NL'
    })
  });
  assert.equal(invoice.response.status, 201);
  const invoiceId = invoice.body.invoice.id;
  const invoiceApproval = await request(baseUrl, `/api/ledger/approvals/${invoice.body.invoice.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Receivable approver', reason: 'Invoice approved for matching.' })
  });
  assert.equal(invoiceApproval.response.status, 200);

  const prematurePayment = await request(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify({ status: 'received', amount: 500, reference: 'BANK-MATCH-BEFORE-PACKAGE' })
  });
  assert.equal(prematurePayment.response.status, 400);
  assert.equal(prematurePayment.body.error.code, 'invoice_not_payable');

  const issuePackage = await request(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoiceId}/issue-package`, {
    method: 'POST',
    body: JSON.stringify({ actor: 'Receivable operator' })
  });
  assert.equal(issuePackage.response.status, 201);
  assert.equal(issuePackage.body.issueReference.startsWith('INV-'), true);
  assert.equal(issuePackage.body.job.invoices.find(item => item.id === invoiceId).status, 'prepared');

  const partial = await request(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify({ status: 'received', amount: 500, method: 'bank_transfer', reference: 'BANK-MATCH-500', notes: 'Partial bank receipt.' })
  });
  assert.equal(partial.response.status, 201);
  assert.equal(partial.body.payment.status, 'pending_confirmation');
  assert.equal(partial.body.payment.data.reconciliationAtRequest.availableAmount, 1210);

  const pendingQueue = await request(baseUrl, '/api/ledger/finance?mode=approval&limit=100');
  const pendingRow = pendingQueue.body.jobs.find(job => job.jobId === jobId);
  assert.ok(pendingRow);
  assert.equal(pendingRow.money.unpaidValue, 500);
  assert.equal(pendingRow.counts.pendingApprovals, 2);

  const duplicatePending = await request(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify({ status: 'received', amount: 100, reference: ' bank-match-500 ', notes: 'Duplicate candidate.' })
  });
  assert.equal(duplicatePending.response.status, 409);
  assert.equal(duplicatePending.body.error.code, 'duplicate_payment_reference');

  const overReserved = await request(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify({ status: 'received', amount: 711, reference: 'BANK-MATCH-OVER', notes: 'Amount exceeds unreserved balance.' })
  });
  assert.equal(overReserved.response.status, 400);
  assert.equal(overReserved.body.error.code, 'payment_exceeds_invoice_balance');
  assert.equal(overReserved.body.error.details.availableAmount, 710);

  const partialApproval = await request(baseUrl, `/api/ledger/approvals/${partial.body.payment.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Receivable approver', reason: 'Bank statement match verified.' })
  });
  assert.equal(partialApproval.response.status, 200);
  let detail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  let reconciledInvoice = detail.body.job.invoices.find(item => item.id === invoiceId);
  assert.equal(reconciledInvoice.status, 'partially_paid');
  assert.equal(reconciledInvoice.data.reconciliation.receivedAmount, 500);
  assert.equal(reconciledInvoice.data.reconciliation.outstandingAmount, 710);

  const duplicateApproved = await request(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify({ status: 'received', amount: 100, reference: 'BANK-MATCH-500', notes: 'Duplicate approved reference.' })
  });
  assert.equal(duplicateApproved.response.status, 409);

  const finalReceipt = await request(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify({ status: 'received', amount: 710, method: 'bank_transfer', reference: 'BANK-MATCH-710', notes: 'Final bank receipt.' })
  });
  assert.equal(finalReceipt.response.status, 201);
  const finalApproval = await request(baseUrl, `/api/ledger/approvals/${finalReceipt.body.payment.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Receivable approver', reason: 'Final bank statement match verified.' })
  });
  assert.equal(finalApproval.response.status, 200);
  detail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  reconciledInvoice = detail.body.job.invoices.find(item => item.id === invoiceId);
  assert.equal(reconciledInvoice.status, 'paid');
  assert.equal(reconciledInvoice.data.reconciliation.receivedAmount, 1210);
  assert.equal(reconciledInvoice.data.reconciliation.outstandingAmount, 0);
  assert.equal(detail.body.job.payments.filter(payment => payment.status === 'received').length, 2);

  const settledQueue = await request(baseUrl, '/api/ledger/finance?mode=payment&limit=100');
  assert.equal(settledQueue.body.jobs.some(job => job.jobId === jobId), false);
});
