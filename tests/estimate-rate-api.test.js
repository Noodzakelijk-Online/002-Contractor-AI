const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-estimate-rate-api-'));
const tokens = {
  owner: 'estimate-rate-owner-token-at-least-32-characters',
  approver: 'estimate-rate-approver-token-at-least-32-characters',
  office_operator: 'estimate-rate-office-token-at-least-32-characters',
  field_worker: { token: 'estimate-rate-field-token-at-least-32-characters', jobIds: ['none'] }
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
  entryKey: 'estimate-rate-api-policy-0001',
  reason: 'Establish governed API estimating assumptions for internal draft rates.',
  policyName: 'API governed rates',
  currency: 'EUR',
  labourClasses: [{ code: 'CRAFT', name: 'API craft labour', baseHourlyRate: 40 }],
  labourBurden: {
    paidLeavePercent: 10,
    statutoryEmployerCostsPercent: 20,
    pensionBenefitsPercent: 5,
    insuranceOtherPercent: 5,
    productiveUtilizationPercent: 70
  },
  overheadRecovery: {
    method: 'labor_hour',
    annualOverhead: 60_000,
    annualProductiveLabourHours: 2_000,
    directCostPercent: 0
  },
  targetMarginPercent: 20
};

test('estimating rate API enforces role boundaries, approval, draft-only application, export, and capability contracts', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'estimate_rate_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const ownerSession = await request(baseUrl, '/api/session', tokens.owner);
  assert.equal(ownerSession.response.status, 200);
  assert.equal(ownerSession.body.operator.capabilities.estimateRates, true);
  const fieldSession = await request(baseUrl, '/api/session', tokens.field_worker.token);
  assert.equal(fieldSession.body.operator.capabilities.estimateRates, false);
  const fieldRead = await request(baseUrl, '/api/ledger/estimate-rates', tokens.field_worker.token);
  assert.equal(fieldRead.response.status, 403);

  const initial = await request(baseUrl, '/api/ledger/estimate-rates', tokens.approver);
  assert.equal(initial.response.status, 200, JSON.stringify(initial.body));
  assert.equal(initial.body.estimateRates.summary.configured, false);
  const deniedPolicy = await request(baseUrl, '/api/ledger/estimate-rates/policies', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify(policy)
  });
  assert.equal(deniedPolicy.response.status, 403);
  assert.equal(deniedPolicy.body.error.code, 'insufficient_role');

  const requested = await request(baseUrl, '/api/ledger/estimate-rates/policies', tokens.owner, {
    method: 'POST',
    body: JSON.stringify(policy)
  });
  assert.equal(requested.response.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.policy.status, 'pending_approval');
  assert.equal(requested.body.approval.targetType, 'estimate_rate_policy');
  assert.equal(requested.body.estimateRates.summary.pendingApproval, 1);

  const intake = await request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ clientName: 'API Rate Client', title: 'API rate fixture', assignAutomatically: false })
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;
  const created = await request(baseUrl, `/api/ledger/jobs/${jobId}/takeoffs`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      title: 'API rate build-up takeoff',
      currency: 'EUR',
      items: [{ description: 'API floor finish', category: 'material', measurementType: 'manual', quantity: 1, unit: 'm2', unitCost: 20, unitPrice: 30 }]
    })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const takeoffId = created.body.takeoff.id;
  const itemId = created.body.takeoff.items[0].id;
  const buildUp = {
    entryKey: 'estimate-rate-api-build-up-0001',
    policyId: requested.body.policy.id,
    labourClassCode: 'CRAFT',
    labourHoursPerUnit: 0.5,
    materialCostPerUnit: 20,
    equipmentCostPerUnit: 5,
    subcontractCostPerUnit: 0,
    otherDirectCostPerUnit: 2,
    targetMarginPercent: 20
  };
  const beforeApproval = await request(baseUrl, `/api/ledger/jobs/${jobId}/takeoffs/${takeoffId}/items/${itemId}/rate-build-up`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify(buildUp)
  });
  assert.equal(beforeApproval.response.status, 409);
  assert.equal(beforeApproval.body.error.code, 'estimate_rate_policy_required');

  const deniedResolve = await request(baseUrl, `/api/ledger/approvals/${requested.body.approval.id}/resolve`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved' })
  });
  assert.equal(deniedResolve.response.status, 403);
  const approved = await request(baseUrl, `/api/ledger/approvals/${requested.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      resolvedBy: 'API commercial approver',
      reason: 'Labour burden, overhead basis, and margin assumptions verified.'
    })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));

  const deniedBuild = await request(baseUrl, `/api/ledger/jobs/${jobId}/takeoffs/${takeoffId}/items/${itemId}/rate-build-up`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify(buildUp)
  });
  assert.equal(deniedBuild.response.status, 403);
  const applied = await request(baseUrl, `/api/ledger/jobs/${jobId}/takeoffs/${takeoffId}/items/${itemId}/rate-build-up`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify(buildUp)
  });
  assert.equal(applied.response.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.item.rateIntegrityValid, true);
  assert.equal(applied.body.item.rateBuildUp.calculation.unitCost, 82);
  assert.equal(applied.body.item.rateBuildUp.calculation.unitSellRate, 102.5);
  assert.equal(applied.body.externalCommitments, 0);
  assert.equal(applied.body.job.quotes.length, 0);
  assert.equal(applied.body.job.contractValue, 0);

  const register = await request(baseUrl, '/api/ledger/estimate-rates', tokens.approver);
  assert.equal(register.body.estimateRates.summary.configured, true);
  assert.equal(register.body.estimateRates.activePolicy.id, requested.body.policy.id);
  assert.equal(register.body.estimateRates.workerDirectoryRatesUnaffected, true);

  const exported = await request(baseUrl, '/api/operations/export', tokens.owner);
  assert.equal(exported.response.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.body.estimateRatePolicies.length, 1);
  assert.equal(exported.body.takeoffItems.find(item => item.id === itemId).rateBuildUp.calculation.unitCost, 82);
  const validated = await request(baseUrl, '/api/operations/exports/validate', tokens.owner, {
    method: 'POST',
    body: JSON.stringify({ snapshot: exported.body })
  });
  assert.equal(validated.response.status, 200, JSON.stringify(validated.body));
  assert.equal(validated.body.counts.estimateRatePolicies, 1);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200, JSON.stringify(capabilities.body));
  assert.equal(capabilities.body.capabilities.estimateRates.framework, 'unit_rate_labour_burden_overhead_recovery');
  assert.deepEqual(capabilities.body.capabilities.estimateRates.overheadMethods, ['labor_hour', 'direct_cost_percent']);
  assert.equal(capabilities.body.capabilities.estimateRates.draftTakeoffMutationOnly, true);
  assert.equal(capabilities.body.capabilities.estimateRates.workerDirectoryRatesAffected, false);
  assert.equal(capabilities.body.capabilities.requestSafety.estimateRatePolicyRevision, 'owner_requested_approval_gated_versioned');
  assert.equal(capabilities.body.capabilities.requestSafety.unitRateBuildUp, 'active_policy_source_bound_exact_replay');
});
