const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_PATHS = [
  '.dockerignore',
  'App.jsx',
  'ClientPortal.css',
  'ClientPortal.jsx',
  'components/CashFlowForecastControl.jsx',
  'components/BidDecisionControl.jsx',
  'components/MarketFitControl.jsx',
  'components/PerformanceScorecard.jsx',
  'Dockerfile',
  'docker-compose.hosted.yml',
  'evidence-storage.js',
  'operating-ledger.js',
  'postgres-sync-database.js',
  'postgres-sync-worker.js',
  'server.js',
  'scripts/migrate-local-backup-to-hosted.js',
  'scripts/restore-local-backup.js',
  'scripts/run-node-tests.js',
  'scripts/verify-container-runtime.js'
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
  for (const script of ['build', 'lint', 'migrate:hosted', 'restore:local', 'test', 'test:browser', 'test:container', 'verify:release']) {
    if (!packageJson.scripts?.[script]) failures.push(`package.json is missing required script: ${script}`);
  }
  for (const script of ['pretest', 'test']) {
    if (!packageJson.scripts?.[script]?.startsWith('node scripts/run-node-tests.js ')) {
      failures.push(`package.json ${script} must isolate and clean temporary Node test state.`);
    }
  }

  const nodeTestRunner = fs.readFileSync(path.join(root, 'scripts', 'run-node-tests.js'), 'utf8');
  for (const cleanupRequirement of ['fs.mkdtempSync', 'TEMP: runtimeDirectory', 'TMP: runtimeDirectory', 'TMPDIR: runtimeDirectory', 'cleanupRuntimeDirectory(runtimeDirectory)']) {
    if (!nodeTestRunner.includes(cleanupRequirement)) failures.push(`Node test runner is missing temporary-state cleanup: ${cleanupRequirement}`);
  }

  const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const liveFacade of ["app.get('/api/dashboard'", "app.post('/api/upload'"]) {
    if (serverSource.includes(liveFacade)) failures.push(`Live non-ledger facade is still present: ${liveFacade}`);
  }
  for (const canonicalRoute of [
    "app.get('/api/ledger/dashboard'",
    "app.get('/api/ledger/schedule'",
    "app.get('/api/ledger/cash-flow'",
    "app.post('/api/ledger/cash-flow/items'",
    "app.post('/api/ledger/cash-flow/items/:itemId/archive'",
    "app.post('/api/ledger/cash-flow/snapshots'",
    "app.get('/api/ledger/performance-scorecard'",
    "app.post('/api/ledger/performance-scorecard/targets'",
    "app.post('/api/ledger/performance-scorecard/snapshots'",
    "app.get('/api/ledger/market-fit'",
    "app.post('/api/ledger/market-fit/profiles'",
    "app.post('/api/ledger/opportunities/:id/market-fit-assessments'",
    "app.get('/api/ledger/bid-decisions'",
    "app.post('/api/ledger/bid-decisions/policies'",
    "app.post('/api/ledger/opportunities/:id/bid-decisions'",
    "app.get('/api/ledger/estimate-rates'",
    "app.post('/api/ledger/estimate-rates/policies'",
    "app.get('/api/ledger/bid-packages'",
    "app.post('/api/ledger/bid-packages/:id/commitment'",
    "app.post('/api/ledger/jobs/:id/purchase-orders/:purchaseOrderId/issue-package'",
    "app.post('/api/ledger/communications/:id/delivery-receipt'",
    "app.post('/api/ledger/jobs/:id/takeoffs'",
    "app.post('/api/ledger/jobs/:id/takeoffs/:takeoffId/items/:itemId/rate-build-up'",
    "app.post('/api/ledger/jobs/:id/takeoffs/:takeoffId/convert'",
    "app.get('/api/ledger/jobs/:id/risk-register'",
    "app.post('/api/ledger/jobs/:id/risk-register/revisions'",
    "app.post('/api/ledger/jobs/:id/change-orders'",
    "app.post('/api/ledger/jobs/:id/change-orders/:changeOrderId/issue-package'",
    "app.get('/api/client-portal/:token/change-orders/:changeOrderId/package'",
    "app.post('/api/client-portal/:token/change-orders/:changeOrderId/responses'",
    "app.get('/api/ledger/jobs/:id/pricing-basis'",
    "app.post('/api/ledger/jobs/:id/pricing-decisions'",
    "app.post('/api/ledger/upload'",
    "app.post('/api/ledger/opportunities/:id/site-surveys'",
    "app.post('/api/ledger/opportunities/:id/site-surveys/:surveyId/submissions'",
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
  const ledgerSource = fs.readFileSync(path.join(root, 'operating-ledger.js'), 'utf8');
  if (!ledgerSource.includes("version: '048_thirteen_week_cash_flow_forecast'")) {
    failures.push('Canonical cash-flow forecast migration is missing.');
  }
  if (!ledgerSource.includes("version: '049_contractor_balanced_scorecard'")) {
    failures.push('Canonical Contractor Balanced Scorecard migration is missing.');
  }
  if (!ledgerSource.includes("version: '050_governed_market_fit'")) {
    failures.push('Canonical governed market-fit migration is missing.');
  }
  if (!ledgerSource.includes("version: '051_governed_bid_decisions'")) {
    failures.push('Canonical governed bid/no-bid migration is missing.');
  }
  if (!ledgerSource.includes("version: '052_governed_site_surveys'")) {
    failures.push('Canonical governed site-survey migration is missing.');
  }
  if (!ledgerSource.includes("version: '053_work_breakdown_takeoffs'")) {
    failures.push('Canonical WBS takeoff migration is missing.');
  }
  if (!ledgerSource.includes("version: '054_estimate_rate_buildups'")) {
    failures.push('Canonical estimating rate build-up migration is missing.');
  }
  if (!ledgerSource.includes("version: '055_pricing_basis_decisions'")) {
    failures.push('Canonical pricing-basis decision migration is missing.');
  }
  if (!ledgerSource.includes("version: '056_commercial_scope_revisions'")) {
    failures.push('Canonical commercial-scope revision migration is missing.');
  }
  if (!ledgerSource.includes("version: '057_governed_risk_register'")) {
    failures.push('Canonical governed risk-register migration is missing.');
  }
  if (!ledgerSource.includes("version: '058_formal_variation_control'")) {
    failures.push('Canonical formal-variation control migration is missing.');
  }
  if (!ledgerSource.includes("version: '059_crew_capacity_lookahead'")) {
    failures.push('Canonical crew-capacity and two-week look-ahead migration is missing.');
  }
  if (!serverSource.includes("takeoffWorkBreakdown: 'validated_wbs_codes_and_server_rollups'")) {
    failures.push('Quantity takeoff capability does not declare validated WBS rollups.');
  }
  if (!serverSource.includes("takeoffEstimateTrace: 'snapshot_and_work_breakdown_hash'")) {
    failures.push('Quantity takeoff capability does not bind estimates to the WBS hash.');
  }
  if (!serverSource.includes("unitRateBuildUp: 'active_policy_source_bound_exact_replay'")) {
    failures.push('Unit-rate capability does not declare active-policy source binding and exact replay.');
  }
  if (!serverSource.includes("unitRateCommercialEffect: 'draft_takeoff_only'")) {
    failures.push('Unit-rate capability does not constrain commercial mutation to draft takeoffs.');
  }
  if (!serverSource.includes("buildUpIntegrity: 'retained_policy_hash_and_sha256'")) {
    failures.push('Unit-rate capability does not bind build-ups to the retained policy hash.');
  }
  if (!serverSource.includes("quotePricingBasisApproval: 'source_current_required'")) {
    failures.push('Quote approval does not declare current pricing-basis source enforcement.');
  }
  if (!serverSource.includes("framework: 'fixed_price_versus_time_and_materials_decision_tree'")) {
    failures.push('Pricing-basis capability does not declare its deterministic decision-tree framework.');
  }
  if (!serverSource.includes("framework: 'written_scope_assumptions_exclusions_allowances'")) {
    failures.push('Commercial-scope capability does not declare its structured written-scope framework.');
  }
  if (!serverSource.includes("quoteCommercialScopeApproval: 'source_current_required'")) {
    failures.push('Quote approval does not declare current commercial-scope source enforcement.');
  }
  if (!serverSource.includes("framework: 'project_risk_register_and_premortem'")) {
    failures.push('Risk-management capability does not declare its project risk-register and premortem framework.');
  }
  if (!serverSource.includes("quoteRiskRegisterApproval: 'source_current_required'")) {
    failures.push('Quote approval does not declare current project risk-register enforcement.');
  }
  if (!serverSource.includes("framework: 'source_bound_numbered_revision_control'")) {
    failures.push('Formal variation capability does not declare source-bound numbered revision control.');
  }
  if (!serverSource.includes("formalVariationClientResponse: 'package_and_delivery_bound_internal_verification'")) {
    failures.push('Formal variation client decisions are not declared as package-bound and internally verified.');
  }
  if (!serverSource.includes("capacityBasis: 'explicit_worker_weekday_profiles'")) {
    failures.push('Crew capacity planning does not declare explicit worker weekday profiles.');
  }
  if (!serverSource.includes("planApproval: 'immutable_source_current_snapshot'")) {
    failures.push('Crew look-ahead planning does not declare immutable source-current approval semantics.');
  }
  if (!serverSource.includes("crewLookaheadAutonomy: 'internal_review_task_only'")) {
    failures.push('Crew look-ahead autonomy is not constrained to internal review tasks.');
  }
  if (!serverSource.includes('autonomousAuthoring: false')) {
    failures.push('Risk-management capability does not explicitly prohibit autonomous risk authoring.');
  }
  if (!serverSource.includes("siteSurveyApproval: 'source_current_approval_gated'")) {
    failures.push('Site-survey capability does not declare source-current approval semantics.');
  }
  if (!serverSource.includes("siteSurveyAutonomy: 'internal_review_task_only'")) {
    failures.push('Site-survey capability does not constrain autonomy to internal review work.');
  }
  if (!serverSource.includes("assessmentMode: 'deterministic_source_bound_advisory'")) {
    failures.push('Market-fit capability does not declare deterministic advisory assessment semantics.');
  }
  if (!serverSource.includes("assessmentMode: 'deterministic_source_bound_operator_evidence'")) {
    failures.push('Bid/no-bid capability does not declare source-bound operator evidence semantics.');
  }
  if (!serverSource.includes("autonomousReview: 'internal_task_only'")) {
    failures.push('Bid/no-bid capability does not constrain autonomous review to internal tasks.');
  }
  if (!ledgerSource.includes("sourceScope: 'material_metric_inputs/v2'")) {
    failures.push('Performance scorecards do not declare material-input source hashing.');
  }
  if (!serverSource.includes("historicalPointInTime: 'retained_snapshots_only'")) {
    failures.push('Performance scorecards do not declare retained-snapshot historical point-in-time policy.');
  }

  const hostedEnvironment = fs.readFileSync(path.join(root, '.env.hosted.example'), 'utf8');
  for (const key of REQUIRED_HOSTED_ENV_KEYS) {
    if (!new RegExp(`^${key}=`, 'm').test(hostedEnvironment)) failures.push(`Hosted environment contract is missing: ${key}`);
  }

  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  if (!/^USER node$/m.test(dockerfile)) failures.push('Docker runtime must run as the node user.');
  if (!/^HEALTHCHECK\b/m.test(dockerfile)) failures.push('Docker runtime must define a readiness healthcheck.');

  const dockerIgnore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
  if (!/^\.env\*$/m.test(dockerIgnore)) failures.push('Docker build context must exclude every .env variant.');

  const containerVerifier = fs.readFileSync(path.join(root, 'scripts', 'verify-container-runtime.js'), 'utf8');
  for (const requiredProbe of [
    "'/api/health/ready'",
    "'/api/auth/login'",
    "'/api/readiness'",
    "'--read-only'",
    "'--cap-drop', 'ALL'",
    "'no-new-privileges:true'",
    "'/var/lib/contractor-ai'",
    "docker(['stop'"
  ]) {
    if (!containerVerifier.includes(requiredProbe)) failures.push(`Container runtime verifier is missing required probe: ${requiredProbe}`);
  }

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
  for (const command of ['npm run verify:release', 'npm run lint', 'npm test', 'npm run build', 'npm run test:browser', 'npm run test:container']) {
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
