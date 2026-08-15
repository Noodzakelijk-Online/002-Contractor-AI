const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function createLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-audit-hardening-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

test('dashboard summary is reused until a committed ledger mutation invalidates it', t => {
  const ledger = createLedger(t);
  let conflictScans = 0;
  const original = ledger.detectToolReservationConflicts.bind(ledger);
  ledger.detectToolReservationConflicts = (...argumentsList) => {
    conflictScans += 1;
    return original(...argumentsList);
  };

  const first = ledger.dashboardSummary();
  const second = ledger.dashboardSummary();
  assert.deepEqual(second, first);
  assert.equal(conflictScans, 2);

  ledger.createIntake({ title: 'Cache invalidation project', client: { name: 'Cache client' } });
  const afterMutation = ledger.dashboardSummary();
  assert.equal(afterMutation.metrics.jobs, first.metrics.jobs + 1);
  assert.equal(conflictScans, 4);
});

test('evidence storage usage counts each retained storage object only once', t => {
  const ledger = createLedger(t);
  const job = ledger.createIntake({ title: 'Evidence usage project', client: { name: 'Evidence client' } });

  ledger.addDocument(job.id, {
    title: 'Site proof',
    filename: 'site-proof.jpg',
    sizeBytes: 2048,
    storageRef: '2026-08/site-proof.jpg'
  }, { audit: false });
  ledger.addDocument(job.id, {
    title: 'Retained reference to site proof',
    filename: 'site-proof.jpg',
    sizeBytes: 2048,
    storageRef: '2026-08/site-proof.jpg'
  }, { audit: false });
  ledger.addDocument(job.id, {
    title: 'Inspection report',
    filename: 'inspection.pdf',
    sizeBytes: 4096,
    storageRef: '2026-08/inspection.pdf'
  }, { audit: false });

  assert.deepEqual(ledger.evidenceStorageUsage(), {
    bytes: 6144,
    objects: 2
  });
});
