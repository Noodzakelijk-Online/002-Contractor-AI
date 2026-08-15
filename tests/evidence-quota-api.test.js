const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('cumulative evidence quota rejects an upload before storage', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-evidence-quota-'));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    CONTRACTOR_AI_RUNTIME_MODE: 'local',
    CONTRACTOR_AI_STORAGE_MODE: 'local',
    CONTRACTOR_AI_EVIDENCE_STORAGE_MAX_BYTES: '8',
    STATE_FILE: path.join(directory, 'state.json'),
    LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
    UPLOAD_DIR: path.join(directory, 'uploads')
  });
  const app = require('../server');
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'test_complete' });
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const intakeResponse = await fetch(`${baseUrl}/api/ledger/intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Quota project', client: { name: 'Quota client' } })
  });
  const intake = await intakeResponse.json();
  assert.equal(intakeResponse.status, 201);

  const form = new FormData();
  form.append('jobId', intake.job.id);
  form.append('evidenceFile', new Blob([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from('quota overflow')
  ], { type: 'image/jpeg' }), 'quota-proof.jpg');
  const uploadResponse = await fetch(`${baseUrl}/api/ledger/upload`, { method: 'POST', body: form });
  const upload = await uploadResponse.json();
  assert.equal(uploadResponse.status, 507);
  assert.equal(upload.error.code, 'evidence_storage_quota_exceeded');
  assert.equal(fs.existsSync(process.env.UPLOAD_DIR) ? fs.readdirSync(process.env.UPLOAD_DIR).length : 0, 0);
});
