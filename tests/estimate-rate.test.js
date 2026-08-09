const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-estimate-rate-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function createJob(ledger) {
  return ledger.createIntake({
    clientName: 'Rate Build-Up Client',
    title: 'Governed estimate rate fixture',
    service: 'renovation',
    assignAutomatically: false
  }, { actor: 'estimate-rate-test' });
}

function policy(overrides = {}) {
  return {
    entryKey: 'estimate-rate-policy-0001',
    reason: 'Establish the governed estimating assumptions for internal draft rates.',
    policyName: 'Standard governed rates',
    currency: 'EUR',
    labourClasses: [{ code: 'CRAFT', name: 'Qualified craft labour', baseHourlyRate: 40 }],
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
    targetMarginPercent: 20,
    ...overrides
  };
}

function approvePolicy(ledger, payload = policy()) {
  const requested = ledger.requestEstimateRatePolicy(payload, { actor: 'owner' });
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved',
    resolvedBy: 'commercial-approver',
    reason: 'Labour burden, overhead basis, and margin assumptions verified.'
  });
  return ledger.getEstimateRatePolicy(requested.policy.id);
}

function createTakeoffItem(ledger, jobId, description = 'Ceramic floor finish') {
  const takeoff = ledger.createTakeoff(jobId, {
    title: 'Rate build-up takeoff',
    currency: 'EUR',
    items: [{
      description,
      category: 'material',
      measurementType: 'manual',
      quantity: 1,
      unit: 'm2',
      unitCost: 20,
      unitPrice: 30,
      wbsCode: '03.20',
      workPackage: 'Floor finishes'
    }]
  }, { actor: 'estimator' });
  return { takeoff, item: takeoff.items[0] };
}

