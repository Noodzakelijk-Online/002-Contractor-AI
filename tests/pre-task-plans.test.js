const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t, suffix = 'governed') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-pre-task-plan-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  const ledger = new ContractorOperatingLedger({ dbFile });
  const job = ledger.createIntake({
    title: `Pre-task plan ${suffix}`,
    client: { name: `Pre-task client ${suffix}` },
    status: 'in_progress',
    riskLevel: 'high',
    assignAutomatically: false
  }, { actor: 'pre_task_test' });
  const workers = ['Lead installer', 'Site operative'].map(role => {
    const worker = ledger.upsertWorker({ name: `${role} ${suffix}`, role, status: 'available' }, { actor: 'pre_task_test' });
    ledger.addAssignment(job.id, {
      workerId: worker.id,
      workerName: worker.name,
      role,
      status: 'assigned'
    }, { actor: 'pre_task_test' });
    return worker;
  });
  const jha = ledger.createJhaRecord(job.id, {
    title: `Approved JHA ${suffix}`,
    status: 'approved',
    riskLevel: 'high',
    hazards: ['Stored energy', 'Restricted access'],
    controls: ['Isolation and lockout', 'Controlled access'],
    stopWorkTriggers: ['Isolation boundary changes']
  }, { actor: 'pre_task_test' });
  ledger.resolveApproval(jha.approval.id, {
    status: 'approved',
    resolvedBy: 'safety_approver',
    reason: 'Hazards and controls verified for field planning.'
  });
  t.after(() => {
    try {
      ledger.close();
    } catch {
      // Restart coverage closes the first connection before reopening the same file.
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, dbFile, directory, job, workers, jhaId: jha.id };
}

function planPayload(jhaId, suffix = '001', overrides = {}) {
  return {
    entryKey: `pre-task-plan-${suffix}`,
    workDate: new Date().toISOString().slice(0, 10),
    shiftLabel: 'Day shift',
    title: 'Install distribution equipment',
    location: 'Plant room level 2',
    preparedBy: 'Site supervisor',
    jhaId,
    evidenceReference: `method-statement:${suffix}`,
    emergencyArrangements: 'Use the east stair and report to the assembly point.',
    stopWorkTriggers: ['Isolation boundary changes', 'Unplanned simultaneous operations'],
    steps: [
      {
        stepKey: 'isolate',
        description: 'Verify and isolate the distribution supply',
        hazards: ['Stored electrical energy'],
        controls: ['Lock, tag, test, and prove dead']
      },
      {
        stepKey: 'install',
        description: 'Position and secure distribution equipment',
        hazards: ['Manual handling', 'Pinch points'],
        controls: ['Use lifting aid', 'Keep hands outside pinch zones']
      }
    ],
    ...overrides
  };
}

function acknowledgement(worker, suffix) {
  return {
    entryKey: `pre-task-ack-${suffix}`,
    workerId: worker.id,
    acknowledged: true,
    evidenceReference: `worker-device:${suffix}`,
    attestation: 'I reviewed the retained steps, hazards, controls, and stop-work triggers.'
  };
}

test('pre-task plans require source-current approval and every frozen crew acknowledgement before activation', t => {
  const { ledger, job, workers, jhaId } = fixture(t, 'lifecycle');
  const payload = planPayload(jhaId, 'lifecycle-001', { responsibleWorkerId: workers[0].id });
  const created = ledger.createPreTaskPlan(job.id, payload, { actor: 'office_operator' });

  assert.equal(created.replayed, false);
  assert.equal(created.plan.status, 'pending_approval');
  assert.equal(created.plan.definitionIntegrityValid, true);
  assert.equal(created.plan.prerequisitesCurrent, true);
  assert.equal(created.plan.attendanceSummary.expected, 2);
  assert.equal(created.plan.readyForWork, false);
  assert.equal(created.approval.targetType, 'pre_task_plan');
  assert.match(created.plan.planNumber, /^PTP-\d{4}-\d{6}$/);
  assert.equal(created.externalCommitments, 0);

  const replay = ledger.createPreTaskPlan(job.id, payload, { actor: 'offline_retry' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.plan.id, created.plan.id);
  assert.equal(replay.approval.id, created.approval.id);

  ledger.resolveApproval(created.approval.id, {
    status: 'approved',
    resolvedBy: 'pre_task_approver',
    reason: 'Linked JHA, work steps, controls, date, and frozen crew verified.'
  });
  const released = ledger.getPreTaskPlan(created.plan.id);
  assert.equal(released.status, 'approved_waiting_acknowledgement');
  assert.equal(released.readyForWork, false);

  const first = ledger.acknowledgePreTaskPlan(job.id, released.id, acknowledgement(workers[0], 'lifecycle-worker-1'), { actor: 'field_worker' });
  assert.equal(first.attendee.integrityValid, true);
  assert.equal(first.plan.status, 'approved_waiting_acknowledgement');
  assert.equal(first.plan.attendanceSummary.expected, 1);
  assert.equal(first.plan.readyForWork, false);
  assert.equal(ledger.acknowledgePreTaskPlan(job.id, released.id, acknowledgement(workers[0], 'lifecycle-worker-1')).replayed, true);

  const second = ledger.acknowledgePreTaskPlan(job.id, released.id, acknowledgement(workers[1], 'lifecycle-worker-2'), { actor: 'field_worker' });
  assert.equal(second.plan.status, 'active');
  assert.equal(second.plan.attendanceSummary.acknowledged, 2);
  assert.equal(second.plan.readyForWork, true);
  assert.deepEqual(second.plan.blockers, []);

  const suspended = ledger.suspendPreTaskPlan(job.id, released.id, {
    entryKey: 'pre-task-stop-lifecycle-001',
    reason: 'Isolation boundary changed during the planned installation.',
    evidenceReference: 'field-observation:lifecycle-001'
  }, { actor: 'field_worker', workerId: workers[0].id });
  assert.equal(suspended.plan.status, 'suspended');
  assert.equal(suspended.stopWorkImmediate, true);
  assert.equal(ledger.suspendPreTaskPlan(job.id, released.id, {
    entryKey: 'pre-task-stop-lifecycle-001',
    reason: 'Isolation boundary changed during the planned installation.',
    evidenceReference: 'field-observation:lifecycle-001'
  }, { actor: 'offline_retry', workerId: workers[0].id }).replayed, true);

  const closed = ledger.closePreTaskPlan(job.id, released.id, {
    entryKey: 'pre-task-close-lifecycle-001',
    note: 'Work stopped safely and the area was handed back to the supervisor.',
    evidenceReference: 'plan-closeout:lifecycle-001'
  }, { actor: 'office_operator' });
  assert.equal(closed.plan.status, 'closed');
  assert.equal(closed.plan.closureEvidenceReference, 'plan-closeout:lifecycle-001');
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, true, JSON.stringify(diagnostics.issues));
  assert.equal(diagnostics.migrations.currentVersion, '053_work_breakdown_takeoffs');
  assert.equal(diagnostics.counts.preTaskPlans, 1);
  assert.equal(diagnostics.counts.preTaskPlanAttendees, 2);
});

test('pre-task approval fails atomically after plan or linked JHA drift', t => {
  const { ledger, job, jhaId } = fixture(t, 'drift');
  const changedPlan = ledger.createPreTaskPlan(job.id, planPayload(jhaId, 'plan-drift-001'));
  const row = ledger.db.prepare('SELECT steps_json FROM pre_task_plans WHERE id = ?').get(changedPlan.plan.id);
  const steps = JSON.parse(row.steps_json);
  steps[0].controls = ['Changed after approval request'];
  ledger.db.prepare('UPDATE pre_task_plans SET steps_json = ? WHERE id = ?').run(JSON.stringify(steps), changedPlan.plan.id);
  assert.throws(
    () => ledger.resolveApproval(changedPlan.approval.id, { status: 'approved', resolvedBy: 'pre_task_approver' }),
    error => error.code === 'pre_task_plan_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.db.prepare('SELECT status FROM approvals WHERE id = ?').get(changedPlan.approval.id).status, 'pending');
  assert.equal(ledger.db.prepare('SELECT status FROM pre_task_plans WHERE id = ?').get(changedPlan.plan.id).status, 'pending_approval');

  const sourceChanged = ledger.createPreTaskPlan(job.id, planPayload(jhaId, 'source-drift-001'));
  ledger.db.prepare('UPDATE jha_records SET controls_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(['Unapproved changed control']), new Date().toISOString(), jhaId);
  assert.throws(
    () => ledger.resolveApproval(sourceChanged.approval.id, { status: 'approved', resolvedBy: 'pre_task_approver' }),
    error => error.code === 'pre_task_plan_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.db.prepare('SELECT status FROM approvals WHERE id = ?').get(sourceChanged.approval.id).status, 'pending');
  assert.equal(ledger.diagnose().valid, false);
});

test('pre-task revisions supersede the prior plan and autonomy creates one internal review without inferring acknowledgements', t => {
  const { ledger, job, workers, jhaId } = fixture(t, 'revision');
  const original = ledger.createPreTaskPlan(job.id, planPayload(jhaId, 'revision-original'));
  ledger.resolveApproval(original.approval.id, { status: 'approved', resolvedBy: 'pre_task_approver', reason: 'Original plan verified.' });

  const action = ledger.nextActions().find(candidate => candidate.type === 'review_pre_task_plan_readiness' && candidate.planId === original.plan.id);
  assert.ok(action);
  assert.equal(action.outstandingCount, 2);
  const first = ledger.runAutonomousCycle({ actionTypes: ['review_pre_task_plan_readiness'], jobIds: [job.id] });
  assert.equal(first.applied.length, 1);
  assert.equal(first.applied[0].status, 'task_created');
  assert.equal(first.applied[0].activationInferred, false);
  assert.equal(first.applied[0].acknowledgementsInferred, false);
  assert.equal(ledger.getPreTaskPlan(original.plan.id).attendanceSummary.acknowledged, 0);
  const repeat = ledger.runAutonomousCycle({ actionTypes: ['review_pre_task_plan_readiness'], jobIds: [job.id] });
  assert.equal(repeat.applied[0].status, 'replayed');

  const revision = ledger.createPreTaskPlan(job.id, planPayload(jhaId, 'revision-current', {
    supersedesPlanId: original.plan.id,
    responsibleWorkerId: workers[0].id,
    title: 'Install revised distribution equipment',
    evidenceReference: 'method-statement:revision-2'
  }), { actor: 'office_operator' });
  assert.equal(revision.plan.revisionNumber, 2);
  assert.equal(revision.plan.supersedesPlanId, original.plan.id);
  assert.equal(ledger.getPreTaskPlan(original.plan.id).status, 'superseded');
  assert.equal(revision.plan.status, 'pending_approval');
});

test('pre-task plans survive a restart with exact snapshots and acknowledgement evidence', t => {
  const { ledger, dbFile, job, workers, jhaId } = fixture(t, 'restart');
  const created = ledger.createPreTaskPlan(job.id, planPayload(jhaId, 'restart-001'));
  ledger.resolveApproval(created.approval.id, { status: 'approved', resolvedBy: 'pre_task_approver', reason: 'Plan verified before restart.' });
  ledger.acknowledgePreTaskPlan(job.id, created.plan.id, acknowledgement(workers[0], 'restart-worker-1'));
  ledger.close();

  const restarted = new ContractorOperatingLedger({ dbFile });
  const retained = restarted.getPreTaskPlan(created.plan.id, { jobId: job.id });
  assert.equal(retained.status, 'approved_waiting_acknowledgement');
  assert.equal(retained.definitionIntegrityValid, true);
  assert.equal(retained.prerequisitesCurrent, true);
  assert.equal(retained.attendanceSummary.acknowledged, 1);
  assert.equal(retained.attendees.find(attendee => attendee.workerId === workers[0].id).integrityValid, true);
  assert.equal(restarted.migrationStatus().currentVersion, '053_work_breakdown_takeoffs');
  restarted.close();
});
