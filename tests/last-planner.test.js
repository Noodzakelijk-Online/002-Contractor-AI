const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ContractorOperatingLedger } = require('../operating-ledger');

const WEEK_START = '2026-08-03';

function fixture(t, suffix = 'primary') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-last-planner-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const job = ledger.createIntake({
    client: { name: `Last Planner client ${suffix}` },
    title: `Last Planner job ${suffix}`,
    status: 'planned',
    scheduledStart: `${WEEK_START}T08:00:00.000Z`,
    scheduledEnd: '2026-08-16T17:00:00.000Z',
    tasks: [{ title: 'Install source-bound framing', durationHours: 8 }],
    assignAutomatically: false
  }, { actor: 'last-planner-test' });
  const baseline = ledger.requestScheduleBaseline(job.id, { plannedStart: `${WEEK_START}T08:00:00.000Z` });
  ledger.resolveApproval(baseline.approval.id, {
    status: 'approved', resolvedBy: 'owner', reason: 'Task sequence checked.'
  });
  const worker = ledger.upsertWorker({ name: `Last Planner lead ${suffix}`, role: 'Site lead', status: 'available', hourlyRate: 64 });
  const assignment = ledger.addAssignment(job.id, {
    workerId: worker.id,
    role: 'Site lead',
    status: 'planned',
    scheduledStart: `${WEEK_START}T08:00:00.000Z`,
    scheduledEnd: '2026-08-16T17:00:00.000Z',
    allocationHours: 8
  });
  ledger.setCrewCapacityProfile(worker.id, {
    effectiveFrom: WEEK_START,
    timezone: 'Europe/Amsterdam',
    dailyHours: { sunday: 0, monday: 8, tuesday: 8, wednesday: 8, thursday: 8, friday: 8, saturday: 0 }
  });
  const taskId = ledger.getJobDetail(job.id).tasks[0].id;
  const allocation = ledger.createCrewCapacityAllocation({
    assignmentId: assignment.id,
    taskId,
    workDate: WEEK_START,
    plannedHours: 8
  });
  const lookahead = ledger.requestCrewLookaheadPlan({ referenceDate: WEEK_START });
  ledger.resolveApproval(lookahead.approval.id, {
    status: 'approved', resolvedBy: 'owner', reason: 'Capacity and task coverage checked.'
  });
  return { ledger, job, worker, assignment, taskId, allocation: allocation.allocation };
}

function closeDailyCycle(ledger, job, worker, suffix = '01') {
  const started = ledger.createDailyStartHuddle(job.id, {
    entryKey: `last-planner-huddle-${suffix}`,
    workDate: WEEK_START,
    shiftLabel: 'day',
    facilitator: worker.name,
    leadWorkerId: worker.id,
    workerIds: [worker.id],
    plannedWork: 'Install and inspect the retained framing promise.',
    productionTarget: 'Complete the retained weekly promise.',
    safetyFocus: 'Keep the material route clear and apply retained lifting controls.',
    evidenceReference: `huddle-evidence-${suffix}`
  });
  const ended = ledger.closeDailyOperatingCycle(job.id, started.cycle.id, {
    entryKey: `last-planner-eod-${suffix}`,
    workerId: worker.id,
    hours: 8,
    manpower: 1,
    weather: 'clear',
    workCompleted: 'Completed and inspected the retained framing promise.',
    safetyConcern: false,
    planAchieved: true,
    tomorrowPlan: 'Continue with the next approved work-plan activity.',
    evidenceReferences: [`daily-progress-${suffix}`]
  });
  ledger.resolveApproval(ended.dailyLog.fieldReport.approvalId, {
    status: 'approved', resolvedBy: 'owner', reason: 'Daily plan-versus-actual evidence checked.'
  });
  return ledger.getDailyOperatingCycle(started.cycle.id, { jobId: job.id });
}

