const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-legacy-ledger-'));
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

test('legacy job API updates ledger-only jobs and approval-gates delete as cancellation', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Legacy compatible ledger job',
      service: 'painting',
      clientName: 'Legacy Compat Client',
      clientPhone: '+31 6 33333333',
      address: 'Singel 88, Amsterdam',
      priority: 'medium',
      status: 'planned',
      estimatedCost: 900,
      contractValue: 900,
      estimatedHours: 8
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const listed = await request(baseUrl, '/api/jobs?search=Legacy%20compatible');
  assert.equal(listed.response.status, 200);
  assert.ok(listed.body.some(job => job.id === jobId && job.source === 'ledger'));

  const edited = await request(baseUrl, `/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: 'Legacy compatible edited ledger job',
      priority: 'high'
    })
  });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.body.success, true);
  assert.equal(edited.body.source, 'ledger');
  assert.equal(edited.body.operationStatus, 'updated');
  assert.equal(edited.body.requiresApproval, false);
  assert.equal(edited.body.title, 'Legacy compatible edited ledger job');
  assert.equal(edited.body.priority, 'high');

  const detailAfterEdit = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(detailAfterEdit.response.status, 200);
  assert.equal(detailAfterEdit.body.job.title, 'Legacy compatible edited ledger job');
  assert.ok(detailAfterEdit.body.job.audit.some(event => event.action === 'update_job'));

  const completionProposal = await request(baseUrl, `/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      status: 'completed',
      progress: 100,
      reason: 'Legacy-compatible update should still require completion approval.'
    })
  });
  assert.equal(completionProposal.response.status, 200);
  assert.equal(completionProposal.body.success, true);
  assert.equal(completionProposal.body.operationStatus, 'pending_approval');
  assert.equal(completionProposal.body.requiresApproval, true);
  assert.equal(completionProposal.body.approval.targetType, 'job_update');
  assert.equal(completionProposal.body.proposedPatch.status, 'completed');

  const detailBeforeApproval = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(detailBeforeApproval.response.status, 200);
  assert.notEqual(detailBeforeApproval.body.job.status, 'completed');

  const approvedCompletion = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(completionProposal.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Legacy Compat Test', reason: 'Completion verified.' })
  });
  assert.equal(approvedCompletion.response.status, 200);
  assert.equal(approvedCompletion.body.approval.status, 'approved');

  const legacyDetail = await request(baseUrl, `/api/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(legacyDetail.response.status, 200);
  assert.equal(legacyDetail.body.status, 'completed');

  const deleteProposal = await request(baseUrl, `/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason: 'Cancellation requested through legacy-compatible route.' })
  });
  assert.equal(deleteProposal.response.status, 200);
  assert.equal(deleteProposal.body.success, true);
  assert.equal(deleteProposal.body.deleted, false);
  assert.equal(deleteProposal.body.retained, true);
  assert.equal(deleteProposal.body.operationStatus, 'pending_approval');
  assert.equal(deleteProposal.body.requiresApproval, true);
  assert.equal(deleteProposal.body.approval.targetType, 'job_update');
  assert.equal(deleteProposal.body.proposedPatch.status, 'cancelled');

  const detailAfterDeleteRequest = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(detailAfterDeleteRequest.response.status, 200);
  assert.equal(detailAfterDeleteRequest.body.job.status, 'completed');

  const approvedCancellation = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(deleteProposal.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Legacy Compat Test', reason: 'Cancellation verified.' })
  });
  assert.equal(approvedCancellation.response.status, 200);
  assert.equal(approvedCancellation.body.approval.status, 'approved');

  const cancelledDetail = await request(baseUrl, `/api/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(cancelledDetail.response.status, 200);
  assert.equal(cancelledDetail.body.status, 'cancelled');
});
