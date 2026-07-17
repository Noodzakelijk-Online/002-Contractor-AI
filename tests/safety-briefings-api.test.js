const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-safety-briefing-api-'));
const tokens = {
  owner: 'safety-owner-token-at-least-32-characters',
  approver: 'safety-approver-token-at-least-32-characters',
  office: 'safety-office-token-at-least-32-characters',
  field: { token: 'safety-field-token-at-least-32-characters', workerId: 'worker-safety-field' }
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

test('safety briefing API scopes field identity, supports offline replay, and keeps signoff approval-gated', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'safety_briefing_api_test' });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: `Safety briefing API ${suffix}`,
      clientName: `Safety client ${suffix}`,
      status: 'in_progress',
      riskLevel: 'high',
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  assert.equal((await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ id: tokens.field.workerId, name: 'Field safety worker', role: 'Site operative', status: 'available' })
  })).response.status, 201);
  assert.equal((await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: tokens.field.workerId, workerName: 'Field safety worker', role: 'Site operative', status: 'assigned' })
  })).response.status, 201);

  const created = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/safety-meetings`, {
    method: 'POST',
    body: JSON.stringify({
      entryKey: `safety-briefing-api-${suffix}`,
      title: 'Mobile scaffold toolbox talk',
      scheduledAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      topics: ['Inspection before use', 'Wheel locks', 'Exclusion zone']
    })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.safetyMeeting.attendanceSummary.expected, 1);
  const meetingId = created.body.safetyMeeting.id;

  const fieldList = await request(baseUrl, '/api/ledger/safety-briefings?limit=100', { token: tokens.field.token });
  assert.equal(fieldList.response.status, 200);
  assert.equal(fieldList.body.safetyMeetings.length, 1);
  assert.equal(fieldList.body.safetyMeetings[0].attendeeRecords.length, 1);
  assert.equal(fieldList.body.safetyMeetings[0].attendeeRecords[0].workerId, tokens.field.workerId);
  assert.equal(fieldList.body.safetyMeetings[0].sourceHash, undefined);
  assert.equal(fieldList.body.safetyMeetings[0].snapshotHash, undefined);

  const acknowledgementPayload = {
    entryKey: `safety-acknowledgement-api-${suffix}`,
    workerId: 'spoofed-worker',
    workerName: 'Spoofed worker',
    attendeeName: 'Spoofed attendee',
    acknowledgedBy: 'Spoofed actor',
    acknowledged: true,
    evidenceReference: `field-device-attestation:${suffix}`
  };
  const acknowledged = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/safety-meetings/${encodeURIComponent(meetingId)}/acknowledgments`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(acknowledgementPayload)
  });
  assert.equal(acknowledged.response.status, 201, JSON.stringify(acknowledged.body));
  assert.equal(acknowledged.body.attendee.workerId, tokens.field.workerId);
  assert.equal(acknowledged.body.attendee.attendeeName, 'Field safety worker');
  assert.equal(acknowledged.body.attendee.entryKey, undefined);
  assert.equal(acknowledged.body.attendee.entryFingerprint, undefined);
  assert.equal(acknowledged.body.safetyMeeting.attendanceSummary.acknowledged, 1);
  const replay = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/safety-meetings/${encodeURIComponent(meetingId)}/acknowledgments`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(acknowledgementPayload)
  });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.attendee.id, acknowledged.body.attendee.id);

  const forbiddenSignoff = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/safety-meetings/${encodeURIComponent(meetingId)}/signoff`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify({ evidenceReference: `toolbox-sheet:${suffix}` })
  });
  assert.equal(forbiddenSignoff.response.status, 403);

  const signoff = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/safety-meetings/${encodeURIComponent(meetingId)}/signoff`, {
    method: 'POST',
    body: JSON.stringify({ evidenceReference: `toolbox-sheet:${suffix}`, status: 'completed' })
  });
  assert.equal(signoff.response.status, 202, JSON.stringify(signoff.body));
  assert.equal(signoff.body.safetyMeeting.status, 'pending_approval');
  assert.equal(signoff.body.safetyMeeting.integrityValid, true);
  assert.ok(signoff.body.approval.id);

  const approved = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(signoff.body.approval.id)}/resolve`, {
    token: tokens.approver,
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      reason: 'Worker identity, briefing topics, facilitator evidence, and completion reference verified.'
    })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  const retained = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/safety-meetings`);
  assert.equal(retained.response.status, 200);
  assert.equal(retained.body.safetyMeetings[0].status, 'completed');
  assert.equal(retained.body.safetyMeetings[0].integrityValid, true);

  const retainedFieldView = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/safety-meetings`, { token: tokens.field.token });
  assert.equal(retainedFieldView.response.status, 200);
  assert.equal(retainedFieldView.body.safetyMeetings[0].attendeeRecords.length, 1);
  assert.equal(retainedFieldView.body.safetyMeetings[0].attendeeRecords[0].workerId, tokens.field.workerId);
  assert.equal(retainedFieldView.body.safetyMeetings[0].snapshot, undefined);
  assert.equal(retainedFieldView.body.safetyMeetings[0].snapshotHash, undefined);
  assert.equal(retainedFieldView.body.safetyMeetings[0].sourceCurrentHash, undefined);
  assert.equal(retainedFieldView.body.safetyMeetings[0].sourceHash, undefined);

  const diagnostics = await request(baseUrl, '/api/ledger/debug', { token: tokens.owner });
  assert.equal(diagnostics.response.status, 200);
  assert.equal(diagnostics.body.diagnostics.valid, true, JSON.stringify(diagnostics.body.diagnostics.issues));
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '042_governed_work_permits');
  assert.equal(diagnostics.body.diagnostics.counts.safetyMeetingAttendees, 1);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', { token: tokens.owner });
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.body.capabilities.requestSafety.safetyBriefingEntryKey, 'durable');
  assert.equal(capabilities.body.capabilities.requestSafety.safetyBriefingAcknowledgement, 'worker_scoped_exact_replay');
  assert.equal(capabilities.body.capabilities.requestSafety.safetyBriefingSignoff, 'source_current_approval_gated');
  assert.equal(capabilities.body.capabilities.requestSafety.safetyBriefingAttendanceInference, false);
});
