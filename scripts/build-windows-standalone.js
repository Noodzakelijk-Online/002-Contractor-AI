const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const releaseRoot = path.join(root, 'release');
const target = path.join(releaseRoot, 'ContractorAI-windows-x64');
const runtimeFiles = [
  'backup-manifest.js',
  'contractor-framework-catalog.json',
  'evidence-storage.js',
  'framework-catalog.js',
  'hai-connector.js',
  'operating-ledger.js',
  'package.json',
  'package-lock.json',
  'postgres-sync-database.js',
  'postgres-sync-worker.js',
  'runtime-lock.js',
  'server.js',
  'standalone-export-hai.js',
  'standalone-launcher.js',
  'standalone-runtime.js',
  'weather-service.js',
  'scripts/export-hai-feed.js',
  'scripts/migrate-local-backup-to-hosted.js',
  'scripts/restore-local-backup.js',
  'scripts/start-ngrok.js'
];

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
}

function assertBuildHost() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('The standalone package must be built on Windows x64.');
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 22) throw new Error('The standalone package must be built with Node.js 22.x.');
}

function copyRuntimeFile(relative) {
  const source = path.join(root, relative);
  const destination = path.join(target, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function writeLaunchers() {
  const launchers = {
    'ContractorAI.cmd': '@echo off\r\ncd /d "%~dp0"\r\nruntime\\node.exe standalone-launcher.js\r\nif errorlevel 1 pause\r\n',
    'ContractorAI-Tunnel.cmd': '@echo off\r\ncd /d "%~dp0"\r\nset CONTRACTOR_AI_USE_STANDALONE_CONFIG=true\r\nruntime\\node.exe scripts\\start-ngrok.js\r\nif errorlevel 1 pause\r\n',
    'ContractorAI-Export-HAI.cmd': '@echo off\r\ncd /d "%~dp0"\r\nruntime\\node.exe standalone-export-hai.js\r\nif errorlevel 1 pause\r\n'
  };
  for (const [name, contents] of Object.entries(launchers)) fs.writeFileSync(path.join(target, name), contents, 'ascii');
}

function isReusableRuntimeLockError(error, platform = process.platform) {
  return platform === 'win32' && ['EBUSY', 'EPERM'].includes(error?.code);
}

function prepareTarget(resolvedTarget) {
  try {
    fs.rmSync(resolvedTarget, { recursive: true, force: true });
    return false;
  } catch (error) {
    const bundledNode = path.join(resolvedTarget, 'runtime', 'node.exe');
    if (!isReusableRuntimeLockError(error) || !fs.existsSync(bundledNode)) throw error;
    const version = spawnSync(bundledNode, ['--version'], { encoding: 'utf8', windowsHide: true });
    if (version.status !== 0 || version.stdout.trim() !== process.version) {
      throw new Error(`Locked packaged runtime cannot be reused; expected ${process.version}.`, { cause: error });
    }
    for (const entry of fs.readdirSync(resolvedTarget, { withFileTypes: true })) {
      const entryPath = path.join(resolvedTarget, entry.name);
      if (entry.name !== 'runtime') fs.rmSync(entryPath, { recursive: true, force: true });
    }
    for (const entry of fs.readdirSync(path.join(resolvedTarget, 'runtime'), { withFileTypes: true })) {
      if (entry.name.toLowerCase() !== 'node.exe') {
        fs.rmSync(path.join(resolvedTarget, 'runtime', entry.name), { recursive: true, force: true });
      }
    }
    return true;
  }
}

function copyProductionDependencies() {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const packageEntries = Object.entries(lock.packages || {})
    .filter(([relative, metadata]) => relative.startsWith('node_modules/') && metadata.dev !== true)
    .sort(([left], [right]) => left.split('/').length - right.split('/').length || left.localeCompare(right));
  let copied = 0;
  for (const [relative, metadata] of packageEntries) {
    const source = path.join(root, relative);
    if (!fs.existsSync(source)) {
      if (metadata.optional) continue;
      throw new Error(`Required production dependency is missing from the verified root install: ${relative}`);
    }
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true, dereference: true });
    copied += 1;
  }
  for (const dependency of Object.keys(require(path.join(root, 'package.json')).dependencies || {})) {
    if (!fs.existsSync(path.join(target, 'node_modules', ...dependency.split('/')))) {
      throw new Error(`Packaged production dependency is missing: ${dependency}`);
    }
  }
  return copied;
}

function buildWindowsStandalone() {
  assertBuildHost();
  const resolvedTarget = path.resolve(target);
  if (path.dirname(resolvedTarget) !== path.resolve(releaseRoot)) throw new Error('Refusing to replace an unexpected standalone target directory.');
  run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);
  const reusedLockedRuntime = prepareTarget(resolvedTarget);
  fs.mkdirSync(path.join(target, 'runtime'), { recursive: true });
  fs.cpSync(path.join(root, 'dist'), path.join(target, 'dist'), { recursive: true });
  for (const file of runtimeFiles) copyRuntimeFile(file);
  if (!reusedLockedRuntime) fs.copyFileSync(process.execPath, path.join(target, 'runtime', 'node.exe'));
  writeLaunchers();
  const productionDependencyCount = copyProductionDependencies();
  fs.writeFileSync(path.join(target, 'BUILD.json'), `${JSON.stringify({
    format: 'contractor-ai-windows-package/v1',
    architecture: process.arch,
    node: process.versions.node,
    version: require(path.join(root, 'package.json')).version,
    productionDependencyCount,
    builtAt: new Date().toISOString()
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ success: true, target })}\n`);
  return target;
}

if (require.main === module) {
  try { buildWindowsStandalone(); } catch (error) {
    process.stderr.write(`Windows standalone build failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { assertBuildHost, buildWindowsStandalone, copyProductionDependencies, isReusableRuntimeLockError, prepareTarget, runtimeFiles };
