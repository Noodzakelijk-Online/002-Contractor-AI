const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { riskRegisterPayload } = require('./risk-register-fixture');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-quote-api-'));
process.env.NODE_ENV = 'test';
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');
process.env.CONTRACTOR_AI_REQUIRE_AUTH = 'true';
delete process.env.CONTRACTOR_AI_AUTH_TOKEN;

const tokens = {
  owner: 'quote-api-owner-token-123456789012345678901234',
  office: 'quote-api-office-token-12345678901234567890123',
  approver: 'quote-api-approver-token-12345678901234567890',
  field: 'quote-api-field-token-123456789012345678901234'
};
process.env.CONTRACTOR_AI_ROLE_TOKENS = JSON.stringify({
  operators: [
    { id: 'quote-owner', role: 'owner', token: tokens.owner },
    { id: 'quote-office', role: 'office_operator', token: tokens.office },
    { id: 'quote-approver', role: 'approver', token: tokens.approver },
    { id: 'quote-field', role: 'field_worker', workerId: 'worker_quote_field', token: tokens.field }
  ]
});

const app = require('../server');

function headers(role, json = false) {
  return {
    Authorization: `Bearer ${tokens[role]}`,
    ...(json ? { 'Content-Type': 'application/json' } : {})
  };
}

async function jsonRequest(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const body = await response.json();
  return { response, body };
}

test('organization and quote issue APIs enforce role, approval, and download boundaries', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'quote_issue_api_test' });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const initial = await jsonRequest(baseUrl, '/api/ledger/organization', { headers: headers('approver') });
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.organization.readiness.ready, false);

  const profile = {
    legalName: 'Quote API Contractor B.V.',
    registrationNumber: '87654321',
    vatNumber: 'NL987654321B01',
    email: 'office@example.test',
    phone: '+31 10 100 20 30',
    address: 'API-straat 8',
    postalCode: '3011 AA',
    city: 'Rotterdam',
    country: 'NL',
    defaultPaymentTermsDays: 21,
    defaultQuoteValidityDays: 30
  };
  const deniedOfficeProfile = await jsonRequest(baseUrl, '/api/ledger/organization', {
    method: 'PUT', headers: headers('office', true), body: JSON.stringify(profile)
  });
  assert.equal(deniedOfficeProfile.response.status, 403);
  assert.equal(deniedOfficeProfile.body.error.code, 'insufficient_role');

  const retainedProfile = await jsonRequest(baseUrl, '/api/ledger/organization', {
    method: 'PUT', headers: headers('owner', true), body: JSON.stringify(profile)
  });
  assert.equal(retainedProfile.response.status, 200);
  assert.equal(retainedProfile.body.organization.readiness.ready, true);

  const intake = await jsonRequest(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({
      client: { name: 'API <Client>', email: 'client@example.test' },
      title: 'API quote issue job',
      service: 'renovation',
      address: 'Projectlaan 12',
      city: 'Delft',
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const scope = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/commercial-scope/revisions`, {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({
      entryKey: 'quote-issue-api-scope-0001',
      title: 'API quote issue scope',
      scopeSummary: 'Complete the retained API quote issue work within the agreed boundary.',
      inclusions: ['Complete the retained API scope.'],
      assumptions: ['Existing services remain usable.'],
      exclusions: ['Hazardous-material removal is excluded.'],
      allowanceMode: 'none',
      noAllowanceReason: 'No provisional sums or selection allowances apply.',
      reason: 'Establish the written scope before quote issue testing.'
    })
  });
  assert.equal(scope.response.status, 201, JSON.stringify(scope.body));
  const scopeApproved = await jsonRequest(baseUrl, `/api/ledger/approvals/${scope.body.approval.id}/resolve`, {
    method: 'POST',
    headers: headers('approver', true),
    body: JSON.stringify({ status: 'approved', reason: 'Written scope verified.' })
  });
  assert.equal(scopeApproved.response.status, 200, JSON.stringify(scopeApproved.body));

  const risk = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/risk-register/revisions`, {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify(riskRegisterPayload('quote-issue-api-risk-0001', scope.body.revision.id))
  });
  assert.equal(risk.response.status, 201, JSON.stringify(risk.body));
  const riskApproved = await jsonRequest(baseUrl, `/api/ledger/approvals/${risk.body.approval.id}/resolve`, {
    method: 'POST',
    headers: headers('approver', true),
    body: JSON.stringify({ status: 'approved', reason: 'Risk ownership and premortem controls verified.' })
  });
  assert.equal(riskApproved.response.status, 200, JSON.stringify(riskApproved.body));

  const quote = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/quote`, {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({
      commercialScopeRevisionId: scope.body.revision.id,
      riskRegisterRevisionId: risk.body.revision.id,
      validUntil: '2026-10-31',
      lineItems: [{ description: 'Retained API scope', quantity: 2, unitPrice: 350 }]
    })
  });
  assert.equal(quote.response.status, 201);

  const blockedIssue = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/quotes/${quote.body.quote.id}/issue-package`, {
    method: 'POST', headers: headers('office', true), body: '{}'
  });
  assert.equal(blockedIssue.response.status, 409);
  assert.equal(blockedIssue.body.error.code, 'quote_not_approved_for_issue');

  const approved = await jsonRequest(baseUrl, `/api/ledger/approvals/${quote.body.quote.approvalId}/resolve`, {
    method: 'POST',
    headers: headers('approver', true),
    body: JSON.stringify({ status: 'approved', reason: 'Scope and price checked.' })
  });
  assert.equal(approved.response.status, 200);

  const issued = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/quotes/${quote.body.quote.id}/issue-package`, {
    method: 'POST', headers: headers('office', true), body: '{}'
  });
  assert.equal(issued.response.status, 201);
  assert.equal(issued.body.notSent, true);
  assert.equal(issued.body.externalCommitments, 0);
  assert.equal(issued.body.approval.targetType, 'communication');
  assert.equal(issued.body.job.contractValue, 0);

  const replay = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/quotes/${quote.body.quote.id}/issue-package`, {
    method: 'POST', headers: headers('office', true), body: '{}'
  });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.document.id, issued.body.document.id);
  assert.equal(replay.body.approval.id, issued.body.approval.id);

  const fieldDownload = await jsonRequest(baseUrl, `/api/ledger/documents/${issued.body.document.id}/issue-package`, {
    headers: headers('field')
  });
  assert.equal(fieldDownload.response.status, 403);
  assert.equal(fieldDownload.body.error.code, 'insufficient_role');

  const packageResponse = await fetch(`${baseUrl}/api/ledger/documents/${issued.body.document.id}/issue-package`, {
    headers: headers('approver')
  });
  const html = await packageResponse.text();
  assert.equal(packageResponse.status, 200);
  assert.match(packageResponse.headers.get('content-type'), /^text\/html/);
  assert.match(packageResponse.headers.get('content-disposition'), /^attachment;/);
  assert.match(packageResponse.headers.get('cache-control'), /no-store/);
  assert.match(html, /API &lt;Client&gt;/);
  assert.match(html, new RegExp(issued.body.packageHash));
  assert.doesNotMatch(html, /<script>/i);
});
