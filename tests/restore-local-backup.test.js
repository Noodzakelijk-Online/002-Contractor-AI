const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');
const { verifySqliteBackupDatabase } = require('../scripts/restore-local-backup');

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

test('backup verification rejects a migration 023 ledger with missing transmittal constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-transmittal-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Transmittal schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_transmittal_receipts_due');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /document-transmittal constraints are incomplete: idx_transmittal_receipts_due/i
  );
});

test('backup verification rejects a migration 024 ledger with missing meeting carryover constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-meeting-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Meeting schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_meeting_actions_active_carryover');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /project-meeting constraints are incomplete: idx_meeting_actions_active_carryover/i
  );
});

test('backup verification rejects a migration 025 ledger with missing inspection checklist constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-inspection-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Inspection schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_inspection_checklist_approval');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /inspection-checklist constraints are incomplete: idx_inspection_checklist_approval/i
  );
});

test('backup verification rejects a migration 026 ledger with missing bid-package constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-bid-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Bid package schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_bid_packages_approval');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /preconstruction-bid constraints are incomplete: idx_bid_packages_approval/i
  );
});

test('backup verification rejects a migration 027 ledger with missing quantity-takeoff constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-takeoff-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Takeoff schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_takeoff_sheets_quote');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /quantity-takeoff constraints are incomplete: idx_takeoff_sheets_quote/i
  );
});

test('backup verification rejects a migration 028 ledger with missing bid-commitment constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-commitment-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Bid commitment schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_bid_packages_purchase_order');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /bid-commitment constraints are incomplete: idx_bid_packages_purchase_order/i
  );
});

test('backup verification rejects a migration 029 ledger with missing purchase-order issue constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-purchase-order-issue-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Purchase order issue schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_purchase_orders_issue_status');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /purchase-order issue constraints are incomplete: idx_purchase_orders_issue_status/i
  );
});

test('backup verification rejects a migration 030 ledger with missing change-order issue constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-change-order-issue-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Change order issue schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_change_orders_issue_status');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /change-order issue constraints are incomplete: idx_change_orders_issue_status/i
  );
});

test('backup verification rejects a migration 031 ledger with missing cost-forecast constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-cost-forecast-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Cost forecast schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_cost_forecast_snapshots_status');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /cost-forecast constraints are incomplete: idx_cost_forecast_snapshots_status/i
  );
});

test('backup verification rejects a migration 032 ledger with missing production-control constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-production-control-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Production control schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_production_entries_baseline_line');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /production-control constraints are incomplete: idx_production_entries_baseline_line/i
  );
});

test('backup verification rejects a migration 033 ledger with missing site-attendance constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-site-attendance-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Site attendance schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_attendance_sessions_worker_open');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /site-attendance constraints are incomplete: idx_attendance_sessions_worker_open/i
  );
});

test('backup verification rejects a migration 034 ledger with missing weekly-timesheet constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-weekly-timesheet-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Weekly timesheet schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_weekly_timesheets_approved');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /weekly-timesheet constraints are incomplete: idx_weekly_timesheets_approved/i
  );
});

test('backup verification rejects a migration 035 ledger with missing workforce-qualification constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-workforce-qualification-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Workforce qualification schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_worker_credentials_approved');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /workforce-qualification constraints are incomplete: idx_worker_credentials_approved/i
  );
});

test('backup verification rejects a migration 036 ledger with missing worker-availability constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-worker-availability-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Worker availability schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_worker_availability_pending_cancellation');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /worker-availability constraints are incomplete: idx_worker_availability_pending_cancellation/i
  );
});

test('backup verification rejects a migration 037 ledger with missing material-receiving constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-material-receiving-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Material receiving schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_material_receipts_pending_reversal');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /material-receiving constraints are incomplete: idx_material_receipts_pending_reversal/i
  );
});

test('backup verification rejects a migration 038 ledger with missing equipment-custody constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-equipment-custody-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Equipment custody schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_equipment_custody_active_tool');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /equipment-custody constraints are incomplete: idx_equipment_custody_active_tool/i
  );
});

test('backup verification rejects a migration 039 ledger with missing governed expense constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-expense-receipt-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Expense receipt schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_expenses_source_fingerprint');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /governed expense-receipt constraints are incomplete: idx_expenses_source_fingerprint/i
  );
});

test('backup verification rejects a migration 040 ledger with missing environmental-reporting constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-environmental-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Environmental reporting schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_environmental_report_pending_source');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /environmental-reporting constraints are incomplete: idx_environmental_report_pending_source/i
  );
});

test('backup verification rejects a migration 041 ledger with missing governed safety-briefing constraints', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-restore-safety-briefing-schema-'));
  const ledgerFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createBackupLedger(ledgerFile, 'Safety briefing schema fixture');
  const database = new DatabaseSync(ledgerFile);
  database.exec('DROP INDEX idx_safety_attendees_job_entry_key');
  database.close();
  assert.throws(
    () => verifySqliteBackupDatabase(ledgerFile),
    /governed safety-briefing constraints are incomplete: idx_safety_attendees_job_entry_key/i
  );
});

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
  assert.equal(result.databaseVerification.auditIntegrity.supported, true);
  assert.equal(result.databaseVerification.auditIntegrity.valid, true);
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
  assert.equal(result.databaseVerification.auditIntegrity.supported, true);
  assert.equal(result.databaseVerification.auditIntegrity.valid, true);
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
