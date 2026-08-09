const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-energy-performance-api-'));
const tokens = {
  owner: 'energy-owner-token-at-least-32-characters',
  approver: 'energy-approver-token-at-least-32-characters',
  office: 'energy-office-token-at-least-32-characters',
  field: { token: 'energy-field-token-at-least-32-characters', jobIds: ['none'] }
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
  STATE_FILE: path.join(directory, 'state.json'),
  LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(directory, 'uploads')
});

const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const { token = tokens.office, headers = {}, ...requestOptions } = options;
  const response = await fetch(`${baseUrl}${route}`, {
    ...requestOptions,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }
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

async function uploadPdf(baseUrl, jobId, marker) {
  const form = new FormData();
  form.append('evidenceFile', new Blob([
    Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nEnergy assessment ${marker}\n%%EOF`)
  ], { type: 'application/pdf' }), `energy-assessment-${marker}.pdf`);
  form.append('category', 'energy_performance_assessment');
  form.append('jobId', jobId);
  form.append('riskLevel', 'high');
  form.append('notes', 'Adviser-issued NTA 8800 assessment.');
  return request(baseUrl, '/api/ledger/upload', {
    method: 'POST',
    headers: { 'Idempotency-Key': `energy-upload-${marker}` },
    body: form
  });
}

function energyPayload(documentId, marker) {
  return {
    entryKey: `energy-api-${marker}`,
    phase: 'permit_application',
    buildingUse: 'residential',
    buildingScope: 'building',
    objectReference: `BAG-PAND-${marker}`,
    assessmentDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    assessorName: 'API qualified EP adviser',
    assessorCredential: 'EP-W/D-API-001',
    certifiedCompany: 'API Certified Energy BV',
    ntaVersion: 'NTA 8800:2026',
    softwareName: 'Attested EP software',
    softwareVersion: '2026.1',
    epOnlineRegistration: `EP-ONLINE-${marker}`,
    beng1Value: 40,
    beng1Limit: 55,
    beng2Value: 25,
    beng2Limit: 30,
    beng3Value: 65,
    beng3Minimum: 50,
    tojuliApplicable: false,
    tojuliNotApplicableReason: 'The retained adviser report states that TOjuli does not apply.',
    evidenceReference: `energy-report-${marker}`,
    evidenceDocumentId: documentId
  };
}

test('energy-performance API enforces office capture, approver review, export, and no-certification boundaries', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'energy_performance_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const marker = Date.now();

  const intake = await post(baseUrl, '/api/ledger/intake', {
    title: `Energy performance API ${marker}`,
    client: { name: `Energy client ${marker}` },
    service: 'new_build',
    status: 'in_progress',
    assignAutomatically: false
  }, tokens.owner);
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;

  const upload = await uploadPdf(baseUrl, jobId, marker);
  assert.equal(upload.response.status, 200, JSON.stringify(upload.body));
  const payload = energyPayload(upload.body.ledgerDocument.id, marker);
  const fieldDenied = await post(baseUrl, `/api/ledger/jobs/${jobId}/energy-performance`, payload, tokens.field.token);
  assert.equal(fieldDenied.response.status, 403);
  assert.equal(fieldDenied.body.error.code, 'insufficient_role');

  const retained = await post(baseUrl, `/api/ledger/jobs/${jobId}/energy-performance`, payload);
  assert.equal(retained.response.status, 201, JSON.stringify(retained.body));
  assert.equal(retained.body.record.status, 'pending_approval');
  assert.equal(retained.body.record.integrityValid, true);
  assert.equal(retained.body.calculationEngine, false);
  assert.equal(retained.body.certificationClaimed, false);
  assert.equal(retained.body.externalRegistration, false);
  assert.equal(retained.body.externalCommitments, 0);

  const officeRegister = await request(baseUrl, `/api/ledger/jobs/${jobId}/energy-performance`);
  assert.equal(officeRegister.response.status, 200);
  assert.equal(officeRegister.body.energyPerformance.records.length, 1);
  const fieldReadDenied = await request(baseUrl, `/api/ledger/jobs/${jobId}/energy-performance`, { token: tokens.field.token });
  assert.equal(fieldReadDenied.response.status, 403);

  const approved = await post(baseUrl, `/api/ledger/approvals/${retained.body.approval.id}/resolve`, {
    status: 'approved',
    resolvedBy: 'API energy approver',
    reason: 'Adviser, method, registration, declared thresholds, and retained PDF verified.'
  }, tokens.approver);
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  const verified = await request(baseUrl, `/api/ledger/jobs/${jobId}/energy-performance`, { token: tokens.approver });
  assert.equal(verified.body.energyPerformance.current[0].status, 'verified_compliant');
  assert.equal(verified.body.energyPerformance.ready, true);

  const exported = await request(baseUrl, '/api/operations/export', { token: tokens.owner });
  assert.equal(exported.response.status, 200);
  assert.equal(exported.body.energyPerformanceRecords.length, 1);
  const validation = await post(baseUrl, '/api/operations/exports/validate', { snapshot: exported.body }, tokens.owner);
  assert.equal(validation.response.status, 200, JSON.stringify(validation.body));
  assert.equal(validation.body.counts.energyPerformanceRecords, 1);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', { token: tokens.owner });
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.body.capabilities.requestSafety.energyPerformanceEntryKey, 'durable_exact_replay');
  assert.equal(capabilities.body.capabilities.requestSafety.energyPerformanceEvidenceIntegrity, 'retained_pdf_sha256_and_immutable_snapshot');
  assert.equal(capabilities.body.capabilities.requestSafety.energyPerformanceApproval, 'source_current_independent_review');
  assert.equal(capabilities.body.capabilities.requestSafety.energyPerformanceCalculationEngine, false);
  assert.equal(capabilities.body.capabilities.requestSafety.energyPerformanceLegalCertification, false);
  assert.equal(capabilities.body.capabilities.requestSafety.energyPerformanceExternalRegistration, false);

  const diagnostics = await request(baseUrl, '/api/ledger/debug', { token: tokens.owner });
  assert.equal(diagnostics.response.status, 200);
  assert.equal(diagnostics.body.diagnostics.valid, true, JSON.stringify(diagnostics.body.diagnostics.issues));
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '071_data_subject_request_governance');
});
