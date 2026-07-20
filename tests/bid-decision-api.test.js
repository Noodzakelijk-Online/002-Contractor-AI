const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-bid-decision-api-'));
const tokens = {
  owner: 'bid-decision-owner-token-at-least-32-characters',
  approver: 'bid-decision-approver-token-at-least-32-characters',
  office_operator: 'bid-decision-office-token-at-least-32-characters',
  field_worker: { token: 'bid-decision-field-token-at-least-32-characters', jobIds: ['none'] }
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

const marketPolicy = {
  entryKey: 'bid-decision-api-market-policy-0001',
  reason: 'Retain the API market focus used by the pursuit scorecard.',
  profileName: 'API pursuit market focus',
  services: ['Renovation'],
  clientSegments: ['Homeowner'],
  sourceChannels: ['Referral'],
  minJobValue: 5_000,
  maxJobValue: 100_000,
  fitThreshold: 70,
  serviceAreas: [{ label: 'Arnhem API pursuit area', country: 'NL', postalPrefixes: ['68'], cities: ['Arnhem'] }]
};

const policy = {
  entryKey: 'bid-decision-api-policy-0001',
  reason: 'Adopt the API pursuit scorecard, thresholds, and hard gates.',
  policyName: 'API pursuit scorecard',
  bidThreshold: 70,
  noBidThreshold: 45
};

const criteria = [
  'client_payment',
  'scope_contract',
  'capacity_schedule',
  'technical_safety',
  'commercial_return'
].map(key => ({ key, rating: 5, evidence: `${key} verified against current API test evidence.` }));
const gates = [
  'scope_defined',
  'capacity_available',
  'contract_risk_acceptable',
  'payment_terms_acceptable',
  'compliance_achievable'
].map(key => ({ key, status: 'yes' }));

test('bid/no-bid API enforces roles, source-current approval, export, and capability contracts', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'bid_decision_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const fieldRead = await request(baseUrl, '/api/ledger/bid-decisions', tokens.field_worker.token);
  assert.equal(fieldRead.response.status, 403);
  const initial = await request(baseUrl, '/api/ledger/bid-decisions', tokens.approver);
  assert.equal(initial.response.status, 200, JSON.stringify(initial.body));
  assert.equal(initial.body.bidDecisions.summary.configured, false);

  const market = await request(baseUrl, '/api/ledger/market-fit/profiles', tokens.owner, {
    method: 'POST', body: JSON.stringify(marketPolicy)
  });
  assert.equal(market.response.status, 201, JSON.stringify(market.body));
  const marketApproval = await request(baseUrl, `/api/ledger/approvals/${market.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Market evidence verified.' })
  });
  assert.equal(marketApproval.response.status, 200, JSON.stringify(marketApproval.body));

  const created = await request(baseUrl, '/api/ledger/opportunities', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'API Pursuit Client', title: 'API Arnhem pursuit', service: 'Renovation', clientSegment: 'Homeowner',
      sourceChannel: 'Referral', postalCode: '6811AA', city: 'Arnhem', country: 'NL', estimatedValue: 35_000
    })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const opportunityId = created.body.opportunity.id;
  const fit = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}/market-fit-assessments`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ entryKey: 'bid-decision-api-fit-0001' })
  });
  assert.equal(fit.response.status, 201, JSON.stringify(fit.body));

  const deniedPolicy = await request(baseUrl, '/api/ledger/bid-decisions/policies', tokens.office_operator, {
    method: 'POST', body: JSON.stringify(policy)
  });
  assert.equal(deniedPolicy.response.status, 403);
  assert.equal(deniedPolicy.body.error.code, 'insufficient_role');
  const requestedPolicy = await request(baseUrl, '/api/ledger/bid-decisions/policies', tokens.owner, {
    method: 'POST', body: JSON.stringify(policy)
  });
  assert.equal(requestedPolicy.response.status, 201, JSON.stringify(requestedPolicy.body));
  assert.equal(requestedPolicy.body.policy.status, 'pending_approval');
  assert.equal(requestedPolicy.body.approval.targetType, 'bid_decision_policy');
  const approvedPolicy = await request(baseUrl, `/api/ledger/approvals/${requestedPolicy.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Pursuit governance verified.' })
  });
  assert.equal(approvedPolicy.response.status, 200, JSON.stringify(approvedPolicy.body));

  const preview = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}/bid-decision`, tokens.office_operator);
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.bidDecision.evaluation.recommendation, 'review');
  assert.equal(preview.body.bidDecision.evaluation.marketFit.current, true);
  assert.equal(preview.body.bidDecision.evaluation.evidenceGaps.length, 10);

  const decisionPayload = {
    entryKey: 'bid-decision-api-request-0001',
    criteria,
    gates,
    proposedDecision: 'bid',
    rationale: 'All retained scorecard evidence supports bidding for this opportunity.'
  };
  const requested = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}/bid-decisions`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify(decisionPayload)
  });
  assert.equal(requested.response.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.decision.score, 100);
  assert.equal(requested.body.decision.recommendation, 'bid');
  assert.equal(requested.body.decision.status, 'pending_approval');
  assert.equal(requested.body.approval.data.opportunityStageMutation, false);
  const replay = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}/bid-decisions`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify(decisionPayload)
  });
  assert.equal(replay.response.status, 201, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);

  const deniedResolve = await request(baseUrl, `/api/ledger/approvals/${requested.body.approval.id}/resolve`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ status: 'approved' })
  });
  assert.equal(deniedResolve.response.status, 403);
  const approved = await request(baseUrl, `/api/ledger/approvals/${requested.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Pursuit ratings, gates, and source hashes verified.' })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.bidDecision.currentDecision.proposedDecision, 'bid');
  assert.equal(approved.body.bidDecision.stale, false);

  const opportunity = await request(baseUrl, `/api/ledger/opportunities/${opportunityId}`, tokens.office_operator);
  assert.equal(opportunity.response.status, 200, JSON.stringify(opportunity.body));
  assert.equal(opportunity.body.opportunity.stage, 'new');
  assert.equal(opportunity.body.opportunity.bidDecision.currentDecision.proposedDecision, 'bid');

  const register = await request(baseUrl, '/api/ledger/bid-decisions', tokens.approver);
  assert.equal(register.body.bidDecisions.summary.configured, true);
  assert.equal(register.body.bidDecisions.summary.bid, 1);
  assert.equal(register.body.bidDecisions.summary.missingOrStale, 0);

  const exported = await request(baseUrl, '/api/operations/export', tokens.owner);
  assert.equal(exported.response.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.body.bidDecisionPolicies.length, 1);
  assert.equal(exported.body.opportunityBidDecisions.length, 1);
  const validated = await request(baseUrl, '/api/operations/exports/validate', tokens.owner, {
    method: 'POST', body: JSON.stringify({ snapshot: exported.body })
  });
  assert.equal(validated.response.status, 200, JSON.stringify(validated.body));
  assert.equal(validated.body.counts.bidDecisionPolicies, 1);
  assert.equal(validated.body.counts.opportunityBidDecisions, 1);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200, JSON.stringify(capabilities.body));
  assert.equal(capabilities.body.capabilities.bidDecisions.criteria.length, 6);
  assert.equal(capabilities.body.capabilities.bidDecisions.gates.length, 5);
  assert.equal(capabilities.body.capabilities.bidDecisions.marketFitIntegration, 'current_retained_assessment_required');
  assert.equal(capabilities.body.capabilities.bidDecisions.opportunityStageMutation, false);
  assert.equal(capabilities.body.capabilities.bidDecisions.externalCommitments, 0);
  assert.equal(capabilities.body.capabilities.requestSafety.bidDecisionPolicyRevision, 'owner_requested_approval_gated_versioned');
  assert.equal(capabilities.body.capabilities.requestSafety.opportunityBidDecision, 'source_current_approval_gated_exact_replay');
});
