const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-market-fit-api-'));
const tokens = {
  owner: 'market-fit-owner-token-at-least-32-characters',
  approver: 'market-fit-approver-token-at-least-32-characters',
  office_operator: 'market-fit-office-token-at-least-32-characters',
  field_worker: { token: 'market-fit-field-token-at-least-32-characters', jobIds: ['none'] }
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
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

const policy = {
  entryKey: 'market-fit-api-policy-0001',
  reason: 'Set the approved commercial focus for API qualification.',
  profileName: 'API residential focus',
  services: ['Renovation'],
  clientSegments: ['Homeowner'],
  sourceChannels: ['Referral'],
  minJobValue: 5_000,
  maxJobValue: 100_000,
  fitThreshold: 70,
  serviceAreas: [{ label: 'Arnhem API area', country: 'NL', postalPrefixes: ['68'], cities: ['Arnhem'] }]
};

test('market-fit API enforces policy ownership, approval, advisory assessment, export, and capability contracts', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'market_fit_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const fieldRead = await request(baseUrl, '/api/ledger/market-fit', tokens.field_worker.token);
  assert.equal(fieldRead.response.status, 403);
  const initial = await request(baseUrl, '/api/ledger/market-fit', tokens.approver);
  assert.equal(initial.response.status, 200, JSON.stringify(initial.body));
  assert.equal(initial.body.marketFit.summary.configured, false);

  const denied = await request(baseUrl, '/api/ledger/market-fit/profiles', tokens.office_operator, {
    method: 'POST', body: JSON.stringify(policy)
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.error.code, 'insufficient_role');
  const requested = await request(baseUrl, '/api/ledger/market-fit/profiles', tokens.owner, {
    method: 'POST', body: JSON.stringify(policy)
  });
  assert.equal(requested.response.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.profile.status, 'pending_approval');
  assert.equal(requested.body.approval.targetType, 'market_fit_profile');
  const replay = await request(baseUrl, '/api/ledger/market-fit/profiles', tokens.owner, {
    method: 'POST', body: JSON.stringify(policy)
  });
  assert.equal(replay.response.status, 201, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);

  const deniedResolve = await request(baseUrl, `/api/ledger/approvals/${requested.body.approval.id}/resolve`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ status: 'approved' })
  });
  assert.equal(deniedResolve.response.status, 403);
  const approved = await request(baseUrl, `/api/ledger/approvals/${requested.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', resolvedBy: 'Market approver', reason: 'ICP and service-area evidence verified.' })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));

  const created = await request(baseUrl, '/api/ledger/opportunities', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'API Market Client', title: 'API Arnhem renovation', service: 'Renovation', clientSegment: 'Homeowner',
      sourceChannel: 'Referral', postalCode: '6811AA', city: 'Arnhem', country: 'NL', estimatedValue: 25_000
    })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.opportunity.data.clientSegment, 'Homeowner');
  const opportunityId = created.body.opportunity.id;
  const fit = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}/market-fit`, tokens.office_operator);
  assert.equal(fit.response.status, 200, JSON.stringify(fit.body));
  assert.equal(fit.body.evaluation.recommendation, 'pursue');
  assert.equal(fit.body.evaluation.score, 100);
  assert.equal(fit.body.evaluation.automaticRejection, false);

  const retained = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}/market-fit-assessments`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ entryKey: 'market-fit-api-assessment-0001' })
  });
  assert.equal(retained.response.status, 201, JSON.stringify(retained.body));
  assert.equal(retained.body.assessment.integrityValid, true);
  const retainedReplay = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}/market-fit-assessments`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ entryKey: 'market-fit-api-assessment-0001' })
  });
  assert.equal(retainedReplay.response.status, 201, JSON.stringify(retainedReplay.body));
  assert.equal(retainedReplay.body.replayed, true);

  const register = await request(baseUrl, '/api/ledger/market-fit', tokens.approver);
  assert.equal(register.body.marketFit.summary.configured, true);
  assert.equal(register.body.marketFit.summary.pursue, 1);
  assert.equal(register.body.marketFit.summary.missingOrStale, 0);

  const exported = await request(baseUrl, '/api/operations/export', tokens.owner);
  assert.equal(exported.response.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.body.marketFitProfiles.length, 1);
  assert.equal(exported.body.opportunityFitAssessments.length, 1);
  const validated = await request(baseUrl, '/api/operations/exports/validate', tokens.owner, {
    method: 'POST', body: JSON.stringify({ snapshot: exported.body })
  });
  assert.equal(validated.response.status, 200, JSON.stringify(validated.body));
  assert.equal(validated.body.counts.marketFitProfiles, 1);
  assert.equal(validated.body.counts.opportunityFitAssessments, 1);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200, JSON.stringify(capabilities.body));
  assert.equal(capabilities.body.capabilities.marketFit.criteria.length, 5);
  assert.equal(capabilities.body.capabilities.marketFit.assessmentMode, 'deterministic_source_bound_advisory');
  assert.equal(capabilities.body.capabilities.marketFit.automaticRejection, false);
  assert.equal(capabilities.body.capabilities.marketFit.externalCommitments, 0);
  assert.equal(capabilities.body.capabilities.requestSafety.marketFitPolicyRevision, 'owner_requested_approval_gated_versioned');
  assert.equal(capabilities.body.capabilities.requestSafety.opportunityFitAssessment, 'source_bound_exact_replay');
});
