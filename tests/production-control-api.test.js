const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-production-api-'));
const tokens = {
  owner: 'production-owner-token-at-least-32-characters',
  approver: 'production-approver-token-at-least-32-characters',
  office_operator: 'production-office-token-at-least-32-characters',
  field_worker: {
    token: 'production-field-token-at-least-32-characters',
    workerId: 'worker-production-field'
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

test('production API enforces office baselines, scoped field capture, replay, and approved reversals', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'production_control_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const worker = await request(baseUrl, '/api/ledger/workers', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ id: tokens.field_worker.workerId, name: 'Production field worker', role: 'Installer', status: 'available', hourlyRate: 62 })
  });
  assert.equal(worker.response.status, 201, JSON.stringify(worker.body));
  const intake = await request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      title: 'API measured production',
      client: { name: 'API Production Client' },
      status: 'in_progress',
      workerId: tokens.field_worker.workerId,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;
  const assignment = await request(baseUrl, `/api/ledger/jobs/${jobId}/assignments`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ workerId: tokens.field_worker.workerId, role: 'Installer', status: 'assigned' })
  });
  assert.equal(assignment.response.status, 201, JSON.stringify(assignment.body));

  const deniedBaseline = await request(baseUrl, `/api/ledger/jobs/${jobId}/production-baselines`, tokens.field_worker.token, {
    method: 'POST', body: JSON.stringify({ lines: [] })
  });
  assert.equal(deniedBaseline.response.status, 403);
  const prepared = await request(baseUrl, `/api/ledger/jobs/${jobId}/production-baselines`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      lines: [{ lineKey: 'installed-area', costCode: 'LAB-AREA', description: 'Installed finish area', unit: 'm2', plannedQuantity: 80, plannedLaborHours: 64 }]
    })
  });
  assert.equal(prepared.response.status, 201, JSON.stringify(prepared.body));
  assert.equal(prepared.body.baseline.status, 'pending_approval');
  assert.equal(prepared.body.approval.targetType, 'production_baseline');

  const approved = await request(baseUrl, `/api/ledger/approvals/${prepared.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Production quantity and labor plan checked.' })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));

  const fieldRead = await request(baseUrl, `/api/ledger/jobs/${jobId}/production`, tokens.field_worker.token);
  assert.equal(fieldRead.response.status, 200, JSON.stringify(fieldRead.body));
  assert.equal(fieldRead.body.production.activeBaseline.id, prepared.body.baseline.id);
  assert.equal(fieldRead.body.production.activeBaseline.approvalId, undefined);
  assert.equal(fieldRead.body.production.activeBaseline.data, undefined);
  assert.equal(fieldRead.body.production.activeBaseline.snapshotHash, undefined);
  assert.equal(fieldRead.body.production.sourceHash, undefined);

  const payload = {
    entryKey: 'production-api-field-0001',
    baselineId: prepared.body.baseline.id,
    lineKey: 'installed-area',
    workDate: '2026-07-16',
    quantity: 16,
    crewHours: 24,
    note: 'Scoped crew measured and retained the first installed area.',
    actor: 'spoofed-owner'
  };
  const recorded = await request(baseUrl, `/api/ledger/jobs/${jobId}/production-entries`, tokens.field_worker.token, {
    method: 'POST', body: JSON.stringify(payload)
  });
  assert.equal(recorded.response.status, 201, JSON.stringify(recorded.body));
  assert.equal(recorded.body.entry.replayed, false);
  assert.equal(recorded.body.entry.workerId, tokens.field_worker.workerId);
  assert.equal(recorded.body.entry.data, undefined);
  assert.equal(recorded.body.entry.entryKey, undefined);
  assert.equal(recorded.body.entry.entryFingerprint, undefined);
  assert.equal(recorded.body.production.summary.performanceFactor, 0.5333);
  const replay = await request(baseUrl, `/api/ledger/jobs/${jobId}/production-entries`, tokens.field_worker.token, {
    method: 'POST', body: JSON.stringify(payload)
  });
  assert.equal(replay.response.status, 201, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.entry.id, recorded.body.entry.id);
  const conflict = await request(baseUrl, `/api/ledger/jobs/${jobId}/production-entries`, tokens.field_worker.token, {
    method: 'POST', body: JSON.stringify({ ...payload, quantity: 20 })
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, 'production_entry_key_reused');

  const deniedReversal = await request(baseUrl, `/api/ledger/jobs/${jobId}/production-entries/${recorded.body.entry.id}/reversal`, tokens.field_worker.token, {
    method: 'POST', body: JSON.stringify({ reason: 'Field role cannot reverse retained production.' })
  });
  assert.equal(deniedReversal.response.status, 403);
  const reversal = await request(baseUrl, `/api/ledger/jobs/${jobId}/production-entries/${recorded.body.entry.id}/reversal`, tokens.office_operator, {
    method: 'POST', body: JSON.stringify({ reason: 'The installed quantity was assigned to the wrong cost code.' })
  });
  assert.equal(reversal.response.status, 201, JSON.stringify(reversal.body));
  assert.equal(reversal.body.entry.status, 'pending_reversal');
  const resolved = await request(baseUrl, `/api/ledger/approvals/${reversal.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST', body: JSON.stringify({ status: 'approved', reason: 'Wrong cost-code allocation verified.' })
  });
  assert.equal(resolved.response.status, 200, JSON.stringify(resolved.body));

  const ownerDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`, tokens.owner);
  assert.equal(ownerDetail.response.status, 200, JSON.stringify(ownerDetail.body));
  assert.equal(ownerDetail.body.job.productionEntries[0].status, 'reversed');
  assert.equal(ownerDetail.body.job.productionControl.summary.crewHours, 0);
  assert.ok(ownerDetail.body.job.audit.some(event => event.action === 'record_production_output' && event.actor === 'role:field_worker'));

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200, JSON.stringify(capabilities.body));
  assert.equal(capabilities.body.capabilities.productionControl.earnedHoursCalculation, true);
  assert.equal(capabilities.body.capabilities.productionControl.reversalMode, 'approval_gated_compensating_record');
  assert.equal(capabilities.body.capabilities.requestSafety.productionEntryKey, 'durable');
});
