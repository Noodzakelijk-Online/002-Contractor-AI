const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-task-lifecycle-'));
const ownerToken = 'task-owner-token-at-least-32-characters';
const fieldToken = 'task-field-token-at-least-32-characters';
const fieldWorkerId = 'worker_task_field';

Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_AUTH_TOKEN: '',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify({
    owner: ownerToken,
    field_worker: { token: fieldToken, workerId: fieldWorkerId }
  }),
  STATE_FILE: path.join(stateDirectory, 'state.json'),
  LEDGER_DB_FILE: path.join(stateDirectory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(stateDirectory, 'uploads')
});

const app = require('../server');

function authHeaders(token) {
  return { 'Content-Type': 'application/json', 'X-Contractor-AI-Token': token };
}

async function request(baseUrl, route, token, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { ...authHeaders(token), ...(options.headers || {}) }
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test('retained tasks support scoped start, block, completion, and cancellation lifecycles', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const worker = await request(baseUrl, '/api/ledger/workers', ownerToken, {
    method: 'POST',
    body: JSON.stringify({ id: fieldWorkerId, name: 'Task Field Operator', role: 'carpenter', status: 'available' })
  });
  assert.equal(worker.response.status, 201);

  const otherWorker = await request(baseUrl, '/api/ledger/workers', ownerToken, {
    method: 'POST',
    body: JSON.stringify({ id: 'worker_task_other', name: 'Other Crew Member', role: 'electrician', status: 'available' })
  });
  assert.equal(otherWorker.response.status, 201);

  const intake = await request(baseUrl, '/api/ledger/intake', ownerToken, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Scoped task lifecycle job',
      service: 'renovation',
      contractValue: 14500,
      client: { name: 'Task Lifecycle Client', email: 'private-task-client@example.test' }
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const assignment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, ownerToken, {
    method: 'POST',
    body: JSON.stringify({ workerId: fieldWorkerId, status: 'planned' })
  });
  assert.equal(assignment.response.status, 201);

  const assignedTask = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/tasks`, ownerToken, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Install retained task control',
      priority: 'high',
      assigneeId: fieldWorkerId,
      dueAt: '2026-07-20T15:00:00.000Z'
    })
  });
  assert.equal(assignedTask.response.status, 201);

  const foreignTask = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/tasks`, ownerToken, {
    method: 'POST',
    body: JSON.stringify({ title: 'Electrical distribution review', priority: 'medium', assigneeId: otherWorker.body.worker.id })
  });
  assert.equal(foreignTask.response.status, 201);

  const dashboardBefore = await request(baseUrl, '/api/ledger/dashboard', ownerToken);
  const openTasksBefore = dashboardBefore.body.dashboard.workload.openTasks;

  const started = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/task/${encodeURIComponent(assignedTask.body.task.id)}`,
    fieldToken,
    {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'in_progress',
        title: 'Forged replacement title',
        assigneeId: otherWorker.body.worker.id,
        actor: 'role:owner'
      })
    }
  );
  assert.equal(started.response.status, 200);
  assert.equal(started.body.record.status, 'in_progress');
  assert.equal(started.body.record.title, assignedTask.body.task.title);
  assert.equal(started.body.record.assigneeId, fieldWorkerId);
  assert.equal(started.body.job.fieldScoped, true);
  assert.equal('contractValue' in started.body.job, false);
  assert.equal('clientEmail' in started.body.job, false);
  assert.deepEqual(started.body.job.approvals, []);

  const missingEvidence = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/task/${encodeURIComponent(assignedTask.body.task.id)}`,
    fieldToken,
    { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) }
  );
  assert.equal(missingEvidence.response.status, 400);
  assert.equal(missingEvidence.body.error.code, 'task_transition_evidence_required');

  const completed = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/task/${encodeURIComponent(assignedTask.body.task.id)}`,
    fieldToken,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed', notes: 'Installation checked against the retained work package.', evidence: ['field-photo-task-001'] })
    }
  );
  assert.equal(completed.response.status, 200);
  assert.equal(completed.body.record.status, 'completed');
  assert.ok(Date.parse(completed.body.record.completedAt));

  const foreignMutation = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/task/${encodeURIComponent(foreignTask.body.task.id)}`,
    fieldToken,
    { method: 'PATCH', body: JSON.stringify({ status: 'blocked', notes: 'Attempted cross-assignee mutation.' }) }
  );
  assert.equal(foreignMutation.response.status, 403);
  assert.equal(foreignMutation.body.error.code, 'field_task_scope_forbidden');

  const fieldCancellation = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/task/${encodeURIComponent(foreignTask.body.task.id)}`,
    fieldToken,
    { method: 'PATCH', body: JSON.stringify({ status: 'cancelled', notes: 'Not field authority.' }) }
  );
  assert.equal(fieldCancellation.response.status, 403);
  assert.equal(fieldCancellation.body.error.code, 'field_task_transition_forbidden');

  const cancelled = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/task/${encodeURIComponent(foreignTask.body.task.id)}`,
    ownerToken,
    { method: 'PATCH', body: JSON.stringify({ status: 'cancelled', notes: 'Replaced by the approved electrical work package.' }) }
  );
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.body.record.status, 'cancelled');
  assert.equal(cancelled.body.record.completedAt, null);

  const detail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`, ownerToken);
  const retainedTask = detail.body.job.tasks.find(task => task.id === assignedTask.body.task.id);
  assert.equal(retainedTask.data.lifecycleTransition.note, 'Installation checked against the retained work package.');
  assert.deepEqual(retainedTask.data.lifecycleTransition.evidence, ['field-photo-task-001']);
  const taskAudit = detail.body.job.audit.filter(event => event.action === 'transition_task');
  assert.equal(taskAudit.length, 3);
  assert.ok(taskAudit.some(event => event.actor === 'role:field_worker'));

  const dashboardAfter = await request(baseUrl, '/api/ledger/dashboard', ownerToken);
  assert.equal(dashboardAfter.body.dashboard.workload.openTasks, openTasksBefore - 2);
});
