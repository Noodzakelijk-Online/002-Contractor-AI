const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-change-order-package-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function organizationPayload() {
  return {
    legalName: 'Change Control Contractor B.V.',
    tradingName: 'Change Control Contractor',
    registrationNumber: '12345678',
    vatNumber: 'NL123456789B01',
    email: 'changes@contractor.example',
    phone: '+31 30 123 45 67',
    address: 'Ledgerstraat 10',
    postalCode: '3511 AA',
    city: 'Utrecht',
    country: 'NL',
    iban: 'NL91 ABNA 0417 1643 00',
    bic: 'ABNANL2A',
    defaultPaymentTermsDays: 30,
    defaultQuoteValidityDays: 30,
    quoteTerms: 'Additional work starts only after separately verified client acceptance.'
  };
}

function approvedChangeOrder(ledger, suffix = '1') {
  const job = ledger.createIntake({
    title: `Change-order issue ${suffix}`,
    client: {
      name: `<Client ${suffix}>`,
      email: `client-${suffix}@example.test`,
      address: 'Clientstraat 5',
      city: 'Amsterdam',
      country: 'NL'
    },
    address: 'Projectstraat 5',
    city: 'Amsterdam',
    country: 'NL',
    contractValue: 1000,
    assignAutomatically: false
  }, { actor: 'change-order-test' });
  const changeOrder = ledger.createChangeOrder(job.id, {
    title: `Additional lining <${suffix}>`,
    scopeDelta: `Install additional acoustic lining & protection ${suffix}.`,
    taxRate: 21,
    scheduleDeltaDays: 2,
    notes: 'Rates include retained access and protection.',
    lineItems: [
      { description: 'Acoustic lining <unsafe>', quantity: 2, unitPrice: 100, costCode: 'CO-100' },
      { description: 'Protection', quantity: 1, unitPrice: 50, costCode: 'CO-200' }
    ]
  }, { actor: 'change-order-test' });
  ledger.resolveApproval(changeOrder.approvalId, {
    status: 'approved',
    resolvedBy: 'Change approver',
    reason: 'Scope, rates, VAT, and schedule impact checked.'
  });
  return {
    job,
    changeOrder: ledger.getJobDetail(job.id).changeOrders.find(item => item.id === changeOrder.id)
  };
}

