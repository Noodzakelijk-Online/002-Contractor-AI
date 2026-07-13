const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const childScript = String.raw`
const app = require('./server');
let failed = false;
const server = app.listen(0, '127.0.0.1', async () => {
  try {
    const baseUrl = 'http://127.0.0.1:' + server.address().port;
    const statuses = [];
    let finalHeaders = {};
    for (let index = 1; index <= 51; index += 1) {
      const forwardedFor = process.env.TEST_PATTERN === 'fixed_chain'
        ? '203.0.113.' + index + ', 198.51.100.77'
        : '203.0.113.' + index;
      const response = await fetch(baseUrl + '/api/session', {
        headers: { 'X-Forwarded-For': forwardedFor }
      });
      statuses.push(response.status);
      if (index === 51) {
        finalHeaders = {
          requestId: response.headers.get('x-request-id'),
          limit: response.headers.get('ratelimit-limit'),
          remaining: response.headers.get('ratelimit-remaining'),
          reset: response.headers.get('ratelimit-reset'),
          policy: response.headers.get('ratelimit-policy'),
          retryAfter: response.headers.get('retry-after')
        };
      }
      await response.arrayBuffer();
    }
    process.stdout.write('__PROXY_RESULT__' + JSON.stringify({ statuses, finalHeaders }) + '\n');
  } catch (error) {
    failed = true;
    process.stderr.write(String(error?.stack || error) + '\n');
  } finally {
    server.close(() => process.exit(failed ? 1 : 0));
  }
});
`;

function runProxyScenario({ trustedProxy = '', pattern = 'unique' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-proxy-security-'));
  try {
    const result = childProcess.spawnSync(process.execPath, ['-e', childScript], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CONTRACTOR_AI_RUNTIME_MODE: 'local',
        CONTRACTOR_AI_STORAGE_MODE: 'local',
        CONTRACTOR_AI_TRUST_PROXY: trustedProxy,
        CONTRACTOR_AI_RATE_WINDOW_MS: '60000',
        CONTRACTOR_AI_RATE_LIMIT: '50',
        CONTRACTOR_AI_RATE_BUCKET_LIMIT: '100',
        CONTRACTOR_AI_AUTONOMOUS_SCHEDULER_ENABLED: 'false',
        CONTRACTOR_AI_REQUIRE_AUTH: 'false',
        CONTRACTOR_AI_AUTH_TOKEN: '',
        CONTRACTOR_AI_ROLE_TOKENS: '',
        TEST_PATTERN: pattern,
        STATE_FILE: path.join(directory, 'state.json'),
        LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
        UPLOAD_DIR: path.join(directory, 'uploads')
      }
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('__PROXY_RESULT__'));
    assert.ok(line, result.stdout);
    return JSON.parse(line.slice('__PROXY_RESULT__'.length));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('forwarded client addresses are ignored unless an explicit proxy is trusted', () => {
  const result = runProxyScenario();
  assert.equal(result.statuses.filter(status => status === 200).length, 50);
  assert.equal(result.statuses.at(-1), 429);
  assert.ok(result.finalHeaders.requestId);
  assert.equal(result.finalHeaders.limit, '50');
  assert.equal(result.finalHeaders.remaining, '0');
  assert.match(result.finalHeaders.policy, /^50;w=60$/);
  assert.ok(Number(result.finalHeaders.reset) >= 1);
  assert.ok(Number(result.finalHeaders.retryAfter) >= 1);
});

test('a trusted loopback ingress separates genuine forwarded client addresses', () => {
  const result = runProxyScenario({ trustedProxy: 'loopback' });
  assert.ok(result.statuses.every(status => status === 200));
  assert.equal(result.finalHeaders.remaining, '49');
  assert.equal(result.finalHeaders.retryAfter, null);
});

test('a trusted ingress ignores spoofed leftmost addresses beyond the first untrusted hop', () => {
  const result = runProxyScenario({ trustedProxy: 'loopback', pattern: 'fixed_chain' });
  assert.equal(result.statuses.filter(status => status === 200).length, 50);
  assert.equal(result.statuses.at(-1), 429);
  assert.ok(result.finalHeaders.requestId);
  assert.ok(Number(result.finalHeaders.retryAfter) >= 1);
});
