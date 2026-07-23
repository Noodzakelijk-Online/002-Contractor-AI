const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-photo-evidence-api-'));
const jobId = 'photo-evidence-api-job';
const workerId = 'photo-evidence-api-worker';
const otherWorkerId = 'photo-evidence-api-other-worker';
const tokens = {
  owner: 'photo-evidence-api-owner-token-at-least-32-characters',
  approver: 'photo-evidence-api-approver-token-at-least-32-characters',
  office_operator: 'photo-evidence-api-office-token-at-least-32-characters',
  field_worker: [
    {
      id: workerId,
      workerId,
      token: 'photo-evidence-api-field-token-at-least-32-characters',
      jobIds: [jobId]
    },
    {
      id: otherWorkerId,
      workerId: otherWorkerId,
      token: 'photo-evidence-api-other-field-token-at-least-32-characters',
      jobIds: [jobId]
    }
  ]
};

Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify(tokens),
  STATE_FILE: path.join(directory, 'state.json'),
  LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(directory, 'uploads')
});
delete process.env.CONTRACTOR_AI_AUTH_TOKEN;
delete process.env.DASHBOARD_AUTH_TOKEN;

const app = require('../server');

async function request(baseUrl, route, token, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${typeof token === 'string' ? token : token.token}`,
      ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

function uploadForm(setId, phase, capturedAt, entryKey) {
  const form = new FormData();
  form.append(
    'evidenceFile',
    new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${phase} governed site photo`)], { type: 'image/jpeg' }),
    `${phase}-site-photo.jpg`
  );
  form.append('jobId', jobId);
  form.append('photoEvidenceSetId', setId);
  form.append('photoEvidencePhase', phase);
  form.append('photoEvidenceEntryKey', entryKey);
  form.append('capturedAt', capturedAt);
  form.append('notes', `${phase} condition at roof outlet 04`);
  form.append('category', 'governed_field_photo');
  return form;
}

