const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function makeLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-privacy-ledger-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function verifyAndAssess(ledger, request, action, extra = {}) {
  ledger.verifyDataSubjectRequestIdentity(request.id, {
    method: 'existing_contact',
    evidenceReference: 'Verified through the retained client contact and signed response.'
  }, { actor: 'privacy_operator' });
  return ledger.assessDataSubjectRequest(request.id, {
    action,
    rationale: 'The verified request and current retained inventory were reviewed for this specific decision.',
    legalBasisReference: 'GDPR Articles 12-20 review record',
    retentionPolicyReference: 'Contractor.AI retention policy 2026-01',
    ...extra
  }, { actor: 'privacy_owner' });
}

function approve(ledger, approvalId, actor = 'privacy_approver') {
  return ledger.resolveApproval(approvalId, {
    status: 'approved',
    resolvedBy: actor,
    reason: 'Identity, request scope, retained categories, and source-current safeguards were independently reviewed.'
  }, { actor, enforceSeparation: true });
}

test('access requests require verified identity, source-current approval, and a human-reviewed export', t => {
  const ledger = makeLedger(t);
  assert.equal(ledger.migrationStatus().currentVersion, '071_data_subject_request_governance');
  const client = ledger.createClient({
    name: 'Access Request Client',
    email: 'privacy-access@example.test',
    phone: '+31 20 555 0191',
    address: 'Privacylaan 1',
    city: 'Amsterdam'
  }, { actor: 'office_operator' });
  const request = ledger.createDataSubjectRequest({
    subjectType: 'client',
    subjectId: client.id,
    requestType: 'access',
    channel: 'email',
    requesterReference: 'inbound-email-2026-001',
    details: 'Please provide the personal data associated with this client record.'
  }, { actor: 'privacy_operator' });

  assert.equal(request.status, 'open');
  assert.equal(request.identity.fullIdentityDocumentStored, false);
  assert.equal(ledger.listDataSubjectRequests({ status: 'all' }).summary.identityPending, 1);
  assert.throws(
    () => ledger.assessDataSubjectRequest(request.id, {
      action: 'provide_access',
      rationale: 'Attempt before identity verification must fail.',
      legalBasisReference: 'GDPR Article 15',
      retentionPolicyReference: 'Retention policy 2026'
    }),
    error => error.code === 'data_subject_identity_verification_required'
  );

  const extendedDueAt = new Date(Date.parse(request.dueAt) + (24 * 60 * 60 * 1000)).toISOString();
  assert.throws(
    () => ledger.extendDataSubjectRequestDeadline(request.id, {
      dueAt: extendedDueAt,
      reason: 'Complex source inventory requires a bounded extension.'
    }),
    error => error.code === 'data_subject_extension_notification_required'
  );
  const extended = ledger.extendDataSubjectRequestDeadline(request.id, {
    dueAt: extendedDueAt,
    reason: 'Complex source inventory requires a bounded extension.',
    notificationReference: 'Requester informed in retained message PRIV-EXT-001.'
  }, { actor: 'privacy_operator' });
  assert.equal(extended.result.extensions[0].notificationReference, 'Requester informed in retained message PRIV-EXT-001.');

  const assessed = verifyAndAssess(ledger, request, 'provide_access');
  assert.equal(assessed.request.status, 'pending_approval');
  assert.equal(assessed.approval.approvalType, 'privacy_rights_decision');
  approve(ledger, assessed.approval.id);

  const completed = ledger.getDataSubjectRequest(request.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result.externalCommitments, 0);
  assert.equal(completed.result.extensions[0].notificationReference, 'Requester informed in retained message PRIV-EXT-001.');
  const exported = ledger.dataSubjectExportPayload(request.id);
  assert.equal(exported.payload.format, 'contractor-ai-data-subject-export/v1');
  assert.equal(exported.payload.privacy.automaticallyDelivered, false);
  assert.equal(exported.payload.privacy.thirdPartyRightsReviewRequiredBeforeDelivery, true);
  assert.equal(exported.payload.records.profile.email, 'privacy-access@example.test');
  assert.doesNotMatch(JSON.stringify(exported.payload), /token_hash/i);
  assert.match(exported.checksum, /^[a-f0-9]{64}$/);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('rectification approval fails closed when the personal-data inventory changed after assessment', t => {
  const ledger = makeLedger(t);
  const client = ledger.createClient({ name: 'Rectification Client', email: 'old-address@example.test' });
  const request = ledger.createDataSubjectRequest({
    subjectType: 'client',
    subjectId: client.id,
    requestType: 'rectification'
  });
  const assessed = verifyAndAssess(ledger, request, 'apply_rectification', {
    corrections: { email: 'correct-address@example.test', city: 'Utrecht' }
  });

  ledger.updateClient(client.id, { phone: '+31 30 555 0188' }, { actor: 'office_operator' });
  assert.throws(
    () => approve(ledger, assessed.approval.id),
    error => error.code === 'data_subject_source_stale'
  );
  assert.equal(ledger.listApprovals({ status: 'all', limit: 100 }).find(item => item.id === assessed.approval.id).status, 'pending');
  assert.equal(ledger.getDataSubjectRequest(request.id).status, 'pending_approval');
  assert.equal(ledger.listClients({ limit: 100 }).find(item => item.id === client.id).email, 'old-address@example.test');
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('approved restriction and objection decisions block new operational and marketing use', t => {
  const ledger = makeLedger(t);
  const client = ledger.createClient({ name: 'Restricted Client', email: 'restricted@example.test' });
  const restriction = ledger.createDataSubjectRequest({
    subjectType: 'client', subjectId: client.id, requestType: 'restriction'
  });
  approve(ledger, verifyAndAssess(ledger, restriction, 'apply_restriction').approval.id);

  assert.throws(
    () => ledger.createOpportunity({ title: 'Blocked follow-on work', client: { email: client.email, name: client.name } }),
    error => error.code === 'data_subject_processing_restricted'
  );

  const lifted = ledger.createDataSubjectRequest({
    subjectType: 'client', subjectId: client.id, requestType: 'restriction'
  });
  approve(ledger, verifyAndAssess(ledger, lifted, 'lift_restriction').approval.id);
  const opportunity = ledger.createOpportunity({
    title: 'Permitted follow-on work',
    client: { email: client.email, name: client.name }
  });
  assert.equal(opportunity.clientId, client.id);

  const objection = ledger.createDataSubjectRequest({
    subjectType: 'client', subjectId: client.id, requestType: 'objection'
  });
  approve(ledger, verifyAndAssess(ledger, objection, 'apply_objection').approval.id);
  assert.throws(
    () => ledger.assertDataSubjectProcessingAllowed('client', client.id, 'direct_marketing'),
    error => error.code === 'data_subject_marketing_objection_active'
  );
  assert.doesNotThrow(() => ledger.assertDataSubjectProcessingAllowed('client', client.id, 'contract_service'));
});

test('erasure handling is blocker-aware and records partial pseudonymization without deleting audit evidence', t => {
  const ledger = makeLedger(t);
  const client = ledger.createClient({ name: 'Erasure Client', email: 'erasure@example.test' });
  ledger.createOpportunity({ title: 'Active retained opportunity', client: { name: client.name, email: client.email } });
  const blocked = ledger.createDataSubjectRequest({
    subjectType: 'client', subjectId: client.id, requestType: 'erasure'
  });
  ledger.verifyDataSubjectRequestIdentity(blocked.id, {
    method: 'signed_correspondence', evidenceReference: 'Signed retained correspondence reference PRIV-ERASURE-001'
  });
  assert.throws(
    () => ledger.assessDataSubjectRequest(blocked.id, {
      action: 'pseudonymize_current_records',
      rationale: 'Pseudonymize eligible current projections while preserving required retained evidence.',
      legalBasisReference: 'GDPR Article 17 assessment',
      retentionPolicyReference: 'Contractor.AI retention policy 2026-01'
    }),
    error => error.code === 'data_subject_pseudonymization_blocked' && error.details.blockers.some(item => item.code === 'active_opportunities')
  );

  const worker = ledger.upsertWorker({
    name: 'Former Worker', role: 'Installer', status: 'available', email: 'former-worker@example.test', phone: '+31 6 12345678'
  });
  ledger.retireWorker(worker.id, { actor: 'approved_worker_retirement' });
  const erasure = ledger.createDataSubjectRequest({
    subjectType: 'worker', subjectId: worker.id, requestType: 'erasure'
  });
  const assessed = verifyAndAssess(ledger, erasure, 'pseudonymize_current_records');
  approve(ledger, assessed.approval.id);
  const completed = ledger.getDataSubjectRequest(erasure.id);
  const pseudonymized = ledger.getWorker(worker.id);
  assert.equal(completed.status, 'partially_completed');
  assert.equal(completed.result.fullErasureClaimed, false);
  assert.match(completed.subjectLabel, /^Pseudonymized worker /);
  assert.match(pseudonymized.name, /^Pseudonymized worker /);
  assert.equal(pseudonymized.email, null);
  assert.equal(pseudonymized.phone, null);
  assert.equal(pseudonymized.status, 'retired');
  assert.equal(ledger.listAudit({ entityType: 'data_subject_request', entityId: erasure.id, limit: 20 }).length >= 4, true);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

function loadServer(directory, roleTokens) {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    CONTRACTOR_AI_RUNTIME_MODE: 'local',
    CONTRACTOR_AI_STORAGE_MODE: 'local',
    CONTRACTOR_AI_REQUIRE_AUTH: 'true',
    CONTRACTOR_AI_AUTH_TOKEN: '',
    CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify(roleTokens),
    CONTRACTOR_AI_AUTONOMOUS_SCHEDULER_ENABLED: 'false',
    STATE_FILE: path.join(directory, 'state.json'),
    LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
    UPLOAD_DIR: path.join(directory, 'uploads')
  });
  delete process.env.DASHBOARD_AUTH_TOKEN;
  delete process.env.CONTRACTOR_AI_DATABASE_URL;
  delete require.cache[require.resolve('../server')];
  return require('../server');
}

async function apiRequest(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

function bearer(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test('privacy operations are owner-only and approved exports are private and checksum-protected', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-privacy-api-'));
  const tokens = {
    owner: 'privacy-owner-token-at-least-32-characters',
    approver: 'privacy-approver-token-at-least-32-characters',
    office_operator: 'privacy-office-token-at-least-32-characters'
  };
  const app = loadServer(directory, tokens);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server }).catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const denied = await apiRequest(baseUrl, '/api/operations/privacy/requests', {
    headers: bearer(tokens.office_operator)
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.error.code, 'insufficient_role');

  const createdClient = await apiRequest(baseUrl, '/api/ledger/clients', {
    method: 'POST',
    headers: bearer(tokens.owner),
    body: JSON.stringify({ name: 'API Privacy Client', email: 'privacy-api@example.test' })
  });
  assert.equal(createdClient.response.status, 201, JSON.stringify(createdClient.body));
  const created = await apiRequest(baseUrl, '/api/operations/privacy/requests', {
    method: 'POST',
    headers: bearer(tokens.owner),
    body: JSON.stringify({
      subjectType: 'client',
      subjectId: createdClient.body.client.id,
      requestType: 'portability',
      channel: 'email'
    })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const requestId = created.body.request.id;

  const verified = await apiRequest(baseUrl, `/api/operations/privacy/requests/${requestId}/identity`, {
    method: 'POST',
    headers: bearer(tokens.owner),
    body: JSON.stringify({ method: 'existing_contact', evidenceReference: 'Confirmed through existing client contact thread PRIV-API-001' })
  });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.body));
  const assessed = await apiRequest(baseUrl, `/api/operations/privacy/requests/${requestId}/assessment`, {
    method: 'POST',
    headers: bearer(tokens.owner),
    body: JSON.stringify({
      action: 'provide_portability',
      rationale: 'Prepare a structured owner-reviewed package for the verified requester.',
      legalBasisReference: 'GDPR Article 20 review',
      retentionPolicyReference: 'Contractor.AI retention policy 2026-01'
    })
  });
  assert.equal(assessed.response.status, 201, JSON.stringify(assessed.body));

  const resolved = await apiRequest(baseUrl, `/api/ledger/approvals/${assessed.body.approval.id}/resolve`, {
    method: 'POST',
    headers: bearer(tokens.approver),
    body: JSON.stringify({ status: 'approved', reason: 'Verified scope and source-current inventory independently reviewed.' })
  });
  assert.equal(resolved.response.status, 200, JSON.stringify(resolved.body));

  const exported = await apiRequest(baseUrl, `/api/operations/privacy/requests/${requestId}/export`, {
    headers: bearer(tokens.owner)
  });
  assert.equal(exported.response.status, 200, JSON.stringify(exported.body));
  assert.equal(exported.response.headers.get('cache-control'), 'private, no-store');
  assert.equal(exported.response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(exported.response.headers.get('x-contractor-ai-sha256'), /^[a-f0-9]{64}$/);
  assert.equal(exported.body.privacy.automaticallyDelivered, false);

  const capabilities = await apiRequest(baseUrl, '/api/operations/capabilities', { headers: bearer(tokens.owner) });
  assert.equal(capabilities.body.capabilities.retention.dataSubjectRequests, true);
  assert.equal(capabilities.body.capabilities.retention.extensionNotificationEvidence, 'requester_notification_reference_required');
  assert.equal(capabilities.body.capabilities.retention.fullErasureClaimed, false);
  const operationalExport = await apiRequest(baseUrl, '/api/operations/export', { headers: bearer(tokens.owner) });
  assert.equal(operationalExport.body.dataSubjectRequests.length, 1);
});
