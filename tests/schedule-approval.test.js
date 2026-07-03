const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-schedule-'));
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');

const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  return { response, body };
}

test('schedule approval commits the proposed window only after approval', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const plannedStart = '2026-07-06T08:00:00.000Z';
  const plannedEnd = '2026-07-06T16:00:00.000Z';

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Schedule approval regression job',
      service: 'Garden renovation',
      client: {
        name: 'Schedule Client BV',
        email: 'schedule@example.test',
        phone: '+31611111111',
        address: 'Nieuwezijds Voorburgwal 1, Amsterdam',
        country: 'NL'
      },
      address: 'Nieuwezijds Voorburgwal 1, Amsterdam',
      city: 'Amsterdam',
      priority: 'high',
      estimatedHours: 8,
      tools: ['Hedge trimmer', 'Trailer'],
      materials: [{ name: 'Border edging', quantity: 10, unit: 'm', supplier: 'Bouwmaat' }]
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  assert.ok(jobId);
  assert.notEqual(intake.body.job.scheduledStart, plannedStart);

  const recommendation = await request(baseUrl, '/api/schedule/recommend', {
    method: 'POST',
    body: JSON.stringify({ jobId, plannedStart, plannedEnd })
  });
  assert.equal(recommendation.response.status, 200);
  assert.equal(recommendation.body.recommendation.plannedStart, plannedStart);
  assert.equal(recommendation.body.recommendation.plannedEnd, plannedEnd);
  assert.ok(recommendation.body.recommendation.nextActions.some(action => action.type === 'request_schedule_approval'));

  const approvalRequest = await request(baseUrl, '/api/schedule/request-approval', {
    method: 'POST',
    body: JSON.stringify({ jobId, plannedStart, plannedEnd })
  });
  assert.equal(approvalRequest.response.status, 201);
  assert.equal(approvalRequest.body.status, 'approval_requested');
  assert.equal(approvalRequest.body.approval.targetType, 'schedule_commitment');
  assert.equal(approvalRequest.body.approval.approvalType, 'schedule_commitment');
  assert.equal(approvalRequest.body.approval.status, 'pending');
  assert.equal(approvalRequest.body.proposedPatch.scheduledStart, plannedStart);
  assert.equal(approvalRequest.body.proposedPatch.scheduledEnd, plannedEnd);
  assert.notEqual(approvalRequest.body.job.scheduledStart, plannedStart);
  assert.ok(approvalRequest.body.job.audit.some(event => event.action === 'request_schedule_approval'));

  const duplicateRequest = await request(baseUrl, '/api/schedule/request-approval', {
    method: 'POST',
    body: JSON.stringify({ jobId, plannedStart, plannedEnd })
  });
  assert.equal(duplicateRequest.response.status, 201);
  assert.equal(duplicateRequest.body.status, 'existing');
  assert.equal(duplicateRequest.body.approval.id, approvalRequest.body.approval.id);

  const detailBeforeResolve = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(detailBeforeResolve.response.status, 200);
  assert.notEqual(detailBeforeResolve.body.job.scheduledStart, plannedStart);

  const resolved = await request(baseUrl, `/api/approvals/${approvalRequest.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Schedule Test', reason: 'Schedule window reviewed.' })
  });
  assert.equal(resolved.response.status, 200);
  assert.equal(resolved.body.approval.status, 'approved');

  const detailAfterResolve = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(detailAfterResolve.response.status, 200);
  assert.equal(detailAfterResolve.body.job.scheduledStart, plannedStart);
  assert.equal(detailAfterResolve.body.job.scheduledEnd, plannedEnd);
  assert.equal(detailAfterResolve.body.job.status, 'scheduled');
  assert.equal(detailAfterResolve.body.job.phase, 'scheduled');
  assert.equal(detailAfterResolve.body.job.approvalState, 'schedule_approved');
  assert.ok(detailAfterResolve.body.job.audit.some(event => event.action === 'apply_schedule_commitment'));
});

test('schedule approval creates the recommended worker assignment when the job has no crew', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const plannedStart = '2026-07-07T07:30:00.000Z';
  const plannedEnd = '2026-07-07T13:30:00.000Z';

  const worker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Recommended Garden Lead',
      role: 'Garden lead',
      status: 'available',
      homeRegion: 'Amsterdam',
      hourlyRate: 42,
      skills: ['garden maintenance', 'hedge trimming', 'green waste']
    })
  });
  assert.equal(worker.response.status, 201);

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Crewless garden schedule job',
      service: 'garden maintenance',
      assignAutomatically: false,
      client: {
        name: 'Crewless Client',
        email: 'crewless@example.test',
        phone: '+31622222222',
        address: 'Prinsengracht 1, Amsterdam',
        country: 'NL'
      },
      address: 'Prinsengracht 1, Amsterdam',
      city: 'Amsterdam',
      priority: 'medium',
      estimatedHours: 6,
      tools: ['Hedge trimmer'],
      materials: [{ name: 'Green waste bags', quantity: 8, unit: 'bags' }]
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  assert.equal(intake.body.job.assignments.length, 0);

  const approvalRequest = await request(baseUrl, '/api/schedule/request-approval', {
    method: 'POST',
    body: JSON.stringify({ jobId, plannedStart, plannedEnd })
  });
  assert.equal(approvalRequest.response.status, 201);
  assert.ok(approvalRequest.body.proposedAssignment.workerId);
  assert.equal(approvalRequest.body.proposedAssignment.workerId, approvalRequest.body.recommendation.recommendedWorker.id);
  assert.equal(approvalRequest.body.proposedAssignment.workerName, approvalRequest.body.recommendation.recommendedWorker.name);
  assert.equal(approvalRequest.body.proposedAssignment.scheduledStart, plannedStart);
  assert.equal(approvalRequest.body.job.assignments.length, 0);

  const resolved = await request(baseUrl, `/api/approvals/${approvalRequest.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Schedule Test', reason: 'Schedule and crew reviewed.' })
  });
  assert.equal(resolved.response.status, 200);

  const detail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.job.scheduledStart, plannedStart);
  assert.equal(detail.body.job.scheduledEnd, plannedEnd);
  assert.equal(detail.body.job.assignments.length, 1);
  assert.equal(detail.body.job.assignments[0].workerId, approvalRequest.body.proposedAssignment.workerId);
  assert.equal(detail.body.job.assignments[0].workerName, approvalRequest.body.proposedAssignment.workerName);
  assert.equal(detail.body.job.assignments[0].status, 'planned');
  assert.equal(detail.body.job.assignments[0].scheduledStart, plannedStart);
  assert.ok(detail.body.job.audit.some(event => event.action === 'create_assignment'));
  assert.ok(detail.body.job.audit.some(event =>
    event.action === 'apply_schedule_commitment'
    && event.metadata?.assignmentId === detail.body.job.assignments[0].id
  ));
});
