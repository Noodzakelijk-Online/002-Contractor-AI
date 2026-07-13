const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function createBackupLedger(file, title) {
  const ledger = new ContractorOperatingLedger({ dbFile: file });
  const job = ledger.createIntake({ title, client: { name: `${title} client` } }, { actor: 'restore_fixture' });
  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  ledger.createOperatorSession({
    sessionIdHash: `session-hash-${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`,
    operatorId: 'restore-fixture-owner',
    role: 'owner',
    tokenFingerprint: 'restore-fixture-token-fingerprint',
    issuedAt,
    expiresAt
  });
  ledger.recordAuthenticationFailure(crypto.createHash('sha256').update(`restore-rate-limit-${title}`).digest('hex'));
  ledger.recordApiRateLimitRequest(crypto.createHash('sha256').update(`restore-api-rate-limit-${title}`).digest('hex'));
  ledger.close();
  return job.id;
}

test('stopped-runtime restore keeps v1 backup compatibility and creates a pre-restore safety copy', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const backupId = '2026-07-10T13-30-00-000Z';
  const backupDir = path.join(dataDir, 'backups', backupId);
  fs.mkdirSync(backupDir, { recursive: true });
  const stateFile = path.join(dataDir, 'server-state.json');
  const ledgerFile = path.join(dataDir, 'contractor-ledger.sqlite');
  fs.writeFileSync(stateFile, 'current-state');
  fs.writeFileSync(ledgerFile, 'current-ledger');
  const backupState = path.join(backupDir, 'server-state.json');
  const backupLedger = path.join(backupDir, 'contractor-ledger.sqlite');
  fs.writeFileSync(backupState, 'restored-state');
  const restoredJobId = createBackupLedger(backupLedger, 'Restored v1 ledger fixture');
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({
    format: 'contractor-ai-backup-manifest/v1',
    backupId,
    databaseMode: 'sqlite',
    files: [
      { file: 'server-state.json', bytes: fs.statSync(backupState).size, sha256: digest(backupState) },
      { file: 'contractor-ledger.sqlite', bytes: fs.statSync(backupLedger).size, sha256: digest(backupLedger) }
    ]
  }));

  const output = execFileSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'restore-local-backup.js'),
    '--data-dir', dataDir,
    '--backup-id', backupId,
    '--confirm', `RESTORE_${backupId}`
  ], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.success, true);
  assert.equal(result.restartRequired, true);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), 'restored-state');
  assert.equal(result.databaseVerification.valid, true);
  assert.equal(result.invalidatedOperatorSessions, 1);
  assert.equal(result.clearedAuthenticationRateLimits, 1);
  assert.equal(result.clearedApiRateLimits, 1);
  const restoredDatabase = new DatabaseSync(ledgerFile, { readOnly: true });
  assert.equal(restoredDatabase.prepare('SELECT title FROM jobs WHERE id = ?').get(restoredJobId).title, 'Restored v1 ledger fixture');
  assert.equal(Number(restoredDatabase.prepare('SELECT COUNT(*) AS count FROM operator_sessions WHERE revoked_at IS NULL').get().count), 0);
  assert.equal(Number(restoredDatabase.prepare('SELECT COUNT(*) AS count FROM auth_rate_limits').get().count), 0);
  assert.equal(Number(restoredDatabase.prepare('SELECT COUNT(*) AS count FROM api_rate_limits').get().count), 0);
  restoredDatabase.close();
  assert.equal(fs.readFileSync(path.join(dataDir, 'backups', result.preRestoreBackupId, 'server-state.json'), 'utf8'), 'current-state');
  assert.equal(fs.readFileSync(path.join(dataDir, 'backups', result.preRestoreBackupId, 'contractor-ledger.sqlite'), 'utf8'), 'current-ledger');
  assert.equal(result.evidenceRestored, false);
});

