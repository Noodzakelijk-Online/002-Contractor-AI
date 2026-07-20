const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { ContractorOperatingLedger } = require('../operating-ledger');
const { resolvePostgresConnectionOptions } = require('../postgres-sync-database');
const {
  migrateLocalBackupToHosted,
  orderedSelfReferentialRows,
  orderedSourceTables,
  rewriteRowReferences,
  verifyBackupDirectory
} = require('../scripts/migrate-local-backup-to-hosted');

const connectionString = process.env.CONTRACTOR_AI_POSTGRES_TEST_URL;

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function pgClient(databaseUrl) {
  const options = resolvePostgresConnectionOptions(databaseUrl);
  return new Client({
    connectionString: options.connectionString,
    ssl: options.ssl === false ? false : { rejectUnauthorized: options.rejectUnauthorized !== false }
  });
}

function databaseUrl(baseUrl, databaseName) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function createTestDatabase(t, suffix) {
  const name = `contractor_migration_${suffix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const admin = pgClient(databaseUrl(connectionString, 'postgres'));
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  t.after(async () => {
    const cleanup = pgClient(databaseUrl(connectionString, 'postgres'));
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await cleanup.end();
  });
  return databaseUrl(connectionString, name);
}

function createBackupFixture(t, suffix = 'success') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `contractor-ai-hosted-migration-${suffix}-`));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceFile = path.join(directory, 'source.sqlite');
  const localStorageRef = `data/uploads/${suffix}-site-proof.jpg`;
  const source = new ContractorOperatingLedger({ dbFile: sourceFile });
  const job = source.createIntake({
    title: `Hosted migration ${suffix}`,
    client: { name: `Migration Client ${suffix}` },
    description: 'A complete local ledger fixture for the hosted migration path.',
    estimatedHours: 123.123456789,
    contractValue: 987654321.123456
  }, { actor: 'migration_fixture' });
  const taskDependency = source.addTaskDependency(job.id, {
    predecessorTaskId: job.tasks[0].id,
    successorTaskId: job.tasks[1].id
  }, { actor: 'migration_fixture' });
  let scheduleBaseline = source.requestScheduleBaseline(job.id, {
    plannedStart: '2026-07-20T08:00:00.000Z',
    reason: 'Retained local schedule migration fixture.'
  }, { actor: 'migration_fixture' });
  source.resolveApproval(scheduleBaseline.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration work-plan sequence and durations verified.'
  });
  const evidenceBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from(`hosted-migration-${suffix}`)]);
  const document = source.addDocument(job.id, {
    type: 'field_photo',
    title: 'Migration site proof',
    filename: `${suffix}-site-proof.jpg`,
    mimeType: 'image/jpeg',
    size: evidenceBytes.length,
    storageRef: localStorageRef
  }, { actor: 'migration_fixture' });
  const sdsEvidenceBytes = Buffer.from(`%PDF-1.7\nGoverned hosted migration SDS ${suffix}\n%%EOF`);
  const sdsStorageRef = `data/uploads/${suffix}-manufacturer-sds.pdf`;
  const sdsDocument = source.addDocument(job.id, {
    type: 'sds_pdf',
    title: 'Migration manufacturer SDS',
    filename: `${suffix}-manufacturer-sds.pdf`,
    mimeType: 'application/pdf',
    size: sdsEvidenceBytes.length,
    storageRef: sdsStorageRef,
    status: 'stored',
    analysis: {
      upload: {
        sha256: crypto.createHash('sha256').update(sdsEvidenceBytes).digest('hex'),
        signatureVerified: true
      }
    }
  }, { actor: 'migration_fixture' });
  const sdsRequest = source.createSdsRevision(job.id, {
    entryKey: `migration-sds-revision-${suffix}`,
    material: 'Migration two-component coating',
    manufacturer: 'Migration Coatings Europe BV',
    productCode: 'MIG-2K-7016',
    language: 'nl',
    issuedOn: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    documentId: sdsDocument.id,
    hazardClasses: ['H315 - Causes skin irritation'],
    requiredPpe: ['Chemical-resistant gloves', 'Safety goggles'],
    firstAidMeasures: 'Rinse exposed skin or eyes and obtain medical advice when symptoms persist.',
    fireMeasures: 'Use foam, dry powder, or carbon dioxide and control contaminated run-off.',
    handlingStorage: 'Keep sealed in a ventilated area away from heat and incompatible materials.',
    spillResponse: 'Ventilate, contain with inert absorbent, and prevent entry into drains.',
    disposal: 'Use an authorized waste contractor for product and contaminated absorbent.',
    emergencyContact: 'Migration Coatings emergency line +31 20 555 0199.',
    revisionReason: 'Manufacturer source and operational controls retained for hosted migration verification.'
  }, { actor: 'migration_fixture' });
  source.resolveApproval(sdsRequest.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration SDS manufacturer PDF, product identity, dates, and field controls verified.'
  });
  const sdsRevision = source.getSdsSheet(sdsRequest.id);
  const drawingEvidenceBytes = Buffer.from(`%PDF-1.7\nGoverned hosted migration drawing ${suffix}\n%%EOF`);
  const drawingStorageRef = `data/uploads/${suffix}-drawing-A-201-C01.pdf`;
  const drawingDocument = source.addDocument(job.id, {
    type: 'drawing_pdf',
    title: 'Migration construction drawing source',
    filename: `${suffix}-drawing-A-201-C01.pdf`,
    mimeType: 'application/pdf',
    size: drawingEvidenceBytes.length,
    storageRef: drawingStorageRef,
    status: 'stored',
    analysis: {
      upload: {
        sha256: crypto.createHash('sha256').update(drawingEvidenceBytes).digest('hex'),
        signatureVerified: true
      }
    }
  }, { actor: 'migration_fixture' });
  const drawingRequest = source.createDrawingRevision(job.id, {
    entryKey: `migration-drawing-revision-${suffix}`,
    sheetNumber: 'MIG-A-201',
    revision: 'C01',
    title: 'Migration first-floor construction plan',
    discipline: 'architecture',
    purpose: 'for_construction',
    issueDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    scale: '1:50',
    zone: 'First floor',
    sourceDocumentId: drawingDocument.id,
    revisionReason: 'Migration drawing source and revision controls retained for hosted verification.',
    reviewNotes: 'Migration title block and issue purpose checked.'
  }, { actor: 'migration_fixture' });
  source.resolveApproval(drawingRequest.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration drawing PDF, title block, revision, and issue purpose verified.'
  });
  const drawingRevision = source.getDrawingRevision(drawingRequest.id);
  const controlledDocument = source.createControlledDocumentRevision(job.id, {
    documentNumber: 'MIG-A-101',
    revision: 'P01',
    title: 'Migration controlled construction plan',
    discipline: 'architectural',
    sourceReference: 'migration-private:MIG-A-101-P01'
  }, { actor: 'migration_fixture' });
  const controlledReview = source.transitionLifecycleRecord(job.id, 'document', controlledDocument.document.id, {
    status: 'approved',
    verificationReference: 'migration-controlled-check',
    notes: 'Controlled drawing source and identity checked before migration.'
  }, { actor: 'migration_fixture' });
  source.resolveApproval(controlledReview.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Controlled document migration fixture verified.'
  });
  source.addProgressUpdate(job.id, {
    progressPercent: 33.333333333,
    note: 'Evidence reference must follow the object-storage migration.',
    photos: [{ storageRef: localStorageRef }]
  }, { actor: 'migration_fixture' });
  const tradePartner = source.upsertTradePartner({
    name: `Migration Supplier ${suffix}`,
    partnerType: 'supplier',
    contactName: 'Migration order desk',
    email: `migration-supplier-${suffix}@example.test`,
    phone: '+31 10 555 12 34',
    address: 'Migration supplier street 8',
    city: 'Rotterdam',
    country: 'NL',
    registrationNumber: '66778899',
    vatNumber: 'NL123456789B01',
    verificationReference: `Migration fixture registry check ${suffix}`,
    verifiedAt: new Date(Date.now() - 86_400_000).toISOString(),
    data: { postalCode: '3011 AA' }
  }, { actor: 'migration_fixture' });
  const purchaseOrder = source.createPurchaseOrder(job.id, {
    supplier: tradePartner.name,
    tradePartnerId: tradePartner.id,
    status: 'ready_to_order',
    amount: 400,
    currency: 'EUR',
    items: [{ name: 'Migration payable materials', quantity: 1, unitCost: 400 }]
  }, { actor: 'migration_fixture' });
  source.resolveApproval(purchaseOrder.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration purchase commitment verified.'
  });
  const materialRequirement = source.addMaterialRequirement(job.id, {
    name: 'Migration payable materials', quantity: 1, unit: 'unit', status: 'needed'
  }, { actor: 'migration_fixture' });
  const materialReceipt = source.createMaterialReceipt(job.id, {
    purchaseOrderId: purchaseOrder.id,
    receiptReference: `MIGRATION-RECEIPT-${suffix}`,
    evidenceReference: `migration:signed-ticket:${suffix}`,
    deliveredAt: new Date(Date.now() - 60_000).toISOString(),
    receivedBy: 'Migration site receiver',
    entryKey: `migration-receipt-${suffix}`,
    lines: [{
      materialRequirementId: materialRequirement.id,
      itemName: 'Migration payable materials', unit: 'unit', receivedQuantity: 1, acceptedQuantity: 1, damagedQuantity: 0
    }]
  }, { actor: 'migration_fixture' }).receipt;
  const supplierInvoice = source.createSupplierInvoice(job.id, {
    purchaseOrderId: purchaseOrder.id,
    tradePartnerId: tradePartner.id,
    supplier: tradePartner.name,
    invoiceNumber: `MIGRATION-SUP-${suffix}`,
    invoiceDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    netAmount: 400,
    taxAmount: 84,
    total: 484,
    materialReceiptId: materialReceipt.id,
    notes: 'Retained supplier payable migration fixture.'
  }, { actor: 'migration_fixture' });
  source.resolveApproval(supplierInvoice.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration supplier invoice match verified.'
  });
  const supplierPayment = source.recordSupplierInvoicePayment(job.id, supplierInvoice.id, {
    amount: 484,
    paidAt: new Date().toISOString(),
    method: 'bank_transfer',
    reference: `MIGRATION-BANK-${suffix}`,
    notes: 'Retained payment evidence migration fixture.'
  }, { actor: 'migration_fixture' });
  source.resolveApproval(supplierPayment.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration supplier payment evidence verified.'
  });
  const costBudget = source.createBudgetLine(job.id, {
    status: 'baseline',
    costCode: 'MIG-COST-100',
    description: 'Migration cost forecast baseline',
    budgetAmount: 2000,
    forecastAmount: 1800
  }, { actor: 'migration_fixture' });
  source.resolveApproval(costBudget.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration cost baseline verified.'
  });
  const billingMilestone = source.createBillingMilestone(job.id, {
    title: 'Migration staged billing control',
    amount: 123456.78,
    taxRate: 21,
    plannedIssueAt: '2026-07-01T09:00:00.000Z',
    dueAt: '2026-07-31T23:59:59.000Z',
    notes: 'Retained staged billing migration fixture.'
  }, { actor: 'migration_fixture' });
  source.resolveApproval(billingMilestone.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration billing milestone verified against contract value.'
  });
  const organization = source.updateOrganizationProfile({
    legalName: `Migration Contractor ${suffix} B.V.`,
    registrationNumber: '44332211',
    vatNumber: 'NL987654321B01',
    email: `migration-${suffix}@example.test`,
    address: 'Migrationstraat 1',
    postalCode: '3511 AA',
    city: 'Utrecht',
    country: 'NL',
    defaultPaymentTermsDays: 30,
    defaultQuoteValidityDays: 30
  }, { actor: 'migration_fixture' });
  source.createFieldReport(job.id, {
    status: 'draft',
    reportDate: '2026-07-13',
    workCompleted: 'Hosted migration completion evidence retained.'
  }, { actor: 'migration_fixture' });
  source.addProgressUpdate(job.id, {
    status: 'completed',
    progressPercent: 100,
    note: 'Hosted migration fixture completed.'
  }, { actor: 'migration_fixture' });
  const quality = source.addQualityCheck(job.id, {
    title: 'Hosted migration final quality review',
    status: 'approved',
    result: 'passed',
    defects: [],
    defectsOpen: 0,
    notes: 'No open defects remain in the migration fixture.'
  }, { actor: 'migration_fixture' });
  source.resolveApproval(quality.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration handover quality evidence verified.'
  });
  const handover = source.prepareHandoverIssuePackage(job.id, {}, { actor: 'migration_fixture' });
  const projectMeeting = source.createProjectMeeting(job.id, {
    title: 'Migration project coordination',
    meetingType: 'coordination',
    scheduledAt: '2026-07-13T09:00:00.000Z',
    attendees: [{ name: 'Migration project manager' }, { name: 'Migration site lead' }],
    agenda: ['Hosted migration readiness'],
    minutesSummary: 'The team reviewed local-to-hosted migration readiness and retained an assigned action.',
    decisions: ['Proceed after the verified backup is complete.'],
    actions: [{ title: 'Verify hosted readiness', ownerName: 'Migration project manager', dueAt: '2026-07-14' }]
  }, { actor: 'migration_fixture' });
  const projectMeetingSubmission = source.submitProjectMeetingMinutes(job.id, projectMeeting.id);
  source.resolveApproval(projectMeetingSubmission.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration meeting snapshot, decision, and action verified.'
  });
  scheduleBaseline = source.requestScheduleBaseline(job.id, {
    plannedStart: '2026-07-20T08:00:00.000Z',
    reason: 'Meeting action task included in the retained hosted migration baseline.'
  }, { actor: 'migration_fixture' });
  source.resolveApproval(scheduleBaseline.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Updated migration work plan verified after meeting action approval.'
  });
  const costForecastRequest = source.requestCostForecastSnapshot(job.id, {}, { actor: 'migration_fixture' });
  source.resolveApproval(costForecastRequest.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration source-linked cost forecast verified.'
  });
  let costForecast = source.calculateCostForecast(job.id).activeSnapshot;
  source.recordProjectMeetingIssue(job.id, projectMeeting.id, {
    deliveryReference: `migration-meeting-receipt:${suffix}`
  }, { actor: 'migration_fixture' });
  source.createOperatorSession({
    sessionIdHash: `local-session-${suffix}`,
    operatorId: 'local-owner',
    role: 'owner',
    tokenFingerprint: 'local-migration-token-fingerprint',
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString()
  });
  source.recordAuthenticationFailure(crypto.createHash('sha256').update(`migration-rate-limit-${suffix}`).digest('hex'));
  source.recordApiRateLimitRequest(crypto.createHash('sha256').update(`migration-api-rate-limit-${suffix}`).digest('hex'));
  const takeoff = source.createTakeoff(job.id, {
    title: 'Migration measured scope',
    items: [{
      description: 'Measured wall finish',
      measurementType: 'area',
      length: 12.5,
      width: 2.8,
      wastePercent: 7.5,
      unitCost: 14.25,
      unitPrice: 31.75,
      costCode: 'MIG-FIN-100'
    }]
  }, { actor: 'migration_fixture' });
  const convertedTakeoff = source.convertTakeoffToQuote(job.id, takeoff.id, {
    validUntil: '2026-12-31'
  }, { actor: 'migration_fixture' });
  const bidOpportunity = source.createOpportunity({
    clientName: `Migration tender client ${suffix}`,
    title: `Migration selected bid ${suffix}`,
    stage: 'estimating',
    estimatedValue: 75_000
  }, { actor: 'migration_fixture' });
  const bidPackage = source.createBidPackage(bidOpportunity.id, {
    title: 'Migration mechanical package',
    trade: 'Mechanical',
    scope: 'Supply, install, commission, and retain handover evidence for the complete mechanical scope.',
    dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    tradePartnerIds: [tradePartner.id]
  }, { actor: 'migration_fixture' });
  const bidReturn = source.recordBidReturn(bidPackage.id, bidPackage.participants[0].id, {
    amount: 23_456.78,
    taxRate: 21,
    receivedAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 45 * 86_400_000).toISOString(),
    durationDays: 30,
    evidenceReference: `MIGRATION-BID-RETURN-${suffix}`,
    exclusions: ['Builder-provided temporary power'],
    qualifications: ['Final coordination drawing approval']
  }, { actor: 'migration_fixture' });
  const bidSelection = source.requestBidPackageSelection(bidPackage.id, bidReturn.participant.id, {
    rationale: 'Verified compliant return retained as the migration purchasing basis.'
  }, { actor: 'migration_fixture' });
  source.resolveApproval(bidSelection.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration bid comparison and trade-partner evidence verified.'
  });
  const bidJob = source.convertOpportunityToJob(bidOpportunity.id, {}, { actor: 'migration_fixture' }).job;
  const preparedBidCommitment = source.createBidPackageCommitment(bidPackage.id, {
    requiredBy: new Date(Date.now() + 60 * 86_400_000).toISOString(),
    costCode: 'MIG-SUB-410',
    notes: 'Retain the exact approved selected-bid envelope through environment migration.'
  }, { actor: 'migration_fixture' });
  source.resolveApproval(preparedBidCommitment.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration purchasing envelope, source hash, and current partner compliance verified.'
  });
  const bidOrderPackage = source.preparePurchaseOrderIssuePackage(
    bidJob.id,
    preparedBidCommitment.purchaseOrder.id,
    {},
    { actor: 'migration_fixture' }
  );
  source.resolveApproval(bidOrderPackage.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration order recipient and both immutable attachments verified.'
  });
  source.recordCommunicationDelivery(bidOrderPackage.communication.id, {
    integration: 'migration_verified_order_provider',
    providerMessageId: `migration-order-${suffix}`
  }, { actor: 'migration_fixture_provider' });
  const bidCommitment = source.getBidPackage(bidPackage.id).commitment;
  const productionBaselineRequest = source.requestProductionBaseline(job.id, {
    lines: [{
      lineKey: 'migration-installed-area',
      costCode: 'MIG-PROD-100',
      description: 'Migration installed finish area',
      unit: 'm2',
      plannedQuantity: 250,
      plannedLaborHours: 200
    }]
  }, { actor: 'migration_fixture' });
  source.resolveApproval(productionBaselineRequest.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration production baseline quantities and labor hours verified.'
  });
  const productionEntry = source.recordProductionEntry(job.id, {
    entryKey: `migration-production-${suffix}-0001`,
    lineKey: 'migration-installed-area',
    workDate: '2026-07-13',
    quantity: 62.5,
    crewHours: 48,
    note: 'Migration production evidence retained for hosted parity.'
  }, { actor: 'migration_fixture' }).entry;
  const productionBaseline = source.calculateProductionPerformance(job.id).activeBaseline;
  const attendanceWorker = source.upsertWorker({
    name: `Migration attendance worker ${suffix}`,
    role: 'Installer',
    status: 'available'
  }, { actor: 'migration_fixture' });
  let attendanceAssignment = source.addAssignment(job.id, {
    workerId: attendanceWorker.id,
    status: 'active'
  }, { actor: 'migration_fixture' });
  if (attendanceAssignment.approval?.id) {
    source.resolveApproval(attendanceAssignment.approval.id, {
      status: 'approved', resolvedBy: 'migration_fixture_approver', reason: 'Migration attendance assignment verified.'
    });
    attendanceAssignment = source.getJobDetail(job.id).assignments.find(item => item.id === attendanceAssignment.id);
  }
  const preTaskJha = source.createJhaRecord(job.id, {
    title: `Migration approved installation JHA ${suffix}`,
    status: 'approved',
    riskLevel: 'high',
    hazards: ['Stored energy', 'Restricted access'],
    controls: ['Isolation and lockout', 'Controlled access'],
    stopWorkTriggers: ['Isolation boundary changes']
  }, { actor: 'migration_fixture' });
  source.resolveApproval(preTaskJha.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration JHA hazards and controls verified.'
  });
  const preTaskRequest = source.createPreTaskPlan(job.id, {
    entryKey: `migration-pre-task-plan-${suffix}`,
    workDate: new Date().toISOString().slice(0, 10),
    shiftLabel: 'Day shift',
    title: 'Migration distribution installation plan',
    location: 'Migration plant room',
    preparedBy: 'Migration site supervisor',
    responsibleWorkerId: attendanceWorker.id,
    jhaId: preTaskJha.id,
    sdsSheetIds: [sdsRevision.id],
    evidenceReference: `migration-method-statement:${suffix}`,
    emergencyArrangements: 'Use the retained emergency route and report to the assembly point.',
    stopWorkTriggers: ['Isolation boundary changes', 'Unplanned simultaneous operations'],
    steps: [{
      stepKey: 'isolate-and-install',
      description: 'Isolate the supply and install the distribution equipment',
      hazards: ['Stored electrical energy', 'Manual handling'],
      controls: ['Lock, tag, test, and use the planned lifting aid']
    }]
  }, { actor: 'migration_fixture' });
  source.resolveApproval(preTaskRequest.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration plan sources, steps, controls, and frozen crew verified.'
  });
  source.acknowledgePreTaskPlan(job.id, preTaskRequest.plan.id, {
    entryKey: `migration-pre-task-ack-${suffix}`,
    workerId: attendanceWorker.id,
    acknowledged: true,
    evidenceReference: `migration-worker-attestation:${suffix}`,
    attestation: 'I reviewed the retained plan and stop-work triggers.'
  }, { actor: 'migration_field_worker', workerId: attendanceWorker.id });
  const preTaskPlan = source.getPreTaskPlan(preTaskRequest.plan.id);
  const expenseReceiptRequest = source.createExpenseReceipt(job.id, {
    entryKey: `migration-expense-${suffix}`,
    workerId: attendanceWorker.id,
    expenseDate: new Date().toISOString().slice(0, 10),
    category: 'materials',
    vendor: `Migration merchant ${suffix}`,
    receiptReference: `MIGRATION-EXPENSE-${suffix}`,
    totalAmount: 242,
    taxAmount: 42,
    taxTreatment: 'recoverable',
    paymentMethod: 'personal_card',
    costCode: 'MIG-EXP-100',
    notes: 'Retained governed expense receipt migration fixture.'
  }, { actor: 'migration_fixture' });
  source.resolveApproval(expenseReceiptRequest.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration receipt identity, assignment, VAT, and project allocation verified.'
  });
  const expenseReceipt = source.getExpense(expenseReceiptRequest.expense.id);
  const environmentalActivityRequest = source.createEnvironmentalActivity(job.id, {
    entryKey: `migration-environmental-${suffix}`,
    workerId: attendanceWorker.id,
    activityDate: new Date().toISOString().slice(0, 10),
    category: 'fuel',
    ghgScope: 'scope_1',
    description: `Migration generator diesel ${suffix}`,
    quantity: 75,
    unit: 'litre',
    emissionFactor: 2.68,
    factorSource: 'Migration retained factor library',
    factorReference: `migration-factor:diesel:${suffix}`,
    evidenceReference: `migration-fuel-ticket:${suffix}`,
    notes: 'Retained environmental migration fixture.'
  }, { actor: 'migration_fixture' });
  source.resolveApproval(environmentalActivityRequest.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration activity quantity, evidence, scope, and factor provenance verified.'
  });
  const environmentalActivity = source.getEnvironmentalActivity(environmentalActivityRequest.activity.id);
  const environmentalReportRequest = source.requestEnvironmentalReport(job.id, {}, { actor: 'migration_fixture' });
  source.resolveApproval(environmentalReportRequest.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration environmental source set and report checksums verified.'
  });
  const environmentalReport = source.getEnvironmentalReport(environmentalReportRequest.report.id);
  const refreshedCostForecastRequest = source.requestCostForecastSnapshot(job.id, {}, { actor: 'migration_fixture' });
  source.resolveApproval(refreshedCostForecastRequest.approval.id, {
    status: 'approved',
    resolvedBy: 'migration_fixture_approver',
    reason: 'Migration forecast refreshed after governed expense recognition.'
  });
  costForecast = source.calculateCostForecast(job.id).activeSnapshot;
  const custodyTool = source.upsertTool({
    name: `Migration custody lift ${suffix}`,
    category: 'access',
    status: 'available',
    currentLocation: 'Migration depot'
  }, { actor: 'migration_fixture' });
  const custodyReservation = source.reserveTool(job.id, {
    toolId: custodyTool.id,
    toolName: custodyTool.name,
    status: 'reserved',
    neededUntil: new Date(Date.now() + 86_400_000).toISOString()
  }, { actor: 'migration_fixture' });
  const custodyCheckout = source.checkoutEquipment(job.id, {
    reservationId: custodyReservation.id,
    workerId: attendanceWorker.id,
    checkedOutAt: new Date(Date.now() - 120_000).toISOString(),
    checkedOutBy: attendanceWorker.name,
    condition: 'good',
    location: 'Migration project gate',
    meter: 88.5,
    evidenceReference: `migration:equipment-handoff:${suffix}`,
    entryKey: `migration-equipment-checkout-${suffix}`
  }, { actor: 'migration_fixture' }).custody;
  const equipmentCustody = source.returnEquipment(job.id, custodyCheckout.id, {
    returnedAt: new Date(Date.now() - 60_000).toISOString(),
    returnedBy: attendanceWorker.name,
    condition: 'damaged',
    location: 'Migration quarantine bay',
    meter: 91.25,
    evidenceReference: `migration:equipment-return:${suffix}`,
    entryKey: `migration-equipment-return-${suffix}`,
    notes: 'Retained guard damage requires hosted maintenance review.'
  }, { actor: 'migration_fixture' }).custody;
  const qualificationRequirement = source.createQualificationRequirement(job.id, {
    credentialType: 'vca',
    title: 'Migration VCA site qualification',
    role: 'Installer'
  }, { actor: 'migration_fixture' }).requirement;
  const credentialRequest = source.requestWorkerCredential(attendanceWorker.id, {
    credentialType: 'vca_vol',
    issuer: 'Migration SSVV source',
    credentialNumber: `MIGRATION-VCA-${suffix}`,
    issuedOn: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
    expiresOn: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10),
    evidenceReference: `Migration retained VCA evidence ${suffix}`
  }, { actor: 'migration_fixture' });
  source.resolveApproval(credentialRequest.approval.id, {
    status: 'approved', resolvedBy: 'migration_fixture_approver', reason: 'Migration worker credential source verified.'
  });
  const workerCredential = source.getWorkerCredential(credentialRequest.credential.id);
  const availabilityStart = new Date(Date.now() + 150 * 86_400_000).toISOString();
  const availabilityPeriod = source.createWorkerAvailabilityPeriod(attendanceWorker.id, {
    periodType: 'training',
    title: 'Migration equipment training',
    startsAt: availabilityStart,
    endsAt: new Date(Date.parse(availabilityStart) + 8 * 3_600_000).toISOString(),
    notes: 'Migration operational availability fixture.'
  }, { actor: 'migration_fixture' }).period;
  const attendanceOrientation = source.createWorkerOrientation(job.id, {
    assignmentId: attendanceAssignment.id,
    workerId: attendanceWorker.id,
    workerName: attendanceWorker.name,
    status: 'completed'
  }, { actor: 'migration_fixture' });
  source.resolveApproval(attendanceOrientation.approvalId, {
    status: 'approved', resolvedBy: 'migration_fixture_approver', reason: 'Migration attendance orientation verified.'
  });
  const attendanceAccess = source.createSiteAccessLog(job.id, {
    assignmentId: attendanceAssignment.id,
    workerId: attendanceWorker.id,
    workerName: attendanceWorker.name,
    orientationId: attendanceOrientation.id,
    orientationValid: true,
    status: 'cleared'
  }, { actor: 'migration_fixture' });
  source.resolveApproval(attendanceAccess.approvalId, {
    status: 'approved', resolvedBy: 'migration_fixture_approver', reason: 'Migration attendance access verified.'
  });
  const attendanceCheckInAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const attendanceCheckOutAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const attendanceSession = source.recordAttendanceCheckIn(job.id, {
    assignmentId: attendanceAssignment.id,
    workerId: attendanceWorker.id,
    occurredAt: attendanceCheckInAt,
    entryKey: `migration-attendance-in-${suffix}`
  }, { actor: 'migration_fixture' }).session;
  source.recordAttendanceCheckOut(job.id, attendanceSession.id, {
    workerId: attendanceWorker.id,
    occurredAt: attendanceCheckOutAt,
    entryKey: `migration-attendance-out-${suffix}`
  }, { actor: 'migration_fixture' });
  const week = new Date();
  week.setUTCHours(0, 0, 0, 0);
  week.setUTCDate(week.getUTCDate() - (week.getUTCDay() || 7) - 6);
  const timesheetPeriodStart = week.toISOString().slice(0, 10);
  const timesheetJob = source.createIntake({
    title: `Migration timesheet job ${suffix}`,
    client: { name: `Migration timesheet client ${suffix}` },
    status: 'in_progress',
    assignAutomatically: false
  }, { actor: 'migration_fixture' });
  source.addTimeLog(timesheetJob.id, {
    workerId: attendanceWorker.id,
    workDate: timesheetPeriodStart,
    hours: 7.5,
    rate: 44,
    source: 'migration_verified_timecard',
    verificationReference: `migration-time-${suffix}`
  }, { actor: 'migration_fixture' });
  const timesheetRequest = source.requestWeeklyTimesheet(attendanceWorker.id, { periodStart: timesheetPeriodStart }, { actor: 'migration_fixture' });
  source.resolveApproval(timesheetRequest.approval.id, {
    status: 'approved', resolvedBy: 'migration_fixture_approver', reason: 'Migration weekly timesheet sources verified.'
  });
  const weeklyTimesheet = source.getWeeklyTimesheet(timesheetRequest.timesheet.id);
  const timesheetExport = source.prepareTimesheetExport({ periodStart: timesheetPeriodStart }, { actor: 'migration_fixture' }).export;
  const dayworkRequest = source.createDayworkTicket(job.id, {
    entryKey: `migration-daywork-${suffix}`,
    workerId: attendanceWorker.id,
    workDate: new Date().toISOString().slice(0, 10),
    title: 'Migration additional support work',
    description: 'Retained additional support installation for environment migration verification.',
    reason: 'Existing site condition differed from the retained coordination basis.',
    evidenceReference: `migration-daywork-evidence:${suffix}`,
    lines: [
      { lineKey: 'migration-daywork-labor', lineType: 'labor', description: 'Installation labor', quantity: 2, unit: 'hour', costCode: 'MIG-DW-LAB' },
      { lineKey: 'migration-daywork-material', lineType: 'material', description: 'Support bracket', quantity: 4, unit: 'piece', costCode: 'MIG-DW-MAT' }
    ]
  }, { actor: 'migration_fixture' });
  source.resolveApproval(dayworkRequest.approval.id, {
    status: 'approved', resolvedBy: 'migration_fixture_approver', reason: 'Migration daywork quantities and evidence verified.'
  });
  const dayworkAcknowledgement = source.requestDayworkAcknowledgement(job.id, dayworkRequest.ticket.id, {
    evidenceReference: `migration-daywork-signed:${suffix}`,
    acknowledgedBy: 'Migration client representative',
    acknowledgedAt: new Date().toISOString()
  }, { actor: 'migration_fixture' });
  source.resolveApproval(dayworkAcknowledgement.approval.id, {
    status: 'approved', resolvedBy: 'migration_fixture_approver', reason: 'Migration daywork receipt evidence verified.'
  });
  const daywork = source.convertDayworkTicketToChangeOrder(job.id, dayworkRequest.ticket.id, {
    prices: [
      { lineKey: 'migration-daywork-labor', unitPrice: 75 },
      { lineKey: 'migration-daywork-material', unitPrice: 25 }
    ],
    taxRate: 21
  }, { actor: 'migration_fixture' });
  const nonconformanceRequest = source.createNonconformance(job.id, {
    entryKey: `migration-ncr-${suffix}`,
    workerId: attendanceWorker.id,
    workerName: attendanceWorker.name,
    severity: 'high',
    discipline: 'structural',
    title: 'Migration anchor spacing deviation',
    description: 'Retained measurements show anchor spacing outside the approved detail.',
    location: 'Migration facade bay M4',
    detectedAt: new Date().toISOString(),
    raisedBy: attendanceWorker.name,
    requirementReference: 'Migration detail STR-421 revision C',
    immediateContainment: 'Held covering work and marked the affected bay.',
    responsibleParty: 'Migration facade supervisor',
    dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  }, { actor: 'migration_fixture' });
  const nonconformanceCorrection = source.requestNonconformanceCorrectiveAction(job.id, nonconformanceRequest.nonconformance.id, {
    rootCause: 'Setting-out reference came from a superseded workshop sketch.',
    correctiveAction: 'Install supplementary anchors and retain repeat test evidence.',
    responsibleParty: 'Migration facade supervisor',
    dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    evidenceReference: `migration-ncr-correction:${suffix}`
  }, { actor: 'migration_fixture' });
  source.resolveApproval(nonconformanceCorrection.approval.id, {
    status: 'approved', resolvedBy: 'migration_fixture_approver', reason: 'Migration correction basis verified.'
  });
  const nonconformanceClosure = source.requestNonconformanceClosure(job.id, nonconformanceRequest.nonconformance.id, {
    verificationResult: 'passed',
    verificationEvidence: `migration-ncr-verification:${suffix}`,
    verifiedBy: 'Migration independent quality lead',
    verifiedAt: new Date().toISOString()
  }, { actor: 'migration_fixture' });
  source.resolveApproval(nonconformanceClosure.approval.id, {
    status: 'approved', resolvedBy: 'migration_fixture_approver', reason: 'Migration independent verification matched the correction.'
  });
  const nonconformance = source.getNonconformance(nonconformanceRequest.nonconformance.id);
  source.close();

  const backupId = `2026-07-13T12-00-00-${suffix}`;
  const backupDir = path.join(directory, 'backups', backupId);
  const backupLedger = path.join(backupDir, 'contractor-ledger.sqlite');
  const backupEvidence = path.join(backupDir, 'evidence', `${suffix}-site-proof.jpg`);
  const backupSdsEvidence = path.join(backupDir, 'evidence', `${suffix}-manufacturer-sds.pdf`);
  const backupDrawingEvidence = path.join(backupDir, 'evidence', `${suffix}-drawing-A-201-C01.pdf`);
  fs.mkdirSync(path.dirname(backupEvidence), { recursive: true });
  fs.copyFileSync(sourceFile, backupLedger);
  fs.writeFileSync(backupEvidence, evidenceBytes);
  fs.writeFileSync(backupSdsEvidence, sdsEvidenceBytes);
  fs.writeFileSync(backupDrawingEvidence, drawingEvidenceBytes);
  const files = [
    { file: 'contractor-ledger.sqlite', target: backupLedger },
    { file: `evidence/${suffix}-site-proof.jpg`, target: backupEvidence },
    { file: `evidence/${suffix}-manufacturer-sds.pdf`, target: backupSdsEvidence },
    { file: `evidence/${suffix}-drawing-A-201-C01.pdf`, target: backupDrawingEvidence }
  ].map(entry => ({
    file: entry.file,
    bytes: fs.statSync(entry.target).size,
    sha256: digest(entry.target)
  }));
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({
    format: 'contractor-ai-backup-manifest/v2',
    backupId,
    createdAt: '2026-07-13T12:00:00.000Z',
    databaseMode: 'sqlite',
    evidence: { included: true, fileCount: 3 },
    files
  }, null, 2));
  return { attendanceSession, availabilityPeriod, backupDir, backupId, bidCommitment, bidJob, bidOrderPackage, bidPackage, billingMilestone, controlledDocument, convertedTakeoff, costForecast, daywork, document, drawingDocument, drawingEvidenceBytes, drawingRevision, drawingStorageRef, environmentalActivity, environmentalReport, equipmentCustody, evidenceBytes, expenseReceipt, handover, job, localStorageRef, materialReceipt, nonconformance, organization, preTaskPlan, productionBaseline, productionEntry, projectMeeting, qualificationRequirement, scheduleBaseline, sdsDocument, sdsEvidenceBytes, sdsRevision, sdsStorageRef, supplierInvoice, supplierPayment, takeoff, taskDependency, timesheetExport, timesheetPeriodStart, tradePartner, weeklyTimesheet, workerCredential };
}

class FakeHostedStorage {
  constructor({ corruptRead = false } = {}) {
    this.corruptRead = corruptRead;
    this.objects = new Map();
    this.counter = 0;
  }

  async verify() {
    return { ready: true, mode: 's3', checkedAt: new Date().toISOString() };
  }

  async store(file) {
    const filename = `migrated-${++this.counter}-${file.originalName}`;
    const storageRef = `s3://migration-test/${filename}`;
    this.objects.set(storageRef, Buffer.from(file.buffer));
    return { filename, storageRef, size: file.size, mimeType: file.mimeType };
  }

  async read(storageRef) {
    const value = this.objects.get(storageRef);
    return this.corruptRead ? Buffer.from('corrupt') : Buffer.from(value);
  }

  async remove(storageRef) {
    return this.objects.delete(storageRef);
  }
}

