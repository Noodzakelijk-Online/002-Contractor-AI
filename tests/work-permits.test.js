const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t, suffix = 'governed') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-work-permit-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  const job = ledger.createIntake({
    title: `Work permit ${suffix}`,
    client: { name: `Permit client ${suffix}` },
    status: 'in_progress',
    riskLevel: 'high',
    assignAutomatically: false
  }, { actor: 'permit_test' });
  const workers = ['Lead installer', 'Site operative'].map((role) => {
    const worker = ledger.upsertWorker({
      name: `${role} ${suffix}`,
      role,
      status: 'available'
    }, { actor: 'permit_test' });
    ledger.addAssignment(job.id, {
      workerId: worker.id,
      workerName: worker.name,
      role,
      status: 'assigned'
    }, { actor: 'permit_test' });
    return worker;
  });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, job, workers };
}

function permitPayload(suffix = '001') {
  return {
    entryKey: `work-permit-${suffix}`,
    permitType: 'hot_work',
    title: 'Hot work in plant room',
    holder: 'Site supervisor',
    location: 'Plant room level 2',
    validFrom: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    hazards: ['Ignition sources', 'Hot metal and fumes'],
    controls: ['Dedicated fire watch', 'Extinguisher within reach'],
    conditions: ['Stop work when ventilation is unavailable'],
    evidenceReference: `permit-assessment:${suffix}`
  };
}

function acknowledgement(worker, suffix) {
  return {
    entryKey: `permit-acknowledgement-${suffix}`,
    workerId: worker.id,
    workerName: worker.name,
    acknowledged: true,
    evidenceReference: `worker-device-attestation:${suffix}`
  };
}

test('work permits require approval and every assigned worker acknowledgement before work is ready', t => {
  const { ledger, job, workers } = fixture(t, 'lifecycle');
  const payload = permitPayload('lifecycle-001');
  const created = ledger.createWorkPermit(job.id, payload, { actor: 'office_operator' });

  assert.equal(created.replayed, false);
  assert.equal(created.permit.status, 'pending_approval');
  assert.equal(created.permit.definitionIntegrityValid, true);
  assert.equal(created.permit.attendanceSummary.expected, 2);
  assert.equal(created.permit.readyForWork, false);
  assert.equal(created.approval.targetType, 'work_permit');
  assert.equal(created.externalCommitments, 0);

  const creationReplay = ledger.createWorkPermit(job.id, payload, { actor: 'offline_retry' });
  assert.equal(creationReplay.replayed, true);
  assert.equal(creationReplay.permit.id, created.permit.id);
  assert.equal(creationReplay.approval.id, created.approval.id);

  ledger.resolveApproval(created.approval.id, {
    status: 'approved',
    resolvedBy: 'permit_approver',
    reason: 'Hazards, controls, validity, source evidence, and assigned crew verified.'
  });
  const active = ledger.getWorkPermit(created.permit.id);
  assert.equal(active.status, 'active');
  assert.equal(active.readyForWork, false);
  assert.equal(active.blockers.some(blocker => blocker.type === 'permit_acknowledgements_outstanding'), true);

  const first = ledger.acknowledgeWorkPermit(
    job.id,
    active.id,
    acknowledgement(workers[0], 'lifecycle-worker-1'),
    { actor: 'field_worker' }
  );
  assert.equal(first.replayed, false);
  assert.equal(first.attendee.status, 'acknowledged');
  assert.equal(first.attendee.integrityValid, true);
  assert.equal(first.permit.attendanceSummary.expected, 1);
  assert.equal(first.permit.readyForWork, false);

  const firstReplay = ledger.acknowledgeWorkPermit(
    job.id,
    active.id,
    acknowledgement(workers[0], 'lifecycle-worker-1'),
    { actor: 'offline_retry' }
  );
  assert.equal(firstReplay.replayed, true);
  assert.equal(firstReplay.attendee.id, first.attendee.id);

  const second = ledger.acknowledgeWorkPermit(
    job.id,
    active.id,
    acknowledgement(workers[1], 'lifecycle-worker-2'),
    { actor: 'field_worker' }
  );
  assert.equal(second.permit.attendanceSummary.acknowledged, 2);
  assert.equal(second.permit.readyForWork, true);
  assert.equal(second.permit.blockers.length, 0);

  const suspended = ledger.suspendWorkPermit(job.id, active.id, {
    entryKey: 'permit-suspension-lifecycle-001',
    reason: 'Ventilation stopped during hot work.',
    evidenceReference: 'field-observation:lifecycle-001'
  }, { actor: 'site_supervisor' });
  assert.equal(suspended.replayed, false);
  assert.equal(suspended.stopWorkImmediate, true);
  assert.equal(suspended.permit.status, 'suspended');
  assert.equal(suspended.permit.readyForWork, false);
  const suspensionReplay = ledger.suspendWorkPermit(job.id, active.id, {
    entryKey: 'permit-suspension-lifecycle-001',
    reason: 'Ventilation stopped during hot work.',
    evidenceReference: 'field-observation:lifecycle-001'
  }, { actor: 'offline_retry' });
  assert.equal(suspensionReplay.replayed, true);

  const closed = ledger.closeWorkPermit(job.id, active.id, {
    entryKey: 'permit-closure-lifecycle-001',
    note: 'Work area inspected, fire watch completed, and equipment removed.',
    evidenceReference: 'permit-closeout:lifecycle-001'
  }, { actor: 'site_supervisor' });
  assert.equal(closed.permit.status, 'closed');
  assert.equal(closed.permit.closureEvidenceReference, 'permit-closeout:lifecycle-001');
  assert.equal(closed.externalCommitments, 0);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, true, JSON.stringify(diagnostics.issues));
  assert.equal(diagnostics.migrations.currentVersion, '047_governed_drawing_revision_control');
  assert.equal(diagnostics.counts.governedWorkPermits, 1);
  assert.equal(diagnostics.counts.workPermitAttendees, 2);
});

