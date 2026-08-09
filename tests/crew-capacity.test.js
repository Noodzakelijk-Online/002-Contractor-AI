const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ContractorOperatingLedger } = require('../operating-ledger');

function nextMondayWindow() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const daysUntilMonday = (8 - start.getUTCDay()) % 7 || 7;
  start.setUTCDate(start.getUTCDate() + daysUntilMonday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 13);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

const CREW_WINDOW = nextMondayWindow();
const WINDOW_START = CREW_WINDOW.start;
const WINDOW_END = CREW_WINDOW.end;

function createLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-crew-capacity-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function weekdayProfile(hours = 8) {
  return {
    effectiveFrom: WINDOW_START,
    timezone: 'Europe/Amsterdam',
    dailyHours: {
      sunday: 0,
      monday: hours,
      tuesday: hours,
      wednesday: hours,
      thursday: hours,
      friday: hours,
      saturday: 0
    }
  };
}

function scheduledFixture(t, durationHours = 8) {
  const ledger = createLedger(t);
  const job = ledger.createIntake({
    client: { name: 'Crew capacity client', email: 'crew-capacity@example.test', country: 'NL' },
    title: 'Crew capacity governed plan',
    status: 'planned',
    scheduledStart: `${WINDOW_START}T08:00:00.000Z`,
    scheduledEnd: `${WINDOW_END}T17:00:00.000Z`,
    tasks: [{ title: 'Install retained scope', durationHours }],
    assignAutomatically: false
  }, { actor: 'crew-capacity-test' });
  const baseline = ledger.requestScheduleBaseline(job.id, {
    plannedStart: `${WINDOW_START}T08:00:00.000Z`,
    reason: 'Crew capacity fixture baseline.'
  });
  ledger.resolveApproval(baseline.approval.id, {
    status: 'approved',
    resolvedBy: 'crew-capacity-owner',
    reason: 'Task sequence and duration verified.'
  });
  const worker = ledger.upsertWorker({
    name: `Capacity worker ${durationHours}`,
    role: 'Installer',
    status: 'available'
  });
  const assignment = ledger.addAssignment(job.id, {
    workerId: worker.id,
    role: 'Installer',
    status: 'planned',
    scheduledStart: `${WINDOW_START}T08:00:00.000Z`,
    scheduledEnd: `${WINDOW_END}T17:00:00.000Z`,
    allocationHours: durationHours
  });
  assert.equal(assignment.status, 'planned');
  return { ledger, job: ledger.getJobDetail(job.id), worker, assignment };
}

test('explicit capacity and day allocations produce an approval-backed source-current look-ahead', t => {
  const { ledger, job, worker, assignment } = scheduledFixture(t, 8);
  const profile = ledger.setCrewCapacityProfile(worker.id, weekdayProfile(8), { actor: 'planner' });
  assert.equal(profile.profile.weeklyHours, 40);
  assert.equal(profile.profile.integrityValid, true);
  assert.equal(ledger.setCrewCapacityProfile(worker.id, weekdayProfile(8)).replayed, true);

  const payload = {
    assignmentId: assignment.id,
    taskId: job.tasks[0].id,
    workDate: WINDOW_START,
    plannedHours: 8,
    notes: 'One retained installation shift.'
  };
  const allocation = ledger.createCrewCapacityAllocation(payload, { actor: 'planner' });
  assert.equal(allocation.allocation.integrityValid, true);
  assert.equal(ledger.createCrewCapacityAllocation(payload).replayed, true);

  const board = ledger.listCrewCapacityBoard({ referenceDate: WINDOW_START });
  assert.equal(board.window.horizonDays, 14);
  assert.equal(board.ready, true, JSON.stringify(board.blockers));
  assert.equal(board.summary.totalPlannedHours, 8);
  assert.equal(board.summary.taskCapacityGaps, 0);
  assert.equal(board.workers.find(item => item.id === worker.id).days[0].remainingHours, 0);

  const requested = ledger.requestCrewLookaheadPlan({
    referenceDate: WINDOW_START,
    reason: 'Capacity, availability, assignment, and task coverage reviewed.'
  }, { actor: 'planner' });
  assert.equal(requested.plan.status, 'pending_approval');
  assert.equal(requested.plan.integrityValid, true);
  assert.equal(requested.approval.targetType, 'crew_lookahead_plan');
  assert.equal(requested.approval.data.externalCommitments, 0);
  const replay = ledger.requestCrewLookaheadPlan({ referenceDate: WINDOW_START });
  assert.equal(replay.replayed, true);
  assert.equal(replay.plan.id, requested.plan.id);

  ledger.resolveApproval(requested.approval.id, {
    status: 'approved',
    resolvedBy: 'crew-capacity-owner',
    reason: 'The exact two-week plan was checked.'
  });
  const approvedBoard = ledger.listCrewCapacityBoard({ referenceDate: WINDOW_START });
  assert.equal(approvedBoard.plans.approved.id, requested.plan.id);
  assert.equal(approvedBoard.plans.current, true);
  assert.equal(approvedBoard.safeguards.externalCommitments, 0);
  assert.equal(ledger.diagnose().valid, true, JSON.stringify(ledger.diagnose().issues));
  assert.equal(ledger.migrationStatus().currentVersion, '068_operational_safety_controls');
});

