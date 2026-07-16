const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-graceful-shutdown-'));
const databaseFile = path.join(directory, 'ledger.sqlite');
process.env.STATE_FILE = path.join(directory, 'state.json');
process.env.LEDGER_DB_FILE = databaseFile;
process.env.UPLOAD_DIR = path.join(directory, 'uploads');
process.env.CONTRACTOR_AI_AUTONOMOUS_SCHEDULER_ENABLED = 'true';

const { ContractorOperatingLedger } = require('../operating-ledger');
const app = require('../server');

test('runtime shutdown drains HTTP, clears scheduler timers, and closes the retained ledger once', async () => {
  const server = app.listen(0);
  assert.strictEqual(app.locals.runtimeControl.configureHttpServer(server), server);
  assert.equal(server.keepAliveTimeout, 65_000);
  assert.equal(server.headersTimeout, 70_000);
  assert.deepEqual(app.locals.runtimeControl.httpTimeouts, {
    keepAliveTimeoutMs: 65_000,
    headersTimeoutMs: 70_000
  });
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/api/ledger/intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Graceful shutdown persistence proof',
      client: { name: 'Shutdown Proof Client' },
      assignAutomatically: false
    })
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(app.locals.runtimeControl.schedulerTimerCount(), 2);

  const firstShutdown = app.locals.runtimeControl.shutdown({ server, signal: 'test_shutdown', timeoutMs: 2_000 });
  const repeatedShutdown = app.locals.runtimeControl.shutdown({ server, signal: 'test_shutdown_repeated', timeoutMs: 2_000 });
  assert.strictEqual(repeatedShutdown, firstShutdown);
  const result = await firstShutdown;

  assert.equal(result.signal, 'test_shutdown');
  assert.equal(result.timersCleared, 2);
  assert.deepEqual(result.http, { drained: true, forced: false });
  assert.equal(server.listening, false);
  assert.equal(app.locals.runtimeControl.schedulerTimerCount(), 0);

  const reopened = new ContractorOperatingLedger({ dbFile: databaseFile });
  try {
    assert.equal(reopened.getJobDetail(payload.job.id, { includeAudit: false }).title, 'Graceful shutdown persistence proof');
    assert.equal(reopened.diagnose().valid, true);
  } finally {
    reopened.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
