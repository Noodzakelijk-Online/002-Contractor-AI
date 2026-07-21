const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-invoice-package-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function organizationPayload() {
  return {
    legalName: 'Invoice Contractor B.V.',
    tradingName: 'Invoice Contractor',
    registrationNumber: '12345678',
    vatNumber: 'NL123456789B01',
    email: 'finance@contractor.example',
    phone: '+31 30 123 45 67',
    address: 'Ledgerstraat 10',
    postalCode: '3511 AA',
    city: 'Utrecht',
    country: 'NL',
    iban: 'NL91 ABNA 0417 1643 00',
    bic: 'ABNANL2A',
    defaultPaymentTermsDays: 30,
    defaultQuoteValidityDays: 30
  };
}

function structuredInvoicePayload(overrides = {}) {
  return {
    amount: 1000,
    taxRate: 21,
    dueAt: '2026-09-30T23:59:59.000Z',
    structuredExportRequested: true,
    buyerReference: 'BUYER-REF-42',
    buyerLegalName: 'Structured Buyer B.V.',
    buyerRegistrationNumber: '87654321',
    buyerEndpointScheme: '0106',
    buyerEndpointId: '87654321',
    buyerAddress: 'Buyerstraat 4',
    buyerPostalCode: '3011 AA',
    buyerCity: 'Rotterdam',
    buyerCountry: 'NL',
    notes: 'Retained invoice note <unsafe>.',
    ...overrides
  };
}

function completedJob(ledger, suffix = 'one') {
  return ledger.createIntake({
    client: {
      name: `Structured Buyer ${suffix}`,
      company: 'Structured Buyer B.V.',
      email: 'buyer@example.test',
      address: 'Buyerstraat 4',
      city: 'Rotterdam',
      country: 'NL'
    },
    title: `Invoice package ${suffix}`,
    status: 'completed',
    progressPercent: 100,
    contractValue: 1000,
    assignAutomatically: false
  }, { actor: 'invoice-test' });
}

test('invoice drafts use server-calculated totals and retain structured export readiness', t => {
  const ledger = temporaryLedger(t);
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner' });
  const job = completedJob(ledger);

  assert.throws(
    () => ledger.createInvoice(job.id, structuredInvoicePayload({ taxAmount: 1, total: 2 })),
    error => error.code === 'invoice_total_mismatch' && error.statusCode === 400
  );
  assert.throws(
    () => ledger.createInvoice(job.id, structuredInvoicePayload({ amount: -5 })),
    error => error.code === 'invoice_amount_invalid' && error.statusCode === 400
  );

  const invoice = ledger.createInvoice(job.id, structuredInvoicePayload({ status: 'sent', taxAmount: 210, total: 1210 }), { actor: 'office' });
  assert.equal(invoice.status, 'draft');
  assert.equal(invoice.amount, 1000);
  assert.equal(invoice.data.taxRate, 21);
  assert.equal(invoice.taxAmount, 210);
  assert.equal(invoice.total, 1210);
  assert.equal(invoice.data.structuredReadiness.ready, true);
  assert.equal(invoice.data.structuredReadiness.transportConfigured, false);
  assert.equal(invoice.data.lineItems.length, 1);
  assert.ok(invoice.approvalId);
  assert.equal(ledger.migrationStatus().currentVersion, '058_formal_variation_control');
});

