const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const {
  ContractorOperatingLedger,
  AUDIT_CHAIN_FORMAT,
  AUDIT_CHAIN_GENESIS_HASH
} = require('../operating-ledger');
const { verifySqliteBackupDatabase } = require('../scripts/restore-local-backup');

function temporaryLedger(t, prefix = 'contractor-ai-audit-integrity-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbFile = path.join(directory, 'ledger.sqlite');
  const ledger = new ContractorOperatingLedger({ dbFile });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, dbFile, directory };
}

function appendFixtureEvents(ledger, count = 3) {
  for (let index = 1; index <= count; index += 1) {
    ledger.audit({
      entityType: 'integrity_fixture',
      entityId: `fixture_${index}`,
      action: 'retain_fixture_event',
      actor: 'audit_integrity_test',
      after: { index, retained: true }
    });
  }
}

test('audit events append to one durable hash chain across a local restart', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-audit-restart-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const first = new ContractorOperatingLedger({ dbFile });
  const emptyIntegrity = first.verifyAuditIntegrity();
  assert.equal(emptyIntegrity.valid, true);
  assert.equal(emptyIntegrity.status, 'verified');
  assert.equal(emptyIntegrity.format, AUDIT_CHAIN_FORMAT);
  assert.equal(emptyIntegrity.algorithm, 'sha256');
  assert.equal(emptyIntegrity.eventCount, 0);
  assert.equal(emptyIntegrity.headEventId, null);
  assert.equal(emptyIntegrity.headHash, AUDIT_CHAIN_GENESIS_HASH);
  assert.deepEqual(emptyIntegrity.failures, []);
  appendFixtureEvents(first);
  const beforeRestart = first.verifyAuditIntegrity();
  assert.equal(beforeRestart.valid, true);
  assert.equal(beforeRestart.eventCount, 3);
  const events = first.listAudit({ limit: 10 }).sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  assert.deepEqual(events.map(event => event.sequenceNumber), [1, 2, 3]);
  assert.equal(events[0].previousHash, AUDIT_CHAIN_GENESIS_HASH);
  assert.equal(events[1].previousHash, events[0].eventHash);
  assert.equal(events[2].previousHash, events[1].eventHash);
  assert.match(events[2].eventHash, /^[a-f0-9]{64}$/);
  first.close();

  const restarted = new ContractorOperatingLedger({ dbFile });
  try {
    const afterRestart = restarted.verifyAuditIntegrity();
    assert.equal(afterRestart.valid, true);
    assert.equal(afterRestart.eventCount, 3);
    assert.equal(afterRestart.headHash, beforeRestart.headHash);
    assert.equal(restarted.migrationStatus().currentVersion, '013_audit_history_queries');
  } finally {
    restarted.close();
  }
});

test('audit verification detects modified events, deleted events, and stale chain heads', async t => {
  await t.test('modified event payload', () => {
    const { ledger } = temporaryLedger(t, 'contractor-ai-audit-modified-');
    appendFixtureEvents(ledger);
    ledger.db.prepare("UPDATE audit_events SET after_json = '{\"index\":2,\"retained\":false}' WHERE sequence_number = 2").run();
    const integrity = ledger.verifyAuditIntegrity();
    assert.equal(integrity.valid, false);
    assert.ok(integrity.failures.some(failure => failure.code === 'event_hash_mismatch' && failure.actual));
    assert.equal(ledger.diagnose().valid, false);
  });

  await t.test('deleted middle event', () => {
    const { ledger } = temporaryLedger(t, 'contractor-ai-audit-deleted-');
    appendFixtureEvents(ledger);
    ledger.db.prepare('DELETE FROM audit_events WHERE sequence_number = 2').run();
    const integrity = ledger.verifyAuditIntegrity();
    assert.equal(integrity.valid, false);
    assert.ok(integrity.failures.some(failure => ['sequence_gap', 'previous_hash_mismatch', 'head_count_mismatch'].includes(failure.code)));
  });

  await t.test('stale retained head', () => {
    const { ledger } = temporaryLedger(t, 'contractor-ai-audit-head-');
    appendFixtureEvents(ledger);
    ledger.db.prepare('UPDATE audit_chain_state SET event_count = 1, head_hash = ?').run(AUDIT_CHAIN_GENESIS_HASH);
    const integrity = ledger.verifyAuditIntegrity();
    assert.equal(integrity.valid, false);
    assert.ok(integrity.failures.some(failure => failure.code === 'head_count_mismatch'));
    assert.ok(integrity.failures.some(failure => failure.code === 'head_hash_mismatch'));
  });
});

test('migration 012 deterministically chains retained pre-chain audit history', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-audit-backfill-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const database = new DatabaseSync(dbFile);
  database.exec(`
    CREATE TABLE ledger_schema_migrations (
      version TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      job_id TEXT,
      action TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'Contractor.AI',
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
  const insertMigration = database.prepare('INSERT INTO ledger_schema_migrations (version, description, applied_at) VALUES (?, ?, ?)');
  const legacyVersions = [
    '001_initial_ledger_schema',
    '002_document_storage_index',
    '003_durable_scheduler_leases',
    '004_durable_request_idempotency',
    '005_postgres_double_precision',
    '006_trade_partner_compliance',
    '007_inactive_job_portal_revocation',
    '008_idempotency_lease_ownership',
    '009_durable_operator_sessions',
    '010_durable_auth_rate_limits',
    '011_durable_api_rate_limits'
  ];
  for (const version of legacyVersions) {
    insertMigration.run(version, 'Legacy applied migration', '2026-01-01T00:00:00.000Z');
  }
  const insertAudit = database.prepare(`
    INSERT INTO audit_events (id, entity_type, entity_id, action, actor, before_json, after_json, metadata_json, created_at)
    VALUES (?, 'legacy_fixture', ?, 'legacy_event', 'migration_test', '{}', ?, '{}', ?)
  `);
  insertAudit.run('audit_legacy_1', 'legacy_1', '{"index":1}', '2026-01-02T00:00:00.000Z');
  insertAudit.run('audit_legacy_2', 'legacy_2', '{"index":2}', '2026-01-03T00:00:00.000Z');
  database.close();

  const ledger = new ContractorOperatingLedger({ dbFile });
  try {
    const integrity = ledger.verifyAuditIntegrity();
    assert.equal(integrity.valid, true);
    assert.equal(integrity.eventCount, 2);
    assert.equal(ledger.migrationStatus().currentVersion, '013_audit_history_queries');
    assert.deepEqual(
      ledger.db.prepare('SELECT sequence_number FROM audit_events ORDER BY sequence_number').all().map(row => Number(row.sequence_number)),
      [1, 2]
    );
  } finally {
    ledger.close();
  }
});

test('restore validation rejects a checksummed database whose chained audit payload was rewritten', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-audit-restore-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ledger = new ContractorOperatingLedger({ dbFile });
  appendFixtureEvents(ledger, 2);
  ledger.close();

  const database = new DatabaseSync(dbFile);
  database.prepare("UPDATE audit_events SET metadata_json = '{\"rewritten\":true}' WHERE sequence_number = 1").run();
  database.close();

  assert.throws(
    () => verifySqliteBackupDatabase(dbFile),
    /audit chain failed integrity verification: event_hash_mismatch/i
  );
});
