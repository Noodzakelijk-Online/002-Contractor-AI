const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t, suffix = 'primary') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-daily-cycle-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const worker = ledger.upsertWorker({
    name: `Daily cycle lead ${suffix}`,
    role: 'Site lead',
    status: 'available',
    hourlyRate: 64
  });
  const job = ledger.createIntake({
    title: `Daily operating cycle ${suffix}`,
    client: { name: `Daily cycle client ${suffix}` },
    status: 'planned',
    assignAutomatically: false
  }, { actor: 'daily-cycle-test' });
  const assignment = ledger.addAssignment(job.id, {
    workerId: worker.id,
    role: 'Site lead',
    status: 'planned',
    scheduledStart: '2026-07-23T06:00:00.000Z',
    scheduledEnd: '2026-07-23T16:00:00.000Z',
    allocationHours: 8
  });
  return { ledger, worker, job, assignment };
}

function huddlePayload(workerId, overrides = {}) {
  return {
    entryKey: 'daily-huddle-entry-0001',
    workDate: '2026-07-23',
    shiftLabel: 'day',
    facilitator: 'Daily cycle lead',
    leadWorkerId: workerId,
    workerIds: [workerId],
    plannedWork: 'Install and inspect the retained first-floor wall framing.',
    productionTarget: 'Complete 18 linear metres before 15:00.',
    weather: 'clear',
    siteConditions: 'Occupied ground floor; east stair is the only material route.',
    safetyFocus: 'Keep the stair route clear and use the retained manual-handling controls.',
    qualityHoldPoints: ['Check line and level before closing the frame'],
    constraints: ['Electrical detail due before the final bay'],
    blockingIssues: [],
    stopWorkRequired: false,
    evidenceReference: 'huddle-signoff-photo-001',
    ...overrides
  };
}

function eodPayload(workerId, overrides = {}) {
  return {
    entryKey: 'daily-eod-entry-0001',
    workerId,
    hours: 7.5,
    manpower: 3,
    weather: 'clear',
    workCompleted: 'Installed and checked 15 linear metres of first-floor wall framing.',
    blockers: ['Electrical detail prevented the final bay'],
    safetyConcern: false,
    planAchieved: false,
    varianceReasons: ['Electrical detail arrived after the planned handoff'],
    unresolvedActions: ['Confirm the final electrical opening before 08:00'],
    tomorrowPlan: 'Complete the final bay, retain the hold-point check, and start boarding.',
    evidenceReferences: ['progress-photo-set-2026-07-23'],
    ...overrides
  };
}

test('daily start huddle and EOD report retain one replay-safe approval-linked operating cycle', t => {
  const { ledger, worker, job, assignment } = fixture(t, 'success');
  assert.equal(assignment.status, 'planned');

  const started = ledger.createDailyStartHuddle(job.id, huddlePayload(worker.id), { actor: 'site-lead' });
  assert.equal(started.replayed, false);
  assert.equal(started.externalCommitments, 0);
  assert.equal(started.cycle.status, 'released');
  assert.equal(started.cycle.huddleIntegrityValid, true);
  assert.equal(started.cycle.crew[0].assignmentId, assignment.id);
  assert.equal(started.cycle.planningSource.lookaheadPlan, null);
  assert.equal(started.cycle.safeguards.externalCommitments, 0);

  const startReplay = ledger.createDailyStartHuddle(job.id, huddlePayload(worker.id), { actor: 'site-lead' });
  assert.equal(startReplay.replayed, true);
  assert.equal(startReplay.cycle.id, started.cycle.id);
  assert.throws(
    () => ledger.createDailyStartHuddle(job.id, huddlePayload(worker.id, { plannedWork: 'Different retained content cannot reuse this key.' })),
    error => error.code === 'daily_huddle_entry_key_reused'
  );

  const closed = ledger.closeDailyOperatingCycle(job.id, started.cycle.id, eodPayload(worker.id), { actor: 'site-lead' });
  assert.equal(closed.replayed, false);
  assert.equal(closed.cycle.status, 'pending_approval');
  assert.equal(closed.cycle.integrityValid, true);
  assert.equal(closed.cycle.planAchieved, false);
  assert.deepEqual(closed.cycle.varianceReasons, ['Electrical detail arrived after the planned handoff']);
  assert.equal(closed.dailyLog.fieldReport.data.dailyCycleId, started.cycle.id);
  assert.equal(closed.dailyLog.timeLog.hours, 7.5);
  assert.equal(closed.dailyLog.safetyCheck.status, 'recorded');
  assert.equal(closed.dailyLog.approvals.length, 1);

  const eodReplay = ledger.closeDailyOperatingCycle(job.id, started.cycle.id, eodPayload(worker.id), { actor: 'site-lead' });
  assert.equal(eodReplay.replayed, true);
  assert.equal(eodReplay.cycle.fieldReportId, closed.dailyLog.fieldReport.id);
  assert.throws(
    () => ledger.closeDailyOperatingCycle(job.id, started.cycle.id, eodPayload(worker.id, { hours: 8 })),
    error => error.code === 'daily_eod_entry_key_reused'
  );

  ledger.resolveApproval(closed.dailyLog.fieldReport.approvalId, {
    status: 'approved',
    resolvedBy: 'daily-cycle-owner',
    reason: 'Plan-versus-actual field evidence checked.'
  });
  const approved = ledger.getDailyOperatingCycle(started.cycle.id, { jobId: job.id });
  assert.equal(approved.status, 'closed');
  assert.ok(approved.closedAt);
  assert.equal(approved.approvalStatus, 'approved');
  assert.equal(approved.fieldReportStatus, 'submitted');
  assert.equal(ledger.diagnose().valid, true, JSON.stringify(ledger.diagnose().issues));
  assert.equal(ledger.migrationStatus().currentVersion, '064_governed_installation_qc');
});

