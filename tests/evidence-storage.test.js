const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EvidenceStorageError, LocalEvidenceStorage, S3EvidenceStorage } = require('../evidence-storage');

test('local evidence storage retains files under the configured private root', async t => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-storage-project-'));
  const rootDir = path.join(projectRoot, 'data', 'uploads');
  const storage = new LocalEvidenceStorage({ rootDir, projectRoot });
  const stored = await storage.store({
    originalName: 'site proof.jpg',
    mimeType: 'image/jpeg',
    size: 4,
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0])
  });
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  assert.match(stored.storageRef, /^data\/uploads\//);
  assert.equal(stored.sha256, crypto.createHash('sha256').update(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).digest('hex'));
  assert.deepEqual(await storage.read(stored.storageRef), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  const verification = await storage.verify();
  assert.equal(verification.ready, true);
  assert.equal(verification.mode, 'local');
  assert.equal(await storage.remove(stored.storageRef), true);
  assert.equal(await storage.remove(stored.storageRef), false);
  await assert.rejects(() => storage.read('../outside.jpg'), error => error instanceof EvidenceStorageError && error.code === 'evidence_not_available');
  await assert.rejects(() => storage.remove('../outside.jpg'), error => error instanceof EvidenceStorageError && error.code === 'invalid_storage_reference');
});

