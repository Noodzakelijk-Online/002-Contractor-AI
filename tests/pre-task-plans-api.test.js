const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-pre-task-api-'));
const tokens = {
  owner: 'pre-task-owner-token-at-least-32-characters',
  approver: 'pre-task-approver-token-at-least-32-characters',
  office: 'pre-task-office-token-at-least-32-characters',
  field: { token: 'pre-task-field-token-at-least-32-characters', workerId: 'worker-pre-task-field' }
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

async function post(baseUrl, route, body, token = tokens.office) {
  return request(baseUrl, route, { token, method: 'POST', body: JSON.stringify(body) });
}

test('pre-task plan API enforces role, identity, approval, acknowledgement, stop-work, and closeout boundaries', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'pre_task_plan_api_test' });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const secondWorkerId = `worker-pre-task-second-${suffix}`;

  const intake = await post(baseUrl, '/api/ledger/intake', {
    title: `Pre-task API project ${suffix}`,
    clientName: `Pre-task API client ${suffix}`,
    status: 'in_progress',
    riskLevel: 'high',
    assignAutomatically: false
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;

  for (const worker of [
    { id: tokens.field.workerId, name: 'Field pre-task worker' },
    { id: secondWorkerId, name: 'Second pre-task worker' }
  ]) {
    assert.equal((await post(baseUrl, '/api/ledger/workers', { ...worker, role: 'Site operative', status: 'available' })).response.status, 201);
    assert.equal((await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
      workerId: worker.id,
      workerName: worker.name,
      role: 'Site operative',
      status: 'assigned'
    })).response.status, 201);
  }

  const jha = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/jhas`, {
    title: 'Distribution installation JHA',
    status: 'approved',
    riskLevel: 'high',
    hazards: ['Stored electrical energy'],
    controls: ['Lock, tag, test, and prove dead']
  });
  assert.equal(jha.response.status, 201, JSON.stringify(jha.body));
  assert.ok(jha.body.jha.approval?.id);
  assert.equal((await post(baseUrl, `/api/ledger/approvals/${encodeURIComponent(jha.body.jha.approval.id)}/resolve`, {
    status: 'approved',
    resolvedBy: 'API safety approver',
    reason: 'JHA hazards and controls verified.'
  }, tokens.approver)).response.status, 200);

  const payload = {
    entryKey: `pre-task-api-${suffix}`,
    workDate: new Date().toISOString().slice(0, 10),
    shiftLabel: 'Day shift',
    title: 'Install distribution equipment',
    location: 'Main plant room',
    preparedBy: 'API site supervisor',
    jhaId: jha.body.jha.id,
    evidenceReference: `method-statement:${suffix}`,
    stopWorkTriggers: ['Isolation boundary changes'],
    steps: [{
      stepKey: 'isolate',
      description: 'Verify and isolate the distribution supply',
      hazards: ['Stored electrical energy'],
      controls: ['Lock, tag, test, and prove dead']
    }]
  };

  const forbiddenCreation = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/pre-task-plans`, payload, tokens.field.token);
  assert.equal(forbiddenCreation.response.status, 403);

  const created = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/pre-task-plans`, payload);
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.preTaskPlan.status, 'pending_approval');
  assert.equal(created.body.preTaskPlan.attendanceSummary.expected, 2);
  assert.equal(created.body.approval.targetType, 'pre_task_plan');
  const planId = created.body.preTaskPlan.id;

  const fieldList = await request(baseUrl, '/api/ledger/pre-task-plans?limit=100', { token: tokens.field.token });
  assert.equal(fieldList.response.status, 200, JSON.stringify(fieldList.body));
  assert.equal(fieldList.body.preTaskPlans.length, 1);
  assert.equal(fieldList.body.preTaskPlans[0].attendees.length, 1);
  assert.equal(fieldList.body.preTaskPlans[0].attendees[0].workerId, tokens.field.workerId);
  assert.equal(fieldList.body.preTaskPlans[0].sourceHash, undefined);
  assert.equal(fieldList.body.preTaskPlans[0].snapshotHash, undefined);
  assert.equal(fieldList.body.preTaskPlans[0].entryKey, undefined);

  const premature = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/pre-task-plans/${encodeURIComponent(planId)}/acknowledgments`, {
    entryKey: `pre-task-ack-api-${suffix}`,
    workerId: secondWorkerId,
    acknowledged: true,
    evidenceReference: `field-device:${suffix}`
  }, tokens.field.token);
  assert.equal(premature.response.status, 409);

  assert.equal((await post(baseUrl, `/api/ledger/approvals/${encodeURIComponent(created.body.approval.id)}/resolve`, {
    status: 'approved',
    resolvedBy: 'API pre-task approver',
    reason: 'Plan sources, steps, controls, date, and crew verified.'
  }, tokens.approver)).response.status, 200);

  const fieldAcknowledgement = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/pre-task-plans/${encodeURIComponent(planId)}/acknowledgments`, {
    entryKey: `pre-task-ack-api-${suffix}`,
    workerId: secondWorkerId,
    acknowledged: true,
    evidenceReference: `field-device:${suffix}`
  }, tokens.field.token);
  assert.equal(fieldAcknowledgement.response.status, 201, JSON.stringify(fieldAcknowledgement.body));
  assert.equal(fieldAcknowledgement.body.attendee.workerId, tokens.field.workerId);
  assert.equal(fieldAcknowledgement.body.preTaskPlan.status, 'approved_waiting_acknowledgement');
  assert.equal(fieldAcknowledgement.body.preTaskPlan.attendanceSummary.expected, 0);
  assert.equal(fieldAcknowledgement.body.preTaskPlan.readyForWork, false);

  const secondAcknowledgement = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/pre-task-plans/${encodeURIComponent(planId)}/acknowledgments`, {
    entryKey: `pre-task-ack-second-api-${suffix}`,
    workerId: secondWorkerId,
    acknowledged: true,
    evidenceReference: `office-assisted-device:${suffix}`
  });
  assert.equal(secondAcknowledgement.response.status, 201, JSON.stringify(secondAcknowledgement.body));
  assert.equal(secondAcknowledgement.body.preTaskPlan.status, 'active');
  assert.equal(secondAcknowledgement.body.preTaskPlan.readyForWork, true);

  const suspended = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/pre-task-plans/${encodeURIComponent(planId)}/suspend`, {
    entryKey: `pre-task-stop-api-${suffix}`,
    reason: 'Isolation boundary changed during the planned work.',
    evidenceReference: `stop-work:${suffix}`
  }, tokens.field.token);
  assert.equal(suspended.response.status, 200, JSON.stringify(suspended.body));
  assert.equal(suspended.body.preTaskPlan.status, 'suspended');
  assert.equal(suspended.body.stopWorkImmediate, true);

  const forbiddenClose = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/pre-task-plans/${encodeURIComponent(planId)}/close`, {
    entryKey: `pre-task-close-api-${suffix}`,
    note: 'Area was safely handed back after the work stopped.',
    evidenceReference: `closeout:${suffix}`
  }, tokens.field.token);
  assert.equal(forbiddenClose.response.status, 403);

  const closed = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/pre-task-plans/${encodeURIComponent(planId)}/close`, {
    entryKey: `pre-task-close-api-${suffix}`,
    note: 'Area was safely handed back after the work stopped.',
    evidenceReference: `closeout:${suffix}`
  });
  assert.equal(closed.response.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.preTaskPlan.status, 'closed');

  const diagnostics = await request(baseUrl, '/api/ledger/debug', { token: tokens.owner });
  assert.equal(diagnostics.response.status, 200);
  assert.equal(diagnostics.body.diagnostics.valid, true, JSON.stringify(diagnostics.body.diagnostics.issues));
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '057_governed_risk_register');
  assert.equal(diagnostics.body.diagnostics.counts.preTaskPlans, 1);
  assert.equal(diagnostics.body.diagnostics.counts.preTaskPlanAttendees, 2);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', { token: tokens.owner });
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.body.capabilities.requestSafety.preTaskPlanRelease, 'source_current_approval_gated');
  assert.equal(capabilities.body.capabilities.requestSafety.preTaskPlanAcknowledgement, 'worker_scoped_exact_replay');
  assert.equal(capabilities.body.capabilities.requestSafety.preTaskPlanActivation, 'all_frozen_crew_acknowledged');
  assert.equal(capabilities.body.capabilities.requestSafety.preTaskPlanActivationInference, false);
  assert.equal(capabilities.body.capabilities.requestSafety.preTaskPlanAcknowledgementInference, false);
});
