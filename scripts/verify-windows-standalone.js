const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const packageRoot = path.join(projectRoot, 'release', 'ContractorAI-windows-x64');
const runtimeExecutable = path.join(packageRoot, 'runtime', 'node.exe');

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  assert.ok(Number.isInteger(port) && port > 0, 'Could not reserve a standalone smoke-test port.');
  return port;
}

async function requestJson(baseUrl, route, token, timeoutMs = 5_000, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      method: options.method || 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal
    });
    const text = await response.text();
    return { response, text, body: text ? JSON.parse(text) : null };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForReadiness(baseUrl, token, child, stderr, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = 'no response';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged runtime exited before readiness (${child.exitCode}): ${stderr()}`);
    }
    try {
      const result = await requestJson(baseUrl, '/api/readiness', token, 2_000);
      if (result.response.status === 200 && result.body?.status === 'ready') return result.body;
      lastFailure = `HTTP ${result.response.status}: ${result.text}`;
    } catch (error) {
      lastFailure = error.message;
    }
    await delay(250);
  }
  throw new Error(`Packaged runtime readiness timed out: ${lastFailure}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    delay(8_000).then(() => false)
  ]);
  if (!exited && child.exitCode === null) {
    child.kill('SIGKILL');
    await new Promise(resolve => child.once('exit', resolve));
  }
}

function removeFixture(directory) {
  const resolved = path.resolve(directory);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${tempRoot}${path.sep}`) || !path.basename(resolved).startsWith('contractor-ai-windows-package-')) {
    throw new Error(`Refusing to remove unexpected standalone fixture: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body)
  };
}

