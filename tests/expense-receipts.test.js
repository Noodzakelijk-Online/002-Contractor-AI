const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t, suffix = '1') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-expense-receipts-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  const job = ledger.createIntake({
    title: `Expense receipt ${suffix}`,
    client: { name: `Expense client ${suffix}` },
    status: 'scheduled',
    assignAutomatically: false
  }, { actor: 'expense_test' });
  const worker = ledger.upsertWorker({
    name: `Expense worker ${suffix}`,
    role: 'Site carpenter',
    status: 'available'
  }, { actor: 'expense_test' });
  ledger.addAssignment(job.id, {
    workerId: worker.id,
    workerName: worker.name,
    role: worker.role,
    status: 'assigned'
  }, { actor: 'expense_test' });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, job, worker };
}

function receiptPayload(job, worker, suffix = '001') {
  return {
    entryKey: `expense-receipt-${suffix}`,
    expenseDate: new Date().toISOString().slice(0, 10),
    workerId: worker.id,
    workerName: worker.name,
    category: 'materials',
    vendor: 'Bouwmaat Utrecht',
    receiptReference: `BON-${suffix}`,
    totalAmount: 121,
    taxAmount: 21,
    taxTreatment: 'recoverable',
    paymentMethod: 'personal_card',
    costCode: 'MAT-100',
    currency: 'EUR',
    notes: `Fixings purchased for ${job.title}.`
  };
}

test('expense receipts are replay-safe, duplicate-resistant, VAT-aware, and approval-gated', t => {
  const { ledger, job, worker } = fixture(t, 'governed');
  const payload = receiptPayload(job, worker, 'GOV-001');
  const created = ledger.createExpenseReceipt(job.id, payload, { actor: 'field_worker' });
  assert.equal(created.replayed, false);
  assert.equal(created.expense.status, 'pending_approval');
  assert.equal(created.expense.totalAmount, 121);
  assert.equal(created.expense.netAmount, 100);
  assert.equal(created.expense.taxAmount, 21);
  assert.equal(created.expense.costAmount, 100);
  assert.equal(created.expense.integrityValid, true);
  assert.equal(created.approval.targetType, 'expense');
  assert.equal(ledger.calculateCostForecast(job.id).summary.actual, 0);

  const replay = ledger.createExpenseReceipt(job.id, payload, { actor: 'offline_retry' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.expense.id, created.expense.id);
  assert.equal(ledger.count('expenses'), 1);
  assert.throws(
    () => ledger.createExpenseReceipt(job.id, { ...payload, totalAmount: 120 }),
    error => error.code === 'expense_entry_key_reused' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.createExpenseReceipt(job.id, { ...payload, entryKey: 'expense-receipt-GOV-002' }),
    error => error.code === 'expense_receipt_duplicate' && error.statusCode === 409
  );

  const decision = created.approval.decision;
  assert.equal(decision.preview.total, 121);
  assert.equal(decision.preview.costAmount, 100);
  assert.equal(decision.riskLevel, 'high');
  assert.ok(decision.safeguards.some(item => /does not reimburse/i.test(item)));
  ledger.resolveApproval(created.approval.id, {
    status: 'approved',
    resolvedBy: 'expense_approver',
    reason: 'Receipt, worker, project allocation, VAT, and cost code verified.'
  });
  const approved = ledger.getExpense(created.expense.id);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.integrityValid, true);
  assert.equal(ledger.calculateCostForecast(job.id).summary.actual, 100);
  assert.equal(ledger.listFinanceReadiness({ jobIds: [job.id] }).jobs[0].money.expenseValue, 100);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
  assert.equal(ledger.diagnose().valid, true);
});

