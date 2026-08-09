const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { applyStandaloneEnvironment, ensureStandaloneConfig, STANDALONE_CONFIG_FORMAT } = require('../standalone-runtime');
const { runtimeFiles } = require('../scripts/build-windows-standalone');

test('standalone runtime creates one persistent owner key under the Windows user profile', () => {
  const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-standalone-'));
  const environment = { LOCALAPPDATA: localAppData, PORT: '4123' };
  const first = ensureStandaloneConfig({ environment });
  const second = ensureStandaloneConfig({ environment });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.config.format, STANDALONE_CONFIG_FORMAT);
  assert.equal(first.config.ownerToken, second.config.ownerToken);
  assert.ok(first.config.ownerToken.length >= 32);
  assert.equal(first.config.port, 4123);
  assert.ok(first.paths.configFile.startsWith(path.resolve(localAppData)));

  const applied = applyStandaloneEnvironment({ environment });
  assert.equal(environment.NODE_ENV, 'production');
  assert.equal(environment.CONTRACTOR_AI_RUNTIME_MODE, 'local');
  assert.equal(environment.CONTRACTOR_AI_STORAGE_MODE, 'local');
  assert.equal(environment.CONTRACTOR_AI_REQUIRE_AUTH, 'true');
  assert.equal(environment.CONTRACTOR_AI_BIND_HOST, '127.0.0.1');
  assert.equal(environment.CONTRACTOR_AI_AUTH_TOKEN, first.config.ownerToken);
  assert.equal(environment.LEDGER_DB_FILE, applied.paths.ledgerFile);
});

test('Windows package contract includes the standalone, tunnel, HAI, and canonical ledger runtimes', () => {
  for (const required of [
    'server.js',
    'operating-ledger.js',
    'standalone-launcher.js',
    'standalone-runtime.js',
    'hai-connector.js',
    'scripts/start-ngrok.js',
    'scripts/export-hai-feed.js'
  ]) assert.ok(runtimeFiles.includes(required), required);
});
