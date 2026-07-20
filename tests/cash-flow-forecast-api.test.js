const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-cash-flow-api-'));
const tokens = {
  owner: 'cash-flow-owner-token-at-least-32-characters',
  approver: 'cash-flow-approver-token-at-least-32-characters',
  office_operator: 'cash-flow-office-token-at-least-32-characters',
  field_worker: { token: 'cash-flow-field-token-at-least-32-characters', jobIds: ['none'] }
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

test('cash-flow API enforces role, replay, archive, snapshot, and source-current approval controls', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'cash_flow_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const fieldRead = await request(baseUrl, '/api/ledger/cash-flow?asOfDate=2026-07-20&openingBalance=1000', tokens.field_worker.token);
  assert.equal(fieldRead.response.status, 403);
  const approverRead = await request(baseUrl, '/api/ledger/cash-flow?asOfDate=2026-07-20&openingBalance=1000', tokens.approver);
  assert.equal(approverRead.response.status, 200, JSON.stringify(approverRead.body));
  assert.equal(approverRead.body.cashFlow.weeks.length, 13);
  const invalidOpening = await request(baseUrl, '/api/ledger/cash-flow?openingBalance=not-a-number', tokens.office_operator);
  assert.equal(invalidOpening.response.status, 400);
  assert.equal(invalidOpening.body.error.code, 'cash_flow_opening_balance_invalid');

  const deniedCreate = await request(baseUrl, '/api/ledger/cash-flow/items', tokens.approver, {
    method: 'POST',
    body: JSON.stringify({
      entryKey: 'cash-flow-api-denied',
      direction: 'outflow',
      category: 'overhead',
      title: 'Denied overhead',
      amount: 100,
      expectedAt: '2026-07-22'
    })
  });
  assert.equal(deniedCreate.response.status, 403);

  const payload = {
    entryKey: 'cash-flow-api-overhead',
    direction: 'outflow',
    category: 'overhead',
    title: 'Monthly premises cost',
    amount: 600,
    expectedAt: '2026-07-24',
    recurrence: 'monthly',
    recurrenceEndAt: '2026-09-24',
    confidencePercent: 100,
    sourceReference: 'Lease schedule'
  };
  const created = await request(baseUrl, '/api/ledger/cash-flow/items', tokens.office_operator, {
    method: 'POST', body: JSON.stringify(payload)
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.item.status, 'active');
  assert.equal(created.body.replayed, false);
  const replay = await request(baseUrl, '/api/ledger/cash-flow/items', tokens.office_operator, {
    method: 'POST', body: JSON.stringify(payload)
  });
  assert.equal(replay.response.status, 201, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.item.id, created.body.item.id);
  const conflict = await request(baseUrl, '/api/ledger/cash-flow/items', tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ ...payload, amount: 700 })
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, 'cash_flow_entry_key_conflict');

  const prepared = await request(baseUrl, '/api/ledger/cash-flow/snapshots', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ asOfDate: '2026-07-20', openingBalance: 1000 })
  });
  assert.equal(prepared.response.status, 201, JSON.stringify(prepared.body));
  assert.equal(prepared.body.snapshot.status, 'pending_approval');
  assert.equal(prepared.body.snapshot.integrityValid, true);
  assert.equal(prepared.body.approval.targetType, 'cash_flow_forecast');
  const deniedResolve = await request(baseUrl, `/api/ledger/approvals/${prepared.body.approval.id}/resolve`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ status: 'approved' })
  });
  assert.equal(deniedResolve.response.status, 403);
  const approved = await request(baseUrl, `/api/ledger/approvals/${prepared.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'API cash approver', reason: 'Opening cash and recurring lease checked.' })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  const current = await request(baseUrl, '/api/ledger/cash-flow?asOfDate=2026-07-20&openingBalance=1000', tokens.office_operator);
  assert.equal(current.response.status, 200, JSON.stringify(current.body));
  assert.equal(current.body.cashFlow.snapshotCurrent, true);
  assert.equal(current.body.cashFlow.activeSnapshot.forecastNumber, prepared.body.snapshot.forecastNumber);

  const second = await request(baseUrl, '/api/ledger/cash-flow/items', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      entryKey: 'cash-flow-api-tax-item',
      direction: 'outflow',
      category: 'tax',
      title: 'Quarterly VAT payment',
      amount: 300,
      expectedAt: '2026-08-31'
    })
  });
  assert.equal(second.response.status, 201, JSON.stringify(second.body));
  const staleView = await request(baseUrl, '/api/ledger/cash-flow?asOfDate=2026-07-20&openingBalance=1000', tokens.office_operator);
  assert.equal(staleView.body.cashFlow.snapshotCurrent, false);
  const revised = await request(baseUrl, '/api/ledger/cash-flow/snapshots', tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ asOfDate: '2026-07-20', openingBalance: 1000 })
  });
  assert.equal(revised.response.status, 201, JSON.stringify(revised.body));
  const archived = await request(baseUrl, `/api/ledger/cash-flow/items/${second.body.item.id}/archive`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ reason: 'Replaced by the verified tax filing calendar.' })
  });
  assert.equal(archived.response.status, 200, JSON.stringify(archived.body));
  assert.equal(archived.body.item.status, 'archived');
  const staleApproval = await request(baseUrl, `/api/ledger/approvals/${revised.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'API cash approver', reason: 'Stale evidence must fail.' })
  });
  assert.equal(staleApproval.response.status, 409);
  assert.equal(staleApproval.body.error.code, 'cash_flow_forecast_stale');

  const exported = await request(baseUrl, '/api/operations/export', tokens.owner);
  assert.equal(exported.response.status, 200, JSON.stringify(exported.body));
  assert.ok(exported.body.cashFlowItems.some(item => item.id === created.body.item.id));
  assert.ok(exported.body.cashFlowForecastSnapshots.some(snapshot => snapshot.id === prepared.body.snapshot.id));
  const validated = await request(baseUrl, '/api/operations/exports/validate', tokens.owner, {
    method: 'POST', body: JSON.stringify({ snapshot: exported.body })
  });
  assert.equal(validated.response.status, 200, JSON.stringify(validated.body));
  assert.equal(validated.body.counts.cashFlowItems, 2);
  assert.equal(validated.body.counts.cashFlowForecastSnapshots, 2);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200, JSON.stringify(capabilities.body));
  assert.equal(capabilities.body.capabilities.cashFlowForecasting.horizonWeeks, 13);
  assert.equal(capabilities.body.capabilities.cashFlowForecasting.fundsMoved, false);
  assert.equal(capabilities.body.capabilities.requestSafety.cashFlowEntryKey, 'durable');
});
