const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-supplier-payables-'));
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');

const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  return { response, body: await response.json() };
}

async function resolve(baseUrl, approvalId, reason) {
  return request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(approvalId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Payables QA approver', ...(reason ? { reason } : {}) })
  });
}

let fixtureSequence = 0;

async function createApprovedPayableFixture(t, overrides = {}) {
  fixtureSequence += 1;
  const server = app.listen(0);
  await new Promise(resolveListening => server.once('listening', resolveListening));
  t.after(() => new Promise(resolveClose => server.close(resolveClose)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const supplier = `Autonomous Payable Supplier ${fixtureSequence} B.V.`;
  const partner = await request(baseUrl, '/api/ledger/trade-partners', {
    method: 'POST',
    body: JSON.stringify({
      name: supplier,
      partnerType: 'supplier',
      registrationNumber: String(88_000_000 + fixtureSequence),
      vatNumber: `NL12345678${fixtureSequence}B01`,
      verificationReference: `AUTONOMOUS-PAYABLE-${fixtureSequence}`,
      verifiedAt: new Date(Date.now() - 86_400_000).toISOString()
    })
  });
  assert.equal(partner.response.status, 201);
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: `Autonomous supplier payable ${fixtureSequence}`,
      client: { name: `Autonomous Payable Client ${fixtureSequence}` },
      status: 'scheduled',
      estimatedCost: 500,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  const purchaseOrder = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/purchase-orders`, {
    method: 'POST',
    body: JSON.stringify({
      supplier,
      tradePartnerId: partner.body.partner.id,
      status: 'ready_to_order',
      amount: 500,
      currency: 'EUR',
      items: [{ name: 'Autonomous review materials', quantity: 1, unitCost: 500 }]
    })
  });
  assert.equal(purchaseOrder.response.status, 201);
  const purchaseApproval = await resolve(baseUrl, purchaseOrder.body.purchaseOrder.approvalId, 'Supplier and purchase commitment verified.');
  assert.equal(purchaseApproval.response.status, 200);
  const createdInvoice = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/supplier-invoices`, {
    method: 'POST',
    body: JSON.stringify({
      purchaseOrderId: purchaseOrder.body.purchaseOrder.id,
      tradePartnerId: partner.body.partner.id,
      supplier,
      invoiceNumber: overrides.invoiceNumber || `SUP-AUTO-${fixtureSequence}`,
      invoiceDate: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
      dueAt: overrides.dueAt || new Date(Date.now() - 86_400_000).toISOString(),
      netAmount: 500,
      taxAmount: 105,
      total: 605,
      currency: 'EUR',
      deliveryReference: `AUTONOMOUS-GR-${fixtureSequence}`
    })
  });
  assert.equal(createdInvoice.response.status, 201);
  const invoiceApproval = await resolve(baseUrl, createdInvoice.body.supplierInvoice.approvalId, 'Purchase order, delivery evidence, and invoice totals verified.');
  assert.equal(invoiceApproval.response.status, 200);
  return { baseUrl, jobId, supplierInvoice: createdInvoice.body.supplierInvoice };
}

test('supplier payables retain three-way matches, refuse duplicates, and reconcile approved payment evidence', async t => {
  const server = app.listen(0);
  await new Promise(resolveListening => server.once('listening', resolveListening));
  t.after(() => new Promise(resolveClose => server.close(resolveClose)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const partnerName = 'Payables QA Supply B.V.';
  const partner = await request(baseUrl, '/api/ledger/trade-partners', {
    method: 'POST',
    body: JSON.stringify({
      name: partnerName,
      partnerType: 'supplier',
      registrationNumber: '88776655',
      vatNumber: 'NL123456789B01',
      verificationReference: 'KVK and VAT verification PAYABLES-QA-1',
      verifiedAt: new Date(Date.now() - 86_400_000).toISOString()
    })
  });
  assert.equal(partner.response.status, 201);
  assert.equal(partner.body.partner.compliance.compliant, true);

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Supplier payable lifecycle',
      client: { name: 'Payables QA Client' },
      status: 'scheduled',
      estimatedCost: 1000,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const purchaseOrder = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/purchase-orders`, {
    method: 'POST',
    body: JSON.stringify({
      supplier: partnerName,
      tradePartnerId: partner.body.partner.id,
      status: 'ready_to_order',
      amount: 1000,
      currency: 'EUR',
      orderReference: 'PO-PAYABLES-001',
      items: [{ name: 'Installation materials', quantity: 1, unitCost: 1000 }]
    })
  });
  assert.equal(purchaseOrder.response.status, 201);
  assert.equal(purchaseOrder.body.purchaseOrder.status, 'pending_approval');
  const purchaseApproval = await resolve(baseUrl, purchaseOrder.body.purchaseOrder.approvalId, 'Supplier compliance and purchase commitment verified.');
  assert.equal(purchaseApproval.response.status, 200);
  const deliveryEvidence = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/documents`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'service_completion',
      title: 'Signed service completion GR-0042',
      filename: 'service-completion-gr-0042.pdf'
    })
  });
  assert.equal(deliveryEvidence.response.status, 201);

  const invoiceDate = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const dueAt = new Date(Date.now() - 1_000).toISOString();
  const supplierInvoicePayload = {
    purchaseOrderId: purchaseOrder.body.purchaseOrder.id,
    tradePartnerId: partner.body.partner.id,
    supplier: partnerName,
    invoiceNumber: 'SUP-2026-0042',
    invoiceDate,
    dueAt,
    netAmount: 1000,
    taxAmount: 210,
    total: 1210,
    currency: 'EUR',
    deliveryDocumentId: deliveryEvidence.body.document.id,
    notes: 'Goods receipt, quantity, supplier, and amount checked against the approved purchase order.'
  };
  const supplierInvoice = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/supplier-invoices`, {
    method: 'POST',
    body: JSON.stringify(supplierInvoicePayload)
  });
  assert.equal(supplierInvoice.response.status, 201);
  assert.equal(supplierInvoice.body.externalPaymentInitiated, false);
  assert.equal(supplierInvoice.body.supplierInvoice.status, 'pending_approval');
  assert.equal(supplierInvoice.body.supplierInvoice.match.status, 'matched');
  assert.equal(supplierInvoice.body.supplierInvoice.match.type, 'three_way_service_completion');
  assert.deepEqual(supplierInvoice.body.supplierInvoice.match.exceptions, []);
  assert.equal(supplierInvoice.body.supplierInvoice.total, 1210);

  const duplicateInvoice = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/supplier-invoices`, {
    method: 'POST',
    body: JSON.stringify({ ...supplierInvoicePayload, purchaseOrderId: null })
  });
  assert.equal(duplicateInvoice.response.status, 409);
  assert.equal(duplicateInvoice.body.error.code, 'duplicate_supplier_invoice');
  assert.equal(duplicateInvoice.body.error.details.supplierInvoiceId, supplierInvoice.body.supplierInvoice.id);

  const invoiceApproval = await resolve(baseUrl, supplierInvoice.body.supplierInvoice.approvalId, 'Purchase order, delivery receipt, VAT, and invoice number verified.');
  assert.equal(invoiceApproval.response.status, 200);
  const payableQueue = await request(baseUrl, '/api/ledger/finance?mode=payable_due&limit=100');
  assert.equal(payableQueue.response.status, 200);
  const payableJob = payableQueue.body.jobs.find(item => item.jobId === jobId);
  assert.ok(payableJob);
  assert.equal(payableJob.financeStatus, 'payable_due');
  assert.equal(payableJob.flags.supplierPayableOutstanding, true);
  assert.equal(payableJob.flags.supplierPayableDue, true);
  assert.equal(payableJob.money.supplierInvoiceNetValue, 1000);
  assert.equal(payableJob.money.supplierPayableValue, 1210);
  assert.equal(payableJob.counts.dueSupplierInvoices, 1);
  assert.ok(payableJob.nextActions.some(action => action.type === 'record_supplier_payment'));

  const partialPayment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/supplier-invoices/${encodeURIComponent(supplierInvoice.body.supplierInvoice.id)}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      amount: 242,
      paidAt: new Date().toISOString(),
      method: 'bank_transfer',
      reference: 'BANK-PAYABLES-0042-A',
      notes: 'Partial bank payment visible on the retained bank statement.'
    })
  });
  assert.equal(partialPayment.response.status, 201);
  assert.equal(partialPayment.body.externalPaymentInitiated, false);
  assert.equal(partialPayment.body.supplierPayment.status, 'pending_confirmation');
  assert.equal(partialPayment.body.supplierPayment.data.externalPaymentInitiated, false);

  const duplicatePayment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/supplier-invoices/${encodeURIComponent(supplierInvoice.body.supplierInvoice.id)}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      amount: 242,
      paidAt: new Date().toISOString(),
      method: 'bank_transfer',
      reference: 'BANK-PAYABLES-0042-A',
      notes: 'Duplicate reference must be refused.'
    })
  });
  assert.equal(duplicatePayment.response.status, 409);
  assert.equal(duplicatePayment.body.error.code, 'duplicate_supplier_payment_reference');

  const pendingDetail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(pendingDetail.body.job.supplierInvoices[0].status, 'approved');
  assert.equal(pendingDetail.body.job.supplierInvoicePayments[0].status, 'pending_confirmation');
  const partialApproval = await resolve(baseUrl, partialPayment.body.supplierPayment.approvalId, 'Bank statement reference and amount verified.');
  assert.equal(partialApproval.response.status, 200);

  const partiallyPaidDetail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  const partiallyPaidInvoice = partiallyPaidDetail.body.job.supplierInvoices.find(item => item.id === supplierInvoice.body.supplierInvoice.id);
  assert.equal(partiallyPaidInvoice.status, 'partially_paid');
  assert.equal(partiallyPaidInvoice.data.reconciliation.paidAmount, 242);
  assert.equal(partiallyPaidInvoice.data.reconciliation.outstandingAmount, 968);

  const finalPayment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/supplier-invoices/${encodeURIComponent(supplierInvoice.body.supplierInvoice.id)}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      amount: 968,
      paidAt: new Date().toISOString(),
      method: 'bank_transfer',
      reference: 'BANK-PAYABLES-0042-B',
      notes: 'Final bank payment visible on the retained bank statement.'
    })
  });
  assert.equal(finalPayment.response.status, 201);
  const finalApproval = await resolve(baseUrl, finalPayment.body.supplierPayment.approvalId, 'Final bank statement amount and reference verified.');
  assert.equal(finalApproval.response.status, 200);

  const settledDetail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  const settledInvoice = settledDetail.body.job.supplierInvoices.find(item => item.id === supplierInvoice.body.supplierInvoice.id);
  assert.equal(settledInvoice.status, 'paid');
  assert.equal(settledInvoice.data.reconciliation.paidAmount, 1210);
  assert.equal(settledInvoice.data.reconciliation.outstandingAmount, 0);
  assert.equal(settledDetail.body.job.supplierInvoicePayments.filter(payment => payment.status === 'paid').length, 2);

  const exported = await request(baseUrl, '/api/operations/export');
  assert.equal(exported.response.status, 200);
  assert.ok(exported.body.supplierInvoices.some(item => item.id === supplierInvoice.body.supplierInvoice.id));
  assert.equal(exported.body.supplierInvoicePayments.filter(item => item.supplierInvoiceId === supplierInvoice.body.supplierInvoice.id).length, 2);

  const handoff = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/finance-handoffs`, {
    method: 'POST',
    body: JSON.stringify({ status: 'draft', targetSystem: 'FAB', notes: 'Supplier payable handoff package QA.' })
  });
  assert.equal(handoff.response.status, 201);
  assert.ok(handoff.body.financeHandoff.package.supplierInvoices.some(item => item.id === supplierInvoice.body.supplierInvoice.id));
  assert.equal(handoff.body.financeHandoff.package.supplierInvoicePayments.filter(item => item.status === 'paid').length, 2);

  const audit = await request(baseUrl, `/api/ledger/audit?jobId=${encodeURIComponent(jobId)}&limit=200`);
  for (const action of [
    'record_supplier_invoice',
    'approve_supplier_invoice_match',
    'record_supplier_payment_confirmation',
    'approve_supplier_payment_confirmation',
    'reconcile_supplier_payable'
  ]) {
    assert.ok(audit.body.events.some(event => event.action === action), `missing audit action ${action}`);
  }
  assert.ok(audit.body.events
    .filter(event => ['record_supplier_invoice', 'record_supplier_payment_confirmation', 'approve_supplier_payment_confirmation'].includes(event.action))
    .every(event => event.metadata.externalCommitments === 0));
});

test('supplier invoice match exceptions require a retained approver override reason', async t => {
  const server = app.listen(0);
  await new Promise(resolveListening => server.once('listening', resolveListening));
  t.after(() => new Promise(resolveClose => server.close(resolveClose)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Supplier invoice exception override',
      client: { name: 'Payables Exception Client' },
      status: 'scheduled',
      assignAutomatically: false
    })
  });
  const jobId = intake.body.job.id;
  const invoice = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/supplier-invoices`, {
    method: 'POST',
    body: JSON.stringify({
      supplier: 'One-off Emergency Supplier',
      invoiceNumber: 'EMERGENCY-009',
      invoiceDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      netAmount: 200,
      taxAmount: 42,
      total: 242,
      deliveryReference: 'Emergency call-out completion sheet EC-009',
      notes: 'No purchase order existed because the call-out prevented further damage.'
    })
  });
  assert.equal(invoice.response.status, 201);
  assert.equal(invoice.body.supplierInvoice.match.status, 'exception');
  assert.ok(invoice.body.supplierInvoice.match.exceptions.some(item => item.code === 'purchase_order_missing'));
  assert.ok(invoice.body.supplierInvoice.match.exceptions.some(item => item.code === 'trade_partner_missing'));
  assert.equal(invoice.body.supplierInvoice.approval.data.requiresExceptionOverride, true);

  const missingReason = await resolve(baseUrl, invoice.body.supplierInvoice.approvalId);
  assert.equal(missingReason.response.status, 400);
  assert.equal(missingReason.body.error.code, 'supplier_invoice_exception_reason_required');

  const approved = await resolve(
    baseUrl,
    invoice.body.supplierInvoice.approvalId,
    'Emergency work completion is verified; create and verify the trade partner before any payment confirmation.'
  );
  assert.equal(approved.response.status, 200);
  const detail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(detail.body.job.supplierInvoices[0].status, 'approved');
  assert.match(detail.body.job.supplierInvoices[0].data.approvalDecision.exceptionOverride, /Emergency work completion/);

  const blockedPayment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/supplier-invoices/${encodeURIComponent(invoice.body.supplierInvoice.id)}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      amount: 242,
      paidAt: new Date().toISOString(),
      reference: 'EMERGENCY-BANK-009'
    })
  });
  assert.equal(blockedPayment.response.status, 409);
  assert.equal(blockedPayment.body.error.code, 'trade_partner_required');

  const retainedPartner = await request(baseUrl, '/api/ledger/trade-partners', {
    method: 'POST',
    body: JSON.stringify({
      name: 'One-off Emergency Supplier',
      partnerType: 'supplier',
      registrationNumber: '99887766',
      vatNumber: 'NL987654321B01',
      verificationReference: 'Emergency supplier verification EMERGENCY-009',
      verifiedAt: new Date().toISOString()
    })
  });
  assert.equal(retainedPartner.response.status, 201);
  const retainedPayment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/supplier-invoices/${encodeURIComponent(invoice.body.supplierInvoice.id)}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      amount: 242,
      paidAt: new Date().toISOString(),
      reference: 'EMERGENCY-BANK-009'
    })
  });
  assert.equal(retainedPayment.response.status, 201);
  assert.equal(retainedPayment.body.supplierPayment.data.partnerComplianceSnapshot.compliant, true);
});

