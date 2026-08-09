const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-last-planner-api-'));
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');

const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  return { response, body };
}

test('Last Planner API joins make-ready, approval, daily actuals, PPC, export, and diagnostics', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const weekStart = '2026-10-05';
  const suffix = Date.now();

  const workerResult = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ name: `Last Planner API lead ${suffix}`, role: 'Site lead', status: 'available', hourlyRate: 64 })
  });
  assert.equal(workerResult.response.status, 201);
  const worker = workerResult.body.worker;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: `Last Planner API client ${suffix}`,
      title: `Last Planner API job ${suffix}`,
      status: 'planned',
      scheduledStart: `${weekStart}T08:00:00.000Z`,
      scheduledEnd: '2026-10-18T17:00:00.000Z',
      assignAutomatically: false,
      tasks: [{ title: 'Install API weekly scope', durationHours: 8 }]
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  const taskId = intake.body.job.tasks[0].id;

  const baseline = await request(baseUrl, `/api/ledger/jobs/${jobId}/schedule-baselines`, {
    method: 'POST', body: JSON.stringify({ plannedStart: `${weekStart}T08:00:00.000Z` })
  });
  assert.equal(baseline.response.status, 201);
  assert.equal((await request(baseUrl, `/api/ledger/approvals/${baseline.body.approval.id}/resolve`, {
    method: 'POST', body: JSON.stringify({ status: 'approved', resolvedBy: 'owner', reason: 'Task schedule checked.' })
  })).response.status, 200);

  const assignment = await request(baseUrl, `/api/ledger/jobs/${jobId}/assignments`, {
    method: 'POST',
    body: JSON.stringify({
      workerId: worker.id,
      role: 'Site lead',
      status: 'planned',
      scheduledStart: `${weekStart}T08:00:00.000Z`,
      scheduledEnd: '2026-10-18T17:00:00.000Z',
      allocationHours: 8
    })
  });
  assert.equal(assignment.response.status, 201);

  assert.equal((await request(baseUrl, `/api/ledger/workers/${worker.id}/capacity-profile`, {
    method: 'PUT',
    body: JSON.stringify({
      effectiveFrom: weekStart,
      referenceDate: weekStart,
      timezone: 'Europe/Amsterdam',
      dailyHours: { sunday: 0, monday: 8, tuesday: 8, wednesday: 8, thursday: 8, friday: 8, saturday: 0 }
    })
  })).response.status, 200);
  assert.equal((await request(baseUrl, '/api/ledger/crew-capacity/allocations', {
    method: 'POST',
    body: JSON.stringify({ assignmentId: assignment.body.assignment.id, taskId, workDate: weekStart, plannedHours: 8, referenceDate: weekStart })
  })).response.status, 201);
  const lookahead = await request(baseUrl, '/api/ledger/crew-lookahead/plans', {
    method: 'POST', body: JSON.stringify({ referenceDate: weekStart })
  });
  assert.equal(lookahead.response.status, 201, JSON.stringify(lookahead.body));
  assert.equal((await request(baseUrl, `/api/ledger/approvals/${lookahead.body.approval.id}/resolve`, {
    method: 'POST', body: JSON.stringify({ status: 'approved', resolvedBy: 'owner', reason: 'Crew source checked.' })
  })).response.status, 200);

  const constraint = await request(baseUrl, `/api/ledger/jobs/${jobId}/last-planner/constraints`, {
    method: 'POST',
    body: JSON.stringify({
      taskId,
      category: 'material',
      title: 'Confirm retained API material',
      description: 'Verify the exact retained material before the weekly promise.',
      owner: 'Site lead',
      dueDate: weekStart,
      weekStart,
      evidenceReference: 'api-material-source',
      entryKey: `lp-api-constraint-${suffix}`
    })
  });
  assert.equal(constraint.response.status, 201, JSON.stringify(constraint.body));
  assert.equal(constraint.body.constraint.status, 'open');
  const released = await request(baseUrl, `/api/ledger/jobs/${jobId}/last-planner/constraints/${constraint.body.constraint.id}/release`, {
    method: 'POST',
    body: JSON.stringify({ weekStart, evidenceReference: 'api-material-release-evidence', entryKey: `lp-api-release-${suffix}` })
  });
  assert.equal(released.response.status, 200, JSON.stringify(released.body));
  assert.equal(released.body.constraint.integrityValid, true);

  const plan = await request(baseUrl, `/api/ledger/jobs/${jobId}/last-planner/plans`, {
    method: 'POST',
    body: JSON.stringify({
      weekStart,
      entryKey: `lp-api-plan-${suffix}`,
      commitments: [{
        taskId,
        workDate: weekStart,
        promise: 'Complete and inspect the API weekly scope.',
        promisedBy: worker.name,
        plannedHours: 8
      }]
    })
  });
  assert.equal(plan.response.status, 201, JSON.stringify(plan.body));
  assert.equal(plan.body.plan.status, 'pending_approval');
  const planDecision = await request(baseUrl, `/api/ledger/approvals/${plan.body.approval.id}/resolve`, {
    method: 'POST', body: JSON.stringify({ status: 'approved', resolvedBy: 'owner', reason: 'Weekly promises checked.' })
  });
  assert.equal(planDecision.response.status, 200, JSON.stringify(planDecision.body));

  const huddle = await request(baseUrl, `/api/ledger/jobs/${jobId}/daily-cycles`, {
    method: 'POST',
    body: JSON.stringify({
      entryKey: `lp-api-huddle-${suffix}`,
      workDate: weekStart,
      facilitator: worker.name,
      leadWorkerId: worker.id,
      workerIds: [worker.id],
      plannedWork: 'Complete the retained API weekly promise.',
      productionTarget: 'Complete and inspect the weekly scope.',
      safetyFocus: 'Apply the retained task controls and keep access clear.',
      evidenceReference: 'api-huddle-evidence'
    })
  });
  assert.equal(huddle.response.status, 201, JSON.stringify(huddle.body));
  const ended = await request(baseUrl, `/api/ledger/jobs/${jobId}/daily-cycles/${huddle.body.cycle.id}/end-of-day`, {
    method: 'POST',
    body: JSON.stringify({
      entryKey: `lp-api-eod-${suffix}`,
      workerId: worker.id,
      hours: 8,
      manpower: 1,
      weather: 'clear',
      workCompleted: 'Completed and inspected the retained API weekly scope.',
      safetyConcern: false,
      planAchieved: true,
      tomorrowPlan: 'Continue with the next approved activity.',
      evidenceReferences: ['api-daily-progress-evidence']
    })
  });
  assert.equal(ended.response.status, 201, JSON.stringify(ended.body));
  assert.equal((await request(baseUrl, `/api/ledger/approvals/${ended.body.dailyLog.fieldReport.approvalId}/resolve`, {
    method: 'POST', body: JSON.stringify({ status: 'approved', resolvedBy: 'owner', reason: 'Daily evidence checked.' })
  })).response.status, 200);

  const approvedPlans = await request(baseUrl, `/api/ledger/last-planner/plans?jobId=${jobId}&weekStart=${weekStart}&status=approved`);
  assert.equal(approvedPlans.response.status, 200);
  const commitment = approvedPlans.body.plans[0].commitments[0];
  const outcome = await request(baseUrl, `/api/ledger/jobs/${jobId}/last-planner/plans/${plan.body.plan.id}/commitments/${commitment.id}/outcome`, {
    method: 'POST',
    body: JSON.stringify({
      weekStart,
      result: 'completed',
      evidenceReferences: ['api-weekly-completion-evidence'],
      dailyCycleIds: [huddle.body.cycle.id],
      entryKey: `lp-api-outcome-${suffix}`
    })
  });
  assert.equal(outcome.response.status, 201, JSON.stringify(outcome.body));
  assert.equal(outcome.body.board.summary.ppcPercent, 100);

  const board = await request(baseUrl, `/api/ledger/last-planner?jobId=${jobId}&weekStart=${weekStart}`);
  assert.equal(board.response.status, 200);
  assert.equal(board.body.board.summary.completedPromises, 1);
  assert.equal(board.body.board.safeguards.externalCommitments, 0);
  const capabilities = await request(baseUrl, '/api/operations/capabilities');
  assert.equal(capabilities.body.capabilities.lastPlannerLite.actualEvidence, 'closed_daily_operating_cycle_required');
  assert.equal(capabilities.body.capabilities.lastPlannerLite.externalCommitments, 0);
  assert.equal(capabilities.body.capabilities.requestSafety.lastPlannerCommitmentInference, false);
  const operationalExport = await request(baseUrl, '/api/operations/export');
  assert.equal(operationalExport.body.lastPlannerConstraints.length, 1);
  assert.equal(operationalExport.body.lastPlannerWeeklyPlans.length, 1);
  assert.equal(operationalExport.body.lastPlannerOutcomes.length, 1);
  const diagnostics = await request(baseUrl, '/api/ledger/debug');
  assert.equal(diagnostics.body.diagnostics.valid, true, JSON.stringify(diagnostics.body.diagnostics.issues));
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '069_governed_framework_workspace');
  assert.equal(diagnostics.body.diagnostics.counts.lastPlannerWeeklyPlans, 1);
});
