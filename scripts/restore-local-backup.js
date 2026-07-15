const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { AUDIT_CHAIN_ID, verifyAuditChainRows } = require('../operating-ledger');

const projectRoot = path.resolve(__dirname, '..');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    parsed[key] = values[index + 1] && !values[index + 1].startsWith('--') ? values[++index] : true;
  }
  return parsed;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeBackupDirectory(dataDir, backupId) {
  if (!/^[A-Za-z0-9._-]+$/.test(backupId || '')) throw new Error('Backup id is invalid.');
  const backupRoot = path.resolve(dataDir, 'backups');
  const backupDir = path.resolve(backupRoot, backupId);
  if (path.dirname(backupDir) !== backupRoot) throw new Error('Backup id is invalid.');
  return { backupRoot, backupDir };
}

function safeManifestTarget(root, manifestPath) {
  const normalized = String(manifestPath || '').replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (!normalized || path.posix.isAbsolute(normalized) || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Backup manifest contains an unsafe file path: ${manifestPath}`);
  }
  const target = path.resolve(root, ...segments);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Backup manifest contains an unsafe file path: ${manifestPath}`);
  return target;
}

function verifyManifest(backupDir) {
  const manifestFile = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error('Backup manifest was not found.');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (!['contractor-ai-backup-manifest/v1', 'contractor-ai-backup-manifest/v2'].includes(manifest?.format) || !Array.isArray(manifest.files)) {
    throw new Error('Backup manifest is invalid.');
  }
  for (const entry of manifest.files) {
    const file = String(entry?.file || '');
    const target = safeManifestTarget(backupDir, file);
    if (!fs.existsSync(target)) throw new Error(`Backup file is missing: ${file}`);
    const stats = fs.lstatSync(target);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`Backup file type is unsafe: ${file}`);
    if (stats.size !== Number(entry.bytes) || sha256(target) !== entry.sha256) {
      throw new Error(`Backup checksum failed: ${file}`);
    }
  }
  if (manifest.format === 'contractor-ai-backup-manifest/v2') {
    const evidenceEntries = manifest.files.filter(entry => String(entry?.file || '').replace(/\\/g, '/').startsWith('evidence/'));
    if (manifest.databaseMode === 'sqlite' && (manifest.evidence?.included !== true || Number(manifest.evidence?.fileCount) !== evidenceEntries.length)) {
      throw new Error('Backup evidence manifest is incomplete.');
    }
  }
  return manifest;
}

