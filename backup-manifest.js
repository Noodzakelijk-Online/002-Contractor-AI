const crypto = require('node:crypto');

const BACKUP_MANIFEST_V3 = 'contractor-ai-backup-manifest/v3';
const LEGACY_BACKUP_MANIFEST_FORMATS = new Set([
  'contractor-ai-backup-manifest/v1',
  'contractor-ai-backup-manifest/v2'
]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function signingKeyBytes(value) {
  const key = Buffer.from(String(value || ''), 'utf8');
  if (key.length < 32) throw new Error('Backup signing key must contain at least 32 UTF-8 bytes.');
  return key;
}

function unsignedManifest(manifest) {
  const { authenticity: _authenticity, ...unsigned } = manifest || {};
  return unsigned;
}

function manifestSignature(manifest, key) {
  return crypto.createHmac('sha256', signingKeyBytes(key)).update(stableJson(unsignedManifest(manifest))).digest('hex');
}

function manifestKeyId(key) {
  return crypto.createHash('sha256').update(signingKeyBytes(key)).digest('hex').slice(0, 16);
}

function signBackupManifest(manifest, key) {
  const signed = { ...unsignedManifest(manifest), format: BACKUP_MANIFEST_V3 };
  signed.authenticity = {
    algorithm: 'hmac-sha256',
    keyId: manifestKeyId(key),
    signature: manifestSignature(signed, key)
  };
  return signed;
}

function verifyBackupManifestAuthenticity(manifest, key, options = {}) {
  if (LEGACY_BACKUP_MANIFEST_FORMATS.has(manifest?.format)) {
    if (!options.allowLegacyUnsigned) {
      throw new Error('Unsigned legacy backup manifests require the explicit --allow-legacy-unsigned compatibility override.');
    }
    return { authenticated: false, legacy: true, format: manifest.format };
  }
  if (manifest?.format !== BACKUP_MANIFEST_V3) throw new Error('Backup manifest format is unsupported.');
  if (
    manifest.authenticity?.algorithm !== 'hmac-sha256'
    || typeof manifest.authenticity?.keyId !== 'string'
    || !/^[a-f0-9]{64}$/.test(String(manifest.authenticity?.signature || ''))
  ) {
    throw new Error('Backup manifest authenticity metadata is invalid.');
  }
  const expectedKeyId = manifestKeyId(key);
  const expected = Buffer.from(manifestSignature(manifest, key), 'hex');
  const actual = Buffer.from(manifest.authenticity.signature, 'hex');
  if (
    manifest.authenticity.keyId !== expectedKeyId
    || expected.length !== actual.length
    || !crypto.timingSafeEqual(expected, actual)
  ) {
    throw new Error('Backup manifest authenticity verification failed.');
  }
  return {
    authenticated: true,
    legacy: false,
    format: manifest.format,
    algorithm: manifest.authenticity.algorithm,
    keyId: expectedKeyId
  };
}

module.exports = {
  BACKUP_MANIFEST_V3,
  LEGACY_BACKUP_MANIFEST_FORMATS,
  manifestKeyId,
  signBackupManifest,
  stableJson,
  verifyBackupManifestAuthenticity
};
