const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-attendance-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  const job = ledger.createIntake({
    title: 'Attendance controlled site',
    client: { name: 'Attendance Client' },
    status: 'in_progress',
    assignAutomatically: false
  }, { actor: 'attendance-test' });
  const worker = ledger.upsertWorker({ name: 'Site Worker', role: 'Installer', status: 'available' }, { actor: 'attendance-test' });
  let assignment = ledger.addAssignment(job.id, {
    workerId: worker.id,
    status: 'active',
    role: 'Installer'
  }, { actor: 'attendance-test', optional: false });
  if (assignment.approval?.id) {
    ledger.resolveApproval(assignment.approval.id, {
      status: 'approved',
      resolvedBy: 'Workforce approver',
      reason: 'Worker availability and assignment window were verified.'
    });
    assignment = ledger.getJobDetail(job.id).assignments.find(item => item.id === assignment.id);
  }
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, job, worker, assignment };
}

function clearSiteAccess(ledger, job, worker, assignment) {
  const orientation = ledger.createWorkerOrientation(job.id, {
    assignmentId: assignment.id,
    workerId: worker.id,
    workerName: worker.name,
    status: 'completed',
    topics: ['site rules', 'emergency routes']
  }, { actor: 'safety-office' });
  ledger.resolveApproval(orientation.approvalId, {
    status: 'approved',
    resolvedBy: 'Safety approver',
    reason: 'Worker identity, topics, and assignment were verified.'
  });
  const access = ledger.createSiteAccessLog(job.id, {
    assignmentId: assignment.id,
    workerId: worker.id,
    workerName: worker.name,
    orientationId: orientation.id,
    orientationValid: true,
    status: 'cleared',
    accessPoint: 'North gate'
  }, { actor: 'safety-office' });
  ledger.resolveApproval(access.approvalId, {
    status: 'approved',
    resolvedBy: 'Access approver',
    reason: 'Assignment-scoped orientation and access point were verified.'
  });
  return { orientation, access };
}

test('attendance requires assignment-scoped access and retains exact replay semantics', t => {
  const { ledger, job, worker, assignment } = fixture(t);
  const checkInAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const payload = {
    assignmentId: assignment.id,
    workerId: worker.id,
    occurredAt: checkInAt,
    entryKey: 'attendance-check-in-0001',
    accessPoint: 'North gate',
    note: 'Started assigned installation work.'
  };
  assert.throws(
    () => ledger.recordAttendanceCheckIn(job.id, payload),
    error => error.code === 'attendance_site_access_required' && error.statusCode === 409
  );
  clearSiteAccess(ledger, job, worker, assignment);

  const first = ledger.recordAttendanceCheckIn(job.id, payload, { actor: 'role:field_worker' });
  const replay = ledger.recordAttendanceCheckIn(job.id, payload, { actor: 'role:field_worker' });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.session.id, first.session.id);
  assert.equal(first.board.summary.checkedIn, 1);
  assert.equal(first.session.data.payrollDerived, false);
  assert.equal(first.session.data.geolocationCaptured, false);
  assert.throws(
    () => ledger.recordAttendanceCheckIn(job.id, { ...payload, note: 'Different content' }),
    error => error.code === 'attendance_entry_key_reused' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.recordAttendanceCheckIn(job.id, { ...payload, entryKey: 'attendance-check-in-0002' }),
    error => error.code === 'attendance_worker_already_checked_in' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.releaseAssignment(job.id, assignment.id, { reason: 'Attempt while worker remains on site.' }),
    error => error.code === 'assignment_open_attendance' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.requestJobArchive(job.id, { reason: 'Attempt archive while worker remains on site.' }),
    error => error.code === 'job_archive_open_attendance' && error.statusCode === 409
  );

  const checkoutPayload = {
    workerId: worker.id,
    occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    entryKey: 'attendance-check-out-0001',
    note: 'Left after assigned work was secured.'
  };
  const checkedOut = ledger.recordAttendanceCheckOut(job.id, first.session.id, checkoutPayload, { actor: 'role:field_worker' });
  const checkoutReplay = ledger.recordAttendanceCheckOut(job.id, first.session.id, checkoutPayload, { actor: 'role:field_worker' });
  assert.equal(checkedOut.session.status, 'checked_out');
  assert.equal(checkoutReplay.replayed, true);
  assert.equal(checkedOut.board.summary.checkedIn, 0);
  assert.equal(checkedOut.board.summary.checkedOut, 1);
  assert.ok(checkedOut.board.rows[0].durationHours > 0);
  assert.equal(ledger.diagnose().valid, true);
});

