const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-invoice-api-'));
process.env.NODE_ENV = 'test';
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');
process.env.CONTRACTOR_AI_REQUIRE_AUTH = 'true';
process.env.CONTRACTOR_AI_VERIFIED_INTEGRATIONS = 'invoice_api_provider';
delete process.env.CONTRACTOR_AI_AUTH_TOKEN;

const tokens = {
  owner: 'invoice-api-owner-token-1234567890123456789012',
  office: 'invoice-api-office-token-123456789012345678901',
  approver: 'invoice-api-approver-token-1234567890123456789',
  field: 'invoice-api-field-token-1234567890123456789012'
};
process.env.CONTRACTOR_AI_ROLE_TOKENS = JSON.stringify({
  operators: [
    { id: 'invoice-owner', role: 'owner', token: tokens.owner },
    { id: 'invoice-office', role: 'office_operator', token: tokens.office },
    { id: 'invoice-approver', role: 'approver', token: tokens.approver },
    { id: 'invoice-field', role: 'field_worker', workerId: 'worker_invoice_field', token: tokens.field }
  ]
});

const app = require('../server');

function headers(role, json = false) {
  return {
    Authorization: `Bearer ${tokens[role]}`,
    ...(json ? { 'Content-Type': 'application/json' } : {})
  };
}

async function jsonRequest(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const body = await response.json();
  return { response, body };
}

test('invoice issue APIs enforce calculations, roles, package approval, and verified delivery', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'invoice_issue_api_test' });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const profile = await jsonRequest(baseUrl, '/api/ledger/organization', {
    method: 'PUT',
    headers: headers('owner', true),
    body: JSON.stringify({
      legalName: 'Invoice API Contractor B.V.',
      registrationNumber: '87654321',
      vatNumber: 'NL987654321B01',
      email: 'invoice-api@example.test',
      phone: '+31 20 123 45 67',
      address: 'API-straat 8',
      postalCode: '1012 AB',
      city: 'Amsterdam',
      country: 'NL',
      iban: 'NL91ABNA0417164300',
      bic: 'ABNANL2A',
      defaultPaymentTermsDays: 30,
      defaultQuoteValidityDays: 30
    })
  });
  assert.equal(profile.response.status, 200);

  const intake = await jsonRequest(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({
      client: { name: 'Invoice API Buyer', company: 'Invoice API Buyer B.V.', email: 'buyer@example.test' },
      title: 'Invoice API closeout',
      status: 'completed',
      progressPercent: 100,
      contractValue: 1500,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const mismatched = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/invoices`, {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({ amount: 1500, taxRate: 21, taxAmount: 1, total: 2 })
  });
  assert.equal(mismatched.response.status, 400);
  assert.equal(mismatched.body.error.code, 'invoice_total_mismatch');

  const invoice = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/invoices`, {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({
      amount: 1500,
      taxRate: 21,
      taxAmount: 315,
      total: 1815,
      dueAt: '2026-09-30T23:59:59.000Z',
      structuredExportRequested: true,
      buyerReference: 'API-BUYER-42',
      buyerLegalName: 'Invoice API Buyer B.V.',
      buyerRegistrationNumber: '11223344',
      buyerEndpointScheme: '0106',
      buyerEndpointId: '11223344',
      buyerAddress: 'Buyerlaan 42',
      buyerPostalCode: '3011 AA',
      buyerCity: 'Rotterdam',
      buyerCountry: 'NL'
    })
  });
  assert.equal(invoice.response.status, 201);
  assert.equal(invoice.body.invoice.total, 1815);
  assert.equal(invoice.body.invoice.data.structuredReadiness.ready, true);

  const blockedPackage = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoice.body.invoice.id}/issue-package`, {
    method: 'POST', headers: headers('office', true), body: '{}'
  });
  assert.equal(blockedPackage.response.status, 409);
  assert.equal(blockedPackage.body.error.code, 'invoice_not_approved_for_issue');

  const approval = await jsonRequest(baseUrl, `/api/ledger/approvals/${invoice.body.invoice.approvalId}/resolve`, {
    method: 'POST',
    headers: headers('approver', true),
    body: JSON.stringify({ status: 'approved', reason: 'Invoice calculation and buyer identity checked.' })
  });
  assert.equal(approval.response.status, 200);

  const prepared = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoice.body.invoice.id}/issue-package`, {
    method: 'POST', headers: headers('office', true), body: '{}'
  });
  assert.equal(prepared.response.status, 201);
  assert.equal(prepared.body.notSent, true);
  assert.equal(prepared.body.transportSubmitted, false);
  assert.equal(prepared.body.structuredExportIncluded, true);
  assert.equal(prepared.body.documents.length, 2);
  assert.equal(prepared.body.approval.targetType, 'communication');

  const fieldDownload = await jsonRequest(baseUrl, `/api/ledger/documents/${prepared.body.ublDocument.id}/issue-package`, {
    headers: headers('field')
  });
  assert.equal(fieldDownload.response.status, 403);
  assert.equal(fieldDownload.body.error.code, 'insufficient_role');

  const ublResponse = await fetch(`${baseUrl}/api/ledger/documents/${prepared.body.ublDocument.id}/issue-package`, {
    headers: headers('approver')
  });
  const ubl = await ublResponse.text();
  assert.equal(ublResponse.status, 200);
  assert.match(ublResponse.headers.get('content-type'), /^application\/xml/);
  assert.match(ublResponse.headers.get('content-disposition'), /^attachment;/);
  assert.match(ublResponse.headers.get('cache-control'), /no-store/);
  assert.match(ubl, /<cbc:ID>INV-\d{4}-000001<\/cbc:ID>/);
  assert.match(ubl, /<cbc:PayableAmount currencyID="EUR">1815\.00<\/cbc:PayableAmount>/);

  const deliveryBeforeApproval = await jsonRequest(baseUrl, `/api/ledger/communications/${prepared.body.communication.id}/delivery-receipt`, {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({ integration: 'invoice_api_provider' })
  });
  assert.equal(deliveryBeforeApproval.response.status, 409);
  assert.equal(deliveryBeforeApproval.body.error.code, 'communication_approval_required');

  const deliveryApproval = await jsonRequest(baseUrl, `/api/ledger/approvals/${prepared.body.approval.id}/resolve`, {
    method: 'POST',
    headers: headers('approver', true),
    body: JSON.stringify({ status: 'approved', reason: 'Invoice attachments and recipient checked.' })
  });
  assert.equal(deliveryApproval.response.status, 200);

  const unverifiedDelivery = await jsonRequest(baseUrl, `/api/ledger/communications/${prepared.body.communication.id}/delivery-receipt`, {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({ integration: 'unknown-provider' })
  });
  assert.equal(unverifiedDelivery.response.status, 409);
  assert.equal(unverifiedDelivery.body.error.code, 'verified_integration_required');

  const delivered = await jsonRequest(baseUrl, `/api/ledger/communications/${prepared.body.communication.id}/delivery-receipt`, {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({ integration: 'invoice_api_provider', providerMessageId: 'invoice-api-message-1' })
  });
  assert.equal(delivered.response.status, 200);
  assert.equal(delivered.body.communication.status, 'sent');
  const sentInvoice = delivered.body.job.invoices.find(item => item.id === invoice.body.invoice.id);
  assert.equal(sentInvoice.status, 'sent');
  assert.equal(sentInvoice.data.issuePackage.providerMessageId, 'invoice-api-message-1');
});
