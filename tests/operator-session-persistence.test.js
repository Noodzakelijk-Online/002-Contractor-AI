const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

test('operator sessions remain revocable across ledger restarts', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-operator-session-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const session = {
    sessionIdHash: 'durable-session-id-hash',
    operatorId: 'office-utrecht',
    role: 'office_operator',
    tokenFingerprint: 'durable-token-fingerprint',
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString()
  };

  const initial = new ContractorOperatingLedger({ dbFile });
  assert.equal(initial.migrationStatus().currentVersion, '070_managed_operator_accounts');
  assert.equal(initial.createOperatorSession(session).operatorId, session.operatorId);
  initial.close();

  const restarted = new ContractorOperatingLedger({ dbFile });
  assert.equal(restarted.getOperatorSession(session.sessionIdHash).role, session.role);
  assert.equal(restarted.revokeOperatorSession(session.sessionIdHash, { reason: 'operator_logout' }), true);
  restarted.close();

  const verified = new ContractorOperatingLedger({ dbFile });
  assert.equal(verified.getOperatorSession(session.sessionIdHash), null);
  const revoked = verified.getOperatorSession(session.sessionIdHash, { includeRevoked: true });
  assert.equal(revoked.revocationReason, 'operator_logout');
  assert.ok(revoked.revokedAt);
  verified.close();
});
