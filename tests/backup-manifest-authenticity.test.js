const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BACKUP_MANIFEST_V3,
  signBackupManifest,
  verifyBackupManifestAuthenticity
} = require('../backup-manifest');

const signingKey = 'contractor-ai-test-backup-signing-key-with-at-least-32-characters';

function fixture() {
  return {
    format: BACKUP_MANIFEST_V3,
    backupId: '2026-08-15T00-00-00-000Z',
    createdAt: '2026-08-15T00:00:00.000Z',
    databaseMode: 'sqlite',
    database: { engine: 'sqlite', file: 'ledger.sqlite' },
    evidence: { included: true, fileCount: 0 },
    files: [{ file: 'ledger.sqlite', bytes: 4096, sha256: 'a'.repeat(64) }]
  };
}

test('signed backup manifests authenticate canonical recovery metadata', () => {
  const signed = signBackupManifest(fixture(), signingKey);
  const verification = verifyBackupManifestAuthenticity(signed, signingKey);
  assert.equal(verification.authenticated, true);
  assert.equal(verification.algorithm, 'hmac-sha256');
  assert.equal(signed.authenticity.keyId, verification.keyId);
});

test('manifest metadata cannot be changed while retaining authenticity', () => {
  const signed = signBackupManifest(fixture(), signingKey);
  signed.files[0].sha256 = 'b'.repeat(64);
  assert.throws(
    () => verifyBackupManifestAuthenticity(signed, signingKey),
    /authenticity verification failed/i
  );
});

test('unsigned legacy manifests require an explicit compatibility override', () => {
  const legacy = { ...fixture(), format: 'contractor-ai-backup-manifest/v2' };
  assert.throws(() => verifyBackupManifestAuthenticity(legacy, signingKey), /unsigned legacy backup/i);
  assert.deepEqual(verifyBackupManifestAuthenticity(legacy, signingKey, { allowLegacyUnsigned: true }), {
    authenticated: false,
    legacy: true,
    format: 'contractor-ai-backup-manifest/v2'
  });
});
