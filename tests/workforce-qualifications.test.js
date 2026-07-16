const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ContractorOperatingLedger } = require('../operating-ledger');

function createLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-qualifications-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function futureDate(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function qualificationFixture(ledger, suffix = Date.now()) {
  const job = ledger.createIntake({
    title: `Qualification job ${suffix}`,
    status: 'scheduled',
    scheduledStart: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    scheduledEnd: new Date(Date.now() + 8 * 86_400_000).toISOString(),
    client: { name: `Qualification client ${suffix}` }
  }, { actor: 'qualification_test' });
  const worker = ledger.upsertWorker({
    name: `Qualified worker ${suffix}`,
    role: 'Site carpenter',
    status: 'available',
    skills: ['carpentry']
  }, { actor: 'qualification_test' });
  const assignment = ledger.addAssignment(job.id, {
    workerId: worker.id,
    role: 'Site carpenter',
    status: 'planned',
    scheduledStart: job.scheduledStart,
    scheduledEnd: job.scheduledEnd
  }, { actor: 'qualification_test', optional: false });
  const requirement = ledger.createQualificationRequirement(job.id, {
    credentialType: 'vca',
    title: 'Current VCA for site work',
    role: 'Site carpenter'
  }, { actor: 'qualification_test' }).requirement;
  return { job, worker, assignment, requirement };
}

test('worker credentials are immutable approval-backed revisions used by dispatch readiness', t => {
  const ledger = createLedger(t);
  const { job, worker, assignment } = qualificationFixture(ledger, 'revision');

  const before = ledger.workerAssignmentReadiness([assignment], {
    jobId: job.id,
    plannedStart: job.scheduledStart,
    plannedEnd: job.scheduledEnd
  });
  assert.equal(before.status, 'blocked');
  assert.equal(before.qualificationBlockers, 1);
  assert.equal(before.blockers[0].type, 'worker_qualification_missing');

  const payload = {
    credentialType: 'vca_basic',
    issuer: 'SSVV examination centre',
    credentialNumber: 'VCA-REVISION-001',
    issuedOn: futureDate(-30),
    expiresOn: futureDate(365),
    evidenceReference: 'Verified certificate scan VCA-REVISION-001'
  };
  const requested = ledger.requestWorkerCredential(worker.id, payload, { actor: 'qualification_test' });
  assert.equal(requested.credential.status, 'pending_approval');
  assert.equal(requested.approval.targetType, 'worker_credential');
  const replay = ledger.requestWorkerCredential(worker.id, payload, { actor: 'qualification_test' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.credential.id, requested.credential.id);

  const pending = ledger.assessWorkerQualifications(worker.id, { jobId: job.id, role: assignment.role, at: job.scheduledEnd });
  assert.equal(pending.status, 'blocked');
  assert.equal(pending.blockers[0].type, 'worker_qualification_pending_approval');

  ledger.resolveApproval(requested.approval.id, {
    status: 'approved',
    resolvedBy: 'qualification_approver',
    reason: 'Identity, issuer, dates, and retained source evidence verified.'
  });
  const approved = ledger.getWorkerCredential(requested.credential.id);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.verifiedBy, 'qualification_approver');
  assert.equal(ledger.assessWorkerQualifications(worker.id, { jobId: job.id, role: assignment.role, at: job.scheduledEnd }).status, 'ready');

  const revision = ledger.requestWorkerCredential(worker.id, {
    ...payload,
    credentialNumber: 'VCA-REVISION-002',
    expiresOn: futureDate(730),
    evidenceReference: 'Verified replacement certificate scan VCA-REVISION-002'
  }, { actor: 'qualification_test' });
  assert.equal(revision.credential.versionNumber, 2);
  assert.equal(revision.credential.supersedesCredentialId, approved.id);
  assert.equal(ledger.assessWorkerQualifications(worker.id, { jobId: job.id, role: assignment.role, at: job.scheduledEnd }).status, 'ready');

  ledger.resolveApproval(revision.approval.id, {
    status: 'approved',
    resolvedBy: 'qualification_approver',
    reason: 'Replacement credential source verified.'
  });
  assert.equal(ledger.getWorkerCredential(revision.credential.id).status, 'approved');
  assert.equal(ledger.listWorkerCredentials({ workerId: worker.id, includeHistory: true }).find(item => item.id === approved.id).status, 'superseded');
  assert.equal(ledger.diagnose().valid, true);
});

test('job qualification removal remains enforced until its approval resolves', t => {
  const ledger = createLedger(t);
  const { job, worker, assignment, requirement } = qualificationFixture(ledger, 'retirement');

  const firstRequest = ledger.requestQualificationRequirementRetirement(job.id, requirement.id, {
    reason: 'Client removed the controlled site-work scope from this job.'
  }, { actor: 'qualification_test' });
  assert.equal(firstRequest.requirement.status, 'pending_retirement');
  assert.equal(ledger.assessWorkerQualifications(worker.id, { jobId: job.id, role: assignment.role }).status, 'blocked');

  ledger.resolveApproval(firstRequest.approval.id, {
    status: 'rejected',
    resolvedBy: 'qualification_approver',
    reason: 'The site-work scope remains in the retained contract.'
  });
  assert.equal(ledger.listQualificationRequirements({ jobId: job.id })[0].status, 'active');

  const secondRequest = ledger.requestQualificationRequirementRetirement(job.id, requirement.id, {
    reason: 'Approved scope change removed all controlled site work.'
  }, { actor: 'qualification_test' });
  ledger.resolveApproval(secondRequest.approval.id, {
    status: 'approved',
    resolvedBy: 'qualification_approver',
    reason: 'Accepted scope change and safety plan confirm removal.'
  });
  assert.equal(ledger.listQualificationRequirements({ jobId: job.id }).length, 0);
  assert.equal(ledger.listQualificationRequirements({ jobId: job.id, includeRetired: true })[0].status, 'retired');
  assert.equal(ledger.assessWorkerQualifications(worker.id, { jobId: job.id, role: assignment.role }).status, 'not_required');
});

test('optional job qualifications remain advisory for unassigned visitor access', t => {
  const ledger = createLedger(t);
  const job = ledger.createIntake({
    title: 'Optional visitor qualification job',
    status: 'scheduled',
    client: { name: 'Optional visitor qualification client' }
  }, { actor: 'qualification_test' });
  ledger.createQualificationRequirement(job.id, {
    credentialType: 'gpi',
    title: 'Advisory GPI evidence',
    mandatory: false
  }, { actor: 'qualification_test' });

  const orientation = ledger.createWorkerOrientation(job.id, {
    workerName: 'Supervised visitor',
    company: 'Client representative',
    status: 'completed',
    verificationReference: 'visitor-orientation-001'
  }, { actor: 'qualification_test' });
  ledger.resolveApproval(orientation.approval.id, {
    status: 'approved',
    resolvedBy: 'qualification_approver',
    reason: 'Visitor identity and site orientation were verified.'
  });

  const access = ledger.createSiteAccessLog(job.id, {
    orientationId: orientation.id,
    workerName: 'Supervised visitor',
    company: 'Client representative',
    status: 'cleared'
  }, { actor: 'qualification_test' });
  assert.equal(access.status, 'pending_approval');
  assert.ok(access.approval?.id);
  ledger.resolveApproval(access.approval.id, {
    status: 'approved',
    resolvedBy: 'qualification_approver',
    reason: 'Supervised visitor access and orientation were verified.'
  });
  assert.equal(ledger.getJobDetail(job.id).siteAccessLogs.find(item => item.id === access.id).status, 'cleared');
});

test('qualification gaps create one internal autonomous review task without fabricating evidence', t => {
  const ledger = createLedger(t);
  const { job, worker, assignment } = qualificationFixture(ledger, 'autonomy');
  const action = ledger.nextActions().find(item => item.type === 'review_worker_qualification_gap' && item.assignmentId === assignment.id);
  assert.ok(action);
  assert.equal(action.workerId, worker.id);

  const first = ledger.runAutonomousCycle({
    actionTypes: ['review_worker_qualification_gap'],
    jobId: job.id,
    actor: 'qualification_scheduler'
  });
  assert.equal(first.applied.length, 1);
  assert.equal(first.applied[0].status, 'task_created');
  assert.equal(ledger.listWorkerCredentials({ workerId: worker.id, includeHistory: true }).length, 0);

  const second = ledger.runAutonomousCycle({
    actionTypes: ['review_worker_qualification_gap'],
    jobId: job.id,
    actor: 'qualification_scheduler'
  });
  assert.equal(second.applied.length, 0);
  assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM job_tasks WHERE data_json LIKE '%qualification_monitor%'").get().count, 1);
  assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM job_tasks WHERE id = ?").get(first.applied[0].taskId).count, 1);
});

test('tampered credential snapshots cannot be approved and remain pending', t => {
  const ledger = createLedger(t);
  const worker = ledger.upsertWorker({ name: 'Credential integrity worker', role: 'Electrician', status: 'available' });
  const requested = ledger.requestWorkerCredential(worker.id, {
    credentialType: 'electrical_nen3140',
    issuer: 'Retained training provider',
    credentialNumber: 'NEN-3140-001',
    issuedOn: futureDate(-10),
    expiresOn: futureDate(365),
    evidenceReference: 'NEN 3140 source document checksum 001'
  });
  ledger.db.prepare('UPDATE worker_credentials SET snapshot_json = ? WHERE id = ?').run('{"tampered":true}', requested.credential.id);

  assert.throws(
    () => ledger.resolveApproval(requested.approval.id, { status: 'approved', resolvedBy: 'qualification_approver' }),
    error => error.code === 'worker_credential_snapshot_integrity_failed'
  );
  assert.equal(ledger.db.prepare('SELECT status FROM approvals WHERE id = ?').get(requested.approval.id).status, 'pending');
  assert.equal(ledger.db.prepare('SELECT status FROM worker_credentials WHERE id = ?').get(requested.credential.id).status, 'pending_approval');
  assert.equal(ledger.diagnose().valid, false);
});
