const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');
const { approveLowRiskRegister } = require('./risk-register-fixture');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-opportunities-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function approveCommercialScope(ledger, jobId, entryKey) {
  const requested = ledger.requestCommercialScopeRevision(jobId, {
    entryKey,
    title: 'Converted opportunity written scope',
    scopeSummary: 'Deliver the retained fit-out work represented by the accepted proposal basis.',
    inclusions: ['Complete the retained office fit-out work.'],
    assumptions: ['The client provides access during the agreed programme.'],
    exclusions: ['Latent hazardous materials are excluded.'],
    clientResponsibilities: ['Confirm access before mobilisation.'],
    contractorResponsibilities: ['Retain completion and handover evidence.'],
    allowanceMode: 'none',
    noAllowanceReason: 'The retained fit-out proposal contains no allowances.',
    reason: 'Establish the written basis before quote approval and client acceptance.'
  }, { actor: 'office-pipeline' });
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved',
    resolvedBy: 'pipeline-scope-approver',
    reason: 'Written scope, assumptions, exclusions, and allowance position verified.'
  });
  const scope = ledger.getCommercialScopeRevision(requested.revision.id);
  approveLowRiskRegister(ledger, jobId, scope, `${entryKey}-risk`);
  return scope;
}

test('opportunity lifecycle retains forecast, loss evidence, activities, and autonomous internal follow-up drafts', t => {
  const ledger = temporaryLedger(t);
  const overdueAt = new Date(Date.now() - 26 * 60 * 60 * 1_000).toISOString();
  const opportunity = ledger.createOpportunity({
    clientName: 'Pipeline Client',
    email: 'pipeline@example.test',
    title: 'Canal house energy retrofit',
    service: 'Renovation',
    estimatedValue: 20_000,
    probabilityPercent: 40,
    nextFollowUpAt: overdueAt,
    ownerName: 'Utrecht office'
  }, { actor: 'office-pipeline' });

  assert.equal(opportunity.stage, 'new');
  assert.equal(opportunity.weightedValue, 8_000);
  assert.equal(opportunity.client.name, 'Pipeline Client');
  assert.equal(ledger.opportunityForecast().summary.overdueFollowUps, 1);
  assert.throws(
    () => ledger.updateOpportunity(opportunity.id, { stage: 'won' }),
    error => error.code === 'opportunity_won_evidence_required' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.updateOpportunity(opportunity.id, { stage: 'lost' }),
    error => error.code === 'opportunity_lost_reason_required' && error.statusCode === 400
  );

  const note = ledger.createOpportunityActivity(opportunity.id, {
    activityType: 'note',
    summary: 'Client confirmed access constraints',
    notes: 'Scaffold permit may be required.'
  }, { actor: 'office-pipeline' });
  assert.equal(note.replayed, false);
  assert.equal(note.activity.status, 'open');
  const completed = ledger.updateOpportunityActivity(opportunity.id, note.activity.id, {
    status: 'completed',
    notes: 'Constraints captured in the retained preconstruction record.'
  }, { actor: 'office-pipeline' });
  assert.equal(completed.status, 'completed');
  assert.ok(completed.completedAt);

  const dryRun = ledger.runAutonomousCycle({ dryRun: true, actionTypes: ['draft_opportunity_follow_up'] });
  assert.equal(dryRun.preview.length, 1);
  assert.equal(dryRun.preview[0].opportunityId, opportunity.id);
  const cycle = ledger.runAutonomousCycle({ actionTypes: ['draft_opportunity_follow_up'] });
  assert.equal(cycle.applied.length, 1);
  assert.equal(cycle.applied[0].status, 'drafted');
  const detail = ledger.getOpportunity(opportunity.id);
  const autonomousDraft = detail.activities.find(activity => activity.id === cycle.applied[0].activityId);
  assert.equal(autonomousDraft.activityType, 'internal_follow_up_draft');
  assert.equal(autonomousDraft.status, 'draft');
  assert.equal(autonomousDraft.data.internalOnly, true);
  assert.equal(autonomousDraft.data.externalCommitments, 0);
  assert.equal(ledger.runAutonomousCycle({ actionTypes: ['draft_opportunity_follow_up'] }).applied.length, 0);
  assert.equal(ledger.listOpportunityActivities({ opportunityId: opportunity.id }).length, 2);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('opportunity conversion is replay-safe and verified quote acceptance is the only win path', t => {
  const ledger = temporaryLedger(t);
  const opportunity = ledger.createOpportunity({
    clientName: 'Conversion Client',
    title: 'Office fit-out qualification',
    service: 'Fit-out',
    stage: 'estimating',
    estimatedValue: 15_000,
    probabilityPercent: 55
  }, { actor: 'office-pipeline' });

  const conversion = ledger.convertOpportunityToJob(opportunity.id, {}, { actor: 'office-pipeline' });
  assert.equal(conversion.replayed, false);
  assert.equal(conversion.opportunity.convertedJobId, conversion.job.id);
  assert.equal(conversion.opportunity.stage, 'proposal');
  assert.equal(conversion.job.assignments.length, 0);
  assert.equal(conversion.job.data.sourceOpportunityId, opportunity.id);
  assert.equal(conversion.job.quotes.length, 1);
  assert.equal(ledger.listJobs({ includeArchived: true }).length, 1);

  const replay = ledger.convertOpportunityToJob(opportunity.id, {}, { actor: 'office-pipeline' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.job.id, conversion.job.id);
  assert.equal(ledger.listJobs({ includeArchived: true }).length, 1);

  const legacyQuote = conversion.job.quotes[0];
  ledger.resolveApproval(legacyQuote.approvalId, {
    status: 'rejected',
    resolvedBy: 'internal-approver',
    reason: 'Replace the pre-scope draft with a source-bound commercial quote.'
  });
  const scope = approveCommercialScope(ledger, conversion.job.id, 'opportunity-conversion-scope-0001');
  const quote = ledger.createQuote(conversion.job.id, {
    commercialScopeRevisionId: scope.id,
    lineItems: [{ description: 'Accepted fit-out scope', quantity: 1, unitPrice: 15_000 }]
  }, { actor: 'office-pipeline' });
  ledger.resolveApproval(quote.approvalId, { status: 'approved', resolvedBy: 'internal-approver' });
  const acceptance = ledger.requestQuoteAcceptance(conversion.job.id, quote.id, {
    acceptedAt: '2026-07-15',
    evidenceReference: 'signed-fitout-2026-0715'
  }, { actor: 'office-pipeline' });
  assert.equal(ledger.getOpportunity(opportunity.id).stage, 'proposal');
  ledger.resolveApproval(acceptance.approval.id, { status: 'approved', resolvedBy: 'contract-approver' });

  const won = ledger.getOpportunity(opportunity.id);
  assert.equal(won.stage, 'won');
  assert.equal(won.probabilityPercent, 100);
  assert.equal(won.data.wonEvidence.quoteId, quote.id);
  assert.equal(won.data.wonEvidence.approvalId, acceptance.approval.id);
  assert.equal(won.data.wonEvidence.evidenceReference, 'signed-fitout-2026-0715');
  assert.throws(
    () => ledger.updateOpportunity(opportunity.id, { stage: 'lost', lostReason: 'Should not reopen verified work' }),
    error => error.code === 'opportunity_won_immutable' && error.statusCode === 409
  );
  assert.equal(ledger.opportunityForecast().summary.won, 1);
  assert.equal(ledger.diagnose().counts.opportunities, 1);
  assert.equal(ledger.diagnose().counts.opportunityActivities, 0);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});
