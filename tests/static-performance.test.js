const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('built dashboard uses immutable asset caching, no-store HTML, and compression', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-static-'));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    CONTRACTOR_AI_DATA_DIR: directory,
    LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
    UPLOAD_DIR: path.join(directory, 'uploads')
  });
  delete process.env.CONTRACTOR_AI_AUTH_TOKEN;
  delete process.env.CONTRACTOR_AI_ROLE_TOKENS;
  delete process.env.CONTRACTOR_AI_REQUIRE_AUTH;
  delete require.cache[require.resolve('../server')];
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const index = await fetch(baseUrl, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(index.status, 200);
    assert.equal(index.headers.get('cache-control'), 'no-store');
    const html = await index.text();
    const assetPath = html.match(/src="(\/assets\/[^"?]+\.js)"/)?.[1];
    assert.ok(assetPath, 'built JavaScript asset path');
    const asset = await fetch(`${baseUrl}${assetPath}`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control') || '', /immutable/);
    assert.equal(asset.headers.get('content-encoding'), 'gzip');
    assert.ok((await asset.arrayBuffer()).byteLength > 1_024);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Node test runner discovers every test exactly once and npm has no duplicate pretest hook', () => {
  const packageJson = require('../package.json');
  const { allTestFiles, postgresTestFiles, withTestConcurrency } = require('../scripts/run-node-tests');
  const files = allTestFiles();
  const postgresFiles = postgresTestFiles(files);
  assert.equal(packageJson.scripts.pretest, undefined);
  assert.match(packageJson.scripts.test, /--test-concurrency=4(?:\s|$)/);
  assert.equal(new Set(files).size, files.length);
  assert.ok(files.includes('tests/hai-connector.test.js'));
  assert.ok(files.includes('tests/windows-standalone.test.js'));
  assert.deepEqual(files, [...files].sort((left, right) => left.localeCompare(right)));
  assert.deepEqual(postgresFiles, [
    'tests/local-to-hosted-migration.test.js',
    'tests/operations-safety.test.js',
    'tests/postgres-ledger-contract.test.js',
    'tests/startup-readiness.test.js'
  ]);
  assert.deepEqual(withTestConcurrency(['--test-concurrency=4', '--test-reporter=spec'], 1), [
    '--test-concurrency=1',
    '--test-reporter=spec'
  ]);
});

test('browser runner discovers isolated bounded batches without duplicate workflows', () => {
  const { chunkBrowserTests, configuredBatchSize, discoverBrowserTests } = require('../scripts/run-browser-tests');
  const files = discoverBrowserTests();
  const batchSize = configuredBatchSize();
  const batches = chunkBrowserTests(files, batchSize);
  assert.equal(batchSize, 4);
  assert.equal(files.length, 80);
  assert.equal(new Set(files).size, files.length);
  assert.equal(batches.flat().length, files.length);
  assert.ok(batches.every(batch => batch.length >= 1 && batch.length <= batchSize));
});
