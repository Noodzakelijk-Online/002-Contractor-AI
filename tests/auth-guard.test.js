const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { riskRegisterPayload } = require('./risk-register-fixture');

function loadServerWithEnv(env = {}) {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-auth-'));
  process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
  process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
  process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');
  process.env.NODE_ENV = env.NODE_ENV || 'test';

  if (env.CONTRACTOR_AI_REQUIRE_AUTH === undefined) {
    delete process.env.CONTRACTOR_AI_REQUIRE_AUTH;
  } else {
    process.env.CONTRACTOR_AI_REQUIRE_AUTH = env.CONTRACTOR_AI_REQUIRE_AUTH;
  }

  if (env.CONTRACTOR_AI_AUTH_TOKEN === undefined) {
    delete process.env.CONTRACTOR_AI_AUTH_TOKEN;
  } else {
    process.env.CONTRACTOR_AI_AUTH_TOKEN = env.CONTRACTOR_AI_AUTH_TOKEN;
  }

  if (env.CONTRACTOR_AI_ROLE_TOKENS === undefined) {
    delete process.env.CONTRACTOR_AI_ROLE_TOKENS;
  } else {
    process.env.CONTRACTOR_AI_ROLE_TOKENS = env.CONTRACTOR_AI_ROLE_TOKENS;
  }

  delete process.env.DASHBOARD_AUTH_TOKEN;
  delete require.cache[require.resolve('../server')];
  return require('../server');
}

async function withServer(app, run) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const body = await response.json();
  return { response, body };
}

test('production auth guard fails closed when auth is required without a strong token', async () => {
  const app = loadServerWithEnv({ NODE_ENV: 'production' });

  await withServer(app, async baseUrl => {
    const dashboard = await request(baseUrl, '/api/ledger/dashboard');
    assert.equal(dashboard.response.status, 503);
    assert.equal(dashboard.body.error.code, 'auth_not_configured');

    const health = await request(baseUrl, '/api/health');
    assert.equal(health.response.status, 503);
    assert.equal(health.body.error.code, 'auth_not_configured');

    const readiness = await request(baseUrl, '/api/health/ready');
    assert.equal(readiness.response.status, 503);
    assert.equal(readiness.body.status, 'attention');
    assert.equal(readiness.body.runtime, undefined);
    assert.equal(readiness.body.migrations, undefined);
  });
});

