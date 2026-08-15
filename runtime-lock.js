const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RUNTIME_LOCK_FORMAT = 'contractor-ai-runtime-lock/v1';

function runtimeLockPath(dataDir) {
  return path.join(path.resolve(dataDir), 'runtime.lock');
}

function processIsActive(pid, expectedStartedAt = null) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) {
    if (!expectedStartedAt) return true;
    const expected = Date.parse(expectedStartedAt);
    const current = Date.now() - process.uptime() * 1_000;
    return Number.isFinite(expected) && Math.abs(expected - current) < 5_000;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function readRuntimeLock(file) {
  try {
    const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
    return lock?.format === RUNTIME_LOCK_FORMAT ? lock : null;
  } catch {
    return null;
  }
}

function activeRuntimeError(lock) {
  const error = new Error(`Contractor.AI ${lock?.purpose || 'runtime'} is active with process ${lock?.pid || 'unknown'}; stop it before starting another runtime or restore.`);
  error.code = 'contractor_ai_runtime_active';
  error.lock = lock || null;
  return error;
}

function acquireRuntimeLock(dataDir, options = {}) {
  const directory = path.resolve(dataDir);
  const file = runtimeLockPath(directory);
  const leaseId = crypto.randomUUID();
  const record = {
    format: RUNTIME_LOCK_FORMAT,
    leaseId,
    pid: Number.isInteger(options.pid) ? options.pid : process.pid,
    purpose: String(options.purpose || 'runtime'),
    processStartedAt: new Date(Date.now() - process.uptime() * 1_000).toISOString(),
    acquiredAt: new Date().toISOString()
  };
  fs.mkdirSync(directory, { recursive: true });
  let reclaimedStaleLock = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      try { fs.chmodSync(file, 0o600); } catch { /* Best effort on Windows. */ }
      let released = false;
      return {
        file,
        leaseId,
        record,
        reclaimedStaleLock,
        release() {
          if (released) return false;
          released = true;
          const retained = readRuntimeLock(file);
          if (retained?.leaseId !== leaseId) return false;
          fs.rmSync(file, { force: true });
          return true;
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const retained = readRuntimeLock(file);
      if (retained && processIsActive(Number(retained.pid), retained.processStartedAt)) throw activeRuntimeError(retained);
      if (!retained) {
        const ageMs = Date.now() - fs.statSync(file).mtimeMs;
        if (ageMs < 30_000) throw activeRuntimeError(null);
      }
      fs.rmSync(file, { force: true });
      reclaimedStaleLock = true;
    }
  }
  throw activeRuntimeError(readRuntimeLock(file));
}

module.exports = {
  RUNTIME_LOCK_FORMAT,
  acquireRuntimeLock,
  processIsActive,
  readRuntimeLock,
  runtimeLockPath
};
