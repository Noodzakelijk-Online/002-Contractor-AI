const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-purchase-order-package-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function organizationPayload() {
  return {
    legalName: 'Order Contractor B.V.',
    tradingName: 'Order Contractor',
    registrationNumber: '12345678',
    vatNumber: 'NL123456789B01',
    email: 'orders@contractor.example',
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

function verifiedSupplier(ledger, suffix = '1') {
  return ledger.upsertTradePartner({
    name: `Verified Order Supplier ${suffix} B.V.`,
    partnerType: 'supplier',
    contactName: 'Supplier Desk',
    email: `orders-${suffix}@supplier.example`,
    phone: '+31 10 555 12 34',
    address: 'Leverancierstraat 20',
    city: 'Rotterdam',
    country: 'NL',
    registrationNumber: `8877665${suffix}`,
    vatNumber: `NL98765432${suffix}B01`,
    verificationReference: `KVK-VAT-ORDER-${suffix}`,
    verifiedAt: new Date(Date.now() - 86_400_000).toISOString(),
    data: { postalCode: '3011 AA' }
  }, { actor: 'purchase-order-test' });
}

function approvedPurchaseOrder(ledger, suffix = '1') {
  const supplier = verifiedSupplier(ledger, suffix);
  const job = ledger.createIntake({
    title: `Purchase order issue ${suffix}`,
    client: { name: `Order Client ${suffix}` },
    address: 'Projectstraat 5',
    city: 'Amsterdam',
    country: 'NL',
    assignAutomatically: false
  }, { actor: 'purchase-order-test' });
  const purchaseOrder = ledger.createPurchaseOrder(job.id, {
    status: 'ready_to_order',
    requiresApproval: true,
    tradePartnerId: supplier.id,
    supplier: supplier.name,
    amount: 1250,
    currency: 'EUR',
    requiredBy: '2026-09-30T23:59:59.000Z',
    notes: 'Deliver against the retained project access plan.',
    items: [
      { description: 'Distribution board', quantity: 1, unit: 'unit', unitCost: 1000, costCode: 'MAT-100' },
      { description: 'Commissioning support', quantity: 2, unit: 'hour', unitCost: 125, costCode: 'LAB-200' }
    ]
  }, { actor: 'purchase-order-test' });
  ledger.resolveApproval(purchaseOrder.approval.id, {
    status: 'approved',
    resolvedBy: 'Purchasing approver',
    reason: 'Supplier, exact lines, net amount, required date, and compliance checked.'
  });
  return { supplier, job, purchaseOrder: ledger.getPurchaseOrder(purchaseOrder.id) };
}

test('approved purchase orders retain immutable HTML and generic UBL packages before verified issue', t => {
  const ledger = temporaryLedger(t);
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner' });
  const { supplier, job, purchaseOrder } = approvedPurchaseOrder(ledger);

  const prepared = ledger.preparePurchaseOrderIssuePackage(job.id, purchaseOrder.id, {}, { actor: 'office' });
  assert.match(prepared.issueReference, /^PO-\d{4}-000001$/);
  assert.equal(prepared.purchaseOrder.status, 'ready_to_order');
  assert.equal(prepared.purchaseOrder.orderIssued, false);
  assert.equal(prepared.purchaseOrder.externalCommitments, 0);
  assert.equal(prepared.documents.length, 2);
  assert.equal(prepared.htmlDocument.type, 'purchase_order_issue_package');
  assert.equal(prepared.ublDocument.type, 'purchase_order_ubl_package');
  assert.equal(prepared.ublDocument.data.networkProfileCertified, false);
  assert.equal(prepared.communication.data.recipient, supplier.email);
  assert.equal(prepared.communication.status, 'draft');
  assert.equal(prepared.approval.targetType, 'communication');
  assert.match(prepared.approval.decision.primaryEffect, /purchase-order/i);
  assert.ok(prepared.approval.decision.safeguards.some(item => /configured provider receipt/i.test(item)));

  const html = ledger.getPurchaseOrderIssueDocument(prepared.htmlDocument.id, { audit: false });
  const ubl = ledger.getPurchaseOrderIssueDocument(prepared.ublDocument.id, { audit: false });
  assert.match(html.content, /Approved net commitment/);
  assert.match(html.content, /€\s*1[.,]250[.,]00|1\.250,00\s*€/);
  assert.match(ubl.content, /<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"/);
  assert.match(ubl.content, /<cbc:OrderTypeCode>220<\/cbc:OrderTypeCode>/);
  assert.match(ubl.content, /<cac:RequestedDeliveryPeriod><cbc:EndDate>2026-09-30<\/cbc:EndDate>/);
  assert.doesNotMatch(ubl.content, /ActualDeliveryDate|CustomizationID|ProfileID/);
  assert.match(ubl.content, /not a Peppol certification or transport receipt/);
  assert.match(ubl.content, /<cbc:PayableAmount currencyID="EUR">1250\.00<\/cbc:PayableAmount>/);

  const replay = ledger.preparePurchaseOrderIssuePackage(job.id, purchaseOrder.id, {}, { actor: 'second-office' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.issueReference, prepared.issueReference);
  assert.equal(replay.packageHash, prepared.packageHash);
  assert.equal(ledger.count('purchase_order_number_sequences'), 1);

  assert.throws(
    () => ledger.recordCommunicationDelivery(prepared.communication.id, {
      integration: 'verified-order-provider', providerMessageId: 'order-message-before-approval'
    }),
    error => error.code === 'communication_approval_required' && error.statusCode === 409
  );
  ledger.resolveApproval(prepared.approval.id, {
    status: 'approved',
    resolvedBy: 'Order transmission approver',
    reason: 'Recipient, order reference, exact frozen lines, HTML, and UBL attachments checked.'
  });
  assert.throws(
    () => ledger.recordCommunicationDelivery(prepared.communication.id, { integration: 'verified-order-provider' }),
    error => error.code === 'purchase_order_delivery_evidence_required' && error.statusCode === 400
  );

  const delivered = ledger.recordCommunicationDelivery(prepared.communication.id, {
    integration: 'verified-order-provider',
    providerMessageId: 'order-message-0001',
    receipt: { status: 'accepted', provider: 'test-provider' }
  }, { actor: 'verified-integration' });
  assert.equal(delivered.status, 'sent');
  const issued = ledger.getPurchaseOrder(purchaseOrder.id);
  assert.equal(issued.status, 'ordered');
  assert.equal(issued.orderIssued, true);
  assert.equal(issued.awardIssued, true);
  assert.equal(issued.externalCommitments, 1);
  assert.equal(issued.issuePackage.providerMessageId, 'order-message-0001');
  assert.equal(issued.issuePackage.transportStatus, 'delivered_by_verified_integration');
  assert.equal(ledger.diagnose().valid, true);

  ledger.db.prepare("UPDATE trade_partners SET status = 'retired' WHERE id = ?").run(supplier.id);
  const historicalReplay = ledger.preparePurchaseOrderIssuePackage(job.id, purchaseOrder.id, {}, { actor: 'audit-review' });
  assert.equal(historicalReplay.replayed, true);
  assert.equal(historicalReplay.externalCommitments, 1);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('purchase-order package approval fails closed when source data or attachments change', t => {
  const ledger = temporaryLedger(t);
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner' });
  const first = approvedPurchaseOrder(ledger, '2');
  const prepared = ledger.preparePurchaseOrderIssuePackage(first.job.id, first.purchaseOrder.id);

  ledger.db.prepare("UPDATE purchase_orders SET required_by = '2026-10-15T23:59:59.000Z' WHERE id = ?").run(first.purchaseOrder.id);
  assert.throws(
    () => ledger.resolveApproval(prepared.approval.id, { status: 'approved', resolvedBy: 'Approver' }),
    error => error.code === 'purchase_order_issue_package_stale' && error.statusCode === 409
  );
  assert.equal(ledger.getCommunication(prepared.communication.id).status, 'draft');
  ledger.db.prepare('UPDATE purchase_orders SET required_by = ? WHERE id = ?').run(first.purchaseOrder.requiredBy, first.purchaseOrder.id);

  const documentRow = ledger.db.prepare('SELECT data_json FROM documents WHERE id = ?').get(prepared.ublDocument.id);
  const documentData = JSON.parse(documentRow.data_json);
  documentData.snapshot.seller.legalName = 'Tampered Supplier';
  ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(JSON.stringify(documentData), prepared.ublDocument.id);
  assert.throws(
    () => ledger.resolveApproval(prepared.approval.id, { status: 'approved', resolvedBy: 'Approver' }),
    error => error.code === 'purchase_order_issue_package_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.getCommunication(prepared.communication.id).status, 'draft');
});

test('purchase-order numbers are durable, sequential, and not consumed by replay', t => {
  const ledger = temporaryLedger(t);
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner' });
  const first = approvedPurchaseOrder(ledger, '3');
  const second = approvedPurchaseOrder(ledger, '4');
  const firstPackage = ledger.preparePurchaseOrderIssuePackage(first.job.id, first.purchaseOrder.id);
  const replay = ledger.preparePurchaseOrderIssuePackage(first.job.id, first.purchaseOrder.id);
  const secondPackage = ledger.preparePurchaseOrderIssuePackage(second.job.id, second.purchaseOrder.id);
  assert.equal(replay.issueReference, firstPackage.issueReference);
  assert.match(firstPackage.issueReference, /-000001$/);
  assert.match(secondPackage.issueReference, /-000002$/);
  assert.equal(ledger.db.prepare('SELECT last_value FROM purchase_order_number_sequences').get().last_value, 2);
});

test('finance readiness gates standalone order preparation and verified delivery in sequence', t => {
  const ledger = temporaryLedger(t);
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'owner' });
  const { supplier, job, purchaseOrder } = approvedPurchaseOrder(ledger, '5');

  let financeRow = ledger.listFinanceReadiness({ limit: 100 }).jobs.find(item => item.jobId === job.id);
  assert.ok(financeRow);
  assert.equal(financeRow.flags.purchaseOrderPackageReady, true);
  assert.equal(financeRow.flags.purchaseOrderDeliveryReady, false);
  assert.deepEqual(
    financeRow.nextActions.find(action => action.type === 'prepare_purchase_order_package'),
    {
      type: 'prepare_purchase_order_package',
      label: 'Prepare immutable purchase-order package',
      purchaseOrderId: purchaseOrder.id,
      supplier: supplier.name,
      recipient: supplier.email,
      requiresApproval: false
    }
  );

  const prepared = ledger.preparePurchaseOrderIssuePackage(job.id, purchaseOrder.id, {}, { actor: 'office' });
  financeRow = ledger.listFinanceReadiness({ limit: 100 }).jobs.find(item => item.jobId === job.id);
  assert.equal(financeRow.flags.approvalRequired, true);
  assert.equal(financeRow.flags.purchaseOrderDeliveryReady, false);
  assert.equal(financeRow.counts.purchaseOrderDeliveriesReady, 0);
  assert.equal(financeRow.nextActions.some(action => action.type === 'record_purchase_order_delivery'), false);

  ledger.resolveApproval(prepared.approval.id, {
    status: 'approved',
    resolvedBy: 'Order transmission approver',
    reason: 'Recipient and frozen order attachments verified.'
  });
  financeRow = ledger.listFinanceReadiness({ limit: 100 }).jobs.find(item => item.jobId === job.id);
  const deliveryAction = financeRow.nextActions.find(action => action.type === 'record_purchase_order_delivery');
  assert.equal(financeRow.flags.approvalRequired, false);
  assert.equal(financeRow.flags.purchaseOrderDeliveryReady, true);
  assert.equal(financeRow.counts.purchaseOrderDeliveriesReady, 1);
  assert.deepEqual(deliveryAction, {
    type: 'record_purchase_order_delivery',
    label: 'Record verified purchase-order delivery',
    purchaseOrderId: purchaseOrder.id,
    communicationId: prepared.communication.id,
    issueReference: prepared.issueReference,
    supplier: supplier.name,
    recipient: supplier.email,
    requiresApproval: false
  });
  assert.equal(financeRow.latest.purchaseOrder.id, purchaseOrder.id);

  ledger.recordCommunicationDelivery(prepared.communication.id, {
    integration: 'verified-order-provider',
    providerMessageId: 'finance-order-message-0005'
  }, { actor: 'verified-integration' });
  financeRow = ledger.listFinanceReadiness({ limit: 100 }).jobs.find(item => item.jobId === job.id);
  assert.equal(financeRow.flags.purchaseOrderDeliveryReady, false);
  assert.equal(financeRow.counts.purchaseOrderDeliveriesReady, 0);
  assert.equal(financeRow.nextActions.some(action => action.type === 'record_purchase_order_delivery'), false);
  assert.equal(financeRow.latest.purchaseOrder.orderIssued, true);
  assert.equal(financeRow.latest.purchaseOrder.externalCommitments, 1);
});