test('dashboard auth guard accepts bearer, API-key, contractor token, and browser basic auth', async () => {
  const token = 'contractor-ai-test-token-at-least-32-characters';
  const app = loadServerWithEnv({
    NODE_ENV: 'production',
    CONTRACTOR_AI_AUTH_TOKEN: token
  });

  await withServer(app, async baseUrl => {
    const denied = await request(baseUrl, '/api/ledger/dashboard');
    assert.equal(denied.response.status, 401);
    assert.equal(denied.body.error.code, 'authentication_required');
    assert.match(denied.response.headers.get('www-authenticate') || '', /Bearer realm="Contractor\.AI"/);

    const publicSession = await request(baseUrl, '/api/session');
    assert.equal(publicSession.response.status, 200);
    assert.equal(publicSession.body.authentication.required, true);
    assert.equal(publicSession.body.authentication.authenticated, false);
    assert.equal(publicSession.body.operator.authenticated, false);

    const deniedHealth = await request(baseUrl, '/api/health');
    assert.equal(deniedHealth.response.status, 401);
    assert.equal(deniedHealth.body.error.code, 'authentication_required');

    const deniedReadiness = await request(baseUrl, '/api/readiness');
    assert.equal(deniedReadiness.response.status, 401);
    assert.equal(deniedReadiness.body.error.code, 'authentication_required');

    const publicReadiness = await request(baseUrl, '/api/health/ready');
    assert.equal(publicReadiness.response.status, 200);
    assert.equal(publicReadiness.body.status, 'ready');
    assert.equal(publicReadiness.body.runtime, undefined);
    assert.equal(publicReadiness.body.migrations, undefined);

    const bearer = await request(baseUrl, '/api/ledger/dashboard', {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(bearer.response.status, 200);

    const authenticatedHealth = await request(baseUrl, '/api/health', {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(authenticatedHealth.response.status, 200);
    assert.equal(authenticatedHealth.body.runtime.auth.required, true);
    assert.ok(authenticatedHealth.body.migrations.currentVersion);

    const contractorHeader = await request(baseUrl, '/api/ledger/dashboard', {
      headers: { 'X-Contractor-AI-Token': token }
    });
    assert.equal(contractorHeader.response.status, 200);

    const apiKey = await request(baseUrl, '/api/ledger/dashboard', {
      headers: { 'X-API-Key': token }
    });
    assert.equal(apiKey.response.status, 200);

    const basicValue = Buffer.from(`contractor:${token}`).toString('base64');
    const basic = await request(baseUrl, '/api/ledger/dashboard', {
      headers: { Authorization: `Basic ${basicValue}` }
    });
    assert.equal(basic.response.status, 200);
  });
});

test('approved client portal tokens work without exposing the authenticated dashboard', async () => {
  const token = 'contractor-ai-client-portal-token-32';
  const app = loadServerWithEnv({
    NODE_ENV: 'production',
    CONTRACTOR_AI_AUTH_TOKEN: token
  });

  await withServer(app, async baseUrl => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const intake = await request(baseUrl, '/api/ledger/intake', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Authenticated portal job',
        client: { name: 'Portal access client' },
        address: 'Amsterdam',
        service: 'maintenance',
        description: 'Client-safe project status.'
      })
    });
    assert.equal(intake.response.status, 201);

    const selection = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/client-selections`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Authenticated paving choice',
        status: 'pending_client',
        options: ['Grey', 'Black'],
        clientVisible: true,
        requiresApproval: false
      })
    });
    assert.equal(selection.response.status, 201);

    const access = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/client-portal-access`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expiresAt: '2027-01-01' })
    });
    assert.equal(access.response.status, 201);

    const resolved = await request(baseUrl, `/api/ledger/approvals/${access.body.access.approval.id}/resolve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ status: 'approved', resolvedBy: 'Auth portal test' })
    });
    assert.equal(resolved.response.status, 200);

    const deniedDashboard = await request(baseUrl, '/api/ledger/dashboard');
    assert.equal(deniedDashboard.response.status, 401);

    const portal = await request(baseUrl, `/api/client-portal/${access.body.access.portalToken}`);
    assert.equal(portal.response.status, 200);
    assert.equal(portal.body.job.title, 'Authenticated portal job');

    const portalResponse = await request(
      baseUrl,
      `/api/client-portal/${access.body.access.portalToken}/selections/${selection.body.clientSelection.id}/responses`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responseId: 'auth-portal-response-0001',
          decision: 'accepted',
          selectedOption: 'Grey'
        })
      }
    );
    assert.equal(portalResponse.response.status, 201);
    assert.equal(portalResponse.body.approvalRequired, true);
    assert.equal(portalResponse.body.externalCommitments, 0);
    assert.equal(portalResponse.body.approval.targetType, 'client_selection_response');

    const stillDeniedDashboard = await request(baseUrl, '/api/ledger/dashboard');
    assert.equal(stillDeniedDashboard.response.status, 401);

    const invalidPortalResponse = await request(
      baseUrl,
      `/api/client-portal/not-a-real-token/selections/${selection.body.clientSelection.id}/responses`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responseId: 'auth-invalid-portal-response-0001',
          decision: 'accepted',
          selectedOption: 'Grey'
        })
      }
    );
    assert.equal(invalidPortalResponse.response.status, 404);

    const portalPage = await fetch(`${baseUrl}/client-portal.html`);
    assert.equal(portalPage.status, 200);
    assert.match(await portalPage.text(), /<div id="root"><\/div>/);
    assert.equal(portalPage.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.doesNotMatch(portalPage.headers.get('content-security-policy') || '', /unsafe-inline/);
  });
});

test('multiple field principals retain independent job scope and audit identity', async () => {
  const operators = [
    { id: 'owner-multi-field', role: 'owner', token: 'multi-field-owner-token-at-least-32-characters' },
    { id: 'field-north', name: 'North crew', role: 'field_worker', token: 'multi-field-north-token-at-least-32-characters', jobIds: ['job_field_north'] },
    { id: 'field-south', name: 'South crew', role: 'field_worker', token: 'multi-field-south-token-at-least-32-characters', jobIds: ['job_field_south'] }
  ];
  const app = loadServerWithEnv({
    NODE_ENV: 'production',
    CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify({ operators })
  });

  await withServer(app, async baseUrl => {
    const headersFor = principal => ({ Authorization: `Bearer ${principal.token}`, 'Content-Type': 'application/json' });
    const ownerHeaders = headersFor(operators[0]);
    const northHeaders = headersFor(operators[1]);
    const southHeaders = headersFor(operators[2]);

    for (const [id, title] of [['job_field_north', 'North scoped job'], ['job_field_south', 'South scoped job']]) {
      const intake = await request(baseUrl, '/api/ledger/intake', {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ ledgerJobId: id, title, client: { name: `${title} client` }, assignAutomatically: false })
      });
      assert.equal(intake.response.status, 201);
      assert.equal(intake.body.job.id, id);
    }

    const northSession = await request(baseUrl, '/api/session', { headers: northHeaders });
    const southSession = await request(baseUrl, '/api/session', { headers: southHeaders });
    assert.equal(northSession.body.operator.id, 'field-north');
    assert.equal(northSession.body.operator.name, 'North crew');
    assert.equal(southSession.body.operator.id, 'field-south');
    assert.equal(southSession.body.operator.name, 'South crew');

    const northJobs = await request(baseUrl, '/api/ledger/jobs?limit=100', { headers: northHeaders });
    const southJobs = await request(baseUrl, '/api/ledger/jobs?limit=100', { headers: southHeaders });
    assert.deepEqual(northJobs.body.jobs.map(job => job.id), ['job_field_north']);
    assert.deepEqual(southJobs.body.jobs.map(job => job.id), ['job_field_south']);

    const northProgress = await request(baseUrl, '/api/ledger/jobs/job_field_north/progress', {
      method: 'POST',
      headers: northHeaders,
      body: JSON.stringify({ entryKey: 'north-principal-progress-0001', status: 'in_progress', progressPercent: 20, note: 'North crew retained its own update.' })
    });
    const southProgress = await request(baseUrl, '/api/ledger/jobs/job_field_south/progress', {
      method: 'POST',
      headers: southHeaders,
      body: JSON.stringify({ entryKey: 'south-principal-progress-0001', status: 'in_progress', progressPercent: 30, note: 'South crew retained its own update.' })
    });
    assert.equal(northProgress.response.status, 201);
    assert.equal(southProgress.response.status, 201);

    const deniedCrossScope = await request(baseUrl, '/api/ledger/jobs/job_field_south/progress', {
      method: 'POST',
      headers: northHeaders,
      body: JSON.stringify({ entryKey: 'north-cross-scope-progress-0001', status: 'in_progress', progressPercent: 40, note: 'This must be denied.' })
    });
    assert.equal(deniedCrossScope.response.status, 403);
    assert.equal(deniedCrossScope.body.error.code, 'field_job_scope_forbidden');

    const northDetail = await request(baseUrl, '/api/ledger/jobs/job_field_north', { headers: ownerHeaders });
    const southDetail = await request(baseUrl, '/api/ledger/jobs/job_field_south', { headers: ownerHeaders });
    assert.ok(northDetail.body.job.audit.some(event => event.action === 'record_progress' && event.actor === 'role:field_worker:field-north'));
    assert.ok(southDetail.body.job.audit.some(event => event.action === 'record_progress' && event.actor === 'role:field_worker:field-south'));
  });
});

test('role tokens limit operator mutations to their authorized ledger workflow', async () => {
  const tokens = {
    owner: 'owner-role-token-at-least-32-chars',
    approver: 'approver-role-token-at-least-32-chars',
    office_operator: 'office-role-token-at-least-32-chars',
    field_worker: {
      token: 'field-role-token-at-least-32-chars',
      workerId: 'field-worker-role-scope'
    }
  };
  const app = loadServerWithEnv({
    NODE_ENV: 'production',
    CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify(tokens)
  });

  await withServer(app, async baseUrl => {
    const ownerHeaders = { Authorization: `Bearer ${tokens.owner}`, 'Content-Type': 'application/json' };
    const fieldHeaders = { Authorization: `Bearer ${tokens.field_worker.token}`, 'Content-Type': 'application/json' };
    const approverHeaders = { Authorization: `Bearer ${tokens.approver}`, 'Content-Type': 'application/json' };
    const officeHeaders = { Authorization: `Bearer ${tokens.office_operator}`, 'Content-Type': 'application/json' };

    const fieldSession = await request(baseUrl, '/api/session', { headers: fieldHeaders });
    assert.equal(fieldSession.response.status, 200);
    assert.equal(fieldSession.body.operator.role, 'field_worker');
    assert.equal(fieldSession.body.operator.fieldScoped, true);
    assert.equal(fieldSession.body.operator.capabilities.dashboard, false);
    assert.equal(fieldSession.body.operator.capabilities.resources, false);
    assert.equal(fieldSession.body.operator.capabilities.finance, false);
    assert.equal(fieldSession.body.operator.capabilities.clientSuccess, false);
    assert.equal(fieldSession.body.operator.capabilities.fieldEvidence, true);
    assert.equal(fieldSession.body.operator.worker.id, 'field-worker-role-scope');

    const officeSession = await request(baseUrl, '/api/session', { headers: officeHeaders });
    assert.equal(officeSession.response.status, 200);
    assert.equal(officeSession.body.operator.capabilities.intake, true);
    assert.equal(officeSession.body.operator.capabilities.approvals, false);
    assert.equal(officeSession.body.operator.capabilities.resources, true);
    assert.equal(officeSession.body.operator.capabilities.finance, true);
    assert.equal(officeSession.body.operator.capabilities.clientSuccess, true);
    assert.equal(officeSession.body.operator.capabilities.fieldEvidence, true);

    const approverSession = await request(baseUrl, '/api/session', { headers: approverHeaders });
    assert.equal(approverSession.response.status, 200);
    assert.equal(approverSession.body.operator.capabilities.approvals, true);
    assert.equal(approverSession.body.operator.capabilities.resources, true);
    assert.equal(approverSession.body.operator.capabilities.finance, true);
    assert.equal(approverSession.body.operator.capabilities.clientSuccess, true);
    assert.equal(approverSession.body.operator.capabilities.fieldEvidence, false);

    const officeIntake = await request(baseUrl, '/api/ledger/intake', {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ title: 'Role audit fixture', client: { name: 'Role Client' }, address: 'Utrecht' })
    });
    assert.equal(officeIntake.response.status, 201);
    const ownerBackup = await request(baseUrl, '/api/operations/backup', {
      method: 'POST',
      headers: ownerHeaders,
      body: '{}'
    });
    assert.equal(ownerBackup.response.status, 201);
    const ownerAudit = await request(baseUrl, '/api/ledger/audit?limit=5&includeFacets=true', { headers: ownerHeaders });
    assert.equal(ownerAudit.response.status, 200);
    assert.ok(ownerAudit.body.events.length > 0);
    assert.ok(ownerAudit.body.page);
    assert.ok(ownerAudit.body.facets);
    const deniedOfficeAudit = await request(baseUrl, '/api/ledger/audit?limit=5', { headers: officeHeaders });
    assert.equal(deniedOfficeAudit.response.status, 403);
    assert.equal(deniedOfficeAudit.body.error.code, 'insufficient_role');
    const deniedApproverAudit = await request(baseUrl, '/api/ledger/audit?limit=5', { headers: approverHeaders });
    assert.equal(deniedApproverAudit.response.status, 403);
    assert.equal(deniedApproverAudit.body.error.code, 'insufficient_role');
    const deniedOfficeBackup = await request(baseUrl, `/api/operations/backups/${encodeURIComponent(ownerBackup.body.backup.backupId)}/download`, {
      headers: officeHeaders
    });
    assert.equal(deniedOfficeBackup.response.status, 403);
    assert.equal(deniedOfficeBackup.body.error.code, 'insufficient_role');
    const ownerBackupDownload = await fetch(`${baseUrl}/api/operations/backups/${encodeURIComponent(ownerBackup.body.backup.backupId)}/download`, {
      headers: { Authorization: `Bearer ${tokens.owner}` }
    });
    assert.equal(ownerBackupDownload.status, 200);
    assert.equal(ownerBackupDownload.headers.get('content-type'), 'application/gzip');
    await ownerBackupDownload.arrayBuffer();

    const deniedFieldResources = await request(baseUrl, '/api/ledger/workforce?limit=10', { headers: fieldHeaders });
    assert.equal(deniedFieldResources.response.status, 403);
    assert.equal(deniedFieldResources.body.error.code, 'insufficient_role');

    const deniedFieldClients = await request(baseUrl, '/api/ledger/client-success?limit=10', { headers: fieldHeaders });
    assert.equal(deniedFieldClients.response.status, 403);
    assert.equal(deniedFieldClients.body.error.code, 'insufficient_role');

    const deniedFieldAssurance = await request(baseUrl, '/api/ledger/field-assurance?limit=10', { headers: fieldHeaders });
    assert.equal(deniedFieldAssurance.response.status, 403);
    assert.equal(deniedFieldAssurance.body.error.code, 'insufficient_role');

    const officeResources = await request(baseUrl, '/api/ledger/inventory?limit=10', { headers: officeHeaders });
    assert.equal(officeResources.response.status, 200);

    const officeClients = await request(baseUrl, '/api/ledger/client-success?limit=10', { headers: officeHeaders });
    assert.equal(officeClients.response.status, 200);

    const officeSchedule = await request(baseUrl, '/api/ledger/schedule?limit=10', { headers: officeHeaders });
    assert.equal(officeSchedule.response.status, 200);
    const approverSchedule = await request(baseUrl, '/api/ledger/schedule?limit=10', { headers: approverHeaders });
    assert.equal(approverSchedule.response.status, 200);
    const deniedFieldSchedule = await request(baseUrl, '/api/ledger/schedule?limit=10', { headers: fieldHeaders });
    assert.equal(deniedFieldSchedule.response.status, 403);
    assert.equal(deniedFieldSchedule.body.error.code, 'insufficient_role');

    const officeClientRecord = await request(baseUrl, '/api/ledger/clients', {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({
        name: 'Role governed client',
        company: 'Role Governed Client BV',
        email: 'role-client@example.test',
        address: 'Role Street 10',
        postalCode: '3511 AA',
        city: 'Utrecht',
        registrationNumber: '12345678',
        actor: 'spoofed-owner'
      })
    });
    assert.equal(officeClientRecord.response.status, 201);
    assert.equal(officeClientRecord.body.client.readiness.structuredInvoiceReady, true);

    const officeClientDirectory = await request(baseUrl, '/api/ledger/clients?search=Role%20Governed&limit=10', { headers: officeHeaders });
    assert.equal(officeClientDirectory.response.status, 200);
    assert.equal(officeClientDirectory.body.clients[0].id, officeClientRecord.body.client.id);
    const approverClientDirectory = await request(baseUrl, '/api/ledger/clients?search=Role%20Governed&limit=10', { headers: approverHeaders });
    assert.equal(approverClientDirectory.response.status, 200);
    const deniedFieldClientDirectory = await request(baseUrl, '/api/ledger/clients?limit=10', { headers: fieldHeaders });
    assert.equal(deniedFieldClientDirectory.response.status, 403);
    assert.equal(deniedFieldClientDirectory.body.error.code, 'insufficient_role');
    const governedClientAudit = await request(
      baseUrl,
      `/api/ledger/audit?entityId=${encodeURIComponent(officeClientRecord.body.client.id)}&limit=10`,
      { headers: ownerHeaders }
    );
    assert.ok(governedClientAudit.body.events.some(event => (
      event.action === 'create_client' && event.actor === 'role:office_operator'
    )));

    const officeAssurance = await request(baseUrl, '/api/ledger/field-assurance?limit=10', { headers: officeHeaders });
    assert.equal(officeAssurance.response.status, 200);

    const approverResources = await request(baseUrl, '/api/ledger/workforce?limit=10', { headers: approverHeaders });
    assert.equal(approverResources.response.status, 200);

    const approverClients = await request(baseUrl, '/api/ledger/client-success?limit=10', { headers: approverHeaders });
    assert.equal(approverClients.response.status, 200);

    const approverAssurance = await request(baseUrl, '/api/ledger/field-assurance?limit=10', { headers: approverHeaders });
    assert.equal(approverAssurance.response.status, 200);

    const worker = await request(baseUrl, '/api/ledger/workers', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ id: 'field-worker-role-scope', name: 'Scoped field worker', role: 'Installer', status: 'available', hourlyRate: 63 })
    });
    assert.equal(worker.response.status, 201);
    const approverWorkerDetail = await request(baseUrl, '/api/ledger/workers/field-worker-role-scope', { headers: approverHeaders });
    assert.equal(approverWorkerDetail.response.status, 200);
    const deniedFieldWorkerDirectory = await request(baseUrl, '/api/ledger/workers?limit=10', { headers: fieldHeaders });
    assert.equal(deniedFieldWorkerDirectory.response.status, 403);
    assert.equal(deniedFieldWorkerDirectory.body.error.code, 'insufficient_role');
    const officeQualifications = await request(baseUrl, '/api/ledger/qualifications', { headers: officeHeaders });
    assert.equal(officeQualifications.response.status, 200);
    const approverQualifications = await request(baseUrl, '/api/ledger/qualifications', { headers: approverHeaders });
    assert.equal(approverQualifications.response.status, 200);
    const deniedFieldQualifications = await request(baseUrl, '/api/ledger/qualifications', { headers: fieldHeaders });
    assert.equal(deniedFieldQualifications.response.status, 403);
    assert.equal(deniedFieldQualifications.body.error.code, 'insufficient_role');
    const deniedApproverCredentialMutation = await request(baseUrl, '/api/ledger/workers/field-worker-role-scope/credentials', {
      method: 'POST',
      headers: approverHeaders,
      body: JSON.stringify({ credentialType: 'vca_basic', evidenceReference: 'Unauthorized approver mutation.' })
    });
    assert.equal(deniedApproverCredentialMutation.response.status, 403);
    assert.equal(deniedApproverCredentialMutation.body.error.code, 'insufficient_role');
    const officeAvailability = await request(baseUrl, '/api/ledger/availability', { headers: officeHeaders });
    assert.equal(officeAvailability.response.status, 200);
    const approverAvailability = await request(baseUrl, '/api/ledger/availability', { headers: approverHeaders });
    assert.equal(approverAvailability.response.status, 200);
    const deniedFieldAvailability = await request(baseUrl, '/api/ledger/availability', { headers: fieldHeaders });
    assert.equal(deniedFieldAvailability.response.status, 403);
    assert.equal(deniedFieldAvailability.body.error.code, 'insufficient_role');
    const availabilityStartsAt = new Date(Date.now() + 45 * 86_400_000).toISOString();
    const availabilityEndsAt = new Date(Date.parse(availabilityStartsAt) + 8 * 3_600_000).toISOString();
    const deniedApproverAvailabilityMutation = await request(baseUrl, '/api/ledger/workers/field-worker-role-scope/availability', {
      method: 'POST',
      headers: approverHeaders,
      body: JSON.stringify({ periodType: 'training', startsAt: availabilityStartsAt, endsAt: availabilityEndsAt })
    });
    assert.equal(deniedApproverAvailabilityMutation.response.status, 403);
    assert.equal(deniedApproverAvailabilityMutation.body.error.code, 'insufficient_role');
    const authorizedOfficeAvailability = await request(baseUrl, '/api/ledger/workers/field-worker-role-scope/availability', {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ periodType: 'training', startsAt: availabilityStartsAt, endsAt: availabilityEndsAt, notes: 'Role-governed capacity record.' })
    });
    assert.equal(authorizedOfficeAvailability.response.status, 201);
    assert.equal(authorizedOfficeAvailability.body.period.status, 'active');

    const officeRetirementWorker = await request(baseUrl, '/api/ledger/workers', {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ name: 'Office retirement role worker', role: 'Painter', status: 'available' })
    });
    assert.equal(officeRetirementWorker.response.status, 201);
    const workerRetirementPath = `/api/ledger/workers/${officeRetirementWorker.body.worker.id}/retirement`;
    const deniedFieldWorkerRetirement = await request(baseUrl, workerRetirementPath, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify({ reason: 'Field role cannot request workforce retirement.' })
    });
    assert.equal(deniedFieldWorkerRetirement.response.status, 403);
    const deniedApproverWorkerRetirement = await request(baseUrl, workerRetirementPath, {
      method: 'POST',
      headers: approverHeaders,
      body: JSON.stringify({ reason: 'Approver role cannot request workforce retirement.' })
    });
    assert.equal(deniedApproverWorkerRetirement.response.status, 403);
    const authorizedOfficeWorkerRetirement = await request(baseUrl, workerRetirementPath, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ reason: 'Office operator requests retained workforce retirement review.' })
    });
    assert.equal(authorizedOfficeWorkerRetirement.response.status, 200);
    assert.equal(authorizedOfficeWorkerRetirement.body.approval.targetType, 'worker_retirement');

    const intake = await request(baseUrl, '/api/ledger/intake', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ title: 'Role-bound roof inspection', client: { name: 'Role Client' }, address: 'Utrecht', workerId: 'field-worker-role-scope' })
    });
    assert.equal(intake.response.status, 201);

    const archivePayload = JSON.stringify({ reason: 'Archive role boundary verification request.' });
    const deniedFieldArchive = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/archive`, {
      method: 'POST',
      headers: fieldHeaders,
      body: archivePayload
    });
    assert.equal(deniedFieldArchive.response.status, 403);
    assert.equal(deniedFieldArchive.body.error.code, 'insufficient_role');
    const deniedApproverArchive = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/archive`, {
      method: 'POST',
      headers: approverHeaders,
      body: archivePayload
    });
    assert.equal(deniedApproverArchive.response.status, 403);
    assert.equal(deniedApproverArchive.body.error.code, 'insufficient_role');
    const authorizedOfficeArchive = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/archive`, {
      method: 'POST',
      headers: officeHeaders,
      body: archivePayload
    });
    assert.equal(authorizedOfficeArchive.response.status, 409);
    assert.equal(authorizedOfficeArchive.body.error.code, 'job_archive_blocked_by_approvals');

    const deniedFieldCapabilityPlan = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/capability-plan`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify({ mode: 'preview', requirementKeys: ['documents'] })
    });
    assert.equal(deniedFieldCapabilityPlan.response.status, 403);
    assert.equal(deniedFieldCapabilityPlan.body.error.code, 'insufficient_role');
    const officeCapabilityPreview = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/capability-plan`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ mode: 'preview', requirementKeys: ['documents', 'incident'] })
    });
    assert.equal(officeCapabilityPreview.response.status, 201);
    assert.ok(officeCapabilityPreview.body.actions.some(action => action.requirementKey === 'documents' && action.safeDraftable === true));
    assert.ok(officeCapabilityPreview.body.actions.some(action => action.requirementKey === 'incident' && action.blockedFromAutonomy === true));

    const commandPlan = await request(baseUrl, `/api/ledger/command-plan?mode=safe&limit=100&jobId=${encodeURIComponent(intake.body.job.id)}`, { headers: ownerHeaders });
    assert.equal(commandPlan.response.status, 200);
    const capabilityCommand = commandPlan.body.actions.find(action => action.actionType === 'draft_capability_gap');
    assert.ok(capabilityCommand);
    const deniedOfficeCommandApply = await request(baseUrl, '/api/ledger/command-plan', {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ actionIds: [capabilityCommand.id], limit: 1 })
    });
    assert.equal(deniedOfficeCommandApply.response.status, 403);
    assert.equal(deniedOfficeCommandApply.body.error.code, 'insufficient_role');
    const deniedOfficeAutonomousCycle = await request(baseUrl, '/api/ledger/autonomous-cycle', {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ dryRun: false, maxActions: 1 })
    });
    assert.equal(deniedOfficeAutonomousCycle.response.status, 403);
    assert.equal(deniedOfficeAutonomousCycle.body.error.code, 'insufficient_role');
    const deniedApproverAutonomousPreview = await request(baseUrl, '/api/ledger/autonomous-cycle', {
      method: 'POST',
      headers: approverHeaders,
      body: JSON.stringify({ dryRun: true, maxActions: 1 })
    });
    assert.equal(deniedApproverAutonomousPreview.response.status, 403);
    assert.equal(deniedApproverAutonomousPreview.body.error.code, 'insufficient_role');
    const ownerCommandApply = await request(baseUrl, '/api/ledger/command-plan', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ actionIds: [capabilityCommand.id], limit: 1, actor: 'owner-role-test' })
    });
    assert.equal(ownerCommandApply.response.status, 201, JSON.stringify({ action: capabilityCommand, response: ownerCommandApply.body }));
    assert.equal(ownerCommandApply.body.summary.selected, 1);
    assert.equal(ownerCommandApply.body.summary.externalCommitments, 0);

    const unassigned = await request(baseUrl, '/api/ledger/intake', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ title: 'Unassigned role-bound job', client: { name: 'Other Role Client' }, assignAutomatically: false })
    });
    assert.equal(unassigned.response.status, 201);

    const deniedFieldPack = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/field-assurance-pack`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify({})
    });
    assert.equal(deniedFieldPack.response.status, 403);
    assert.equal(deniedFieldPack.body.error.code, 'insufficient_role');

    const deniedApproverPack = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/field-assurance-pack`, {
      method: 'POST',
      headers: approverHeaders,
      body: JSON.stringify({})
    });
    assert.equal(deniedApproverPack.response.status, 403);
    assert.equal(deniedApproverPack.body.error.code, 'insufficient_role');

    const officePack = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/field-assurance-pack`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({})
    });
    assert.equal(officePack.response.status, 201);
    assert.equal(officePack.body.pack.externalCommitments, 0);

    const material = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/materials`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ name: 'Role-bound membrane', quantity: 4, unit: 'rolls', status: 'needed' })
    });
    assert.equal(material.response.status, 201);

    const deniedFieldMaterialStatus = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/materials/${material.body.materialRequirement.id}/status`, {
      method: 'PATCH',
      headers: fieldHeaders,
      body: JSON.stringify({ status: 'available', availableQuantity: 4, verificationReference: 'FIELD-ROLE-REF', notes: 'Unauthorized field material transition.' })
    });
    assert.equal(deniedFieldMaterialStatus.response.status, 403);
    assert.equal(deniedFieldMaterialStatus.body.error.code, 'insufficient_role');

    const deniedApproverMaterialStatus = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/materials/${material.body.materialRequirement.id}/status`, {
      method: 'PATCH',
      headers: approverHeaders,
      body: JSON.stringify({ status: 'available', availableQuantity: 4, verificationReference: 'APPROVER-ROLE-REF', notes: 'Unauthorized approver material transition.' })
    });
    assert.equal(deniedApproverMaterialStatus.response.status, 403);
    assert.equal(deniedApproverMaterialStatus.body.error.code, 'insufficient_role');

    const officeMaterialStatus = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/materials/${material.body.materialRequirement.id}/status`, {
      method: 'PATCH',
      headers: officeHeaders,
      body: JSON.stringify({ status: 'available', availableQuantity: 4, location: 'Warehouse role bay', verificationReference: 'OFFICE-ROLE-REF', notes: 'Authorized office material verification.' })
    });
    assert.equal(officeMaterialStatus.response.status, 200);
    assert.equal(officeMaterialStatus.body.materialRequirement.status, 'available');
    assert.equal(officeMaterialStatus.body.externalCommitments, 0);

    const tradePartnerPayload = JSON.stringify({
      name: 'Role Test Supplier',
      partnerType: 'supplier',
      registrationNumber: '11223344',
      vatNumber: 'NL123456789B01',
      verificationReference: 'Role boundary registry check',
      verifiedAt: new Date(Date.now() - 86_400_000).toISOString()
    });
    const deniedFieldPartner = await request(baseUrl, '/api/ledger/trade-partners', {
      method: 'POST',
      headers: fieldHeaders,
      body: tradePartnerPayload
    });
    assert.equal(deniedFieldPartner.response.status, 403);
    assert.equal(deniedFieldPartner.body.error.code, 'insufficient_role');
    const deniedApproverPartner = await request(baseUrl, '/api/ledger/trade-partners', {
      method: 'POST',
      headers: approverHeaders,
      body: tradePartnerPayload
    });
    assert.equal(deniedApproverPartner.response.status, 403);
    assert.equal(deniedApproverPartner.body.error.code, 'insufficient_role');
    const officePartner = await request(baseUrl, '/api/ledger/trade-partners', {
      method: 'POST',
      headers: officeHeaders,
      body: tradePartnerPayload
    });
    assert.equal(officePartner.response.status, 201);
    assert.equal(officePartner.body.partner.compliance.status, 'verified');
    const approverPartners = await request(baseUrl, '/api/ledger/trade-partners', { headers: approverHeaders });
    assert.equal(approverPartners.response.status, 200);
    assert.ok(approverPartners.body.partners.some(partner => partner.id === officePartner.body.partner.id));
    const deniedFieldPartners = await request(baseUrl, '/api/ledger/trade-partners', { headers: fieldHeaders });
    assert.equal(deniedFieldPartners.response.status, 403);

    const procurementDraft = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/procurement-orders`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        supplier: 'Role Test Supplier',
        tradePartnerId: officePartner.body.partner.id,
        status: 'draft',
        amount: 120,
        approvalThreshold: 1000,
        requiredBy: '2026-08-01T08:00:00.000Z',
        items: [{ name: 'Role-bound membrane', quantity: 4, unitCost: 30 }],
        notes: 'Retained office procurement draft.'
      })
    });
    assert.equal(procurementDraft.response.status, 201);
    assert.equal(procurementDraft.body.procurementOrder.status, 'draft');

    const procurementRoute = `/api/ledger/jobs/${intake.body.job.id}/procurement-orders/${procurementDraft.body.procurementOrder.id}/request-approval`;
    const procurementApprovalBody = JSON.stringify({
      supplier: 'Role Test Supplier',
      tradePartnerId: officePartner.body.partner.id,
      amount: 120,
      requiredBy: '2026-08-01T08:00:00.000Z',
      notes: 'Retained supplier, item, and price evidence for approval.'
    });
    const deniedFieldProcurement = await request(baseUrl, procurementRoute, { method: 'POST', headers: fieldHeaders, body: procurementApprovalBody });
    assert.equal(deniedFieldProcurement.response.status, 403);
    assert.equal(deniedFieldProcurement.body.error.code, 'insufficient_role');
    const deniedApproverProcurement = await request(baseUrl, procurementRoute, { method: 'POST', headers: approverHeaders, body: procurementApprovalBody });
    assert.equal(deniedApproverProcurement.response.status, 403);
    assert.equal(deniedApproverProcurement.body.error.code, 'insufficient_role');
    const officeProcurement = await request(baseUrl, procurementRoute, { method: 'POST', headers: officeHeaders, body: procurementApprovalBody });
    assert.equal(officeProcurement.response.status, 200);
    assert.equal(officeProcurement.body.procurementOrder.status, 'pending_approval');
    assert.equal(officeProcurement.body.approval.targetType, 'procurement_order');

    const selection = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/client-selections`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ title: 'Role-bound finish', status: 'pending_client', options: ['white', 'graphite'] })
    });
    assert.equal(selection.response.status, 201);

    const deniedFieldSelection = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/lifecycle/selection/${selection.body.clientSelection.id}`, {
      method: 'PATCH',
      headers: fieldHeaders,
      body: JSON.stringify({ status: 'selected', selectedOption: 'white', verificationReference: 'FIELD-SELECTION-REF', notes: 'Unauthorized field selection decision.' })
    });
    assert.equal(deniedFieldSelection.response.status, 403);
    assert.equal(deniedFieldSelection.body.error.code, 'insufficient_role');

    const deniedApproverSelection = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/lifecycle/selection/${selection.body.clientSelection.id}`, {
      method: 'PATCH',
      headers: approverHeaders,
      body: JSON.stringify({ status: 'selected', selectedOption: 'white', verificationReference: 'APPROVER-SELECTION-REF', notes: 'Unauthorized approver selection mutation.' })
    });
    assert.equal(deniedApproverSelection.response.status, 403);
    assert.equal(deniedApproverSelection.body.error.code, 'insufficient_role');

    const officeSelection = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/lifecycle/selection/${selection.body.clientSelection.id}`, {
      method: 'PATCH',
      headers: officeHeaders,
      body: JSON.stringify({ status: 'selected', selectedOption: 'white', verificationReference: 'OFFICE-SELECTION-REF', notes: 'Authorized office selection evidence.' })
    });
    assert.equal(officeSelection.response.status, 200);
    assert.equal(officeSelection.body.record.status, 'pending_approval');
    assert.equal(officeSelection.body.approval.targetType, 'client_selection');

    const deniedFieldFinanceCosts = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/finance-costs`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify({ expense: { amount: 25, vendor: 'Role Test Vendor', notes: 'Unauthorized office finance mutation.' } })
    });
    assert.equal(deniedFieldFinanceCosts.response.status, 403);
    assert.equal(deniedFieldFinanceCosts.body.error.code, 'insufficient_role');

    const deniedApproverFinanceCosts = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/finance-costs`, {
      method: 'POST',
      headers: approverHeaders,
      body: JSON.stringify({ expense: { amount: 25, vendor: 'Role Test Vendor', notes: 'Unauthorized approver finance mutation.' } })
    });
    assert.equal(deniedApproverFinanceCosts.response.status, 403);
    assert.equal(deniedApproverFinanceCosts.body.error.code, 'insufficient_role');

    const officeFinanceCosts = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/finance-costs`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ expense: { amount: 25, vendor: 'Role Test Vendor', notes: 'Authorized office finance evidence.' } })
    });
    assert.equal(officeFinanceCosts.response.status, 201);
    assert.equal(officeFinanceCosts.body.costs.expense.amount, 25);

    const fieldJobs = await request(baseUrl, '/api/ledger/jobs?limit=100', { headers: fieldHeaders });
    assert.equal(fieldJobs.response.status, 200);
    assert.ok(fieldJobs.body.jobs.some(job => job.id === intake.body.job.id));
    assert.ok(!fieldJobs.body.jobs.some(job => job.id === unassigned.body.job.id));

    const deniedOtherJob = await request(baseUrl, `/api/ledger/jobs/${unassigned.body.job.id}`, { headers: fieldHeaders });
    assert.equal(deniedOtherJob.response.status, 403);
    assert.equal(deniedOtherJob.body.error.code, 'field_job_scope_forbidden');

    const blockedIntake = await request(baseUrl, '/api/ledger/intake', {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify({ title: 'Unauthorized job', client: { name: 'Blocked' } })
    });
    assert.equal(blockedIntake.response.status, 403);
    assert.equal(blockedIntake.body.error.code, 'insufficient_role');

    const evidence = new FormData();
    evidence.append('evidenceFile', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('field proof')], { type: 'image/jpeg' }), 'roof-photo.jpg');
    evidence.append('jobId', intake.body.job.id);
    evidence.append('attachToBuild', 'true');
    const fieldUpload = await fetch(`${baseUrl}/api/ledger/upload`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.field_worker.token}` }, body: evidence });
    const fieldUploadBody = await fieldUpload.json();
    assert.equal(fieldUpload.status, 200);
    assert.ok(fieldUploadBody.ledgerDocument.id);
    assert.ok(fieldUploadBody.ledgerFollowUp.records.progress.id);

    const detail = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}`, { headers: ownerHeaders });
    assert.equal(detail.response.status, 200);
    assert.ok(detail.body.job.audit.some(event => event.action === 'store_document' && event.actor === 'role:field_worker'));
    assert.ok(detail.body.job.progress.some(update => update.id === fieldUploadBody.ledgerFollowUp.records.progress.id));

    const fieldProgress = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/progress`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify({ entryKey: 'field-progress-role-0001', status: 'in_progress', progressPercent: 35, note: 'Field crew completed the first work area.', actor: 'spoofed-owner' })
    });
    assert.equal(fieldProgress.response.status, 201);
    assert.equal(fieldProgress.body.progress.progressPercent, 35);
    assert.equal(fieldProgress.body.progress.replayed, false);
    assert.equal(Object.hasOwn(fieldProgress.body.progress, 'data'), false);

    const fieldProgressReplay = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/progress`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify({ entryKey: 'field-progress-role-0001', status: 'in_progress', progressPercent: 35, note: 'Field crew completed the first work area.' })
    });
    assert.equal(fieldProgressReplay.response.status, 201);
    assert.equal(fieldProgressReplay.body.progress.id, fieldProgress.body.progress.id);
    assert.equal(fieldProgressReplay.body.progress.replayed, true);

    const fieldProgressConflict = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/progress`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify({ entryKey: 'field-progress-role-0001', status: 'blocked', progressPercent: 35, note: 'Changed content must not reuse this field retry key.' })
    });
    assert.equal(fieldProgressConflict.response.status, 409);
    assert.equal(fieldProgressConflict.body.error.code, 'progress_entry_key_reused');

    const fieldDailyLog = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/daily-logs`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify({
        workerId: officeRetirementWorker.body.worker.id,
        workerName: 'Spoofed office worker',
        rate: 999,
        actor: 'spoofed-owner',
        workDate: '2026-07-13',
        hours: 6.5,
        manpower: 2,
        weather: 'cloudy',
        workCompleted: 'Installed and checked the assigned roof edge protection.',
        blockers: 'Awaiting the next material delivery',
        safetyConcern: false
      })
    });
    assert.equal(fieldDailyLog.response.status, 201);
    assert.equal(fieldDailyLog.body.dailyLog.timeLog.workerId, 'field-worker-role-scope');
    assert.equal(Object.hasOwn(fieldDailyLog.body.dailyLog.timeLog, 'rate'), false);
    assert.equal(Object.hasOwn(fieldDailyLog.body.dailyLog.timeLog, 'data'), false);
    assert.equal(typeof fieldDailyLog.body.dailyLog.approvals, 'number');
    assert.equal(Object.hasOwn(fieldDailyLog.body.job, 'estimatedCost'), false);
    assert.equal(Object.hasOwn(fieldDailyLog.body.job, 'quotes'), false);
    assert.equal(Object.hasOwn(fieldDailyLog.body.job, 'expenses'), false);
    assert.equal(Object.hasOwn(fieldDailyLog.body.job, 'clientEmail'), false);

    const fieldObservationPayload = {
      entryKey: 'field-observation-role-0001',
      category: 'quality',
      title: 'Roof edge fixing requires review',
      severity: 'medium',
      responsible: 'Role Field Worker',
      dueAt: '2026-07-20',
      notes: 'One retained fixing location differs from the approved setting-out record.',
      evidenceDocumentIds: [fieldUploadBody.ledgerDocument.id],
      actor: 'spoofed-owner'
    };
    const fieldObservation = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/observations`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify(fieldObservationPayload)
    });
    assert.equal(fieldObservation.response.status, 201);
    assert.equal(fieldObservation.body.replayed, false);
    assert.equal(fieldObservation.body.observation.replayed, false);
    assert.equal(Object.hasOwn(fieldObservation.body.observation, 'data'), false);
    assert.equal(Object.hasOwn(fieldObservation.body.observation, 'approvalId'), false);

    const fieldObservationReplay = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/observations`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify(fieldObservationPayload)
    });
    assert.equal(fieldObservationReplay.response.status, 201);
    assert.equal(fieldObservationReplay.body.replayed, true);
    assert.equal(fieldObservationReplay.body.observation.id, fieldObservation.body.observation.id);

    const fieldIncidentPayload = {
      entryKey: 'field-incident-role-0001',
      incidentType: 'near_miss',
      title: 'Loose material moved beside access route',
      severity: 'high',
      occurredAt: '2026-07-16T08:30:00.000Z',
      reportedBy: 'Role Field Worker',
      description: 'A loose panel shifted beside the occupied access route.',
      immediateAction: 'Work stopped and the access route was isolated.',
      evidenceDocumentIds: [fieldUploadBody.ledgerDocument.id],
      requiresApproval: true,
      actor: 'spoofed-owner'
    };
    const fieldIncident = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/incidents`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify(fieldIncidentPayload)
    });
    assert.equal(fieldIncident.response.status, 201);
    assert.equal(fieldIncident.body.replayed, false);
    assert.equal(Object.hasOwn(fieldIncident.body.incident, 'data'), false);
    assert.equal(Object.hasOwn(fieldIncident.body.incident, 'approval'), false);

    const fieldPunchPayload = {
      entryKey: 'field-punch-role-0001',
      title: 'Door frame finish requires correction',
      severity: 'medium',
      assignee: 'Role Field Worker',
      dueAt: '2026-07-22',
      location: 'Level 2 room 2.14',
      description: 'Paint edge is incomplete at the retained frame location.',
      evidenceDocumentIds: [fieldUploadBody.ledgerDocument.id],
      actor: 'spoofed-owner'
    };
    const fieldPunch = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/punch-items`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify(fieldPunchPayload)
    });
    assert.equal(fieldPunch.response.status, 201);
    assert.equal(fieldPunch.body.replayed, false);
    assert.equal(fieldPunch.body.punchItem.replayed, false);
    assert.equal(Object.hasOwn(fieldPunch.body.punchItem, 'data'), false);
    assert.equal(Object.hasOwn(fieldPunch.body.punchItem, 'approvalId'), false);

    const fieldPunchReplay = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/punch-items`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify(fieldPunchPayload)
    });
    assert.equal(fieldPunchReplay.response.status, 201);
    assert.equal(fieldPunchReplay.body.replayed, true);
    assert.equal(fieldPunchReplay.body.punchItem.id, fieldPunch.body.punchItem.id);

    const deniedOtherIncident = await request(baseUrl, `/api/ledger/jobs/${unassigned.body.job.id}/incidents`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify({ ...fieldIncidentPayload, entryKey: 'field-incident-denied-0001' })
    });
    assert.equal(deniedOtherIncident.response.status, 403);
    assert.equal(deniedOtherIncident.body.error.code, 'field_job_scope_forbidden');

    const deniedOtherPunch = await request(baseUrl, `/api/ledger/jobs/${unassigned.body.job.id}/punch-items`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify({ ...fieldPunchPayload, entryKey: 'field-punch-denied-0001' })
    });
    assert.equal(deniedOtherPunch.response.status, 403);
    assert.equal(deniedOtherPunch.body.error.code, 'field_job_scope_forbidden');

    const scopedFieldList = await request(baseUrl, '/api/ledger/jobs?limit=100', { headers: fieldHeaders });
    const scopedFieldJob = scopedFieldList.body.jobs.find(job => job.id === intake.body.job.id);
    assert.ok(scopedFieldJob);
    for (const privateKey of ['estimatedCost', 'contractValue', 'marginTargetPercent', 'clientEmail', 'clientPhone', 'data']) {
      assert.equal(Object.hasOwn(scopedFieldJob, privateKey), false, privateKey);
    }

    const scopedFieldDetail = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}`, { headers: fieldHeaders });
    assert.equal(scopedFieldDetail.response.status, 200);
    for (const privateKey of ['quotes', 'changeOrders', 'communications', 'expenses', 'invoices', 'payments', 'portalAccess', 'approvals', 'audit']) {
      if (privateKey === 'communications' || privateKey === 'approvals') {
        assert.deepEqual(scopedFieldDetail.body.job[privateKey], []);
      } else {
        assert.equal(Object.hasOwn(scopedFieldDetail.body.job, privateKey), false, privateKey);
      }
    }
    assert.equal(scopedFieldDetail.body.job.timeLogs.length, 1);
    assert.equal(Object.hasOwn(scopedFieldDetail.body.job.timeLogs[0], 'rate'), false);

    const ownerDailyDetail = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}`, { headers: ownerHeaders });
    const retainedDailyTime = ownerDailyDetail.body.job.timeLogs.find(log => log.id === fieldDailyLog.body.dailyLog.timeLog.id);
    assert.equal(retainedDailyTime.workerId, 'field-worker-role-scope');
    assert.equal(retainedDailyTime.rate, 63);
    assert.equal(ownerDailyDetail.body.job.progress.filter(update => update.data?.entryKey === 'field-progress-role-0001').length, 1);
    assert.equal(ownerDailyDetail.body.job.observations.filter(record => record.data?.entryKey === 'field-observation-role-0001').length, 1);
    assert.equal(ownerDailyDetail.body.job.incidents.filter(record => record.data?.entryKey === 'field-incident-role-0001').length, 1);
    assert.equal(ownerDailyDetail.body.job.punchItems.filter(record => record.data?.entryKey === 'field-punch-role-0001').length, 1);
    assert.deepEqual(ownerDailyDetail.body.job.incidents.find(record => record.id === fieldIncident.body.incident.id).data.evidenceDocumentIds, [fieldUploadBody.ledgerDocument.id]);
    assert.deepEqual(ownerDailyDetail.body.job.punchItems.find(record => record.id === fieldPunch.body.punchItem.id).data.evidenceDocumentIds, [fieldUploadBody.ledgerDocument.id]);
    assert.ok(ownerDailyDetail.body.job.audit.some(event => event.action === 'record_progress' && event.entityId === fieldProgress.body.progress.id && event.actor === 'role:field_worker'));
    assert.ok(ownerDailyDetail.body.job.audit.some(event => event.action === 'record_field_daily_log' && event.actor === 'role:field_worker'));
    assert.ok(ownerDailyDetail.body.job.audit.some(event => event.action === 'record_observation' && event.entityId === fieldObservation.body.observation.id && event.actor === 'role:field_worker'));
    assert.ok(ownerDailyDetail.body.job.audit.some(event => event.action === 'record_incident' && event.entityId === fieldIncident.body.incident.id && event.actor === 'role:field_worker'));
    assert.ok(ownerDailyDetail.body.job.audit.some(event => event.action === 'create_punch_item' && event.entityId === fieldPunch.body.punchItem.id && event.actor === 'role:field_worker'));

    const deniedCompletion = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/progress`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify({ status: 'completed', progressPercent: 100, note: 'Attempted field closure.' })
    });
    assert.equal(deniedCompletion.response.status, 403);
    assert.equal(deniedCompletion.body.error.code, 'field_completion_approval_required');

    const storedEvidenceCount = fs.readdirSync(process.env.UPLOAD_DIR).length;
    const otherEvidence = new FormData();
    otherEvidence.append('evidenceFile', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('wrong field proof')], { type: 'image/jpeg' }), 'wrong-job-photo.jpg');
    otherEvidence.append('jobId', unassigned.body.job.id);
    const deniedUpload = await fetch(`${baseUrl}/api/ledger/upload`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.field_worker.token}` }, body: otherEvidence });
    const deniedUploadBody = await deniedUpload.json();
    assert.equal(deniedUpload.status, 403);
    assert.equal(deniedUploadBody.error.code, 'field_job_scope_forbidden');
    assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, storedEvidenceCount);

    const scopeRequest = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/commercial-scope/revisions`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        entryKey: 'auth-role-commercial-scope-0001',
        title: 'Role-governed written scope',
        scopeSummary: 'Deliver the retained role-test renovation work.',
        inclusions: ['Complete the retained renovation work.'],
        assumptions: ['Site access remains available as recorded.'],
        exclusions: ['Latent hazardous materials are excluded.'],
        clientResponsibilities: ['Provide access before mobilisation.'],
        contractorResponsibilities: ['Retain completion evidence.'],
        allowanceMode: 'none',
        noAllowanceReason: 'No allowances apply to the retained role-test scope.',
        reason: 'Establish written scope before role-governed quote approval.'
      })
    });
    assert.equal(scopeRequest.response.status, 201);
    const scopeApproval = await request(baseUrl, `/api/ledger/approvals/${scopeRequest.body.approval.id}/resolve`, {
      method: 'POST',
      headers: approverHeaders,
      body: JSON.stringify({
        status: 'approved',
        resolvedBy: 'Approver role',
        reason: 'Written scope, assumptions, exclusions, and allowance position verified.'
      })
    });
    assert.equal(scopeApproval.response.status, 200);

    const riskRequest = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/risk-register/revisions`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify(riskRegisterPayload('auth-role-risk-register-0001', scopeRequest.body.revision.id))
    });
    assert.equal(riskRequest.response.status, 201);
    const riskApproval = await request(baseUrl, `/api/ledger/approvals/${riskRequest.body.approval.id}/resolve`, {
      method: 'POST',
      headers: approverHeaders,
      body: JSON.stringify({
        status: 'approved',
        resolvedBy: 'Approver role',
        reason: 'Risk ownership, treatment controls, and premortem links verified.'
      })
    });
    assert.equal(riskApproval.response.status, 200);

    const quote = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/quote`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        commercialScopeRevisionId: scopeRequest.body.revision.id,
        riskRegisterRevisionId: riskRequest.body.revision.id,
        subtotal: 1200,
        taxRate: 21
      })
    });
    assert.equal(quote.response.status, 201);

    const fieldResolution = await request(baseUrl, `/api/ledger/approvals/${quote.body.quote.approvalId}/resolve`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify({ status: 'approved' })
    });
    assert.equal(fieldResolution.response.status, 403);

    const approved = await request(baseUrl, `/api/ledger/approvals/${quote.body.quote.approvalId}/resolve`, {
      method: 'POST',
      headers: approverHeaders,
      body: JSON.stringify({ status: 'approved', resolvedBy: 'Approver role' })
    });
    assert.equal(approved.response.status, 200);

    const deniedFieldAcceptance = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/quotes/${quote.body.quote.id}/acceptance`, {
      method: 'POST',
      headers: fieldHeaders,
      body: JSON.stringify({ acceptedAt: '2026-07-14T12:00:00.000Z', evidenceReference: 'FIELD-CANNOT-ACCEPT' })
    });
    assert.equal(deniedFieldAcceptance.response.status, 403);
    assert.equal(deniedFieldAcceptance.body.error.code, 'insufficient_role');

    const acceptance = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}/quotes/${quote.body.quote.id}/acceptance`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ acceptedAt: '2026-07-14T12:00:00.000Z', evidenceReference: 'SIGNED-QUOTE-ROLE-001' })
    });
    assert.equal(acceptance.response.status, 201);
    assert.equal(acceptance.body.approval.targetType, 'quote_acceptance');

    const deniedOfficeVerification = await request(baseUrl, `/api/ledger/approvals/${acceptance.body.approval.id}/resolve`, {
      method: 'POST',
      headers: officeHeaders,
      body: JSON.stringify({ status: 'approved' })
    });
    assert.equal(deniedOfficeVerification.response.status, 403);

    const verifiedAcceptance = await request(baseUrl, `/api/ledger/approvals/${acceptance.body.approval.id}/resolve`, {
      method: 'POST',
      headers: approverHeaders,
      body: JSON.stringify({ status: 'approved', resolvedBy: 'Approver role' })
    });
    assert.equal(verifiedAcceptance.response.status, 200);

    const commercialDetail = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}`, { headers: ownerHeaders });
    assert.equal(commercialDetail.body.job.contractValue, 1200);
    assert.equal(commercialDetail.body.job.quotes.find(item => item.id === quote.body.quote.id).status, 'accepted');
  });
});