test('backup verifier requires an intact v2 SQLite ledger and evidence set', t => {
  const fixture = createBackupFixture(t, 'verify');
  const verified = verifyBackupDirectory(fixture.backupDir);
  assert.equal(verified.manifest.backupId, fixture.backupId);
  assert.equal(verified.evidenceFiles.length, 3);
  fs.appendFileSync(path.join(fixture.backupDir, 'evidence', 'verify-site-proof.jpg'), 'tampered');
  assert.throws(() => verifyBackupDirectory(fixture.backupDir), /checksum failed/i);
});

test('hosted migration CLI requires an exact confirmation and safe backup id', () => {
  const script = path.join(__dirname, '..', 'scripts', 'migrate-local-backup-to-hosted.js');
  const unconfirmed = spawnSync(process.execPath, [script, '--backup-id', 'backup-safe'], { encoding: 'utf8' });
  assert.equal(unconfirmed.status, 1);
  assert.match(unconfirmed.stderr, /--confirm MIGRATE_backup-safe/);
  const traversal = spawnSync(process.execPath, [script, '--backup-id', '..', '--confirm', 'MIGRATE_..'], { encoding: 'utf8' });
  assert.equal(traversal.status, 1);
  assert.match(traversal.stderr, /valid verified local backup id/i);
});

