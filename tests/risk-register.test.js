const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger, PRICING_BASIS_FACTORS } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-risk-register-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  const ledger = new ContractorOperatingLedger({ dbFile });
  t.after(() => {
    try { ledger.close(); } catch { /* already closed */ }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, dbFile };
}

function createJob(ledger) {
  return ledger.createIntake({
    clientName: 'Risk Register Client',
    title: 'Occupied apartment renovation',
    service: 'renovation',
    description: 'Renovate the occupied apartment against the retained commercial boundary.',
    estimatedHours: 160,
    estimatedCost: 26_000,
    assignAutomatically: false
  }, { actor: 'risk-register-test' });
}

function approveScope(ledger, jobId, entryKey, title = 'Apartment renovation commercial scope') {
  const requested = ledger.requestCommercialScopeRevision(jobId, {
    entryKey,
    title,
    scopeSummary: 'Complete the occupied apartment renovation within the retained measured work boundary.',
    inclusions: ['Protect access and complete the measured installation package.'],
    assumptions: ['Existing services remain usable after isolation checks.'],
    exclusions: ['Hazardous-material removal is excluded.'],
    clientResponsibilities: ['Provide access and confirm finish selections before procurement.'],
    contractorResponsibilities: ['Retain protection, test, and completion evidence.'],
    allowanceMode: 'none',
    noAllowanceReason: 'No provisional sums or selection allowances apply.',
    reason: 'Establish the written scope before project risk review.'
  });
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved', resolvedBy: 'commercial-approver', reason: 'Written scope and source evidence verified.'
  });
  return ledger.getCommercialScopeRevision(requested.revision.id);
}

function riskPayload(entryKey, commercialScopeRevisionId, overrides = {}) {
  return {
    entryKey,
    commercialScopeRevisionId,
    title: overrides.title || 'Apartment project risk register',
    currency: 'EUR',
    risks: overrides.risks || [{
      riskKey: 'RISK-ACCESS',
      category: 'site_condition',
      title: 'Restricted occupied-site access',
      cause: 'The apartment remains occupied while work is completed.',
      event: 'Materials cannot be moved through the planned access route.',
      consequence: 'Crew productivity falls and the planned completion date is threatened.',
      owner: 'Project manager',
      probability: 4,
      impact: 4,
      responseStrategy: 'mitigate',
      mitigationAction: 'Confirm a protected delivery route and delivery windows before mobilization.',
      contingencyAction: 'Use smaller delivery batches and resequence internal work packages.',
      trigger: 'The client cannot confirm the retained delivery window seven days before start.',
      dueAt: '2026-08-20',
      residualProbability: 2,
      residualImpact: 3,
      costExposureAmount: 4_000,
      scheduleExposureDays: 3,
      status: 'monitoring',
      evidenceReference: 'Commercial scope and site logistics note S-01'
    }],
    premortem: overrides.premortem || {
      workshopDate: '2026-08-01',
      failureStatement: 'The apartment renovation missed its date and exceeded the approved commercial allowance.',
      facilitator: 'Commercial manager',
      participants: ['Project manager', 'Estimator', 'Site supervisor'],
      failureModes: [{
        riskKey: 'RISK-ACCESS',
        failureMode: 'Occupied-site access prevented planned material movement.',
        earlyWarning: 'Delivery windows remain unconfirmed one week before mobilization.',
        prevention: 'Freeze access arrangements during the pre-start review and retain confirmation.'
      }]
    },
    reason: overrides.reason || 'Retain the project premortem and commercial exposure review before pricing.'
  };
}

function approveRisk(ledger, jobId, scope, entryKey, overrides = {}) {
  const requested = ledger.requestRiskRegisterRevision(jobId, riskPayload(entryKey, scope.id, overrides), { actor: 'project-manager' });
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved', resolvedBy: 'risk-approver', reason: 'Risk ownership, treatments, exposure, and premortem links verified.'
  });
  return ledger.getRiskRegisterRevision(requested.revision.id);
}

function pricingPayload(entryKey, scope, risk) {
  return {
    entryKey,
    commercialScopeRevisionId: scope.id,
    riskRegisterRevisionId: risk.id,
    selectedModel: 'fixed_price',
    rationale: 'The approved scope and treated project risks support fixed-price delivery.',
    factors: PRICING_BASIS_FACTORS.map(factor => ({
      key: factor.key,
      status: 'yes',
      evidence: `${factor.label} is verified against the retained scope and approved risk register.`
    }))
  };
}