test('S3 evidence storage signs private object requests and requires full configuration', async () => {
  assert.throws(() => new S3EvidenceStorage({}), error => error instanceof EvidenceStorageError && error.code === 's3_configuration_required');
  const requests = [];
  const retainedBodies = new Map();
  const storage = new S3EvidenceStorage({
    endpoint: 'https://s3.eu-central-1.example.test',
    bucket: 'contractor-private',
    region: 'eu-central-1',
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret',
    fetchFn: async (url, options) => {
      requests.push({ url: String(url), options });
      const target = String(url);
      if (options.method === 'PUT') retainedBodies.set(target, Buffer.from(options.body));
      if (options.method === 'DELETE') retainedBodies.delete(target);
      return new Response(options.method === 'GET' ? retainedBodies.get(target) : null, { status: 200 });
    }
  });
  const stored = await storage.store({ originalName: 'site proof.jpg', mimeType: 'image/jpeg', size: 4, buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) });
  assert.match(stored.storageRef, /^s3:\/\/contractor-private\/contractor-ai\/evidence\//);
  assert.equal(stored.sha256, crypto.createHash('sha256').update(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).digest('hex'));
  assert.match(requests[0].url, /contractor-private\/contractor-ai\/evidence\//);
  assert.match(requests[0].options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=test-access\//);
  assert.deepEqual(await storage.read(stored.storageRef), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

  const verification = await storage.verify();
  assert.equal(verification.ready, true);
  assert.equal(verification.mode, 's3');
  assert.deepEqual(requests.slice(-3).map(request => request.options.method), ['PUT', 'GET', 'DELETE']);
  assert.match(requests.at(-1).url, /\/contractor-ai\/evidence\/.readiness-[a-f0-9]{24}$/);
  assert.equal(retainedBodies.has(requests.at(-1).url), false);
  assert.equal(await storage.remove(stored.storageRef), true);
  assert.equal(requests.at(-1).options.method, 'DELETE');
});

test('S3 evidence references remain inside the configured private prefix', async () => {
  const requests = [];
  const storage = new S3EvidenceStorage({
    endpoint: 'https://s3.eu-central-1.example.test/provider-root',
    bucket: 'contractor-private',
    region: 'eu-central-1',
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret',
    prefix: '/tenant-a/contractor-evidence/',
    fetchFn: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(options.method === 'GET' ? 'retained' : null, { status: 200 });
    }
  });

  const validReference = 's3://contractor-private/tenant-a/contractor-evidence/2026-07/site-proof.jpg';
  assert.deepEqual(await storage.read(validReference), Buffer.from('retained'));
  assert.match(requests[0].url, /\/provider-root\/contractor-private\/tenant-a\/contractor-evidence\/2026-07\/site-proof.jpg$/);

  const invalidReferences = [
    's3://contractor-private/tenant-b/contractor-evidence/site-proof.jpg',
    's3://contractor-private/tenant-a/other/site-proof.jpg',
    's3://contractor-private/tenant-a/contractor-evidence/../private-payroll.csv',
    's3://different-bucket/tenant-a/contractor-evidence/site-proof.jpg'
  ];
  for (const reference of invalidReferences) {
    await assert.rejects(
      () => storage.read(reference),
      error => error instanceof EvidenceStorageError && error.code === 'invalid_storage_reference'
    );
  }
  assert.equal(requests.length, 1);
});

test('S3 configuration rejects ambiguous endpoints, buckets, and object prefixes', () => {
  const options = {
    endpoint: 'https://s3.eu-central-1.example.test',
    bucket: 'contractor-private',
    region: 'eu-central-1',
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret',
    fetchFn: async () => new Response(null, { status: 200 })
  };
  for (const endpoint of [
    'ftp://s3.example.test',
    'https://user:secret@s3.example.test',
    'https://s3.example.test?tenant=contractor',
    'not-a-url'
  ]) {
    assert.throws(
      () => new S3EvidenceStorage({ ...options, endpoint }),
      error => error instanceof EvidenceStorageError && error.code === 'invalid_s3_endpoint'
    );
  }
  assert.throws(
    () => new S3EvidenceStorage({ ...options, bucket: 'contractor/private' }),
    error => error instanceof EvidenceStorageError && error.code === 'invalid_s3_bucket'
  );
  assert.throws(
    () => new S3EvidenceStorage({ ...options, prefix: 'contractor-ai/../private' }),
    error => error instanceof EvidenceStorageError && error.code === 'invalid_s3_prefix'
  );
});

test('S3 readiness fails closed on provider, network, timeout, and read-back errors', async () => {
  const baseOptions = {
    endpoint: 'https://s3.eu-central-1.example.test',
    bucket: 'contractor-private',
    region: 'eu-central-1',
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret'
  };

  const rejected = new S3EvidenceStorage({
    ...baseOptions,
    fetchFn: async () => new Response(null, { status: 403 })
  });
  await assert.rejects(() => rejected.verify(), error => error instanceof EvidenceStorageError && error.code === 'object_storage_request_failed');

  const unreachable = new S3EvidenceStorage({
    ...baseOptions,
    fetchFn: async () => { throw new TypeError('network unavailable'); }
  });
  await assert.rejects(() => unreachable.verify(), error => error instanceof EvidenceStorageError && error.code === 'object_storage_unavailable');

  const timedOut = new S3EvidenceStorage({
    ...baseOptions,
    timeoutMs: 500,
    fetchFn: async (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })
  });
  await assert.rejects(() => timedOut.verify(), error => error instanceof EvidenceStorageError && error.code === 'object_storage_timeout');

  const mismatched = new S3EvidenceStorage({
    ...baseOptions,
    fetchFn: async (url, options) => new Response(options.method === 'GET' ? 'wrong-marker' : null, { status: 200 })
  });
  await assert.rejects(() => mismatched.verify(), error => error instanceof EvidenceStorageError && error.code === 'object_storage_verification_failed');

  const cleanupRejected = new S3EvidenceStorage({
    ...baseOptions,
    fetchFn: async (url, options) => {
      if (options.method === 'DELETE') return new Response(null, { status: 403 });
      return new Response(options.method === 'GET' ? 'contractor-ai-storage-readiness/v1' : null, { status: 200 });
    }
  });
  await assert.rejects(() => cleanupRejected.verify(), error => error instanceof EvidenceStorageError && error.code === 'object_storage_cleanup_failed');
});
