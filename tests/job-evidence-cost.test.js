const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-job-capture-'));
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

test('job command capture routes return refreshed dashboard summaries for evidence and costs', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'Evidence Cost Client',
      clientPhone: '+31 6 77777777',
      address: 'Herengracht 10, Amsterdam',
      service: 'renovation',
      title: 'Evidence and cost capture job',
      description: 'Small renovation requiring field evidence, material cost and follow-up records.',
      status: 'scheduled',
      priority: 'medium',
      estimatedCost: 1200,
      contractValue: 1800,
      estimatedHours: 8
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const initialCapabilities = await request(baseUrl, '/api/ledger/capabilities');
  assert.equal(initialCapabilities.response.status, 200);
  assert.ok(initialCapabilities.body.summary.averageCoverage >= 0);
  assert.ok(initialCapabilities.body.capabilities.some(capability =>
    capability.key === 'financial-control'
    && capability.sourceEvidence.some(item => item.includes('Built'))
    && capability.serviceGroups.length >= 2
  ));

  const progress = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/progress`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'in_progress',
      progressPercent: 40,
      note: 'Started work and captured initial site condition.'
    })
  });
  assert.equal(progress.response.status, 201);
  assert.equal(progress.body.job.progressPercent, 40);
  assert.ok(progress.body.dashboard.metrics.openJobs >= 1);

  const document = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/documents`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'photo',
      title: 'Before hallway protection photo',
      filename: 'before-hallway.jpg',
      mimeType: 'image/jpeg',
      storageRef: 'local://before-hallway.jpg',
      status: 'stored',
      tags: ['jobsite', 'before', 'wkb']
    })
  });
  assert.equal(document.response.status, 201);
  assert.equal(document.body.document.type, 'photo');
  assert.equal(document.body.dashboard.metrics.storedDocuments, 1);

  const expense = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/expenses`, {
    method: 'POST',
    body: JSON.stringify({
      category: 'materials',
      amount: 88.4,
      currency: 'EUR',
      vendor: 'Bouwmaat',
      receiptRef: 'receipt-88-40',
      status: 'submitted',
      notes: 'Dust protection and fasteners.'
    })
  });
  assert.equal(expense.response.status, 201);
  assert.equal(expense.body.expense.amount, 88.4);
  assert.ok(expense.body.dashboard.metrics.jobs >= 1);

  const invoice = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/invoices`, {
    method: 'POST',
    body: JSON.stringify({ amount: 1800, taxAmount: 378, total: 2178, peppolReady: true })
  });
  assert.equal(invoice.response.status, 201);
  assert.ok(invoice.body.invoice.approvalId);
  assert.ok(invoice.body.dashboard.metrics.draftInvoices >= 1);
  assert.ok(invoice.body.dashboard.metrics.pendingApprovals >= 1);

  const communication = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/communication`, {
    method: 'POST',
    body: JSON.stringify({
      channel: 'portal',
      direction: 'outbound',
      subject: 'Field evidence captured',
      body: 'Draft update: initial jobsite evidence and costs have been recorded.'
    })
  });
  assert.equal(communication.response.status, 201);
  assert.equal(communication.body.communication.status, 'draft');
  assert.ok(communication.body.dashboard.metrics.communicationDrafts >= 1);

  const payment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/payments`, {
    method: 'POST',
    body: JSON.stringify({ status: 'awaiting_payment', amount: 2178, method: 'bank_transfer' })
  });
  assert.equal(payment.response.status, 201);
  assert.equal(payment.body.payment.status, 'awaiting_payment');
  assert.ok(payment.body.dashboard.metrics.paymentFollowUps >= 1);

  const aftercare = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/aftercare`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Check hallway protection marks', type: 'client_follow_up', status: 'open' })
  });
  assert.equal(aftercare.response.status, 201);
  assert.ok(aftercare.body.dashboard.metrics.openAftercare >= 1);

  const recurring = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/recurring-plans`, {
    method: 'POST',
    body: JSON.stringify({ service: 'quarterly maintenance inspection', intervalRule: 'quarterly' })
  });
  assert.equal(recurring.response.status, 201);
  assert.equal(recurring.body.recurringPlan.status, 'active');
  assert.ok(recurring.body.dashboard.metrics.activeRecurringPlans >= 1);

  const uploadForm = new FormData();
  uploadForm.append('evidenceFile', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('direct ledger upload proof')], { type: 'image/jpeg' }), 'direct-ledger-photo.jpg');
  uploadForm.append('title', 'Direct ledger proof photo');
  uploadForm.append('category', 'field_photo');
  uploadForm.append('jobId', jobId);
  uploadForm.append('riskLevel', 'low');
  uploadForm.append('notes', 'Photo uploaded directly against the operating ledger job.');
  uploadForm.append('attachToBuild', 'false');

  const uploadResponse = await fetch(`${baseUrl}/api/ledger/upload`, {
    method: 'POST',
    body: uploadForm
  });
  const uploadBody = await uploadResponse.json();
  assert.equal(uploadResponse.status, 200);
  assert.equal(uploadBody.success, true);
  assert.ok(uploadBody.uploadedFile.storageRef);
  assert.ok(uploadBody.ledgerDocument.id);
  assert.equal(uploadBody.ledgerDocument.jobId, jobId);
  assert.equal(uploadBody.ledgerDocument.title, 'Direct ledger proof photo');
  assert.equal(uploadBody.ledgerDocument.filename, 'direct-ledger-photo.jpg');
  assert.equal(uploadBody.ledgerDocument.storageRef, uploadBody.uploadedFile.storageRef);
  assert.equal(uploadBody.ledgerDocument.data.analysis.upload.storageRef, uploadBody.uploadedFile.storageRef);
  assert.ok(uploadBody.ledgerFollowUp.records.progress.id);
  assert.ok(uploadBody.actions.some(action => action.type === 'record_ledger_progress_evidence'));
  assert.ok(fs.existsSync(path.resolve(__dirname, '..', uploadBody.uploadedFile.storageRef)));

  const riskyUploadForm = new FormData();
  riskyUploadForm.append('evidenceFile', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('quality issue proof')], { type: 'image/jpeg' }), 'cracked-corner-quality-photo.jpg');
  riskyUploadForm.append('category', 'field_photo');
  riskyUploadForm.append('jobId', jobId);
  riskyUploadForm.append('riskLevel', 'high');
  riskyUploadForm.append('notes', 'Uploaded photo shows crack damage and a possible quality issue in the corner.');
  riskyUploadForm.append('attachToBuild', 'false');

  const riskyUploadResponse = await fetch(`${baseUrl}/api/ledger/upload`, {
    method: 'POST',
    body: riskyUploadForm
  });
  const riskyUpload = await riskyUploadResponse.json();
  assert.equal(riskyUploadResponse.status, 200);
  assert.equal(riskyUpload.success, true);
  assert.ok(riskyUpload.ledgerDocument.id);
  assert.ok(riskyUpload.ledgerFollowUp.records.task.id);
  assert.ok(riskyUpload.ledgerFollowUp.records.safetyCheck.id);
  assert.ok(riskyUpload.ledgerFollowUp.records.qualityCheck.id);
  assert.ok(riskyUpload.actions.some(action => action.type === 'create_ledger_evidence_review_task'));
  assert.ok(riskyUpload.actions.some(action => action.type === 'create_ledger_safety_review'));
  assert.ok(riskyUpload.actions.some(action => action.type === 'create_ledger_quality_review'));

  const detail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(detail.response.status, 200);
  assert.ok(detail.body.job.documents.some(item => item.id === document.body.document.id));
  assert.ok(detail.body.job.documents.some(item => item.id === uploadBody.ledgerDocument.id));
  assert.ok(detail.body.job.documents.some(item => item.id === riskyUpload.ledgerDocument.id));
  assert.ok(detail.body.job.tasks.some(item => item.id === riskyUpload.ledgerFollowUp.records.task.id));
  assert.ok(detail.body.job.safetyChecks.some(item => item.id === riskyUpload.ledgerFollowUp.records.safetyCheck.id && item.approvalId));
  assert.ok(detail.body.job.qualityChecks.some(item => item.id === riskyUpload.ledgerFollowUp.records.qualityCheck.id && item.approvalId));
  assert.ok(detail.body.job.progress.some(item => item.id === uploadBody.ledgerFollowUp.records.progress.id));
  assert.ok(detail.body.job.expenses.some(item => item.id === expense.body.expense.id));
  assert.ok(Array.isArray(detail.body.job.capabilities));
  const euCompliance = detail.body.job.capabilities.find(capability => capability.key === 'eu-compliance');
  assert.ok(euCompliance);
  assert.ok(Number.isFinite(euCompliance.coverage));
  assert.ok(euCompliance.requirements.some(requirement => requirement.key === 'wkb' && requirement.covered));
  assert.ok(euCompliance.recommendedActions.every(action => action.requirementKey && action.actionTarget));
  assert.ok(euCompliance.recommendedActions.some(action =>
    ['permit_form', 'sds_form', 'site_access_form', 'approval_queue', 'audit_log'].includes(action.actionTarget)
  ));
  assert.ok(detail.body.job.capabilitySummary.averageCoverage >= 0);
  assert.ok(detail.body.job.audit.some(event => event.action === 'store_document'));
  assert.ok(detail.body.job.audit.some(event => event.action === 'record_expense'));
});