test('work permit approval fails atomically when retained hazards are changed', t => {
  const { ledger, job } = fixture(t, 'tamper');
  const created = ledger.createWorkPermit(job.id, permitPayload('tamper-001'));
  const row = ledger.db.prepare('SELECT data_json FROM permit_records WHERE id = ?').get(created.permit.id);
  const data = JSON.parse(row.data_json);
  data.hazards = ['Changed after approval request'];
  ledger.db.prepare('UPDATE permit_records SET data_json = ? WHERE id = ?').run(JSON.stringify(data), created.permit.id);

  assert.throws(
    () => ledger.resolveApproval(created.approval.id, { status: 'approved', resolvedBy: 'permit_approver' }),
    error => error.code === 'work_permit_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.db.prepare('SELECT status FROM approvals WHERE id = ?').get(created.approval.id).status, 'pending');
  assert.equal(ledger.db.prepare('SELECT status FROM permit_records WHERE id = ?').get(created.permit.id).status, 'pending_approval');
  assert.equal(ledger.getWorkPermit(created.permit.id).definitionIntegrityValid, false);
  assert.equal(ledger.diagnose().valid, false);
});

test('work permit autonomy creates one internal readiness review and never activates or acknowledges', t => {
  const { ledger, job } = fixture(t, 'autonomy');
  const created = ledger.createWorkPermit(job.id, permitPayload('autonomy-001'));
  ledger.resolveApproval(created.approval.id, {
    status: 'approved',
    resolvedBy: 'permit_approver',
    reason: 'Permit definition verified for autonomous review fixture.'
  });
  const action = ledger.nextActions().find(candidate => (
    candidate.type === 'review_work_permit_readiness' && candidate.permitId === created.permit.id
  ));
  assert.ok(action);
  assert.equal(action.outstandingCount, 2);
  assert.equal(action.reasons.includes('acknowledgements_outstanding'), true);

  const first = ledger.runAutonomousCycle({
    actionTypes: ['review_work_permit_readiness'],
    jobIds: [job.id]
  });
  assert.equal(first.applied.length, 1);
  assert.equal(first.applied[0].status, 'task_created');
  assert.equal(first.applied[0].externalCommitments, 0);
  assert.equal(first.applied[0].activationInferred, false);
  assert.equal(first.applied[0].acknowledgementsInferred, false);
  const retained = ledger.getWorkPermit(created.permit.id);
  assert.equal(retained.status, 'active');
  assert.equal(retained.attendanceSummary.acknowledged, 0);

  const repeat = ledger.runAutonomousCycle({
    actionTypes: ['review_work_permit_readiness'],
    jobIds: [job.id]
  });
  assert.equal(repeat.applied.length, 1);
  assert.equal(repeat.applied[0].status, 'replayed');
  assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM job_tasks WHERE data_json LIKE '%workPermitId%'").get().count, 1);
});

test('work permit creation rejects incomplete safety definitions and jobs without assigned workers', t => {
  const { ledger, job } = fixture(t, 'validation');
  const payload = permitPayload('validation-001');
  assert.throws(
    () => ledger.createWorkPermit(job.id, { ...payload, entryKey: 'permit-no-hazards-001', hazards: [] }),
    error => error.code === 'work_permit_hazards_required' && error.statusCode === 400
  );
  assert.throws(
    () => ledger.createWorkPermit(job.id, { ...payload, entryKey: 'permit-no-controls-001', controls: [] }),
    error => error.code === 'work_permit_controls_required' && error.statusCode === 400
  );
  assert.throws(
    () => ledger.createWorkPermit(job.id, {
      ...payload,
      entryKey: 'permit-invalid-window-001',
      validFrom: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    }),
    error => error.code === 'work_permit_validity_invalid' && error.statusCode === 400
  );

  ledger.db.prepare("UPDATE assignments SET status = 'cancelled' WHERE job_id = ?").run(job.id);
  assert.throws(
    () => ledger.createWorkPermit(job.id, { ...payload, entryKey: 'permit-no-crew-001' }),
    error => error.code === 'work_permit_assigned_workers_required' && error.statusCode === 409
  );
  assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM permit_records WHERE entry_key = 'permit-no-crew-001'").get().count, 0);
});
