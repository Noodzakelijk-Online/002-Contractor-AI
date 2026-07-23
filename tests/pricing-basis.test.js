const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger, PRICING_BASIS_FACTORS } = require('../operating-ledger');
const { approveLowRiskRegister } = require('./risk-register-fixture');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-pricing-basis-'));
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
    clientName: 'Pricing Basis Client',
    title: 'Pricing basis renovation',
    service: 'renovation',
    description: 'Measured interior renovation with retained estimate evidence.',
    estimatedHours: 120,
    estimatedCost: 18_000,
    assignAutomatically: false
  }, { actor: 'pricing-basis-test' });
}

function factors(overrides = {}) {
  return PRICING_BASIS_FACTORS.map(factor => ({
    key: factor.key,
    status: overrides[factor.key] || 'yes',
    evidence: `${factor.label} is supported by retained project evidence.`
  }));
}

function decisionPayload(entryKey, overrides = {}) {
  return {
    entryKey,
    factors: factors(overrides.factors || {}),
    selectedModel: overrides.selectedModel || 'fixed_price',
    rationale: overrides.rationale || 'The retained commercial evidence supports the selected contract pricing model.',
    ...(overrides.overrideReason ? { overrideReason: overrides.overrideReason } : {})
  };
}

function createTakeoff(ledger, jobId) {
  return ledger.createTakeoff(jobId, {
    title: 'Retained commercial takeoff',
    currency: 'EUR',
    items: [{
      description: 'Measured installation package',
      category: 'labor',
      measurementType: 'manual',
      quantity: 40,
      unit: 'hour',
      unitCost: 45,
      unitPrice: 75,
      wbsCode: '02.10',
      workPackage: 'Installation labour'
    }]
  }, { actor: 'estimator' });
}

function approveScope(ledger, jobId, entryKey) {
  const requested = ledger.requestCommercialScopeRevision(jobId, {
    entryKey,
    title: 'Pricing-basis commercial scope',
    scopeSummary: 'Complete the measured renovation within the retained work boundary.',
    inclusions: ['Complete the measured installation package.'],
    assumptions: ['Existing site services remain usable.'],
    exclusions: ['Hazardous-material removal is excluded.'],
    allowanceMode: 'none',
    noAllowanceReason: 'No provisional sums or selection allowances apply.',
    reason: 'Establish the written scope before selecting the pricing basis.'
  }, { actor: 'estimator' });
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved', resolvedBy: 'commercial-approver', reason: 'Written scope verified.'
  });
  const scope = ledger.getCommercialScopeRevision(requested.revision.id);
  approveLowRiskRegister(ledger, jobId, scope, `${entryKey}-risk`);
  return scope;
}

test('pricing-basis decision tree is deterministic and requires evidence for overrides', t => {
  const { ledger } = temporaryLedger(t);
  const job = createJob(ledger);
  approveScope(ledger, job.id, 'pricing-basis-scope-tree-0001');

  const fixed = ledger.evaluatePricingBasisDecision(job.id, { factors: factors() }, { strict: true });
  assert.equal(fixed.score, 100);
  assert.equal(fixed.recommendation, 'fixed_price');
  assert.deepEqual(fixed.blockers, []);
  assert.deepEqual(fixed.evidenceGaps, []);

  const timeAndMaterials = ledger.evaluatePricingBasisDecision(job.id, {
    factors: factors({ site_conditions_known: 'no' })
  }, { strict: true });
  assert.equal(timeAndMaterials.score, 85);
  assert.equal(timeAndMaterials.recommendation, 'time_and_materials');
  assert.deepEqual(timeAndMaterials.blockers, ['site_conditions_known']);

  const review = ledger.evaluatePricingBasisDecision(job.id, {
    factors: factors({ selections_locked: 'unknown' })
  }, { strict: true });
  assert.equal(review.recommendation, 'review');
  assert.deepEqual(review.evidenceGaps, ['selections_locked']);

  assert.throws(
    () => ledger.retainPricingBasisDecision(job.id, decisionPayload('pricing-basis-override-0001', {
      factors: { site_conditions_known: 'no' },
      selectedModel: 'fixed_price'
    })),
    error => error.code === 'pricing_basis_override_reason_required' && error.statusCode === 400
  );
  const overridden = ledger.retainPricingBasisDecision(job.id, decisionPayload('pricing-basis-override-0002', {
    factors: { site_conditions_known: 'no' },
    selectedModel: 'fixed_price',
    overrideReason: 'A capped investigation allowance transfers the remaining site-condition exposure.'
  }), { actor: 'commercial-manager' });
  assert.equal(overridden.decision.snapshot.override, true);
  assert.equal(overridden.decision.integrityValid, true);
  assert.equal(overridden.externalCommitments, 0);
});

