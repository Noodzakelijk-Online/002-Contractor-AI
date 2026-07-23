const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function parseTarFiles(buffer) {
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const readString = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '');
    assert.equal(readString(257, 6), 'ustar');
    const storedChecksum = Number.parseInt(readString(148, 8).trim() || '0', 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    assert.equal([...checksumHeader].reduce((total, byte) => total + byte, 0), storedChecksum);
    const name = readString(0, 100);
    const prefix = readString(345, 155);
    const size = Number.parseInt(readString(124, 12).trim() || '0', 8);
    const archivePath = prefix ? `${prefix}/${name}` : name;
    const contentStart = offset + 512;
    files.set(archivePath, buffer.subarray(contentStart, contentStart + size));
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

function loadServer(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-operations-'));
  Object.assign(process.env, {
    STATE_FILE: path.join(directory, 'state.json'),
    LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
    UPLOAD_DIR: path.join(directory, 'uploads'),
    NODE_ENV: 'test',
    CONTRACTOR_AI_RUNTIME_MODE: 'local',
    CONTRACTOR_AI_STORAGE_MODE: 'local',
    CONTRACTOR_AI_TRUST_PROXY: '',
    CONTRACTOR_AI_AUTONOMOUS_SCHEDULER_ENABLED: 'false',
    ...overrides
  });
  if (!Object.prototype.hasOwnProperty.call(overrides, 'CONTRACTOR_AI_DATABASE_URL')) delete process.env.CONTRACTOR_AI_DATABASE_URL;
  delete require.cache[require.resolve('../server')];
  return require('../server');
}

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  return { response, body: await response.json() };
}

