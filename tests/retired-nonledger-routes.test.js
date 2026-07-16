const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-retired-routes-'));
process.env.STATE_FILE = path.join(stateDirectory, 'legacy-state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');

const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  return { response, body: await response.json() };
}

test('non-ledger job, worker, and tool routes are explicit retirement boundaries', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (const route of ['/api/jobs', '/api/jobs/old-job/tasks', '/api/workers', '/api/workers/old-worker', '/api/tools', '/api/tools/old-tool']) {
    const result = await request(baseUrl, route, { method: 'POST', body: '{}' });
    assert.equal(result.response.status, 410, route);
    assert.equal(result.body.error.code, 'legacy_resource_route_retired');
  }

  const jobMigration = await request(baseUrl, '/api/jobs');
  assert.equal(jobMigration.response.status, 410);
  assert.equal(jobMigration.body.migration.collection, '/api/ledger/jobs');
  assert.equal(jobMigration.body.migration.intake, '/api/ledger/intake');
  assert.equal(jobMigration.body.migration.records, '/api/ledger/jobs/:jobId/*');

  const workerMigration = await request(baseUrl, '/api/workers');
  assert.equal(workerMigration.response.status, 410);
  assert.equal(workerMigration.body.migration.collection, '/api/ledger/workers');

  const toolMigration = await request(baseUrl, '/api/tools');
  assert.equal(toolMigration.response.status, 410);
  assert.equal(toolMigration.body.migration.collection, '/api/ledger/tools');
});

test('the ledger remains the only mutating contractor resource API', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({ title: 'Ledger-only source-of-truth regression', client: { name: 'Ledger Client' } })
  });
  assert.equal(intake.response.status, 201);

  const jobs = await request(baseUrl, '/api/ledger/jobs?limit=100');
  assert.equal(jobs.response.status, 200);
  assert.ok(jobs.body.jobs.some(job => job.id === intake.body.job.id));

  const diagnostics = await request(baseUrl, '/api/debug/diagnostics');
  assert.equal(diagnostics.response.status, 200);
  assert.equal(diagnostics.body.persistence.mode, 'ledger_only');
  assert.equal(diagnostics.body.ledger.diagnostics.valid, true);
});

test('operational facades point callers to ledger records', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const expected = {
    '/api/clients': '/api/ledger/clients',
    '/api/approvals': '/api/ledger/approvals',
    '/api/audit': '/api/ledger/audit',
    '/api/communication': '/api/ledger/communications',
    '/api/weather/assess': '/api/ledger/weather/assess',
    '/api/schedule/recommend': '/api/ledger/schedule/recommend'
  };
  for (const [route, endpoint] of Object.entries(expected)) {
    const result = await request(baseUrl, route);
    assert.equal(result.response.status, 410, route);
    assert.equal(result.body.error.code, 'ledger_facade_route_retired');
    assert.equal(result.body.migration.endpoint, endpoint);
  }
});

test('dashboard and evidence facades are non-mutating migration boundaries', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const dashboard = await request(baseUrl, '/api/dashboard');
  assert.equal(dashboard.response.status, 410);
  assert.equal(dashboard.body.error.code, 'dashboard_facade_retired');
  assert.equal(dashboard.body.migration.dashboard, '/api/ledger/dashboard');

  const upload = await request(baseUrl, '/api/upload', {
    method: 'POST',
    body: JSON.stringify({ jobId: 'must-not-be-created', filename: 'evidence.pdf' })
  });
  assert.equal(upload.response.status, 410);
  assert.equal(upload.body.error.code, 'upload_facade_retired');
  assert.equal(upload.body.migration.endpoint, '/api/ledger/upload');

  const canonicalDashboard = await request(baseUrl, '/api/ledger/dashboard');
  assert.equal(canonicalDashboard.response.status, 200);
  assert.ok(canonicalDashboard.body.dashboard.metrics);
});
