const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyTunnelEnvironment,
  hasStrongOwnerAuthentication,
  ngrokForwardOptions,
  startTunnel,
  stopTunnel
} = require('../scripts/start-ngrok');

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
  assert.throws(() => applyTunnelEnvironment({}, 'http://contractor.example.ngrok.app', 3456), /HTTPS/);
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
});

test('ngrok listener is established before the loopback app starts and both close cleanly', async () => {
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
    ngrok: { forward: async () => { events.push('listener-open'); return listener; } }
  });
  assert.deepEqual(events, ['listener-open', 'server-start:127.0.0.1:3210']);
  assert.equal(runtime.publicUrl, 'https://contractor-test.ngrok.app');
  assert.equal(environment.CORS_ORIGINS, runtime.publicUrl);
  await stopTunnel(runtime, 'test');
  assert.deepEqual(events.slice(-2), ['server-stop', 'listener-close']);
});
