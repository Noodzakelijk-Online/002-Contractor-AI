const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-drawing-api-'));
const tokens = {
  owner: 'drawing-owner-token-at-least-32-characters',
  approver: 'drawing-approver-token-at-least-32-characters',
  office: 'drawing-office-token-at-least-32-characters',
  field: { token: 'drawing-field-token-at-least-32-characters', workerId: 'worker-drawing-field' }
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify({
    owner: tokens.owner,
    approver: tokens.approver,
    office_operator: tokens.office,
    field_worker: tokens.field
  }),
  STATE_FILE: path.join(stateDirectory, 'state.json'),
  LEDGER_DB_FILE: path.join(stateDirectory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(stateDirectory, 'uploads')
});

const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const { token = tokens.office, headers = {}, ...requestOptions } = options;
  const response = await fetch(`${baseUrl}${route}`, {
    ...requestOptions,
    headers: { Authorization: `Bearer ${token}`, ...headers }
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, body };
}

function post(baseUrl, route, body, token = tokens.office) {
  return request(baseUrl, route, {
    token,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function uploadPdf(baseUrl, jobId, suffix) {
  const form = new FormData();
  form.append('evidenceFile', new Blob([
    Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nGoverned drawing ${suffix}\n%%EOF`)
  ], { type: 'application/pdf' }), `A-201-${suffix}.pdf`);
  form.append('category', 'drawing_pdf');
  form.append('jobId', jobId);
  form.append('riskLevel', 'high');
  form.append('notes', `Drawing source ${suffix}.`);
  return request(baseUrl, '/api/ledger/upload', {
    method: 'POST',
    headers: { 'Idempotency-Key': `drawing-upload-${suffix}-0001` },
    body: form
  });
}

function drawingPayload(sourceDocumentId, entryKey, overrides = {}) {
  return {
    entryKey,
    sheetNumber: 'A-201',
    revision: 'C01',
    title: 'First-floor construction plan',
    discipline: 'architecture',
    purpose: 'for_construction',
    issueDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    scale: '1:50',
    zone: 'First floor',
    sourceDocumentId,
    revisionReason: 'Coordinated construction issue retained for controlled field use.',
    reviewNotes: 'Title block, revision, scale, and drawing purpose checked.',
    ...overrides
  };
}

test('drawing revision API enforces approval and exposes only current field-safe revisions', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'drawing_revision_api_test' });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();

  const intake = await post(baseUrl, '/api/ledger/intake', {
    title: `Drawing API project ${suffix}`,
    clientName: `Drawing API client ${suffix}`,
    status: 'in_progress',
    riskLevel: 'high',
    assignAutomatically: false
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;

  assert.equal((await post(baseUrl, '/api/ledger/workers', {
    id: tokens.field.workerId,
    name: 'Drawing field installer',
    role: 'Installer',
    status: 'available'
  })).response.status, 201);
  assert.equal((await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    workerId: tokens.field.workerId,
    workerName: 'Drawing field installer',
    role: 'Installer',
    status: 'assigned'
  })).response.status, 201);

  const uploaded = await uploadPdf(baseUrl, jobId, `c01-${suffix}`);
  assert.equal(uploaded.response.status, 200, JSON.stringify(uploaded.body));
  const payload = drawingPayload(uploaded.body.ledgerDocument.id, `drawing-api-c01-${suffix}`);

  const fieldDenied = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/drawing-revisions`, payload, tokens.field.token);
  assert.equal(fieldDenied.response.status, 403);
  assert.equal(fieldDenied.body.error.code, 'insufficient_role');

  const created = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/drawing-revisions`, payload);
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.drawing.status, 'pending_approval');
  assert.equal(created.body.drawing.integrityValid, true);
  assert.match(created.body.drawing.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(created.body.approval.approvalType, 'drawing_revision_publication');

  const fieldBefore = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/drawings`, { token: tokens.field.token });
  assert.equal(fieldBefore.response.status, 200);
  assert.deepEqual(fieldBefore.body.drawings, []);

  const approved = await post(baseUrl, `/api/ledger/approvals/${encodeURIComponent(created.body.approval.id)}/resolve`, {
    status: 'approved',
    resolvedBy: 'API drawing approver',
    reason: 'PDF checksum, title block, revision, and issue purpose verified.'
  }, tokens.approver);
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));

  const fieldCurrent = await request(baseUrl, '/api/ledger/drawings?limit=100', { token: tokens.field.token });
  assert.equal(fieldCurrent.response.status, 200, JSON.stringify(fieldCurrent.body));
  assert.equal(fieldCurrent.body.drawings.length, 1);
  assert.equal(fieldCurrent.body.drawings[0].id, created.body.drawing.id);
  assert.equal(fieldCurrent.body.drawings[0].current, true);
  assert.equal(fieldCurrent.body.drawings[0].sourceHash, undefined);
  assert.equal(fieldCurrent.body.drawings[0].snapshotHash, undefined);
  assert.equal(fieldCurrent.body.drawings[0].snapshot, undefined);
  assert.equal(fieldCurrent.body.drawings[0].entryKey, undefined);
  assert.equal(fieldCurrent.body.drawings[0].entryFingerprint, undefined);
  assert.equal(fieldCurrent.body.drawings[0].data, undefined);

  const content = await request(baseUrl, `/api/ledger/documents/${encodeURIComponent(created.body.drawing.id)}/content`, { token: tokens.field.token });
  assert.equal(content.response.status, 200);
  assert.match(content.response.headers.get('content-type') || '', /application\/pdf/);

  const retainedFile = path.resolve(path.join(__dirname, '..'), uploaded.body.ledgerDocument.storageRef);
  const retainedBytes = fs.readFileSync(retainedFile);
  fs.writeFileSync(retainedFile, Buffer.from('%PDF-1.7\nTampered retained drawing\n%%EOF'));
  const tamperedContent = await request(baseUrl, `/api/ledger/documents/${encodeURIComponent(created.body.drawing.id)}/content`, { token: tokens.field.token });
  assert.equal(tamperedContent.response.status, 409);
  assert.equal(tamperedContent.body.error.code, 'evidence_content_integrity_failed');
  fs.writeFileSync(retainedFile, retainedBytes);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', { token: tokens.owner });
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.body.capabilities.requestSafety.drawingRevisionEntryKey, 'durable');
  assert.equal(capabilities.body.capabilities.requestSafety.drawingRevisionSourceIntegrity, 'sheet_document_snapshot_sha256');
  assert.equal(capabilities.body.capabilities.requestSafety.drawingRevisionApproval, 'source_current_approval_gated');
  assert.equal(capabilities.body.capabilities.requestSafety.drawingRevisionDistribution, 'approval_gated_transmittal_with_receipts');
  assert.equal(capabilities.body.capabilities.requestSafety.drawingPublicationInference, false);
  assert.equal(capabilities.body.capabilities.requestSafety.drawingDeliveryInference, false);

  const diagnostics = await request(baseUrl, '/api/ledger/debug', { token: tokens.owner });
  assert.equal(diagnostics.response.status, 200);
  assert.equal(diagnostics.body.diagnostics.valid, true, JSON.stringify(diagnostics.body.diagnostics.issues));
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '069_governed_framework_workspace');
});
