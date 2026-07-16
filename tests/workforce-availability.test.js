const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ContractorOperatingLedger } = require('../operating-ledger');

function createLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-worker-availability-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function futureWindow(offsetDays = 7, durationHours = 8) {
  const startsAt = new Date(Date.now() + offsetDays * 86_400_000).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + durationHours * 3_600_000).toISOString();
  return { startsAt, endsAt };
}

test('availability periods are replay-safe and block assignment approval until approved cancellation', t => {
  const ledger = createLedger(t);
  const window = futureWindow();
  const job = ledger.createIntake({
    title: 'Availability governed assignment',
    client: { name: 'Availability client' },
    scheduledStart: window.startsAt,
    scheduledEnd: window.endsAt
  });
  const worker = ledger.upsertWorker({ name: 'Availability worker', role: 'Installer', status: 'available' });
  const payload = {
    periodType: 'training',
    title: 'Manufacturer training',
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    notes: 'Operational capacity only.'
  };
  const first = ledger.createWorkerAvailabilityPeriod(worker.id, payload, { actor: 'availability_test' });
  const replay = ledger.createWorkerAvailabilityPeriod(worker.id, payload, { actor: 'availability_test' });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.period.id, first.period.id);
  assert.equal(ledger.getWorker(worker.id).availability.upcoming, 1);
  const scheduleCandidate = ledger.workerScheduleCandidates(
    { title: job.title, jobType: 'installation' },
    window.startsAt,
    window.endsAt,
    job.id
  ).find(item => item.worker.id === worker.id);
  assert.equal(scheduleCandidate.available, false);
  assert.equal(scheduleCandidate.availabilityConflicts.length, 1);

  const assignment = ledger.addAssignment(job.id, {
    workerId: worker.id,
    role: 'Installer',
    status: 'planned',
    scheduledStart: window.startsAt,
    scheduledEnd: window.endsAt
  });
  assert.equal(assignment.status, 'pending_approval');
  assert.equal(assignment.availabilityConflicts.length, 1);
  assert.ok(assignment.data.approvalReasons.some(reason => reason.type === 'worker_availability_conflict'));
  const readiness = ledger.workerAssignmentReadiness([assignment], { jobId: job.id });
  assert.equal(readiness.status, 'blocked');
  assert.equal(readiness.availabilityConflicts, 1);

  const cancellation = ledger.requestWorkerAvailabilityCancellation(worker.id, first.period.id, {
    reason: 'Training was moved outside the retained assignment window.'
  }, { actor: 'availability_test' });
  assert.equal(cancellation.period.status, 'pending_cancellation');
  assert.equal(ledger.findWorkerAvailabilityConflicts({
    workerId: worker.id,
    scheduledStart: window.startsAt,
    scheduledEnd: window.endsAt
  }).length, 1);

  assert.throws(
    () => ledger.resolveApproval(assignment.approval.id, {
      status: 'approved',
      resolvedBy: 'availability_approver',
      reason: 'Attempt before availability resolution.'
    }),
    error => error.code === 'assignment_worker_availability_required'
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).some(item => item.id === assignment.approval.id), true);

  ledger.resolveApproval(cancellation.approval.id, {
    status: 'approved',
    resolvedBy: 'availability_approver',
    reason: 'Operational training move verified.'
  });
  assert.equal(ledger.getWorkerAvailabilityPeriod(first.period.id).status, 'cancelled');
  const approvedAssignment = ledger.resolveApproval(assignment.approval.id, {
    status: 'approved',
    resolvedBy: 'availability_approver',
    reason: 'Availability conflict is resolved.'
  });
  assert.equal(approvedAssignment.status, 'approved');
  assert.equal(ledger.getJobDetail(job.id).assignments[0].status, 'planned');
  assert.equal(ledger.diagnose().valid, true);
});

