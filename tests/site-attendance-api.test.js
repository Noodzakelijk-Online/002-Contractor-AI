const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-attendance-api-'));
const tokens = {
  owner: 'attendance-owner-token-at-least-32-characters',
  approver: 'attendance-approver-token-at-least-32-characters',
  office_operator: 'attendance-office-token-at-least-32-characters',
  field_worker: {
    token: 'attendance-field-token-at-least-32-characters',
    workerId: 'worker-attendance-field'
  }
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify(tokens),
  STATE_FILE: path.join(directory, 'state.json'),
  LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(directory, 'uploads')
});
delete process.env.CONTRACTOR_AI_AUTH_TOKEN;
delete process.env.DASHBOARD_AUTH_TOKEN;

const app = require('../server');

async function request(baseUrl, route, token, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test('attendance API enforces worker scope, access clearance, replay, and adjustment approval', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'attendance_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const worker = await request(baseUrl, '/api/ledger/workers', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ id: tokens.field_worker.workerId, name: 'Attendance field worker', role: 'Installer', status: 'available' })
  });
  assert.equal(worker.response.status, 201, JSON.stringify(worker.body));
  const intake = await request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ title: 'API attendance site', client: { name: 'API Attendance Client' }, status: 'in_progress', assignAutomatically: false })
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;
  const assignmentResponse = await request(baseUrl, `/api/ledger/jobs/${jobId}/assignments`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ workerId: tokens.field_worker.workerId, role: 'Installer', status: 'active' })
  });
  assert.equal(assignmentResponse.response.status, 201, JSON.stringify(assignmentResponse.body));
  let assignment = assignmentResponse.body.assignment;
  if (assignment.approval?.id) {
    const approvedAssignment = await request(baseUrl, `/api/ledger/approvals/${assignment.approval.id}/resolve`, tokens.approver, {
      method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Assignment availability and timing verified.' })
    });
    assert.equal(approvedAssignment.response.status, 200, JSON.stringify(approvedAssignment.body));
    const detail = await request(baseUrl, `/api/ledger/jobs/${jobId}`, tokens.owner);
    assignment = detail.body.job.assignments.find(item => item.id === assignment.id);
  }

  const deniedBeforeAccess = await request(baseUrl, `/api/ledger/jobs/${jobId}/attendance/check-in`, tokens.field_worker.token, {
    method: 'POST',
    body: JSON.stringify({ entryKey: 'attendance-api-in-0001', assignmentId: assignment.id, workerId: 'spoofed-worker' })
  });
  assert.equal(deniedBeforeAccess.response.status, 409);
  assert.equal(deniedBeforeAccess.body.error.code, 'attendance_site_access_required');

  const orientation = await request(baseUrl, `/api/ledger/jobs/${jobId}/orientations`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ assignmentId: assignment.id, workerId: tokens.field_worker.workerId, workerName: 'Attendance field worker', status: 'completed' })
  });
  assert.equal(orientation.response.status, 201, JSON.stringify(orientation.body));
  const orientationApproval = await request(baseUrl, `/api/ledger/approvals/${orientation.body.orientation.approvalId}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Orientation identity and site topics verified.' })
  });
  assert.equal(orientationApproval.response.status, 200, JSON.stringify(orientationApproval.body));
  const access = await request(baseUrl, `/api/ledger/jobs/${jobId}/site-access`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      assignmentId: assignment.id,
      workerId: tokens.field_worker.workerId,
      workerName: 'Attendance field worker',
      orientationId: orientation.body.orientation.id,
      orientationValid: true,
      status: 'cleared',
      accessPoint: 'API gate'
    })
  });
  assert.equal(access.response.status, 201, JSON.stringify(access.body));
  const accessApproval = await request(baseUrl, `/api/ledger/approvals/${access.body.siteAccessLog.approvalId}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Assignment-scoped access evidence verified.' })
  });
  assert.equal(accessApproval.response.status, 200, JSON.stringify(accessApproval.body));

  const checkInPayload = {
    entryKey: 'attendance-api-in-0001',
    assignmentId: assignment.id,
    workerId: 'spoofed-worker',
    occurredAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    accessPoint: 'API gate'
  };
  const checkedIn = await request(baseUrl, `/api/ledger/jobs/${jobId}/attendance/check-in`, tokens.field_worker.token, {
    method: 'POST', body: JSON.stringify(checkInPayload)
  });
  assert.equal(checkedIn.response.status, 201, JSON.stringify(checkedIn.body));
  assert.equal(checkedIn.body.session.workerId, tokens.field_worker.workerId);
  assert.equal(checkedIn.body.session.checkInEntryKey, undefined);
  const replay = await request(baseUrl, `/api/ledger/jobs/${jobId}/attendance/check-in`, tokens.field_worker.token, {
    method: 'POST', body: JSON.stringify(checkInPayload)
  });
  assert.equal(replay.response.status, 201, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);

  const board = await request(baseUrl, '/api/ledger/attendance', tokens.field_worker.token);
  assert.equal(board.response.status, 200, JSON.stringify(board.body));
  assert.equal(board.body.attendance.rows.length, 1);
  assert.equal(board.body.attendance.rows[0].workerId, tokens.field_worker.workerId);
  assert.equal(board.body.attendance.policy.payrollDerived, false);

  const checkedOut = await request(baseUrl, `/api/ledger/jobs/${jobId}/attendance/${checkedIn.body.session.id}/check-out`, tokens.field_worker.token, {
    method: 'POST',
    body: JSON.stringify({ entryKey: 'attendance-api-out-0001', occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
  });
  assert.equal(checkedOut.response.status, 201, JSON.stringify(checkedOut.body));
  assert.equal(checkedOut.body.session.status, 'checked_out');
  const deniedAdjustment = await request(baseUrl, `/api/ledger/jobs/${jobId}/attendance/${checkedIn.body.session.id}/adjustments`, tokens.field_worker.token, {
    method: 'POST', body: JSON.stringify({ reason: 'Field role cannot change retained attendance.' })
  });
  assert.equal(deniedAdjustment.response.status, 403);

  const adjustment = await request(baseUrl, `/api/ledger/jobs/${jobId}/attendance/${checkedIn.body.session.id}/adjustments`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      checkInAt: new Date(Date.parse(checkedOut.body.session.checkInAt) + 10 * 60 * 1000).toISOString(),
      checkOutAt: checkedOut.body.session.checkOutAt,
      reason: 'Supervisor verified a ten-minute gate scanner offset.'
    })
  });
  assert.equal(adjustment.response.status, 201, JSON.stringify(adjustment.body));
  assert.equal(adjustment.body.adjustment.status, 'pending_approval');
  const approvedAdjustment = await request(baseUrl, `/api/ledger/approvals/${adjustment.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Gate scanner evidence verified.' })
  });
  assert.equal(approvedAdjustment.response.status, 200, JSON.stringify(approvedAdjustment.body));
  const ownerBoard = await request(baseUrl, `/api/ledger/jobs/${jobId}/attendance`, tokens.owner);
  assert.equal(ownerBoard.response.status, 200, JSON.stringify(ownerBoard.body));
  assert.equal(ownerBoard.body.attendance.rows[0].adjustment.status, 'approved');
});
