const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-worker-directory-'));
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');

const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  return { response, body };
}

test('crew directory validates workers and gates retirement against active assignments', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const missingName = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ role: 'Installer' })
  });
  assert.equal(missingName.response.status, 400);
  assert.equal(missingName.body.error.code, 'worker_name_required');

  const created = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Retained Crew Lead',
      role: 'Renovation lead',
      email: 'crew.lead@example.test',
      phone: '+31 6 12345678',
      status: 'available',
      homeRegion: 'Utrecht',
      hourlyRate: 58.5,
      skills: ['renovation', 'site coordination'],
      notes: 'Internal retained workforce record.'
    })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.worker.name, 'Retained Crew Lead');
  assert.deepEqual(created.body.worker.skills, ['renovation', 'site coordination']);

  const legacyWorker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Imported Active Worker', status: 'available' })
  });
  const migrationDb = new DatabaseSync(process.env.LEDGER_DB_FILE);
  migrationDb.prepare("UPDATE workers SET status = 'active' WHERE id = ?").run(legacyWorker.body.worker.id);
  migrationDb.close();

  const canonicalBusy = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(legacyWorker.body.worker.id)}`);
  assert.equal(canonicalBusy.body.worker.status, 'busy');
  const busyDirectory = await request(baseUrl, '/api/ledger/workers?status=busy&limit=100');
  assert.ok(busyDirectory.body.workers.some(worker => worker.id === legacyWorker.body.worker.id));
  const travelingWorker = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(legacyWorker.body.worker.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'traveling' })
  });
  assert.equal(travelingWorker.response.status, 200);
  assert.equal(travelingWorker.body.worker.status, 'traveling');

  const duplicateEmail = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Duplicate Crew Record', email: 'crew.lead@example.test' })
  });
  assert.equal(duplicateEmail.response.status, 409);
  assert.equal(duplicateEmail.body.error.code, 'worker_email_duplicate');

  const directRetirement = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(created.body.worker.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'retired' })
  });
  assert.equal(directRetirement.response.status, 409);
  assert.equal(directRetirement.body.error.code, 'worker_retirement_route_required');

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Worker retirement assignment gate',
      status: 'scheduled',
      assignAutomatically: false,
      client: { name: 'Crew Governance Client' }
    })
  });
  assert.equal(intake.response.status, 201);
  const assignment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(intake.body.job.id)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({
      workerId: created.body.worker.id,
      status: 'planned',
      scheduledStart: '2027-02-01T08:00:00.000Z',
      scheduledEnd: '2027-02-01T16:00:00.000Z'
    })
  });
  assert.equal(assignment.response.status, 201);
  assert.equal(assignment.body.assignment.status, 'planned');

  const shortReason = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(created.body.worker.id)}/retirement`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Short' })
  });
  assert.equal(shortReason.response.status, 400);
  assert.equal(shortReason.body.error.code, 'worker_retirement_reason_required');

  const retirement = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(created.body.worker.id)}/retirement`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Crew member is leaving after assigned work is reassigned.' })
  });
  assert.equal(retirement.response.status, 200);
  assert.equal(retirement.body.requiresApproval, true);
  assert.equal(retirement.body.approval.targetType, 'worker_retirement');
  assert.equal(retirement.body.approval.data.activeAssignmentCount, 1);
  assert.equal(retirement.body.worker.retirementApprovalId, retirement.body.approval.id);

  const replay = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(created.body.worker.id)}/retirement`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Crew member is leaving after assigned work is reassigned.' })
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.approval.id, retirement.body.approval.id);

  const directory = await request(baseUrl, '/api/ledger/workers?limit=100');
  assert.equal(directory.response.status, 200);
  const directoryWorker = directory.body.workers.find(worker => worker.id === created.body.worker.id);
  assert.equal(directoryWorker.retirementApprovalId, retirement.body.approval.id);
  assert.equal(directoryWorker.activeAssignmentCount, 1);
  assert.equal(directory.body.summary.pendingRetirement, 1);
  assert.equal(directory.body.summary.activeAssignments, 1);

  const secondIntake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Blocked new worker assignment',
      status: 'planned',
      assignAutomatically: false,
      client: { name: 'Crew Governance Client Two' }
    })
  });
  const blockedAssignment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(secondIntake.body.job.id)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: created.body.worker.id, status: 'planned' })
  });
  assert.equal(blockedAssignment.response.status, 409);
  assert.equal(blockedAssignment.body.error.code, 'worker_retirement_pending');

  const blockedApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(retirement.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Crew approver', reason: 'Attempt before assignment release.' })
  });
  assert.equal(blockedApproval.response.status, 409);
  assert.equal(blockedApproval.body.error.code, 'worker_retirement_active_assignments');

  const pendingAfterBlock = await request(baseUrl, '/api/ledger/approvals?status=pending&limit=100');
  assert.ok(pendingAfterBlock.body.approvals.some(approval => approval.id === retirement.body.approval.id));

  const released = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(intake.body.job.id)}/assignments/${encodeURIComponent(assignment.body.assignment.id)}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Assignment reassigned before worker retirement.' })
  });
  assert.equal(released.response.status, 200);
  assert.equal(released.body.assignment.status, 'released');

  const approved = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(retirement.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Crew approver', reason: 'Assignments cleared and retained history reviewed.' })
  });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.body.approval.status, 'approved');

  const retired = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(created.body.worker.id)}`);
  assert.equal(retired.response.status, 200);
  assert.equal(retired.body.worker.status, 'retired');
  assert.equal(retired.body.worker.activeAssignmentCount, 0);

  const retiredEdit = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(created.body.worker.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ phone: '+31 6 99999999' })
  });
  assert.equal(retiredEdit.response.status, 409);
  assert.equal(retiredEdit.body.error.code, 'worker_retired');

  const audit = await request(baseUrl, `/api/ledger/audit?entityId=${encodeURIComponent(created.body.worker.id)}&limit=100`);
  assert.ok(audit.body.events.some(event => event.action === 'create_worker'));
  assert.ok(audit.body.events.some(event => event.action === 'request_worker_retirement'));
  assert.ok(audit.body.events.some(event => event.action === 'apply_worker_retirement'));
});

test('archived job assignments become dormant and retire through one audited approval', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const workerResponse = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Dormant Assignment Crew', status: 'available', role: 'Archive handover' })
  });
  assert.equal(workerResponse.response.status, 201);
  const worker = workerResponse.body.worker;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Dormant assignment lifecycle job',
      status: 'planned',
      assignAutomatically: false,
      client: { name: 'Archived Assignment Client' }
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const assignmentResponse = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: worker.id, status: 'planned' })
  });
  assert.equal(assignmentResponse.response.status, 201);
  const assignment = assignmentResponse.body.assignment;
  const preArchiveJob = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  for (const approval of preArchiveJob.body.job.approvals.filter(item => item.status === 'pending')) {
    const prerequisiteApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(approval.id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ status: 'approved', resolvedBy: 'Fixture approver', reason: 'Retained job prerequisite reviewed before archive.' })
    });
    assert.equal(prerequisiteApproval.response.status, 200);
  }

  const archiveRequest = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/archive`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Retain this completed fixture outside active operating queues.' })
  });
  assert.equal(archiveRequest.response.status, 201, JSON.stringify(archiveRequest.body));
  const archiveApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(archiveRequest.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Archive approver', reason: 'Archived state and retained records verified.' })
  });
  assert.equal(archiveApproval.response.status, 200);

  const dormantWorkerResponse = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(worker.id)}`);
  assert.equal(dormantWorkerResponse.body.worker.activeAssignmentCount, 0);
  assert.equal(dormantWorkerResponse.body.worker.dormantAssignmentCount, 1);
  assert.equal(dormantWorkerResponse.body.worker.retainedAssignmentCount, 1);

  const directory = await request(baseUrl, '/api/ledger/workers?limit=500');
  const directoryWorker = directory.body.workers.find(item => item.id === worker.id);
  assert.equal(directoryWorker.activeAssignmentCount, 0);
  assert.equal(directoryWorker.dormantAssignmentCount, 1);
  assert.ok(directory.body.summary.dormantAssignments >= 1);

  const retirementRequest = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(worker.id)}/retirement`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Remove this worker from all future restored and newly planned work.' })
  });
  assert.equal(retirementRequest.response.status, 200);
  assert.equal(retirementRequest.body.approval.data.activeAssignmentCount, 0);
  assert.equal(retirementRequest.body.approval.data.dormantAssignmentCount, 1);
  assert.equal(retirementRequest.body.approval.decision.preview.dormantAssignmentCount, 1);
  assert.ok(retirementRequest.body.approval.decision.effects.some(effect => /Release 1 dormant assignment/i.test(effect)));

  const retirementApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(retirementRequest.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Crew approver', reason: 'Dormant job assignment and future restore impact verified.' })
  });
  assert.equal(retirementApproval.response.status, 200);

  const retiredWorkerResponse = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(worker.id)}`);
  assert.equal(retiredWorkerResponse.body.worker.status, 'retired');
  assert.equal(retiredWorkerResponse.body.worker.activeAssignmentCount, 0);
  assert.equal(retiredWorkerResponse.body.worker.dormantAssignmentCount, 0);
  assert.deepEqual(retiredWorkerResponse.body.worker.data.releasedDormantAssignmentIds, [assignment.id]);

  const archivedJob = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(archivedJob.body.job.status, 'archived');
  assert.equal(archivedJob.body.job.assignments.find(item => item.id === assignment.id).status, 'released');
  const audit = await request(baseUrl, `/api/ledger/audit?jobId=${encodeURIComponent(jobId)}&limit=100`);
  assert.ok(audit.body.events.some(event => event.action === 'release_assignment' && event.entityId === assignment.id));
});
