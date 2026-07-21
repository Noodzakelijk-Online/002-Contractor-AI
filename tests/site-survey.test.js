const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger, SITE_SURVEY_TEMPLATE } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-site-survey-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function opportunity(ledger, suffix = 'primary') {
  return ledger.createOpportunity({
    clientName: `Survey Client ${suffix}`,
    title: `Arnhem renovation ${suffix}`,
    service: 'Renovation',
    address: 'Jansstraat 1',
    postalCode: '6811AA',
    city: 'Arnhem',
    country: 'NL',
    estimatedValue: 32_500
  }, { actor: 'office' });
}

function evidence(ledger, opportunityId, suffix = 'photo') {
  return ledger.addOpportunityEvidence(opportunityId, {
    title: `Retained ${suffix}`,
    filename: `${suffix}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 1_024,
    storageRef: `private/${opportunityId}/${suffix}.jpg`,
    contentHash: crypto.createHash('sha256').update(`${opportunityId}:${suffix}`).digest('hex')
  }, { actor: 'office' });
}

function submission(evidenceId, overrides = {}) {
  return {
    entryKey: 'site-survey-submission-primary-0001',
    surveyedAt: '2026-07-22T08:30:00.000Z',
    surveyor: 'Qualified Surveyor',
    scopeSummary: 'Renovate the retained kitchen footprint and associated finishes.',
    checklistResponses: SITE_SURVEY_TEMPLATE.items.map(item => ({
      itemKey: item.key,
      result: 'pass',
      notes: 'Verified and retained during the physical survey.',
      evidenceDocumentIds: [evidenceId]
    })),
    measurements: [{
      label: 'Kitchen floor area', quantity: 22.5, unit: 'm2', location: 'Ground floor', evidenceIds: [evidenceId]
    }],
    evidenceIds: [evidenceId],
    assumptions: ['Existing electrical supply remains serviceable.'],
    exclusions: ['Hazardous-material removal is excluded.'],
    constraints: ['The dwelling remains occupied.'],
    utilities: ['Power isolation is at the retained consumer unit.'],
    hazards: ['Protect the occupied access route.'],
    clientDecisions: ['Final tile selection remains due before procurement.'],
    ...overrides
  };
}

test('site surveys are replay-safe, evidence-bound, approval-gated, and carried into converted jobs', t => {
  const ledger = temporaryLedger(t);
  const lead = opportunity(ledger);
  const planPayload = {
    entryKey: 'site-survey-plan-primary-0001',
    scheduledAt: '2026-07-22T08:00:00.000Z',
    surveyor: 'Qualified Surveyor',
    notes: 'Internal plan; client confirmation is retained separately.'
  };
  const planned = ledger.requestOpportunitySiteSurvey(lead.id, planPayload, { actor: 'office' });
  assert.equal(planned.survey.status, 'planned');
  assert.equal(planned.survey.integrityValid, true);
  assert.equal(ledger.getOpportunity(lead.id).stage, 'site_visit');
  assert.equal(ledger.requestOpportunitySiteSurvey(lead.id, planPayload, { actor: 'office' }).replayed, true);
  assert.throws(
    () => ledger.requestOpportunitySiteSurvey(lead.id, { ...planPayload, surveyor: 'Changed Surveyor' }, { actor: 'office' }),
    error => error.code === 'site_survey_replay_conflict' && error.statusCode === 409
  );

  const retainedEvidence = evidence(ledger, lead.id);
  const payload = submission(retainedEvidence.id);
  const submitted = ledger.submitOpportunitySiteSurvey(lead.id, planned.survey.id, payload, { actor: 'surveyor' });
  assert.equal(submitted.survey.status, 'pending_approval');
  assert.equal(submitted.survey.snapshot.readiness.estimateReady, true);
  assert.equal(submitted.survey.snapshot.submission.measurements.length, 1);
  assert.equal(submitted.approval.targetType, 'opportunity_site_survey');
  assert.equal(submitted.approval.data.externalCommitments, 0);
  assert.equal(ledger.submitOpportunitySiteSurvey(lead.id, planned.survey.id, payload, { actor: 'surveyor' }).replayed, true);

  ledger.resolveApproval(submitted.approval.id, {
    status: 'approved', resolvedBy: 'office-approver', reason: 'Scope, measurements, checklist, and evidence verified.'
  });
  const approved = ledger.getOpportunity(lead.id);
  assert.equal(approved.stage, 'estimating');
  assert.equal(approved.siteSurvey.currentSurvey.status, 'approved');
  assert.equal(approved.siteSurvey.currentSurvey.integrityValid, true);
  assert.equal(approved.siteSurvey.readiness.estimateReady, true);
  assert.equal(approved.siteSurvey.stale, false);

  const conversion = ledger.convertOpportunityToJob(lead.id, {}, { actor: 'office' });
  assert.equal(conversion.job.preconstruction.opportunity.id, lead.id);
  assert.equal(conversion.job.preconstruction.siteSurvey.currentSurvey.id, planned.survey.id);
  assert.equal(conversion.job.preconstruction.siteSurvey.readiness.estimateReady, true);
  assert.equal(ledger.diagnose().valid, true);
  assert.equal(ledger.diagnose().counts.opportunityEvidence, 1);
  assert.equal(ledger.diagnose().counts.approvedOpportunitySiteSurveys, 1);
  assert.equal(ledger.migrationStatus().currentVersion, '056_commercial_scope_revisions');
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('site-survey approval rolls back when source changes and rejection permits a new retained survey', t => {
  const ledger = temporaryLedger(t);
  const lead = opportunity(ledger, 'stale');
  const planned = ledger.requestOpportunitySiteSurvey(lead.id, {
    entryKey: 'site-survey-plan-stale-0001',
    scheduledAt: '2026-07-23T09:00:00.000Z',
    surveyor: 'Source Surveyor'
  });
  const retainedEvidence = evidence(ledger, lead.id, 'stale-source');
  const requested = ledger.submitOpportunitySiteSurvey(
    lead.id,
    planned.survey.id,
    submission(retainedEvidence.id, { entryKey: 'site-survey-submission-stale-0001' })
  );

  ledger.updateOpportunity(lead.id, { estimatedValue: 38_000 }, { actor: 'office' });
  assert.throws(
    () => ledger.resolveApproval(requested.approval.id, {
      status: 'approved', resolvedBy: 'approver', reason: 'Attempt current-source approval.'
    }),
    error => error.code === 'site_survey_stale' && error.statusCode === 409
  );
  assert.equal(ledger.getOpportunitySiteSurvey(planned.survey.id).status, 'pending_approval');
  assert.equal(ledger.mapApproval(ledger.db.prepare('SELECT * FROM approvals WHERE id = ?').get(requested.approval.id)).status, 'pending');
  ledger.resolveApproval(requested.approval.id, {
    status: 'rejected', resolvedBy: 'approver', reason: 'Estimate basis changed; repeat the survey review.'
  });
  assert.equal(ledger.getOpportunitySiteSurvey(planned.survey.id).status, 'rejected');

  const replacement = ledger.requestOpportunitySiteSurvey(lead.id, {
    entryKey: 'site-survey-plan-replacement-0001',
    scheduledAt: '2026-07-24T09:00:00.000Z',
    surveyor: 'Source Surveyor'
  });
  assert.equal(replacement.survey.status, 'planned');
  assert.equal(ledger.listOpportunitySiteSurveys({ opportunityId: lead.id }).length, 2);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('site-survey autonomy creates one internal review activity and never creates a survey or appointment', t => {
  const ledger = temporaryLedger(t);
  const lead = opportunity(ledger, 'autonomy');
  ledger.updateOpportunity(lead.id, { stage: 'site_visit' }, { actor: 'office' });

  const preview = ledger.runAutonomousCycle({ dryRun: true, actionTypes: ['review_site_survey'] });
  assert.equal(preview.preview.length, 1);
  assert.equal(preview.preview[0].opportunityId, lead.id);
  const cycle = ledger.runAutonomousCycle({ actionTypes: ['review_site_survey'] });
  assert.equal(cycle.applied.length, 1);
  assert.equal(cycle.applied[0].appointmentCreated, false);
  assert.equal(cycle.applied[0].surveySubmitted, false);
  assert.equal(ledger.listOpportunitySiteSurveys({ opportunityId: lead.id }).length, 0);
  const activity = ledger.listOpportunityActivities({ opportunityId: lead.id })[0];
  assert.equal(activity.activityType, 'site_survey_review');
  assert.equal(activity.data.internalOnly, true);
  assert.equal(activity.data.externalCommitments, 0);
  assert.equal(ledger.runAutonomousCycle({ actionTypes: ['review_site_survey'] }).applied.length, 0);
});
