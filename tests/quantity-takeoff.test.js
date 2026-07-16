const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-takeoff-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function createJob(ledger) {
  return ledger.createIntake({
    clientName: 'Measured Scope Client',
    title: 'Measured renovation scope',
    service: 'renovation',
    assignAutomatically: false
  }, { actor: 'takeoff-test' });
}

test('quantity takeoffs derive count, linear, area, volume, waste, and commercial totals on the server', t => {
  const ledger = temporaryLedger(t);
  const job = createJob(ledger);
  const takeoff = ledger.createTakeoff(job.id, {
    title: 'Measured ground floor',
    taxRate: 21,
    items: [
      { description: 'Door sets', measurementType: 'count', count: 3, unitCost: 250, unitPrice: 400, costCode: 'JOIN-100' },
      { description: 'Skirting', measurementType: 'linear', count: 2, length: 8.5, wastePercent: 5, unitCost: 4, unitPrice: 9, costCode: 'FIN-110' },
      { description: 'Floor finish', measurementType: 'area', count: 2, length: 4, width: 3, wastePercent: 10, unitCost: 18, unitPrice: 32, costCode: 'FIN-120' },
      { description: 'Concrete pads', measurementType: 'volume', count: 4, length: 0.5, width: 0.5, height: 0.4, unitCost: 120, unitPrice: 210, costCode: 'CON-100' },
      { description: 'Site setup allowance', measurementType: 'manual', quantity: 1.5, unit: 'day', unitCost: 300, unitPrice: 500, costCode: 'PRE-100' }
    ]
  }, { actor: 'estimator' });

  assert.equal(takeoff.status, 'draft');
  assert.equal(takeoff.itemCount, 5);
  assert.deepEqual(takeoff.items.map(item => item.quantity), [3, 17.85, 26.4, 0.4, 1.5]);
  assert.deepEqual(takeoff.items.map(item => item.unit), ['ea', 'm', 'm2', 'm3', 'day']);
  assert.equal(takeoff.totalCost, 1794.6);
  assert.equal(takeoff.subtotal, 3039.45);
  assert.equal(takeoff.taxAmount, 638.28);
  assert.equal(takeoff.total, 3677.73);
  assert.equal(takeoff.marginAmount, 1244.85);
  assert.equal(takeoff.marginPercent, 40.9564);
  assert.equal(takeoff.data.externalCommitments, 0);
  assert.equal(ledger.getJobDetail(job.id).takeoffs[0].id, takeoff.id);
  const preconstruction = ledger.getJobDetail(job.id).capabilities.find(capability => capability.key === 'preconstruction');
  assert.equal(preconstruction.requirements.find(requirement => requirement.key === 'takeoff').covered, true);
  assert.equal(ledger.diagnose().valid, true);
});

test('draft takeoff measurements can be corrected and removed while invalid formulas fail closed', t => {
  const ledger = temporaryLedger(t);
  const job = createJob(ledger);
  const takeoff = ledger.createTakeoff(job.id, { title: 'Correction register', taxRate: 9 });

  assert.throws(
    () => ledger.addTakeoffItem(job.id, takeoff.id, { description: 'Invalid area', measurementType: 'area', length: 4, width: 0, unitPrice: 10 }),
    error => error.code === 'takeoff_area_dimensions_required' && error.statusCode === 400
  );
  assert.throws(
    () => ledger.addTakeoffItem(job.id, takeoff.id, { description: 'Negative rate', measurementType: 'count', count: 1, unitPrice: -1 }),
    error => error.code === 'takeoff_measurement_invalid' && error.statusCode === 400
  );

  const added = ledger.addTakeoffItem(job.id, takeoff.id, {
    description: 'Wall paint',
    measurementType: 'area',
    count: 2,
    length: 5,
    width: 2.4,
    wastePercent: 5,
    unitCost: 6,
    unitPrice: 14,
    sourceReference: 'Drawing A-201'
  }, { actor: 'estimator' });
  assert.equal(added.item.quantity, 25.2);
  assert.equal(added.takeoff.subtotal, 352.8);

  const updated = ledger.updateTakeoffItem(job.id, takeoff.id, added.item.id, {
    width: 3,
    unitPrice: 15
  }, { actor: 'estimator' });
  assert.equal(updated.item.quantity, 31.5);
  assert.equal(updated.item.totalPrice, 472.5);
  assert.equal(updated.takeoff.total, 515.03);

  const removed = ledger.removeTakeoffItem(job.id, takeoff.id, added.item.id, { actor: 'estimator' });
  assert.equal(removed.takeoff.itemCount, 0);
  assert.equal(removed.takeoff.total, 0);
  assert.equal(ledger.diagnose().valid, true);
});

