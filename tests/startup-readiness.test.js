const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('direct production startup refuses an invalid runtime configuration', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-startup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = childProcess.spawnSync(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      CONTRACTOR_AI_RUNTIME_MODE: 'local',
      CONTRACTOR_AI_STORAGE_MODE: 'local',
      CONTRACTOR_AI_AUTH_TOKEN: '',
      CONTRACTOR_AI_ROLE_TOKENS: '',
      CONTRACTOR_AI_TRUST_PROXY: '',
      STATE_FILE: path.join(directory, 'state.json'),
      LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
      UPLOAD_DIR: path.join(directory, 'uploads')
    }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /production_runtime_not_ready/);
  assert.match(result.stderr, /production_auth_token_required/);
});

test('direct production startup rejects operator secrets shorter than 32 characters', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-startup-weak-token-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = childProcess.spawnSync(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      CONTRACTOR_AI_RUNTIME_MODE: 'local',
      CONTRACTOR_AI_STORAGE_MODE: 'local',
      CONTRACTOR_AI_AUTH_TOKEN: 'x'.repeat(31),
      CONTRACTOR_AI_ROLE_TOKENS: '',
      CONTRACTOR_AI_TRUST_PROXY: '',
      STATE_FILE: path.join(directory, 'state.json'),
      LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
      UPLOAD_DIR: path.join(directory, 'uploads')
    }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /weak_auth_token/);
  assert.match(result.stderr, /production_auth_token_required/);
});

test('direct production startup refuses copied environment template placeholders', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-startup-template-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = childProcess.spawnSync(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      CONTRACTOR_AI_RUNTIME_MODE: 'local',
      CONTRACTOR_AI_STORAGE_MODE: 'local',
      CONTRACTOR_AI_AUTH_TOKEN: 'replace-with-a-long-unique-owner-token',
      CONTRACTOR_AI_ROLE_TOKENS: '',
      CONTRACTOR_AI_TRUST_PROXY: '',
      STATE_FILE: path.join(directory, 'state.json'),
      LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
      UPLOAD_DIR: path.join(directory, 'uploads')
    }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /production_runtime_not_ready/);
  assert.match(result.stderr, /template_placeholder_configured/);
});

test('direct production startup rejects a relative configured HAI feed path', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-startup-hai-path-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = childProcess.spawnSync(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      CONTRACTOR_AI_RUNTIME_MODE: 'local',
      CONTRACTOR_AI_STORAGE_MODE: 'local',
      CONTRACTOR_AI_AUTH_TOKEN: 'hai-path-owner-token-at-least-32-characters',
      CONTRACTOR_AI_ROLE_TOKENS: '',
      CONTRACTOR_AI_TRUST_PROXY: '',
      CONTRACTOR_AI_HAI_FEED_PATH: 'relative-feed.json',
      STATE_FILE: path.join(directory, 'state.json'),
      LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
      UPLOAD_DIR: path.join(directory, 'uploads')
    }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /production_runtime_not_ready/);
  assert.match(result.stderr, /hai_feed_path_invalid/);
});

test('direct production startup rejects duplicate principal identity and token ownership', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-startup-principals-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sharedToken = 'duplicate-principal-token-at-least-32-characters';
  const result = childProcess.spawnSync(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      CONTRACTOR_AI_RUNTIME_MODE: 'local',
      CONTRACTOR_AI_STORAGE_MODE: 'local',
      CONTRACTOR_AI_AUTH_TOKEN: '',
      CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify({
        operators: [
          { id: 'office-primary', role: 'office_operator', token: sharedToken },
          { id: 'office-secondary', role: 'office_operator', token: sharedToken }
        ]
      }),
      CONTRACTOR_AI_TRUST_PROXY: '',
      STATE_FILE: path.join(directory, 'state.json'),
      LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
      UPLOAD_DIR: path.join(directory, 'uploads')
    }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /production_runtime_not_ready/);
  assert.match(result.stderr, /duplicate_operator_token/);
});

test('direct production startup rejects universal and hop-count proxy trust shortcuts', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-startup-proxy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = childProcess.spawnSync(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      CONTRACTOR_AI_RUNTIME_MODE: 'local',
      CONTRACTOR_AI_STORAGE_MODE: 'local',
      CONTRACTOR_AI_AUTH_TOKEN: 'proxy-policy-owner-token-2026',
      CONTRACTOR_AI_ROLE_TOKENS: '',
      CONTRACTOR_AI_TRUST_PROXY: 'true',
      STATE_FILE: path.join(directory, 'state.json'),
      LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
      UPLOAD_DIR: path.join(directory, 'uploads')
    }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /production_runtime_not_ready/);
  assert.match(result.stderr, /invalid_trusted_proxy/);
});