async function verifyPackagedTunnelLifecycle(ownerToken) {
  const packagedTunnel = require(path.join(packageRoot, 'scripts', 'start-ngrok.js'));
  const environment = {
    NGROK_AUTHTOKEN: 'packaged-ngrok-verification-token-at-least-32-characters',
    CONTRACTOR_AI_AUTH_TOKEN: ownerToken,
    PORT: '43210'
  };
  const events = [];
  const publicUrl = 'https://contractor-windows-package.ngrok.app';
  const runtime = await packagedTunnel.startTunnel({
    environment,
    app: {
      locals: {
        runtimeControl: {
          start: async options => {
            assert.deepEqual(options, { host: '127.0.0.1', port: 43210 });
            events.push('server-start');
            return { listening: true };
          },
          shutdown: async () => { events.push('server-stop'); }
        }
      }
    },
    ngrok: {
      forward: async options => {
        assert.equal(options.addr, 'http://127.0.0.1:43210');
        events.push('listener-open');
        return {
          url: () => publicUrl,
          close: async () => { events.push('listener-close'); }
        };
      }
    },
    fetchImpl: async (url, options) => {
      if (url.startsWith('http://127.0.0.1:43210/')) {
        return jsonResponse({
          status: 'ready',
          checks: { configuration: 'ready', database: 'ready', evidenceStorage: 'verified' }
        });
      }
      if (!options.headers.Authorization) {
        return jsonResponse({ error: { code: 'authentication_required' } }, 401);
      }
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
  });

  assert.equal(runtime.publicUrl, publicUrl);
  assert.equal(environment.CONTRACTOR_AI_NGROK_ACTIVE, 'true');
  assert.match(environment.CONTRACTOR_AI_NGROK_VERIFIED_AT, /^\d{4}-\d{2}-\d{2}T/);
  await packagedTunnel.stopTunnel(runtime, 'windows-package-test');
  assert.deepEqual(events, ['listener-open', 'server-start', 'listener-close', 'server-stop']);
  assert.equal(environment.CONTRACTOR_AI_NGROK_ACTIVE, 'false');
  return true;
}

async function verifyWindowsStandalone() {
  assert.equal(process.platform, 'win32', 'The Windows package smoke test must run on Windows.');
  assert.ok(fs.existsSync(runtimeExecutable), 'Build the Windows standalone package before running its smoke test.');
  const build = JSON.parse(fs.readFileSync(path.join(packageRoot, 'BUILD.json'), 'utf8'));
  assert.equal(build.format, 'contractor-ai-windows-package/v1');
  assert.match(String(build.node || ''), /^22\./, 'The packaged runtime must use Node.js 22.');

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-windows-package-'));
  const port = await reservePort();
  const ownerToken = crypto.randomBytes(32).toString('base64url');
  const configDirectory = path.join(fixtureRoot, 'config');
  const haiFeedPath = path.join(fixtureRoot, 'connected-sources', 'contractor-ai.json');
  fs.mkdirSync(configDirectory, { recursive: true });
  fs.writeFileSync(path.join(configDirectory, 'runtime.json'), `${JSON.stringify({
    format: 'contractor-ai-windows-standalone/v1',
    ownerToken,
    port,
    createdAt: new Date().toISOString()
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

  let stdout = '';
  let stderr = '';
  const child = spawn(runtimeExecutable, ['standalone-launcher.js'], {
    cwd: packageRoot,
    env: {
      ...process.env,
      CONTRACTOR_AI_STANDALONE_ROOT: fixtureRoot,
      CONTRACTOR_AI_OPEN_BROWSER: 'false',
      CONTRACTOR_AI_HAI_FEED_PATH: haiFeedPath
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stdout.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-100_000); });
  child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-100_000); });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const readiness = await waitForReadiness(baseUrl, ownerToken, child, () => stderr);
    assert.equal(readiness.ledger?.migrations?.currentVersion, '072_operator_locale_preferences');
    assert.deepEqual(readiness.ledger?.migrations?.pending, []);
    assert.ok(readiness.ledger?.migrations?.applied?.some(migration => migration.version === '071_data_subject_request_governance'));

    const operators = await requestJson(baseUrl, '/api/operations/operators', ownerToken);
    assert.equal(operators.response.status, 200);
    assert.equal(operators.body?.summary?.environment, 1);
    assert.equal(JSON.stringify(operators.body).includes(ownerToken), false);
    assert.equal(operators.body?.accounts?.some(account => Object.hasOwn(account, 'tokenHash')), false);

    const privacyRequests = await requestJson(baseUrl, '/api/operations/privacy/requests?status=all&limit=10', ownerToken);
    assert.equal(privacyRequests.response.status, 200);
    assert.deepEqual(privacyRequests.body?.requests, []);

    const capabilities = await requestJson(baseUrl, '/api/operations/capabilities', ownerToken);
    assert.equal(capabilities.response.status, 200);
    assert.equal(capabilities.body?.capabilities?.retention?.dataSubjectRequests, true);
    assert.equal(capabilities.body?.capabilities?.retention?.fullErasureClaimed, false);

    const manifest = await requestJson(baseUrl, '/api/integrations/hai/manifest', ownerToken);
    assert.equal(manifest.response.status, 200);
    assert.equal(manifest.body?.mode, 'read_only');
    assert.equal(manifest.body?.canExecute, false);
    assert.equal(manifest.body?.schema, 'accountfeed.GenericItem');
    assert.equal(manifest.body?.itemProvider, 'generic_json_feed');
    assert.equal(manifest.body?.itemType, 'document');
    assert.equal(manifest.body?.operationType, 'review_document');
    const haiStatus = await requestJson(baseUrl, '/api/integrations/hai/status', ownerToken);
    assert.equal(haiStatus.response.status, 200);
    assert.equal(haiStatus.body?.publication?.status, 'not_published');
    const haiPublication = await requestJson(baseUrl, '/api/integrations/hai/publish', ownerToken, 5_000, {
      method: 'POST',
      body: { limit: 100 }
    });
    assert.equal(haiPublication.response.status, 200);
    assert.equal(haiPublication.body?.publication?.status, 'published');
    assert.equal(haiPublication.body?.canExecute, false);
    assert.equal(haiPublication.body?.externalCommitments, 0);
    assert.ok(fs.existsSync(haiFeedPath));
    assert.equal(stdout.includes(ownerToken), false, 'A retained standalone owner key must not reappear in startup output.');
    const ngrokLifecycleVerified = await verifyPackagedTunnelLifecycle(ownerToken);

    return {
      valid: true,
      node: build.node,
      migration: readiness.ledger.migrations.currentVersion,
      pendingMigrations: readiness.ledger.migrations.pending.length,
      operatorRegisterRedacted: true,
      privacyRegisterAvailable: true,
      haiReadOnly: true,
      haiContract: manifest.body.schema,
      haiLocalFeedPublished: true,
      ngrokLifecycleVerified
    };
  } finally {
    await stopChild(child);
    removeFixture(fixtureRoot);
  }
}

if (require.main === module) {
  verifyWindowsStandalone()
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => {
      process.stderr.write(`Windows standalone smoke test failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { removeFixture, reservePort, verifyWindowsStandalone };
