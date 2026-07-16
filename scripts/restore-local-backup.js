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
