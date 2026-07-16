const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ContractorOperatingLedger } = require('../operating-ledger');

test('durable scheduler leases prevent duplicate autonomous cycle execution', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-scheduler-'));
  const databaseFile = path.join(directory, 'ledger.sqlite');
  const ledger = new ContractorOperatingLedger({ dbFile: databaseFile });
  const secondLedger = new ContractorOperatingLedger({ dbFile: databaseFile });
  t.after(() => {
    secondLedger.close();
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const first = ledger.claimScheduledJob('ledger_autonomous_cycle', {
    intervalSeconds: 60,
    leaseSeconds: 30,
    now: '2026-07-10T09:00:00.000Z'
  });
  assert.equal(first.claimed, true);

  const duplicate = ledger.claimScheduledJob('ledger_autonomous_cycle', {
    intervalSeconds: 60,
    leaseSeconds: 30,
    now: '2026-07-10T09:00:05.000Z'
  });
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.reason, 'lease_active');

  const reclaimed = secondLedger.claimScheduledJob('ledger_autonomous_cycle', {
    intervalSeconds: 60,
    leaseSeconds: 30,
    now: '2026-07-10T09:00:31.000Z'
  });
  assert.equal(reclaimed.claimed, true);
  assert.notEqual(reclaimed.leaseId, first.leaseId);

  const staleCompletion = ledger.completeScheduledJob('ledger_autonomous_cycle', first.leaseId, {
    success: true,
    actionCount: 99
  }, { now: '2026-07-10T09:00:32.000Z', actor: 'stale-scheduler-test' });
  assert.equal(staleCompletion.completed, false);
  assert.equal(staleCompletion.reason, 'lease_not_owned');
  assert.equal(staleCompletion.job.leaseId, reclaimed.leaseId);

  const completion = secondLedger.completeScheduledJob('ledger_autonomous_cycle', reclaimed.leaseId, {
    success: true,
    actionCount: 2
  }, { now: '2026-07-10T09:00:35.000Z', actor: 'scheduler-test' });
  assert.equal(completion.completed, true);
  assert.equal(completion.job.lastResult.actionCount, 2);

  const notDue = ledger.claimScheduledJob('ledger_autonomous_cycle', {
    intervalSeconds: 60,
    now: '2026-07-10T09:01:00.000Z'
  });
  assert.equal(notDue.claimed, false);
  assert.equal(notDue.reason, 'not_due');

  const next = ledger.claimScheduledJob('ledger_autonomous_cycle', {
    intervalSeconds: 60,
    now: '2026-07-10T09:01:36.000Z'
  });
  assert.equal(next.claimed, true);
  assert.equal(next.job.runCount, 3);
});