test('attendance adjustments preserve raw times and apply only after approval', t => {
  const { ledger, job, worker, assignment } = fixture(t);
  clearSiteAccess(ledger, job, worker, assignment);
  const rawCheckIn = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const rawCheckOut = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const session = ledger.recordAttendanceCheckIn(job.id, {
    assignmentId: assignment.id,
    workerId: worker.id,
    occurredAt: rawCheckIn,
    entryKey: 'attendance-adjust-in-0001'
  }).session;
  ledger.recordAttendanceCheckOut(job.id, session.id, {
    workerId: worker.id,
    occurredAt: rawCheckOut,
    entryKey: 'attendance-adjust-out-0001'
  });
  const requestedCheckIn = new Date(Date.parse(rawCheckIn) + 15 * 60 * 1000).toISOString();
  const requestedCheckOut = new Date(Date.parse(rawCheckOut) + 10 * 60 * 1000).toISOString();
  const requested = ledger.requestAttendanceAdjustment(job.id, session.id, {
    checkInAt: requestedCheckIn,
    checkOutAt: requestedCheckOut,
    reason: 'Supervisor confirmed corrected gate scanner times.'
  }, { actor: 'office' });
  assert.equal(requested.adjustment.status, 'pending_approval');
  assert.equal(requested.adjustment.integrityValid, true);
  assert.equal(requested.approval.targetType, 'attendance_adjustment');
  assert.match(requested.approval.decision.primaryEffect, /compensating attendance-time view/i);
  assert.equal(ledger.getAttendanceSession(session.id).effectiveCheckInAt, rawCheckIn);

  ledger.resolveApproval(requested.approval.id, {
    status: 'approved',
    resolvedBy: 'Attendance approver',
    reason: 'Gate evidence and supervisor confirmation were verified.'
  });
  const adjusted = ledger.getAttendanceSession(session.id);
  assert.equal(adjusted.checkInAt, rawCheckIn);
  assert.equal(adjusted.checkOutAt, rawCheckOut);
  assert.equal(adjusted.effectiveCheckInAt, requestedCheckIn);
  assert.equal(adjusted.effectiveCheckOutAt, requestedCheckOut);
  assert.equal(adjusted.adjustment.status, 'approved');
  assert.equal(ledger.diagnose().valid, true);
});

test('stale attendance produces one idempotent internal review task', t => {
  const { ledger, job, worker, assignment } = fixture(t);
  clearSiteAccess(ledger, job, worker, assignment);
  const retained = ledger.recordAttendanceCheckIn(job.id, {
    assignmentId: assignment.id,
    workerId: worker.id,
    occurredAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    entryKey: 'attendance-stale-in-0001'
  }).session;
  const preview = ledger.runAutonomousCycle({ dryRun: true, actionTypes: ['review_stale_attendance'], jobIds: [job.id] });
  assert.equal(preview.preview.length, 1);
  assert.equal(preview.preview[0].attendanceSessionId, retained.id);
  const applied = ledger.runAutonomousCycle({ actionTypes: ['review_stale_attendance'], jobIds: [job.id] });
  assert.equal(applied.applied.length, 1);
  assert.equal(applied.applied[0].status, 'task_created');
  const task = ledger.getJobDetail(job.id).tasks.find(item => item.id === applied.applied[0].taskId);
  assert.equal(task.data.attendanceSessionId, retained.id);
  assert.equal(task.data.internalOnly, true);
  assert.equal(ledger.runAutonomousCycle({ dryRun: true, actionTypes: ['review_stale_attendance'], jobIds: [job.id] }).preview.length, 0);
});
