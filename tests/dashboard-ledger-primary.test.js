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

test('canonical ledger dashboard and resource routes publish the command-center source', async t => {
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

  const dashboard = await request(baseUrl, '/api/ledger/dashboard');
  const jobs = await request(baseUrl, '/api/ledger/jobs?limit=500');
  const workers = await request(baseUrl, '/api/ledger/workers?limit=500');
  const tools = await request(baseUrl, '/api/ledger/tools?limit=500');
  assert.equal(dashboard.response.status, 200);
  assert.equal(jobs.response.status, 200);
  assert.equal(workers.response.status, 200);
  assert.equal(tools.response.status, 200);
  assert.ok(dashboard.body.dashboard.metrics);
  assert.ok(dashboard.body.dashboard.capabilities.length > 0);
  assert.ok(Array.isArray(jobs.body.jobs));
  assert.ok(Array.isArray(workers.body.workers));
  assert.ok(Array.isArray(tools.body.tools));
  const persistedJob = jobs.body.jobs.find(job => job.id === intake.body.job.id);
  assert.ok(persistedJob);
  assert.equal(persistedJob.title, 'Ledger-first dashboard regression');
  assert.equal(dashboard.body.dashboard.metrics.jobs, jobs.body.jobs.length);
});
