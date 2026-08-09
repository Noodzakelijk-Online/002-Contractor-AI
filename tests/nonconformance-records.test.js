const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t, suffix = 'governed') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-ncr-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  const job = ledger.createIntake({
    title: `NCR ${suffix}`,
    client: { name: `NCR client ${suffix}` },
    status: 'in_progress',
    assignAutomatically: false
  }, { actor: 'ncr_test' });
  const worker = ledger.upsertWorker({
    name: `Quality worker ${suffix}`,
    role: 'Site operative',
    status: 'available'
  }, { actor: 'ncr_test' });
  ledger.addAssignment(job.id, {
    workerId: worker.id,
    workerName: worker.name,
    role: worker.role,
    status: 'assigned'
  }, { actor: 'ncr_test' });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, job, worker };
}

function recordPayload(worker, suffix = '001') {
  return {
    entryKey: `nonconformance-entry-${suffix}`,
    workerId: worker.id,
    workerName: worker.name,
    severity: 'high',
    discipline: 'structural',
    title: 'Anchor spacing differs from approved detail',
    description: 'Retained survey measurements show two anchors outside the approved maximum spacing.',
    location: 'Level 2 east facade bay E4',
    detectedAt: new Date().toISOString(),
    raisedBy: worker.name,
    requirementReference: 'Approved detail STR-421 revision C / note 7',
    immediateContainment: 'Stopped covering work and marked the affected bay pending technical review.',
    responsibleParty: 'Facade subcontract supervisor',
    dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    notes: 'Internal quality record only.'
  };
}

function correctionPayload() {
  return {
    rootCause: 'Setting-out points were transferred from a superseded workshop sketch.',
    correctiveAction: 'Install approved supplementary anchors, repeat pull tests, and retain revised survey evidence.',
    responsibleParty: 'Facade subcontract supervisor',
    dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    evidenceReference: 'internal-method-review:NCR-correction-001',
    notes: 'No external instruction or cost commitment is created.'
  };
}

function closurePayload() {
  return {
    verificationResult: 'passed',
    verificationEvidence: 'pull-test-report:PTR-2026-184 and survey:SV-884',
    verifiedBy: 'Independent quality lead',
    verifiedAt: new Date().toISOString(),
    notes: 'Correction matches the approved detail and retained test acceptance criteria.'
  };
}

