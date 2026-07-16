const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-client-followup-'));
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');
process.env.CONTRACTOR_AI_VERIFIED_INTEGRATIONS = 'test_provider';

const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  return { response, body };
}

test('autonomous cycle drafts approval-gated client reply follow-up without sending', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const sentAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  const replyBy = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Client confirmation follow-up QA',
      service: 'Garden maintenance',
      client: {
        name: 'Follow Up Client',
        email: 'client@example.test',
        phone: '+31600000000',
        address: 'Keizersgracht 10, Amsterdam',
        country: 'NL'
      },
      address: 'Keizersgracht 10, Amsterdam',
      city: 'Amsterdam',
      priority: 'medium',
      estimatedCost: 450,
      estimatedHours: 5,
      tasks: ['Confirm access', 'Trim hedges']
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const original = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/communication`, {
    method: 'POST',
    body: JSON.stringify({
      channel: 'email',
      direction: 'outbound',
      sentAt,
      subject: 'Confirm Friday access and green-waste bags',
      body: 'Can you confirm Friday access and whether green-waste bags are available?',
      expectsReply: true,
      replyBy,
      requiresApproval: true
    })
  });
  assert.equal(original.response.status, 201);
  assert.equal(original.body.communication.status, 'draft');
  assert.equal(original.body.communication.data.expectsReply, true);

  const prematureReceipt = await request(baseUrl, `/api/ledger/communications/${original.body.communication.id}/delivery-receipt`, {
    method: 'POST',
    body: JSON.stringify({ integration: 'test_provider', providerMessageId: 'provider-message-123', sentAt })
  });
  assert.equal(prematureReceipt.response.status, 409);
  assert.equal(prematureReceipt.body.error.code, 'communication_approval_required');

  const approval = await request(baseUrl, `/api/ledger/approvals/${original.body.communication.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Integration approval test', reason: 'Client communication approved for delivery.' })
  });
  assert.equal(approval.response.status, 200);

  const unverifiedReceipt = await request(baseUrl, `/api/ledger/communications/${original.body.communication.id}/delivery-receipt`, {
    method: 'POST',
    body: JSON.stringify({ integration: 'unconfigured_provider', providerMessageId: 'provider-message-123', sentAt })
  });
  assert.equal(unverifiedReceipt.response.status, 409);
  assert.equal(unverifiedReceipt.body.error.code, 'verified_integration_required');

  const delivered = await request(baseUrl, `/api/ledger/communications/${original.body.communication.id}/delivery-receipt`, {
    method: 'POST',
    body: JSON.stringify({ integration: 'test_provider', providerMessageId: 'provider-message-123', sentAt, receipt: { status: 'accepted' } })
  });
  assert.equal(delivered.response.status, 200);
  assert.equal(delivered.body.communication.status, 'sent');
  assert.equal(delivered.body.communication.data.deliveryReceipt.integration, 'test_provider');

  const dryRun = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, actor: 'test' })
  });
  assert.equal(dryRun.response.status, 200);
  const previewAction = dryRun.body.preview.find(action =>
    action.type === 'client_reply_follow_up'
    && action.communicationId === original.body.communication.id
  );
  assert.ok(previewAction);
  assert.equal(previewAction.jobId, jobId);

  const cycle = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({
      dryRun: false,
      actor: 'test',
      actionTypes: ['client_reply_follow_up'],
      jobIds: [jobId],
      maxActions: 1
    })
  });
  assert.equal(cycle.response.status, 200);
  const applied = cycle.body.applied.find(action =>
    action.type === 'client_reply_follow_up'
    && action.communicationId === original.body.communication.id
  );
  assert.ok(applied);
  assert.equal(applied.status, 'drafted');
  assert.ok(applied.followUpCommunicationId);
  assert.ok(applied.approvalId);

  const detail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(detail.response.status, 200);
  const followUp = detail.body.job.communications.find(item => item.id === applied.followUpCommunicationId);
  assert.ok(followUp);
  assert.equal(followUp.status, 'draft');
  assert.equal(followUp.direction, 'outbound');
  assert.equal(followUp.data.followUpFor, original.body.communication.id);
  assert.ok(followUp.approvalId);
  assert.match(followUp.body, /Robert can review this follow-up before anything is sent/);
  assert.ok(detail.body.job.audit.some(event => event.action === 'autonomous_draft_client_reply_followup'));

  const approvals = await request(baseUrl, '/api/ledger/approvals?status=pending&limit=100');
  assert.equal(approvals.response.status, 200);
  assert.ok(approvals.body.approvals.some(approval =>
    approval.id === applied.approvalId
    && approval.targetType === 'communication'
    && approval.approvalType === 'external_communication'
  ));

  const communications = await request(baseUrl, '/api/ledger/communications?status=all&limit=100');
  assert.equal(communications.response.status, 200);
  assert.ok(communications.body.summary.total >= 2);
  assert.ok(communications.body.summary.outboundDrafts >= 1);
  assert.ok(communications.body.summary.pendingApproval >= 1);
  assert.ok(communications.body.summary.waitingForReply >= 1);
  assert.ok(communications.body.communications.some(item =>
    item.id === original.body.communication.id
    && item.jobId === jobId
    && item.jobTitle === 'Client confirmation follow-up QA'
    && item.clientName === 'Follow Up Client'
  ));
  assert.ok(communications.body.communications.some(item =>
    item.id === applied.followUpCommunicationId
    && item.approvalId === applied.approvalId
    && item.status === 'draft'
    && item.data.followUpFor === original.body.communication.id
  ));

  const secondDryRun = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, actor: 'test' })
  });
  assert.equal(secondDryRun.response.status, 200);
  assert.equal(secondDryRun.body.preview.some(action =>
    action.type === 'client_reply_follow_up'
    && action.communicationId === original.body.communication.id
  ), false);
});
