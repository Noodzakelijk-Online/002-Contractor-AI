const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-equipment-directory-'));
process.env.STATE_FILE = path.join(directory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(directory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(directory, 'uploads');
process.env.CONTRACTOR_AI_REQUIRE_AUTH = 'true';
process.env.CONTRACTOR_AI_ROLE_TOKENS = JSON.stringify({
  owner: 'equipment-owner-token-at-least-32-characters',
  office_operator: 'equipment-office-token-at-least-32-characters',
  approver: 'equipment-approver-token-at-least-32-characters',
  field_worker: {
    token: 'equipment-field-token-at-least-32-characters',
    workerId: 'equipment-field-worker'
  }
});

const app = require('../server');

const tokens = {
  owner: 'equipment-owner-token-at-least-32-characters',
  office: 'equipment-office-token-at-least-32-characters',
  approver: 'equipment-approver-token-at-least-32-characters',
  field: 'equipment-field-token-at-least-32-characters'
};

async function request(baseUrl, route, options = {}) {
  const { token = tokens.office, ...fetchOptions } = options;
  const response = await fetch(`${baseUrl}${route}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(fetchOptions.headers || {})
    },
    ...fetchOptions
  });
  const body = await response.json();
  return { response, body };
}

async function createJob(baseUrl, title) {
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title,
      status: 'planned',
      assignAutomatically: false,
      client: { name: `${title} client` }
    })
  });
  assert.equal(intake.response.status, 201);
  return intake.body.job;
}

test('equipment directory validates records and blocks retirement while operational reservations remain', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const missingName = await request(baseUrl, '/api/ledger/tools', {
    method: 'POST',
    body: JSON.stringify({ category: 'power_tool' })
  });
  assert.equal(missingName.response.status, 400);
  assert.equal(missingName.body.error.code, 'tool_name_required');

  const created = await request(baseUrl, '/api/ledger/tools', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Retained site laser',
      category: 'measurement',
      status: 'available',
      homeLocation: 'Utrecht depot',
      currentLocation: 'Utrecht depot',
      actor: 'spoofed-owner'
    })
  });
  assert.equal(created.response.status, 201);
  const tool = created.body.tool;

  const directRetirement = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'retired' })
  });
  assert.equal(directRetirement.response.status, 409);
  assert.equal(directRetirement.body.error.code, 'tool_retirement_route_required');

  const job = await createJob(baseUrl, 'Operational equipment reservation');
  const reservation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(job.id)}/tools`, {
    method: 'POST',
    body: JSON.stringify({ toolId: tool.id, status: 'reserved' })
  });
  assert.equal(reservation.response.status, 201);
  assert.equal(reservation.body.toolReservation.status, 'reserved');

  const shortReason = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}/retirement`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Short' })
  });
  assert.equal(shortReason.response.status, 400);
  assert.equal(shortReason.body.error.code, 'tool_retirement_reason_required');

  const forbiddenDelete = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason: 'Office operators use the explicit retirement request.' })
  });
  assert.equal(forbiddenDelete.response.status, 403);

  const retirement = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}/retirement`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Equipment is leaving service after its retained job reservation is released.' })
  });
  assert.equal(retirement.response.status, 200);
  assert.equal(retirement.body.approval.targetType, 'tool_retirement');
  assert.equal(retirement.body.approval.data.activeReservationCount, 1);
  assert.equal(retirement.body.tool.retirementApprovalId, retirement.body.approval.id);

  const directoryResponse = await request(baseUrl, '/api/ledger/tools?limit=100');
  const directoryTool = directoryResponse.body.tools.find(item => item.id === tool.id);
  assert.equal(directoryTool.activeReservationCount, 1);
  assert.equal(directoryTool.dormantReservationCount, 0);
  assert.equal(directoryResponse.body.summary.pendingRetirement, 1);
  assert.equal(directoryResponse.body.summary.activeReservations, 1);

  const secondJob = await createJob(baseUrl, 'Blocked equipment reservation');
  const blockedReservation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(secondJob.id)}/tools`, {
    method: 'POST',
    body: JSON.stringify({ toolId: tool.id, status: 'reserved' })
  });
  assert.equal(blockedReservation.response.status, 409);
  assert.equal(blockedReservation.body.error.code, 'tool_retirement_pending');

  const blockedApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(retirement.body.approval.id)}/resolve`, {
    token: tokens.approver,
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Equipment approver', reason: 'Attempt before operational release.' })
  });
  assert.equal(blockedApproval.response.status, 409);
  assert.equal(blockedApproval.body.error.code, 'tool_retirement_active_reservations');
  assert.equal(blockedApproval.body.error.details.activeReservationCount, 1);

  const approvals = await request(baseUrl, '/api/ledger/approvals?status=pending&limit=100', { token: tokens.approver });
  const pending = approvals.body.approvals.find(item => item.id === retirement.body.approval.id);
  assert.ok(pending);
  assert.match(pending.decision.safeguards.join(' '), /blocked until 1 operational reservation/i);

  const released = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(job.id)}/tools/${encodeURIComponent(reservation.body.toolReservation.id)}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Equipment reassigned before retirement.', actor: 'spoofed-owner', releasedBy: 'spoofed-approver' })
  });
  assert.equal(released.response.status, 200);
  assert.equal(released.body.toolReservation.status, 'released');
  assert.equal(released.body.toolReservation.data.releasedBy, 'role:office_operator');

  const approved = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(retirement.body.approval.id)}/resolve`, {
    token: tokens.approver,
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Equipment approver', reason: 'Operational reservations are clear.' })
  });
  assert.equal(approved.response.status, 200);

  const retiredDirectory = await request(baseUrl, '/api/ledger/tools?status=retired&limit=100');
  const retired = retiredDirectory.body.tools.find(item => item.id === tool.id);
  assert.equal(retired.status, 'retired');
  assert.equal(retired.activeReservationCount, 0);

  const retiredEdit = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ currentLocation: 'External storage' })
  });
  assert.equal(retiredEdit.response.status, 409);
  assert.equal(retiredEdit.body.error.code, 'tool_retired');

  const audit = await request(baseUrl, `/api/ledger/audit?entityId=${encodeURIComponent(tool.id)}&limit=100`, { token: tokens.owner });
  const requestEvent = audit.body.events.find(event => event.action === 'request_tool_retirement');
  assert.equal(requestEvent.actor, 'role:office_operator');
  assert.ok(audit.body.events.some(event => event.action === 'apply_tool_retirement'));
});

test('required equipment inspections gate reservations and retain internal evidence history', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const nextDueAt = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const inspectedAt = new Date().toISOString().slice(0, 10);

  const created = await request(baseUrl, '/api/ledger/tools', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Inspection-gated retained lift',
      category: 'access',
      status: 'available',
      currentLocation: 'Rotterdam depot',
      data: {
        inspectionRequired: true,
        inspectionDueAt: '2020-01-01',
        serialNumber: 'LIFT-INSPECTION-001'
      }
    })
  });
  assert.equal(created.response.status, 201);
  const tool = created.body.tool;

  const directory = await request(baseUrl, `/api/ledger/tools?search=${encodeURIComponent(tool.name)}&limit=100`);
  const overdueTool = directory.body.tools.find(item => item.id === tool.id);
  assert.equal(overdueTool.inspection.status, 'overdue');
  assert.equal(overdueTool.inspection.blocksReservation, true);
  assert.ok(directory.body.summary.inspectionOverdue >= 1);
  assert.ok(directory.body.summary.inspectionBlocked >= 1);

  const job = await createJob(baseUrl, 'Inspection-gated reservation');
  const overdueReservation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(job.id)}/tools`, {
    method: 'POST',
    body: JSON.stringify({ toolId: tool.id, status: 'reserved' })
  });
  assert.equal(overdueReservation.response.status, 409);
  assert.equal(overdueReservation.body.error.code, 'tool_inspection_overdue');
  assert.equal(overdueReservation.body.error.details.inspectionStatus, 'overdue');

  for (const token of [tokens.approver, tokens.field]) {
    const forbidden = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}/inspections`, {
      token,
      method: 'POST',
      body: JSON.stringify({ result: 'passed', inspector: 'Unauthorized actor', inspectedAt, nextDueAt })
    });
    assert.equal(forbidden.response.status, 403);
    assert.equal(forbidden.body.error.code, 'insufficient_role');
  }

  const missingFindings = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}/inspections`, {
    method: 'POST',
    body: JSON.stringify({ result: 'failed', inspector: 'Internal inspector', inspectedAt })
  });
  assert.equal(missingFindings.response.status, 400);
  assert.equal(missingFindings.body.error.code, 'tool_inspection_findings_required');

  const passed = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}/inspections`, {
    method: 'POST',
    body: JSON.stringify({
      result: 'passed',
      inspector: 'Internal inspector',
      inspectedAt,
      nextDueAt,
      reference: 'CHECKLIST-2026-001',
      notes: 'Internal operational checks completed.',
      actor: 'spoofed-owner'
    })
  });
  assert.equal(passed.response.status, 201);
  assert.equal(passed.body.inspection.recordedBy, 'role:office_operator');
  assert.equal(passed.body.inspection.certificationClaimed, false);
  assert.equal(passed.body.externalCommitments, 0);
  assert.equal(passed.body.reservationReady, true);
  assert.equal(passed.body.tool.inspection.status, 'current');

  const reservation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(job.id)}/tools`, {
    method: 'POST',
    body: JSON.stringify({ toolId: tool.id, status: 'reserved' })
  });
  assert.equal(reservation.response.status, 201);

  const failed = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}/inspections`, {
    method: 'POST',
    body: JSON.stringify({
      result: 'failed',
      inspector: 'Internal inspector',
      inspectedAt,
      reference: 'CHECKLIST-2026-002',
      notes: 'Guard damage requires maintenance before further use.'
    })
  });
  assert.equal(failed.response.status, 201);
  assert.equal(failed.body.tool.status, 'maintenance');
  assert.equal(failed.body.tool.inspection.status, 'failed');
  assert.equal(failed.body.reservationReady, false);

  const secondJob = await createJob(baseUrl, 'Failed inspection reservation');
  const failedReservation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(secondJob.id)}/tools`, {
    method: 'POST',
    body: JSON.stringify({ toolId: tool.id, status: 'reserved' })
  });
  assert.equal(failedReservation.response.status, 409);
  assert.equal(failedReservation.body.error.code, 'tool_inspection_failed');

  const prematureReinspection = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}/inspections`, {
    method: 'POST',
    body: JSON.stringify({ result: 'passed', inspector: 'Internal inspector', inspectedAt, nextDueAt })
  });
  assert.equal(prematureReinspection.response.status, 409);
  assert.equal(prematureReinspection.body.error.code, 'tool_maintenance_required_before_reinspection');

  const released = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(job.id)}/tools/${encodeURIComponent(reservation.body.toolReservation.id)}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Unsafe equipment removed from the active work plan.' })
  });
  assert.equal(released.response.status, 200);

  for (const token of [tokens.approver, tokens.field]) {
    const forbidden = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}/maintenance`, {
      token,
      method: 'POST',
      body: JSON.stringify({
        outcome: 'completed',
        maintenanceType: 'corrective',
        performedBy: 'Unauthorized actor',
        performedAt: inspectedAt,
        notes: 'Attempted maintenance evidence outside the office role.'
      })
    });
    assert.equal(forbidden.response.status, 403);
    assert.equal(forbidden.body.error.code, 'insufficient_role');
  }

  const spendAttempt = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}/maintenance`, {
    method: 'POST',
    body: JSON.stringify({
      outcome: 'completed',
      maintenanceType: 'service',
      performedBy: 'Internal technician',
      performedAt: inspectedAt,
      notes: 'Attempted supplier service commitment through evidence route.',
      amount: 125
    })
  });
  assert.equal(spendAttempt.response.status, 409);
  assert.equal(spendAttempt.body.error.code, 'tool_maintenance_spend_requires_approval');

  const maintained = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}/maintenance`, {
    method: 'POST',
    body: JSON.stringify({
      outcome: 'completed',
      maintenanceType: 'corrective',
      performedBy: 'Internal technician',
      performedAt: inspectedAt,
      reference: 'WORK-ORDER-2026-001',
      notes: 'Damaged guard was replaced and the retained function check completed.',
      actor: 'spoofed-owner'
    })
  });
  assert.equal(maintained.response.status, 201);
  assert.equal(maintained.body.maintenance.recordedBy, 'role:office_operator');
  assert.equal(maintained.body.maintenance.supplierSpend, 0);
  assert.equal(maintained.body.externalCommitments, 0);
  assert.equal(maintained.body.reinspectionRequired, true);
  assert.equal(maintained.body.reservationReady, false);
  assert.equal(maintained.body.tool.status, 'inspection_due');
  assert.equal(maintained.body.tool.inspection.status, 'reinspection_required');

  const stillBlockedReservation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(secondJob.id)}/tools`, {
    method: 'POST',
    body: JSON.stringify({ toolId: tool.id, status: 'reserved' })
  });
  assert.equal(stillBlockedReservation.response.status, 409);
  assert.equal(stillBlockedReservation.body.error.code, 'tool_reinspection_required');

  const reinspection = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}/inspections`, {
    method: 'POST',
    body: JSON.stringify({
      result: 'passed',
      inspector: 'Internal inspector',
      inspectedAt,
      nextDueAt,
      reference: 'CHECKLIST-2026-003',
      notes: 'Post-maintenance internal operational reinspection passed.'
    })
  });
  assert.equal(reinspection.response.status, 201);
  assert.equal(reinspection.body.tool.status, 'available');
  assert.equal(reinspection.body.tool.inspection.status, 'current');
  assert.equal(reinspection.body.reservationReady, true);

  const clearedReservation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(secondJob.id)}/tools`, {
    method: 'POST',
    body: JSON.stringify({ toolId: tool.id, status: 'reserved' })
  });
  assert.equal(clearedReservation.response.status, 201);

  const retainedDirectory = await request(baseUrl, `/api/ledger/tools?search=${encodeURIComponent(tool.name)}&limit=100`);
  const retained = retainedDirectory.body.tools.find(item => item.id === tool.id);
  assert.equal(retained.data.inspectionHistory.length, 3);
  assert.equal(retained.data.maintenanceHistory.length, 1);
  assert.equal(retained.inspection.historyCount, 3);
  assert.equal(retained.maintenance.historyCount, 1);
  assert.ok(retainedDirectory.body.summary.maintenanceRecords >= 1);

  const audit = await request(baseUrl, `/api/ledger/audit?entityId=${encodeURIComponent(tool.id)}&limit=100`, { token: tokens.owner });
  const inspectionEvents = audit.body.events.filter(event => event.action === 'record_tool_inspection');
  const maintenanceEvents = audit.body.events.filter(event => event.action === 'record_tool_maintenance');
  assert.equal(inspectionEvents.length, 3);
  assert.equal(maintenanceEvents.length, 1);
  assert.ok(inspectionEvents.every(event => event.actor === 'role:office_operator'));
  assert.ok(inspectionEvents.every(event => event.metadata.externalCommitments === 0));
  assert.ok(inspectionEvents.every(event => event.metadata.certificationClaimed === false));
  assert.equal(maintenanceEvents[0].actor, 'role:office_operator');
  assert.equal(maintenanceEvents[0].metadata.supplierSpend, 0);
  assert.equal(maintenanceEvents[0].metadata.externalCommitments, 0);
});

test('equipment retirement releases dormant archived-job reservations without deleting history', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const toolResponse = await request(baseUrl, '/api/ledger/tools', {
    method: 'POST',
    body: JSON.stringify({ name: 'Dormant archive lift', category: 'access', status: 'available', currentLocation: 'Depot' })
  });
  assert.equal(toolResponse.response.status, 201);
  const tool = toolResponse.body.tool;
  const job = await createJob(baseUrl, 'Dormant equipment archive job');
  const reservationResponse = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(job.id)}/tools`, {
    method: 'POST',
    body: JSON.stringify({ toolId: tool.id, status: 'reserved' })
  });
  assert.equal(reservationResponse.response.status, 201);
  const reservation = reservationResponse.body.toolReservation;

  const pendingJobApprovals = await request(baseUrl, `/api/ledger/approvals?status=pending&jobId=${encodeURIComponent(job.id)}&limit=100`, { token: tokens.approver });
  for (const pending of pendingJobApprovals.body.approvals) {
    const decision = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(pending.id)}/resolve`, {
      token: tokens.approver,
      method: 'POST',
      body: JSON.stringify({ status: 'approved', resolvedBy: 'Equipment approver', reason: 'Archive prerequisite reviewed.' })
    });
    assert.equal(decision.response.status, 200);
  }

  const archive = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(job.id)}/archive`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Retain the completed equipment lifecycle fixture outside active operations.' })
  });
  assert.equal(archive.response.status, 201);
  const archiveApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(archive.body.approval.id)}/resolve`, {
    token: tokens.approver,
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Equipment approver', reason: 'Archive scope reviewed.' })
  });
  assert.equal(archiveApproval.response.status, 200);

  const dormantDirectory = await request(baseUrl, '/api/ledger/tools?limit=100');
  const dormantTool = dormantDirectory.body.tools.find(item => item.id === tool.id);
  assert.equal(dormantTool.activeReservationCount, 0);
  assert.equal(dormantTool.dormantReservationCount, 1);

  const retirement = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}/retirement`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Archived-job reservation should become a retained release before retirement.' })
  });
  assert.equal(retirement.response.status, 200);
  assert.equal(retirement.body.approval.data.activeReservationCount, 0);
  assert.equal(retirement.body.approval.data.dormantReservationCount, 1);

  const approval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(retirement.body.approval.id)}/resolve`, {
    token: tokens.approver,
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Equipment approver', reason: 'Dormant reservation release reviewed.' })
  });
  assert.equal(approval.response.status, 200);

  const archivedJob = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(job.id)}`, { token: tokens.approver });
  const retainedReservation = archivedJob.body.job.tools.find(item => item.id === reservation.id);
  assert.equal(retainedReservation.status, 'released');
  assert.match(retainedReservation.data.releaseReason, /equipment retirement approval/i);

  const toolAudit = await request(baseUrl, `/api/ledger/audit?entityId=${encodeURIComponent(tool.id)}&limit=100`, { token: tokens.owner });
  const applyAudit = toolAudit.body.events.find(event => event.action === 'apply_tool_retirement');
  assert.deepEqual(applyAudit.metadata.releasedDormantReservationIds, [reservation.id]);
  assert.equal(applyAudit.metadata.externalCommitments, 0);
});