test('operational export and backup are local, auditable maintenance controls', async t => {
  const app = loadServer();
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({ title: 'Real retained job', client: { name: 'Operations Client' }, address: 'Amsterdam' })
  });
  assert.equal(intake.response.status, 201);
  const exportedRfi = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/rfis`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Exported RFI', question: 'Retain this decision question.', status: 'open' })
  });
  assert.equal(exportedRfi.response.status, 201);
  const exportedSubmittal = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/submittals`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Exported submittal', status: 'draft' })
  });
  assert.equal(exportedSubmittal.response.status, 201);
  const exportedDocument = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/controlled-document-revisions`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Exported controlled plan',
      documentNumber: 'EXP-A-101',
      revision: 'P01',
      sourceReference: 'private:EXP-A-101-P01'
    })
  });
  assert.equal(exportedDocument.response.status, 201);

  const auditHistory = await request(baseUrl, '/api/ledger/audit?limit=1&includeFacets=true');
  assert.equal(auditHistory.response.status, 200);
  assert.equal(auditHistory.body.events.length, 1);
  assert.equal(auditHistory.body.page.limit, 1);
  assert.equal(auditHistory.body.page.returned, 1);
  assert.ok(Number.isSafeInteger(auditHistory.body.events[0].sequenceNumber));
  assert.match(auditHistory.body.events[0].eventHash, /^[a-f0-9]{64}$/);
  assert.match(auditHistory.body.events[0].previousHash, /^[a-f0-9]{64}$/);
  assert.ok(auditHistory.body.facets.entityTypes.length > 0);
  assert.ok(auditHistory.body.facets.actions.length > 0);
  assert.ok(auditHistory.body.facets.actors.length > 0);
  const filteredAuditHistory = await request(baseUrl, `/api/ledger/audit?limit=10&action=${encodeURIComponent(auditHistory.body.events[0].action)}`);
  assert.equal(filteredAuditHistory.response.status, 200);
  assert.ok(filteredAuditHistory.body.events.length > 0);
  assert.ok(filteredAuditHistory.body.events.every(event => event.action === auditHistory.body.events[0].action));
  const invalidAuditCursor = await request(baseUrl, '/api/ledger/audit?beforeSequence=invalid');
  assert.equal(invalidAuditCursor.response.status, 400);
  assert.equal(invalidAuditCursor.body.error.code, 'audit_cursor_invalid');

  const exported = await request(baseUrl, '/api/operations/export');
  assert.equal(exported.response.status, 200);
  assert.equal(exported.response.headers.get('cache-control'), 'no-store');
  assert.equal(exported.body.format, 'contractor-ai-operational-export/v2');
  assert.equal(exported.body.purpose, 'operator_reconciliation');
  assert.equal(exported.body.restorable, false);
  assert.match(exported.body.integrity.digest, /^[a-f0-9]{64}$/);
  assert.ok(exported.body.jobs.some(job => job.id === intake.body.job.id));
  assert.ok(Array.isArray(exported.body.billingMilestones));
  assert.ok(Array.isArray(exported.body.costForecastSnapshots));
  assert.ok(Array.isArray(exported.body.productionBaselines));
  assert.ok(Array.isArray(exported.body.productionEntries));
  assert.ok(Array.isArray(exported.body.attendanceSessions));
  assert.ok(Array.isArray(exported.body.attendanceAdjustments));
  assert.ok(Array.isArray(exported.body.supplierInvoices));
  assert.ok(Array.isArray(exported.body.supplierInvoicePayments));
  assert.ok(Array.isArray(exported.body.taskDependencies));
  assert.ok(Array.isArray(exported.body.scheduleBaselines));
  assert.ok(Array.isArray(exported.body.inspectionTemplates));
  assert.ok(Array.isArray(exported.body.inspectionChecklistSubmissions));
  assert.equal(exported.body.inspectionTemplates.filter(template => template.builtIn).length, 3);
  assert.ok(exported.body.projectControls.rfis.some(record => record.id === exportedRfi.body.rfi.id));
  assert.ok(exported.body.projectControls.submittals.some(record => record.id === exportedSubmittal.body.submittal.id));
  assert.ok(exported.body.projectControls.controlledDocuments.some(record => record.id === exportedDocument.body.document.id));
  assert.ok(Array.isArray(exported.body.handoverPackages));

  const exportValidation = await request(baseUrl, '/api/operations/exports/validate', {
    method: 'POST',
    body: JSON.stringify({ snapshot: exported.body })
  });
  assert.equal(exportValidation.response.status, 200);
  assert.equal(exportValidation.body.valid, true);
  assert.equal(exportValidation.body.restorable, false);
  assert.equal(exportValidation.body.integrity.verified, true);
  assert.equal(exportValidation.body.counts.jobs, exported.body.jobs.length);
  assert.equal(exportValidation.body.counts.billingMilestones, exported.body.billingMilestones.length);
  assert.equal(exportValidation.body.counts.costForecastSnapshots, exported.body.costForecastSnapshots.length);
  assert.equal(exportValidation.body.counts.productionBaselines, exported.body.productionBaselines.length);
  assert.equal(exportValidation.body.counts.productionEntries, exported.body.productionEntries.length);
  assert.equal(exportValidation.body.counts.attendanceSessions, exported.body.attendanceSessions.length);
  assert.equal(exportValidation.body.counts.attendanceAdjustments, exported.body.attendanceAdjustments.length);
  assert.equal(exportValidation.body.counts.supplierInvoices, exported.body.supplierInvoices.length);
  assert.equal(exportValidation.body.counts.supplierInvoicePayments, exported.body.supplierInvoicePayments.length);
  assert.equal(exportValidation.body.counts.taskDependencies, exported.body.taskDependencies.length);
  assert.equal(exportValidation.body.counts.scheduleBaselines, exported.body.scheduleBaselines.length);
  assert.equal(exportValidation.body.counts.inspectionTemplates, exported.body.inspectionTemplates.length);
  assert.equal(exportValidation.body.counts.inspectionChecklistSubmissions, exported.body.inspectionChecklistSubmissions.length);
  assert.equal(exportValidation.body.counts.rfis, exported.body.projectControls.rfis.length);
  assert.equal(exportValidation.body.counts.submittals, exported.body.projectControls.submittals.length);
  assert.equal(exportValidation.body.counts.controlledDocuments, exported.body.projectControls.controlledDocuments.length);
  assert.equal(exportValidation.body.counts.handoverPackages, exported.body.handoverPackages.length);

  const prePipelineExport = structuredClone(exported.body);
  delete prePipelineExport.opportunities;
  delete prePipelineExport.opportunityActivities;
  delete prePipelineExport.inspectionTemplates;
  delete prePipelineExport.inspectionChecklistSubmissions;
  delete prePipelineExport.projectControls;
  const { integrity: prePipelineIntegrity, ...prePipelinePayload } = prePipelineExport;
  prePipelineExport.integrity = {
    ...prePipelineIntegrity,
    digest: crypto.createHash('sha256').update(stableJson(prePipelinePayload)).digest('hex')
  };
  const prePipelineValidation = await request(baseUrl, '/api/operations/exports/validate', {
    method: 'POST',
    body: JSON.stringify({ snapshot: prePipelineExport })
  });
  assert.equal(prePipelineValidation.response.status, 200);
  assert.equal(prePipelineValidation.body.counts.opportunities, 0);
  assert.equal(prePipelineValidation.body.counts.opportunityActivities, 0);
  assert.equal(prePipelineValidation.body.counts.inspectionTemplates, 0);
  assert.equal(prePipelineValidation.body.counts.inspectionChecklistSubmissions, 0);
  assert.equal(prePipelineValidation.body.counts.rfis, 0);
  assert.equal(prePipelineValidation.body.counts.submittals, 0);
  assert.equal(prePipelineValidation.body.counts.controlledDocuments, 0);

  const tamperedExport = structuredClone(exported.body);
  tamperedExport.jobs[0].title = 'Tampered after export';
  const invalidExport = await request(baseUrl, '/api/operations/exports/validate', {
    method: 'POST',
    body: JSON.stringify({ snapshot: tamperedExport })
  });
  assert.equal(invalidExport.response.status, 422);
  assert.equal(invalidExport.body.error.code, 'export_integrity_failed');

  const wrongRestoreArtifact = await request(baseUrl, '/api/operations/restore/validate', {
    method: 'POST',
    body: JSON.stringify({ snapshot: exported.body })
  });
  assert.equal(wrongRestoreArtifact.response.status, 422);
  assert.equal(wrongRestoreArtifact.body.error.code, 'operational_export_not_restorable');

  const evidenceSource = path.join(process.env.UPLOAD_DIR, '2026-07', 'retained-site-proof.jpg');
  fs.mkdirSync(path.dirname(evidenceSource), { recursive: true });
  fs.writeFileSync(evidenceSource, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x42, 0x41, 0x43, 0x4b, 0x55, 0x50]));
  const backup = await request(baseUrl, '/api/operations/backup', { method: 'POST', body: '{}' });
  assert.equal(backup.response.status, 201);
  assert.ok(backup.body.backup.files.some(file => file.endsWith('operational-export.json')));
  assert.ok(backup.body.backup.files.some(file => file.endsWith('manifest.json')));
  assert.equal(backup.body.backup.evidenceFiles, 1);
  assert.equal(backup.body.backup.verification.valid, true);
  assert.ok(backup.body.backup.backupId);
  const backupDirectory = path.join(path.dirname(process.env.STATE_FILE), 'backups', backup.body.backup.backupId);
  const backupManifest = JSON.parse(fs.readFileSync(path.join(backupDirectory, 'manifest.json'), 'utf8'));
  assert.equal(backupManifest.format, 'contractor-ai-backup-manifest/v2');
  assert.deepEqual(backupManifest.evidence, { included: true, fileCount: 1 });
  assert.ok(backupManifest.files.some(file => file.file === 'evidence/2026-07/retained-site-proof.jpg'));
  assert.ok(fs.existsSync(path.join(backupDirectory, 'evidence', '2026-07', 'retained-site-proof.jpg')));

  const restoreValidation = await request(baseUrl, '/api/operations/restore/validate', {
    method: 'POST',
    body: JSON.stringify({ backupId: backup.body.backup.backupId })
  });
  assert.equal(restoreValidation.response.status, 200);
  assert.equal(restoreValidation.body.valid, true);
  assert.equal(restoreValidation.body.restorable, true);
  assert.equal(restoreValidation.body.verification.databaseVerification.valid, true);

  const backups = await request(baseUrl, '/api/operations/backups');
  assert.equal(backups.response.status, 200);
  assert.ok(backups.body.backups.some(entry => entry.backupId === backup.body.backup.backupId && entry.downloadAvailable === true));

  const verification = await request(baseUrl, `/api/operations/backups/${encodeURIComponent(backup.body.backup.backupId)}/verify`);
  assert.equal(verification.response.status, 200);
  assert.equal(verification.body.verification.valid, true);
  assert.ok(verification.body.verification.checkedFiles >= 2);

  const download = await fetch(`${baseUrl}/api/operations/backups/${encodeURIComponent(backup.body.backup.backupId)}/download`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/gzip');
  assert.match(download.headers.get('content-disposition') || '', new RegExp(backup.body.backup.backupId));
  assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.equal(
    download.headers.get('x-contractor-ai-manifest-sha256'),
    crypto.createHash('sha256').update(fs.readFileSync(path.join(backupDirectory, 'manifest.json'))).digest('hex')
  );
  const archive = parseTarFiles(zlib.gunzipSync(Buffer.from(await download.arrayBuffer())));
  const archiveRoot = backup.body.backup.backupId;
  assert.ok(archive.has(`${archiveRoot}/manifest.json`));
  assert.ok(archive.has(`${archiveRoot}/ledger.sqlite`));
  assert.ok(archive.has(`${archiveRoot}/operational-export.json`));
  assert.deepEqual(archive.get(`${archiveRoot}/evidence/2026-07/retained-site-proof.jpg`), fs.readFileSync(evidenceSource));
  assert.deepEqual(JSON.parse(archive.get(`${archiveRoot}/manifest.json`).toString('utf8')), backupManifest);

  fs.writeFileSync(path.join(backupDirectory, 'manifest.json'), JSON.stringify({
    ...backupManifest,
    files: [...backupManifest.files, { file: '../outside.txt', bytes: 0, sha256: '0'.repeat(64) }]
  }, null, 2));
  const unsafeDownload = await request(baseUrl, `/api/operations/backups/${encodeURIComponent(backup.body.backup.backupId)}/download`);
  assert.equal(unsafeDownload.response.status, 409);
  assert.equal(unsafeDownload.body.error.code, 'backup_integrity_failed');
  assert.ok(unsafeDownload.body.verification.failures.some(failure => failure.file === '../outside.txt' && failure.reason === 'unsafe_manifest_path'));
  fs.writeFileSync(path.join(backupDirectory, 'manifest.json'), JSON.stringify(backupManifest, null, 2));

  fs.appendFileSync(path.join(backupDirectory, 'evidence', '2026-07', 'retained-site-proof.jpg'), 'tampered');
  const tamperedVerification = await request(baseUrl, `/api/operations/backups/${encodeURIComponent(backup.body.backup.backupId)}/verify`);
  assert.equal(tamperedVerification.response.status, 409);
  assert.equal(tamperedVerification.body.verification.valid, false);
  assert.ok(tamperedVerification.body.verification.failures.some(failure => failure.file === 'evidence/2026-07/retained-site-proof.jpg' && failure.reason === 'checksum_mismatch'));

  const blockedRestore = await request(baseUrl, '/api/operations/restore/validate', {
    method: 'POST',
    body: JSON.stringify({ backupId: backup.body.backup.backupId })
  });
  assert.equal(blockedRestore.response.status, 409);
  assert.equal(blockedRestore.body.valid, false);
  assert.equal(blockedRestore.body.restorable, false);

  const blockedDownload = await request(baseUrl, `/api/operations/backups/${encodeURIComponent(backup.body.backup.backupId)}/download`);
  assert.equal(blockedDownload.response.status, 409);
  assert.equal(blockedDownload.body.error.code, 'backup_integrity_failed');

  const invalidBackup = await request(baseUrl, '/api/operations/backups/..%2Fstate/verify');
  assert.equal(invalidBackup.response.status, 400);
  assert.equal(invalidBackup.body.error.code, 'invalid_backup_id');

  const readiness = await request(baseUrl, '/api/readiness');
  assert.equal(readiness.response.status, 200);
  assert.equal(readiness.body.runtime.mode, 'local');
  assert.equal(readiness.body.status, 'ready');
  assert.equal(readiness.body.runtime.evidenceStorage.status, 'verified');
  assert.equal(readiness.body.runtime.evidenceStorage.verified, true);
  assert.equal(readiness.body.ledger.migrations.currentVersion, '059_crew_capacity_lookahead');
  assert.equal(readiness.body.ledger.auditIntegrity.valid, true);
  assert.deepEqual(readiness.body.ledger.migrations.pending, []);

  const publicReadiness = await request(baseUrl, '/api/health/ready');
  assert.equal(publicReadiness.response.status, 200);
  assert.equal(publicReadiness.body.status, 'ready');
  assert.equal(publicReadiness.body.checks.evidenceStorage, 'verified');
  assert.equal(publicReadiness.body.runtime, undefined);

  const health = await request(baseUrl, '/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.services.ai, 'ledger_only');
  assert.equal(health.body.services.notifications, 'draft_only');

  const capabilities = await request(baseUrl, '/api/operations/capabilities');
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.body.status, 'ready');
  assert.equal(capabilities.body.localFirst, true);
  assert.equal(capabilities.body.capabilities.export.format, 'contractor-ai-operational-export/v2');
  assert.equal(capabilities.body.capabilities.export.restorable, false);
  assert.equal(capabilities.body.capabilities.export.integrity, 'sha256');
  assert.equal(capabilities.body.capabilities.backup.available, true);
  assert.equal(capabilities.body.capabilities.backup.evidenceIncluded, true);
  assert.equal(capabilities.body.capabilities.backup.portableDownload, true);
  assert.equal(capabilities.body.capabilities.backup.packageFormat, 'tar.gz');
  assert.equal(capabilities.body.capabilities.hostedMigration.available, true);
  assert.equal(capabilities.body.capabilities.hostedMigration.source, 'verified_backup_v2');
  assert.equal(capabilities.body.capabilities.hostedMigration.target, 'postgresql+s3');
  assert.equal(capabilities.body.capabilities.hostedMigration.evidenceReadBackVerification, true);
  assert.equal(capabilities.body.capabilities.hostedMigration.emptyTargetRequired, true);
  assert.equal(capabilities.body.capabilities.restore.stoppedRuntimeRequired, true);
  assert.equal(capabilities.body.capabilities.restore.validation, 'retained_backup_id');
  assert.equal(capabilities.body.capabilities.providerRecovery.available, false);
  assert.equal(capabilities.body.capabilities.providerRecovery.applicationPackageAvailable, true);
  assert.equal(capabilities.body.capabilities.persistence.schemaInitialization.serialized, true);
  assert.equal(capabilities.body.capabilities.persistence.schemaInitialization.mechanism, 'sqlite_write_transaction');
  assert.equal(capabilities.body.capabilities.auditIntegrity.valid, true);
  assert.equal(capabilities.body.capabilities.auditIntegrity.status, 'verified');
  assert.equal(capabilities.body.capabilities.auditIntegrity.algorithm, 'sha256');
  assert.equal(capabilities.body.capabilities.auditIntegrity.appendMode, 'atomic_hash_chain');
  assert.equal(capabilities.body.capabilities.auditIntegrity.verificationEndpoint, '/api/operations/audit-integrity');
  assert.equal(capabilities.body.capabilities.auditIntegrity.historyEndpoint, '/api/ledger/audit');
  assert.equal(capabilities.body.capabilities.auditIntegrity.historyAccess, 'owner_only');
  assert.equal(capabilities.body.capabilities.auditIntegrity.historyPagination, 'sequence_cursor');
  assert.deepEqual(capabilities.body.capabilities.auditIntegrity.historyFilters,
    ['query', 'jobId', 'entityType', 'entityId', 'action', 'actor', 'from', 'until']);
  assert.equal(capabilities.body.capabilities.authentication.loginRateLimit.durability, 'ledger');
  assert.equal(capabilities.body.capabilities.authentication.loginRateLimit.keyMaterial, 'hmac-sha256');
  assert.equal(capabilities.body.capabilities.authentication.loginRateLimit.successfulLoginResetsFailures, true);
  assert.equal(capabilities.body.capabilities.authentication.loginRateLimit.multiReplicaSafe, true);
  assert.equal(capabilities.body.capabilities.evidenceStorage.privateAccess, true);
  assert.equal(capabilities.body.capabilities.evidenceStorage.status, 'verified');
  assert.ok(capabilities.body.capabilities.evidenceStorage.verifiedAt);
  assert.equal(capabilities.body.capabilities.requestSafety.apiRateLimit.durability, 'ledger');
  assert.equal(capabilities.body.capabilities.requestSafety.apiRateLimit.keyMaterial, 'hmac-sha256-bucket');
  assert.equal(capabilities.body.capabilities.requestSafety.apiRateLimit.boundedCardinality, true);
  assert.equal(capabilities.body.capabilities.requestSafety.apiRateLimit.multiReplicaSafe, true);
  assert.equal(capabilities.body.capabilities.requestSafety.evidenceUploadIdempotency, 'durable');
  assert.equal(capabilities.body.capabilities.requestSafety.evidenceUploadLeaseOwnership, 'unique_claim_token');
  assert.equal(capabilities.body.capabilities.requestSafety.evidenceUploadReclaimSafe, true);
  assert.equal(capabilities.body.capabilities.requestSafety.progressEntryKey, 'durable');
  assert.equal(capabilities.body.capabilities.requestSafety.productionEntryKey, 'durable');
  assert.equal(capabilities.body.capabilities.requestSafety.productionEntryReversal, 'approval_gated_compensating_record');
  assert.equal(capabilities.body.capabilities.requestSafety.dailyLogEntryKey, 'durable');
  assert.equal(capabilities.body.capabilities.requestSafety.taskLifecycle, 'retained');
  assert.equal(capabilities.body.capabilities.requestSafety.taskCompletionEvidenceRequired, true);
  assert.equal(capabilities.body.capabilities.requestSafety.fieldTaskScopeEnforced, true);
  assert.equal(capabilities.body.capabilities.requestSafety.fieldMutationAtomicity, true);
  assert.equal(capabilities.body.capabilities.requestSafety.equipmentRetirement, 'approval_gated');
  assert.equal(capabilities.body.capabilities.requestSafety.equipmentActiveReservationGate, true);
  assert.equal(capabilities.body.capabilities.requestSafety.equipmentDormantReservationRelease, 'retained_atomic');
  assert.equal(capabilities.body.capabilities.requestSafety.browserOutboxScope, 'operator');
  assert.equal(capabilities.body.capabilities.requestSafety.payloadConflictRejected, true);
  assert.equal(capabilities.body.capabilities.communications.outboundDraftOnly, true);
  assert.equal(capabilities.body.capabilities.communications.deliveryReceiptApprovalRequired, true);
  assert.equal(capabilities.body.capabilities.communications.verifiedIntegrationCount, 0);
  assert.deepEqual(capabilities.body.capabilities.changeControl, {
    serverCalculatedTotals: true,
    durableNumbering: true,
    dayworkTicketNumbering: true,
    dayworkCommercialPricing: 'office_only_after_internal_approval',
    dayworkAcknowledgementChangesContractValue: false,
    immutableHtmlPackage: true,
    deliveryApprovalRequired: true,
    verifiedProviderReceiptRequired: true,
    acceptanceBoundToIssuedPackage: true,
    contractValueChange: 'verified_acceptance_only'
  });
  assert.equal(capabilities.body.capabilities.costForecasting.sourceLinked, true);
  assert.equal(capabilities.body.capabilities.costForecasting.costCodeBreakdown, true);
  assert.equal(capabilities.body.capabilities.costForecasting.doubleCountControl, 'supplier_invoice_reduces_linked_order_commitment');
  assert.equal(capabilities.body.capabilities.costForecasting.immutableSnapshots, true);
  assert.equal(capabilities.body.capabilities.costForecasting.approvalRequired, true);
  assert.equal(capabilities.body.capabilities.costForecasting.sourceCurrentApprovalRequired, true);
  assert.equal(capabilities.body.capabilities.costForecasting.externalCommitments, 0);
  assert.equal(capabilities.body.capabilities.productionControl.immutableBaselines, true);
  assert.equal(capabilities.body.capabilities.productionControl.baselineApprovalRequired, true);
  assert.equal(capabilities.body.capabilities.productionControl.earnedHoursCalculation, true);
  assert.equal(capabilities.body.capabilities.productionControl.replaySafeFieldCapture, true);
  assert.equal(capabilities.body.capabilities.productionControl.autonomousVarianceReview, 'internal_task_only');
  assert.equal(capabilities.body.capabilities.productionControl.externalCommitments, 0);
  assert.equal(capabilities.body.capabilities.invoicing.serverCalculatedTotals, true);
  assert.equal(capabilities.body.capabilities.invoicing.durableNumbering, true);
  assert.equal(capabilities.body.capabilities.invoicing.immutableHtmlPackage, true);
  assert.equal(capabilities.body.capabilities.invoicing.ubl21Export, true);
  assert.equal(capabilities.body.capabilities.invoicing.structuredReadinessChecks, true);
  assert.equal(capabilities.body.capabilities.invoicing.networkSubmission, false);
  assert.equal(capabilities.body.capabilities.invoicing.deliveryReceiptApprovalRequired, true);
  assert.equal(capabilities.body.capabilities.automation.ledgerOnly, true);
  assert.equal(capabilities.body.capabilities.automation.coordination, 'durable_compare_and_swap_lease');
  assert.equal(capabilities.body.capabilities.automation.multiReplicaSafe, true);
  assert.equal(capabilities.body.capabilities.automation.externalCommitments, 0);

  const auditIntegrity = await request(baseUrl, '/api/operations/audit-integrity');
  assert.equal(auditIntegrity.response.status, 200);
  assert.equal(auditIntegrity.body.success, true);
  assert.equal(auditIntegrity.body.integrity.valid, true);
  assert.ok(auditIntegrity.body.integrity.eventCount >= 1);
});

test('QA reset requires explicit confirmation and preserves non-QA work', async t => {
  const app = loadServer();
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const real = await request(baseUrl, '/api/ledger/intake', { method: 'POST', body: JSON.stringify({ title: 'Kitchen handover', client: { name: 'Real Client' } }) });
  const qa = await request(baseUrl, '/api/ledger/intake', { method: 'POST', body: JSON.stringify({ title: 'Browser QA dispatch fixture', client: { name: 'QA Client' } }) });
  const realOpportunity = await request(baseUrl, '/api/ledger/opportunities', { method: 'POST', body: JSON.stringify({ title: 'School roof inquiry', client: { name: 'Municipal Client' }, estimatedValue: 18000 }) });
  const qaOpportunity = await request(baseUrl, '/api/ledger/opportunities', { method: 'POST', body: JSON.stringify({ title: 'Browser QA pipeline fixture', client: { name: 'Demo Pipeline Client' }, estimatedValue: 4200 }) });
  const realWorker = await request(baseUrl, '/api/ledger/workers', { method: 'POST', body: JSON.stringify({ name: 'Field supervisor', status: 'available' }) });
  const qaWorker = await request(baseUrl, '/api/ledger/workers', { method: 'POST', body: JSON.stringify({ name: 'Browser QA field worker', status: 'available' }) });
  const realTool = await request(baseUrl, '/api/ledger/tools', { method: 'POST', body: JSON.stringify({ name: 'Company laser level', status: 'available' }) });
  const qaTool = await request(baseUrl, '/api/ledger/tools', { method: 'POST', body: JSON.stringify({ name: 'Demo laser level', status: 'available' }) });
  assert.equal(real.response.status, 201);
  assert.equal(qa.response.status, 201);
  assert.equal(realOpportunity.response.status, 201);
  assert.equal(qaOpportunity.response.status, 201);
  assert.equal(realWorker.response.status, 201);
  assert.equal(qaWorker.response.status, 201);
  assert.equal(realTool.response.status, 201);
  assert.equal(qaTool.response.status, 201);

  const missingConfirmation = await request(baseUrl, '/api/operations/reset-qa', { method: 'POST', body: '{}' });
  assert.equal(missingConfirmation.response.status, 400);
  assert.equal(missingConfirmation.body.error.code, 'confirmation_required');

  const reset = await request(baseUrl, '/api/operations/reset-qa', { method: 'POST', body: JSON.stringify({ confirmation: 'RESET_QA' }) });
  assert.equal(reset.response.status, 200);
  assert.ok(reset.body.archivedLedgerJobIds.includes(qa.body.job.id));
  assert.ok(reset.body.archivedOpportunityIds.includes(qaOpportunity.body.opportunity.id));
  assert.ok(reset.body.retiredWorkerIds.includes(qaWorker.body.worker.id));
  assert.ok(reset.body.retiredToolIds.includes(qaTool.body.tool.id));

  const jobs = await request(baseUrl, '/api/ledger/jobs?includeArchived=true&limit=100');
  const realJob = jobs.body.jobs.find(job => job.id === real.body.job.id);
  const qaJob = jobs.body.jobs.find(job => job.id === qa.body.job.id);
  assert.equal(realJob.status, 'intake');
  assert.equal(qaJob.status, 'archived');

  const opportunities = await request(baseUrl, '/api/ledger/opportunities?includeClosed=true&limit=100');
  assert.equal(opportunities.body.opportunities.find(opportunity => opportunity.id === realOpportunity.body.opportunity.id).stage, 'new');
  assert.equal(opportunities.body.opportunities.find(opportunity => opportunity.id === qaOpportunity.body.opportunity.id).stage, 'archived');

  const workers = await request(baseUrl, '/api/ledger/workers?limit=100');
  assert.equal(workers.body.workers.find(worker => worker.id === realWorker.body.worker.id).status, 'available');
  assert.equal(workers.body.workers.find(worker => worker.id === qaWorker.body.worker.id).status, 'retired');
  const tools = await request(baseUrl, '/api/ledger/tools?limit=100');
  assert.equal(tools.body.tools.find(tool => tool.id === realTool.body.tool.id).status, 'available');
  assert.equal(tools.body.tools.find(tool => tool.id === qaTool.body.tool.id).status, 'retired');

  const pendingApprovals = await request(baseUrl, '/api/ledger/approvals?status=pending&limit=500');
  assert.equal(pendingApprovals.response.status, 200);
  assert.ok(!pendingApprovals.body.approvals.some(approval => /\b(browser|qa|demo|sample)\b/i.test(approval.summary || '')));

  const dashboard = await request(baseUrl, '/api/ledger/dashboard');
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.dashboard.money.estimatedPipeline, 0);
  assert.ok(!dashboard.body.dashboard.nextActions.some(action => /\b(browser|qa|demo|sample)\b/i.test(action.message || '')));

  const commandPlan = await request(baseUrl, '/api/ledger/command-plan?limit=100');
  assert.equal(commandPlan.response.status, 200);
  assert.ok(!commandPlan.body.actions.some(action => /\b(browser|qa|demo|sample)\b/i.test(action.message || '')));
});

test('manual scheduler requests use a persisted lease and do not immediately repeat', async t => {
  const app = loadServer();
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const status = await request(baseUrl, '/api/ledger/scheduler');
  assert.equal(status.response.status, 200);
  assert.equal(status.body.scheduler.enabled, false);
  assert.equal(status.body.scheduler.job, null);

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Durable scheduler retained work',
      service: 'Deck repair',
      address: 'Prinsengracht 10, Amsterdam',
      client: { name: 'Scheduler Client' }
    })
  });
  assert.equal(intake.response.status, 201);
  const planned = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'planned' })
  });
  assert.equal(planned.response.status, 200);
  assert.equal(planned.body.requiresApproval, false);

  const preview = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, maxActions: 10 })
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.dryRun, true);
  assert.ok(preview.body.preview.some(action => action.jobId === intake.body.job.id));
  const statusAfterPreview = await request(baseUrl, '/api/ledger/scheduler');
  assert.equal(statusAfterPreview.body.scheduler.job, null);

  const first = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: false, maxActions: 10 })
  });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.durable.ran, true);
  assert.equal(first.body.durable.completed, true);
  assert.ok(first.body.scheduler.job.lastCompletedAt);
  assert.ok(first.body.applied.length > 0);
  assert.equal(first.body.summary.applied, first.body.applied.length);
  assert.equal(first.body.summary.blocked, first.body.blocked.length);
  assert.equal(first.body.summary.externalCommitments, 0);
  assert.ok(first.body.blocked.some(action =>
    action.type === 'create_budget_line'
    && /positive estimate or contract value/i.test(action.reason)
  ));
  assert.equal(first.body.scheduler.job.lastResult.actionCount, first.body.applied.length);
  assert.equal(first.body.scheduler.job.lastResult.blockedCount, first.body.blocked.length);

  const repeated = await request(baseUrl, '/api/ledger/scheduler/run', { method: 'POST', body: '{}' });
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.body.ran, false);
  assert.equal(repeated.body.claim.reason, 'not_due');
});

test('hosted readiness uses the PostgreSQL ledger adapter when durable services are configured', { skip: !process.env.CONTRACTOR_AI_POSTGRES_TEST_URL }, async t => {
  const storageEndpoint = 'https://s3.eu-central-1.example.test';
  const originalFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    if (String(input).startsWith(storageEndpoint)) {
      const body = options.method === 'GET' ? 'contractor-ai-storage-readiness/v1' : null;
      return new Response(body, { status: 200 });
    }
    return originalFetch(input, options);
  };
  t.after(() => { global.fetch = originalFetch; });
  const app = loadServer({
    NODE_ENV: 'production',
    CONTRACTOR_AI_RUNTIME_MODE: 'hosted',
    CONTRACTOR_AI_STORAGE_MODE: 's3',
    CONTRACTOR_AI_AUTH_TOKEN: 'production-token-with-sufficient-length',
    CONTRACTOR_AI_DATABASE_URL: process.env.CONTRACTOR_AI_POSTGRES_TEST_URL,
    CONTRACTOR_AI_PUBLIC_URL: 'https://contractor-ai.test',
    CONTRACTOR_AI_HOSTING_PROVIDER: 'EU Test Provider',
    CONTRACTOR_AI_HOSTING_REGION: 'eu-central-1',
    CONTRACTOR_AI_DATA_RESIDENCY: 'EU',
    CONTRACTOR_AI_DPA_REFERENCE: 'DPA-operations-test-2026',
    CONTRACTOR_AI_POSTGRES_BACKUP_MODE: 'pitr',
    CONTRACTOR_AI_OBJECT_VERSIONING_ENABLED: 'true',
    CONTRACTOR_AI_BACKUP_POLICY_REFERENCE: 'recovery-operations-test-2026',
    CONTRACTOR_AI_TRUST_PROXY: 'loopback',
    CORS_ORIGINS: 'https://contractor-ai.test',
    CONTRACTOR_AI_S3_ENDPOINT: storageEndpoint,
    CONTRACTOR_AI_S3_BUCKET: 'contractor-private',
    CONTRACTOR_AI_S3_ACCESS_KEY_ID: 'test-access',
    CONTRACTOR_AI_S3_SECRET_ACCESS_KEY: 'test-secret'
  });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const readiness = await request(baseUrl, '/api/readiness', {
    headers: { Authorization: 'Bearer production-token-with-sufficient-length' }
  });
  assert.equal(readiness.response.status, 200);
  assert.equal(readiness.body.status, 'ready');
  assert.equal(readiness.body.runtime.databaseMode, 'postgres');
  assert.equal(readiness.body.runtime.evidenceStorage.status, 'verified');
  assert.equal(readiness.body.runtime.evidenceStorage.verified, true);
  assert.equal(readiness.body.runtime.hosting.publicHttps, true);
  assert.equal(readiness.body.runtime.hosting.publicOriginAllowed, true);
  assert.equal(readiness.body.runtime.hosting.trustedProxyConfigured, true);
  assert.equal(readiness.body.runtime.hosting.trustedProxyEntryCount, 1);
  assert.equal(readiness.body.runtime.hosting.dataResidency, 'EU');
  assert.equal(readiness.body.runtime.hosting.dpaConfigured, true);
  assert.equal(readiness.body.runtime.hosting.recovery.postgresBackupMode, 'pitr');
  assert.equal(readiness.body.runtime.hosting.recovery.objectVersioningEnabled, true);
  assert.ok(!readiness.body.runtime.issues.some(issue => issue.code === 'hosted_postgres_adapter_required'));

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    headers: { Authorization: 'Bearer production-token-with-sufficient-length' },
    body: JSON.stringify({ title: 'Hosted PostgreSQL API contract', client: { name: 'Hosted Contract Client' } })
  });
  assert.equal(intake.response.status, 201);
  assert.ok(intake.body.job.id);
  assert.ok(Array.isArray(intake.body.dashboard.nextActions));

  const authHeaders = { Authorization: 'Bearer production-token-with-sufficient-length', 'Content-Type': 'application/json' };
  const hostedBackup = await request(baseUrl, '/api/operations/backup', { method: 'POST', headers: authHeaders, body: '{}' });
  assert.equal(hostedBackup.response.status, 409);
  assert.equal(hostedBackup.body.error.code, 'provider_recovery_required');
  const hostedBackupList = await request(baseUrl, '/api/operations/backups', { headers: authHeaders });
  assert.equal(hostedBackupList.response.status, 409);
  assert.equal(hostedBackupList.body.error.code, 'provider_recovery_required');
  const hostedReset = await request(baseUrl, '/api/operations/reset-qa', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ confirmation: 'RESET_QA' })
  });
  assert.equal(hostedReset.response.status, 409);
  assert.equal(hostedReset.body.error.code, 'provider_recovery_required');
  const retainedJob = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}`, { headers: authHeaders });
  assert.equal(retainedJob.response.status, 200);
  assert.notEqual(retainedJob.body.job.status, 'archived');

  const capabilities = await request(baseUrl, '/api/operations/capabilities', { headers: authHeaders });
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.body.capabilities.backup.available, false);
  assert.equal(capabilities.body.capabilities.providerRecovery.available, true);
  assert.equal(capabilities.body.capabilities.providerRecovery.postgresBackupMode, 'pitr');
  assert.equal(capabilities.body.capabilities.providerRecovery.objectVersioningEnabled, true);
  assert.equal(capabilities.body.capabilities.providerRecovery.policyConfigured, true);
  assert.equal(capabilities.body.capabilities.providerRecovery.applicationPackageAvailable, false);
  assert.equal(capabilities.body.capabilities.persistence.schemaInitialization.serialized, true);
  assert.equal(capabilities.body.capabilities.persistence.schemaInitialization.mechanism, 'postgres_advisory_lock');

  const publicReadiness = await request(baseUrl, '/api/health/ready');
  assert.equal(publicReadiness.response.status, 200);
  assert.equal(publicReadiness.body.checks.evidenceStorage, 'verified');
  assert.equal(publicReadiness.body.runtime, undefined);
});