test('expense reversal is compensating, approval-backed, and restores after rejection', t => {
  const { ledger, job, worker } = fixture(t, 'reversal');
  const created = ledger.createExpenseReceipt(job.id, receiptPayload(job, worker, 'REV-001'), { actor: 'field_worker' });
  ledger.resolveApproval(created.approval.id, {
    status: 'approved', resolvedBy: 'expense_approver', reason: 'Original receipt verified.'
  });

  const first = ledger.requestExpenseReversal(job.id, created.expense.id, {
    reason: 'Receipt was allocated to the wrong retained project.'
  }, { actor: 'office_operator' });
  assert.equal(first.expense.status, 'pending_reversal');
  assert.equal(ledger.calculateCostForecast(job.id).summary.actual, 100);
  ledger.resolveApproval(first.approval.id, {
    status: 'rejected', resolvedBy: 'expense_approver', reason: 'Project allocation matches the retained receipt.'
  });
  assert.equal(ledger.getExpense(created.expense.id).status, 'approved');
  assert.equal(ledger.calculateCostForecast(job.id).summary.actual, 100);

  const second = ledger.requestExpenseReversal(job.id, created.expense.id, {
    reason: 'Corrected bookkeeping evidence confirms another project allocation.'
  }, { actor: 'office_operator' });
  ledger.resolveApproval(second.approval.id, {
    status: 'approved', resolvedBy: 'expense_approver', reason: 'Corrected allocation evidence verified.'
  });
  const reversed = ledger.getExpense(created.expense.id);
  assert.equal(reversed.status, 'reversed');
  assert.equal(reversed.receiptReference, 'BON-REV-001');
  assert.equal(reversed.integrityValid, true);
  assert.equal(ledger.calculateCostForecast(job.id).summary.actual, 0);
  const finance = ledger.listFinanceReadiness({ jobIds: [job.id] }).jobs[0];
  assert.equal(finance.money.expenseValue, 0);
  assert.equal(finance.latest.expense.id, reversed.id);
  assert.equal(finance.latest.expense.status, 'reversed');
  const audit = ledger.getJobDetail(job.id, { includeAudit: true }).audit;
  assert.equal(audit.some(event => event.action === 'submit_expense_receipt'), true);
  assert.equal(audit.some(event => event.action === 'approve_expense_receipt'), true);
  assert.equal(audit.some(event => event.action === 'request_expense_reversal'), true);
  assert.equal(audit.some(event => event.action === 'reverse_expense_receipt'), true);
  assert.equal(ledger.diagnose().valid, true);
});

test('expense approval rolls back when retained receipt content is changed', t => {
  const { ledger, job, worker } = fixture(t, 'integrity');
  const created = ledger.createExpenseReceipt(job.id, receiptPayload(job, worker, 'INT-001'), { actor: 'field_worker' });
  const row = ledger.db.prepare('SELECT data_json FROM expenses WHERE id = ?').get(created.expense.id);
  const data = JSON.parse(row.data_json);
  ledger.db.prepare('UPDATE expenses SET data_json = ? WHERE id = ?').run(JSON.stringify({ ...data, totalAmount: 999 }), created.expense.id);
  assert.throws(
    () => ledger.resolveApproval(created.approval.id, {
      status: 'approved', resolvedBy: 'expense_approver', reason: 'Tampered receipt must not pass.'
    }),
    error => error.code === 'expense_receipt_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).some(item => item.id === created.approval.id), true);
  assert.equal(ledger.getExpense(created.expense.id).status, 'pending_approval');
  ledger.db.prepare('UPDATE expenses SET data_json = ? WHERE id = ?').run(row.data_json, created.expense.id);
  assert.equal(ledger.diagnose().valid, true);
});

test('autonomous expense review is internal, idempotent, and never resolves or reimburses', t => {
  const { ledger, job, worker } = fixture(t, 'autonomy');
  const created = ledger.createExpenseReceipt(job.id, {
    ...receiptPayload(job, worker, 'AUTO-001'),
    totalAmount: 605,
    taxAmount: 105
  }, { actor: 'field_worker' });
  const approvalCount = ledger.count('approvals');
  const paymentCount = ledger.count('payments');
  const communicationCount = ledger.count('communication_records');

  const candidate = ledger.nextActions().find(action => (
    action.type === 'review_expense_receipt' && action.expenseId === created.expense.id
  ));
  assert.ok(candidate);
  assert.equal(candidate.requiresApproval, true);

  const first = ledger.runAutonomousCycle({
    actionTypes: ['review_expense_receipt'],
    jobIds: [job.id]
  });
  assert.equal(first.applied.length, 1);
  assert.equal(first.applied[0].externalCommitments, 0);
  assert.equal(first.applied[0].fundsMoved, false);

  const detail = ledger.getJobDetail(job.id, { includeAudit: true });
  const reviewTask = detail.tasks.find(task => task.data?.expenseId === created.expense.id);
  assert.ok(reviewTask);
  assert.equal(reviewTask.data.internalOnly, true);
  assert.equal(reviewTask.data.externalCommitments, 0);
  assert.equal(reviewTask.data.fundsMoved, false);
  assert.equal(ledger.getExpense(created.expense.id).status, 'pending_approval');
  assert.equal(ledger.count('approvals'), approvalCount);
  assert.equal(ledger.count('payments'), paymentCount);
  assert.equal(ledger.count('communication_records'), communicationCount);

  const second = ledger.runAutonomousCycle({
    actionTypes: ['review_expense_receipt'],
    jobIds: [job.id]
  });
  assert.equal(second.applied.length, 0);
  assert.equal(ledger.diagnose().valid, true);
});