test('stopped-runtime v2 restore replaces evidence only after preserving the current files', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-evidence-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const backupId = '2026-07-13T13-30-00-000Z';
  const backupDir = path.join(dataDir, 'backups', backupId);
  const backupEvidence = path.join(backupDir, 'evidence', '2026-07', 'restored-proof.jpg');
  const uploadDir = path.join(dataDir, 'uploads');
  const currentEvidence = path.join(uploadDir, 'current', 'before-restore.jpg');
  fs.mkdirSync(path.dirname(backupEvidence), { recursive: true });
  fs.mkdirSync(path.dirname(currentEvidence), { recursive: true });

  const stateFile = path.join(dataDir, 'server-state.json');
  const ledgerFile = path.join(dataDir, 'contractor-ledger.sqlite');
  const backupState = path.join(backupDir, 'server-state.json');
  const backupLedger = path.join(backupDir, 'contractor-ledger.sqlite');
  fs.writeFileSync(stateFile, 'current-state-v2');
  fs.writeFileSync(ledgerFile, 'current-ledger-v2');
  fs.writeFileSync(currentEvidence, 'current-evidence-v2');
  fs.writeFileSync(backupState, 'restored-state-v2');
  const restoredJobId = createBackupLedger(backupLedger, 'Restored v2 ledger fixture');
  fs.writeFileSync(backupEvidence, 'restored-evidence-v2');

  const files = [
    { file: 'server-state.json', target: backupState },
    { file: 'contractor-ledger.sqlite', target: backupLedger },
    { file: 'evidence/2026-07/restored-proof.jpg', target: backupEvidence }
  ].map(entry => ({ file: entry.file, bytes: fs.statSync(entry.target).size, sha256: digest(entry.target) }));
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({
    format: 'contractor-ai-backup-manifest/v2',
    backupId,
    databaseMode: 'sqlite',
    evidence: { included: true, fileCount: 1 },
    files
  }));

  const output = execFileSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'restore-local-backup.js'),
    '--data-dir', dataDir,
    '--upload-dir', uploadDir,
    '--backup-id', backupId,
    '--confirm', `RESTORE_${backupId}`
  ], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.success, true);
  assert.equal(result.evidenceRestored, true);
  assert.equal(result.restoredEvidenceFiles, 1);
  assert.equal(result.databaseVerification.valid, true);
  assert.equal(result.invalidatedOperatorSessions, 1);
  assert.equal(result.clearedAuthenticationRateLimits, 1);
  assert.equal(result.clearedApiRateLimits, 1);
  const restoredDatabase = new DatabaseSync(ledgerFile, { readOnly: true });
  assert.equal(restoredDatabase.prepare('SELECT title FROM jobs WHERE id = ?').get(restoredJobId).title, 'Restored v2 ledger fixture');
  assert.equal(Number(restoredDatabase.prepare('SELECT COUNT(*) AS count FROM operator_sessions WHERE revoked_at IS NULL').get().count), 0);
  assert.equal(Number(restoredDatabase.prepare('SELECT COUNT(*) AS count FROM auth_rate_limits').get().count), 0);
  assert.equal(Number(restoredDatabase.prepare('SELECT COUNT(*) AS count FROM api_rate_limits').get().count), 0);
  restoredDatabase.close();
  assert.equal(fs.readFileSync(path.join(uploadDir, '2026-07', 'restored-proof.jpg'), 'utf8'), 'restored-evidence-v2');
  assert.equal(fs.existsSync(currentEvidence), false);
  assert.equal(
    fs.readFileSync(path.join(dataDir, 'backups', result.preRestoreBackupId, 'evidence', 'current', 'before-restore.jpg'), 'utf8'),
    'current-evidence-v2'
  );
});

test('stopped-runtime restore rejects manifest traversal before changing live data', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-unsafe-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const backupId = '2026-07-13T14-00-00-000Z';
  const backupDir = path.join(dataDir, 'backups', backupId);
  fs.mkdirSync(backupDir, { recursive: true });
  const ledgerFile = path.join(dataDir, 'contractor-ledger.sqlite');
  const backupLedger = path.join(backupDir, 'contractor-ledger.sqlite');
  const outside = path.join(dataDir, 'outside.txt');
  fs.writeFileSync(ledgerFile, 'live-ledger-must-remain');
  fs.writeFileSync(backupLedger, 'untrusted-ledger');
  fs.writeFileSync(outside, 'outside-file');
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({
    format: 'contractor-ai-backup-manifest/v2',
    backupId,
    databaseMode: 'sqlite',
    evidence: { included: true, fileCount: 0 },
    files: [
      { file: 'contractor-ledger.sqlite', bytes: fs.statSync(backupLedger).size, sha256: digest(backupLedger) },
      { file: '../outside.txt', bytes: fs.statSync(outside).size, sha256: digest(outside) }
    ]
  }));

  const result = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'restore-local-backup.js'),
    '--data-dir', dataDir,
    '--backup-id', backupId,
    '--confirm', `RESTORE_${backupId}`
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsafe file path/);
  assert.equal(fs.readFileSync(ledgerFile, 'utf8'), 'live-ledger-must-remain');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside-file');
});
