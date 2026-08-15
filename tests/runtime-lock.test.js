const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { acquireRuntimeLock, runtimeLockPath } = require('../runtime-lock');
const { restore } = require('../scripts/restore-local-backup');

test('runtime lock excludes a second live process and releases by lease identity', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-runtime-lock-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const first = acquireRuntimeLock(dataDir, { purpose: 'runtime' });
  assert.throws(
    () => acquireRuntimeLock(dataDir, { purpose: 'restore' }),
    error => error.code === 'contractor_ai_runtime_active'
  );
  first.release();
  const second = acquireRuntimeLock(dataDir, { purpose: 'restore' });
  assert.equal(fs.existsSync(runtimeLockPath(dataDir)), true);
  second.release();
  assert.equal(fs.existsSync(runtimeLockPath(dataDir)), false);
});

test('runtime lock reclaims a stale process marker', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-runtime-lock-stale-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(runtimeLockPath(dataDir), JSON.stringify({
    format: 'contractor-ai-runtime-lock/v1',
    pid: 2_147_483_647,
    purpose: 'runtime',
    leaseId: 'stale-lease'
  }));
  const lock = acquireRuntimeLock(dataDir, { purpose: 'restore' });
  assert.equal(lock.reclaimedStaleLock, true);
  lock.release();
});

test('restore refuses to begin while the local runtime lease is active', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-runtime-lock-restore-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const runtime = acquireRuntimeLock(dataDir, { purpose: 'runtime' });
  try {
    assert.throws(() => restore({
      'data-dir': dataDir,
      'backup-id': 'not-reached',
      confirm: 'RESTORE_not-reached'
    }), error => error.code === 'contractor_ai_runtime_active');
  } finally {
    runtime.release();
  }
});
