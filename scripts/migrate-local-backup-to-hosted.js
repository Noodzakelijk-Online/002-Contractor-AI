const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Client } = require('pg');
const {
  ContractorOperatingLedger,
  AUDIT_CHAIN_ID,
  AUDIT_CHAIN_GENESIS_HASH,
  auditEventHash,
  auditEventFromRow,
  verifyAuditChainRows,
  builtInInspectionTemplateRows
} = require('../operating-ledger');
const { createEvidenceStorage } = require('../evidence-storage');
const { resolvePostgresConnectionOptions } = require('../postgres-sync-database');

const projectRoot = path.resolve(__dirname, '..');
const MIGRATION_LOCK_ID = 2_024_070_013;
const OPERATOR_SESSION_TABLE = 'operator_sessions';
const AUTH_RATE_LIMIT_TABLE = 'auth_rate_limits';
const API_RATE_LIMIT_TABLE = 'api_rate_limits';

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

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function safeManifestTarget(root, manifestPath) {
  const normalized = String(manifestPath || '').replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (!normalized || path.posix.isAbsolute(normalized) || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Backup manifest contains an unsafe file path: ${manifestPath}`);
  }
  const target = path.resolve(root, ...segments);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new Error(`Backup manifest contains an unsafe file path: ${manifestPath}`);
  }
  return target;
}

function isSqliteFile(file) {
  const descriptor = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(16);
    return fs.readSync(descriptor, header, 0, header.length, 0) === header.length
      && header.equals(Buffer.from('SQLite format 3\0', 'binary'));
  } finally {
    fs.closeSync(descriptor);
  }
}

function verifyBackupDirectory(backupDirectory) {
  const backupDir = path.resolve(backupDirectory);
  const manifestFile = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error('Backup manifest was not found.');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest?.format !== 'contractor-ai-backup-manifest/v2' || manifest.databaseMode !== 'sqlite' || !Array.isArray(manifest.files)) {
    throw new Error('Hosted migration requires a SQLite contractor-ai-backup-manifest/v2 package.');
  }
  const files = [];
  const seen = new Set();
  for (const entry of manifest.files) {
    const file = String(entry?.file || '').replace(/\\/g, '/');
    if (seen.has(file)) throw new Error(`Backup manifest contains a duplicate file path: ${file}`);
    seen.add(file);
    const target = safeManifestTarget(backupDir, file);
    if (!fs.existsSync(target)) throw new Error(`Backup file is missing: ${file}`);
    const stats = fs.lstatSync(target);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`Backup file type is unsafe: ${file}`);
    if (stats.size !== Number(entry.bytes) || sha256File(target) !== entry.sha256) {
      throw new Error(`Backup checksum failed: ${file}`);
    }
    files.push({ ...entry, file, target });
  }
  const evidenceFiles = files.filter(entry => entry.file.startsWith('evidence/'));
  if (manifest.evidence?.included !== true || Number(manifest.evidence?.fileCount) !== evidenceFiles.length) {
    throw new Error('Backup evidence manifest is incomplete.');
  }
  const sqliteFiles = files.filter(entry => !entry.file.includes('/') && isSqliteFile(entry.target));
  if (sqliteFiles.length !== 1) throw new Error('Backup must contain exactly one top-level SQLite ledger database.');
  return {
    backupDir,
    manifest,
    manifestHash: sha256File(manifestFile),
    files,
    evidenceFiles,
    ledgerFile: sqliteFiles[0].target
  };
}

function safeIdentifier(value) {
  const identifier = String(value || '');
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) throw new Error(`Unsafe database identifier: ${identifier}`);
  return identifier;
}

function quotedIdentifier(value) {
  return `"${safeIdentifier(value)}"`;
}

function sourceTableNames(database) {
  return database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'ledger_schema_migrations'
    ORDER BY name
  `).all().map(row => safeIdentifier(row.name));
}

function sourceColumns(database, table) {
  return database.prepare(`PRAGMA table_info(${quotedIdentifier(table)})`).all().map(row => safeIdentifier(row.name));
}

