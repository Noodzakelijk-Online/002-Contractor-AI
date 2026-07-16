const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-field-risk-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  const ledger = new ContractorOperatingLedger({ dbFile });
  const job = ledger.createIntake({
    title: 'Field risk replay fixture',
    client: { name: 'Field Risk Client' },
    description: 'Verify exact offline retries and job-scoped evidence.'
  }, { actor: 'field_risk_test' });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, job };
}

test('observations are exact-replay safe and retain only same-job evidence', t => {
  const { ledger, job } = fixture(t);
  const evidence = ledger.addDocument(job.id, { title: 'West elevation photograph', filename: 'west-elevation.jpg' });
  const foreignJob = ledger.createIntake({ title: 'Foreign job', client: { name: 'Other client' } });
  const foreignEvidence = ledger.addDocument(foreignJob.id, { title: 'Foreign photograph', filename: 'foreign.jpg' });

  const payload = {
    entryKey: 'observation-offline-0001',
    category: 'quality',
    title: 'Facade fixing spacing differs from drawing',
    severity: 'medium',
    responsible: 'Site supervisor',
    dueAt: '2026-07-20',
    notes: 'West elevation row three requires a retained technical review.',
    correctiveAction: 'Check the approved setting-out record before continuing.',
    evidenceDocumentIds: [evidence.id]
  };

  const first = ledger.createObservationRecord(job.id, payload, { actor: 'role:field_worker:worker-1' });
  const observationReplayPayload = { ...payload };
  delete observationReplayPayload.dueAt;
  const replay = ledger.createObservationRecord(job.id, observationReplayPayload, { actor: 'role:field_worker:worker-1' });

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.id, first.id);
  assert.deepEqual(replay.data.evidenceDocumentIds, [evidence.id]);
  const detail = ledger.getJobDetail(job.id, { includeAudit: true });
  assert.equal(detail.observations.filter(record => record.data?.entryKey === payload.entryKey).length, 1);
  assert.equal(detail.audit.filter(event => event.action === 'record_observation' && event.entityId === first.id).length, 1);
  assert.equal(detail.audit.find(event => event.entityId === first.id).metadata.externalCommitments, 0);

  assert.throws(
    () => ledger.createObservationRecord(job.id, { ...payload, severity: 'high' }),
    error => error.code === 'observation_entry_key_reused' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.createObservationRecord(job.id, { ...payload, entryKey: 'observation-offline-0002', evidenceDocumentIds: [foreignEvidence.id] }),
    error => error.code === 'observation_evidence_not_found'
  );
});

test('incidents are exact-replay safe, approval-backed, and retain evidence', t => {
  const { ledger, job } = fixture(t);
  const evidence = ledger.addDocument(job.id, { title: 'Near-miss photograph', filename: 'near-miss.jpg' });
  const payload = {
    entryKey: 'incident-offline-0001',
    incidentType: 'near_miss',
    title: 'Unsecured material moved near access route',
    severity: 'high',
    occurredAt: '2026-07-16T08:30:00.000Z',
    reportedBy: 'Field worker',
    description: 'A loose panel shifted while the access route was occupied.',
    immediateAction: 'Stopped work and isolated the access route.',
    witnesses: ['Site supervisor'],
    evidenceDocumentIds: [evidence.id],
    requiresApproval: true
  };

  const first = ledger.createIncidentRecord(job.id, payload, { actor: 'role:field_worker:worker-1' });
  const incidentReplayPayload = { ...payload };
  delete incidentReplayPayload.occurredAt;
  const replay = ledger.createIncidentRecord(job.id, incidentReplayPayload, { actor: 'role:field_worker:worker-1' });

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.id, first.id);
  assert.equal(replay.approval.id, first.approval.id);
  assert.deepEqual(replay.data.evidenceDocumentIds, [evidence.id]);
  const detail = ledger.getJobDetail(job.id, { includeAudit: true });
  assert.equal(detail.incidents.filter(record => record.data?.entryKey === payload.entryKey).length, 1);
  assert.equal(detail.approvals.filter(approval => approval.targetId === first.id).length, 1);
  assert.equal(detail.audit.filter(event => event.action === 'record_incident' && event.entityId === first.id).length, 1);

  assert.throws(
    () => ledger.createIncidentRecord(job.id, { ...payload, immediateAction: 'Changed after the first retained write.' }),
    error => error.code === 'incident_entry_key_reused' && error.statusCode === 409
  );
});

test('incident write and approval roll back together when audit retention fails', t => {
  const { ledger, job } = fixture(t);
  const originalAudit = ledger.audit.bind(ledger);
  ledger.audit = event => {
    if (event.action === 'record_incident') throw new Error('injected incident audit failure');
    return originalAudit(event);
  };

  assert.throws(() => ledger.createIncidentRecord(job.id, {
    entryKey: 'incident-rollback-0001',
    title: 'Transactional incident fixture',
    severity: 'high',
    occurredAt: '2026-07-16T09:00:00.000Z',
    description: 'This record must not survive without its audit event.',
    immediateAction: 'Work stopped for the transaction test.',
    requiresApproval: true
  }, { actor: 'field_risk_test' }), /injected incident audit failure/);

  ledger.audit = originalAudit;
  const detail = ledger.getJobDetail(job.id, { includeAudit: true });
  assert.equal(detail.incidents.some(record => record.data?.entryKey === 'incident-rollback-0001'), false);
  assert.equal(detail.approvals.some(approval => approval.targetType === 'incident_record'), false);
  assert.equal(detail.audit.some(event => event.action === 'record_incident'), false);
});
