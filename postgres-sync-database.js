const path = require('node:path');
const { Worker } = require('node:worker_threads');

const DEFAULT_TIMEOUT_MS = 60_000;
const RESPONSE_BYTES = 8 * 1024 * 1024;

function resolvePostgresConnectionOptions(connectionString, { ssl, rejectUnauthorized } = {}) {
  let normalizedConnectionString = connectionString;
  let sslMode = '';
  try {
    const parsed = new URL(connectionString);
    sslMode = String(parsed.searchParams.get('sslmode') || '').trim().toLowerCase();
    if (sslMode) {
      parsed.searchParams.delete('sslmode');
      normalizedConnectionString = parsed.toString();
    }
  } catch {
    // The pg client will provide the authoritative error for malformed URLs.
  }

  if (ssl === false || sslMode === 'disable') {
    return { connectionString: normalizedConnectionString, ssl: false, rejectUnauthorized: false, sslMode: sslMode || 'disable' };
  }

  const shouldVerify = rejectUnauthorized !== undefined
    ? rejectUnauthorized !== false
    : !['allow', 'prefer', 'require', 'no-verify'].includes(sslMode);
  return {
    connectionString: normalizedConnectionString,
    ssl: ssl !== false,
    rejectUnauthorized: shouldVerify,
    sslMode: sslMode || 'verify-full'
  };
}

function postgresError(payload) {
  const error = new Error(payload?.message || 'PostgreSQL request failed.');
  error.code = payload?.code || 'postgres_request_failed';
  return error;
}

function normalizeAdvisoryLockKey(value) {
  const key = Number(value);
  if (!Number.isSafeInteger(key)) throw new Error('PostgreSQL advisory lock key must be a safe integer.');
  return key;
}

function translateSql(sql) {
  let translated = String(sql || '')
    .replace(/^\s*PRAGMA[^;]+;?\s*$/gmi, '')
    .replace(/\bBEGIN\s+IMMEDIATE\b/gi, 'BEGIN')
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');

  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(String(sql || ''))) {
    translated = `${translated.trim().replace(/;$/, '')} ON CONFLICT DO NOTHING`;
  }
  if (/\bCREATE\s+TABLE\b/i.test(translated)) {
    translated = translated.replace(/\bREAL\b/gi, 'DOUBLE PRECISION');
  }
  return translated.trim();
}

function translateParameters(sql, values) {
  let index = 0;
  const translated = String(sql || '').replace(/\?/g, () => `$${++index}`);
  if (index !== values.length) {
    throw new Error(`PostgreSQL statement expected ${index} bound values but received ${values.length}.`);
  }
  return translated;
}

class PostgresSyncDatabase {
  constructor({ connectionString, ssl, rejectUnauthorized, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!connectionString) throw new Error('A PostgreSQL connection string is required.');
    const connectionOptions = resolvePostgresConnectionOptions(connectionString, { ssl, rejectUnauthorized });
    this.timeoutMs = Math.max(1_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
    this.closed = false;
    this.worker = new Worker(path.join(__dirname, 'postgres-sync-worker.js'), {
      workerData: connectionOptions
    });
    this.responseBuffer = new SharedArrayBuffer(RESPONSE_BYTES + 8);
    this.responseSignal = new Int32Array(this.responseBuffer, 0, 2);
    this.worker.unref();
    this.worker.on('error', () => {});
    this.query('SELECT 1 AS connected');
  }

  request(request) {
    if (this.closed) throw new Error('PostgreSQL database is closed.');
    const shared = this.responseBuffer;
    const signal = this.responseSignal;
    Atomics.store(signal, 0, 0);
    Atomics.store(signal, 1, 0);
    this.worker.postMessage({ request, shared });
    const waitResult = Atomics.wait(signal, 0, 0, this.timeoutMs);
    if (waitResult === 'timed-out') {
      this.closed = true;
      this.worker.terminate();
      throw new Error(`PostgreSQL request timed out after ${this.timeoutMs}ms.`);
    }
    const length = Atomics.load(signal, 1);
    const bytes = new Uint8Array(shared, 8, Math.max(0, length));
    const payload = JSON.parse(Buffer.from(bytes).toString('utf8') || '{}');
    if (Atomics.load(signal, 0) !== 1 || !payload.ok) throw postgresError(payload.error);
    return payload.result;
  }

  query(text, values = []) {
    const translated = translateParameters(translateSql(text), values);
    return this.request({ operation: 'query', text: translated, values });
  }

  exec(sql) {
    const text = translateSql(sql);
    if (!text) return;
    this.request({ operation: 'query', text, values: [] });
  }

  prepare(sql) {
    return {
      all: (...values) => this.query(sql, values).rows,
      get: (...values) => this.query(sql, values).rows[0],
      run: (...values) => {
        const result = this.query(sql, values);
        return { changes: result.rowCount, lastInsertRowid: null };
      }
    };
  }

  withAdvisoryLock(lockKey, callback) {
    if (typeof callback !== 'function') throw new Error('PostgreSQL advisory lock callback is required.');
    const key = normalizeAdvisoryLockKey(lockKey);
    this.query('SELECT pg_advisory_lock(?) AS locked', [key]);
    let result;
    let callbackError = null;
    try {
      result = callback();
      if (result && typeof result.then === 'function') {
        throw new Error('PostgreSQL advisory lock callbacks must be synchronous.');
      }
    } catch (error) {
      callbackError = error;
    }

    let releaseError = null;
    try {
      const released = this.query('SELECT pg_advisory_unlock(?) AS unlocked', [key]).rows[0]?.unlocked;
      if (released !== true) throw new Error('PostgreSQL advisory lock was not owned by this connection.');
    } catch (error) {
      releaseError = error;
    }
    if (callbackError) {
      if (releaseError && callbackError && typeof callbackError === 'object' && callbackError.cause === undefined) {
        callbackError.cause = releaseError;
      }
      throw callbackError;
    }
    if (releaseError) throw releaseError;
    return result;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
  }
}

module.exports = {
  PostgresSyncDatabase,
  normalizeAdvisoryLockKey,
  resolvePostgresConnectionOptions,
  translateParameters,
  translateSql
};
