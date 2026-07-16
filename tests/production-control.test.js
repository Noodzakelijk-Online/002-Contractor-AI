const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-production-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  const job = ledger.createIntake({
    title: 'Measured field production',
    client: { name: 'Production Client' },
    status: 'in_progress',
    assignAutomatically: false
  }, { actor: 'production-test' });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, job };
}

const planLines = [
  { lineKey: 'wall-area', costCode: 'LAB-WALL', description: 'Install internal wall finish', unit: 'm2', plannedQuantity: 100, plannedLaborHours: 80 },
  { lineKey: 'edge-trim', costCode: 'LAB-TRIM', description: 'Install edge trim', unit: 'm', plannedQuantity: 20, plannedLaborHours: 10 }
];

test('production baseline approval governs replay-safe output and earned-hours variance', t => {
  const { ledger, job } = fixture(t);
  const requested = ledger.requestProductionBaseline(job.id, { lines: planLines, notes: 'Measured production budget.' }, { actor: 'office' });
  assert.equal(requested.baseline.status, 'pending_approval');
  assert.equal(requested.baseline.integrityValid, true);
  assert.equal(requested.approval.targetType, 'production_baseline');
  assert.match(requested.approval.decision.primaryEffect, /production baseline/i);
  assert.equal(requested.production.status, 'pending_approval');
  assert.throws(
    () => ledger.recordProductionEntry(job.id, {
      entryKey: 'production-before-approval-0001', lineKey: 'wall-area', quantity: 10, crewHours: 8, note: 'Must remain blocked.'
    }),
    error => error.code === 'production_baseline_required' && error.statusCode === 409
  );

  const replayedBaseline = ledger.requestProductionBaseline(job.id, { lines: planLines }, { actor: 'office-two' });
  assert.equal(replayedBaseline.replayed, true);
  assert.equal(replayedBaseline.baseline.id, requested.baseline.id);
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved', resolvedBy: 'Production approver', reason: 'Quantities and labor budget verified.'
  });

  const payload = {
    entryKey: 'production-field-output-0001',
    baselineId: requested.baseline.id,
    lineKey: 'wall-area',
    workDate: '2026-07-16',
    quantity: 25,
    crewHours: 40,
    note: 'First zone installed and measured by the crew lead.',
    source: 'field_outbox'
  };
  const first = ledger.recordProductionEntry(job.id, payload, { actor: 'role:field_worker' });
  const replay = ledger.recordProductionEntry(job.id, payload, { actor: 'role:field_worker' });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.entry.id, first.entry.id);
  assert.equal(first.production.summary.plannedLaborHours, 90);
  assert.equal(first.production.summary.earnedHours, 20);
  assert.equal(first.production.summary.crewHours, 40);
  assert.equal(first.production.summary.performanceFactor, 0.5);
  assert.equal(first.production.summary.atRisk, true);
  assert.equal(first.production.lines.find(line => line.lineKey === 'wall-area').quantityProgressPercent, 25);
  assert.throws(
    () => ledger.recordProductionEntry(job.id, { ...payload, quantity: 30 }),
    error => error.code === 'production_entry_key_reused' && error.statusCode === 409
  );

  const detail = ledger.getJobDetail(job.id, { includeAudit: true });
  assert.equal(detail.productionControl.sourceHash, first.production.sourceHash);
  assert.equal(detail.productionEntries.length, 1);
  assert.equal(detail.productionControl.summary.atRiskLines, 1);
  assert.ok(detail.audit.some(event => event.action === 'record_production_output' && event.entityId === first.entry.id));
  const preview = ledger.runAutonomousCycle({ dryRun: true, actionTypes: ['review_productivity_variance'], jobIds: [job.id] });
  assert.equal(preview.preview.length, 1);
  assert.equal(preview.preview[0].sourceHash, first.production.sourceHash);
  const applied = ledger.runAutonomousCycle({ actionTypes: ['review_productivity_variance'], jobIds: [job.id] });
  assert.equal(applied.applied.length, 1);
  assert.equal(applied.applied[0].status, 'task_created');
  assert.equal(ledger.getJobDetail(job.id).tasks.find(task => task.id === applied.applied[0].taskId).data.productionSourceHash, first.production.sourceHash);
  assert.equal(ledger.runAutonomousCycle({ dryRun: true, actionTypes: ['review_productivity_variance'], jobIds: [job.id] }).preview.length, 0);
  ledger.recordProductionEntry(job.id, {
    ...payload,
    entryKey: 'production-field-output-0002',
    quantity: 5,
    crewHours: 10,
    note: 'Additional measured output was retained while the existing variance review remained open.'
  }, { actor: 'role:field_worker' });
  assert.equal(ledger.runAutonomousCycle({ dryRun: true, actionTypes: ['review_productivity_variance'], jobIds: [job.id] }).preview.length, 0);
  assert.equal(ledger.diagnose().valid, true);
});