test('inactive jobs expose retained takeoffs as read-only history', t => {
  const ledger = temporaryLedger(t);
  const job = createJob(ledger);
  const takeoff = ledger.createTakeoff(job.id, {
    title: 'Cancelled job measurement',
    items: [{ description: 'Retained measured wall', measurementType: 'area', length: 5, width: 3, unitPrice: 30 }]
  });
  const item = takeoff.items[0];
  ledger.updateJob(job.id, { status: 'cancelled' });

  assert.equal(ledger.listTakeoffs(job.id)[0].id, takeoff.id);
  assert.equal(ledger.getJobDetail(job.id).takeoffs[0].items[0].id, item.id);
  const blockedMutations = [
    () => ledger.updateTakeoff(job.id, takeoff.id, { title: 'Changed after cancellation' }),
    () => ledger.addTakeoffItem(job.id, takeoff.id, { description: 'Late measurement', measurementType: 'count', count: 1, unitPrice: 1 }),
    () => ledger.updateTakeoffItem(job.id, takeoff.id, item.id, { width: 4 }),
    () => ledger.removeTakeoffItem(job.id, takeoff.id, item.id),
    () => ledger.convertTakeoffToQuote(job.id, takeoff.id)
  ];
  for (const mutation of blockedMutations) {
    assert.throws(mutation, error => error.code === 'job_inactive_read_only' && error.statusCode === 409);
  }
});

test('takeoff conversion is atomic, replay-safe, immutable, and traceable to an approval-gated quote', t => {
  const ledger = temporaryLedger(t);
  const job = createJob(ledger);
  const takeoff = ledger.createTakeoff(job.id, {
    title: 'Tender measurement',
    notes: 'Rates exclude asbestos remediation.',
    items: [
      { description: 'Roof insulation', measurementType: 'area', length: 10, width: 8, wastePercent: 7.5, unitCost: 24, unitPrice: 41, costCode: 'ENV-210' }
    ]
  }, { actor: 'estimator' });

  assert.throws(
    () => ledger.convertTakeoffToQuote(job.id, takeoff.id, { validUntil: 'not-a-date' }),
    error => error.code === 'quote_valid_until_invalid' && error.statusCode === 400
  );
  assert.equal(ledger.getTakeoff(job.id, takeoff.id).status, 'draft');
  assert.equal(ledger.getJobDetail(job.id).quotes.length, 0);

  const converted = ledger.convertTakeoffToQuote(job.id, takeoff.id, {
    validUntil: '2026-12-31',
    notes: 'Prepared after estimator review.'
  }, { actor: 'commercial-estimator' });
  assert.equal(converted.replayed, false);
  assert.equal(converted.takeoff.status, 'converted');
  assert.equal(converted.takeoff.integrityValid, true);
  assert.equal(converted.quote.status, 'draft');
  assert.equal(converted.quote.subtotal, converted.takeoff.subtotal);
  assert.equal(converted.quote.data.source.type, 'quantity_takeoff');
  assert.equal(converted.quote.data.source.id, takeoff.id);
  assert.equal(converted.quote.data.source.snapshotHash, converted.takeoff.snapshotHash);
  assert.ok(converted.quote.approvalId);
  assert.equal(converted.externalCommitments, 0);
  assert.equal(ledger.getJobDetail(job.id).contractValue, 0);

  const replay = ledger.convertTakeoffToQuote(job.id, takeoff.id, {}, { actor: 'another-estimator' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.quote.id, converted.quote.id);
  assert.equal(ledger.getJobDetail(job.id).quotes.length, 1);
  assert.throws(
    () => ledger.addTakeoffItem(job.id, takeoff.id, { description: 'Late line', measurementType: 'count', count: 1, unitPrice: 20 }),
    error => error.code === 'takeoff_read_only' && error.statusCode === 409
  );
  assert.equal(ledger.diagnose().valid, true);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('converted takeoff tampering blocks replay and makes diagnostics fail closed', t => {
  const ledger = temporaryLedger(t);
  const job = createJob(ledger);
  const takeoff = ledger.createTakeoff(job.id, {
    title: 'Integrity fixture',
    items: [{ description: 'Measured wall', measurementType: 'area', length: 5, width: 3, unitPrice: 30 }]
  });
  ledger.convertTakeoffToQuote(job.id, takeoff.id);
  ledger.db.prepare('UPDATE takeoff_items SET quantity = 1, total_price = 1 WHERE takeoff_id = ?').run(takeoff.id);

  assert.equal(ledger.getTakeoff(job.id, takeoff.id).integrityValid, false);
  assert.throws(
    () => ledger.convertTakeoffToQuote(job.id, takeoff.id),
    error => error.code === 'takeoff_integrity_failed' && error.statusCode === 409
  );
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => /takeoff.*snapshot verification/i.test(issue.message)));
  assert.ok(diagnostics.issues.some(issue => /takeoff item.*server-calculation verification/i.test(issue.message)));
});

test('converted takeoff replay rejects a broken estimate trace', t => {
  const ledger = temporaryLedger(t);
  const job = createJob(ledger);
  const takeoff = ledger.createTakeoff(job.id, {
    title: 'Trace fixture',
    items: [{ description: 'Measured ceiling', measurementType: 'area', length: 6, width: 4, unitPrice: 25 }]
  });
  const converted = ledger.convertTakeoffToQuote(job.id, takeoff.id);
  ledger.db.prepare('UPDATE quotes SET data_json = ? WHERE id = ?').run('{}', converted.quote.id);

  assert.throws(
    () => ledger.convertTakeoffToQuote(job.id, takeoff.id),
    error => error.code === 'takeoff_quote_trace_invalid' && error.statusCode === 409
  );
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => /lacks its same-job traceable estimate/i.test(issue.message)));
});
