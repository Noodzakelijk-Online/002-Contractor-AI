const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-client-portal-'));
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

test('client portal access is approval-gated, scoped, auditable, and revocable', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Client portal paving job',
      client: { name: 'Portal Client', email: 'portal@example.test', phone: '+31600000000' },
      address: 'Utrecht',
      service: 'paving',
      description: 'Replace the front path with grey pavers.'
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const created = await request(baseUrl, `/api/ledger/jobs/${jobId}/client-portal-access`, {
    method: 'POST',
    body: JSON.stringify({ label: 'Portal Client project', expiresAt: '2027-01-01' })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.access.status, 'pending_approval');
  assert.ok(created.body.access.portalToken);
  assert.ok(created.body.access.approval.id);
  assert.equal(JSON.stringify(created.body.access).includes('tokenHash'), false);

  const beforeApproval = await request(baseUrl, `/api/client-portal/${created.body.access.portalToken}`);
  assert.equal(beforeApproval.response.status, 404);

  const approval = await request(baseUrl, `/api/approvals/${created.body.access.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Portal test' })
  });
  assert.equal(approval.response.status, 200);
  assert.equal(approval.body.approval.status, 'approved');

  const portalLogs = [];
  const originalLog = console.log;
  console.log = (...args) => portalLogs.push(args.join(' '));
  let portal;
  try {
    portal = await request(baseUrl, `/api/client-portal/${created.body.access.portalToken}`);
  } finally {
    console.log = originalLog;
  }
  assert.equal(portal.response.status, 200);
  assert.equal(portal.body.job.id, jobId);
  assert.equal(portal.body.job.title, 'Client portal paving job');
  assert.equal(portal.body.job.address, 'Utrecht');
  assert.equal(Object.hasOwn(portal.body.job, 'client'), false);
  assert.equal(Object.hasOwn(portal.body.job, 'invoices'), false);
  assert.equal(Object.hasOwn(portal.body.job, 'expenses'), false);
  assert.equal(Object.hasOwn(portal.body.job, 'audit'), false);
  assert.ok(portalLogs.some(line => line.includes('/api/client-portal/[redacted]')));
  assert.equal(portalLogs.some(line => line.includes(created.body.access.portalToken)), false);

  const message = await request(baseUrl, `/api/client-portal/${created.body.access.portalToken}/messages`, {
    method: 'POST',
    body: JSON.stringify({ subject: 'Paver colour', body: 'Can we confirm the grey paver sample first?' })
  });
  assert.equal(message.response.status, 201);
  assert.equal(message.body.deliveryMode, 'record_only');
  assert.equal(message.body.approvalRequired, false);
  assert.equal(message.body.communication.direction, 'inbound');
  assert.equal(message.body.communication.status, 'received');
  assert.equal(message.body.communication.approvalId || null, null);

  const accessList = await request(baseUrl, `/api/ledger/jobs/${jobId}/client-portal-access`);
  assert.equal(accessList.response.status, 200);
  assert.equal(accessList.body.access.length, 1);
  assert.equal(Object.hasOwn(accessList.body.access[0], 'tokenHash'), false);
  assert.equal(accessList.body.access[0].status, 'active');

  const revoked = await request(baseUrl, `/api/ledger/client-portal-access/${created.body.access.id}/revoke`, {
    method: 'POST',
    body: JSON.stringify({ actor: 'Portal test' })
  });
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.body.access.status, 'revoked');

  const afterRevocation = await request(baseUrl, `/api/client-portal/${created.body.access.portalToken}`);
  assert.equal(afterRevocation.response.status, 404);

  const audit = await request(baseUrl, `/api/audit?jobId=${jobId}&limit=100`);
  assert.equal(audit.response.status, 200);
  assert.ok(audit.body.events.some(event => event.action === 'create_client_portal_access'));
  assert.ok(audit.body.events.some(event => event.action === 'activate_client_portal_access'));
  assert.ok(audit.body.events.some(event => event.action === 'revoke_client_portal_access'));
});
