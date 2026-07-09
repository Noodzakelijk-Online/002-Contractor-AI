const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-dashboard-ledger-'));
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
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

test('dashboard publishes persisted ledger records as the primary command-center source', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Ledger-first dashboard regression',
      client: { name: 'Dashboard Client', address: 'Utrecht' },
      service: 'maintenance',
      description: 'A durable intake record used to verify the dashboard source.',
      priority: 'high',
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);

  const dashboard = await request(baseUrl, '/api/dashboard');
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.dashboardSource, 'ledger');
  assert.ok(Array.isArray(dashboard.body.jobs));
  assert.ok(Array.isArray(dashboard.body.ledgerJobs));
  assert.ok(Array.isArray(dashboard.body.ledgerWorkers));
  assert.ok(Array.isArray(dashboard.body.ledgerTools));
  const persistedJob = dashboard.body.ledgerJobs.find(job => job.id === intake.body.job.id);
  assert.ok(persistedJob);
  assert.equal(persistedJob.source, 'ledger');
  assert.equal(persistedJob.title, 'Ledger-first dashboard regression');
  assert.ok(dashboard.body.ledger);
  assert.ok(dashboard.body.ledger.metrics);
});
