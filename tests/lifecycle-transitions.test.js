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

  const rfi = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/rfis`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Confirm substrate fixing', status: 'open', question: 'Which fixing is approved for the existing substrate?' })
  });
  assert.equal(rfi.response.status, 201);
  const rfiWithoutAnswer = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/rfi/${encodeURIComponent(rfi.body.rfi.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'answered' })
  });
  assert.equal(rfiWithoutAnswer.response.status, 400);
  const answeringRfi = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/rfi/${encodeURIComponent(rfi.body.rfi.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'answered', response: 'Use the specified chemical anchor after pull testing.', notes: 'Engineer response retained for approval.' })
  });
  assert.equal(answeringRfi.response.status, 200);
  assert.equal(answeringRfi.body.record.status, 'pending_approval');
  assert.equal(answeringRfi.body.record.response, 'Use the specified chemical anchor after pull testing.');
  await resolveApproval(baseUrl, answeringRfi.body.approval.id);

  const submittal = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/submittals`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Anchor product data', status: 'submitted', material: 'Chemical anchor' })
  });
  assert.equal(submittal.response.status, 201);
  const approvingSubmittal = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/submittal/${encodeURIComponent(submittal.body.submittal.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved', notes: 'Product data matches the retained specification.' })
  });
  assert.equal(approvingSubmittal.response.status, 200);
  assert.equal(approvingSubmittal.body.record.status, 'pending_approval');
  await resolveApproval(baseUrl, approvingSubmittal.body.approval.id);

  const rejectedSubmittal = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/submittals`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Unverified anchor alternative', status: 'submitted', material: 'Alternative anchor' })
  });
  assert.equal(rejectedSubmittal.response.status, 201);
  const rejectingSubmittal = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/submittal/${encodeURIComponent(rejectedSubmittal.body.submittal.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'rejected', notes: 'No retained conformity or pull-test evidence was supplied.' })
  });
  assert.equal(rejectingSubmittal.response.status, 200);
  await resolveApproval(baseUrl, rejectingSubmittal.body.approval.id);

  const permit = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/permits`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Work area permit', status: 'needs_renewal', permitType: 'work_area' })
  });
  assert.equal(permit.response.status, 201);
  const submittingPermit = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/permit/${encodeURIComponent(permit.body.permit.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'submitted', notes: 'Renewal evidence checked and retained for approval.' })
  });
  assert.equal(submittingPermit.response.status, 200);
  assert.equal(submittingPermit.body.record.status, 'pending_approval');
  await resolveApproval(baseUrl, submittingPermit.body.approval.id);

  const inspection = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/inspections`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Anchor pull-test inspection', status: 'scheduled', result: 'pending' })
  });
  assert.equal(inspection.response.status, 201);
  const passingInspection = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/inspection/${encodeURIComponent(inspection.body.inspection.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'passed', result: 'passed', notes: 'Pull-test results meet the retained specification.', defects: [] })
  });
  assert.equal(passingInspection.response.status, 200);
  assert.equal(passingInspection.body.record.status, 'pending_approval');
  await resolveApproval(baseUrl, passingInspection.body.approval.id);

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
  assert.equal(detail.body.job.rfis[0].status, 'answered');
  assert.ok(detail.body.job.rfis[0].answeredAt);
  const approvedSubmittal = detail.body.job.submittals.find(item => item.id === submittal.body.submittal.id);
  assert.equal(approvedSubmittal.status, 'approved');
  assert.ok(approvedSubmittal.approvedAt);
  assert.equal(detail.body.job.submittals.find(item => item.id === rejectedSubmittal.body.submittal.id).status, 'rejected');
  assert.equal(detail.body.job.permits[0].status, 'submitted');
  assert.ok(detail.body.job.permits[0].issuedAt);
  assert.equal(detail.body.job.inspections[0].status, 'passed');
  assert.equal(detail.body.job.inspections[0].result, 'passed');
  assert.ok(detail.body.job.inspections[0].completedAt);
  assert.ok(detail.body.job.audit.some(event => event.action === 'transition_observation'));
  assert.ok(detail.body.job.audit.some(event => event.action === 'transition_aftercare'));
  assert.ok(detail.body.job.audit.some(event => event.action === 'transition_rfi'));
  assert.ok(detail.body.job.audit.some(event => event.action === 'transition_inspection'));

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

test('safety and compliance transitions require retained evidence and approval', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const jobId = await createJob(baseUrl, 'Safety compliance lifecycle QA job');

  const meeting = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/safety-meetings`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Pre-task toolbox talk', status: 'scheduled', topics: ['Isolation', 'Emergency arrangements'] })
  });
  assert.equal(meeting.response.status, 201);
  const completingMeeting = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/safety_meeting/${encodeURIComponent(meeting.body.safetyMeeting.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed', notes: 'Crew attendance and discussed controls verified.', attendees: ['Crew lead', 'Installer'] })
  });
  assert.equal(completingMeeting.response.status, 200);
  assert.equal(completingMeeting.body.record.status, 'pending_approval');
  await resolveApproval(baseUrl, completingMeeting.body.approval.id);

  const orientation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/orientations`, {
    method: 'POST',
    body: JSON.stringify({ workerName: 'Safety QA Installer', company: 'Internal crew', status: 'scheduled' })
  });
  assert.equal(orientation.response.status, 201);
  const access = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/site-access`, {
    method: 'POST',
    body: JSON.stringify({ workerName: 'Safety QA Installer', orientationId: orientation.body.orientation.id, status: 'requested' })
  });
  assert.equal(access.response.status, 201);
  const prematureAccess = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/site_access/${encodeURIComponent(access.body.siteAccessLog.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'cleared', notes: 'Must fail before orientation is approved.' })
  });
  assert.equal(prematureAccess.response.status, 409);

  const completingOrientation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/orientation/${encodeURIComponent(orientation.body.orientation.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed', notes: 'Identity, site rules, emergency routes, and task controls verified.', verificationReference: 'orientation-checklist-001' })
  });
  assert.equal(completingOrientation.response.status, 200);
  await resolveApproval(baseUrl, completingOrientation.body.approval.id);

  const clearingAccess = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/site_access/${encodeURIComponent(access.body.siteAccessLog.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'cleared', notes: 'Approved orientation and access-point controls verified.' })
  });
  assert.equal(clearingAccess.response.status, 200);
  assert.equal(clearingAccess.body.record.status, 'pending_approval');
  assert.equal(clearingAccess.body.record.orientationValid, true);
  await resolveApproval(baseUrl, clearingAccess.body.approval.id);

  const jha = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/jhas`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Installation JHA', status: 'draft', riskLevel: 'medium', hazards: ['Manual handling'], controls: ['Team lift'] })
  });
  assert.equal(jha.response.status, 201);
  const approvingJha = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/jha/${encodeURIComponent(jha.body.jha.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved', notes: 'Hazards, controls, PPE, and stop-work triggers reviewed.' })
  });
  assert.equal(approvingJha.response.status, 200);
  await resolveApproval(baseUrl, approvingJha.body.approval.id);

  const sds = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/sds-sheets`, {
    method: 'POST',
    body: JSON.stringify({ material: 'Chemical anchor', supplier: 'Safety Supplier', status: 'requested' })
  });
  assert.equal(sds.response.status, 201);
  const sdsWithoutDocument = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/sds/${encodeURIComponent(sds.body.sdsSheet.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'current', notes: 'Missing the retained document reference.' })
  });
  assert.equal(sdsWithoutDocument.response.status, 400);
  const currentSds = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/sds/${encodeURIComponent(sds.body.sdsSheet.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'current', notes: 'Supplier SDS revision and expiry verified.', documentRef: 'document:sds-chemical-anchor-r4' })
  });
  assert.equal(currentSds.response.status, 200);
  await resolveApproval(baseUrl, currentSds.body.approval.id);

  const quality = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/quality-checks`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Final alignment check', status: 'pending_review', result: 'pending', defects: ['Misaligned trim'] })
  });
  assert.equal(quality.response.status, 201);
  const qualityWithDefect = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/quality_check/${encodeURIComponent(quality.body.qualityCheck.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'passed', notes: 'Must fail while a defect remains.' })
  });
  assert.equal(qualityWithDefect.response.status, 400);
  const passingQuality = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/quality_check/${encodeURIComponent(quality.body.qualityCheck.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'passed', result: 'passed', defects: [], notes: 'Trim corrected and alignment rechecked against the retained tolerance.' })
  });
  assert.equal(passingQuality.response.status, 200);
  await resolveApproval(baseUrl, passingQuality.body.approval.id);

  const safety = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/safety-checks`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Work-area safety check', status: 'open', riskLevel: 'normal', hazards: ['Public interface'] })
  });
  assert.equal(safety.response.status, 201);
  const completingSafety = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/safety_check/${encodeURIComponent(safety.body.safetyCheck.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed', notes: 'Barriers, housekeeping, and public separation verified.' })
  });
  assert.equal(completingSafety.response.status, 200);
  await resolveApproval(baseUrl, completingSafety.body.approval.id);

  const detail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.job.safetyMeetings[0].status, 'completed');
  assert.equal(detail.body.job.safetyMeetings[0].attendees.length, 2);
  assert.equal(detail.body.job.orientations[0].status, 'completed');
  assert.equal(detail.body.job.orientations[0].data.verificationReference, 'orientation-checklist-001');
  assert.equal(detail.body.job.siteAccessLogs[0].status, 'cleared');
  assert.equal(detail.body.job.siteAccessLogs[0].orientationValid, true);
  assert.equal(detail.body.job.jhas[0].status, 'approved');
  assert.ok(detail.body.job.jhas[0].approvedAt);
  assert.equal(detail.body.job.sdsSheets[0].status, 'current');
  assert.equal(detail.body.job.sdsSheets[0].data.documentRef, 'document:sds-chemical-anchor-r4');
  assert.equal(detail.body.job.qualityChecks[0].status, 'approved');
  assert.equal(detail.body.job.qualityChecks[0].result, 'passed');
  assert.equal(detail.body.job.qualityChecks[0].defects.length, 0);
  assert.equal(detail.body.job.safetyChecks[0].status, 'approved');
  assert.ok(detail.body.job.audit.some(event => event.action === 'transition_site_access'));
  assert.ok(detail.body.job.audit.some(event => event.action === 'transition_sds'));
  assert.ok(detail.body.job.audit.some(event => event.action === 'transition_quality_check'));
});