test('direct hosted startup refuses missing HTTPS, EU, DPA, and recovery declarations', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-startup-hosted-policy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = childProcess.spawnSync(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      CONTRACTOR_AI_RUNTIME_MODE: 'hosted',
      CONTRACTOR_AI_STORAGE_MODE: 'local',
      CONTRACTOR_AI_AUTH_TOKEN: 'hosted-policy-test-owner-token',
      CONTRACTOR_AI_ROLE_TOKENS: '',
      CONTRACTOR_AI_DATABASE_URL: '',
      CONTRACTOR_AI_PUBLIC_URL: 'http://contractor-ai.test/path',
      CONTRACTOR_AI_HOSTING_PROVIDER: '',
      CONTRACTOR_AI_HOSTING_REGION: '',
      CONTRACTOR_AI_DATA_RESIDENCY: 'US',
      CONTRACTOR_AI_DPA_REFERENCE: '',
      CONTRACTOR_AI_POSTGRES_BACKUP_MODE: '',
      CONTRACTOR_AI_OBJECT_VERSIONING_ENABLED: 'false',
      CONTRACTOR_AI_BACKUP_POLICY_REFERENCE: '',
      CONTRACTOR_AI_RETENTION_POLICY_REFERENCE: '',
      CONTRACTOR_AI_TRUST_PROXY: '',
      CORS_ORIGINS: 'https://different-origin.test',
      STATE_FILE: path.join(directory, 'state.json'),
      LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
      UPLOAD_DIR: path.join(directory, 'uploads')
    }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /hosted_public_https_required/);
  assert.match(result.stderr, /hosted_provider_required/);
  assert.match(result.stderr, /hosted_region_required/);
  assert.match(result.stderr, /hosted_eu_residency_required/);
  assert.match(result.stderr, /hosted_dpa_required/);
  assert.match(result.stderr, /hosted_postgres_backup_required/);
  assert.match(result.stderr, /hosted_object_versioning_required/);
  assert.match(result.stderr, /hosted_backup_policy_required/);
  assert.match(result.stderr, /hosted_retention_policy_required/);
  assert.match(result.stderr, /hosted_trusted_proxy_required/);
});

test('direct hosted startup refuses insecure and unreachable object storage', { skip: !process.env.CONTRACTOR_AI_POSTGRES_TEST_URL }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-startup-storage-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = childProcess.spawnSync(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      CONTRACTOR_AI_RUNTIME_MODE: 'hosted',
      CONTRACTOR_AI_STORAGE_MODE: 's3',
      CONTRACTOR_AI_EVIDENCE_STORAGE_MAX_BYTES: '1073741824',
      CONTRACTOR_AI_AUTH_TOKEN: 'hosted-startup-test-owner-token',
      CONTRACTOR_AI_ROLE_TOKENS: '',
      CONTRACTOR_AI_DATABASE_URL: process.env.CONTRACTOR_AI_POSTGRES_TEST_URL,
      CONTRACTOR_AI_PUBLIC_URL: 'https://contractor-ai.test',
      CONTRACTOR_AI_HOSTING_PROVIDER: 'EU Test Provider',
      CONTRACTOR_AI_HOSTING_REGION: 'eu-central-1',
      CONTRACTOR_AI_DATA_RESIDENCY: 'EU',
      CONTRACTOR_AI_DPA_REFERENCE: 'DPA-startup-test-2026',
      CONTRACTOR_AI_POSTGRES_BACKUP_MODE: 'pitr',
      CONTRACTOR_AI_OBJECT_VERSIONING_ENABLED: 'true',
      CONTRACTOR_AI_BACKUP_POLICY_REFERENCE: 'recovery-startup-test-2026',
      CONTRACTOR_AI_RETENTION_POLICY_REFERENCE: 'retention-startup-test-2026',
      CONTRACTOR_AI_TRUST_PROXY: 'loopback',
      CONTRACTOR_AI_S3_ENDPOINT: 'http://127.0.0.1:1',
      CONTRACTOR_AI_S3_BUCKET: 'contractor-private',
      CONTRACTOR_AI_S3_REGION: 'eu-central-1',
      CONTRACTOR_AI_S3_ACCESS_KEY_ID: 'startup-test-access',
      CONTRACTOR_AI_S3_SECRET_ACCESS_KEY: 'startup-test-secret',
      CONTRACTOR_AI_STORAGE_TIMEOUT_MS: '500',
      CONTRACTOR_AI_STORAGE_VERIFY_TTL_MS: '5000',
      CORS_ORIGINS: 'https://contractor-ai.test',
      STATE_FILE: path.join(directory, 'state.json'),
      LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
      UPLOAD_DIR: path.join(directory, 'uploads')
    }
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /production_runtime_not_ready/);
  assert.match(result.stderr, /hosted_object_storage_tls_required/);
  assert.match(result.stderr, /object_storage_unavailable/);
});
