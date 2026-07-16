const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-material-receiving-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function organizationPayload() {
  return {
    legalName: 'Receiving Contractor B.V.',
    tradingName: 'Receiving Contractor',
    registrationNumber: '12345678',
    vatNumber: 'NL123456789B01',
    email: 'orders@receiving.example',
    phone: '+31 30 123 45 67',
    address: 'Ledgerstraat 10',
    postalCode: '3511 AA',
    city: 'Utrecht',
    country: 'NL',
    iban: 'NL91 ABNA 0417 1643 00',
    bic: 'ABNANL2A'
  };
}

function issuedPurchaseOrder(ledger, suffix = '1', { quantity = 8 } = {}) {
  ledger.updateOrganizationProfile(organizationPayload(), { actor: 'receiving_test' });
  const supplier = ledger.upsertTradePartner({
    name: `Receiving Supplier ${suffix} B.V.`,
    partnerType: 'supplier',
    contactName: 'Delivery desk',
    email: `delivery-${suffix}@supplier.example`,
    registrationNumber: `8877665${suffix}`,
    vatNumber: `NL98765432${suffix}B01`,
    verificationReference: `KVK-RECEIVING-${suffix}`,
    verifiedAt: new Date(Date.now() - 86_400_000).toISOString()
  }, { actor: 'receiving_test' });
  const job = ledger.createIntake({
    title: `Material receiving ${suffix}`,
    client: { name: `Receiving Client ${suffix}` },
    status: 'scheduled',
    assignAutomatically: false
  }, { actor: 'receiving_test' });
  const requirement = ledger.addMaterialRequirement(job.id, {
    name: 'Tile adhesive', quantity, unit: 'bags', status: 'needed', supplier: supplier.name
  }, { actor: 'receiving_test' });
  const requested = ledger.createPurchaseOrder(job.id, {
    status: 'ready_to_order',
    requiresApproval: true,
    tradePartnerId: supplier.id,
    supplier: supplier.name,
    amount: quantity * 20,
    currency: 'EUR',
    requiredBy: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    items: [{ lineKey: 'adhesive', materialRequirementId: requirement.id, name: requirement.name, quantity, unit: 'bags', unitCost: 20 }]
  }, { actor: 'receiving_test' });
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved', resolvedBy: 'purchase_approver', reason: 'Supplier, scope, amount, and compliance verified.'
  });
  const prepared = ledger.preparePurchaseOrderIssuePackage(job.id, requested.id, {}, { actor: 'receiving_test' });
  ledger.resolveApproval(prepared.approval.id, {
    status: 'approved', resolvedBy: 'delivery_approver', reason: 'Recipient and immutable order package verified.'
  });
  ledger.recordCommunicationDelivery(prepared.communication.id, {
    integration: 'verified-order-provider',
    providerMessageId: `receiving-order-${suffix}`,
    receipt: { status: 'accepted' }
  }, { actor: 'verified_integration' });
  return { job, supplier, requirement, purchaseOrder: ledger.getPurchaseOrder(requested.id) };
}

