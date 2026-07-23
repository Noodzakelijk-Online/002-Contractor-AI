const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SITE_SURVEY_TEMPLATE } = require('../operating-ledger');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-site-survey-api-'));
const tokens = {
  owner: 'site-survey-owner-token-at-least-32-characters',
  approver: 'site-survey-approver-token-at-least-32-characters',
  office_operator: 'site-survey-office-token-at-least-32-characters',
  field_worker: { token: 'site-survey-field-token-at-least-32-characters', jobIds: ['none'] }
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
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${typeof token === 'string' ? token : token.token}`,
      ...(options.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return { response, body: await response.arrayBuffer() };
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test('site-survey API enforces roles, private evidence, approval, export, and capability contracts', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'site_survey_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const created = await request(baseUrl, '/api/ledger/opportunities', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'API Survey Client',
      title: 'API site-survey renovation',
      service: 'Renovation',
      address: 'Velperweg 1',
      postalCode: '6824AA',
      city: 'Arnhem',
      country: 'NL',
      estimatedValue: 28_000
    })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const opportunityId = created.body.opportunity.id;

  const fieldRead = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}/site-surveys`, tokens.field_worker);
  assert.equal(fieldRead.response.status, 403);
  const fieldPlan = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}/site-surveys`, tokens.field_worker, {
    method: 'POST',
    body: JSON.stringify({
      entryKey: 'site-survey-api-field-plan-0001', scheduledAt: '2026-07-22T08:00:00.000Z', surveyor: 'Field worker'
    })
  });
  assert.equal(fieldPlan.response.status, 403);

  const planPayload = {
    entryKey: 'site-survey-api-plan-0001',
    scheduledAt: '2026-07-22T08:00:00.000Z',
    surveyor: 'API Surveyor',
    notes: 'Internal plan; external appointment confirmation is separate.'
  };
  const planned = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}/site-surveys`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify(planPayload)
  });
  assert.equal(planned.response.status, 201, JSON.stringify(planned.body));
  assert.equal(planned.body.survey.status, 'planned');
  assert.equal(planned.body.siteSurvey.activeSurvey.id, planned.body.survey.id);
  const planReplay = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}/site-surveys`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify(planPayload)
  });
  assert.equal(planReplay.response.status, 201, JSON.stringify(planReplay.body));
  assert.equal(planReplay.body.replayed, true);

  const deniedUploadForm = new FormData();
  deniedUploadForm.append('evidenceFile', new Blob([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('private opportunity field proof')
  ], { type: 'image/jpeg' }), 'field-private-photo.jpg');
  deniedUploadForm.append('opportunityId', opportunityId);
  const deniedUpload = await request(baseUrl, '/api/ledger/upload', tokens.field_worker, {
    method: 'POST', body: deniedUploadForm
  });
  assert.equal(deniedUpload.response.status, 403);

  const uploadForm = new FormData();
  const evidenceBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('private site-survey proof')]);
  uploadForm.append('evidenceFile', new Blob([evidenceBytes], { type: 'image/jpeg' }), 'site-survey-photo.jpg');
  uploadForm.append('opportunityId', opportunityId);
  uploadForm.append('title', 'Kitchen dimensions and existing conditions');
  uploadForm.append('category', 'site_survey_photo');
  const uploaded = await request(baseUrl, '/api/ledger/upload', tokens.office_operator, {
    method: 'POST',
    body: uploadForm,
    headers: { 'Idempotency-Key': 'site-survey-api-upload-0001' }
  });
  assert.equal(uploaded.response.status, 200, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.opportunityEvidence.opportunityId, opportunityId);
  assert.equal(uploaded.body.opportunityEvidence.status, 'stored');
  assert.match(uploaded.body.opportunityEvidence.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(uploaded.body.actions.length, 0);
  const evidenceId = uploaded.body.opportunityEvidence.id;

  const download = await request(baseUrl, `/api/ledger/opportunity-evidence/${evidenceId}/content`, tokens.approver);
  assert.equal(download.response.status, 200);
  assert.equal(Buffer.compare(Buffer.from(download.body), evidenceBytes), 0);
  assert.equal(download.response.headers.get('cache-control'), 'private, no-store');

  const submissionPayload = {
    entryKey: 'site-survey-api-submission-0001',
    surveyedAt: '2026-07-22T08:30:00.000Z',
    surveyor: 'API Surveyor',
    scopeSummary: 'Renovate the retained kitchen footprint and associated finishes.',
    checklistResponses: SITE_SURVEY_TEMPLATE.items.map(item => ({
      itemKey: item.key,
      result: 'pass',
      notes: 'Verified during the retained API survey.',
      evidenceDocumentIds: [evidenceId]
    })),
    measurements: [{ label: 'Kitchen floor area', quantity: 21.75, unit: 'm2', evidenceIds: [evidenceId] }],
    evidenceIds: [evidenceId],
    assumptions: ['Existing service routes remain usable.'],
    exclusions: ['Hazardous-material removal excluded.'],
    constraints: ['Occupied dwelling.'],
    utilities: ['Electrical isolation recorded.'],
    hazards: ['Occupied access path.'],
    clientDecisions: ['Finish selection pending.']
  };
  const submitted = await request(
    baseUrl,
    `/api/ledger/opportunities/${opportunityId}/site-surveys/${planned.body.survey.id}/submissions`,
    tokens.office_operator,
    { method: 'POST', body: JSON.stringify(submissionPayload) }
  );
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.body));
  assert.equal(submitted.body.survey.status, 'pending_approval');
  assert.equal(submitted.body.approval.targetType, 'opportunity_site_survey');

  const deniedResolve = await request(baseUrl, `/api/ledger/approvals/${submitted.body.approval.id}/resolve`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ status: 'approved' })
  });
  assert.equal(deniedResolve.response.status, 403);
  const approved = await request(baseUrl, `/api/ledger/approvals/${submitted.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Checklist, measurements, and evidence verified.' })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));

  const retained = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}`, tokens.office_operator);
  assert.equal(retained.response.status, 200, JSON.stringify(retained.body));
  assert.equal(retained.body.opportunity.stage, 'estimating');
  assert.equal(retained.body.opportunity.siteSurvey.readiness.estimateReady, true);
  assert.equal(retained.body.opportunity.siteSurvey.currentSurvey.integrityValid, true);

  const register = await request(baseUrl, '/api/ledger/site-surveys', tokens.approver);
  assert.equal(register.response.status, 200, JSON.stringify(register.body));
  assert.equal(register.body.siteSurveys.summary.ready, 1);
  assert.equal(register.body.siteSurveys.surveys.length, 1);

  const exported = await request(baseUrl, '/api/operations/export', tokens.owner);
  assert.equal(exported.response.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.body.opportunityEvidence.length, 1);
  assert.equal(exported.body.opportunitySiteSurveys.length, 1);
  const validated = await request(baseUrl, '/api/operations/exports/validate', tokens.owner, {
    method: 'POST', body: JSON.stringify({ snapshot: exported.body })
  });
  assert.equal(validated.response.status, 200, JSON.stringify(validated.body));
  assert.equal(validated.body.counts.opportunityEvidence, 1);
  assert.equal(validated.body.counts.opportunitySiteSurveys, 1);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200, JSON.stringify(capabilities.body));
  assert.equal(capabilities.body.capabilities.preconstructionSiteSurvey.available, true);
  assert.equal(capabilities.body.capabilities.preconstructionSiteSurvey.evidence, 'private_sha256_verified');
  assert.equal(capabilities.body.capabilities.requestSafety.siteSurveyApproval, 'source_current_approval_gated');
  assert.equal(capabilities.body.capabilities.requestSafety.siteSurveyAutonomy, 'internal_review_task_only');

  const diagnostics = await request(baseUrl, '/api/ledger/debug', tokens.owner);
  assert.equal(diagnostics.response.status, 200, JSON.stringify(diagnostics.body));
  assert.equal(diagnostics.body.diagnostics.valid, true);
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '064_governed_installation_qc');
});