test('pricing-basis decisions are replay-safe, versioned, and stale when estimate evidence changes', t => {
  const { ledger } = temporaryLedger(t);
  const job = createJob(ledger);
  const missingCoverage = ledger.ledgerCapabilityCoverage({ jobDetail: ledger.getJobDetail(job.id) })
    .capabilities.find(capability => capability.key === 'preconstruction')
    .requirements.find(requirement => requirement.key === 'pricing_basis');
  assert.equal(missingCoverage.status, 'missing');
  assert.equal(missingCoverage.covered, false);
  const takeoff = createTakeoff(ledger, job.id);
  approveScope(ledger, job.id, 'pricing-basis-scope-version-0001');
  const payload = decisionPayload('pricing-basis-version-0001');
  const first = ledger.retainPricingBasisDecision(job.id, payload, { actor: 'estimator' });
  const readyCoverage = ledger.ledgerCapabilityCoverage({ jobDetail: ledger.getJobDetail(job.id) })
    .capabilities.find(capability => capability.key === 'preconstruction')
    .requirements.find(requirement => requirement.key === 'pricing_basis');
  assert.equal(readyCoverage.status, 'ready');
  assert.equal(readyCoverage.covered, true);
  const replay = ledger.retainPricingBasisDecision(job.id, payload, { actor: 'estimator' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.decision.id, first.decision.id);
  assert.throws(
    () => ledger.retainPricingBasisDecision(job.id, { ...payload, rationale: 'Different retained rationale for the same idempotency key.' }),
    error => error.code === 'pricing_basis_replay_conflict' && error.statusCode === 409
  );

  const second = ledger.retainPricingBasisDecision(job.id, decisionPayload('pricing-basis-version-0002', {
    factors: { scope_defined: 'no' },
    selectedModel: 'time_and_materials'
  }), { actor: 'commercial-manager' });
  assert.equal(second.decision.versionNumber, 2);
  assert.equal(ledger.getPricingBasisDecision(first.decision.id).status, 'superseded');
  assert.equal(ledger.pricingBasisForJob(job.id).currentDecision.id, second.decision.id);

  ledger.updateTakeoffItem(job.id, takeoff.id, takeoff.items[0].id, { quantity: 42 }, { actor: 'estimator' });
  const basis = ledger.pricingBasisForJob(job.id);
  assert.equal(basis.stale, true);
  const staleCoverage = ledger.ledgerCapabilityCoverage({ jobDetail: ledger.getJobDetail(job.id) })
    .capabilities.find(capability => capability.key === 'preconstruction')
    .requirements.find(requirement => requirement.key === 'pricing_basis');
  assert.equal(staleCoverage.status, 'action_required');
  assert.equal(staleCoverage.openCount, 1);
  assert.throws(
    () => ledger.assertPricingBasisDecisionCurrent(job.id, second.decision.id),
    error => error.code === 'pricing_basis_decision_stale' && error.statusCode === 409
  );
  assert.equal(ledger.diagnose().issues.some(issue => issue.message.includes(second.decision.id) && issue.severity === 'warning'), true);
});

test('quotes retain pricing intent and approval rolls back atomically after supersession or tampering', t => {
  const { ledger } = temporaryLedger(t);
  const job = createJob(ledger);
  const takeoff = createTakeoff(ledger, job.id);
  approveScope(ledger, job.id, 'pricing-basis-scope-quote-0001');
  const fixed = ledger.retainPricingBasisDecision(job.id, decisionPayload('pricing-basis-quote-0001'), { actor: 'estimator' }).decision;
  const converted = ledger.convertTakeoffToQuote(job.id, takeoff.id, {
    pricingDecisionId: fixed.id,
    notes: 'Fixed-price estimate based on the retained scope and quantities.'
  }, { actor: 'estimator' });
  assert.equal(converted.quote.pricingModel, 'fixed_price');
  assert.equal(converted.quote.pricingBasisIntegrityValid, true);
  assert.equal(converted.quote.pricingBasisCurrent, true);
  assert.equal(converted.quote.data.pricingBasis.decisionSnapshotHash, fixed.snapshotHash);

  const timeAndMaterials = ledger.retainPricingBasisDecision(job.id, decisionPayload('pricing-basis-quote-0002', {
    factors: { scope_defined: 'no' },
    selectedModel: 'time_and_materials'
  }), { actor: 'commercial-manager' }).decision;
  assert.throws(
    () => ledger.resolveApproval(converted.quote.approvalId, {
      status: 'approved',
      resolvedBy: 'commercial-approver',
      reason: 'Commercial basis reviewed.'
    }),
    error => error.code === 'pricing_basis_decision_stale' && error.statusCode === 409
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).some(approval => approval.id === converted.quote.approvalId), true);
  assert.equal(ledger.getJobDetail(job.id).quotes.find(quote => quote.id === converted.quote.id).status, 'draft');

  const currentQuote = ledger.createQuote(job.id, {
    pricingDecisionId: timeAndMaterials.id,
    lineItems: [{ description: 'T&M budget estimate', quantity: 40, unitPrice: 75 }]
  }, { actor: 'estimator' });
  ledger.resolveApproval(currentQuote.approvalId, {
    status: 'approved',
    resolvedBy: 'commercial-approver',
    reason: 'Time-and-materials basis and budget estimate verified.'
  });
  assert.equal(ledger.getJobDetail(job.id).quotes.find(quote => quote.id === currentQuote.id).status, 'approved');
  ledger.db.prepare("UPDATE quotes SET status = 'accepted' WHERE id = ?").run(currentQuote.id);
  const commercial = ledger.recalculateCommercialContractValue(job.id);
  assert.equal(commercial.pricingModel, 'time_and_materials');
  assert.equal(commercial.budgetEstimateNet, 3000);
  assert.equal(commercial.contractValue, 18000);
  assert.equal(ledger.getJobDetail(job.id).data.commercialBudgetEstimateNet, 3000);

  const tamperedQuote = ledger.createQuote(job.id, {
    pricingDecisionId: timeAndMaterials.id,
    lineItems: [{ description: 'Tamper probe', quantity: 1, unitPrice: 100 }]
  });
  const row = ledger.db.prepare('SELECT snapshot_json FROM pricing_basis_decisions WHERE id = ?').get(timeAndMaterials.id);
  ledger.db.prepare('UPDATE pricing_basis_decisions SET snapshot_json = ? WHERE id = ?')
    .run(JSON.stringify({ tampered: true }), timeAndMaterials.id);
  assert.throws(
    () => ledger.resolveApproval(tamperedQuote.approvalId, { status: 'approved', resolvedBy: 'commercial-approver' }),
    error => error.code === 'pricing_basis_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).some(approval => approval.id === tamperedQuote.approvalId), true);
  ledger.db.prepare('UPDATE pricing_basis_decisions SET snapshot_json = ? WHERE id = ?').run(row.snapshot_json, timeAndMaterials.id);
});

test('migration 057 survives restart and diagnostics verify retained pricing decisions', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-pricing-basis-restart-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  const ledger = new ContractorOperatingLedger({ dbFile });
  let restarted = null;
  t.after(() => {
    try { ledger.close(); } catch { /* already closed */ }
    try { restarted?.close(); } catch { /* already closed */ }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const job = createJob(ledger);
  createTakeoff(ledger, job.id);
  approveScope(ledger, job.id, 'pricing-basis-scope-restart-0001');
  const retained = ledger.retainPricingBasisDecision(job.id, decisionPayload('pricing-basis-restart-0001'));
  assert.equal(ledger.migrationStatus().currentVersion, '062_governed_five_s');
  assert.equal(ledger.diagnose().valid, true);
  ledger.close();

  restarted = new ContractorOperatingLedger({ dbFile });
  assert.equal(restarted.migrationStatus().currentVersion, '062_governed_five_s');
  assert.equal(restarted.getPricingBasisDecision(retained.decision.id).integrityValid, true);
  assert.equal(restarted.diagnose().counts.pricingBasisDecisions, 1);
  assert.equal(restarted.diagnose().valid, true);
});
