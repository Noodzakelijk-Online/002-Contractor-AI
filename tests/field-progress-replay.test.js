const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-field-progress-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  const ledger = new ContractorOperatingLedger({ dbFile });
  assert.equal(ledger.dbFile, dbFile);
  const job = ledger.createIntake({
    title: 'Replay-safe field progress',
    client: { name: 'Field Progress Client' },
    description: 'Verify exact offline retries and transactional rollback.'
  }, { actor: 'field_progress_test' });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, job };
}

test('operating ledger rejects unknown persistence options instead of falling back to live data', () => {
  assert.throws(
    () => new ContractorOperatingLedger({ filename: 'wrong-option.sqlite' }),
    /Unsupported operating-ledger option\(s\): filename\. Use dbFile/
  );
});

test('progress updates are exact-replay safe and reject changed content for one key', t => {
  const { ledger, job } = fixture(t);
  const payload = {
    entryKey: 'progress-offline-0001',
    status: 'in_progress',
    progressPercent: 42,
    note: 'First floor framing completed and checked.',
    blockers: ['Window delivery pending'],
    source: 'field_outbox'
  };

  const first = ledger.addProgressUpdate(job.id, payload, { actor: 'role:field_worker' });
  const replay = ledger.addProgressUpdate(job.id, payload, { actor: 'role:field_worker' });

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.id, first.id);
  const detail = ledger.getJobDetail(job.id, { includeAudit: true });
  assert.equal(detail.progress.filter(update => update.data?.entryKey === payload.entryKey).length, 1);
  assert.equal(detail.audit.filter(event => event.action === 'record_progress' && event.entityId === first.id).length, 1);
  assert.throws(() => ledger.addProgressUpdate(job.id, {
    ...payload,
    progressPercent: 55,
    note: 'Changed content must not reuse an offline retry key.'
  }, { actor: 'role:field_worker' }), error => error.code === 'progress_entry_key_reused');
});

test('progress update rolls back the record and job mutation when audit retention fails', t => {
  const { ledger, job } = fixture(t);
  const before = ledger.getJobDetail(job.id, { includeAudit: true });
  const originalAudit = ledger.audit.bind(ledger);
  ledger.audit = event => {
    if (event.action === 'record_progress') throw new Error('injected progress audit failure');
    return originalAudit(event);
  };

  assert.throws(() => ledger.addProgressUpdate(job.id, {
    entryKey: 'progress-rollback-0001',
    status: 'blocked',
    progressPercent: 63,
    note: 'This write must roll back with its audit event.'
  }, { actor: 'field_progress_test' }), /injected progress audit failure/);

  ledger.audit = originalAudit;
  const after = ledger.getJobDetail(job.id, { includeAudit: true });
  assert.equal(after.status, before.status);
  assert.equal(after.progressPercent, before.progressPercent);
  assert.equal(after.progress.some(update => update.data?.entryKey === 'progress-rollback-0001'), false);
  assert.equal(after.audit.some(event => event.action === 'record_progress' && event.metadata?.entryKey === 'progress-rollback-0001'), false);
});
