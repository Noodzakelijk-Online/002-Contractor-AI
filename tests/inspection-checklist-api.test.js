const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-inspection-api-'));
const assignedJobId = 'inspection-api-assigned-job';
const tokens = {
  owner: 'inspection-api-owner-token-at-least-32-characters',
  approver: 'inspection-api-approver-token-at-least-32-characters',
  office_operator: 'inspection-api-office-token-at-least-32-characters',
  field_worker: {
    id: 'field-inspector',
    token: 'inspection-api-field-token-at-least-32-characters',
    jobIds: [assignedJobId]
  }
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

async function createJob(baseUrl, ledgerJobId, title) {
  return request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      ledgerJobId,
      title,
      status: 'planned',
      client: { name: `${title} client` }
    })
  });
}

test('inspection checklist API enforces office, field, and approval role boundaries', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'inspection_checklist_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const intake = await createJob(baseUrl, assignedJobId, 'Assigned inspection project');
  assert.equal(intake.response.status, 201);
  assert.equal(intake.body.job.id, assignedJobId);

  const templates = await request(baseUrl, '/api/ledger/inspection-templates', tokens.office_operator);
  assert.equal(templates.response.status, 200);
  assert.equal(templates.body.templates.filter(template => template.builtIn).length, 4);

  const fieldTemplateRead = await request(baseUrl, '/api/ledger/inspection-templates', tokens.field_worker);
  assert.equal(fieldTemplateRead.response.status, 403);
  const fieldTemplateWrite = await request(baseUrl, '/api/ledger/inspection-templates', tokens.field_worker, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Forbidden field template',
      items: [{ prompt: 'First field check' }, { prompt: 'Second field check' }]
    })
  });
  assert.equal(fieldTemplateWrite.response.status, 403);

  const customTemplate = await request(baseUrl, '/api/ledger/inspection-templates', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      name: 'API facade hold point',
      templateKey: 'api_facade_hold_point',
      inspectionType: 'quality_hold_point',
      discipline: 'quality',
      actor: 'role:owner:spoofed',
      items: [
        { key: 'substrate', prompt: 'Substrate tolerance is verified', failureSeverity: 'high' },
        { key: 'fixings', prompt: 'Fixing pattern matches the drawing', failureSeverity: 'medium' }
      ]
    })
  });
  assert.equal(customTemplate.response.status, 201);
  assert.equal(customTemplate.body.template.data.builtIn, false);

  const fieldScheduleDenied = await request(baseUrl, `/api/ledger/jobs/${assignedJobId}/inspection-checklists`, tokens.field_worker, {
    method: 'POST',
    body: JSON.stringify({ templateId: customTemplate.body.template.id })
  });
  assert.equal(fieldScheduleDenied.response.status, 403);

  const scheduled = await request(baseUrl, `/api/ledger/jobs/${assignedJobId}/inspection-checklists`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      templateId: customTemplate.body.template.id,
      title: 'Assigned elevation inspection',
      entryKey: 'api-inspection-schedule-0001',
      actor: 'role:owner:spoofed'
    })
  });
  assert.equal(scheduled.response.status, 201);
  assert.equal(scheduled.body.inspection.status, 'scheduled');

  const submitted = await request(
    baseUrl,
    `/api/ledger/jobs/${assignedJobId}/inspections/${scheduled.body.inspection.id}/checklist-submissions`,
    tokens.field_worker,
    {
      method: 'POST',
      body: JSON.stringify({
        entryKey: 'api-inspection-submit-0001',
        actor: 'role:owner:spoofed',
        notes: 'Field check retained from assigned scope.',
        responses: [
          { itemKey: 'substrate', result: 'pass' },
          { itemKey: 'fixings', result: 'fail', notes: 'One fixing row is outside the retained spacing.' }
        ]
      })
    }
  );
  assert.equal(submitted.response.status, 201);
  assert.equal(submitted.body.submission.result, 'failed');
  assert.equal(submitted.body.observations.length, 1);
  assert.equal(submitted.body.approval, null);
  assert.equal(submitted.body.inspection.data, undefined);
  assert.equal(submitted.body.inspection.approvalId, undefined);
  assert.equal(submitted.body.submission.data, undefined);
  assert.equal(submitted.body.submission.approvalId, undefined);
  assert.equal(submitted.body.inspection.checklist.submissions[0].data, undefined);
  assert.equal(submitted.body.inspection.checklist.submissions[0].approvalId, undefined);
  const approvalId = scheduled.body.job.approvals?.find(approval => approval.targetId === scheduled.body.inspection.id)?.id
    || (await request(baseUrl, `/api/ledger/jobs/${assignedJobId}`, tokens.owner)).body.job.approvals
      .find(approval => approval.targetId === scheduled.body.inspection.id).id;

  const officeResolveDenied = await request(baseUrl, `/api/ledger/approvals/${approvalId}/resolve`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', reason: 'Operator bypass attempt.' })
  });
  assert.equal(officeResolveDenied.response.status, 403);

  const approval = await request(baseUrl, `/api/ledger/approvals/${approvalId}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      resolvedBy: 'API inspection approver',
      reason: 'Checklist response and linked corrective observation verified.'
    })
  });
  assert.equal(approval.response.status, 200);

  const detail = await request(baseUrl, `/api/ledger/jobs/${assignedJobId}`, tokens.owner);
  const inspection = detail.body.job.inspections.find(record => record.id === scheduled.body.inspection.id);
  assert.equal(inspection.status, 'failed');
  assert.equal(inspection.checklist.submissions[0].status, 'failed');
  assert.ok(detail.body.job.audit.some(event => event.action === 'submit_inspection_checklist' && event.actor === 'role:field_worker:field-inspector'));
  assert.equal(detail.body.job.audit.some(event => event.actor === 'role:owner:spoofed'), false);

  const foreignIntake = await createJob(baseUrl, 'inspection-api-unassigned-job', 'Unassigned inspection project');
  assert.equal(foreignIntake.response.status, 201);
  const foreignSchedule = await request(baseUrl, '/api/ledger/jobs/inspection-api-unassigned-job/inspection-checklists', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      templateId: customTemplate.body.template.id,
      entryKey: 'api-inspection-schedule-0002'
    })
  });
  assert.equal(foreignSchedule.response.status, 201);
  const foreignSubmit = await request(
    baseUrl,
    `/api/ledger/jobs/inspection-api-unassigned-job/inspections/${foreignSchedule.body.inspection.id}/checklist-submissions`,
    tokens.field_worker,
    {
      method: 'POST',
      body: JSON.stringify({
        entryKey: 'api-inspection-submit-0002',
        responses: foreignSchedule.body.inspection.checklist.snapshot.items.map(item => ({ itemKey: item.key, result: 'pass' }))
      })
    }
  );
  assert.equal(foreignSubmit.response.status, 403);
  assert.equal(foreignSubmit.body.error.code, 'field_job_scope_forbidden');
});
