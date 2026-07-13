const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-field-assurance-'));
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

async function createJob(baseUrl, payload = {}) {
  const result = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: payload.clientName || 'Field QA Client',
      clientEmail: payload.clientEmail || 'field@example.test',
      clientPhone: payload.clientPhone || '+31 6 77777777',
      address: payload.address || 'Prinsengracht 10, Amsterdam',
      city: payload.city || 'Amsterdam',
      service: payload.service || 'renovation',
      title: payload.title || 'Field assurance regression job',
      description: payload.description || payload.title || 'Field assurance regression job',
      priority: payload.priority || 'high',
      estimatedCost: payload.estimatedCost || 2200,
      contractValue: payload.contractValue || payload.estimatedCost || 2200,
      estimatedHours: payload.estimatedHours || 8,
      assignAutomatically: false,
      ...payload
    })
  });
  assert.equal(result.response.status, 201);
  return result.body.job.id;
}

test('field assurance coordinates safety, design, quality, evidence and approval gates', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const start = new Date(Date.now() + 48 * 60 * 60 * 1000);
  start.setUTCHours(8, 0, 0, 0);
  const end = new Date(start.getTime() + 6 * 60 * 60 * 1000);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const fieldJobId = await createJob(baseUrl, {
    title: 'Field assurance bathroom review',
    scheduledStart: startIso,
    scheduledEnd: endIso
  });
  const fieldProgress = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(fieldJobId)}/progress`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'in_progress',
      progressPercent: 10,
      note: 'Crew started setup; safety pack still needs review.'
    })
  });
  assert.equal(fieldProgress.response.status, 201);

  const safetyQueue = await request(baseUrl, '/api/ledger/field-assurance?mode=safety&limit=100');
  assert.equal(safetyQueue.response.status, 200);
  const safetyJob = safetyQueue.body.jobs.find(job => job.jobId === fieldJobId);
  assert.ok(safetyJob);
  assert.equal(safetyJob.flags.safetyGap, true);
  assert.ok(safetyJob.nextActions.some(action => action.type === 'prepare_safety_pack'));

  const firstPack = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(fieldJobId)}/field-assurance-pack`, {
    method: 'POST',
    body: JSON.stringify({ actor: 'Field Assurance QA' })
  });
  assert.equal(firstPack.response.status, 201);
  assert.equal(firstPack.body.pack.externalCommitments, 0);
  assert.deepEqual(firstPack.body.pack.reused, {
    safetyMeeting: false,
    jha: false,
    sdsSheet: false,
    orientation: false
  });

  const repeatedPack = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(fieldJobId)}/field-assurance-pack`, {
    method: 'POST',
    body: JSON.stringify({ actor: 'Field Assurance QA' })
  });
  assert.equal(repeatedPack.response.status, 201);
  assert.equal(repeatedPack.body.pack.safetyMeeting.id, firstPack.body.pack.safetyMeeting.id);
  assert.equal(repeatedPack.body.pack.jha.id, firstPack.body.pack.jha.id);
  assert.equal(repeatedPack.body.pack.sdsSheet.id, firstPack.body.pack.sdsSheet.id);
  assert.equal(repeatedPack.body.pack.orientation.id, firstPack.body.pack.orientation.id);
  assert.deepEqual(repeatedPack.body.pack.reused, {
    safetyMeeting: true,
    jha: true,
    sdsSheet: true,
    orientation: true
  });
  assert.equal(repeatedPack.body.pack.job.safetyMeetings.length, 1);
  assert.equal(repeatedPack.body.pack.job.jhas.length, 1);
  assert.equal(repeatedPack.body.pack.job.sdsSheets.length, 1);
  assert.equal(repeatedPack.body.pack.job.orientations.length, 1);

  const clearedSafetyQueue = await request(baseUrl, '/api/ledger/field-assurance?mode=safety&limit=100');
  assert.equal(clearedSafetyQueue.response.status, 200);
  const plannedSafetyJob = clearedSafetyQueue.body.jobs.find(job => job.jobId === fieldJobId);
  assert.ok(plannedSafetyJob);
  assert.equal(plannedSafetyJob.flags.safetyGap, false);
  assert.ok(plannedSafetyJob.nextActions.some(action => (
    action.type === 'review_jha' && action.jhaId === firstPack.body.pack.jha.id
  )));
  assert.ok(plannedSafetyJob.nextActions.some(action => (
    action.type === 'request_sds' && action.sdsSheetId === firstPack.body.pack.sdsSheet.id
  )));
  assert.ok(plannedSafetyJob.nextActions.some(action => (
    action.type === 'complete_safety_meeting' && action.safetyMeetingId === firstPack.body.pack.safetyMeeting.id
  )));
  assert.ok(plannedSafetyJob.nextActions.some(action => (
    action.type === 'complete_orientation' && action.orientationId === firstPack.body.pack.orientation.id
  )));
  assert.equal(plannedSafetyJob.latest.jha.id, firstPack.body.pack.jha.id);
  assert.equal(plannedSafetyJob.latest.sdsSheet.id, firstPack.body.pack.sdsSheet.id);
  assert.equal(plannedSafetyJob.latest.safetyMeeting.id, firstPack.body.pack.safetyMeeting.id);
  assert.equal(plannedSafetyJob.latest.orientation.id, firstPack.body.pack.orientation.id);

  const jha = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(fieldJobId)}/jhas`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Bathroom demolition JHA',
      status: 'draft',
      riskLevel: 'high',
      hazards: ['Dust', 'Sharp tiles'],
      controls: ['PPE', 'Dust extraction']
    })
  });
  assert.equal(jha.response.status, 201);
  assert.ok(jha.body.jha.approvalId);

  const incident = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(fieldJobId)}/incidents`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Dust extraction failure',
      severity: 'high',
      status: 'reported',
      description: 'Dust extraction stopped during demolition.'
    })
  });
  assert.equal(incident.response.status, 201);
  assert.ok(incident.body.incident.approvalId);

  const rfi = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(fieldJobId)}/rfis`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Confirm wall substrate',
      status: 'open',
      question: 'Can we fasten into the existing substrate?'
    })
  });
  assert.equal(rfi.response.status, 201);

  const submittal = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(fieldJobId)}/submittals`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Tile adhesive package',
      status: 'submitted',
      material: 'Tile adhesive'
    })
  });
  assert.equal(submittal.response.status, 201);

  const permit = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(fieldJobId)}/permits`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Hot works permit',
      permitType: 'hot_works',
      status: 'needs_renewal',
      expiresAt: yesterday
    })
  });
  assert.equal(permit.response.status, 201);

  const inspection = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(fieldJobId)}/inspections`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Substrate inspection',
      status: 'failed',
      result: 'failed',
      defects: ['Loose wall section']
    })
  });
  assert.equal(inspection.response.status, 201);
  assert.ok(inspection.body.inspection.approvalId);

  const quality = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(fieldJobId)}/quality-checks`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Tile alignment review',
      status: 'pending_review',
      result: 'pending',
      defectsOpen: 2
    })
  });
  assert.equal(quality.response.status, 201);
  assert.ok(quality.body.qualityCheck.approvalId);
  assert.ok(quality.body.dashboard.metrics);

  const approvalQueue = await request(baseUrl, '/api/ledger/field-assurance?mode=approval&limit=100');
  assert.equal(approvalQueue.response.status, 200);
  const approvalJob = approvalQueue.body.jobs.find(job => job.jobId === fieldJobId);
  assert.ok(approvalJob);
  assert.equal(approvalJob.flags.approvalRequired, true);
  assert.ok(approvalJob.nextActions.some(action => action.type === 'review_field_approval'));

  const incidentQueue = await request(baseUrl, '/api/ledger/field-assurance?mode=incident&limit=100');
  assert.equal(incidentQueue.response.status, 200);
  const incidentJob = incidentQueue.body.jobs.find(job => job.jobId === fieldJobId);
  assert.ok(incidentJob);
  assert.equal(incidentJob.flags.incidentBlocker, true);
  assert.ok(incidentJob.nextActions.some(action => action.type === 'resolve_incident'));

  const designQueue = await request(baseUrl, '/api/ledger/field-assurance?mode=design&limit=100');
  assert.equal(designQueue.response.status, 200);
  const designJob = designQueue.body.jobs.find(job => job.jobId === fieldJobId);
  assert.ok(designJob);
  assert.equal(designJob.flags.designReview, true);
  assert.ok(designJob.nextActions.some(action => action.type === 'review_rfi' && action.rfiId === rfi.body.rfi.id));
  assert.ok(designQueue.body.summary.designReviews >= 1);

  const qualityQueue = await request(baseUrl, '/api/ledger/field-assurance?mode=quality&limit=100');
  assert.equal(qualityQueue.response.status, 200);
  const qualityJob = qualityQueue.body.jobs.find(job => job.jobId === fieldJobId);
  assert.ok(qualityJob);
  assert.equal(qualityJob.flags.qualityReview, true);
  assert.ok(qualityJob.nextActions.some(action => action.type === 'review_inspection' && action.inspectionId === inspection.body.inspection.id));

  const evidenceJobId = await createJob(baseUrl, {
    title: 'Field assurance evidence missing job',
    priority: 'medium'
  });
  const completionProposal = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(evidenceJobId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      status: 'completed',
      reason: 'Regression fixture marks the job complete without field evidence.'
    })
  });
  assert.equal(completionProposal.response.status, 200);
  assert.equal(completionProposal.body.status, 'pending_approval');
  const completionApprovalId = completionProposal.body.approval.id;

  const completionApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(completionApprovalId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      resolvedBy: 'Field QA Test',
      reason: 'Evidence-missing regression setup.'
    })
  });
  assert.equal(completionApproval.response.status, 200);

  const completedDetail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(evidenceJobId)}`);
  assert.equal(completedDetail.response.status, 200);
  assert.equal(completedDetail.body.job.status, 'completed');

  const evidenceQueue = await request(baseUrl, '/api/ledger/field-assurance?mode=evidence&limit=100');
  assert.equal(evidenceQueue.response.status, 200);
  const evidenceJob = evidenceQueue.body.jobs.find(job => job.jobId === evidenceJobId);
  assert.ok(evidenceJob);
  assert.equal(evidenceJob.flags.evidenceMissing, true);
  assert.ok(evidenceJob.nextActions.some(action => action.type === 'capture_field_evidence'));

  const document = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(evidenceJobId)}/documents`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'photo',
      title: 'Progress proof',
      filename: 'progress-proof.jpg',
      status: 'stored'
    })
  });
  assert.equal(document.response.status, 201);
  assert.ok(document.body.dashboard.metrics);

  const clearedEvidenceQueue = await request(baseUrl, '/api/ledger/field-assurance?mode=evidence&limit=100');
  assert.equal(clearedEvidenceQueue.response.status, 200);
  assert.equal(clearedEvidenceQueue.body.jobs.some(job => job.jobId === evidenceJobId), false);

  const documentJobId = await createJob(baseUrl, {
    title: 'Field assurance controlled document review',
    status: 'intake',
    priority: 'medium'
  });
  const reviewDocument = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(documentJobId)}/documents`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'drawing',
      title: 'Approved fixing detail',
      filename: 'fixing-detail-r3.pdf',
      storageRef: 'controlled-documents/fixing-detail-r3.pdf',
      status: 'needs_review'
    })
  });
  assert.equal(reviewDocument.response.status, 201);

  const documentQueue = await request(baseUrl, '/api/ledger/field-assurance?mode=design&limit=100');
  const documentJob = documentQueue.body.jobs.find(job => job.jobId === documentJobId);
  assert.ok(documentJob);
  const documentAction = documentJob.nextActions.find(action => action.type === 'review_document');
  assert.ok(documentAction);
  assert.equal(documentAction.documentId, reviewDocument.body.document.id);
  assert.equal(documentJob.latest.document.id, reviewDocument.body.document.id);

  const missingDocumentReference = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(documentJobId)}/lifecycle/document/${encodeURIComponent(documentAction.documentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved', notes: 'Review note without controlled reference.' })
  });
  assert.equal(missingDocumentReference.response.status, 400);
  assert.match(missingDocumentReference.body.error.message, /reference and evidence/i);

  const documentReview = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(documentJobId)}/lifecycle/document/${encodeURIComponent(documentAction.documentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'approved',
      verificationReference: 'DOC-REVIEW-QA-003',
      notes: 'Revision 3 dimensions, fixing specification, and issue status were checked against the retained scope.'
    })
  });
  assert.equal(documentReview.response.status, 200);
  assert.equal(documentReview.body.record.status, 'pending_approval');
  assert.equal(documentReview.body.record.data.verificationReference, 'DOC-REVIEW-QA-003');
  assert.equal(documentReview.body.approval.targetType, 'document');

  const punchJobId = await createJob(baseUrl, {
    title: 'Field assurance punch review',
    status: 'intake',
    priority: 'medium'
  });
  const punch = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(punchJobId)}/punch-items`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Re-seat cabinet hinge',
      status: 'open',
      severity: 'medium',
      dueAt: yesterday
    })
  });
  assert.equal(punch.response.status, 201);

  const punchQueue = await request(baseUrl, '/api/ledger/field-assurance?mode=quality&limit=100');
  const punchJob = punchQueue.body.jobs.find(job => job.jobId === punchJobId);
  assert.ok(punchJob);
  const punchAction = punchJob.nextActions.find(action => action.type === 'resolve_punch_item');
  assert.ok(punchAction);
  assert.equal(punchAction.punchItemId, punch.body.punchItem.id);
  assert.equal(punchJob.latest.punchItem.id, punch.body.punchItem.id);

  const punchReview = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(punchJobId)}/lifecycle/punch_item/${encodeURIComponent(punchAction.punchItemId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'resolved',
      notes: 'Hinge was re-seated, aligned, cycle-tested, and photographed.',
      resolution: 'Verified corrective work complete.'
    })
  });
  assert.equal(punchReview.response.status, 200);
  assert.equal(punchReview.body.record.status, 'pending_approval');
  assert.equal(punchReview.body.approval.targetType, 'punch_item');
});