function orderedSourceTables(database, tables) {
  const tableSet = new Set(tables);
  const dependencies = new Map(tables.map(table => [
    table,
    new Set(database.prepare(`PRAGMA foreign_key_list(${quotedIdentifier(table)})`).all()
      .map(row => safeIdentifier(row.table))
      .filter(dependency => dependency !== table && tableSet.has(dependency)))
  ]));
  const ordered = [];
  const pending = new Set(tables);
  while (pending.size) {
    const ready = [...pending].filter(table => [...dependencies.get(table)].every(dependency => !pending.has(dependency))).sort();
    if (!ready.length) throw new Error(`Ledger schema contains a foreign-key cycle: ${[...pending].sort().join(', ')}`);
    for (const table of ready) {
      ordered.push(table);
      pending.delete(table);
    }
  }
  return ordered;
}

function orderedSelfReferentialRows(database, table, rows) {
  const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${quotedIdentifier(table)})`).all()
    .filter(row => safeIdentifier(row.table) === table)
    .map(row => ({ from: safeIdentifier(row.from), to: safeIdentifier(row.to) }));
  if (!foreignKeys.length || rows.length < 2) return rows;

  const dependencies = new Map(rows.map((row, index) => [index, new Set()]));
  for (const [index, row] of rows.entries()) {
    for (const foreignKey of foreignKeys) {
      const reference = row[foreignKey.from];
      if (reference === null || reference === undefined) continue;
      const dependencyIndex = rows.findIndex(candidate => candidate[foreignKey.to] === reference);
      if (dependencyIndex >= 0 && dependencyIndex !== index) dependencies.get(index).add(dependencyIndex);
    }
  }

  const ordered = [];
  const pending = new Set(rows.map((_, index) => index));
  while (pending.size) {
    const ready = [...pending].filter(index =>
      [...dependencies.get(index)].every(dependencyIndex => !pending.has(dependencyIndex))
    );
    if (!ready.length) throw new Error(`Ledger table ${table} contains a self-referential foreign-key cycle.`);
    for (const index of ready) {
      ordered.push(rows[index]);
      pending.delete(index);
    }
  }
  return ordered;
}

const PORTABLE_INTEGER_COLUMNS = new Set([
  'audit_chain_state.event_count',
  'audit_events.sequence_number'
]);

function canonicalValue(value, columnKey = '') {
  if (value === null || value === undefined) return null;
  if (PORTABLE_INTEGER_COLUMNS.has(columnKey) && /^\d+$/.test(String(value))) {
    const integer = Number(value);
    if (!Number.isSafeInteger(integer)) throw new Error(`Portable ledger integer exceeds the safe range: ${columnKey}`);
    return integer;
  }
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `base64:${Buffer.from(value).toString('base64')}`;
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function tableDigest(table, columns, rows) {
  const encodedRows = rows.map(row => JSON.stringify(columns.map(column => canonicalValue(row[column], `${table}.${column}`)))).sort();
  return sha256Buffer(Buffer.from(encodedRows.join('\n'), 'utf8'));
}

function inferMimeType(filename) {
  const extension = path.extname(filename).toLowerCase();
  return {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }[extension] || 'application/octet-stream';
}

function storageBasename(value) {
  return path.posix.basename(String(value || '').replace(/\\/g, '/'));
}

function replaceRetainedReferences(value, replacements) {
  if (typeof value === 'string') return replacements.get(value) || value;
  if (Array.isArray(value)) return value.map(item => replaceRetainedReferences(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceRetainedReferences(item, replacements)]));
  }
  return value;
}

const IMMUTABLE_ISSUE_PACKAGE_TYPES = new Set([
  'quote_issue_package',
  'invoice_issue_package',
  'invoice_ubl_package',
  'credit_note_issue_package',
  'credit_note_ubl_package',
  'purchase_order_issue_package',
  'purchase_order_ubl_package',
  'change_order_issue_package',
  'handover_issue_package',
  'drawing_revision'
]);

const IMMUTABLE_SOURCE_JSON_COLUMNS = new Map([
  ['sds_sheets', new Set(['data_json', 'snapshot_json'])]
]);

function rewriteRowReferences(table, row, columns, replacements) {
  const rewritten = { ...row };
  if (typeof rewritten.storage_ref === 'string' && replacements.has(rewritten.storage_ref)) {
    rewritten.storage_ref = replacements.get(rewritten.storage_ref);
  }
  const immutablePayload = table === 'documents' && IMMUTABLE_ISSUE_PACKAGE_TYPES.has(String(rewritten.type || '').toLowerCase());
  if (immutablePayload) return rewritten;
  const immutableColumns = IMMUTABLE_SOURCE_JSON_COLUMNS.get(table) || new Set();
  for (const column of columns.filter(name => name.endsWith('_json') && !immutableColumns.has(name))) {
    if (typeof rewritten[column] !== 'string' || !rewritten[column].trim()) continue;
    try {
      rewritten[column] = JSON.stringify(replaceRetainedReferences(JSON.parse(rewritten[column]), replacements));
    } catch {
      throw new Error(`Ledger table contains invalid JSON in ${column}.`);
    }
  }
  return rewritten;
}

function postgresClientOptions(connectionString) {
  const resolved = resolvePostgresConnectionOptions(connectionString);
  return {
    connectionString: resolved.connectionString,
    ssl: resolved.ssl === false ? false : { rejectUnauthorized: resolved.rejectUnauthorized !== false }
  };
}

async function destinationTableNames(client) {
  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'ledger_schema_migrations'
    ORDER BY table_name
  `);
  return result.rows.map(row => safeIdentifier(row.table_name));
}