function buildUpPayload(overrides = {}) {
  return {
    entryKey: 'unit-rate-build-up-0001',
    labourClassCode: 'CRAFT',
    labourHoursPerUnit: 0.5,
    materialCostPerUnit: 20,
    equipmentCostPerUnit: 5,
    subcontractCostPerUnit: 0,
    otherDirectCostPerUnit: 2,
    targetMarginPercent: 20,
    ...overrides
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

test('estimating rate policies are approval-gated, replay-safe, and produce exact unit-rate arithmetic', t => {
  const ledger = temporaryLedger(t);
  const job = createJob(ledger);
  const { takeoff, item } = createTakeoffItem(ledger, job.id);
  const requested = ledger.requestEstimateRatePolicy(policy(), { actor: 'owner' });

  assert.equal(requested.policy.status, 'pending_approval');
  assert.equal(requested.policy.integrityValid, true);
  assert.equal(requested.policy.derived.totalBurdenPercent, 40);
  assert.equal(requested.policy.derived.labourClasses[0].cashBurdenedHourlyRate, 56);
  assert.equal(requested.policy.derived.labourClasses[0].fullyBurdenedHourlyRate, 80);
  assert.equal(requested.policy.derived.overheadPerLabourHour, 30);
  assert.equal(ledger.activeEstimateRatePolicy(), null);
  assert.throws(
    () => ledger.applyTakeoffUnitRate(job.id, takeoff.id, item.id, buildUpPayload()),
    error => error.code === 'estimate_rate_policy_required' && error.statusCode === 409
  );

  const replay = ledger.requestEstimateRatePolicy(policy(), { actor: 'owner' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.policy.id, requested.policy.id);
  assert.throws(
    () => ledger.requestEstimateRatePolicy(policy({ targetMarginPercent: 21 }), { actor: 'owner' }),
    error => error.code === 'estimate_rate_policy_replay_conflict' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.requestEstimateRatePolicy(policy({ entryKey: 'estimate-rate-policy-0002' }), { actor: 'owner' }),
    error => error.code === 'estimate_rate_policy_pending' && error.statusCode === 409
  );

  ledger.resolveApproval(requested.approval.id, {
    status: 'approved',
    resolvedBy: 'commercial-approver',
    reason: 'Labour burden, overhead basis, and margin assumptions verified.'
  });
  const active = ledger.activeEstimateRatePolicy();
  assert.equal(active.id, requested.policy.id);
  assert.equal(active.status, 'approved');

  const applied = ledger.applyTakeoffUnitRate(job.id, takeoff.id, item.id, {
    ...buildUpPayload(),
    policyId: active.id
  }, { actor: 'estimator' });
  assert.equal(applied.replayed, false);
  assert.equal(applied.item.rateIntegrityValid, true);
  assert.equal(applied.item.ratePolicyId, active.id);
  assert.equal(applied.item.rateBuildUp.calculation.labourCostPerUnit, 40);
  assert.equal(applied.item.rateBuildUp.calculation.directCostPerUnit, 67);
  assert.equal(applied.item.rateBuildUp.calculation.overheadRecoveryPerUnit, 15);
  assert.equal(applied.item.rateBuildUp.calculation.unitCost, 82);
  assert.equal(applied.item.rateBuildUp.calculation.unitSellRate, 102.5);
  assert.equal(applied.item.rateBuildUp.calculation.marginAmountPerUnit, 20.5);
  assert.equal(applied.item.rateBuildUp.calculation.markupPercent, 25);
  assert.equal(applied.item.unitCost, 82);
  assert.equal(applied.item.unitPrice, 102.5);

  const buildReplay = ledger.applyTakeoffUnitRate(job.id, takeoff.id, item.id, {
    ...buildUpPayload(),
    policyId: active.id
  });
  assert.equal(buildReplay.replayed, true);
  assert.equal(buildReplay.item.rateBuildUpHash, applied.item.rateBuildUpHash);
  assert.throws(
    () => ledger.applyTakeoffUnitRate(job.id, takeoff.id, item.id, {
      ...buildUpPayload({ materialCostPerUnit: 21 }),
      policyId: active.id
    }),
    error => error.code === 'unit_rate_replay_conflict' && error.statusCode === 409
  );

  const nonRateEdit = ledger.updateTakeoffItem(job.id, takeoff.id, item.id, {
    description: 'Ceramic floor finish revised description',
    quantity: 2
  }, { actor: 'estimator' });
  assert.equal(nonRateEdit.item.rateBuildUpHash, applied.item.rateBuildUpHash);
  assert.equal(nonRateEdit.item.rateIntegrityValid, true);

  const invalidated = ledger.updateTakeoffItem(job.id, takeoff.id, item.id, {
    unitCost: 83
  }, { actor: 'estimator' });
  assert.equal(invalidated.item.ratePolicyId, null);
  assert.equal(invalidated.item.rateBuildUpHash, null);
  assert.equal(invalidated.item.rateBuildUp, null);
  assert.equal(invalidated.item.data.rateBuildUpInvalidated.reason, 'manual_rate_or_unit_change');
  assert.equal(ledger.diagnose().valid, true);
  assert.equal(ledger.migrationStatus().currentVersion, '068_operational_safety_controls');
});

test('rate-policy revisions preserve historical build-ups and conversion retains their source trace', t => {
  const ledger = temporaryLedger(t);
  const job = createJob(ledger);
  const { takeoff, item } = createTakeoffItem(ledger, job.id, 'Historic rate trace');
  const firstPolicy = approvePolicy(ledger);
  const firstBuild = ledger.applyTakeoffUnitRate(job.id, takeoff.id, item.id, {
    ...buildUpPayload(),
    policyId: firstPolicy.id
  });

  const secondPolicy = approvePolicy(ledger, policy({
    entryKey: 'estimate-rate-policy-0002',
    reason: 'Adopt a direct-cost recovery basis after the annual overhead review.',
    policyName: 'Direct-cost recovery rates',
    labourClasses: [{ code: 'CRAFT', name: 'Qualified craft labour', baseHourlyRate: 50 }],
    labourBurden: {
      paidLeavePercent: 0,
      statutoryEmployerCostsPercent: 0,
      pensionBenefitsPercent: 0,
      insuranceOtherPercent: 0,
      productiveUtilizationPercent: 100
    },
    overheadRecovery: {
      method: 'direct_cost_percent',
      annualOverhead: 0,
      annualProductiveLabourHours: 0,
      directCostPercent: 10
    },
    targetMarginPercent: 25
  }));
  assert.equal(ledger.getEstimateRatePolicy(firstPolicy.id).status, 'superseded');
  assert.equal(ledger.getTakeoff(job.id, takeoff.id).items[0].rateBuildUpHash, firstBuild.item.rateBuildUpHash);
  assert.equal(ledger.getTakeoff(job.id, takeoff.id).items[0].rateIntegrityValid, true);

  const rerated = ledger.applyTakeoffUnitRate(job.id, takeoff.id, item.id, {
    entryKey: 'unit-rate-build-up-0002',
    policyId: secondPolicy.id,
    labourClassCode: 'CRAFT',
    labourHoursPerUnit: 1,
    materialCostPerUnit: 10,
    equipmentCostPerUnit: 0,
    subcontractCostPerUnit: 0,
    otherDirectCostPerUnit: 0,
    targetMarginPercent: 25
  });
  assert.equal(rerated.item.rateBuildUp.policy.versionNumber, 2);
  assert.equal(rerated.item.rateBuildUp.calculation.directCostPerUnit, 60);
  assert.equal(rerated.item.rateBuildUp.calculation.overheadRecoveryPerUnit, 6);
  assert.equal(rerated.item.rateBuildUp.calculation.unitCost, 66);
  assert.equal(rerated.item.rateBuildUp.calculation.unitSellRate, 88);

  const converted = ledger.convertTakeoffToQuote(job.id, takeoff.id, {}, { actor: 'commercial-estimator' });
  assert.equal(converted.takeoff.status, 'converted');
  assert.equal(converted.takeoff.integrityValid, true);
  assert.equal(converted.takeoff.items[0].rateIntegrityValid, true);
  assert.equal(converted.takeoff.items[0].rateBuildUp.policy.id, secondPolicy.id);
  assert.equal(converted.quote.data.source.snapshotHash, converted.takeoff.snapshotHash);
  assert.equal(ledger.convertTakeoffToQuote(job.id, takeoff.id).replayed, true);
  assert.equal(ledger.diagnose().valid, true);
});

test('unit-rate verification rejects a self-consistent embedded policy that is not the referenced retained policy', t => {
  const ledger = temporaryLedger(t);
  const job = createJob(ledger);
  const { takeoff, item } = createTakeoffItem(ledger, job.id, 'Source-bound rate fixture');
  const active = approvePolicy(ledger);
  const applied = ledger.applyTakeoffUnitRate(job.id, takeoff.id, item.id, {
    ...buildUpPayload(),
    policyId: active.id
  });

  const row = ledger.db.prepare('SELECT * FROM takeoff_items WHERE id = ?').get(item.id);
  const data = JSON.parse(row.data_json);
  data.rateBuildUp.policySnapshot.labourClasses[0].baseHourlyRate = 41;
  data.rateBuildUp.policy.snapshotHash = sha256(JSON.stringify(data.rateBuildUp.policySnapshot));
  Object.assign(data.rateBuildUp.calculation, {
    baseHourlyRate: 41,
    cashBurdenedHourlyRate: 57.4,
    fullyBurdenedHourlyRate: 82,
    labourCostPerUnit: 41,
    directCostPerUnit: 68,
    overheadRecoveryPerUnit: 15,
    unitCost: 83,
    unitSellRate: 103.75,
    marginAmountPerUnit: 20.75,
    markupPercent: 25
  });
  const forgedHash = sha256(JSON.stringify(data.rateBuildUp));
  ledger.db.prepare(`
    UPDATE takeoff_items
    SET unit_cost = 83, unit_price = 103.75, total_cost = 83, total_price = 103.75,
        rate_build_up_hash = ?, data_json = ?
    WHERE id = ?
  `).run(forgedHash, JSON.stringify(data), item.id);
  ledger.refreshTakeoffTotals(takeoff.id);

  const forged = ledger.getTakeoff(job.id, takeoff.id).items[0];
  assert.notEqual(forged.rateBuildUpHash, applied.item.rateBuildUpHash);
  assert.equal(forged.rateIntegrityValid, false);
  assert.throws(
    () => ledger.convertTakeoffToQuote(job.id, takeoff.id),
    error => error.code === 'takeoff_rate_integrity_failed' && error.statusCode === 409
  );
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => issue.message.includes(`takeoff item ${item.id} failed retained unit-rate build-up verification`)));
});

test('a rejected rate-policy revision is retained and no longer blocks a replacement request', t => {
  const ledger = temporaryLedger(t);
  const first = ledger.requestEstimateRatePolicy(policy(), { actor: 'owner' });
  ledger.resolveApproval(first.approval.id, {
    status: 'rejected',
    resolvedBy: 'commercial-approver',
    reason: 'Annual productive hours require correction before approval.'
  });
  assert.equal(ledger.getEstimateRatePolicy(first.policy.id).status, 'rejected');
  assert.equal(ledger.activeEstimateRatePolicy(), null);

  const replacement = ledger.requestEstimateRatePolicy(policy({
    entryKey: 'estimate-rate-policy-0002',
    reason: 'Correct the annual productive hours after the approval review.',
    overheadRecovery: {
      method: 'labor_hour',
      annualOverhead: 60_000,
      annualProductiveLabourHours: 2_100,
      directCostPercent: 0
    }
  }), { actor: 'owner' });
  assert.equal(replacement.policy.versionNumber, 2);
  assert.equal(replacement.policy.status, 'pending_approval');
  assert.equal(ledger.diagnose().valid, true);
});
