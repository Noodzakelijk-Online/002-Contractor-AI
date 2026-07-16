const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = path.resolve(os.tmpdir());
const viteCli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(error => {
        if (error) reject(error);
        else if (!port) reject(new Error('Could not allocate a browser test port.'));
        else resolve(port);
      });
    });
  });
}

async function main() {
  // Exercise the same production bundle that Express serves to operators.
  const buildResult = spawnSync(process.execPath, [viteCli, 'build'], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit'
  });
  if (buildResult.error) throw buildResult.error;
  if (buildResult.status !== 0) process.exit(Number.isInteger(buildResult.status) ? buildResult.status : 1);

  const runtimeDirectory = fs.mkdtempSync(path.join(tempRoot, 'contractor-ai-browser-'));
  fs.mkdirSync(path.join(runtimeDirectory, 'local'));
  fs.mkdirSync(path.join(runtimeDirectory, 'auth'));
  const localPort = await reserveFreePort();
  let authPort = await reserveFreePort();
  while (authPort === localPort) authPort = await reserveFreePort();

  function cleanupRuntime() {
    const resolved = path.resolve(runtimeDirectory);
    if (!resolved.startsWith(`${tempRoot}${path.sep}`) || !path.basename(resolved).startsWith('contractor-ai-browser-')) {
      throw new Error(`Refusing to remove an unexpected browser runtime directory: ${resolved}`);
    }
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }

  let result;
  try {
    result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)], {
      cwd: projectRoot,
      env: {
        ...process.env,
        CONTRACTOR_AI_BROWSER_RUNTIME_DIR: runtimeDirectory,
        CONTRACTOR_AI_BROWSER_LOCAL_PORT: String(localPort),
        CONTRACTOR_AI_BROWSER_AUTH_PORT: String(authPort)
      },
      stdio: 'inherit'
    });
  } finally {
    cleanupRuntime();
  }

  if (result.error) throw result.error;
  process.exitCode = Number.isInteger(result.status) ? result.status : 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
