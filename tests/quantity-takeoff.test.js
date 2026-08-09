const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
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
      { description: 'Door sets', measurementType: 'count', count: 3, unitCost: 250, unitPrice: 400, costCode: 'JOIN-100', wbsCode: '02.10', workPackage: 'Openings' },
      { description: 'Skirting', measurementType: 'linear', count: 2, length: 8.5, wastePercent: 5, unitCost: 4, unitPrice: 9, costCode: 'FIN-110', wbsCode: '03.20', workPackage: 'Interior finishes' },
      { description: 'Floor finish', measurementType: 'area', count: 2, length: 4, width: 3, wastePercent: 10, unitCost: 18, unitPrice: 32, costCode: 'FIN-120', wbsCode: '03.20', workPackage: 'Interior finishes' },
      { description: 'Concrete pads', measurementType: 'volume', count: 4, length: 0.5, width: 0.5, height: 0.4, unitCost: 120, unitPrice: 210, costCode: 'CON-100', wbsCode: '01.20', workPackage: 'Foundations' },
      { description: 'Site setup allowance', measurementType: 'manual', quantity: 1.5, unit: 'day', unitCost: 300, unitPrice: 500, costCode: 'PRE-100', wbsCode: '00.10', workPackage: 'Preliminaries' }
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
  assert.equal(takeoff.workBreakdown.format, 'contractor-ai-wbs/v1');
  assert.equal(takeoff.workBreakdown.valid, true);
  assert.equal(takeoff.workBreakdown.packageCount, 4);
  assert.equal(takeoff.workBreakdown.rootCount, 4);
  assert.equal(takeoff.workBreakdown.maxDepth, 2);
  assert.equal(takeoff.workBreakdown.totalCost, takeoff.totalCost);
  assert.equal(takeoff.workBreakdown.totalPrice, takeoff.subtotal);
  assert.match(takeoff.workBreakdown.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    takeoff.workBreakdown.nodes.find(node => node.code === '03.20'),
    {
      code: '03.20',
      name: 'Interior finishes',
      parentCode: '03',
      depth: 2,
      itemIds: [takeoff.items[1].id, takeoff.items[2].id],
      itemCount: 2,
      totalCost: 546.6,
      totalPrice: 1005.45,
      marginAmount: 458.85,
      marginPercent: 45.6363
    }
  );
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
  assert.throws(
    () => ledger.addTakeoffItem(job.id, takeoff.id, { description: 'Invalid WBS', measurementType: 'count', count: 1, unitPrice: 1, wbsCode: '01..20' }),
    error => error.code === 'takeoff_wbs_code_invalid' && error.statusCode === 400
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
    wbsCode: '03.10',
    workPackage: 'Wall finishes',
    sourceReference: 'Drawing A-201'
  }, { actor: 'estimator' });
  assert.equal(added.item.quantity, 25.2);
  assert.equal(added.item.wbsCode, '03.10');
  assert.equal(added.takeoff.workBreakdown.nodes[0].name, 'Wall finishes');
  assert.equal(added.takeoff.subtotal, 352.8);

  assert.throws(
    () => ledger.addTakeoffItem(job.id, takeoff.id, {
      description: 'Conflicting package label', measurementType: 'count', count: 1, unitPrice: 1,
      wbsCode: '03.10', workPackage: 'Different package'
    }),
    error => error.code === 'takeoff_wbs_package_conflict' && error.statusCode === 409
  );

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
      { description: 'Roof insulation', measurementType: 'area', length: 10, width: 8, wastePercent: 7.5, unitCost: 24, unitPrice: 41, costCode: 'ENV-210', wbsCode: '04.30', workPackage: 'Roof insulation' }
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
  assert.equal(converted.quote.data.source.workBreakdownFormat, 'contractor-ai-wbs/v1');
  assert.equal(converted.quote.data.source.workBreakdownHash, converted.takeoff.workBreakdown.hash);
  assert.equal(converted.quote.lineItems[0].wbsCode, '04.30');
  assert.equal(converted.quote.lineItems[0].workPackage, 'Roof insulation');
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

