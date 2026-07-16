const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-credit-note-api-'));
process.env.NODE_ENV = 'test';
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');
process.env.CONTRACTOR_AI_REQUIRE_AUTH = 'true';
process.env.CONTRACTOR_AI_VERIFIED_INTEGRATIONS = 'credit_note_api_provider';
delete process.env.CONTRACTOR_AI_AUTH_TOKEN;

const tokens = {
  owner: 'credit-api-owner-token-12345678901234567890123',
  office: 'credit-api-office-token-1234567890123456789012',
  approver: 'credit-api-approver-token-12345678901234567890',
  field: 'credit-api-field-token-12345678901234567890123'
};
process.env.CONTRACTOR_AI_ROLE_TOKENS = JSON.stringify({
  operators: [
    { id: 'credit-owner', role: 'owner', token: tokens.owner },
    { id: 'credit-office', role: 'office_operator', token: tokens.office },
    { id: 'credit-approver', role: 'approver', token: tokens.approver },
    { id: 'credit-field', role: 'field_worker', workerId: 'worker_credit_field', token: tokens.field }
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

test('credit-note APIs enforce roles, approvals, exact balances, immutable downloads, and verified delivery', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'credit_note_api_test' });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const profile = await jsonRequest(baseUrl, '/api/ledger/organization', {
    method: 'PUT',
    headers: headers('owner', true),
    body: JSON.stringify({
      legalName: 'Credit API Contractor B.V.',
      registrationNumber: '87654321',
      vatNumber: 'NL987654321B01',
      email: 'credit-api@example.test',
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
      client: { name: 'Credit API Buyer', company: 'Credit API Buyer B.V.', email: 'buyer@example.test' },
      title: 'Credit API closeout',
      status: 'completed',
      progressPercent: 100,
      contractValue: 1000,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const invoice = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/invoices`, {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({
      amount: 1000,
      taxRate: 21,
      dueAt: '2026-09-30T23:59:59.000Z',
      structuredExportRequested: true,
      buyerReference: 'CREDIT-API-BUYER-42',
      buyerLegalName: 'Credit API Buyer B.V.',
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
  const invoiceId = invoice.body.invoice.id;
  await jsonRequest(baseUrl, `/api/ledger/approvals/${invoice.body.invoice.approvalId}/resolve`, {
    method: 'POST',
    headers: headers('approver', true),
    body: JSON.stringify({ status: 'approved', reason: 'Invoice data checked.' })
  });
  const invoicePackage = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoiceId}/issue-package`, {
    method: 'POST', headers: headers('office', true), body: '{}'
  });
  assert.equal(invoicePackage.response.status, 201);

  const fieldAttempt = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoiceId}/credit-notes`, {
    method: 'POST',
    headers: headers('field', true),
    body: JSON.stringify({ amount: 200, reason: 'Field role must not change receivables.' })
  });
  assert.equal(fieldAttempt.response.status, 403);
  assert.equal(fieldAttempt.body.error.code, 'insufficient_role');

  const missingReason = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoiceId}/credit-notes`, {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({ amount: 200 })
  });
  assert.equal(missingReason.response.status, 400);
  assert.equal(missingReason.body.error.code, 'credit_note_reason_required');

  const credit = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoiceId}/credit-notes`, {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({
      amount: 200,
      taxRate: 21,
      reason: 'Correct a duplicate API line.',
      description: 'Duplicate API line correction',
      structuredExportRequested: true
    })
  });
  assert.equal(credit.response.status, 201);
  assert.equal(credit.body.creditNote.total, 242);
  assert.equal(credit.body.creditNote.status, 'draft');
  assert.equal(credit.body.job.creditNotes.length, 1);
  const creditNoteId = credit.body.creditNote.id;

  const overCredit = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/invoices/${invoiceId}/credit-notes`, {
    method: 'POST',
    headers: headers('office', true),
    body: JSON.stringify({ amount: 801, reason: 'Exceeds the reserved balance.' })
  });
  assert.equal(overCredit.response.status, 400);
  assert.equal(overCredit.body.error.code, 'credit_note_exceeds_invoice_balance');
  assert.equal(overCredit.body.error.details.availableAmount, 968);

  const blockedPackage = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/credit-notes/${creditNoteId}/issue-package`, {
    method: 'POST', headers: headers('office', true), body: '{}'
  });
  assert.equal(blockedPackage.response.status, 409);
  assert.equal(blockedPackage.body.error.code, 'credit_note_not_approved_for_issue');

  const approval = await jsonRequest(baseUrl, `/api/ledger/approvals/${credit.body.creditNote.approvalId}/resolve`, {
    method: 'POST',
    headers: headers('approver', true),
    body: JSON.stringify({ status: 'approved', reason: 'Credit evidence checked.' })
  });
  assert.equal(approval.response.status, 200);

  const prepared = await jsonRequest(baseUrl, `/api/ledger/jobs/${jobId}/credit-notes/${creditNoteId}/issue-package`, {
    method: 'POST', headers: headers('office', true), body: '{}'
  });
  assert.equal(prepared.response.status, 201);
  assert.equal(prepared.body.notSent, true);
  assert.equal(prepared.body.documents.length, 2);
  assert.equal(prepared.body.reconciliation.creditedAmount, 242);
  assert.equal(prepared.body.reconciliation.outstandingAmount, 968);
  assert.equal(prepared.body.job.invoices.find(item => item.id === invoiceId).status, 'partially_settled');
  const financeJob = prepared.body.finance.jobs.find(item => item.jobId === jobId);
  assert.equal(financeJob.money.creditedValue, 242);
  assert.equal(financeJob.money.grossInvoiceValue, 1210);
  assert.equal(financeJob.money.invoiceValue, 968);

  const ublResponse = await fetch(`${baseUrl}/api/ledger/documents/${prepared.body.ublDocument.id}/issue-package`, {
    headers: headers('approver')
  });
  const ubl = await ublResponse.text();
  assert.equal(ublResponse.status, 200);
  assert.match(ublResponse.headers.get('content-type'), /^application\/xml/);
  assert.match(ublResponse.headers.get('content-disposition'), /^attachment;/);
  assert.match(ubl, /<cbc:CreditNoteTypeCode>381<\/cbc:CreditNoteTypeCode>/);
  assert.match(ubl, new RegExp(`<cac:InvoiceDocumentReference><cbc:ID>${invoicePackage.body.issueReference}<\\/cbc:ID>`));

  await jsonRequest(baseUrl, `/api/ledger/approvals/${prepared.body.approval.id}/resolve`, {
    method: 'POST',
    headers: headers('approver', true),
    body: JSON.stringify({ status: 'approved', reason: 'Credit-note attachments and recipient checked.' })
  });
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
    body: JSON.stringify({ integration: 'credit_note_api_provider', providerMessageId: 'credit-api-message-1' })
  });
  assert.equal(delivered.response.status, 200);
  const sentCredit = delivered.body.job.creditNotes.find(item => item.id === creditNoteId);
  assert.equal(sentCredit.status, 'sent');
  assert.equal(sentCredit.data.issuePackage.providerMessageId, 'credit-api-message-1');
});
