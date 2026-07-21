const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger, BID_DECISION_CRITERIA, BID_DECISION_GATES } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-bid-decision-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function marketPolicy(overrides = {}) {
  return {
    entryKey: 'bid-decision-market-policy-0001',
    reason: 'Set current market-fit evidence before governing pursuit decisions.',
    profileName: 'Bid decision market focus',
    services: ['Renovation'],
    clientSegments: ['Homeowner'],
    sourceChannels: ['Referral'],
    minJobValue: 5_000,
    maxJobValue: 150_000,
    fitThreshold: 70,
    serviceAreas: [{ label: 'Arnhem pursuit area', country: 'NL', postalPrefixes: ['68'], cities: ['Arnhem'] }],
    ...overrides
  };
}

function decisionPolicy(overrides = {}) {
  return {
    entryKey: 'bid-decision-policy-0001',
    reason: 'Adopt the weighted pursuit scorecard and explicit commercial gates.',
    policyName: 'Standard pursuit scorecard',
    bidThreshold: 70,
    noBidThreshold: 45,
    criteria: BID_DECISION_CRITERIA.map(criterion => ({
      key: criterion.key,
      weight: criterion.weight,
      minimumRating: criterion.minimumRating
    })),
    ...overrides
  };
}

function scorecard(overrides = {}) {
  return {
    criteria: BID_DECISION_CRITERIA.filter(criterion => criterion.source === 'operator').map(criterion => ({
      key: criterion.key,
      rating: 5,
      evidence: `${criterion.label} verified against current retained commercial evidence.`
    })),
    gates: BID_DECISION_GATES.map(gate => ({ key: gate.key, status: 'yes' })),
    ...overrides
  };
}

function approvedMarketFit(ledger) {
  const requested = ledger.requestMarketFitProfile(marketPolicy(), { actor: 'owner' });
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved', resolvedBy: 'commercial-approver', reason: 'Market focus and service area verified.'
  });
}

function qualifiedOpportunity(ledger, suffix = 'primary') {
  const opportunity = ledger.createOpportunity({
    clientName: `Pursuit Client ${suffix}`,
    title: `Arnhem renovation ${suffix}`,
    service: 'Renovation',
    clientSegment: 'Homeowner',
    sourceChannel: 'Referral',
    postalCode: '6811AA',
    city: 'Arnhem',
    country: 'NL',
    estimatedValue: 45_000
  });
  ledger.retainOpportunityFitAssessment(opportunity.id, {
    entryKey: `bid-decision-fit-${suffix}-0001`
  }, { actor: 'office' });
  return opportunity;
}

function approvedDecisionPolicy(ledger) {
  const requested = ledger.requestBidDecisionPolicy(decisionPolicy(), { actor: 'owner' });
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved', resolvedBy: 'commercial-approver', reason: 'Pursuit weights, thresholds, and gates verified.'
  });
  return requested;
}

