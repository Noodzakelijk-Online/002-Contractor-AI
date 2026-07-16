const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-takeoff-api-'));
const tokens = {
  owner: 'takeoff-owner-token-at-least-32-characters',
  approver: 'takeoff-approver-token-at-least-32-characters',
  office_operator: 'takeoff-office-token-at-least-32-characters',
  field_worker: { token: 'takeoff-field-token-at-least-32-characters', jobIds: ['none'] }
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify(tokens),
  STATE_FILE: path.join(directory, 'state.json'),
  LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(directory, 'uploads')
});
delete process.env.CONTRACTOR_AI_AUTH_TOKEN;
delete process.env.DASHBOARD_AUTH_TOKEN;

const app = require('../server');

async function request(baseUrl, route, token, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test('takeoff API enforces roles and converts retained measurements into one internal estimate', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'quantity_takeoff_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const session = await request(baseUrl, '/api/session', tokens.office_operator);
  assert.equal(session.response.status, 200);
  assert.equal(session.body.operator.capabilities.takeoffs, true);

  const intake = await request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ clientName: 'API Measurement Client', title: 'API measured scope', assignAutomatically: false })
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;

  const created = await request(baseUrl, `/api/ledger/jobs/${jobId}/takeoffs`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ title: 'API ground floor', taxRate: 21, notes: 'Internal measurement basis.' })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const takeoffId = created.body.takeoff.id;

  const approverWrite = await request(baseUrl, `/api/ledger/jobs/${jobId}/takeoffs/${takeoffId}/items`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({ description: 'Approver must not edit', measurementType: 'count', count: 1, unitPrice: 1 })
  });
  assert.equal(approverWrite.response.status, 403);
  assert.equal(approverWrite.body.error.code, 'insufficient_role');
  const fieldRead = await request(baseUrl, `/api/ledger/jobs/${jobId}/takeoffs`, tokens.field_worker.token);
  assert.equal(fieldRead.response.status, 403);

  const added = await request(baseUrl, `/api/ledger/jobs/${jobId}/takeoffs/${takeoffId}/items`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      description: 'Ceramic floor tiles',
      category: 'material',
      measurementType: 'area',
      count: 2,
      length: 4,
      width: 3,
      wastePercent: 10,
      unitCost: 22,
      unitPrice: 38,
      costCode: 'FIN-220',
      sourceReference: 'Drawing A-101'
    })
  });
  assert.equal(added.response.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.item.quantity, 26.4);
  assert.equal(added.body.takeoff.subtotal, 1003.2);

  const converted = await request(baseUrl, `/api/ledger/jobs/${jobId}/takeoffs/${takeoffId}/convert`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ validUntil: '2026-12-31' })
  });
  assert.equal(converted.response.status, 201, JSON.stringify(converted.body));
  assert.equal(converted.body.takeoff.status, 'converted');
  assert.equal(converted.body.takeoff.integrityValid, true);
  assert.equal(converted.body.quote.status, 'draft');
  assert.ok(converted.body.quote.approvalId);
  assert.equal(converted.body.externalCommitments, 0);
  assert.equal(converted.body.job.contractValue, 0);

  const replay = await request(baseUrl, `/api/ledger/jobs/${jobId}/takeoffs/${takeoffId}/convert`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ validUntil: '2026-12-31' })
  });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.quote.id, converted.body.quote.id);

  const detail = await request(baseUrl, `/api/ledger/jobs/${jobId}`, tokens.approver);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.job.takeoffs[0].quoteId, converted.body.quote.id);
  assert.equal(detail.body.job.quotes.length, 1);

  const exported = await request(baseUrl, '/api/operations/export', tokens.owner);
  assert.ok(exported.body.takeoffSheets.some(item => item.id === takeoffId));
  assert.ok(exported.body.takeoffItems.some(item => item.takeoffId === takeoffId));
});
