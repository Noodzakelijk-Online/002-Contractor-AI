const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-market-fit-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function policy(overrides = {}) {
  return {
    entryKey: 'market-fit-policy-0001',
    reason: 'Set the approved commercial focus for the operating pipeline.',
    profileName: 'Core Arnhem residential',
    services: ['Renovation', 'Maintenance'],
    clientSegments: ['Homeowner', 'Housing association'],
    sourceChannels: ['Referral', 'Existing client'],
    minJobValue: 5_000,
    maxJobValue: 150_000,
    fitThreshold: 70,
    serviceAreas: [{ label: 'Arnhem core', country: 'NL', postalPrefixes: ['68'], cities: ['Arnhem'], priority: 'primary', maxTravelMinutes: 45 }],
    ...overrides
  };
}

test('governed market-fit profiles are replay-safe, approval-gated, versioned, and deterministic', t => {
  const ledger = temporaryLedger(t);
  const requested = ledger.requestMarketFitProfile(policy(), { actor: 'owner' });
  assert.equal(requested.profile.status, 'pending_approval');
  assert.equal(requested.profile.integrityValid, true);
  assert.equal(ledger.activeMarketFitProfile(), null);

  const replay = ledger.requestMarketFitProfile(policy(), { actor: 'owner' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.profile.id, requested.profile.id);
  assert.throws(
    () => ledger.requestMarketFitProfile(policy({ services: ['Roofing'] }), { actor: 'owner' }),
    error => error.code === 'market_fit_replay_conflict' && error.statusCode === 409
  );

  ledger.resolveApproval(requested.approval.id, { status: 'approved', resolvedBy: 'commercial-approver', reason: 'Commercial focus and geography verified.' });
  const active = ledger.activeMarketFitProfile();
  assert.equal(active.status, 'approved');
  assert.equal(active.snapshot.policy.serviceAreas[0].postalPrefixes[0], '68');

  const pursue = ledger.createOpportunity({
    clientName: 'Pursue Client', title: 'Arnhem renovation', service: 'Renovation', clientSegment: 'Homeowner',
    sourceChannel: 'Referral', postalCode: '6811 AA', city: 'Arnhem', country: 'NL', estimatedValue: 25_000
  });
  const pursueFit = ledger.assessOpportunityMarketFit(pursue.id);
  assert.equal(pursueFit.score, 100);
  assert.equal(pursueFit.recommendation, 'pursue');
  assert.equal(pursueFit.criteria.every(criterion => criterion.status === 'match'), true);

  const review = ledger.createOpportunity({
    clientName: 'Review Client', title: 'Incomplete inquiry', service: 'Maintenance', sourceChannel: 'Referral',
    city: 'Arnhem', country: 'NL', estimatedValue: 10_000
  });
  const reviewFit = ledger.assessOpportunityMarketFit(review.id);
  assert.equal(reviewFit.recommendation, 'review');
  assert.deepEqual(reviewFit.evidenceGaps, ['client_segment']);

  const decline = ledger.createOpportunity({
    clientName: 'Outside Client', title: 'Outside policy', service: 'New build', clientSegment: 'Developer',
    sourceChannel: 'Website', postalCode: '1011AA', city: 'Amsterdam', country: 'NL', estimatedValue: 500_000
  });
  const declineFit = ledger.assessOpportunityMarketFit(decline.id);
  assert.equal(declineFit.recommendation, 'decline');
  assert.deepEqual(declineFit.blockers, ['service', 'service_area', 'job_value', 'client_segment', 'source_channel']);
  assert.equal(declineFit.automaticRejection, false);
  assert.equal(declineFit.externalCommitments, 0);

  const retained = ledger.retainOpportunityFitAssessment(pursue.id, { entryKey: 'market-fit-assessment-pursue-0001' }, { actor: 'office' });
  assert.equal(retained.assessment.integrityValid, true);
  assert.equal(retained.assessment.snapshot.recommendation, 'pursue');
  assert.equal(ledger.retainOpportunityFitAssessment(pursue.id, { entryKey: 'market-fit-assessment-pursue-0001' }, { actor: 'office' }).replayed, true);

  ledger.updateOpportunity(pursue.id, { estimatedValue: 200_000 }, { actor: 'office' });
  const register = ledger.marketFitRegister();
  const changed = register.opportunities.find(item => item.opportunity.id === pursue.id);
  assert.equal(changed.stale, true);
  assert.equal(changed.evaluation.recommendation, 'decline');

  const revision = ledger.requestMarketFitProfile(policy({
    entryKey: 'market-fit-policy-0002',
    reason: 'Expand the approved value band after the quarterly strategy review.',
    profileName: 'Core Arnhem residential expanded',
    maxJobValue: 250_000
  }), { actor: 'owner' });
  ledger.resolveApproval(revision.approval.id, { status: 'approved', resolvedBy: 'commercial-approver', reason: 'Revised value band verified.' });
  assert.equal(ledger.getMarketFitProfile(active.id).status, 'superseded');
  assert.equal(ledger.activeMarketFitProfile().id, revision.profile.id);
  assert.equal(ledger.listOpportunityFitAssessments({ opportunityId: pursue.id }).length, 1);
  assert.equal(ledger.diagnose().valid, true);
  assert.equal(ledger.migrationStatus().currentVersion, '062_governed_five_s');
});

test('autonomous market-fit work retains evidence then opens only an internal review task', t => {
  const ledger = temporaryLedger(t);
  const requested = ledger.requestMarketFitProfile(policy(), { actor: 'owner' });
  ledger.resolveApproval(requested.approval.id, { status: 'approved', resolvedBy: 'approver', reason: 'Policy verified.' });
  const opportunity = ledger.createOpportunity({
    clientName: 'Automation Client', title: 'Unqualified distant lead', service: 'Unknown service', clientSegment: 'Unknown segment',
    sourceChannel: 'Unknown source', postalCode: '9711AA', city: 'Groningen', country: 'NL', estimatedValue: 250_000
  });

  const firstPreview = ledger.runAutonomousCycle({ dryRun: true, actionTypes: ['retain_market_fit_assessment'] });
  assert.equal(firstPreview.preview.some(action => action.opportunityId === opportunity.id), true);
  const first = ledger.runAutonomousCycle({ actionTypes: ['retain_market_fit_assessment'] });
  assert.equal(first.applied.length, 1);
  assert.equal(ledger.listOpportunityFitAssessments({ opportunityId: opportunity.id }).length, 1);

  const second = ledger.runAutonomousCycle({ actionTypes: ['review_market_fit'] });
  assert.equal(second.applied.length, 1);
  assert.equal(second.applied[0].status, 'task_created');
  const activity = ledger.listOpportunityActivities({ opportunityId: opportunity.id })[0];
  assert.equal(activity.activityType, 'market_fit_review');
  assert.equal(activity.data.internalOnly, true);
  assert.equal(activity.data.externalCommitments, 0);
  assert.equal(ledger.runAutonomousCycle({ actionTypes: ['review_market_fit'] }).applied.length, 0);
});

test('market-fit diagnostics reject tampered retained snapshots', t => {
  const ledger = temporaryLedger(t);
  const requested = ledger.requestMarketFitProfile(policy(), { actor: 'owner' });
  ledger.resolveApproval(requested.approval.id, { status: 'approved', resolvedBy: 'approver', reason: 'Policy verified.' });
  ledger.db.prepare("UPDATE market_fit_profiles SET snapshot_json = '{}' WHERE id = ?").run(requested.profile.id);
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => issue.message.includes('Market-fit profile v1 failed retained snapshot verification')));
});
