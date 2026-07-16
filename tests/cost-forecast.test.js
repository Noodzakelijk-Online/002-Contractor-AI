const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-cost-forecast-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function setupForecastJob(ledger, suffix = '1') {
  ledger.updateOrganizationProfile({
    legalName: 'Forecast Contractor B.V.',
    registrationNumber: '12345678',
    vatNumber: 'NL123456789B01',
    email: 'forecast@contractor.example',
    address: 'Ledgerstraat 10',
    postalCode: '3511 AA',
    city: 'Utrecht',
    country: 'NL',
    iban: 'NL91 ABNA 0417 1643 00',
    defaultPaymentTermsDays: 30,
    defaultQuoteValidityDays: 30
  }, { actor: 'owner' });
  const supplier = ledger.upsertTradePartner({
    name: `Forecast Supplier ${suffix} B.V.`,
    partnerType: 'supplier',
    email: `forecast-${suffix}@supplier.example`,
    registrationNumber: `8877665${suffix}`,
    vatNumber: `NL98765432${suffix}B01`,
    verificationReference: `FORECAST-SUPPLIER-${suffix}`,
    verifiedAt: new Date(Date.now() - 86_400_000).toISOString()
  }, { actor: 'forecast-test' });
  const job = ledger.createIntake({
    title: `Cost forecast ${suffix}`,
    client: { name: `Forecast Client ${suffix}` },
    status: 'in_progress',
    progressPercent: 50,
    contractValue: 5000,
    assignAutomatically: false
  }, { actor: 'forecast-test' });
  const materialBudget = ledger.createBudgetLine(job.id, {
    status: 'baseline',
    costCode: 'MAT-100',
    description: 'Materials',
    budgetAmount: 2000,
    forecastAmount: 1000,
    actualAmount: 9999,
    committedAmount: 8888
  }, { actor: 'forecast-test' });
  ledger.resolveApproval(materialBudget.approval.id, {
    status: 'approved', resolvedBy: 'Budget approver', reason: 'Material budget checked.'
  });
  const laborBudget = ledger.createBudgetLine(job.id, {
    status: 'baseline',
    costCode: 'LAB-100',
    description: 'Direct labor',
    budgetAmount: 1000,
    forecastAmount: 600
  }, { actor: 'forecast-test' });
  ledger.resolveApproval(laborBudget.approval.id, {
    status: 'approved', resolvedBy: 'Budget approver', reason: 'Labor budget checked.'
  });
  ledger.addTimeLog(job.id, {
    workDate: '2026-07-16',
    hours: 10,
    rate: 50,
    costCode: 'LAB-100',
    status: 'submitted',
    notes: 'Verified direct labor.'
  }, { actor: 'forecast-test' });
  ledger.addExpense(job.id, {
    category: 'materials',
    amount: 100,
    currency: 'EUR',
    costCode: 'MAT-100',
    status: 'submitted',
    receiptRef: 'MAT-RECEIPT-100'
  }, { actor: 'forecast-test' });
  const purchaseOrder = ledger.createPurchaseOrder(job.id, {
    status: 'ready_to_order',
    tradePartnerId: supplier.id,
    supplier: supplier.name,
    budgetLineId: materialBudget.id,
    amount: 1200,
    currency: 'EUR',
    items: [{ description: 'Forecast materials', quantity: 1, unitCost: 1200 }]
  }, { actor: 'forecast-test' });
  ledger.resolveApproval(purchaseOrder.approval.id, {
    status: 'approved', resolvedBy: 'Purchase approver', reason: 'Supplier and amount checked.'
  });
  const prepared = ledger.preparePurchaseOrderIssuePackage(job.id, purchaseOrder.id, {}, { actor: 'forecast-test' });
  ledger.resolveApproval(prepared.approval.id, {
    status: 'approved', resolvedBy: 'Delivery approver', reason: 'Recipient and package checked.'
  });
  ledger.recordCommunicationDelivery(prepared.communication.id, {
    integration: 'forecast-provider',
    providerMessageId: `forecast-order-${suffix}`
  }, { actor: 'verified-integration' });
  const supplierInvoice = ledger.createSupplierInvoice(job.id, {
    purchaseOrderId: purchaseOrder.id,
    tradePartnerId: supplier.id,
    supplier: supplier.name,
    invoiceNumber: `FORECAST-INV-${suffix}`,
    invoiceDate: '2026-07-15',
    dueAt: '2026-08-15T23:59:59.000Z',
    netAmount: 400,
    taxAmount: 84,
    total: 484,
    currency: 'EUR',
    deliveryReference: `FORECAST-GR-${suffix}`
  }, { actor: 'forecast-test' });
  ledger.resolveApproval(supplierInvoice.approval.id, {
    status: 'approved', resolvedBy: 'Payables approver', reason: 'Three-way match checked.'
  });
  return { job, supplier, materialBudget, laborBudget, purchaseOrder, supplierInvoice };
}

