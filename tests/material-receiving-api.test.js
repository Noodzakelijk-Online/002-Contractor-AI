const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-material-receiving-api-'));
const tokens = {
  owner: 'material-receiving-owner-token-at-least-32-characters',
  approver: 'material-receiving-approver-token-at-least-32-characters',
  office: 'material-receiving-office-token-at-least-32-characters',
  field: { token: 'material-receiving-field-token-at-least-32-characters', workerId: 'worker-material-receiver' }
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

test('material receiving API retains exact field evidence and approval-backed reversal', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'material_receiving_api_test' });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: `Material receiving API ${suffix}`,
      clientName: `Material receiving client ${suffix}`,
      status: 'scheduled',
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  const worker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ id: tokens.field.workerId, name: 'Field material receiver', role: 'Site receiver', status: 'available' })
  });
  assert.equal(worker.response.status, 201);
  const assignment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: tokens.field.workerId, workerName: 'Field material receiver', role: 'Site receiver', status: 'assigned' })
  });
  assert.equal(assignment.response.status, 201);
  const fieldPlan = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/material-receiving-plan`, { token: tokens.field.token });
  assert.equal(fieldPlan.response.status, 200);
  assert.deepEqual(fieldPlan.body.plans, []);
  const material = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/materials`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Unplanned site protection', quantity: 4, unit: 'rolls', status: 'needed' })
  });
  assert.equal(material.response.status, 201);
  const payload = {
    receiptReference: `UNPLANNED-${suffix}`,
    evidenceReference: `signed-ticket:UNPLANNED-${suffix}`,
    deliveredAt: new Date(Date.now() - 60_000).toISOString(),
    receivedBy: 'API site receiver',
    location: 'Site compound',
    entryKey: `material-receipt-api-${suffix}`,
    lines: [{
      materialRequirementId: material.body.materialRequirement.id,
      itemName: 'Unplanned site protection',
      unit: 'rolls',
      receivedQuantity: 4,
      acceptedQuantity: 4,
      damagedQuantity: 0
    }]
  };
  const created = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/material-receipts`, {
    token: tokens.field.token, method: 'POST', body: JSON.stringify(payload)
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.receipt.status, 'discrepancy');
  assert.equal(created.body.receipt.receivedBy, 'Field material receiver');
  assert.equal(created.body.receipt.entryFingerprint, undefined);
  assert.equal(created.body.receipt.exceptions[0].code, 'purchase_order_missing');
  assert.equal(created.body.receipt.summary.acceptedQuantity, 4);
  assert.equal(created.body.job.materials[0].status, 'available');
  assert.equal(created.body.replayed, false);

  const replay = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/material-receipts`, {
    token: tokens.field.token, method: 'POST', body: JSON.stringify(payload)
  });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.receipt.id, created.body.receipt.id);
  const conflict = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/material-receipts`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify({ ...payload, lines: [{ ...payload.lines[0], receivedQuantity: 3, acceptedQuantity: 3 }] })
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, 'material_receipt_replay_conflict');

  const register = await request(baseUrl, '/api/ledger/material-receipts');
  assert.equal(register.response.status, 200);
  assert.equal(register.body.materialReceiving.summary.total, 1);
  assert.equal(register.body.materialReceiving.summary.discrepancies, 1);
  const fieldRegister = await request(baseUrl, '/api/ledger/material-receipts', { token: tokens.field.token });
  assert.equal(fieldRegister.response.status, 403);
  const jobReceipts = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/material-receipts`, { token: tokens.field.token });
  assert.equal(jobReceipts.response.status, 200);
  assert.equal(jobReceipts.body.receipts.length, 1);
  assert.equal(jobReceipts.body.receipts[0].entryFingerprint, undefined);

  const deniedReversal = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/material-receipts/${encodeURIComponent(created.body.receipt.id)}/reversal`,
    { token: tokens.field.token, method: 'POST', body: JSON.stringify({ reason: 'Field worker cannot reverse retained evidence.' }) }
  );
  assert.equal(deniedReversal.response.status, 403);

  const reversal = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/material-receipts/${encodeURIComponent(created.body.receipt.id)}/reversal`,
    { method: 'POST', body: JSON.stringify({ reason: 'The delivery ticket was allocated to the wrong project.' }) }
  );
  assert.equal(reversal.response.status, 202);
  assert.equal(reversal.body.receipt.status, 'pending_reversal');
  const approved = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(reversal.body.approval.id)}/resolve`, {
    token: tokens.approver,
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'material_receipt_api_approver', reason: 'Corrected project allocation evidence verified.' })
  });
  assert.equal(approved.response.status, 200);
  const finalJob = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(finalJob.body.job.materialReceipts[0].status, 'reversed');
  assert.equal(finalJob.body.job.materials[0].status, 'needed');
  const diagnostics = await request(baseUrl, '/api/ledger/debug');
  assert.equal(diagnostics.body.diagnostics.valid, true);
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '047_governed_drawing_revision_control');
});
