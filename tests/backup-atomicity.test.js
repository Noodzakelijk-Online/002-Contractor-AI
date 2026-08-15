const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const backupSigningKey = 'contractor-ai-atomic-backup-test-signing-key-at-least-32-characters';

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const body = await response.json();
  return { response, body };
}

test('failed backup creation never publishes a partial recovery point', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-atomic-backup-'));
  const backupRoot = path.join(directory, 'backups');
  Object.assign(process.env, {
    NODE_ENV: 'test',
    CONTRACTOR_AI_RUNTIME_MODE: 'local',
    CONTRACTOR_AI_STORAGE_MODE: 'local',
    CONTRACTOR_AI_BACKUP_SIGNING_KEY: backupSigningKey,
    STATE_FILE: path.join(directory, 'state.json'),
    LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
    UPLOAD_DIR: path.join(directory, 'uploads')
  });
  delete process.env.CONTRACTOR_AI_REQUIRE_AUTH;
  delete process.env.CONTRACTOR_AI_AUTH_TOKEN;
  delete process.env.CONTRACTOR_AI_ROLE_TOKENS;
  delete require.cache[require.resolve('../server')];
  const app = require('../server');
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'test_cleanup' });
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const originalCopyFileSync = fs.copyFileSync;
  let failureInjected = false;
  fs.copyFileSync = function injectedBackupCopyFailure(source, target, ...args) {
    if (!failureInjected && path.resolve(target).startsWith(`${path.resolve(backupRoot)}${path.sep}`)) {
      failureInjected = true;
      const error = new Error('Injected backup copy failure');
      error.code = 'ENOSPC';
      throw error;
    }
    return originalCopyFileSync.call(this, source, target, ...args);
  };

  let failedBackup;
  try {
    failedBackup = await request(baseUrl, '/api/operations/backup', { method: 'POST', body: '{}' });
  } finally {
    fs.copyFileSync = originalCopyFileSync;
  }

  assert.equal(failureInjected, true);
  assert.equal(failedBackup.response.status, 500);
  assert.equal(failedBackup.body.error.code, 'backup_failed');
  assert.deepEqual(fs.existsSync(backupRoot) ? fs.readdirSync(backupRoot) : [], []);

  const successfulBackup = await request(baseUrl, '/api/operations/backup', { method: 'POST', body: '{}' });
  assert.equal(successfulBackup.response.status, 201);
  const backupId = successfulBackup.body.backup.backupId;
  assert.deepEqual(fs.readdirSync(backupRoot), [backupId]);

  const verification = await request(baseUrl, `/api/operations/backups/${encodeURIComponent(backupId)}/verify`);
  assert.equal(verification.response.status, 200);
  assert.equal(verification.body.verification.valid, true);
});
