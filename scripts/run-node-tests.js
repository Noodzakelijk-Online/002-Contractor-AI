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

function postgresTestFiles(testFiles = allTestFiles()) {
  return testFiles.filter(file => fs.readFileSync(path.join(projectRoot, file), 'utf8')
    .includes('CONTRACTOR_AI_POSTGRES_TEST_URL'));
}

function withTestConcurrency(args, concurrency) {
  const normalized = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--test-concurrency') {
      index += 1;
      continue;
    }
    if (argument.startsWith('--test-concurrency=')) continue;
    normalized.push(argument);
  }
  return [`--test-concurrency=${concurrency}`, ...normalized];
}

function executeTests(testArguments, runtimeDirectory) {
  return spawnSync(process.execPath, ['--test', ...testArguments], {
    cwd: projectRoot,
    env: {
      ...process.env,
      TEMP: runtimeDirectory,
      TMP: runtimeDirectory,
      TMPDIR: runtimeDirectory
    },
    stdio: 'inherit'
  });
}

function runNodeTests(args = process.argv.slice(2)) {
  const runtimeDirectory = createRuntimeDirectory();
  const hasExplicitTestFile = args.some(argument => /(?:^|[\\/])[^\\/]+\.test\.js$/i.test(argument));
  let result;
  try {
    const discovered = hasExplicitTestFile ? [] : allTestFiles();
    const sharedPostgresFiles = process.env.CONTRACTOR_AI_POSTGRES_TEST_URL && !hasExplicitTestFile
      ? postgresTestFiles(discovered)
      : [];
    if (sharedPostgresFiles.length) {
      const sharedSet = new Set(sharedPostgresFiles);
      const parallelFiles = discovered.filter(file => !sharedSet.has(file));
      console.log(`Running ${parallelFiles.length} isolated test files in parallel, then ${sharedPostgresFiles.length} shared PostgreSQL files serially.`);
      result = executeTests([...args, ...parallelFiles], runtimeDirectory);
      if (!result.error && result.status === 0) {
        result = executeTests([...withTestConcurrency(args, 1), ...sharedPostgresFiles], runtimeDirectory);
      }
    } else {
      const testArguments = hasExplicitTestFile ? args : [...args, ...discovered];
      result = executeTests(testArguments, runtimeDirectory);
    }
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

module.exports = {
  allTestFiles,
  cleanupRuntimeDirectory,
  createRuntimeDirectory,
  postgresTestFiles,
  runNodeTests,
  withTestConcurrency
};
