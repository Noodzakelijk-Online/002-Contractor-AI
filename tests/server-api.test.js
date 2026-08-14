const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { riskRegisterPayload } = require('./risk-register-fixture');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-api-'));
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

test('JSON request boundaries reject malformed and oversized bodies without internal errors', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const malformed = await request(baseUrl, '/api/ledger/trade-partners', {
    method: 'POST',
    body: '{'
  });
  assert.equal(malformed.response.status, 400);
  assert.equal(malformed.body.error.code, 'invalid_json');
  assert.ok(malformed.body.error.requestId);

  const oversized = await request(baseUrl, '/api/ledger/trade-partners', {
    method: 'POST',
    body: JSON.stringify({ name: 'Oversized request', padding: 'x'.repeat(2 * 1024 * 1024) })
  });
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.body.error.code, 'request_body_too_large');

  const largeExportValidation = await request(baseUrl, '/api/operations/exports/validate', {
    method: 'POST',
    body: JSON.stringify({ format: 'invalid-export', padding: 'x'.repeat(3 * 1024 * 1024) })
  });
  assert.equal(largeExportValidation.response.status, 422);
  assert.equal(largeExportValidation.body.error.code, 'invalid_operational_export');

  const readiness = await request(baseUrl, '/api/health/ready');
  assert.equal(readiness.response.status, 200);
  assert.equal(readiness.body.status, 'ready');
});

test('legacy job autonomy routes are retired in favor of ledger workflows', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const result = await request(`http://127.0.0.1:${port}`, '/api/jobs/legacy_job_1/execute-ai-plan', {
    method: 'POST',
    body: '{}'
  });

  assert.equal(result.response.status, 410);
  assert.equal(result.body.error.code, 'legacy_resource_route_retired');
  assert.equal(result.body.migration.records, '/api/ledger/jobs/:jobId/*');
});

test('legacy job lifecycle routes are retired with the ledger migration target', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['schedule', 'start', 'complete']) {
    const result = await request(baseUrl, `/api/jobs/legacy_job_1/${route}`, {
      method: 'POST',
      body: '{}'
    });
    assert.equal(result.response.status, 410);
    assert.equal(result.body.error.code, 'legacy_resource_route_retired');
    assert.equal(result.body.migration.intake, '/api/ledger/intake');
  }
});

test('construction compatibility routes are retired in favor of operating-ledger records', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/api/construction', '/api/construction/rfis', '/api/construction/workflows/site-coordination/run']) {
    const result = route === '/api/construction'
      ? await request(baseUrl, route)
      : await request(baseUrl, route, { method: 'POST', body: '{}' });
    assert.equal(result.response.status, 410);
    assert.equal(result.body.error.code, 'legacy_construction_retired');
    assert.equal(result.body.migration.dashboard, '/api/ledger/dashboard');
  }

  const dashboard = await request(baseUrl, '/api/ledger/dashboard');
  assert.equal(dashboard.response.status, 200);
  assert.ok(dashboard.body.dashboard.metrics);

  const retiredDashboard = await request(baseUrl, '/api/dashboard');
  assert.equal(retiredDashboard.response.status, 410);
  assert.equal(retiredDashboard.body.error.code, 'dashboard_facade_retired');
  assert.equal(retiredDashboard.body.migration.dashboard, '/api/ledger/dashboard');
});
test('emergency auto-dispatch is retired in favor of ledger incident and approval workflows', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const emergency = await request(baseUrl, '/api/emergency/activate', {
    method: 'POST',
    body: JSON.stringify({ reason: 'Regression emergency activation' })
  });
  assert.equal(emergency.response.status, 410);
  assert.equal(emergency.body.error.code, 'emergency_autonomy_retired');
  assert.match(emergency.body.error.message, /approval gates/);
});

test('mixed legacy operations cycle is retired in favor of durable ledger automation', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const cycle = await request(baseUrl, '/api/operations/cycle', {
    method: 'POST',
    body: JSON.stringify({ maxActions: 25 })
  });
  assert.equal(cycle.response.status, 410);
  assert.equal(cycle.body.error.code, 'legacy_operations_cycle_retired');
  assert.match(cycle.body.error.message, /ledger\/autonomous-cycle/);
});

test('ledger evidence uploads retain documents and create approval-safe follow-ups', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({ title: 'Evidence review job', client: { name: 'Evidence Client' } })
  });
  assert.equal(intake.response.status, 201);

  const upload = await request(baseUrl, '/api/ledger/upload', {
    method: 'POST',
    body: JSON.stringify({
      filename: 'unsafe-access-photo.jpg',
      fileType: 'image/jpeg',
      category: 'safety',
      jobId: intake.body.job.id,
      riskLevel: 'high',
      notes: 'Blocked stair landing creates unsafe access for the crew.'
    })
  });

  assert.equal(upload.response.status, 200);
  assert.equal(upload.body.success, true);
  assert.equal(upload.body.analysis.category, 'safety');
  assert.equal(upload.body.analysis.riskDetected, true);
  assert.ok(upload.body.ledgerDocument.id);
  assert.equal(upload.body.ledgerDocument.type, 'photo');
  assert.equal(upload.body.ledgerDocument.status, 'needs_review');
  assert.ok(upload.body.ledgerFollowUp.records.safetyCheck.id);
  assert.ok(upload.body.actions.some(action => action.type === 'create_ledger_safety_review'));

  const ledgerDetail = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}`);
  assert.equal(ledgerDetail.response.status, 200);
  assert.ok(ledgerDetail.body.job.documents.some(document => document.id === upload.body.ledgerDocument.id));
  assert.ok(ledgerDetail.body.job.safetyChecks.some(check => check.id === upload.body.ledgerFollowUp.records.safetyCheck.id));

  const missingJob = await request(baseUrl, '/api/ledger/upload', {
    method: 'POST',
    body: JSON.stringify({ filename: 'orphan.jpg', fileType: 'image/jpeg' })
  });
  assert.equal(missingJob.response.status, 400);
  assert.equal(missingJob.body.error.code, 'ledger_job_required');

  const conflictingOwner = await request(baseUrl, '/api/ledger/upload', {
    method: 'POST',
    body: JSON.stringify({
      filename: 'ambiguous.jpg',
      fileType: 'image/jpeg',
      jobId: intake.body.job.id,
      opportunityId: 'opp_conflicting_owner'
    })
  });
  assert.equal(conflictingOwner.response.status, 400);
  assert.equal(conflictingOwner.body.error.code, 'ledger_evidence_owner_invalid');

  const reboundStorage = await request(baseUrl, '/api/ledger/upload', {
    method: 'POST',
    body: JSON.stringify({
      filename: 'rebound.jpg',
      fileType: 'image/jpeg',
      jobId: intake.body.job.id,
      storageRef: 'data/uploads/known-foreign-object.jpg'
    })
  });
  assert.equal(reboundStorage.response.status, 400);
  assert.equal(reboundStorage.body.error.code, 'client_storage_reference_forbidden');
});

test('multipart evidence rejects excessive part cardinality before upload processing', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const boundary = 'contractor-ai-boundary-2026';
  const parts = Array.from({ length: 80 }, (_, index) => (
    `--${boundary}\r\nContent-Disposition: form-data; name="field${index}"\r\n\r\nvalue${index}\r\n`
  )).join('') + `--${boundary}--\r\n`;
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ledger/upload`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: parts
  });
  const body = await response.json();
  assert.equal(response.status, 413);
  assert.equal(body.error.code, 'multipart_parts_exceeded');
});
test('multipart field upload stores local evidence and links ledger document', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({ title: 'Multipart evidence job', client: { name: 'Evidence Client' } })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const evidenceForm = (notes = 'Before photo uploaded from the job site.') => {
    const form = new FormData();
    form.append('evidenceFile', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake image bytes for regression')], { type: 'image/jpeg' }), 'real-site-photo.jpg');
    form.append('category', 'field_photo');
    form.append('jobId', jobId);
    form.append('riskLevel', 'low');
    form.append('notes', notes);
    form.append('attachToBuild', 'true');
    return form;
  };
  const idempotencyKey = 'field-draft-retry-0001';

  const response = await fetch(`${baseUrl}/api/ledger/upload`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: evidenceForm()
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.filename, 'real-site-photo.jpg');
  assert.equal(body.analysis.category, 'field_photo');
  assert.ok(body.uploadedFile.storageRef);
  assert.ok(fs.existsSync(path.resolve(__dirname, '..', body.uploadedFile.storageRef)));
  assert.ok(body.ledgerDocument.id);
  assert.equal(body.ledgerDocument.type, 'photo');
  assert.equal(body.ledgerDocument.filename, 'real-site-photo.jpg');
  assert.equal(body.ledgerDocument.storageRef, body.uploadedFile.storageRef);
  assert.equal(body.migration.legacyBuildAttachmentRetired, true);

  const storedFileCount = fs.readdirSync(process.env.UPLOAD_DIR).length;
  const replayResponse = await fetch(`${baseUrl}/api/ledger/upload`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: evidenceForm()
  });
  const replayBody = await replayResponse.json();
  assert.equal(replayResponse.status, 200);
  assert.equal(replayResponse.headers.get('idempotent-replayed'), 'true');
  assert.equal(replayBody.ledgerDocument.id, body.ledgerDocument.id);
  assert.equal(replayBody.uploadedFile.storageRef, body.uploadedFile.storageRef);
  assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, storedFileCount);

  const conflictResponse = await fetch(`${baseUrl}/api/ledger/upload`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: evidenceForm('Changed evidence must not reuse the completed request identity.')
  });
  const conflictBody = await conflictResponse.json();
  assert.equal(conflictResponse.status, 409);
  assert.equal(conflictBody.error.code, 'idempotency_key_reused');
  assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, storedFileCount);

  const ledgerDetail = await request(baseUrl, `/api/ledger/jobs/${body.ledgerDocument.jobId}`);
  assert.equal(ledgerDetail.response.status, 200);
  assert.ok(ledgerDetail.body.job.documents.some(document => document.id === body.ledgerDocument.id));
  assert.equal(ledgerDetail.body.job.documents.filter(document => document.storageRef === body.uploadedFile.storageRef).length, 1);
  assert.ok(ledgerDetail.body.job.audit.some(event => event.action === 'store_document'));

  const download = await fetch(`${baseUrl}/api/ledger/documents/${body.ledgerDocument.id}/content`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 3).toString('hex'), 'ffd8ff');

  const unsafeForm = new FormData();
  unsafeForm.append('evidenceFile', new Blob([Buffer.from('not a JPEG')], { type: 'image/jpeg' }), 'mismatched-photo.jpg');
  unsafeForm.append('jobId', jobId);
  const unsafeResponse = await fetch(`${baseUrl}/api/ledger/upload`, { method: 'POST', body: unsafeForm });
  const unsafeBody = await unsafeResponse.json();
  assert.equal(unsafeResponse.status, 415);
  assert.equal(unsafeBody.error.code, 'upload_signature_mismatch');

  const filesBeforeUnknownJob = fs.readdirSync(process.env.UPLOAD_DIR).length;
  const unknownJobForm = new FormData();
  unknownJobForm.append('evidenceFile', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('orphan evidence')], { type: 'image/jpeg' }), 'orphan-photo.jpg');
  unknownJobForm.append('jobId', 'job_not_present');
  const unknownJobResponse = await fetch(`${baseUrl}/api/ledger/upload`, { method: 'POST', body: unknownJobForm });
  const unknownJobBody = await unknownJobResponse.json();
  assert.equal(unknownJobResponse.status, 404);
  assert.equal(unknownJobBody.error.code, 'ledger_job_not_found');
  assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, filesBeforeUnknownJob);
});

