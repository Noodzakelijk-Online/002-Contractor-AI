const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function previousMonday() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day - 6);
  return date.toISOString().slice(0, 10);
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-timesheet-api-'));
const tokens = {
  owner: 'timesheet-owner-token-at-least-32-characters',
  approver: 'timesheet-approver-token-at-least-32-characters',
  office_operator: 'timesheet-office-token-at-least-32-characters',
  field_worker: { token: 'timesheet-field-token-at-least-32-characters', workerId: 'worker-timesheet-field' }
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
  let body = text;
  if ((response.headers.get('content-type') || '').includes('application/json')) body = text ? JSON.parse(text) : null;
  return { response, body, text };
}

test('timesheet API enforces office review, approver decisions, and checksum-protected download', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'weekly_timesheet_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const periodStart = previousMonday();

  const worker = await request(baseUrl, '/api/ledger/workers', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ id: tokens.field_worker.workerId, name: 'API Timesheet Worker', role: 'Installer', status: 'available', hourlyRate: 48 })
  });
  assert.equal(worker.response.status, 201, JSON.stringify(worker.body));
  const intake = await request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ title: 'API weekly timesheet job', client: { name: 'API Timesheet Client' }, status: 'in_progress', assignAutomatically: false })
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;
  const timeLog = await request(baseUrl, `/api/ledger/jobs/${jobId}/time-logs`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ workerId: tokens.field_worker.workerId, workDate: periodStart, hours: 8, rate: 48, source: 'verified_manual_timecard', verificationReference: 'API-TIME-001' })
  });
  assert.equal(timeLog.response.status, 201, JSON.stringify(timeLog.body));

  const fieldDenied = await request(baseUrl, `/api/ledger/timesheets?periodStart=${periodStart}`, tokens.field_worker.token);
  assert.equal(fieldDenied.response.status, 403);
  const board = await request(baseUrl, `/api/ledger/timesheets?periodStart=${periodStart}`, tokens.office_operator);
  assert.equal(board.response.status, 200, JSON.stringify(board.body));
  assert.equal(board.body.timesheets.summary.submittedHours, 8);
  assert.equal(board.body.timesheets.rows[0].preview.policy.attendanceUse, 'advisory_exception_signal_only');

  const requested = await request(baseUrl, `/api/ledger/workers/${tokens.field_worker.workerId}/timesheets`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ periodStart })
  });
  assert.equal(requested.response.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.timesheet.status, 'pending_approval');
  assert.equal(requested.body.approval.targetType, 'weekly_timesheet');
  const officeDeniedApproval = await request(baseUrl, `/api/ledger/approvals/${requested.body.approval.id}/resolve`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Office cannot self-approve.' })
  });
  assert.equal(officeDeniedApproval.response.status, 403);
  const approved = await request(baseUrl, `/api/ledger/approvals/${requested.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Submitted hours and job allocation were verified.' })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));

  const prepared = await request(baseUrl, '/api/ledger/timesheet-exports', tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ periodStart })
  });
  assert.equal(prepared.response.status, 201, JSON.stringify(prepared.body));
  assert.equal(prepared.body.export.integrityValid, true);
  assert.equal(prepared.body.externalDeliveryInitiated, false);
  const content = await request(baseUrl, prepared.body.export.downloadPath, tokens.owner);
  assert.equal(content.response.status, 200);
  assert.match(content.response.headers.get('content-type'), /text\/csv/);
  assert.equal(content.response.headers.get('x-contractor-ai-sha256'), prepared.body.export.csvChecksum);
  assert.match(content.text, /API Timesheet Worker/);
  assert.match(content.text, /"8.00"/);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200, JSON.stringify(capabilities.body));
  assert.equal(capabilities.body.capabilities.timesheetControl.sourceCurrentApprovalRequired, true);
  assert.equal(capabilities.body.capabilities.timesheetControl.completeSubmittedWorkerCoverageRequired, true);
  assert.equal(capabilities.body.capabilities.timesheetControl.tamperedHandoffReplayBlocked, true);
  assert.equal(capabilities.body.capabilities.timesheetControl.payrollExecuted, false);
});
