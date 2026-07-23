const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-client-feedback-api-'));
const tokens = {
  owner: 'feedback-owner-token-at-least-32-characters',
  approver: 'feedback-approver-token-at-least-32-characters',
  office_operator: 'feedback-office-token-at-least-32-characters',
  field_worker: { token: 'feedback-field-token-at-least-32-characters', jobIds: ['none'] }
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test('client feedback API enforces roles, supports scoped portal capture, and exports retained evidence', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'client_feedback_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', tokens.owner, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Feedback API renovation',
      client: { name: 'Feedback API client' },
      service: 'renovation',
      status: 'in_progress',
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;
  const operatorPayload = {
    entryKey: 'feedback-api-operator-0001',
    surveyType: 'handover',
    respondentName: 'Client contact',
    npsScore: 8,
    csatScore: 4,
    effortScore: 4,
    comment: 'Good result with one coordination issue.',
    evidenceReference: 'signed-handover-form-001'
  };

  const fieldDenied = await request(baseUrl, `/api/ledger/jobs/${jobId}/client-feedback`, tokens.field_worker.token, {
    method: 'POST',
    body: JSON.stringify(operatorPayload)
  });
  assert.equal(fieldDenied.response.status, 403);
  const retained = await request(baseUrl, `/api/ledger/jobs/${jobId}/client-feedback`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify(operatorPayload)
  });
  assert.equal(retained.response.status, 201, JSON.stringify(retained.body));
  assert.equal(retained.body.feedback.integrityValid, true);
  assert.equal(retained.body.externalCommitments, 0);

  const approverRead = await request(baseUrl, `/api/ledger/client-feedback?jobId=${jobId}`, tokens.approver);
  assert.equal(approverRead.response.status, 200);
  assert.equal(approverRead.body.feedback.length, 1);
  const fieldReadDenied = await request(baseUrl, `/api/ledger/client-feedback?jobId=${jobId}`, tokens.field_worker.token);
  assert.equal(fieldReadDenied.response.status, 403);

  const access = await request(baseUrl, `/api/ledger/jobs/${jobId}/client-portal-access`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ expiresAt: '2027-01-01T00:00:00.000Z' })
  });
  assert.equal(access.response.status, 201, JSON.stringify(access.body));
  const approved = await request(baseUrl, `/api/ledger/approvals/${access.body.access.approval.id}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Feedback approver', reason: 'Verified scoped client access.' })
  });
  assert.equal(approved.response.status, 200);

  const portalBefore = await request(baseUrl, `/api/client-portal/${access.body.access.portalToken}`, null);
  assert.equal(portalBefore.response.status, 200);
  assert.equal(portalBefore.body.portal.feedback.submitted, false);
  const portalPayload = {
    responseId: 'feedback-api-portal-0001',
    surveyType: 'warranty',
    submittedAt: '2020-01-01T00:00:00.000Z',
    respondentName: 'Unverified injected identity',
    evidenceReference: 'untrusted-browser-reference',
    npsScore: 4,
    csatScore: 2,
    effortScore: 2,
    comment: 'Communication required too much effort.',
    followUpConsent: true,
    testimonialConsent: false
  };
  const portalFeedback = await request(baseUrl, `/api/client-portal/${access.body.access.portalToken}/feedback`, null, {
    method: 'POST',
    body: JSON.stringify(portalPayload)
  });
  assert.equal(portalFeedback.response.status, 201, JSON.stringify(portalFeedback.body));
  assert.equal(portalFeedback.body.feedback.source, 'client_portal');
  assert.equal(portalFeedback.body.feedback.surveyType, 'project_experience');
  assert.notEqual(portalFeedback.body.feedback.submittedAt, portalPayload.submittedAt);
  assert.equal(portalFeedback.body.feedback.respondentName, null);
  assert.equal(portalFeedback.body.feedback.evidenceReference, `portal_access:${access.body.access.id}`);
  assert.equal(portalFeedback.body.reviewRequested, false);
  assert.equal(portalFeedback.body.referralRequested, false);
  assert.equal(portalFeedback.body.externalCommitments, 0);
  const portalReplay = await request(baseUrl, `/api/client-portal/${access.body.access.portalToken}/feedback`, null, {
    method: 'POST',
    body: JSON.stringify(portalPayload)
  });
  assert.equal(portalReplay.response.status, 201);
  assert.equal(portalReplay.body.replayed, true);

  const portalAfter = await request(baseUrl, `/api/client-portal/${access.body.access.portalToken}`, null);
  assert.equal(portalAfter.body.portal.feedback.submitted, true);
  const exported = await request(baseUrl, '/api/operations/export', tokens.owner);
  assert.equal(exported.response.status, 200);
  assert.equal(exported.body.clientFeedback.length, 2);
  const validated = await request(baseUrl, '/api/operations/exports/validate', tokens.owner, {
    method: 'POST',
    body: JSON.stringify({ snapshot: exported.body })
  });
  assert.equal(validated.response.status, 200, JSON.stringify(validated.body));
  assert.equal(validated.body.counts.clientFeedback, 2);
});
