const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-ncr-api-'));
const tokens = {
  owner: 'ncr-owner-token-at-least-32-characters',
  approver: 'ncr-approver-token-at-least-32-characters',
  office: 'ncr-office-token-at-least-32-characters',
  field: { token: 'ncr-field-token-at-least-32-characters', workerId: 'worker-ncr-field' }
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify({
    owner: tokens.owner,
    approver: tokens.approver,
    office_operator: tokens.office,
    field_worker: tokens.field
  }),
  STATE_FILE: path.join(stateDirectory, 'state.json'),
  LEDGER_DB_FILE: path.join(stateDirectory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(stateDirectory, 'uploads')
});
const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const { token = tokens.office, ...requestOptions } = options;
  const response = await fetch(`${baseUrl}${route}`, {
    ...requestOptions,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json();
  return { response, body };
}

test('NCR API enforces field identity and office-only correction and closure gates', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'ncr_api_test' });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: `NCR API ${suffix}`,
      clientName: `NCR client ${suffix}`,
      status: 'in_progress',
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  assert.equal((await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ id: tokens.field.workerId, name: 'Field NCR worker', role: 'Site operative', status: 'available' })
  })).response.status, 201);
  assert.equal((await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: tokens.field.workerId, workerName: 'Field NCR worker', role: 'Site operative', status: 'assigned' })
  })).response.status, 201);

  const payload = {
    entryKey: `ncr-api-entry-${suffix}`,
    workerId: 'spoofed-worker',
    raisedBy: 'Spoofed worker',
    severity: 'high',
    discipline: 'quality',
    title: 'Fire stopping depth below retained requirement',
    description: 'Measured seal depth at the riser penetration is below the approved system detail.',
    location: 'Level 3 riser R2',
    detectedAt: new Date().toISOString(),
    requirementReference: 'Approved firestop detail FS-18 revision B',
    immediateContainment: 'Held closure of the riser wall and marked the penetration for controlled correction.',
    responsibleParty: 'Fire stopping supervisor',
    dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  };
  const created = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/nonconformances`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.nonconformance.workerId, tokens.field.workerId);
  assert.equal(created.body.nonconformance.raisedBy, 'Field NCR worker');
  assert.equal(created.body.nonconformance.status, 'open');
  assert.equal(created.body.nonconformance.sourceHash, undefined);
  assert.equal(created.body.nonconformance.snapshotHash, undefined);
  assert.equal(created.body.nonconformance.entryKey, undefined);
  assert.equal(created.body.externalCommitments, 0);
  const recordId = created.body.nonconformance.id;

  const replay = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/nonconformances`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.nonconformance.id, recordId);

  const fieldList = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/nonconformances`, { token: tokens.field.token });
  assert.equal(fieldList.response.status, 200);
  assert.equal(fieldList.body.nonconformances.length, 1);
  assert.equal(fieldList.body.nonconformances[0].sourceHash, undefined);
  assert.equal(fieldList.body.policy.externalCommitments, 0);

  const correctionPayload = {
    rootCause: 'Installer used a depth gauge set for a different tested system.',
    correctiveAction: 'Remove affected seal, reinstall the approved system depth, photograph each stage, and re-inspect.',
    responsibleParty: 'Fire stopping supervisor',
    dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    evidenceReference: `method-review:${suffix}`
  };
  const forbiddenCorrection = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/nonconformances/${recordId}/corrective-action`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(correctionPayload)
  });
  assert.equal(forbiddenCorrection.response.status, 403);

  const correction = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/nonconformances/${recordId}/corrective-action`, {
    method: 'POST',
    body: JSON.stringify(correctionPayload)
  });
  assert.equal(correction.response.status, 201, JSON.stringify(correction.body));
  assert.equal(correction.body.nonconformance.status, 'pending_correction_approval');
  assert.equal(correction.body.approval.targetType, 'nonconformance_correction');
  assert.equal(correction.body.externalCommitments, 0);
  const projectedPending = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/nonconformances`, { token: tokens.field.token });
  assert.equal(projectedPending.body.nonconformances[0].correctionApprovalId, undefined);
  assert.equal(projectedPending.body.nonconformances[0].correctiveActionHash, undefined);

  const approvalQueue = await request(baseUrl, '/api/ledger/approvals?status=pending&limit=500', { token: tokens.approver });
  assert.equal(approvalQueue.response.status, 200, JSON.stringify(approvalQueue.body));
  const preview = approvalQueue.body.approvals.find(approval => approval.id === correction.body.approval.id).decision;
  assert.equal(preview.preview.ncrNumber, created.body.nonconformance.ncrNumber);
  assert.equal(preview.preview.sourceCurrent, true);
  assert.ok(preview.safeguards.join(' ').includes('Independent verification'));

  const correctionDecision = await request(baseUrl, `/api/ledger/approvals/${correction.body.approval.id}/resolve`, {
    token: tokens.approver,
    method: 'POST',
    body: JSON.stringify({ status: 'approved', reason: 'Correction plan and retained evidence basis verified.' })
  });
  assert.equal(correctionDecision.response.status, 200, JSON.stringify(correctionDecision.body));

  const closurePayload = {
    verificationResult: 'passed',
    verificationEvidence: `inspection-report:${suffix}`,
    verifiedBy: 'Independent quality lead',
    verifiedAt: new Date().toISOString(),
    notes: 'Reinstalled depth and product identity match the approved tested system.'
  };
  const forbiddenClosure = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/nonconformances/${recordId}/closure`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(closurePayload)
  });
  assert.equal(forbiddenClosure.response.status, 403);
  const closure = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/nonconformances/${recordId}/closure`, {
    method: 'POST',
    body: JSON.stringify(closurePayload)
  });
  assert.equal(closure.response.status, 201, JSON.stringify(closure.body));
  assert.equal(closure.body.nonconformance.status, 'pending_closure_approval');
  assert.equal(closure.body.approval.targetType, 'nonconformance_closure');

  const closureDecision = await request(baseUrl, `/api/ledger/approvals/${closure.body.approval.id}/resolve`, {
    token: tokens.approver,
    method: 'POST',
    body: JSON.stringify({ status: 'approved', reason: 'Independent verification evidence matches the approved correction.' })
  });
  assert.equal(closureDecision.response.status, 200, JSON.stringify(closureDecision.body));

  const detail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`, { token: tokens.owner });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.job.nonconformances[0].status, 'closed');
  assert.equal(detail.body.job.nonconformances[0].integrityValid, true);
  assert.equal(detail.body.job.nonconformances[0].correctionIntegrityValid, true);
  assert.equal(detail.body.job.nonconformances[0].closureIntegrityValid, true);

  const diagnostics = await request(baseUrl, '/api/ledger/debug', { token: tokens.owner });
  assert.equal(diagnostics.response.status, 200);
  assert.equal(diagnostics.body.diagnostics.valid, true, JSON.stringify(diagnostics.body.diagnostics.issues));
  assert.equal(diagnostics.body.diagnostics.counts.nonconformanceRecords, 1);
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '068_operational_safety_controls');
});