test('bid/no-bid policy and pursuit decisions are replay-safe, approval-gated, source-bound, and stage-neutral', t => {
  const ledger = temporaryLedger(t);
  approvedMarketFit(ledger);
  const opportunity = qualifiedOpportunity(ledger);

  const requestedPolicy = ledger.requestBidDecisionPolicy(decisionPolicy(), { actor: 'owner' });
  assert.equal(requestedPolicy.policy.status, 'pending_approval');
  assert.equal(requestedPolicy.policy.integrityValid, true);
  assert.equal(ledger.activeBidDecisionPolicy(), null);
  assert.equal(ledger.requestBidDecisionPolicy(decisionPolicy(), { actor: 'owner' }).replayed, true);
  assert.throws(
    () => ledger.requestBidDecisionPolicy(decisionPolicy({ bidThreshold: 80 }), { actor: 'owner' }),
    error => error.code === 'bid_decision_policy_replay_conflict' && error.statusCode === 409
  );
  ledger.resolveApproval(requestedPolicy.approval.id, {
    status: 'approved', resolvedBy: 'commercial-approver', reason: 'Scorecard governance verified.'
  });
  assert.equal(ledger.activeBidDecisionPolicy().id, requestedPolicy.policy.id);

  const evaluation = ledger.evaluateOpportunityBidDecision(opportunity.id, scorecard());
  assert.equal(evaluation.score, 100);
  assert.equal(evaluation.recommendation, 'bid');
  assert.equal(evaluation.marketFit.current, true);
  assert.equal(evaluation.criteria.length, 6);
  assert.equal(evaluation.gates.length, 5);
  assert.deepEqual(evaluation.blockers, []);
  assert.deepEqual(evaluation.evidenceGaps, []);
  assert.equal(evaluation.opportunityStageMutation, false);
  assert.equal(evaluation.externalCommitments, 0);

  const requested = ledger.requestOpportunityBidDecision(opportunity.id, {
    entryKey: 'opportunity-bid-decision-0001',
    ...scorecard(),
    proposedDecision: 'bid',
    rationale: 'The retained evidence supports investing in this pursuit.'
  }, { actor: 'office' });
  assert.equal(requested.decision.status, 'pending_approval');
  assert.equal(requested.decision.integrityValid, true);
  assert.equal(requested.approval.targetType, 'opportunity_bid_decision');
  assert.equal(requested.approval.data.requiresExceptionOverride, false);
  assert.equal(ledger.requestOpportunityBidDecision(opportunity.id, {
    entryKey: 'opportunity-bid-decision-0001',
    ...scorecard(),
    proposedDecision: 'bid',
    rationale: 'The retained evidence supports investing in this pursuit.'
  }, { actor: 'office' }).replayed, true);
  assert.equal(ledger.getOpportunity(opportunity.id).stage, 'new');

  ledger.resolveApproval(requested.approval.id, {
    status: 'approved', resolvedBy: 'commercial-approver', reason: 'Pursuit evidence verified.'
  });
  let register = ledger.bidDecisionRegister();
  let row = register.opportunities.find(item => item.opportunity.id === opportunity.id);
  assert.equal(row.currentDecision.proposedDecision, 'bid');
  assert.equal(row.currentDecision.status, 'approved');
  assert.equal(row.stale, false);
  assert.equal(ledger.getOpportunity(opportunity.id).stage, 'new');

  const noBidScorecard = scorecard({
    gates: BID_DECISION_GATES.map(gate => ({
      key: gate.key,
      status: gate.key === 'contract_risk_acceptable' ? 'no' : 'yes'
    }))
  });
  const noBidEvaluation = ledger.evaluateOpportunityBidDecision(opportunity.id, noBidScorecard);
  assert.equal(noBidEvaluation.recommendation, 'no_bid');
  assert.deepEqual(noBidEvaluation.blockers, ['contract_risk_acceptable']);
  const noBid = ledger.requestOpportunityBidDecision(opportunity.id, {
    entryKey: 'opportunity-bid-decision-0002',
    ...noBidScorecard,
    proposedDecision: 'no_bid',
    rationale: 'The retained contract risk is outside the approved pursuit tolerance.'
  }, { actor: 'office' });
  ledger.resolveApproval(noBid.approval.id, {
    status: 'approved', resolvedBy: 'commercial-approver', reason: 'The contract-risk stop gate is supported.'
  });
  register = ledger.bidDecisionRegister();
  row = register.opportunities.find(item => item.opportunity.id === opportunity.id);
  assert.equal(row.currentDecision.proposedDecision, 'no_bid');
  assert.equal(ledger.getOpportunityBidDecision(requested.decision.id).status, 'superseded');
  assert.equal(ledger.getOpportunity(opportunity.id).stage, 'new');
  assert.equal(register.summary.noBid, 1);
  assert.equal(ledger.diagnose().valid, true);
  assert.equal(ledger.migrationStatus().currentVersion, '057_governed_risk_register');
});

