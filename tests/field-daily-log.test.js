const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ContractorOperatingLedger } = require('../operating-ledger');

function createLedger() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-daily-log-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  return { ledger, directory };
}

function seedDailyLogJob(ledger, suffix) {
  const worker = ledger.upsertWorker({
    name: `Daily log worker ${suffix}`,
    role: 'Carpenter',
    status: 'available',
    hourlyRate: 61
  }, { actor: 'test' });
  const job = ledger.createIntake({
    title: `Daily site log ${suffix}`,
    client: { name: `Daily log client ${suffix}` },
    assignAutomatically: false
  }, { actor: 'test' });
  return { worker, job };
}

test('daily site log atomically retains report, time, safety, approval, and audit evidence', () => {
  const { ledger } = createLedger();
  try {
    const { worker, job } = seedDailyLogJob(ledger, 'success');
    const result = ledger.recordFieldDailyLog(job.id, {
      entryKey: 'daily-log-success-0001',
      workerId: worker.id,
      workDate: '2026-07-13',
      hours: 7.5,
      manpower: 3,
      weather: 'clear',
      workCompleted: 'Installed the first-floor timber framing.',
      blockers: ['Awaiting revised stair detail'],
      safetyConcern: false
    }, { actor: 'role:field_worker' });

    assert.equal(result.externalCommitments, 0);
    assert.equal(result.approvals.length, 1);
    assert.equal(result.fieldReport.status, 'pending_approval');
    assert.equal(result.fieldReport.data.source, 'daily_site_log');
    assert.equal(result.fieldReport.data.entryKey, 'daily-log-success-0001');
    assert.equal(result.timeLog.workerId, worker.id);
    assert.equal(result.timeLog.hours, 7.5);
    assert.equal(result.timeLog.rate, 61);
    assert.equal(result.timeLog.data.entryKey, 'daily-log-success-0001');
    assert.equal(result.safetyCheck.status, 'recorded');
    assert.equal(result.safetyCheck.approval, null);
    assert.equal(result.replayed, false);

    const replay = ledger.recordFieldDailyLog(job.id, {
      entryKey: 'daily-log-success-0001',
      workerId: worker.id,
      workDate: '2026-07-13',
      hours: 7.5,
      manpower: 3,
      weather: 'clear',
      workCompleted: 'Installed the first-floor timber framing.',
      blockers: ['Awaiting revised stair detail'],
      safetyConcern: false
    }, { actor: 'role:field_worker' });
    assert.equal(replay.replayed, true);
    assert.equal(replay.fieldReport.id, result.fieldReport.id);
    assert.equal(replay.timeLog.id, result.timeLog.id);
    assert.equal(replay.safetyCheck.id, result.safetyCheck.id);
    assert.throws(() => ledger.recordFieldDailyLog(job.id, {
      entryKey: 'daily-log-success-0001',
      workerId: worker.id,
      workDate: '2026-07-13',
      hours: 8,
      manpower: 3,
      weather: 'clear',
      workCompleted: 'Different content must not reuse the retained entry key.',
      blockers: ['Awaiting revised stair detail'],
      safetyConcern: false
    }, { actor: 'role:field_worker' }), error => error.code === 'daily_log_entry_key_reused');

    const detail = ledger.getJobDetail(job.id, { includeAudit: true });
    assert.equal(detail.fieldReports.length, 1);
    assert.equal(detail.timeLogs.length, 1);
    assert.equal(detail.safetyChecks.length, 1);
    assert.ok(detail.approvals.some(approval => approval.id === result.fieldReport.approvalId));
    const audit = detail.audit.find(event => event.action === 'record_field_daily_log');
    assert.ok(audit);
    assert.equal(audit.actor, 'role:field_worker');
    assert.equal(audit.after.externalCommitments, 0);
  } finally {
    ledger.close();
  }
});

test('daily site log creates an additional approval for a safety concern', () => {
  const { ledger } = createLedger();
  try {
    const { worker, job } = seedDailyLogJob(ledger, 'safety');
    const result = ledger.recordFieldDailyLog(job.id, {
      workerId: worker.id,
      workDate: '2026-07-13',
      hours: 4,
      manpower: 2,
      workCompleted: 'Secured the temporary roof covering.',
      safetyConcern: true,
      safetyRiskLevel: 'critical',
      safetyNotes: 'Unprotected roof edge found; work stopped and barrier installed.'
    }, { actor: 'role:field_worker' });

    assert.equal(result.approvals.length, 2);
    assert.equal(result.safetyCheck.riskLevel, 'critical');
    assert.equal(result.safetyCheck.status, 'pending_review');
    assert.equal(result.safetyCheck.approval.status, 'pending');
  } finally {
    ledger.close();
  }
});

test('daily site log rolls back every child record when one write fails', () => {
  const { ledger } = createLedger();
  try {
    const { worker, job } = seedDailyLogJob(ledger, 'rollback');
    const originalAddTimeLog = ledger.addTimeLog.bind(ledger);
    ledger.addTimeLog = () => {
      const error = new Error('Injected time-log persistence failure');
      error.code = 'injected_time_failure';
      throw error;
    };

    assert.throws(() => ledger.recordFieldDailyLog(job.id, {
      workerId: worker.id,
      workDate: '2026-07-13',
      hours: 8,
      manpower: 2,
      workCompleted: 'This record must roll back completely.'
    }, { actor: 'test' }), /Injected time-log persistence failure/);
    ledger.addTimeLog = originalAddTimeLog;

    const detail = ledger.getJobDetail(job.id, { includeAudit: true });
    assert.equal(detail.fieldReports.length, 0);
    assert.equal(detail.timeLogs.length, 0);
    assert.equal(detail.safetyChecks.length, 0);
    assert.equal(detail.approvals.filter(approval => approval.targetType === 'field_report').length, 0);
    assert.equal(detail.audit.filter(event => event.action === 'record_field_daily_log').length, 0);
  } finally {
    ledger.close();
  }
});
