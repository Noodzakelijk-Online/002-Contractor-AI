const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-open-loops-'));
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

async function createJob(baseUrl, payload = {}) {
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Autonomous open-loop QA job',
      service: 'Renovation',
      client: {
        name: 'Open Loop Client',
        email: 'open-loop@example.test',
        phone: '+31600000001',
        address: 'Prinsengracht 22, Amsterdam',
        country: 'NL'
      },
      address: 'Prinsengracht 22, Amsterdam',
      city: 'Amsterdam',
      priority: 'high',
      riskLevel: 'high',
      estimatedCost: 1800,
      estimatedHours: 18,
      tasks: ['Prepare site', 'Confirm safe access'],
      ...payload
    })
  });
  assert.equal(intake.response.status, 201);
  return intake.body.job.id;
}

function byTypeAndId(actions, type, idKey, idValue) {
  return actions.find(action => action.type === type && action[idKey] === idValue);
}

test('autonomous cycle converts open field loops into approval-safe internal work', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const overdue = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const jobId = await createJob(baseUrl);

  const permit = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/permits`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Temporary scaffolding permit',
      permitType: 'site_access',
      status: 'active',
      expiresAt: tomorrow,
      requiresApproval: false
    })
  });
  assert.equal(permit.response.status, 201);

  const observation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/observations`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Loose stair tread',
      category: 'safety',
      status: 'open',
      severity: 'high',
      dueAt: tomorrow,
      correctiveAction: 'Secure before work continues'
    })
  });
  assert.equal(observation.response.status, 201);

  const incident = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/incidents`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Near miss on access stair',
      incidentType: 'near_miss',
      status: 'reported',
      severity: 'high',
      description: 'Worker slipped near stair access.'
    })
  });
  assert.equal(incident.response.status, 201);

  const safetyCheck = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/safety-checks`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Open access control review',
      status: 'open',
      riskLevel: 'high',
      dueAt: tomorrow,
      notes: 'Confirm barriers and access controls.'
    })
  });
  assert.equal(safetyCheck.response.status, 201);

  const aftercare = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/aftercare`, {
    method: 'POST',
    body: JSON.stringify({
      title: '30 day aftercare call',
      status: 'open',
      dueAt: overdue,
      notes: 'Check client satisfaction and warranty issues.'
    })
  });
  assert.equal(aftercare.response.status, 201);

  const recurringPlan = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/recurring-plans`, {
    method: 'POST',
    body: JSON.stringify({
      service: 'Quarterly garden check',
      status: 'active',
      intervalRule: 'quarterly',
      nextDueAt: yesterday,
      notes: 'Recurring service due.'
    })
  });
  assert.equal(recurringPlan.response.status, 201);

  const dryRun = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, actor: 'open-loop-test' })
  });
  assert.equal(dryRun.response.status, 200);
  assert.ok(byTypeAndId(dryRun.body.preview, 'renew_permit', 'permitId', permit.body.permit.id));
  assert.ok(byTypeAndId(dryRun.body.preview, 'resolve_observation', 'observationId', observation.body.observation.id));
  assert.ok(byTypeAndId(dryRun.body.preview, 'review_incident', 'incidentId', incident.body.incident.id));
  assert.ok(byTypeAndId(dryRun.body.preview, 'safety_review', 'safetyCheckId', safetyCheck.body.safetyCheck.id));
  assert.ok(byTypeAndId(dryRun.body.preview, 'aftercare_follow_up', 'aftercareId', aftercare.body.aftercare.id));
  assert.ok(byTypeAndId(dryRun.body.preview, 'recurring_job_due', 'recurringPlanId', recurringPlan.body.recurringPlan.id));

  const cycle = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: false, actor: 'open-loop-test' })
  });
  assert.equal(cycle.response.status, 200);

  const permitAction = byTypeAndId(cycle.body.applied, 'renew_permit', 'permitId', permit.body.permit.id);
  const observationAction = byTypeAndId(cycle.body.applied, 'resolve_observation', 'observationId', observation.body.observation.id);
  const incidentAction = byTypeAndId(cycle.body.applied, 'review_incident', 'incidentId', incident.body.incident.id);
  const safetyAction = byTypeAndId(cycle.body.applied, 'safety_review', 'safetyCheckId', safetyCheck.body.safetyCheck.id);
  const aftercareAction = byTypeAndId(cycle.body.applied, 'aftercare_follow_up', 'aftercareId', aftercare.body.aftercare.id);
  const recurringAction = byTypeAndId(cycle.body.applied, 'recurring_job_due', 'recurringPlanId', recurringPlan.body.recurringPlan.id);

  for (const action of [permitAction, observationAction, incidentAction, safetyAction]) {
    assert.ok(action);
    assert.equal(action.status, 'task_created');
    assert.ok(action.taskId);
  }
  assert.ok(aftercareAction);
  assert.equal(aftercareAction.status, 'drafted');
  assert.ok(aftercareAction.communicationId);
  assert.ok(aftercareAction.approvalId);
  assert.ok(recurringAction);
  assert.equal(recurringAction.status, 'prepared');
  assert.ok(recurringAction.recurringJobId);
  assert.ok(recurringAction.nextDueAt);
  assert.ok(recurringAction.taskId);
  assert.ok(recurringAction.communicationId);
  assert.ok(recurringAction.approvalId);

  const detail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(detail.response.status, 200);
  const taskIds = new Set(detail.body.job.tasks.map(task => task.id));
  for (const taskId of [permitAction.taskId, observationAction.taskId, incidentAction.taskId, safetyAction.taskId, recurringAction.taskId]) {
    assert.ok(taskIds.has(taskId));
  }

  const aftercareDraft = detail.body.job.communications.find(item => item.id === aftercareAction.communicationId);
  assert.ok(aftercareDraft);
  assert.equal(aftercareDraft.status, 'draft');
  assert.equal(aftercareDraft.direction, 'outbound');
  assert.equal(aftercareDraft.data.aftercareId, aftercare.body.aftercare.id);
  assert.equal(aftercareDraft.data.followUpSource, 'aftercare_monitor');
  assert.ok(aftercareDraft.approvalId);

  const recurringDraft = detail.body.job.communications.find(item => item.id === recurringAction.communicationId);
  assert.ok(recurringDraft);
  assert.equal(recurringDraft.status, 'draft');
  assert.equal(recurringDraft.direction, 'outbound');
  assert.equal(recurringDraft.data.recurringPlanId, recurringPlan.body.recurringPlan.id);
  assert.equal(recurringDraft.data.followUpSource, 'recurring_plan_monitor');
  assert.equal(recurringDraft.data.expectsReply, true);
  assert.ok(recurringDraft.data.replyBy);
  assert.ok(recurringDraft.approvalId);

  const updatedRecurringPlan = detail.body.job.recurringPlans.find(item => item.id === recurringPlan.body.recurringPlan.id);
  assert.ok(updatedRecurringPlan);
  assert.equal(updatedRecurringPlan.lastCreatedJobId, recurringAction.recurringJobId);
  assert.equal(updatedRecurringPlan.nextDueAt, recurringAction.nextDueAt);
  assert.ok(new Date(updatedRecurringPlan.nextDueAt) > new Date(recurringPlan.body.recurringPlan.nextDueAt));

  const recurringJobDetail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(recurringAction.recurringJobId)}`);
  assert.equal(recurringJobDetail.response.status, 200);
  assert.equal(recurringJobDetail.body.job.status, 'intake');
  assert.equal(recurringJobDetail.body.job.jobType, 'Quarterly garden check');
  assert.equal(recurringJobDetail.body.job.client.name, 'Open Loop Client');
  assert.ok(recurringJobDetail.body.job.tasks.some(task => /Confirm recurring/i.test(task.title)));
  assert.ok(recurringJobDetail.body.job.communications.some(item =>
    item.status === 'draft'
    && item.approvalId
    && /waiting for approval/i.test(item.body)
  ));
  assert.ok(recurringJobDetail.body.job.audit.some(event => event.action === 'create_recurring_service_job'));
  assert.ok(recurringJobDetail.body.job.audit.some(event => event.action === 'autonomous_prepare_recurring_service_job'));

  for (const action of [
    'autonomous_create_permit_renewal_task',
    'autonomous_create_observation_followup_task',
    'autonomous_create_incident_review_task',
    'autonomous_create_safety_review_task',
    'autonomous_draft_aftercare_followup',
    'prepare_recurring_service_job',
    'autonomous_create_recurring_service_task',
    'autonomous_draft_recurring_service_confirmation'
  ]) {
    assert.ok(detail.body.job.audit.some(event => event.action === action), `missing audit action ${action}`);
  }

  const approvals = await request(baseUrl, '/api/approvals?status=pending&limit=100');
  assert.equal(approvals.response.status, 200);
  for (const approvalId of [aftercareAction.approvalId, recurringAction.approvalId]) {
    assert.ok(approvals.body.approvals.some(approval =>
      approval.id === approvalId
      && approval.targetType === 'communication'
      && approval.approvalType === 'external_communication'
    ));
  }

  const secondDryRun = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, actor: 'open-loop-test' })
  });
  assert.equal(secondDryRun.response.status, 200);
  assert.equal(secondDryRun.body.preview.some(action =>
    action.type === 'recurring_job_due'
    && action.recurringPlanId === recurringPlan.body.recurringPlan.id
  ), false);
});
