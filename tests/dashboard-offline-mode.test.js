const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboardRootSource = fs.readFileSync(path.join(__dirname, '..', 'App.jsx'), 'utf8');
const fiveSWorkspaceSource = fs.readFileSync(path.join(__dirname, '..', 'components', 'FiveSWorkspace.jsx'), 'utf8');
const lmraControlSource = fs.readFileSync(path.join(__dirname, '..', 'components', 'LmraControl.jsx'), 'utf8');
const qaResetDialogSource = fs.readFileSync(path.join(__dirname, '..', 'components', 'QaResetDialog.jsx'), 'utf8');
const dashboardSource = [
  dashboardRootSource,
  fs.readFileSync(path.join(__dirname, '..', 'dashboard-format.js'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '..', 'components', 'JobWorkspaceControls.jsx'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '..', 'components', 'ResourcesWorkspace.jsx'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '..', 'components', 'AuditHistory.jsx'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '..', 'components', 'CashFlowForecastControl.jsx'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '..', 'components', 'PerformanceScorecard.jsx'), 'utf8'),
  qaResetDialogSource,
].join('\n');
const clientPortalSource = fs.readFileSync(path.join(__dirname, '..', 'ClientPortal.jsx'), 'utf8');
const outboxSource = fs.readFileSync(path.join(__dirname, '..', 'field-outbox.js'), 'utf8');
const localeSource = fs.readFileSync(path.join(__dirname, '..', 'locale.js'), 'utf8');
const ledgerSource = fs.readFileSync(path.join(__dirname, '..', 'operating-ledger.js'), 'utf8');

test('React dashboard uses ledger endpoints instead of cached or simulated contractor records', () => {
  assert.match(dashboardSource, /api\('\/api\/ledger\/dashboard'\)/);
  assert.match(dashboardSource, /api\('\/api\/ledger\/jobs\?limit=100'\)/);
  assert.match(dashboardSource, /api\('\/api\/ledger\/approvals\?status=pending&limit=100'\)/);
  assert.match(dashboardSource, /api\('\/api\/session'\)/);
  assert.doesNotMatch(dashboardSource, /localStorage|sampleJobs|simulateClientRequest|innerHTML|onclick=/);
});