function verifySqliteBackupDatabase(ledgerFile) {
  const sourceFile = path.resolve(ledgerFile);
  const verificationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-sqlite-check-'));
  const verificationFile = path.join(verificationDirectory, path.basename(sourceFile));
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const source = `${sourceFile}${suffix}`;
      if (fs.existsSync(source)) fs.copyFileSync(source, `${verificationFile}${suffix}`);
    }
    const database = new DatabaseSync(verificationFile, { readOnly: true });
    try {
      const integrity = database.prepare('PRAGMA integrity_check').all();
      if (!integrity.length || integrity.some(row => row.integrity_check !== 'ok')) {
        throw new Error('Backup SQLite integrity check failed.');
      }
      const requiredTables = ['audit_events', 'jobs', 'ledger_schema_migrations'];
      const retainedTables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
      const missingTables = requiredTables.filter(table => !retainedTables.has(table));
      if (missingTables.length) throw new Error(`Backup ledger schema is incomplete: ${missingTables.join(', ')}.`);
      const appliedMigrations = new Set(database.prepare('SELECT version FROM ledger_schema_migrations').all().map(row => row.version));
      if (appliedMigrations.has('018_supplier_payables')) {
        const payableTables = ['supplier_invoices', 'supplier_invoice_payments'];
        const missingPayableTables = payableTables.filter(table => !retainedTables.has(table));
        if (missingPayableTables.length) {
          throw new Error(`Backup supplier-payable schema is incomplete: ${missingPayableTables.join(', ')}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        const payableIndexes = ['idx_supplier_invoices_duplicate_key', 'idx_supplier_invoice_payments_reconciliation_key'];
        const missingPayableIndexes = payableIndexes.filter(index => !retainedIndexes.has(index));
        if (missingPayableIndexes.length) {
          throw new Error(`Backup supplier-payable constraints are incomplete: ${missingPayableIndexes.join(', ')}.`);
        }
      }
      if (appliedMigrations.has('019_billing_milestones')) {
        if (!retainedTables.has('billing_milestones')) {
          throw new Error('Backup billing-milestone schema is incomplete: billing_milestones.');
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        const milestoneIndexes = ['idx_billing_milestones_job_status', 'idx_billing_milestones_due'];
        const missingMilestoneIndexes = milestoneIndexes.filter(index => !retainedIndexes.has(index));
        if (missingMilestoneIndexes.length) {
          throw new Error(`Backup billing-milestone constraints are incomplete: ${missingMilestoneIndexes.join(', ')}.`);
        }
      }
      const auditColumns = new Set(database.prepare('PRAGMA table_info(audit_events)').all().map(row => row.name));
      let auditIntegrity = { supported: false, valid: null, status: 'legacy_unchained_backup' };
      if (['sequence_number', 'previous_hash', 'event_hash'].every(column => auditColumns.has(column))) {
        if (!retainedTables.has('audit_chain_state')) throw new Error('Backup audit chain state is missing.');
        const state = database.prepare('SELECT * FROM audit_chain_state WHERE chain_id = ?').get(AUDIT_CHAIN_ID) || null;
        auditIntegrity = { supported: true, ...verifyAuditChainRows(database.prepare('SELECT * FROM audit_events').all(), state) };
        if (!auditIntegrity.valid) {
          throw new Error(`Backup audit chain failed integrity verification: ${auditIntegrity.failures.map(failure => failure.code).join(', ')}.`);
        }
      }
      return { valid: true, tables: retainedTables.size, auditIntegrity };
    } finally {
      database.close();
    }
  } finally {
    fs.rmSync(verificationDirectory, { recursive: true, force: true });
  }
}

function invalidateRestoredOperatorSessions(ledgerFile) {
  const database = new DatabaseSync(ledgerFile);
  try {
    const retained = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'operator_sessions'").get();
    if (!retained) return 0;
    const timestamp = new Date().toISOString();
    const result = database.prepare(`
      UPDATE operator_sessions
      SET revoked_at = ?, revocation_reason = 'backup_restore', updated_at = ?
      WHERE revoked_at IS NULL
    `).run(timestamp, timestamp);
    return Number(result.changes || 0);
  } finally {
    database.close();
  }
}

function clearRestoredAuthenticationRateLimits(ledgerFile) {
  const database = new DatabaseSync(ledgerFile);
  try {
    const retained = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_rate_limits'").get();
    if (!retained) return 0;
    const result = database.prepare('DELETE FROM auth_rate_limits').run();
    return Number(result.changes || 0);
  } finally {
    database.close();
  }
}

function clearRestoredApiRateLimits(ledgerFile) {
  const database = new DatabaseSync(ledgerFile);
  try {
    const retained = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'api_rate_limits'").get();
    if (!retained) return 0;
    const result = database.prepare('DELETE FROM api_rate_limits').run();
    return Number(result.changes || 0);
  } finally {
    database.close();
  }
}

function copyDirectoryFiles(sourceRoot, targetRoot) {
  if (!fs.existsSync(sourceRoot)) return [];
  const copied = [];
  const visit = (directory, relativeDirectory = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Evidence restore refuses symbolic link: ${entry.name}`);
      const relative = path.join(relativeDirectory, entry.name);
      const source = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(source, relative);
        continue;
      }
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const target = path.resolve(targetRoot, relative);
      if (!target.startsWith(`${path.resolve(targetRoot)}${path.sep}`)) throw new Error('Evidence path could not be resolved safely.');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      copied.push(target);
    }
  };
  fs.mkdirSync(targetRoot, { recursive: true });
  visit(path.resolve(sourceRoot));
  return copied;
}

function writeSafetyManifest(directory, files) {
  const entries = files.map(file => ({
    file: path.relative(directory, file).replace(/\\/g, '/'),
    bytes: fs.statSync(file).size,
    sha256: sha256(file)
  }));
  fs.writeFileSync(path.join(directory, 'pre-restore-manifest.json'), JSON.stringify({
    format: 'contractor-ai-pre-restore-manifest/v2',
    createdAt: new Date().toISOString(),
    files: entries
  }, null, 2));
}

function assertSafeReplaceDirectory(target, backupRoot) {
  const resolved = path.resolve(target);
  const filesystemRoot = path.parse(resolved).root;
  const resolvedBackupRoot = path.resolve(backupRoot);
  if (
    resolved === filesystemRoot
    || resolved === projectRoot
    || resolved === resolvedBackupRoot
    || resolved.startsWith(`${resolvedBackupRoot}${path.sep}`)
    || resolvedBackupRoot.startsWith(`${resolved}${path.sep}`)
  ) {
    throw new Error(`Refusing to replace unsafe evidence directory: ${resolved}`);
  }
  return resolved;
}

