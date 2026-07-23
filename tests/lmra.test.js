const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { ContractorOperatingLedger } = require('../operating-ledger')

const READY_CHECKS = {
  task_understood: true,
  work_area_safe: true,
  controls_in_place: true,
  ppe_ready: true,
  equipment_ready: true,
  emergency_ready: true,
  no_changed_conditions: true,
}

function fixture(t, suffix = 'governed') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-lmra-'))
  const dbFile = path.join(directory, 'ledger.sqlite')
  const ledger = new ContractorOperatingLedger({ dbFile })
  const job = ledger.createIntake({
    title: `LMRA ${suffix}`,
    client: { name: `LMRA client ${suffix}` },
    status: 'in_progress',
    riskLevel: 'high',
    assignAutomatically: false,
  }, { actor: 'lmra_test' })
  const worker = ledger.upsertWorker({
    name: `Field worker ${suffix}`,
    role: 'Installer',
    status: 'available',
  }, { actor: 'lmra_test' })
  ledger.addAssignment(job.id, {
    workerId: worker.id,
    workerName: worker.name,
    role: 'Installer',
    status: 'assigned',
  }, { actor: 'lmra_test' })
  const jha = ledger.createJhaRecord(job.id, {
    title: `Approved JHA ${suffix}`,
    status: 'approved',
    riskLevel: 'high',
    hazards: ['Stored energy'],
    controls: ['Lock, tag, test, and prove dead'],
    stopWorkTriggers: ['Isolation boundary changes'],
  }, { actor: 'lmra_test' })
  ledger.resolveApproval(jha.approval.id, {
    status: 'approved',
    resolvedBy: 'safety_approver',
    reason: 'Hazard definition verified.',
  })
  const created = ledger.createPreTaskPlan(job.id, {
    entryKey: `lmra-plan-${suffix}`,
    workDate: new Date().toISOString().slice(0, 10),
    shiftLabel: 'Day shift',
    title: 'Install isolated distribution equipment',
    location: 'Plant room',
    preparedBy: 'Site supervisor',
    responsibleWorkerId: worker.id,
    jhaId: jha.id,
    evidenceReference: `method-statement:${suffix}`,
    emergencyArrangements: 'Use the east stair and report to the assembly point.',
    stopWorkTriggers: ['Isolation boundary changes'],
    steps: [{
      stepKey: 'install',
      description: 'Position and secure distribution equipment',
      hazards: ['Stored energy', 'Pinch points'],
      controls: ['Verify isolation', 'Use the lifting aid'],
    }],
  }, { actor: 'office_operator' })
  ledger.resolveApproval(created.approval.id, {
    status: 'approved',
    resolvedBy: 'pre_task_approver',
    reason: 'Plan and frozen crew verified.',
  })
  ledger.acknowledgePreTaskPlan(job.id, created.plan.id, {
    entryKey: `lmra-plan-ack-${suffix}`,
    workerId: worker.id,
    acknowledged: true,
    evidenceReference: `worker-device:${suffix}`,
  }, { actor: 'field_worker' })
  const plan = ledger.getPreTaskPlan(created.plan.id)
  assert.equal(plan.readyForWork, true)
  t.after(() => {
    try {
      ledger.close()
    } catch {
      // Restart coverage may close this connection first.
    }
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return { ledger, dbFile, job, worker, plan }
}

function assessmentPayload(worker, plan, suffix, overrides = {}) {
  return {
    entryKey: `lmra-assessment-${suffix}`,
    workerId: worker.id,
    workerName: worker.name,
    preTaskPlanId: plan.id,
    workArea: 'Plant room level 2',
    activity: 'Install isolated distribution equipment',
    clientCapturedAt: new Date().toISOString(),
    validForMinutes: 120,
    checks: READY_CHECKS,
    safeToStart: true,
    observedHazards: [],
    evidenceReference: `field-device:${suffix}`,
    ...overrides,
  }
}

test('LMRA readiness is worker-scoped, source-current, time-bounded, and exact-replay safe', t => {
  const { ledger, job, worker, plan } = fixture(t, 'ready')
  const payload = assessmentPayload(worker, plan, 'ready-001')
  const first = ledger.createLmraAssessment(job.id, payload, { actor: 'field_worker' })

  assert.equal(first.replayed, false)
  assert.equal(first.assessment.outcome, 'ready')
  assert.equal(first.assessment.readyForHazardousWork, true)
  assert.equal(first.assessment.sourceCurrent, true)
  assert.equal(first.assessment.integrityValid, true)
  assert.equal(first.assessment.isLatestForWorkerPlan, true)
  assert.ok(Date.parse(first.assessment.validUntil) > Date.parse(first.assessment.assessedAt))
  assert.equal(first.externalCommitments, 0)
  assert.equal(first.authorizationInferred, false)

  const replay = ledger.createLmraAssessment(job.id, payload, { actor: 'offline_retry' })
  assert.equal(replay.replayed, true)
  assert.equal(replay.assessment.id, first.assessment.id)
  assert.equal(ledger.listLmraAssessments({ jobId: job.id }).length, 1)
  assert.throws(
    () => ledger.createLmraAssessment(job.id, { ...payload, activity: 'Different activity' }),
    error => error.code === 'lmra_entry_key_reused' && error.statusCode === 409,
  )
  const diagnostics = ledger.diagnose()
  assert.equal(diagnostics.valid, true, JSON.stringify(diagnostics.issues))
  assert.equal(diagnostics.migrations.currentVersion, '066_governed_client_feedback')
  assert.equal(diagnostics.counts.lmraAssessments, 1)
})

test('failed and changed-condition checks retain stop-work and require linked reassessment evidence', t => {
  const { ledger, job, worker, plan } = fixture(t, 'stop-work')
  const initial = ledger.createLmraAssessment(job.id, assessmentPayload(worker, plan, 'initial'))
  const stop = ledger.createLmraAssessment(job.id, assessmentPayload(worker, plan, 'stop', {
    checks: { ...READY_CHECKS, no_changed_conditions: false },
    safeToStart: false,
    observedHazards: ['Unexpected simultaneous lifting operation'],
    stopWorkReason: 'A lifting operation entered the isolated work area.',
  }))

  assert.equal(stop.assessment.outcome, 'stop_work')
  assert.equal(stop.assessment.readyForHazardousWork, false)
  assert.equal(stop.stopWorkImmediate, true)
  assert.equal(ledger.getLmraAssessment(initial.assessment.id).isLatestForWorkerPlan, false)
  assert.equal(ledger.getLmraAssessment(initial.assessment.id).readyForHazardousWork, false)
  const blockedFieldAssurance = ledger.listFieldAssurance({ mode: 'safety' })
  const blockedJob = blockedFieldAssurance.jobs.find(item => item.jobId === job.id)
  assert.ok(blockedJob)
  assert.equal(blockedJob.flags.safetyGap, true)
  assert.equal(blockedJob.counts.openLmraAssessments, 1)
  assert.equal(blockedJob.counts.missingLmraAssessments, 0)
  assert.equal(blockedJob.latest.lmra.id, stop.assessment.id)
  assert.ok(blockedJob.nextActions.some(action => action.type === 'record_lmra'))

  assert.throws(
    () => ledger.createLmraAssessment(job.id, assessmentPayload(worker, plan, 'bad-clear')),
    error => error.code === 'lmra_reassessment_evidence_required' && error.statusCode === 409,
  )
  const cleared = ledger.createLmraAssessment(job.id, assessmentPayload(worker, plan, 'clear', {
    reassessmentOfId: stop.assessment.id,
    resolutionNote: 'The lift was completed, the exclusion boundary restored, and controls rechecked.',
  }))
  assert.equal(cleared.assessment.outcome, 'ready')
  assert.equal(cleared.assessment.readyForHazardousWork, true)
  assert.equal(cleared.assessment.reassessmentOfId, stop.assessment.id)
  assert.equal(ledger.getLmraAssessment(stop.assessment.id).readyForHazardousWork, false)
  const clearedFieldAssurance = ledger.listFieldAssurance({ mode: 'safety' })
  assert.equal(clearedFieldAssurance.jobs.some(item => item.jobId === job.id), false)
  const safetyCapability = ledger.ledgerCapabilityCoverage({
    jobDetail: ledger.getJobDetail(job.id, { includeAudit: false }),
  }).capabilities.find(item => item.key === 'safety-quality')
  const lmraRequirement = safetyCapability.requirements.find(item => item.key === 'lmra')
  assert.equal(lmraRequirement.count, 1)
  assert.equal(lmraRequirement.openCount, 0)
  assert.equal(lmraRequirement.status, 'ready')
})

test('delayed offline capture remains stop-work evidence and source changes revoke readiness', t => {
  const { ledger, job, worker, plan } = fixture(t, 'source-current')
  const stale = ledger.createLmraAssessment(job.id, assessmentPayload(worker, plan, 'offline-stale', {
    clientCapturedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  }))
  assert.equal(stale.assessment.outcome, 'stop_work')
  assert.equal(stale.assessment.readyForHazardousWork, false)
  assert.match(stale.assessment.stopWorkReason, /delayed capture/i)

  const ready = ledger.createLmraAssessment(job.id, assessmentPayload(worker, plan, 'live-clear', {
    reassessmentOfId: stale.assessment.id,
    resolutionNote: 'A new live assessment was completed after reconnecting and rechecking controls.',
  }))
  assert.equal(ready.assessment.readyForHazardousWork, true)

  ledger.db.prepare("UPDATE pre_task_plans SET status = 'suspended', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), plan.id)
  const revoked = ledger.getLmraAssessment(ready.assessment.id)
  assert.equal(revoked.sourceCurrent, false)
  assert.equal(revoked.readyForHazardousWork, false)
  assert.ok(revoked.blockers.length > 0)
})

test('LMRA autonomy creates only one internal review task and never infers assessment or work authorization', t => {
  const { ledger, job, worker, plan } = fixture(t, 'autonomy')
  const action = ledger.nextActions().find(candidate => (
    candidate.type === 'review_lmra_readiness'
    && candidate.planId === plan.id
    && candidate.workerId === worker.id
  ))
  assert.ok(action)
  assert.deepEqual(action.reasons, ['lmra_missing'])

  const first = ledger.runAutonomousCycle({ actionTypes: ['review_lmra_readiness'], jobIds: [job.id] })
  assert.equal(first.applied.length, 1)
  assert.equal(first.applied[0].status, 'task_created')
  assert.equal(first.applied[0].assessmentInferred, false)
  assert.equal(first.applied[0].authorizationInferred, false)
  assert.equal(ledger.listLmraAssessments({ jobId: job.id }).length, 0)

  const repeat = ledger.runAutonomousCycle({ actionTypes: ['review_lmra_readiness'], jobIds: [job.id] })
  assert.equal(repeat.applied[0].status, 'replayed')
  assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM job_tasks WHERE data_json LIKE '%lmraAssessmentId%'").get().count, 1)
})

test('LMRA snapshot tampering is detected after restart', t => {
  const { ledger, dbFile, job, worker, plan } = fixture(t, 'restart')
  const created = ledger.createLmraAssessment(job.id, assessmentPayload(worker, plan, 'restart-001'))
  ledger.close()

  const restarted = new ContractorOperatingLedger({ dbFile })
  assert.equal(restarted.getLmraAssessment(created.assessment.id).integrityValid, true)
  restarted.db.prepare('UPDATE lmra_assessments SET activity = ? WHERE id = ?')
    .run('Changed after retention', created.assessment.id)
  assert.equal(restarted.getLmraAssessment(created.assessment.id).integrityValid, false)
  assert.equal(restarted.diagnose().valid, false)
  restarted.close()
})