test('hosted migration orders self-referential follow-up rows without treating the table as a cycle', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(`
      CREATE TABLE jobs (id TEXT PRIMARY KEY);
      CREATE TABLE project_meetings (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id),
        previous_meeting_id TEXT REFERENCES project_meetings(id)
      );
    `);
    assert.deepEqual(orderedSourceTables(database, ['project_meetings', 'jobs']), ['jobs', 'project_meetings']);
    const followUp = { id: 'meeting_follow_up', job_id: 'job_1', previous_meeting_id: 'meeting_original' };
    const original = { id: 'meeting_original', job_id: 'job_1', previous_meeting_id: null };
    assert.deepEqual(
      orderedSelfReferentialRows(database, 'project_meetings', [followUp, original]),
      [original, followUp]
    );
  } finally {
    database.close();
  }
});

test('hosted evidence rewrites preserve immutable governed SDS and drawing source snapshots', () => {
  const originalData = JSON.stringify({
    documentReference: 'manufacturer-sds.pdf',
    documentChecksum: 'retained-checksum',
    hazardClasses: ['H315']
  });
  const originalSnapshot = JSON.stringify({
    format: 'contractor-ai-sds-revision/v1',
    documentReference: 'manufacturer-sds.pdf',
    documentChecksum: 'retained-checksum'
  });
  const rewritten = rewriteRowReferences('sds_sheets', {
    id: 'sds_migration_fixture',
    data_json: originalData,
    snapshot_json: originalSnapshot
  }, ['id', 'data_json', 'snapshot_json'], new Map([
    ['manufacturer-sds.pdf', 'migrated-2-manufacturer-sds.pdf']
  ]));
  assert.equal(rewritten.data_json, originalData);
  assert.equal(rewritten.snapshot_json, originalSnapshot);

  const drawingData = JSON.stringify({ sourceDocumentReference: 'drawing-A-201-C01.pdf', sourceDocumentChecksum: 'drawing-checksum' });
  const drawingSnapshot = JSON.stringify({ format: 'contractor-ai-drawing-revision/v1', sourceDocumentReference: 'drawing-A-201-C01.pdf' });
  const rewrittenDrawing = rewriteRowReferences('documents', {
    id: 'drawing_migration_fixture',
    type: 'drawing_revision',
    storage_ref: 'data/uploads/drawing-A-201-C01.pdf',
    data_json: drawingData,
    snapshot_json: drawingSnapshot
  }, ['id', 'type', 'storage_ref', 'data_json', 'snapshot_json'], new Map([
    ['data/uploads/drawing-A-201-C01.pdf', 'hosted/drawing-A-201-C01.pdf'],
    ['drawing-A-201-C01.pdf', 'migrated-drawing-A-201-C01.pdf']
  ]));
  assert.equal(rewrittenDrawing.storage_ref, 'hosted/drawing-A-201-C01.pdf');
  assert.equal(rewrittenDrawing.data_json, drawingData);
  assert.equal(rewrittenDrawing.snapshot_json, drawingSnapshot);
});

