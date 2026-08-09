const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

const TEST_NOW = new Date();
const TEST_DATE = TEST_NOW.toISOString().slice(0, 10);
const TEST_SUBMITTED_AT = new Date(TEST_NOW.getTime() - 24 * 60 * 60 * 1_000).toISOString();
const TEST_CLOCK = () => new Date(TEST_NOW);

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-client-feedback-'));
  const ledger = new ContractorOperatingLedger({
    dbFile: path.join(directory, 'ledger.sqlite'),
    clock: TEST_CLOCK
  });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function createJob(ledger, title = 'Client feedback job') {
  return ledger.createIntake({
    title,
    client: { name: `${title} client` },
    status: 'in_progress',
    service: 'renovation',
    assignAutomatically: false
  }, { actor: 'feedback-test' });
}

function feedbackPayload(entryKey, overrides = {}) {
  return {
    entryKey,
    surveyType: 'project_experience',
    respondentName: 'Client contact',
    npsScore: 5,
    csatScore: 2,
    effortScore: 2,
    comment: 'The result is acceptable, but coordination took too much effort.',
    followUpConsent: false,
    testimonialConsent: false,
    evidenceReference: 'signed-survey-current-period',
    submittedAt: TEST_SUBMITTED_AT,
    ...overrides
  };
}

