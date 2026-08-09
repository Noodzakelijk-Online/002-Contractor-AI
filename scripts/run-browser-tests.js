const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const espree = require('espree');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = path.resolve(os.tmpdir());
const viteCli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const defaultBatchSize = 4;

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

  const requestedTests = process.argv.slice(2);
  const batches = requestedTests.length
    ? [requestedTests]
    : chunkBrowserTests(discoverBrowserTests(), configuredBatchSize());
  for (let index = 0; index < batches.length; index += 1) {
    console.log(`Browser test batch ${index + 1}/${batches.length} (${batches[index].length} tests)`);
    const status = await runBrowserBatch(batches[index]);
    if (status !== 0) {
      process.exitCode = status;
      return;
    }
  }
}

function configuredBatchSize() {
  const configured = Number(process.env.CONTRACTOR_AI_BROWSER_BATCH_SIZE || defaultBatchSize);
  if (!Number.isInteger(configured) || configured < 1 || configured > 25) {
    throw new Error('CONTRACTOR_AI_BROWSER_BATCH_SIZE must be an integer from 1 through 25.');
  }
  return configured;
}

function visitAst(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'range', 'tokens', 'comments'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(item => visitAst(item, visitor));
    else visitAst(value, visitor);
  }
}

function discoverBrowserTests() {
  const directory = path.join(projectRoot, 'e2e');
  const locations = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.spec.js')) continue;
    const source = fs.readFileSync(path.join(directory, entry.name), 'utf8');
    const tree = espree.parse(source, { ecmaVersion: 'latest', sourceType: 'script', loc: true });
    visitAst(tree, node => {
      if (node.type !== 'CallExpression' || node.callee?.type !== 'Identifier' || node.callee.name !== 'test') return;
      if (node.arguments?.[0]?.type !== 'Literal' || typeof node.arguments[0].value !== 'string') return;
      locations.push(`e2e/${entry.name}:${node.loc.start.line}`);
    });
  }
  return locations.sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
}

function chunkBrowserTests(locations, batchSize) {
  const batches = [];
  for (let index = 0; index < locations.length; index += batchSize) {
    batches.push(locations.slice(index, index + batchSize));
  }
  return batches;
}

function cleanupRuntime(runtimeDirectory) {
  const resolved = path.resolve(runtimeDirectory);
  if (!resolved.startsWith(`${tempRoot}${path.sep}`) || !path.basename(resolved).startsWith('contractor-ai-browser-')) {
    throw new Error(`Refusing to remove an unexpected browser runtime directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}

async function runBrowserBatch(testLocations) {
  const runtimeDirectory = fs.mkdtempSync(path.join(tempRoot, 'contractor-ai-browser-'));
  fs.mkdirSync(path.join(runtimeDirectory, 'local'));
  fs.mkdirSync(path.join(runtimeDirectory, 'auth'));
  const localPort = await reserveFreePort();
  let authPort = await reserveFreePort();
  while (authPort === localPort) authPort = await reserveFreePort();
  let result;
  try {
    result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...testLocations], {
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
    cleanupRuntime(runtimeDirectory);
  }
  if (result.error) throw result.error;
  return Number.isInteger(result.status) ? result.status : 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { chunkBrowserTests, configuredBatchSize, discoverBrowserTests };