test('large navigation and job controls are loaded through local suspense boundaries', () => {
  assert.match(dashboardRootSource, /lazy\(\(\) => import\('\.\/components\/ResourcesWorkspace'\)\)/);
  assert.match(dashboardRootSource, /const AuditHistory = lazy\(\(\) => import\('\.\/components\/AuditHistory'\)\)/);
  assert.match(dashboardRootSource, /const CashFlowForecastControl = lazy\(\(\) => import\('\.\/components\/CashFlowForecastControl'\)\)/);
  assert.match(dashboardRootSource, /const PerformanceScorecard = lazy\(\(\) => import\('\.\/components\/PerformanceScorecard'\)\)/);
  assert.match(dashboardRootSource, /const loadJobWorkspaceControls = \(\) => import\('\.\/components\/JobWorkspaceControls'\)/);
  assert.match(dashboardRootSource, /<LazyControlBoundary label="resource controls">/);
  assert.match(dashboardRootSource, /<LazyControlBoundary label="audit history">/);
  assert.match(dashboardRootSource, /<ResourcesWorkspace[\s\S]*locale=\{operatorLocale\}/);
  assert.match(dashboardRootSource, /<AuditHistory locale=\{operatorLocale\}/);
  assert.match(dashboardRootSource, /<ProjectControls[\s\S]*locale=\{operatorLocale\}/);
  assert.match(dashboardRootSource, /<CapabilitySetupControl[\s\S]*locale=\{operatorLocale\}/);
  assert.match(dashboardRootSource, /<WorkPlanControl[\s\S]*locale=\{operatorLocale\}/);
  assert.match(dashboardRootSource, /<FieldAssuranceWorkspace[\s\S]*locale=\{operatorLocale\}/);
  assert.match(dashboardRootSource, /<NonconformanceControl[\s\S]*locale=\{operatorLocale\}/);
  assert.match(dashboardRootSource, /<FieldRiskControl[\s\S]*locale=\{operatorLocale\}/);
  assert.match(dashboardSource, /function ResourcesWorkspace\(\{[\s\S]*locale = 'en-GB'/);
  assert.match(dashboardSource, /function AuditHistory\(\{ locale = 'en-GB'/);
  assert.match(dashboardSource, /function ProjectControls\(\{[\s\S]*locale = 'en-GB'/);
  assert.match(dashboardSource, /function CapabilitySetupControl\(\{ job, locale = 'en-GB'/);
  assert.match(dashboardSource, /function WorkPlanControl\(\{[\s\S]*locale = 'en-GB'/);
  assert.match(dashboardSource, /function FieldAssuranceWorkspace\(\{[\s\S]*locale = 'en-GB'/);
  assert.match(dashboardSource, /function NonconformanceControl\(\{[\s\S]*locale = 'en-GB'/);
  assert.match(dashboardSource, /function FieldRiskControl\(\{[\s\S]*locale = 'en-GB'/);
  assert.match(dashboardRootSource, /<LazyControlBoundary label="client controls">/);
  assert.match(dashboardRootSource, /<LazyControlBoundary label="automation controls">/);
  assert.match(dashboardRootSource, /<LazyControlBoundary label=\{ot\('job controls'\)\} mode="job">/);
});

test('5S mutations cannot be overwritten by an older parent board request', () => {
  assert.match(fiveSWorkspaceSource, /const hasLocalMutationRef = useRef\(false\)/);
  assert.match(fiveSWorkspaceSource, /if \(!hasLocalMutationRef\.current\) setBoard\(suppliedBoard\)/);
  assert.match(fiveSWorkspaceSource, /function retainMutationBoard\(nextBoard\)/);
  assert.match(fiveSWorkspaceSource, /hasLocalMutationRef\.current = true/);
  assert.match(fiveSWorkspaceSource, /retainMutationBoard\(result\.board\)/);
  assert.match(fiveSWorkspaceSource, /if \(!fieldMode && suppliedBoard\) \{/);
  assert.match(fiveSWorkspaceSource, /setLoading\(false\)/);
});

test('performance workspace renders ten evidence-backed perspectives with governed targets and snapshots', () => {
  for (const perspective of [
    'safety',
    'quality',
    'delivery_reliability',
    'customer_satisfaction',
    'employee_capacity',
    'financial_performance',
    'commercial_pipeline',
    'asset_productivity',
    'compliance',
    'sustainability',
  ]) {
    assert.match(dashboardSource, new RegExp(`${perspective}:`));
  }
  assert.match(dashboardSource, /data-testid="performance-scorecard"/);
  assert.match(dashboardSource, /data-testid="performance-metric-table"/);
  assert.match(dashboardSource, /\/api\/ledger\/performance-scorecard\?/);
  assert.match(dashboardSource, /\/api\/ledger\/performance-scorecard\/targets/);
  assert.match(dashboardSource, /\/api\/ledger\/performance-scorecard\/snapshots/);
  assert.match(dashboardSource, /summary\.metricCount \|\| 23/);
  assert.match(dashboardSource, /if \(status === 'no_data'\) return t\('No data'\)/);
  assert.match(dashboardSource, /import \{ operatorText \} from '\.\.\/operator-locale'/);
  assert.match(dashboardRootSource, /<PerformanceScorecard[\s\S]*locale=\{operatorLocale\}/);
  assert.match(dashboardSource, /canApprove && pendingSnapshot\?\.approvalId/);
  assert.match(dashboardSource, /No external action was created/);
});

test('portfolio schedule is role-gated, ledger-backed, rendered, and connected to operating workflows', () => {
  assert.match(dashboardRootSource, /\['schedule', CalendarDays\]/);
  assert.match(localeSource, /'nav\.schedule': 'Schedule'/);
  assert.match(localeSource, /'nav\.schedule': 'Planning'/);
  assert.match(dashboardSource, /api\('\/api\/ledger\/schedule\?horizonDays=180&limit=500'\)/);
  assert.match(dashboardSource, /if \(key === 'schedule'\) return capabilities\.schedule/);
  assert.match(dashboardSource, /section === 'schedule' && capabilities\.schedule/);
  assert.match(dashboardSource, /data-testid="portfolio-schedule"/);
  assert.match(dashboardSource, /onOpenDispatch=\{reviewPortfolioDispatch\}/);
  assert.match(dashboardSource, /onOpenApprovals=\{openApprovals\}/);
  assert.match(dashboardSource, /onOpen=\{openJobWorkspace\}/);
});

test('dashboard mutations remain API-backed and confirmation-gated where they affect retained operations', () => {
  assert.match(dashboardSource, /api\('\/api\/ledger\/intake'/);
  assert.match(dashboardSource, /api\(`\/api\/ledger\/approvals\/\$\{item\.id\}\/resolve\?includeDashboard=false`/);
  assert.match(dashboardSource, /function reconcileApprovalResolution\(data, approvalId, dashboard = null\)/);
  assert.match(dashboardSource, /pendingApprovals: Math\.max\(0, Number\(currentDashboard\.metrics\.pendingApprovals \|\| 0\) - 1\)/);
  assert.match(dashboardSource, /data-testid="approval-review-modal"/);
  assert.match(dashboardSource, /approvalReview\.item\.decision\?\.safeguards/);
  assert.match(dashboardSource, /required=\{approvalReview\.status === 'rejected' \|\| approvalReview\.item\.data\?\.requiresExceptionOverride === true\}/);
  assert.match(dashboardSource, /confirmation: 'RESET_QA'/);
  assert.match(dashboardSource, /api\('\/api\/operations\/reset-qa\/preview'\)/);
  assert.match(dashboardSource, /planHash/);
  assert.match(qaResetDialogSource, /const CONFIRMATION_PHRASE = 'ARCHIVE QA'/);
  assert.match(qaResetDialogSource, /aria-modal="true"/);
  assert.match(qaResetDialogSource, /headingRef\.current\?\.focus\(\)/);
  assert.match(dashboardRootSource, /qaResetPreviewRequestRef\.current/);
  assert.doesNotMatch(dashboardSource, /window\.(confirm|prompt|alert)\(/);
});

test('finance dashboard plans and invoices retained billing milestones without editable source values', () => {
  assert.match(dashboardSource, /\/billing-milestones`/);
  assert.match(dashboardSource, /create_billing_milestone/);
  assert.match(dashboardSource, /Request milestone approval/);
  assert.match(dashboardSource, /data-testid="invoice-milestone-source"/);
  assert.match(dashboardSource, /billingMilestoneId: milestone\?\.id \|\| ''/);
  assert.match(dashboardSource, /readOnly=\{Boolean\(invoiceDraft\.billingMilestoneId\)\}/);
  assert.match(dashboardSource, /Approved source/);
});

test('finance dashboard completes standalone purchase orders through approved immutable packages and provider receipts', () => {
  assert.match(dashboardSource, /prepare_purchase_order_package/);
  assert.match(dashboardSource, /record_purchase_order_delivery/);
  assert.match(dashboardSource, /purchase-orders\/\$\{encodeURIComponent\(action\.purchaseOrderId\)\}\/issue-package/);
  assert.match(dashboardSource, /data-testid="finance-order-delivery-modal"/);
  assert.match(dashboardSource, /communications\/\$\{encodeURIComponent\(communicationId\)\}\/delivery-receipt/);
  assert.match(dashboardSource, /Download purchase order UBL/);
  assert.match(dashboardSource, /This records an existing delivery receipt; it does not contact the supplier or initiate payment/);
});

test('tender comparison and purchasing controls share the retained operator locale', () => {
  assert.match(dashboardRootSource, /<PipelineWorkspace[\s\S]*text=\{ot\}/);
  assert.match(dashboardRootSource, /<BidPackageWorkspace[\s\S]*text=\{t\}/);
  assert.match(dashboardRootSource, /function BidPackageWorkspace\(\{[\s\S]*text,/);
  assert.match(dashboardRootSource, /ot\('Internal bid package retained\. No invitation or message was sent\.'\)/);
  assert.match(dashboardRootSource, /ot\('Selected bid frozen into purchasing approval\. No supplier contact, award, order, or payment occurred\.'\)/);
  assert.match(dashboardRootSource, /ot\('Verified provider receipt retained for \{reference\}\. The order is now an external commitment; no payment was initiated\.'/);
  assert.match(dashboardRootSource, /t\('No supplier contact, award, order transmission, subcontract signature, or payment occurred\.'\)/);
});

test('finance dashboard freezes server-derived cost forecasts through approval-backed snapshots', () => {
  assert.match(dashboardSource, /function localizedFinanceActionLabel/);
  assert.match(dashboardSource, /function localizedCostForecastWarning/);
  assert.match(dashboardSource, /<FinanceWorkspace[\s\S]*text=\{ot\}/);
  assert.match(dashboardSource, /className="cost-forecast-table-wrap"[\s\S]*tabIndex=\{0\}/);
  assert.match(dashboardSource, /prepare_cost_forecast/);
  assert.match(dashboardSource, /\/cost-forecast\/snapshots`/);
  assert.match(dashboardSource, /Forecast cost/);
  assert.match(dashboardSource, /Forecast margin/);
  assert.match(dashboardSource, /Approved actual/);
  assert.match(dashboardSource, /Unreviewed cost/);
  assert.match(dashboardSource, /Cost to complete/);
  assert.match(dashboardSource, /Cost-code review/);
  assert.match(dashboardSource, /estimateAtCompletion/);
  assert.match(dashboardSource, /review_cost_evidence/);
  assert.match(dashboardSource, /financeActionDraft\.workerId/);
  assert.match(dashboardSource, /workerId: selectedWorker\.id/);
  assert.match(dashboardSource, /Forecast approval freezes this review only/);
  assert.match(dashboardSource, /costForecast\.snapshotCurrent/);
  assert.match(dashboardSource, /awaiting approval/);
  assert.match(dashboardSource, /Cost forecast .* retained from the current cost-code evidence/);
  assert.match(ledgerSource, /billingMilestoneSequence: nextBillingMilestone\?\.sequenceNumber \|\| null/);
  assert.match(ledgerSource, /code: 'unbudgeted_costs_present'[\s\S]*count: summary\.unbudgetedCostCodes/);
  assert.match(ledgerSource, /code: 'purchase_commitment_unreviewed'[\s\S]*amount: roundMoney\(unreviewedCommitment\)/);
});

test('finance dashboard operates an approval-backed 13-week cash-flow forecast', () => {
  assert.match(dashboardSource, /data-testid="cash-flow-control"/);
  assert.match(dashboardSource, /\/api\/ledger\/cash-flow\?/);
  assert.match(dashboardSource, /\/api\/ledger\/cash-flow\/items/);
  assert.match(dashboardSource, /\/api\/ledger\/cash-flow\/snapshots/);
  assert.match(dashboardSource, /13-week cash-flow forecast/);
  assert.match(dashboardSource, /No payment or external commitment was created/);
  assert.match(dashboardSource, /cashFlow\?\.warnings/);
  assert.match(dashboardSource, /canApprove && pendingSnapshot\?\.approvalId/);
  assert.match(dashboardSource, /money\(source\.amount, source\.currency\)/);
});

test('workforce qualifications use retained approval-backed evidence and job readiness controls', () => {
  assert.match(dashboardSource, /api\('\/api\/ledger\/qualifications'\)/);
  assert.match(dashboardSource, /\/qualification-requirements`/);
  assert.match(dashboardSource, /\/credentials`/);
  assert.match(dashboardSource, /data-testid="qualification-workspace"/);
  assert.match(dashboardSource, /data-testid="credential-editor"/);
  assert.match(dashboardSource, /data-testid="qualification-requirement-editor"/);
  assert.match(dashboardSource, /data-testid="qualification-retirement-modal"/);
  assert.match(dashboardSource, /It does not satisfy job readiness until verified/);
  assert.match(dashboardSource, /The requirement remains enforced until approval/);
  assert.match(dashboardSource, /Contractor\.AI does not issue, renew, or contact a certificate authority/);
});

test('worker availability is ledger-backed, privacy-minimized, and cancellation-gated', () => {
  assert.match(dashboardSource, /api\('\/api\/ledger\/availability'\)/);
  assert.match(dashboardSource, /data-testid="availability-workspace"/);
  assert.match(dashboardSource, /data-testid="availability-editor"/);
  assert.match(dashboardSource, /data-testid="availability-cancellation-modal"/);
  assert.match(dashboardSource, /\/availability\/\$\{encodeURIComponent\(availabilityCancellation\.id\)\}\/cancellation/);
  assert.match(dashboardSource, /The scheduling block remains active until approval/);
  assert.match(dashboardSource, /Do not enter diagnosis, illness, medical details, payroll entitlement, HR case information, or location tracking data/);
});

test('field updates use a bounded operator-scoped IndexedDB outbox only for interrupted requests', () => {
  assert.match(outboxSource, /const DATABASE_VERSION = 2/);
  assert.match(outboxSource, /indexedDB\.open\(DATABASE_NAME, DATABASE_VERSION\)/);
  assert.match(outboxSource, /const MAX_EVIDENCE_DRAFTS = 20/);
  assert.match(outboxSource, /const MAX_TOTAL_EVIDENCE_BYTES = 50 \* 1024 \* 1024/);
  assert.match(outboxSource, /const MAX_OPERATION_DRAFTS = 100/);
  assert.match(outboxSource, /const MAX_TOTAL_OPERATION_BYTES = 1024 \* 1024/);
  assert.match(outboxSource, /new Set\(\['progress', 'production_entry', 'daywork_ticket', 'nonconformance', 'daily_huddle', 'daily_cycle_close', 'daily_log', 'inspection_checklist', 'observation', 'incident', 'punch_item', 'attendance_check_in', 'attendance_check_out', 'safety_briefing_acknowledgement', 'work_permit_acknowledgement', 'pre_task_plan_acknowledgement', 'pre_task_plan_suspension', 'lmra_assessment', 'material_receipt', 'expense_receipt', 'environmental_activity', 'equipment_check_out', 'equipment_return', 'five_s_audit'\]\)/);
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
  assert.match(dashboardSource, /window\.addEventListener\('offline', updateNetworkState\)/);
  assert.match(dashboardRootSource, /networkOnline\s*\? \(fieldScoped \? appText\(operatorLocale, 'shell\.fieldScope'\) : appText\(operatorLocale, 'shell\.localFirst'\)\)\s*: appText\(operatorLocale, 'shell\.offlineQueue'\)/);
  assert.match(localeSource, /'shell\.offlineQueue': 'Offline queue'/);
  assert.match(localeSource, /'shell\.offlineQueue': 'Offline wachtrij'/);
  assert.match(dashboardSource, /navigator\.onLine === false && hasLoadedDataRef\.current/);
  assert.match(dashboardSource, /Save huddle offline/);
  assert.match(dashboardSource, /Save EOD report offline/);
  assert.match(dashboardSource, /Save progress offline/);
  assert.match(dashboardSource, /Save checklist offline/);
  assert.match(dashboardSource, /Save observation offline/);
  assert.match(dashboardSource, /Save incident offline/);
  assert.match(dashboardSource, /Save punch item offline/);
  assert.match(dashboardSource, /Save receipt offline/);
  assert.match(dashboardSource, /Save handoff offline/);
  assert.match(dashboardSource, /Save return offline/);
  assert.match(dashboardSource, /Save acknowledgement offline/);
  assert.doesNotMatch(outboxSource, /localStorage|sessionStorage/);
});

test('daywork capture connects offline field evidence to separate acknowledgement and change-order approval gates', () => {
  assert.match(dashboardSource, /data-testid="daywork-control"/);
  assert.match(dashboardSource, /type: 'daywork_ticket'/);
  assert.match(dashboardSource, /type === 'daywork_ticket'/);
  assert.match(dashboardSource, /type: 'nonconformance'/);
  assert.match(dashboardSource, /type === 'nonconformance'/);
  assert.match(dashboardSource, /daywork-tickets\/\$\{encodeURIComponent\(ticketId\)\}\/acknowledgement/);
  assert.match(dashboardSource, /daywork-tickets\/\$\{encodeURIComponent\(ticketId\)\}\/convert/);
  assert.match(dashboardSource, /It does not accept price or scope/);
  assert.match(dashboardSource, /Conversion creates a separate approval-gated change order/);
});

test('governed safety briefings connect office scheduling, worker-scoped offline acknowledgement, and approval-backed signoff', () => {
  assert.match(dashboardSource, /api\('\/api\/ledger\/safety-briefings\?limit=100'\)/);
  assert.match(dashboardSource, /data-testid="safety-briefing-control"/);
  assert.match(dashboardSource, /type: 'safety_briefing_acknowledgement'/);
  assert.match(dashboardSource, /safety-meetings\/\$\{encodeURIComponent\(safetyMeetingId\)\}\/acknowledgments/);
  assert.match(dashboardSource, /\/signoff`/);
  assert.match(dashboardSource, /\/attendees\/\$\{encodeURIComponent\(attendee\.id\)\}\/excuse/);
  assert.match(dashboardSource, /I attended this briefing, understood the retained topics/);
  assert.match(dashboardSource, /Request signoff approval/);
  assert.match(dashboardSource, /do not certify legal compliance/i);
});

test('governed work permits connect approval, scoped offline acknowledgement, stop work, and closeout', () => {
  assert.match(dashboardSource, /fieldScoped \? Promise\.resolve\(\{ rows: \[\], summary: \{\} \}\) : api\('\/api\/ledger\/field-assurance\?limit=100'\)/);
  assert.match(dashboardSource, /api\('\/api\/ledger\/work-permits\?limit=100'\)/);
  assert.match(dashboardSource, /data-testid="work-permit-control"/);
  assert.match(dashboardSource, /type: 'work_permit_acknowledgement'/);
  assert.match(dashboardSource, /work-permits\/\$\{encodeURIComponent\(workPermitId\)\}\/acknowledgments/);
  assert.match(dashboardSource, /\/work-permits\/\$\{encodeURIComponent\(selectedWorkPermit\.id\)\}\/suspend/);
  assert.match(dashboardSource, /\/work-permits\/\$\{encodeURIComponent\(selectedWorkPermit\.id\)\}\/close/);
  assert.match(dashboardSource, /I reviewed this permit, understand the hazards and controls/);
  assert.match(dashboardSource, /Stop work until the live ledger confirms readiness/);
  assert.match(dashboardSource, /Request permit activation/);
});

test('material receiving connects purchasing, field readiness, approvals, and supplier invoice matching', () => {
  assert.match(dashboardSource, /api\('\/api\/ledger\/material-receipts\?limit=500'\)/);
  assert.match(dashboardSource, /data-testid="material-receiving-workspace"/);
  assert.match(dashboardSource, /data-testid="field-material-receipt-form"/);
  assert.match(dashboardSource, /type: 'material_receipt'/);
  assert.match(dashboardSource, /type === 'material_receipt'\s*\?\s*'material-receipts'/);
  assert.match(dashboardSource, /material-receipts\/\$\{encodeURIComponent\(materialReceiptReversal\.id\)\}\/reversal/);
  assert.match(dashboardSource, /materialReceiptId: financeActionDraft\.materialReceiptId \|\| null/);
  assert.match(dashboardSource, /Retained goods receipt/);
  assert.match(dashboardSource, /verified three-way match/);
});

test('governed expense receipts connect field capture, offline replay, approval, finance cost, and reversal', () => {
  assert.match(dashboardSource, /data-testid="field-expense-receipt-form"/);
  assert.match(dashboardSource, /type: 'expense_receipt'/);
  assert.match(dashboardSource, /type === 'expense_receipt'\s*\?\s*'expense-receipts'/);
  assert.match(dashboardSource, /type: 'environmental_activity'/);
  assert.match(dashboardSource, /type === 'environmental_activity'\s*\?\s*'environmental-activities'/);
  assert.match(dashboardSource, /expense-receipts\?limit=8/);
  assert.match(dashboardSource, /entryKey: financeActionDraft\.entryKey/);
  assert.match(dashboardSource, /taxTreatment: financeActionDraft\.taxTreatment/);
  assert.match(dashboardSource, /paymentMethod: financeActionDraft\.paymentMethod/);
  assert.match(dashboardSource, /request_expense_reversal/);
  assert.match(dashboardSource, /expense-receipts\/\$\{encodeURIComponent\(financeAction\.action\.expenseId\)\}\/reversal/);
  assert.match(dashboardSource, /No reimbursement or payment was initiated/);
});

test('equipment custody connects reservations, field handoff, exact offline retry, return quarantine, and office review', () => {
  assert.match(dashboardSource, /api\('\/api\/ledger\/equipment-custody\?limit=500'\)/);
  assert.match(dashboardSource, /data-testid="equipment-custody-register"/);
  assert.match(dashboardSource, /data-testid="equipment-checkout-modal"/);
  assert.match(dashboardSource, /data-testid="equipment-return-modal"/);
  assert.match(dashboardSource, /data-testid="field-equipment-checkout-form"/);
  assert.match(dashboardSource, /data-testid="field-equipment-return-form"/);
  assert.match(dashboardSource, /type: 'equipment_check_out'/);
  assert.match(dashboardSource, /type: 'equipment_return'/);
  assert.match(dashboardSource, /equipment-custody\/check-out/);
  assert.match(dashboardSource, /equipment-custody\/\$\{encodeURIComponent\(custodySessionId\)\}\/return/);
  assert.match(dashboardSource, /Damaged, unsafe, and lost returns are quarantined automatically/);
});

test('governed 5S connects approved standards, canonical equipment state, corrective action, and exact offline replay', () => {
  const source = `${dashboardSource}\n${fiveSWorkspaceSource}`;
  assert.match(fiveSWorkspaceSource, /'field-five-s-workspace' : 'five-s-workspace'/);
  assert.match(fiveSWorkspaceSource, /data-testid="five-s-location-form"/);
  assert.match(fiveSWorkspaceSource, /data-testid="five-s-standard-form"/);
  assert.match(fiveSWorkspaceSource, /'field-five-s-audit-form' : 'five-s-audit-form'/);
  assert.match(source, /type: 'five_s_audit'/);
  assert.match(source, /type === 'five_s_audit'/);
  assert.match(source, /five-s\/locations\/\$\{encodeURIComponent\(fiveSLocationId\)\}\/audits/);
  assert.match(source, /exact approved standard revision/i);
  assert.match(fiveSWorkspaceSource, /Canonical equipment link/);
  assert.match(fiveSWorkspaceSource, /do not change tool custody or status, dispatch a vehicle/i);
});

test('LMRA control binds exact plan sources, stop-work, reassessment, and offline non-authorization', () => {
  const source = `${dashboardRootSource}\n${lmraControlSource}`;
  assert.match(source, /type: 'lmra_assessment'/);
  assert.match(dashboardRootSource, /type === 'lmra_assessment'/);
  assert.match(lmraControlSource, /data-testid="lmra-control"/);
  assert.match(lmraControlSource, /Work is not authorized until the live ledger validates current sources/i);
  assert.match(lmraControlSource, /reassessmentOfId: needsReassessmentEvidence/);
  assert.match(lmraControlSource, /no_changed_conditions/);
});

test('job workspace schedules governed installation QC and immutable approval-backed inspection checklists', () => {
  assert.match(dashboardSource, /data-testid="inspection-checklist-control"/);
  assert.match(dashboardSource, /data-testid="inspection-template-form"/);
  assert.match(dashboardSource, /data-testid="inspection-schedule-form"/);
  assert.match(dashboardSource, /data-testid="inspection-checklist-form"/);
  assert.match(dashboardSource, /data-testid="installation-qc-context"/);
  assert.match(dashboardSource, /api\('\/api\/ledger\/inspection-templates'/);
  assert.match(dashboardSource, /\/inspection-checklists`/);
  assert.match(dashboardSource, /\/checklist-submissions`/);
  assert.match(dashboardSource, /type: 'inspection_checklist'/);
  assert.match(dashboardSource, /Govern task completion as installation QC/);
  assert.match(dashboardSource, /Evidence required to pass/);
  assert.match(dashboardSource, /Offline capture may queue evidence, but never releases a hold point or completes the task/);
});

test('governed photo evidence connects office scheduling, worker-scoped sequence capture, offline replay, and independent release', () => {
  assert.match(dashboardSource, /data-testid="photo-evidence-control"/);
  assert.match(dashboardSource, /data-testid="photo-evidence-schedule-form"/);
  assert.match(dashboardRootSource, /data-testid="field-evidence-form"/);
  assert.match(dashboardRootSource, /data-testid="photo-evidence-context"/);
  assert.match(dashboardRootSource, /\/photo-evidence`/);
  assert.match(dashboardRootSource, /\/photo-evidence\/\$\{encodeURIComponent\(setId\)\}\/review/);
  assert.match(dashboardRootSource, /payload\.append\('photoEvidencePhase', photoEvidencePhase\)/);
  assert.match(dashboardRootSource, /payload\.append\('capturedAt', new Date\(capturedAt\)\.toISOString\(\)\)/);
  assert.match(outboxSource, /photoEvidenceSetId: String\(photoEvidenceSetId \|\| ''\)/);
  assert.match(outboxSource, /photoEvidencePhase: String\(photoEvidencePhase \|\| ''\)/);
  assert.match(outboxSource, /capturedAt: String\(capturedAt \|\| ''\)/);
  assert.match(dashboardSource, /Offline capture can queue files and metadata, but cannot request review, release evidence, or complete the task/);
});

test('dashboard loads a field worker only through scoped ledger calls and hides owner workflow navigation', () => {
  assert.match(dashboardSource, /const fieldScoped = operator\.fieldScoped === true/);
  assert.match(dashboardSource, /const visibleNavItems = useMemo\(\s*\(\) =>\s*navItems\.filter/);
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
  assert.match(dashboardSource, /type === 'progress'\s*\?\s*'progress'/);
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
  assert.match(dashboardSource, /data-testid="runtime-exposure-readiness"/);
  assert.match(dashboardSource, /data-testid="hai-connector-readiness"/);
  assert.match(dashboardSource, /href="\/api\/integrations\/hai\/feed\?limit=100"/);
  assert.match(dashboardSource, /Export HAI feed/);
  assert.match(dashboardSource, /operations\/backups\/\$\{encodeURIComponent\(backup\.backupId\)\}\/download/);
  assert.match(dashboardSource, /command-plan\?limit=100&jobLimit=12/);
  assert.match(dashboardSource, /if \(next === 'operations'\) void refreshOperationsCommandPlan\(sequence\)/);
  assert.match(dashboardSource, /Preparing the bounded command plan/);
  assert.match(dashboardSource, /<FileDown size=\{15\} \/>\s*Download\s*<\/a>/);
  assert.match(dashboardSource, /Validate export/);
  assert.match(dashboardSource, /Check restore/);
  assert.match(dashboardSource, /It cannot restore the database or evidence\s+files/);
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
  assert.match(dashboardSource, /data-testid="commercial-delivery-modal"/);
  assert.match(dashboardSource, /server-derived totals/);
  assert.match(dashboardSource, /quotes\/\$\{encodeURIComponent\(record\.id\)\}\/acceptance/);
  assert.match(dashboardSource, /change-orders\/\$\{encodeURIComponent\(record\.id\)\}\/acceptance/);
  assert.match(dashboardSource, /change-orders\/\$\{encodeURIComponent\(changeOrder\.id\)\}\/issue-package/);
  assert.match(
    dashboardSource,
    /communications\/\$\{encodeURIComponent\(commercialDelivery\.communication\.id\)\}\/delivery-receipt/
  );
  assert.match(dashboardSource, /acceptedAt: commercialAcceptanceDraft\.acceptedAt/);
  assert.match(dashboardSource, /Contract value remains unchanged until client acceptance is verified/);
  assert.match(dashboardSource, /Internal change-order approval alone does not alter contract value|internal approval request/);
  assert.match(dashboardSource, /commercialDialogOpenerRef\.current = document\.activeElement/);
  assert.match(dashboardSource, /commercialDialogReturnFocusRef = useRef\(false\)/);
  assert.match(dashboardSource, /if \(opener\?\.isConnected && !opener\.disabled\) opener\.focus\(\)/);
  assert.match(dashboardSource, /\[commercialAcceptance, commercialDelivery, commercialDraftMode, submitting, takeoffDialog\]/);
  assert.match(dashboardSource, /if \(selectedJobId\) closeJobWorkspace\(\)/);
});

test('job archive and restore controls use retained approval-gated ledger routes', () => {
  assert.match(dashboardSource, /api\('\/api\/ledger\/jobs\?archiveOnly=true&limit=100'\)/);
  assert.match(dashboardSource, /`\/api\/ledger\/jobs\/\$\{encodeURIComponent\(job\.id\)\}\/\$\{mode\}\?includeDashboard=false`/);
  assert.match(dashboardSource, /data-testid="job-archive-control"/);
  assert.match(dashboardSource, /data-testid="job-archive-registry"/);
  assert.match(dashboardSource, /data-testid="job-lifecycle-modal"/);
  assert.match(dashboardSource, /The complete job ledger, evidence, finance, field, client, resource, and audit history remains retained/);
  assert.match(dashboardSource, /No message, cancellation, supplier order, payment, safety clearance, or schedule commitment is triggered/);
});

test('client success exposes immutable handover readiness, preparation, and download controls', () => {
  assert.match(dashboardSource, /api\(`\/api\/ledger\/jobs\/\$\{encodeURIComponent\(item\.jobId\)\}\/handover-packages`/);
  assert.match(dashboardSource, /prepareClientHandover/);
  assert.match(dashboardSource, /Prepare dossier/);
  assert.match(dashboardSource, /Download dossier/);
  assert.match(dashboardSource, /handoverReadiness\?\.currentPackageId/);
  assert.match(dashboardSource, /Immutable handover dossier retained\. Client delivery is a separate approval-gated step\./);
});

test('client portal is a scoped React workflow without imperative HTML rendering', () => {
  assert.match(clientPortalSource, /\/api\/client-portal\/\$\{encodeURIComponent\(token\)\}/);
  assert.match(clientPortalSource, /\/messages`/);
  assert.match(clientPortalSource, /\/feedback`/);
  assert.match(clientPortalSource, /\/selections\/\$\{encodeURIComponent\(selection\.id\)\}\/responses/);
  assert.match(clientPortalSource, /\/change-orders\/\$\{encodeURIComponent\(variation\.id\)\}\/responses/);
  assert.match(clientPortalSource, /\/change-orders\/\$\{encodeURIComponent\(variation\.id\)\}\/package/);
  assert.match(clientPortalSource, /responseId: createResponseId\(\)/);
  assert.match(clientPortalSource, /Ter beoordeling indienen/);
  assert.match(clientPortalSource, /Meer- en minderwerk/);
  assert.match(clientPortalSource, /Ik ben bevoegd om dit voorstel namens de opdrachtgever te accepteren/);
  assert.match(clientPortalSource, /Tot die verificatie wijzigt geen contractsom en is het extra werk niet geautoriseerd/);
  assert.match(clientPortalSource, /Hiermee wijzigt u geen prijs, planning, opdracht of bestelling/);
  assert.match(clientPortalSource, /Hoe waarschijnlijk is het dat u ons aanbeveelt/);
  assert.match(clientPortalSource, /Mijn reactie mag intern worden beoordeeld voor een mogelijke referentie/);
  assert.match(clientPortalSource, /payload\.portal\?\.feedback\?\.submitted === true/);
  assert.match(clientPortalSource, /new URLSearchParams\(window\.location\.hash\.slice\(1\)\)/);
  assert.match(clientPortalSource, /noindex, nofollow/);
  assert.doesNotMatch(clientPortalSource, /innerHTML|document\.getElementById|addEventListener/);
});

test('operator closeout connects evidence-backed feedback to internal-only recovery visibility', () => {
  assert.match(dashboardSource, /recordType === 'client_feedback'\s*\? 'client-feedback'/);
  assert.match(dashboardSource, /`\/api\/ledger\/jobs\/\$\{encodeURIComponent\(selectedJobId\)\}\/\$\{route\}`/);
  assert.match(dashboardSource, /data-testid=\{`closeout-\$\{view\}-form`\}/);
  assert.match(dashboardSource, /Internal recovery required/);
  assert.match(dashboardSource, /This retains an internal record only\. It does not certify completion, accept liability, authorize cost, book work, or contact the client\./);
});
