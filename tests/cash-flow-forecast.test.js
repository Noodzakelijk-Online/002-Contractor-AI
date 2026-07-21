const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-cash-flow-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function configureOrganization(ledger) {
  ledger.updateOrganizationProfile({
    legalName: 'Liquidity Contractor B.V.',
    registrationNumber: '12345678',
    vatNumber: 'NL123456789B01',
    email: 'finance@liquidity.example',
    address: 'Kasstraat 13',
    postalCode: '3511 AA',
    city: 'Utrecht',
    country: 'NL',
    iban: 'NL91 ABNA 0417 1643 00'
  }, { actor: 'owner' });
}

function createJob(ledger, title, contractValue = 5000) {
  return ledger.createIntake({
    title,
    client: {
      name: `${title} Client`,
      company: `${title} Client B.V.`,
      email: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@example.test`,
      address: 'Clientstraat 4',
      city: 'Rotterdam',
      country: 'NL'
    },
    status: 'in_progress',
    progressPercent: 50,
    contractValue,
    assignAutomatically: false
  }, { actor: 'cash-flow-test' });
}

function createIssuedReceivable(ledger, job) {
  const invoice = ledger.createInvoice(job.id, {
    amount: 1000,
    taxRate: 0,
    dueAt: '2026-07-27T23:59:59.000Z',
    notes: 'Cash-flow receivable source.'
  }, { actor: 'cash-flow-test' });
  ledger.resolveApproval(invoice.approvalId, { status: 'approved', resolvedBy: 'finance-approver' });
  const prepared = ledger.prepareInvoiceIssuePackage(job.id, invoice.id, {}, { actor: 'cash-flow-test' });
  ledger.resolveApproval(prepared.approval.id, { status: 'approved', resolvedBy: 'delivery-approver' });
  ledger.recordCommunicationDelivery(prepared.communication.id, {
    integration: 'cash-flow-provider',
    providerMessageId: 'cash-flow-receivable-1'
  }, { actor: 'verified-integration' });
  return invoice;
}

function createIssuedCommitment(ledger, job, partner) {
  const order = ledger.createPurchaseOrder(job.id, {
    status: 'ready_to_order',
    tradePartnerId: partner.id,
    supplier: partner.name,
    amount: 250,
    currency: 'EUR',
    items: [{ description: 'Unbilled retained materials', quantity: 1, unitCost: 250 }]
  }, { actor: 'cash-flow-test' });
  ledger.resolveApproval(order.approval.id, { status: 'approved', resolvedBy: 'purchase-approver' });
  const packageResult = ledger.preparePurchaseOrderIssuePackage(job.id, order.id, {}, { actor: 'cash-flow-test' });
  ledger.resolveApproval(packageResult.approval.id, { status: 'approved', resolvedBy: 'delivery-approver' });
  ledger.recordCommunicationDelivery(packageResult.communication.id, {
    integration: 'cash-flow-provider',
    providerMessageId: 'cash-flow-order-undated-1'
  }, { actor: 'verified-integration' });
  return order;
}

function createSupplierPayable(ledger, job) {
  const partner = ledger.upsertTradePartner({
    name: 'Liquidity Supplier B.V.',
    partnerType: 'supplier',
    email: 'supplier@liquidity.example',
    registrationNumber: '87654321',
    vatNumber: 'NL987654321B01',
    verificationReference: 'LIQUIDITY-SUPPLIER-CHECK',
    verifiedAt: '2026-07-01T09:00:00.000Z'
  }, { actor: 'cash-flow-test' });
  const order = ledger.createPurchaseOrder(job.id, {
    status: 'ready_to_order',
    tradePartnerId: partner.id,
    supplier: partner.name,
    amount: 600,
    currency: 'EUR',
    items: [{ description: 'Retained materials', quantity: 1, unitCost: 600 }]
  }, { actor: 'cash-flow-test' });
  ledger.resolveApproval(order.approval.id, { status: 'approved', resolvedBy: 'purchase-approver' });
  const packageResult = ledger.preparePurchaseOrderIssuePackage(job.id, order.id, {}, { actor: 'cash-flow-test' });
  ledger.resolveApproval(packageResult.approval.id, { status: 'approved', resolvedBy: 'delivery-approver' });
  ledger.recordCommunicationDelivery(packageResult.communication.id, {
    integration: 'cash-flow-provider',
    providerMessageId: 'cash-flow-order-1'
  }, { actor: 'verified-integration' });
  const invoice = ledger.createSupplierInvoice(job.id, {
    purchaseOrderId: order.id,
    tradePartnerId: partner.id,
    supplier: partner.name,
    invoiceNumber: 'SUP-CASH-001',
    invoiceDate: '2026-07-10',
    dueAt: '2026-07-24T23:59:59.000Z',
    netAmount: 600,
    taxAmount: 0,
    total: 600,
    currency: 'EUR',
    deliveryReference: 'GR-CASH-001'
  }, { actor: 'cash-flow-test' });
  ledger.resolveApproval(invoice.approval.id, {
    status: 'approved',
    resolvedBy: 'payables-approver',
    reason: 'Supplier, delivery evidence, invoice amount, and retained purchase commitment checked.'
  });
  return { invoice, partner };
}

test('13-week forecast derives ledger cash, expands assumptions, and freezes source-current snapshots', t => {
  const ledger = temporaryLedger(t);
  configureOrganization(ledger);
  const job = createJob(ledger, 'Liquidity project');
  createIssuedReceivable(ledger, job);
  const { partner } = createSupplierPayable(ledger, job);
  const undatedOrder = createIssuedCommitment(ledger, job, partner);

  const billingJob = createJob(ledger, 'Future billing', 1000);
  const milestone = ledger.createBillingMilestone(billingJob.id, {
    title: 'Approved progress claim',
    amount: 400,
    taxRate: 0,
    plannedIssueAt: '2026-07-22T09:00:00.000Z',
    dueAt: '2026-08-05T23:59:59.000Z'
  }, { actor: 'cash-flow-test' });
  ledger.resolveApproval(milestone.approvalId, { status: 'approved', resolvedBy: 'billing-approver' });

  const payroll = ledger.createCashFlowItem({
    entryKey: 'cash-flow-payroll-weekly-2026',
    direction: 'outflow',
    category: 'payroll',
    title: 'Weekly payroll funding',
    amount: 500,
    expectedAt: '2026-07-20',
    recurrence: 'weekly',
    recurrenceEndAt: '2026-10-12',
    confidencePercent: 100,
    sourceReference: 'Payroll plan 2026-Q3'
  }, { actor: 'finance-office' });
  assert.equal(payroll.replayed, false);
  assert.equal(payroll.item.status, 'active');
  const replay = ledger.createCashFlowItem({
    entryKey: 'cash-flow-payroll-weekly-2026',
    direction: 'outflow',
    category: 'payroll',
    title: 'Weekly payroll funding',
    amount: 500,
    expectedAt: '2026-07-20',
    recurrence: 'weekly',
    recurrenceEndAt: '2026-10-12',
    confidencePercent: 100,
    sourceReference: 'Payroll plan 2026-Q3'
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.item.id, payroll.item.id);
  assert.throws(
    () => ledger.createCashFlowItem({
      entryKey: 'cash-flow-payroll-weekly-2026',
      direction: 'outflow',
      category: 'payroll',
      title: 'Changed payroll',
      amount: 700,
      expectedAt: '2026-07-20'
    }),
    error => error.code === 'cash_flow_entry_key_conflict' && error.statusCode === 409
  );

  let forecast = ledger.calculateCashFlowForecast({ asOfDate: '2026-07-20', openingBalance: 1500 });
  assert.equal(forecast.ready, true);
  assert.equal(forecast.weeks.length, 13);
  assert.equal(forecast.weekStart, '2026-07-20');
  assert.equal(forecast.horizonEnd, '2026-10-19');
  assert.equal(forecast.sources.filter(source => source.sourceType === 'manual_assumption').length, 13);
  assert.equal(forecast.sources.filter(source => source.sourceType === 'client_receivable').length, 1);
  assert.equal(forecast.sources.filter(source => source.sourceType === 'supplier_payable').length, 1);
  assert.equal(forecast.sources.filter(source => source.sourceType === 'planned_billing').length, 1);
  assert.equal(forecast.undatedCommitments.length, 1);
  assert.equal(forecast.undatedCommitments[0].sourceId, undatedOrder.id);
  assert.equal(forecast.summary.undatedCommitmentCount, 1);
  assert.equal(forecast.summary.undatedCommitmentValue, 250);
  assert.ok(forecast.warnings.some(warning => warning.code === 'cash_flow_undated_commitments'));
  assert.equal(forecast.summary.totalInflows, 1400);
  assert.equal(forecast.summary.totalOutflows, 7100);
  assert.equal(forecast.summary.closingBalance, -4200);
  assert.equal(forecast.summary.negativeWeeks, 9);
  assert.equal(forecast.summary.atRisk, true);
  assert.equal(forecast.weeks[0].outflow, 1100);
  assert.equal(forecast.weeks[0].closingBalance, 400);
  assert.equal(forecast.weeks[1].inflow, 1000);
  assert.equal(forecast.weeks[2].inflow, 400);
  assert.equal(forecast.weeks[2].weightedInflow, 280);

  const requested = ledger.requestCashFlowForecastSnapshot({ asOfDate: '2026-07-20', openingBalance: 1500 }, { actor: 'finance-office' });
  assert.match(requested.snapshot.forecastNumber, /^CF-\d{4}-000001$/);
  assert.equal(requested.snapshot.status, 'pending_approval');
  assert.equal(requested.snapshot.integrityValid, true);
  assert.equal(requested.approval.targetType, 'cash_flow_forecast');
  assert.match(requested.approval.decision.primaryEffect, /13-week cash-flow/i);
  assert.ok(requested.approval.decision.safeguards.some(item => /refused if/i.test(item)));
  const snapshotReplay = ledger.requestCashFlowForecastSnapshot({ asOfDate: '2026-07-20', openingBalance: 1500 });
  assert.equal(snapshotReplay.replayed, true);
  assert.equal(snapshotReplay.snapshot.id, requested.snapshot.id);
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved',
    resolvedBy: 'cash-flow-approver',
    reason: 'Opening balance and weekly source evidence checked.'
  });
  forecast = ledger.calculateCashFlowForecast({ asOfDate: '2026-07-20', openingBalance: 1500 });
  assert.equal(forecast.snapshotCurrent, true);
  assert.equal(forecast.activeSnapshot.forecastNumber, requested.snapshot.forecastNumber);

  const tax = ledger.createCashFlowItem({
    entryKey: 'cash-flow-tax-2026-q3',
    direction: 'outflow',
    category: 'tax',
    title: 'VAT reserve payment',
    amount: 250,
    expectedAt: '2026-08-31',
    confidencePercent: 100
  });
  forecast = ledger.calculateCashFlowForecast({ asOfDate: '2026-07-20', openingBalance: 1500 });
  assert.equal(forecast.snapshotCurrent, false);
  const revised = ledger.requestCashFlowForecastSnapshot({ asOfDate: '2026-07-20', openingBalance: 1500 });
  assert.match(revised.snapshot.forecastNumber, /-000002$/);
  assert.equal(revised.snapshot.versionNumber, 2);
  assert.equal(ledger.db.prepare("SELECT last_value FROM cash_flow_forecast_version_sequence WHERE sequence_key = 'global'").get().last_value, 2);
  ledger.archiveCashFlowItem(tax.item.id, { reason: 'Tax timing replaced by the verified filing calendar.' });
  assert.throws(
    () => ledger.resolveApproval(revised.approval.id, {
      status: 'approved',
      resolvedBy: 'cash-flow-approver',
      reason: 'This stale snapshot must fail.'
    }),
    error => error.code === 'cash_flow_forecast_stale' && error.statusCode === 409
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).some(item => item.id === revised.approval.id), true);
  assert.equal(ledger.diagnose().valid, true);
  assert.equal(ledger.migrationStatus().currentVersion, '058_formal_variation_control');
});

test('cash-flow forecast blocks mixed currencies and detects retained snapshot tampering', t => {
  const ledger = temporaryLedger(t);
  ledger.createCashFlowItem({
    entryKey: 'cash-flow-eur-assumption',
    direction: 'inflow',
    category: 'other',
    title: 'EUR receipt',
    amount: 100,
    currency: 'EUR',
    expectedAt: '2026-07-22'
  });
  const usd = ledger.createCashFlowItem({
    entryKey: 'cash-flow-usd-assumption',
    direction: 'outflow',
    category: 'other',
    title: 'USD supplier deposit',
    amount: 50,
    currency: 'USD',
    expectedAt: '2026-07-23'
  });
  let forecast = ledger.calculateCashFlowForecast({ asOfDate: '2026-07-20', openingBalance: 500 });
  assert.equal(forecast.ready, false);
  assert.ok(forecast.blockers.some(blocker => blocker.code === 'cash_flow_currency_mismatch'));
  assert.throws(
    () => ledger.requestCashFlowForecastSnapshot({ asOfDate: '2026-07-20', openingBalance: 500 }),
    error => error.code === 'cash_flow_forecast_not_ready' && error.statusCode === 409
  );
  ledger.archiveCashFlowItem(usd.item.id, { reason: 'Converted to EUR outside Contractor.AI before forecasting.' });
  const requested = ledger.requestCashFlowForecastSnapshot({ asOfDate: '2026-07-20', openingBalance: 500 });
  const row = ledger.db.prepare('SELECT snapshot_json FROM cash_flow_forecast_snapshots WHERE id = ?').get(requested.snapshot.id);
  const tampered = JSON.parse(row.snapshot_json);
  tampered.summary.closingBalance = 999999;
  ledger.db.prepare('UPDATE cash_flow_forecast_snapshots SET snapshot_json = ? WHERE id = ?')
    .run(JSON.stringify(tampered), requested.snapshot.id);
  assert.throws(
    () => ledger.getCashFlowForecastSnapshot(requested.snapshot.id),
    error => error.code === 'cash_flow_forecast_integrity_failed' && error.statusCode === 409
  );
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => /Cash-flow forecast .*failed retained snapshot verification/.test(issue.message)));
});

test('monthly assumptions retain their original month-end cadence', t => {
  const ledger = temporaryLedger(t);
  ledger.createCashFlowItem({
    entryKey: 'cash-flow-month-end-2026',
    direction: 'outflow',
    category: 'overhead',
    title: 'Month-end facility charge',
    amount: 100,
    expectedAt: '2026-01-31',
    recurrence: 'monthly',
    recurrenceEndAt: '2026-04-30',
    confidencePercent: 100
  });

  const forecast = ledger.calculateCashFlowForecast({ asOfDate: '2026-01-26', openingBalance: 1000 });
  assert.deepEqual(
    forecast.sources.filter(source => source.sourceType === 'manual_assumption').map(source => source.expectedAt),
    ['2026-01-31', '2026-02-28', '2026-03-31']
  );
});
