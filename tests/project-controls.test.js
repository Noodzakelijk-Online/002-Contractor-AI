const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { ContractorOperatingLedger } = require('../operating-ledger');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-project-controls-'));
const tokens = {
  owner: 'project-controls-owner-token-at-least-32-characters',
  approver: 'project-controls-approver-token-at-least-32-characters',
  office_operator: 'project-controls-office-token-at-least-32-characters',
  field_worker: { token: 'project-controls-field-token-at-least-32-characters', jobIds: ['unassigned'] }
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify(tokens),
  STATE_FILE: path.join(directory, 'state.json'),
  LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(directory, 'uploads')
});
delete process.env.CONTRACTOR_AI_AUTH_TOKEN;
delete process.env.DASHBOARD_AUTH_TOKEN;

const app = require('../server');

async function request(baseUrl, route, token, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

async function resolveApproval(baseUrl, approvalId, reason) {
  const result = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(approvalId)}/resolve`, tokens.owner, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Project controls owner', reason })
  });
  assert.equal(result.response.status, 200);
  return result.body.approval;
}

test('project-control API retains approval-gated document revisions and enforces operator boundaries', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'project_controls_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Controlled renovation project',
      service: 'renovation',
      description: 'Project-control workflow fixture.',
      client: { name: 'Project controls client' }
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const fieldDenied = await request(baseUrl, `/api/ledger/jobs/${jobId}/controlled-document-revisions`, tokens.field_worker.token, {
    method: 'POST',
    body: JSON.stringify({ documentNumber: 'A-101', revision: 'P01', title: 'Plan', sourceReference: 'private:A-101-P01' })
  });
  assert.equal(fieldDenied.response.status, 403);
  assert.equal(fieldDenied.body.error.code, 'insufficient_role');

  const approverDenied = await request(baseUrl, `/api/ledger/jobs/${jobId}/rfis`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({ title: 'Unauthorized RFI', question: 'Should not be created.' })
  });
  assert.equal(approverDenied.response.status, 403);

  const bypassDenied = await request(baseUrl, `/api/ledger/jobs/${jobId}/documents`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ type: 'controlled_document', title: 'Bypass', documentNumber: 'A-101', revision: 'P01' })
  });
  assert.equal(bypassDenied.response.status, 400);
  assert.equal(bypassDenied.body.error.code, 'controlled_document_workflow_required');

  const first = await request(baseUrl, `/api/ledger/jobs/${jobId}/controlled-document-revisions`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      documentNumber: 'A-101',
      revision: 'P01',
      title: 'Ground-floor construction plan',
      discipline: 'architectural',
      sourceReference: 'private:A-101-P01',
      actor: 'role:owner:spoofed'
    })
  });
  assert.equal(first.response.status, 201);
  assert.equal(first.body.document.status, 'draft');
  assert.equal(first.body.document.data.isCurrent, false);
  assert.equal(first.body.document.data.createdBy, 'role:office_operator');
  assert.equal(first.body.approvalRequiredBeforeCurrent, true);

  const duplicate = await request(baseUrl, `/api/ledger/jobs/${jobId}/controlled-document-revisions`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      documentNumber: 'A-101',
      revision: 'P01',
      title: 'Duplicate plan',
      sourceReference: 'private:duplicate'
    })
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, 'controlled_document_revision_exists');

  const missingReviewEvidence = await request(baseUrl, `/api/ledger/jobs/${jobId}/lifecycle/document/${first.body.document.id}`, tokens.office_operator, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved' })
  });
  assert.equal(missingReviewEvidence.response.status, 400);

  const firstReview = await request(baseUrl, `/api/ledger/jobs/${jobId}/lifecycle/document/${first.body.document.id}`, tokens.office_operator, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved', verificationReference: 'check:A-101-P01', notes: 'Dimensions and coordination checked.' })
  });
  assert.equal(firstReview.response.status, 200);
  assert.equal(firstReview.body.record.status, 'pending_approval');
  await resolveApproval(baseUrl, firstReview.body.approval.id, 'P01 source and checker record verified.');

  const missingReason = await request(baseUrl, `/api/ledger/jobs/${jobId}/controlled-document-revisions`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      documentNumber: 'A-101',
      revision: 'P02',
      title: 'Ground-floor construction plan',
      discipline: 'architectural',
      sourceReference: 'private:A-101-P02'
    })
  });
  assert.equal(missingReason.response.status, 400);
  assert.equal(missingReason.body.error.code, 'controlled_document_revision_reason_required');

  const second = await request(baseUrl, `/api/ledger/jobs/${jobId}/controlled-document-revisions`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      documentNumber: 'A-101',
      revision: 'P02',
      title: 'Ground-floor construction plan',
      discipline: 'architectural',
      sourceReference: 'private:A-101-P02',
      revisionReason: 'Door opening coordinated with structural detail.'
    })
  });
  assert.equal(second.response.status, 201);
  assert.equal(second.body.document.supersedesDocumentId, first.body.document.id);
  const branchedCandidate = await request(baseUrl, `/api/ledger/jobs/${jobId}/controlled-document-revisions`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      documentNumber: 'A-101',
      revision: 'P03',
      title: 'Branched construction plan',
      sourceReference: 'private:A-101-P03',
      revisionReason: 'Attempted branch while P02 is unresolved.'
    })
  });
  assert.equal(branchedCandidate.response.status, 409);
  assert.equal(branchedCandidate.body.error.code, 'controlled_document_candidate_exists');
  let detail = await request(baseUrl, `/api/ledger/jobs/${jobId}`, tokens.owner);
  assert.equal(detail.body.job.documents.find(document => document.id === first.body.document.id).status, 'approved');
  assert.equal(detail.body.job.documents.find(document => document.id === first.body.document.id).data.isCurrent, true);

  const secondReview = await request(baseUrl, `/api/ledger/jobs/${jobId}/lifecycle/document/${second.body.document.id}`, tokens.office_operator, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved', verificationReference: 'check:A-101-P02', notes: 'Coordination change and source file checked.' })
  });
  assert.equal(secondReview.response.status, 200);

  const officeCannotApprove = await request(baseUrl, `/api/ledger/approvals/${secondReview.body.approval.id}/resolve`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved' })
  });
  assert.equal(officeCannotApprove.response.status, 403);
  await resolveApproval(baseUrl, secondReview.body.approval.id, 'P02 checker evidence verified.');

  detail = await request(baseUrl, `/api/ledger/jobs/${jobId}`, tokens.owner);
  const firstFinal = detail.body.job.documents.find(document => document.id === first.body.document.id);
  const secondFinal = detail.body.job.documents.find(document => document.id === second.body.document.id);
  assert.equal(firstFinal.status, 'superseded');
  assert.equal(firstFinal.data.isCurrent, false);
  assert.equal(firstFinal.data.supersededByDocumentId, secondFinal.id);
  assert.equal(secondFinal.status, 'approved');
  assert.equal(secondFinal.data.isCurrent, true);
  assert.ok(secondFinal.effectiveAt);
  assert.ok(detail.body.job.audit.some(event =>
    event.entityId === first.body.document.id
    && event.action === 'create_controlled_document_revision'
    && event.actor === 'role:office_operator'
  ));
  assert.equal(detail.body.job.audit.some(event => event.actor === 'role:owner:spoofed'), false);

  const supersededTransmittal = await request(baseUrl, `/api/ledger/jobs/${jobId}/document-transmittals`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      subject: 'Stale revision attempt',
      purpose: 'for_construction',
      documentIds: [firstFinal.id],
      recipients: [{ name: 'Site supervisor', email: 'site@example.test' }]
    })
  });
  assert.equal(supersededTransmittal.response.status, 400);
  assert.equal(supersededTransmittal.body.error.code, 'transmittal_document_not_current');

  const fieldTransmittalDenied = await request(baseUrl, `/api/ledger/jobs/${jobId}/document-transmittals`, tokens.field_worker.token, {
    method: 'POST',
    body: JSON.stringify({
      subject: 'Unauthorized distribution',
      documentIds: [secondFinal.id],
      recipients: [{ name: 'Site supervisor', email: 'site@example.test' }]
    })
  });
  assert.equal(fieldTransmittalDenied.response.status, 403);

  const transmittal = await request(baseUrl, `/api/ledger/jobs/${jobId}/document-transmittals`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      subject: 'Construction issue package',
      purpose: 'for_construction',
      dueAt: '2020-01-02',
      message: 'Use the approved P02 revision for construction.',
      documentIds: [secondFinal.id],
      recipients: [{ name: 'Site supervisor', email: 'site@example.test' }],
      actor: 'role:owner:spoofed'
    })
  });
  assert.equal(transmittal.response.status, 201);
  assert.equal(transmittal.body.transmittal.status, 'pending_approval');
  assert.equal(transmittal.body.transmittal.data.createdBy, 'role:office_operator');
  assert.equal(transmittal.body.externalDeliveryInitiated, false);

  const prematureIssue = await request(baseUrl, `/api/ledger/jobs/${jobId}/document-transmittals/${transmittal.body.transmittal.id}/issue`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ deliveryReference: 'provider:premature' })
  });
  assert.equal(prematureIssue.response.status, 409);
  assert.equal(prematureIssue.body.error.code, 'transmittal_approval_required');

  const officeCannotApproveTransmittal = await request(baseUrl, `/api/ledger/approvals/${transmittal.body.approval.id}/resolve`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved' })
  });
  assert.equal(officeCannotApproveTransmittal.response.status, 403);
  await resolveApproval(baseUrl, transmittal.body.approval.id, 'Current P02 revision, recipient, purpose, and package digest verified.');

  const issuedTransmittal = await request(baseUrl, `/api/ledger/jobs/${jobId}/document-transmittals/${transmittal.body.transmittal.id}/issue`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ deliveryReference: 'provider-message:project-controls-001' })
  });
  assert.equal(issuedTransmittal.response.status, 200);
  assert.equal(issuedTransmittal.body.transmittal.status, 'issued');
  assert.equal(issuedTransmittal.body.externalDeliveryPerformedByContractorAI, false);
  const receipt = issuedTransmittal.body.transmittal.receipts[0];
  const acknowledged = await request(baseUrl, `/api/ledger/jobs/${jobId}/document-transmittals/${transmittal.body.transmittal.id}/receipts/${receipt.id}/acknowledge`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ evidenceReference: 'mail-receipt:site-supervisor', acknowledgedBy: receipt.recipientName })
  });
  assert.equal(acknowledged.response.status, 200);
  assert.equal(acknowledged.body.transmittal.status, 'acknowledged');

  const overdueRfi = await request(baseUrl, `/api/ledger/jobs/${jobId}/rfis`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Overdue design clarification',
      question: 'Confirm the retained detail before work continues.',
      responsible: 'Design reviewer',
      dueAt: '2020-01-02',
      status: 'open'
    })
  });
  assert.equal(overdueRfi.response.status, 201);
  const overdueSubmittal = await request(baseUrl, `/api/ledger/jobs/${jobId}/submittals`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Overdue product package',
      reviewer: 'Technical reviewer',
      dueAt: '2020-01-02',
      status: 'submitted'
    })
  });
  assert.equal(overdueSubmittal.response.status, 201);

  const preview = await request(baseUrl, '/api/ledger/autonomous-cycle', tokens.owner, {
    method: 'POST',
    body: JSON.stringify({
      dryRun: true,
      actionTypes: ['draft_rfi_follow_up', 'draft_submittal_follow_up'],
      jobIds: [jobId]
    })
  });
  assert.equal(preview.response.status, 200);
  assert.ok(preview.body.preview.some(action => action.type === 'draft_rfi_follow_up' && action.rfiId === overdueRfi.body.rfi.id));
  assert.ok(preview.body.preview.some(action => action.type === 'draft_submittal_follow_up' && action.submittalId === overdueSubmittal.body.submittal.id));

  const autonomous = await request(baseUrl, '/api/ledger/autonomous-cycle', tokens.owner, {
    method: 'POST',
    body: JSON.stringify({
      actionTypes: ['draft_rfi_follow_up', 'draft_submittal_follow_up'],
      jobIds: [jobId],
      maxActions: 2,
      actor: 'project_controls_autonomous_test'
    })
  });
  assert.equal(autonomous.response.status, 200);
  assert.equal(autonomous.body.applied.length, 2);
  assert.ok(autonomous.body.applied.every(action => action.status === 'drafted' && action.approvalId && action.externalDeliveryInitiated === false));

  detail = await request(baseUrl, `/api/ledger/jobs/${jobId}`, tokens.owner);
  const followUps = detail.body.job.communications.filter(communication =>
    ['rfi_due_monitor', 'submittal_due_monitor'].includes(communication.data?.followUpSource)
  );
  assert.equal(followUps.length, 2);
  assert.ok(followUps.every(communication =>
    communication.status === 'draft'
    && communication.approvalId
    && communication.data.internalDraft === true
    && communication.data.externalDeliveryInitiated === false
    && communication.data.statusChanged === false
  ));
  assert.equal(detail.body.job.rfis.find(record => record.id === overdueRfi.body.rfi.id).status, 'open');
  assert.equal(detail.body.job.submittals.find(record => record.id === overdueSubmittal.body.submittal.id).status, 'submitted');

  const replayPreview = await request(baseUrl, '/api/ledger/autonomous-cycle', tokens.owner, {
    method: 'POST',
    body: JSON.stringify({
      dryRun: true,
      actionTypes: ['draft_rfi_follow_up', 'draft_submittal_follow_up'],
      jobIds: [jobId]
    })
  });
  assert.equal(replayPreview.response.status, 200);
  assert.equal(replayPreview.body.preview.length, 0);

  const diagnostics = await request(baseUrl, '/api/readiness', tokens.owner);
  assert.equal(diagnostics.response.status, 200);
  assert.equal(diagnostics.body.ledger.valid, true);
  assert.equal(diagnostics.body.ledger.migrations.currentVersion, '050_governed_market_fit');
});

test('controlled document migration upgrades a 021 ledger without losing existing documents', t => {
  const migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-document-migration-'));
  const dbFile = path.join(migrationDirectory, 'ledger.sqlite');
  t.after(() => fs.rmSync(migrationDirectory, { recursive: true, force: true }));

  const initial = new ContractorOperatingLedger({ dbFile });
  const job = initial.createIntake({ title: 'Document migration fixture', client: { name: 'Migration client' } });
  const retained = initial.addDocument(job.id, { title: 'Existing field evidence', type: 'field_photo' });
  initial.close();

  const oldSchema = new DatabaseSync(dbFile);
  oldSchema.exec(`
    DROP INDEX IF EXISTS idx_drawing_job_entry_key;
    DROP INDEX IF EXISTS idx_drawing_job_sheet_revision;
    DROP INDEX IF EXISTS idx_drawing_one_current_sheet;
    DROP INDEX IF EXISTS idx_drawing_pending_supersession;
    DROP INDEX IF EXISTS idx_drawing_job_status_discipline;
    DROP INDEX IF EXISTS idx_drawing_source_document;
    DROP INDEX IF EXISTS idx_documents_job_number_revision;
    DROP INDEX IF EXISTS idx_documents_controlled_current;
    DROP INDEX IF EXISTS idx_documents_single_candidate;
    DROP INDEX IF EXISTS idx_documents_supersedes;
    ALTER TABLE documents DROP COLUMN reviewed_at;
    ALTER TABLE documents DROP COLUMN entry_fingerprint;
    ALTER TABLE documents DROP COLUMN entry_key;
    ALTER TABLE documents DROP COLUMN snapshot_json;
    ALTER TABLE documents DROP COLUMN snapshot_hash;
    ALTER TABLE documents DROP COLUMN source_hash;
    ALTER TABLE documents DROP COLUMN source_document_id;
    ALTER TABLE documents DROP COLUMN supersedes_document_id;
    ALTER TABLE documents DROP COLUMN effective_at;
    ALTER TABLE documents DROP COLUMN discipline;
    ALTER TABLE documents DROP COLUMN revision;
    ALTER TABLE documents DROP COLUMN document_number;
    DELETE FROM ledger_schema_migrations WHERE version = '022_controlled_document_revisions';
    DELETE FROM ledger_schema_migrations WHERE version = '047_governed_drawing_revision_control';
  `);
  oldSchema.close();

  const upgraded = new ContractorOperatingLedger({ dbFile });
  try {
    assert.equal(upgraded.migrationStatus().currentVersion, '050_governed_market_fit');
    assert.equal(upgraded.migrationStatus().pending.length, 0);
    const columns = new Set(upgraded.db.prepare('PRAGMA table_info(documents)').all().map(column => column.name));
    for (const column of ['document_number', 'revision', 'discipline', 'effective_at', 'supersedes_document_id']) {
      assert.ok(columns.has(column), `missing migrated column ${column}`);
    }
    const retainedAfterUpgrade = upgraded.getJobDetail(job.id).documents.find(document => document.id === retained.id);
    assert.ok(retainedAfterUpgrade);
    assert.equal(retainedAfterUpgrade.documentNumber, null);
    assert.equal(upgraded.diagnose().valid, true);
  } finally {
    upgraded.close();
  }
});
