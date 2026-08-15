const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const imageTag = `contractor-ai-runtime-smoke:${runId}`;
const containerName = `contractor-ai-runtime-smoke-${runId}`;
const volumeName = `contractor-ai-runtime-smoke-${runId}`;
const authToken = `container-smoke-owner-${crypto.randomBytes(24).toString('hex')}`;

let imageCreated = false;
let volumeCreated = false;
let containerCreated = false;

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: projectRoot,
    encoding: options.inherit ? undefined : 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs || 15 * 60 * 1000
  });
  if (result.error) {
    if (options.allowFailure) return { status: null, stdout: '', stderr: result.error.message };
    throw result.error;
  }
  const output = {
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim()
  };
  if (result.status !== 0 && !options.allowFailure) {
    const detail = output.stderr || output.stdout || `exit status ${result.status}`;
    throw new Error(`Docker command failed: docker ${args.slice(0, 2).join(' ')}\n${detail}`);
  }
  return output;
}

function inspectContainer() {
  const result = docker(['inspect', containerName]);
  const parsed = JSON.parse(result.stdout);
  assert.equal(Array.isArray(parsed), true, 'Docker inspect must return a container array.');
  assert.equal(parsed.length, 1, 'Docker inspect must return exactly one smoke container.');
  return parsed[0];
}

function mappedPort() {
  const result = docker(['port', containerName, '3000/tcp']);
  const match = result.stdout.match(/:(\d+)\s*$/m);
  assert.ok(match, `Docker did not publish the application port on loopback: ${result.stdout}`);
  const port = Number(match[1]);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535, 'Docker returned an invalid host port.');
  return port;
}