test('governed client feedback is replay-safe, measurable, and creates internal-only recovery work', t => {
  const ledger = temporaryLedger(t);
  const job = createJob(ledger);
  const first = ledger.createClientFeedback(job.id, feedbackPayload('feedback-entry-0001'), { actor: 'office' });
  assert.equal(first.replayed, false);
  assert.equal(first.feedback.npsCategory, 'detractor');
  assert.equal(first.feedback.followUpRequired, true);
  assert.equal(first.feedback.integrityValid, true);

  const replay = ledger.createClientFeedback(job.id, feedbackPayload('feedback-entry-0001'), { actor: 'office' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.feedback.id, first.feedback.id);
  assert.throws(
    () => ledger.createClientFeedback(job.id, feedbackPayload('feedback-entry-0001', { npsScore: 6 }), { actor: 'office' }),
    error => error.code === 'client_feedback_replay_conflict' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.createClientFeedback(job.id, feedbackPayload('feedback-entry-invalid', { evidenceReference: '' }), { actor: 'office' }),
    error => error.code === 'client_feedback_evidence_required'
  );

  ledger.createClientFeedback(job.id, feedbackPayload('feedback-entry-0002', {
    surveyType: 'handover',
    npsScore: 10,
    csatScore: 5,
    effortScore: 5,
    evidenceReference: 'handover-survey-2026-07-22'
  }), { actor: 'office' });
  ledger.createClientFeedback(job.id, feedbackPayload('feedback-entry-0003', {
    surveyType: 'aftercare',
    npsScore: 8,
    csatScore: 4,
    effortScore: 4,
    evidenceReference: 'aftercare-call-2026-07-22'
  }), { actor: 'office' });

  const scorecard = ledger.calculatePerformanceScorecard({ periodEnd: TEST_DATE, weeks: 13 });
  assert.equal(scorecard.summary.metricCount, 23);
  assert.equal(scorecard.metrics.find(metric => metric.key === 'net_promoter_score').value, 0);
  assert.equal(scorecard.metrics.find(metric => metric.key === 'customer_satisfaction_pct').value, 66.7);
  assert.equal(scorecard.metrics.find(metric => metric.key === 'customer_effort_pct').value, 66.7);

  const preview = ledger.runAutonomousCycle({
    dryRun: true,
    actionTypes: ['prepare_client_feedback_recovery'],
    jobIds: [job.id]
  });
  assert.equal(preview.preview.length, 1);
  assert.equal(preview.preview[0].feedbackId, first.feedback.id);
  assert.equal(preview.summary.externalCommitments, 0);

  const applied = ledger.runAutonomousCycle({
    actionTypes: ['prepare_client_feedback_recovery'],
    jobIds: [job.id]
  });
  assert.equal(applied.applied.length, 1);
  assert.equal(applied.applied[0].status, 'aftercare_created');
  assert.equal(applied.applied[0].notificationsSent, 0);
  assert.equal(ledger.listCommunications({ jobId: job.id }).length, 0);
  const aftercare = ledger.getJobDetail(job.id).aftercare;
  assert.equal(aftercare.length, 1);
  assert.equal(aftercare[0].data.feedbackId, first.feedback.id);
  assert.equal(aftercare[0].data.internalOnly, true);
  assert.equal(ledger.dashboardSummary().metrics.clientFeedbackRecoveryRequired, 1);

  const repeat = ledger.runAutonomousCycle({
    actionTypes: ['prepare_client_feedback_recovery'],
    jobIds: [job.id]
  });
  assert.equal(repeat.preview.length, 0);
  assert.equal(ledger.getJobDetail(job.id).aftercare.length, 1);
  ledger.transitionLifecycleRecord(job.id, 'aftercare', aftercare[0].id, {
    status: 'completed',
    notes: 'The internal recovery review was completed without an external commitment.'
  }, { actor: 'office' });
  assert.equal(ledger.dashboardSummary().metrics.clientFeedbackRecoveryRequired, 0);
  assert.equal(ledger.migrationStatus().currentVersion, '070_managed_operator_accounts');
  assert.equal(ledger.diagnose().valid, true, JSON.stringify(ledger.diagnose().issues));
});

test('NPS uses its bipolar range when an approved target is zero or negative', t => {
  const ledger = temporaryLedger(t);
  const job = createJob(ledger, 'Negative NPS target job');
  ledger.createClientFeedback(job.id, feedbackPayload('feedback-negative-nps-0001', {
    npsScore: 0,
    csatScore: 3,
    effortScore: 3
  }), { actor: 'office' });
  const targetRequest = ledger.requestPerformanceScorecardTarget({
    metricKey: 'net_promoter_score',
    targetValue: -20,
    entryKey: 'feedback-negative-nps-target-0001',
    reason: 'Use the approved recovery baseline for this reporting period.'
  }, { actor: 'office' });
  ledger.resolveApproval(targetRequest.approval.id, {
    status: 'approved',
    resolvedBy: 'owner',
    reason: 'The temporary recovery baseline and NPS scale were verified.'
  });

  const metric = ledger.calculatePerformanceScorecard({
    periodEnd: TEST_DATE,
    weeks: 13
  }).metrics.find(item => item.key === 'net_promoter_score');
  assert.equal(metric.value, -100);
  assert.equal(metric.targetValue, -20);
  assert.equal(metric.status, 'off_track');
  assert.equal(metric.score, 0);
});

test('portal feedback is single-submit per scoped access and tampering fails diagnostics', t => {
  const ledger = temporaryLedger(t);
  const job = createJob(ledger, 'Portal feedback job');
  const access = ledger.createClientPortalAccess(job.id, {
    expiresAt: '2027-01-01T00:00:00.000Z'
  }, { actor: 'office' });
  ledger.resolveApproval(access.approval.id, {
    status: 'approved',
    resolvedBy: 'portal-approver',
    reason: 'Verified client and expiry.'
  });

  const payload = {
    responseId: 'portal-feedback-response-0001',
    npsScore: 9,
    csatScore: 5,
    effortScore: 4,
    comment: 'Clear handover and a good result.',
    followUpConsent: true,
    testimonialConsent: true
  };
  const submitted = ledger.submitClientPortalFeedback(access.portalToken, payload);
  assert.equal(submitted.replayed, false);
  assert.equal(submitted.feedback.source, 'client_portal');
  assert.equal(submitted.feedback.evidenceReference, `portal_access:${access.id}`);
  assert.equal(submitted.feedback.referralEligible, true);
  assert.equal(ledger.getClientPortalSnapshot(access.portalToken).portal.feedback.submitted, true);
  assert.equal(ledger.submitClientPortalFeedback(access.portalToken, payload).replayed, true);
  assert.throws(
    () => ledger.submitClientPortalFeedback(access.portalToken, { ...payload, responseId: 'portal-feedback-response-0002' }),
    error => error.code === 'client_feedback_already_submitted' && error.statusCode === 409
  );

  ledger.db.prepare('UPDATE client_feedback SET data_json = ? WHERE id = ?').run(JSON.stringify({
    ...submitted.feedback.data,
    referralEligible: false
  }), submitted.feedback.id);
  assert.throws(
    () => ledger.listClientFeedback({ jobId: job.id }),
    error => error.code === 'client_feedback_integrity_failed' && error.statusCode === 409
  );
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => issue.message.includes(submitted.feedback.id)));
});
