const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_PATHS = [
  '.dockerignore',
  'App.jsx',
  'ClientPortal.css',
  'ClientPortal.jsx',
  'components/CashFlowForecastControl.jsx',
  'components/AutomationSafetyDialog.css',
  'components/AutomationSafetyDialog.jsx',
  'components/QaResetDialog.css',
  'components/QaResetDialog.jsx',
  'components/BidDecisionControl.jsx',
  'components/MarketFitControl.jsx',
  'components/PerformanceScorecard.jsx',
  'components/TeamAccessControl.jsx',
  'components/FrameworkWorkspace.css',
  'components/FrameworkWorkspace.jsx',
  'contractor-framework-catalog.json',
  'CHANGELOG.md',
  'Dockerfile',
  'docs/ACCESSIBILITY.md',
  'docs/ACCEPTANCE_TESTS.md',
  'docs/API_USAGE_AUDIT.md',
  'docs/CODEX_CHECKPOINTS.md',
  'docs/CODEX_WORKLOG.md',
  'docs/CRITICAL_PATH.md',
  'docs/FINAL_VERIFICATION_REPORT.md',
  'docs/GOAL_COMPLETION_MATRIX.md',
  'docs/HAI_CONNECTOR.md',
  'docs/NGROK.md',
  'docs/OPERATOR_RUNBOOK.md',
  'docs/PERFORMANCE_BENCHMARK.md',
  'docs/SECURITY.md',
  'docs/TASK_GRAPH.md',
  'docs/TECHNICAL_AUDIT.md',
  'docs/UI_ACTION_AUDIT.md',
  'docs/WINDOWS_STANDALONE.md',
  'docker-compose.hosted.yml',
  'evidence-storage.js',
  'e2e/accessibility-helpers.js',
  'e2e/accessibility.spec.js',
  'e2e/operations-safety.spec.js',
  'framework-catalog.js',
  'hai-connector.js',
  'operating-ledger.js',
  'postgres-sync-database.js',
  'postgres-sync-worker.js',
  'server.js',
  'standalone-launcher.js',
  'standalone-runtime.js',
  'scripts/build-windows-standalone.js',
  'scripts/verify-windows-standalone.js',
  'scripts/export-hai-feed.js',
  'scripts/verify-hai-contract.js',
  'scripts/generate-framework-catalog.js',
  'scripts/migrate-local-backup-to-hosted.js',
  'scripts/benchmark-ledger.js',
  'scripts/doctor.js',
  'scripts/restore-local-backup.js',
  'scripts/run-node-tests.js',
  'scripts/start-ngrok.js',
  'scripts/verify-bundle-budget.js',
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
  'CONTRACTOR_AI_BACKUP_POLICY_REFERENCE',
  'CONTRACTOR_AI_RETENTION_POLICY_REFERENCE'
];

