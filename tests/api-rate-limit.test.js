const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

function loadServer(options = {}) {
  const stateDirectory = options.stateDirectory || fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-api-rate-'));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    CONTRACTOR_AI_RUNTIME_MODE: 'local',
    CONTRACTOR_AI_STORAGE_MODE: 'local',
    CONTRACTOR_AI_REQUIRE_AUTH: 'false',
    CONTRACTOR_AI_RATE_LIMIT: String(options.limit || 50),
    CONTRACTOR_AI_RATE_WINDOW_MS: String(options.windowMs || 900_000),
    CONTRACTOR_AI_RATE_BUCKET_LIMIT: String(options.bucketCount || 100),
    STATE_FILE: path.join(stateDirectory, 'state.json'),
    LEDGER_DB_FILE: path.join(stateDirectory, 'ledger.sqlite'),
    UPLOAD_DIR: path.join(stateDirectory, 'uploads')
  });
  delete process.env.CONTRACTOR_AI_AUTH_TOKEN;
  delete process.env.CONTRACTOR_AI_ROLE_TOKENS;
  delete process.env.CONTRACTOR_AI_DATABASE_URL;
  if (options.trustedProxy) process.env.CONTRACTOR_AI_TRUST_PROXY = options.trustedProxy;
  else delete process.env.CONTRACTOR_AI_TRUST_PROXY;
  delete require.cache[require.resolve('../server')];
  return { app: require('../server'), stateDirectory };
}

async function withServer(app, run) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await app.locals.runtimeControl.shutdown({ server, signal: 'api_rate_limit_test' });
  }
}

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const body = await response.json();
  return { response, body };
}

test('API request quota survives a local server restart and keeps readiness available', async t => {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-api-rate-restart-'));
  t.after(() => fs.rmSync(stateDirectory, { recursive: true, force: true }));

  const first = loadServer({ stateDirectory, limit: 50 });
  await withServer(first.app, async baseUrl => {
    for (let attempt = 1; attempt <= 25; attempt += 1) {
      const result = await request(baseUrl, '/api/not-a-route');
      assert.equal(result.response.status, 404);
      assert.equal(result.response.headers.get('ratelimit-remaining'), String(50 - attempt));
    }
  });

  const restarted = loadServer({ stateDirectory, limit: 50 });
  await withServer(restarted.app, async baseUrl => {
    for (let attempt = 26; attempt <= 50; attempt += 1) {
      const result = await request(baseUrl, '/api/not-a-route');
      assert.equal(result.response.status, 404);
      assert.equal(result.response.headers.get('ratelimit-remaining'), String(50 - attempt));
    }
    const throttled = await request(baseUrl, '/api/not-a-route');
    assert.equal(throttled.response.status, 429);
    assert.equal(throttled.body.error.code, 'rate_limited');
    assert.equal(throttled.response.headers.get('ratelimit-remaining'), '0');
    assert.ok(Number(throttled.response.headers.get('retry-after')) > 0);

    const readiness = await request(baseUrl, '/api/health/ready');
    assert.equal(readiness.response.status, 200);
    assert.equal(readiness.body.status, 'ready');
    assert.equal(readiness.response.headers.get('ratelimit-limit'), null);
  });
});

test('HMAC bucket assignment bounds retained API limiter cardinality', async t => {
  const loaded = loadServer({ limit: 1_000, bucketCount: 100, trustedProxy: 'loopback' });
  t.after(() => fs.rmSync(loaded.stateDirectory, { recursive: true, force: true }));
  await withServer(loaded.app, async baseUrl => {
    for (let client = 1; client <= 140; client += 1) {
      const response = await request(baseUrl, '/api/not-a-route', {
        headers: { 'X-Forwarded-For': `198.51.100.${(client % 250) + 1}` }
      });
      assert.equal(response.response.status, 404);
    }
  });

  const database = new DatabaseSync(path.join(loaded.stateDirectory, 'ledger.sqlite'), { readOnly: true });
  try {
    const rows = database.prepare('SELECT key_hash FROM api_rate_limits').all();
    assert.ok(rows.length > 1);
    assert.ok(rows.length <= 100);
    assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.key_hash)));
    assert.equal(JSON.stringify(rows).includes('198.51.100'), false);
  } finally {
    database.close();
  }
});
