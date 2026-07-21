const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-transmittal-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const job = ledger.createIntake({
    title: 'Controlled distribution fixture',
    status: 'planned',
    client: { name: 'Distribution client', email: 'client@example.test' }
  });
  return { ledger, job };
}

function approveCurrentRevision(ledger, jobId, revision = 'P01', revisionReason = '') {
  const created = ledger.createControlledDocumentRevision(jobId, {
    title: 'Ground-floor construction plan',
    documentNumber: 'A-101',
    revision,
    discipline: 'architectural',
    sourceReference: `private:A-101-${revision}`,
    revisionReason
  }, { actor: 'office:test' });
  const review = ledger.transitionLifecycleRecord(jobId, 'document', created.document.id, {
    status: 'approved',
    verificationReference: `check:A-101-${revision}`,
    notes: `Revision ${revision} checked against the retained coordination record.`
  }, { actor: 'office:test' });
  ledger.resolveApproval(review.approval.id, {
    status: 'approved',
    resolvedBy: 'owner:test',
    reason: `Revision ${revision} source and checker evidence verified.`
  });
  return ledger.getDocument(created.document.id);
}

test('document transmittal requires approval, issue evidence, and recipient-specific acknowledgments', t => {
  const { ledger, job } = fixture(t);
  const document = approveCurrentRevision(ledger, job.id);
  const prepared = ledger.createDocumentTransmittal(job.id, {
    subject: 'Construction issue package',
    purpose: 'for_construction',
    dueAt: '2020-01-02',
    message: 'Use this approved revision for the retained construction scope.',
    documentIds: [document.id],
    recipients: [
      { name: 'Site supervisor', email: 'site@example.test' },
      { name: 'Design reviewer', email: 'design@example.test' }
    ]
  }, { actor: 'office:test' });

  assert.match(prepared.transmittal.transmittalNumber, /^TRN-\d{4}-\d{6}$/);
  assert.equal(prepared.transmittal.status, 'pending_approval');
  assert.equal(prepared.transmittal.documents[0].revision, 'P01');
  assert.equal(prepared.transmittal.receipts.length, 2);
  assert.ok(prepared.transmittal.receipts.every(receipt => receipt.status === 'pending_issue'));
  assert.equal(prepared.externalDeliveryInitiated, false);

  assert.throws(
    () => ledger.recordDocumentTransmittalIssue(job.id, prepared.transmittal.id, { deliveryReference: 'provider:before-approval' }),
    error => error.code === 'transmittal_approval_required'
  );
  const approval = ledger.listApprovals({ status: 'pending', limit: 20 }).find(item => item.id === prepared.approval.id);
  assert.equal(approval.decision.riskLevel, 'high');
  assert.match(approval.decision.primaryEffect, /controlled-document transmittal/i);
  assert.match(approval.decision.safeguards.join(' '), /does not send/i);

  ledger.resolveApproval(prepared.approval.id, {
    status: 'approved',
    resolvedBy: 'owner:test',
    reason: 'Current revision, recipient register, purpose, and package digest verified.'
  });
  const issued = ledger.recordDocumentTransmittalIssue(job.id, prepared.transmittal.id, {
    deliveryReference: 'provider-message:trn-001'
  }, { actor: 'office:test' });
  assert.equal(issued.status, 'issued');
  assert.equal(issued.deliveryReference, 'provider-message:trn-001');
  assert.ok(issued.receipts.every(receipt => receipt.status === 'awaiting_acknowledgment'));

  const autonomousPreview = ledger.runAutonomousCycle({
    dryRun: true,
    actionTypes: ['draft_transmittal_ack_follow_up'],
    jobIds: [job.id]
  });
  assert.equal(autonomousPreview.preview.length, 1);
  assert.equal(autonomousPreview.preview[0].recipients.length, 2);
  const autonomous = ledger.runAutonomousCycle({
    actionTypes: ['draft_transmittal_ack_follow_up'],
    jobIds: [job.id],
    actor: 'autonomous:test'
  });
  assert.equal(autonomous.applied.length, 1);
  assert.equal(autonomous.applied[0].status, 'drafted');
  assert.equal(autonomous.applied[0].externalDeliveryInitiated, false);
  const followUp = ledger.getJobDetail(job.id).communications.find(record => record.data?.transmittalId === prepared.transmittal.id);
  assert.equal(followUp.status, 'draft');
  assert.equal(followUp.data.acknowledgmentChanged, false);
  assert.ok(followUp.approvalId);
  assert.equal(ledger.runAutonomousCycle({
    dryRun: true,
    actionTypes: ['draft_transmittal_ack_follow_up'],
    jobIds: [job.id]
  }).preview.length, 0);

  const [firstReceipt, secondReceipt] = issued.receipts;
  const first = ledger.acknowledgeDocumentTransmittal(job.id, issued.id, firstReceipt.id, {
    evidenceReference: 'mail-receipt:site',
    acknowledgedBy: firstReceipt.recipientName
  }, { actor: 'office:test' });
  assert.equal(first.transmittal.status, 'partially_acknowledged');
  assert.equal(first.receipt.status, 'acknowledged');
  const replay = ledger.acknowledgeDocumentTransmittal(job.id, issued.id, firstReceipt.id, {
    evidenceReference: 'mail-receipt:site',
    acknowledgedBy: firstReceipt.recipientName
  }, { actor: 'office:test' });
  assert.equal(replay.replayed, true);
  const completed = ledger.acknowledgeDocumentTransmittal(job.id, issued.id, secondReceipt.id, {
    evidenceReference: 'mail-receipt:design',
    acknowledgedBy: secondReceipt.recipientName
  }, { actor: 'office:test' });
  assert.equal(completed.transmittal.status, 'acknowledged');
  assert.equal(ledger.diagnose().valid, true);
});

