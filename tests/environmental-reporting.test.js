const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t, suffix = '1') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-environmental-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  const job = ledger.createIntake({
    title: `Environmental reporting ${suffix}`,
    client: { name: `Environmental client ${suffix}` },
    status: 'scheduled',
    assignAutomatically: false
  }, { actor: 'environmental_test' });
  const worker = ledger.upsertWorker({
    name: `Environmental worker ${suffix}`,
    role: 'Site operative',
    status: 'available'
  }, { actor: 'environmental_test' });
  ledger.addAssignment(job.id, {
    workerId: worker.id,
    workerName: worker.name,
    role: worker.role,
    status: 'assigned'
  }, { actor: 'environmental_test' });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, job, worker };
}

function activityPayload(worker, suffix = '001') {
  return {
    entryKey: `environmental-activity-${suffix}`,
    activityDate: new Date().toISOString().slice(0, 10),
    workerId: worker.id,
    workerName: worker.name,
    category: 'fuel',
    ghgScope: 'scope_1',
    description: `Excavator diesel ${suffix}`,
    quantity: 50,
    unit: 'litre',
    emissionFactor: 2.7,
    factorSource: 'Operator retained factor library',
    factorReference: `factor-library:diesel:${suffix}`,
    evidenceReference: `fuel-ticket:${suffix}`,
    notes: 'Quantity taken from the retained site fuel ticket.'
  };
}

test('environmental activity is replay-safe, source-verified, calculated, and approval-gated', t => {
  const { ledger, job, worker } = fixture(t, 'governed');
  const payload = activityPayload(worker, 'GOV-001');
  const created = ledger.createEnvironmentalActivity(job.id, {
    ...payload,
    submittedBy: 'submitted:spoofed-environmental-operator'
  }, { actor: 'field_worker' });

  assert.equal(created.replayed, false);
  assert.equal(created.activity.status, 'pending_approval');
  assert.equal(created.activity.emissionsKgCo2e, 135);
  assert.equal(created.activity.recognizedKgCo2e, 0);
  assert.equal(created.activity.integrityValid, true);
  assert.equal(created.activity.data.submittedBy, 'field_worker');
  assert.equal(created.approval.targetType, 'environmental_activity');
  assert.equal(ledger.calculateEnvironmentalRegister(job.id).summary.totalKgCo2e, 0);

  const replay = ledger.createEnvironmentalActivity(job.id, payload, { actor: 'offline_retry' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.activity.id, created.activity.id);
  assert.equal(ledger.count('environmental_activities'), 1);
  assert.throws(
    () => ledger.createEnvironmentalActivity(job.id, { ...payload, quantity: 51 }),
    error => error.code === 'environmental_entry_key_reused' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.createEnvironmentalActivity(job.id, { ...payload, entryKey: 'environmental-activity-GOV-002' }),
    error => error.code === 'environmental_activity_duplicate' && error.statusCode === 409
  );

  assert.equal(created.approval.decision.preview.emissionsKgCo2e, 135);
  assert.equal(created.approval.decision.preview.factorSource, 'Operator retained factor library');
  assert.ok(created.approval.decision.safeguards.some(item => /does not claim regulatory certification/i.test(item)));

  ledger.resolveApproval(created.approval.id, {
    status: 'approved',
    resolvedBy: 'environmental_approver',
    reason: 'Fuel ticket, job allocation, unit, factor value, and factor provenance verified.'
  });
  const approved = ledger.getEnvironmentalActivity(created.activity.id);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.recognizedKgCo2e, 135);
  const register = ledger.calculateEnvironmentalRegister(job.id);
  assert.equal(register.readyForReport, true);
  assert.equal(register.summary.totalKgCo2e, 135);
  assert.equal(register.summary.totalTonnesCo2e, 0.135);
  assert.deepEqual(register.summary.byScope, [{ key: 'scope_1', count: 1, emissionsKgCo2e: 135 }]);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
  assert.equal(ledger.diagnose().valid, true);
});

test('environmental reports freeze current approved evidence and retain historical downloads', t => {
  const { ledger, job, worker } = fixture(t, 'report');
  const first = ledger.createEnvironmentalActivity(job.id, activityPayload(worker, 'REPORT-001'), { actor: 'field_worker' });
  ledger.resolveApproval(first.approval.id, {
    status: 'approved', resolvedBy: 'environmental_approver', reason: 'First activity source verified.'
  });

  const requested = ledger.requestEnvironmentalReport(job.id, {}, { actor: 'office_operator' });
  assert.equal(requested.replayed, false);
  assert.equal(requested.report.status, 'pending_approval');
  assert.equal(requested.report.activityCount, 1);
  assert.equal(requested.report.integrityValid, true);
  assert.equal(requested.report.sourceCurrent, true);
  assert.throws(
    () => ledger.getEnvironmentalReportContent(requested.report.id),
    error => error.code === 'environmental_report_not_approved'
  );

  ledger.resolveApproval(requested.approval.id, {
    status: 'approved',
    resolvedBy: 'environmental_approver',
    reason: 'Source currency, factor provenance, snapshot, and CSV checksum verified.'
  });
  const approved = ledger.getEnvironmentalReport(requested.report.id);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.sourceCurrent, true);
  const download = ledger.getEnvironmentalReportContent(approved.id);
  assert.match(download.content, /^\uFEFFactivity_id,activity_date,category,ghg_scope/);
  assert.match(download.content, /Excavator diesel REPORT-001/);

  const second = ledger.createEnvironmentalActivity(job.id, {
    ...activityPayload(worker, 'REPORT-002'),
    description: 'Temporary power consumption',
    category: 'electricity',
    ghgScope: 'scope_2',
    quantity: 100,
    unit: 'kWh',
    emissionFactor: 0.4
  }, { actor: 'field_worker' });
  assert.equal(ledger.getEnvironmentalReport(approved.id).sourceCurrent, true);
  ledger.resolveApproval(second.approval.id, {
    status: 'approved', resolvedBy: 'environmental_approver', reason: 'Electricity statement and factor provenance verified.'
  });
  assert.equal(ledger.getEnvironmentalReport(approved.id).sourceCurrent, false);
  assert.match(ledger.getEnvironmentalReportContent(approved.id).content, /REPORT-001/);

  const replacement = ledger.requestEnvironmentalReport(job.id, {}, { actor: 'office_operator' });
  assert.notEqual(replacement.report.id, approved.id);
  assert.equal(replacement.report.summary.totalKgCo2e, 175);
  assert.equal(replacement.report.activityCount, 2);
  assert.equal(ledger.diagnose().valid, true);
});

