const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-crew-capacity-api-'));
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

test('crew-capacity API governs profiles, allocations, approval, export, and readiness', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const windowStart = '2026-09-07';
  const windowEnd = '2026-09-20';
  const suffix = Date.now();

  const workerResult = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ name: `Crew API worker ${suffix}`, role: 'Installer', status: 'available' })
  });
  assert.equal(workerResult.response.status, 201);
  const workerId = workerResult.body.worker.id;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: `Crew API client ${suffix}`,
      title: `Crew API plan ${suffix}`,
      status: 'planned',
      scheduledStart: `${windowStart}T08:00:00.000Z`,
      scheduledEnd: `${windowEnd}T17:00:00.000Z`,
      assignAutomatically: false,
      tasks: [{ title: 'Install API scope', durationHours: 8 }]
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  const taskId = intake.body.job.tasks[0].id;

  const baseline = await request(baseUrl, `/api/ledger/jobs/${jobId}/schedule-baselines`, {
    method: 'POST',
    body: JSON.stringify({ plannedStart: `${windowStart}T08:00:00.000Z` })
  });
  assert.equal(baseline.response.status, 201);
  const baselineApproval = await request(baseUrl, `/api/ledger/approvals/${baseline.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'crew-api-owner', reason: 'Schedule checked.' })
  });
  assert.equal(baselineApproval.response.status, 200);

  const assignment = await request(baseUrl, `/api/ledger/jobs/${jobId}/assignments`, {
    method: 'POST',
    body: JSON.stringify({
      workerId,
      role: 'Installer',
      status: 'planned',
      scheduledStart: `${windowStart}T08:00:00.000Z`,
      scheduledEnd: `${windowEnd}T17:00:00.000Z`,
      allocationHours: 8
    })
  });
  assert.equal(assignment.response.status, 201);
  assert.equal(assignment.body.assignment.status, 'planned');

  const profile = await request(baseUrl, `/api/ledger/workers/${workerId}/capacity-profile`, {
    method: 'PUT',
    body: JSON.stringify({
      effectiveFrom: windowStart,
      referenceDate: windowStart,
      timezone: 'Europe/Amsterdam',
      dailyHours: { sunday: 0, monday: 8, tuesday: 8, wednesday: 8, thursday: 8, friday: 8, saturday: 0 }
    })
  });
  assert.equal(profile.response.status, 200, JSON.stringify(profile.body));
  assert.equal(profile.body.profile.integrityValid, true);

  const allocation = await request(baseUrl, '/api/ledger/crew-capacity/allocations', {
    method: 'POST',
    body: JSON.stringify({
      assignmentId: assignment.body.assignment.id,
      taskId,
      workDate: windowStart,
      referenceDate: windowStart,
      plannedHours: 8
    })
  });
  assert.equal(allocation.response.status, 201, JSON.stringify(allocation.body));
  assert.equal(allocation.body.board.ready, true, JSON.stringify(allocation.body.board.blockers));

  const requested = await request(baseUrl, '/api/ledger/crew-lookahead/plans', {
    method: 'POST',
    body: JSON.stringify({ referenceDate: windowStart, reason: 'API plan verified for approval.' })
  });
  assert.equal(requested.response.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.plan.status, 'pending_approval');
  const decision = await request(baseUrl, `/api/ledger/approvals/${requested.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'crew-api-owner', reason: 'Exact plan checked.' })
  });
  assert.equal(decision.response.status, 200, JSON.stringify(decision.body));

  const board = await request(baseUrl, `/api/ledger/crew-capacity?referenceDate=${windowStart}`);
  assert.equal(board.response.status, 200);
  assert.equal(board.body.board.plans.current, true);
  assert.equal(board.body.board.safeguards.crewNotifications, 0);
  const plans = await request(baseUrl, '/api/ledger/crew-lookahead/plans');
  assert.equal(plans.response.status, 200);
  assert.equal(plans.body.plans[0].status, 'approved');

  const capabilities = await request(baseUrl, '/api/operations/capabilities');
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.body.capabilities.crewCapacityPlanning.horizonDays, 14);
  assert.equal(capabilities.body.capabilities.crewCapacityPlanning.autonomy, 'internal_review_task_only');
  assert.equal(capabilities.body.capabilities.crewCapacityPlanning.externalCommitments, 0);
  const operationalExport = await request(baseUrl, '/api/operations/export');
  assert.equal(operationalExport.response.status, 200);
  assert.equal(operationalExport.body.crewCapacityProfiles.length, 1);
  assert.equal(operationalExport.body.crewCapacityAllocations.length, 1);
  assert.equal(operationalExport.body.crewLookaheadPlans.length, 1);
  const diagnostics = await request(baseUrl, '/api/ledger/debug');
  assert.equal(diagnostics.body.diagnostics.valid, true, JSON.stringify(diagnostics.body.diagnostics.issues));
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '067_governed_energy_performance');
  assert.equal(diagnostics.body.diagnostics.counts.crewCapacityProfiles, 1);
  assert.equal(diagnostics.body.diagnostics.counts.crewCapacityAllocations, 1);
  assert.equal(diagnostics.body.diagnostics.counts.crewLookaheadPlans, 1);
});
