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

test('notification test endpoint is a dry-run draft and never reports live delivery', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const result = await request(baseUrl, '/api/test/notifications', {
    method: 'POST',
    body: JSON.stringify({ type: 'all' })
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.deliveryMode, 'dry_run');
  assert.equal(result.body.notSent, true);
  assert.match(result.body.message, /no external messages were sent/i);
  assert.equal(result.body.channels.length, 2);

  for (const channel of result.body.channels) {
    assert.equal(channel.status, 'dry_run');
    assert.equal(channel.notSent, true);
    assert.equal(channel.requiresApproval, true);
    assert.match(channel.content, /dry-run notification draft/i);
  }
});

test('simulated client request creates a draft plan by default instead of applying commitments', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const result = await request(baseUrl, '/api/simulate/client-request', {
    method: 'POST',
    body: JSON.stringify({ scenario: 'Garden maintenance' })
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'analyzed_with_draft_plan');
  assert.equal(result.body.deliveryMode, 'draft_only');
  assert.equal(result.body.notSent, true);
  assert.equal(result.body.execution, null);
  assert.equal(result.body.job.status, 'pending');
  assert.ok(result.body.nextSteps.includes('draft_client_update'));
  assert.ok(!result.body.nextSteps.includes('notify_client'));

  const clientUpdate = result.body.plan.actions.find(action => action.type === 'draft_client_update');
  assert.ok(clientUpdate);
  assert.equal(clientUpdate.status, 'draft');
  assert.equal(clientUpdate.requiresApproval, true);
  assert.equal(clientUpdate.notSent, true);
});

test('legacy client chat uses approval-safe draft wording', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const result = await request(baseUrl, '/api/legacy/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ message: 'What client updates are ready?' })
  });

  assert.equal(result.response.status, 200);
  assert.match(result.body.response, /draft/i);
  assert.match(result.body.response, /approval/i);
  assert.doesNotMatch(result.body.response, /I've sent/i);
  assert.doesNotMatch(result.body.response, /\bsent her\b/i);
});

test('legacy autonomous cycle previews by default instead of mutating job state', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const job = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Preview-only garden cleanup',
      client: 'Safety Client',
      address: 'Amsterdam',
      description: 'Garden maintenance with hedge trimming and cleanup',
      priority: 'medium'
    })
  });
  assert.equal(job.response.status, 201);

  const cycle = await request(baseUrl, '/api/ai/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ maxActions: 20 })
  });

  assert.equal(cycle.response.status, 200);
  assert.equal(cycle.body.mode, 'dry_run');
  assert.equal(cycle.body.defaultedToDryRun, true);
  assert.equal(cycle.body.notApplied, true);
  assert.match(cycle.body.approvalPolicy, /previews/i);

  const detail = await request(baseUrl, `/api/jobs/${job.body.id}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.status, 'pending');
  assert.equal(detail.body.worker || null, null);
  assert.equal(detail.body.assignedWorkerId || null, null);
});

test('legacy autonomous cycle can still be explicitly applied for internal state', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const cycle = await request(baseUrl, '/api/ai/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: false, maxActions: 1 })
  });

  assert.equal(cycle.response.status, 200);
  assert.equal(cycle.body.mode, 'applied');
  assert.equal(cycle.body.defaultedToDryRun, false);
  assert.equal(cycle.body.notApplied, false);
  assert.match(cycle.body.approvalPolicy, /explicitly applied/i);
});

test('top-level communication API records outbound drafts without sending', async t => {
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

  const outbound = await request(baseUrl, '/api/communication', {
    method: 'POST',
    body: JSON.stringify({
      ledgerJobId: job.body.job.id,
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

  const inbound = await request(baseUrl, '/api/communication', {
    method: 'POST',
    body: JSON.stringify({
      jobId: job.body.job.id,
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

  const list = await request(baseUrl, '/api/communication?status=all&limit=100');
  assert.equal(list.response.status, 200);
  assert.ok(list.body.communications.some(item => item.id === outbound.body.communication.id));
  assert.ok(list.body.communications.some(item => item.id === inbound.body.communication.id));
  assert.ok(list.body.summary.outboundDrafts >= 1);
  assert.ok(list.body.summary.pendingApproval >= 1);
});

test('top-level communication API requires an existing job target', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const result = await request(baseUrl, '/api/communication', {
    method: 'POST',
    body: JSON.stringify({
      channel: 'email',
      direction: 'outbound',
      subject: 'Missing target',
      body: 'This should not be recorded without a job.'
    })
  });

  assert.equal(result.response.status, 400);
  assert.match(result.body.error.message, /valid jobId or ledgerJobId/i);
});
