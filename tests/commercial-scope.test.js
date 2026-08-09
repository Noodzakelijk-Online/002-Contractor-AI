const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger, PRICING_BASIS_FACTORS } = require('../operating-ledger');
const { approveLowRiskRegister } = require('./risk-register-fixture');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-commercial-scope-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  const ledger = new ContractorOperatingLedger({ dbFile });
  t.after(() => {
    try { ledger.close(); } catch { /* already closed */ }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, dbFile };
}

function createJob(ledger) {
  const job = ledger.createIntake({
    clientName: 'Commercial Scope Client',
    clientEmail: 'scope@example.test',
    title: 'Canal house renovation',
    service: 'renovation',
    description: 'Renovate the retained kitchen and utility-room footprint.',
    address: 'Keizersgracht 100',
    city: 'Amsterdam',
    estimatedHours: 180,
    estimatedCost: 28_000,
    assignAutomatically: false
  }, { actor: 'commercial-scope-test' });
  const takeoff = ledger.createTakeoff(job.id, {
    title: 'Measured renovation scope',
    currency: 'EUR',
    items: [{
      description: 'Cabinet and finish installation',
      category: 'labor',
      measurementType: 'manual',
      quantity: 80,
      unit: 'hour',
      unitCost: 48,
      unitPrice: 78,
      wbsCode: '06.10',
      workPackage: 'Interior installation'
    }]
  }, { actor: 'estimator' });
  return { job, takeoff };
}

function scopePayload(entryKey, overrides = {}) {
  return {
    entryKey,
    title: overrides.title || 'Kitchen renovation commercial scope',
    scopeSummary: overrides.scopeSummary || 'Complete the measured kitchen renovation within the retained room boundary.',
    inclusions: overrides.inclusions || [
      'Protect the retained access route and adjacent finishes.',
      'Install the measured cabinetry, worktop, and finish package.'
    ],
    assumptions: overrides.assumptions || [
      'Existing structural openings remain unchanged.',
      'Client selections are confirmed before the retained clarification deadline.'
    ],
    exclusions: overrides.exclusions || [
      'Hazardous-material removal is excluded.',
      'Utility upgrades outside the retained room boundary are excluded.'
    ],
    clientResponsibilities: ['Provide clear access and approve selections by the stated deadline.'],
    contractorResponsibilities: ['Protect occupied areas and retain completion evidence.'],
    currency: 'EUR',
    allowanceMode: overrides.allowanceMode || 'defined',
    allowances: overrides.allowances || [{
      allowanceKey: 'ALLOW-TILE',
      allowanceType: 'selection_allowance',
      title: 'Wall tile supply',
      description: 'Client-selected wall tile supply allowance excluding installation.',
      quantity: 20,
      unit: 'm2',
      unitRate: 45,
      reconciliationMethod: 'actual_cost_variation',
      selectionBy: 'client',
      evidenceReference: 'Survey schedule S-01'
    }],
    noAllowanceReason: overrides.noAllowanceReason,
    clarificationDeadline: '2026-08-15',
    reason: overrides.reason || 'Establish the written commercial basis before pricing and quote approval.'
  };
}

function pricingPayload(entryKey, commercialScopeRevisionId) {
  return {
    entryKey,
    commercialScopeRevisionId,
    selectedModel: 'fixed_price',
    rationale: 'The approved written scope and retained estimate evidence support fixed-price delivery.',
    factors: PRICING_BASIS_FACTORS.map(factor => ({
      key: factor.key,
      status: 'yes',
      evidence: `${factor.label} is verified against the approved commercial scope.`
    }))
  };
}

function approveScope(ledger, jobId, entryKey, overrides = {}) {
  const requested = ledger.requestCommercialScopeRevision(jobId, scopePayload(entryKey, overrides), { actor: 'estimator' });
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved',
    resolvedBy: 'commercial-approver',
    reason: 'Written scope, source evidence, exclusions, and allowances verified.'
  });
  const scope = ledger.getCommercialScopeRevision(requested.revision.id);
  approveLowRiskRegister(ledger, jobId, scope, `${entryKey}-risk`);
  return scope;
}

function configureOrganization(ledger) {
  ledger.updateOrganizationProfile({
    legalName: 'Contractor AI Test B.V.',
    tradingName: 'Contractor AI Test',
    registrationNumber: '12345678',
    vatNumber: 'NL123456789B01',
    email: 'office@example.test',
    phone: '+31 20 123 4567',
    address: 'Teststraat 1',
    postalCode: '1011AA',
    city: 'Amsterdam',
    country: 'NL',
    defaultPaymentTermsDays: 30,
    defaultQuoteValidityDays: 30
  }, { actor: 'owner' });
}