test('verified local backup migrates losslessly to empty PostgreSQL and private object storage', { skip: !connectionString }, async t => {
  const targetUrl = await createTestDatabase(t, 'success');
  const fixture = createBackupFixture(t, 'success');
  const storage = new FakeHostedStorage();
  const migration = await migrateLocalBackupToHosted({
    backupDir: fixture.backupDir,
    databaseUrl: targetUrl,
    storage,
    actor: 'migration_integration_test'
  });

  assert.equal(migration.success, true);
  assert.equal(migration.backupId, fixture.backupId);
  assert.equal(migration.evidenceFiles, 3);
  assert.equal(migration.invalidatedOperatorSessions, 1);
  assert.equal(migration.clearedAuthenticationRateLimits, 1);
  assert.equal(migration.clearedApiRateLimits, 1);
  assert.equal(migration.migrationVersion, '048_thirteen_week_cash_flow_forecast');
  assert.equal(migration.sourceAuditIntegrity.supported, true);
  assert.equal(migration.sourceAuditIntegrity.valid, true);
  assert.equal(migration.auditIntegrity.valid, true);
  assert.equal(migration.diagnostics.valid, true);
  assert.equal(storage.objects.size, 3);
  assert.ok([...storage.objects.values()].some(value => value.equals(fixture.evidenceBytes)));
  assert.ok([...storage.objects.values()].some(value => value.equals(fixture.sdsEvidenceBytes)));
  assert.ok([...storage.objects.values()].some(value => value.equals(fixture.drawingEvidenceBytes)));

  const hosted = new ContractorOperatingLedger({ databaseUrl: targetUrl });
  try {
    const detail = hosted.getJobDetail(fixture.job.id, { includeAudit: true });
    const migratedMeeting = detail.projectMeetings.find(item => item.id === fixture.projectMeeting.id);
    assert.equal(migratedMeeting.status, 'issued');
    assert.equal(migratedMeeting.deliveryReference, `migration-meeting-receipt:success`);
    assert.ok(migratedMeeting.actions[0].linkedTaskId);
    assert.equal(detail.contractValue, 987654321.123456);
    assert.ok(detail.documents.some(document =>
      document.id === fixture.controlledDocument.document.id
      && document.documentNumber === 'MIG-A-101'
      && document.revision === 'P01'
      && document.status === 'approved'
      && document.data.isCurrent === true
    ));
    const migratedDrawing = detail.drawings.find(item => item.id === fixture.drawingRevision.id);
    assert.equal(migratedDrawing.status, 'current');
    assert.equal(migratedDrawing.current, true);
    assert.equal(migratedDrawing.integrityValid, true);
    assert.equal(migratedDrawing.sourceHash, fixture.drawingRevision.sourceHash);
    assert.equal(migratedDrawing.snapshotHash, fixture.drawingRevision.snapshotHash);
    assert.equal(migratedDrawing.sourceDocumentId, fixture.drawingDocument.id);
    assert.equal(detail.estimatedHours, 123.123456789);
    const migratedTakeoff = detail.takeoffs.find(item => item.id === fixture.takeoff.id);
    assert.equal(migratedTakeoff.status, 'converted');
    assert.equal(migratedTakeoff.integrityValid, true);
    assert.equal(migratedTakeoff.quoteId, fixture.convertedTakeoff.quote.id);
    assert.equal(migratedTakeoff.items[0].quantity, 37.625);
    assert.equal(detail.quotes.find(item => item.id === migratedTakeoff.quoteId).data.source.snapshotHash, migratedTakeoff.snapshotHash);
    const migratedBillingMilestone = detail.billingMilestones.find(item => item.id === fixture.billingMilestone.id);
    assert.equal(migratedBillingMilestone.status, 'approved');
    assert.equal(migratedBillingMilestone.amount, 123456.78);
    assert.equal(migratedBillingMilestone.taxAmount, 25925.92);
    assert.equal(migratedBillingMilestone.invoiceId, null);
    assert.ok(detail.taskDependencies.some(item => item.id === fixture.taskDependency.id && item.status === 'active'));
    assert.equal(detail.scheduleControl.activeBaseline.id, fixture.scheduleBaseline.baseline.id);
    assert.equal(detail.scheduleControl.baselineCurrent, true);
    const migratedForecast = hosted.getCostForecastSnapshot(fixture.costForecast.id, { verifyCurrent: true });
    assert.equal(migratedForecast.forecastNumber, fixture.costForecast.forecastNumber);
    assert.equal(migratedForecast.status, 'approved');
    assert.equal(migratedForecast.integrityValid, true);
    assert.equal(migratedForecast.sourceCurrent, true);
    assert.equal(migratedForecast.snapshotHash, fixture.costForecast.snapshotHash);
    assert.ok(detail.costForecastSnapshots.some(item => item.id === fixture.costForecast.id));
    assert.equal(detail.productionControl.activeBaseline.id, fixture.productionBaseline.id);
    assert.equal(detail.productionControl.activeBaseline.integrityValid, true);
    assert.equal(detail.productionControl.lines[0].installedQuantity, 62.5);
    assert.equal(detail.productionControl.lines[0].crewHours, 48);
    assert.ok(detail.productionEntries.some(item => item.id === fixture.productionEntry.id && item.entryFingerprint === fixture.productionEntry.entryFingerprint));
    const migratedDaywork = detail.dayworkTickets.find(item => item.id === fixture.daywork.ticket.id);
    assert.equal(migratedDaywork.status, 'converted');
    assert.equal(migratedDaywork.integrityValid, true);
    assert.equal(migratedDaywork.sourceHash, fixture.daywork.ticket.sourceHash);
    assert.equal(migratedDaywork.changeOrderId, fixture.daywork.changeOrder.id);
    assert.ok(detail.changeOrders.some(item => item.id === fixture.daywork.changeOrder.id && item.data.source.id === migratedDaywork.id));
    const migratedNonconformance = detail.nonconformances.find(item => item.id === fixture.nonconformance.id);
    assert.equal(migratedNonconformance.status, 'closed');
    assert.equal(migratedNonconformance.integrityValid, true);
    assert.equal(migratedNonconformance.correctionIntegrityValid, true);
    assert.equal(migratedNonconformance.closureIntegrityValid, true);
    assert.equal(migratedNonconformance.sourceHash, fixture.nonconformance.sourceHash);
    assert.equal(migratedNonconformance.closureHash, fixture.nonconformance.closureHash);
    const migratedPreTaskPlan = detail.preTaskPlans.find(item => item.id === fixture.preTaskPlan.id);
    assert.equal(migratedPreTaskPlan.status, 'active');
    assert.equal(migratedPreTaskPlan.definitionIntegrityValid, true);
    assert.equal(migratedPreTaskPlan.prerequisitesCurrent, true);
    assert.equal(migratedPreTaskPlan.sourceHash, fixture.preTaskPlan.sourceHash);
    assert.equal(migratedPreTaskPlan.snapshotHash, fixture.preTaskPlan.snapshotHash);
    assert.equal(migratedPreTaskPlan.data.linkedSources.sdsSheets[0].id, fixture.sdsRevision.id);
    assert.equal(migratedPreTaskPlan.attendanceSummary.acknowledged, 1);
    assert.equal(migratedPreTaskPlan.attendees[0].entryFingerprint, fixture.preTaskPlan.attendees[0].entryFingerprint);
    assert.equal(migratedPreTaskPlan.attendees[0].integrityValid, true);
    const migratedAttendance = detail.attendanceSessions.find(item => item.id === fixture.attendanceSession.id);
    assert.equal(migratedAttendance.status, 'checked_out');
    assert.equal(migratedAttendance.checkInEntryFingerprint, fixture.attendanceSession.checkInEntryFingerprint);
    assert.equal(migratedAttendance.data.payrollDerived, false);
    const migratedCustody = detail.equipmentCustody.find(item => item.id === fixture.equipmentCustody.id);
    assert.equal(migratedCustody.status, 'exception');
    assert.equal(migratedCustody.checkoutFingerprint, fixture.equipmentCustody.checkoutFingerprint);
    assert.equal(migratedCustody.returnFingerprint, fixture.equipmentCustody.returnFingerprint);
    assert.equal(migratedCustody.returnCondition, 'damaged');
    const migratedExpense = detail.expenses.find(item => item.id === fixture.expenseReceipt.id);
    assert.equal(migratedExpense.status, 'approved');
    assert.equal(migratedExpense.entryFingerprint, fixture.expenseReceipt.entryFingerprint);
    assert.equal(migratedExpense.sourceFingerprint, fixture.expenseReceipt.sourceFingerprint);
    assert.equal(migratedExpense.totalAmount, 242);
    assert.equal(migratedExpense.costAmount, 200);
    assert.equal(migratedExpense.integrityValid, true);
    const migratedEnvironmentalActivity = detail.environmentalActivities.find(item => item.id === fixture.environmentalActivity.id);
    assert.equal(migratedEnvironmentalActivity.status, 'approved');
    assert.equal(migratedEnvironmentalActivity.entryFingerprint, fixture.environmentalActivity.entryFingerprint);
    assert.equal(migratedEnvironmentalActivity.sourceFingerprint, fixture.environmentalActivity.sourceFingerprint);
    assert.equal(migratedEnvironmentalActivity.emissionsKgCo2e, 201);
    assert.equal(migratedEnvironmentalActivity.integrityValid, true);
    const migratedEnvironmentalReport = hosted.getEnvironmentalReportContent(fixture.environmentalReport.id);
    assert.equal(migratedEnvironmentalReport.report.status, 'approved');
    assert.equal(migratedEnvironmentalReport.report.integrityValid, true);
    assert.equal(migratedEnvironmentalReport.report.sourceCurrent, true);
    assert.match(migratedEnvironmentalReport.content, /Migration generator diesel/);
    const migratedCredential = hosted.getWorkerCredential(fixture.workerCredential.id);
    assert.equal(migratedCredential.status, 'approved');
    assert.equal(migratedCredential.snapshotHash, fixture.workerCredential.snapshotHash);
    assert.equal(migratedCredential.credentialType, 'vca_vol');
    const migratedAvailability = hosted.getWorkerAvailabilityPeriod(fixture.availabilityPeriod.id);
    assert.equal(migratedAvailability.status, 'active');
    assert.equal(migratedAvailability.sourceFingerprint, fixture.availabilityPeriod.sourceFingerprint);
    assert.ok(detail.qualificationRequirements.some(item => item.id === fixture.qualificationRequirement.id && item.status === 'active'));
    assert.equal(hosted.assessWorkerQualifications(migratedCredential.workerId, {
      jobId: fixture.job.id,
      role: 'Installer',
      at: new Date().toISOString()
    }).status, 'ready');
    const migratedTimesheet = hosted.getWeeklyTimesheet(fixture.weeklyTimesheet.id);
    assert.equal(migratedTimesheet.status, 'approved');
    assert.equal(migratedTimesheet.integrityValid, true);
    assert.equal(migratedTimesheet.sourceHash, fixture.weeklyTimesheet.sourceHash);
    const migratedTimesheetExport = hosted.getTimesheetExportContent(fixture.timesheetExport.id);
    assert.equal(migratedTimesheetExport.export.integrityValid, true);
    assert.match(migratedTimesheetExport.content, /7\.50/);
    const migratedDocument = detail.documents.find(item => item.id === fixture.document.id);
    assert.match(migratedDocument.storageRef, /^s3:\/\/migration-test\/migrated-\d+-/);
    assert.notEqual(migratedDocument.storageRef, fixture.localStorageRef);
    const migratedSds = detail.sdsSheets.find(item => item.id === fixture.sdsRevision.id);
    assert.equal(migratedSds.status, 'current');
    assert.equal(migratedSds.current, true);
    assert.equal(migratedSds.integrityValid, true);
    assert.equal(migratedSds.productKey, fixture.sdsRevision.productKey);
    assert.equal(migratedSds.revisionNumber, 1);
    assert.equal(migratedSds.sourceHash, fixture.sdsRevision.sourceHash);
    assert.equal(migratedSds.snapshotHash, fixture.sdsRevision.snapshotHash);
    assert.equal(migratedSds.documentId, fixture.sdsDocument.id);
    const migratedSdsDocument = detail.documents.find(item => item.id === fixture.sdsDocument.id);
    assert.match(migratedSdsDocument.storageRef, /^s3:\/\/migration-test\/migrated-\d+-/);
    assert.notEqual(migratedSdsDocument.storageRef, fixture.sdsStorageRef);
    const progress = detail.progress.find(item => item.note.includes('Evidence reference'));
    assert.equal(progress.progressPercent, 33.333333333);
    assert.equal(progress.photos[0].storageRef, migratedDocument.storageRef);
    const migratedPartner = hosted.getTradePartner(fixture.tradePartner.id);
    assert.equal(migratedPartner.name, fixture.tradePartner.name);
    assert.equal(migratedPartner.compliance.status, 'verified');
    assert.equal(migratedPartner.data.verificationReference, fixture.tradePartner.data.verificationReference);
    const migratedBidPackage = hosted.getBidPackage(fixture.bidPackage.id);
    assert.equal(migratedBidPackage.jobId, fixture.bidJob.id);
    assert.equal(migratedBidPackage.commitment.purchaseOrderId, fixture.bidCommitment.purchaseOrderId);
    assert.equal(migratedBidPackage.commitment.status, 'ordered');
    assert.equal(migratedBidPackage.commitment.integrityValid, true);
    assert.equal(migratedBidPackage.commitment.spendAuthorized, true);
    assert.equal(migratedBidPackage.commitment.orderIssued, true);
    assert.equal(migratedBidPackage.commitment.awardIssued, true);
    assert.equal(migratedBidPackage.commitment.externalCommitments, 1);
    assert.equal(migratedBidPackage.commitment.issuePackage.providerMessageId, 'migration-order-success');
    assert.equal(migratedBidPackage.commitment.purchaseOrder.data.source.commitmentHash, migratedBidPackage.commitmentHash);
    const migratedOrderUbl = hosted.getPurchaseOrderIssueDocument(fixture.bidOrderPackage.ublDocument.id, { audit: false });
    assert.equal(migratedOrderUbl.packageHash, fixture.bidOrderPackage.packageHash);
    assert.match(migratedOrderUbl.content, /urn:oasis:names:specification:ubl:schema:xsd:Order-2/);
    const migratedBidJob = hosted.getJobDetail(fixture.bidJob.id);
    assert.ok(migratedBidJob.purchaseOrders.some(item =>
      item.id === fixture.bidCommitment.purchaseOrderId
      && item.status === 'ordered'
      && item.orderIssued === true
      && item.externalCommitments === 1
      && item.data.source.type === 'bid_package_commitment'
    ));
    const migratedSupplierInvoice = detail.supplierInvoices.find(item => item.id === fixture.supplierInvoice.id);
    assert.equal(migratedSupplierInvoice.status, 'paid');
    assert.equal(migratedSupplierInvoice.data.reconciliation.outstandingAmount, 0);
    assert.equal(migratedSupplierInvoice.data.match.materialReceiptId, fixture.materialReceipt.id);
    const migratedReceipt = detail.materialReceipts.find(item => item.id === fixture.materialReceipt.id);
    assert.equal(migratedReceipt.entryFingerprint, fixture.materialReceipt.entryFingerprint);
    assert.equal(migratedReceipt.summary.acceptedQuantity, 1);
    assert.ok(detail.supplierInvoicePayments.some(item => item.id === fixture.supplierPayment.id && item.status === 'paid'));
    const migratedOrganization = hosted.getOrganizationProfile();
    assert.equal(migratedOrganization.legalName, fixture.organization.legalName);
    assert.equal(migratedOrganization.registrationNumber, fixture.organization.registrationNumber);
    assert.equal(migratedOrganization.readiness.ready, true);
    const migratedHandover = hosted.getHandoverIssuePackage(fixture.handover.document.id, { audit: false });
    assert.equal(migratedHandover.packageHash, fixture.handover.packageHash);
    assert.equal(migratedHandover.document.data.evidenceHash, fixture.handover.evidenceHash);
    assert.match(migratedHandover.content, /Hosted migration success/);
    assert.equal(Number(hosted.db.prepare('SELECT COUNT(*) AS count FROM operator_sessions').get().count), 0);
    assert.equal(Number(hosted.db.prepare('SELECT COUNT(*) AS count FROM auth_rate_limits').get().count), 0);
    assert.equal(Number(hosted.db.prepare('SELECT COUNT(*) AS count FROM api_rate_limits').get().count), 0);
    const receipt = hosted.listAudit({ entityType: 'operational_migration', limit: 100 })
      .find(event => event.id === migration.receiptId);
    assert.equal(receipt.action, 'migrate_local_backup_to_hosted');
    assert.equal(receipt.metadata.sourceBackupId, fixture.backupId);
    assert.equal(receipt.metadata.databaseSha256, migration.databaseSha256);
    assert.equal(receipt.metadata.invalidatedOperatorSessions, 1);
    assert.equal(receipt.metadata.clearedAuthenticationRateLimits, 1);
    assert.equal(receipt.metadata.clearedApiRateLimits, 1);
  } finally {
    hosted.close();
  }

  await assert.rejects(
    migrateLocalBackupToHosted({ backupDir: fixture.backupDir, databaseUrl: targetUrl, storage }),
    /target is not empty/i
  );
  assert.equal(storage.objects.size, 3);
});

test('failed evidence verification rolls back PostgreSQL and removes uploaded objects', { skip: !connectionString }, async t => {
  const targetUrl = await createTestDatabase(t, 'rollback');
  const fixture = createBackupFixture(t, 'rollback');
  const storage = new FakeHostedStorage({ corruptRead: true });
  await assert.rejects(
    migrateLocalBackupToHosted({ backupDir: fixture.backupDir, databaseUrl: targetUrl, storage }),
    /read-back verification failed/i
  );
  assert.equal(storage.objects.size, 0);

  const target = new ContractorOperatingLedger({ databaseUrl: targetUrl });
  try {
    assert.equal(target.listJobs({ includeArchived: true, limit: 100 }).length, 0);
    assert.equal(target.listAudit({ limit: 100 }).length, 0);
    assert.equal(target.diagnose().valid, true);
  } finally {
    target.close();
  }
});
