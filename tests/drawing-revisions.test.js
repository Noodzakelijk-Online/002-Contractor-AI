const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-drawing-revision-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  const ledger = new ContractorOperatingLedger({ dbFile });
  const job = ledger.createIntake({
    title: 'Governed drawing construction project',
    client: { name: 'Drawing contract client' },
    status: 'in_progress',
    riskLevel: 'high',
    assignAutomatically: false
  }, { actor: 'drawing_test' });
  t.after(() => {
    try {
      ledger.close();
    } catch {
      // Restart coverage closes the original connection.
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, job, dbFile };
}

function addPdf(ledger, jobId, suffix) {
  const bytes = Buffer.from(`%PDF-1.7\nGoverned drawing ${suffix}\n%%EOF`);
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
  return ledger.addDocument(jobId, {
    type: 'drawing_pdf',
    title: `Architect drawing ${suffix}`,
    filename: `A-101-${suffix}.pdf`,
    mimeType: 'application/pdf',
    size: bytes.length,
    storageRef: `uploads/A-101-${suffix}.pdf`,
    status: 'stored',
    analysis: { upload: { sha256: checksum, signatureVerified: true } }
  }, { actor: 'drawing_test' });
}

function drawingPayload(sourceDocumentId, entryKey, overrides = {}) {
  return {
    entryKey,
    sheetNumber: 'A-101',
    revision: 'P01',
    title: 'Ground-floor construction plan',
    discipline: 'architecture',
    purpose: 'for_construction',
    issueDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    scale: '1:50',
    zone: 'Ground floor',
    sourceDocumentId,
    sourceDocumentReference: `design-portal:${entryKey}`,
    revisionReason: 'Initial coordinated construction issue retained for controlled field access.',
    reviewNotes: 'Sheet identity, revision cloud, title block, and issue purpose reviewed.',
    ...overrides
  };
}

function approve(ledger, approvalId) {
  return ledger.resolveApproval(approvalId, {
    status: 'approved',
    resolvedBy: 'drawing_approver',
    reason: 'PDF checksum, title block, issue purpose, revision, and supersession verified.'
  });
}

test('governed drawings retain immutable PDF evidence, supersede atomically, distribute, and survive restart', t => {
  const { ledger, job, dbFile } = fixture(t);
  const firstDocument = addPdf(ledger, job.id, 'p01');
  const firstPayload = drawingPayload(firstDocument.id, 'drawing-a101-p01-001');
  const first = ledger.createDrawingRevision(job.id, firstPayload, { actor: 'office_operator' });

  assert.equal(first.replayed, false);
  assert.equal(first.status, 'pending_approval');
  assert.equal(first.current, false);
  assert.equal(first.integrityValid, true);
  assert.equal(first.sourceDocumentId, firstDocument.id);
  assert.equal(first.approval.targetType, 'document');
  assert.equal(first.approval.approvalType, 'drawing_revision_publication');
  assert.equal(first.approval.decision.riskLevel, 'high');
  assert.match(first.approval.decision.safeguards.join(' '), /does not certify design adequacy/i);
  assert.equal(first.data.externalCommitments, 0);
  assert.throws(
    () => ledger.transitionLifecycleRecord(job.id, 'document', first.id, {
      status: 'approved',
      verificationReference: 'attempted-bypass',
      notes: 'Attempted generic lifecycle bypass.'
    }),
    error => error.code === 'drawing_revision_workflow_required'
  );

  assert.equal(ledger.createDrawingRevision(job.id, firstPayload, { actor: 'offline_retry' }).replayed, true);
  assert.throws(
    () => ledger.createDrawingRevision(job.id, { ...firstPayload, reviewNotes: 'Different retained review.' }),
    error => error.code === 'drawing_revision_entry_key_conflict'
  );

  approve(ledger, first.approval.id);
  assert.equal(ledger.getDrawingRevision(first.id).status, 'current');
  assert.equal(ledger.getDrawingRevision(first.id).current, true);
  assert.ok(ledger.getDrawingRevision(first.id).reviewedAt);

  const unlinkedDocument = addPdf(ledger, job.id, 'unlinked');
  assert.throws(
    () => ledger.createDrawingRevision(job.id, drawingPayload(unlinkedDocument.id, 'drawing-a101-unlinked', { revision: 'P02' })),
    error => error.code === 'drawing_supersession_required'
  );

  const secondDocument = addPdf(ledger, job.id, 'p02');
  const secondPayload = drawingPayload(secondDocument.id, 'drawing-a101-p02-001', {
    revision: 'P02',
    supersedesDrawingId: first.id,
    revisionReason: 'Coordinated stair opening and wall dimensions updated after structural review.'
  });
  const second = ledger.createDrawingRevision(job.id, secondPayload, { actor: 'office_operator' });
  assert.equal(second.supersedesDocumentId, first.id);
  assert.equal(ledger.createDrawingRevision(job.id, secondPayload, { actor: 'offline_retry' }).replayed, true);
  assert.throws(
    () => ledger.createDrawingRevision(job.id, {
      ...secondPayload,
      entryKey: 'drawing-a101-p02-parallel',
      revision: 'P02A'
    }),
    error => error.code === 'drawing_revision_pending_exists'
  );

  const retainedSourceData = ledger.db.prepare('SELECT data_json FROM documents WHERE id = ?').get(secondDocument.id).data_json;
  ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(JSON.stringify({ analysis: { upload: { sha256: 'tampered' } } }), secondDocument.id);
  assert.throws(() => approve(ledger, second.approval.id), error => error.code === 'drawing_revision_integrity_failed');
  assert.equal(ledger.db.prepare('SELECT status FROM approvals WHERE id = ?').get(second.approval.id).status, 'pending');
  assert.equal(ledger.getDrawingRevision(first.id).status, 'current');
  ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(retainedSourceData, secondDocument.id);

  approve(ledger, second.approval.id);
  assert.equal(ledger.getDrawingRevision(first.id).status, 'superseded');
  assert.equal(ledger.getDrawingRevision(first.id).current, false);
  assert.equal(ledger.getDrawingRevision(first.id).supersededByDrawingId, second.id);
  assert.equal(ledger.getDrawingRevision(second.id).status, 'current');
  assert.equal(ledger.listDrawingRevisions({ jobId: job.id, currentOnly: true })[0].id, second.id);

  assert.throws(
    () => ledger.createDocumentTransmittal(job.id, {
      subject: 'Superseded drawing issue',
      purpose: 'for_construction',
      documentIds: [first.id],
      recipients: [{ name: 'Site manager', email: 'site@example.test' }]
    }),
    error => error.code === 'transmittal_document_not_current'
  );
  const transmittalResult = ledger.createDocumentTransmittal(job.id, {
    subject: 'Current construction drawing issue',
    purpose: 'for_construction',
    documentIds: [second.id],
    recipients: [{ name: 'Site manager', email: 'site@example.test' }]
  }, { actor: 'document_controller' });
  assert.equal(transmittalResult.transmittal.documents[0].type, 'drawing_revision');
  assert.equal(transmittalResult.transmittal.documents[0].sourceReferenceHash, second.sourceHash);
  approve(ledger, transmittalResult.approval.id);
  const issued = ledger.recordDocumentTransmittalIssue(job.id, transmittalResult.transmittal.id, {
    deliveryReference: 'mail-provider-receipt:drawing-p02'
  }, { actor: 'document_controller' });
  assert.equal(issued.status, 'issued');

  assert.equal(ledger.nextActions().some(action => action.type === 'review_drawing_distribution' && action.drawingRevisionId === second.id), false);
  assert.equal(ledger.diagnose().valid, true, JSON.stringify(ledger.diagnose().issues));
  assert.equal(ledger.migrationStatus().currentVersion, '059_crew_capacity_lookahead');

  ledger.close();
  const restarted = new ContractorOperatingLedger({ dbFile });
  assert.equal(restarted.listDrawingRevisions({ jobId: job.id }).length, 2);
  assert.equal(restarted.listDrawingRevisions({ jobId: job.id, currentOnly: true })[0].id, second.id);
  assert.equal(restarted.getDrawingRevision(second.id).integrityValid, true);
  assert.equal(restarted.diagnose().valid, true, JSON.stringify(restarted.diagnose().issues));
  restarted.close();
});

test('autonomous drawing review creates one internal task and never infers publication or delivery', t => {
  const { ledger, job } = fixture(t);
  const source = addPdf(ledger, job.id, 'review');
  const drawing = ledger.createDrawingRevision(job.id, drawingPayload(source.id, 'drawing-review-a101-001'));
  approve(ledger, drawing.approval.id);

  const firstRun = ledger.runAutonomousCycle({ actionTypes: ['review_drawing_distribution'], jobIds: [job.id] });
  assert.equal(firstRun.applied.length, 1);
  assert.equal(firstRun.applied[0].status, 'task_created');
  assert.equal(firstRun.applied[0].externalCommitments, 0);
  const task = ledger.getJobDetail(job.id).tasks.find(item => item.id === firstRun.applied[0].taskId);
  assert.equal(task.data.internalOnly, true);
  assert.equal(task.data.distributionInferred, false);
  assert.equal(task.data.designApprovalInferred, false);
  assert.equal(ledger.getDrawingRevision(drawing.id).status, 'current');
  assert.equal(ledger.runAutonomousCycle({ actionTypes: ['review_drawing_distribution'], jobIds: [job.id] }).applied.length, 0);
});