test('material receipts are exact-replay safe, synchronize requirements, and prove supplier invoice matching', t => {
  const ledger = temporaryLedger(t);
  const fixture = issuedPurchaseOrder(ledger, '1');
  const deliveredAt = new Date(Date.now() - 60_000).toISOString();
  const payload = {
    purchaseOrderId: fixture.purchaseOrder.id,
    receiptReference: 'GR-RECEIVING-001',
    evidenceReference: 'signed-ticket:GR-RECEIVING-001',
    deliveredAt,
    receivedBy: 'Site receiver',
    location: 'Ground-floor store',
    finalDelivery: true,
    entryKey: 'material-receipt-001',
    lines: [{
      lineKey: 'adhesive',
      materialRequirementId: fixture.requirement.id,
      itemName: 'Tile adhesive',
      unit: 'bags',
      receivedQuantity: 8,
      acceptedQuantity: 8,
      damagedQuantity: 0
    }]
  };
  const fieldPlans = ledger.listMaterialReceivingPlansForJob(fixture.job.id);
  assert.equal(fieldPlans.length, 1);
  assert.equal(fieldPlans[0].lines[0].remainingQuantity, 8);

  const created = ledger.createMaterialReceipt(fixture.job.id, payload, { actor: 'field_receiver' });
  assert.equal(created.replayed, false);
  assert.equal(created.receipt.status, 'received');
  assert.equal(created.receipt.summary.acceptedQuantity, 8);
  assert.equal(created.receipt.exceptions.length, 0);
  assert.equal(ledger.getJobDetail(fixture.job.id).materials[0].status, 'available');
  assert.equal(ledger.getJobDetail(fixture.job.id).materials[0].data.receiptControl.acceptedQuantity, 8);
  assert.equal(ledger.materialReceiptPurchaseOrderPlan(fixture.purchaseOrder.id).summary.complete, true);
  assert.equal(ledger.listMaterialReceivingPlansForJob(fixture.job.id).length, 0);

  const replay = ledger.createMaterialReceipt(fixture.job.id, payload, { actor: 'offline_retry' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt.id, created.receipt.id);
  assert.equal(ledger.count('material_receipts'), 1);
  assert.throws(
    () => ledger.createMaterialReceipt(fixture.job.id, {
      ...payload,
      lines: [{ ...payload.lines[0], receivedQuantity: 7, acceptedQuantity: 7 }]
    }),
    error => error.code === 'material_receipt_replay_conflict' && error.statusCode === 409
  );

  const invoice = ledger.createSupplierInvoice(fixture.job.id, {
    supplier: fixture.supplier.name,
    tradePartnerId: fixture.supplier.id,
    purchaseOrderId: fixture.purchaseOrder.id,
    materialReceiptId: created.receipt.id,
    invoiceNumber: 'SUP-RECEIVING-001',
    netAmount: 160,
    taxAmount: 33.6,
    total: 193.6,
    currency: 'EUR',
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueAt: new Date(Date.now() + 30 * 86_400_000).toISOString()
  }, { actor: 'accounts_payable' });
  assert.equal(invoice.data.match.status, 'matched');
  assert.equal(invoice.data.match.type, 'three_way_material_receipt');
  assert.equal(invoice.data.match.materialReceiptId, created.receipt.id);
  ledger.resolveApproval(invoice.approval.id, {
    status: 'approved', resolvedBy: 'payable_approver', reason: 'Purchase order, receipt, invoice, and supplier verified.'
  });

  const reversal = ledger.requestMaterialReceiptReversal(fixture.job.id, created.receipt.id, {
    reason: 'The retained ticket was entered against the wrong delivery.'
  }, { actor: 'office_operator' });
  assert.throws(
    () => ledger.resolveApproval(reversal.approval.id, {
      status: 'approved', resolvedBy: 'receipt_approver', reason: 'Requested reversal reviewed.'
    }),
    error => error.code === 'material_receipt_linked_payable_required' && error.statusCode === 409
  );
  assert.equal(ledger.getMaterialReceipt(created.receipt.id).status, 'pending_reversal');
});

test('partial and damaged receipts retain discrepancies and reverse through one approval without deleting evidence', t => {
  const ledger = temporaryLedger(t);
  const fixture = issuedPurchaseOrder(ledger, '2', { quantity: 10 });
  const receipt = ledger.createMaterialReceipt(fixture.job.id, {
    purchaseOrderId: fixture.purchaseOrder.id,
    receiptReference: 'GR-RECEIVING-002',
    evidenceReference: 'photo:GR-RECEIVING-002',
    deliveredAt: new Date(Date.now() - 60_000).toISOString(),
    receivedBy: 'Site receiver',
    entryKey: 'material-receipt-002',
    finalDelivery: true,
    lines: [{
      lineKey: 'adhesive', materialRequirementId: fixture.requirement.id,
      itemName: 'Tile adhesive', unit: 'bags', receivedQuantity: 8, acceptedQuantity: 6, damagedQuantity: 2
    }]
  }, { actor: 'field_receiver' }).receipt;
  assert.equal(receipt.status, 'discrepancy');
  assert.ok(receipt.exceptions.some(item => item.code === 'damaged_quantity'));
  assert.ok(receipt.exceptions.some(item => item.code === 'short_final_delivery'));
  assert.equal(ledger.getJobDetail(fixture.job.id).materials[0].status, 'received');
  assert.equal(ledger.getJobDetail(fixture.job.id).materials[0].data.availableQuantity, 6);
  const inventoryException = ledger.listInventoryReadiness({ mode: 'receiving_exception' }).jobs.find(item => item.jobId === fixture.job.id);
  assert.equal(inventoryException.inventoryStatus, 'receiving_exception');
  assert.equal(inventoryException.flags.receivingException, true);
  assert.equal(inventoryException.counts.materialReceiptExceptions, 1);
  assert.equal(inventoryException.nextActions[0].materialReceiptId, receipt.id);

  const requested = ledger.requestMaterialReceiptReversal(fixture.job.id, receipt.id, {
    reason: 'The delivery note belongs to another project and must be reversed.'
  }, { actor: 'office_operator' });
  assert.equal(requested.receipt.status, 'pending_reversal');
  assert.equal(ledger.getJobDetail(fixture.job.id).materials[0].data.availableQuantity, 6);
  ledger.resolveApproval(requested.approval.id, {
    status: 'rejected', resolvedBy: 'receipt_approver', reason: 'The site and supplier references confirm this project.'
  });
  assert.equal(ledger.getMaterialReceipt(receipt.id).status, 'discrepancy');

  const approvedRequest = ledger.requestMaterialReceiptReversal(fixture.job.id, receipt.id, {
    reason: 'A corrected supplier ticket proves the original project link was wrong.'
  }, { actor: 'office_operator' });
  ledger.resolveApproval(approvedRequest.approval.id, {
    status: 'approved', resolvedBy: 'receipt_approver', reason: 'Corrected supplier ticket and project references verified.'
  });
  const reversed = ledger.getMaterialReceipt(receipt.id);
  assert.equal(reversed.status, 'reversed');
  assert.equal(reversed.lines.length, 1);
  assert.equal(ledger.getJobDetail(fixture.job.id).materials[0].status, 'needed');
  assert.equal(ledger.getJobDetail(fixture.job.id).materials[0].data.availableQuantity, 0);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
  assert.equal(ledger.diagnose().valid, true);
});

test('autonomy creates one internal material receiving review and never changes supplier or finance state', t => {
  const ledger = temporaryLedger(t);
  const fixture = issuedPurchaseOrder(ledger, '3');
  const receipt = ledger.createMaterialReceipt(fixture.job.id, {
    purchaseOrderId: fixture.purchaseOrder.id,
    receiptReference: 'GR-RECEIVING-003',
    evidenceReference: 'signed-ticket:GR-RECEIVING-003',
    deliveredAt: new Date(Date.now() - 60_000).toISOString(),
    receivedBy: 'Site receiver',
    entryKey: 'material-receipt-003',
    lines: [{
      lineKey: 'adhesive', materialRequirementId: fixture.requirement.id,
      itemName: 'Tile adhesive', unit: 'bags', receivedQuantity: 8, acceptedQuantity: 7, damagedQuantity: 1
    }]
  }, { actor: 'field_receiver' }).receipt;

  const preview = ledger.nextActions().filter(action => action.type === 'review_material_receipt' && action.materialReceiptId === receipt.id);
  assert.equal(preview.length, 1);
  const communicationCount = ledger.count('communication_records');
  const first = ledger.runAutonomousCycle({ actionTypes: ['review_material_receipt'], jobIds: [fixture.job.id] });
  assert.equal(first.applied.length, 1);
  const task = ledger.getJobDetail(fixture.job.id).tasks.find(item => item.id === first.applied[0].taskId);
  assert.equal(task.data.internalOnly, true);
  assert.equal(task.data.externalCommitments, 0);
  assert.equal(ledger.getMaterialReceipt(receipt.id).status, 'discrepancy');
  assert.equal(ledger.count('supplier_invoices'), 0);
  assert.equal(ledger.count('communication_records'), communicationCount);
  const second = ledger.runAutonomousCycle({ actionTypes: ['review_material_receipt'], jobIds: [fixture.job.id] });
  assert.equal(second.applied.length, 0);
  assert.equal(ledger.diagnose().valid, true);
});
