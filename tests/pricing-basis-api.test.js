const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PRICING_BASIS_FACTORS } = require('../operating-ledger');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-pricing-basis-api-'));
const tokens = {
  owner: 'pricing-basis-owner-token-at-least-32-characters',
  approver: 'pricing-basis-approver-token-at-least-32-characters',
  office_operator: 'pricing-basis-office-token-at-least-32-characters',
  field_worker: { token: 'pricing-basis-field-token-at-least-32-characters', jobIds: ['none'] }
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

function factors(overrides = {}) {
  return PRICING_BASIS_FACTORS.map(factor => ({
    key: factor.key,
    status: overrides[factor.key] || 'yes',
    evidence: `${factor.label} is verified in the API fixture evidence.`
  }));
}

test('pricing-basis API enforces roles, quote source currency, export, and capability contracts', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'pricing_basis_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const ownerSession = await request(baseUrl, '/api/session', tokens.owner);
  assert.equal(ownerSession.body.operator.capabilities.pricingBasis, true);
  const fieldSession = await request(baseUrl, '/api/session', tokens.field_worker.token);
  assert.equal(fieldSession.body.operator.capabilities.pricingBasis, false);

  const intake = await request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'API Pricing Client',
      title: 'API pricing-basis fixture',
      service: 'renovation',
      estimatedHours: 80,
      estimatedCost: 12_000,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;

  const scopeRequest = await request(baseUrl, `/api/ledger/jobs/${jobId}/commercial-scope/revisions`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      entryKey: 'pricing-basis-api-scope-0001',
      title: 'API pricing-basis scope',
      scopeSummary: 'Complete the retained API renovation within the agreed work boundary.',
      inclusions: ['Complete the retained renovation package.'],
      assumptions: ['Existing services remain usable.'],
      exclusions: ['Hazardous-material removal is excluded.'],
      allowanceMode: 'none',
      noAllowanceReason: 'No provisional sums or selection allowances apply.',
      reason: 'Establish the written scope before pricing-basis assessment.'
    })
  });
  assert.equal(scopeRequest.response.status, 201, JSON.stringify(scopeRequest.body));
  const scopeApproval = await request(baseUrl, `/api/ledger/approvals/${scopeRequest.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Written commercial scope verified.' })
  });
  assert.equal(scopeApproval.response.status, 200, JSON.stringify(scopeApproval.body));

  const fieldRead = await request(baseUrl, `/api/ledger/jobs/${jobId}/pricing-basis`, tokens.field_worker.token);
  assert.equal(fieldRead.response.status, 403);
  const approverRead = await request(baseUrl, `/api/ledger/jobs/${jobId}/pricing-basis`, tokens.approver);
  assert.equal(approverRead.response.status, 200, JSON.stringify(approverRead.body));
  assert.equal(approverRead.body.pricingBasis.currentDecision, null);
  assert.equal(approverRead.body.pricingBasis.evaluation.recommendation, 'review');

  const fixedPayload = {
    entryKey: 'pricing-basis-api-0001',
    commercialScopeRevisionId: scopeRequest.body.revision.id,
    factors: factors(),
    selectedModel: 'fixed_price',
    rationale: 'Complete retained evidence supports a fixed-price commercial commitment.'
  };
  const denied = await request(baseUrl, `/api/ledger/jobs/${jobId}/pricing-decisions`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify(fixedPayload)
  });
  assert.equal(denied.response.status, 403);
  const retained = await request(baseUrl, `/api/ledger/jobs/${jobId}/pricing-decisions`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify(fixedPayload)
  });
  assert.equal(retained.response.status, 201, JSON.stringify(retained.body));
  assert.equal(retained.body.decision.selectedModel, 'fixed_price');
  assert.equal(retained.body.decision.integrityValid, true);
  assert.equal(retained.body.replayed, false);
  assert.equal(retained.body.externalCommitments, 0);

  const quote = await request(baseUrl, `/api/ledger/jobs/${jobId}/quote`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      pricingDecisionId: retained.body.decision.id,
      currency: 'EUR',
      lineItems: [{ description: 'Fixed-price renovation', quantity: 1, unitPrice: 15_000 }]
    })
  });
  assert.equal(quote.response.status, 201, JSON.stringify(quote.body));
  assert.equal(quote.body.quote.pricingModel, 'fixed_price');
  assert.equal(quote.body.quote.pricingBasisIntegrityValid, true);
  const quoteApprovalId = quote.body.quote.approvalId;

  const superseded = await request(baseUrl, `/api/ledger/jobs/${jobId}/pricing-decisions`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      entryKey: 'pricing-basis-api-0002',
      factors: factors({ scope_defined: 'no' }),
      selectedModel: 'time_and_materials',
      rationale: 'Unresolved scope boundaries require measured time-and-materials control.'
    })
  });
  assert.equal(superseded.response.status, 201, JSON.stringify(superseded.body));
  assert.equal(superseded.body.decision.selectedModel, 'time_and_materials');
  assert.equal(superseded.body.pricingBasis.decisions.length, 2);
  assert.equal(superseded.body.pricingBasis.decisions.find(item => item.id === retained.body.decision.id).status, 'superseded');

  const staleApproval = await request(baseUrl, `/api/ledger/approvals/${quoteApprovalId}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', reason: 'Commercial evidence reviewed.' })
  });
  assert.equal(staleApproval.response.status, 409, JSON.stringify(staleApproval.body));
  assert.equal(staleApproval.body.error.code, 'pricing_basis_decision_stale');
  const pending = await request(baseUrl, '/api/ledger/approvals?status=pending', tokens.approver);
  assert.equal(pending.body.approvals.some(approval => approval.id === quoteApprovalId), true);

  const tmQuote = await request(baseUrl, `/api/ledger/jobs/${jobId}/quote`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      pricingDecisionId: superseded.body.decision.id,
      currency: 'EUR',
      notes: 'Budget estimate only. Actual billing follows retained time and materials evidence.',
      lineItems: [{ description: 'T&M budget estimate', quantity: 80, unitPrice: 75 }]
    })
  });
  assert.equal(tmQuote.response.status, 201, JSON.stringify(tmQuote.body));
  assert.equal(tmQuote.body.quote.pricingModel, 'time_and_materials');
  const approved = await request(baseUrl, `/api/ledger/approvals/${tmQuote.body.quote.approvalId}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', reason: 'T&M evidence and budget basis verified.' })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));

  const exported = await request(baseUrl, '/api/operations/export', tokens.owner);
  assert.equal(exported.response.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.body.pricingBasisDecisions.length, 2);
  const validated = await request(baseUrl, '/api/operations/exports/validate', tokens.owner, {
    method: 'POST',
    body: JSON.stringify({ snapshot: exported.body })
  });
  assert.equal(validated.response.status, 200, JSON.stringify(validated.body));
  assert.equal(validated.body.counts.pricingBasisDecisions, 2);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200, JSON.stringify(capabilities.body));
  assert.equal(capabilities.body.capabilities.pricingBasis.framework, 'fixed_price_versus_time_and_materials_decision_tree');
  assert.equal(capabilities.body.capabilities.pricingBasis.quoteApproval, 'current_source_required');
  assert.equal(capabilities.body.capabilities.pricingBasis.autonomousSelection, false);
  assert.equal(capabilities.body.capabilities.requestSafety.pricingBasisDecision, 'versioned_source_bound_exact_replay');
  assert.equal(capabilities.body.capabilities.requestSafety.quotePricingBasisApproval, 'source_current_required');
});