async function request(baseUrl, route, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 5_000);
  try {
    const response = await fetch(`${baseUrl}${route}`, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { response, body, text };
  } finally {
    clearTimeout(timeout);
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForReady(baseUrl, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = 'no response';
  while (Date.now() < deadline) {
    const inspected = inspectContainer();
    if (inspected.State?.Status === 'exited' || inspected.State?.Status === 'dead') {
      throw new Error(`Container stopped before readiness (exit ${inspected.State.ExitCode}).`);
    }
    try {
      const ready = await request(baseUrl, '/api/health/ready');
      if (ready.response.status === 200 && ready.body?.status === 'ready') return ready;
      lastFailure = `HTTP ${ready.response.status}: ${ready.text}`;
    } catch (error) {
      lastFailure = error.message;
    }
    await delay(500);
  }
  throw new Error(`Container readiness timed out: ${lastFailure}`);
}

async function waitForDockerHealth(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'missing';
  while (Date.now() < deadline) {
    const inspected = inspectContainer();
    if (inspected.State?.Status === 'exited' || inspected.State?.Status === 'dead') {
      throw new Error(`Container stopped while waiting for Docker health (exit ${inspected.State.ExitCode}).`);
    }
    lastStatus = inspected.State?.Health?.Status || 'missing';
    if (lastStatus === 'healthy') return;
    if (lastStatus === 'unhealthy') throw new Error('Docker marked the Contractor.AI container unhealthy.');
    await delay(1_000);
  }
  throw new Error(`Docker health did not become healthy; last status: ${lastStatus}.`);
}

function assertHardenedContainer(inspected) {
  assert.equal(inspected.Config?.User, 'node', 'The production image must declare the non-root node user.');
  assert.equal(inspected.HostConfig?.ReadonlyRootfs, true, 'The production root filesystem must be read-only.');
  assert.equal(inspected.HostConfig?.Init, true, 'The container must use an init process for signal forwarding.');
  assert.ok(inspected.HostConfig?.CapDrop?.map(value => value.toUpperCase()).includes('ALL'), 'All Linux capabilities must be dropped.');
  assert.ok(inspected.HostConfig?.SecurityOpt?.some(value => value.startsWith('no-new-privileges')), 'Privilege escalation must be disabled.');
  assert.ok(inspected.HostConfig?.Tmpfs?.['/tmp'], 'The read-only runtime must have a bounded writable /tmp mount.');
  assert.ok(
    inspected.Mounts?.some(mount => mount.Type === 'volume' && mount.Name === volumeName && mount.Destination === '/var/lib/contractor-ai'),
    'The ledger and evidence path must use the dedicated durable volume.'
  );
  const portBinding = inspected.HostConfig?.PortBindings?.['3000/tcp']?.[0];
  assert.equal(portBinding?.HostIp, '127.0.0.1', 'The application port must bind to loopback only.');
  const uid = docker(['exec', containerName, 'id', '-u']).stdout;
  assert.notEqual(uid, '0', 'The running application process must not be root.');
}

async function verifyApplication(baseUrl) {
  const shell = await request(baseUrl, '/');
  assert.equal(shell.response.status, 200, 'The production React shell must be served.');
  assert.match(shell.response.headers.get('content-type') || '', /^text\/html\b/i);
  assert.match(shell.text, /<div id="root"><\/div>/, 'The production shell must contain the React root.');
  assert.match(shell.response.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.doesNotMatch(shell.text, new RegExp(authToken), 'The access key must never enter the rendered shell.');

  const denied = await request(baseUrl, '/api/readiness');
  assert.equal(denied.response.status, 401, 'Detailed readiness must reject unauthenticated callers.');
  assert.equal(denied.body?.error?.code, 'authentication_required');

  const login = await request(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: authToken })
  });
  assert.equal(login.response.status, 200, `Production login failed: ${login.text}`);
  assert.equal(login.body?.authenticated, true);
  assert.equal(login.body?.role, 'owner');
  const setCookie = login.response.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';', 1)[0];
  assert.match(cookie, /^contractor_ai_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Secure/i);
  assert.doesNotMatch(setCookie, new RegExp(authToken));

  const session = await request(baseUrl, '/api/session', { headers: { Cookie: cookie } });
  assert.equal(session.response.status, 200);
  assert.equal(session.body?.authentication?.authenticated, true);
  assert.equal(session.body?.authentication?.method, 'session');
  assert.equal(session.body?.operator?.role, 'owner');

  const detailed = await request(baseUrl, '/api/readiness', { headers: { Cookie: cookie } });
  assert.equal(detailed.response.status, 200, `Authenticated readiness failed: ${detailed.text}`);
  assert.equal(detailed.body?.status, 'ready');
  assert.equal(detailed.body?.runtime?.mode, 'local');
  assert.equal(detailed.body?.runtime?.storageMode, 'local');
  assert.equal(detailed.body?.runtime?.databaseMode, 'sqlite');
  assert.equal(detailed.body?.runtime?.auth?.required, true);
  assert.equal(detailed.body?.runtime?.evidenceStorage?.verified, true);
  assert.equal(detailed.body?.ledger?.valid, true);
  assert.equal(detailed.body?.ledger?.auditIntegrity?.valid, true);
  assert.deepEqual(detailed.body?.ledger?.migrations?.pending, []);
  assert.ok(detailed.body?.ledger?.migrations?.currentVersion, 'The migrated ledger version must be reported.');

  const dashboard = await request(baseUrl, '/api/ledger/dashboard', { headers: { Cookie: cookie } });
  assert.equal(dashboard.response.status, 200, 'The authenticated ledger dashboard must be reachable.');
  return { cookie, migration: detailed.body.ledger.migrations.currentVersion };
}

function stopContainer() {
  docker(['stop', '--time', '15', containerName], { timeoutMs: 30_000 });
  const inspected = inspectContainer();
  assert.equal(inspected.State?.Status, 'exited', 'The container must stop after SIGTERM.');
  assert.equal(inspected.State?.ExitCode, 0, 'The application must shut down cleanly.');
}