test('NCR flows through replay-safe capture, corrective-action approval, and independent closure approval', t => {
  const { ledger, job, worker } = fixture(t, 'lifecycle');
  const payload = recordPayload(worker, 'lifecycle-001');
  const created = ledger.createNonconformance(job.id, payload, { actor: 'field_worker' });

  assert.equal(created.replayed, false);
  assert.match(created.nonconformance.ncrNumber, /^NCR-\d{4}-\d{6}$/);
  assert.equal(created.nonconformance.status, 'open');
  assert.equal(created.nonconformance.integrityValid, true);
  assert.equal(created.externalCommitments, 0);

  const replay = ledger.createNonconformance(job.id, payload, { actor: 'offline_retry' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.nonconformance.id, created.nonconformance.id);
  assert.throws(
    () => ledger.createNonconformance(job.id, { ...payload, title: 'Changed retry content' }),
    error => error.code === 'nonconformance_entry_key_reused' && error.statusCode === 409
  );

  const correction = ledger.requestNonconformanceCorrectiveAction(
    job.id,
    created.nonconformance.id,
    correctionPayload(),
    { actor: 'office_operator' }
  );
  assert.equal(correction.nonconformance.status, 'pending_correction_approval');
  assert.equal(correction.approval.targetType, 'nonconformance_correction');
  assert.equal(correction.externalCommitments, 0);
  const correctionReplay = ledger.requestNonconformanceCorrectiveAction(job.id, created.nonconformance.id, correctionPayload());
  assert.equal(correctionReplay.replayed, true);
  assert.equal(correctionReplay.approval.id, correction.approval.id);
  assert.throws(
    () => ledger.requestNonconformanceCorrectiveAction(job.id, created.nonconformance.id, {
      ...correctionPayload(),
      evidenceReference: 'internal-method-review:changed-pending-request'
    }),
    error => error.code === 'nonconformance_correction_pending_conflict' && error.statusCode === 409
  );

  ledger.resolveApproval(correction.approval.id, {
    status: 'approved',
    resolvedBy: 'quality_approver',
    reason: 'Root cause, responsibility, method, and evidence reference verified.'
  });
  const corrected = ledger.getNonconformance(created.nonconformance.id);
  assert.equal(corrected.status, 'correction_approved');
  assert.equal(corrected.correctionIntegrityValid, true);
  assert.equal(corrected.correctiveAction.rootCause, correctionPayload().rootCause);

  const retainedClosure = closurePayload();
  assert.throws(
    () => ledger.requestNonconformanceClosure(job.id, created.nonconformance.id, {
      ...retainedClosure,
      verifiedBy: correctionPayload().responsibleParty
    }),
    error => error.code === 'nonconformance_independent_verifier_required' && error.statusCode === 409
  );
  const closure = ledger.requestNonconformanceClosure(
    job.id,
    created.nonconformance.id,
    retainedClosure,
    { actor: 'office_operator' }
  );
  assert.equal(closure.nonconformance.status, 'pending_closure_approval');
  assert.equal(closure.approval.targetType, 'nonconformance_closure');
  assert.equal(closure.externalCommitments, 0);
  const closureReplay = ledger.requestNonconformanceClosure(job.id, created.nonconformance.id, retainedClosure);
  assert.equal(closureReplay.replayed, true);
  assert.equal(closureReplay.approval.id, closure.approval.id);
  assert.throws(
    () => ledger.requestNonconformanceClosure(job.id, created.nonconformance.id, {
      ...retainedClosure,
      verificationEvidence: 'changed-pending-verification'
    }),
    error => error.code === 'nonconformance_closure_pending_conflict' && error.statusCode === 409
  );

  ledger.resolveApproval(closure.approval.id, {
    status: 'approved',
    resolvedBy: 'quality_approver',
    reason: 'Independent verification matches the approved correction and original NCR.'
  });
  const closed = ledger.getNonconformance(created.nonconformance.id);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closedBy, retainedClosure.verifiedBy);
  assert.equal(closed.closureIntegrityValid, true);
  assert.equal(closed.closure.verificationResult, 'passed');
  assert.equal(ledger.getJobDetail(job.id).nonconformances[0].id, closed.id);
  assert.equal(ledger.assessHandoverReadiness(job.id).blockers.some(blocker => blocker.code === 'open_nonconformances'), false);

  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, true, JSON.stringify(diagnostics.issues));
  assert.equal(diagnostics.migrations.currentVersion, '071_data_subject_request_governance');
  assert.equal(diagnostics.counts.nonconformanceRecords, 1);
  assert.equal(diagnostics.counts.openNonconformances, 0);
  assert.equal(ledger.dashboardSummary().metrics.nonconformances, 1);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('rejected NCR decisions return to actionable states without losing retained decisions', t => {
  const { ledger, job, worker } = fixture(t, 'rejections');
  const created = ledger.createNonconformance(job.id, recordPayload(worker, 'rejections-001'));
  const firstCorrection = ledger.requestNonconformanceCorrectiveAction(job.id, created.nonconformance.id, correctionPayload());
  ledger.resolveApproval(firstCorrection.approval.id, {
    status: 'rejected',
    resolvedBy: 'quality_approver',
    reason: 'Correction method needs a revised technical basis.'
  });
  const correctionRejected = ledger.getNonconformance(created.nonconformance.id);
  assert.equal(correctionRejected.status, 'correction_rejected');
  assert.equal(correctionRejected.correctionApprovalId, null);
  assert.equal(correctionRejected.data.correctionDecision.status, 'rejected');

  const revisedCorrection = ledger.requestNonconformanceCorrectiveAction(job.id, created.nonconformance.id, {
    ...correctionPayload(),
    evidenceReference: 'internal-method-review:NCR-correction-002'
  });
  ledger.resolveApproval(revisedCorrection.approval.id, {
    status: 'approved',
    resolvedBy: 'quality_approver',
    reason: 'Revised correction method verified.'
  });
  const closure = ledger.requestNonconformanceClosure(job.id, created.nonconformance.id, closurePayload());
  ledger.resolveApproval(closure.approval.id, {
    status: 'rejected',
    resolvedBy: 'quality_approver',
    reason: 'Repeat one pull test before closure.'
  });
  const closureRejected = ledger.getNonconformance(created.nonconformance.id);
  assert.equal(closureRejected.status, 'correction_approved');
  assert.equal(closureRejected.closureApprovalId, null);
  assert.equal(closureRejected.data.closureDecision.status, 'rejected');
  assert.equal(ledger.diagnose().valid, true);
});

test('NCR approval fails atomically after retained source or correction tampering', t => {
  const { ledger, job, worker } = fixture(t, 'tamper');
  const created = ledger.createNonconformance(job.id, recordPayload(worker, 'tamper-001'));
  const correction = ledger.requestNonconformanceCorrectiveAction(job.id, created.nonconformance.id, correctionPayload());
  ledger.db.prepare('UPDATE nonconformance_records SET description = ? WHERE id = ?')
    .run('Tampered source description', created.nonconformance.id);
  assert.throws(
    () => ledger.resolveApproval(correction.approval.id, {
      status: 'approved',
      resolvedBy: 'quality_approver',
      reason: 'This must roll back.'
    }),
    error => error.code === 'nonconformance_correction_state_conflict' && error.statusCode === 409
  );
  assert.equal(ledger.db.prepare('SELECT status FROM approvals WHERE id = ?').get(correction.approval.id).status, 'pending');
  assert.equal(ledger.db.prepare('SELECT status FROM nonconformance_records WHERE id = ?').get(created.nonconformance.id).status, 'pending_correction_approval');
  assert.equal(ledger.diagnose().valid, false);
});

test('autonomous NCR review creates one internal task for the current record state', t => {
  const { ledger, job, worker } = fixture(t, 'autonomy');
  const created = ledger.createNonconformance(job.id, {
    ...recordPayload(worker, 'autonomy-001'),
    dueAt: new Date().toISOString().slice(0, 10)
  });
  const archivedJob = ledger.createIntake({
    title: 'Archived NCR autonomy scope',
    client: { name: 'Archived NCR client' },
    status: 'in_progress',
    assignAutomatically: false
  });
  const archivedRecord = ledger.createNonconformance(archivedJob.id, {
    ...recordPayload(worker, 'autonomy-archived-001'),
    workerId: undefined,
    workerName: undefined,
    dueAt: new Date().toISOString().slice(0, 10)
  }).nonconformance;
  ledger.db.prepare("UPDATE jobs SET status = 'archived' WHERE id = ?").run(archivedJob.id);
  const first = ledger.runAutonomousCycle({
    actor: 'ncr_autonomy_test',
    actionTypes: ['review_nonconformance']
  });
  assert.ok(first.applied.some(action => action.type === 'review_nonconformance' && action.nonconformanceId === created.nonconformance.id));
  assert.equal(first.preview.some(action => action.nonconformanceId === archivedRecord.id), false);
  const tasks = ledger.db.prepare("SELECT * FROM job_tasks WHERE job_id = ? AND data_json LIKE ?").all(job.id, `%${created.nonconformance.id}%`);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, 'open');
  assert.equal(JSON.parse(tasks[0].data_json).externalCommitments, 0);
  ledger.db.prepare("UPDATE job_tasks SET status = 'completed' WHERE id = ?").run(tasks[0].id);

  const second = ledger.runAutonomousCycle({
    actor: 'ncr_autonomy_test',
    actionTypes: ['review_nonconformance']
  });
  assert.equal(second.applied.filter(action => action.nonconformanceId === created.nonconformance.id).length, 0);
  assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM job_tasks WHERE job_id = ? AND data_json LIKE ?").get(job.id, `%${created.nonconformance.id}%`).count, 1);
});

