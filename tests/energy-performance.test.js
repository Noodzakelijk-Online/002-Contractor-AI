const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-energy-performance-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  const ledger = new ContractorOperatingLedger({ dbFile });
  const job = ledger.createIntake({
    title: 'BENG governed evidence project',
    client: { name: 'Energy-performance client' },
    status: 'in_progress',
    service: 'new_build',
    assignAutomatically: false
  }, { actor: 'energy_test' });
  t.after(() => {
    try {
      ledger.close();
    } catch {
      // Restart coverage closes the original connection.
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, dbFile, ledger, job };
}

function addAssessmentPdf(ledger, jobId, suffix) {
  const bytes = Buffer.from(`%PDF-1.7\nNTA 8800 assessment ${suffix}\n%%EOF`);
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
  return ledger.addDocument(jobId, {
    type: 'energy_performance_assessment',
    title: `Energy-performance assessment ${suffix}`,
    filename: `energy-performance-${suffix}.pdf`,
    mimeType: 'application/pdf',
    size: bytes.length,
    storageRef: `uploads/energy-performance-${suffix}.pdf`,
    status: 'stored',
    analysis: { upload: { sha256: checksum, signatureVerified: true } }
  }, { actor: 'energy_test' });
}

function payload(documentId, entryKey, overrides = {}) {
  return {
    entryKey,
    phase: 'permit_application',
    buildingUse: 'residential',
    buildingScope: 'building',
    objectReference: 'BAG-PAND-0123456789',
    assessmentDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    assessorName: 'Qualified EP adviser',
    assessorCredential: 'EP-W/D-12345',
    certifiedCompany: 'Certified Energy Evidence BV',
    ntaVersion: 'NTA 8800:2026',
    softwareName: 'Attested EP software',
    softwareVersion: '2026.1',
    epOnlineRegistration: 'EP-ONLINE-123456789',
    beng1Value: 45.2,
    beng1Limit: 55,
    beng2Value: 28.4,
    beng2Limit: 30,
    beng3Value: 62,
    beng3Minimum: 50,
    tojuliApplicable: true,
    tojuliValue: 0.72,
    tojuliLimit: 1.2,
    evidenceReference: `adviser-report:${entryKey}`,
    evidenceDocumentId: documentId,
    notes: 'Operator retained the values and limits stated in the adviser-issued PDF.',
    ...overrides
  };
}

function approve(ledger, approvalId) {
  return ledger.resolveApproval(approvalId, {
    status: 'approved',
    resolvedBy: 'energy_approver',
    reason: 'Adviser, method, software, registration, declared thresholds, and checksummed PDF verified.'
  });
}

test('energy-performance evidence is replay-safe, approval-gated, revisioned, and restart durable', t => {
  const { dbFile, ledger, job } = fixture(t);
  const permitPdf = addAssessmentPdf(ledger, job.id, 'permit-v1');
  const permitPayload = payload(permitPdf.id, 'energy-permit-0001');
  const permit = ledger.createEnergyPerformanceRecord(job.id, permitPayload, { actor: 'office_operator' });

  assert.equal(permit.replayed, false);
  assert.equal(permit.record.status, 'pending_approval');
  assert.equal(permit.record.outcome.overallCompliant, true);
  assert.equal(permit.record.integrityValid, true);
  assert.equal(permit.certificationClaimed, false);
  assert.equal(permit.externalCommitments, 0);
  assert.equal(ledger.createEnergyPerformanceRecord(job.id, permitPayload).replayed, true);
  assert.throws(
    () => ledger.createEnergyPerformanceRecord(job.id, { ...permitPayload, beng1Value: 46 }),
    error => error.code === 'energy_performance_replay_conflict' && error.statusCode === 409
  );
  approve(ledger, permit.approval.id);
  assert.equal(ledger.getEnergyPerformanceRecord(permit.record.id).status, 'verified_compliant');

  const completionPdf = addAssessmentPdf(ledger, job.id, 'completion');
  assert.throws(
    () => ledger.createEnergyPerformanceRecord(job.id, payload(completionPdf.id, 'energy-completion-wrong-version', {
      phase: 'completion_verification',
      permitSourceRecordId: permit.record.id,
      epOnlineRegistration: null,
      softwareVersion: '2026.2'
    })),
    error => error.code === 'energy_performance_permit_software_mismatch'
  );
  const completion = ledger.createEnergyPerformanceRecord(job.id, payload(completionPdf.id, 'energy-completion-0001', {
    phase: 'completion_verification',
    permitSourceRecordId: permit.record.id,
    epOnlineRegistration: null
  }));
  approve(ledger, completion.approval.id);
  assert.equal(ledger.getEnergyPerformanceRecord(completion.record.id).status, 'verified_compliant');

  const revisionPdf = addAssessmentPdf(ledger, job.id, 'permit-v2');
  const revision = ledger.createEnergyPerformanceRecord(job.id, payload(revisionPdf.id, 'energy-permit-0002', {
    supersedesRecordId: permit.record.id,
    beng2Value: 31.5
  }));
  assert.equal(revision.record.outcome.overallCompliant, false);
  assert.deepEqual(revision.record.outcome.failedChecks, ['beng_2']);
  approve(ledger, revision.approval.id);
  assert.equal(ledger.getEnergyPerformanceRecord(permit.record.id).status, 'superseded');
  assert.equal(ledger.getEnergyPerformanceRecord(revision.record.id).status, 'verified_gap');

  const register = ledger.energyPerformanceForJob(job.id);
  assert.equal(register.records.length, 3);
  assert.equal(register.current.length, 2);
  assert.equal(register.ready, false);
  assert.ok(register.blockers.some(blocker => blocker.code === 'energy_performance_threshold_gap'));
  assert.equal(ledger.dashboardSummary().metrics.energyPerformanceThresholdGaps, 1);
  assert.equal(ledger.diagnose().valid, true, JSON.stringify(ledger.diagnose().issues));
  assert.equal(ledger.migrationStatus().currentVersion, '067_governed_energy_performance');

  ledger.close();
  const restarted = new ContractorOperatingLedger({ dbFile });
  assert.equal(restarted.energyPerformanceForJob(job.id).records.length, 3);
  assert.equal(restarted.getEnergyPerformanceRecord(revision.record.id).integrityValid, true);
  assert.equal(restarted.migrationStatus().currentVersion, '067_governed_energy_performance');
  restarted.close();
});

test('energy-performance approval rejects source drift and preserves the pending decision', t => {
  const { ledger, job } = fixture(t);
  const document = addAssessmentPdf(ledger, job.id, 'tamper-source');
  const retained = ledger.createEnergyPerformanceRecord(
    job.id,
    payload(document.id, 'energy-tamper-0001'),
    { actor: 'office_operator' }
  );
  ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(JSON.stringify({
    analysis: { upload: { sha256: 'f'.repeat(64), signatureVerified: true } }
  }), document.id);

  assert.throws(
    () => approve(ledger, retained.approval.id),
    error => error.code === 'energy_performance_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.db.prepare('SELECT status FROM approvals WHERE id = ?').get(retained.approval.id).status, 'pending');
  assert.equal(ledger.getEnergyPerformanceRecord(retained.record.id).status, 'pending_approval');
  assert.equal(ledger.getEnergyPerformanceRecord(retained.record.id).integrityValid, false);
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => issue.message.includes(retained.record.id)));
});
