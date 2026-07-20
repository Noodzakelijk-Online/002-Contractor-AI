const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ContractorOperatingLedger } = require('../operating-ledger');

function futureDate(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-sds-revision-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  const ledger = new ContractorOperatingLedger({ dbFile });
  const job = ledger.createIntake({
    title: 'Governed coating installation',
    client: { name: 'SDS contract client' },
    status: 'in_progress',
    riskLevel: 'high',
    assignAutomatically: false
  }, { actor: 'sds_test' });
  t.after(() => {
    try {
      ledger.close();
    } catch {
      // Restart coverage closes the initial connection before teardown.
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, job, dbFile };
}

function addPdf(ledger, jobId, suffix) {
  const bytes = Buffer.from(`%PDF-1.7\nGoverned SDS ${suffix}\n%%EOF`);
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
  return ledger.addDocument(jobId, {
    type: 'sds_pdf',
    title: `Manufacturer SDS ${suffix}`,
    filename: `manufacturer-sds-${suffix}.pdf`,
    mimeType: 'application/pdf',
    size: bytes.length,
    storageRef: `uploads/manufacturer-sds-${suffix}.pdf`,
    status: 'stored',
    analysis: { upload: { sha256: checksum, signatureVerified: true } }
  }, { actor: 'sds_test' });
}

function revisionPayload(documentId, entryKey, overrides = {}) {
  return {
    entryKey,
    material: 'Two-component epoxy coating',
    manufacturer: 'Coatings Europe BV',
    productCode: 'EPOXY-2K-7016',
    language: 'nl-NL',
    issuedOn: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    expiresAt: futureDate(365),
    documentId,
    documentReference: `manufacturer-portal:${entryKey}`,
    hazardClasses: ['H315 - Causes skin irritation', 'H319 - Causes serious eye irritation'],
    requiredPpe: ['Chemical-resistant gloves', 'Safety goggles'],
    firstAidMeasures: 'Rinse exposed skin or eyes immediately and obtain medical advice when symptoms persist.',
    fireMeasures: 'Use foam, dry powder, or carbon dioxide and prevent contaminated run-off.',
    handlingStorage: 'Keep sealed, ventilated, and away from heat and incompatible materials.',
    spillResponse: 'Ventilate, contain with inert absorbent, and prevent entry into drains.',
    disposal: 'Dispose of product and contaminated absorbent through an authorized waste contractor.',
    emergencyContact: 'Coatings Europe emergency line +31 20 555 0199.',
    revisionReason: 'Manufacturer source and all operational controls reviewed for field reliance.',
    notes: 'Dutch field copy retained with the job evidence.',
    ...overrides
  };
}

function approve(ledger, approvalId) {
  return ledger.resolveApproval(approvalId, {
    status: 'approved',
    resolvedBy: 'sds_safety_approver',
    reason: 'Manufacturer PDF, product identity, dates, hazards, PPE, and emergency controls verified.'
  });
}

test('governed SDS revisions retain exact evidence, supersede atomically, and never infer current status', t => {
  const { ledger, job, dbFile } = fixture(t);
  const firstDocument = addPdf(ledger, job.id, 'r1');
  const firstPayload = revisionPayload(firstDocument.id, 'sds-revision-r1-001');
  const first = ledger.createSdsRevision(job.id, firstPayload, { actor: 'office_operator' });

  assert.equal(first.replayed, false);
  assert.equal(first.status, 'pending_approval');
  assert.equal(first.revisionNumber, 1);
  assert.equal(first.integrityValid, true);
  assert.equal(first.current, false);
  assert.equal(first.approval.targetType, 'sds_sheet');
  assert.equal(first.data.externalCommitments, 0);

  const pendingReplay = ledger.createSdsRevision(job.id, firstPayload, { actor: 'offline_retry' });
  assert.equal(pendingReplay.replayed, true);
  assert.equal(pendingReplay.id, first.id);
  approve(ledger, first.approval.id);

  const currentFirst = ledger.getSdsSheet(first.id);
  assert.equal(currentFirst.status, 'current');
  assert.equal(currentFirst.current, true);
  assert.ok(currentFirst.reviewedAt);
  const approvedReplay = ledger.createSdsRevision(job.id, firstPayload, { actor: 'offline_retry' });
  assert.equal(approvedReplay.replayed, true);
  assert.equal(approvedReplay.id, first.id);

  assert.throws(
    () => ledger.createSdsRevision(job.id, { ...firstPayload, notes: 'Different retained content.' }, { actor: 'office_operator' }),
    error => error.code === 'sds_revision_entry_key_conflict'
  );
  assert.throws(
    () => ledger.createSdsRevision(job.id, revisionPayload(addPdf(ledger, job.id, 'parallel').id, 'sds-parallel-001')),
    error => error.code === 'sds_revision_supersession_required'
  );

  const jha = ledger.createJhaRecord(job.id, {
    title: 'Epoxy coating JHA',
    status: 'approved',
    riskLevel: 'high',
    hazards: ['Chemical exposure'],
    controls: ['Use current SDS controls and required PPE']
  }, { actor: 'sds_test' });
  approve(ledger, jha.approval.id);
  assert.equal(ledger.preTaskPlanLinkedSources(job.id, {
    jhaId: jha.id,
    sdsSheetIds: [first.id]
  }, { validate: true }).ready, true);

  const secondDocument = addPdf(ledger, job.id, 'r2');
  const secondPayload = revisionPayload(secondDocument.id, 'sds-revision-r2-001', {
    supersedesSdsId: first.id,
    expiresAt: futureDate(180),
    revisionReason: 'Manufacturer issued a replacement PDF with updated spill-response instructions.',
    spillResponse: 'Evacuate the immediate area, ventilate, contain with inert absorbent, and protect all drains.'
  });
  const second = ledger.createSdsRevision(job.id, secondPayload, { actor: 'office_operator' });
  assert.equal(second.revisionNumber, 2);
  assert.equal(ledger.createSdsRevision(job.id, secondPayload, { actor: 'offline_retry' }).replayed, true);
  assert.throws(
    () => ledger.createSdsRevision(job.id, {
      ...secondPayload,
      entryKey: 'sds-revision-r2-parallel'
    }, { actor: 'office_operator' }),
    error => error.code === 'sds_revision_pending_exists'
  );

  approve(ledger, second.approval.id);
  assert.equal(ledger.getSdsSheet(first.id).status, 'superseded');
  assert.equal(ledger.getSdsSheet(first.id).current, false);
  assert.equal(ledger.getSdsSheet(first.id).supersededBySdsId, second.id);
  assert.equal(ledger.getSdsSheet(second.id).status, 'current');
  assert.equal(ledger.getSdsSheet(second.id).current, true);
  assert.equal(ledger.listSdsSheets({ jobId: job.id, currentOnly: true }).length, 1);
  assert.equal(ledger.createSdsRevision(job.id, secondPayload, { actor: 'offline_retry' }).replayed, true);
  assert.throws(
    () => ledger.preTaskPlanLinkedSources(job.id, { jhaId: jha.id, sdsSheetIds: [first.id] }, { validate: true }),
    error => error.code === 'pre_task_plan_prerequisites_not_ready'
  );

  const thirdDocument = addPdf(ledger, job.id, 'r3');
  const thirdPayload = revisionPayload(thirdDocument.id, 'sds-revision-r3-001', {
    supersedesSdsId: second.id,
    expiresAt: futureDate(20),
    revisionReason: 'Short-validity manufacturer revision retained pending a scheduled product review.'
  });
  const third = ledger.createSdsRevision(job.id, thirdPayload, { actor: 'office_operator' });
  const retainedDocumentData = ledger.db.prepare('SELECT data_json FROM documents WHERE id = ?').get(thirdDocument.id).data_json;
  const retainedSecondData = ledger.db.prepare('SELECT data_json FROM sds_sheets WHERE id = ?').get(second.id).data_json;
  ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(JSON.stringify({ analysis: { upload: { sha256: 'tampered' } } }), thirdDocument.id);
  assert.throws(
    () => approve(ledger, third.approval.id),
    error => error.code === 'sds_revision_integrity_failed'
  );
  assert.equal(ledger.db.prepare('SELECT status FROM approvals WHERE id = ?').get(third.approval.id).status, 'pending');
  assert.equal(ledger.getSdsSheet(second.id).status, 'current');
  assert.equal(ledger.getSdsSheet(third.id).status, 'pending_approval');

  ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(retainedDocumentData, thirdDocument.id);
  ledger.db.prepare('UPDATE sds_sheets SET data_json = ? WHERE id = ?').run(JSON.stringify({
    ...JSON.parse(retainedSecondData),
    spillResponse: 'Tampered predecessor evidence that must not remain field-current.'
  }), second.id);
  assert.equal(ledger.getSdsSheet(second.id).integrityValid, false);
  approve(ledger, third.approval.id);
  assert.equal(ledger.getSdsSheet(second.id).status, 'superseded');
  assert.equal(ledger.getSdsSheet(third.id).current, true);
  const supersededSecondData = JSON.parse(ledger.db.prepare('SELECT data_json FROM sds_sheets WHERE id = ?').get(second.id).data_json);
  ledger.db.prepare('UPDATE sds_sheets SET data_json = ? WHERE id = ?').run(JSON.stringify({
    ...supersededSecondData,
    spillResponse: JSON.parse(retainedSecondData).spillResponse
  }), second.id);

  const firstReview = ledger.runAutonomousCycle({ actionTypes: ['review_sds_revision'], jobIds: [job.id] });
  assert.equal(firstReview.applied.length, 1);
  assert.equal(firstReview.applied[0].status, 'task_created');
  assert.equal(firstReview.applied[0].externalCommitments, 0);
  const reviewTask = ledger.getJobDetail(job.id).tasks.find(task => task.id === firstReview.applied[0].taskId);
  assert.equal(reviewTask.data.internalOnly, true);
  assert.equal(reviewTask.data.currentStatusInferred, false);
  assert.equal(ledger.runAutonomousCycle({ actionTypes: ['review_sds_revision'], jobIds: [job.id] }).applied.length, 0);
  assert.equal(ledger.diagnose().valid, true, JSON.stringify(ledger.diagnose().issues));
  assert.equal(ledger.migrationStatus().currentVersion, '051_governed_bid_decisions');

  ledger.close();
  const restarted = new ContractorOperatingLedger({ dbFile });
  assert.equal(restarted.listSdsSheets({ jobId: job.id }).length, 3);
  assert.equal(restarted.listSdsSheets({ jobId: job.id, currentOnly: true })[0].id, third.id);
  assert.equal(restarted.getSdsSheet(third.id).integrityValid, true);
  assert.equal(restarted.diagnose().valid, true, JSON.stringify(restarted.diagnose().issues));
  restarted.close();
});
