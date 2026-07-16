const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_PATHS = [
  'App.jsx',
  'ClientPortal.css',
  'ClientPortal.jsx',
  'Dockerfile',
  'docker-compose.hosted.yml',
  'evidence-storage.js',
  'operating-ledger.js',
  'postgres-sync-database.js',
  'postgres-sync-worker.js',
  'server.js',
  'scripts/migrate-local-backup-to-hosted.js',
  'scripts/restore-local-backup.js'
];

const RETIRED_PATHS = [
  'advanced_ai_backend',
  'contractor_ai_backend',
  'god_mode_contractor_ai',
  'autonomous-engine.js',
  'question_bank',
  'THE_VELHORST_DOSSIER_DEFINITIVE.md',
  'tmp-actioncheck4.js',
  'fn.indexOf(name)!',
  'pnpm-lock.yaml',
  'public/client-portal.html',
  'public/index.html',
  'vercel.json'
];

const REQUIRED_HOSTED_ENV_KEYS = [
  'CONTRACTOR_AI_PUBLIC_URL',
  'CONTRACTOR_AI_HOSTING_PROVIDER',
  'CONTRACTOR_AI_HOSTING_REGION',
  'CONTRACTOR_AI_DATA_RESIDENCY',
  'CONTRACTOR_AI_DPA_REFERENCE',
  'CONTRACTOR_AI_TRUST_PROXY',
  'CONTRACTOR_AI_SESSION_TTL_SECONDS',
  'CONTRACTOR_AI_LOGIN_RATE_WINDOW_MS',
  'CONTRACTOR_AI_LOGIN_RATE_LIMIT',
  'CONTRACTOR_AI_DATABASE_URL',
  'CONTRACTOR_AI_S3_ENDPOINT',
  'CONTRACTOR_AI_S3_BUCKET',
  'CONTRACTOR_AI_POSTGRES_BACKUP_MODE',
  'CONTRACTOR_AI_OBJECT_VERSIONING_ENABLED',
  'CONTRACTOR_AI_BACKUP_POLICY_REFERENCE'
];

function walkFiles(root, relative = '', unreadableDirectories = []) {
  const excluded = new Set([
    '.git', '.pytest_cache', '.vite', 'coverage', 'data', 'dist', 'node_modules',
    'playwright-report', 'storage', 'test-results', 'uploads'
  ]);
  const directory = path.join(root, relative);
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    unreadableDirectories.push(relative.replace(/\\/g, '/') || '.');
    return files;
  }
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (!excluded.has(entry.name)) files.push(...walkFiles(root, child, unreadableDirectories));
    } else if (entry.isFile()) {
      files.push(child.replace(/\\/g, '/'));
    }
  }
  return files;
}

function verifyReleaseContract(root = path.resolve(__dirname, '..')) {
  const failures = [];
  const unreadableDirectories = [];
  const sourceFiles = walkFiles(root, '', unreadableDirectories);
  const exists = relative => fs.existsSync(path.join(root, relative));
  for (const required of REQUIRED_PATHS) {
    if (!exists(required)) failures.push(`Missing canonical release path: ${required}`);
  }
  for (const retired of RETIRED_PATHS) {
    if (exists(retired)) failures.push(`Retired runtime path is still present: ${retired}`);
  }

  const forbiddenExtensions = new Set(['.db', '.py', '.sqlite', '.sqlite3']);
  for (const directory of unreadableDirectories) failures.push(`Source directory is not readable: ${directory}`);
  for (const file of sourceFiles) {
    if (forbiddenExtensions.has(path.extname(file).toLowerCase())) {
      failures.push(`Generated or prototype runtime file is present: ${file}`);
    }
  }

  const packageFile = path.join(root, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  if (packageJson.main !== 'server.js') failures.push('package.json must use server.js as the sole runtime entrypoint.');
  for (const script of ['build', 'lint', 'migrate:hosted', 'restore:local', 'test', 'test:browser', 'verify:release']) {
    if (!packageJson.scripts?.[script]) failures.push(`package.json is missing required script: ${script}`);
  }

  const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const liveFacade of ["app.get('/api/dashboard'", "app.post('/api/upload'"]) {
    if (serverSource.includes(liveFacade)) failures.push(`Live non-ledger facade is still present: ${liveFacade}`);
  }
  for (const canonicalRoute of [
    "app.get('/api/ledger/dashboard'",
    "app.get('/api/ledger/schedule'",
    "app.post('/api/ledger/upload'",
    "app.post('/api/ledger/jobs/:id/daily-logs'",
    "app.post('/api/ledger/jobs/:id/controlled-document-revisions'",
    "app.post('/api/ledger/jobs/:id/supplier-invoices'",
    "app.post('/api/ledger/jobs/:id/supplier-invoices/:supplierInvoiceId/payments'",
    "app.post('/api/auth/login'",
    "app.post('/api/auth/logout'",
    "app.get('/api/session'",
    "app.post('/api/operations/exports/validate'",
    "app.post('/api/operations/restore/validate'"
  ]) {
    if (!serverSource.includes(canonicalRoute)) failures.push(`Canonical ledger route is missing: ${canonicalRoute}`);
  }

  const hostedEnvironment = fs.readFileSync(path.join(root, '.env.hosted.example'), 'utf8');
  for (const key of REQUIRED_HOSTED_ENV_KEYS) {
    if (!new RegExp(`^${key}=`, 'm').test(hostedEnvironment)) failures.push(`Hosted environment contract is missing: ${key}`);
  }

  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  if (!/^USER node$/m.test(dockerfile)) failures.push('Docker runtime must run as the node user.');
  if (!/^HEALTHCHECK\b/m.test(dockerfile)) failures.push('Docker runtime must define a readiness healthcheck.');

  const hostedCompose = fs.readFileSync(path.join(root, 'docker-compose.hosted.yml'), 'utf8');
  for (const requirement of [
    /127\.0\.0\.1:/,
    /read_only:\s*true/,
    /cap_drop:\s*\n\s*- ALL/,
    /no-new-privileges:true/
  ]) {
    if (!requirement.test(hostedCompose)) failures.push(`Hosted Compose is missing release hardening: ${requirement}`);
  }

  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'verify.yml'), 'utf8');
  for (const command of ['npm run verify:release', 'npm run lint', 'npm test', 'npm run build', 'npm run test:browser']) {
    if (!workflow.includes(command)) failures.push(`CI workflow is missing required gate: ${command}`);
  }
  if (!/push:\s*\n\s+branches:\s*\n\s+- main/.test(workflow)) {
    failures.push('CI push verification must be limited to main so pull request branches do not run duplicate suites.');
  }
  if (!/CONTRACTOR_AI_POSTGRES_TEST_URL:.*sslmode=require/.test(workflow)) {
    failures.push('CI PostgreSQL contract must run with sslmode=require.');
  }
  if (!workflow.includes("SHOW ssl")) failures.push('CI workflow must verify PostgreSQL TLS is active.');

  return {
    valid: failures.length === 0,
    failures,
    checks: {
      canonicalPaths: REQUIRED_PATHS.length,
      retiredPaths: RETIRED_PATHS.length,
      hostedEnvironmentKeys: REQUIRED_HOSTED_ENV_KEYS.length,
      sourceFiles: sourceFiles.length
    }
  };
}

if (require.main === module) {
  const result = verifyReleaseContract();
  if (!result.valid) {
    for (const failure of result.failures) process.stderr.write(`${failure}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

module.exports = { verifyReleaseContract, walkFiles };