test('document transmittal refuses stale revisions and exposes snapshot tampering in diagnostics', t => {
  const { ledger, job } = fixture(t);
  const first = approveCurrentRevision(ledger, job.id);
  const prepared = ledger.createDocumentTransmittal(job.id, {
    subject: 'Pending construction issue',
    purpose: 'for_construction',
    documentIds: [first.id],
    recipients: [{ name: 'Site supervisor', email: 'site@example.test' }]
  });
  ledger.resolveApproval(prepared.approval.id, {
    status: 'approved',
    resolvedBy: 'owner:test',
    reason: 'The package snapshot is valid for issue.'
  });

  approveCurrentRevision(ledger, job.id, 'P02', 'Door opening coordinated with the structural detail.');
  assert.throws(
    () => ledger.recordDocumentTransmittalIssue(job.id, prepared.transmittal.id, { deliveryReference: 'provider:stale-attempt' }),
    error => error.code === 'transmittal_documents_stale'
  );

  ledger.db.prepare("UPDATE document_transmittals SET subject = 'Rewritten subject' WHERE id = ?").run(prepared.transmittal.id);
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => /snapshot integrity/i.test(issue.message)));
});

test('migration 023 upgrades a 022 ledger with the transmittal contract', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-transmittal-migration-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const initial = new ContractorOperatingLedger({ dbFile });
  initial.createIntake({ title: 'Migration fixture', client: { name: 'Migration client' } });
  initial.close();

  const oldSchema = new DatabaseSync(dbFile);
  oldSchema.exec(`
    DROP TABLE transmittal_receipts;
    DROP TABLE document_transmittals;
    DROP TABLE transmittal_number_sequences;
    DELETE FROM ledger_schema_migrations WHERE version = '023_document_transmittals';
  `);
  oldSchema.close();

  const upgraded = new ContractorOperatingLedger({ dbFile });
  try {
    assert.equal(upgraded.migrationStatus().currentVersion, '058_formal_variation_control');
    assert.equal(upgraded.migrationStatus().pending.length, 0);
    for (const table of ['transmittal_number_sequences', 'document_transmittals', 'transmittal_receipts']) {
      assert.ok(upgraded.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
    }
    assert.equal(upgraded.diagnose().valid, true);
  } finally {
    upgraded.close();
  }
});