test('make-ready release, weekly approval, daily actual, and PPC form one replay-safe chain', t => {
  const { ledger, job, worker, taskId } = fixture(t, 'success');
  const constraintPayload = {
    taskId,
    category: 'information',
    title: 'Confirm retained framing detail',
    description: 'Verify the opening dimension before the framing promise is made.',
    owner: 'Site lead',
    dueDate: WEEK_START,
    evidenceReference: 'drawing-detail-A-103',
    entryKey: 'last-planner-constraint-success'
  };
  const created = ledger.createLastPlannerConstraint(job.id, constraintPayload, { actor: 'planner' });
  assert.equal(created.constraint.integrityValid, true);
  assert.equal(ledger.createLastPlannerConstraint(job.id, constraintPayload).replayed, true);
  assert.throws(
    () => ledger.requestLastPlannerWeeklyPlan(job.id, {
      weekStart: WEEK_START,
      entryKey: 'last-planner-plan-blocked',
      commitments: [{ taskId, workDate: WEEK_START, promise: 'Complete retained framing.', promisedBy: worker.name, plannedHours: 8 }]
    }),
    error => error.code === 'last_planner_commitment_not_ready'
  );

  const releasePayload = {
    evidenceReference: 'verified-detail-A-103-rev-2',
    entryKey: 'last-planner-release-success'
  };
  const released = ledger.releaseLastPlannerConstraint(job.id, created.constraint.id, releasePayload, { actor: 'planner' });
  assert.equal(released.constraint.status, 'released');
  assert.equal(released.constraint.releaseIntegrityValid, true);
  assert.equal(ledger.releaseLastPlannerConstraint(job.id, created.constraint.id, releasePayload).replayed, true);

  const planPayload = {
    weekStart: WEEK_START,
    entryKey: 'last-planner-plan-success',
    reason: 'Make-ready and crew evidence checked.',
    commitments: [{
      taskId,
      workDate: WEEK_START,
      promise: 'Complete and inspect the retained framing scope.',
      promisedBy: worker.name,
      plannedHours: 8
    }]
  };
  const requested = ledger.requestLastPlannerWeeklyPlan(job.id, planPayload, { actor: 'planner' });
  assert.equal(requested.plan.status, 'pending_approval');
  assert.equal(requested.plan.integrityValid, true);
  assert.equal(requested.approval.targetType, 'last_planner_weekly_plan');
  assert.equal(requested.approval.data.externalCommitments, 0);
  assert.equal(ledger.requestLastPlannerWeeklyPlan(job.id, planPayload).replayed, true);
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved', resolvedBy: 'owner', reason: 'Exact weekly promises checked.'
  });

  const emergent = ledger.createLastPlannerConstraint(job.id, {
    taskId,
    category: 'access',
    title: 'Confirm emergent access route',
    description: 'Reconfirm the access route after the approved weekly plan was retained.',
    owner: 'Site lead',
    dueDate: WEEK_START,
    evidenceReference: 'access-route-change-source',
    entryKey: 'last-planner-emergent-constraint'
  });
  assert.equal(ledger.getLastPlannerBoard({ jobId: job.id, weekStart: WEEK_START }).commitments[0].atRisk, true);
  ledger.releaseLastPlannerConstraint(job.id, emergent.constraint.id, {
    evidenceReference: 'access-route-reverified',
    entryKey: 'last-planner-emergent-release'
  });
  assert.equal(ledger.getLastPlannerBoard({ jobId: job.id, weekStart: WEEK_START }).commitments[0].atRisk, false);

  const dailyCycle = closeDailyCycle(ledger, job, worker);
  assert.equal(dailyCycle.status, 'closed');
  assert.equal(dailyCycle.planningSource.lastPlannerWeeklyPlan.id, requested.plan.id);
  const commitment = ledger.listLastPlannerWeeklyPlans({ jobId: job.id, weekStart: WEEK_START, status: 'approved' })[0].commitments[0];
  const outcomePayload = {
    result: 'completed',
    evidenceReferences: ['weekly-completion-photo-set'],
    dailyCycleIds: [dailyCycle.id],
    entryKey: 'last-planner-outcome-success'
  };
  const outcome = ledger.recordLastPlannerOutcome(job.id, requested.plan.id, commitment.id, outcomePayload, { actor: 'planner' });
  assert.equal(outcome.outcome.integrityValid, true);
  assert.equal(ledger.recordLastPlannerOutcome(job.id, requested.plan.id, commitment.id, outcomePayload).replayed, true);

  const board = ledger.getLastPlannerBoard({ jobId: job.id, weekStart: WEEK_START });
  assert.equal(board.summary.weeklyPromises, 1);
  assert.equal(board.summary.completedPromises, 1);
  assert.equal(board.summary.ppcPercent, 100);
  assert.equal(board.summary.openConstraints, 0);
  assert.equal(board.safeguards.scheduleChanged, false);
  assert.equal(ledger.diagnose().valid, true, JSON.stringify(ledger.diagnose().issues));
  assert.equal(ledger.migrationStatus().currentVersion, '062_governed_five_s');
});

test('weekly approvals fail atomically on changed crew evidence and autonomy only creates internal review work', t => {
  const { ledger, job, worker, taskId, allocation } = fixture(t, 'stale');
  const requested = ledger.requestLastPlannerWeeklyPlan(job.id, {
    weekStart: WEEK_START,
    entryKey: 'last-planner-plan-stale',
    commitments: [{ taskId, workDate: WEEK_START, promise: 'Complete retained framing.', promisedBy: worker.name, plannedHours: 8 }]
  });
  ledger.cancelCrewCapacityAllocation(allocation.id, { reason: 'Crew plan changed before weekly approval.' });
  assert.throws(
    () => ledger.resolveApproval(requested.approval.id, { status: 'approved', resolvedBy: 'owner', reason: 'Attempt stale approval.' }),
    error => error.code === 'last_planner_lookahead_stale'
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).some(item => item.id === requested.approval.id), true);
  ledger.resolveApproval(requested.approval.id, { status: 'rejected', resolvedBy: 'owner', reason: 'Crew source changed.' });
  assert.equal(ledger.listLastPlannerWeeklyPlans({ jobId: job.id, status: 'rejected' })[0].id, requested.plan.id);

  const constraint = ledger.createLastPlannerConstraint(job.id, {
    taskId,
    category: 'material',
    title: 'Confirm delivery location',
    description: 'Retain the internal delivery location before a new promise.',
    owner: 'Planner',
    dueDate: WEEK_START,
    evidenceReference: 'material-plan-source',
    entryKey: 'last-planner-autonomy-constraint'
  });
  const actions = ledger.nextActions({ includeLastPlanner: true }).filter(action => action.type === 'review_last_planner_constraint');
  assert.ok(actions.some(action => action.constraintId === constraint.constraint.id));
  const applied = ledger.runAutonomousCycle({
    actionTypes: ['review_last_planner_constraint'],
    jobIds: [job.id],
    actor: 'last-planner-autonomy'
  });
  assert.ok(applied.applied.length >= 1);
  assert.ok(applied.applied.every(item => item.externalCommitments === 0 && item.assignmentsCreated === 0));
  const reviewTask = ledger.getJobDetail(job.id).tasks.find(task => task.data?.constraintId === constraint.constraint.id);
  assert.equal(reviewTask.data.internalOnly, true);
  assert.equal(reviewTask.data.excludeFromWorkPlan, true);
  assert.equal(ledger.runAutonomousCycle({ actionTypes: ['review_last_planner_constraint'], jobIds: [job.id] }).applied.length, 0);
});