test('commercial scope revisions are explicit, replay-safe, approval-gated, and capability-visible', t => {
  const { ledger } = temporaryLedger(t);
  const { job } = createJob(ledger);

  assert.throws(
    () => ledger.retainPricingBasisDecision(job.id, pricingPayload('scope-pricing-before-approval', 'missing')),
    error => error.code === 'commercial_scope_required' && error.statusCode === 409
  );

  const payload = scopePayload('commercial-scope-version-0001');
  const requested = ledger.requestCommercialScopeRevision(job.id, payload, { actor: 'estimator' });
  assert.equal(requested.revision.status, 'pending_approval');
  assert.equal(requested.revision.integrityValid, true);
  assert.equal(requested.revision.allowanceTotal, 900);
  assert.equal(requested.approval.targetType, 'commercial_scope');
  assert.equal(requested.externalCommitments, 0);

  const replay = ledger.requestCommercialScopeRevision(job.id, payload, { actor: 'estimator' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.revision.id, requested.revision.id);
  assert.throws(
    () => ledger.requestCommercialScopeRevision(job.id, { ...payload, scopeSummary: 'A materially different scope using the same entry key.' }),
    error => error.code === 'commercial_scope_replay_conflict' && error.statusCode === 409
  );

  const pendingCoverage = ledger.ledgerCapabilityCoverage({ jobDetail: ledger.getJobDetail(job.id) })
    .capabilities.find(capability => capability.key === 'preconstruction')
    .requirements.find(requirement => requirement.key === 'commercial_scope');
  assert.equal(pendingCoverage.status, 'action_required');

  ledger.resolveApproval(requested.approval.id, {
    status: 'approved',
    resolvedBy: 'commercial-approver',
    reason: 'All written commercial terms and source evidence verified.'
  });
  const register = ledger.commercialScopeForJob(job.id);
  assert.equal(register.ready, true);
  assert.equal(register.currentRevision.id, requested.revision.id);
  assert.equal(register.currentRevision.snapshot.inclusions.length, 2);
  assert.equal(register.currentRevision.snapshot.assumptions.length, 2);
  assert.equal(register.currentRevision.snapshot.exclusions.length, 2);
  assert.equal(register.currentRevision.snapshot.allowances[0].amount, 900);

  const readyCoverage = ledger.ledgerCapabilityCoverage({ jobDetail: ledger.getJobDetail(job.id) })
    .capabilities.find(capability => capability.key === 'preconstruction')
    .requirements.find(requirement => requirement.key === 'commercial_scope');
  assert.equal(readyCoverage.status, 'ready');
  assert.equal(ledger.diagnose().valid, true);
});

test('scope approval and downstream pricing fail atomically when retained source evidence changes', t => {
  const { ledger } = temporaryLedger(t);
  const { job, takeoff } = createJob(ledger);
  const requested = ledger.requestCommercialScopeRevision(job.id, scopePayload('commercial-scope-stale-0001'));
  ledger.updateTakeoffItem(job.id, takeoff.id, takeoff.items[0].id, { quantity: 84 }, { actor: 'estimator' });

  assert.throws(
    () => ledger.resolveApproval(requested.approval.id, {
      status: 'approved',
      resolvedBy: 'commercial-approver',
      reason: 'Attempt approval after source change.'
    }),
    error => error.code === 'commercial_scope_source_stale' && error.statusCode === 409
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).some(approval => approval.id === requested.approval.id), true);
  assert.equal(ledger.getCommercialScopeRevision(requested.revision.id).status, 'pending_approval');

  ledger.resolveApproval(requested.approval.id, {
    status: 'rejected',
    resolvedBy: 'commercial-approver',
    reason: 'Refresh the scope against the changed measured quantity.'
  });
  const current = approveScope(ledger, job.id, 'commercial-scope-stale-0002');
  assert.equal(current.status, 'approved');

  ledger.updateTakeoffItem(job.id, takeoff.id, takeoff.items[0].id, { quantity: 86 }, { actor: 'estimator' });
  assert.equal(ledger.commercialScopeForJob(job.id).stale, true);
  assert.throws(
    () => ledger.retainPricingBasisDecision(job.id, pricingPayload('scope-pricing-stale-0001', current.id)),
    error => error.code === 'commercial_scope_source_stale' && error.statusCode === 409
  );
  assert.equal(ledger.diagnose().issues.some(issue => issue.message.includes(current.id) && issue.severity === 'warning'), true);
});

