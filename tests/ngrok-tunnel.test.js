const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const {
  applyTunnelEnvironment,
  hasStrongOwnerAuthentication,
  ngrokForwardOptions,
  ownerAuthenticationToken,
  startTunnel,
  stopTunnel,
  waitForTunnelReadiness
} = require('../scripts/start-ngrok');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body)
  };
}

function localReadyResponse() {
  return jsonResponse({
    status: 'ready',
    checks: { configuration: 'ready', database: 'ready', evidenceStorage: 'verified' }
  });
}

function publicReadyResponse(environment, publicUrl) {
  const verified = environment.CONTRACTOR_AI_NGROK_ACTIVE === 'true';
  return jsonResponse({
    status: 'ready',
    runtime: {
      auth: { required: true },
      exposure: {
        loopbackOnly: true,
        publicOrigin: publicUrl,
        publicTunnel: verified,
        publicTunnelVerified: verified && Boolean(environment.CONTRACTOR_AI_NGROK_VERIFIED_AT),
        publicTunnelVerificationPending: !verified
      }
    }
  });
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('ngrok configuration forwards only to the local loopback server', () => {
  const options = ngrokForwardOptions({ NGROK_DOMAIN: 'contractor.example.ngrok.app', NGROK_ALLOW_CIDRS: '203.0.113.0/24' }, 3456);
  assert.equal(options.addr, 'http://127.0.0.1:3456');
  assert.equal(options.domain, 'contractor.example.ngrok.app');
  assert.deepEqual(options.ip_restriction_allow_cidrs, ['203.0.113.0/24']);
  const environment = {};
  assert.equal(applyTunnelEnvironment(environment, 'https://contractor.example.ngrok.app', 3456), 'https://contractor.example.ngrok.app');
  assert.equal(environment.CONTRACTOR_AI_BIND_HOST, '127.0.0.1');
  assert.equal(environment.CONTRACTOR_AI_TRUST_PROXY, 'loopback');
  assert.equal(environment.CONTRACTOR_AI_RUNTIME_MODE, 'local');
  assert.equal(environment.CONTRACTOR_AI_NGROK_ACTIVE, 'verifying');
  assert.equal(environment.CONTRACTOR_AI_NGROK_VERIFIED_AT, undefined);
  assert.throws(() => applyTunnelEnvironment({}, 'http://contractor.example.ngrok.app', 3456), /HTTPS/);
});

test('ngrok readiness rejects redirects, oversized bodies, and unexpected runtime boundaries', async () => {
  await assert.rejects(waitForTunnelReadiness('https://contractor-test.ngrok.app', {
    timeoutMs: 5,
    retryMs: 1,
    fetchImpl: async () => jsonResponse({ status: 'attention' }),
    validate: body => {
      if (body.status !== 'ready') throw new Error('not ready');
    }
  }), error => error.code === 'ngrok_readiness_verification_failed');

  await assert.rejects(waitForTunnelReadiness('https://contractor-test.ngrok.app', {
    timeoutMs: 5,
    retryMs: 1,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => String(300 * 1024) },
      text: async () => '{}'
    })
  }), /could not be verified/);
});

test('ngrok startup fails closed before opening a listener without owner authentication', async () => {
  let forwardCalls = 0;
  await assert.rejects(startTunnel({
    environment: { NGROK_AUTHTOKEN: 'ngrok-token-at-least-32-characters', PORT: '3000' },
    ngrok: { forward: async () => { forwardCalls += 1; } }
  }), /owner access key/);
  assert.equal(forwardCalls, 0);
  assert.equal(hasStrongOwnerAuthentication({ CONTRACTOR_AI_AUTH_TOKEN: 'short' }), false);
  assert.equal(hasStrongOwnerAuthentication({
    CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify({ owner: { token: 'structured-owner-token-at-least-32-characters' } })
  }), true);
  assert.equal(ownerAuthenticationToken({
    CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify({
      operators: [{ id: 'owner-one', role: 'owner', token: 'principal-owner-token-at-least-32-characters' }]
    })
  }), 'principal-owner-token-at-least-32-characters');
});