async function destinationColumns(client, table) {
  const result = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [table]);
  return result.rows.map(row => safeIdentifier(row.column_name));
}

async function insertRows(client, table, columns, rows) {
  if (!rows.length) return;
  const batchSize = Math.max(1, Math.min(500, Math.floor(30_000 / Math.max(1, columns.length))));
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = [];
    const tuples = batch.map(row => {
      const placeholders = columns.map(column => {
        values.push(row[column]);
        return `$${values.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await client.query(
      `INSERT INTO ${quotedIdentifier(table)} (${columns.map(quotedIdentifier).join(', ')}) VALUES ${tuples.join(', ')}`,
      values
    );
  }
}

const MIGRATION_SEED_COLUMNS = {
  inspection_templates: [
    'id',
    'template_key',
    'name',
    'inspection_type',
    'discipline',
    'version_number',
    'status',
    'items_json',
    'data_json'
  ]
};

async function prepareMigrationSeedTable(client, table, sourceIncludesTable) {
  const columns = MIGRATION_SEED_COLUMNS[table];
  if (!columns) return false;
  const destinationRows = (await client.query(
    `SELECT ${columns.map(quotedIdentifier).join(', ')} FROM ${quotedIdentifier(table)}`
  )).rows;
  if (!destinationRows.length) return false;
  const expectedRows = table === 'inspection_templates'
    ? builtInInspectionTemplateRows().map(row => Object.fromEntries(columns.map(column => [column, row[column]])))
    : [];
  const canonical = destinationRows.length === expectedRows.length
    && tableDigest(table, columns, destinationRows) === tableDigest(table, columns, expectedRows);
  if (!canonical) throw new Error(`Hosted migration target is not empty: ${table}`);
  if (sourceIncludesTable) await client.query(`DELETE FROM ${quotedIdentifier(table)}`);
  return true;
}

function verifySourceAuditChain(database) {
  const columns = sourceColumns(database, 'audit_events');
  if (!['sequence_number', 'previous_hash', 'event_hash'].every(column => columns.includes(column))) {
    return { supported: false, valid: null, status: 'legacy_unchained_backup' };
  }
  const retainedTables = new Set(sourceTableNames(database));
  const state = retainedTables.has('audit_chain_state')
    ? database.prepare('SELECT * FROM audit_chain_state WHERE chain_id = ?').get(AUDIT_CHAIN_ID) || null
    : null;
  const integrity = verifyAuditChainRows(database.prepare('SELECT * FROM audit_events').all(), state);
  if (!integrity.valid) {
    throw new Error(`Source backup audit chain failed integrity verification: ${integrity.failures.map(failure => failure.code).join(', ')}`);
  }
  return { supported: true, ...integrity };
}

async function rebuildHostedAuditChain(client) {
  const rows = (await client.query('SELECT * FROM audit_events ORDER BY created_at ASC, id ASC')).rows;
  await client.query('UPDATE audit_events SET sequence_number = NULL, previous_hash = NULL, event_hash = NULL');
  let previousHash = AUDIT_CHAIN_GENESIS_HASH;
  let sequenceNumber = 0;
  for (const row of rows) {
    sequenceNumber += 1;
    const eventHash = auditEventHash({
      ...auditEventFromRow(row),
      sequenceNumber,
      previousHash
    });
    await client.query(`
      UPDATE audit_events
      SET sequence_number = $1, previous_hash = $2, event_hash = $3
      WHERE id = $4
    `, [sequenceNumber, previousHash, eventHash, row.id]);
    previousHash = eventHash;
  }
  await client.query('DELETE FROM audit_chain_state WHERE chain_id = $1', [AUDIT_CHAIN_ID]);
  if (rows.length) {
    await client.query(`
      INSERT INTO audit_chain_state (chain_id, head_event_id, head_hash, event_count, updated_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [AUDIT_CHAIN_ID, rows.at(-1).id, previousHash, sequenceNumber, new Date().toISOString()]);
  }
  return { eventCount: sequenceNumber, headEventId: rows.at(-1)?.id || null, headHash: previousHash };
}

async function appendHostedAuditEvent(client, event) {
  await client.query(`
    INSERT INTO audit_chain_state (chain_id, head_event_id, head_hash, event_count, updated_at)
    VALUES ($1, NULL, $2, 0, $3)
    ON CONFLICT (chain_id) DO NOTHING
  `, [AUDIT_CHAIN_ID, AUDIT_CHAIN_GENESIS_HASH, event.createdAt]);
  const state = (await client.query('SELECT * FROM audit_chain_state WHERE chain_id = $1 FOR UPDATE', [AUDIT_CHAIN_ID])).rows[0];
  if (!state) throw new Error('Hosted migration could not retain the audit chain state.');
  const sequenceNumber = Number(state.event_count || 0) + 1;
  const previousHash = state.head_hash || AUDIT_CHAIN_GENESIS_HASH;
  const eventHash = auditEventHash({ ...event, sequenceNumber, previousHash });
  await client.query(`
    INSERT INTO audit_events (
      id, entity_type, entity_id, job_id, action, actor,
      before_json, after_json, metadata_json, created_at,
      sequence_number, previous_hash, event_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  `, [
    event.id,
    event.entityType,
    event.entityId,
    event.jobId || null,
    event.action,
    event.actor,
    event.beforeJson,
    event.afterJson,
    event.metadataJson,
    event.createdAt,
    sequenceNumber,
    previousHash,
    eventHash
  ]);
  const advanced = await client.query(`
    UPDATE audit_chain_state
    SET head_event_id = $1, head_hash = $2, event_count = $3, updated_at = $4
    WHERE chain_id = $5 AND head_hash = $6 AND event_count = $7
  `, [event.id, eventHash, sequenceNumber, event.createdAt, AUDIT_CHAIN_ID, previousHash, Number(state.event_count || 0)]);
  if (advanced.rowCount !== 1) throw new Error('Hosted migration lost ownership of the audit chain head.');
  return { sequenceNumber, previousHash, eventHash };
}

async function migrateEvidence(verification, documents, storage, storedObjects = []) {
  if (!verification.evidenceFiles.length) return { replacements: new Map(), stored: storedObjects, files: [] };
  if (!storage || typeof storage.store !== 'function' || typeof storage.read !== 'function' || typeof storage.remove !== 'function') {
    throw new Error('Evidence migration requires a readable, writable, and removable hosted storage adapter.');
  }
  await storage.verify();
  const evidenceByBasename = new Map();
  for (const evidence of verification.evidenceFiles) {
    const basename = storageBasename(evidence.file);
    const matches = evidenceByBasename.get(basename) || [];
    matches.push(evidence);
    evidenceByBasename.set(basename, matches);
  }
  for (const document of documents) {
    if (!document.storage_ref || String(document.storage_ref).startsWith('s3://')) continue;
    const matches = evidenceByBasename.get(storageBasename(document.storage_ref)) || [];
    if (matches.length !== 1) throw new Error(`Document evidence could not be mapped uniquely: ${document.id}`);
  }

  const replacements = new Map();
  const files = [];
  for (const evidence of verification.evidenceFiles) {
    const relatedDocuments = documents.filter(document => storageBasename(document.storage_ref) === storageBasename(evidence.file));
    const originalName = relatedDocuments[0]?.filename || storageBasename(evidence.file);
    const mimeType = relatedDocuments[0]?.mime_type || inferMimeType(originalName);
    const buffer = fs.readFileSync(evidence.target);
    const result = await storage.store({ originalName, mimeType, size: buffer.length, buffer });
    storedObjects.push(result.storageRef);
    const retained = await storage.read(result.storageRef);
    if (!Buffer.from(retained).equals(buffer)) throw new Error(`Hosted evidence read-back verification failed: ${evidence.file}`);
    for (const document of relatedDocuments) {
      replacements.set(String(document.storage_ref), result.storageRef);
      replacements.set(storageBasename(document.storage_ref), result.filename);
    }
    files.push({ source: evidence.file, storageRef: result.storageRef, bytes: buffer.length, sha256: sha256Buffer(buffer) });
  }
  return { replacements, stored: storedObjects, files };
}

function createHostedEvidenceStorageFromEnvironment() {
  return createEvidenceStorage({
    mode: 's3',
    s3: {
      endpoint: process.env.CONTRACTOR_AI_S3_ENDPOINT,
      bucket: process.env.CONTRACTOR_AI_S3_BUCKET,
      region: process.env.CONTRACTOR_AI_S3_REGION || 'eu-central-1',
      accessKeyId: process.env.CONTRACTOR_AI_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.CONTRACTOR_AI_S3_SECRET_ACCESS_KEY,
      prefix: process.env.CONTRACTOR_AI_S3_PREFIX || 'contractor-ai/evidence',
      timeoutMs: process.env.CONTRACTOR_AI_STORAGE_TIMEOUT_MS
    }
  });
}

async function migrateLocalBackupToHosted({ backupDir, databaseUrl, storage = null, actor = 'local_to_hosted_migration' }) {
  if (!databaseUrl) throw new Error('A hosted PostgreSQL database URL is required.');
  const verification = verifyBackupDirectory(backupDir);
  const initializer = new ContractorOperatingLedger({ databaseUrl });
  const destinationMigrations = initializer.migrationStatus();
  initializer.close();

  const source = new DatabaseSync(verification.ledgerFile, { readOnly: true });
  const client = new Client(postgresClientOptions(databaseUrl));
  const uploadedObjects = [];
  let committed = false;
  try {
    const sourceAuditIntegrity = verifySourceAuditChain(source);
    const tables = orderedSourceTables(source, sourceTableNames(source));
    const sourceColumnsByTable = new Map(tables.map(table => [table, sourceColumns(source, table)]));
    const sourceRowsByTable = new Map(tables.map(table => [
      table,
      source.prepare(`SELECT * FROM ${quotedIdentifier(table)}`).all()
    ]));
    const invalidatedOperatorSessions = sourceRowsByTable.get(OPERATOR_SESSION_TABLE)?.length || 0;
    if (sourceRowsByTable.has(OPERATOR_SESSION_TABLE)) {
      sourceRowsByTable.set(OPERATOR_SESSION_TABLE, []);
    }
    const clearedAuthenticationRateLimits = sourceRowsByTable.get(AUTH_RATE_LIMIT_TABLE)?.length || 0;
    if (sourceRowsByTable.has(AUTH_RATE_LIMIT_TABLE)) {
      sourceRowsByTable.set(AUTH_RATE_LIMIT_TABLE, []);
    }
    const clearedApiRateLimits = sourceRowsByTable.get(API_RATE_LIMIT_TABLE)?.length || 0;
    if (sourceRowsByTable.has(API_RATE_LIMIT_TABLE)) {
      sourceRowsByTable.set(API_RATE_LIMIT_TABLE, []);
    }
    const documents = sourceRowsByTable.get('documents') || [];

    await client.connect();
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [MIGRATION_LOCK_ID]);
    if (lock.rows[0]?.locked !== true) throw new Error('Another Contractor.AI hosted migration is already running.');
    await client.query('BEGIN');
    const targetTables = await destinationTableNames(client);
    const targetSet = new Set(targetTables);
    const missingTables = tables.filter(table => !targetSet.has(table));
    if (missingTables.length) throw new Error(`Hosted schema is missing ledger tables: ${missingTables.join(', ')}`);
    if (targetTables.length) {
      await client.query(`LOCK TABLE ${targetTables.map(quotedIdentifier).join(', ')} IN ACCESS EXCLUSIVE MODE`);
    }
    for (const table of targetTables) {
      if (await prepareMigrationSeedTable(client, table, sourceRowsByTable.has(table))) continue;
      const count = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${quotedIdentifier(table)}`);
      if (BigInt(count.rows[0].count) !== 0n) throw new Error(`Hosted migration target is not empty: ${table}`);
    }

    const evidence = await migrateEvidence(verification, documents, storage, uploadedObjects);
    const tableResults = [];
    for (const table of tables) {
      const columns = sourceColumnsByTable.get(table);
      const targetColumns = await destinationColumns(client, table);
      const missingColumns = columns.filter(column => !targetColumns.includes(column));
      if (missingColumns.length) throw new Error(`Hosted table ${table} is missing columns: ${missingColumns.join(', ')}`);
      const rows = orderedSelfReferentialRows(
        source,
        table,
        sourceRowsByTable.get(table).map(row => rewriteRowReferences(table, row, columns, evidence.replacements))
      );
      await insertRows(client, table, columns, rows);
      const destinationRows = (await client.query(
        `SELECT ${columns.map(quotedIdentifier).join(', ')} FROM ${quotedIdentifier(table)}`
      )).rows;
      const sourceDigest = tableDigest(table, columns, rows);
      const destinationDigest = tableDigest(table, columns, destinationRows);
      if (destinationRows.length !== rows.length || sourceDigest !== destinationDigest) {
        throw new Error(`Hosted verification failed for ledger table: ${table}`);
      }
      tableResults.push({ table, rows: rows.length, sha256: sourceDigest });
    }

    const rebuiltAuditChain = await rebuildHostedAuditChain(client);
    const databaseDigest = sha256Buffer(Buffer.from(tableResults.map(result => `${result.table}:${result.rows}:${result.sha256}`).join('\n')));
    const receiptId = `migration_${sha256Buffer(Buffer.from(`${verification.manifest.backupId}\0${verification.manifestHash}`)).slice(0, 24)}`;
    const receiptMetadata = {
      sourceBackupId: verification.manifest.backupId,
      manifestSha256: verification.manifestHash,
      databaseSha256: databaseDigest,
      sourceRows: tableResults.reduce((total, result) => total + result.rows, 0),
      tables: tableResults.length,
      invalidatedOperatorSessions,
      clearedAuthenticationRateLimits,
      clearedApiRateLimits,
      sourceAuditIntegrity: {
        supported: sourceAuditIntegrity.supported,
        verified: sourceAuditIntegrity.valid,
        eventCount: sourceAuditIntegrity.eventCount || 0
      },
      rebuiltAuditChain,
      evidenceFiles: evidence.files.length,
      evidenceSha256: evidence.files.map(file => ({ source: file.source, bytes: file.bytes, sha256: file.sha256 }))
    };
    await appendHostedAuditEvent(client, {
      id: receiptId,
      entityType: 'operational_migration',
      entityId: verification.manifest.backupId,
      jobId: null,
      action: 'migrate_local_backup_to_hosted',
      actor,
      beforeJson: '{}',
      afterJson: '{}',
      metadataJson: JSON.stringify(receiptMetadata),
      createdAt: new Date().toISOString()
    });
    await client.query('COMMIT');
    committed = true;

    const validationLedger = new ContractorOperatingLedger({ databaseUrl });
    try {
      const diagnostics = validationLedger.diagnose();
      if (!diagnostics.valid) {
        const issueSummary = (diagnostics.issues || [])
          .slice(0, 5)
          .map(issue => issue.message)
          .filter(Boolean)
          .join('; ');
        throw new Error(`Hosted ledger diagnostics reported ${diagnostics.issueCount} issue(s) after migration.${issueSummary ? ` ${issueSummary}` : ''}`);
      }
      const auditIntegrity = validationLedger.verifyAuditIntegrity();
      if (!auditIntegrity.valid) throw new Error('Hosted ledger audit chain failed verification after migration.');
      const receipt = validationLedger.listAudit({ entityType: 'operational_migration', limit: 100 })
        .find(event => event.id === receiptId);
      if (!receipt) throw new Error('Hosted migration receipt was not retained.');
      return {
        success: true,
        backupId: verification.manifest.backupId,
        manifestSha256: verification.manifestHash,
        databaseSha256: databaseDigest,
        tables: tableResults,
        sourceRows: receiptMetadata.sourceRows,
        invalidatedOperatorSessions,
        clearedAuthenticationRateLimits,
        clearedApiRateLimits,
        sourceAuditIntegrity,
        auditIntegrity,
        evidenceFiles: evidence.files.length,
        receiptId,
        migrationVersion: destinationMigrations.currentVersion,
        diagnostics: { valid: diagnostics.valid, issueCount: diagnostics.issueCount }
      };
    } finally {
      validationLedger.close();
    }
  } catch (error) {
    if (!committed) {
      await client.query('ROLLBACK').catch(() => {});
      if (storage) {
        const cleanupFailures = [];
        for (const storageRef of [...uploadedObjects].reverse()) {
          try {
            await storage.remove(storageRef);
          } catch {
            cleanupFailures.push(storageRef);
          }
        }
        if (cleanupFailures.length) error.cleanupFailures = cleanupFailures.length;
      }
    }
    throw error;
  } finally {
    source.close();
    await client.end().catch(() => {});
  }
}

async function runCli() {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const dataDir = path.resolve(argumentsMap['data-dir'] || process.env.CONTRACTOR_AI_DATA_DIR || path.join(projectRoot, 'data'));
  const backupId = String(argumentsMap['backup-id'] || '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(backupId) || backupId === '.' || backupId === '..') {
    throw new Error('Set --backup-id to a valid verified local backup id.');
  }
  if (argumentsMap.confirm !== `MIGRATE_${backupId}`) {
    throw new Error(`Set --confirm MIGRATE_${backupId} to migrate this verified backup into an empty hosted target.`);
  }
  const databaseUrl = String(argumentsMap['database-url'] || process.env.CONTRACTOR_AI_DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('Set CONTRACTOR_AI_DATABASE_URL to the empty hosted PostgreSQL migration target.');
  const connection = resolvePostgresConnectionOptions(databaseUrl);
  if (!['require', 'verify-full'].includes(connection.sslMode)) {
    throw new Error('Hosted migration requires PostgreSQL TLS with sslmode=require or sslmode=verify-full.');
  }
  const storage = createHostedEvidenceStorageFromEnvironment();
  const result = await migrateLocalBackupToHosted({
    backupDir: path.join(dataDir, 'backups', backupId),
    databaseUrl,
    storage,
    actor: 'hosted_migration_cli'
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  runCli().catch(error => {
    process.stderr.write(`${error.message || 'Hosted migration failed.'}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  migrateLocalBackupToHosted,
  orderedSelfReferentialRows,
  orderedSourceTables,
  rewriteRowReferences,
  tableDigest,
  verifyBackupDirectory
};
