const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function organizationPayload() {
  return {
    legalName: 'Handover Contractor B.V.',
    tradingName: 'Handover Contractor',
    registrationNumber: '12345678',
    vatNumber: 'NL123456789B01',
    email: 'handover@example.test',
    phone: '+31 20 123 45 67',
    address: 'Dossierstraat 10',
    postalCode: '3511 AA',
    city: 'Utrecht',
    country: 'NL'
  };
}

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-handover-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function readyHandoverJob(ledger) {
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner' });
  const job = ledger.createIntake({
    client: {
      name: '<script>Handover Client</script>',
      company: '<script>Handover Client B.V.</script>',
      email: 'client@example.test',
      address: 'Clientstraat 4'
    },
    title: 'Completed apartment renovation',
    description: 'Retain the verified completion evidence.',
    address: 'Projectlaan 20',
    city: 'Rotterdam',
    status: 'completed',
    progressPercent: 100,
    assignAutomatically: false
  }, { actor: 'office' });
  ledger.createFieldReport(job.id, {
    status: 'draft',
    reportDate: '2026-07-15',
    workCompleted: 'Final installation and cleanup completed.',
    photos: ['photo-reference-1']
  }, { actor: 'field' });
  const quality = ledger.addQualityCheck(job.id, {
    title: 'Final completion quality review',
    status: 'approved',
    result: 'passed',
    defects: [],
    defectsOpen: 0,
    notes: 'Workmanship and retained completion evidence checked.'
  }, { actor: 'quality' });
  ledger.resolveApproval(quality.approval.id, {
    status: 'approved',
    resolvedBy: 'quality-approver',
    reason: 'No open defects remain.'
  });
  return job;
}

