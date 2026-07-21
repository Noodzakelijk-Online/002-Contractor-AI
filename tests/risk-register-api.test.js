const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PRICING_BASIS_FACTORS } = require('../operating-ledger');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-risk-register-api-'));
const tokens = {
  owner: 'risk-register-owner-token-at-least-32-characters',
  approver: 'risk-register-approver-token-at-least-32-characters',
  office_operator: 'risk-register-office-token-at-least-32-characters',
  field_worker: { token: 'risk-register-field-token-at-least-32-characters', jobIds: ['none'] }
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

function scopePayload() {
  return {
    entryKey: 'risk-register-api-scope-0001',
    title: 'API retained commercial scope',
    scopeSummary: 'Complete the retained API refurbishment within the measured project boundary.',
    inclusions: ['Protect access and complete the measured refurbishment package.'],
    assumptions: ['Existing services remain usable after isolation checks.'],
    exclusions: ['Hazardous-material removal is excluded.'],
    allowanceMode: 'none',
    noAllowanceReason: 'No provisional sums or client selection allowances apply.',
    reason: 'Establish the source-bound API commercial scope before risk review.'
  };
}

function riskPayload(scopeRevisionId) {
  return {
    entryKey: 'risk-register-api-version-0001',
    commercialScopeRevisionId: scopeRevisionId,
    title: 'API project risk register',
    currency: 'EUR',
    risks: [{
      riskKey: 'RISK-API-SUPPLY',
      category: 'supply_chain',
      title: 'Retained finish delivery delay',
      cause: 'The selected finish has a constrained supplier lead time.',
      event: 'The finish is not available for the planned installation date.',
      consequence: 'The installation sequence and client completion date are delayed.',
      owner: 'Project manager',
      probability: 3,
      impact: 4,
      responseStrategy: 'mitigate',
      mitigationAction: 'Confirm stock and reserve the finish before the procurement release.',
      contingencyAction: 'Present an approved equal alternative before the required-on-site date.',
      trigger: 'Supplier confirmation is absent ten working days before installation.',
      residualProbability: 2,
      residualImpact: 3,
      costExposureAmount: 2_500,
      scheduleExposureDays: 4,
      status: 'monitoring'
    }],
    premortem: {
      workshopDate: '2026-08-04',
      failureStatement: 'The refurbishment completed late because retained finish procurement failed.',
      facilitator: 'Commercial manager',
      participants: ['Estimator', 'Project manager'],
      failureModes: [{
        riskKey: 'RISK-API-SUPPLY',
        failureMode: 'The specified finish was unavailable at procurement release.',
        earlyWarning: 'The supplier did not provide written stock confirmation.',
        prevention: 'Retain stock confirmation and an approved alternative before quote approval.'
      }]
    },
    reason: 'Retain the API project premortem and risk treatments before pricing.'
  };
}

function pricingPayload(scopeRevisionId, riskRevisionId) {
  return {
    entryKey: 'risk-register-api-pricing-0001',
    commercialScopeRevisionId: scopeRevisionId,
    riskRegisterRevisionId: riskRevisionId,
    selectedModel: 'fixed_price',
    rationale: 'The approved scope and treated risk exposure support fixed-price delivery.',
    factors: PRICING_BASIS_FACTORS.map(factor => ({
      key: factor.key,
      status: 'yes',
      evidence: `${factor.label} is verified against the approved API scope and risk register.`
    }))
  };
}

test('risk-register API enforces roles, approval order, downstream binding, export, and capability contracts', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'risk_register_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const ownerSession = await request(baseUrl, '/api/session', tokens.owner);
  assert.equal(ownerSession.body.operator.capabilities.riskRegister, true);
  const fieldSession = await request(baseUrl, '/api/session', tokens.field_worker.token);
  assert.equal(fieldSession.body.operator.capabilities.riskRegister, false);

  const intake = await request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'API Risk Register Client',
      title: 'API risk-register fixture',
      service: 'renovation',
      estimatedHours: 80,
      estimatedCost: 0,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;

  const fieldRead = await request(baseUrl, `/api/ledger/jobs/${jobId}/risk-register`, tokens.field_worker.token);
  assert.equal(fieldRead.response.status, 403);
  const approverRead = await request(baseUrl, `/api/ledger/jobs/${jobId}/risk-register`, tokens.approver);
  assert.equal(approverRead.response.status, 200, JSON.stringify(approverRead.body));
  assert.equal(approverRead.body.riskRegister.ready, false);

  const requestedScope = await request(baseUrl, `/api/ledger/jobs/${jobId}/commercial-scope/revisions`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify(scopePayload())
  });
  assert.equal(requestedScope.response.status, 201, JSON.stringify(requestedScope.body));
  const approvedScope = await request(baseUrl, `/api/ledger/approvals/${requestedScope.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'API scope verified.' })
  });
  assert.equal(approvedScope.response.status, 200, JSON.stringify(approvedScope.body));

  const deniedRequest = await request(baseUrl, `/api/ledger/jobs/${jobId}/risk-register/revisions`, tokens.approver, {
    method: 'POST', body: JSON.stringify(riskPayload(requestedScope.body.revision.id))
  });
  assert.equal(deniedRequest.response.status, 403);
  const requested = await request(baseUrl, `/api/ledger/jobs/${jobId}/risk-register/revisions`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify(riskPayload(requestedScope.body.revision.id))
  });
  assert.equal(requested.response.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.revision.status, 'pending_approval');
  assert.equal(requested.body.revision.totalExpectedValue, 750);
  assert.equal(requested.body.approval.decision.preview.summary.totalExpectedValue, 750);
  assert.equal(requested.body.externalCommitments, 0);

  const pricingBeforeApproval = await request(baseUrl, `/api/ledger/jobs/${jobId}/pricing-decisions`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify(pricingPayload(requestedScope.body.revision.id, requested.body.revision.id))
  });
  assert.equal(pricingBeforeApproval.response.status, 409, JSON.stringify(pricingBeforeApproval.body));
  assert.equal(pricingBeforeApproval.body.error.code, 'risk_register_required');

  const approvedRisk = await request(baseUrl, `/api/ledger/approvals/${requested.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Risk ownership and premortem evidence verified.' })
  });
  assert.equal(approvedRisk.response.status, 200, JSON.stringify(approvedRisk.body));
  const register = await request(baseUrl, `/api/ledger/jobs/${jobId}/risk-register`, tokens.approver);
  assert.equal(register.body.riskRegister.ready, true);

  const retainedPricing = await request(baseUrl, `/api/ledger/jobs/${jobId}/pricing-decisions`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify(pricingPayload(requestedScope.body.revision.id, requested.body.revision.id))
  });
  assert.equal(retainedPricing.response.status, 201, JSON.stringify(retainedPricing.body));
  assert.equal(retainedPricing.body.decision.snapshot.source.riskRegister.revisionId, requested.body.revision.id);

  const quote = await request(baseUrl, `/api/ledger/jobs/${jobId}/quote`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      commercialScopeRevisionId: requestedScope.body.revision.id,
      riskRegisterRevisionId: requested.body.revision.id,
      pricingDecisionId: retainedPricing.body.decision.id,
      lineItems: [{ description: 'API retained refurbishment', quantity: 1, unitPrice: 18_000 }]
    })
  });
  assert.equal(quote.response.status, 201, JSON.stringify(quote.body));
  assert.equal(quote.body.quote.riskRegister.revisionId, requested.body.revision.id);
  assert.equal(quote.body.quote.riskRegisterIntegrityValid, true);

  const exported = await request(baseUrl, '/api/operations/export', tokens.owner);
  assert.equal(exported.response.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.body.riskRegisterRevisions.length, 1);
  const validated = await request(baseUrl, '/api/operations/exports/validate', tokens.owner, {
    method: 'POST', body: JSON.stringify({ snapshot: exported.body })
  });
  assert.equal(validated.response.status, 200, JSON.stringify(validated.body));
  assert.equal(validated.body.counts.riskRegisterRevisions, 1);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200, JSON.stringify(capabilities.body));
  assert.equal(capabilities.body.capabilities.riskManagement.framework, 'project_risk_register_and_premortem');
  assert.equal(capabilities.body.capabilities.riskManagement.autonomousAuthoring, false);
  assert.equal(capabilities.body.capabilities.riskManagement.observedFieldIncidentsSeparate, true);
  assert.equal(capabilities.body.capabilities.requestSafety.riskRegisterRevision, 'source_current_approval_gated_versioned');
  assert.equal(capabilities.body.capabilities.requestSafety.quoteRiskRegisterApproval, 'source_current_required');
});
