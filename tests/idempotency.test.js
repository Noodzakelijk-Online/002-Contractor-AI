const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

test('completed idempotent requests survive a local restart and reject changed payloads', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-idempotency-'));
  const dbFile = path.join(dataDir, 'ledger.sqlite');
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const firstLedger = new ContractorOperatingLedger({ dbFile });
  const keyHash = 'restart-proof-key-hash';
  const scope = 'POST /api/ledger/upload:local-test';
  const requestHash = 'restart-proof-request-hash';
  const claim = firstLedger.claimIdempotentRequest({ keyHash, scope, requestHash });
  assert.equal(claim.claimed, true);
  assert.equal(firstLedger.completeIdempotentRequest(keyHash, requestHash, 201, { documentId: 'doc_restart_proof' }, claim.leaseId), true);
  firstLedger.close();

  const restartedLedger = new ContractorOperatingLedger({ dbFile });
  try {
    const replay = restartedLedger.claimIdempotentRequest({ keyHash, scope, requestHash });
    assert.equal(replay.replayed, true);
    assert.equal(replay.responseStatus, 201);
    assert.deepEqual(replay.responseBody, { documentId: 'doc_restart_proof' });

    const conflict = restartedLedger.claimIdempotentRequest({ keyHash, scope, requestHash: 'changed-request-hash' });
    assert.equal(conflict.claimed, false);
    assert.equal(conflict.reason, 'request_conflict');
    assert.equal(restartedLedger.migrationStatus().currentVersion, '029_purchase_order_issue_packages');
  } finally {
    restartedLedger.close();
  }
});

test('active idempotency leases block concurrent work and can be released for retry', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-idempotency-lease-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(dataDir, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const input = {
    keyHash: 'active-lease-key-hash',
    scope: 'POST /api/ledger/upload:local-test',
    requestHash: 'active-lease-request-hash'
  };
  const first = ledger.claimIdempotentRequest(input);
  assert.equal(first.claimed, true);
  const duplicate = ledger.claimIdempotentRequest(input);
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.reason, 'request_in_progress');
  assert.ok(duplicate.retryAfterMs > 0);

  assert.equal(ledger.releaseIdempotentRequest(input.keyHash, input.requestHash, 'not-the-owner'), false);
  assert.equal(ledger.releaseIdempotentRequest(input.keyHash, input.requestHash, first.leaseId), true);
  assert.equal(ledger.claimIdempotentRequest(input).claimed, true);
});

test('stale idempotency workers cannot complete or release a reclaimed request', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-idempotency-owner-'));
  const dbFile = path.join(dataDir, 'ledger.sqlite');
  const firstLedger = new ContractorOperatingLedger({ dbFile });
  const secondLedger = new ContractorOperatingLedger({ dbFile });
  t.after(() => {
    secondLedger.close();
    firstLedger.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const input = {
    keyHash: 'reclaimed-request-key-hash',
    scope: 'POST /api/ledger/upload:local-test',
    requestHash: 'reclaimed-request-payload-hash',
    leaseMs: 5_000,
    now: '2026-07-10T09:00:00.000Z'
  };
  const first = firstLedger.claimIdempotentRequest(input);
  assert.equal(first.claimed, true);
  const reclaimed = secondLedger.claimIdempotentRequest({ ...input, now: '2026-07-10T09:00:06.000Z' });
  assert.equal(reclaimed.claimed, true);
  assert.notEqual(reclaimed.leaseId, first.leaseId);

  assert.equal(firstLedger.completeIdempotentRequest(
    input.keyHash,
    input.requestHash,
    200,
    { documentId: 'stale-document' },
    first.leaseId
  ), false);
  assert.equal(firstLedger.releaseIdempotentRequest(input.keyHash, input.requestHash, first.leaseId), false);
  assert.equal(secondLedger.completeIdempotentRequest(
    input.keyHash,
    input.requestHash,
    201,
    { documentId: 'current-document' },
    reclaimed.leaseId
  ), true);

  const replay = firstLedger.claimIdempotentRequest({ ...input, now: '2026-07-10T09:00:07.000Z' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.responseStatus, 201);
  assert.deepEqual(replay.responseBody, { documentId: 'current-document' });
});
