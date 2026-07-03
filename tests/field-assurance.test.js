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
  assert.ok(designJob.nextActions.some(action => action.type === 'review_rfi'));
  assert.ok(designQueue.body.summary.designReviews >= 1);

  const qualityQueue = await request(baseUrl, '/api/ledger/field-assurance?mode=quality&limit=100');
  assert.equal(qualityQueue.response.status, 200);
  const qualityJob = qualityQueue.body.jobs.find(job => job.jobId === fieldJobId);
  assert.ok(qualityJob);
  assert.equal(qualityJob.flags.qualityReview, true);
  assert.ok(qualityJob.nextActions.some(action => action.type === 'review_inspection'));

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
});
