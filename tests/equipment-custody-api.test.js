const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-equipment-custody-api-'));
const tokens = {
  owner: 'equipment-custody-owner-token-at-least-32-characters',
  approver: 'equipment-custody-approver-token-at-least-32-characters',
  office: 'equipment-custody-office-token-at-least-32-characters',
  field: { token: 'equipment-custody-field-token-at-least-32-characters', workerId: 'worker-equipment-custodian' }
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

test('equipment custody API gives assigned field workers replay-safe checkout and return without global access', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'equipment_custody_api_test' });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: `Equipment custody API ${suffix}`,
      clientName: `Equipment custody client ${suffix}`,
      status: 'scheduled',
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  const worker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ id: tokens.field.workerId, name: 'Field equipment custodian', role: 'Equipment operator', status: 'available' })
  });
  assert.equal(worker.response.status, 201);
  const assignment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: tokens.field.workerId, workerName: 'Field equipment custodian', role: 'Equipment operator', status: 'assigned' })
  });
  assert.equal(assignment.response.status, 201);
  const tool = await request(baseUrl, '/api/ledger/tools', {
    method: 'POST',
    body: JSON.stringify({ name: `API custody lift ${suffix}`, category: 'access', status: 'available', currentLocation: 'Depot' })
  });
  assert.equal(tool.response.status, 201);
  const reservation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/tools`, {
    method: 'POST',
    body: JSON.stringify({
      toolId: tool.body.tool.id,
      toolName: tool.body.tool.name,
      status: 'reserved',
      neededUntil: new Date(Date.now() + 86_400_000).toISOString()
    })
  });
  assert.equal(reservation.response.status, 201);

  const plan = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/equipment-custody-plan`, { token: tokens.field.token });
  assert.equal(plan.response.status, 200);
  assert.equal(plan.body.plans.length, 1);
  assert.equal(plan.body.plans[0].checkoutReady, true);
  assert.equal(plan.body.plans[0].tool.id, tool.body.tool.id);

  const checkoutPayload = {
    reservationId: reservation.body.toolReservation.id,
    checkedOutAt: new Date(Date.now() - 60_000).toISOString(),
    checkedOutBy: 'Spoofed office actor',
    condition: 'good',
    location: 'Project gate',
    evidenceReference: `handoff:${suffix}`,
    entryKey: `equipment-checkout-api-${suffix}`
  };
  const checkout = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/equipment-custody/check-out`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(checkoutPayload)
  });
  assert.equal(checkout.response.status, 201);
  assert.equal(checkout.body.custody.checkedOutBy, 'Field equipment custodian');
  assert.equal(checkout.body.custody.workerId, tokens.field.workerId);
  assert.equal(checkout.body.custody.checkoutFingerprint, undefined);
  assert.equal(checkout.body.custody.checkoutEntryKey, undefined);
  assert.equal(checkout.body.replayed, false);

  const replay = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/equipment-custody/check-out`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(checkoutPayload)
  });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.custody.id, checkout.body.custody.id);

  const globalDenied = await request(baseUrl, '/api/ledger/equipment-custody', { token: tokens.field.token });
  assert.equal(globalDenied.response.status, 403);
  const scoped = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/equipment-custody`, { token: tokens.field.token });
  assert.equal(scoped.response.status, 200);
  assert.equal(scoped.body.custody.length, 1);
  assert.equal(scoped.body.custody[0].checkoutFingerprint, undefined);

  const returnPayload = {
    returnedAt: new Date().toISOString(),
    returnedBy: 'Spoofed office actor',
    condition: 'unsafe',
    location: 'Quarantine bay',
    evidenceReference: `return-photo:${suffix}`,
    entryKey: `equipment-return-api-${suffix}`,
    notes: 'Emergency stop did not reset; equipment isolated for review.'
  };
  const returned = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/equipment-custody/${encodeURIComponent(checkout.body.custody.id)}/return`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(returnPayload)
  });
  assert.equal(returned.response.status, 200);
  assert.equal(returned.body.custody.returnedBy, 'Field equipment custodian');
  assert.equal(returned.body.custody.status, 'exception');
  assert.equal(returned.body.custody.returnFingerprint, undefined);
  const register = await request(baseUrl, '/api/ledger/equipment-custody');
  assert.equal(register.response.status, 200);
  assert.equal(register.body.equipmentCustody.summary.exceptions, 1);
  assert.equal(register.body.equipmentCustody.policy.externalCommitments, 0);
  const diagnostics = await request(baseUrl, '/api/ledger/debug');
  assert.equal(diagnostics.body.diagnostics.valid, true);
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '053_work_breakdown_takeoffs');
});
