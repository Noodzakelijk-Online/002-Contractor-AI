const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-expense-receipts-api-'));
const tokens = {
  owner: 'expense-receipt-owner-token-at-least-32-characters',
  approver: 'expense-receipt-approver-token-at-least-32-characters',
  office: 'expense-receipt-office-token-at-least-32-characters',
  field: { token: 'expense-receipt-field-token-at-least-32-characters', workerId: 'worker-expense-receipt-field' }
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify({ owner: tokens.owner, approver: tokens.approver, office_operator: tokens.office, field_worker: tokens.field }),
  STATE_FILE: path.join(stateDirectory, 'state.json'),
  LEDGER_DB_FILE: path.join(stateDirectory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(stateDirectory, 'uploads')
});
const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const { token = tokens.office, ...requestOptions } = options;
  const response = await fetch(`${baseUrl}${route}`, {
    ...requestOptions,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json();
  return { response, body };
}

test('field expense API enforces worker scope, exact replay, approval, and office-only reversal', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'expense_receipt_api_test' });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: `Expense receipt API ${suffix}`,
      clientName: `Expense client ${suffix}`,
      status: 'scheduled',
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  const worker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ id: tokens.field.workerId, name: 'Field expense worker', role: 'Site carpenter', status: 'available' })
  });
  assert.equal(worker.response.status, 201);
  const assignment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: tokens.field.workerId, workerName: 'Field expense worker', role: 'Site carpenter', status: 'assigned' })
  });
  assert.equal(assignment.response.status, 201);

  const payload = {
    entryKey: `expense-api-${suffix}`,
    expenseDate: new Date().toISOString().slice(0, 10),
    workerId: 'spoofed-worker',
    workerName: 'Spoofed worker',
    category: 'materials',
    vendor: 'Bouwmaat API',
    receiptReference: `API-BON-${suffix}`,
    totalAmount: 60.5,
    taxAmount: 10.5,
    taxTreatment: 'recoverable',
    paymentMethod: 'personal_card',
    costCode: 'API-MAT-100',
    notes: 'Fixings purchased during the assigned field shift.'
  };
  const created = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/expense-receipts`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.expense.workerId, tokens.field.workerId);
  assert.equal(created.body.expense.workerName, 'Field expense worker');
  assert.equal(created.body.expense.totalAmount, 60.5);
  assert.equal(created.body.expense.taxAmount, 10.5);
  assert.equal(created.body.expense.status, 'pending_approval');
  assert.equal(created.body.expense.entryKey, undefined);
  assert.equal(created.body.expense.entryFingerprint, undefined);
  assert.equal(created.body.approval, null);
  assert.equal(created.body.fundsMoved, false);

  const replay = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/expense-receipts`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.expense.id, created.body.expense.id);

  const scoped = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/expense-receipts`, { token: tokens.field.token });
  assert.equal(scoped.response.status, 200);
  assert.equal(scoped.body.expenses.length, 1);
  assert.equal(scoped.body.expenses[0].totalAmount, 60.5);
  const officeList = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/expense-receipts`);
  assert.equal(officeList.response.status, 200);
  assert.equal(officeList.body.expenses[0].integrityValid, true);
  assert.ok(officeList.body.expenses[0].approvalId);

  const approvalId = officeList.body.expenses[0].approvalId;
  const approved = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(approvalId)}/resolve`, {
    token: tokens.approver,
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'API expense approver', reason: 'Receipt, worker, VAT, and job allocation verified.' })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  const approvedScoped = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/expense-receipts`, { token: tokens.field.token });
  assert.equal(approvedScoped.body.expenses[0].status, 'approved');

  const fieldReversal = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/expense-receipts/${encodeURIComponent(created.body.expense.id)}/reversal`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify({ reason: 'Field worker must not reverse approved cost evidence.' })
  });
  assert.equal(fieldReversal.response.status, 403);
  const reversal = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/expense-receipts/${encodeURIComponent(created.body.expense.id)}/reversal`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Corrected bookkeeping evidence proves another project allocation.' })
  });
  assert.equal(reversal.response.status, 201, JSON.stringify(reversal.body));
  assert.equal(reversal.body.expense.status, 'pending_reversal');
  const reversed = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(reversal.body.approval.id)}/resolve`, {
    token: tokens.approver,
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'API expense approver', reason: 'Corrected allocation evidence verified.' })
  });
  assert.equal(reversed.response.status, 200, JSON.stringify(reversed.body));
  const finalList = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/expense-receipts`);
  assert.equal(finalList.body.expenses[0].status, 'reversed');

  const capabilities = await request(baseUrl, '/api/operations/capabilities', { token: tokens.owner });
  assert.equal(capabilities.body.capabilities.requestSafety.expenseReceiptEntryKey, 'durable');
  assert.equal(capabilities.body.capabilities.requestSafety.expenseReceiptReversal, 'approval_gated_compensating_record');
  const diagnostics = await request(baseUrl, '/api/ledger/debug', { token: tokens.owner });
  assert.equal(diagnostics.body.diagnostics.valid, true);
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '068_operational_safety_controls');
});
