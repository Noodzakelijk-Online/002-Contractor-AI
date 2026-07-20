const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-performance-scorecard-api-'));
const tokens = {
  owner: 'performance-owner-token-at-least-32-characters',
  approver: 'performance-approver-token-at-least-32-characters',
  office_operator: 'performance-office-token-at-least-32-characters',
  field_worker: { token: 'performance-field-token-at-least-32-characters', jobIds: ['none'] }
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
const scorecardPeriodEnd = new Date().toISOString().slice(0, 10);
const historicalPeriodEnd = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

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

test('performance scorecard API enforces roles, target governance, immutable snapshots, export, and capabilities', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'performance_scorecard_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const fieldRead = await request(baseUrl, `/api/ledger/performance-scorecard?periodEnd=${scorecardPeriodEnd}&weeks=13`, tokens.field_worker.token);
  assert.equal(fieldRead.response.status, 403);
  const approverRead = await request(baseUrl, `/api/ledger/performance-scorecard?periodEnd=${scorecardPeriodEnd}&weeks=13`, tokens.approver);
  assert.equal(approverRead.response.status, 200, JSON.stringify(approverRead.body));
  assert.equal(approverRead.body.scorecard.perspectives.length, 10);
  assert.equal(approverRead.body.scorecard.metrics.length, 20);
  assert.equal(approverRead.body.scorecard.summary.noData, 20);
  const historicalRead = await request(baseUrl, `/api/ledger/performance-scorecard?periodEnd=${historicalPeriodEnd}&weeks=13`, tokens.approver);
  assert.equal(historicalRead.response.status, 200, JSON.stringify(historicalRead.body));
  assert.equal(historicalRead.body.scorecard.metrics.filter(metric => metric.availability === 'historical_state_not_retained').length, 9);
  assert.equal(historicalRead.body.scorecard.sourceBasis.pointInTime.available, false);
  assert.ok(historicalRead.body.scorecard.warnings.some(warning => warning.code === 'performance_historical_point_in_time_unavailable'));
  const invalidWeeks = await request(baseUrl, `/api/ledger/performance-scorecard?periodEnd=${scorecardPeriodEnd}&weeks=2`, tokens.office_operator);
  assert.equal(invalidWeeks.response.status, 400);
  assert.equal(invalidWeeks.body.error.code, 'performance_scorecard_weeks_invalid');

  const targetPayload = {
    metricKey: 'opportunity_win_rate_pct',
    targetValue: 40,
    entryKey: 'performance-api-win-target-0001',
    reason: 'Align the commercial threshold with the approved annual operating plan.',
    periodEnd: scorecardPeriodEnd,
    weeks: 13
  };
  const deniedTarget = await request(baseUrl, '/api/ledger/performance-scorecard/targets', tokens.approver, {
    method: 'POST', body: JSON.stringify(targetPayload)
  });
  assert.equal(deniedTarget.response.status, 403);
  const target = await request(baseUrl, '/api/ledger/performance-scorecard/targets', tokens.office_operator, {
    method: 'POST', body: JSON.stringify(targetPayload)
  });
  assert.equal(target.response.status, 201, JSON.stringify(target.body));
  assert.equal(target.body.target.status, 'pending_approval');
  assert.equal(target.body.approval.targetType, 'performance_scorecard_target');
  assert.equal(target.body.scorecard.ready, false);
  const targetReplay = await request(baseUrl, '/api/ledger/performance-scorecard/targets', tokens.office_operator, {
    method: 'POST', body: JSON.stringify(targetPayload)
  });
  assert.equal(targetReplay.response.status, 201, JSON.stringify(targetReplay.body));
  assert.equal(targetReplay.body.replayed, true);
  assert.equal(targetReplay.body.target.id, target.body.target.id);
  const blockedSnapshot = await request(baseUrl, '/api/ledger/performance-scorecard/snapshots', tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ periodEnd: scorecardPeriodEnd, weeks: 13 })
  });
  assert.equal(blockedSnapshot.response.status, 409);
  assert.equal(blockedSnapshot.body.error.code, 'performance_scorecard_not_ready');
  const deniedResolve = await request(baseUrl, `/api/ledger/approvals/${target.body.approval.id}/resolve`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ status: 'approved' })
  });
  assert.equal(deniedResolve.response.status, 403);
  const approvedTarget = await request(baseUrl, `/api/ledger/approvals/${target.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', resolvedBy: 'Performance approver', reason: 'Target and operating-plan basis verified.' })
  });
  assert.equal(approvedTarget.response.status, 200, JSON.stringify(approvedTarget.body));

  const prepared = await request(baseUrl, '/api/ledger/performance-scorecard/snapshots', tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ periodEnd: scorecardPeriodEnd, weeks: 13 })
  });
  assert.equal(prepared.response.status, 201, JSON.stringify(prepared.body));
  assert.equal(prepared.body.snapshot.status, 'pending_approval');
  assert.equal(prepared.body.snapshot.integrityValid, true);
  assert.equal(prepared.body.approval.targetType, 'performance_scorecard');
  const preparedReplay = await request(baseUrl, '/api/ledger/performance-scorecard/snapshots', tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ periodEnd: scorecardPeriodEnd, weeks: 13 })
  });
  assert.equal(preparedReplay.response.status, 201, JSON.stringify(preparedReplay.body));
  assert.equal(preparedReplay.body.replayed, true);

  const revisedTarget = await request(baseUrl, '/api/ledger/performance-scorecard/targets', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      ...targetPayload,
      targetValue: 45,
      entryKey: 'performance-api-win-target-0002',
      reason: 'Raise the approved commercial threshold for the next management cycle.'
    })
  });
  assert.equal(revisedTarget.response.status, 201, JSON.stringify(revisedTarget.body));
  const approvedRevision = await request(baseUrl, `/api/ledger/approvals/${revisedTarget.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', resolvedBy: 'Performance approver', reason: 'Revised target and effective management basis verified.' })
  });
  assert.equal(approvedRevision.response.status, 200, JSON.stringify(approvedRevision.body));
  const staleSnapshot = await request(baseUrl, `/api/ledger/approvals/${prepared.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', resolvedBy: 'Performance approver', reason: 'Stale target basis must fail.' })
  });
  assert.equal(staleSnapshot.response.status, 409);
  assert.equal(staleSnapshot.body.error.code, 'performance_scorecard_stale');
  const rejected = await request(baseUrl, `/api/ledger/approvals/${prepared.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'rejected', resolvedBy: 'Performance approver', reason: 'Superseded target basis.' })
  });
  assert.equal(rejected.response.status, 200, JSON.stringify(rejected.body));
  const currentRequest = await request(baseUrl, '/api/ledger/performance-scorecard/snapshots', tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ periodEnd: scorecardPeriodEnd, weeks: 13 })
  });
  assert.equal(currentRequest.response.status, 201, JSON.stringify(currentRequest.body));
  const approvedSnapshot = await request(baseUrl, `/api/ledger/approvals/${currentRequest.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', resolvedBy: 'Performance approver', reason: 'Current evidence, targets, gaps, and period verified.' })
  });
  assert.equal(approvedSnapshot.response.status, 200, JSON.stringify(approvedSnapshot.body));
  const current = await request(baseUrl, `/api/ledger/performance-scorecard?periodEnd=${scorecardPeriodEnd}&weeks=13`, tokens.office_operator);
  assert.equal(current.response.status, 200, JSON.stringify(current.body));
  assert.equal(current.body.scorecard.snapshotCurrent, true);
  assert.equal(current.body.scorecard.activeSnapshot.scorecardNumber, currentRequest.body.snapshot.scorecardNumber);

  const exported = await request(baseUrl, '/api/operations/export', tokens.owner);
  assert.equal(exported.response.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.body.performanceScorecardTargets.length, 2);
  assert.equal(exported.body.performanceScorecardSnapshots.length, 2);
  const validated = await request(baseUrl, '/api/operations/exports/validate', tokens.owner, {
    method: 'POST', body: JSON.stringify({ snapshot: exported.body })
  });
  assert.equal(validated.response.status, 200, JSON.stringify(validated.body));
  assert.equal(validated.body.counts.performanceScorecardTargets, 2);
  assert.equal(validated.body.counts.performanceScorecardSnapshots, 2);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200, JSON.stringify(capabilities.body));
  assert.equal(capabilities.body.capabilities.performanceScorecard.metricCount, 20);
  assert.equal(capabilities.body.capabilities.performanceScorecard.perspectives.length, 10);
  assert.equal(capabilities.body.capabilities.performanceScorecard.sourceHashScope, 'material_metric_inputs');
  assert.equal(capabilities.body.capabilities.performanceScorecard.pointInTimeMetricCount, 9);
  assert.equal(capabilities.body.capabilities.performanceScorecard.pointInTimeMetrics.length, 9);
  assert.equal(capabilities.body.capabilities.performanceScorecard.historicalPointInTime, 'retained_snapshots_only');
  assert.equal(capabilities.body.capabilities.performanceScorecard.missingEvidencePasses, false);
  assert.equal(capabilities.body.capabilities.requestSafety.performanceTargetRevision, 'approval_gated_versioned');
});
