const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-portfolio-schedule-'));
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

async function createJob(baseUrl, title, schedule = {}) {
  const result = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title,
      client: { name: 'Portfolio Schedule Client' },
      status: 'scheduled',
      assignAutomatically: false,
      ...schedule
    })
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  return result.body.job;
}

test('portfolio schedule isolates planning risk and revalidates cross-job conflicts', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const worker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Portfolio Schedule Crew',
      role: 'Lead contractor',
      status: 'available',
      skills: ['general contracting']
    })
  });
  assert.equal(worker.response.status, 201, JSON.stringify(worker.body));

  const baselineJob = await createJob(baseUrl, 'Portfolio baseline job', {
    scheduledStart: '2026-08-03T08:00:00.000Z',
    scheduledEnd: '2026-08-03T16:00:00.000Z',
    priority: 'high'
  });
  const firstTask = await request(baseUrl, `/api/ledger/jobs/${baselineJob.id}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Complete retained portfolio work', durationHours: 8, priority: 'high' })
  });
  assert.equal(firstTask.response.status, 201, JSON.stringify(firstTask.body));
  const baseline = await request(baseUrl, `/api/ledger/jobs/${baselineJob.id}/schedule-baselines`, {
    method: 'POST',
    body: JSON.stringify({ plannedStart: '2026-08-03T08:00:00.000Z' })
  });
  assert.equal(baseline.response.status, 201, JSON.stringify(baseline.body));
  const approvedBaseline = await request(baseUrl, `/api/ledger/approvals/${baseline.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      resolvedBy: 'Portfolio schedule test',
      reason: 'Task sequence and internal planning window verified.'
    })
  });
  assert.equal(approvedBaseline.response.status, 200, JSON.stringify(approvedBaseline.body));

  const firstAssignment = await request(baseUrl, `/api/ledger/jobs/${baselineJob.id}/assignments`, {
    method: 'POST',
    body: JSON.stringify({
      workerId: worker.body.worker.id,
      status: 'scheduled',
      scheduledStart: '2026-08-03T08:00:00.000Z',
      scheduledEnd: '2026-08-03T16:00:00.000Z'
    })
  });
  assert.equal(firstAssignment.response.status, 201, JSON.stringify(firstAssignment.body));

  const conflictJob = await createJob(baseUrl, 'Portfolio conflict job', {
    scheduledStart: '2026-08-03T10:00:00.000Z',
    scheduledEnd: '2026-08-03T18:00:00.000Z',
    priority: 'critical'
  });
  const conflictAssignment = await request(baseUrl, `/api/ledger/jobs/${conflictJob.id}/assignments`, {
    method: 'POST',
    body: JSON.stringify({
      workerId: worker.body.worker.id,
      status: 'scheduled',
      scheduledStart: '2026-08-03T10:00:00.000Z',
      scheduledEnd: '2026-08-03T18:00:00.000Z'
    })
  });
  assert.equal(conflictAssignment.response.status, 201, JSON.stringify(conflictAssignment.body));
  assert.equal(conflictAssignment.body.assignment.status, 'pending_approval');

  const unscheduledJob = await createJob(baseUrl, 'Portfolio unscheduled job', {
    status: 'intake',
    scheduledStart: null,
    scheduledEnd: null
  });

  const portfolio = await request(
    baseUrl,
    '/api/ledger/schedule?referenceAt=2026-08-03T07%3A00%3A00.000Z&horizonDays=14&limit=100'
  );
  assert.equal(portfolio.response.status, 200, JSON.stringify(portfolio.body));
  assert.equal(portfolio.body.window.horizonDays, 14);
  assert.ok(portfolio.body.jobs.some(job => job.jobId === baselineJob.id && job.baseline.status === 'approved'));
  const conflicted = portfolio.body.jobs.find(job => job.jobId === conflictJob.id);
  assert.equal(conflicted.scheduleStatus, 'conflict');
  assert.equal(conflicted.flags.conflict, true);
  assert.ok(conflicted.counts.workerConflicts >= 1);
  assert.ok(portfolio.body.summary.conflicts >= 1);
  const unscheduled = portfolio.body.jobs.find(job => job.jobId === unscheduledJob.id);
  assert.equal(unscheduled.scheduleStatus, 'unscheduled');
  assert.equal(unscheduled.flags.unscheduled, true);

  const conflictOnly = await request(
    baseUrl,
    '/api/ledger/schedule?mode=conflict&referenceAt=2026-08-03T07%3A00%3A00.000Z&horizonDays=14&limit=100'
  );
  assert.equal(conflictOnly.response.status, 200);
  assert.ok(conflictOnly.body.jobs.length >= 1);
  assert.ok(conflictOnly.body.jobs.every(job => job.flags.conflict));

  const overdue = await request(
    baseUrl,
    '/api/ledger/schedule?mode=overdue&referenceAt=2026-08-04T08%3A00%3A00.000Z&horizonDays=14&limit=100'
  );
  assert.equal(overdue.response.status, 200);
  const overdueBaseline = overdue.body.jobs.find(job => job.jobId === baselineJob.id);
  assert.ok(overdueBaseline);
  assert.ok(overdueBaseline.counts.overdueTasks >= 1);
  assert.equal(overdueBaseline.tasks.find(task => task.id === firstTask.body.task.id).overdue, true);

  const searched = await request(
    baseUrl,
    '/api/ledger/schedule?search=Portfolio%20baseline&referenceAt=2026-08-03T07%3A00%3A00.000Z&horizonDays=14'
  );
  assert.deepEqual(searched.body.jobs.map(job => job.jobId), [baselineJob.id]);
  assert.equal(searched.body.summary.matching, 1);

  const invalidReference = await request(baseUrl, '/api/ledger/schedule?referenceAt=not-a-date');
  assert.equal(invalidReference.response.status, 400);
  assert.equal(invalidReference.body.error.code, 'portfolio_schedule_reference_invalid');

  const audit = await request(baseUrl, `/api/ledger/audit?jobId=${baselineJob.id}&limit=100`);
  assert.equal(audit.body.events.some(event => event.action === 'recommend_schedule' && event.actor === 'portfolio_schedule'), false);
});