test('environmental reversal is compensating and rejected reversal restores recognition', t => {
  const { ledger, job, worker } = fixture(t, 'reversal');
  const created = ledger.createEnvironmentalActivity(job.id, activityPayload(worker, 'REV-001'), { actor: 'field_worker' });
  ledger.resolveApproval(created.approval.id, {
    status: 'approved', resolvedBy: 'environmental_approver', reason: 'Original activity source verified.'
  });

  const first = ledger.requestEnvironmentalActivityReversal(job.id, created.activity.id, {
    reason: 'The retained ticket was initially thought to belong to another job.'
  }, { actor: 'office_operator' });
  assert.equal(first.activity.status, 'pending_reversal');
  assert.equal(ledger.calculateEnvironmentalRegister(job.id).summary.totalKgCo2e, 0);
  assert.equal(ledger.calculateEnvironmentalRegister(job.id).summary.pendingReversals, 1);
  ledger.resolveApproval(first.approval.id, {
    status: 'rejected', resolvedBy: 'environmental_approver', reason: 'The ticket correctly belongs to this job.'
  });
  assert.equal(ledger.getEnvironmentalActivity(created.activity.id).status, 'approved');
  assert.equal(ledger.calculateEnvironmentalRegister(job.id).summary.totalKgCo2e, 135);

  const second = ledger.requestEnvironmentalActivityReversal(job.id, created.activity.id, {
    reason: 'Corrected source evidence confirms duplicate capture in another retained record.'
  }, { actor: 'office_operator' });
  ledger.resolveApproval(second.approval.id, {
    status: 'approved', resolvedBy: 'environmental_approver', reason: 'Correction source verified.'
  });
  const reversed = ledger.getEnvironmentalActivity(created.activity.id);
  assert.equal(reversed.status, 'reversed');
  assert.equal(reversed.recognizedKgCo2e, 0);
  assert.equal(reversed.integrityValid, true);
  assert.equal(ledger.calculateEnvironmentalRegister(job.id).summary.totalKgCo2e, 0);
  assert.equal(ledger.getJobDetail(job.id, { includeAudit: true }).audit.some(event => event.action === 'reverse_environmental_activity'), true);
  assert.equal(ledger.diagnose().valid, true);
});

test('environmental autonomy creates internal review work and a governed report only', t => {
  const { ledger, job, worker } = fixture(t, 'autonomy');
  const created = ledger.createEnvironmentalActivity(job.id, activityPayload(worker, 'AUTO-001'), { actor: 'field_worker' });
  const communicationCount = ledger.count('communication_records');
  const reviewCandidate = ledger.nextActions().find(action => action.type === 'review_environmental_activity' && action.activityId === created.activity.id);
  assert.ok(reviewCandidate);

  const reviewCycle = ledger.runAutonomousCycle({ actionTypes: ['review_environmental_activity'], jobIds: [job.id] });
  assert.equal(reviewCycle.applied.length, 1);
  assert.equal(reviewCycle.applied[0].certificationClaimed, false);
  const reviewTask = ledger.getJobDetail(job.id).tasks.find(task => task.data?.environmentalActivityId === created.activity.id);
  assert.ok(reviewTask);
  assert.equal(reviewTask.data.internalOnly, true);
  assert.equal(ledger.getEnvironmentalActivity(created.activity.id).status, 'pending_approval');
  assert.equal(ledger.runAutonomousCycle({ actionTypes: ['review_environmental_activity'], jobIds: [job.id] }).applied.length, 0);

  ledger.resolveApproval(created.approval.id, {
    status: 'approved', resolvedBy: 'environmental_approver', reason: 'Source and factor provenance verified.'
  });
  const reportCandidate = ledger.nextActions().find(action => action.type === 'prepare_environmental_report' && action.jobId === job.id);
  assert.ok(reportCandidate);
  const reportCycle = ledger.runAutonomousCycle({ actionTypes: ['prepare_environmental_report'], jobIds: [job.id] });
  assert.equal(reportCycle.applied.length, 1);
  assert.equal(reportCycle.applied[0].externalCommitments, 0);
  assert.equal(reportCycle.applied[0].certificationClaimed, false);
  const reports = ledger.listEnvironmentalReports({ jobId: job.id });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].status, 'pending_approval');
  assert.equal(ledger.runAutonomousCycle({ actionTypes: ['prepare_environmental_report'], jobIds: [job.id] }).applied.length, 0);
  assert.equal(ledger.count('communication_records'), communicationCount);
  assert.equal(ledger.diagnose().valid, true);
});