test('photo-evidence API atomically binds private uploads to assigned-worker phases and independent approval', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'photo_evidence_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const fieldToken = tokens.field_worker[0];
  const otherFieldToken = tokens.field_worker[1];

  const intake = await request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      ledgerJobId: jobId,
      title: 'Photo evidence API project',
      status: 'in_progress',
      client: { name: 'Photo evidence API client' },
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  for (const worker of [
    { id: workerId, name: 'Assigned Photo Worker', role: 'Installer' },
    { id: otherWorkerId, name: 'Other Photo Worker', role: 'Installer' }
  ]) {
    const created = await request(baseUrl, '/api/ledger/workers', tokens.owner, {
      method: 'POST',
      body: JSON.stringify({ ...worker, status: 'available' })
    });
    assert.equal(created.response.status, 201);
  }
  const assignment = await request(baseUrl, `/api/ledger/jobs/${jobId}/assignments`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ workerId, role: 'Installer', status: 'planned' })
  });
  assert.equal(assignment.response.status, 201);
  const task = await request(baseUrl, `/api/ledger/jobs/${jobId}/tasks`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Install roof outlet waterproofing',
      status: 'in_progress',
      assigneeId: workerId,
      priority: 'high'
    })
  });
  assert.equal(task.response.status, 201);
  const scheduled = await request(baseUrl, `/api/ledger/jobs/${jobId}/photo-evidence`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      entryKey: 'photo-evidence-api-schedule-0001',
      taskId: task.body.task.id,
      assignmentId: assignment.body.assignment.id,
      assignedWorkerId: workerId,
      title: 'Roof outlet waterproofing evidence',
      workLocation: 'Building C / roof / outlet 04',
      requiredPhases: ['before', 'during', 'after'],
      actor: 'role:owner:spoofed'
    })
  });
  assert.equal(scheduled.response.status, 201);
  const setId = scheduled.body.photoEvidenceSet.id;

  const assignedList = await request(baseUrl, '/api/ledger/photo-evidence', fieldToken);
  assert.equal(assignedList.response.status, 200);
  assert.deepEqual(assignedList.body.photoEvidenceSets.map(set => set.id), [setId]);
  assert.equal(assignedList.body.photoEvidenceSets[0].entryKey, undefined);
  assert.equal(assignedList.body.photoEvidenceSets[0].latestApproval, undefined);
  const otherList = await request(baseUrl, '/api/ledger/photo-evidence', otherFieldToken);
  assert.equal(otherList.response.status, 200);
  assert.equal(otherList.body.photoEvidenceSets.length, 0);

  const captureTimes = [
    new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    new Date(Date.now() - 1 * 60 * 1000).toISOString()
  ];
  const wrongWorker = await request(baseUrl, '/api/ledger/upload', otherFieldToken, {
    method: 'POST',
    body: uploadForm(setId, 'before', captureTimes[0], 'photo-evidence-api-wrong-worker')
  });
  assert.equal(wrongWorker.response.status, 403);
  assert.equal(wrongWorker.body.error.code, 'photo_evidence_worker_scope_forbidden');

  const officeCapture = await request(baseUrl, '/api/ledger/upload', tokens.office_operator, {
    method: 'POST',
    body: uploadForm(setId, 'before', captureTimes[0], 'photo-evidence-api-office-capture')
  });
  assert.equal(officeCapture.response.status, 403);
  assert.equal(officeCapture.body.error.code, 'photo_evidence_worker_scope_forbidden');

  const uploads = [];
  for (const [index, phase] of ['before', 'during', 'after'].entries()) {
    const uploaded = await request(baseUrl, '/api/ledger/upload', fieldToken, {
      method: 'POST',
      headers: { 'Idempotency-Key': `photo-evidence-api-upload-${phase}` },
      body: uploadForm(setId, phase, captureTimes[index], `photo-evidence-api-capture-${phase}`)
    });
    assert.equal(uploaded.response.status, 200, JSON.stringify(uploaded.body));
    assert.equal(uploaded.body.ledgerFollowUp.records.photoEvidenceCapture.phase, phase);
    assert.equal(uploaded.body.ledgerFollowUp.records.photoEvidenceCapture.capturedByActor, 'role:field_worker:photo-evidence-api-worker');
    assert.equal(uploaded.body.ledgerFollowUp.records.photoEvidenceCapture.documentIntegrityValid, true);
    assert.ok(uploaded.body.actions.some(action => action.type === 'record_governed_photo_evidence'));
    uploads.push(uploaded.body);
  }
  assert.equal(uploads[2].ledgerFollowUp.records.photoEvidenceSet.status, 'captures_complete');
  assert.equal(uploads[2].ledgerFollowUp.records.photoEvidenceSet.complete, true);

  const review = await request(baseUrl, `/api/ledger/jobs/${jobId}/photo-evidence/${setId}/review`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ entryKey: 'photo-evidence-api-review-0001', actor: 'role:approver:spoofed' })
  });
  assert.equal(review.response.status, 201);
  assert.equal(review.body.photoEvidenceSet.status, 'pending_review');
  assert.equal(review.body.approval.requestedBy, 'role:office_operator');

  const selfApproval = await request(baseUrl, `/api/ledger/approvals/${review.body.approval.id}/resolve`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      reason: 'Attempted self approval.',
      resolvedBy: 'role:approver:spoofed'
    })
  });
  assert.equal(selfApproval.response.status, 403);
  assert.equal(selfApproval.body.error.code, 'insufficient_role');

  const resolved = await request(baseUrl, `/api/ledger/approvals/${review.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      reason: 'Checksum, chronology, task location, and all retained photographs independently verified.'
    })
  });
  assert.equal(resolved.response.status, 200);
  const ownerDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`, tokens.owner);
  const released = ownerDetail.body.job.photoEvidenceSets.find(set => set.id === setId);
  assert.equal(released.status, 'released');
  assert.equal(released.readyForTaskCompletion, true);
  assert.equal(released.captures.length, 3);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.body.capabilities.requestSafety.photoEvidenceTaskCompletionGate, true);
  assert.equal(capabilities.body.capabilities.requestSafety.photoEvidenceReleaseInference, false);
});
