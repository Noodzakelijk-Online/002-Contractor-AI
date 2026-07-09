const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-lifecycle-'));
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

async function createJob(baseUrl, title = 'Lifecycle transition QA job') {
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title,
      service: 'renovation',
      description: 'A persisted record lifecycle regression fixture.',
      address: 'Weteringschans 10, Amsterdam',
      client: { name: 'Lifecycle QA Client', email: 'lifecycle@example.test' }
    })
  });
  assert.equal(intake.response.status, 201);
  return intake.body.job.id;
}

async function resolveApproval(baseUrl, approvalId) {
  const resolved = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(approvalId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Lifecycle QA' })
  });
  assert.equal(resolved.response.status, 200);
  assert.equal(resolved.body.approval.status, 'approved');
}

test('lifecycle transitions update existing records and gate consequential closures', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jobId = await createJob(baseUrl);
  const otherJobId = await createJob(baseUrl, 'Lifecycle ownership QA job');

  const observation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/observations`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Loose threshold', status: 'open', severity: 'medium' })
  });
  assert.equal(observation.response.status, 201);

  const progressingObservation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/observation/${encodeURIComponent(observation.body.observation.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'in_progress', notes: 'Replacement threshold is being fitted.' })
  });
  assert.equal(progressingObservation.response.status, 200);
  assert.equal(progressingObservation.body.approvalRequired, false);
  assert.equal(progressingObservation.body.record.status, 'in_progress');

  const resolvingObservation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/observation/${encodeURIComponent(observation.body.observation.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'resolved', notes: 'Threshold replaced and photo evidence reviewed.', evidence: ['threshold-after.jpg'] })
  });
  assert.equal(resolvingObservation.response.status, 200);
  assert.equal(resolvingObservation.body.record.status, 'pending_approval');
  assert.equal(resolvingObservation.body.approvalRequired, true);
  assert.equal(resolvingObservation.body.approval.targetType, 'observation_record');
  assert.equal(resolvingObservation.body.record.data.lifecycleTransition.note, 'Threshold replaced and photo evidence reviewed.');
  await resolveApproval(baseUrl, resolvingObservation.body.approval.id);

  const incident = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/incidents`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Minor trip hazard', status: 'reported', severity: 'high' })
  });
  assert.equal(incident.response.status, 201);
  assert.ok(incident.body.incident.approvalId);
  const resolvingIncident = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/incident/${encodeURIComponent(incident.body.incident.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'resolved', notes: 'Cable route secured and crew briefed.' })
  });
  assert.equal(resolvingIncident.response.status, 200);
  assert.equal(resolvingIncident.body.record.status, 'pending_approval');
  assert.equal(resolvingIncident.body.approval.id, incident.body.incident.approvalId);
  assert.equal(resolvingIncident.body.approval.data.requestedStatus, 'resolved');
  await resolveApproval(baseUrl, resolvingIncident.body.approval.id);

  const punch = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/punch-items`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Paint touch-up', status: 'open', description: 'Finish the door frame.' })
  });
  assert.equal(punch.response.status, 201);
  const resolvingPunch = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/punch_item/${encodeURIComponent(punch.body.punchItem.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'verified', notes: 'Touch-up completed and checked in daylight.' })
  });
  assert.equal(resolvingPunch.response.status, 200);
  assert.equal(resolvingPunch.body.record.status, 'pending_approval');
  await resolveApproval(baseUrl, resolvingPunch.body.approval.id);

  const warranty = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/warranty-claims`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Cabinet hinge adjustment', status: 'open', issue: 'Hinge needs adjustment.' })
  });
  assert.equal(warranty.response.status, 201);
  const resolvingWarranty = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/warranty_claim/${encodeURIComponent(warranty.body.warrantyClaim.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'resolved', notes: 'Hinge adjusted and client outcome recorded.', resolution: 'Adjusted and retested.' })
  });
  assert.equal(resolvingWarranty.response.status, 200);
  assert.equal(resolvingWarranty.body.record.status, 'pending_approval');
  await resolveApproval(baseUrl, resolvingWarranty.body.approval.id);

  const aftercare = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/aftercare`, {
    method: 'POST',
    body: JSON.stringify({ title: 'One-week client follow-up', status: 'open', notes: 'Call client.' })
  });
  assert.equal(aftercare.response.status, 201);
  const completingAftercare = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/aftercare/${encodeURIComponent(aftercare.body.aftercare.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed', notes: 'Client confirmed the installation is working as expected.' })
  });
  assert.equal(completingAftercare.response.status, 200);
  assert.equal(completingAftercare.body.approvalRequired, false);
  assert.equal(completingAftercare.body.record.status, 'completed');

  const detail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.job.observations.length, 1);
  assert.equal(detail.body.job.observations[0].status, 'resolved');
  assert.ok(detail.body.job.observations[0].closedAt);
  assert.equal(detail.body.job.incidents.length, 1);
  assert.equal(detail.body.job.incidents[0].status, 'resolved');
  assert.ok(detail.body.job.incidents[0].resolvedAt);
  assert.equal(detail.body.job.punchItems.length, 1);
  assert.equal(detail.body.job.punchItems[0].status, 'verified');
  assert.equal(detail.body.job.warrantyClaims.length, 1);
  assert.equal(detail.body.job.warrantyClaims[0].status, 'resolved');
  assert.equal(detail.body.job.aftercare.length, 1);
  assert.equal(detail.body.job.aftercare[0].status, 'completed');
  assert.ok(detail.body.job.audit.some(event => event.action === 'transition_observation'));
  assert.ok(detail.body.job.audit.some(event => event.action === 'transition_aftercare'));

  const ownershipCheck = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(otherJobId)}/lifecycle/observation/${encodeURIComponent(observation.body.observation.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'resolved', notes: 'Must not cross job boundaries.' })
  });
  assert.equal(ownershipCheck.response.status, 404);

  const invalidType = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/not_a_record/${encodeURIComponent(observation.body.observation.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'resolved', notes: 'Invalid type.' })
  });
  assert.equal(invalidType.response.status, 400);
});