test('cost forecast derives evidence without double counting and freezes source-current snapshots', t => {
  const ledger = temporaryLedger(t);
  const { job } = setupForecastJob(ledger);

  let forecast = ledger.calculateCostForecast(job.id);
  assert.equal(forecast.ready, true);
  assert.equal(forecast.currency, 'EUR');
  assert.equal(forecast.summary.budget, 3000);
  assert.equal(forecast.summary.actual, 1000);
  assert.equal(forecast.summary.externalCommitment, 800);
  assert.equal(forecast.summary.authorizedNotIssued, 0);
  assert.equal(forecast.summary.forecast, 1900);
  assert.equal(forecast.summary.budgetVariance, 1100);
  assert.equal(forecast.summary.projectedMargin, 3100);
  assert.equal(forecast.summary.earnedValue, 1500);
  assert.equal(forecast.summary.costPerformanceIndex, 1.5);
  const material = forecast.lines.find(line => line.costCode === 'MAT-100');
  assert.equal(material.actual, 500);
  assert.equal(material.supplierActual, 400);
  assert.equal(material.expenseActual, 100);
  assert.equal(material.externalCommitment, 800);
  assert.equal(material.forecast, 1300);
  assert.equal(material.reportedActual, 9999);
  assert.ok(forecast.warnings.some(warning => warning.code === 'reported_cost_totals_differ'));

  const requested = ledger.requestCostForecastSnapshot(job.id, {}, { actor: 'office' });
  assert.match(requested.snapshot.forecastNumber, /^FC-\d{4}-000001$/);
  assert.equal(requested.snapshot.status, 'pending_approval');
  assert.equal(requested.snapshot.integrityValid, true);
  assert.equal(requested.approval.targetType, 'cost_forecast');
  assert.match(requested.approval.decision.primaryEffect, /cost forecast/i);
  assert.ok(requested.approval.decision.safeguards.some(item => /source changed/i.test(item)));
  const replay = ledger.requestCostForecastSnapshot(job.id, {}, { actor: 'second-office' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.snapshot.id, requested.snapshot.id);
  assert.equal(ledger.db.prepare('SELECT last_value FROM cost_forecast_number_sequences').get().last_value, 1);
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved', resolvedBy: 'Forecast approver', reason: 'Cost-code sources and variance checked.'
  });
  forecast = ledger.calculateCostForecast(job.id);
  assert.equal(forecast.snapshotCurrent, true);
  assert.equal(forecast.activeSnapshot.forecastNumber, requested.snapshot.forecastNumber);

  ledger.addExpense(job.id, {
    category: 'materials', amount: 50, currency: 'EUR', costCode: 'MAT-100', status: 'submitted'
  }, { actor: 'forecast-test' });
  forecast = ledger.calculateCostForecast(job.id);
  assert.equal(forecast.snapshotCurrent, false);
  assert.equal(forecast.summary.actual, 1050);
  const revised = ledger.requestCostForecastSnapshot(job.id, {}, { actor: 'office' });
  assert.match(revised.snapshot.forecastNumber, /-000002$/);
  ledger.addExpense(job.id, {
    category: 'materials', amount: 25, currency: 'EUR', costCode: 'MAT-100', status: 'submitted'
  }, { actor: 'forecast-test' });
  assert.throws(
    () => ledger.resolveApproval(revised.approval.id, {
      status: 'approved', resolvedBy: 'Forecast approver', reason: 'This stale snapshot must fail.'
    }),
    error => error.code === 'cost_forecast_snapshot_stale' && error.statusCode === 409
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).find(item => item.id === revised.approval.id)?.status, 'pending');
  assert.equal(ledger.diagnose().valid, true);
});

test('mixed currencies and missing approved budgets block a forecast snapshot', t => {
  const ledger = temporaryLedger(t);
  const job = ledger.createIntake({
    title: 'Blocked forecast',
    client: { name: 'Blocked Forecast Client' },
    contractValue: 1000,
    assignAutomatically: false
  }, { actor: 'forecast-test' });
  ledger.addExpense(job.id, {
    category: 'materials', amount: 100, currency: 'USD', costCode: 'MAT-USD', status: 'submitted'
  });
  let forecast = ledger.calculateCostForecast(job.id);
  assert.equal(forecast.ready, false);
  assert.ok(forecast.blockers.some(blocker => blocker.code === 'approved_budget_required'));
  const budget = ledger.createBudgetLine(job.id, {
    status: 'baseline', costCode: 'MAT-EUR', description: 'Euro baseline', budgetAmount: 1000, currency: 'EUR'
  });
  ledger.resolveApproval(budget.approval.id, { status: 'approved', resolvedBy: 'Budget approver' });
  forecast = ledger.calculateCostForecast(job.id);
  assert.equal(forecast.ready, false);
  assert.ok(forecast.blockers.some(blocker => blocker.code === 'cost_forecast_currency_mismatch'));
  assert.throws(
    () => ledger.requestCostForecastSnapshot(job.id),
    error => error.code === 'cost_forecast_not_ready' && error.statusCode === 409
  );
});

test('cost forecast snapshot tampering is detected by direct reads and diagnostics', t => {
  const ledger = temporaryLedger(t);
  const { job } = setupForecastJob(ledger, '2');
  const requested = ledger.requestCostForecastSnapshot(job.id);
  const row = ledger.db.prepare('SELECT snapshot_json FROM cost_forecast_snapshots WHERE id = ?').get(requested.snapshot.id);
  const snapshot = JSON.parse(row.snapshot_json);
  snapshot.summary.forecast = 1;
  ledger.db.prepare('UPDATE cost_forecast_snapshots SET snapshot_json = ? WHERE id = ?')
    .run(JSON.stringify(snapshot), requested.snapshot.id);
  assert.throws(
    () => ledger.getCostForecastSnapshot(requested.snapshot.id),
    error => error.code === 'cost_forecast_snapshot_integrity_failed' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.listAllCostForecastSnapshots(),
    error => error.code === 'cost_forecast_snapshot_integrity_failed' && error.statusCode === 409
  );
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => /Cost forecast .*failed retained snapshot verification/.test(issue.message)));
});