function walkFiles(root, relative = '', unreadableDirectories = []) {
  const excluded = new Set([
    '.git', '.pytest_cache', '.vite', 'artifacts', 'coverage', 'data', 'dist', 'node_modules',
    'playwright-report', 'release', 'storage', 'test-results', 'tmp', 'uploads'
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
  for (const script of ['benchmark:ledger', 'build', 'doctor', 'export:hai', 'lint', 'migrate:hosted', 'package:windows', 'restore:local', 'start:standalone', 'start:tunnel', 'test', 'test:browser', 'test:container', 'test:performance', 'test:windows-package', 'verify:bundle', 'verify:hai-contract', 'verify:release']) {
    if (!packageJson.scripts?.[script]) failures.push(`package.json is missing required script: ${script}`);
  }
  if (packageJson.scripts?.pretest) failures.push('package.json must not duplicate the full Node suite through an automatic pretest hook.');
  if (packageJson.devDependencies?.['@axe-core/playwright'] !== '4.12.1') {
    failures.push('The browser accessibility gate must use the pinned @axe-core/playwright 4.12.1 engine.');
  }
  if (!packageJson.scripts?.test?.startsWith('node scripts/run-node-tests.js ')) {
    failures.push('package.json test must isolate and clean temporary Node test state.');
  }

  const nodeTestRunner = fs.readFileSync(path.join(root, 'scripts', 'run-node-tests.js'), 'utf8');
  for (const cleanupRequirement of ['fs.mkdtempSync', 'allTestFiles()', 'postgresTestFiles(discovered)', 'withTestConcurrency(args, 1)', 'TEMP: runtimeDirectory', 'TMP: runtimeDirectory', 'TMPDIR: runtimeDirectory', 'cleanupRuntimeDirectory(runtimeDirectory)']) {
    if (!nodeTestRunner.includes(cleanupRequirement)) failures.push(`Node test runner is missing required isolation control: ${cleanupRequirement}`);
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
    "app.get('/api/ledger/frameworks/catalog'",
    "app.get('/api/ledger/frameworks'",
    "app.get('/api/ledger/frameworks/:implementationId/revisions'",
    "app.post('/api/ledger/frameworks'",
    "app.patch('/api/ledger/frameworks/:implementationId'",
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
    "app.post('/api/operations/restore/validate'",
    "app.get('/api/operations/control'",
    "app.get('/api/operations/operators'",
    "app.post('/api/operations/operators'",
    "app.post('/api/operations/operators/:operatorId/rotate'",
    "app.post('/api/operations/operators/:operatorId/deactivate'",
    "app.post('/api/operations/control/suspend'",
    "app.post('/api/operations/control/resume'",
    "app.get('/api/operations/support-bundle'",
    "app.get('/api/integrations/hai/manifest'",
    "app.get('/api/integrations/hai/feed'"
  ]) {
    if (!serverSource.includes(canonicalRoute)) failures.push(`Canonical ledger route is missing: ${canonicalRoute}`);
  }
  const ledgerSource = fs.readFileSync(path.join(root, 'operating-ledger.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'App.jsx'), 'utf8');
  const frameworkCatalogSource = fs.readFileSync(path.join(root, 'framework-catalog.js'), 'utf8');
  const frameworkWorkspaceSource = fs.readFileSync(path.join(root, 'components', 'FrameworkWorkspace.jsx'), 'utf8');
  const teamAccessSource = fs.readFileSync(path.join(root, 'components', 'TeamAccessControl.jsx'), 'utf8');
  const privacyRequestSource = fs.readFileSync(path.join(root, 'components', 'PrivacyRequestsControl.jsx'), 'utf8');
  const restoreSource = fs.readFileSync(path.join(root, 'scripts', 'restore-local-backup.js'), 'utf8');
  const hostedMigrationSource = fs.readFileSync(path.join(root, 'scripts', 'migrate-local-backup-to-hosted.js'), 'utf8');
  const dockerSource = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const windowsPackageSource = fs.readFileSync(path.join(root, 'scripts', 'build-windows-standalone.js'), 'utf8');
  const windowsPackageVerificationSource = fs.readFileSync(path.join(root, 'scripts', 'verify-windows-standalone.js'), 'utf8');
  const accessibilitySource = fs.readFileSync(path.join(root, 'e2e', 'accessibility.spec.js'), 'utf8');
  const accessibilityHelperSource = fs.readFileSync(path.join(root, 'e2e', 'accessibility-helpers.js'), 'utf8');
  for (const accessibilityRequirement of [
    'owner primary workspaces meet automated WCAG A and AA rules',
    'representative owner dialogs meet automated WCAG A and AA rules',
    'mobile navigation and client portal meet automated WCAG A and AA rules'
  ]) {
    if (!accessibilitySource.includes(accessibilityRequirement)) {
      failures.push(`Accessibility browser coverage is missing: ${accessibilityRequirement}`);
    }
  }
  for (const accessibilityTag of ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']) {
    if (!accessibilityHelperSource.includes(`'${accessibilityTag}'`)) {
      failures.push(`Accessibility browser gate is missing WCAG tag: ${accessibilityTag}`);
    }
  }
  for (const runtimePath of ['framework-catalog.js', 'contractor-framework-catalog.json']) {
    if (!dockerSource.includes(runtimePath)) failures.push(`Docker runtime is missing framework dependency: ${runtimePath}`);
    if (!windowsPackageSource.includes(`'${runtimePath}'`)) failures.push(`Windows runtime is missing framework dependency: ${runtimePath}`);
  }
  for (const verificationRequirement of [
    '071_data_subject_request_governance',
    '/api/operations/operators',
    '/api/operations/privacy/requests',
    '/api/integrations/hai/manifest',
    'accountfeed.GenericItem',
    'generic_json_feed',
    'review_document',
    'operatorRegisterRedacted',
    'privacyRegisterAvailable',
    'removeFixture(fixtureRoot)'
  ]) {
    if (!windowsPackageVerificationSource.includes(verificationRequirement)) {
      failures.push(`Windows package smoke test is missing verification: ${verificationRequirement}`);
    }
  }
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
  if (!ledgerSource.includes("version: '060_daily_operating_cycles'")) {
    failures.push('Canonical daily start-huddle and end-of-day operating-cycle migration is missing.');
  }
  if (!ledgerSource.includes("version: '061_last_planner_lite'")) {
    failures.push('Canonical Last Planner lite migration is missing.');
  }
  if (!ledgerSource.includes("version: '062_governed_five_s'")) {
    failures.push('Canonical governed 5S migration is missing.');
  }
  if (!ledgerSource.includes("version: '063_governed_lmra'")) {
    failures.push('Canonical governed LMRA migration is missing.');
  }
  if (!ledgerSource.includes("version: '064_governed_installation_qc'")) {
    failures.push('Canonical governed installation-QC migration is missing.');
  }
  if (!ledgerSource.includes("version: '065_governed_photo_evidence'")) {
    failures.push('Canonical governed photo-evidence migration is missing.');
  }
  if (!ledgerSource.includes("version: '066_governed_client_feedback'")) {
    failures.push('Canonical governed client-feedback migration is missing.');
  }
  if (!ledgerSource.includes("version: '067_governed_energy_performance'")) {
    failures.push('Canonical governed energy-performance migration is missing.');
  }
  if (!ledgerSource.includes("version: '068_operational_safety_controls'")) {
    failures.push('Canonical operational safety-control migration is missing.');
  }
  if (!ledgerSource.includes("version: '069_governed_framework_workspace'")) {
    failures.push('Canonical governed framework workspace migration is missing.');
  }
  if (!ledgerSource.includes("version: '070_managed_operator_accounts'")) {
    failures.push('Canonical managed operator account migration is missing.');
  }
  if (!ledgerSource.includes("version: '071_data_subject_request_governance'")) {
    failures.push('Canonical data-subject request governance migration is missing.');
  }
  for (const privacyRequirement of [
    'createDataSubjectRequest',
    'verifyDataSubjectRequestIdentity',
    'assessDataSubjectRequest',
    'applyDataSubjectRequestDecision',
    'dataSubjectExportPayload',
    'assertDataSubjectProcessingAllowed'
  ]) {
    if (!ledgerSource.includes(privacyRequirement)) {
      failures.push(`Data-subject request governance is missing required behavior: ${privacyRequirement}`);
    }
  }
  for (const privacyEndpoint of [
    '/api/operations/privacy/requests',
    '/api/operations/privacy/requests/:requestId/identity',
    '/api/operations/privacy/requests/:requestId/extend',
    '/api/operations/privacy/requests/:requestId/assessment',
    '/api/operations/privacy/requests/:requestId/export'
  ]) {
    if (!serverSource.includes(privacyEndpoint)) {
      failures.push(`Owner privacy operations are missing endpoint: ${privacyEndpoint}`);
    }
  }
  for (const managedAccessRequirement of [
    'createManagedOperatorAccount',
    'rotateManagedOperatorAccess',
    'deactivateManagedOperatorAccount',
    'revokeOperatorSessionsForPrincipal'
  ]) {
    if (!ledgerSource.includes(managedAccessRequirement)) {
      failures.push(`Managed operator lifecycle is missing required behavior: ${managedAccessRequirement}`);
    }
  }
  if (!serverSource.includes("randomBytes(32).toString('base64url')")
    || !serverSource.includes("update('contractor-ai-managed-operator\\0')")) {
    failures.push('Managed operator keys are not generated strongly and retained through a domain-separated hash.');
  }
  if (!teamAccessSource.includes('data-testid="issued-operator-access-key"')
    || teamAccessSource.includes('localStorage')
    || teamAccessSource.includes('sessionStorage')) {
    failures.push('Managed operator keys must be shown once without browser-storage retention.');
  }
  if (!privacyRequestSource.includes('data-testid="privacy-requests-control"')
    || !privacyRequestSource.includes('Do not upload or copy a full identity document')
    || !privacyRequestSource.includes('full identity document')
    || !privacyRequestSource.includes('Requester notification reference')
    || privacyRequestSource.includes('localStorage')
    || privacyRequestSource.includes('sessionStorage')) {
    failures.push('Privacy requests must be operator-visible, data-minimized, and absent from browser storage.');
  }
  if (!ledgerSource.includes('data_subject_extension_notification_required')
    || !serverSource.includes("extensionNotificationEvidence: 'requester_notification_reference_required'")) {
    failures.push('Privacy deadline extensions must retain evidence that the requester was informed.');
  }
  for (const privacyTest of ['tests/data-subject-requests.test.js', 'e2e/privacy-requests.spec.js']) {
    if (!fs.existsSync(path.join(root, privacyTest))) failures.push(`Privacy lifecycle coverage is missing: ${privacyTest}`);
  }
  if (!restoreSource.includes('deactivateRestoredManagedOperators')
    || !hostedMigrationSource.includes('deactivatedManagedOperators')) {
    failures.push('Restore and hosted migration do not deactivate retained managed operator access.');
  }
  const frameworkCatalog = JSON.parse(fs.readFileSync(path.join(root, 'contractor-framework-catalog.json'), 'utf8'));
  if (
    frameworkCatalog.format !== 'contractor-ai/framework-catalog-v1'
    || frameworkCatalog.counts?.families !== 23
    || frameworkCatalog.counts?.frameworks !== 671
    || frameworkCatalog.counts?.familyMemberships !== 700
  ) {
    failures.push('Checked-in framework catalog does not retain all 23 families and 700 memberships.');
  }
  for (const playbookRequirement of [
    "const PLAYBOOK_FORMAT = 'contractor-ai/framework-family-playbook-v1'",
    'recommendedScope',
    'reviewCadenceDays',
    'evidenceSuggestions',
    'measureSuggestions',
    'safeguards'
  ]) {
    if (!frameworkCatalogSource.includes(playbookRequirement)) {
      failures.push(`Framework family playbooks are missing required behavior: ${playbookRequirement}`);
    }
  }
  if (!frameworkWorkspaceSource.includes('Evidence candidates are prompts only and are never retained as proof automatically.')) {
    failures.push('Framework method starter does not retain the no-fabricated-evidence boundary.');
  }
  if (!appSource.includes('/api/ledger/frameworks/catalog?limit=1000&compact_families=true')) {
    failures.push('Framework dashboard does not request the explicit compact family representation.');
  }
  if (!frameworkCatalogSource.includes("familyRepresentation: compactFamilies ? 'compact' : 'compatible'")) {
    failures.push('Framework catalog does not preserve default nested-family compatibility.');
  }
  if (!ledgerSource.includes('this.assertAutomationActive();')) {
    failures.push('Autonomous command application does not enforce the durable owner safety stop.');
  }
  if (!serverSource.includes("actualEvidence: 'closed_daily_operating_cycle_required'")) {
    failures.push('Last Planner capability does not require closed daily operating-cycle evidence.');
  }
  if (!serverSource.includes("fiveSAuditToolState: 'canonical_status_inspection_location_checked'")) {
    failures.push('5S capability does not bind audits to canonical equipment state.');
  }
  if (!serverSource.includes("lmraSourceValidation: 'server_current_at_receipt'")) {
    failures.push('LMRA capability does not require a current server-side source check.');
  }
  if (!serverSource.includes('lmraOfflineAuthorization: false')) {
    failures.push('LMRA capability does not explicitly block offline authorization.');
  }
  if (!serverSource.includes('photoEvidenceTaskCompletionGate: true')) {
    failures.push('Photo-evidence capability does not gate task completion.');
  }
  if (!serverSource.includes('photoEvidenceReleaseInference: false')) {
    failures.push('Photo-evidence capability does not explicitly block inferred release.');
  }
  if (!serverSource.includes("energyPerformanceEvidenceIntegrity: 'retained_pdf_sha256_and_immutable_snapshot'")) {
    failures.push('Energy-performance capability does not bind evidence to an immutable retained PDF checksum.');
  }
  if (!serverSource.includes('energyPerformanceCalculationEngine: false')
    || !serverSource.includes('energyPerformanceLegalCertification: false')
    || !serverSource.includes('energyPerformanceExternalRegistration: false')) {
    failures.push('Energy-performance capability does not preserve the no-calculation, no-certification, and no-registration boundary.');
  }
  if (!serverSource.includes("clientFeedbackIntegrity: 'immutable_snapshot_and_entry_fingerprint'")) {
    failures.push('Client feedback does not advertise immutable snapshot and replay integrity.');
  }
  if (!serverSource.includes("clientFeedbackAutonomy: 'internal_service_recovery_only'")) {
    failures.push('Client feedback autonomy is not constrained to internal service recovery.');
  }
  const haiConnectorSource = fs.readFileSync(path.join(root, 'hai-connector.js'), 'utf8');
  for (const haiBoundary of [
    "connectorId: HAI_CONNECTOR_ID",
    "mode: 'read_only'",
    "const HAI_FEED_FORMAT = 'hai-accountfeed-generic-item/v1'",
    "const HAI_ITEM_PROVIDER = 'generic_json_feed'",
    "const HAI_ITEM_TYPE = 'document'",
    "const HAI_FEED_OPERATION = 'review_document'",
    'provider: HAI_ITEM_PROVIDER',
    'itemType: HAI_ITEM_TYPE',
    'content: cleanText',
    'canExecute: false',
    'externalCommitments: 0'
  ]) {
    if (!haiConnectorSource.includes(haiBoundary)) {
      failures.push(`HAI connector is missing its read-only boundary: ${haiBoundary}`);
    }
  }
  const haiContractVerifierSource = fs.readFileSync(path.join(root, 'scripts', 'verify-hai-contract.js'), 'utf8');
  for (const haiVerificationRequirement of [
    'ParseGenericFeed(data, 200000, 16000)',
    'normalized.OperationType != "review_document"',
    "'--network', 'none'",
    "golang:1.25-alpine@sha256:",
    'verifyNativeContract()'
  ]) {
    if (!haiContractVerifierSource.includes(haiVerificationRequirement)) {
      failures.push(`HAI compatibility verifier is missing required behavior: ${haiVerificationRequirement}`);
    }
  }
  if (!serverSource.includes("installationQcSourceValidation: 'server_current_at_receipt_and_release'")) {
    failures.push('Installation-QC capability does not require current source checks at receipt and release.');
  }
  if (!serverSource.includes('installationQcTaskCompletionGate: true')) {
    failures.push('Installation-QC capability does not gate task completion.');
  }
  if (!serverSource.includes('installationQcOfflineRelease: false')) {
    failures.push('Installation-QC capability does not explicitly block offline release.');
  }
  if (!serverSource.includes("installationQcAutonomy: 'internal_review_task_only'")) {
    failures.push('Installation-QC capability does not constrain autonomous behavior to internal review tasks.');
  }
  if (!serverSource.includes("fiveSVehicleDispatch: false")) {
    failures.push('5S capability does not explicitly prohibit inferred vehicle dispatch.');
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
  if (!dockerfile.includes('hai-connector.js')) failures.push('Docker runtime must include the HAI connector required by server.js.');

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
  for (const command of ['npm run verify:release', 'npm run verify:hai-contract', 'npm run lint', 'npm test', 'npm run build', 'npm run verify:bundle', 'npm run test:browser', 'npm run test:container']) {
    if (!workflow.includes(command)) failures.push(`CI workflow is missing required gate: ${command}`);
  }
  if (!/push:\s*\n\s+branches:\s*\n\s+- main/.test(workflow)) {
    failures.push('CI push verification must be limited to main so pull request branches do not run duplicate suites.');
  }
  if (!/CONTRACTOR_AI_POSTGRES_TEST_URL:.*sslmode=require/.test(workflow)) {
    failures.push('CI PostgreSQL contract must run with sslmode=require.');
  }
  if (!workflow.includes("SHOW ssl")) failures.push('CI workflow must verify PostgreSQL TLS is active.');
  for (const windowsRequirement of ['windows-standalone:', 'runs-on: windows-latest', 'npm run package:windows', 'npm run test:windows-package', 'actions/upload-artifact@v7']) {
    if (!workflow.includes(windowsRequirement)) failures.push(`CI workflow is missing Windows package verification: ${windowsRequirement}`);
  }
  if (workflow.includes('actions/checkout@v7') || workflow.includes('actions/setup-node@v7')) {
    failures.push('CI workflow references an unavailable major for checkout or setup-node.');
  }

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