test('NCR retries canonicalize dates and revised corrective dates drive overdue metrics', t => {
  const { ledger, job, worker } = fixture(t, 'canonical-retry');
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const originalDueAt = yesterday.toISOString().slice(0, 10);
  const created = ledger.createNonconformance(job.id, {
    ...recordPayload(worker, 'canonical-retry-001'),
    detectedAt: yesterday.toISOString(),
    dueAt: originalDueAt
  });
  assert.equal(ledger.dashboardSummary().metrics.overdueNonconformances, 1);
  const revisedDueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const request = ledger.requestNonconformanceCorrectiveAction(job.id, created.nonconformance.id, {
    ...correctionPayload(),
    responsibleParty: undefined,
    dueAt: `${revisedDueAt}T12:00:00.000Z`
  });
  const replay = ledger.requestNonconformanceCorrectiveAction(job.id, created.nonconformance.id, {
    ...correctionPayload(),
    responsibleParty: undefined,
    dueAt: revisedDueAt
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.approval.id, request.approval.id);
  ledger.resolveApproval(request.approval.id, {
    status: 'approved',
    resolvedBy: 'quality_approver',
    reason: 'Canonical correction retry and revised due date verified.'
  });
  assert.equal(ledger.dashboardSummary().metrics.overdueNonconformances, 0);
  const verifiedAt = new Date();
  const closure = ledger.requestNonconformanceClosure(job.id, created.nonconformance.id, {
    ...closurePayload(),
    verifiedAt: verifiedAt.toISOString()
  });
  const closureReplay = ledger.requestNonconformanceClosure(job.id, created.nonconformance.id, {
    ...closurePayload(),
    verifiedAt: verifiedAt.toISOString().replace('Z', '+00:00')
  });
  assert.equal(closureReplay.replayed, true);
  assert.equal(closureReplay.approval.id, closure.approval.id);
});