test('approved invoices create numbered immutable HTML and UBL packages behind delivery approval', t => {
  const ledger = temporaryLedger(t);
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner' });
  const job = completedJob(ledger);
  const invoice = ledger.createInvoice(job.id, structuredInvoicePayload(), { actor: 'office' });

  assert.throws(
    () => ledger.prepareInvoiceIssuePackage(job.id, invoice.id),
    error => error.code === 'invoice_not_approved_for_issue' && error.statusCode === 409
  );
  ledger.resolveApproval(invoice.approvalId, { status: 'approved', resolvedBy: 'finance-approver' });
  const beforePackage = ledger.listFinanceReadiness({ mode: 'invoice', limit: 100 }).jobs.find(item => item.jobId === job.id);
  assert.equal(beforePackage.flags.invoicePackageReady, true);
  assert.equal(beforePackage.money.unpaidValue, 0);
  assert.ok(beforePackage.nextActions.some(action => action.type === 'prepare_invoice_package'));

  const prepared = ledger.prepareInvoiceIssuePackage(job.id, invoice.id, { actor: 'office' });
  assert.equal(prepared.replayed, false);
  assert.match(prepared.issueReference, /^INV-\d{4}-000001$/);
  assert.deepEqual(prepared.documents.map(document => document.type), ['invoice_issue_package', 'invoice_ubl_package']);
  assert.equal(prepared.communication.status, 'draft');
  assert.equal(prepared.communication.data.transportSubmitted, false);
  assert.equal(prepared.approval.targetType, 'communication');
  assert.equal(prepared.approval.status, 'pending');
  assert.equal(prepared.externalCommitments, 0);

  const html = ledger.getInvoiceIssueDocument(prepared.htmlDocument.id, { actor: 'reviewer' });
  const ubl = ledger.getInvoiceIssueDocument(prepared.ublDocument.id, { actor: 'reviewer' });
  assert.match(html.content, /INV-\d{4}-000001/);
  assert.match(html.content, /Retained invoice note &lt;unsafe&gt;/);
  assert.doesNotMatch(html.content, /<unsafe>/);
  assert.match(html.content, new RegExp(prepared.packageHash));
  assert.match(ubl.content, /urn:fdc:peppol\.eu:2017:poacc:billing:3\.0/);
  assert.match(ubl.content, /<cbc:InvoiceTypeCode>380<\/cbc:InvoiceTypeCode>/);
  assert.match(ubl.content, /<cbc:EndpointID schemeID="0106">87654321<\/cbc:EndpointID>/);
  assert.match(ubl.content, /<cac:InvoiceLine>/);
  assert.match(ubl.content, /<cbc:PayableAmount currencyID="EUR">1210\.00<\/cbc:PayableAmount>/);
  assert.match(ubl.content, /Retained invoice note &lt;unsafe&gt;\./);

  const replay = ledger.prepareInvoiceIssuePackage(job.id, invoice.id, { actor: 'second-office' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.issueReference, prepared.issueReference);
  assert.equal(replay.approval.id, prepared.approval.id);
  assert.equal(ledger.db.prepare('SELECT last_value FROM invoice_number_sequences WHERE period_year = ?').get(Number(prepared.issueReference.slice(4, 8))).last_value, 1);

  assert.throws(
    () => ledger.recordCommunicationDelivery(prepared.communication.id, { integration: 'verified-provider' }),
    error => error.code === 'communication_approval_required' && error.statusCode === 409
  );
  ledger.resolveApproval(prepared.approval.id, { status: 'approved', resolvedBy: 'delivery-approver' });
  const delivered = ledger.recordCommunicationDelivery(prepared.communication.id, {
    integration: 'verified-provider',
    providerMessageId: 'provider-message-1'
  }, { actor: 'delivery-api' });
  assert.equal(delivered.status, 'sent');
  const sentInvoice = ledger.getJobDetail(job.id, { includeAudit: false }).invoices.find(item => item.id === invoice.id);
  assert.equal(sentInvoice.status, 'sent');
  assert.equal(sentInvoice.data.issuePackage.transportStatus, 'delivered_by_verified_integration');
  assert.equal(sentInvoice.data.issuePackage.providerMessageId, 'provider-message-1');
  const receivable = ledger.listFinanceReadiness({ mode: 'payment', limit: 100 }).jobs.find(item => item.jobId === job.id);
  assert.ok(receivable);
  assert.equal(receivable.money.unpaidValue, 1210);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('structured package preparation fails with exact blockers and delivery fails closed after tampering', t => {
  const ledger = temporaryLedger(t);
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner' });
  const incompleteJob = completedJob(ledger, 'incomplete');
  const incomplete = ledger.createInvoice(incompleteJob.id, structuredInvoicePayload({
    buyerReference: '',
    purchaseOrderReference: '',
    buyerEndpointId: '',
    buyerEndpointScheme: ''
  }));
  ledger.resolveApproval(incomplete.approvalId, { status: 'approved', resolvedBy: 'finance-approver' });
  assert.throws(
    () => ledger.prepareInvoiceIssuePackage(incompleteJob.id, incomplete.id),
    error => error.code === 'invoice_structured_export_incomplete'
      && error.details.missing.some(item => item.code === 'buyer_endpoint_missing')
      && error.details.missing.some(item => item.code === 'buyer_reference_missing')
  );

  const job = completedJob(ledger, 'tamper');
  const invoice = ledger.createInvoice(job.id, structuredInvoicePayload());
  ledger.resolveApproval(invoice.approvalId, { status: 'approved', resolvedBy: 'finance-approver' });
  const prepared = ledger.prepareInvoiceIssuePackage(job.id, invoice.id);
  const original = ledger.db.prepare('SELECT data_json FROM documents WHERE id = ?').get(prepared.ublDocument.id).data_json;
  const tampered = JSON.parse(original);
  tampered.snapshot.invoice.total = 1;
  ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(JSON.stringify(tampered), prepared.ublDocument.id);

  assert.throws(
    () => ledger.getInvoiceIssueDocument(prepared.ublDocument.id),
    error => error.code === 'invoice_issue_package_integrity_failed' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.resolveApproval(prepared.approval.id, { status: 'approved', resolvedBy: 'delivery-approver' }),
    error => error.code === 'invoice_issue_package_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).some(item => item.id === prepared.approval.id), true);
  ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(original, prepared.ublDocument.id);
  ledger.resolveApproval(prepared.approval.id, { status: 'approved', resolvedBy: 'delivery-approver' });
  ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(JSON.stringify(tampered), prepared.ublDocument.id);
  assert.throws(
    () => ledger.recordCommunicationDelivery(prepared.communication.id, { integration: 'verified-provider' }),
    error => error.code === 'invoice_issue_package_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.getJobDetail(job.id, { includeAudit: false }).invoices.find(item => item.id === invoice.id).status, 'prepared');
});
