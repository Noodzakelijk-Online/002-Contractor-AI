const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-framework-api-'));
const tokens = {
  owner: 'framework-owner-token-at-least-32-characters',
  approver: 'framework-approver-token-at-least-32-characters',
  office_operator: 'framework-office-token-at-least-32-characters',
  field_worker: { token: 'framework-field-token-at-least-32-characters', jobIds: ['none'] }
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
  const responseText = await response.text();
  return { response, body: responseText ? JSON.parse(responseText) : null };
}

test('framework API is role-scoped, cacheable, replay-safe, exportable, and revisioned', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'framework_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const fieldCatalog = await request(baseUrl, '/api/ledger/frameworks/catalog', tokens.field_worker.token);
  assert.equal(fieldCatalog.response.status, 403);
  const catalog = await request(baseUrl, '/api/ledger/frameworks/catalog?query=swot&limit=20', tokens.approver);
  assert.equal(catalog.response.status, 200, JSON.stringify(catalog.body));
  assert.equal(catalog.response.headers.get('cache-control'), 'private, max-age=3600');
  assert.equal(catalog.body.catalog.counts.frameworks, 671);
  assert.equal(catalog.body.catalog.frameworks[0].id, 'swot');

  const payload = {
    frameworkId: 'swot',
    scopeType: 'organization',
    status: 'draft',
    objective: 'Retain an evidence-based operating strategy review.',
    ownerName: 'Office lead',
    reason: 'Create the governed strategy review.',
    entryKey: 'framework-api-create-swot-0001'
  };
  const deniedCreate = await request(baseUrl, '/api/ledger/frameworks', tokens.approver, {
    method: 'POST', body: JSON.stringify(payload)
  });
  assert.equal(deniedCreate.response.status, 403);
  const created = await request(baseUrl, '/api/ledger/frameworks', tokens.office_operator, {
    method: 'POST', body: JSON.stringify(payload)
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.implementation.revision, 1);
  assert.equal(created.body.workspace.summary.statuses.draft, 1);

  const replay = await request(baseUrl, '/api/ledger/frameworks', tokens.office_operator, {
    method: 'POST', body: JSON.stringify(payload)
  });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.replayed, true);

  const implementationId = created.body.implementation.id;
  const updated = await request(baseUrl, `/api/ledger/frameworks/${implementationId}`, tokens.owner, {
    method: 'PATCH',
    body: JSON.stringify({
      ...payload,
      status: 'active',
      currentState: 'The operating strategy has no retained source-linked decision record.',
      targetState: 'The operating strategy is evidence-backed, owned, measured, and reviewed.',
      decision: 'Prioritize recurring service density and measure the result before expansion.',
      evidenceRefs: ['scorecard:current'],
      successMeasures: ['Recurring service revenue reaches 25 percent.'],
      reviewDueAt: '2026-12-31',
      reason: 'Activate the reviewed operating strategy.',
      expectedRevision: 1,
      entryKey: 'framework-api-update-swot-0001'
    })
  });
  assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.implementation.status, 'active');
  assert.equal(updated.body.implementation.revision, 2);

  const revisions = await request(baseUrl, `/api/ledger/frameworks/${implementationId}/revisions`, tokens.approver);
  assert.equal(revisions.response.status, 200);
  assert.equal(revisions.body.revisions.length, 2);
  assert.equal(revisions.body.revisions[0].snapshotHash.length, 64);

  const exported = await request(baseUrl, '/api/operations/export', tokens.owner);
  assert.equal(exported.response.status, 200);
  assert.equal(exported.body.frameworkImplementations.length, 1);
  assert.equal(exported.body.frameworkImplementationRevisions.length, 2);
  const validated = await request(baseUrl, '/api/operations/exports/validate', tokens.owner, {
    method: 'POST', body: JSON.stringify(exported.body)
  });
  assert.equal(validated.response.status, 200, JSON.stringify(validated.body));
  assert.equal(validated.body.counts.frameworkImplementations, 1);
  assert.equal(validated.body.counts.frameworkImplementationRevisions, 2);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.body.capabilities.operatingFrameworks.frameworkCount, 671);
  assert.equal(capabilities.body.capabilities.operatingFrameworks.externalCommitments, 0);
});
