const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadServerWithEnv(env = {}) {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-auth-'));
  process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
  process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
  process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');
  process.env.NODE_ENV = env.NODE_ENV || 'test';

  if (env.CONTRACTOR_AI_REQUIRE_AUTH === undefined) {
    delete process.env.CONTRACTOR_AI_REQUIRE_AUTH;
  } else {
    process.env.CONTRACTOR_AI_REQUIRE_AUTH = env.CONTRACTOR_AI_REQUIRE_AUTH;
  }

  if (env.CONTRACTOR_AI_AUTH_TOKEN === undefined) {
    delete process.env.CONTRACTOR_AI_AUTH_TOKEN;
  } else {
    process.env.CONTRACTOR_AI_AUTH_TOKEN = env.CONTRACTOR_AI_AUTH_TOKEN;
  }

  delete process.env.DASHBOARD_AUTH_TOKEN;
  delete require.cache[require.resolve('../server')];
  return require('../server');
}

async function withServer(app, run) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const body = await response.json();
  return { response, body };
}

test('production auth guard fails closed when auth is required without a strong token', async () => {
  const app = loadServerWithEnv({ NODE_ENV: 'production' });

  await withServer(app, async baseUrl => {
    const dashboard = await request(baseUrl, '/api/dashboard');
    assert.equal(dashboard.response.status, 503);
    assert.equal(dashboard.body.error.code, 'auth_not_configured');

    const health = await request(baseUrl, '/api/health');
    assert.equal(health.response.status, 200);
  });
});

test('dashboard auth guard accepts bearer, API-key, contractor token, and browser basic auth', async () => {
  const token = 'contractor-ai-test-token-32';
  const app = loadServerWithEnv({
    NODE_ENV: 'production',
    CONTRACTOR_AI_AUTH_TOKEN: token
  });

  await withServer(app, async baseUrl => {
    const denied = await request(baseUrl, '/api/dashboard');
    assert.equal(denied.response.status, 401);
    assert.equal(denied.body.error.code, 'authentication_required');
    assert.match(denied.response.headers.get('www-authenticate') || '', /Basic realm="Contractor\.AI"/);

    const bearer = await request(baseUrl, '/api/dashboard', {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(bearer.response.status, 200);

    const contractorHeader = await request(baseUrl, '/api/dashboard', {
      headers: { 'X-Contractor-AI-Token': token }
    });
    assert.equal(contractorHeader.response.status, 200);

    const apiKey = await request(baseUrl, '/api/dashboard', {
      headers: { 'X-API-Key': token }
    });
    assert.equal(apiKey.response.status, 200);

    const basicValue = Buffer.from(`contractor:${token}`).toString('base64');
    const basic = await request(baseUrl, '/api/dashboard', {
      headers: { Authorization: `Basic ${basicValue}` }
    });
    assert.equal(basic.response.status, 200);
  });
});
