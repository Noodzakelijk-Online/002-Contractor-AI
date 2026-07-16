const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ContractorOperatingLedger } = require('../operating-ledger');

test('a new ledger with no legacy state starts without synthetic audit records', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-empty-ledger-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'contractor-ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  assert.equal(ledger.count('audit_events'), 0);
  assert.deepEqual(ledger.listAudit(), []);
});

test('a pre-ledger state file is imported once and is never mutated by the ledger runtime', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-state-migration-'));
  const stateFile = path.join(directory, 'server-state.json');
  const ledgerFile = path.join(directory, 'contractor-ledger.sqlite');
  const uploadDir = path.join(directory, 'uploads');
  const legacyState = {
    jobs: [{ id: 101, title: 'Imported state job', client: 'Migration Client', address: 'Utrecht', status: 'scheduled', priority: 'high', estimatedCost: 820 }],
    workers: [{ id: 201, name: 'Imported worker', specialty: 'General maintenance', status: 'available', location: 'Utrecht' }],
    tools: [{ id: 301, name: 'Imported ladder', category: 'access', status: 'available', currentLocation: 'Utrecht depot' }]
  };
  fs.writeFileSync(stateFile, JSON.stringify(legacyState, null, 2));
  const originalState = fs.readFileSync(stateFile, 'utf8');

  const previous = {
    STATE_FILE: process.env.STATE_FILE,
    LEDGER_DB_FILE: process.env.LEDGER_DB_FILE,
    UPLOAD_DIR: process.env.UPLOAD_DIR
  };
  process.env.STATE_FILE = stateFile;
  process.env.LEDGER_DB_FILE = ledgerFile;
  process.env.UPLOAD_DIR = uploadDir;
  delete require.cache[require.resolve('../server')];
  const app = require('../server');
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    // The native SQLite handle remains open until this test process exits on
    // Windows, so the temporary directory is left for the OS temp cleanup.
  });

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const initialJobs = await fetch(`${baseUrl}/api/ledger/jobs?limit=100`).then(response => response.json());
  assert.ok(initialJobs.jobs.some(job => job.id === 'legacy_job_101' && job.title === 'Imported state job'));

  const intake = await fetch(`${baseUrl}/api/ledger/intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Ledger write after import', client: { name: 'New Ledger Client' } })
  });
  assert.equal(intake.status, 201);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), originalState);

  const retired = await fetch(`${baseUrl}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(retired.status, 410);
});