test('hosted readiness fails closed when object storage rejects the verification marker', { skip: !process.env.CONTRACTOR_AI_POSTGRES_TEST_URL }, async t => {
  const storageEndpoint = 'https://s3-denied.eu-central-1.example.test';
  const originalFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    if (String(input).startsWith(storageEndpoint)) return new Response(null, { status: 403 });
    return originalFetch(input, options);
  };
  t.after(() => { global.fetch = originalFetch; });
  const app = loadServer({
    NODE_ENV: 'production',
    CONTRACTOR_AI_RUNTIME_MODE: 'hosted',
    CONTRACTOR_AI_STORAGE_MODE: 's3',
    CONTRACTOR_AI_AUTH_TOKEN: 'production-token-with-sufficient-length',
    CONTRACTOR_AI_DATABASE_URL: process.env.CONTRACTOR_AI_POSTGRES_TEST_URL,
    CONTRACTOR_AI_PUBLIC_URL: 'https://contractor-ai.test',
    CONTRACTOR_AI_HOSTING_PROVIDER: 'EU Test Provider',
    CONTRACTOR_AI_HOSTING_REGION: 'eu-central-1',
    CONTRACTOR_AI_DATA_RESIDENCY: 'EU',
    CONTRACTOR_AI_DPA_REFERENCE: 'DPA-operations-test-2026',
    CONTRACTOR_AI_POSTGRES_BACKUP_MODE: 'pitr',
    CONTRACTOR_AI_OBJECT_VERSIONING_ENABLED: 'true',
    CONTRACTOR_AI_BACKUP_POLICY_REFERENCE: 'recovery-operations-test-2026',
    CONTRACTOR_AI_TRUST_PROXY: 'loopback',
    CORS_ORIGINS: 'https://contractor-ai.test',
    CONTRACTOR_AI_S3_ENDPOINT: storageEndpoint,
    CONTRACTOR_AI_S3_BUCKET: 'contractor-private',
    CONTRACTOR_AI_S3_ACCESS_KEY_ID: 'test-access',
    CONTRACTOR_AI_S3_SECRET_ACCESS_KEY: 'test-secret'
  });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const readiness = await request(baseUrl, '/api/readiness', {
    headers: { Authorization: 'Bearer production-token-with-sufficient-length' }
  });
  assert.equal(readiness.response.status, 503);
  assert.equal(readiness.body.status, 'attention');
  assert.equal(readiness.body.runtime.evidenceStorage.status, 'unavailable');
  assert.ok(readiness.body.runtime.issues.some(issue => issue.code === 'object_storage_request_failed'));

  const publicReadiness = await request(baseUrl, '/api/health/ready');
  assert.equal(publicReadiness.response.status, 503);
  assert.equal(publicReadiness.body.checks.evidenceStorage, 'unavailable');
  assert.equal(publicReadiness.body.runtime, undefined);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', {
    headers: { Authorization: 'Bearer production-token-with-sufficient-length' }
  });
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.body.status, 'attention');
  assert.equal(capabilities.body.capabilities.evidenceStorage.errorCode, 'object_storage_request_failed');
});