test('recommendation overrides require rationale and approval rejects stale pursuit evidence atomically', t => {
  const ledger = temporaryLedger(t);
  approvedMarketFit(ledger);
  const opportunity = qualifiedOpportunity(ledger, 'override');
  approvedDecisionPolicy(ledger);
  const blockedScorecard = scorecard({
    gates: BID_DECISION_GATES.map(gate => ({ key: gate.key, status: gate.key === 'capacity_available' ? 'no' : 'yes' }))
  });
  assert.equal(ledger.evaluateOpportunityBidDecision(opportunity.id, blockedScorecard).recommendation, 'no_bid');
  assert.throws(
    () => ledger.requestOpportunityBidDecision(opportunity.id, {
      entryKey: 'opportunity-bid-override-0001',
      ...blockedScorecard,
      proposedDecision: 'bid',
      rationale: 'Management wants to pursue this strategically important project.'
    }, { actor: 'office' }),
    error => error.code === 'bid_decision_override_reason_required'
  );
  const requested = ledger.requestOpportunityBidDecision(opportunity.id, {
    entryKey: 'opportunity-bid-override-0001',
    ...blockedScorecard,
    proposedDecision: 'bid',
    rationale: 'Management wants to pursue this strategically important project.',
    overrideReason: 'A verified subcontract capacity option is awaiting final confirmation.'
  }, { actor: 'office' });
  assert.equal(requested.decision.snapshot.override, true);
  assert.equal(requested.approval.data.requiresExceptionOverride, true);

  ledger.updateOpportunity(opportunity.id, { estimatedValue: 55_000 }, { actor: 'office' });
  assert.throws(
    () => ledger.resolveApproval(requested.approval.id, {
      status: 'approved', resolvedBy: 'commercial-approver', reason: 'Approve the documented exception.'
    }),
    error => error.code === 'bid_decision_stale' && error.statusCode === 409
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).some(approval => approval.id === requested.approval.id), true);
  assert.equal(ledger.getOpportunityBidDecision(requested.decision.id).status, 'pending_approval');
  ledger.resolveApproval(requested.approval.id, {
    status: 'rejected', resolvedBy: 'commercial-approver', reason: 'Refresh the scorecard against the changed opportunity value.'
  });
  assert.equal(ledger.getOpportunityBidDecision(requested.decision.id).status, 'rejected');
});

test('autonomous pursuit logic opens one internal review and never creates a decision or external action', t => {
  const ledger = temporaryLedger(t);
  approvedMarketFit(ledger);
  const opportunity = qualifiedOpportunity(ledger, 'automation');
  approvedDecisionPolicy(ledger);

  const preview = ledger.runAutonomousCycle({ dryRun: true, actionTypes: ['review_bid_decision'] });
  const action = preview.preview.find(item => item.opportunityId === opportunity.id);
  assert.ok(action);
  assert.match(action.message, /Automation cannot choose, close, or contact the lead/);
  const first = ledger.runAutonomousCycle({ actionTypes: ['review_bid_decision'] });
  assert.equal(first.applied.length, 1);
  assert.equal(first.applied[0].status, 'task_created');
  const activity = ledger.listOpportunityActivities({ opportunityId: opportunity.id })[0];
  assert.equal(activity.activityType, 'bid_decision_review');
  assert.equal(activity.data.internalOnly, true);
  assert.equal(activity.data.externalCommitments, 0);
  assert.equal(ledger.listOpportunityBidDecisions({ opportunityId: opportunity.id }).length, 0);
  assert.equal(ledger.runAutonomousCycle({ actionTypes: ['review_bid_decision'] }).applied.length, 0);
});

test('bid/no-bid diagnostics detect tampered policy and decision snapshots', t => {
  const ledger = temporaryLedger(t);
  approvedMarketFit(ledger);
  const opportunity = qualifiedOpportunity(ledger, 'integrity');
  const policy = approvedDecisionPolicy(ledger);
  const requested = ledger.requestOpportunityBidDecision(opportunity.id, {
    entryKey: 'opportunity-bid-integrity-0001',
    ...scorecard(),
    proposedDecision: 'bid',
    rationale: 'Retain a checksum-protected pursuit decision for integrity testing.'
  }, { actor: 'office' });
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved', resolvedBy: 'approver', reason: 'Integrity evidence verified.'
  });

  ledger.db.prepare("UPDATE opportunity_bid_decisions SET snapshot_json = '{}' WHERE id = ?").run(requested.decision.id);
  let diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => issue.message.includes(`Opportunity bid/no-bid decision ${requested.decision.id} failed retained snapshot verification`)));

  ledger.db.prepare("UPDATE bid_decision_policies SET snapshot_json = '{}' WHERE id = ?").run(policy.policy.id);
  diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => issue.message.includes('Bid/no-bid policy v1 failed retained snapshot verification')));
});
