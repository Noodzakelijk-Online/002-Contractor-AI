const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { AUDIT_CHAIN_ID, verifyAuditChainRows } = require('../operating-ledger');

const projectRoot = path.resolve(__dirname, '..');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    parsed[key] = values[index + 1] && !values[index + 1].startsWith('--') ? values[++index] : true;
  }
  return parsed;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeBackupDirectory(dataDir, backupId) {
  if (!/^[A-Za-z0-9._-]+$/.test(backupId || '')) throw new Error('Backup id is invalid.');
  const backupRoot = path.resolve(dataDir, 'backups');
  const backupDir = path.resolve(backupRoot, backupId);
  if (path.dirname(backupDir) !== backupRoot) throw new Error('Backup id is invalid.');
  return { backupRoot, backupDir };
}

function safeManifestTarget(root, manifestPath) {
  const normalized = String(manifestPath || '').replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (!normalized || path.posix.isAbsolute(normalized) || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Backup manifest contains an unsafe file path: ${manifestPath}`);
  }
  const target = path.resolve(root, ...segments);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Backup manifest contains an unsafe file path: ${manifestPath}`);
  return target;
}

function verifyManifest(backupDir) {
  const manifestFile = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error('Backup manifest was not found.');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (!['contractor-ai-backup-manifest/v1', 'contractor-ai-backup-manifest/v2'].includes(manifest?.format) || !Array.isArray(manifest.files)) {
    throw new Error('Backup manifest is invalid.');
  }
  for (const entry of manifest.files) {
    const file = String(entry?.file || '');
    const target = safeManifestTarget(backupDir, file);
    if (!fs.existsSync(target)) throw new Error(`Backup file is missing: ${file}`);
    const stats = fs.lstatSync(target);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`Backup file type is unsafe: ${file}`);
    if (stats.size !== Number(entry.bytes) || sha256(target) !== entry.sha256) {
      throw new Error(`Backup checksum failed: ${file}`);
    }
  }
  if (manifest.format === 'contractor-ai-backup-manifest/v2') {
    const evidenceEntries = manifest.files.filter(entry => String(entry?.file || '').replace(/\\/g, '/').startsWith('evidence/'));
    if (manifest.databaseMode === 'sqlite' && (manifest.evidence?.included !== true || Number(manifest.evidence?.fileCount) !== evidenceEntries.length)) {
      throw new Error('Backup evidence manifest is incomplete.');
    }
  }
  return manifest;
}

