const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-work-permit-api-'));
const tokens = {
  owner: 'permit-owner-token-at-least-32-characters',
  approver: 'permit-approver-token-at-least-32-characters',
  office: 'permit-office-token-at-least-32-characters',
  field: { token: 'permit-field-token-at-least-32-characters', workerId: 'worker-permit-field' }
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify({ owner: tokens.owner, approver: tokens.approver, office_operator: tokens.office, field_worker: tokens.field }),
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
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, body };
}

test('work permit API scopes field identity and keeps activation, suspension, and closure role-gated', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'work_permit_api_test' });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const secondWorkerId = `worker-permit-second-${suffix}`;
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: `Work permit API ${suffix}`,
      clientName: `Permit client ${suffix}`,
      status: 'in_progress',
      riskLevel: 'high',
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  assert.equal((await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ id: tokens.field.workerId, name: 'Field permit worker', role: 'Site operative', status: 'available' })
  })).response.status, 201);
  assert.equal((await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: tokens.field.workerId, workerName: 'Field permit worker', role: 'Site operative', status: 'assigned' })
  })).response.status, 201);
  assert.equal((await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ id: secondWorkerId, name: 'Second permit worker', role: 'Site operative', status: 'available' })
  })).response.status, 201);
  assert.equal((await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: secondWorkerId, workerName: 'Second permit worker', role: 'Site operative', status: 'assigned' })
  })).response.status, 201);

  const payload = {
    entryKey: `work-permit-api-${suffix}`,
    permitType: 'work_at_height',
    title: 'Roof edge access permit',
    location: 'South roof',
    validFrom: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    hazards: ['Unprotected roof edge', 'Dropped objects'],
    controls: ['Guardrail inspected', 'Exclusion zone below'],
    conditions: ['Suspend when wind exceeds the site limit'],
    evidenceReference: `risk-assessment:${suffix}`
  };
  const forbiddenCreation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/work-permits`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(forbiddenCreation.response.status, 403);

  const created = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/work-permits`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.workPermit.status, 'pending_approval');
  assert.equal(created.body.workPermit.attendanceSummary.expected, 2);
  assert.equal(created.body.approval.targetType, 'work_permit');
  const permitId = created.body.workPermit.id;

  const fieldList = await request(baseUrl, '/api/ledger/work-permits?limit=100', { token: tokens.field.token });
  assert.equal(fieldList.response.status, 200);
  assert.equal(fieldList.body.workPermits.length, 1);
  assert.equal(fieldList.body.workPermits[0].attendees.length, 1);
  assert.equal(fieldList.body.workPermits[0].attendees[0].workerId, tokens.field.workerId);
  assert.equal(fieldList.body.workPermits[0].sourceHash, undefined);
  assert.equal(fieldList.body.workPermits[0].snapshotHash, undefined);
  assert.equal(fieldList.body.workPermits[0].entryKey, undefined);

  const prematureAcknowledgement = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/work-permits/${encodeURIComponent(permitId)}/acknowledgments`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify({
      entryKey: `permit-ack-api-${suffix}`,
      acknowledged: true,
      evidenceReference: `field-device-attestation:${suffix}`
    })
  });
  assert.equal(prematureAcknowledgement.response.status, 409);
  assert.equal(prematureAcknowledgement.body.error.code, 'work_permit_not_acknowledgeable');

  const approved = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(created.body.approval.id)}/resolve`, {
    token: tokens.approver,
    method: 'POST',
    body: JSON.stringify({ status: 'approved', reason: 'Permit definition and assigned crew verified.' })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));

  const acknowledgementPayload = {
    entryKey: `permit-ack-api-${suffix}`,
    workerId: 'spoofed-worker',
    workerName: 'Spoofed worker',
    acknowledgedBy: 'Spoofed actor',
    acknowledged: true,
    evidenceReference: `field-device-attestation:${suffix}`
  };
  const acknowledged = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/work-permits/${encodeURIComponent(permitId)}/acknowledgments`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(acknowledgementPayload)
  });
  assert.equal(acknowledged.response.status, 201, JSON.stringify(acknowledged.body));
  assert.equal(acknowledged.body.attendee.workerId, tokens.field.workerId);
  assert.equal(acknowledged.body.attendee.attendeeName, 'Field permit worker');
  assert.equal(acknowledged.body.attendee.entryKey, undefined);
  assert.equal(acknowledged.body.workPermit.readyForWork, false);
  assert.equal(acknowledged.body.externalCommitments, 0);
  const replay = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/work-permits/${encodeURIComponent(permitId)}/acknowledgments`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(acknowledgementPayload)
  });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.attendee.id, acknowledged.body.attendee.id);
  assert.equal(replay.body.workPermit.readyForWork, false);

  const secondAcknowledgement = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/work-permits/${encodeURIComponent(permitId)}/acknowledgments`, {
    method: 'POST',
    body: JSON.stringify({
      entryKey: `permit-second-ack-api-${suffix}`,
      workerId: secondWorkerId,
      workerName: 'Second permit worker',
      acknowledged: true,
      evidenceReference: `second-field-device-attestation:${suffix}`
    })
  });
  assert.equal(secondAcknowledgement.response.status, 201, JSON.stringify(secondAcknowledgement.body));
  assert.equal(secondAcknowledgement.body.workPermit.readyForWork, true);
  const readyFieldList = await request(baseUrl, '/api/ledger/work-permits?limit=100', { token: tokens.field.token });
  assert.equal(readyFieldList.response.status, 200);
  assert.equal(readyFieldList.body.workPermits[0].readyForWork, true);

  const forbiddenSuspension = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/work-permits/${encodeURIComponent(permitId)}/suspend`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify({ entryKey: `permit-suspend-api-${suffix}`, reason: 'Unsafe condition observed.', evidenceReference: `observation:${suffix}` })
  });
  assert.equal(forbiddenSuspension.response.status, 403);

  const suspended = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/work-permits/${encodeURIComponent(permitId)}/suspend`, {
    method: 'POST',
    body: JSON.stringify({ entryKey: `permit-suspend-api-${suffix}`, reason: 'Guardrail was moved during work.', evidenceReference: `observation:${suffix}` })
  });
  assert.equal(suspended.response.status, 200, JSON.stringify(suspended.body));
  assert.equal(suspended.body.permit.status, 'suspended');
  assert.equal(suspended.body.stopWorkImmediate, true);

  const closed = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/work-permits/${encodeURIComponent(permitId)}/close`, {
    method: 'POST',
    body: JSON.stringify({
      entryKey: `permit-close-api-${suffix}`,
      note: 'Roof access ended and the work area was inspected.',
      evidenceReference: `closeout:${suffix}`
    })
  });
  assert.equal(closed.response.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.permit.status, 'closed');

  const retained = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/work-permits`);
  assert.equal(retained.response.status, 200);
  assert.equal(retained.body.workPermits[0].status, 'closed');
  assert.equal(retained.body.workPermits[0].definitionIntegrityValid, true);

  const diagnostics = await request(baseUrl, '/api/ledger/debug', { token: tokens.owner });
  assert.equal(diagnostics.response.status, 200);
  assert.equal(diagnostics.body.diagnostics.valid, true, JSON.stringify(diagnostics.body.diagnostics.issues));
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '050_governed_market_fit');
  assert.equal(diagnostics.body.diagnostics.counts.governedWorkPermits, 1);
  assert.equal(diagnostics.body.diagnostics.counts.workPermitAttendees, 2);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', { token: tokens.owner });
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.body.capabilities.requestSafety.workPermitEntryKey, 'durable');
  assert.equal(capabilities.body.capabilities.requestSafety.workPermitActivation, 'source_current_approval_gated');
  assert.equal(capabilities.body.capabilities.requestSafety.workPermitAcknowledgement, 'worker_scoped_exact_replay');
  assert.equal(capabilities.body.capabilities.requestSafety.workPermitSuspension, 'immediate_evidence_retained');
  assert.equal(capabilities.body.capabilities.requestSafety.workPermitActivationInference, false);
  assert.equal(capabilities.body.capabilities.requestSafety.workPermitAcknowledgementInference, false);
});