test('rejected availability cancellation restores the blocking period and sensitive fields are refused', t => {
  const ledger = createLedger(t);
  const window = futureWindow(14);
  const worker = ledger.upsertWorker({ name: 'Privacy governed worker', role: 'Electrician', status: 'available' });
  assert.throws(
    () => ledger.createWorkerAvailabilityPeriod(worker.id, {
      periodType: 'leave',
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      diagnosis: 'Sensitive diagnosis must not be retained.'
    }),
    error => error.code === 'worker_availability_sensitive_data_forbidden'
  );
  assert.throws(
    () => ledger.createWorkerAvailabilityPeriod(worker.id, {
      periodType: 'leave',
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      notes: 'Medical details must not be retained here.'
    }),
    error => error.code === 'worker_availability_sensitive_data_forbidden'
  );
  const created = ledger.createWorkerAvailabilityPeriod(worker.id, {
    periodType: 'leave',
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    notes: 'Not available for operational planning.'
  });
  const cancellation = ledger.requestWorkerAvailabilityCancellation(worker.id, created.period.id, {
    reason: 'Request is being reviewed against the retained plan.'
  });
  ledger.resolveApproval(cancellation.approval.id, {
    status: 'rejected',
    resolvedBy: 'availability_approver',
    reason: 'The retained leave period remains current.'
  });
  const restored = ledger.getWorkerAvailabilityPeriod(created.period.id);
  assert.equal(restored.status, 'active');
  assert.equal(restored.cancellationApprovalId, null);
  assert.equal(ledger.findWorkerAvailabilityConflicts({
    workerId: worker.id,
    scheduledStart: window.startsAt,
    scheduledEnd: window.endsAt
  }).length, 1);
  assert.equal(ledger.diagnose().valid, true);
});

test('autonomy creates one internal availability review task and never changes commitments', t => {
  const ledger = createLedger(t);
  const window = futureWindow(21);
  const job = ledger.createIntake({
    title: 'Availability autonomous review',
    client: { name: 'Autonomy availability client' },
    scheduledStart: window.startsAt,
    scheduledEnd: window.endsAt
  });
  const worker = ledger.upsertWorker({ name: 'Autonomy availability worker', role: 'Foreman', status: 'available' });
  const assignment = ledger.addAssignment(job.id, {
    workerId: worker.id,
    role: 'Foreman',
    status: 'planned',
    scheduledStart: window.startsAt,
    scheduledEnd: window.endsAt
  });
  const period = ledger.createWorkerAvailabilityPeriod(worker.id, {
    periodType: 'external_commitment',
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    notes: 'Retained capacity conflict.'
  });
  const action = ledger.nextActions().find(item => (
    item.type === 'review_worker_availability_conflict'
    && item.assignmentId === assignment.id
    && item.periodId === period.period.id
  ));
  assert.ok(action);
  const workforceRow = ledger.listWorkforceReadiness({ limit: 100 }).jobs.find(item => item.jobId === job.id);
  assert.equal(workforceRow.flags.workerConflict, true);
  assert.equal(workforceRow.counts.workerAvailabilityConflicts, 1);
  assert.equal(ledger.dashboardSummary().workload.workerAvailabilityConflicts, 1);
  const first = ledger.runAutonomousCycle({
    actionTypes: ['review_worker_availability_conflict'],
    jobIds: [job.id],
    actor: 'availability_autonomy_test'
  });
  assert.equal(first.applied.length, 1);
  const task = ledger.getJobDetail(job.id).tasks.find(item => item.id === first.applied[0].taskId);
  assert.equal(task.data.internalOnly, true);
  assert.equal(task.data.externalCommitments, 0);
  assert.equal(ledger.getWorkerAvailabilityPeriod(period.period.id).status, 'active');
  assert.equal(ledger.getJobDetail(job.id).assignments.find(item => item.id === assignment.id).status, 'planned');
  const second = ledger.runAutonomousCycle({ actionTypes: ['review_worker_availability_conflict'], jobIds: [job.id] });
  assert.equal(second.applied.length, 0);
  assert.equal(ledger.diagnose().valid, true);
});
