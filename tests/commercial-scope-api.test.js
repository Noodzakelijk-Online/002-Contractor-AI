const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PRICING_BASIS_FACTORS } = require('../operating-ledger');
const { riskRegisterPayload } = require('./risk-register-fixture');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-commercial-scope-api-'));
const tokens = {
  owner: 'commercial-scope-owner-token-at-least-32-characters',
  approver: 'commercial-scope-approver-token-at-least-32-characters',
  office_operator: 'commercial-scope-office-token-at-least-32-characters',
  field_worker: { token: 'commercial-scope-field-token-at-least-32-characters', jobIds: ['none'] }
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

function scopePayload(entryKey) {
  return {
    entryKey,
    title: 'API commercial scope schedule',
    scopeSummary: 'Complete the retained API renovation within the measured room boundary.',
    inclusions: ['Protect access and install the measured finish package.'],
    assumptions: ['Existing structural openings remain unchanged.'],
    exclusions: ['Hazardous-material removal is excluded.'],
    clientResponsibilities: ['Confirm finish selections before procurement review.'],
    contractorResponsibilities: ['Retain protection and completion evidence.'],
    currency: 'EUR',
    allowanceMode: 'defined',
    allowances: [{
      allowanceKey: 'ALLOW-API',
      allowanceType: 'provisional_sum',
      title: 'Electrical investigation',
      description: 'Provisional sum for opening and testing the retained circuit.',
      quantity: 8,
      unit: 'hour',
      unitRate: 75,
      reconciliationMethod: 'actual_cost_variation',
      selectionBy: 'contractor',
      evidenceReference: 'API survey S-01'
    }],
    reason: 'Establish the written API commercial basis before pricing and quote approval.'
  };
}

function pricingPayload(scopeRevisionId, riskRegisterRevisionId) {
  return {
    entryKey: 'commercial-scope-api-pricing-0001',
    commercialScopeRevisionId: scopeRevisionId,
    ...(riskRegisterRevisionId ? { riskRegisterRevisionId } : {}),
    selectedModel: 'fixed_price',
    rationale: 'Approved written scope and estimate evidence support fixed-price delivery.',
    factors: PRICING_BASIS_FACTORS.map(factor => ({
      key: factor.key,
      status: 'yes',
      evidence: `${factor.label} is verified against the approved API scope.`
    }))
  };
}

test('commercial-scope API enforces roles, approval order, quote binding, export, and capability contracts', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'commercial_scope_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const ownerSession = await request(baseUrl, '/api/session', tokens.owner);
  assert.equal(ownerSession.body.operator.capabilities.commercialScope, true);
  const fieldSession = await request(baseUrl, '/api/session', tokens.field_worker.token);
  assert.equal(fieldSession.body.operator.capabilities.commercialScope, false);

  const intake = await request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'API Commercial Scope Client',
      title: 'API commercial scope fixture',
      service: 'renovation',
      estimatedHours: 80,
      estimatedCost: 14_000,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;

  const fieldRead = await request(baseUrl, `/api/ledger/jobs/${jobId}/commercial-scope`, tokens.field_worker.token);
  assert.equal(fieldRead.response.status, 403);
  const approverRead = await request(baseUrl, `/api/ledger/jobs/${jobId}/commercial-scope`, tokens.approver);
  assert.equal(approverRead.response.status, 200, JSON.stringify(approverRead.body));
  assert.equal(approverRead.body.commercialScope.ready, false);

  const payload = scopePayload('commercial-scope-api-0001');
  const deniedRequest = await request(baseUrl, `/api/ledger/jobs/${jobId}/commercial-scope/revisions`, tokens.approver, {
    method: 'POST', body: JSON.stringify(payload)
  });
  assert.equal(deniedRequest.response.status, 403);
  const requested = await request(baseUrl, `/api/ledger/jobs/${jobId}/commercial-scope/revisions`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify(payload)
  });
  assert.equal(requested.response.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.revision.status, 'pending_approval');
  assert.equal(requested.body.revision.allowanceTotal, 600);
  assert.equal(requested.body.approval.decision.preview.allowanceTotal, 600);
  assert.equal(requested.body.externalCommitments, 0);

  const pricingBeforeApproval = await request(baseUrl, `/api/ledger/jobs/${jobId}/pricing-decisions`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify(pricingPayload(requested.body.revision.id))
  });
  assert.equal(pricingBeforeApproval.response.status, 409, JSON.stringify(pricingBeforeApproval.body));
  assert.equal(pricingBeforeApproval.body.error.code, 'commercial_scope_required');

  const approvedScope = await request(baseUrl, `/api/ledger/approvals/${requested.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', reason: 'Written scope and allowance evidence verified.' })
  });
  assert.equal(approvedScope.response.status, 200, JSON.stringify(approvedScope.body));
  const register = await request(baseUrl, `/api/ledger/jobs/${jobId}/commercial-scope`, tokens.approver);
  assert.equal(register.body.commercialScope.ready, true);
  assert.equal(register.body.commercialScope.currentRevision.id, requested.body.revision.id);

  const riskRequest = await request(baseUrl, `/api/ledger/jobs/${jobId}/risk-register/revisions`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify(riskRegisterPayload('commercial-scope-api-risk-0001', requested.body.revision.id))
  });
  assert.equal(riskRequest.response.status, 201, JSON.stringify(riskRequest.body));
  const riskApproval = await request(baseUrl, `/api/ledger/approvals/${riskRequest.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Project risk and premortem evidence verified.' })
  });
  assert.equal(riskApproval.response.status, 200, JSON.stringify(riskApproval.body));

  const retainedPricing = await request(baseUrl, `/api/ledger/jobs/${jobId}/pricing-decisions`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify(pricingPayload(requested.body.revision.id, riskRequest.body.revision.id))
  });
  assert.equal(retainedPricing.response.status, 201, JSON.stringify(retainedPricing.body));
  assert.equal(retainedPricing.body.decision.snapshot.source.commercialScope.revisionId, requested.body.revision.id);

  const quote = await request(baseUrl, `/api/ledger/jobs/${jobId}/quote`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      commercialScopeRevisionId: requested.body.revision.id,
      riskRegisterRevisionId: riskRequest.body.revision.id,
      pricingDecisionId: retainedPricing.body.decision.id,
      currency: 'EUR',
      lineItems: [{ description: 'API retained renovation package', quantity: 1, unitPrice: 16_000 }]
    })
  });
  assert.equal(quote.response.status, 201, JSON.stringify(quote.body));
  assert.equal(quote.body.quote.commercialScope.revisionId, requested.body.revision.id);
  assert.equal(quote.body.quote.commercialScopeIntegrityValid, true);
  const approvedQuote = await request(baseUrl, `/api/ledger/approvals/${quote.body.quote.approvalId}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Current scope and pricing basis verified.' })
  });
  assert.equal(approvedQuote.response.status, 200, JSON.stringify(approvedQuote.body));

  const exported = await request(baseUrl, '/api/operations/export', tokens.owner);
  assert.equal(exported.response.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.body.commercialScopeRevisions.length, 1);
  const validated = await request(baseUrl, '/api/operations/exports/validate', tokens.owner, {
    method: 'POST', body: JSON.stringify({ snapshot: exported.body })
  });
  assert.equal(validated.response.status, 200, JSON.stringify(validated.body));
  assert.equal(validated.body.counts.commercialScopeRevisions, 1);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200, JSON.stringify(capabilities.body));
  assert.equal(capabilities.body.capabilities.commercialScope.framework, 'written_scope_assumptions_exclusions_allowances');
  assert.equal(capabilities.body.capabilities.commercialScope.quoteApproval, 'current_approved_scope_required');
  assert.equal(capabilities.body.capabilities.commercialScope.autonomousAuthoring, false);
  assert.equal(capabilities.body.capabilities.requestSafety.commercialScopeRevision, 'source_current_approval_gated_versioned');
  assert.equal(capabilities.body.capabilities.requestSafety.quoteCommercialScopeApproval, 'source_current_required');
});