function cleanup() {
  if (containerCreated) docker(['rm', '--force', containerName], { allowFailure: true, timeoutMs: 30_000 });
  if (volumeCreated) docker(['volume', 'rm', '--force', volumeName], { allowFailure: true, timeoutMs: 30_000 });
  if (imageCreated) docker(['image', 'rm', '--force', imageTag], { allowFailure: true, timeoutMs: 60_000 });
}

async function main() {
  docker(['version', '--format', '{{.Server.Version}}']);
  process.stdout.write(`Building production image ${imageTag}\n`);
  docker(['build', '--tag', imageTag, '.'], { inherit: true });
  imageCreated = true;
  docker(['volume', 'create', '--label', `contractor-ai.smoke=${runId}`, volumeName]);
  volumeCreated = true;
  docker([
    'run', '--detach',
    '--name', containerName,
    '--label', `contractor-ai.smoke=${runId}`,
    '--init',
    '--read-only',
    '--tmpfs', '/tmp:size=64m,mode=1777',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '--mount', `type=volume,source=${volumeName},target=/var/lib/contractor-ai`,
    '--publish', '127.0.0.1::3000',
    '--env', 'NODE_ENV=production',
    '--env', 'CONTRACTOR_AI_RUNTIME_MODE=local',
    '--env', 'CONTRACTOR_AI_STORAGE_MODE=local',
    '--env', 'CONTRACTOR_AI_REQUIRE_AUTH=true',
    '--env', `CONTRACTOR_AI_AUTH_TOKEN=${authToken}`,
    '--env', 'CONTRACTOR_AI_BACKUP_SIGNING_KEY=contractor-ai-container-test-backup-signing-key-at-least-32-characters',
    '--env', 'CONTRACTOR_AI_AUTONOMOUS_SCHEDULER_ENABLED=false',
    imageTag
  ]);
  containerCreated = true;

  const inspected = inspectContainer();
  assertHardenedContainer(inspected);
  const baseUrl = `http://127.0.0.1:${mappedPort()}`;
  const publicReady = await waitForReady(baseUrl);
  assert.equal(publicReady.body?.checks?.configuration, 'ready');
  assert.equal(publicReady.body?.checks?.database, 'ready');
  assert.equal(publicReady.body?.checks?.evidenceStorage, 'verified');
  const firstRuntime = await verifyApplication(baseUrl);
  await waitForDockerHealth();

  stopContainer();
  docker(['start', containerName]);
  const restartedBaseUrl = `http://127.0.0.1:${mappedPort()}`;
  await waitForReady(restartedBaseUrl);
  const persistedSession = await request(restartedBaseUrl, '/api/session', { headers: { Cookie: firstRuntime.cookie } });
  assert.equal(persistedSession.response.status, 200);
  assert.equal(persistedSession.body?.authentication?.authenticated, true, 'The retained operator session must survive a container restart.');
  const persistedReadiness = await request(restartedBaseUrl, '/api/readiness', { headers: { Cookie: firstRuntime.cookie } });
  assert.equal(persistedReadiness.response.status, 200);
  assert.equal(persistedReadiness.body?.ledger?.migrations?.currentVersion, firstRuntime.migration);
  assert.equal(persistedReadiness.body?.ledger?.auditIntegrity?.valid, true);
  stopContainer();

  process.stdout.write(`${JSON.stringify({
    valid: true,
    image: imageTag,
    runtime: {
      nonRoot: true,
      readOnly: true,
      loopbackOnly: true,
      authentication: 'session',
      database: 'sqlite-volume',
      restartPersistence: true,
      gracefulShutdown: true,
      migration: firstRuntime.migration
    }
  })}\n`);
}

main()
  .catch(error => {
    if (containerCreated) {
      const logs = docker(['logs', '--tail', '200', containerName], { allowFailure: true, timeoutMs: 30_000 });
      if (logs.stdout) process.stderr.write(`\nContainer stdout:\n${logs.stdout}\n`);
      if (logs.stderr) process.stderr.write(`\nContainer stderr:\n${logs.stderr}\n`);
    }
    console.error(error);
    process.exitCode = 1;
  })
  .finally(cleanup);