test('persisted WBS conflicts fail diagnostics without crashing ledger inspection', t => {
  const ledger = temporaryLedger(t);
  const job = createJob(ledger);
  const takeoff = ledger.createTakeoff(job.id, {
    title: 'WBS conflict fixture',
    items: [
      { description: 'Wall framing', measurementType: 'area', length: 4, width: 3, unitPrice: 20, wbsCode: '02.10', workPackage: 'Framing' },
      { description: 'Roof framing', measurementType: 'area', length: 4, width: 2, unitPrice: 25, wbsCode: '02.20', workPackage: 'Roof structure' }
    ]
  });
  ledger.db.prepare('UPDATE takeoff_items SET wbs_code = ?, work_package = ? WHERE id = ?')
    .run('02.10', 'Conflicting framing name', takeoff.items[1].id);

  const retained = ledger.getTakeoff(job.id, takeoff.id);
  assert.equal(retained.workBreakdown.valid, false);
  assert.equal(retained.workBreakdown.conflicts.length, 1);
  assert.throws(
    () => ledger.convertTakeoffToQuote(job.id, takeoff.id),
    error => error.code === 'takeoff_wbs_invalid' && error.statusCode === 409
  );
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => /conflicting WBS work-package classifications/i.test(issue.message)));
});

test('migration 053 preserves legacy converted takeoff hashes and upgrades editable drafts', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-takeoff-migration-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  let ledger = new ContractorOperatingLedger({ dbFile });
  t.after(() => {
    try { ledger.close(); } catch {
      // A failed migration may already have closed the database handle.
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const convertedJob = createJob(ledger);
  const legacyTakeoff = ledger.createTakeoff(convertedJob.id, {
    title: 'Legacy converted basis',
    items: [{ description: 'Legacy measured wall', measurementType: 'area', length: 4, width: 3, unitPrice: 20 }]
  });
  const legacyData = { ...legacyTakeoff.data };
  delete legacyData.workBreakdownFormat;
  ledger.db.prepare('UPDATE takeoff_sheets SET data_json = ? WHERE id = ?').run(JSON.stringify(legacyData), legacyTakeoff.id);
  const converted = ledger.convertTakeoffToQuote(convertedJob.id, legacyTakeoff.id);
  assert.equal(converted.quote.data.source.workBreakdownHash, undefined);

  const draftJob = createJob(ledger);
  const editableDraft = ledger.createTakeoff(draftJob.id, {
    title: 'Legacy editable basis',
    items: [{ description: 'Legacy measured floor', measurementType: 'area', length: 3, width: 3, unitPrice: 18 }]
  });
  const draftData = { ...editableDraft.data };
  delete draftData.workBreakdownFormat;
  ledger.db.prepare('UPDATE takeoff_sheets SET data_json = ? WHERE id = ?').run(JSON.stringify(draftData), editableDraft.id);
  ledger.close();

  const legacyDatabase = new DatabaseSync(dbFile);
  legacyDatabase.exec(`
    DROP INDEX idx_takeoff_items_wbs;
    ALTER TABLE takeoff_items DROP COLUMN work_package;
    ALTER TABLE takeoff_items DROP COLUMN wbs_code;
    DELETE FROM ledger_schema_migrations WHERE version = '053_work_breakdown_takeoffs';
  `);
  legacyDatabase.close();

  ledger = new ContractorOperatingLedger({ dbFile });
  assert.equal(ledger.migrationStatus().currentVersion, '069_governed_framework_workspace');
  const retainedConverted = ledger.getTakeoff(convertedJob.id, legacyTakeoff.id);
  assert.equal(retainedConverted.integrityValid, true);
  assert.equal(retainedConverted.data.workBreakdownFormat, undefined);
  assert.equal(retainedConverted.workBreakdown.nodes[0].name, 'General scope');
  assert.equal(ledger.convertTakeoffToQuote(convertedJob.id, legacyTakeoff.id).replayed, true);
  const retainedDraft = ledger.getTakeoff(draftJob.id, editableDraft.id);
  assert.equal(retainedDraft.data.workBreakdownFormat, 'contractor-ai-wbs/v1');
  assert.equal(retainedDraft.workBreakdown.valid, true);
  assert.equal(ledger.diagnose().valid, true);
});