test('quotes bind the exact approved scope and issue packages render written terms and allowances', t => {
  const { ledger } = temporaryLedger(t);
  const { job } = createJob(ledger);
  configureOrganization(ledger);
  const scope = approveScope(ledger, job.id, 'commercial-scope-quote-0001');
  const basis = ledger.retainPricingBasisDecision(job.id, pricingPayload('commercial-scope-pricing-0001', scope.id), { actor: 'estimator' }).decision;
  const quote = ledger.createQuote(job.id, {
    commercialScopeRevisionId: scope.id,
    pricingDecisionId: basis.id,
    currency: 'EUR',
    validUntil: '2026-09-01',
    lineItems: [{ description: 'Complete retained renovation package', quantity: 1, unitPrice: 32_000 }]
  }, { actor: 'estimator' });
  assert.equal(quote.commercialScope.revisionId, scope.id);
  assert.equal(quote.commercialScopeIntegrityValid, true);
  assert.equal(quote.commercialScopeCurrent, true);

  const secondRequest = ledger.requestCommercialScopeRevision(job.id, scopePayload('commercial-scope-quote-0002', {
    title: 'Kitchen renovation commercial scope revision 2',
    reason: 'Clarify the retained finish boundary before quote approval.'
  }));
  ledger.resolveApproval(secondRequest.approval.id, {
    status: 'approved', resolvedBy: 'commercial-approver', reason: 'Revised boundary verified.'
  });
  assert.throws(
    () => ledger.resolveApproval(quote.approvalId, {
      status: 'approved', resolvedBy: 'commercial-approver', reason: 'Attempt stale quote approval.'
    }),
    error => ['commercial_scope_revision_stale', 'pricing_basis_decision_stale'].includes(error.code) && error.statusCode === 409
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).some(approval => approval.id === quote.approvalId), true);

  const secondScope = ledger.getCommercialScopeRevision(secondRequest.revision.id);
  approveLowRiskRegister(ledger, job.id, secondScope, 'commercial-scope-quote-risk-0002');
  const secondBasis = ledger.retainPricingBasisDecision(job.id, pricingPayload('commercial-scope-pricing-0002', secondScope.id), { actor: 'estimator' }).decision;
  const currentQuote = ledger.createQuote(job.id, {
    commercialScopeRevisionId: secondScope.id,
    pricingDecisionId: secondBasis.id,
    currency: 'EUR',
    validUntil: '2026-09-01',
    notes: 'All changes require separate written approval.',
    lineItems: [{ description: 'Complete retained renovation package', quantity: 1, unitPrice: 32_500 }]
  }, { actor: 'estimator' });
  ledger.resolveApproval(currentQuote.approvalId, {
    status: 'approved', resolvedBy: 'commercial-approver', reason: 'Current written scope and pricing basis verified.'
  });
  const issued = ledger.prepareQuoteIssuePackage(job.id, currentQuote.id, { actor: 'office-operator' });
  assert.equal(issued.externalCommitments, 0);
  assert.match(issued.document.data.snapshot.quote.commercialScope.snapshot.scopeSummary, /Complete the measured kitchen renovation/);
  assert.equal(issued.document.data.snapshot.quote.commercialScope.snapshot.allowanceTotal, 900);
  const downloaded = ledger.getQuoteIssuePackage(issued.document.id, { audit: false });
  assert.match(downloaded.html, /Included work/);
  assert.match(downloaded.html, /Assumptions/);
  assert.match(downloaded.html, /Exclusions/);
  assert.match(downloaded.html, /Allowances and provisional sums/);
  assert.match(downloaded.html, /Wall tile supply/);
  assert.match(downloaded.html, /actual cost variation/);
});

test('migration 057 survives restart and diagnostics verify retained scope revisions', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-commercial-scope-restart-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  const ledger = new ContractorOperatingLedger({ dbFile });
  let restarted = null;
  t.after(() => {
    try { ledger.close(); } catch { /* already closed */ }
    try { restarted?.close(); } catch { /* already closed */ }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const { job } = createJob(ledger);
  const revision = approveScope(ledger, job.id, 'commercial-scope-restart-0001');
  assert.equal(ledger.migrationStatus().currentVersion, '070_managed_operator_accounts');
  assert.equal(ledger.diagnose().valid, true);
  ledger.close();

  restarted = new ContractorOperatingLedger({ dbFile });
  assert.equal(restarted.migrationStatus().currentVersion, '070_managed_operator_accounts');
  assert.equal(restarted.getCommercialScopeRevision(revision.id).integrityValid, true);
  assert.equal(restarted.commercialScopeForJob(job.id).ready, true);
  assert.equal(restarted.diagnose().counts.commercialScopeRevisions, 1);
  assert.equal(restarted.diagnose().valid, true);
});
