const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { ContractorOperatingLedger } = require('../operating-ledger');
const { resolvePostgresConnectionOptions } = require('../postgres-sync-database');
const { migrateLocalBackupToHosted, verifyBackupDirectory } = require('../scripts/migrate-local-backup-to-hosted');

const connectionString = process.env.CONTRACTOR_AI_POSTGRES_TEST_URL;

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function pgClient(databaseUrl) {
  const options = resolvePostgresConnectionOptions(databaseUrl);
  return new Client({
    connectionString: options.connectionString,
    ssl: options.ssl === false ? false : { rejectUnauthorized: options.rejectUnauthorized !== false }
  });
}

function databaseUrl(baseUrl, databaseName) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function createTestDatabase(t, suffix) {
  const name = `contractor_migration_${suffix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const admin = pgClient(databaseUrl(connectionString, 'postgres'));
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  t.after(async () => {
    const cleanup = pgClient(databaseUrl(connectionString, 'postgres'));
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await cleanup.end();
  });
  return databaseUrl(connectionString, name);
}

function createBackupFixture(t, suffix = 'success') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `contractor-ai-hosted-migration-${suffix}-`));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceFile = path.join(directory, 'source.sqlite');
  const localStorageRef = `data/uploads/${suffix}-site-proof.jpg`;
  const source = new ContractorOperatingLedger({ dbFile: sourceFile });
  const job = source.createIntake({
    title: `Hosted migration ${suffix}`,
    client: { name: `Migration Client ${suffix}` },
    description: 'A complete local ledger fixture for the hosted migration path.',
    estimatedHours: 123.123456789,
    contractValue: 987654321.123456
  }, { actor: 'migration_fixture' });
  const evidenceBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from(`hosted-migration-${suffix}`)]);
  const document = source.addDocument(job.id, {
    type: 'field_photo',
    title: 'Migration site proof',
    filename: `${suffix}-site-proof.jpg`,
    mimeType: 'image/jpeg',
    size: evidenceBytes.length,
    storageRef: localStorageRef
  }, { actor: 'migration_fixture' });
  source.addProgressUpdate(job.id, {
    progressPercent: 33.333333333,
    note: 'Evidence reference must follow the object-storage migration.',
    photos: [{ storageRef: localStorageRef }]
  }, { actor: 'migration_fixture' });
  const tradePartner = source.upsertTradePartner({
    name: `Migration Supplier ${suffix}`,
    partnerType: 'supplier',
    registrationNumber: '66778899',
    vatNumber: 'NL123456789B01',
    verificationReference: `Migration fixture registry check ${suffix}`,
    verifiedAt: new Date(Date.now() - 86_400_000).toISOString()
  }, { actor: 'migration_fixture' });
  source.createOperatorSession({
    sessionIdHash: `local-session-${suffix}`,
    operatorId: 'local-owner',
    role: 'owner',
    tokenFingerprint: 'local-migration-token-fingerprint',
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString()
  });
  source.recordAuthenticationFailure(crypto.createHash('sha256').update(`migration-rate-limit-${suffix}`).digest('hex'));
  source.close();

  const backupId = `2026-07-13T12-00-00-${suffix}`;
  const backupDir = path.join(directory, 'backups', backupId);
  const backupLedger = path.join(backupDir, 'contractor-ledger.sqlite');
  const backupEvidence = path.join(backupDir, 'evidence', `${suffix}-site-proof.jpg`);
  fs.mkdirSync(path.dirname(backupEvidence), { recursive: true });
  fs.copyFileSync(sourceFile, backupLedger);
  fs.writeFileSync(backupEvidence, evidenceBytes);
  const files = [
    { file: 'contractor-ledger.sqlite', target: backupLedger },
    { file: `evidence/${suffix}-site-proof.jpg`, target: backupEvidence }
  ].map(entry => ({
    file: entry.file,
    bytes: fs.statSync(entry.target).size,
    sha256: digest(entry.target)
  }));
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({
    format: 'contractor-ai-backup-manifest/v2',
    backupId,
    createdAt: '2026-07-13T12:00:00.000Z',
    databaseMode: 'sqlite',
    evidence: { included: true, fileCount: 1 },
    files
  }, null, 2));
  return { backupDir, backupId, document, evidenceBytes, job, localStorageRef, tradePartner };
}

class FakeHostedStorage {
  constructor({ corruptRead = false } = {}) {
    this.corruptRead = corruptRead;
    this.objects = new Map();
    this.counter = 0;
  }

  async verify() {
    return { ready: true, mode: 's3', checkedAt: new Date().toISOString() };
  }

  async store(file) {
    const filename = `migrated-${++this.counter}-${file.originalName}`;
    const storageRef = `s3://migration-test/${filename}`;
    this.objects.set(storageRef, Buffer.from(file.buffer));
    return { filename, storageRef, size: file.size, mimeType: file.mimeType };
  }

  async read(storageRef) {
    const value = this.objects.get(storageRef);
    return this.corruptRead ? Buffer.from('corrupt') : Buffer.from(value);
  }

  async remove(storageRef) {
    return this.objects.delete(storageRef);
  }
}