test('issued change orders retain an immutable package and bind acceptance to verified delivery', t => {
  const ledger = temporaryLedger(t);
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner' });
  const { job, changeOrder } = approvedChangeOrder(ledger);

  const prepared = ledger.prepareChangeOrderIssuePackage(job.id, changeOrder.id, {}, { actor: 'office' });
  assert.match(prepared.issueReference, /^CO-\d{4}-000001$/);
  assert.equal(prepared.changeOrder.status, 'approved');
  assert.equal(prepared.externalCommitments, 0);
  assert.equal(prepared.document.type, 'change_order_issue_package');
  assert.equal(prepared.document.status, 'prepared');
  assert.equal(prepared.communication.status, 'draft');
  assert.equal(prepared.communication.data.recipient, 'client-1@example.test');
  assert.equal(prepared.approval.targetType, 'communication');
  assert.match(prepared.approval.decision.primaryEffect, /change-order delivery/i);
  assert.ok(prepared.approval.decision.safeguards.some(item => /later verified acceptance/i.test(item)));
  assert.equal(ledger.getJobDetail(job.id).contractValue, 1000);

  const issue = ledger.getChangeOrderIssuePackage(prepared.document.id, { audit: false });
  assert.match(issue.filename, /^CO-\d{4}-000001\.html$/);
  assert.match(issue.html, /Additional lining &lt;1&gt;/);
  assert.match(issue.html, /Acoustic lining &lt;unsafe&gt;/);
  assert.match(issue.html, /Client acceptance is recorded and verified separately/);
  assert.match(issue.html, />Prepared [^<]+<\/p>/);
  assert.doesNotMatch(issue.html, />Issued [^<]+<\/p>/);
  assert.doesNotMatch(issue.html, /<unsafe>/i);
  assert.match(issue.html, new RegExp(prepared.packageHash));

  const replay = ledger.prepareChangeOrderIssuePackage(job.id, changeOrder.id, {}, { actor: 'second-office' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.issueReference, prepared.issueReference);
  assert.equal(replay.document.id, prepared.document.id);
  assert.equal(ledger.db.prepare('SELECT last_value FROM change_order_number_sequences').get().last_value, 1);

  assert.throws(
    () => ledger.requestChangeOrderAcceptance(job.id, changeOrder.id, {
      acceptedAt: '2026-07-16', evidenceReference: 'signed-before-delivery'
    }),
    error => error.code === 'change_order_not_issued' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.recordCommunicationDelivery(prepared.communication.id, {
      integration: 'verified-client-provider', providerMessageId: 'before-approval'
    }),
    error => error.code === 'communication_approval_required' && error.statusCode === 409
  );
  ledger.resolveApproval(prepared.approval.id, {
    status: 'approved',
    resolvedBy: 'Delivery approver',
    reason: 'Recipient and exact frozen package checked.'
  });
  assert.throws(
    () => ledger.recordCommunicationDelivery(prepared.communication.id, { integration: 'verified-client-provider' }),
    error => error.code === 'change_order_delivery_evidence_required' && error.statusCode === 400
  );

  const delivered = ledger.recordCommunicationDelivery(prepared.communication.id, {
    integration: 'verified-client-provider',
    providerMessageId: 'change-message-0001',
    receipt: { status: 'accepted-by-provider' }
  }, { actor: 'verified-integration' });
  assert.equal(delivered.status, 'sent');
  let detail = ledger.getJobDetail(job.id);
  let issued = detail.changeOrders.find(item => item.id === changeOrder.id);
  assert.equal(issued.status, 'issued');
  assert.equal(issued.data.issuePackage.transportStatus, 'delivered_by_verified_integration');
  assert.equal(issued.data.issuePackage.providerMessageId, 'change-message-0001');
  assert.equal(issued.data.issuePackage.externalCommitments, 0);
  assert.equal(detail.contractValue, 1000);

  const acceptance = ledger.requestChangeOrderAcceptance(job.id, changeOrder.id, {
    acceptedAt: '2026-07-16',
    evidenceReference: 'signed-change-order-0001',
    notes: 'Signed package retained in the client contract record.'
  }, { actor: 'office' });
  assert.equal(acceptance.approval.decision.preview.issueReference, prepared.issueReference);
  assert.equal(acceptance.approval.decision.preview.packageHash, prepared.packageHash);
  assert.equal(ledger.getJobDetail(job.id).contractValue, 1000);
  ledger.db.prepare("UPDATE change_orders SET status = 'approved' WHERE id = ?").run(changeOrder.id);
  assert.throws(
    () => ledger.resolveApproval(acceptance.approval.id, {
      status: 'approved', resolvedBy: 'Acceptance approver', reason: 'This state must fail atomically.'
    }),
    error => error.code === 'change_order_acceptance_state_invalid' && error.statusCode === 409
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).find(item => item.id === acceptance.approval.id)?.status, 'pending');
  ledger.db.prepare("UPDATE change_orders SET status = 'issued' WHERE id = ?").run(changeOrder.id);
  ledger.resolveApproval(acceptance.approval.id, {
    status: 'approved',
    resolvedBy: 'Acceptance approver',
    reason: 'Client signature and exact issued package hash checked.'
  });

  detail = ledger.getJobDetail(job.id, { includeAudit: true });
  issued = detail.changeOrders.find(item => item.id === changeOrder.id);
  assert.equal(issued.status, 'accepted');
  assert.equal(issued.data.acceptance.issueReference, prepared.issueReference);
  assert.equal(issued.data.acceptance.packageHash, prepared.packageHash);
  assert.equal(issued.data.acceptance.providerMessageId, 'change-message-0001');
  assert.equal(detail.contractValue, 1250);
  assert.ok(detail.audit.some(event => event.action === 'prepare_change_order_issue_package'));
  assert.ok(detail.audit.some(event => event.action === 'issue_change_order'));
  assert.ok(detail.audit.some(event => event.action === 'accept_change_order_contract'));
  assert.equal(ledger.diagnose().valid, true);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('change-order delivery and acceptance fail closed after source or package tampering', t => {
  const ledger = temporaryLedger(t);
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner' });
  const first = approvedChangeOrder(ledger, '2');
  const prepared = ledger.prepareChangeOrderIssuePackage(first.job.id, first.changeOrder.id);

  ledger.db.prepare("UPDATE change_orders SET scope_delta = 'Tampered scope' WHERE id = ?").run(first.changeOrder.id);
  assert.throws(
    () => ledger.resolveApproval(prepared.approval.id, { status: 'approved', resolvedBy: 'Approver' }),
    error => error.code === 'change_order_issue_package_stale' && error.statusCode === 409
  );
  assert.equal(ledger.getCommunication(prepared.communication.id).status, 'draft');
  ledger.db.prepare('UPDATE change_orders SET scope_delta = ? WHERE id = ?').run(first.changeOrder.scopeDelta, first.changeOrder.id);

  const documentRow = ledger.db.prepare('SELECT data_json FROM documents WHERE id = ?').get(prepared.document.id);
  const documentData = JSON.parse(documentRow.data_json);
  documentData.snapshot.changeOrder.total = 1;
  ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(JSON.stringify(documentData), prepared.document.id);
  assert.throws(
    () => ledger.resolveApproval(prepared.approval.id, { status: 'approved', resolvedBy: 'Approver' }),
    error => error.code === 'change_order_issue_package_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.getCommunication(prepared.communication.id).status, 'draft');
});

test('change-order references are sequential and replay does not consume a number', t => {
  const ledger = temporaryLedger(t);
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner' });
  const first = approvedChangeOrder(ledger, '3');
  const second = approvedChangeOrder(ledger, '4');
  const firstPackage = ledger.prepareChangeOrderIssuePackage(first.job.id, first.changeOrder.id);
  const replay = ledger.prepareChangeOrderIssuePackage(first.job.id, first.changeOrder.id);
  const secondPackage = ledger.prepareChangeOrderIssuePackage(second.job.id, second.changeOrder.id);
  assert.equal(replay.issueReference, firstPackage.issueReference);
  assert.match(firstPackage.issueReference, /-000001$/);
  assert.match(secondPackage.issueReference, /-000002$/);
  assert.equal(ledger.db.prepare('SELECT last_value FROM change_order_number_sequences').get().last_value, 2);
});
