const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-workforce-'));
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

async function createJob(baseUrl, payload) {
  const result = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: payload.clientName || 'Crew QA Client',
      clientEmail: payload.clientEmail || 'crew@example.test',
      clientPhone: payload.clientPhone || '+31 6 22222222',
      address: payload.address || 'Prinsengracht 20, Amsterdam',
      city: payload.city || 'Amsterdam',
      service: payload.service || 'renovation',
      title: payload.title,
      description: payload.description || payload.title,
      priority: payload.priority || 'medium',
      estimatedCost: payload.estimatedCost || 1400,
      contractValue: payload.contractValue || payload.estimatedCost || 1400,
      estimatedHours: payload.estimatedHours || 6,
      assignAutomatically: false,
      ...payload
    })
  });
  assert.equal(result.response.status, 201);
  return result.body.job.id;
}

test('workforce readiness coordinates crew assignment, instruction, access and time gaps', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setUTCHours(8, 0, 0, 0);
  const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const workerResult = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Crew QA Lead',
      role: 'Lead contractor',
      status: 'available',
      hourlyRate: 72,
      skills: ['renovation', 'site access']
    })
  });
  assert.equal(workerResult.response.status, 201);
  const workerId = workerResult.body.worker.id;

  const unassignedJobId = await createJob(baseUrl, {
    title: 'Crew queue needs assignment',
    status: 'scheduled',
    scheduledStart: startIso,
    scheduledEnd: endIso
  });

  const assignmentQueue = await request(baseUrl, '/api/ledger/workforce?mode=assignment&limit=100');
  assert.equal(assignmentQueue.response.status, 200);
  const unassignedJob = assignmentQueue.body.jobs.find(job => job.jobId === unassignedJobId);
  assert.ok(unassignedJob);
  assert.equal(unassignedJob.flags.needsAssignment, true);
  assert.ok(unassignedJob.nextActions.some(action => action.type === 'assign_worker'));
  assert.ok(assignmentQueue.body.summary.needsAssignment >= 1);

  const assignedJobId = await createJob(baseUrl, {
    title: 'Crew queue needs instructions and access',
    status: 'scheduled',
    scheduledStart: startIso,
    scheduledEnd: endIso,
    priority: 'high'
  });
  const assignment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(assignedJobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({
      workerId,
      status: 'scheduled',
      scheduledStart: startIso,
      scheduledEnd: endIso,
      allocationHours: 4,
      role: 'Lead contractor'
    })
  });
  assert.equal(assignment.response.status, 201);
  assert.equal(assignment.body.assignment.status, 'scheduled');

  const instructionQueue = await request(baseUrl, '/api/ledger/workforce?mode=instruction&limit=100');
  assert.equal(instructionQueue.response.status, 200);
  const instructionJob = instructionQueue.body.jobs.find(job => job.jobId === assignedJobId);
  assert.ok(instructionJob);
  assert.equal(instructionJob.flags.needsInstruction, true);
  assert.ok(instructionJob.nextActions.some(action => action.type === 'draft_worker_instruction'));

  const orientation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(assignedJobId)}/orientations`, {
    method: 'POST',
    body: JSON.stringify({
      workerName: 'Crew QA Lead',
      company: 'Internal crew',
      status: 'scheduled',
      dueAt: yesterday,
      topics: ['Site access', 'PPE', 'Stop-work triggers']
    })
  });
  assert.equal(orientation.response.status, 201);

  const accessQueue = await request(baseUrl, '/api/ledger/workforce?mode=access&limit=100');
  assert.equal(accessQueue.response.status, 200);
  const accessJob = accessQueue.body.jobs.find(job => job.jobId === assignedJobId);
  assert.ok(accessJob);
  assert.equal(accessJob.flags.siteAccess, true);
  assert.equal(accessJob.counts.dueOrientations, 1);
  assert.ok(accessJob.nextActions.some(action => action.type === 'complete_worker_orientation'));

  const conflictJobId = await createJob(baseUrl, {
    title: 'Crew queue conflict job',
    status: 'scheduled',
    scheduledStart: startIso,
    scheduledEnd: endIso,
    priority: 'critical'
  });
  const conflictAssignment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(conflictJobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({
      workerId,
      status: 'scheduled',
      scheduledStart: startIso,
      scheduledEnd: endIso,
      allocationHours: 4,
      role: 'Lead contractor'
    })
  });
  assert.equal(conflictAssignment.response.status, 201);
  assert.equal(conflictAssignment.body.assignment.status, 'pending_approval');
  assert.ok(conflictAssignment.body.assignment.approvalId);

  const conflictQueue = await request(baseUrl, '/api/ledger/workforce?mode=conflict&limit=100');
  assert.equal(conflictQueue.response.status, 200);
  const conflictJob = conflictQueue.body.jobs.find(job => job.jobId === conflictJobId);
  assert.ok(conflictJob);
  assert.equal(conflictJob.flags.workerConflict, true);
  assert.equal(conflictJob.flags.approvalRequired, true);
  assert.ok(conflictJob.nextActions.some(action => action.type === 'resolve_worker_conflict'));
  assert.ok(conflictQueue.body.summary.workerConflicts >= 1);

  const timeJobId = await createJob(baseUrl, {
    title: 'Crew queue missing time',
    status: 'completed',
    progressPercent: 100,
    scheduledStart: startIso,
    scheduledEnd: endIso
  });
  const timeQueue = await request(baseUrl, '/api/ledger/workforce?mode=time&limit=100');
  assert.equal(timeQueue.response.status, 200);
  const timeJob = timeQueue.body.jobs.find(job => job.jobId === timeJobId);
  assert.ok(timeJob);
  assert.equal(timeJob.flags.timeMissing, true);
  assert.ok(timeJob.nextActions.some(action => action.type === 'record_time_log'));

  const timeLog = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(timeJobId)}/time-logs`, {
    method: 'POST',
    body: JSON.stringify({
      workerId,
      workDate: new Date().toISOString().slice(0, 10),
      hours: 3.5,
      billable: true,
      rate: 72,
      status: 'submitted',
      costCode: 'labor',
      notes: 'Crew QA recorded time.'
    })
  });
  assert.equal(timeLog.response.status, 201);
  assert.equal(timeLog.body.timeLog.hours, 3.5);

  const clearedTimeQueue = await request(baseUrl, '/api/ledger/workforce?mode=time&limit=100');
  assert.equal(clearedTimeQueue.response.status, 200);
  assert.equal(clearedTimeQueue.body.jobs.some(job => job.jobId === timeJobId), false);
});