test('risk-register revisions are scored by the server, replay-safe, approval-gated, and capability-visible', t => {
  const { ledger } = temporaryLedger(t);
  const job = createJob(ledger);
  const scope = approveScope(ledger, job.id, 'risk-register-scope-0001');

  assert.throws(
    () => ledger.retainPricingBasisDecision(job.id, pricingPayload('risk-pricing-missing-0001', scope, { id: 'missing' })),
    error => error.code === 'risk_register_required' && error.statusCode === 409
  );

  const payload = riskPayload('risk-register-version-0001', scope.id);
  const requested = ledger.requestRiskRegisterRevision(job.id, payload, { actor: 'project-manager' });
  assert.equal(requested.revision.status, 'pending_approval');
  assert.equal(requested.revision.integrityValid, true);
  assert.equal(requested.revision.riskCount, 1);
  assert.equal(requested.revision.highRiskCount, 0);
  assert.equal(requested.revision.totalExpectedValue, 1200);
  assert.equal(requested.revision.snapshot.risks[0].inherentScore, 16);
  assert.equal(requested.revision.snapshot.risks[0].residualScore, 6);
  assert.equal(requested.approval.targetType, 'risk_register');
  assert.equal(requested.approval.decision.preview.summary.totalExpectedValue, 1200);

  const replay = ledger.requestRiskRegisterRevision(job.id, payload, { actor: 'project-manager' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.revision.id, requested.revision.id);
  assert.throws(
    () => ledger.requestRiskRegisterRevision(job.id, { ...payload, title: 'Changed risk register title' }),
    error => error.code === 'risk_register_replay_conflict' && error.statusCode === 409
  );

  ledger.resolveApproval(requested.approval.id, {
    status: 'approved', resolvedBy: 'risk-approver', reason: 'Risk ownership and premortem evidence verified.'
  });
  const register = ledger.riskRegisterForJob(job.id);
  assert.equal(register.ready, true);
  assert.equal(register.currentRevision.id, requested.revision.id);
  const coverage = ledger.ledgerCapabilityCoverage({ jobDetail: ledger.getJobDetail(job.id) })
    .capabilities.find(capability => capability.key === 'preconstruction')
    .requirements.find(requirement => requirement.key === 'risk_register');
  assert.equal(coverage.status, 'ready');
  assert.equal(coverage.blockedFromAutonomy, true);
  assert.equal(ledger.diagnose().valid, true);
});

test('high residual risks require explicit acceptance and conflict with a low-change-risk pricing assertion', t => {
  const { ledger } = temporaryLedger(t);
  const job = createJob(ledger);
  const scope = approveScope(ledger, job.id, 'risk-register-scope-high-0001');
  const highRisk = riskPayload('risk-register-high-0001', scope.id);
  highRisk.risks[0] = { ...highRisk.risks[0], residualProbability: 4, residualImpact: 4 };
  assert.throws(
    () => ledger.requestRiskRegisterRevision(job.id, highRisk),
    error => error.code === 'risk_register_acceptance_required' && error.statusCode === 400
  );
  highRisk.risks[0].acceptanceReason = 'Escalated to the owner with a protected contingency and weekly review.';
  const risk = approveRisk(ledger, job.id, scope, highRisk.entryKey, { risks: highRisk.risks });
  assert.equal(risk.highRiskCount, 1);
  assert.throws(
    () => ledger.retainPricingBasisDecision(job.id, pricingPayload('risk-register-high-pricing-0001', scope, risk)),
    error => error.code === 'pricing_basis_risk_conflict' && error.statusCode === 409
  );
});

test('pricing and quotes bind the exact current risk revision and stale source evidence blocks approval', t => {
  const { ledger } = temporaryLedger(t);
  const job = createJob(ledger);
  const scope = approveScope(ledger, job.id, 'risk-register-scope-quote-0001');
  const risk = approveRisk(ledger, job.id, scope, 'risk-register-quote-0001');
  const pricing = ledger.retainPricingBasisDecision(job.id, pricingPayload('risk-register-pricing-0001', scope, risk)).decision;
  assert.equal(pricing.snapshot.source.riskRegister.revisionId, risk.id);

  const quote = ledger.createQuote(job.id, {
    commercialScopeRevisionId: scope.id,
    riskRegisterRevisionId: risk.id,
    pricingDecisionId: pricing.id,
    lineItems: [{ description: 'Retained apartment renovation', quantity: 1, unitPrice: 30_000 }]
  });
  assert.equal(quote.riskRegister.revisionId, risk.id);
  assert.equal(quote.riskRegisterIntegrityValid, true);
  assert.equal(quote.riskRegisterCurrent, true);

  approveScope(ledger, job.id, 'risk-register-scope-quote-0002', 'Apartment renovation scope revision 2');
  assert.equal(ledger.riskRegisterForJob(job.id).stale, true);
  assert.throws(
    () => ledger.resolveApproval(quote.approvalId, { status: 'approved', resolvedBy: 'approver', reason: 'Attempt stale quote approval.' }),
    error => ['commercial_scope_revision_stale', 'risk_register_source_stale', 'pricing_basis_decision_stale'].includes(error.code) && error.statusCode === 409
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).some(approval => approval.id === quote.approvalId), true);
});

test('migration 057 survives restart and diagnostics verify retained project risk registers', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-risk-register-restart-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  const ledger = new ContractorOperatingLedger({ dbFile });
  let restarted = null;
  t.after(() => {
    try { ledger.close(); } catch { /* already closed */ }
    try { restarted?.close(); } catch { /* already closed */ }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const job = createJob(ledger);
  const scope = approveScope(ledger, job.id, 'risk-register-scope-restart-0001');
  const risk = approveRisk(ledger, job.id, scope, 'risk-register-restart-0001');
  assert.equal(ledger.migrationStatus().currentVersion, '064_governed_installation_qc');
  ledger.close();

  restarted = new ContractorOperatingLedger({ dbFile });
  assert.equal(restarted.migrationStatus().currentVersion, '064_governed_installation_qc');
  assert.equal(restarted.getRiskRegisterRevision(risk.id).integrityValid, true);
  assert.equal(restarted.riskRegisterForJob(job.id).ready, true);
  assert.equal(restarted.diagnose().counts.riskRegisterRevisions, 1);
  assert.equal(restarted.diagnose().valid, true);
});
