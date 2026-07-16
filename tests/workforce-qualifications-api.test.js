const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-qualification-api-'));
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

test('qualification API gates site access and attendance with approved current evidence', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const scheduledStart = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const scheduledEnd = new Date(Date.now() + 8 * 86_400_000).toISOString();

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: `Qualification API job ${suffix}`,
      clientName: `Qualification API client ${suffix}`,
      status: 'scheduled',
      scheduledStart,
      scheduledEnd
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const workerResult = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ name: `Qualification API worker ${suffix}`, role: 'Site carpenter', status: 'available' })
  });
  assert.equal(workerResult.response.status, 201);
  const workerId = workerResult.body.worker.id;

  const assignmentResult = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId, role: 'Site carpenter', status: 'planned', scheduledStart, scheduledEnd })
  });
  assert.equal(assignmentResult.response.status, 201);
  const assignment = assignmentResult.body.assignment;

  const requirementResult = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/qualification-requirements`, {
    method: 'POST',
    body: JSON.stringify({ credentialType: 'vca', role: 'Site carpenter', title: 'Current VCA for controlled site access' })
  });
  assert.equal(requirementResult.response.status, 201);
  assert.equal(requirementResult.body.requirement.status, 'active');
  assert.equal(requirementResult.body.qualificationRegister.summary.blockedAssignments, 1);

  const orientationResult = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/orientations`, {
    method: 'POST',
    body: JSON.stringify({
      assignmentId: assignment.id,
      workerId,
      workerName: workerResult.body.worker.name,
      company: 'Internal crew',
      status: 'completed',
      notes: 'Identity, site rules, emergency controls, and task boundaries reviewed.'
    })
  });
  assert.equal(orientationResult.response.status, 201);
  assert.ok(orientationResult.body.orientation.approvalId);
  const orientationApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(orientationResult.body.orientation.approvalId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'qualification_api_approver', reason: 'Orientation evidence verified.' })
  });
  assert.equal(orientationApproval.response.status, 200);

  const blockedAccess = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/site-access`, {
    method: 'POST',
    body: JSON.stringify({
      assignmentId: assignment.id,
      workerId,
      orientationId: orientationResult.body.orientation.id,
      workerName: workerResult.body.worker.name,
      status: 'cleared',
      accessPoint: 'Main gate'
    })
  });
  assert.equal(blockedAccess.response.status, 201);
  assert.equal(blockedAccess.body.siteAccessLog.status, 'blocked');
  assert.equal(blockedAccess.body.siteAccessLog.approval, null);
  assert.match(blockedAccess.body.siteAccessLog.data.blockedReason, /VCA/i);

  const invalidCredential = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(workerId)}/credentials`, {
    method: 'POST',
    body: JSON.stringify({ credentialType: 'vca_basic', evidenceReference: 'x' })
  });
  assert.equal(invalidCredential.response.status, 400);
  assert.equal(invalidCredential.body.error.code, 'worker_credential_evidence_required');

  const credentialResult = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(workerId)}/credentials`, {
    method: 'POST',
    body: JSON.stringify({
      credentialType: 'vca_basic',
      issuer: 'SSVV examination centre',
      credentialNumber: `VCA-API-${suffix}`,
      issuedOn: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
      expiresOn: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10),
      evidenceReference: `Retained VCA certificate scan VCA-API-${suffix}`
    })
  });
  assert.equal(credentialResult.response.status, 201);
  assert.equal(credentialResult.body.credential.status, 'pending_approval');
  assert.equal(credentialResult.body.worker.qualification.pending, 1);

  const credentialApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(credentialResult.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'qualification_api_approver', reason: 'Certificate source and dates verified.' })
  });
  assert.equal(credentialApproval.response.status, 200);

  const registerResult = await request(baseUrl, '/api/ledger/qualifications');
  assert.equal(registerResult.response.status, 200);
  assert.ok(registerResult.body.qualificationRegister.catalog.credentials.some(item => item.key === 'vca_basic'));
  assert.equal(registerResult.body.qualificationRegister.summary.blockedAssignments, 0);

  const pendingAccess = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/site-access`, {
    method: 'POST',
    body: JSON.stringify({
      assignmentId: assignment.id,
      workerId,
      orientationId: orientationResult.body.orientation.id,
      workerName: workerResult.body.worker.name,
      status: 'cleared',
      accessPoint: 'Main gate'
    })
  });
  assert.equal(pendingAccess.response.status, 201);
  assert.equal(pendingAccess.body.siteAccessLog.status, 'pending_approval');
  assert.ok(pendingAccess.body.siteAccessLog.approval.id);

  const accessApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(pendingAccess.body.siteAccessLog.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'qualification_api_approver', reason: 'Orientation and current VCA verified.' })
  });
  assert.equal(accessApproval.response.status, 200);

  const attendance = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/attendance/check-in`, {
    method: 'POST',
    body: JSON.stringify({
      assignmentId: assignment.id,
      workerId,
      workerName: workerResult.body.worker.name,
      entryKey: `qualification-api-check-in-${suffix}`,
      occurredAt: new Date().toISOString(),
      accessPoint: 'Main gate'
    })
  });
  assert.equal(attendance.response.status, 201);
  assert.equal(attendance.body.session.status, 'checked_in');
});
