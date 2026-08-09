const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-lmra-api-'))
const tokens = {
  owner: 'lmra-owner-token-at-least-32-characters',
  approver: 'lmra-approver-token-at-least-32-characters',
  office: 'lmra-office-token-at-least-32-characters',
  field: { token: 'lmra-field-token-at-least-32-characters', workerId: 'worker-lmra-field' },
}
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify({
    owner: tokens.owner,
    approver: tokens.approver,
    office_operator: tokens.office,
    field_worker: tokens.field,
  }),
  STATE_FILE: path.join(stateDirectory, 'state.json'),
  LEDGER_DB_FILE: path.join(stateDirectory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(stateDirectory, 'uploads'),
})
const app = require('../server')

const READY_CHECKS = {
  task_understood: true,
  work_area_safe: true,
  controls_in_place: true,
  ppe_ready: true,
  equipment_ready: true,
  emergency_ready: true,
  no_changed_conditions: true,
}

async function request(baseUrl, route, options = {}) {
  const { token = tokens.office, ...requestOptions } = options
  const response = await fetch(`${baseUrl}${route}`, {
    ...requestOptions,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? await response.json() : await response.text()
  return { response, body }
}

async function post(baseUrl, route, body, token = tokens.office) {
  return request(baseUrl, route, { token, method: 'POST', body: JSON.stringify(body) })
}

test('LMRA API enforces field identity, exact replay, source validation, projection, and capability boundaries', async t => {
  const server = app.listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'lmra_api_test' })
    fs.rmSync(stateDirectory, { recursive: true, force: true })
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const suffix = Date.now()

  const intake = await post(baseUrl, '/api/ledger/intake', {
    title: `LMRA API project ${suffix}`,
    clientName: `LMRA API client ${suffix}`,
    status: 'in_progress',
    riskLevel: 'high',
    assignAutomatically: false,
  })
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body))
  const jobId = intake.body.job.id

  assert.equal((await post(baseUrl, '/api/ledger/workers', {
    id: tokens.field.workerId,
    name: 'LMRA field worker',
    role: 'Installer',
    status: 'available',
  })).response.status, 201)
  assert.equal((await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    workerId: tokens.field.workerId,
    workerName: 'LMRA field worker',
    role: 'Installer',
    status: 'assigned',
  })).response.status, 201)

  const jha = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/jhas`, {
    title: 'Electrical installation JHA',
    status: 'approved',
    riskLevel: 'high',
    hazards: ['Stored electrical energy'],
    controls: ['Lock, tag, test, and prove dead'],
  })
  assert.equal(jha.response.status, 201, JSON.stringify(jha.body))
  assert.equal((await post(baseUrl, `/api/ledger/approvals/${encodeURIComponent(jha.body.jha.approval.id)}/resolve`, {
    status: 'approved',
    resolvedBy: 'API safety approver',
    reason: 'JHA hazards and controls verified.',
  }, tokens.approver)).response.status, 200)

  const createdPlan = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/pre-task-plans`, {
    entryKey: `lmra-api-plan-${suffix}`,
    workDate: new Date().toISOString().slice(0, 10),
    shiftLabel: 'Day shift',
    title: 'Install isolated distribution equipment',
    location: 'Main plant room',
    preparedBy: 'API supervisor',
    responsibleWorkerId: tokens.field.workerId,
    jhaId: jha.body.jha.id,
    evidenceReference: `method-statement:${suffix}`,
    steps: [{
      stepKey: 'install',
      description: 'Position and secure distribution equipment',
      hazards: ['Stored electrical energy'],
      controls: ['Verify isolation before work'],
    }],
  })
  assert.equal(createdPlan.response.status, 201, JSON.stringify(createdPlan.body))
  assert.equal((await post(baseUrl, `/api/ledger/approvals/${encodeURIComponent(createdPlan.body.approval.id)}/resolve`, {
    status: 'approved',
    resolvedBy: 'API pre-task approver',
    reason: 'Plan, source, date, and frozen worker verified.',
  }, tokens.approver)).response.status, 200)
  const planId = createdPlan.body.preTaskPlan.id

  const acknowledged = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/pre-task-plans/${encodeURIComponent(planId)}/acknowledgments`, {
    entryKey: `lmra-api-plan-ack-${suffix}`,
    workerId: 'spoofed-worker',
    acknowledged: true,
    evidenceReference: `field-device:${suffix}`,
  }, tokens.field.token)
  assert.equal(acknowledged.response.status, 201, JSON.stringify(acknowledged.body))
  assert.equal(acknowledged.body.attendee.workerId, tokens.field.workerId)
  assert.equal(acknowledged.body.preTaskPlan.readyForWork, true)

  const payload = {
    entryKey: `lmra-api-assessment-${suffix}`,
    workerId: 'spoofed-worker',
    workerName: 'Spoofed worker name',
    preTaskPlanId: planId,
    workArea: 'Main plant room',
    activity: 'Install isolated distribution equipment',
    clientCapturedAt: new Date().toISOString(),
    validForMinutes: 120,
    checks: READY_CHECKS,
    safeToStart: true,
    evidenceReference: `lmra-device:${suffix}`,
  }
  const forbiddenOfficeAssessment = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lmra`, payload)
  assert.equal(forbiddenOfficeAssessment.response.status, 403)
  assert.equal(forbiddenOfficeAssessment.body.error.code, 'lmra_field_worker_required')

  const created = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lmra`, payload, tokens.field.token)
  assert.equal(created.response.status, 201, JSON.stringify(created.body))
  assert.equal(created.body.lmraAssessment.workerId, tokens.field.workerId)
  assert.equal(created.body.lmraAssessment.workerName, 'LMRA field worker')
  assert.equal(created.body.lmraAssessment.outcome, 'ready')
  assert.equal(created.body.lmraAssessment.readyForHazardousWork, true)
  assert.equal(created.body.lmraAssessment.sourceHash, undefined)
  assert.equal(created.body.lmraAssessment.snapshotHash, undefined)
  assert.equal(created.body.authorizationInferred, false)
  assert.equal(created.body.externalCommitments, 0)

  const replay = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lmra`, payload, tokens.field.token)
  assert.equal(replay.response.status, 201, JSON.stringify(replay.body))
  assert.equal(replay.body.replayed, true)
  assert.equal(replay.body.lmraAssessment.id, created.body.lmraAssessment.id)

  const fieldList = await request(baseUrl, '/api/ledger/lmra?limit=100', { token: tokens.field.token })
  assert.equal(fieldList.response.status, 200, JSON.stringify(fieldList.body))
  assert.equal(fieldList.body.lmraAssessments.length, 1)
  assert.equal(fieldList.body.lmraAssessments[0].workerId, tokens.field.workerId)
  assert.equal(fieldList.body.policy.queuedOfflineAuthorizesWork, false)

  const officeList = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lmra?limit=100`)
  assert.equal(officeList.response.status, 200, JSON.stringify(officeList.body))
  assert.equal(officeList.body.lmraAssessments[0].sourceCurrent, true)
  assert.match(officeList.body.lmraAssessments[0].sourceHash, /^[a-f0-9]{64}$/)

  const diagnostics = await request(baseUrl, '/api/ledger/debug', { token: tokens.owner })
  assert.equal(diagnostics.response.status, 200)
  assert.equal(diagnostics.body.diagnostics.valid, true, JSON.stringify(diagnostics.body.diagnostics.issues))
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '070_managed_operator_accounts')
  assert.equal(diagnostics.body.diagnostics.counts.lmraAssessments, 1)

  const capabilities = await request(baseUrl, '/api/operations/capabilities', { token: tokens.owner })
  assert.equal(capabilities.response.status, 200)
  assert.equal(capabilities.body.capabilities.lastMinuteRiskAssessment.workerEvidence, 'authenticated_worker_scoped')
  assert.equal(capabilities.body.capabilities.lastMinuteRiskAssessment.authorizationInferred, false)
  assert.equal(capabilities.body.capabilities.requestSafety.lmraSourceValidation, 'server_current_at_receipt')
  assert.equal(capabilities.body.capabilities.requestSafety.lmraOfflineAuthorization, false)
})
