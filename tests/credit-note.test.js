const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-credit-note-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function organizationPayload() {
  return {
    legalName: 'Credit Control B.V.',
    tradingName: 'Credit Control',
    registrationNumber: '12345678',
    vatNumber: 'NL123456789B01',
    email: 'finance@credit-control.example',
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

function completedJob(ledger, suffix = 'one') {
  return ledger.createIntake({
    client: {
      name: `Credit Buyer ${suffix}`,
      company: 'Credit Buyer B.V.',
      email: 'buyer@example.test',
      address: 'Buyerstraat 4',
      city: 'Rotterdam',
      country: 'NL'
    },
    title: `Credit note ${suffix}`,
    status: 'completed',
    progressPercent: 100,
    contractValue: 1000,
    assignAutomatically: false
  }, { actor: 'credit-note-test' });
}

function issuedInvoice(ledger, job, overrides = {}) {
  const invoice = ledger.createInvoice(job.id, {
    amount: 1000,
    taxRate: 21,
    dueAt: '2026-09-30T23:59:59.000Z',
    structuredExportRequested: true,
    buyerReference: 'BUYER-CREDIT-42',
    buyerLegalName: 'Credit Buyer B.V.',
    buyerRegistrationNumber: '87654321',
    buyerEndpointScheme: '0106',
    buyerEndpointId: '87654321',
    buyerAddress: 'Buyerstraat 4',
    buyerPostalCode: '3011 AA',
    buyerCity: 'Rotterdam',
    buyerCountry: 'NL',
    ...overrides
  }, { actor: 'credit-note-test' });
  ledger.resolveApproval(invoice.approvalId, {
    status: 'approved',
    resolvedBy: 'finance-approver',
    reason: 'Invoice calculation and identity checked.'
  });
  return { invoice, issuePackage: ledger.prepareInvoiceIssuePackage(job.id, invoice.id, { actor: 'credit-note-test' }) };
}

test('draft credit notes reserve balance and rejection releases it without changing the invoice', t => {
  const ledger = temporaryLedger(t);
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner' });
  const job = completedJob(ledger);
  const { invoice } = issuedInvoice(ledger, job);

  const creditNote = ledger.createCreditNote(job.id, invoice.id, {
    amount: 200,
    taxRate: 21,
    reason: 'Correct a duplicated material line.'
  }, { actor: 'office' });
  assert.equal(creditNote.status, 'draft');
  assert.equal(creditNote.taxAmount, 42);
  assert.equal(creditNote.total, 242);
  assert.ok(creditNote.approvalId);

  let reconciliation = ledger.getInvoiceReconciliation(invoice.id);
  assert.equal(reconciliation.invoiceTotal, 1210);
  assert.equal(reconciliation.adjustedInvoiceTotal, 1210);
  assert.equal(reconciliation.pendingCreditAmount, 242);
  assert.equal(reconciliation.creditedAmount, 0);
  assert.equal(reconciliation.availableAmount, 968);
  assert.equal(ledger.getJobDetail(job.id, { includeAudit: false }).invoices[0].status, 'prepared');
  assert.throws(
    () => ledger.recordPayment(job.id, {
      invoiceId: invoice.id,
      status: 'received',
      amount: 969,
      reference: 'BANK-OVER-RESERVATION'
    }),
    error => error.code === 'payment_exceeds_invoice_balance' && error.details.availableAmount === 968
  );
  assert.throws(
    () => ledger.createCreditNote(job.id, invoice.id, {
      amount: 801,
      reason: 'This request exceeds the remaining balance.'
    }),
    error => error.code === 'credit_note_exceeds_invoice_balance' && error.details.availableAmount === 968
  );

  ledger.resolveApproval(creditNote.approvalId, {
    status: 'rejected',
    resolvedBy: 'finance-approver',
    reason: 'The source line was not duplicated.'
  });
  reconciliation = ledger.getInvoiceReconciliation(invoice.id);
  assert.equal(reconciliation.pendingCreditAmount, 0);
  assert.equal(reconciliation.creditedAmount, 0);
  assert.equal(reconciliation.availableAmount, 1210);
  assert.equal(ledger.getJobDetail(job.id, { includeAudit: false }).creditNotes[0].status, 'rejected');
});

test('approved credit notes create immutable numbered HTML and Peppol UBL packages and reconcile mixed settlement', t => {
  const ledger = temporaryLedger(t);
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner' });
  const job = completedJob(ledger);
  const { invoice, issuePackage: invoicePackage } = issuedInvoice(ledger, job);
  const creditNote = ledger.createCreditNote(job.id, invoice.id, {
    amount: 200,
    taxRate: 21,
    reason: 'Correct <unsafe> duplicated material.',
    description: 'Duplicated material correction',
    structuredExportRequested: true
  }, { actor: 'office' });

  assert.throws(
    () => ledger.prepareCreditNoteIssuePackage(job.id, creditNote.id),
    error => error.code === 'credit_note_not_approved_for_issue' && error.statusCode === 409
  );
  ledger.resolveApproval(creditNote.approvalId, {
    status: 'approved',
    resolvedBy: 'finance-approver',
    reason: 'Correction evidence and VAT treatment checked.'
  });
  const prepared = ledger.prepareCreditNoteIssuePackage(job.id, creditNote.id, { actor: 'office' });
  assert.equal(prepared.replayed, false);
  assert.match(prepared.issueReference, /^CRN-\d{4}-000001$/);
  assert.deepEqual(prepared.documents.map(document => document.type), ['credit_note_issue_package', 'credit_note_ubl_package']);
  assert.equal(prepared.communication.status, 'draft');
  assert.equal(prepared.approval.status, 'pending');
  assert.equal(prepared.reconciliation.creditedAmount, 242);
  assert.equal(prepared.reconciliation.adjustedInvoiceTotal, 968);
  assert.equal(prepared.reconciliation.outstandingAmount, 968);
  assert.equal(prepared.reconciliation.status, 'partially_settled');

  const html = ledger.getCreditNoteIssueDocument(prepared.htmlDocument.id, { actor: 'reviewer' });
  const ubl = ledger.getCreditNoteIssueDocument(prepared.ublDocument.id, { actor: 'reviewer' });
  assert.match(html.content, /Correct &lt;unsafe&gt; duplicated material\./);
  assert.doesNotMatch(html.content, /<unsafe>/);
  assert.match(html.content, new RegExp(invoicePackage.issueReference));
  assert.match(html.content, new RegExp(prepared.packageHash));
  assert.match(ubl.content, /urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2/);
  assert.match(ubl.content, /urn:fdc:peppol\.eu:2017:poacc:billing:3\.0/);
  assert.match(ubl.content, /<cbc:CreditNoteTypeCode>381<\/cbc:CreditNoteTypeCode>/);
  assert.match(ubl.content, new RegExp(`<cac:InvoiceDocumentReference><cbc:ID>${invoicePackage.issueReference}<\\/cbc:ID>`));
  assert.match(ubl.content, /<cac:CreditNoteLine>/);
  assert.match(ubl.content, /<cbc:PayableAmount currencyID="EUR">242\.00<\/cbc:PayableAmount>/);

  const replay = ledger.prepareCreditNoteIssuePackage(job.id, creditNote.id, { actor: 'second-office' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.issueReference, prepared.issueReference);
  assert.equal(replay.approval.id, prepared.approval.id);
  assert.equal(
    ledger.db.prepare('SELECT last_value FROM credit_note_number_sequences WHERE period_year = ?')
      .get(Number(prepared.issueReference.slice(4, 8))).last_value,
    1
  );

  ledger.resolveApproval(prepared.approval.id, {
    status: 'approved',
    resolvedBy: 'delivery-approver',
    reason: 'Attachments and recipient checked.'
  });
  ledger.recordCommunicationDelivery(prepared.communication.id, {
    integration: 'verified-provider',
    providerMessageId: 'credit-provider-message-1'
  }, { actor: 'delivery-api' });
  const sentCredit = ledger.getJobDetail(job.id, { includeAudit: false }).creditNotes[0];
  assert.equal(sentCredit.status, 'sent');
  assert.equal(sentCredit.data.issuePackage.transportStatus, 'delivered_by_verified_integration');

  const payment = ledger.recordPayment(job.id, {
    invoiceId: invoice.id,
    status: 'received',
    amount: 968,
    currency: 'EUR',
    method: 'bank_transfer',
    reference: 'BANK-AFTER-CREDIT'
  }, { actor: 'office' });
  ledger.resolveApproval(payment.approvalId, {
    status: 'approved',
    resolvedBy: 'finance-approver',
    reason: 'Bank statement match verified.'
  });
  const settledInvoice = ledger.getJobDetail(job.id, { includeAudit: false }).invoices[0];
  assert.equal(settledInvoice.status, 'settled');
  assert.equal(settledInvoice.data.reconciliation.outstandingAmount, 0);
  assert.equal(settledInvoice.data.reconciliation.receivedAmount, 968);
  assert.equal(settledInvoice.data.reconciliation.creditedAmount, 242);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('full credit closes the receivable and package tampering fails closed', t => {
  const ledger = temporaryLedger(t);
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner' });
  const job = completedJob(ledger, 'full');
  const { invoice } = issuedInvoice(ledger, job);
  const creditNote = ledger.createCreditNote(job.id, invoice.id, {
    amount: 1000,
    taxRate: 21,
    reason: 'Cancel the complete invoice after retained scope reversal.'
  });
  ledger.resolveApproval(creditNote.approvalId, {
    status: 'approved',
    resolvedBy: 'finance-approver',
    reason: 'Complete scope reversal checked.'
  });
  const prepared = ledger.prepareCreditNoteIssuePackage(job.id, creditNote.id);
  const detail = ledger.getJobDetail(job.id, { includeAudit: false });
  assert.equal(detail.invoices[0].status, 'credited');
  assert.equal(ledger.getInvoiceReconciliation(invoice.id).outstandingAmount, 0);
  assert.equal(
    ledger.listFinanceReadiness({ mode: 'payment', limit: 100 }).jobs.some(item => item.jobId === job.id),
    false
  );

  const retained = ledger.db.prepare('SELECT data_json FROM documents WHERE id = ?').get(prepared.ublDocument.id).data_json;
  const tampered = JSON.parse(retained);
  tampered.snapshot.creditNote.total = 1;
  ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(JSON.stringify(tampered), prepared.ublDocument.id);
  assert.throws(
    () => ledger.getCreditNoteIssueDocument(prepared.ublDocument.id),
    error => error.code === 'credit_note_issue_package_integrity_failed' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.resolveApproval(prepared.approval.id, {
      status: 'approved',
      resolvedBy: 'delivery-approver',
      reason: 'Attempt delivery after tampering.'
    }),
    error => error.code === 'credit_note_issue_package_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).some(item => item.id === prepared.approval.id), true);
});