test('overload, retained absence, stale source, and malformed hours fail closed', t => {
  const { ledger, job, worker, assignment } = scheduledFixture(t, 9);
  ledger.setCrewCapacityProfile(worker.id, weekdayProfile(8));
  assert.throws(
    () => ledger.createCrewCapacityAllocation({
      assignmentId: assignment.id,
      taskId: job.tasks[0].id,
      workDate: WINDOW_START,
      plannedHours: 'not-a-number'
    }),
    error => error.code === 'crew_allocation_hours_invalid'
  );
  const allocation = ledger.createCrewCapacityAllocation({
    assignmentId: assignment.id,
    taskId: job.tasks[0].id,
    workDate: WINDOW_START,
    plannedHours: 9
  });
  let board = ledger.listCrewCapacityBoard({ referenceDate: WINDOW_START });
  assert.equal(board.ready, false);
  assert.ok(board.blockers.some(blocker => blocker.type === 'crew_overload'));
  assert.throws(
    () => ledger.requestCrewLookaheadPlan({ referenceDate: WINDOW_START }),
    error => error.code === 'crew_lookahead_not_ready' && error.statusCode === 409
  );

  ledger.createWorkerAvailabilityPeriod(worker.id, {
    periodType: 'training',
    title: 'Retained training day',
    startsAt: `${WINDOW_START}T07:00:00.000Z`,
    endsAt: `${WINDOW_START}T18:00:00.000Z`,
    notes: 'Operational unavailability only.'
  });
  board = ledger.listCrewCapacityBoard({ referenceDate: WINDOW_START });
  assert.ok(board.blockers.some(blocker => blocker.type === 'crew_unavailable_allocation'));

  assert.equal(ledger.nextActions().some(action => action.type === 'review_crew_capacity'), false);
  assert.ok(ledger.nextActions({ includeCrewCapacity: true }).some(action => action.type === 'review_crew_capacity' && action.jobId === job.id));

  const preview = ledger.runAutonomousCycle({
    dryRun: true,
    actionTypes: ['review_crew_capacity'],
    jobIds: [job.id]
  });
  assert.ok(preview.preview.length >= 1);
  const applied = ledger.runAutonomousCycle({
    actionTypes: ['review_crew_capacity'],
    jobIds: [job.id],
    actor: 'crew-capacity-autonomy'
  });
  assert.ok(applied.applied.length >= 1);
  assert.ok(applied.applied.every(item => item.externalCommitments === 0 && item.assignmentsCreated === 0));
  const appliedSourceHashes = new Set(applied.applied.map(item => item.sourceHash));
  const tasks = ledger.getJobDetail(job.id).tasks.filter(task => appliedSourceHashes.has(task.data?.crewLookaheadSourceHash));
  assert.equal(tasks.length, applied.applied.length);
  assert.ok(tasks.every(task => task.data.internalOnly === true && task.data.notificationsSent === 0));
  assert.equal(ledger.runAutonomousCycle({ actionTypes: ['review_crew_capacity'], jobIds: [job.id] }).applied.length, 0);

  assert.equal(ledger.cancelCrewCapacityAllocation(allocation.allocation.id, { reason: 'Resolve the overloaded retained shift.' }).allocation.status, 'cancelled');
});

test('approval resolution is atomic when look-ahead source evidence changes', t => {
  const { ledger, job, worker, assignment } = scheduledFixture(t, 8);
  ledger.setCrewCapacityProfile(worker.id, weekdayProfile(8));
  ledger.createCrewCapacityAllocation({
    assignmentId: assignment.id,
    taskId: job.tasks[0].id,
    workDate: WINDOW_START,
    plannedHours: 8
  });
  const requested = ledger.requestCrewLookaheadPlan({ referenceDate: WINDOW_START });
  ledger.setCrewCapacityProfile(worker.id, weekdayProfile(6), { actor: 'planner' });
  assert.throws(
    () => ledger.resolveApproval(requested.approval.id, {
      status: 'approved',
      resolvedBy: 'crew-capacity-owner',
      reason: 'Attempt against stale evidence.'
    }),
    error => error.code === 'crew_lookahead_stale'
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).some(item => item.id === requested.approval.id), true);
  assert.equal(ledger.listCrewLookaheadPlans({ status: 'pending_approval' })[0].id, requested.plan.id);
  ledger.resolveApproval(requested.approval.id, {
    status: 'rejected',
    resolvedBy: 'crew-capacity-owner',
    reason: 'Capacity changed after submission.'
  });
  assert.equal(ledger.listCrewLookaheadPlans({ status: 'rejected' })[0].id, requested.plan.id);
  assert.equal(ledger.listCrewCapacityBoard({ referenceDate: WINDOW_START }).plans.stale, false);
});
