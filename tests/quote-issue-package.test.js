const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-quote-package-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function organizationPayload(overrides = {}) {
  return {
    legalName: 'Contractor Nederland B.V.',
    tradingName: 'Contractor Nederland',
    registrationNumber: '12345678',
    vatNumber: 'NL123456789B01',
    email: 'offertes@contractor.example',
    phone: '+31 20 123 45 67',
    website: 'https://contractor.example',
    address: 'Ledgerstraat 10',
    postalCode: '1234 AB',
    city: 'Utrecht',
    country: 'NL',
    iban: 'NL91 ABNA 0417 1643 00',
    bic: 'ABNANL2A',
    defaultPaymentTermsDays: 30,
    defaultQuoteValidityDays: 30,
    quoteTerms: 'Scope outside this quote requires a separately accepted change order.',
    ...overrides
  };
}

function approvedQuote(ledger) {
  const job = ledger.createIntake({
    client: { name: '<script>Client</script>', email: 'client@example.test' },
    title: 'Controlled kitchen renovation',
    service: 'renovation',
    address: 'Clientstraat 4',
    city: 'Rotterdam',
    description: 'Prepare and install the retained scope.',
    assignAutomatically: false
  }, { actor: 'office-commercial' });
  const quote = ledger.createQuote(job.id, {
    currency: 'EUR',
    taxRate: 21,
    validUntil: '2026-09-30',
    notes: 'Price is based on the retained scope.',
    lineItems: [
      { description: 'Preparation <unsafe>', quantity: 2, unitPrice: 125, costCode: 'PREP' },
      { description: 'Installation', quantity: 3, unitPrice: 200, costCode: 'INSTALL' }
    ]
  }, { actor: 'office-commercial' });
  return { job, quote };
}

