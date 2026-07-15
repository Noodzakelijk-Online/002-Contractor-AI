const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-meeting-api-'));
const tokens = {
  owner: 'meeting-api-owner-token-at-least-32-characters',
  approver: 'meeting-api-approver-token-at-least-32-characters',
  office_operator: 'meeting-api-office-token-at-least-32-characters',
  field_worker: { token: 'meeting-api-field-token-at-least-32-characters', jobIds: ['unassigned'] }
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify(tokens),
  STATE_FILE: path.join(directory, 'state.json'),
  LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(directory, 'uploads')
});
delete process.env.CONTRACTOR_AI_AUTH_TOKEN;
delete process.env.DASHBOARD_AUTH_TOKEN;

const app = require('../server');

async function request(baseUrl, route, token, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${typeof token === 'string' ? token : token.token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test('project-meeting API enforces roles and completes the approval-backed minutes workflow', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'project_meeting_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      title: 'API meeting controls project',
      status: 'planned',
      client: { name: 'API meeting client' }
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  tokens.field_worker.jobIds = [jobId];

  const payload = {
    title: 'Client coordination minutes',
    meetingType: 'client',
    scheduledAt: '2026-07-15T09:00:00.000Z',
    location: 'Site office',
    chair: 'Office project manager',
    attendees: [{ name: 'Office project manager' }, { name: 'Client representative', email: 'client@example.test' }],
    agenda: ['Programme', 'Client decisions'],
    minutesSummary: 'The programme and retained client decisions were reviewed with named owners.',
    decisions: ['Client retained the selected finish.'],
    actions: [{ title: 'Confirm finish delivery', ownerName: 'Office project manager', dueAt: '2020-01-01', priority: 'high' }],
    actor: 'role:owner:spoofed'
  };

  const fieldDenied = await request(baseUrl, `/api/ledger/jobs/${jobId}/project-meetings`, tokens.field_worker, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(fieldDenied.response.status, 403);
  assert.equal(fieldDenied.body.error.code, 'insufficient_role');

  const approverDenied = await request(baseUrl, `/api/ledger/jobs/${jobId}/project-meetings`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(approverDenied.response.status, 403);

  const created = await request(baseUrl, `/api/ledger/jobs/${jobId}/project-meetings`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.meeting.status, 'draft');
  assert.equal(created.body.meeting.data.createdBy, 'role:office_operator');
  const meetingId = created.body.meeting.id;

  const submitted = await request(baseUrl, `/api/ledger/jobs/${jobId}/project-meetings/${meetingId}/submit`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Review retained attendance, decisions, and action ownership.' })
  });
  assert.equal(submitted.response.status, 200);
  assert.equal(submitted.body.meeting.status, 'pending_approval');
  assert.equal(submitted.body.externalDeliveryInitiated, false);

  const officeDenied = await request(baseUrl, `/api/ledger/approvals/${submitted.body.approval.id}/resolve`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', reason: 'Attempted operator bypass.' })
  });
  assert.equal(officeDenied.response.status, 403);

  const approved = await request(baseUrl, `/api/ledger/approvals/${submitted.body.approval.id}/resolve`, tokens.owner, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      resolvedBy: 'API meeting owner',
      reason: 'Attendance, decisions, owner, due date, and immutable minutes snapshot verified.'
    })
  });
  assert.equal(approved.response.status, 200);

  let detail = await request(baseUrl, `/api/ledger/jobs/${jobId}`, tokens.owner);
  let meeting = detail.body.job.projectMeetings.find(record => record.id === meetingId);
  assert.equal(meeting.status, 'approved');
  assert.equal(meeting.actions[0].status, 'open');
  assert.ok(detail.body.job.tasks.some(task => task.id === meeting.actions[0].linkedTaskId));
  assert.ok(detail.body.job.audit.some(event => event.entityId === meetingId && event.action === 'create_project_meeting' && event.actor === 'role:office_operator'));
  assert.equal(detail.body.job.audit.some(event => event.actor === 'role:owner:spoofed'), false);

  const issued = await request(baseUrl, `/api/ledger/jobs/${jobId}/project-meetings/${meetingId}/issue`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ deliveryReference: 'email-receipt:api-meeting-minutes' })
  });
  assert.equal(issued.response.status, 200);
  assert.equal(issued.body.meeting.status, 'issued');
  assert.equal(issued.body.externalDeliveryPerformedByContractorAI, false);

  const completed = await request(
    baseUrl,
    `/api/ledger/jobs/${jobId}/project-meetings/${meetingId}/actions/${meeting.actions[0].id}/complete`,
    tokens.office_operator,
    {
      method: 'POST',
      body: JSON.stringify({
        evidenceReference: 'supplier-confirmation:api-finish-delivery',
        completedBy: 'Office project manager',
        notes: 'Retained supplier confirmation reviewed.'
      })
    }
  );
  assert.equal(completed.response.status, 200);
  assert.equal(completed.body.action.status, 'completed');
  assert.equal(completed.body.job.tasks.find(task => task.id === meeting.actions[0].linkedTaskId).status, 'completed');

  const exported = await request(baseUrl, '/api/operations/export', tokens.owner);
  assert.equal(exported.response.status, 200);
  assert.ok(exported.body.projectControls.meetings.some(record => record.id === meetingId));
  const validation = await request(baseUrl, '/api/operations/exports/validate', tokens.owner, {
    method: 'POST',
    body: JSON.stringify({ snapshot: exported.body })
  });
  assert.equal(validation.response.status, 200);
  assert.equal(validation.body.counts.meetings, 1);

  detail = await request(baseUrl, `/api/ledger/jobs/${jobId}`, tokens.owner);
  meeting = detail.body.job.projectMeetings.find(record => record.id === meetingId);
  assert.equal(meeting.status, 'issued');
  assert.equal(meeting.actions[0].status, 'completed');
});