test('autonomous cycles create one internal payable review task without moving funds', async t => {
  const { baseUrl, jobId, supplierInvoice } = await createApprovedPayableFixture(t, {
    invoiceNumber: 'SUP-AUTO-1000',
    dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  });

  const preview = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, actionTypes: ['review_supplier_payable'], jobIds: [jobId] })
  });
  assert.equal(preview.response.status, 200);
  const payableAction = preview.body.preview.find(action => action.supplierInvoiceId === supplierInvoice.id);
  assert.ok(payableAction);
  assert.equal(payableAction.requiresApproval, true);

  const applied = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ actionTypes: ['review_supplier_payable'], jobIds: [jobId] })
  });
  assert.equal(applied.response.status, 200);
  assert.equal(applied.body.applied.filter(action => action.supplierInvoiceId === supplierInvoice.id).length, 1);
  assert.equal(applied.body.applied.find(action => action.supplierInvoiceId === supplierInvoice.id).externalPaymentInitiated, false);

  const second = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ actionTypes: ['review_supplier_payable'], jobIds: [jobId] })
  });
  assert.equal(second.response.status, 200);
  assert.equal(second.body.preview.some(action => action.supplierInvoiceId === supplierInvoice.id), false);

  const detail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  const tasks = detail.body.job.tasks.filter(task => task.data?.supplierInvoiceId === supplierInvoice.id);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].data.externalPaymentInitiated, false);
  assert.equal(detail.body.job.supplierInvoicePayments.length, 0);
});
