const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-comm-safety-'));
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');

const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  return { response, body };
}

test('synthetic notification endpoint is retired in favor of job-linked ledger drafts', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const result = await request(baseUrl, '/api/test/notifications', {
    method: 'POST',
    body: JSON.stringify({ type: 'all' })
  });

  assert.equal(result.response.status, 410);
  assert.equal(result.body.error.code, 'test_notification_route_retired');
  assert.equal(result.body.migration.endpoint, '/api/ledger/jobs/:jobId/communication');
  assert.equal(result.body.migration.approvalRequired, true);
});

test('sample client request endpoint is retired and cannot create non-ledger jobs', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const before = await request(baseUrl, '/api/ledger/jobs?limit=500');
  assert.equal(before.response.status, 200);

  const result = await request(baseUrl, '/api/simulate/client-request', {
    method: 'POST',
    body: JSON.stringify({ scenario: 'Garden maintenance' })
  });

  assert.equal(result.response.status, 410);
  assert.equal(result.body.error.code, 'simulation_retired');

  const after = await request(baseUrl, '/api/ledger/jobs?limit=500');
  assert.equal(after.response.status, 200);
  assert.deepEqual(after.body.jobs.map(job => job.id).sort(), before.body.jobs.map(job => job.id).sort());
});

test('legacy simulated chat endpoint is retired', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const result = await request(baseUrl, '/api/legacy/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'What client updates are ready?' })
  });

  assert.equal(result.response.status, 410);
  assert.equal(result.body.error.code, 'legacy_chat_retired');
});

test('unpersisted conversational AI is retired in favor of the ledger command plan', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const result = await request(baseUrl, '/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'What should I do next?' })
  });

  assert.equal(result.response.status, 410);
  assert.equal(result.body.error.code, 'conversational_ai_route_retired');
  assert.deepEqual(result.body.migration, { endpoint: '/api/ledger/command-plan', method: 'GET' });
});

test('legacy autonomous cycle is retired in favor of ledger-only automation', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const cycle = await request(baseUrl, '/api/ai/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ maxActions: 20 })
  });

  assert.equal(cycle.response.status, 410);
  assert.equal(cycle.body.error.code, 'legacy_autonomy_retired');
  assert.match(cycle.body.error.message, /\/api\/ledger\/autonomous-cycle/);
});

test('ledger communication API records outbound drafts without sending', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const job = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Communication facade paving job',
      client: { name: 'Facade Client', email: 'facade@example.test' },
      address: 'Rotterdam',
      service: 'paving',
      description: 'Client asked for a paving quote and timeline.'
    })
  });
  assert.equal(job.response.status, 201);

  const outbound = await request(baseUrl, `/api/ledger/jobs/${job.body.job.id}/communication`, {
    method: 'POST',
    body: JSON.stringify({
      channel: 'email',
      direction: 'outbound',
      status: 'sent',
      subject: 'Paving quote update',
      body: 'We can start next week and will send the quote after approval.',
      sentAt: '2026-07-01T10:00:00.000Z'
    })
  });

  assert.equal(outbound.response.status, 201);
  assert.equal(outbound.body.deliveryMode, 'draft_only');
  assert.equal(outbound.body.notSent, true);
  assert.equal(outbound.body.approvalRequired, true);
  assert.equal(outbound.body.communication.status, 'draft');
  assert.equal(outbound.body.communication.sentAt || null, null);
  assert.ok(outbound.body.communication.approvalId);
  assert.equal(outbound.body.communication.approval.approvalType, 'external_communication');
  assert.ok(outbound.body.job.communications.some(item => item.id === outbound.body.communication.id));

  const inbound = await request(baseUrl, `/api/ledger/jobs/${job.body.job.id}/communication`, {
    method: 'POST',
    body: JSON.stringify({
      channel: 'portal',
      direction: 'inbound',
      subject: 'Client confirmation',
      body: 'Please use grey pavers.'
    })
  });

  assert.equal(inbound.response.status, 201);
  assert.equal(inbound.body.deliveryMode, 'record_only');
  assert.equal(inbound.body.notSent, false);
  assert.equal(inbound.body.approvalRequired, false);
  assert.equal(inbound.body.communication.status, 'received');
  assert.equal(inbound.body.communication.approvalId || null, null);

  const list = await request(baseUrl, '/api/ledger/communications?status=all&limit=100');
  assert.equal(list.response.status, 200);
  assert.ok(list.body.communications.some(item => item.id === outbound.body.communication.id));
  assert.ok(list.body.communications.some(item => item.id === inbound.body.communication.id));
  assert.ok(list.body.summary.outboundDrafts >= 1);
  assert.ok(list.body.summary.pendingApproval >= 1);
});

test('ledger communication API requires an existing job target', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const result = await request(baseUrl, '/api/ledger/jobs/job_missing/communication', {
    method: 'POST',
    body: JSON.stringify({
      channel: 'email', direction: 'outbound', subject: 'Missing target', body: 'This should not be recorded without a job.'
    })
  });

  assert.equal(result.response.status, 404);
  assert.match(result.body.error.message, /ledger job not found/i);
});