test('ngrok tunnel verifies local and public readiness before announcement and closes ingress first', async () => {
  const events = [];
  const environment = {
    NGROK_AUTHTOKEN: 'ngrok-token-at-least-32-characters',
    CONTRACTOR_AI_AUTH_TOKEN: 'contractor-owner-token-at-least-32-characters',
    PORT: '3210'
  };
  const listener = {
    url: () => 'https://contractor-test.ngrok.app',
    close: async () => { events.push('listener-close'); }
  };
  const app = {
    locals: {
      runtimeControl: {
        start: async options => { events.push(`server-start:${options.host}:${options.port}`); return { listening: true }; },
        shutdown: async () => { events.push('server-stop'); }
      }
    }
  };
  const runtime = await startTunnel({
    environment,
    app,
    ngrok: { forward: async () => { events.push('listener-open'); return listener; } },
    fetchImpl: async (url, options) => {
      if (url.startsWith('http://127.0.0.1:3210/')) {
        events.push('local-ready');
        return localReadyResponse();
      }
      if (!options.headers.Authorization) {
        events.push('public-denied');
        return jsonResponse({ error: { code: 'authentication_required' } }, 401);
      }
      assert.equal(options.headers.Authorization, `Bearer ${environment.CONTRACTOR_AI_AUTH_TOKEN}`);
      events.push(environment.CONTRACTOR_AI_NGROK_ACTIVE === 'true' ? 'public-verified' : 'public-pending');
      return publicReadyResponse(environment, 'https://contractor-test.ngrok.app');
    }
  });
  assert.deepEqual(events, [
    'listener-open',
    'server-start:127.0.0.1:3210',
    'local-ready',
    'public-denied',
    'public-pending',
    'public-verified'
  ]);
  assert.equal(runtime.publicUrl, 'https://contractor-test.ngrok.app');
  assert.equal(environment.CORS_ORIGINS, runtime.publicUrl);
  assert.equal(environment.CONTRACTOR_AI_NGROK_ACTIVE, 'true');
  assert.match(environment.CONTRACTOR_AI_NGROK_VERIFIED_AT, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(runtime.readiness.publicEndpoint, 'https://contractor-test.ngrok.app/api/readiness');
  await stopTunnel(runtime, 'test');
  assert.deepEqual(events.slice(-2), ['listener-close', 'server-stop']);
  assert.equal(environment.CONTRACTOR_AI_NGROK_ACTIVE, 'false');
  assert.equal(environment.CONTRACTOR_AI_NGROK_VERIFIED_AT, undefined);
  await stopTunnel(runtime, 'duplicate-stop');
  assert.equal(events.filter(event => event === 'listener-close').length, 1);
  assert.equal(events.filter(event => event === 'server-stop').length, 1);
});

test('ngrok startup closes public ingress and the loopback runtime when verification fails', async () => {
  const events = [];
  const environment = {
    NGROK_AUTHTOKEN: 'ngrok-token-at-least-32-characters',
    CONTRACTOR_AI_AUTH_TOKEN: 'contractor-owner-token-at-least-32-characters',
    PORT: '3211'
  };
  const listener = {
    url: () => 'https://contractor-failed.ngrok.app',
    close: async () => { events.push('listener-close'); }
  };
  const app = {
    locals: {
      runtimeControl: {
        start: async () => { events.push('server-start'); return { listening: true }; },
        shutdown: async () => { events.push('server-stop'); }
      }
    }
  };

  await assert.rejects(startTunnel({
    environment,
    app,
    ngrok: { forward: async () => listener },
    readinessTimeoutMs: 10,
    readinessRetryMs: 1,
    fetchImpl: async (url, options) => {
      if (url.startsWith('http://127.0.0.1:3211/')) return localReadyResponse();
      if (!options.headers.Authorization) return jsonResponse({ error: { code: 'authentication_required' } }, 401);
      return jsonResponse({ status: 'attention' }, 503);
    }
  }), error => error.code === 'ngrok_readiness_verification_failed');

  assert.deepEqual(events, ['server-start', 'listener-close', 'server-stop']);
  assert.equal(environment.CONTRACTOR_AI_NGROK_ACTIVE, 'false');
  assert.equal(environment.CONTRACTOR_AI_NGROK_VERIFIED_AT, undefined);
});

test('ngrok lifecycle verifies the real production readiness projection through the public edge', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-ngrok-runtime-'));
  const port = await reservePort();
  const publicUrl = 'https://contractor-runtime-test.ngrok.app';
  const retainedEnvironment = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: 'production',
    PORT: String(port),
    CONTRACTOR_AI_RUNTIME_MODE: 'local',
    CONTRACTOR_AI_STORAGE_MODE: 'local',
    CONTRACTOR_AI_AUTH_TOKEN: 'contractor-runtime-owner-token-at-least-32-characters',
    CONTRACTOR_AI_BACKUP_SIGNING_KEY: 'contractor-ai-ngrok-test-backup-signing-key-at-least-32-characters',
    CONTRACTOR_AI_ROLE_TOKENS: '',
    CONTRACTOR_AI_DATA_DIR: directory,
    LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
    UPLOAD_DIR: path.join(directory, 'uploads'),
    NGROK_AUTHTOKEN: 'ngrok-runtime-token-at-least-32-characters'
  });
  delete process.env.CONTRACTOR_AI_USE_STANDALONE_CONFIG;
  delete require.cache[require.resolve('../server')];
  const events = [];
  let runtime;

  t.after(async () => {
    if (runtime) await stopTunnel(runtime, 'test-cleanup').catch(() => {});
    delete require.cache[require.resolve('../server')];
    for (const key of Object.keys(process.env)) {
      if (!Object.hasOwn(retainedEnvironment, key)) delete process.env[key];
    }
    Object.assign(process.env, retainedEnvironment);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  runtime = await startTunnel({
    environment: process.env,
    ngrok: {
      forward: async options => {
        assert.equal(options.addr, `http://127.0.0.1:${port}`);
        events.push('listener-open');
        return {
          url: () => publicUrl,
          close: async () => { events.push('listener-close'); }
        };
      }
    },
    fetchImpl: async (url, options) => {
      const target = new URL(url);
      if (target.origin === publicUrl) {
        target.protocol = 'http:';
        target.hostname = '127.0.0.1';
        target.port = String(port);
      }
      return fetch(target, options);
    }
  });

  const readiness = await fetch(`http://127.0.0.1:${port}/api/readiness`, {
    headers: { Authorization: `Bearer ${process.env.CONTRACTOR_AI_AUTH_TOKEN}` }
  }).then(response => response.json());
  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.runtime.exposure.bindHost, '127.0.0.1');
  assert.equal(readiness.runtime.exposure.loopbackOnly, true);
  assert.equal(readiness.runtime.exposure.publicTunnel, true);
  assert.equal(readiness.runtime.exposure.publicTunnelVerified, true);
  assert.equal(readiness.runtime.exposure.publicTunnelVerificationPending, false);
  assert.equal(readiness.runtime.exposure.publicOrigin, publicUrl);
  assert.match(readiness.runtime.exposure.tunnelVerifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(readiness.runtime.auth.required, true);

  await stopTunnel(runtime, 'test');
  runtime = null;
  assert.equal(events.at(-1), 'listener-close');
});