test('operating ledger persists intake, approvals, audit, and autonomous controls', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const organization = await request(baseUrl, '/api/ledger/organization', {
    method: 'PUT',
    body: JSON.stringify({
      legalName: 'Server API Contractor B.V.',
      registrationNumber: '12345678',
      vatNumber: 'NL123456789B01',
      email: 'server-api@example.test',
      address: 'Ledgerstraat 1',
      postalCode: '1011 AA',
      city: 'Amsterdam',
      country: 'NL',
      iban: 'NL91ABNA0417164300'
    })
  });
  assert.equal(organization.response.status, 200);

  const dashboardBefore = await request(baseUrl, '/api/ledger/dashboard');
  assert.equal(dashboardBefore.response.status, 200);
  const startingJobCount = dashboardBefore.body.dashboard.metrics.jobs;
  assert.ok(Number.isInteger(startingJobCount));
  assert.ok(dashboardBefore.body.dashboard.capabilities.some(capability => capability.key === 'financial-control'));

  const scheduleWorker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Ledger scheduling crew',
      role: 'Renovation specialist',
      status: 'available',
      homeRegion: 'Amsterdam',
      skills: ['kitchen renovation', 'tile work']
    })
  });
  assert.equal(scheduleWorker.response.status, 201);

  const scheduleTool = await request(baseUrl, '/api/ledger/tools', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Tile Saw',
      category: 'power_tools',
      status: 'available',
      homeLocation: 'Amsterdam depot',
      currentLocation: 'Amsterdam depot'
    })
  });
  assert.equal(scheduleTool.response.status, 201);

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Ledger canal kitchen refit',
      service: 'Kitchen renovation',
      client: {
        name: 'Ledger Client BV',
        email: 'client@example.test',
        phone: '+31600000000',
        address: 'Prinsengracht 1, Amsterdam',
        country: 'NL'
      },
      address: 'Prinsengracht 1, Amsterdam',
      city: 'Amsterdam',
      priority: 'high',
      estimatedCost: 3200,
      estimatedHours: 24,
      lineItems: [
        { description: 'Cabinet removal', quantity: 1, unitPrice: 650 },
        { description: 'Install worktop', quantity: 1, unitPrice: 1650 }
      ],
      tools: ['Tile Saw'],
      materials: [{ name: 'Worktop adhesive', quantity: 4, unit: 'tubes', supplier: 'Bouwmaat' }]
    })
  });
  assert.equal(intake.response.status, 201);
  assert.equal(intake.body.success, true);
  const jobId = intake.body.job.id;
  assert.ok(jobId);
  assert.equal(intake.body.job.client.name, 'Ledger Client BV');
  assert.ok(intake.body.job.tasks.length >= 4);
  assert.ok(intake.body.job.quotes[0].approvalId);
  assert.ok(intake.body.job.communications[0].approvalId);
  assert.ok(intake.body.job.audit.some(event => event.action === 'create_intake_job'));

  const tradePartner = await request(baseUrl, '/api/ledger/trade-partners', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Bouwmaat',
      partnerType: 'supplier',
      registrationNumber: '99887766',
      vatNumber: 'NL123456789B01',
      verificationReference: 'Server API registry check',
      verifiedAt: new Date(Date.now() - 86_400_000).toISOString()
    })
  });
  assert.equal(tradePartner.response.status, 201);
  assert.equal(tradePartner.body.partner.compliance.status, 'verified');

  const dashboardAfterIntake = await request(baseUrl, '/api/ledger/dashboard');
  assert.equal(dashboardAfterIntake.response.status, 200);
  assert.equal(dashboardAfterIntake.body.dashboard.metrics.jobs, startingJobCount + 1);

  const capabilityPreview = await request(baseUrl, `/api/ledger/jobs/${jobId}/capability-plan`, {
    method: 'POST',
    body: JSON.stringify({ mode: 'preview', requirementKeys: ['site_visit', 'documents'], actor: 'capability-test' })
  });
  assert.equal(capabilityPreview.response.status, 201);
  assert.equal(capabilityPreview.body.success, true);
  assert.equal(capabilityPreview.body.mode, 'preview');
  assert.equal(capabilityPreview.body.summary.externalCommitments, 0);
  assert.equal(capabilityPreview.body.summary.safeDraftable, 1);
  assert.equal(capabilityPreview.body.summary.manualRequired, 1);
  assert.ok(capabilityPreview.body.actions.some(action =>
    action.requirementKey === 'site_visit'
    && action.safeDraftable === false
    && action.blockedFromAutonomy === true
    && action.payload === null
  ));
  assert.ok(capabilityPreview.body.actions.some(action => action.requirementKey === 'documents' && action.safeDraftable === true));
  assert.ok(capabilityPreview.body.actions.some(action => action.sourceVendors.includes('Procore') || action.sourceVendors.includes('Autodesk')));
  const previewCoverage = capabilityPreview.body.coverage.summary.averageCoverage;

  const capabilityApply = await request(baseUrl, `/api/ledger/jobs/${jobId}/capability-plan`, {
    method: 'POST',
    body: JSON.stringify({ requirementKeys: ['site_visit', 'documents'], actor: 'capability-test' })
  });
  assert.equal(capabilityApply.response.status, 201);
  assert.equal(capabilityApply.body.success, true);
  assert.equal(capabilityApply.body.mode, 'applied');
  assert.equal(capabilityApply.body.summary.externalCommitments, 0);
  assert.equal(capabilityApply.body.created.length, 1);
  assert.ok(capabilityApply.body.created.some(item => item.requirementKey === 'documents' && item.id));
  assert.ok(capabilityApply.body.blocked.some(item => item.requirementKey === 'site_visit' && item.automationPolicy === 'manual_commitment'));
  assert.ok(capabilityApply.body.summary.averageCoverageAfter >= previewCoverage);
  assert.equal(capabilityApply.body.job.siteVisits.length, 0);
  assert.ok(capabilityApply.body.job.documents.length >= 1);
  assert.ok(capabilityApply.body.job.audit.some(event => event.action === 'apply_capability_gap_plan'));

  const contextualDraftJob = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Contextual capability patio painting',
      service: 'Exterior painting',
      description: 'Paint the patio doors, protect the garden path, and confirm colour before opening paint.',
      client: {
        name: 'Context Client',
        email: 'context@example.test',
        phone: '+31600000001',
        address: 'Keizersgracht 10, Amsterdam',
        country: 'NL'
      },
      address: 'Keizersgracht 10, Amsterdam',
      city: 'Amsterdam',
      priority: 'medium',
      estimatedCost: 2400,
      estimatedHours: 18,
      assignAutomatically: false
    })
  });
  assert.equal(contextualDraftJob.response.status, 201);
  const contextualJobId = contextualDraftJob.body.job.id;

  const contextualApply = await request(baseUrl, `/api/ledger/jobs/${contextualJobId}/capability-plan`, {
    method: 'POST',
    body: JSON.stringify({
      requirementKeys: ['change_order', 'selection', 'incident', 'expense', 'instructions'],
      actor: 'contextual-draft-test'
    })
  });
  assert.equal(contextualApply.response.status, 201);
  assert.equal(contextualApply.body.success, true);
  assert.equal(contextualApply.body.summary.externalCommitments, 0);
  assert.equal(contextualApply.body.created.length, 1);
  assert.ok(contextualApply.body.created.some(item => item.requirementKey === 'instructions'));
  assert.deepEqual(
    new Set(contextualApply.body.blocked.map(item => item.requirementKey)),
    new Set(['change_order', 'selection', 'incident', 'expense'])
  );

  const contextualDetail = contextualApply.body.job;
  assert.equal(contextualDetail.changeOrders.length, 0);
  assert.equal(contextualDetail.clientSelections.length, 0);
  assert.equal(contextualDetail.incidents.length, 0);
  assert.equal(contextualDetail.expenses.length, 0);
  const contextualText = contextualDetail.workerInstructions[0]?.body || '';
  assert.match(contextualText, /Keizersgracht 10, Amsterdam/);
  assert.doesNotMatch(contextualText, /placeholder/i);
  assert.match(contextualDetail.workerInstructions[0].body, /Stop and ask Robert/);

  const commandJob = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Today command plan deck repair',
      service: 'Deck repair',
      client: {
        name: 'Command Plan Client',
        email: 'command-plan@example.test',
        phone: '+31600000002',
        address: 'Herengracht 44, Amsterdam',
        country: 'NL'
      },
      address: 'Herengracht 44, Amsterdam',
      city: 'Amsterdam',
      priority: 'high',
      riskLevel: 'medium',
      estimatedCost: 1800,
      estimatedHours: 16
    })
  });
  assert.equal(commandJob.response.status, 201);
  const commandJobId = commandJob.body.job.id;

  const commandPlan = await request(baseUrl, `/api/ledger/command-plan?limit=80&jobId=${encodeURIComponent(commandJobId)}`);
  assert.equal(commandPlan.response.status, 200);
  assert.equal(commandPlan.body.success, true);
  assert.equal(commandPlan.body.summary.externalCommitments, 0);
  assert.deepEqual(commandPlan.body.scope, {
    jobLimit: 12,
    consideredJobs: 1,
    jobIds: [commandJobId]
  });
  const safeCapabilityCommand = commandPlan.body.actions.find(action =>
    action.actionType === 'draft_capability_gap'
    && action.safeDraftable === true
    && action.jobId === commandJobId
  );
  assert.ok(safeCapabilityCommand);
  assert.notEqual(safeCapabilityCommand.requirementKey, 'site_visit');

  const commandApply = await request(baseUrl, '/api/ledger/command-plan', {
    method: 'POST',
    body: JSON.stringify({ actionIds: [safeCapabilityCommand.id], actor: 'command-plan-test', limit: 1 })
  });
  assert.equal(commandApply.response.status, 201);
  assert.equal(commandApply.body.success, true);
  assert.equal(commandApply.body.summary.externalCommitments, 0);
  assert.ok(commandApply.body.commandPlan);
  assert.ok(commandApply.body.commandPlan.scope.consideredJobs <= 12);
  assert.equal(commandApply.body.commandPlan.actions.some(action => action.id === safeCapabilityCommand.id), false);
  assert.ok(commandApply.body.applied.some(item =>
    item.type === 'draft_capability_gap'
    && item.jobId === commandJobId
    && item.created.some(record => record.requirementKey === safeCapabilityCommand.requirementKey && record.id)
  ));

  const commandDetail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(commandJobId)}`);
  assert.equal(commandDetail.response.status, 200);
  assert.equal(commandDetail.body.job.siteVisits.length, 0);
  assert.ok(commandDetail.body.job.audit.some(event => event.action === 'apply_today_command_plan'));
  assert.ok(commandDetail.body.job.audit.some(event => event.action === 'apply_capability_gap_plan'));

  const clients = await request(baseUrl, '/api/ledger/clients?search=Ledger%20Client');
  assert.equal(clients.response.status, 200);
  const ledgerClient = clients.body.clients.find(client => client.name === 'Ledger Client BV');
  assert.ok(ledgerClient);

  const updatedClient = await request(baseUrl, `/api/ledger/clients/${ledgerClient.id}`, {
    method: 'PUT',
    body: JSON.stringify({ preferredLanguage: 'nl', city: 'Amsterdam' })
  });
  assert.equal(updatedClient.response.status, 200);
  assert.equal(updatedClient.body.client.city, 'Amsterdam');

  const progress = await request(baseUrl, `/api/ledger/jobs/${jobId}/progress`, {
    method: 'POST',
    body: JSON.stringify({ status: 'in_progress', progressPercent: 35, note: 'Site survey complete.' })
  });
  assert.equal(progress.response.status, 201);
  assert.equal(progress.body.job.status, 'in_progress');
  assert.equal(progress.body.job.progressPercent, 35);

  const communication = await request(baseUrl, `/api/ledger/jobs/${jobId}/communication`, {
    method: 'POST',
    body: JSON.stringify({
      channel: 'email',
      direction: 'outbound',
      subject: 'Kitchen refit update',
      body: 'Draft external update waiting for approval.'
    })
  });
  assert.equal(communication.response.status, 201);
  assert.equal(communication.body.communication.status, 'draft');
  assert.ok(communication.body.communication.approvalId);

  const timeLog = await request(baseUrl, `/api/ledger/jobs/${jobId}/time-logs`, {
    method: 'POST',
    body: JSON.stringify({
      workerId: scheduleWorker.body.worker.id,
      workerName: scheduleWorker.body.worker.name,
      workDate: '2026-06-28',
      hours: 6.5,
      rate: 72,
      notes: 'Survey and preparation.'
    })
  });
  assert.equal(timeLog.response.status, 201);
  assert.equal(timeLog.body.timeLog.hours, 6.5);

  const timesheet = await request(baseUrl, `/api/ledger/workers/${scheduleWorker.body.worker.id}/timesheets`, {
    method: 'POST',
    body: JSON.stringify({ periodStart: '2026-06-22' })
  });
  assert.equal(timesheet.response.status, 201);
  const timesheetApproval = await request(baseUrl, `/api/ledger/approvals/${timesheet.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Time Test', reason: 'Worker, hours, week, rate, and job allocation checked.' })
  });
  assert.equal(timesheetApproval.response.status, 200);

  const expense = await request(baseUrl, `/api/ledger/jobs/${jobId}/expense-receipts`, {
    method: 'POST',
    body: JSON.stringify({
      entryKey: 'server-api-expense-receipt-0001',
      expenseDate: '2026-06-28',
      category: 'materials',
      totalAmount: 188.25,
      taxAmount: 0,
      taxTreatment: 'exempt',
      paymentMethod: 'company_card',
      vendor: 'Bouwmaat',
      receiptReference: 'SERVER-API-EXPENSE-18825',
      notes: 'Adhesive and fixings.'
    })
  });
  assert.equal(expense.response.status, 201);
  assert.equal(expense.body.expense.amount, 188.25);
  const expenseApproval = await request(baseUrl, `/api/ledger/approvals/${expense.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Expense Test', reason: 'Receipt, amount, tax treatment, and job allocation checked.' })
  });
  assert.equal(expenseApproval.response.status, 200);

  const invoice = await request(baseUrl, `/api/ledger/jobs/${jobId}/invoices`, {
    method: 'POST',
    body: JSON.stringify({
      amount: 2300,
      taxAmount: 483,
      total: 2783,
      dueAt: '2026-08-15T12:00:00.000Z',
      buyerAddress: 'Prinsengracht 1',
      buyerCity: 'Amsterdam',
      buyerCountry: 'NL'
    })
  });
  assert.equal(invoice.response.status, 201);
  assert.ok(invoice.body.invoice.approvalId);

  const scopeRequest = await request(baseUrl, `/api/ledger/jobs/${jobId}/commercial-scope/revisions`, {
    method: 'POST',
    body: JSON.stringify({
      entryKey: 'server-api-commercial-scope-0001',
      title: 'Kitchen refit written scope',
      scopeSummary: 'Deliver the retained kitchen refit within the recorded project boundary.',
      inclusions: ['Remove the retained cabinets and install the worktop package.'],
      assumptions: ['The recorded site access and dimensions remain current.'],
      exclusions: ['Latent hazardous materials and concealed structural repairs are excluded.'],
      clientResponsibilities: ['Provide access before mobilisation.'],
      contractorResponsibilities: ['Retain installation and completion evidence.'],
      allowanceMode: 'none',
      noAllowanceReason: 'The retained kitchen refit scope contains no allowances.',
      reason: 'Establish written scope before approving the commercial quote.'
    })
  });
  assert.equal(scopeRequest.response.status, 201);
  const approvedScope = await request(baseUrl, `/api/ledger/approvals/${scopeRequest.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      resolvedBy: 'Scope Approver',
      reason: 'Written scope, assumptions, exclusions, and allowance position verified.'
    })
  });
  assert.equal(approvedScope.response.status, 200);
  const riskRequest = await request(baseUrl, `/api/ledger/jobs/${jobId}/risk-register/revisions`, {
    method: 'POST',
    body: JSON.stringify(riskRegisterPayload('server-api-risk-register-0001', scopeRequest.body.revision.id))
  });
  assert.equal(riskRequest.response.status, 201);
  const approvedRisk = await request(baseUrl, `/api/ledger/approvals/${riskRequest.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      resolvedBy: 'Risk Approver',
      reason: 'Risk ownership, response controls, and premortem links verified.'
    })
  });
  assert.equal(approvedRisk.response.status, 200);
  const scopedQuote = await request(baseUrl, `/api/ledger/jobs/${jobId}/quote`, {
    method: 'POST',
    body: JSON.stringify({
      commercialScopeRevisionId: scopeRequest.body.revision.id,
      riskRegisterRevisionId: riskRequest.body.revision.id,
      taxRate: 21,
      lineItems: [
        { description: 'Cabinet removal', quantity: 1, unitPrice: 650 },
        { description: 'Install worktop', quantity: 1, unitPrice: 1650 }
      ]
    })
  });
  assert.equal(scopedQuote.response.status, 201);

  const approvals = await request(baseUrl, '/api/ledger/approvals');
  assert.equal(approvals.response.status, 200);
  const quoteApproval = approvals.body.approvals.find(approval => approval.id === scopedQuote.body.quote.approvalId);
  assert.ok(quoteApproval);

  const topLevelApprovals = await request(baseUrl, '/api/ledger/approvals');
  assert.equal(topLevelApprovals.response.status, 200);
  assert.ok(topLevelApprovals.body.approvals.some(approval => approval.id === quoteApproval.id));

  const resolved = await request(baseUrl, `/api/ledger/approvals/${quoteApproval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Test Approver', reason: 'Quote checked.' })
  });
  assert.equal(resolved.response.status, 200);
  assert.equal(resolved.body.approval.status, 'approved');

  const jobDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(jobDetail.response.status, 200);
  assert.equal(jobDetail.body.job.quotes.find(quote => quote.id === quoteApproval.targetId).status, 'approved');
  assert.ok(jobDetail.body.job.invoices.some(item => item.approvalId === invoice.body.invoice.approvalId));
  assert.ok(jobDetail.body.job.audit.some(event => event.action === 'resolve_approved'));

  const weather = await request(baseUrl, '/api/ledger/weather/assess', {
    method: 'POST',
    body: JSON.stringify({ jobId, condition: 'rain_risk', precipitationPercent: 72 })
  });
  assert.equal(weather.response.status, 201);
  assert.equal(weather.body.weather.precipitationPercent, 72);
  assert.equal(weather.body.recommendation.requiresApproval, true);
  assert.equal(weather.body.recommendation.status, 'needs_approval');
  assert.equal(weather.body.recommendation.readiness.weather.status, 'risk');
  assert.ok(weather.body.recommendation.blockers.some(blocker => blocker.type === 'weather_risk'));
  assert.ok(weather.body.nextActions.some(action => action.type === 'request_schedule_approval'));
  assert.ok(weather.body.nextAction?.type);
  assert.ok(weather.body.job.weather.some(item => item.id === weather.body.weather.id));
  assert.ok(weather.body.dispatch.weatherRisks >= 1);

  const schedule = await request(baseUrl, '/api/ledger/schedule/recommend', {
    method: 'POST',
    body: JSON.stringify({ jobId, plannedStart: '2026-07-01T08:00:00.000Z' })
  });
  assert.equal(schedule.response.status, 200);
  assert.equal(schedule.body.recommendation.requiresApproval, true);
  assert.equal(schedule.body.recommendation.status, 'needs_approval');
  assert.equal(schedule.body.recommendation.readiness.weather.status, 'risk');
  assert.ok(schedule.body.recommendation.plannedEnd);
  assert.ok(schedule.body.recommendation.recommendedWorker);
  assert.ok(schedule.body.recommendation.workerCandidates.length >= 1);
  assert.ok(schedule.body.recommendation.missing.includes('route_plan'));
  assert.ok(schedule.body.recommendation.missing.includes('loading_plan'));
  assert.ok(schedule.body.recommendation.missing.includes('procurement_plan'));
  assert.ok(schedule.body.recommendation.missing.includes('site_access'));
  assert.ok(schedule.body.recommendation.missing.includes('safety_pack'));
  assert.equal(schedule.body.recommendation.readiness.procurement.status, 'missing');
  assert.equal(schedule.body.recommendation.readiness.siteAccess.status, 'missing');
  assert.equal(schedule.body.recommendation.readiness.safety.status, 'missing');
  assert.ok(schedule.body.recommendation.readiness.approvals.pending >= 1);
  assert.ok(schedule.body.recommendation.blockers.some(blocker => blocker.type === 'approval_gate'));
  assert.ok(schedule.body.recommendation.nextActions.some(action => action.type === 'review_pending_approvals'));
  assert.ok(schedule.body.recommendation.nextActions.some(action => action.type === 'plan_procurement'));
  assert.ok(schedule.body.recommendation.nextActions.some(action => action.type === 'prepare_site_access'));
  assert.ok(schedule.body.recommendation.nextActions.some(action => action.type === 'prepare_safety_pack'));
  assert.ok(schedule.body.recommendation.nextActions.some(action => action.type === 'request_schedule_approval'));

  const prep = await request(baseUrl, '/api/ledger/schedule/prepare-dispatch', {
    method: 'POST',
    body: JSON.stringify({ jobId, plannedStart: '2026-07-01T08:00:00.000Z' })
  });
  assert.equal(prep.response.status, 201);
  const prepTypes = new Set(prep.body.created.map(item => item.type));
  assert.ok(prepTypes.has('route_plan'));
  assert.ok(prepTypes.has('loading_plan'));
  assert.ok(prepTypes.has('procurement_order'));
  assert.ok(prepTypes.has('worker_instruction'));
  assert.ok(prepTypes.has('safety_meeting'));
  assert.ok(prepTypes.has('jha_record'));
  assert.ok(prepTypes.has('sds_sheet'));
  assert.ok(prepTypes.has('worker_orientation'));
  assert.ok(prepTypes.has('site_access_log'));
  assert.equal(prep.body.approvals.length, 0);
  assert.ok(!prep.body.created.some(item => item.approvalId));
  assert.equal(prep.body.recommendationBefore.readiness.route.status, 'missing');
  assert.equal(prep.body.recommendationAfter.readiness.route.status, 'ready');
  assert.equal(prep.body.recommendationAfter.readiness.loading.status, 'ready');
  assert.equal(prep.body.recommendationAfter.readiness.instructions.status, 'review');
  assert.equal(prep.body.recommendationAfter.readiness.instructions.drafts, 1);
  assert.ok(prep.body.recommendationAfter.nextActions.some(action => action.type === 'review_worker_instruction'));
  assert.equal(prep.body.recommendationAfter.readiness.procurement.status, 'approval');
  assert.equal(prep.body.recommendationAfter.readiness.siteAccess.status, 'blocked');
  assert.equal(prep.body.recommendationAfter.readiness.safety.status, 'review');
  const createdRecord = type => prep.body.created.find(item => item.type === type);
  assert.ok(prep.body.job.routePlans.some(item => item.id === createdRecord('route_plan').id && item.status === 'draft'));
  assert.ok(prep.body.job.loadingPlans.some(item => item.id === createdRecord('loading_plan').id && item.status === 'draft'));
  assert.ok(prep.body.job.procurementOrders.some(item => item.id === createdRecord('procurement_order').id && item.status === 'draft'));
  assert.ok(prep.body.job.workerInstructions.some(item => item.id === createdRecord('worker_instruction').id && item.status === 'draft'));
  assert.ok(prep.body.job.safetyMeetings.some(item => item.id === createdRecord('safety_meeting').id && item.status === 'scheduled'));
  assert.ok(prep.body.job.jhas.some(item => item.id === createdRecord('jha_record').id && item.status === 'draft'));
  assert.ok(prep.body.job.sdsSheets.some(item => item.id === createdRecord('sds_sheet').id && item.status === 'requested'));
  assert.ok(prep.body.job.orientations.some(item => item.id === createdRecord('worker_orientation').id && item.status === 'scheduled'));
  const preparedAccess = prep.body.job.siteAccessLogs.find(item => item.id === createdRecord('site_access_log').id);
  assert.ok(preparedAccess);
  assert.equal(preparedAccess.status, 'blocked');
  assert.equal(preparedAccess.orientationValid, false);
  assert.ok(prep.body.job.audit.some(event => event.action === 'prepare_schedule_dispatch'));

  const prepAgain = await request(baseUrl, '/api/ledger/schedule/prepare-dispatch', {
    method: 'POST',
    body: JSON.stringify({ jobId, plannedStart: '2026-07-01T08:00:00.000Z' })
  });
  assert.equal(prepAgain.response.status, 201);
  assert.equal(prepAgain.body.created.length, 0);
  assert.ok(prepAgain.body.skipped.length >= 1);
  assert.ok(prepAgain.body.skipped.some(item => item.type === 'site_access_log' && item.reason === 'current_assignment_record_exists'));

  const siteVisit = await request(baseUrl, `/api/ledger/jobs/${jobId}/site-visits`, {
    method: 'POST',
    body: JSON.stringify({
      visitType: 'site_survey',
      status: 'confirmed',
      scheduledAt: '2026-06-30T08:00:00.000Z',
      assignee: 'Robert',
      checklist: ['Confirm access', 'Measure work area', 'Take before photos'],
      findings: 'Client wants an added backsplash repair checked before dispatch.'
    })
  });
  assert.equal(siteVisit.response.status, 201);
  assert.equal(siteVisit.body.siteVisit.status, 'pending_approval');
  assert.ok(siteVisit.body.siteVisit.approvalId);

  const siteVisitApproval = await request(baseUrl, `/api/ledger/approvals/${siteVisit.body.siteVisit.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Survey Test', reason: 'Appointment confirmed with client.' })
  });
  assert.equal(siteVisitApproval.response.status, 200);
  assert.equal(siteVisitApproval.body.approval.status, 'approved');

  const changeOrder = await request(baseUrl, `/api/ledger/jobs/${jobId}/change-orders`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Backsplash repair addition',
      status: 'submitted',
      scopeDelta: 'Add backsplash repair discovered during site survey.',
      amount: 480,
      taxRate: 21,
      taxAmount: 100.8,
      total: 580.8,
      scheduleDeltaDays: 1,
      lineItems: [{ description: 'Backsplash repair', quantity: 1, unitPrice: 480 }]
    })
  });
  assert.equal(changeOrder.response.status, 201);
  assert.equal(changeOrder.body.changeOrder.status, 'pending_approval');
  assert.ok(changeOrder.body.changeOrder.approvalId);

  const changeOrderApproval = await request(baseUrl, `/api/ledger/approvals/${changeOrder.body.changeOrder.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Scope Test', reason: 'Client-approved extra scope.' })
  });
  assert.equal(changeOrderApproval.response.status, 200);
  assert.equal(changeOrderApproval.body.approval.status, 'approved');

  const scopeDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(scopeDetail.response.status, 200);
  assert.ok(scopeDetail.body.job.siteVisits.some(item => item.id === siteVisit.body.siteVisit.id && item.status === 'confirmed'));
  assert.ok(scopeDetail.body.job.changeOrders.some(item => item.id === changeOrder.body.changeOrder.id && item.status === 'approved'));

  const fieldReport = await request(baseUrl, `/api/ledger/jobs/${jobId}/field-reports`, {
    method: 'POST',
    body: JSON.stringify({
      reportDate: '2026-06-30',
      status: 'submitted',
      weather: 'Dry and workable',
      manpower: 2,
      workCompleted: 'Measured kitchen, protected hallway, confirmed delivery route.',
      blockers: ['Client decision needed on tile trim'],
      photos: ['before-kitchen.jpg']
    })
  });
  assert.equal(fieldReport.response.status, 201);
  assert.equal(fieldReport.body.fieldReport.status, 'pending_approval');
  assert.ok(fieldReport.body.fieldReport.approvalId);

  const fieldReportApproval = await request(baseUrl, `/api/ledger/approvals/${fieldReport.body.fieldReport.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Field Test', reason: 'Field report checked.' })
  });
  assert.equal(fieldReportApproval.response.status, 200);
  assert.equal(fieldReportApproval.body.approval.status, 'approved');

  const rfi = await request(baseUrl, `/api/ledger/jobs/${jobId}/rfis`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Tile trim decision',
      status: 'closed',
      responsible: 'Robert',
      dueAt: '2026-07-01',
      question: 'Which tile trim finish should be installed?',
      response: 'Use brushed stainless trim approved by client.'
    })
  });
  assert.equal(rfi.response.status, 201);
  assert.equal(rfi.body.rfi.status, 'pending_approval');
  assert.ok(rfi.body.rfi.approvalId);

  const rfiApproval = await request(baseUrl, `/api/ledger/approvals/${rfi.body.rfi.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'RFI Test', reason: 'Decision checked against scope.' })
  });
  assert.equal(rfiApproval.response.status, 200);
  assert.equal(rfiApproval.body.approval.status, 'approved');

  const submittal = await request(baseUrl, `/api/ledger/jobs/${jobId}/submittals`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Regression tile adhesive submittal',
      packageName: '09 30 00',
      status: 'approved',
      responsible: 'Project team',
      reviewer: 'Robert',
      dueAt: '2026-07-01',
      material: 'Tile adhesive',
      specification: 'Use approved waterproof adhesive for kitchen splash zone.',
      attachments: ['adhesive-spec.pdf']
    })
  });
  assert.equal(submittal.response.status, 201);
  assert.equal(submittal.body.submittal.status, 'pending_approval');
  assert.ok(submittal.body.submittal.approvalId);

  const submittalApproval = await request(baseUrl, `/api/ledger/approvals/${submittal.body.submittal.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Submittal Test', reason: 'Material package matches scope.' })
  });
  assert.equal(submittalApproval.response.status, 200);
  assert.equal(submittalApproval.body.approval.status, 'approved');

  const clientSelection = await request(baseUrl, `/api/ledger/jobs/${jobId}/client-selections`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Regression tile trim finish',
      category: 'finish',
      status: 'locked',
      clientName: 'Regression Client',
      value: 1650,
      dueAt: '2026-07-01',
      options: ['brushed stainless', 'black powder coat'],
      selectedOption: 'brushed stainless'
    })
  });
  assert.equal(clientSelection.response.status, 201);
  assert.equal(clientSelection.body.clientSelection.status, 'pending_approval');
  assert.ok(clientSelection.body.clientSelection.approvalId);

  const selectionApproval = await request(baseUrl, `/api/ledger/approvals/${clientSelection.body.clientSelection.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Selection Test', reason: 'Client decision and value checked.' })
  });
  assert.equal(selectionApproval.response.status, 200);
  assert.equal(selectionApproval.body.approval.status, 'approved');

  const permit = await request(baseUrl, `/api/ledger/jobs/${jobId}/permits`, {
    method: 'POST',
    body: JSON.stringify({
      permitType: 'public_space',
      title: 'Temporary hallway access protection',
      status: 'active',
      holder: 'Project team',
      location: 'Prinsengracht 1 shared hallway',
      expiresAt: '2026-07-02',
      notes: 'Protect shared hallway and keep access clear.'
    })
  });
  assert.equal(permit.response.status, 201);
  assert.equal(permit.body.permit.status, 'pending_approval');
  assert.ok(permit.body.permit.approvalId);

  const permitApproval = await request(baseUrl, `/api/ledger/approvals/${permit.body.permit.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Permit Test', reason: 'Permit reliance approved.' })
  });
  assert.equal(permitApproval.response.status, 200);
  assert.equal(permitApproval.body.approval.status, 'approved');

  const inspection = await request(baseUrl, `/api/ledger/jobs/${jobId}/inspections`, {
    method: 'POST',
    body: JSON.stringify({
      inspectionType: 'pre_task_inspection',
      title: 'Regression pre-task inspection',
      status: 'passed',
      result: 'passed',
      inspector: 'Robert',
      checklist: ['Access safe', 'PPE ready'],
      defects: [],
      photos: ['inspection-pass.jpg']
    })
  });
  assert.equal(inspection.response.status, 201);
  assert.equal(inspection.body.inspection.status, 'pending_approval');
  assert.ok(inspection.body.inspection.approvalId);

  const inspectionApproval = await request(baseUrl, `/api/ledger/approvals/${inspection.body.inspection.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Inspection Test', reason: 'Inspection checked.' })
  });
  assert.equal(inspectionApproval.response.status, 200);
  assert.equal(inspectionApproval.body.approval.status, 'approved');

  const observation = await request(baseUrl, `/api/ledger/jobs/${jobId}/observations`, {
    method: 'POST',
    body: JSON.stringify({
      category: 'safety',
      title: 'Regression temporary access observation',
      status: 'open',
      severity: 'high',
      responsible: 'Robert',
      correctiveAction: 'Add temporary ramp and inspect before work continues.',
      photos: ['access-observation.jpg']
    })
  });
  assert.equal(observation.response.status, 201);
  assert.equal(observation.body.observation.status, 'open');
  assert.ok(observation.body.observation.approvalId);

  const observationApproval = await request(baseUrl, `/api/ledger/approvals/${observation.body.observation.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Observation Test', reason: 'Risk reviewed but remains open.' })
  });
  assert.equal(observationApproval.response.status, 200);
  assert.equal(observationApproval.body.approval.status, 'approved');

  const incident = await request(baseUrl, `/api/ledger/jobs/${jobId}/incidents`, {
    method: 'POST',
    body: JSON.stringify({
      incidentType: 'near_miss',
      title: 'Regression near miss',
      status: 'resolved',
      severity: 'high',
      reportedBy: 'Marco',
      description: 'Trip hazard found at shared hallway.',
      immediateAction: 'Stopped work and cleared the pathway.',
      correctiveAction: 'Add access control to dispatch checklist.'
    })
  });
  assert.equal(incident.response.status, 201);
  assert.equal(incident.body.incident.status, 'pending_approval');
  assert.ok(incident.body.incident.approvalId);

  const incidentApproval = await request(baseUrl, `/api/ledger/approvals/${incident.body.incident.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Incident Test', reason: 'Incident resolution verified.' })
  });
  assert.equal(incidentApproval.response.status, 200);
  assert.equal(incidentApproval.body.approval.status, 'approved');

  const safetyMeeting = await request(baseUrl, `/api/ledger/jobs/${jobId}/safety-meetings`, {
    method: 'POST',
    body: JSON.stringify({
      meetingType: 'pre_task_talk',
      title: 'Regression pre-task safety talk',
      status: 'completed',
      facilitator: 'Robert',
      attendees: ['Robert', 'Marco'],
      topics: ['PPE', 'Shared hallway access', 'Stop-work trigger']
    })
  });
  assert.equal(safetyMeeting.response.status, 201);
  assert.equal(safetyMeeting.body.safetyMeeting.status, 'pending_approval');
  assert.ok(safetyMeeting.body.safetyMeeting.approvalId);

  const safetyMeetingApproval = await request(baseUrl, `/api/ledger/approvals/${safetyMeeting.body.safetyMeeting.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Safety Talk Test', reason: 'Attendees and topics verified.' })
  });
  assert.equal(safetyMeetingApproval.response.status, 200);
  assert.equal(safetyMeetingApproval.body.approval.status, 'approved');

  const orientation = await request(baseUrl, `/api/ledger/jobs/${jobId}/orientations`, {
    method: 'POST',
    body: JSON.stringify({
      workerName: 'Marco',
      company: 'NO Crew',
      language: 'nl',
      status: 'completed',
      topics: ['Site rules', 'PPE', 'Emergency route'],
      documents: ['orientation-marco.pdf']
    })
  });
  assert.equal(orientation.response.status, 201);
  assert.equal(orientation.body.orientation.status, 'pending_approval');
  assert.ok(orientation.body.orientation.approvalId);

  const orientationApproval = await request(baseUrl, `/api/ledger/approvals/${orientation.body.orientation.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Orientation Test', reason: 'Orientation evidence verified.' })
  });
  assert.equal(orientationApproval.response.status, 200);
  assert.equal(orientationApproval.body.approval.status, 'approved');

  const jha = await request(baseUrl, `/api/ledger/jobs/${jobId}/jhas`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Regression access JHA',
      status: 'approved',
      riskLevel: 'high',
      assignee: 'Robert',
      hazards: ['Shared hallway', 'Manual handling'],
      controls: ['Protect hallway', 'Two-person lift', 'Stop work on changed conditions']
    })
  });
  assert.equal(jha.response.status, 201);
  assert.equal(jha.body.jha.status, 'pending_approval');
  assert.ok(jha.body.jha.approvalId);

  const jhaApproval = await request(baseUrl, `/api/ledger/approvals/${jha.body.jha.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'JHA Test', reason: 'Controls reviewed.' })
  });
  assert.equal(jhaApproval.response.status, 200);
  assert.equal(jhaApproval.body.approval.status, 'approved');

  const sdsSheet = await request(baseUrl, `/api/ledger/jobs/${jobId}/sds-sheets`, {
    method: 'POST',
    body: JSON.stringify({
      material: 'Regression adhesive',
      supplier: 'Bouwmaat',
      status: 'current',
      expiresAt: '2026-12-31',
      documentRef: 'adhesive-sds.pdf',
      hazardClass: 'irritant'
    })
  });
  assert.equal(sdsSheet.response.status, 201);
  assert.equal(sdsSheet.body.sdsSheet.status, 'pending_approval');
  assert.ok(sdsSheet.body.sdsSheet.approvalId);

  const sdsApproval = await request(baseUrl, `/api/ledger/approvals/${sdsSheet.body.sdsSheet.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'SDS Test', reason: 'SDS expiry and material match checked.' })
  });
  assert.equal(sdsApproval.response.status, 200);
  assert.equal(sdsApproval.body.approval.status, 'approved');

  const siteAccess = await request(baseUrl, `/api/ledger/jobs/${jobId}/site-access`, {
    method: 'POST',
    body: JSON.stringify({
      orientationId: orientation.body.orientation.id,
      workerName: 'Marco',
      company: 'NO Crew',
      status: 'checked_in',
      orientationValid: true,
      accessPoint: 'Shared hallway',
      location: 'Prinsengracht 1'
    })
  });
  assert.equal(siteAccess.response.status, 201);
  assert.equal(siteAccess.body.siteAccessLog.status, 'pending_approval');
  assert.equal(siteAccess.body.siteAccessLog.orientationValid, true);
  assert.ok(siteAccess.body.siteAccessLog.approvalId);

  const siteAccessApproval = await request(baseUrl, `/api/ledger/approvals/${siteAccess.body.siteAccessLog.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Access Test', reason: 'Orientation and access point checked.' })
  });
  assert.equal(siteAccessApproval.response.status, 200);
  assert.equal(siteAccessApproval.body.approval.status, 'approved');

  const fieldDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(fieldDetail.response.status, 200);
  assert.ok(fieldDetail.body.job.fieldReports.some(item => item.id === fieldReport.body.fieldReport.id && item.status === 'submitted'));
  assert.ok(fieldDetail.body.job.rfis.some(item => item.id === rfi.body.rfi.id && item.status === 'closed'));
  assert.ok(fieldDetail.body.job.submittals.some(item => item.id === submittal.body.submittal.id && item.status === 'approved'));
  assert.ok(fieldDetail.body.job.clientSelections.some(item => item.id === clientSelection.body.clientSelection.id && item.status === 'locked'));
  assert.ok(fieldDetail.body.job.permits.some(item => item.id === permit.body.permit.id && item.status === 'active'));
  assert.ok(fieldDetail.body.job.inspections.some(item => item.id === inspection.body.inspection.id && item.status === 'passed'));
  assert.ok(fieldDetail.body.job.observations.some(item => item.id === observation.body.observation.id && item.status === 'open'));
  assert.ok(fieldDetail.body.job.incidents.some(item => item.id === incident.body.incident.id && item.status === 'resolved'));
  assert.ok(fieldDetail.body.job.safetyMeetings.some(item => item.id === safetyMeeting.body.safetyMeeting.id && item.status === 'completed'));
  assert.ok(fieldDetail.body.job.orientations.some(item => item.id === orientation.body.orientation.id && item.status === 'completed'));
  assert.ok(fieldDetail.body.job.jhas.some(item => item.id === jha.body.jha.id && item.status === 'approved'));
  assert.ok(fieldDetail.body.job.sdsSheets.some(item => item.id === sdsSheet.body.sdsSheet.id && item.status === 'current'));
  assert.ok(fieldDetail.body.job.siteAccessLogs.some(item => item.id === siteAccess.body.siteAccessLog.id && item.status === 'checked_in'));

  const dispatch = await request(baseUrl, `/api/ledger/jobs/${jobId}/dispatch`, {
    method: 'POST',
    body: JSON.stringify({
      origin: 'Amsterdam depot',
      destination: 'Prinsengracht 1, Amsterdam',
      vehicle: 'Transit van with trailer',
      trailerRequired: true,
      procurementSupplier: 'Bouwmaat',
      procurementAmount: 650,
      procurementStatus: 'ready_to_order',
      requiredBy: '2026-07-01',
      workerInstructionTitle: 'Kitchen refit dispatch brief',
      workerInstructionBody: 'Arrive at 08:00, protect the hallway, take before photos, and flag blockers before extra work.'
    })
  });
  assert.equal(dispatch.response.status, 201);
  assert.ok(dispatch.body.dispatch.routePlan.id);
  assert.ok(dispatch.body.dispatch.loadingPlan.id);
  assert.ok(dispatch.body.dispatch.procurementOrder.id);
  assert.equal(dispatch.body.dispatch.procurementOrder.status, 'pending_approval');
  assert.ok(dispatch.body.dispatch.procurementOrder.approvalId);
  assert.ok(dispatch.body.dispatch.workerInstruction.id);
  assert.ok(dispatch.body.job.routePlans.some(item => item.id === dispatch.body.dispatch.routePlan.id));
  assert.ok(dispatch.body.job.loadingPlans.some(item => item.id === dispatch.body.dispatch.loadingPlan.id));
  assert.ok(dispatch.body.job.procurementOrders.some(item => item.id === dispatch.body.dispatch.procurementOrder.id));
  assert.ok(dispatch.body.job.workerInstructions.some(item => item.id === dispatch.body.dispatch.workerInstruction.id));
  assert.ok(dispatch.body.job.audit.some(event => event.action === 'create_dispatch_pack'));

  const procurementApproval = await request(baseUrl, `/api/ledger/approvals/${dispatch.body.dispatch.procurementOrder.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Procurement Test', reason: 'Spend approved but not externally ordered.' })
  });
  assert.equal(procurementApproval.response.status, 200);
  assert.equal(procurementApproval.body.approval.status, 'approved');

  const publishedInstruction = await request(baseUrl, `/api/ledger/jobs/${jobId}/worker-instructions`, {
    method: 'POST',
    body: JSON.stringify({
      audience: 'crew',
      channel: 'app',
      status: 'sent',
      title: 'Published regression dispatch instructions',
      body: 'Confirm arrival and upload before photos.'
    })
  });
  assert.equal(publishedInstruction.response.status, 201);
  assert.equal(publishedInstruction.body.workerInstruction.status, 'pending_approval');
  assert.ok(publishedInstruction.body.workerInstruction.approvalId);

  const instructionApproval = await request(baseUrl, `/api/ledger/approvals/${publishedInstruction.body.workerInstruction.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Dispatch Test', reason: 'Crew instruction checked.' })
  });
  assert.equal(instructionApproval.response.status, 200);
  assert.equal(instructionApproval.body.approval.status, 'approved');

  const dispatchDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(dispatchDetail.response.status, 200);
  assert.ok(dispatchDetail.body.job.procurementOrders.some(item => item.id === dispatch.body.dispatch.procurementOrder.id && item.status === 'ready_to_order'));
  assert.ok(dispatchDetail.body.job.workerInstructions.some(item => item.id === publishedInstruction.body.workerInstruction.id && item.status === 'approved'));

  const closeout = await request(baseUrl, `/api/ledger/jobs/${jobId}/closeout`, {
    method: 'POST',
    body: JSON.stringify({
      amount: 2300,
      taxAmount: 483,
      total: 2783,
      createRecurringPlan: true,
      intervalRule: 'quarterly',
      completionNote: 'Closeout package regression check.'
    })
  });
  assert.equal(closeout.response.status, 201);
  assert.ok(closeout.body.closeout.quality.id);
  assert.ok(closeout.body.closeout.safety.id);
  assert.ok(closeout.body.closeout.aftercare.id);
  assert.ok(closeout.body.closeout.payment.id);
  assert.ok(closeout.body.closeout.communication.approvalId);
  assert.ok(closeout.body.closeout.recurringPlan.id);
  assert.equal(closeout.body.closeout.completion.requiresApproval, true);
  assert.ok(closeout.body.closeout.completion.approval.id);
  assert.equal(closeout.body.closeout.completion.approval.targetType, 'job_update');
  assert.equal(closeout.body.closeout.completion.proposedPatch.status, 'completed');
  assert.notEqual(closeout.body.job.status, 'completed');
  assert.ok(closeout.body.job.qualityChecks.length >= 1);
  assert.ok(closeout.body.job.safetyChecks.length >= 1);
  assert.ok(closeout.body.job.payments.length >= 1);
  assert.ok(closeout.body.job.aftercare.length >= 1);
  assert.ok(closeout.body.job.recurringPlans.some(plan => plan.intervalRule === 'quarterly'));

  const closeoutCompletionApproval = await request(baseUrl, `/api/ledger/approvals/${closeout.body.closeout.completion.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Closeout Test', reason: 'Completion verified before closeout.' })
  });
  assert.equal(closeoutCompletionApproval.response.status, 200);
  assert.equal(closeoutCompletionApproval.body.approval.status, 'approved');

  const closeoutCompletedDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(closeoutCompletedDetail.response.status, 200);
  assert.equal(closeoutCompletedDetail.body.job.status, 'completed');
  assert.equal(closeoutCompletedDetail.body.job.progressPercent, 100);

  const qualitySignoff = await request(baseUrl, `/api/ledger/jobs/${jobId}/quality-checks`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Regression quality signoff', status: 'passed', result: 'passed' })
  });
  assert.equal(qualitySignoff.response.status, 201);
  assert.ok(qualitySignoff.body.qualityCheck.approvalId);

  const punchItem = await request(baseUrl, `/api/ledger/jobs/${jobId}/punch-items`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Regression backsplash correction',
      status: 'closed',
      severity: 'medium',
      assignee: 'Robert',
      dueAt: '2026-07-02',
      location: 'Kitchen backsplash',
      description: 'Correction completed and photo evidence attached.',
      photos: ['punch-closed.jpg']
    })
  });
  assert.equal(punchItem.response.status, 201);
  assert.equal(punchItem.body.punchItem.status, 'pending_approval');
  assert.ok(punchItem.body.punchItem.approvalId);

  const punchApproval = await request(baseUrl, `/api/ledger/approvals/${punchItem.body.punchItem.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Punch Test', reason: 'Closeout evidence verified.' })
  });
  assert.equal(punchApproval.response.status, 200);
  assert.equal(punchApproval.body.approval.status, 'approved');

  const warrantyClaim = await request(baseUrl, `/api/ledger/jobs/${jobId}/warranty-claims`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Regression workmanship aftercare',
      status: 'resolved',
      clientName: 'Regression Client',
      severity: 'medium',
      dueAt: '2026-07-08',
      warrantyType: 'workmanship',
      issue: 'Client reported minor trim movement after completion.',
      resolution: 'Trim resecured and client informed.',
      photos: ['warranty-resolved.jpg']
    })
  });
  assert.equal(warrantyClaim.response.status, 201);
  assert.equal(warrantyClaim.body.warrantyClaim.status, 'pending_approval');
  assert.ok(warrantyClaim.body.warrantyClaim.approvalId);

  const warrantyApproval = await request(baseUrl, `/api/ledger/approvals/${warrantyClaim.body.warrantyClaim.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Warranty Test', reason: 'Resolution checked against aftercare obligation.' })
  });
  assert.equal(warrantyApproval.response.status, 200);
  assert.equal(warrantyApproval.body.approval.status, 'approved');

  const safetyReview = await request(baseUrl, `/api/ledger/jobs/${jobId}/safety-checks`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Regression high-risk safety review', riskLevel: 'high', hazards: ['temporary access'] })
  });
  assert.equal(safetyReview.response.status, 201);
  assert.ok(safetyReview.body.safetyCheck.approvalId);

  const payableInvoiceApproval = await request(baseUrl, `/api/ledger/approvals/${invoice.body.invoice.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance Test', reason: 'Invoice approved before payment matching.' })
  });
  assert.equal(payableInvoiceApproval.response.status, 200);

  const payableInvoicePackage = await request(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoice.body.invoice.id}/issue-package`, {
    method: 'POST',
    body: JSON.stringify({ actor: 'Finance Test' })
  });
  assert.equal(payableInvoicePackage.response.status, 201);
  assert.equal(payableInvoicePackage.body.job.invoices.find(item => item.id === invoice.body.invoice.id).status, 'prepared');

  const ambiguousPayment = await request(baseUrl, `/api/ledger/jobs/${jobId}/payments`, {
    method: 'POST',
    body: JSON.stringify({ status: 'received', amount: 2783, method: 'bank_transfer', reference: 'REG-PAY-1' })
  });
  assert.equal(ambiguousPayment.response.status, 400);
  assert.equal(ambiguousPayment.body.error.code, 'invoice_required_for_payment_confirmation');

  const paymentReceived = await request(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoice.body.invoice.id}/payments`, {
    method: 'POST',
    body: JSON.stringify({ status: 'received', amount: 2783, method: 'bank_transfer', reference: 'REG-PAY-1' })
  });
  assert.equal(paymentReceived.response.status, 201);
  assert.equal(paymentReceived.body.payment.status, 'pending_confirmation');
  assert.ok(paymentReceived.body.payment.approvalId);

  const paymentApproval = await request(baseUrl, `/api/ledger/approvals/${paymentReceived.body.payment.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance Test', reason: 'Payment matched bank export.' })
  });
  assert.equal(paymentApproval.response.status, 200);
  assert.equal(paymentApproval.body.approval.status, 'approved');

  const budgetLine = await request(baseUrl, `/api/ledger/jobs/${jobId}/budget-lines`, {
    method: 'POST',
    body: JSON.stringify({
      costCode: 'REG-100',
      description: 'Regression finance baseline',
      category: 'materials',
      status: 'locked',
      budgetAmount: 1800,
      committedAmount: 950,
      actualAmount: 188.25,
      forecastAmount: 1900
    })
  });
  assert.equal(budgetLine.response.status, 201);
  assert.equal(budgetLine.body.budgetLine.status, 'pending_approval');
  assert.ok(budgetLine.body.budgetLine.approvalId);

  const budgetApproval = await request(baseUrl, `/api/ledger/approvals/${budgetLine.body.budgetLine.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Budget Test', reason: 'Baseline reviewed.' })
  });
  assert.equal(budgetApproval.response.status, 200);
  assert.equal(budgetApproval.body.approval.status, 'approved');

  const purchaseOrder = await request(baseUrl, `/api/ledger/jobs/${jobId}/purchase-orders`, {
    method: 'POST',
    body: JSON.stringify({
      budgetLineId: budgetLine.body.budgetLine.id,
      supplier: 'Bouwmaat',
      tradePartnerId: tradePartner.body.partner.id,
      status: 'ordered',
      amount: 950,
      requiredBy: '2026-07-01',
      items: [{ name: 'Regression worktop materials', quantity: 1, unitCost: 950 }]
    })
  });
  assert.equal(purchaseOrder.response.status, 201);
  assert.equal(purchaseOrder.body.purchaseOrder.status, 'pending_approval');
  assert.ok(purchaseOrder.body.purchaseOrder.approvalId);

  const purchaseOrderApproval = await request(baseUrl, `/api/ledger/approvals/${purchaseOrder.body.purchaseOrder.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'PO Test', reason: 'Supplier commitment approved for internal ordering.' })
  });
  assert.equal(purchaseOrderApproval.response.status, 200);
  assert.equal(purchaseOrderApproval.body.approval.status, 'approved');

  const drawRequest = await request(baseUrl, `/api/ledger/jobs/${jobId}/draw-requests`, {
    method: 'POST',
    body: JSON.stringify({
      invoiceId: invoice.body.invoice.id,
      title: 'Regression progress draw',
      status: 'submitted',
      requestedAmount: 2783,
      percentComplete: 80,
      dueAt: '2026-07-05'
    })
  });
  assert.equal(drawRequest.response.status, 201);
  assert.equal(drawRequest.body.drawRequest.status, 'pending_approval');
  assert.ok(drawRequest.body.drawRequest.approvalId);

  const drawApproval = await request(baseUrl, `/api/ledger/approvals/${drawRequest.body.drawRequest.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Draw Test', reason: 'Draw package checked.' })
  });
  assert.equal(drawApproval.response.status, 200);
  assert.equal(drawApproval.body.approval.status, 'approved');

  const lienWaiver = await request(baseUrl, `/api/ledger/jobs/${jobId}/lien-waivers`, {
    method: 'POST',
    body: JSON.stringify({
      paymentId: paymentReceived.body.payment.id,
      supplier: 'Bouwmaat',
      waiverType: 'conditional',
      status: 'received',
      amount: 2783,
      documentRef: 'waiver-regression.pdf'
    })
  });
  assert.equal(lienWaiver.response.status, 201);
  assert.equal(lienWaiver.body.lienWaiver.status, 'pending_approval');
  assert.ok(lienWaiver.body.lienWaiver.approvalId);

  const waiverApproval = await request(baseUrl, `/api/ledger/approvals/${lienWaiver.body.lienWaiver.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Waiver Test', reason: 'Waiver matched payment record.' })
  });
  assert.equal(waiverApproval.response.status, 200);
  assert.equal(waiverApproval.body.approval.status, 'approved');

  const financeHandoff = await request(baseUrl, `/api/ledger/jobs/${jobId}/finance-handoffs`, {
    method: 'POST',
    body: JSON.stringify({
      targetSystem: 'FAB',
      packageType: 'job_finance',
      status: 'submitted',
      exportFormat: 'json',
      notes: 'Regression finance package.'
    })
  });
  assert.equal(financeHandoff.response.status, 201);
  assert.equal(financeHandoff.body.financeHandoff.status, 'pending_approval');
  assert.ok(financeHandoff.body.financeHandoff.approvalId);

  const handoffApproval = await request(baseUrl, `/api/ledger/approvals/${financeHandoff.body.financeHandoff.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'FAB Test', reason: 'Bookkeeping handoff package approved.' })
  });
  assert.equal(handoffApproval.response.status, 200);
  assert.equal(handoffApproval.body.approval.status, 'approved');

  const closeoutDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(closeoutDetail.response.status, 200);
  assert.ok(closeoutDetail.body.job.payments.some(item => item.id === paymentReceived.body.payment.id && item.status === 'received'));
  assert.ok(closeoutDetail.body.job.budgetLines.some(item => item.id === budgetLine.body.budgetLine.id && item.status === 'locked'));
  assert.ok(closeoutDetail.body.job.purchaseOrders.some(item => item.id === purchaseOrder.body.purchaseOrder.id && item.status === 'ready_to_order'));
  assert.ok(closeoutDetail.body.job.drawRequests.some(item => item.id === drawRequest.body.drawRequest.id && item.status === 'submitted'));
  assert.ok(closeoutDetail.body.job.lienWaivers.some(item => item.id === lienWaiver.body.lienWaiver.id && item.status === 'received'));
  assert.ok(closeoutDetail.body.job.financeHandoffs.some(item => item.id === financeHandoff.body.financeHandoff.id && item.status === 'ready_to_export'));
  assert.ok(closeoutDetail.body.job.punchItems.some(item => item.id === punchItem.body.punchItem.id && item.status === 'closed'));
  assert.ok(closeoutDetail.body.job.warrantyClaims.some(item => item.id === warrantyClaim.body.warrantyClaim.id && item.status === 'resolved'));
  assert.ok(closeoutDetail.body.job.audit.some(event => event.action === 'create_closeout_package'));

  const cycle = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: false, actor: 'test-cycle' })
  });
  assert.equal(cycle.response.status, 200);
  assert.equal(cycle.body.success, true);
  assert.ok(Array.isArray(cycle.body.preview));
  assert.ok(Array.isArray(cycle.body.applied));
  assert.ok(cycle.body.dashboard.metrics.pendingApprovals >= 1);

  const debug = await request(baseUrl, '/api/ledger/debug');
  assert.equal(debug.response.status, 200);
  assert.equal(debug.body.diagnostics.valid, true);
  assert.ok(debug.body.diagnostics.counts.qualityChecks >= 2);
  assert.ok(debug.body.diagnostics.counts.safetyChecks >= 2);
  assert.ok(debug.body.diagnostics.counts.payments >= 2);
  assert.ok(debug.body.diagnostics.counts.budgetLines >= 1);
  assert.ok(debug.body.diagnostics.counts.purchaseOrders >= 1);
  assert.ok(debug.body.diagnostics.counts.drawRequests >= 1);
  assert.ok(debug.body.diagnostics.counts.lienWaivers >= 1);
  assert.ok(debug.body.diagnostics.counts.financeHandoffs >= 1);
  assert.ok(debug.body.diagnostics.counts.aftercareItems >= 1);
  assert.ok(debug.body.diagnostics.counts.recurringPlans >= 1);
  assert.ok(debug.body.diagnostics.counts.siteVisits >= 1);
  assert.ok(debug.body.diagnostics.counts.changeOrders >= 1);
  assert.ok(debug.body.diagnostics.counts.fieldReports >= 1);
  assert.ok(debug.body.diagnostics.counts.rfiRecords >= 1);
  assert.ok(debug.body.diagnostics.counts.submittals >= 1);
  assert.ok(debug.body.diagnostics.counts.clientSelections >= 1);
  assert.ok(debug.body.diagnostics.counts.permitRecords >= 1);
  assert.ok(debug.body.diagnostics.counts.inspectionRecords >= 1);
  assert.ok(debug.body.diagnostics.counts.observationRecords >= 1);
  assert.ok(debug.body.diagnostics.counts.incidentRecords >= 1);
  assert.ok(debug.body.diagnostics.counts.safetyMeetings >= 1);
  assert.ok(debug.body.diagnostics.counts.orientations >= 1);
  assert.ok(debug.body.diagnostics.counts.jhas >= 1);
  assert.ok(debug.body.diagnostics.counts.sdsSheets >= 1);
  assert.ok(debug.body.diagnostics.counts.siteAccessLogs >= 1);
  assert.ok(debug.body.diagnostics.counts.routePlans >= 1);
  assert.ok(debug.body.diagnostics.counts.loadingPlans >= 1);
  assert.ok(debug.body.diagnostics.counts.procurementOrders >= 1);
  assert.ok(debug.body.diagnostics.counts.workerInstructions >= 2);
  assert.ok(debug.body.diagnostics.counts.punchItems >= 1);
  assert.ok(debug.body.diagnostics.counts.warrantyClaims >= 1);
  assert.ok(debug.body.dashboard.metrics.auditEvents >= 1);
  assert.ok(debug.body.dashboard.metrics.openAftercare >= 1);
  assert.ok(debug.body.dashboard.metrics.activeRecurringPlans >= 1);
  assert.ok(debug.body.dashboard.metrics.siteVisits >= 1);
  assert.ok(debug.body.dashboard.metrics.changeOrders >= 1);
  assert.ok(debug.body.dashboard.metrics.fieldReports >= 1);
  assert.ok(debug.body.dashboard.metrics.submittals >= 1);
  assert.ok(debug.body.dashboard.metrics.clientSelections >= 1);
  assert.ok(debug.body.dashboard.metrics.permitRecords >= 1);
  assert.ok(debug.body.dashboard.metrics.inspections >= 1);
  assert.ok(debug.body.dashboard.metrics.openObservations >= 1);
  assert.ok(debug.body.dashboard.metrics.safetyMeetings >= 1);
  assert.ok(debug.body.dashboard.metrics.orientations >= 1);
  assert.ok(debug.body.dashboard.metrics.jhas >= 1);
  assert.ok(debug.body.dashboard.metrics.sdsSheets >= 1);
  assert.ok(debug.body.dashboard.metrics.siteAccessLogs >= 1);
  assert.equal(debug.body.dashboard.metrics.dispatchReadyJobs, 0);
  assert.ok(debug.body.dashboard.metrics.budgetLines >= 1);
  assert.ok(debug.body.dashboard.metrics.purchaseOrders >= 1);
  assert.ok(debug.body.dashboard.metrics.drawRequests >= 1);
  assert.ok(debug.body.dashboard.metrics.lienWaivers >= 1);
  assert.ok(debug.body.dashboard.metrics.financeHandoffs >= 1);
  assert.ok(debug.body.dashboard.metrics.punchItems >= 1);
  assert.ok(debug.body.dashboard.metrics.warrantyClaims >= 1);
  assert.ok(debug.body.dashboard.money.changeOrderValue >= 580.8);
  assert.ok(debug.body.dashboard.money.procurementValue >= 650);
  assert.ok(debug.body.dashboard.money.budgetValue >= 1800);
  assert.ok(debug.body.dashboard.money.purchaseOrderValue >= 950);
  assert.ok(debug.body.dashboard.money.drawRequestValue >= 2783);
  assert.ok(debug.body.dashboard.money.financeHandoffValue >= 1);

  const intakeAudit = await request(baseUrl, `/api/ledger/audit?jobId=${encodeURIComponent(jobId)}&action=create_intake_job`);
  assert.equal(intakeAudit.response.status, 200);
  assert.ok(intakeAudit.body.events.some(event => event.action === 'create_intake_job'));
  const timeAudit = await request(baseUrl, `/api/ledger/audit?jobId=${encodeURIComponent(jobId)}&action=record_time`);
  assert.equal(timeAudit.response.status, 200);
  assert.ok(timeAudit.body.events.some(event => event.action === 'record_time'));

  const topLevelAudit = await request(baseUrl, `/api/ledger/audit?jobId=${encodeURIComponent(jobId)}&action=assess_weather`);
  assert.equal(topLevelAudit.response.status, 200);
  assert.ok(topLevelAudit.body.events.some(event => event.action === 'assess_weather'));

  const ledgerOnlyIntake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Ledger-only dashboard merge job',
      client: { name: 'Ledger Merge Client', address: 'Utrecht' },
      service: 'Painting',
      description: 'Persisted directly through the operating ledger.',
      priority: 'high',
      status: 'planned',
      assignAutomatically: false
    })
  });
  assert.equal(ledgerOnlyIntake.response.status, 201);

  const ledgerOnlyWorker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Ledger-only Crew Lead',
      role: 'Painting',
      status: 'available',
      homeRegion: 'Utrecht',
      skills: ['painting', 'client handover']
    })
  });
  assert.equal(ledgerOnlyWorker.response.status, 201);

  const ledgerOnlyTool = await request(baseUrl, '/api/ledger/tools', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Ledger-only Paint Sprayer',
      category: 'painting',
      status: 'available',
      currentLocation: 'Utrecht Depot'
    })
  });
  assert.equal(ledgerOnlyTool.response.status, 201);

  const firstToolReservation = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}/tools`, {
    method: 'POST',
    body: JSON.stringify({
      toolId: ledgerOnlyTool.body.tool.id,
      toolName: 'Ledger-only Paint Sprayer',
      neededFrom: '2026-07-01T08:00:00.000Z',
      neededUntil: '2026-07-01T12:00:00.000Z'
    })
  });
  assert.equal(firstToolReservation.response.status, 201);
  assert.equal(firstToolReservation.body.toolReservation.status, 'reserved');
  assert.equal(firstToolReservation.body.toolReservation.requiresApproval, false);

  const conflictJob = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Ledger-only conflicting tool job',
      client: { name: 'Ledger Tool Conflict Client', address: 'Rotterdam' },
      service: 'Painting',
      description: 'Second persisted job needs the same paint sprayer.',
      priority: 'medium',
      status: 'planned',
      assignAutomatically: false
    })
  });
  assert.equal(conflictJob.response.status, 201);

  const firstWorkerAssignment = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}/assignments`, {
    method: 'POST',
    body: JSON.stringify({
      workerId: ledgerOnlyWorker.body.worker.id,
      workerName: 'Ledger-only Crew Lead',
      role: 'Painter',
      scheduledStart: '2026-07-02T08:00:00.000Z',
      scheduledEnd: '2026-07-02T12:00:00.000Z',
      allocationHours: 4
    })
  });
  assert.equal(firstWorkerAssignment.response.status, 201);
  assert.equal(firstWorkerAssignment.body.assignment.status, 'planned');
  assert.equal(firstWorkerAssignment.body.assignment.requiresApproval, false);

  const conflictingAssignment = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}/assignments`, {
    method: 'POST',
    body: JSON.stringify({
      workerId: ledgerOnlyWorker.body.worker.id,
      workerName: 'Ledger-only Crew Lead',
      role: 'Painter',
      scheduledStart: '2026-07-02T10:00:00.000Z',
      scheduledEnd: '2026-07-02T14:00:00.000Z',
      allocationHours: 4
    })
  });
  assert.equal(conflictingAssignment.response.status, 201);
  assert.equal(conflictingAssignment.body.assignment.status, 'pending_approval');
  assert.equal(conflictingAssignment.body.assignment.requiresApproval, true);
  assert.ok(conflictingAssignment.body.assignment.approval.id);
  assert.equal(conflictingAssignment.body.assignment.approval.targetType, 'assignment');
  assert.ok(conflictingAssignment.body.assignment.conflicts.some(conflict => conflict.assignmentId === firstWorkerAssignment.body.assignment.id));

  const assignmentConflictDashboard = await request(baseUrl, '/api/ledger/dashboard');
  assert.equal(assignmentConflictDashboard.response.status, 200);
  assert.ok(assignmentConflictDashboard.body.dashboard.metrics.assignmentConflicts >= 1);
  assert.ok(assignmentConflictDashboard.body.dashboard.nextActions.some(action => action.type === 'resolve_worker_conflict'));

  const approvedWorkerConflict = await request(baseUrl, `/api/ledger/approvals/${conflictingAssignment.body.assignment.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Assignment Test', reason: 'Worker conflict intentionally approved for regression coverage.' })
  });
  assert.equal(approvedWorkerConflict.response.status, 200);
  assert.equal(approvedWorkerConflict.body.approval.status, 'approved');

  const approvedAssignmentDetail = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}`);
  assert.equal(approvedAssignmentDetail.response.status, 200);
  assert.ok(approvedAssignmentDetail.body.job.assignments.some(item => item.id === conflictingAssignment.body.assignment.id && item.status === 'planned'));

  const firstAssignmentRelease = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}/assignments/${firstWorkerAssignment.body.assignment.id}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Regression release clears original worker booking.' })
  });
  assert.equal(firstAssignmentRelease.response.status, 200);
  assert.equal(firstAssignmentRelease.body.assignment.status, 'released');

  const conflictingAssignmentRelease = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}/assignments/${conflictingAssignment.body.assignment.id}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Regression release clears approved worker conflict booking.' })
  });
  assert.equal(conflictingAssignmentRelease.response.status, 200);
  assert.equal(conflictingAssignmentRelease.body.assignment.status, 'released');

  const postReleaseAssignment = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}/assignments`, {
    method: 'POST',
    body: JSON.stringify({
      workerId: ledgerOnlyWorker.body.worker.id,
      workerName: 'Ledger-only Crew Lead',
      role: 'Painter',
      scheduledStart: '2026-07-02T10:00:00.000Z',
      scheduledEnd: '2026-07-02T14:00:00.000Z',
      allocationHours: 4
    })
  });
  assert.equal(postReleaseAssignment.response.status, 201);
  assert.equal(postReleaseAssignment.body.assignment.status, 'planned');
  assert.equal(postReleaseAssignment.body.assignment.requiresApproval, false);
  assert.equal(postReleaseAssignment.body.assignment.conflicts.length, 0);

  const conflictingReservation = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}/tools`, {
    method: 'POST',
    body: JSON.stringify({
      toolId: ledgerOnlyTool.body.tool.id,
      toolName: 'Ledger-only Paint Sprayer',
      neededFrom: '2026-07-01T10:00:00.000Z',
      neededUntil: '2026-07-01T14:00:00.000Z'
    })
  });
  assert.equal(conflictingReservation.response.status, 201);
  assert.equal(conflictingReservation.body.toolReservation.status, 'pending_approval');
  assert.equal(conflictingReservation.body.toolReservation.requiresApproval, true);
  assert.ok(conflictingReservation.body.toolReservation.approval.id);
  assert.equal(conflictingReservation.body.toolReservation.approval.targetType, 'tool_reservation');
  assert.ok(conflictingReservation.body.toolReservation.conflicts.some(conflict => conflict.reservationId === firstToolReservation.body.toolReservation.id));

  const conflictDashboard = await request(baseUrl, '/api/ledger/dashboard');
  assert.equal(conflictDashboard.response.status, 200);
  assert.ok(conflictDashboard.body.dashboard.metrics.toolReservationConflicts >= 1);
  assert.ok(conflictDashboard.body.dashboard.nextActions.some(action => action.type === 'resolve_tool_conflict'));

  const approvedToolConflict = await request(baseUrl, `/api/ledger/approvals/${conflictingReservation.body.toolReservation.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Tool Test', reason: 'Conflict intentionally approved for regression coverage.' })
  });
  assert.equal(approvedToolConflict.response.status, 200);
  assert.equal(approvedToolConflict.body.approval.status, 'approved');

  const approvedConflictDetail = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}`);
  assert.equal(approvedConflictDetail.response.status, 200);
  assert.ok(approvedConflictDetail.body.job.tools.some(item => item.id === conflictingReservation.body.toolReservation.id && item.status === 'reserved'));

  const firstToolRelease = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}/tools/${firstToolReservation.body.toolReservation.id}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Regression release clears original booking.' })
  });
  assert.equal(firstToolRelease.response.status, 200);
  assert.equal(firstToolRelease.body.toolReservation.status, 'released');

  const conflictingToolRelease = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}/tools/${conflictingReservation.body.toolReservation.id}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Regression release clears approved conflict booking.' })
  });
  assert.equal(conflictingToolRelease.response.status, 200);
  assert.equal(conflictingToolRelease.body.toolReservation.status, 'released');

  const postReleaseReservation = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}/tools`, {
    method: 'POST',
    body: JSON.stringify({
      toolId: ledgerOnlyTool.body.tool.id,
      toolName: 'Ledger-only Paint Sprayer',
      neededFrom: '2026-07-01T10:00:00.000Z',
      neededUntil: '2026-07-01T14:00:00.000Z'
    })
  });
  assert.equal(postReleaseReservation.response.status, 201);
  assert.equal(postReleaseReservation.body.toolReservation.status, 'reserved');
  assert.equal(postReleaseReservation.body.toolReservation.requiresApproval, false);
  assert.equal(postReleaseReservation.body.toolReservation.conflicts.length, 0);

  const lowRiskJobUpdate = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: 'Ledger-only edited dashboard merge job',
      priority: 'medium'
    })
  });
  assert.equal(lowRiskJobUpdate.response.status, 200);
  assert.equal(lowRiskJobUpdate.body.status, 'updated');
  assert.equal(lowRiskJobUpdate.body.requiresApproval, false);
  assert.equal(lowRiskJobUpdate.body.job.title, 'Ledger-only edited dashboard merge job');

  const completionProposal = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      status: 'completed',
      progressPercent: 100,
      reason: 'Regression test verifies completion requires approval.'
    })
  });
  assert.equal(completionProposal.response.status, 200);
  assert.equal(completionProposal.body.status, 'pending_approval');
  assert.equal(completionProposal.body.requiresApproval, true);
  assert.ok(completionProposal.body.approval.id);
  assert.equal(completionProposal.body.approval.targetType, 'job_update');
  assert.equal(completionProposal.body.approval.data.patch.status, 'completed');

  const pendingCompletionDetail = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}`);
  assert.equal(pendingCompletionDetail.response.status, 200);
  assert.notEqual(pendingCompletionDetail.body.job.status, 'completed');

  const approvedCompletion = await request(baseUrl, `/api/ledger/approvals/${completionProposal.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Job Update Test', reason: 'Completion was verified.' })
  });
  assert.equal(approvedCompletion.response.status, 200);
  assert.equal(approvedCompletion.body.approval.status, 'approved');

  const completedDetail = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}`);
  assert.equal(completedDetail.response.status, 200);
  assert.equal(completedDetail.body.job.status, 'completed');
  assert.equal(completedDetail.body.job.progressPercent, 100);
  assert.ok(completedDetail.body.job.audit.some(event => event.action === 'propose_job_update'));
  assert.ok(completedDetail.body.job.audit.some(event => event.action === 'apply_job_update_approval'));

  const ledgerJobs = await request(baseUrl, '/api/ledger/jobs?search=Ledger-only');
  assert.equal(ledgerJobs.response.status, 200);
  assert.ok(ledgerJobs.body.jobs.some(job => job.id === ledgerOnlyIntake.body.job.id));

  const ledgerWorkers = await request(baseUrl, '/api/ledger/workers?search=Ledger-only');
  assert.equal(ledgerWorkers.response.status, 200);
  assert.ok(ledgerWorkers.body.workers.some(worker => worker.id === ledgerOnlyWorker.body.worker.id));

  const ledgerTools = await request(baseUrl, '/api/ledger/tools?search=Ledger-only');
  assert.equal(ledgerTools.response.status, 200);
  assert.ok(ledgerTools.body.tools.some(tool => tool.id === ledgerOnlyTool.body.tool.id));

  const ledgerWorkerRetirement = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(ledgerOnlyWorker.body.worker.id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason: 'Direct ledger resource retirement requires approval.' })
  });
  assert.equal(ledgerWorkerRetirement.response.status, 200);
  assert.equal(ledgerWorkerRetirement.body.success, true);
  assert.equal(ledgerWorkerRetirement.body.deleted, false);
  assert.equal(ledgerWorkerRetirement.body.retained, true);
  assert.equal(ledgerWorkerRetirement.body.retired, false);
  assert.equal(ledgerWorkerRetirement.body.requiresApproval, true);
  assert.equal(ledgerWorkerRetirement.body.operationStatus, 'pending_approval');
  assert.equal(ledgerWorkerRetirement.body.approval.targetType, 'worker_retirement');
  assert.equal(ledgerWorkerRetirement.body.worker.status, 'available');

  const blockedLedgerWorkerRetirement = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(ledgerWorkerRetirement.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Resource Approval Test', reason: 'Worker retirement approved.' })
  });
  assert.equal(blockedLedgerWorkerRetirement.response.status, 409);
  assert.equal(blockedLedgerWorkerRetirement.body.error.code, 'worker_retirement_active_assignments');

  const pendingWorkerRetirement = await request(baseUrl, '/api/ledger/approvals?status=pending&limit=100');
  assert.equal(pendingWorkerRetirement.response.status, 200);
  assert.ok(pendingWorkerRetirement.body.approvals.some(approval => approval.id === ledgerWorkerRetirement.body.approval.id));

  const finalWorkerAssignmentRelease = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}/assignments/${postReleaseAssignment.body.assignment.id}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Release the final retained assignment before worker retirement.' })
  });
  assert.equal(finalWorkerAssignmentRelease.response.status, 200);
  assert.equal(finalWorkerAssignmentRelease.body.assignment.status, 'released');

  const approvedLedgerWorkerRetirement = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(ledgerWorkerRetirement.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Resource Approval Test', reason: 'Worker retirement approved after assignment release.' })
  });
  assert.equal(approvedLedgerWorkerRetirement.response.status, 200);
  assert.equal(approvedLedgerWorkerRetirement.body.approval.status, 'approved');

  const retiredLedgerWorkers = await request(baseUrl, '/api/ledger/workers?status=retired&limit=100');
  assert.equal(retiredLedgerWorkers.response.status, 200);
  assert.ok(retiredLedgerWorkers.body.workers.some(worker => worker.id === ledgerOnlyWorker.body.worker.id));

  const ledgerToolRetirement = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(ledgerOnlyTool.body.tool.id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason: 'Direct ledger equipment retirement requires approval.' })
  });
  assert.equal(ledgerToolRetirement.response.status, 200);
  assert.equal(ledgerToolRetirement.body.success, true);
  assert.equal(ledgerToolRetirement.body.deleted, false);
  assert.equal(ledgerToolRetirement.body.retained, true);
  assert.equal(ledgerToolRetirement.body.retired, false);
  assert.equal(ledgerToolRetirement.body.requiresApproval, true);
  assert.equal(ledgerToolRetirement.body.operationStatus, 'pending_approval');
  assert.equal(ledgerToolRetirement.body.approval.targetType, 'tool_retirement');
  assert.equal(ledgerToolRetirement.body.tool.status, 'available');

  const blockedLedgerToolRetirement = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(ledgerToolRetirement.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Resource Approval Test', reason: 'Attempt retirement before reservation release.' })
  });
  assert.equal(blockedLedgerToolRetirement.response.status, 409);
  assert.equal(blockedLedgerToolRetirement.body.error.code, 'tool_retirement_active_reservations');

  const pendingToolRetirement = await request(baseUrl, '/api/ledger/approvals?status=pending&limit=100');
  assert.equal(pendingToolRetirement.response.status, 200);
  assert.ok(pendingToolRetirement.body.approvals.some(approval => approval.id === ledgerToolRetirement.body.approval.id));

  const finalToolReservationRelease = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}/tools/${postReleaseReservation.body.toolReservation.id}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Release the final retained reservation before equipment retirement.' })
  });
  assert.equal(finalToolReservationRelease.response.status, 200);
  assert.equal(finalToolReservationRelease.body.toolReservation.status, 'released');

  const approvedLedgerToolRetirement = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(ledgerToolRetirement.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Resource Approval Test', reason: 'Tool retirement approved after reservation release.' })
  });
  assert.equal(approvedLedgerToolRetirement.response.status, 200);
  assert.equal(approvedLedgerToolRetirement.body.approval.status, 'approved');

  const retiredLedgerTools = await request(baseUrl, '/api/ledger/tools?status=retired&limit=100');
  assert.equal(retiredLedgerTools.response.status, 200);
  assert.ok(retiredLedgerTools.body.tools.some(tool => tool.id === ledgerOnlyTool.body.tool.id));
});
