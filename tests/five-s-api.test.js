const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-five-s-api-'));
const tokens = {
  owner: 'five-s-owner-token-at-least-32-characters',
  approver: 'five-s-approver-token-at-least-32-characters',
  office: 'five-s-office-token-at-least-32-characters',
  field: { token: 'five-s-field-token-at-least-32-characters', workerId: 'worker-five-s-field' }
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
  const body = await response.json();
  return { response, body };
}

function standardItems(toolId) {
  return [
    { id: 'sort', stage: 'sort', title: 'Remove unneeded stock', requirement: 'Only planned task stock remains in this location.' },
    { id: 'set', stage: 'set_in_order', itemType: 'tool', toolId, title: 'Return the saw to its marked home', requirement: 'Saw is available, inspection-ready, and in its marked position.' },
    { id: 'shine', stage: 'shine', title: 'Clean the work storage', requirement: 'Storage and equipment are clean enough to expose damage.' },
    { id: 'standardize', stage: 'standardize', title: 'Keep labels current', requirement: 'Labels and position markings match the retained standard.' },
    { id: 'sustain', stage: 'sustain', title: 'Retain the routine', requirement: 'The current standard and audit cadence are visible to the crew.' }
  ];
}

test('5S API scopes field access, forces field identity, and exports governed records', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'five_s_api_test' });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: `5S API job ${suffix}`,
      clientName: `5S API client ${suffix}`,
      status: 'scheduled',
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  assert.equal((await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ id: tokens.field.workerId, name: 'Field 5S lead', role: 'Site lead', status: 'available' })
  })).response.status, 201);
  assert.equal((await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: tokens.field.workerId, role: 'Site lead', status: 'assigned' })
  })).response.status, 201);

  const locationName = `API service van ${suffix}`;
  const tool = await request(baseUrl, '/api/ledger/tools', {
    method: 'POST',
    body: JSON.stringify({ name: `API track saw ${suffix}`, category: 'cutting', status: 'available', currentLocation: locationName })
  });
  assert.equal(tool.response.status, 201);
  const location = await request(baseUrl, '/api/ledger/five-s/locations', {
    method: 'POST',
    body: JSON.stringify({
      jobId,
      name: locationName,
      locationType: 'vehicle',
      identifier: `VAN-${suffix}`,
      owner: 'Field 5S lead',
      auditFrequencyDays: 7,
      entryKey: `five-s-api-location-${suffix}`
    })
  });
  assert.equal(location.response.status, 201, JSON.stringify(location.body));
  const standard = await request(baseUrl, `/api/ledger/five-s/locations/${encodeURIComponent(location.body.location.id)}/standards`, {
    method: 'POST',
    body: JSON.stringify({ items: standardItems(tool.body.tool.id), entryKey: `five-s-api-standard-${suffix}` })
  });
  assert.equal(standard.response.status, 201, JSON.stringify(standard.body));
  const approved = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(standard.body.approval.id)}/resolve`, {
    token: tokens.approver,
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: '5S approver', reason: 'All stages and linked equipment checked.' })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));

  const missingScope = await request(baseUrl, '/api/ledger/five-s', { token: tokens.field.token });
  assert.equal(missingScope.response.status, 400);
  const fieldBoard = await request(baseUrl, `/api/ledger/five-s?jobId=${encodeURIComponent(jobId)}`, { token: tokens.field.token });
  assert.equal(fieldBoard.response.status, 200);
  assert.equal(fieldBoard.body.board.rows.length, 1);
  assert.equal(fieldBoard.body.board.rows[0].currentStandard.snapshotHash, undefined);
  const deniedLocation = await request(baseUrl, '/api/ledger/five-s/locations', {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify({
      jobId,
      name: 'Unauthorized vehicle',
      locationType: 'vehicle',
      owner: 'Field 5S lead',
      auditFrequencyDays: 7,
      entryKey: `five-s-api-denied-${suffix}`
    })
  });
  assert.equal(deniedLocation.response.status, 403);

  const auditPayload = {
    standardId: standard.body.standard.id,
    auditDate: new Date().toISOString().slice(0, 10),
    auditedBy: 'Spoofed office identity',
    evidenceReferences: [`photo-set:${suffix}`],
    entryKey: `five-s-api-audit-${suffix}`,
    results: standard.body.standard.items.map(item => ({ itemId: item.id, result: 'pass', note: 'Checked in the field.' }))
  };
  const audit = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/five-s/locations/${encodeURIComponent(location.body.location.id)}/audits`,
    { token: tokens.field.token, method: 'POST', body: JSON.stringify(auditPayload) }
  );
  assert.equal(audit.response.status, 201, JSON.stringify(audit.body));
  assert.equal(audit.body.audit.auditedBy, 'Field 5S lead');
  assert.equal(audit.body.audit.entryKey, undefined);
  assert.equal(audit.body.board.ready, true);
  const replay = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/five-s/locations/${encodeURIComponent(location.body.location.id)}/audits`,
    { token: tokens.field.token, method: 'POST', body: JSON.stringify(auditPayload) }
  );
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.replayed, true);

  const otherJob = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({ title: `Unassigned 5S job ${suffix}`, clientName: `Other client ${suffix}`, assignAutomatically: false })
  });
  assert.equal(otherJob.response.status, 201);
  const forbidden = await request(baseUrl, `/api/ledger/five-s?jobId=${encodeURIComponent(otherJob.body.job.id)}`, { token: tokens.field.token });
  assert.equal(forbidden.response.status, 403);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', { token: tokens.owner });
  assert.equal(capabilities.body.capabilities.fiveSOrganization.standardApproval, 'immutable_source_current_snapshot');
  assert.equal(capabilities.body.capabilities.requestSafety.fiveSVehicleDispatch, false);
  const operationalExport = await request(baseUrl, '/api/operations/export', { token: tokens.owner });
  assert.equal(operationalExport.body.fiveSLocations.length, 1);
  assert.equal(operationalExport.body.fiveSStandards.length, 1);
  assert.equal(operationalExport.body.fiveSAudits.length, 1);
  const diagnostics = await request(baseUrl, '/api/ledger/debug', { token: tokens.owner });
  assert.equal(diagnostics.body.diagnostics.valid, true, JSON.stringify(diagnostics.body.diagnostics.issues));
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '071_data_subject_request_governance');
  assert.equal(diagnostics.body.diagnostics.counts.fiveSAudits, 1);
});
