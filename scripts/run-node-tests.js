const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = path.resolve(os.tmpdir());
const runtimePrefix = 'contractor-ai-node-tests-';

function createRuntimeDirectory() {
  return fs.mkdtempSync(path.join(tempRoot, runtimePrefix));
}

function cleanupRuntimeDirectory(runtimeDirectory) {
  const resolved = path.resolve(runtimeDirectory);
  if (!resolved.startsWith(`${tempRoot}${path.sep}`) || !path.basename(resolved).startsWith(runtimePrefix)) {
    throw new Error(`Refusing to remove an unexpected Node test runtime directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}

function allTestFiles() {
  return fs.readdirSync(path.join(projectRoot, 'tests'), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
    .map(entry => path.posix.join('tests', entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function runNodeTests(args = process.argv.slice(2)) {
  const runtimeDirectory = createRuntimeDirectory();
  const hasExplicitTestFile = args.some(argument => /(?:^|[\\/])[^\\/]+\.test\.js$/i.test(argument));
  const testArguments = hasExplicitTestFile ? args : [...args, ...allTestFiles()];
  let result;
  try {
    result = spawnSync(process.execPath, ['--test', ...testArguments], {
      cwd: projectRoot,
      env: {
        ...process.env,
        TEMP: runtimeDirectory,
        TMP: runtimeDirectory,
        TMPDIR: runtimeDirectory
      },
      stdio: 'inherit'
    });
  } finally {
    cleanupRuntimeDirectory(runtimeDirectory);
  }

  if (result.error) throw result.error;
  return Number.isInteger(result.status) ? result.status : 1;
}

if (require.main === module) {
  try {
    process.exitCode = runNodeTests();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = { allTestFiles, cleanupRuntimeDirectory, createRuntimeDirectory, runNodeTests };