test('handover dossiers are immutable, current-evidence bound, capability-backed, and autonomously reviewable', t => {
  const ledger = temporaryLedger(t);
  const job = readyHandoverJob(ledger);
  ledger.db.prepare("UPDATE field_reports SET status = 'cancelled' WHERE job_id = ?").run(job.id);
  ledger.addDocument(job.id, {
    type: 'photo',
    title: 'Cancelled completion photo',
    filename: 'cancelled-completion.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 4,
    status: 'cancelled'
  }, { actor: 'field' });
  const cancelledOnlyReadiness = ledger.assessHandoverReadiness(job.id);
  assert.equal(cancelledOnlyReadiness.ready, false);
  assert.ok(cancelledOnlyReadiness.missing.some(requirement => requirement.code === 'field_evidence_required'));
  ledger.createFieldReport(job.id, {
    status: 'draft',
    reportDate: '2026-07-15',
    workCompleted: 'Replacement active completion evidence retained.'
  }, { actor: 'field' });
  ledger.addDocument(job.id, {
    type: 'photo',
    title: 'Legacy completion photo',
    filename: 'completion.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 4,
    status: 'stored'
  }, { actor: 'field' });
  const punch = ledger.createPunchItem(job.id, {
    title: 'Final sealant correction',
    status: 'open',
    dueAt: '2026-07-16'
  }, { actor: 'quality' });

  const blockedReadiness = ledger.assessHandoverReadiness(job.id);
  assert.equal(blockedReadiness.ready, false);
  assert.ok(blockedReadiness.blockers.some(blocker => blocker.code === 'open_punch_items' && blocker.recordIds.includes(punch.id)));
  const punchResolution = ledger.transitionLifecycleRecord(job.id, 'punch_item', punch.id, {
    status: 'resolved',
    notes: 'Sealant corrected and completion photo checked.'
  }, { actor: 'quality' });
  ledger.resolveApproval(punchResolution.approval.id, {
    status: 'approved',
    resolvedBy: 'quality-approver',
    reason: 'Punch correction evidence verified.'
  });

  let detail = ledger.getJobDetail(job.id, { includeAudit: false });
  let euCapability = detail.capabilities.find(capability => capability.key === 'eu-compliance');
  assert.equal(euCapability.requirements.find(requirement => requirement.key === 'wkb').covered, false);

  const firstReadiness = ledger.assessHandoverReadiness(job.id, { detail });
  assert.equal(firstReadiness.ready, true);
  assert.equal(firstReadiness.status, 'ready');
  assert.equal(firstReadiness.warnings[0].code, 'legacy_evidence_without_content_hash');
  ledger.audit({ entityType: 'job', entityId: job.id, jobId: job.id, action: 'unrelated_audit_probe', actor: 'test' });
  assert.equal(ledger.assessHandoverReadiness(job.id).evidenceHash, firstReadiness.evidenceHash);

  const prepared = ledger.prepareHandoverIssuePackage(job.id, {}, { actor: 'office' });
  assert.equal(prepared.replayed, false);
  assert.equal(prepared.document.type, 'handover_issue_package');
  assert.equal(prepared.document.status, 'prepared');
  assert.equal(prepared.communication.data.attachmentDocumentIds[0], prepared.document.id);
  assert.equal(prepared.approval.targetType, 'communication');
  assert.equal(prepared.externalCommitments, 0);
  assert.match(prepared.issueReference, /^HOV-\d{4}-/);

  const downloaded = ledger.getIssuePackage(prepared.document.id, { audit: false });
  assert.equal(downloaded.packageHash, prepared.packageHash);
  assert.match(downloaded.content, /Project handover dossier/);
  assert.match(downloaded.content, /does not certify statutory Wkb compliance/i);
  assert.doesNotMatch(downloaded.content, /<script>Handover Client/);
  assert.match(downloaded.content, /&lt;script&gt;Handover Client B\.V\.&lt;\/script&gt;/);

  const repeated = ledger.prepareHandoverIssuePackage(job.id, {}, { actor: 'office' });
  assert.equal(repeated.replayed, true);
  assert.equal(repeated.document.id, prepared.document.id);
  assert.equal(repeated.communication.id, prepared.communication.id);
  assert.equal(ledger.listHandoverPackages({ jobId: job.id }).length, 1);
  assert.equal(ledger.assessHandoverReadiness(job.id).currentPackageId, prepared.document.id);

  detail = ledger.getJobDetail(job.id, { includeAudit: false });
  euCapability = detail.capabilities.find(capability => capability.key === 'eu-compliance');
  const wkbRequirement = euCapability.requirements.find(requirement => requirement.key === 'wkb');
  assert.equal(wkbRequirement.covered, true);
  assert.equal(wkbRequirement.status, 'ready');

  ledger.resolveApproval(prepared.approval.id, {
    status: 'approved',
    resolvedBy: 'handover-approver',
    reason: 'Recipient and immutable package checked.'
  });
  const delivered = ledger.recordCommunicationDelivery(prepared.communication.id, {
    integration: 'verified-handover-provider',
    providerMessageId: 'handover-message-1'
  }, { actor: 'verified-integration' });
  assert.equal(delivered.status, 'sent');

  ledger.createFieldReport(job.id, {
    status: 'draft',
    reportDate: '2026-07-16',
    workCompleted: 'Client walkthrough evidence added.'
  }, { actor: 'field' });
  const changedReadiness = ledger.assessHandoverReadiness(job.id);
  assert.equal(changedReadiness.ready, true);
  assert.equal(changedReadiness.currentPackageId, null);
  assert.notEqual(changedReadiness.evidenceHash, prepared.evidenceHash);
  assert.throws(
    () => ledger.verifyCommunicationAttachments(prepared.communication.id),
    error => error.code === 'handover_issue_package_stale' && error.statusCode === 409
  );

  const autonomousPreview = ledger.runAutonomousCycle({
    dryRun: true,
    actionTypes: ['prepare_handover_package_review'],
    jobIds: [job.id]
  });
  assert.equal(autonomousPreview.preview.length, 1);
  assert.equal(autonomousPreview.preview[0].evidenceHash, changedReadiness.evidenceHash);
  const autonomousApplied = ledger.runAutonomousCycle({
    actionTypes: ['prepare_handover_package_review'],
    jobIds: [job.id],
    actor: 'autonomous-test'
  });
  assert.equal(autonomousApplied.applied.length, 1);
  assert.equal(autonomousApplied.applied[0].externalDeliveryInitiated, false);
  assert.equal(autonomousApplied.summary.externalCommitments, 0);
  const autonomousRepeat = ledger.runAutonomousCycle({
    actionTypes: ['prepare_handover_package_review'],
    jobIds: [job.id],
    actor: 'autonomous-test'
  });
  assert.equal(autonomousRepeat.preview.length, 0);
  assert.equal(autonomousRepeat.applied.length, 0);

  const refreshed = ledger.prepareHandoverIssuePackage(job.id, {}, { actor: 'office' });
  assert.notEqual(refreshed.document.id, prepared.document.id);
  assert.equal(ledger.listHandoverPackages({ jobId: job.id }).length, 2);
  const row = ledger.db.prepare('SELECT data_json FROM documents WHERE id = ?').get(refreshed.document.id);
  const corruptedData = JSON.parse(row.data_json);
  corruptedData.snapshot.job.title = 'Tampered title';
  ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(JSON.stringify(corruptedData), refreshed.document.id);
  assert.throws(
    () => ledger.getHandoverIssuePackage(refreshed.document.id, { audit: false }),
    error => error.code === 'handover_issue_package_integrity_failed' && error.statusCode === 409
  );
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => issue.message.includes(refreshed.document.id) && issue.message.includes('checksum')));
});

const apiStateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-handover-api-'));
process.env.NODE_ENV = 'test';
process.env.STATE_FILE = path.join(apiStateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(apiStateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(apiStateDirectory, 'uploads');
process.env.CONTRACTOR_AI_REQUIRE_AUTH = 'true';
process.env.CONTRACTOR_AI_VERIFIED_INTEGRATIONS = 'handover_api_provider';
delete process.env.CONTRACTOR_AI_AUTH_TOKEN;

const tokens = {
  owner: 'handover-owner-token-1234567890123456789012',
  office: 'handover-office-token-123456789012345678901',
  approver: 'handover-approver-token-1234567890123456789',
  field: 'handover-field-token-1234567890123456789012'
};
process.env.CONTRACTOR_AI_ROLE_TOKENS = JSON.stringify({
  operators: [
    { id: 'handover-owner', role: 'owner', token: tokens.owner },
    { id: 'handover-office', role: 'office_operator', token: tokens.office },
    { id: 'handover-approver', role: 'approver', token: tokens.approver },
    { id: 'handover-field', role: 'field_worker', workerId: 'handover-worker', token: tokens.field }
  ]
});

const app = require('../server');

function headers(role, json = false) {
  return {
    Authorization: `Bearer ${tokens[role]}`,
    ...(json ? { 'Content-Type': 'application/json' } : {})
  };
}

async function apiRequest(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const body = await response.json();
  return { response, body };
}

test('handover APIs enforce roles, readiness, immutable download, delivery approval, and export visibility', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'handover_api_test' });
    fs.rmSync(apiStateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const profile = await apiRequest(baseUrl, '/api/ledger/organization', {
    method: 'PUT', headers: headers('owner', true), body: JSON.stringify(organizationPayload())
  });
  assert.equal(profile.response.status, 200);

  const intake = await apiRequest(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({
      client: { name: 'API Handover Client', company: 'API Handover Client B.V.', email: 'client@example.test' },
      title: 'API completed handover project',
      address: 'API Projectstraat 12',
      city: 'Amsterdam',
      status: 'completed',
      progressPercent: 100,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const blocked = await apiRequest(baseUrl, `/api/ledger/jobs/${jobId}/handover-packages`, {
    method: 'POST', headers: headers('office', true), body: '{}'
  });
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.body.error.code, 'handover_package_not_ready');

  const report = await apiRequest(baseUrl, `/api/ledger/jobs/${jobId}/field-reports`, {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({ status: 'draft', reportDate: '2026-07-15', workCompleted: 'Completion evidence retained.' })
  });
  assert.equal(report.response.status, 201);
  const quality = await apiRequest(baseUrl, `/api/ledger/jobs/${jobId}/quality-checks`, {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({ title: 'Final API quality review', status: 'approved', result: 'passed', defects: [], defectsOpen: 0, notes: 'No open defects.' })
  });
  assert.equal(quality.response.status, 201);
  const qualityApproval = await apiRequest(baseUrl, `/api/ledger/approvals/${quality.body.qualityCheck.approvalId}/resolve`, {
    method: 'POST', headers: headers('approver', true), body: JSON.stringify({ status: 'approved', reason: 'Quality evidence checked.' })
  });
  assert.equal(qualityApproval.response.status, 200);

  const fieldReadiness = await apiRequest(baseUrl, `/api/ledger/jobs/${jobId}/handover-readiness`, {
    headers: headers('field')
  });
  assert.equal(fieldReadiness.response.status, 403);
  assert.equal(fieldReadiness.body.error.code, 'insufficient_role');

  const readiness = await apiRequest(baseUrl, `/api/ledger/jobs/${jobId}/handover-readiness`, {
    headers: headers('office')
  });
  assert.equal(readiness.response.status, 200);
  assert.equal(readiness.body.readiness.ready, true);

  const prepared = await apiRequest(baseUrl, `/api/ledger/jobs/${jobId}/handover-packages`, {
    method: 'POST', headers: headers('office', true), body: JSON.stringify({ channel: 'email' })
  });
  assert.equal(prepared.response.status, 201);
  assert.equal(prepared.body.package.replayed, false);
  assert.equal(prepared.body.package.document.type, 'handover_issue_package');
  assert.equal(prepared.body.package.approval.targetType, 'communication');

  const fieldDownload = await apiRequest(baseUrl, `/api/ledger/documents/${prepared.body.package.document.id}/issue-package`, {
    headers: headers('field')
  });
  assert.equal(fieldDownload.response.status, 403);
  assert.equal(fieldDownload.body.error.code, 'insufficient_role');

  const packageResponse = await fetch(`${baseUrl}/api/ledger/documents/${prepared.body.package.document.id}/issue-package`, {
    headers: headers('approver')
  });
  const html = await packageResponse.text();
  assert.equal(packageResponse.status, 200);
  assert.match(packageResponse.headers.get('content-type'), /^text\/html/);
  assert.match(packageResponse.headers.get('content-disposition'), /^attachment;/);
  assert.match(html, /API completed handover project/);
  assert.match(html, /Package SHA-256/);

  const beforeApproval = await apiRequest(baseUrl, `/api/ledger/communications/${prepared.body.package.communication.id}/delivery-receipt`, {
    method: 'POST', headers: headers('office', true), body: JSON.stringify({ integration: 'handover_api_provider' })
  });
  assert.equal(beforeApproval.response.status, 409);
  assert.equal(beforeApproval.body.error.code, 'communication_approval_required');

  const deliveryApproval = await apiRequest(baseUrl, `/api/ledger/approvals/${prepared.body.package.approval.id}/resolve`, {
    method: 'POST', headers: headers('approver', true), body: JSON.stringify({ status: 'approved', reason: 'Recipient and dossier checked.' })
  });
  assert.equal(deliveryApproval.response.status, 200);
  const delivered = await apiRequest(baseUrl, `/api/ledger/communications/${prepared.body.package.communication.id}/delivery-receipt`, {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({ integration: 'handover_api_provider', providerMessageId: 'handover-api-message-1' })
  });
  assert.equal(delivered.response.status, 200);
  assert.equal(delivered.body.communication.status, 'sent');

  const clients = await apiRequest(baseUrl, '/api/ledger/client-success?mode=all&limit=100', { headers: headers('office') });
  assert.equal(clients.response.status, 200);
  const clientRow = clients.body.jobs.find(job => job.jobId === jobId);
  assert.ok(clientRow);
  assert.equal(clientRow.counts.handoverPackages, 1);
  assert.equal(clientRow.counts.handoverDelivered, 1);
  assert.equal(clientRow.handoverReadiness.currentPackageId, prepared.body.package.document.id);

  const exported = await apiRequest(baseUrl, '/api/operations/export', { headers: headers('owner') });
  assert.equal(exported.response.status, 200);
  assert.equal(exported.body.handoverPackages.length, 1);
  const validation = await apiRequest(baseUrl, '/api/operations/exports/validate', {
    method: 'POST', headers: headers('owner', true), body: JSON.stringify(exported.body)
  });
  assert.equal(validation.response.status, 200, JSON.stringify(validation.body));
  assert.equal(validation.body.counts.handoverPackages, 1);
});