test('backup verifier requires an intact v2 SQLite ledger and evidence set', t => {
  const fixture = createBackupFixture(t, 'verify');
  const verified = verifyBackupDirectory(fixture.backupDir);
  assert.equal(verified.manifest.backupId, fixture.backupId);
  assert.equal(verified.evidenceFiles.length, 1);
  fs.appendFileSync(path.join(fixture.backupDir, 'evidence', 'verify-site-proof.jpg'), 'tampered');
  assert.throws(() => verifyBackupDirectory(fixture.backupDir), /checksum failed/i);
});

test('hosted migration CLI requires an exact confirmation and safe backup id', () => {
  const script = path.join(__dirname, '..', 'scripts', 'migrate-local-backup-to-hosted.js');
  const unconfirmed = spawnSync(process.execPath, [script, '--backup-id', 'backup-safe'], { encoding: 'utf8' });
  assert.equal(unconfirmed.status, 1);
  assert.match(unconfirmed.stderr, /--confirm MIGRATE_backup-safe/);
  const traversal = spawnSync(process.execPath, [script, '--backup-id', '..', '--confirm', 'MIGRATE_..'], { encoding: 'utf8' });
  assert.equal(traversal.status, 1);
  assert.match(traversal.stderr, /valid verified local backup id/i);
});

test('verified local backup migrates losslessly to empty PostgreSQL and private object storage', { skip: !connectionString }, async t => {
  const targetUrl = await createTestDatabase(t, 'success');
  const fixture = createBackupFixture(t, 'success');
  const storage = new FakeHostedStorage();
  const migration = await migrateLocalBackupToHosted({
    backupDir: fixture.backupDir,
    databaseUrl: targetUrl,
    storage,
    actor: 'migration_integration_test'
  });

  assert.equal(migration.success, true);
  assert.equal(migration.backupId, fixture.backupId);
  assert.equal(migration.evidenceFiles, 1);
  assert.equal(migration.invalidatedOperatorSessions, 1);
  assert.equal(migration.clearedAuthenticationRateLimits, 1);
  assert.equal(migration.migrationVersion, '010_durable_auth_rate_limits');
  assert.equal(migration.diagnostics.valid, true);
  assert.equal(storage.objects.size, 1);
  assert.deepEqual([...storage.objects.values()][0], fixture.evidenceBytes);

  const hosted = new ContractorOperatingLedger({ databaseUrl: targetUrl });
  try {
    const detail = hosted.getJobDetail(fixture.job.id, { includeAudit: true });
    assert.equal(detail.contractValue, 987654321.123456);
    assert.equal(detail.estimatedHours, 123.123456789);
    const migratedDocument = detail.documents.find(item => item.id === fixture.document.id);
    assert.match(migratedDocument.storageRef, /^s3:\/\/migration-test\/migrated-1-/);
    assert.notEqual(migratedDocument.storageRef, fixture.localStorageRef);
    const progress = detail.progress.find(item => item.note.includes('Evidence reference'));
    assert.equal(progress.progressPercent, 33.333333333);
    assert.equal(progress.photos[0].storageRef, migratedDocument.storageRef);
    const migratedPartner = hosted.getTradePartner(fixture.tradePartner.id);
    assert.equal(migratedPartner.name, fixture.tradePartner.name);
    assert.equal(migratedPartner.compliance.status, 'verified');
    assert.equal(migratedPartner.data.verificationReference, fixture.tradePartner.data.verificationReference);
    assert.equal(Number(hosted.db.prepare('SELECT COUNT(*) AS count FROM operator_sessions').get().count), 0);
    assert.equal(Number(hosted.db.prepare('SELECT COUNT(*) AS count FROM auth_rate_limits').get().count), 0);
    const receipt = hosted.listAudit({ entityType: 'operational_migration', limit: 100 })
      .find(event => event.id === migration.receiptId);
    assert.equal(receipt.action, 'migrate_local_backup_to_hosted');
    assert.equal(receipt.metadata.sourceBackupId, fixture.backupId);
    assert.equal(receipt.metadata.databaseSha256, migration.databaseSha256);
    assert.equal(receipt.metadata.invalidatedOperatorSessions, 1);
    assert.equal(receipt.metadata.clearedAuthenticationRateLimits, 1);
  } finally {
    hosted.close();
  }

  await assert.rejects(
    migrateLocalBackupToHosted({ backupDir: fixture.backupDir, databaseUrl: targetUrl, storage }),
    /target is not empty/i
  );
  assert.equal(storage.objects.size, 1);
});

test('failed evidence verification rolls back PostgreSQL and removes uploaded objects', { skip: !connectionString }, async t => {
  const targetUrl = await createTestDatabase(t, 'rollback');
  const fixture = createBackupFixture(t, 'rollback');
  const storage = new FakeHostedStorage({ corruptRead: true });
  await assert.rejects(
    migrateLocalBackupToHosted({ backupDir: fixture.backupDir, databaseUrl: targetUrl, storage }),
    /read-back verification failed/i
  );
  assert.equal(storage.objects.size, 0);

  const target = new ContractorOperatingLedger({ databaseUrl: targetUrl });
  try {
    assert.equal(target.listJobs({ includeArchived: true, limit: 100 }).length, 0);
    assert.equal(target.listAudit({ limit: 100 }).length, 0);
    assert.equal(target.diagnose().valid, true);
  } finally {
    target.close();
  }
});
