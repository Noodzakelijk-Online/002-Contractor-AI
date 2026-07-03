const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-client-success-'));
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

async function createJob(baseUrl, payload) {
  const result = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: payload.clientName || 'Client Success QA',
      clientEmail: payload.clientEmail || 'client-success@example.test',
      clientPhone: payload.clientPhone || '+31 6 11111111',
      address: payload.address || 'Singel 100, Amsterdam',
      city: payload.city || 'Amsterdam',
      service: payload.service || 'renovation',
      title: payload.title,
      description: payload.description || payload.title,
      priority: payload.priority || 'medium',
      estimatedCost: payload.estimatedCost || 1200,
      contractValue: payload.contractValue || payload.estimatedCost || 1200,
      estimatedHours: payload.estimatedHours || 8,
      ...payload
    })
  });
  assert.equal(result.response.status, 201);
  return result.body.job.id;
}

async function resolvePendingClientApprovals(baseUrl, jobId) {
  const clientTargets = new Set([
    'communication',
    'client_selection',
    'quality_check',
    'punch_item',
    'warranty_claim',
    'job_update'
  ]);
  const detail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(detail.response.status, 200);
  const approvals = detail.body.job.approvals.filter(approval =>
    approval.status === 'pending' && clientTargets.has(approval.targetType)
  );
  for (const approval of approvals) {
    const resolved = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(approval.id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ status: 'approved', resolvedBy: 'Client Success QA' })
    });
    assert.equal(resolved.response.status, 200);
    assert.equal(resolved.body.approval.status, 'approved');
  }
}

test('client success API coordinates closeout, waiting-client, aftercare and approval work', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const closeoutJobId = await createJob(baseUrl, {
    title: 'Client success closeout bathroom',
    service: 'bathroom renovation',
    status: 'completed',
    progressPercent: 100,
    priority: 'high',
    estimatedCost: 4500,
    contractValue: 4500,
    targetCompletion: '2026-07-03T16:00:00.000Z'
  });
  await resolvePendingClientApprovals(baseUrl, closeoutJobId);

  const closeoutQueue = await request(baseUrl, '/api/ledger/client-success?mode=closeout&limit=100');
  assert.equal(closeoutQueue.response.status, 200);
  const closeoutJob = closeoutQueue.body.jobs.find(job => job.jobId === closeoutJobId);
  assert.ok(closeoutJob);
  assert.equal(closeoutJob.flags.closeoutReady, true);
  assert.equal(closeoutJob.flags.approvalRequired, false);
  assert.ok(closeoutJob.counts.pendingApprovals === 0);
  assert.ok(closeoutJob.nextActions.some(action => action.type === 'prepare_closeout'));
  assert.ok(closeoutQueue.body.summary.closeoutReady >= 1);

  const aftercare = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(closeoutJobId)}/aftercare`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'One-week satisfaction check',
      status: 'open',
      dueAt: yesterday,
      notes: 'Confirm warranty questions and review closeout handover.'
    })
  });
  assert.equal(aftercare.response.status, 201);

  const aftercareQueue = await request(baseUrl, '/api/ledger/client-success?mode=aftercare&limit=100');
  assert.equal(aftercareQueue.response.status, 200);
  const aftercareJob = aftercareQueue.body.jobs.find(job => job.jobId === closeoutJobId);
  assert.ok(aftercareJob);
  assert.equal(aftercareJob.flags.aftercareDue, true);
  assert.equal(aftercareJob.counts.dueAftercare, 1);
  assert.ok(aftercareJob.nextActions.some(action => action.type === 'complete_aftercare'));
  assert.ok(aftercareQueue.body.summary.aftercareDue >= 1);

  const waitingJobId = await createJob(baseUrl, {
    title: 'Client success waiting kitchen',
    service: 'kitchen installation',
    status: 'scheduled',
    progressPercent: 40,
    estimatedCost: 2500,
    contractValue: 2500
  });
  await resolvePendingClientApprovals(baseUrl, waitingJobId);

  const selection = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(waitingJobId)}/client-selections`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Choose tile colour',
      category: 'finish',
      status: 'pending_client',
      dueAt: yesterday,
      options: ['matte white', 'warm grey'],
      value: 450
    })
  });
  assert.equal(selection.response.status, 201);
  assert.equal(selection.body.clientSelection.status, 'pending_client');

  const communication = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(waitingJobId)}/communication`, {
    method: 'POST',
    body: JSON.stringify({
      channel: 'email',
      direction: 'outbound',
      status: 'sent',
      subject: 'Please confirm access and tile selection',
      body: 'Can you confirm access and the selected tile colour?',
      expectsReply: true,
      replyBy: yesterday,
      requiresApproval: false
    })
  });
  assert.equal(communication.response.status, 201);
  assert.equal(communication.body.communication.status, 'sent');

  const waitingQueue = await request(baseUrl, '/api/ledger/client-success?mode=waiting&limit=100');
  assert.equal(waitingQueue.response.status, 200);
  const waitingJob = waitingQueue.body.jobs.find(job => job.jobId === waitingJobId);
  assert.ok(waitingJob);
  assert.equal(waitingJob.flags.waitingClient, true);
  assert.equal(waitingJob.counts.overdueSelections, 1);
  assert.equal(waitingJob.counts.waitingReplies, 1);
  assert.equal(waitingJob.counts.overdueReplies, 1);
  assert.ok(waitingJob.nextActions.some(action => action.type === 'selection_follow_up'));
  assert.ok(waitingJob.nextActions.some(action => action.type === 'client_reply_follow_up'));
  assert.ok(waitingQueue.body.summary.waitingClient >= 1);

  const warrantyJobId = await createJob(baseUrl, {
    title: 'Client success warranty gate',
    service: 'aftercare service',
    status: 'completed',
    progressPercent: 100,
    estimatedCost: 900,
    contractValue: 900
  });
  await resolvePendingClientApprovals(baseUrl, warrantyJobId);

  const warranty = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(warrantyJobId)}/warranty-claims`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Resolve loose hinge claim',
      status: 'resolved',
      severity: 'medium',
      dueAt: yesterday,
      issue: 'Client reported a loose cabinet hinge.',
      resolution: 'Hinge adjusted and retested.'
    })
  });
  assert.equal(warranty.response.status, 201);
  assert.equal(warranty.body.warrantyClaim.status, 'pending_approval');
  assert.ok(warranty.body.warrantyClaim.approvalId);

  const approvalQueue = await request(baseUrl, '/api/ledger/client-success?mode=approval&limit=100');
  assert.equal(approvalQueue.response.status, 200);
  const approvalJob = approvalQueue.body.jobs.find(job => job.jobId === warrantyJobId);
  assert.ok(approvalJob);
  assert.equal(approvalJob.flags.approvalRequired, true);
  assert.equal(approvalJob.counts.pendingApprovals, 1);
  assert.ok(approvalJob.nextActions.some(action => action.type === 'review_client_approval'));

  const resolvedWarranty = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(warranty.body.warrantyClaim.approvalId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Client Success QA' })
  });
  assert.equal(resolvedWarranty.response.status, 200);
  assert.equal(resolvedWarranty.body.approval.status, 'approved');

  const clearedApprovalQueue = await request(baseUrl, '/api/ledger/client-success?mode=approval&limit=100');
  assert.equal(clearedApprovalQueue.response.status, 200);
  assert.equal(clearedApprovalQueue.body.jobs.some(job => job.jobId === warrantyJobId), false);
});