test('business identity is durable, validated, and reports commercial issue readiness', t => {
  const ledger = temporaryLedger(t);
  const initial = ledger.getOrganizationProfile();
  assert.equal(initial.profileId, 'primary');
  assert.equal(initial.readiness.ready, false);
  assert.ok(initial.readiness.missingFields.includes('legalName'));
  assert.ok(initial.readiness.missingFields.includes('vatNumber'));

  assert.throws(
    () => ledger.updateOrganizationProfile(organizationPayload({ email: 'not-an-email' })),
    error => error.code === 'organization_profile_invalid' && error.statusCode === 400
  );
  assert.throws(
    () => ledger.updateOrganizationProfile(organizationPayload({ country: 'NLD' })),
    error => error.code === 'organization_profile_invalid' && error.statusCode === 400
  );

  const retained = ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner-profile' });
  assert.equal(retained.readiness.ready, true);
  assert.equal(retained.iban, 'NL91ABNA0417164300');
  assert.equal(retained.registrationNumber, '12345678');
  assert.equal(retained.data.quoteTerms, organizationPayload().quoteTerms);

  assert.equal(ledger.getOrganizationProfile().legalName, retained.legalName);
  assert.equal(ledger.migrationStatus().currentVersion, '014_organization_profile');
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('approved quotes create one immutable issue package and one approval-gated delivery draft', t => {
  const ledger = temporaryLedger(t);
  const { job, quote } = approvedQuote(ledger);

  assert.throws(
    () => ledger.prepareQuoteIssuePackage(job.id, quote.id),
    error => error.code === 'quote_not_approved_for_issue' && error.statusCode === 409
  );
  ledger.resolveApproval(quote.approvalId, { status: 'approved', resolvedBy: 'commercial-approver' });
  assert.throws(
    () => ledger.prepareQuoteIssuePackage(job.id, quote.id),
    error => error.code === 'organization_profile_incomplete' && error.statusCode === 409
  );

  ledger.updateOrganizationProfile(organizationPayload({
    legalName: '<script>alert(1)</script> Contractor B.V.',
    tradingName: ''
  }), { actor: 'owner-profile' });
  const prepared = ledger.prepareQuoteIssuePackage(job.id, quote.id, { actor: 'office-commercial' });
  assert.equal(prepared.replayed, false);
  assert.equal(prepared.deliveryMode, 'draft_only');
  assert.equal(prepared.notSent, true);
  assert.equal(prepared.clientAcceptanceRequired, true);
  assert.equal(prepared.externalCommitments, 0);
  assert.equal(prepared.document.type, 'quote_issue_package');
  assert.equal(prepared.document.status, 'prepared');
  assert.equal(prepared.communication.status, 'draft');
  assert.equal(prepared.communication.data.attachmentDocumentIds[0], prepared.document.id);
  assert.equal(prepared.approval.targetType, 'communication');
  assert.equal(prepared.approval.status, 'pending');
  assert.equal(ledger.getJobDetail(job.id).contractValue, 0);

  const issue = ledger.getQuoteIssuePackage(prepared.document.id, { actor: 'package-reviewer' });
  assert.match(issue.filename, /^Q-\d{8}-[A-F0-9]{8}\.html$/);
  assert.match(issue.html, /Preparation &lt;unsafe&gt;/);
  assert.match(issue.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; Contractor B\.V\./);
  assert.match(issue.html, /&lt;script&gt;Client&lt;\/script&gt;/);
  assert.doesNotMatch(issue.html, /<script>/i);
  assert.match(issue.html, new RegExp(prepared.packageHash));
  assert.match(issue.html, /Client acceptance is recorded separately/);

  const replay = ledger.prepareQuoteIssuePackage(job.id, quote.id, { actor: 'second-office-operator' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.document.id, prepared.document.id);
  assert.equal(replay.communication.id, prepared.communication.id);
  assert.equal(replay.approval.id, prepared.approval.id);
  assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM documents WHERE type = 'quote_issue_package'").get().count, 1);
  assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM communication_records WHERE id = ?").get(prepared.communication.id).count, 1);

  ledger.resolveApproval(prepared.approval.id, { status: 'approved', resolvedBy: 'delivery-approver' });
  const afterApproval = ledger.getJobDetail(job.id);
  assert.equal(afterApproval.communications.find(item => item.id === prepared.communication.id).status, 'approved');
  assert.equal(afterApproval.communications.find(item => item.id === prepared.communication.id).sentAt, null);
  assert.equal(afterApproval.contractValue, 0);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('quote issue package downloads fail closed after retained snapshot tampering', t => {
  const ledger = temporaryLedger(t);
  const { job, quote } = approvedQuote(ledger);
  ledger.resolveApproval(quote.approvalId, { status: 'approved', resolvedBy: 'commercial-approver' });
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner-profile' });
  const prepared = ledger.prepareQuoteIssuePackage(job.id, quote.id, { actor: 'office-commercial' });
  const row = ledger.db.prepare('SELECT data_json FROM documents WHERE id = ?').get(prepared.document.id);
  const data = JSON.parse(row.data_json);
  data.snapshot.quote.total = 1;
  ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(JSON.stringify(data), prepared.document.id);

  assert.throws(
    () => ledger.getQuoteIssuePackage(prepared.document.id),
    error => error.code === 'quote_issue_package_integrity_failed' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.prepareQuoteIssuePackage(job.id, quote.id),
    error => error.code === 'quote_issue_package_integrity_failed' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.resolveApproval(prepared.approval.id, { status: 'approved', resolvedBy: 'delivery-approver' }),
    error => error.code === 'quote_issue_package_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).find(item => item.id === prepared.approval.id)?.status, 'pending');

  ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(row.data_json, prepared.document.id);
  ledger.resolveApproval(prepared.approval.id, { status: 'approved', resolvedBy: 'delivery-approver' });
  ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(JSON.stringify(data), prepared.document.id);
  assert.throws(
    () => ledger.recordCommunicationDelivery(prepared.communication.id, { integration: 'verified-mail-provider' }),
    error => error.code === 'quote_issue_package_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.getJobDetail(job.id).communications.find(item => item.id === prepared.communication.id).sentAt, null);
});
