const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-client-directory-'));
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

test('client directory validates commercial identity and reports linked operating context', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const invalidEmail = await request(baseUrl, '/api/ledger/clients', {
    method: 'POST',
    body: JSON.stringify({ name: 'Invalid Client', email: 'not-an-email' })
  });
  assert.equal(invalidEmail.response.status, 400);
  assert.equal(invalidEmail.body.error.code, 'client_email_invalid');

  const incompleteEndpoint = await request(baseUrl, '/api/ledger/clients', {
    method: 'POST',
    body: JSON.stringify({ name: 'Incomplete Endpoint Client', electronicAddressScheme: '0106' })
  });
  assert.equal(incompleteEndpoint.response.status, 400);
  assert.equal(incompleteEndpoint.body.error.code, 'client_electronic_address_incomplete');

  const created = await request(baseUrl, '/api/ledger/clients', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Marit de Vries',
      company: 'Directory Client BV',
      clientType: 'business',
      email: 'marit@directory-client.example',
      billingEmail: 'finance@directory-client.example',
      phone: '+31 20 555 0190',
      address: 'Keizersgracht 100',
      postalCode: '1015 AA',
      city: 'Amsterdam',
      country: 'NL',
      registrationNumber: '87654321',
      vatNumber: 'NL123456789B01',
      preferredLanguage: 'nl',
      notes: 'Retained commercial identity for controlled issue packages.'
    })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.client.readiness.contactReady, true);
  assert.equal(created.body.client.readiness.invoiceReady, true);
  assert.equal(created.body.client.readiness.structuredInvoiceReady, true);
  assert.deepEqual(created.body.client.readiness.endpoint, { scheme: '0106', id: '87654321', derived: true });
  const clientId = created.body.client.id;

  const duplicate = await request(baseUrl, '/api/ledger/clients', {
    method: 'POST',
    body: JSON.stringify({ name: 'Duplicate Directory Contact', email: 'marit@directory-client.example' })
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, 'client_duplicate');

  const duplicateRegistration = await request(baseUrl, '/api/ledger/clients', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Different Registration Contact',
      company: 'Different Registration Company BV',
      email: 'different-registration@example.test',
      registrationNumber: '87654321'
    })
  });
  assert.equal(duplicateRegistration.response.status, 409);
  assert.equal(duplicateRegistration.body.error.code, 'client_duplicate');

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Directory linked retrofit',
      status: 'scheduled',
      contractValue: 18000,
      assignAutomatically: false,
      client: {
        name: 'Marit de Vries',
        company: 'Directory Client BV',
        email: 'marit@directory-client.example'
      }
    })
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  assert.equal(intake.body.job.clientId, clientId);

  const opportunity = await request(baseUrl, '/api/ledger/opportunities', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Directory linked extension',
      stage: 'qualifying',
      estimatedValue: 9500,
      client: {
        name: 'Marit de Vries',
        company: 'Directory Client BV',
        email: 'marit@directory-client.example'
      }
    })
  });
  assert.equal(opportunity.response.status, 201, JSON.stringify(opportunity.body));
  assert.equal(opportunity.body.opportunity.clientId, clientId);

  const invoice = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(intake.body.job.id)}/invoices`, {
    method: 'POST',
    body: JSON.stringify({ amount: 1000, taxRate: 21, dueAt: '2026-08-15', notes: 'Directory receivable fixture.' })
  });
  assert.equal(invoice.response.status, 201, JSON.stringify(invoice.body));
  assert.equal(invoice.body.invoice.data.buyer.endpointScheme, '0106');
  assert.equal(invoice.body.invoice.data.buyer.endpointId, '87654321');

  const migrationDb = new DatabaseSync(process.env.LEDGER_DB_FILE);
  migrationDb.prepare("UPDATE invoices SET status = 'sent' WHERE id = ?").run(invoice.body.invoice.id);
  migrationDb.close();

  const updated = await request(baseUrl, `/api/ledger/clients/${encodeURIComponent(clientId)}`, {
    method: 'PUT',
    body: JSON.stringify({ preferredLanguage: 'en', notes: 'Billing contact reviewed by the office operator.' })
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.client.preferredLanguage, 'en');
  assert.equal(updated.body.client.data.billingEmail, 'finance@directory-client.example');
  assert.equal(updated.body.client.data.notes, 'Billing contact reviewed by the office operator.');

  const directory = await request(baseUrl, '/api/ledger/clients?search=Directory%20Client&limit=100');
  assert.equal(directory.response.status, 200);
  assert.equal(directory.body.clients.length, 1);
  const record = directory.body.clients[0];
  assert.equal(record.id, clientId);
  assert.equal(record.readiness.structuredInvoiceReady, true);
  assert.equal(record.metrics.activeJobs, 1);
  assert.equal(record.metrics.openOpportunities, 1);
  assert.equal(record.metrics.acceptedContractValue, 18000);
  assert.equal(record.metrics.outstandingReceivable, 1210);
  assert.equal(record.latestJobs[0].id, intake.body.job.id);
  assert.equal(directory.body.summary.total, 1);
  assert.equal(directory.body.summary.structuredInvoiceReady, 1);
  assert.equal(directory.body.summary.activeJobs, 1);
  assert.equal(directory.body.summary.openOpportunities, 1);
  assert.equal(directory.body.summary.outstandingReceivable, 1210);

  const audit = await request(baseUrl, `/api/ledger/audit?entityId=${encodeURIComponent(clientId)}&limit=100`);
  assert.ok(audit.body.events.some(event => event.action === 'create_client'));
  assert.ok(audit.body.events.some(event => event.action === 'update_client'));
});
