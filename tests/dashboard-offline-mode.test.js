const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'App.jsx'), 'utf8');
const clientPortalSource = fs.readFileSync(path.join(__dirname, '..', 'ClientPortal.jsx'), 'utf8');
const outboxSource = fs.readFileSync(path.join(__dirname, '..', 'field-outbox.js'), 'utf8');

test('React dashboard uses ledger endpoints instead of cached or simulated contractor records', () => {
  assert.match(dashboardSource, /api\('\/api\/ledger\/dashboard'\)/);
  assert.match(dashboardSource, /api\('\/api\/ledger\/jobs\?limit=100'\)/);
  assert.match(dashboardSource, /api\('\/api\/ledger\/approvals\?status=pending&limit=100'\)/);
  assert.match(dashboardSource, /api\('\/api\/session'\)/);
  assert.doesNotMatch(dashboardSource, /localStorage|sampleJobs|simulateClientRequest|innerHTML|onclick=/);
});

test('dashboard mutations remain API-backed and confirmation-gated where they affect retained operations', () => {
  assert.match(dashboardSource, /api\('\/api\/ledger\/intake'/);
  assert.match(dashboardSource, /api\(`\/api\/ledger\/approvals\/\$\{item\.id\}\/resolve`/);
  assert.match(dashboardSource, /data-testid="approval-review-modal"/);
  assert.match(dashboardSource, /approvalReview\.item\.decision\?\.safeguards/);
  assert.match(dashboardSource, /required=\{approvalReview\.status === 'rejected' \|\| approvalReview\.item\.data\?\.requiresExceptionOverride === true\}/);
  assert.match(dashboardSource, /confirmation: 'RESET_QA'/);
  assert.match(dashboardSource, /window\.confirm\('Archive Browser QA and demo records/);
});

test('field updates use a bounded operator-scoped IndexedDB outbox only for interrupted requests', () => {
  assert.match(outboxSource, /const DATABASE_VERSION = 2/);
  assert.match(outboxSource, /indexedDB\.open\(DATABASE_NAME, DATABASE_VERSION\)/);
  assert.match(outboxSource, /const MAX_EVIDENCE_DRAFTS = 20/);
  assert.match(outboxSource, /const MAX_TOTAL_EVIDENCE_BYTES = 50 \* 1024 \* 1024/);
  assert.match(outboxSource, /const MAX_OPERATION_DRAFTS = 100/);
  assert.match(outboxSource, /const MAX_TOTAL_OPERATION_BYTES = 1024 \* 1024/);
  assert.match(outboxSource, /new Set\(\['progress', 'daily_log'\]\)/);
  assert.match(outboxSource, /operator\.id \|\| operator\.worker\?\.id/);
  assert.match(outboxSource, /draft\.operatorScope === operatorScope/);
  assert.match(outboxSource, /await sendEvidence\(draft\)/);
  assert.match(outboxSource, /await sendOperation\(draft\)/);
  assert.match(outboxSource, /id: String\(id \|\| createFieldEvidenceDraftId\(\)\)/);
  assert.match(dashboardSource, /enqueueFieldEvidenceDraft\(draft\)/);
  assert.match(dashboardSource, /enqueueFieldOperationDraft\(draft\)/);
  assert.match(dashboardSource, /fieldOutboxOperatorScope\(operator\)/);
  assert.match(dashboardSource, /flushFieldOutbox\(\{/);
  assert.match(dashboardSource, /sendOperation: recordFieldOperation/);
  assert.match(dashboardSource, /'Idempotency-Key': id \|\| createFieldEvidenceDraftId\(\)/);
  assert.match(dashboardSource, /shouldQueueFieldMutation\(requestError\)/);
  assert.match(dashboardSource, /window\.addEventListener\('online', handleOnline\)/);
  assert.match(dashboardSource, /Save daily log offline/);
  assert.match(dashboardSource, /Save progress offline/);
  assert.doesNotMatch(outboxSource, /localStorage|sessionStorage/);
});

test('dashboard loads a field worker only through scoped ledger calls and hides owner workflow navigation', () => {
  assert.match(dashboardSource, /const fieldScoped = operator\.fieldScoped === true/);
  assert.match(dashboardSource, /const visibleNavItems = useMemo\(\(\) => navItems\.filter/);
  assert.match(dashboardSource, /if \(key === 'field'\) return capabilities\.fieldEvidence/);
  assert.match(dashboardSource, /if \(key === 'operations'\) return capabilities\.maintenance/);
  assert.match(dashboardSource, /if \(fieldScoped\) \{/);
  assert.match(dashboardSource, /dashboard: fieldScopedDashboard\(scopedJobs\)/);
  assert.match(dashboardSource, /capabilities\.intake \?/);
  assert.match(dashboardSource, /capabilities\.maintenance \?/);
});

test('field workflow can record scoped progress without exposing job completion', () => {
  const fieldProgressStart = dashboardSource.indexOf('data-testid="field-progress-form"');
  const fieldProgressEnd = dashboardSource.indexOf('</form>', fieldProgressStart);
  assert.ok(fieldProgressStart >= 0 && fieldProgressEnd > fieldProgressStart, 'field progress form source must be retained');
  const fieldProgressSource = dashboardSource.slice(fieldProgressStart, fieldProgressEnd);
  assert.match(dashboardSource, /function recordFieldProgress\(event\)/);
  assert.match(dashboardSource, /type: 'progress'/);
  assert.match(dashboardSource, /type === 'progress' \? 'progress'/);
  assert.match(dashboardSource, /id: fieldProgress\.entryKey/);
  assert.match(dashboardSource, /source: 'field_dashboard'/);
  assert.match(fieldProgressSource, /<option value="in_progress">In progress<\/option>/);
  assert.match(fieldProgressSource, /<option value="blocked">Blocked<\/option>/);
  assert.doesNotMatch(fieldProgressSource, /<option value="completed">/);
});

test('operations view lists, verifies, and exports portable checksummed local backups', () => {
  assert.match(dashboardSource, /api\('\/api\/operations\/backups'\)/);
  assert.match(dashboardSource, /api\('\/api\/operations\/capabilities'\)/);
  assert.match(dashboardSource, /api\('\/api\/operations\/restore\/validate'/);
  assert.match(dashboardSource, /api\('\/api\/operations\/exports\/validate'/);
  assert.match(dashboardSource, /backup\.verification\.checkedFiles/);
  assert.match(dashboardSource, /backup\.evidenceFiles/);
  assert.match(dashboardSource, /operationCapabilities\?\.backup\?\.available/);
  assert.match(dashboardSource, /operationCapabilities\?\.backup\?\.portableDownload/);
  assert.match(dashboardSource, /operationCapabilities\?\.hostedMigration\?\.available/);
  assert.match(dashboardSource, />EU migration</);
  assert.match(dashboardSource, /operations\/backups\/\$\{encodeURIComponent\(backup\.backupId\)\}\/download/);
  assert.match(dashboardSource, /Download<\/a>/);
  assert.match(dashboardSource, /Validate export/);
  assert.match(dashboardSource, /Check restore/);
  assert.match(dashboardSource, /It cannot restore the database or evidence files/);
  assert.match(dashboardSource, /const providerRecovery = operationCapabilities\?\.providerRecovery/);
  assert.match(dashboardSource, /data-testid="login-defense-readiness"/);
  assert.match(dashboardSource, /loginRateLimitCapability\?\.durability === 'ledger'/);
  assert.match(dashboardSource, /loginRateLimitCapability\?\.multiReplicaSafe/);
  assert.match(dashboardSource, /data-testid="api-defense-readiness"/);
  assert.match(dashboardSource, /apiRateLimitCapability\?\.durability === 'ledger'/);
  assert.match(dashboardSource, /apiRateLimitCapability\?\.multiReplicaSafe/);
  assert.match(dashboardSource, /const auditIntegrityCapability = operationCapabilities\?\.auditIntegrity/);
  assert.match(dashboardSource, /auditIntegrityCapability\?\.appendMode === 'atomic_hash_chain'/);
  assert.match(dashboardSource, /data-testid="audit-integrity-readiness"/);
  assert.match(dashboardSource, /disabled=\{submitting \|\| !localBackupAvailable\}/);
  assert.match(dashboardSource, /Application-local packages are disabled in hosted mode/);
});

test('operations view exposes owner audit investigation with cursor paging and chain proof', () => {
  assert.match(dashboardSource, /data-testid="audit-history-panel"/);
  assert.match(dashboardSource, /data-testid="audit-history-filters"/);
  assert.match(dashboardSource, /data-testid="audit-event-detail"/);
  assert.match(dashboardSource, /\/api\/ledger\/audit\?/);
  assert.match(dashboardSource, /beforeSequence/);
  assert.match(dashboardSource, /includeFacets/);
  assert.match(dashboardSource, /newestSequence: current\?\.newestSequence \|\| nextPage\.newestSequence/);
  assert.match(dashboardSource, /Audit history/);
  assert.match(dashboardSource, /Previous hash/);
  assert.match(dashboardSource, /Event hash/);
  assert.match(dashboardSource, /detailCloseRef\.current\?\.focus\(\)/);
  assert.match(dashboardSource, /window\.addEventListener\('keydown', handleKeyDown\)/);
  assert.match(dashboardSource, /detailOpenerRef\.current\?\.focus\(\)/);
});

test('job workspace exposes approval-safe commercial drafting and acceptance evidence', () => {
  assert.match(dashboardSource, /minimumFractionDigits: 2/);
  assert.match(dashboardSource, /maximumFractionDigits: 2/);
  assert.match(dashboardSource, /data-testid="commercial-control"/);
  assert.match(dashboardSource, /data-testid="commercial-draft-modal"/);
  assert.match(dashboardSource, /data-testid="commercial-acceptance-modal"/);
  assert.match(dashboardSource, /server-derived totals/);
  assert.match(dashboardSource, /quotes\/\$\{encodeURIComponent\(record\.id\)\}\/acceptance/);
  assert.match(dashboardSource, /change-orders\/\$\{encodeURIComponent\(record\.id\)\}\/acceptance/);
  assert.match(dashboardSource, /acceptedAt: commercialAcceptanceDraft\.acceptedAt/);
  assert.match(dashboardSource, /Contract value remains unchanged until client acceptance is verified/);
  assert.match(dashboardSource, /Internal change-order approval alone does not alter contract value|internal approval request/);
  assert.match(dashboardSource, /commercialDialogOpenerRef\.current = document\.activeElement/);
  assert.match(dashboardSource, /requestAnimationFrame\(\(\) => opener\?\.focus\?\.\(\)\)/);
  assert.match(dashboardSource, /if \(selectedJobId\) closeJobWorkspace\(\)/);
});

test('job archive and restore controls use retained approval-gated ledger routes', () => {
  assert.match(dashboardSource, /api\('\/api\/ledger\/jobs\?archiveOnly=true&limit=100'\)/);
  assert.match(dashboardSource, /`\/api\/ledger\/jobs\/\$\{encodeURIComponent\(job\.id\)\}\/\$\{mode\}`/);
  assert.match(dashboardSource, /data-testid="job-archive-control"/);
  assert.match(dashboardSource, /data-testid="job-archive-registry"/);
  assert.match(dashboardSource, /data-testid="job-lifecycle-modal"/);
  assert.match(dashboardSource, /The complete job ledger, evidence, finance, field, client, resource, and audit history remains retained/);
  assert.match(dashboardSource, /No message, cancellation, supplier order, payment, safety clearance, or schedule commitment is triggered/);
});

test('client portal is a scoped React workflow without imperative HTML rendering', () => {
  assert.match(clientPortalSource, /\/api\/client-portal\/\$\{encodeURIComponent\(token\)\}/);
  assert.match(clientPortalSource, /\/messages`/);
  assert.match(clientPortalSource, /\/selections\/\$\{encodeURIComponent\(selection\.id\)\}\/responses/);
  assert.match(clientPortalSource, /responseId: createResponseId\(\)/);
  assert.match(clientPortalSource, /Ter beoordeling indienen/);
  assert.match(clientPortalSource, /Hiermee wijzigt u geen prijs, planning, opdracht of bestelling/);
  assert.match(clientPortalSource, /new URLSearchParams\(window\.location\.hash\.slice\(1\)\)/);
  assert.match(clientPortalSource, /noindex, nofollow/);
  assert.doesNotMatch(clientPortalSource, /innerHTML|document\.getElementById|addEventListener/);
});