test('production entry reversal preserves history and excludes output only after approval', t => {
  const { ledger, job } = fixture(t);
  const requested = ledger.requestProductionBaseline(job.id, { lines: planLines }, { actor: 'office' });
  ledger.resolveApproval(requested.approval.id, { status: 'approved', resolvedBy: 'Production approver' });
  const retained = ledger.recordProductionEntry(job.id, {
    entryKey: 'production-reversal-output-0001',
    lineKey: 'edge-trim',
    workDate: '2026-07-16',
    quantity: 5,
    crewHours: 4,
    note: 'Trim quantity was assigned to the wrong job area.'
  }, { actor: 'field' });

  const reversal = ledger.requestProductionEntryReversal(job.id, retained.entry.id, {
    reason: 'The measured trim belongs to a separate work package.'
  }, { actor: 'office' });
  assert.equal(reversal.entry.status, 'pending_reversal');
  assert.equal(reversal.approval.targetType, 'production_entry_reversal');
  assert.match(reversal.approval.decision.primaryEffect, /reverse retained production entry/i);
  assert.equal(ledger.calculateProductionPerformance(job.id).summary.crewHours, 4);

  ledger.resolveApproval(reversal.approval.id, {
    status: 'rejected', resolvedBy: 'Production approver', reason: 'Allocation concern was not yet substantiated.'
  });
  assert.equal(ledger.getJobDetail(job.id).productionEntries.find(entry => entry.id === retained.entry.id).status, 'recorded');
  assert.equal(ledger.calculateProductionPerformance(job.id).summary.crewHours, 4);

  const verifiedReversal = ledger.requestProductionEntryReversal(job.id, retained.entry.id, {
    reason: 'The separate work-package allocation is now supported by retained measurement evidence.'
  }, { actor: 'office' });
  assert.notEqual(verifiedReversal.approval.id, reversal.approval.id);
  ledger.resolveApproval(verifiedReversal.approval.id, {
    status: 'approved', resolvedBy: 'Production approver', reason: 'Wrong work package confirmed.'
  });
  const production = ledger.calculateProductionPerformance(job.id);
  assert.equal(production.summary.crewHours, 0);
  assert.equal(production.summary.earnedHours, 0);
  assert.equal(production.entries.find(entry => entry.id === retained.entry.id).status, 'reversed');
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM production_entries WHERE id = ?').get(retained.entry.id).count, 1);
  assert.ok(ledger.getJobDetail(job.id, { includeAudit: true }).audit.some(event => event.action === 'reverse_production_entry'));
  assert.equal(ledger.diagnose().valid, true);
});

test('revised baselines preserve cumulative output and cannot orphan retained line history', t => {
  const { ledger, job } = fixture(t);
  const initial = ledger.requestProductionBaseline(job.id, { lines: planLines });
  ledger.resolveApproval(initial.approval.id, { status: 'approved', resolvedBy: 'Production approver' });
  ledger.recordProductionEntry(job.id, {
    entryKey: 'production-cumulative-output-0001',
    lineKey: 'wall-area',
    quantity: 20,
    crewHours: 16,
    note: 'Measured cumulative wall output.'
  });

  assert.throws(
    () => ledger.requestProductionBaseline(job.id, { lines: [planLines[1]] }),
    error => error.code === 'production_baseline_line_history_required' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.requestProductionBaseline(job.id, { lines: [{ ...planLines[0], unit: 'm' }, planLines[1]] }),
    error => error.code === 'production_baseline_unit_conflict' && error.statusCode === 409
  );

  const revised = ledger.requestProductionBaseline(job.id, {
    lines: [{ ...planLines[0], plannedQuantity: 120, plannedLaborHours: 90 }, planLines[1]],
    notes: 'Verified scope growth retained in a revised production plan.'
  });
  ledger.resolveApproval(revised.approval.id, { status: 'approved', resolvedBy: 'Production approver' });
  const production = ledger.calculateProductionPerformance(job.id);
  assert.equal(production.activeBaseline.id, revised.baseline.id);
  assert.equal(production.lines.find(line => line.lineKey === 'wall-area').installedQuantity, 20);
  assert.equal(production.lines.find(line => line.lineKey === 'wall-area').crewHours, 16);
  assert.equal(production.baselines.find(item => item.id === initial.baseline.id).status, 'superseded');
});

test('production baseline tampering is reported by direct reads and diagnostics', t => {
  const { ledger, job } = fixture(t);
  const requested = ledger.requestProductionBaseline(job.id, { lines: planLines });
  const snapshot = JSON.parse(ledger.db.prepare('SELECT snapshot_json FROM production_baselines WHERE id = ?').get(requested.baseline.id).snapshot_json);
  snapshot.lines[0].plannedQuantity = 1;
  ledger.db.prepare('UPDATE production_baselines SET snapshot_json = ? WHERE id = ?').run(JSON.stringify(snapshot), requested.baseline.id);
  assert.throws(
    () => ledger.getProductionBaseline(requested.baseline.id),
    error => error.code === 'production_baseline_integrity_failed' && error.statusCode === 409
  );
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => /Production baseline .*failed retained snapshot verification/.test(issue.message)));
});
