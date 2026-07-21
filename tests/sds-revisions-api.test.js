const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-sds-api-'));
const tokens = {
  owner: 'sds-owner-token-at-least-32-characters',
  approver: 'sds-approver-token-at-least-32-characters',
  office: 'sds-office-token-at-least-32-characters',
  field: { token: 'sds-field-token-at-least-32-characters', workerId: 'worker-sds-field' }
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
    Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nGoverned SDS ${suffix}\n%%EOF`)
  ], { type: 'application/pdf' }), `manufacturer-sds-${suffix}.pdf`);
  form.append('category', 'sds_pdf');
  form.append('jobId', jobId);
  form.append('riskLevel', 'high');
  form.append('notes', `Manufacturer SDS source ${suffix}.`);
  return request(baseUrl, '/api/ledger/upload', {
    method: 'POST',
    headers: { 'Idempotency-Key': `sds-upload-${suffix}-0001` },
    body: form
  });
}

function revisionPayload(documentId, entryKey, overrides = {}) {
  return {
    entryKey,
    material: 'Low-VOC floor adhesive',
    manufacturer: 'Adhesives Nederland BV',
    productCode: 'LV-ADH-402',
    language: 'nl',
    issuedOn: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    documentId,
    hazardClasses: ['EUH208 - May produce an allergic reaction'],
    requiredPpe: ['Protective gloves', 'Safety glasses'],
    firstAidMeasures: 'Wash exposed skin and obtain medical advice if irritation persists.',
    fireMeasures: 'Use water fog, foam, dry powder, or carbon dioxide.',
    handlingStorage: 'Store sealed in a cool, ventilated place away from direct sunlight.',
    spillResponse: 'Contain with inert absorbent and keep the product out of drains.',
    disposal: 'Use an authorized waste contractor for product and contaminated packaging.',
    emergencyContact: 'Adhesives Nederland emergency line +31 10 555 0142.',
    revisionReason: 'Manufacturer PDF and field controls verified for this product revision.',
    ...overrides
  };
}

test('SDS revision API enforces source upload, approval, role scope, and field-safe current records', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'sds_revision_api_test' });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();

  const intake = await post(baseUrl, '/api/ledger/intake', {
    title: `SDS API project ${suffix}`,
    clientName: `SDS API client ${suffix}`,
    status: 'in_progress',
    riskLevel: 'high',
    assignAutomatically: false
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;

  assert.equal((await post(baseUrl, '/api/ledger/workers', {
    id: tokens.field.workerId,
    name: 'SDS field installer',
    role: 'Installer',
    status: 'available'
  })).response.status, 201);
  assert.equal((await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    workerId: tokens.field.workerId,
    workerName: 'SDS field installer',
    role: 'Installer',
    status: 'assigned'
  })).response.status, 201);

  const uploadedFirst = await uploadPdf(baseUrl, jobId, `r1-${suffix}`);
  assert.equal(uploadedFirst.response.status, 200, JSON.stringify(uploadedFirst.body));
  assert.equal(uploadedFirst.body.ledgerDocument.mimeType, 'application/pdf');
  assert.match(uploadedFirst.body.ledgerDocument.data.analysis.upload.sha256, /^[a-f0-9]{64}$/);
  const firstPayload = revisionPayload(uploadedFirst.body.ledgerDocument.id, `sds-api-r1-${suffix}`);

  const fieldDenied = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/sds-revisions`, firstPayload, tokens.field.token);
  assert.equal(fieldDenied.response.status, 403);
  assert.equal(fieldDenied.body.error.code, 'insufficient_role');

  const createdFirst = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/sds-revisions`, firstPayload);
  assert.equal(createdFirst.response.status, 201, JSON.stringify(createdFirst.body));
  assert.equal(createdFirst.body.sdsSheet.status, 'pending_approval');
  assert.match(createdFirst.body.sdsSheet.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(createdFirst.body.approval.status, 'pending');

  const fieldBeforeApproval = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/sds-sheets`, { token: tokens.field.token });
  assert.equal(fieldBeforeApproval.response.status, 200);
  assert.deepEqual(fieldBeforeApproval.body.sdsSheets, []);

  const approvedFirst = await post(baseUrl, `/api/ledger/approvals/${encodeURIComponent(createdFirst.body.approval.id)}/resolve`, {
    status: 'approved',
    resolvedBy: 'API SDS approver',
    reason: 'Manufacturer source, product identity, dates, hazards, PPE, and emergency controls verified.'
  }, tokens.approver);
  assert.equal(approvedFirst.response.status, 200, JSON.stringify(approvedFirst.body));

  const fieldCurrent = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/sds-sheets`, { token: tokens.field.token });
  assert.equal(fieldCurrent.response.status, 200, JSON.stringify(fieldCurrent.body));
  assert.equal(fieldCurrent.body.sdsSheets.length, 1);
  assert.equal(fieldCurrent.body.sdsSheets[0].id, createdFirst.body.sdsSheet.id);
  assert.equal(fieldCurrent.body.sdsSheets[0].current, true);
  assert.equal(fieldCurrent.body.sdsSheets[0].sourceHash, undefined);
  assert.equal(fieldCurrent.body.sdsSheets[0].snapshotHash, undefined);
  assert.equal(fieldCurrent.body.sdsSheets[0].snapshot, undefined);
  assert.equal(fieldCurrent.body.sdsSheets[0].entryKey, undefined);
  assert.equal(fieldCurrent.body.sdsSheets[0].entryFingerprint, undefined);
  assert.equal(fieldCurrent.body.sdsSheets[0].data, undefined);

  const uploadedSecond = await uploadPdf(baseUrl, jobId, `r2-${suffix}`);
  assert.equal(uploadedSecond.response.status, 200, JSON.stringify(uploadedSecond.body));
  const secondPayload = revisionPayload(uploadedSecond.body.ledgerDocument.id, `sds-api-r2-${suffix}`, {
    supersedesSdsId: createdFirst.body.sdsSheet.id,
    revisionReason: 'Manufacturer replaced the source PDF with updated fire-response controls.',
    fireMeasures: 'Use alcohol-resistant foam or dry powder and cool adjacent containers with water fog.'
  });
  const createdSecond = await post(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/sds-revisions`, secondPayload);
  assert.equal(createdSecond.response.status, 201, JSON.stringify(createdSecond.body));
  assert.equal(createdSecond.body.sdsSheet.revisionNumber, 2);

  const fieldDuringReview = await request(baseUrl, '/api/ledger/sds-sheets?limit=100', { token: tokens.field.token });
  assert.equal(fieldDuringReview.response.status, 200);
  assert.equal(fieldDuringReview.body.sdsSheets.length, 1);
  assert.equal(fieldDuringReview.body.sdsSheets[0].id, createdFirst.body.sdsSheet.id);

  assert.equal((await post(baseUrl, `/api/ledger/approvals/${encodeURIComponent(createdSecond.body.approval.id)}/resolve`, {
    status: 'approved',
    resolvedBy: 'API SDS approver',
    reason: 'Replacement PDF and changed fire-response controls verified.'
  }, tokens.approver)).response.status, 200);

  const fieldAfterApproval = await request(baseUrl, '/api/ledger/sds-sheets?limit=100', { token: tokens.field.token });
  assert.equal(fieldAfterApproval.response.status, 200, JSON.stringify(fieldAfterApproval.body));
  assert.equal(fieldAfterApproval.body.sdsSheets.length, 1);
  assert.equal(fieldAfterApproval.body.sdsSheets[0].id, createdSecond.body.sdsSheet.id);
  assert.equal(fieldAfterApproval.body.sdsSheets[0].revisionNumber, 2);

  const officeHistory = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/sds-sheets`, { token: tokens.office });
  assert.equal(officeHistory.response.status, 200);
  assert.equal(officeHistory.body.sdsSheets.length, 2);
  assert.deepEqual(new Set(officeHistory.body.sdsSheets.map(sheet => sheet.status)), new Set(['current', 'superseded']));

  const capabilities = await request(baseUrl, '/api/operations/capabilities', { token: tokens.owner });
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.body.capabilities.requestSafety.sdsRevisionEntryKey, 'durable');
  assert.equal(capabilities.body.capabilities.requestSafety.sdsRevisionSourceIntegrity, 'product_document_snapshot_sha256');
  assert.equal(capabilities.body.capabilities.requestSafety.sdsRevisionApproval, 'source_current_approval_gated');
  assert.equal(capabilities.body.capabilities.requestSafety.sdsRevisionSupersession, 'atomic_single_current_product');
  assert.equal(capabilities.body.capabilities.requestSafety.sdsRevisionAutonomy, 'internal_review_task_only');
  assert.equal(capabilities.body.capabilities.requestSafety.sdsCurrentStatusInference, false);

  const diagnostics = await request(baseUrl, '/api/ledger/debug', { token: tokens.owner });
  assert.equal(diagnostics.response.status, 200);
  assert.equal(diagnostics.body.diagnostics.valid, true, JSON.stringify(diagnostics.body.diagnostics.issues));
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '057_governed_risk_register');
});
