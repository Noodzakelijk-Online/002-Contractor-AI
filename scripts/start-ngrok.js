const { applyStandaloneEnvironment } = require('../standalone-runtime');

function strongToken(value) {
  const token = String(value || '');
  return token.length >= 32 && token === token.trim() && !/replace-with|example/i.test(token);
}

function hasStrongOwnerAuthentication(environment = process.env) {
  if (strongToken(environment.CONTRACTOR_AI_AUTH_TOKEN || environment.DASHBOARD_AUTH_TOKEN)) return true;
  try {
    const parsed = JSON.parse(environment.CONTRACTOR_AI_ROLE_TOKENS || '{}');
    const ownerValues = parsed && !Array.isArray(parsed)
      ? (Array.isArray(parsed.owner) ? parsed.owner : [parsed.owner])
      : [];
    if (ownerValues.some(value => strongToken(typeof value === 'object' ? value?.token : value))) return true;
    const principals = Array.isArray(parsed) ? parsed : Array.isArray(parsed.operators) ? parsed.operators : [];
    return principals.some(principal => principal?.role === 'owner' && strongToken(principal.token));
  } catch {
    return false;
  }
}

function validatedPort(value) {
  const parsed = Number(value || 3000);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error('PORT must be an integer between 1 and 65535.');
  return parsed;
}

function ngrokForwardOptions(environment, port) {
  const options = {
    addr: `http://127.0.0.1:${port}`,
    authtoken_from_env: true,
    forwards_to: `contractor-ai-windows:${port}`
  };
  const domain = String(environment.NGROK_DOMAIN || '').trim();
  if (domain) options.domain = domain;
  const allowedCidrs = String(environment.NGROK_ALLOW_CIDRS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (allowedCidrs.length) options.ip_restriction_allow_cidrs = allowedCidrs;
  return options;
}

function applyTunnelEnvironment(environment, publicUrl, port) {
  const url = new URL(publicUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('ngrok did not return a valid HTTPS origin.');
  }
  Object.assign(environment, {
    NODE_ENV: 'production',
    PORT: String(port),
    CONTRACTOR_AI_RUNTIME_MODE: 'local',
    CONTRACTOR_AI_REQUIRE_AUTH: 'true',
    CONTRACTOR_AI_BIND_HOST: '127.0.0.1',
    CONTRACTOR_AI_PUBLIC_URL: url.origin,
    CONTRACTOR_AI_TRUST_PROXY: 'loopback',
    CONTRACTOR_AI_NGROK_ACTIVE: 'true',
    CORS_ORIGINS: url.origin
  });
  return url.origin;
}

async function startTunnel(options = {}) {
  const environment = options.environment || process.env;
  if (environment.CONTRACTOR_AI_USE_STANDALONE_CONFIG === 'true') applyStandaloneEnvironment({ environment });
  if (!strongToken(environment.NGROK_AUTHTOKEN)) throw new Error('NGROK_AUTHTOKEN is required and must not be a template value.');
  if (!hasStrongOwnerAuthentication(environment)) throw new Error('A strong Contractor.AI owner access key is required before public tunnel exposure.');
  const port = validatedPort(environment.PORT);
  const ngrok = options.ngrok || require('@ngrok/ngrok');
  const listener = await ngrok.forward(ngrokForwardOptions(environment, port));
  let server;
  try {
    const publicUrl = applyTunnelEnvironment(environment, listener.url(), port);
    const app = options.app || require('../server');
    server = await app.locals.runtimeControl.start({ host: '127.0.0.1', port });
    process.stdout.write(`\nContractor.AI secure tunnel: ${publicUrl}\n`);
    process.stdout.write('The ledger remains on this computer. Authentication is still required.\n\n');
    return { app, listener, publicUrl, server };
  } catch (error) {
    await listener.close().catch(() => {});
    throw error;
  }
}

async function stopTunnel(runtime, signal) {
  await runtime.app.locals.runtimeControl.shutdown({ server: runtime.server, signal });
  await runtime.listener.close().catch(() => {});
}

if (require.main === module) {
  let runtime;
  startTunnel().then(started => {
    runtime = started;
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => stopTunnel(runtime, signal)
        .then(() => { process.exitCode = 0; })
        .catch(() => { process.exitCode = 1; }));
    }
  }).catch(error => {
    process.stderr.write(`Contractor.AI tunnel could not start: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  applyTunnelEnvironment,
  hasStrongOwnerAuthentication,
  ngrokForwardOptions,
  startTunnel,
  stopTunnel,
  strongToken,
  validatedPort
};
