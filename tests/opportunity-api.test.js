const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-opportunity-api-'));
const tokens = {
  owner: 'opportunity-owner-token-at-least-32-characters',
  approver: 'opportunity-approver-token-at-least-32-characters',
  office_operator: 'opportunity-office-token-at-least-32-characters',
  field_worker: { token: 'opportunity-field-token-at-least-32-characters', jobIds: ['none'] }
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

test('opportunity API enforces operator roles and exposes forecast, activity, and replay-safe conversion', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'opportunity_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const created = await request(baseUrl, '/api/ledger/opportunities', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'API Pipeline Client',
      title: 'API pipeline opportunity',
      service: 'Maintenance',
      estimatedValue: 7_500,
      nextFollowUpAt: new Date(Date.now() + 86_400_000).toISOString()
    })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.opportunity.stage, 'new');
  assert.equal(created.body.forecast.summary.open, 1);
  const opportunityId = created.body.opportunity.id;

  const approverRead = await request(baseUrl, '/api/ledger/opportunities', tokens.approver);
  assert.equal(approverRead.response.status, 200);
  assert.equal(approverRead.body.opportunities.length, 1);
  const approverWrite = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}`, tokens.approver, {
    method: 'PATCH',
    body: JSON.stringify({ stage: 'qualifying' })
  });
  assert.equal(approverWrite.response.status, 403);
  assert.equal(approverWrite.body.error.code, 'insufficient_role');

  const fieldRead = await request(baseUrl, '/api/ledger/opportunities', tokens.field_worker.token);
  assert.equal(fieldRead.response.status, 403);
  assert.equal(fieldRead.body.error.code, 'insufficient_role');

  const activity = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}/activities`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ activityType: 'site_call', summary: 'Confirm site survey window', dueAt: '2026-07-20' })
  });
  assert.equal(activity.response.status, 201);
  assert.equal(activity.body.opportunity.activities.length, 1);

  const converted = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}/convert`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ priority: 'medium' })
  });
  assert.equal(converted.response.status, 201);
  assert.equal(converted.body.replayed, false);
  assert.equal(converted.body.opportunity.convertedJobId, converted.body.job.id);
  const replay = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}/convert`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ priority: 'medium' })
  });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.job.id, converted.body.job.id);

  const detail = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}`, tokens.owner);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.opportunity.convertedJob.id, converted.body.job.id);
});