function verifySqliteBackupDatabase(ledgerFile) {
  const sourceFile = path.resolve(ledgerFile);
  const verificationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-sqlite-check-'));
  const verificationFile = path.join(verificationDirectory, path.basename(sourceFile));
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const source = `${sourceFile}${suffix}`;
      if (fs.existsSync(source)) fs.copyFileSync(source, `${verificationFile}${suffix}`);
    }
    const database = new DatabaseSync(verificationFile, { readOnly: true });
    try {
      const integrity = database.prepare('PRAGMA integrity_check').all();
      if (!integrity.length || integrity.some(row => row.integrity_check !== 'ok')) {
        throw new Error('Backup SQLite integrity check failed.');
      }
      const requiredTables = ['audit_events', 'jobs', 'ledger_schema_migrations'];
      const retainedTables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
      const missingTables = requiredTables.filter(table => !retainedTables.has(table));
      if (missingTables.length) throw new Error(`Backup ledger schema is incomplete: ${missingTables.join(', ')}.`);
      const appliedMigrations = new Set(database.prepare('SELECT version FROM ledger_schema_migrations').all().map(row => row.version));
      if (appliedMigrations.has('018_supplier_payables')) {
        const payableTables = ['supplier_invoices', 'supplier_invoice_payments'];
        const missingPayableTables = payableTables.filter(table => !retainedTables.has(table));
        if (missingPayableTables.length) {
          throw new Error(`Backup supplier-payable schema is incomplete: ${missingPayableTables.join(', ')}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        const payableIndexes = ['idx_supplier_invoices_duplicate_key', 'idx_supplier_invoice_payments_reconciliation_key'];
        const missingPayableIndexes = payableIndexes.filter(index => !retainedIndexes.has(index));
        if (missingPayableIndexes.length) {
          throw new Error(`Backup supplier-payable constraints are incomplete: ${missingPayableIndexes.join(', ')}.`);
        }
      }
      if (appliedMigrations.has('019_billing_milestones')) {
        if (!retainedTables.has('billing_milestones')) {
          throw new Error('Backup billing-milestone schema is incomplete: billing_milestones.');
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        const milestoneIndexes = ['idx_billing_milestones_job_status', 'idx_billing_milestones_due'];
        const missingMilestoneIndexes = milestoneIndexes.filter(index => !retainedIndexes.has(index));
        if (missingMilestoneIndexes.length) {
          throw new Error(`Backup billing-milestone constraints are incomplete: ${missingMilestoneIndexes.join(', ')}.`);
        }
      }
      if (appliedMigrations.has('020_project_schedule_baselines')) {
        const scheduleTables = ['task_dependencies', 'schedule_baselines'];
        const missingScheduleTables = scheduleTables.filter(table => !retainedTables.has(table));
        if (missingScheduleTables.length) {
          throw new Error(`Backup project-schedule schema is incomplete: ${missingScheduleTables.join(', ')}.`);
        }
        const taskColumns = new Set(database.prepare('PRAGMA table_info(job_tasks)').all().map(row => row.name));
        const missingTaskColumns = ['planned_start', 'planned_end', 'duration_hours'].filter(column => !taskColumns.has(column));
        if (missingTaskColumns.length) {
          throw new Error(`Backup project-schedule task columns are incomplete: ${missingTaskColumns.join(', ')}.`);
        }
        const baselineColumns = new Set(database.prepare('PRAGMA table_info(schedule_baselines)').all().map(row => row.name));
        const missingBaselineColumns = ['approval_id', 'plan_hash', 'snapshot_hash', 'snapshot_json'].filter(column => !baselineColumns.has(column));
        if (missingBaselineColumns.length) {
          throw new Error(`Backup project-schedule baseline columns are incomplete: ${missingBaselineColumns.join(', ')}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        const scheduleIndexes = ['idx_task_dependencies_job', 'idx_task_dependencies_successor', 'idx_schedule_baselines_job', 'idx_schedule_baselines_status'];
        const missingScheduleIndexes = scheduleIndexes.filter(index => !retainedIndexes.has(index));
        if (missingScheduleIndexes.length) {
          throw new Error(`Backup project-schedule constraints are incomplete: ${missingScheduleIndexes.join(', ')}.`);
        }
      }
      if (appliedMigrations.has('021_preconstruction_opportunities')) {
        const opportunityTables = ['opportunities', 'opportunity_activities'];
        const missingOpportunityTables = opportunityTables.filter(table => !retainedTables.has(table));
        if (missingOpportunityTables.length) {
          throw new Error(`Backup preconstruction-pipeline schema is incomplete: ${missingOpportunityTables.join(', ')}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        const opportunityIndexes = [
          'idx_opportunities_stage_follow_up',
          'idx_opportunities_client',
          'idx_opportunities_converted_job',
          'idx_opportunity_activities_due',
          'idx_opportunity_activities_idempotency'
        ];
        const missingOpportunityIndexes = opportunityIndexes.filter(index => !retainedIndexes.has(index));
        if (missingOpportunityIndexes.length) {
          throw new Error(`Backup preconstruction-pipeline constraints are incomplete: ${missingOpportunityIndexes.join(', ')}.`);
        }
      }
      if (appliedMigrations.has('022_controlled_document_revisions')) {
        const documentColumns = new Set(database.prepare('PRAGMA table_info(documents)').all().map(row => row.name));
        const missingDocumentColumns = ['document_number', 'revision', 'discipline', 'effective_at', 'supersedes_document_id']
          .filter(column => !documentColumns.has(column));
        if (missingDocumentColumns.length) {
          throw new Error(`Backup controlled-document columns are incomplete: ${missingDocumentColumns.join(', ')}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        const documentIndexes = [
          'idx_documents_job_number_revision',
          'idx_documents_controlled_current',
          'idx_documents_single_candidate',
          'idx_documents_supersedes'
        ];
        const missingDocumentIndexes = documentIndexes.filter(index => !retainedIndexes.has(index));
        if (missingDocumentIndexes.length) {
          throw new Error(`Backup controlled-document constraints are incomplete: ${missingDocumentIndexes.join(', ')}.`);
        }
      }
      if (appliedMigrations.has('023_document_transmittals')) {
        const transmittalTables = ['transmittal_number_sequences', 'document_transmittals', 'transmittal_receipts'];
        const missingTransmittalTables = transmittalTables.filter(table => !retainedTables.has(table));
        if (missingTransmittalTables.length) {
          throw new Error(`Backup document-transmittal schema is incomplete: ${missingTransmittalTables.join(', ')}.`);
        }
        const transmittalColumns = new Set(database.prepare('PRAGMA table_info(document_transmittals)').all().map(row => row.name));
        const missingTransmittalColumns = ['transmittal_number', 'approval_id', 'documents_json', 'recipients_json', 'snapshot_hash', 'delivery_reference']
          .filter(column => !transmittalColumns.has(column));
        if (missingTransmittalColumns.length) {
          throw new Error(`Backup document-transmittal columns are incomplete: ${missingTransmittalColumns.join(', ')}.`);
        }
        const receiptColumns = new Set(database.prepare('PRAGMA table_info(transmittal_receipts)').all().map(row => row.name));
        const missingReceiptColumns = ['recipient_key', 'status', 'acknowledged_at', 'acknowledged_by', 'evidence_reference']
          .filter(column => !receiptColumns.has(column));
        if (missingReceiptColumns.length) {
          throw new Error(`Backup transmittal-receipt columns are incomplete: ${missingReceiptColumns.join(', ')}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        const transmittalIndexes = ['idx_document_transmittals_job', 'idx_document_transmittals_status', 'idx_transmittal_receipts_due'];
        const missingTransmittalIndexes = transmittalIndexes.filter(index => !retainedIndexes.has(index));
        if (missingTransmittalIndexes.length) {
          throw new Error(`Backup document-transmittal constraints are incomplete: ${missingTransmittalIndexes.join(', ')}.`);
        }
      }
      if (appliedMigrations.has('024_project_meeting_minutes')) {
        const meetingTables = ['project_meeting_number_sequences', 'project_meetings', 'meeting_action_items'];
        const missingMeetingTables = meetingTables.filter(table => !retainedTables.has(table));
        if (missingMeetingTables.length) {
          throw new Error(`Backup project-meeting schema is incomplete: ${missingMeetingTables.join(', ')}.`);
        }
        const meetingColumns = new Set(database.prepare('PRAGMA table_info(project_meetings)').all().map(row => row.name));
        const missingMeetingColumns = ['meeting_number', 'attendees_json', 'agenda_json', 'decisions_json', 'approval_id', 'snapshot_hash', 'delivery_reference', 'follows_meeting_id']
          .filter(column => !meetingColumns.has(column));
        if (missingMeetingColumns.length) {
          throw new Error(`Backup project-meeting columns are incomplete: ${missingMeetingColumns.join(', ')}.`);
        }
        const actionColumns = new Set(database.prepare('PRAGMA table_info(meeting_action_items)').all().map(row => row.name));
        const missingActionColumns = ['item_number', 'owner_name', 'linked_task_id', 'completion_evidence', 'carried_from_action_id']
          .filter(column => !actionColumns.has(column));
        if (missingActionColumns.length) {
          throw new Error(`Backup meeting-action columns are incomplete: ${missingActionColumns.join(', ')}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        const meetingIndexes = [
          'idx_project_meetings_job',
          'idx_project_meetings_status',
          'idx_project_meetings_follows',
          'idx_meeting_actions_due',
          'idx_meeting_actions_meeting',
          'idx_meeting_actions_task',
          'idx_meeting_actions_active_carryover'
        ];
        const missingMeetingIndexes = meetingIndexes.filter(index => !retainedIndexes.has(index));
        if (missingMeetingIndexes.length) {
          throw new Error(`Backup project-meeting constraints are incomplete: ${missingMeetingIndexes.join(', ')}.`);
        }
      }
      if (appliedMigrations.has('025_inspection_checklists')) {
        const checklistTables = ['inspection_templates', 'inspection_checklist_submissions'];
        const missingChecklistTables = checklistTables.filter(table => !retainedTables.has(table));
        if (missingChecklistTables.length) {
          throw new Error(`Backup inspection-checklist schema is incomplete: ${missingChecklistTables.join(', ')}.`);
        }
        const templateColumns = new Set(database.prepare('PRAGMA table_info(inspection_templates)').all().map(row => row.name));
        const missingTemplateColumns = ['template_key', 'version_number', 'items_json', 'status']
          .filter(column => !templateColumns.has(column));
        if (missingTemplateColumns.length) {
          throw new Error(`Backup inspection-template columns are incomplete: ${missingTemplateColumns.join(', ')}.`);
        }
        const submissionColumns = new Set(database.prepare('PRAGMA table_info(inspection_checklist_submissions)').all().map(row => row.name));
        const missingSubmissionColumns = ['inspection_id', 'job_id', 'snapshot_json', 'snapshot_hash', 'approval_id', 'failed_count']
          .filter(column => !submissionColumns.has(column));
        if (missingSubmissionColumns.length) {
          throw new Error(`Backup inspection-checklist submission columns are incomplete: ${missingSubmissionColumns.join(', ')}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        const checklistIndexes = [
          'idx_inspection_templates_active',
          'idx_inspection_templates_current',
          'idx_inspection_checklist_inspection',
          'idx_inspection_checklist_job',
          'idx_inspection_checklist_approval'
        ];
        const missingChecklistIndexes = checklistIndexes.filter(index => !retainedIndexes.has(index));
        if (missingChecklistIndexes.length) {
          throw new Error(`Backup inspection-checklist constraints are incomplete: ${missingChecklistIndexes.join(', ')}.`);
        }
      }
      if (appliedMigrations.has('026_preconstruction_bid_packages')) {
        const bidTables = ['bid_package_number_sequences', 'bid_packages', 'bid_package_participants'];
        const missingBidTables = bidTables.filter(table => !retainedTables.has(table));
        if (missingBidTables.length) {
          throw new Error(`Backup preconstruction-bid schema is incomplete: ${missingBidTables.join(', ')}.`);
        }
        const packageColumns = new Set(database.prepare('PRAGMA table_info(bid_packages)').all().map(row => row.name));
        const missingPackageColumns = ['opportunity_id', 'package_number', 'status', 'approval_id', 'selected_bid_participant_id', 'comparison_hash']
          .filter(column => !packageColumns.has(column));
        if (missingPackageColumns.length) {
          throw new Error(`Backup bid-package columns are incomplete: ${missingPackageColumns.join(', ')}.`);
        }
        const participantColumns = new Set(database.prepare('PRAGMA table_info(bid_package_participants)').all().map(row => row.name));
        const missingParticipantColumns = ['bid_package_id', 'trade_partner_id', 'status', 'total', 'evidence_reference']
          .filter(column => !participantColumns.has(column));
        if (missingParticipantColumns.length) {
          throw new Error(`Backup bid-participant columns are incomplete: ${missingParticipantColumns.join(', ')}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        const bidIndexes = [
          'idx_bid_packages_opportunity',
          'idx_bid_packages_portfolio',
          'idx_bid_packages_approval',
          'idx_bid_participants_package',
          'idx_bid_participants_partner'
        ];
        const missingBidIndexes = bidIndexes.filter(index => !retainedIndexes.has(index));
        if (missingBidIndexes.length) {
          throw new Error(`Backup preconstruction-bid constraints are incomplete: ${missingBidIndexes.join(', ')}.`);
        }
      }
      if (appliedMigrations.has('027_quantity_takeoffs')) {
        const takeoffTables = ['takeoff_sheets', 'takeoff_items'];
        const missingTakeoffTables = takeoffTables.filter(table => !retainedTables.has(table));
        if (missingTakeoffTables.length) {
          throw new Error(`Backup quantity-takeoff schema is incomplete: ${missingTakeoffTables.join(', ')}.`);
        }
        const sheetColumns = new Set(database.prepare('PRAGMA table_info(takeoff_sheets)').all().map(row => row.name));
        const missingSheetColumns = ['job_id', 'status', 'total_cost', 'subtotal', 'quote_id', 'snapshot_hash']
          .filter(column => !sheetColumns.has(column));
        if (missingSheetColumns.length) {
          throw new Error(`Backup quantity-takeoff columns are incomplete: ${missingSheetColumns.join(', ')}.`);
        }
        const itemColumns = new Set(database.prepare('PRAGMA table_info(takeoff_items)').all().map(row => row.name));
        const missingItemColumns = ['takeoff_id', 'measurement_type', 'quantity', 'unit_cost', 'unit_price', 'total_cost', 'total_price']
          .filter(column => !itemColumns.has(column));
        if (missingItemColumns.length) {
          throw new Error(`Backup takeoff-item columns are incomplete: ${missingItemColumns.join(', ')}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        const takeoffIndexes = [
          'idx_takeoff_sheets_job',
          'idx_takeoff_sheets_quote',
          'idx_takeoff_items_sheet',
          'idx_takeoff_items_cost_code'
        ];
        const missingTakeoffIndexes = takeoffIndexes.filter(index => !retainedIndexes.has(index));
        if (missingTakeoffIndexes.length) {
          throw new Error(`Backup quantity-takeoff constraints are incomplete: ${missingTakeoffIndexes.join(', ')}.`);
        }
      }
      if (appliedMigrations.has('028_bid_commitment_bridge')) {
        const packageColumns = new Set(database.prepare('PRAGMA table_info(bid_packages)').all().map(row => row.name));
        const missingCommitmentColumns = ['purchase_order_id', 'commitment_hash']
          .filter(column => !packageColumns.has(column));
        if (missingCommitmentColumns.length) {
          throw new Error(`Backup bid-commitment columns are incomplete: ${missingCommitmentColumns.join(', ')}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        const commitmentIndexes = ['idx_bid_packages_purchase_order', 'idx_bid_packages_commitment'];
        const missingCommitmentIndexes = commitmentIndexes.filter(index => !retainedIndexes.has(index));
        if (missingCommitmentIndexes.length) {
          throw new Error(`Backup bid-commitment constraints are incomplete: ${missingCommitmentIndexes.join(', ')}.`);
        }
      }
      if (appliedMigrations.has('029_purchase_order_issue_packages')) {
        if (!retainedTables.has('purchase_order_number_sequences')) {
          throw new Error('Backup purchase-order issue schema is incomplete: purchase_order_number_sequences.');
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        if (!retainedIndexes.has('idx_purchase_orders_issue_status')) {
          throw new Error('Backup purchase-order issue constraints are incomplete: idx_purchase_orders_issue_status.');
        }
      }
      if (appliedMigrations.has('030_change_order_issue_packages')) {
        if (!retainedTables.has('change_order_number_sequences')) {
          throw new Error('Backup change-order issue schema is incomplete: change_order_number_sequences.');
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        if (!retainedIndexes.has('idx_change_orders_issue_status')) {
          throw new Error('Backup change-order issue constraints are incomplete: idx_change_orders_issue_status.');
        }
      }
      if (appliedMigrations.has('031_cost_forecast_snapshots')) {
        for (const table of ['cost_forecast_number_sequences', 'cost_forecast_snapshots']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup cost-forecast schema is incomplete: ${table}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of ['idx_cost_forecast_snapshots_job', 'idx_cost_forecast_snapshots_status']) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup cost-forecast constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('032_production_control')) {
        for (const table of ['production_baselines', 'production_entries']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup production-control schema is incomplete: ${table}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_production_baselines_job',
          'idx_production_baselines_status',
          'idx_production_entries_job_date',
          'idx_production_entries_baseline_line'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup production-control constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('033_site_attendance')) {
        for (const table of ['attendance_sessions', 'attendance_adjustments']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup site-attendance schema is incomplete: ${table}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_attendance_sessions_job_time',
          'idx_attendance_sessions_worker_status',
          'idx_attendance_sessions_worker_open',
          'idx_attendance_adjustments_session_status',
          'idx_attendance_adjustments_pending'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup site-attendance constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('034_weekly_timesheets')) {
        for (const table of ['weekly_timesheets', 'timesheet_exports']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup weekly-timesheet schema is incomplete: ${table}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_weekly_timesheets_worker_period',
          'idx_weekly_timesheets_period_status',
          'idx_weekly_timesheets_pending',
          'idx_weekly_timesheets_approved',
          'idx_timesheet_exports_period'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup weekly-timesheet constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('035_workforce_qualifications')) {
        for (const table of ['worker_credentials', 'job_qualification_requirements']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup workforce-qualification schema is incomplete: ${table}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_worker_credentials_worker_type',
          'idx_worker_credentials_expiry',
          'idx_worker_credentials_pending',
          'idx_worker_credentials_approved',
          'idx_job_qualification_requirements_job',
          'idx_job_qualification_requirements_status'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup workforce-qualification constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('036_worker_availability')) {
        if (!retainedTables.has('worker_availability_periods')) {
          throw new Error('Backup worker-availability schema is incomplete: worker_availability_periods.');
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_worker_availability_worker_window',
          'idx_worker_availability_current',
          'idx_worker_availability_pending_cancellation'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup worker-availability constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('037_material_receiving')) {
        for (const table of ['material_receipts', 'material_receipt_lines']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup material-receiving schema is incomplete: ${table}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_material_receipts_job_delivery',
          'idx_material_receipts_purchase_order',
          'idx_material_receipts_exception',
          'idx_material_receipts_pending_reversal',
          'idx_material_receipt_lines_requirement'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup material-receiving constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('038_equipment_custody')) {
        if (!retainedTables.has('equipment_custody_sessions')) {
          throw new Error('Backup equipment-custody schema is incomplete: equipment_custody_sessions.');
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_equipment_custody_active_tool',
          'idx_equipment_custody_job_status',
          'idx_equipment_custody_worker_status',
          'idx_equipment_custody_due',
          'idx_equipment_custody_reservation'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup equipment-custody constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('039_governed_expense_receipts')) {
        if (!retainedTables.has('expenses')) {
          throw new Error('Backup governed expense-receipt schema is incomplete: expenses.');
        }
        const expenseColumns = new Set(database.prepare('PRAGMA table_info(expenses)').all().map(row => row.name));
        for (const column of [
          'worker_id',
          'expense_date',
          'entry_key',
          'entry_fingerprint',
          'source_fingerprint',
          'reversal_approval_id'
        ]) {
          if (!expenseColumns.has(column)) {
            throw new Error(`Backup governed expense-receipt schema is incomplete: expenses.${column}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_expenses_job_entry_key',
          'idx_expenses_source_fingerprint',
          'idx_expenses_job_status_date',
          'idx_expenses_worker_status_date',
          'idx_expenses_pending_reversal'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup governed expense-receipt constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('040_governed_environmental_reporting')) {
        for (const table of ['environmental_activities', 'environmental_reports']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup environmental-reporting schema is incomplete: ${table}.`);
          }
        }
        const activityColumns = new Set(database.prepare('PRAGMA table_info(environmental_activities)').all().map(row => row.name));
        for (const column of [
          'activity_date',
          'ghg_scope',
          'emission_factor',
          'emissions_kg_co2e',
          'factor_source',
          'factor_reference',
          'evidence_reference',
          'entry_key',
          'entry_fingerprint',
          'source_fingerprint',
          'reversal_approval_id'
        ]) {
          if (!activityColumns.has(column)) {
            throw new Error(`Backup environmental-reporting schema is incomplete: environmental_activities.${column}.`);
          }
        }
        const reportColumns = new Set(database.prepare('PRAGMA table_info(environmental_reports)').all().map(row => row.name));
        for (const column of ['source_hash', 'snapshot_hash', 'snapshot_json', 'csv_checksum', 'csv_content', 'approval_id']) {
          if (!reportColumns.has(column)) {
            throw new Error(`Backup environmental-reporting schema is incomplete: environmental_reports.${column}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_environmental_activity_job_status_date',
          'idx_environmental_activity_worker_date',
          'idx_environmental_activity_pending_reversal',
          'idx_environmental_report_job_period',
          'idx_environmental_report_pending_source'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup environmental-reporting constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('041_governed_safety_briefings')) {
        for (const table of ['safety_meetings', 'safety_meeting_attendees']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup governed safety-briefing schema is incomplete: ${table}.`);
          }
        }
        const meetingColumns = new Set(database.prepare('PRAGMA table_info(safety_meetings)').all().map(row => row.name));
        for (const column of ['evidence_reference', 'source_hash', 'snapshot_hash', 'snapshot_json', 'entry_key', 'entry_fingerprint']) {
          if (!meetingColumns.has(column)) {
            throw new Error(`Backup governed safety-briefing schema is incomplete: safety_meetings.${column}.`);
          }
        }
        const attendeeColumns = new Set(database.prepare('PRAGMA table_info(safety_meeting_attendees)').all().map(row => row.name));
        for (const column of ['meeting_id', 'job_id', 'worker_id', 'attendee_key', 'status', 'evidence_reference', 'entry_key', 'entry_fingerprint']) {
          if (!attendeeColumns.has(column)) {
            throw new Error(`Backup governed safety-briefing schema is incomplete: safety_meeting_attendees.${column}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_safety_meetings_job_entry_key',
          'idx_safety_meetings_job_status_schedule',
          'idx_safety_attendees_meeting_status',
          'idx_safety_attendees_worker_status',
          'idx_safety_attendees_job_entry_key'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup governed safety-briefing constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('042_governed_work_permits')) {
        for (const table of ['permit_records', 'work_permit_attendees']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup governed work-permit schema is incomplete: ${table}.`);
          }
        }
        const permitColumns = new Set(database.prepare('PRAGMA table_info(permit_records)').all().map(row => row.name));
        for (const column of [
          'valid_from',
          'evidence_reference',
          'source_hash',
          'snapshot_hash',
          'snapshot_json',
          'entry_key',
          'entry_fingerprint',
          'suspended_at',
          'closed_at',
          'closure_evidence_reference'
        ]) {
          if (!permitColumns.has(column)) {
            throw new Error(`Backup governed work-permit schema is incomplete: permit_records.${column}.`);
          }
        }
        const attendeeColumns = new Set(database.prepare('PRAGMA table_info(work_permit_attendees)').all().map(row => row.name));
        for (const column of [
          'permit_id',
          'job_id',
          'assignment_id',
          'worker_id',
          'attendee_key',
          'status',
          'evidence_reference',
          'entry_key',
          'entry_fingerprint'
        ]) {
          if (!attendeeColumns.has(column)) {
            throw new Error(`Backup governed work-permit schema is incomplete: work_permit_attendees.${column}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_work_permits_job_entry_key',
          'idx_work_permits_job_status_validity',
          'idx_work_permit_attendees_permit_status',
          'idx_work_permit_attendees_worker_status',
          'idx_work_permit_attendees_job_entry_key'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup governed work-permit constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('043_governed_daywork_tickets')) {
        for (const table of ['daywork_number_sequences', 'daywork_tickets']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup governed daywork schema is incomplete: ${table}.`);
          }
        }
        const ticketColumns = new Set(database.prepare('PRAGMA table_info(daywork_tickets)').all().map(row => row.name));
        for (const column of [
          'ticket_number',
          'work_date',
          'worker_id',
          'evidence_reference',
          'lines_json',
          'source_hash',
          'snapshot_hash',
          'snapshot_json',
          'entry_key',
          'entry_fingerprint',
          'approval_id',
          'acknowledgement_approval_id',
          'acknowledgement_reference',
          'change_order_id'
        ]) {
          if (!ticketColumns.has(column)) {
            throw new Error(`Backup governed daywork schema is incomplete: daywork_tickets.${column}.`);
          }
        }
        const sequenceColumns = new Set(database.prepare('PRAGMA table_info(daywork_number_sequences)').all().map(row => row.name));
        for (const column of ['period_year', 'last_value', 'updated_at']) {
          if (!sequenceColumns.has(column)) {
            throw new Error(`Backup governed daywork schema is incomplete: daywork_number_sequences.${column}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_daywork_job_status_date',
          'idx_daywork_worker_date',
          'idx_daywork_pending_acknowledgement'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup governed daywork constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('044_governed_nonconformance_records')) {
        for (const table of ['nonconformance_number_sequences', 'nonconformance_records']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup governed nonconformance schema is incomplete: ${table}.`);
          }
        }
        const recordColumns = new Set(database.prepare('PRAGMA table_info(nonconformance_records)').all().map(row => row.name));
        for (const column of [
          'ncr_number',
          'detected_at',
          'requirement_reference',
          'immediate_containment',
          'source_hash',
          'snapshot_hash',
          'snapshot_json',
          'entry_key',
          'entry_fingerprint',
          'corrective_action_json',
          'corrective_action_hash',
          'correction_approval_id',
          'closure_json',
          'closure_hash',
          'closure_approval_id',
          'closed_at',
          'closed_by'
        ]) {
          if (!recordColumns.has(column)) {
            throw new Error(`Backup governed nonconformance schema is incomplete: nonconformance_records.${column}.`);
          }
        }
        const sequenceColumns = new Set(database.prepare('PRAGMA table_info(nonconformance_number_sequences)').all().map(row => row.name));
        for (const column of ['period_year', 'last_value', 'updated_at']) {
          if (!sequenceColumns.has(column)) {
            throw new Error(`Backup governed nonconformance schema is incomplete: nonconformance_number_sequences.${column}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_nonconformance_job_status_due',
          'idx_nonconformance_worker_detected',
          'idx_nonconformance_pending_correction',
          'idx_nonconformance_pending_closure'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup governed nonconformance constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('045_governed_pre_task_plans')) {
        for (const table of ['pre_task_plan_number_sequences', 'pre_task_plans', 'pre_task_plan_attendees']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup governed pre-task plan schema is incomplete: ${table}.`);
          }
        }
        const planColumns = new Set(database.prepare('PRAGMA table_info(pre_task_plans)').all().map(row => row.name));
        for (const column of [
          'plan_number',
          'revision_number',
          'supersedes_plan_id',
          'work_date',
          'jha_id',
          'work_permit_id',
          'sds_sheet_ids_json',
          'steps_json',
          'evidence_reference',
          'source_hash',
          'snapshot_hash',
          'snapshot_json',
          'entry_key',
          'entry_fingerprint',
          'approval_id',
          'activated_at',
          'suspended_at',
          'closed_at',
          'closure_evidence_reference'
        ]) {
          if (!planColumns.has(column)) {
            throw new Error(`Backup governed pre-task plan schema is incomplete: pre_task_plans.${column}.`);
          }
        }
        const attendeeColumns = new Set(database.prepare('PRAGMA table_info(pre_task_plan_attendees)').all().map(row => row.name));
        for (const column of [
          'plan_id',
          'job_id',
          'assignment_id',
          'worker_id',
          'attendee_key',
          'status',
          'evidence_reference',
          'entry_key',
          'entry_fingerprint'
        ]) {
          if (!attendeeColumns.has(column)) {
            throw new Error(`Backup governed pre-task plan schema is incomplete: pre_task_plan_attendees.${column}.`);
          }
        }
        const sequenceColumns = new Set(database.prepare('PRAGMA table_info(pre_task_plan_number_sequences)').all().map(row => row.name));
        for (const column of ['period_year', 'last_value', 'updated_at']) {
          if (!sequenceColumns.has(column)) {
            throw new Error(`Backup governed pre-task plan schema is incomplete: pre_task_plan_number_sequences.${column}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_pre_task_plans_job_status_date',
          'idx_pre_task_plans_approval',
          'idx_pre_task_attendees_plan_status',
          'idx_pre_task_attendees_worker_status',
          'idx_pre_task_attendees_job_entry_key'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup governed pre-task plan constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('046_governed_sds_revision_control')) {
        if (!retainedTables.has('sds_sheets')) {
          throw new Error('Backup governed SDS revision schema is incomplete: sds_sheets.');
        }
        const sdsColumns = new Set(database.prepare('PRAGMA table_info(sds_sheets)').all().map(row => row.name));
        for (const column of [
          'product_key',
          'revision_number',
          'supersedes_sds_id',
          'manufacturer',
          'product_code',
          'language',
          'issued_on',
          'document_id',
          'source_hash',
          'snapshot_hash',
          'snapshot_json',
          'entry_key',
          'entry_fingerprint',
          'reviewed_at'
        ]) {
          if (!sdsColumns.has(column)) {
            throw new Error(`Backup governed SDS revision schema is incomplete: sds_sheets.${column}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_sds_job_entry_key',
          'idx_sds_job_product_revision',
          'idx_sds_supersedes',
          'idx_sds_one_current_product',
          'idx_sds_job_status_expiry',
          'idx_sds_document'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup governed SDS revision constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('047_governed_drawing_revision_control')) {
        const documentColumns = new Set(database.prepare('PRAGMA table_info(documents)').all().map(row => row.name));
        for (const column of [
          'source_document_id',
          'source_hash',
          'snapshot_hash',
          'snapshot_json',
          'entry_key',
          'entry_fingerprint',
          'reviewed_at'
        ]) {
          if (!documentColumns.has(column)) {
            throw new Error(`Backup governed drawing revision schema is incomplete: documents.${column}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_drawing_job_entry_key',
          'idx_drawing_job_sheet_revision',
          'idx_drawing_one_current_sheet',
          'idx_drawing_pending_supersession',
          'idx_drawing_job_status_discipline',
          'idx_drawing_source_document'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup governed drawing revision constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('048_thirteen_week_cash_flow_forecast')) {
        for (const table of ['cash_flow_items', 'cash_flow_forecast_number_sequences', 'cash_flow_forecast_version_sequence', 'cash_flow_forecast_snapshots']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup cash-flow forecast schema is incomplete: ${table}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of ['idx_cash_flow_items_status_date', 'idx_cash_flow_items_job', 'idx_cash_flow_forecast_status']) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup cash-flow forecast constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('049_contractor_balanced_scorecard')) {
        for (const table of [
          'performance_scorecard_targets',
          'performance_scorecard_number_sequences',
          'performance_scorecard_version_sequence',
          'performance_scorecard_snapshots'
        ]) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup performance scorecard schema is incomplete: ${table}.`);
          }
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of ['idx_performance_target_one_approved', 'idx_performance_target_status', 'idx_performance_scorecard_status']) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup performance scorecard constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('050_governed_market_fit')) {
        for (const table of ['market_fit_profiles', 'opportunity_fit_assessments']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup governed market-fit schema is incomplete: ${table}.`);
          }
        }
        const profileColumns = new Set(database.prepare('PRAGMA table_info(market_fit_profiles)').all().map(row => row.name));
        for (const column of ['version_number', 'status', 'profile_name', 'entry_key', 'entry_fingerprint', 'snapshot_hash', 'snapshot_json', 'approval_id']) {
          if (!profileColumns.has(column)) throw new Error(`Backup governed market-fit schema is incomplete: market_fit_profiles.${column}.`);
        }
        const assessmentColumns = new Set(database.prepare('PRAGMA table_info(opportunity_fit_assessments)').all().map(row => row.name));
        for (const column of ['opportunity_id', 'profile_id', 'score', 'recommendation', 'source_hash', 'snapshot_hash', 'snapshot_json', 'entry_key', 'entry_fingerprint']) {
          if (!assessmentColumns.has(column)) throw new Error(`Backup governed market-fit schema is incomplete: opportunity_fit_assessments.${column}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of ['idx_market_fit_one_approved', 'idx_market_fit_profile_status', 'idx_opportunity_fit_history', 'idx_opportunity_fit_profile']) {
          if (!retainedIndexes.has(index)) throw new Error(`Backup governed market-fit constraints are incomplete: ${index}.`);
        }
      }
      if (appliedMigrations.has('051_governed_bid_decisions')) {
        for (const table of ['bid_decision_policies', 'opportunity_bid_decisions']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup governed bid/no-bid schema is incomplete: ${table}.`);
          }
        }
        const policyColumns = new Set(database.prepare('PRAGMA table_info(bid_decision_policies)').all().map(row => row.name));
        for (const column of ['version_number', 'status', 'policy_name', 'entry_key', 'entry_fingerprint', 'snapshot_hash', 'snapshot_json', 'approval_id']) {
          if (!policyColumns.has(column)) throw new Error(`Backup governed bid/no-bid schema is incomplete: bid_decision_policies.${column}.`);
        }
        const decisionColumns = new Set(database.prepare('PRAGMA table_info(opportunity_bid_decisions)').all().map(row => row.name));
        for (const column of ['opportunity_id', 'policy_id', 'status', 'recommendation', 'proposed_decision', 'score', 'source_hash', 'snapshot_hash', 'snapshot_json', 'entry_key', 'entry_fingerprint', 'approval_id']) {
          if (!decisionColumns.has(column)) throw new Error(`Backup governed bid/no-bid schema is incomplete: opportunity_bid_decisions.${column}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_bid_decision_policy_one_approved',
          'idx_bid_decision_policy_status',
          'idx_opportunity_bid_decision_one_approved',
          'idx_opportunity_bid_decision_one_pending',
          'idx_opportunity_bid_decision_history',
          'idx_opportunity_bid_decision_policy'
        ]) {
          if (!retainedIndexes.has(index)) throw new Error(`Backup governed bid/no-bid constraints are incomplete: ${index}.`);
        }
      }
      if (appliedMigrations.has('052_governed_site_surveys')) {
        for (const table of ['opportunity_evidence', 'opportunity_site_surveys']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup governed site-survey schema is incomplete: ${table}.`);
          }
        }
        const evidenceColumns = new Set(database.prepare('PRAGMA table_info(opportunity_evidence)').all().map(row => row.name));
        for (const column of ['opportunity_id', 'storage_ref', 'content_hash', 'status', 'data_json']) {
          if (!evidenceColumns.has(column)) throw new Error(`Backup governed site-survey schema is incomplete: opportunity_evidence.${column}.`);
        }
        const surveyColumns = new Set(database.prepare('PRAGMA table_info(opportunity_site_surveys)').all().map(row => row.name));
        for (const column of ['opportunity_id', 'status', 'template_version', 'template_hash', 'source_hash', 'snapshot_hash', 'snapshot_json', 'schedule_entry_key', 'schedule_fingerprint', 'submission_entry_key', 'submission_fingerprint', 'approval_id']) {
          if (!surveyColumns.has(column)) throw new Error(`Backup governed site-survey schema is incomplete: opportunity_site_surveys.${column}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_opportunity_evidence_history',
          'idx_opportunity_evidence_storage',
          'idx_opportunity_site_survey_one_active',
          'idx_opportunity_site_survey_one_approved',
          'idx_opportunity_site_survey_history',
          'idx_opportunity_site_survey_approval'
        ]) {
          if (!retainedIndexes.has(index)) throw new Error(`Backup governed site-survey constraints are incomplete: ${index}.`);
        }
      }
      if (appliedMigrations.has('053_work_breakdown_takeoffs')) {
        const takeoffItemColumns = new Set(database.prepare('PRAGMA table_info(takeoff_items)').all().map(row => row.name));
        for (const column of ['wbs_code', 'work_package']) {
          if (!takeoffItemColumns.has(column)) throw new Error(`Backup WBS takeoff schema is incomplete: takeoff_items.${column}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        if (!retainedIndexes.has('idx_takeoff_items_wbs')) {
          throw new Error('Backup WBS takeoff constraints are incomplete: idx_takeoff_items_wbs.');
        }
      }
      if (appliedMigrations.has('054_estimate_rate_buildups')) {
        if (!retainedTables.has('estimate_rate_policies')) {
          throw new Error('Backup estimating rate schema is incomplete: estimate_rate_policies.');
        }
        const policyColumns = new Set(database.prepare('PRAGMA table_info(estimate_rate_policies)').all().map(row => row.name));
        for (const column of ['version_number', 'status', 'policy_name', 'currency', 'entry_key', 'entry_fingerprint', 'snapshot_hash', 'snapshot_json', 'approval_id']) {
          if (!policyColumns.has(column)) throw new Error(`Backup estimating rate schema is incomplete: estimate_rate_policies.${column}.`);
        }
        const takeoffItemColumns = new Set(database.prepare('PRAGMA table_info(takeoff_items)').all().map(row => row.name));
        for (const column of ['rate_policy_id', 'rate_build_up_hash']) {
          if (!takeoffItemColumns.has(column)) throw new Error(`Backup estimating rate schema is incomplete: takeoff_items.${column}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of ['idx_estimate_rate_policy_one_approved', 'idx_estimate_rate_policy_status', 'idx_takeoff_items_rate_policy']) {
          if (!retainedIndexes.has(index)) throw new Error(`Backup estimating rate constraints are incomplete: ${index}.`);
        }
      }
      if (appliedMigrations.has('055_pricing_basis_decisions')) {
        if (!retainedTables.has('pricing_basis_decisions')) {
          throw new Error('Backup pricing-basis schema is incomplete: pricing_basis_decisions.');
        }
        const decisionColumns = new Set(database.prepare('PRAGMA table_info(pricing_basis_decisions)').all().map(row => row.name));
        for (const column of ['job_id', 'version_number', 'status', 'recommendation', 'selected_model', 'score', 'source_hash', 'snapshot_hash', 'snapshot_json', 'entry_key', 'entry_fingerprint']) {
          if (!decisionColumns.has(column)) throw new Error(`Backup pricing-basis schema is incomplete: pricing_basis_decisions.${column}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of ['idx_pricing_basis_one_current', 'idx_pricing_basis_job_history', 'idx_pricing_basis_model_status']) {
          if (!retainedIndexes.has(index)) throw new Error(`Backup pricing-basis constraints are incomplete: ${index}.`);
        }
      }
      if (appliedMigrations.has('056_commercial_scope_revisions')) {
        if (!retainedTables.has('commercial_scope_revisions')) {
          throw new Error('Backup commercial-scope schema is incomplete: commercial_scope_revisions.');
        }
        const scopeColumns = new Set(database.prepare('PRAGMA table_info(commercial_scope_revisions)').all().map(row => row.name));
        for (const column of ['job_id', 'version_number', 'status', 'title', 'currency', 'allowance_total', 'source_hash', 'snapshot_hash', 'snapshot_json', 'entry_key', 'entry_fingerprint', 'approval_id']) {
          if (!scopeColumns.has(column)) throw new Error(`Backup commercial-scope schema is incomplete: commercial_scope_revisions.${column}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of ['idx_commercial_scope_one_approved', 'idx_commercial_scope_one_pending', 'idx_commercial_scope_job_history', 'idx_commercial_scope_approval']) {
          if (!retainedIndexes.has(index)) throw new Error(`Backup commercial-scope constraints are incomplete: ${index}.`);
        }
      }
      if (appliedMigrations.has('057_governed_risk_register')) {
        if (!retainedTables.has('risk_register_revisions')) {
          throw new Error('Backup risk-register schema is incomplete: risk_register_revisions.');
        }
        const riskColumns = new Set(database.prepare('PRAGMA table_info(risk_register_revisions)').all().map(row => row.name));
        for (const column of ['job_id', 'version_number', 'status', 'title', 'currency', 'risk_count', 'high_risk_count', 'total_expected_value', 'source_hash', 'snapshot_hash', 'snapshot_json', 'entry_key', 'entry_fingerprint', 'approval_id']) {
          if (!riskColumns.has(column)) throw new Error(`Backup risk-register schema is incomplete: risk_register_revisions.${column}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of ['idx_risk_register_one_approved', 'idx_risk_register_one_pending', 'idx_risk_register_job_history', 'idx_risk_register_approval']) {
          if (!retainedIndexes.has(index)) throw new Error(`Backup risk-register constraints are incomplete: ${index}.`);
        }
      }
      if (appliedMigrations.has('058_formal_variation_control')) {
        if (!retainedTables.has('variation_number_sequences')) {
          throw new Error('Backup formal-variation schema is incomplete: variation_number_sequences.');
        }
        const changeOrderColumns = new Set(database.prepare('PRAGMA table_info(change_orders)').all().map(row => row.name));
        for (const column of ['variation_number', 'revision_number', 'supersedes_change_order_id', 'entry_key', 'entry_fingerprint', 'source_hash', 'snapshot_hash', 'snapshot_json']) {
          if (!changeOrderColumns.has(column)) throw new Error(`Backup formal-variation schema is incomplete: change_orders.${column}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of ['idx_change_orders_variation_revision', 'idx_change_orders_entry_key', 'idx_change_orders_revision_chain', 'idx_change_orders_formal_status']) {
          if (!retainedIndexes.has(index)) throw new Error(`Backup formal-variation constraints are incomplete: ${index}.`);
        }
      }
      if (appliedMigrations.has('059_crew_capacity_lookahead')) {
        for (const table of ['crew_capacity_profiles', 'crew_capacity_allocations', 'crew_lookahead_plans']) {
          if (!retainedTables.has(table)) throw new Error(`Backup crew-planning schema is incomplete: ${table}.`);
        }
        const profileColumns = new Set(database.prepare('PRAGMA table_info(crew_capacity_profiles)').all().map(row => row.name));
        for (const column of ['worker_id', 'version_number', 'status', 'effective_from', 'timezone', 'weekly_hours', 'daily_hours_json', 'source_hash', 'snapshot_hash', 'snapshot_json', 'entry_key', 'entry_fingerprint']) {
          if (!profileColumns.has(column)) throw new Error(`Backup crew-planning schema is incomplete: crew_capacity_profiles.${column}.`);
        }
        const allocationColumns = new Set(database.prepare('PRAGMA table_info(crew_capacity_allocations)').all().map(row => row.name));
        for (const column of ['worker_id', 'assignment_id', 'job_id', 'task_id', 'work_date', 'planned_hours', 'status', 'entry_key', 'entry_fingerprint']) {
          if (!allocationColumns.has(column)) throw new Error(`Backup crew-planning schema is incomplete: crew_capacity_allocations.${column}.`);
        }
        const lookaheadColumns = new Set(database.prepare('PRAGMA table_info(crew_lookahead_plans)').all().map(row => row.name));
        for (const column of ['version_number', 'status', 'window_start', 'window_end', 'horizon_days', 'source_hash', 'snapshot_hash', 'snapshot_json', 'approval_id']) {
          if (!lookaheadColumns.has(column)) throw new Error(`Backup crew-planning schema is incomplete: crew_lookahead_plans.${column}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_crew_capacity_profile_one_active',
          'idx_crew_capacity_profile_history',
          'idx_crew_capacity_allocation_worker_day',
          'idx_crew_capacity_allocation_job_day',
          'idx_crew_capacity_allocation_task',
          'idx_crew_lookahead_one_approved',
          'idx_crew_lookahead_one_pending',
          'idx_crew_lookahead_history'
        ]) {
          if (!retainedIndexes.has(index)) throw new Error(`Backup crew-planning constraints are incomplete: ${index}.`);
        }
      }
      if (appliedMigrations.has('060_daily_operating_cycles')) {
        if (!retainedTables.has('daily_operating_cycles')) {
          throw new Error('Backup daily operating-cycle schema is incomplete: daily_operating_cycles.');
        }
        const dailyCycleColumns = new Set(database.prepare('PRAGMA table_info(daily_operating_cycles)').all().map(row => row.name));
        for (const column of [
          'job_id',
          'work_date',
          'shift_label',
          'status',
          'crew_json',
          'huddle_source_hash',
          'huddle_snapshot_hash',
          'huddle_snapshot_json',
          'huddle_entry_key',
          'huddle_entry_fingerprint',
          'field_report_id',
          'time_log_id',
          'safety_check_id',
          'eod_source_hash',
          'eod_snapshot_hash',
          'eod_snapshot_json',
          'eod_entry_key',
          'eod_entry_fingerprint'
        ]) {
          if (!dailyCycleColumns.has(column)) throw new Error(`Backup daily operating-cycle schema is incomplete: daily_operating_cycles.${column}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_daily_operating_cycles_job_date',
          'idx_daily_operating_cycles_status_date',
          'idx_daily_operating_cycles_field_report'
        ]) {
          if (!retainedIndexes.has(index)) throw new Error(`Backup daily operating-cycle constraints are incomplete: ${index}.`);
        }
      }
      if (appliedMigrations.has('061_last_planner_lite')) {
        for (const table of ['last_planner_constraints', 'last_planner_weekly_plans', 'last_planner_outcomes']) {
          if (!retainedTables.has(table)) throw new Error(`Backup Last Planner schema is incomplete: ${table}.`);
        }
        const constraintColumns = new Set(database.prepare('PRAGMA table_info(last_planner_constraints)').all().map(row => row.name));
        for (const column of ['job_id', 'task_id', 'category', 'title', 'owner', 'due_date', 'status', 'source_hash', 'snapshot_hash', 'snapshot_json', 'entry_key', 'entry_fingerprint', 'release_source_hash', 'release_snapshot_hash', 'release_snapshot_json', 'release_entry_key', 'release_entry_fingerprint']) {
          if (!constraintColumns.has(column)) throw new Error(`Backup Last Planner schema is incomplete: last_planner_constraints.${column}.`);
        }
        const planColumns = new Set(database.prepare('PRAGMA table_info(last_planner_weekly_plans)').all().map(row => row.name));
        for (const column of ['job_id', 'version_number', 'week_start', 'week_end', 'status', 'lookahead_plan_id', 'source_hash', 'snapshot_hash', 'snapshot_json', 'approval_id', 'entry_key', 'entry_fingerprint']) {
          if (!planColumns.has(column)) throw new Error(`Backup Last Planner schema is incomplete: last_planner_weekly_plans.${column}.`);
        }
        const outcomeColumns = new Set(database.prepare('PRAGMA table_info(last_planner_outcomes)').all().map(row => row.name));
        for (const column of ['plan_id', 'job_id', 'commitment_id', 'result', 'evidence_references_json', 'variance_category', 'variance_reason', 'daily_cycle_ids_json', 'source_hash', 'snapshot_hash', 'snapshot_json', 'entry_key', 'entry_fingerprint']) {
          if (!outcomeColumns.has(column)) throw new Error(`Backup Last Planner schema is incomplete: last_planner_outcomes.${column}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_last_planner_constraints_job_due',
          'idx_last_planner_constraints_task',
          'idx_last_planner_one_pending',
          'idx_last_planner_one_approved',
          'idx_last_planner_plan_history',
          'idx_last_planner_outcomes_job',
          'idx_last_planner_outcomes_result'
        ]) {
          if (!retainedIndexes.has(index)) throw new Error(`Backup Last Planner constraints are incomplete: ${index}.`);
        }
      }
      if (appliedMigrations.has('062_governed_five_s')) {
        for (const table of ['five_s_locations', 'five_s_standards', 'five_s_audits', 'five_s_actions']) {
          if (!retainedTables.has(table)) throw new Error(`Backup 5S schema is incomplete: ${table}.`);
        }
        const locationColumns = new Set(database.prepare('PRAGMA table_info(five_s_locations)').all().map(row => row.name));
        for (const column of ['job_id', 'name', 'location_type', 'identifier', 'owner', 'audit_frequency_days', 'status', 'entry_key', 'entry_fingerprint']) {
          if (!locationColumns.has(column)) throw new Error(`Backup 5S schema is incomplete: five_s_locations.${column}.`);
        }
        const standardColumns = new Set(database.prepare('PRAGMA table_info(five_s_standards)').all().map(row => row.name));
        for (const column of ['location_id', 'version_number', 'status', 'source_hash', 'snapshot_hash', 'snapshot_json', 'approval_id', 'entry_key', 'entry_fingerprint']) {
          if (!standardColumns.has(column)) throw new Error(`Backup 5S schema is incomplete: five_s_standards.${column}.`);
        }
        const auditColumns = new Set(database.prepare('PRAGMA table_info(five_s_audits)').all().map(row => row.name));
        for (const column of ['location_id', 'job_id', 'standard_id', 'audit_date', 'audited_by', 'status', 'score_percent', 'results_json', 'evidence_references_json', 'source_hash', 'snapshot_hash', 'snapshot_json', 'entry_key', 'entry_fingerprint']) {
          if (!auditColumns.has(column)) throw new Error(`Backup 5S schema is incomplete: five_s_audits.${column}.`);
        }
        const actionColumns = new Set(database.prepare('PRAGMA table_info(five_s_actions)').all().map(row => row.name));
        for (const column of ['audit_id', 'location_id', 'job_id', 'standard_item_id', 'stage', 'title', 'finding', 'severity', 'owner', 'due_date', 'status', 'source_hash', 'snapshot_hash', 'snapshot_json', 'resolution_evidence_reference', 'resolution_note', 'resolution_source_hash', 'resolution_snapshot_hash', 'resolution_snapshot_json', 'resolution_entry_key', 'resolution_entry_fingerprint']) {
          if (!actionColumns.has(column)) throw new Error(`Backup 5S schema is incomplete: five_s_actions.${column}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_five_s_locations_job_status',
          'idx_five_s_locations_type_status',
          'idx_five_s_standard_one_pending',
          'idx_five_s_standard_one_approved',
          'idx_five_s_standard_history',
          'idx_five_s_audits_location_date',
          'idx_five_s_audits_job_date',
          'idx_five_s_audits_status',
          'idx_five_s_actions_location_status',
          'idx_five_s_actions_job_status',
          'idx_five_s_actions_due'
        ]) {
          if (!retainedIndexes.has(index)) throw new Error(`Backup 5S constraints are incomplete: ${index}.`);
        }
      }
      if (appliedMigrations.has('063_governed_lmra')) {
        if (!retainedTables.has('lmra_assessments')) throw new Error('Backup LMRA schema is incomplete: lmra_assessments.');
        const lmraColumns = new Set(database.prepare('PRAGMA table_info(lmra_assessments)').all().map(row => row.name));
        for (const column of [
          'job_id',
          'task_id',
          'pre_task_plan_id',
          'work_permit_id',
          'worker_id',
          'worker_name',
          'work_area',
          'activity',
          'assessed_at',
          'valid_until',
          'outcome',
          'checks_json',
          'observed_hazards_json',
          'evidence_reference',
          'stop_work_reason',
          'reassessment_of_id',
          'resolution_note',
          'source_hash',
          'snapshot_hash',
          'snapshot_json',
          'entry_key',
          'entry_fingerprint'
        ]) {
          if (!lmraColumns.has(column)) throw new Error(`Backup LMRA schema is incomplete: lmra_assessments.${column}.`);
        }
        const retainedIndexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
        for (const index of [
          'idx_lmra_job_worker_assessed',
          'idx_lmra_plan_worker_assessed',
          'idx_lmra_outcome_validity',
          'idx_lmra_reassessment_source'
        ]) {
          if (!retainedIndexes.has(index)) throw new Error(`Backup LMRA constraints are incomplete: ${index}.`);
        }
      }
      if (appliedMigrations.has('064_governed_installation_qc')) {
        if (!retainedTables.has('installation_qc_controls')) {
          throw new Error('Backup installation-QC schema is incomplete: installation_qc_controls.');
        }
        const installationQcColumns = new Set(
          database.prepare('PRAGMA table_info(installation_qc_controls)').all().map(row => row.name)
        );
        for (const column of [
          'inspection_id',
          'job_id',
          'task_id',
          'assignment_id',
          'assigned_worker_id',
          'installation_stage',
          'control_point',
          'work_location',
          'reference_basis',
          'reference_document_ids_json',
          'status',
          'latest_submission_id',
          'source_hash',
          'snapshot_json',
          'snapshot_hash',
          'released_at',
          'released_by'
        ]) {
          if (!installationQcColumns.has(column)) {
            throw new Error(`Backup installation-QC schema is incomplete: installation_qc_controls.${column}.`);
          }
        }
        const retainedIndexes = new Set(
          database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name)
        );
        for (const index of [
          'idx_installation_qc_job_status',
          'idx_installation_qc_task_status',
          'idx_installation_qc_worker_status'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup installation-QC constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('065_governed_photo_evidence')) {
        for (const table of ['photo_evidence_sets', 'photo_evidence_captures']) {
          if (!retainedTables.has(table)) {
            throw new Error(`Backup photo-evidence schema is incomplete: ${table}.`);
          }
        }
        const photoSetColumns = new Set(
          database.prepare('PRAGMA table_info(photo_evidence_sets)').all().map(row => row.name)
        );
        for (const column of [
          'id',
          'job_id',
          'task_id',
          'assignment_id',
          'assigned_worker_id',
          'required_phases_json',
          'status',
          'latest_approval_id',
          'source_hash',
          'snapshot_json',
          'snapshot_hash',
          'released_at',
          'released_by',
          'entry_key',
          'entry_fingerprint'
        ]) {
          if (!photoSetColumns.has(column)) {
            throw new Error(`Backup photo-evidence schema is incomplete: photo_evidence_sets.${column}.`);
          }
        }
        const photoCaptureColumns = new Set(
          database.prepare('PRAGMA table_info(photo_evidence_captures)').all().map(row => row.name)
        );
        for (const column of [
          'id',
          'set_id',
          'job_id',
          'task_id',
          'document_id',
          'phase',
          'captured_at',
          'captured_by_worker_id',
          'caption',
          'source_hash',
          'snapshot_json',
          'snapshot_hash',
          'entry_key',
          'entry_fingerprint'
        ]) {
          if (!photoCaptureColumns.has(column)) {
            throw new Error(`Backup photo-evidence schema is incomplete: photo_evidence_captures.${column}.`);
          }
        }
        const retainedIndexes = new Set(
          database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name)
        );
        for (const index of [
          'idx_photo_evidence_set_job_status',
          'idx_photo_evidence_set_task_status',
          'idx_photo_evidence_set_worker_status',
          'idx_photo_evidence_capture_set_phase',
          'idx_photo_evidence_capture_worker'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup photo-evidence constraints are incomplete: ${index}.`);
          }
        }
      }
      if (appliedMigrations.has('066_governed_client_feedback')) {
        if (!retainedTables.has('client_feedback')) {
          throw new Error('Backup client-feedback schema is incomplete: client_feedback.');
        }
        const clientFeedbackColumns = new Set(
          database.prepare('PRAGMA table_info(client_feedback)').all().map(row => row.name)
        );
        for (const column of [
          'id',
          'job_id',
          'client_id',
          'portal_access_id',
          'survey_type',
          'source',
          'status',
          'respondent_name',
          'nps_score',
          'csat_score',
          'effort_score',
          'comment',
          'follow_up_consent',
          'testimonial_consent',
          'evidence_reference',
          'submitted_at',
          'entry_key',
          'entry_fingerprint',
          'snapshot_json',
          'snapshot_hash',
          'data_json',
          'created_at',
          'updated_at'
        ]) {
          if (!clientFeedbackColumns.has(column)) {
            throw new Error(`Backup client-feedback schema is incomplete: client_feedback.${column}.`);
          }
        }
        const retainedIndexes = new Set(
          database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name)
        );
        for (const index of [
          'idx_client_feedback_job_submitted',
          'idx_client_feedback_client_submitted',
          'idx_client_feedback_portal_survey'
        ]) {
          if (!retainedIndexes.has(index)) {
            throw new Error(`Backup client-feedback constraints are incomplete: ${index}.`);
          }
        }
        const portalSurveyIndex = database.prepare(`
          SELECT sql
          FROM sqlite_master
          WHERE type = 'index' AND name = 'idx_client_feedback_portal_survey'
        `).get();
        if (!portalSurveyIndex?.sql
          || !/CREATE\s+UNIQUE\s+INDEX/i.test(portalSurveyIndex.sql)
          || !/WHERE\s+portal_access_id\s+IS\s+NOT\s+NULL/i.test(portalSurveyIndex.sql)) {
          throw new Error('Backup client-feedback constraints are incomplete: idx_client_feedback_portal_survey must be a partial unique index.');
        }
      }
      if (appliedMigrations.has('067_governed_energy_performance')) {
        if (!retainedTables.has('energy_performance_records')) {
          throw new Error('Backup energy-performance schema is incomplete: energy_performance_records.');
        }
        const energyPerformanceColumns = new Set(
          database.prepare('PRAGMA table_info(energy_performance_records)').all().map(row => row.name)
        );
        for (const column of [
          'id',
          'job_id',
          'phase',
          'building_use',
          'building_scope',
          'object_reference',
          'assessment_date',
          'assessor_name',
          'assessor_credential',
          'certified_company',
          'nta_version',
          'software_name',
          'software_version',
          'ep_online_registration',
          'label_class',
          'beng1_value',
          'beng1_limit',
          'beng2_value',
          'beng2_limit',
          'beng3_value',
          'beng3_minimum',
          'tojuli_applicable',
          'tojuli_value',
          'tojuli_limit',
          'tojuli_not_applicable_reason',
          'evidence_reference',
          'evidence_document_id',
          'permit_source_record_id',
          'supersedes_record_id',
          'status',
          'approval_id',
          'source_hash',
          'snapshot_json',
          'snapshot_hash',
          'entry_key',
          'entry_fingerprint',
          'notes',
          'data_json',
          'created_at',
          'updated_at'
        ]) {
          if (!energyPerformanceColumns.has(column)) {
            throw new Error(`Backup energy-performance schema is incomplete: energy_performance_records.${column}.`);
          }
        }
        const energyPerformanceIndexes = new Map(
          database.prepare(`
            SELECT name, sql FROM sqlite_master
            WHERE type = 'index' AND name LIKE 'idx_energy_performance_%'
          `).all().map(row => [row.name, row.sql || ''])
        );
        for (const index of [
          'idx_energy_performance_job_phase',
          'idx_energy_performance_pending_scope',
          'idx_energy_performance_current_scope'
        ]) {
          if (!energyPerformanceIndexes.has(index)) {
            throw new Error(`Backup energy-performance constraints are incomplete: ${index}.`);
          }
        }
        if (!/CREATE\s+UNIQUE\s+INDEX/i.test(energyPerformanceIndexes.get('idx_energy_performance_pending_scope'))
          || !/WHERE\s+status\s*=\s*'pending_approval'/i.test(energyPerformanceIndexes.get('idx_energy_performance_pending_scope'))) {
          throw new Error('Backup energy-performance constraints are incomplete: pending scope review must be a partial unique index.');
        }
        if (!/CREATE\s+UNIQUE\s+INDEX/i.test(energyPerformanceIndexes.get('idx_energy_performance_current_scope'))
          || !/WHERE\s+status\s+IN\s*\(\s*'verified_compliant'\s*,\s*'verified_gap'\s*\)/i.test(energyPerformanceIndexes.get('idx_energy_performance_current_scope'))) {
          throw new Error('Backup energy-performance constraints are incomplete: current scope record must be a partial unique index.');
        }
      }
      const auditColumns = new Set(database.prepare('PRAGMA table_info(audit_events)').all().map(row => row.name));
      let auditIntegrity = { supported: false, valid: null, status: 'legacy_unchained_backup' };
      if (['sequence_number', 'previous_hash', 'event_hash'].every(column => auditColumns.has(column))) {
        if (!retainedTables.has('audit_chain_state')) throw new Error('Backup audit chain state is missing.');
        const state = database.prepare('SELECT * FROM audit_chain_state WHERE chain_id = ?').get(AUDIT_CHAIN_ID) || null;
        auditIntegrity = { supported: true, ...verifyAuditChainRows(database.prepare('SELECT * FROM audit_events').all(), state) };
        if (!auditIntegrity.valid) {
          throw new Error(`Backup audit chain failed integrity verification: ${auditIntegrity.failures.map(failure => failure.code).join(', ')}.`);
        }
      }
      return { valid: true, tables: retainedTables.size, auditIntegrity };
    } finally {
      database.close();
    }
  } finally {
    fs.rmSync(verificationDirectory, { recursive: true, force: true });
  }
}

function invalidateRestoredOperatorSessions(ledgerFile) {
  const database = new DatabaseSync(ledgerFile);
  try {
    const retained = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'operator_sessions'").get();
    if (!retained) return 0;
    const timestamp = new Date().toISOString();
    const result = database.prepare(`
      UPDATE operator_sessions
      SET revoked_at = ?, revocation_reason = 'backup_restore', updated_at = ?
      WHERE revoked_at IS NULL
    `).run(timestamp, timestamp);
    return Number(result.changes || 0);
  } finally {
    database.close();
  }
}

function clearRestoredAuthenticationRateLimits(ledgerFile) {
  const database = new DatabaseSync(ledgerFile);
  try {
    const retained = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_rate_limits'").get();
    if (!retained) return 0;
    const result = database.prepare('DELETE FROM auth_rate_limits').run();
    return Number(result.changes || 0);
  } finally {
    database.close();
  }
}

function clearRestoredApiRateLimits(ledgerFile) {
  const database = new DatabaseSync(ledgerFile);
  try {
    const retained = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'api_rate_limits'").get();
    if (!retained) return 0;
    const result = database.prepare('DELETE FROM api_rate_limits').run();
    return Number(result.changes || 0);
  } finally {
    database.close();
  }
}

function copyDirectoryFiles(sourceRoot, targetRoot) {
  if (!fs.existsSync(sourceRoot)) return [];
  const copied = [];
  const visit = (directory, relativeDirectory = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Evidence restore refuses symbolic link: ${entry.name}`);
      const relative = path.join(relativeDirectory, entry.name);
      const source = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(source, relative);
        continue;
      }
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const target = path.resolve(targetRoot, relative);
      if (!target.startsWith(`${path.resolve(targetRoot)}${path.sep}`)) throw new Error('Evidence path could not be resolved safely.');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      copied.push(target);
    }
  };
  fs.mkdirSync(targetRoot, { recursive: true });
  visit(path.resolve(sourceRoot));
  return copied;
}

function writeSafetyManifest(directory, files) {
  const entries = files.map(file => ({
    file: path.relative(directory, file).replace(/\\/g, '/'),
    bytes: fs.statSync(file).size,
    sha256: sha256(file)
  }));
  fs.writeFileSync(path.join(directory, 'pre-restore-manifest.json'), JSON.stringify({
    format: 'contractor-ai-pre-restore-manifest/v2',
    createdAt: new Date().toISOString(),
    files: entries
  }, null, 2));
}

function assertSafeReplaceDirectory(target, backupRoot) {
  const resolved = path.resolve(target);
  const filesystemRoot = path.parse(resolved).root;
  const resolvedBackupRoot = path.resolve(backupRoot);
  if (
    resolved === filesystemRoot
    || resolved === projectRoot
    || resolved === resolvedBackupRoot
    || resolved.startsWith(`${resolvedBackupRoot}${path.sep}`)
    || resolvedBackupRoot.startsWith(`${resolved}${path.sep}`)
  ) {
    throw new Error(`Refusing to replace unsafe evidence directory: ${resolved}`);
  }
  return resolved;
}

function restore(argumentsMap) {
  const dataDir = path.resolve(argumentsMap['data-dir'] || process.env.CONTRACTOR_AI_DATA_DIR || path.join(projectRoot, 'data'));
  const backupId = String(argumentsMap['backup-id'] || '');
  if (argumentsMap.confirm !== `RESTORE_${backupId}`) throw new Error(`Set --confirm RESTORE_${backupId} to apply this verified local backup.`);
  const { backupRoot, backupDir } = safeBackupDirectory(dataDir, backupId);
  const manifest = verifyManifest(backupDir);
  if (manifest.databaseMode !== 'sqlite') throw new Error('This command restores SQLite local backups only. Restore hosted PostgreSQL through the managed provider recovery procedure.');

  const stateFile = path.resolve(argumentsMap['state-file'] || process.env.STATE_FILE || path.join(dataDir, 'server-state.json'));
  const ledgerFile = path.resolve(argumentsMap['ledger-db-file'] || process.env.LEDGER_DB_FILE || path.join(dataDir, 'contractor-ledger.sqlite'));
  const uploadDir = assertSafeReplaceDirectory(argumentsMap['upload-dir'] || process.env.UPLOAD_DIR || path.join(dataDir, 'uploads'), backupRoot);
  const targetFiles = [stateFile, ledgerFile, `${ledgerFile}-wal`, `${ledgerFile}-shm`];
  const manifestFiles = new Set(manifest.files.map(entry => entry.file));
  const requiredFiles = [path.basename(ledgerFile)];
  for (const file of requiredFiles) {
    if (!manifestFiles.has(file)) throw new Error(`Backup does not contain required local state file: ${file}`);
  }
  const backupLedgerFile = path.join(backupDir, path.basename(ledgerFile));
  const databaseVerification = verifySqliteBackupDatabase(backupLedgerFile);

  const safetyId = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const safetyDir = path.join(backupRoot, safetyId);
  fs.mkdirSync(safetyDir, { recursive: true });
  const copiedSafetyFiles = [];
  for (const target of targetFiles) {
    if (!fs.existsSync(target)) continue;
    const safetyTarget = path.join(safetyDir, path.basename(target));
    fs.copyFileSync(target, safetyTarget);
    copiedSafetyFiles.push(safetyTarget);
  }
  copiedSafetyFiles.push(...copyDirectoryFiles(uploadDir, path.join(safetyDir, 'evidence')));
  writeSafetyManifest(safetyDir, copiedSafetyFiles);

  const restoredFiles = [];
  for (const target of targetFiles) {
    const filename = path.basename(target);
    const source = path.join(backupDir, filename);
    if (manifestFiles.has(filename)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      restoredFiles.push(filename);
    } else if (target.endsWith('-wal') || target.endsWith('-shm')) {
      fs.rmSync(target, { force: true });
    }
  }
  const invalidatedOperatorSessions = invalidateRestoredOperatorSessions(ledgerFile);
  const clearedAuthenticationRateLimits = clearRestoredAuthenticationRateLimits(ledgerFile);
  const clearedApiRateLimits = clearRestoredApiRateLimits(ledgerFile);

  let evidenceRestored = false;
  let restoredEvidenceFiles = 0;
  if (manifest.format === 'contractor-ai-backup-manifest/v2' && manifest.evidence?.included === true) {
    const stagingDir = `${uploadDir}.restore-${process.pid}-${Date.now()}`;
    assertSafeReplaceDirectory(stagingDir, backupRoot);
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });
    try {
      const evidenceEntries = manifest.files.filter(entry => String(entry.file).replace(/\\/g, '/').startsWith('evidence/'));
      for (const entry of evidenceEntries) {
        const relative = String(entry.file).replace(/\\/g, '/').slice('evidence/'.length);
        const source = safeManifestTarget(backupDir, entry.file);
        const target = safeManifestTarget(stagingDir, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        restoredEvidenceFiles += 1;
      }
      fs.rmSync(uploadDir, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(uploadDir), { recursive: true });
      fs.renameSync(stagingDir, uploadDir);
      evidenceRestored = true;
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  return {
    success: true,
    backupId,
    restoredFiles,
    evidenceRestored,
    restoredEvidenceFiles,
    databaseVerification,
    invalidatedOperatorSessions,
    clearedAuthenticationRateLimits,
    clearedApiRateLimits,
    preRestoreBackupId: safetyId,
    restartRequired: true
  };
}

if (require.main === module) {
  try {
    const result = restore(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    fail(error.message || 'Local backup restore failed.');
  }
}

module.exports = {
  parseArguments,
  restore,
  verifyManifest,
  verifySqliteBackupDatabase
};