test('daily huddle fails closed on missing assignment and safety concern keeps closure pending', t => {
  const { ledger, worker, job } = fixture(t, 'safety');
  const unassigned = ledger.upsertWorker({ name: 'Unassigned daily worker', role: 'Installer', status: 'available' });
  const blocked = ledger.createDailyStartHuddle(job.id, huddlePayload(worker.id, {
    entryKey: 'daily-huddle-entry-blocked',
    workerIds: [worker.id, unassigned.id]
  }));
  assert.equal(blocked.cycle.status, 'blocked');
  assert.match(blocked.cycle.blockingIssues.join(' '), /no active retained assignment/i);

  const result = ledger.closeDailyOperatingCycle(job.id, blocked.cycle.id, eodPayload(worker.id, {
    entryKey: 'daily-eod-entry-safety-01',
    safetyConcern: true,
    safetyRiskLevel: 'critical',
    safetyNotes: 'Unprotected edge found; work stopped and the area was isolated.'
  }));
  assert.equal(result.dailyLog.approvals.length, 2);
  ledger.resolveApproval(result.dailyLog.fieldReport.approvalId, {
    status: 'approved', resolvedBy: 'owner', reason: 'Daily evidence verified.'
  });
  assert.equal(ledger.getDailyOperatingCycle(blocked.cycle.id).status, 'pending_safety_review');
  ledger.resolveApproval(result.dailyLog.safetyCheck.approval.id, {
    status: 'approved', resolvedBy: 'safety-owner', reason: 'Control and stop-work evidence verified.'
  });
  assert.equal(ledger.getDailyOperatingCycle(blocked.cycle.id).status, 'closed');
});

test('daily EOD child writes roll back together and diagnostics detect snapshot tampering', t => {
  const { ledger, worker, job } = fixture(t, 'rollback');
  const started = ledger.createDailyStartHuddle(job.id, huddlePayload(worker.id, { entryKey: 'daily-huddle-entry-rollback' }));
  const original = ledger.addTimeLog.bind(ledger);
  ledger.addTimeLog = () => {
    throw new Error('Injected EOD time persistence failure');
  };
  assert.throws(
    () => ledger.closeDailyOperatingCycle(job.id, started.cycle.id, eodPayload(worker.id, { entryKey: 'daily-eod-entry-rollback' })),
    /Injected EOD time persistence failure/
  );
  ledger.addTimeLog = original;
  const detail = ledger.getJobDetail(job.id);
  assert.equal(detail.fieldReports.length, 0);
  assert.equal(detail.timeLogs.length, 0);
  assert.equal(detail.safetyChecks.length, 0);
  assert.equal(ledger.getDailyOperatingCycle(started.cycle.id).status, 'released');

  const retainedSnapshot = JSON.parse(ledger.db.prepare('SELECT huddle_snapshot_json FROM daily_operating_cycles WHERE id = ?').get(started.cycle.id).huddle_snapshot_json);
  retainedSnapshot.sourceHash = '0'.repeat(64);
  const tamperedSnapshotJson = JSON.stringify(retainedSnapshot);
  const tamperedSnapshotHash = crypto.createHash('sha256').update(tamperedSnapshotJson).digest('hex');
  ledger.db.prepare(`
    UPDATE daily_operating_cycles
    SET huddle_source_hash = ?, huddle_snapshot_hash = ?, huddle_snapshot_json = ?
    WHERE id = ?
  `).run(retainedSnapshot.sourceHash, tamperedSnapshotHash, tamperedSnapshotJson, started.cycle.id);
  assert.equal(ledger.getDailyOperatingCycle(started.cycle.id).huddleIntegrityValid, false);
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => /Daily operating cycle/.test(issue.message)));
});
