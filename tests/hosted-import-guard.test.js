const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-hosted-import-guard-'));
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'hosted',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'false',
  CONTRACTOR_AI_AUTH_TOKEN: '',
  CONTRACTOR_AI_ROLE_TOKENS: '',
  CONTRACTOR_AI_DATABASE_URL: '',
  STATE_FILE: path.join(directory, 'state.json'),
  LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(directory, 'uploads')
});

const app = require('../server');

test('an imported hosted app fails closed until its production requirements are valid', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'hosted_import_guard_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ledger/jobs`);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'auth_not_configured');
});
