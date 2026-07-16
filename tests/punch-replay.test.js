const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-punch-replay-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  const ledger = new ContractorOperatingLedger({ dbFile });
  const job = ledger.createIntake({
    title: 'Punch replay fixture',
    client: { name: 'Closeout Client' },
    description: 'Verify field punch retry and evidence retention.'
  }, { actor: 'punch_test' });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, job };
}

test('punch items are exact-replay safe and retain only same-job evidence', t => {
  const { ledger, job } = fixture(t);
  const evidence = ledger.addDocument(job.id, { title: 'Door frame photograph', filename: 'door-frame.jpg' });
  const foreignJob = ledger.createIntake({ title: 'Other closeout', client: { name: 'Other Client' } });
  const foreignEvidence = ledger.addDocument(foreignJob.id, { title: 'Foreign photograph', filename: 'foreign.jpg' });
  const payload = {
    entryKey: 'punch-offline-0001',
    title: 'Door frame finish requires correction',
    severity: 'medium',
    assignee: 'Finishing supervisor',
    dueAt: '2026-07-21',
    location: 'Level 2 / room 2.14',
    description: 'Paint edge is incomplete at the retained frame location.',
    evidenceDocumentIds: [evidence.id]
  };

  const first = ledger.createPunchItem(job.id, payload, { actor: 'role:field_worker:worker-1' });
  const retryPayload = { ...payload };
  delete retryPayload.dueAt;
  const replay = ledger.createPunchItem(job.id, retryPayload, { actor: 'role:field_worker:worker-1' });

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.id, first.id);
  assert.deepEqual(replay.data.evidenceDocumentIds, [evidence.id]);
  const detail = ledger.getJobDetail(job.id, { includeAudit: true });
  assert.equal(detail.punchItems.filter(record => record.data?.entryKey === payload.entryKey).length, 1);
  assert.equal(detail.audit.filter(event => event.action === 'create_punch_item' && event.entityId === first.id).length, 1);
  assert.equal(detail.audit.find(event => event.entityId === first.id).metadata.externalCommitments, 0);

  assert.throws(
    () => ledger.createPunchItem(job.id, { ...payload, severity: 'high' }),
    error => error.code === 'punch_entry_key_reused' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.createPunchItem(job.id, { ...payload, entryKey: 'punch-offline-0002', evidenceDocumentIds: [foreignEvidence.id] }),
    error => error.code === 'punch_evidence_not_found'
  );
});

test('client-visible punch review retains a decision-specific approval without duplicate replay', t => {
  const { ledger, job } = fixture(t);
  const payload = {
    entryKey: 'punch-client-review-0001',
    title: 'Balcony sealant finish review',
    severity: 'high',
    assignee: 'Envelope supervisor',
    location: 'South balcony',
    description: 'Sealant finish requires retained inspection before client visibility.',
    clientVisible: true
  };

  const first = ledger.createPunchItem(job.id, payload, { actor: 'office_operator' });
  const replay = ledger.createPunchItem(job.id, payload, { actor: 'office_operator' });
  assert.ok(first.approval);
  assert.equal(first.approval.id, replay.approval.id);
  assert.equal(replay.replayed, true);
  assert.equal(first.approval.decision.riskLevel, 'high');
  assert.equal(first.approval.decision.preview.title, payload.title);
  assert.equal(first.approval.decision.preview.location, payload.location);
  assert.equal(first.approval.decision.preview.description, payload.description);
  assert.equal(first.approval.decision.preview.clientVisible, true);
  assert.match(first.approval.decision.safeguards.join(' '), /Does not notify the client/);
  assert.equal(ledger.getJobDetail(job.id).approvals.filter(approval => approval.targetId === first.id).length, 1);

  const mandatoryGate = ledger.createPunchItem(job.id, {
    entryKey: 'punch-mandatory-gate-0001',
    title: 'Terminal punch status cannot bypass approval',
    status: 'verified',
    requiresApproval: false
  }, { actor: 'office_operator' });
  assert.equal(mandatoryGate.status, 'pending_approval');
  assert.ok(mandatoryGate.approval);
});

test('punch record and approval roll back together when audit retention fails', t => {
  const { ledger, job } = fixture(t);
  const originalAudit = ledger.audit.bind(ledger);
  ledger.audit = event => {
    if (event.action === 'create_punch_item') throw new Error('injected punch audit failure');
    return originalAudit(event);
  };

  assert.throws(() => ledger.createPunchItem(job.id, {
    entryKey: 'punch-rollback-0001',
    title: 'Transactional punch fixture',
    severity: 'high',
    description: 'This punch item must not survive without its audit event.',
    clientVisible: true
  }, { actor: 'punch_test' }), /injected punch audit failure/);

  ledger.audit = originalAudit;
  const detail = ledger.getJobDetail(job.id, { includeAudit: true });
  assert.equal(detail.punchItems.some(record => record.data?.entryKey === 'punch-rollback-0001'), false);
  assert.equal(detail.approvals.some(approval => approval.targetType === 'punch_item'), false);
  assert.equal(detail.audit.some(event => event.action === 'create_punch_item'), false);
});

test('warranty resolution approval explains retained effect and safeguards', t => {
  const { ledger, job } = fixture(t);
  const claim = ledger.createWarrantyClaim(job.id, {
    title: 'Cabinet hinge alignment report',
    warrantyType: 'workmanship',
    severity: 'medium',
    issue: 'The retained cabinet door does not close evenly.'
  }, { actor: 'office_operator' });
  const review = ledger.transitionLifecycleRecord(job.id, 'warranty_claim', claim.id, {
    status: 'resolved',
    notes: 'Hinge alignment was inspected after adjustment.',
    resolution: 'Adjusted and retested against the retained installation record.'
  }, { actor: 'office_operator' });

  assert.ok(review.approval);
  assert.equal(review.approval.decision.riskLevel, 'high');
  assert.equal(review.approval.decision.preview.title, 'Cabinet hinge alignment report');
  assert.equal(review.approval.decision.preview.issue, 'The retained cabinet door does not close evenly.');
  assert.equal(review.approval.decision.preview.resolution, 'Adjusted and retested against the retained installation record.');
  assert.equal(review.approval.decision.preview.warrantyType, 'workmanship');
  assert.match(review.approval.decision.safeguards.join(' '), /Does not contact the client/);
});
