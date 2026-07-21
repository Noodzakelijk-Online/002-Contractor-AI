const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-environmental-api-'));
const tokens = {
  owner: 'environmental-owner-token-at-least-32-characters',
  approver: 'environmental-approver-token-at-least-32-characters',
  office: 'environmental-office-token-at-least-32-characters',
  field: { token: 'environmental-field-token-at-least-32-characters', workerId: 'worker-environmental-field' }
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify({ owner: tokens.owner, approver: tokens.approver, office_operator: tokens.office, field_worker: tokens.field }),
  STATE_FILE: path.join(stateDirectory, 'state.json'),
  LEDGER_DB_FILE: path.join(stateDirectory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(stateDirectory, 'uploads')
});
const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const { token = tokens.office, ...requestOptions } = options;
  const response = await fetch(`${baseUrl}${route}`, {
    ...requestOptions,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, body };
}

test('environmental API enforces field scope, approval, report integrity, and office-only correction', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'environmental_api_test' });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: `Environmental API ${suffix}`,
      clientName: `Environmental client ${suffix}`,
      status: 'scheduled',
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  assert.equal((await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ id: tokens.field.workerId, name: 'Field environmental worker', role: 'Site operative', status: 'available' })
  })).response.status, 201);
  assert.equal((await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: tokens.field.workerId, workerName: 'Field environmental worker', role: 'Site operative', status: 'assigned' })
  })).response.status, 201);

  const payload = {
    entryKey: `environmental-api-${suffix}`,
    activityDate: new Date().toISOString().slice(0, 10),
    workerId: 'spoofed-worker',
    workerName: 'Spoofed worker',
    category: 'transport',
    ghgScope: 'scope_3',
    description: 'Supplier delivery mileage',
    quantity: 80,
    unit: 'km',
    emissionFactor: 0.2,
    factorSource: 'Retained company factor library',
    factorReference: `factor-library:delivery-van:${suffix}`,
    evidenceReference: `delivery-route:${suffix}`,
    notes: 'Distance and vehicle class retained from the delivery evidence.'
  };
  const created = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/environmental-activities`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.activity.workerId, tokens.field.workerId);
  assert.equal(created.body.activity.workerName, 'Field environmental worker');
  assert.equal(created.body.activity.emissionsKgCo2e, 16);
  assert.equal(created.body.activity.status, 'pending_approval');
  assert.equal(created.body.activity.entryKey, undefined);
  assert.equal(created.body.activity.entryFingerprint, undefined);
  assert.equal(created.body.approval, null);
  assert.equal(created.body.certificationClaimed, false);

  const replay = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/environmental-activities`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.activity.id, created.body.activity.id);

  const fieldList = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/environmental-activities`, { token: tokens.field.token });
  assert.equal(fieldList.response.status, 200);
  assert.equal(fieldList.body.activities.length, 1);
  assert.equal(fieldList.body.activities[0].sourceFingerprint, undefined);
  assert.equal(fieldList.body.reports.length, 0);
  const officeList = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/environmental-activities`);
  assert.equal(officeList.response.status, 200);
  assert.equal(officeList.body.activities[0].integrityValid, true);
  assert.ok(officeList.body.activities[0].approvalId);
  assert.equal(officeList.body.register.readyForReport, false);

  const approved = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(officeList.body.activities[0].approvalId)}/resolve`, {
    token: tokens.approver,
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'API environmental approver', reason: 'Delivery source, distance, scope, and factor provenance verified.' })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));

  const reportRequest = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/environmental-reports`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(reportRequest.response.status, 201, JSON.stringify(reportRequest.body));
  assert.equal(reportRequest.body.report.status, 'pending_approval');
  assert.equal(reportRequest.body.report.summary.totalKgCo2e, 16);
  const blockedDownload = await request(baseUrl, reportRequest.body.report.downloadPath);
  assert.equal(blockedDownload.response.status, 409);

  const reportApproved = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(reportRequest.body.approval.id)}/resolve`, {
    token: tokens.approver,
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'API environmental approver', reason: 'Report source and checksums verified.' })
  });
  assert.equal(reportApproved.response.status, 200, JSON.stringify(reportApproved.body));
  const download = await request(baseUrl, reportRequest.body.report.downloadPath);
  assert.equal(download.response.status, 200);
  assert.match(download.response.headers.get('content-type'), /text\/csv/);
  assert.equal(download.response.headers.get('x-contractor-ai-sha256'), reportRequest.body.report.csvChecksum);
  assert.match(download.body, /Supplier delivery mileage/);

  const fieldReversal = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/environmental-activities/${encodeURIComponent(created.body.activity.id)}/reversal`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify({ reason: 'Field workers must not reverse approved environmental evidence.' })
  });
  assert.equal(fieldReversal.response.status, 403);
  const reversal = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/environmental-activities/${encodeURIComponent(created.body.activity.id)}/reversal`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Corrected retained source confirms the delivery belongs to another job.' })
  });
  assert.equal(reversal.response.status, 201, JSON.stringify(reversal.body));
  assert.equal(reversal.body.activity.status, 'pending_reversal');

  const capabilities = await request(baseUrl, '/api/operations/capabilities', { token: tokens.owner });
  assert.equal(capabilities.body.capabilities.requestSafety.environmentalActivityEntryKey, 'durable');
  assert.equal(capabilities.body.capabilities.requestSafety.environmentalReportIntegrity, 'source_hash_snapshot_hash_csv_sha256');
  assert.equal(capabilities.body.capabilities.requestSafety.environmentalCertificationClaimed, false);
  const diagnostics = await request(baseUrl, '/api/ledger/debug', { token: tokens.owner });
  assert.equal(diagnostics.body.diagnostics.valid, true);
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '056_commercial_scope_revisions');
});
