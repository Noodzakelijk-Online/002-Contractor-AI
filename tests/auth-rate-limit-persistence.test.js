const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

test('authentication failure windows survive restart without retaining the client address', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-auth-rate-limit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const dbFile = path.join(directory, 'ledger.sqlite');
  const clientAddress = '203.0.113.27';
  const keyHash = crypto.createHash('sha256').update(`contractor-ai-auth-login\0${clientAddress}`).digest('hex');

  const initial = new ContractorOperatingLedger({ dbFile });
  assert.equal(initial.recordAuthenticationFailure(keyHash, { limit: 3, windowMs: 900_000, now: '2026-07-13T09:00:00.000Z' }).attemptCount, 1);
  assert.equal(initial.recordAuthenticationFailure(keyHash, { limit: 3, windowMs: 900_000, now: '2026-07-13T09:01:00.000Z' }).attemptCount, 2);
  initial.close();

  const restarted = new ContractorOperatingLedger({ dbFile });
  try {
    const retained = restarted.getAuthenticationRateLimit(keyHash, { limit: 3, windowMs: 900_000, now: '2026-07-13T09:02:00.000Z' });
    assert.equal(retained.attemptCount, 2);
    assert.equal(retained.remaining, 1);
    assert.equal(retained.limited, false);
    const row = restarted.db.prepare('SELECT * FROM auth_rate_limits WHERE key_hash = ?').get(keyHash);
    assert.equal(row.key_hash, keyHash);
    assert.equal(JSON.stringify(row).includes(clientAddress), false);
    assert.equal(restarted.clearAuthenticationRateLimit(keyHash), true);
    assert.equal(restarted.getAuthenticationRateLimit(keyHash, { limit: 3, windowMs: 900_000 }).attemptCount, 0);
  } finally {
    restarted.close();
  }
});

test('expired authentication failure windows are removed before a new attempt', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-auth-rate-expiry-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  const keyHash = crypto.createHash('sha256').update('expired-client').digest('hex');
  try {
    ledger.recordAuthenticationFailure(keyHash, { limit: 3, windowMs: 60_000, now: '2026-07-13T09:00:00.000Z' });
    const expired = ledger.getAuthenticationRateLimit(keyHash, { limit: 3, windowMs: 60_000, now: '2026-07-13T09:01:01.000Z' });
    assert.equal(expired.attemptCount, 0);
    assert.equal(expired.remaining, 3);
    assert.equal(Number(ledger.db.prepare('SELECT COUNT(*) AS count FROM auth_rate_limits').get().count), 0);
  } finally {
    ledger.close();
  }
});