function restore(argumentsMap) {
  const dataDir = path.resolve(argumentsMap['data-dir'] || process.env.CONTRACTOR_AI_DATA_DIR || path.join(projectRoot, 'data'));
  const backupId = String(argumentsMap['backup-id'] || '');
  if (argumentsMap.confirm !== `RESTORE_${backupId}`) throw new Error(`Set --confirm RESTORE_${backupId} to apply this verified local backup.`);
  const { backupRoot, backupDir } = safeBackupDirectory(dataDir, backupId);
  const manifest = verifyManifest(backupDir);
  if (manifest.databaseMode !== 'sqlite') throw new Error('This command restores SQLite local backups only. Restore hosted PostgreSQL through the managed provider recovery procedure.');

  const stateFile = path.resolve(argumentsMap['state-file'] || process.env.STATE_FILE || path.join(dataDir, 'server-state.json'));
  const ledgerFile = path.resolve(argumentsMap['ledger-db-file'] || process.env.LEDGER_DB_FILE || path.join(dataDir, 'contractor-ledger.sqlite'));
  const uploadDir = assertSafeReplaceDirectory(argumentsMap['upload-dir'] || process.env.UPLOAD_DIR || path.join(dataDir, 'uploads'), backupRoot);
  const targetFiles = [stateFile, ledgerFile, `${ledgerFile}-wal`, `${ledgerFile}-shm`];
  const manifestFiles = new Set(manifest.files.map(entry => entry.file));
  const requiredFiles = [path.basename(ledgerFile)];
  for (const file of requiredFiles) {
    if (!manifestFiles.has(file)) throw new Error(`Backup does not contain required local state file: ${file}`);
  }
  const backupLedgerFile = path.join(backupDir, path.basename(ledgerFile));
  const databaseVerification = verifySqliteBackupDatabase(backupLedgerFile);

  const safetyId = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const safetyDir = path.join(backupRoot, safetyId);
  fs.mkdirSync(safetyDir, { recursive: true });
  const copiedSafetyFiles = [];
  for (const target of targetFiles) {
    if (!fs.existsSync(target)) continue;
    const safetyTarget = path.join(safetyDir, path.basename(target));
    fs.copyFileSync(target, safetyTarget);
    copiedSafetyFiles.push(safetyTarget);
  }
  copiedSafetyFiles.push(...copyDirectoryFiles(uploadDir, path.join(safetyDir, 'evidence')));
  writeSafetyManifest(safetyDir, copiedSafetyFiles);

  const restoredFiles = [];
  for (const target of targetFiles) {
    const filename = path.basename(target);
    const source = path.join(backupDir, filename);
    if (manifestFiles.has(filename)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      restoredFiles.push(filename);
    } else if (target.endsWith('-wal') || target.endsWith('-shm')) {
      fs.rmSync(target, { force: true });
    }
  }
  const invalidatedOperatorSessions = invalidateRestoredOperatorSessions(ledgerFile);
  const clearedAuthenticationRateLimits = clearRestoredAuthenticationRateLimits(ledgerFile);
  const clearedApiRateLimits = clearRestoredApiRateLimits(ledgerFile);

  let evidenceRestored = false;
  let restoredEvidenceFiles = 0;
  if (manifest.format === 'contractor-ai-backup-manifest/v2' && manifest.evidence?.included === true) {
    const stagingDir = `${uploadDir}.restore-${process.pid}-${Date.now()}`;
    assertSafeReplaceDirectory(stagingDir, backupRoot);
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });
    try {
      const evidenceEntries = manifest.files.filter(entry => String(entry.file).replace(/\\/g, '/').startsWith('evidence/'));
      for (const entry of evidenceEntries) {
        const relative = String(entry.file).replace(/\\/g, '/').slice('evidence/'.length);
        const source = safeManifestTarget(backupDir, entry.file);
        const target = safeManifestTarget(stagingDir, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        restoredEvidenceFiles += 1;
      }
      fs.rmSync(uploadDir, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(uploadDir), { recursive: true });
      fs.renameSync(stagingDir, uploadDir);
      evidenceRestored = true;
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  return {
    success: true,
    backupId,
    restoredFiles,
    evidenceRestored,
    restoredEvidenceFiles,
    databaseVerification,
    invalidatedOperatorSessions,
    clearedAuthenticationRateLimits,
    clearedApiRateLimits,
    preRestoreBackupId: safetyId,
    restartRequired: true
  };
}

if (require.main === module) {
  try {
    const result = restore(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    fail(error.message || 'Local backup restore failed.');
  }
}

module.exports = {
  parseArguments,
  restore,
  verifyManifest,
  verifySqliteBackupDatabase
};
