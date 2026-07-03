const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-api-'));
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');

const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  return { response, body };
}

test('API lifecycle keeps worker and tool state consistent', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const dashboard = await request(baseUrl, '/api/dashboard');
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.source, 'node');

  const toolResponse = await request(baseUrl, '/api/tools', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Cordless Drill',
      category: 'power_tools',
      location: 'Warehouse'
    })
  });
  assert.equal(toolResponse.response.status, 201);

  const createResponse = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    body: JSON.stringify({
      title: 'API lifecycle repair',
      client: 'Regression Client',
      address: 'Amsterdam',
      description: 'General repair requiring a cordless drill',
      priority: 'high',
      tools: ['Cordless Drill'],
      estimatedCost: 250
    })
  });
  assert.equal(createResponse.response.status, 201);
  const jobId = createResponse.body.id;
  const ledgerJobId = createResponse.body.ledgerJobId;
  assert.ok(ledgerJobId);

  const ledgerCreated = await request(baseUrl, `/api/ledger/jobs/${ledgerJobId}`);
  assert.equal(ledgerCreated.response.status, 200);
  assert.equal(ledgerCreated.body.job.title, 'API lifecycle repair');
  assert.ok(ledgerCreated.body.job.quotes[0].approvalId);
  assert.ok(ledgerCreated.body.job.audit.some(event => event.action === 'create_intake_job'));

  const executeResponse = await request(baseUrl, `/api/jobs/${jobId}/execute-ai-plan`, {
    method: 'POST',
    body: '{}'
  });
  assert.equal(executeResponse.response.status, 200);
  assert.equal(executeResponse.body.success, true);
  const assignedWorkerId = executeResponse.body.job.assignedWorkerId;
  assert.ok(assignedWorkerId);

  const workersBefore = await request(baseUrl, '/api/workers');
  const completedBefore = workersBefore.body.find(worker => worker.id === assignedWorkerId).completedJobs;

  const startResponse = await request(baseUrl, `/api/jobs/${jobId}/start`, {
    method: 'POST',
    body: '{}'
  });
  assert.equal(startResponse.response.status, 200);
  assert.equal(startResponse.body.job.status, 'in_progress');

  const completeResponse = await request(baseUrl, `/api/jobs/${jobId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ actualCost: 240 })
  });
  assert.equal(completeResponse.response.status, 200);
  assert.equal(completeResponse.body.job.status, 'completed');
  assert.equal(completeResponse.body.job.actualCost, 240);
  assert.ok(completeResponse.body.records.invoice.id);
  assert.ok(completeResponse.body.records.peppolInvoice.id);
  assert.ok(completeResponse.body.records.clientMessage.id);
  assert.ok(completeResponse.body.records.dailyLog.id);
  assert.ok(completeResponse.body.records.closeoutItem.id);
  assert.ok(completeResponse.body.records.payment.id);
  assert.ok(completeResponse.body.actions.some(action => action.type === 'release_resources'));
  assert.ok(completeResponse.body.actions.some(action => action.type === 'draft_invoice'));
  assert.ok(completeResponse.body.actions.some(action => action.type === 'queue_peppol_invoice'));
  assert.ok(completeResponse.body.actions.some(action => action.type === 'draft_client_update'));
  assert.ok(completeResponse.body.actions.some(action => action.type === 'draft_daily_log'));
  assert.ok(completeResponse.body.actions.some(action => action.type === 'create_closeout_item'));
  assert.equal(completeResponse.body.ledgerJob.status, 'completed');
  assert.ok(completeResponse.body.ledgerJob.invoices[0].approvalId);

  const ledgerAfterComplete = await request(baseUrl, `/api/ledger/jobs/${ledgerJobId}`);
  assert.equal(ledgerAfterComplete.response.status, 200);
  assert.equal(ledgerAfterComplete.body.job.status, 'completed');
  assert.ok(ledgerAfterComplete.body.job.progress.some(update => update.status === 'completed'));
  assert.ok(ledgerAfterComplete.body.job.invoices.length >= 1);

  const repeatResponse = await request(baseUrl, `/api/jobs/${jobId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ actualCost: 240 })
  });
  assert.equal(repeatResponse.response.status, 200);
  assert.equal(repeatResponse.body.alreadyCompleted, true);
  assert.equal(repeatResponse.body.actions.length, 0);
  assert.equal(repeatResponse.body.records.invoice.id, completeResponse.body.records.invoice.id);

  const workersAfter = await request(baseUrl, '/api/workers');
  const assignedWorker = workersAfter.body.find(worker => worker.id === assignedWorkerId);
  assert.equal(assignedWorker.completedJobs, completedBefore + 1);
  assert.equal(assignedWorker.currentJobId, null);
  assert.equal(assignedWorker.status, 'available');

  const toolsAfter = await request(baseUrl, '/api/tools');
  const drill = toolsAfter.body.find(tool => tool.id === toolResponse.body.id);
  assert.equal(drill.status, 'available');
  assert.equal(drill.assignedJobId, null);
  assert.equal(drill.assignedWorkerId, null);

  const dashboardAfterComplete = await request(baseUrl, '/api/dashboard');
  assert.equal(dashboardAfterComplete.response.status, 200);
  assert.ok(dashboardAfterComplete.body.ledger.metrics.jobs >= 4);
  assert.ok(dashboardAfterComplete.body.construction.data.invoices.some(record => record.id === completeResponse.body.records.invoice.id));
  assert.ok(dashboardAfterComplete.body.construction.data.peppolInvoices.some(record => record.id === completeResponse.body.records.peppolInvoice.id));
  assert.ok(dashboardAfterComplete.body.construction.data.clientMessages.some(record => record.id === completeResponse.body.records.clientMessage.id));
  assert.ok(dashboardAfterComplete.body.construction.data.dailyLogs.some(record => record.id === completeResponse.body.records.dailyLog.id));
  assert.ok(dashboardAfterComplete.body.construction.data.closeoutItems.some(record => record.id === completeResponse.body.records.closeoutItem.id));
  assert.ok(dashboardAfterComplete.body.construction.data.payments.some(record => record.id === completeResponse.body.records.payment.id));

  const editJobResponse = await request(baseUrl, `/api/jobs/${jobId}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: 'API lifecycle repair edited',
      priority: 'medium',
      status: 'completed'
    })
  });
  assert.equal(editJobResponse.response.status, 200);
  assert.equal(editJobResponse.body.title, 'API lifecycle repair edited');
  assert.equal(editJobResponse.body.priority, 'medium');

  const deleteJobResponse = await request(baseUrl, `/api/jobs/${jobId}`, {
    method: 'DELETE'
  });
  assert.equal(deleteJobResponse.response.status, 200);
  assert.equal(deleteJobResponse.body.success, true);
  assert.equal(deleteJobResponse.body.deleted, false);
  assert.equal(deleteJobResponse.body.retained, true);
  assert.equal(deleteJobResponse.body.job.status, 'pending_archive_approval');
  assert.equal(deleteJobResponse.body.approval.targetType, 'legacy_job_archive');

  const repeatPendingDeleteJob = await request(baseUrl, `/api/jobs/${jobId}`, {
    method: 'DELETE'
  });
  assert.equal(repeatPendingDeleteJob.response.status, 200);
  assert.equal(repeatPendingDeleteJob.body.deleted, false);
  assert.equal(repeatPendingDeleteJob.body.retained, true);
  assert.equal(repeatPendingDeleteJob.body.alreadyPending, true);
  assert.equal(repeatPendingDeleteJob.body.approval.id, deleteJobResponse.body.approval.id);

  const pendingArchiveApprovals = await request(baseUrl, '/api/approvals?status=pending&limit=500');
  assert.equal(pendingArchiveApprovals.response.status, 200);
  assert.equal(pendingArchiveApprovals.body.approvals.filter(approval =>
    approval.targetType === 'legacy_job_archive'
    && String(approval.targetId) === String(jobId)
  ).length, 1);

  const retainedJobResponse = await request(baseUrl, `/api/jobs/${jobId}`);
  assert.equal(retainedJobResponse.response.status, 200);
  assert.equal(retainedJobResponse.body.status, 'pending_archive_approval');

  const archiveApproval = await request(baseUrl, `/api/approvals/${deleteJobResponse.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Regression Test', reason: 'Archive approved.' })
  });
  assert.equal(archiveApproval.response.status, 200);
  assert.equal(archiveApproval.body.approval.status, 'approved');
  assert.equal(archiveApproval.body.sideEffect.type, 'legacy_job_archive');

  const archivedJobResponse = await request(baseUrl, `/api/jobs/${jobId}`);
  assert.equal(archivedJobResponse.response.status, 200);
  assert.equal(archivedJobResponse.body.status, 'archived');

  const repeatArchivedDeleteJob = await request(baseUrl, `/api/jobs/${jobId}`, {
    method: 'DELETE'
  });
  assert.equal(repeatArchivedDeleteJob.response.status, 200);
  assert.equal(repeatArchivedDeleteJob.body.deleted, false);
  assert.equal(repeatArchivedDeleteJob.body.retained, true);
  assert.equal(repeatArchivedDeleteJob.body.alreadyArchived, true);
  assert.equal(repeatArchivedDeleteJob.body.approval, null);
  assert.equal(repeatArchivedDeleteJob.body.job.status, 'archived');

  const defaultJobsAfterArchive = await request(baseUrl, '/api/jobs');
  assert.equal(defaultJobsAfterArchive.response.status, 200);
  assert.ok(!defaultJobsAfterArchive.body.some(job => String(job.id) === String(jobId)));

  const retainedJobsAfterArchive = await request(baseUrl, '/api/jobs?includeArchived=true');
  assert.equal(retainedJobsAfterArchive.response.status, 200);
  assert.ok(retainedJobsAfterArchive.body.some(job => String(job.id) === String(jobId) && job.status === 'archived'));

  const archiveJobs = await request(baseUrl, '/api/jobs?status=archive');
  assert.equal(archiveJobs.response.status, 200);
  assert.ok(archiveJobs.body.some(job => String(job.id) === String(jobId) && job.status === 'archived'));

  const ledgerJobsDefault = await request(baseUrl, '/api/ledger/jobs?limit=100');
  assert.equal(ledgerJobsDefault.response.status, 200);
  assert.ok(!ledgerJobsDefault.body.jobs.some(job => job.id === `legacy_job_${jobId}`));

  const ledgerJobsArchive = await request(baseUrl, '/api/ledger/jobs?status=archive&limit=100');
  assert.equal(ledgerJobsArchive.response.status, 200);
  assert.ok(ledgerJobsArchive.body.jobs.some(job => job.id === `legacy_job_${jobId}` && job.status === 'archived'));

  const dashboardAfterArchive = await request(baseUrl, '/api/dashboard');
  assert.equal(dashboardAfterArchive.response.status, 200);
  assert.ok(!dashboardAfterArchive.body.jobs.some(job => String(job.id) === String(jobId)));
  assert.ok(dashboardAfterArchive.body.ledger.metrics.archivedJobs >= 1);

  const editToolResponse = await request(baseUrl, `/api/tools/${toolResponse.body.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      status: 'maintenance',
      currentLocation: 'Service Depot'
    })
  });
  assert.equal(editToolResponse.response.status, 200);
  assert.equal(editToolResponse.body.status, 'maintenance');
  assert.equal(editToolResponse.body.currentLocation, 'Service Depot');

  const deleteToolResponse = await request(baseUrl, `/api/tools/${toolResponse.body.id}`, {
    method: 'DELETE'
  });
  assert.equal(deleteToolResponse.response.status, 200);
  assert.equal(deleteToolResponse.body.success, true);

  const createWorkerResponse = await request(baseUrl, '/api/workers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Regression Worker',
      specialty: 'QA',
      location: 'Rotterdam',
      hourlyRate: 35
    })
  });
  assert.equal(createWorkerResponse.response.status, 201);

  const editWorkerResponse = await request(baseUrl, `/api/workers/${createWorkerResponse.body.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      status: 'offline',
      location: 'Eindhoven'
    })
  });
  assert.equal(editWorkerResponse.response.status, 200);
  assert.equal(editWorkerResponse.body.status, 'offline');
  assert.equal(editWorkerResponse.body.location, 'Eindhoven');

  const deleteWorkerResponse = await request(baseUrl, `/api/workers/${createWorkerResponse.body.id}`, {
    method: 'DELETE'
  });
  assert.equal(deleteWorkerResponse.response.status, 200);
  assert.equal(deleteWorkerResponse.body.success, true);

  const diagnostics = await request(baseUrl, '/api/debug/diagnostics');
  assert.equal(diagnostics.response.status, 200);
  assert.equal(diagnostics.body.state.validation.valid, true);
});

test('construction API supports project-control records and autonomous review', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const dashboard = await request(baseUrl, '/api/dashboard');
  assert.equal(dashboard.response.status, 200);
  assert.ok(dashboard.body.construction.summary.activeProjects >= 1);
  assert.ok(Array.isArray(dashboard.body.construction.data.projects));
  assert.ok(Array.isArray(dashboard.body.construction.capabilities));
  assert.ok(dashboard.body.construction.capabilities.some(capability => capability.key === 'eu-compliance'));

  const modules = await request(baseUrl, '/api/construction');
  assert.equal(modules.response.status, 200);
  assert.ok(modules.body.collections.includes('rfis'));
  assert.ok(modules.body.collections.includes('schedules'));
  assert.ok(modules.body.collections.includes('formsChecklists'));
  assert.ok(modules.body.collections.includes('transmittals'));
  assert.ok(modules.body.collections.includes('costDatabase'));
  assert.ok(modules.body.collections.includes('leadActivities'));
  assert.ok(modules.body.collections.includes('directoryContacts'));
  assert.ok(modules.body.collections.includes('integrationConnectors'));
  assert.ok(modules.body.collections.includes('resourcePlans'));
  assert.ok(modules.body.collections.includes('clientSelections'));
  assert.ok(modules.body.collections.includes('productionReports'));
  assert.ok(modules.body.collections.includes('payments'));
  assert.ok(modules.body.collections.includes('lienWaivers'));
  assert.ok(modules.body.collections.includes('complianceItems'));
  assert.ok(modules.body.collections.includes('modelIssues'));
  assert.ok(modules.body.collections.includes('takeoffs'));
  assert.ok(modules.body.collections.includes('orientations'));
  assert.ok(modules.body.collections.includes('peppolInvoices'));
  assert.ok(modules.body.collections.includes('wkbDossiers'));
  assert.ok(modules.body.collections.includes('vcaCertificates'));
  assert.ok(modules.body.collections.includes('collaboratorReports'));
  assert.ok(modules.body.collections.includes('segmentedDailyReports'));
  assert.ok(modules.body.collections.includes('dayworkSheets'));
  assert.ok(modules.body.collections.includes('workOrders'));
  assert.ok(modules.body.collections.includes('bookings'));
  assert.ok(modules.body.collections.includes('kioskSessions'));
  assert.ok(modules.body.collections.includes('laborMap'));
  assert.ok(modules.body.collections.includes('qualityReports'));
  assert.ok(modules.body.collections.includes('preTaskPlans'));
  assert.ok(modules.body.collections.includes('certifiedPayroll'));
  assert.ok(modules.body.collections.includes('aiaBillings'));
  assert.ok(modules.body.collections.includes('drawInspections'));
  assert.ok(modules.body.collections.includes('riskMitigations'));
  assert.ok(modules.body.collections.includes('dealPipelines'));
  assert.ok(modules.body.collections.includes('omExtractions'));
  assert.ok(modules.body.capabilities.some(capability => capability.key === 'financial-control'));
  assert.ok(modules.body.workflows.some(workflow => workflow.key === 'payment-release'));
  assert.ok(modules.body.workflows.some(workflow => workflow.key === 'site-coordination'));

  const workflowCatalog = await request(baseUrl, '/api/construction/workflows');
  assert.equal(workflowCatalog.response.status, 200);
  assert.ok(workflowCatalog.body.workflows.some(workflow => workflow.key === 'safety-mobilization'));
  assert.ok(workflowCatalog.body.workflows.some(workflow => workflow.key === 'site-coordination'));

  const paymentWorkflow = await request(baseUrl, '/api/construction/workflows/payment-release/run', {
    method: 'POST',
    body: JSON.stringify({ projectId: 1 })
  });
  assert.equal(paymentWorkflow.response.status, 200);
  assert.equal(paymentWorkflow.body.success, true);
  assert.equal(paymentWorkflow.body.workflowKey, 'payment-release');
  assert.ok(paymentWorkflow.body.records.invoice.id);
  assert.ok(paymentWorkflow.body.records.peppolInvoice.id);
  assert.ok(paymentWorkflow.body.records.payment.lienWaiverRequired);
  assert.ok(paymentWorkflow.body.records.lienWaiver.id);
  assert.ok(paymentWorkflow.body.records.drawRequest.id);
  assert.ok(paymentWorkflow.body.records.drawInspection.id);
  assert.ok(paymentWorkflow.body.records.riskMitigation.id);
  assert.ok(paymentWorkflow.body.run.recordRefs.some(ref => ref.collection === 'payments'));
  assert.ok(paymentWorkflow.body.recordRefs.some(ref => ref.collection === 'drawRequests'));
  assert.ok(paymentWorkflow.body.actions.some(action => action.collection === 'drawRequests'));

  const coordinationWorkflow = await request(baseUrl, '/api/construction/workflows/site-coordination/run', {
    method: 'POST',
    body: JSON.stringify({ projectId: 1 })
  });
  assert.equal(coordinationWorkflow.response.status, 200);
  assert.equal(coordinationWorkflow.body.success, true);
  assert.equal(coordinationWorkflow.body.workflowKey, 'site-coordination');
  assert.ok(coordinationWorkflow.body.records.booking.id);
  assert.ok(coordinationWorkflow.body.records.workOrder.id);
  assert.ok(coordinationWorkflow.body.records.dayworkSheet.id);
  assert.ok(coordinationWorkflow.body.recordRefs.some(ref => ref.collection === 'dayworkSheets'));
  assert.ok(coordinationWorkflow.body.actions.some(action => action.collection === 'workOrders'));

  const dashboardAfterWorkflow = await request(baseUrl, '/api/dashboard');
  assert.equal(dashboardAfterWorkflow.response.status, 200);
  assert.ok(dashboardAfterWorkflow.body.construction.data.workflowRuns.some(run => run.runId === paymentWorkflow.body.runId));
  assert.ok(dashboardAfterWorkflow.body.construction.data.workflowRuns.some(run => run.runId === coordinationWorkflow.body.runId));
  const storedPaymentRun = dashboardAfterWorkflow.body.construction.data.workflowRuns.find(run => run.runId === paymentWorkflow.body.runId);
  assert.ok(storedPaymentRun.recordRefs.some(ref => ref.collection === 'lienWaivers'));

  const overdueDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const createRfi = await request(baseUrl, '/api/construction/rfis', {
    method: 'POST',
    body: JSON.stringify({
      projectId: 1,
      subject: 'Regression RFI',
      status: 'open',
      dueDate: overdueDate,
      responsible: 'Design team'
    })
  });
  assert.equal(createRfi.response.status, 201);
  assert.equal(createRfi.body.record.subject, 'Regression RFI');

  const createSelection = await request(baseUrl, '/api/construction/clientSelections', {
    method: 'POST',
    body: JSON.stringify({
      projectId: 1,
      title: 'Regression client selection',
      status: 'pending_client',
      dueDate: overdueDate,
      client: 'Regression Client'
    })
  });
  assert.equal(createSelection.response.status, 201);

  const createPayment = await request(baseUrl, '/api/construction/payments', {
    method: 'POST',
    body: JSON.stringify({
      projectId: 1,
      vendor: 'Regression Subcontractor',
      status: 'ready_to_release',
      amount: 1200,
      lienWaiverRequired: true
    })
  });
  assert.equal(createPayment.response.status, 201);

  const review = await request(baseUrl, '/api/construction/autonomous-review', {
    method: 'POST',
    body: '{}'
  });
  assert.equal(review.response.status, 200);
  assert.equal(review.body.success, true);
  assert.ok(review.body.actions.some(action => action.type === 'escalate_rfi' && action.id === createRfi.body.record.id));
  assert.ok(review.body.actions.some(action => action.type === 'escalate_selection' && action.id === createSelection.body.record.id));
  assert.ok(review.body.actions.some(action => action.type === 'request_lien_waiver'));
  assert.ok(review.body.actions.some(action => action.type === 'queue_peppol_invoice'));
  assert.ok(review.body.actions.some(action => action.type === 'renew_vca_certificate'));
  assert.ok(review.body.actions.some(action => action.type === 'repair_integration'));
  assert.ok(review.body.actions.some(action => action.type === 'review_collaborator_report'));
  assert.ok(review.body.actions.some(action => action.type === 'verify_kiosk_session'));
  assert.ok(review.body.actions.some(action => action.type === 'resolve_quality_report'));
  assert.ok(review.body.actions.some(action => action.type === 'certify_payroll'));
  assert.ok(review.body.actions.some(action => action.type === 'submit_progress_billing'));
  assert.ok(review.body.actions.some(action => action.type === 'review_om_extraction'));
  assert.ok(review.body.insights.some(insight => ['production_variance', 'compliance_risk'].includes(insight.type)));
  assert.ok(review.body.insights.some(insight => ['takeoff_review', 'wkb_dossier_gap', 'site_access_block'].includes(insight.type)));
  assert.ok(review.body.insights.some(insight => ['cost_database_stale', 'directory_compliance_gap'].includes(insight.type)));
  assert.ok(review.body.insights.some(insight => insight.type === 'segment_blocker'));
  assert.ok(review.body.insights.some(insight => insight.type === 'labor_certification_gap'));
  assert.ok(review.body.insights.some(insight => insight.type === 'finance_risk_control'));
  assert.ok(review.body.insights.some(insight => insight.type === 'deal_underwriting'));
  assert.ok(review.body.capabilities.some(capability => capability.status === 'action_required'));
  assert.ok(review.body.summary.overdueRfis >= 1);
  assert.ok(review.body.summary.pendingPaymentValue >= 1200);
  assert.ok(review.body.summary.openComplianceItems >= 1);
  assert.ok(review.body.summary.openModelIssues >= 1);
  assert.ok(review.body.summary.wkbCompletionPercent < 100);
  assert.ok(review.body.summary.integrationIssues >= 1);
  assert.ok(review.body.summary.pendingCollaboratorReports >= 1);
  assert.ok(review.body.summary.segmentedReportBlockers >= 1);
  assert.ok(review.body.summary.openKioskSessions >= 1);
  assert.ok(review.body.summary.laborCertificationGaps >= 1);
  assert.ok(review.body.summary.openQualityReports >= 1);
  assert.ok(review.body.summary.pendingPreTaskPlans >= 1);
  assert.ok(review.body.summary.pendingCertifiedPayroll >= 1);
  assert.ok(review.body.summary.draftAiaBillings >= 1);
  assert.ok(review.body.summary.pendingDrawInspections >= 1);
  assert.ok(review.body.summary.openRiskMitigations >= 1);
  assert.ok(review.body.summary.activeDealPipelineValue > 0);
  assert.ok(review.body.summary.pendingOmExtractions >= 1);

  const collaboratorReports = await request(baseUrl, '/api/construction/collaboratorReports');
  assert.equal(collaboratorReports.response.status, 200);
  const collaboratorReport = collaboratorReports.body.records.find(record => record.status === 'pending_review');
  assert.ok(collaboratorReport);
  const acceptCollaboratorReport = await request(baseUrl, `/api/construction/collaboratorReports/${collaboratorReport.id}/action`, {
    method: 'POST',
    body: JSON.stringify({ status: 'accepted' })
  });
  assert.equal(acceptCollaboratorReport.response.status, 200);
  assert.equal(acceptCollaboratorReport.body.record.status, 'accepted');
  assert.ok(acceptCollaboratorReport.body.records.dailyLog.id);
  assert.ok(acceptCollaboratorReport.body.actions.some(action => action.type === 'draft_daily_log'));

  const aiaBillings = await request(baseUrl, '/api/construction/aiaBillings');
  assert.equal(aiaBillings.response.status, 200);
  const aiaBilling = aiaBillings.body.records.find(record => record.status === 'draft');
  assert.ok(aiaBilling);
  const submitAiaBilling = await request(baseUrl, `/api/construction/aiaBillings/${aiaBilling.id}/action`, {
    method: 'POST',
    body: JSON.stringify({ status: 'submitted' })
  });
  assert.equal(submitAiaBilling.response.status, 200);
  assert.equal(submitAiaBilling.body.record.status, 'submitted');
  assert.ok(submitAiaBilling.body.records.invoice.id);
  assert.ok(submitAiaBilling.body.records.drawRequest.id);
  assert.ok(submitAiaBilling.body.actions.some(action => action.type === 'draft_invoice'));
  assert.ok(submitAiaBilling.body.actions.some(action => action.type === 'create_draw_request'));

  const closeRfiAction = await request(baseUrl, `/api/construction/rfis/${createRfi.body.record.id}/action`, {
    method: 'POST',
    body: JSON.stringify({ status: 'closed' })
  });
  assert.equal(closeRfiAction.response.status, 200);
  assert.equal(closeRfiAction.body.record.status, 'closed');
  assert.ok(closeRfiAction.body.records.transmittal.id);
  assert.ok(closeRfiAction.body.actions.some(action => action.type === 'draft_rfi_transmittal'));

  const createTimecard = await request(baseUrl, '/api/construction/timecards', {
    method: 'POST',
    body: JSON.stringify({
      projectId: 1,
      worker: 'Regression Worker',
      date: new Date().toISOString().slice(0, 10),
      hours: 8,
      hourlyRate: 72,
      costCode: '01-200',
      status: 'submitted'
    })
  });
  assert.equal(createTimecard.response.status, 201);
  const approveTimecard = await request(baseUrl, `/api/construction/timecards/${createTimecard.body.record.id}/action`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved' })
  });
  assert.equal(approveTimecard.response.status, 200);
  assert.equal(approveTimecard.body.record.status, 'approved');
  assert.equal(approveTimecard.body.records.jobCostEntry.actualCost, 576);
  assert.ok(approveTimecard.body.records.payrollRun.id);
  assert.ok(approveTimecard.body.actions.some(action => action.type === 'post_timecard_job_cost'));
  assert.ok(approveTimecard.body.actions.some(action => action.type === 'queue_timecard_payroll'));

  const createMaterial = await request(baseUrl, '/api/construction/materials', {
    method: 'POST',
    body: JSON.stringify({
      projectId: 1,
      title: 'Regression material',
      status: 'low_stock',
      quantity: 3,
      unit: 'boxes',
      vendor: 'Regression Supplier',
      expectedDelivery: new Date().toISOString().slice(0, 10)
    })
  });
  assert.equal(createMaterial.response.status, 201);
  const orderMaterial = await request(baseUrl, `/api/construction/materials/${createMaterial.body.record.id}/action`, {
    method: 'POST',
    body: JSON.stringify({ status: 'ordered' })
  });
  assert.equal(orderMaterial.response.status, 200);
  assert.ok(orderMaterial.body.records.purchaseOrder.id);
  assert.ok(orderMaterial.body.actions.some(action => action.type === 'create_material_purchase_order'));

  const createPeppolInvoice = await request(baseUrl, '/api/construction/peppolInvoices', {
    method: 'POST',
    body: JSON.stringify({
      projectId: 1,
      recipient: 'Regression Client',
      status: 'ready',
      amount: 2400,
      standard: 'UBL 2.1',
      dueDate: new Date().toISOString().slice(0, 10)
    })
  });
  assert.equal(createPeppolInvoice.response.status, 201);
  const peppolInvoice = createPeppolInvoice.body.record;
  const sendPeppolInvoice = await request(baseUrl, `/api/construction/peppolInvoices/${peppolInvoice.id}/action`, {
    method: 'POST',
    body: JSON.stringify({ status: 'sent' })
  });
  assert.equal(sendPeppolInvoice.response.status, 200);
  assert.equal(sendPeppolInvoice.body.record.status, 'sent');
  assert.ok(sendPeppolInvoice.body.records.invoice.id);
  assert.ok(sendPeppolInvoice.body.actions.some(action => action.type === 'sync_peppol_invoice'));

  const batchTimecard = await request(baseUrl, '/api/construction/timecards', {
    method: 'POST',
    body: JSON.stringify({
      projectId: 1,
      worker: 'Batch Worker',
      date: new Date().toISOString().slice(0, 10),
      hours: 5,
      hourlyRate: 60,
      costCode: '01-300',
      status: 'submitted'
    })
  });
  assert.equal(batchTimecard.response.status, 201);
  const batchMaterial = await request(baseUrl, '/api/construction/materials', {
    method: 'POST',
    body: JSON.stringify({
      projectId: 1,
      title: 'Batch material',
      status: 'low_stock',
      quantity: 4,
      unit: 'packs',
      vendor: 'Batch Supplier'
    })
  });
  assert.equal(batchMaterial.response.status, 201);
  const batchAction = await request(baseUrl, '/api/construction/actions/batch', {
    method: 'POST',
    body: JSON.stringify({
      actions: [
        { collection: 'timecards', id: batchTimecard.body.record.id, status: 'approved' },
        { collection: 'materials', id: batchMaterial.body.record.id, status: 'ordered' }
      ]
    })
  });
  assert.equal(batchAction.response.status, 200);
  assert.equal(batchAction.body.executed, 2);
  assert.equal(batchAction.body.failed, 0);
  assert.ok(batchAction.body.results.some(result => result.collection === 'timecards' && result.records.jobCostEntry.actualCost === 300));
  assert.ok(batchAction.body.results.some(result => result.collection === 'materials' && result.records.purchaseOrder.id));

  const updateRfi = await request(baseUrl, `/api/construction/rfis/${createRfi.body.record.id}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'closed' })
  });
  assert.equal(updateRfi.response.status, 200);
  assert.equal(updateRfi.body.record.status, 'closed');

  const rfis = await request(baseUrl, '/api/construction/rfis');
  assert.equal(rfis.response.status, 200);
  assert.equal(rfis.body.records.find(record => record.id === createRfi.body.record.id).status, 'closed');

  const deleteSelection = await request(baseUrl, `/api/construction/clientSelections/${createSelection.body.record.id}`, {
    method: 'DELETE'
  });
  assert.equal(deleteSelection.response.status, 200);
  assert.equal(deleteSelection.body.success, true);
  assert.equal(deleteSelection.body.deleted, false);
  assert.equal(deleteSelection.body.retained, true);
  assert.equal(deleteSelection.body.record.status, 'pending_archive_approval');
  assert.equal(deleteSelection.body.approval.targetType, 'construction_record_archive');

  const repeatPendingDeleteSelection = await request(baseUrl, `/api/construction/clientSelections/${createSelection.body.record.id}`, {
    method: 'DELETE'
  });
  assert.equal(repeatPendingDeleteSelection.response.status, 200);
  assert.equal(repeatPendingDeleteSelection.body.retained, true);
  assert.equal(repeatPendingDeleteSelection.body.alreadyPending, true);
  assert.equal(repeatPendingDeleteSelection.body.approval.id, deleteSelection.body.approval.id);

  const pendingSelectionApprovals = await request(baseUrl, '/api/approvals?status=pending&limit=500');
  assert.equal(pendingSelectionApprovals.response.status, 200);
  assert.equal(pendingSelectionApprovals.body.approvals.filter(approval =>
    approval.targetType === 'construction_record_archive'
    && approval.targetId === `clientSelections:${createSelection.body.record.id}`
  ).length, 1);

  const selections = await request(baseUrl, '/api/construction/clientSelections');
  assert.equal(selections.response.status, 200);
  assert.ok(selections.body.records.some(record =>
    record.id === createSelection.body.record.id
    && record.status === 'pending_archive_approval'
  ));

  const archiveSelection = await request(baseUrl, `/api/approvals/${deleteSelection.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Regression Test', reason: 'Archive selection record.' })
  });
  assert.equal(archiveSelection.response.status, 200);
  assert.equal(archiveSelection.body.approval.status, 'approved');
  assert.equal(archiveSelection.body.sideEffect.type, 'construction_record_archive');

  const archivedSelections = await request(baseUrl, '/api/construction/clientSelections');
  assert.equal(archivedSelections.response.status, 200);
  assert.ok(archivedSelections.body.records.some(record =>
    record.id === createSelection.body.record.id
    && record.status === 'archived'
  ));

  const repeatArchivedDeleteSelection = await request(baseUrl, `/api/construction/clientSelections/${createSelection.body.record.id}`, {
    method: 'DELETE'
  });
  assert.equal(repeatArchivedDeleteSelection.response.status, 200);
  assert.equal(repeatArchivedDeleteSelection.body.retained, true);
  assert.equal(repeatArchivedDeleteSelection.body.alreadyArchived, true);
  assert.equal(repeatArchivedDeleteSelection.body.approval, null);
  assert.equal(repeatArchivedDeleteSelection.body.record.status, 'archived');

  const createInvoice = await request(baseUrl, '/api/construction/invoices', {
    method: 'POST',
    body: JSON.stringify({
      projectId: 1,
      vendor: 'Regression Vendor',
      number: 'INV-ACTION-1',
      status: 'pending_review',
      amount: 777
    })
  });
  assert.equal(createInvoice.response.status, 201);

  const payInvoice = await request(baseUrl, `/api/construction/invoices/${createInvoice.body.record.id}/action`, {
    method: 'POST',
    body: JSON.stringify({ status: 'paid' })
  });
  assert.equal(payInvoice.response.status, 200);
  assert.equal(payInvoice.body.success, true);
  assert.equal(payInvoice.body.record.status, 'paid');
  assert.ok(payInvoice.body.record.paidAt);
  assert.equal(payInvoice.body.record.actionHistory.at(-1).to, 'paid');
  assert.ok(payInvoice.body.records.payment.id);
  assert.ok(payInvoice.body.actions.some(action => action.type === 'sync_payment'));

  const createDailyLog = await request(baseUrl, '/api/construction/dailyLogs', {
    method: 'POST',
    body: JSON.stringify({
      projectId: 1,
      date: new Date().toISOString().slice(0, 10),
      status: 'draft',
      manpower: 3,
      notes: 'Regression field log'
    })
  });
  assert.equal(createDailyLog.response.status, 201);

  const submitDailyLog = await request(baseUrl, `/api/construction/dailyLogs/${createDailyLog.body.record.id}/action`, {
    method: 'POST',
    body: JSON.stringify({ status: 'submitted' })
  });
  assert.equal(submitDailyLog.response.status, 200);
  assert.equal(submitDailyLog.body.record.status, 'submitted');
  assert.ok(submitDailyLog.body.record.submittedAt);
  assert.ok(submitDailyLog.body.records.clientMessage.id);
  assert.ok(submitDailyLog.body.actions.some(action => action.type === 'draft_client_update'));

  const dashboardAfterActions = await request(baseUrl, '/api/dashboard');
  assert.equal(dashboardAfterActions.response.status, 200);
  assert.ok(dashboardAfterActions.body.construction.data.payments.some(record => record.id === payInvoice.body.records.payment.id));
  assert.ok(dashboardAfterActions.body.construction.data.clientMessages.some(record => record.id === submitDailyLog.body.records.clientMessage.id));
});

test('emergency activation dispatches resources and creates command records', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const emergency = await request(baseUrl, '/api/emergency/activate', {
    method: 'POST',
    body: JSON.stringify({ reason: 'Regression emergency activation' })
  });
  assert.equal(emergency.response.status, 200);
  assert.equal(emergency.body.success, true);
  assert.equal(emergency.body.job.priority, 'critical');
  assert.equal(emergency.body.job.status, 'in_progress');
  assert.ok(emergency.body.job.progress >= 15);
  assert.ok(emergency.body.worker);
  assert.ok(emergency.body.actions.some(action => action.type === 'dispatch_worker'));
  assert.ok(emergency.body.actions.some(action => action.type === 'open_incident'));
  assert.ok(emergency.body.actions.some(action => action.type === 'draft_client_update'));
  assert.ok(emergency.body.records.incident.id);
  assert.ok(emergency.body.records.task.id);
  assert.ok(emergency.body.records.clientMessage.id);
  assert.ok(emergency.body.records.safetyMeeting.id);
  assert.ok(emergency.body.records.dailyLog.id);

  const dashboard = await request(baseUrl, '/api/dashboard');
  assert.equal(dashboard.response.status, 200);
  assert.ok(dashboard.body.construction.data.incidents.some(record => record.id === emergency.body.records.incident.id));
  assert.ok(dashboard.body.construction.data.tasks.some(record => record.id === emergency.body.records.task.id));
  assert.ok(dashboard.body.construction.data.clientMessages.some(record => record.id === emergency.body.records.clientMessage.id));

  const diagnostics = await request(baseUrl, '/api/debug/diagnostics');
  assert.equal(diagnostics.response.status, 200);
  assert.equal(diagnostics.body.state.validation.valid, true);
});

test('operations cycle combines job AI and Build autonomous review', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const worker = await request(baseUrl, '/api/workers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Operations Cycle Worker',
      specialty: 'General repair',
      status: 'available',
      location: 'Amsterdam'
    })
  });
  assert.equal(worker.response.status, 201);

  const tool = await request(baseUrl, '/api/tools', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Operations Cycle Kit',
      category: 'general',
      status: 'available',
      location: 'Warehouse'
    })
  });
  assert.equal(tool.response.status, 201);

  const job = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Operations cycle validation job',
      client: 'Operations Client',
      address: 'Amsterdam',
      description: 'General repair with operations cycle kit',
      status: 'pending',
      priority: 'high',
      tools: ['Operations Cycle Kit'],
      estimatedCost: 500
    })
  });
  assert.equal(job.response.status, 201);

  const cycle = await request(baseUrl, '/api/operations/cycle', {
    method: 'POST',
    body: JSON.stringify({ maxActions: 25 })
  });
  assert.equal(cycle.response.status, 200);
  assert.equal(cycle.body.success, true);
  assert.equal(cycle.body.source, 'server');
  assert.ok(cycle.body.jobCycle.actions.some(action => action.jobId === job.body.id));
  assert.ok(cycle.body.summary.jobActions >= 1);
  assert.equal(cycle.body.summary.jobActions, cycle.body.jobCycle.actions.length);
  assert.equal(cycle.body.summary.constructionActions, cycle.body.constructionReview.actions.length);
  assert.ok(Array.isArray(cycle.body.constructionReview.insights));
  assert.ok(Array.isArray(cycle.body.capabilities));

  const dashboard = await request(baseUrl, '/api/dashboard');
  assert.equal(dashboard.response.status, 200);
  const updatedJob = dashboard.body.jobs.find(item => item.id === job.body.id);
  assert.ok(updatedJob);
  assert.notEqual(updatedJob.status, 'pending');
  assert.ok(dashboard.body.construction.data.lastReview || dashboard.body.construction.lastReview);
});

test('capability gap plan installs official vendor modules', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const gaps = await request(baseUrl, '/api/construction/capability-gaps');
  assert.equal(gaps.response.status, 200);
  assert.equal(gaps.body.success, true);
  assert.ok(gaps.body.blueprint.some(vendor => vendor.vendor === 'Procore'));
  assert.ok(gaps.body.plan.vendors.some(vendor => vendor.vendor === 'HammerTech'));
  assert.ok(Number.isFinite(gaps.body.plan.summary.averageCoverage));
  const procoreBlueprint = gaps.body.blueprint.find(vendor => vendor.vendor === 'Procore');
  assert.ok(procoreBlueprint.serviceGroups.some(group => group.name === 'Project execution'));
  assert.ok(procoreBlueprint.netherlandsEuEnhancements.some(note => note.includes('Wkb')));

  const marketMap = await request(baseUrl, '/api/construction/market-map');
  assert.equal(marketMap.response.status, 200);
  assert.equal(marketMap.body.success, true);
  assert.ok(marketMap.body.marketMap.summary.services >= 70);
  assert.ok(marketMap.body.marketMap.vendors.some(vendor => vendor.vendor === 'Built' && vendor.serviceGroups.length >= 3));

  const operatingCatalog = await request(baseUrl, '/api/construction/operating-catalog');
  assert.equal(operatingCatalog.response.status, 200);
  assert.equal(operatingCatalog.body.success, true);
  assert.ok(operatingCatalog.body.catalog.summary.services >= 70);
  assert.ok(operatingCatalog.body.catalog.summary.approvalGates >= 8);
  assert.ok(operatingCatalog.body.catalog.summary.regionalControls >= 5);
  assert.ok(operatingCatalog.body.catalog.lanes.some(lane =>
    lane.key === 'financial-control'
    && lane.vendors.includes('Built')
    && lane.safeAutonomy.canSendExternally === false
    && lane.safeAutonomy.requiresApprovalFor.includes('payment_or_draw_release')
  ));
  assert.ok(operatingCatalog.body.catalog.regionalControls.some(control => control.key === 'wkb'));

  const install = await request(baseUrl, '/api/construction/capability-gaps/run', {
    method: 'POST',
    body: JSON.stringify({
      vendor: 'Procore',
      modules: ['portfolioReports'],
      force: true,
      limit: 1
    })
  });
  assert.equal(install.response.status, 200);
  assert.equal(install.body.success, true);
  assert.equal(install.body.vendor, 'Procore');
  assert.equal(install.body.created, 1);
  assert.equal(install.body.records[0].collection, 'portfolioReports');
  assert.equal(install.body.records[0].sourceVendor, 'Procore');
  assert.ok(install.body.gapPlan.vendors.some(vendor => vendor.vendor === 'Procore'));

  const dashboard = await request(baseUrl, '/api/dashboard');
  assert.equal(dashboard.response.status, 200);
  assert.ok(dashboard.body.construction.data.portfolioReports.some(record => record.sourceVendor === 'Procore'));
  assert.ok(dashboard.body.construction.operatingCatalog.summary.services >= 70);
});

test('expanded construction actions create competitor-suite linked records', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const today = new Date().toISOString().slice(0, 10);

  const createRecord = async (collection, record) => {
    const result = await request(baseUrl, `/api/construction/${collection}`, {
      method: 'POST',
      body: JSON.stringify({ projectId: 1, ...record })
    });
    assert.equal(result.response.status, 201);
    return result.body.record;
  };

  const runAction = async (collection, record, status) => {
    const result = await request(baseUrl, `/api/construction/${collection}/${record.id}/action`, {
      method: 'POST',
      body: JSON.stringify({ status })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.record.status, status);
    return result.body;
  };

  const draw = await createRecord('drawRequests', {
    title: 'Regression funded draw',
    status: 'pending_lender',
    requestedAmount: 12345,
    approvedAmount: 12345
  });
  const fundedDraw = await runAction('drawRequests', draw, 'funded');
  assert.ok(fundedDraw.records.payment.id);
  assert.equal(fundedDraw.records.payment.status, 'ready_to_release');
  assert.ok(fundedDraw.records.portfolioReport.id);
  assert.ok(fundedDraw.actions.some(action => action.type === 'create_draw_payment_release'));

  const payment = await createRecord('payments', {
    vendor: 'Waiver Vendor',
    status: 'scheduled',
    amount: 4321,
    lienWaiverRequired: true
  });
  const waiver = await createRecord('lienWaivers', {
    vendor: 'Waiver Vendor',
    status: 'requested',
    amount: 4321,
    paymentId: payment.id
  });
  const receivedWaiver = await runAction('lienWaivers', waiver, 'received');
  assert.equal(receivedWaiver.records.payment.id, payment.id);
  assert.equal(receivedWaiver.records.payment.lienWaiverRequired, false);
  assert.ok(receivedWaiver.records.document.id);
  assert.ok(receivedWaiver.actions.some(action => action.type === 'unblock_payment_release'));

  const capital = await createRecord('capitalRequests', {
    title: 'Regression capital request',
    status: 'pending_owner',
    amount: 7654
  });
  const approvedCapital = await runAction('capitalRequests', capital, 'approved');
  assert.ok(approvedCapital.records.drawRequest.id);
  assert.equal(approvedCapital.records.drawRequest.requestedAmount, 7654);

  const underwriting = await createRecord('underwritingReviews', {
    title: 'Regression underwriting review',
    status: 'pending_review',
    riskLevel: 'medium',
    reviewer: 'Finance'
  });
  const approvedUnderwriting = await runAction('underwritingReviews', underwriting, 'approved');
  assert.ok(approvedUnderwriting.records.riskMitigation.id);
  assert.equal(approvedUnderwriting.records.riskMitigation.status, 'mitigated');

  const orientation = await createRecord('orientations', {
    worker: 'Regression Crew',
    company: 'Regression Sub',
    status: 'pending',
    dueDate: today
  });
  const completedOrientation = await runAction('orientations', orientation, 'completed');
  assert.ok(completedOrientation.records.siteAccessLog.id);
  assert.equal(completedOrientation.records.siteAccessLog.orientationValid, true);

  const jha = await createRecord('jhas', {
    title: 'Regression JHA',
    status: 'pending_review',
    assignee: 'Safety Lead'
  });
  const approvedJha = await runAction('jhas', jha, 'approved');
  assert.ok(approvedJha.records.formsChecklist.id);
  assert.equal(approvedJha.records.formsChecklist.category, 'safety');

  const sds = await createRecord('sdsSheets', {
    title: 'Regression SDS',
    status: 'missing',
    supplier: 'Chemical Supplier'
  });
  const currentSds = await runAction('sdsSheets', sds, 'current');
  assert.ok(currentSds.records.complianceItem.id);
  assert.equal(currentSds.records.complianceItem.status, 'current');

  const safetyPlan = await createRecord('safetyPlans', {
    title: 'Regression safety plan',
    status: 'pending_review',
    reviewer: 'Safety Lead'
  });
  const approvedSafetyPlan = await runAction('safetyPlans', safetyPlan, 'approved');
  assert.ok(approvedSafetyPlan.records.document.id);
  assert.equal(approvedSafetyPlan.records.document.category, 'safety_plan');

  const permit = await createRecord('permits', {
    title: 'Regression permit',
    status: 'pending',
    holder: 'Site Team',
    location: 'Test Zone'
  });
  const activePermit = await runAction('permits', permit, 'active');
  assert.ok(activePermit.records.bulletin.id);
  assert.ok(activePermit.actions.some(action => action.type === 'draft_permit_bulletin'));

  const opportunity = await createRecord('opportunities', {
    title: 'Regression pursuit',
    client: 'Regression Client',
    status: 'lead',
    value: 50000,
    probability: 30
  });
  const qualifiedOpportunity = await runAction('opportunities', opportunity, 'qualified');
  assert.ok(qualifiedOpportunity.records.dealPipeline.id);
  assert.ok(qualifiedOpportunity.records.leadActivity.id);
  assert.equal(qualifiedOpportunity.records.dealPipeline.status, 'underwriting');

  const takeoff = await createRecord('takeoffs', {
    title: 'Regression takeoff',
    status: 'review_required',
    quantity: 25,
    unitCost: 80,
    unit: 'sqm'
  });
  const approvedTakeoff = await runAction('takeoffs', takeoff, 'approved');
  assert.ok(approvedTakeoff.records.estimate.id);
  assert.equal(approvedTakeoff.records.estimate.estimateValue, 2000);

  const specification = await createRecord('specifications', {
    title: 'Regression specification',
    status: 'needs_review',
    section: '09 30 00'
  });
  const mappedSpecification = await runAction('specifications', specification, 'mapped');
  assert.ok(mappedSpecification.records.submittal.id);
  assert.equal(mappedSpecification.records.submittal.package, '09 30 00');

  const serviceTicket = await createRecord('serviceTickets', {
    title: 'Regression service ticket',
    status: 'open',
    assignee: 'Service Team'
  });
  const closedServiceTicket = await runAction('serviceTickets', serviceTicket, 'closed');
  assert.ok(closedServiceTicket.records.document.id);
  assert.equal(closedServiceTicket.records.document.category, 'service_ticket');

  const dayworkSheet = await createRecord('dayworkSheets', {
    title: 'Regression daywork sheet',
    status: 'submitted',
    crew: 'Regression Crew',
    amount: 1800,
    description: 'Out-of-scope regression work'
  });
  const approvedDaywork = await runAction('dayworkSheets', dayworkSheet, 'approved');
  assert.ok(approvedDaywork.records.changeOrder.id);
  assert.equal(approvedDaywork.records.changeOrder.value, 1800);
  assert.ok(approvedDaywork.records.clientMessage.id);
  assert.ok(approvedDaywork.actions.some(action => action.type === 'create_daywork_change_order'));

  const booking = await createRecord('bookings', {
    title: 'Regression loading booking',
    status: 'pending',
    resource: 'Loading zone',
    startAt: today
  });
  const confirmedBooking = await runAction('bookings', booking, 'confirmed');
  assert.ok(confirmedBooking.records.task.id);
  assert.ok(confirmedBooking.records.bulletin.id);
  assert.ok(confirmedBooking.actions.some(action => action.type === 'draft_booking_bulletin'));

  const workOrder = await createRecord('workOrders', {
    title: 'Regression work order',
    status: 'open',
    assignedTo: 'Field Team',
    description: 'Complete and store evidence'
  });
  const completedWorkOrder = await runAction('workOrders', workOrder, 'completed');
  assert.ok(completedWorkOrder.records.dailyLog.id);
  assert.ok(completedWorkOrder.records.document.id);
  assert.equal(completedWorkOrder.records.document.category, 'work_order');
  assert.ok(completedWorkOrder.actions.some(action => action.type === 'store_work_order_evidence'));

  const connector = await createRecord('integrationConnectors', {
    title: 'Regression ERP connector',
    provider: 'Exact Online',
    status: 'needs_auth'
  });
  const connectedConnector = await runAction('integrationConnectors', connector, 'connected');
  assert.ok(connectedConnector.records.document.id);
  assert.equal(connectedConnector.records.document.category, 'integration_sync');
  assert.ok(connectedConnector.record.lastSyncAt);
});

test('upload analysis routes job evidence into construction records', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const upload = await request(baseUrl, '/api/upload', {
    method: 'POST',
    body: JSON.stringify({
      filename: 'unsafe-access-photo.jpg',
      fileType: 'image/jpeg',
      category: 'safety',
      jobId: 1,
      projectId: 1,
      riskLevel: 'high',
      notes: 'Blocked stair landing creates unsafe access for the crew.'
    })
  });

  assert.equal(upload.response.status, 200);
  assert.equal(upload.body.success, true);
  assert.equal(upload.body.analysis.category, 'safety');
  assert.equal(upload.body.analysis.riskDetected, true);
  assert.ok(upload.body.records.formsChecklist.id);
  assert.ok(upload.body.records.incident.id);
  assert.ok(upload.body.ledgerDocument.id);
  assert.equal(upload.body.ledgerDocument.type, 'photo');
  assert.equal(upload.body.ledgerDocument.status, 'needs_review');
  assert.ok(upload.body.actions.some(action => action.type === 'create_safety_checklist'));
  assert.ok(upload.body.actions.some(action => action.type === 'open_incident'));
  assert.ok(upload.body.actions.some(action => action.type === 'update_job_evidence'));

  const dashboard = await request(baseUrl, '/api/dashboard');
  assert.equal(dashboard.response.status, 200);
  assert.ok(dashboard.body.construction.data.formsChecklists.some(record => record.id === upload.body.records.formsChecklist.id));
  assert.ok(dashboard.body.construction.data.incidents.some(record => record.id === upload.body.records.incident.id));
  assert.ok(dashboard.body.jobs.find(job => job.id === 1).ai.reasoning.includes('unsafe-access-photo.jpg'));
});

test('multipart field upload stores local evidence and links ledger document', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const form = new FormData();
  form.append('evidenceFile', new Blob([Buffer.from('fake image bytes for regression')], { type: 'image/jpeg' }), 'real-site-photo.jpg');
  form.append('category', 'field_photo');
  form.append('jobId', '1');
  form.append('projectId', '1');
  form.append('riskLevel', 'low');
  form.append('notes', 'Before photo uploaded from the job site.');
  form.append('attachToBuild', 'true');

  const response = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    body: form
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.filename, 'real-site-photo.jpg');
  assert.equal(body.analysis.category, 'field_photo');
  assert.ok(body.uploadedFile.storageRef);
  assert.ok(fs.existsSync(path.resolve(__dirname, '..', body.uploadedFile.storageRef)));
  assert.ok(body.records.photoRecord.id);
  assert.ok(body.records.dailyLog.id);
  assert.ok(body.ledgerDocument.id);
  assert.equal(body.ledgerDocument.type, 'photo');
  assert.equal(body.ledgerDocument.filename, 'real-site-photo.jpg');
  assert.equal(body.ledgerDocument.storageRef, body.uploadedFile.storageRef);

  const ledgerDetail = await request(baseUrl, `/api/ledger/jobs/${body.ledgerDocument.jobId}`);
  assert.equal(ledgerDetail.response.status, 200);
  assert.ok(ledgerDetail.body.job.documents.some(document => document.id === body.ledgerDocument.id));
  assert.ok(ledgerDetail.body.job.audit.some(event => event.action === 'store_document'));
});

test('operating ledger persists intake, approvals, audit, and autonomous controls', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const dashboardBefore = await request(baseUrl, '/api/dashboard');
  assert.equal(dashboardBefore.response.status, 200);
  assert.ok(dashboardBefore.body.ledger.metrics.jobs >= 3);
  assert.ok(dashboardBefore.body.ledger.capabilities.some(capability => capability.key === 'financial-control'));

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Ledger canal kitchen refit',
      service: 'Kitchen renovation',
      client: {
        name: 'Ledger Client BV',
        email: 'client@example.test',
        phone: '+31600000000',
        address: 'Prinsengracht 1, Amsterdam',
        country: 'NL'
      },
      address: 'Prinsengracht 1, Amsterdam',
      city: 'Amsterdam',
      priority: 'high',
      estimatedCost: 3200,
      estimatedHours: 24,
      lineItems: [
        { description: 'Cabinet removal', quantity: 1, unitPrice: 650 },
        { description: 'Install worktop', quantity: 1, unitPrice: 1650 }
      ],
      tools: ['Tile Saw'],
      materials: [{ name: 'Worktop adhesive', quantity: 4, unit: 'tubes', supplier: 'Bouwmaat' }]
    })
  });
  assert.equal(intake.response.status, 201);
  assert.equal(intake.body.success, true);
  const jobId = intake.body.job.id;
  assert.ok(jobId);
  assert.equal(intake.body.job.client.name, 'Ledger Client BV');
  assert.ok(intake.body.job.tasks.length >= 4);
  assert.ok(intake.body.job.quotes[0].approvalId);
  assert.ok(intake.body.job.communications[0].approvalId);
  assert.ok(intake.body.job.audit.some(event => event.action === 'create_intake_job'));

  const capabilityPreview = await request(baseUrl, `/api/ledger/jobs/${jobId}/capability-plan`, {
    method: 'POST',
    body: JSON.stringify({ mode: 'preview', requirementKeys: ['site_visit', 'documents'], actor: 'capability-test' })
  });
  assert.equal(capabilityPreview.response.status, 201);
  assert.equal(capabilityPreview.body.success, true);
  assert.equal(capabilityPreview.body.mode, 'preview');
  assert.equal(capabilityPreview.body.summary.externalCommitments, 0);
  assert.ok(capabilityPreview.body.actions.length >= 2);
  assert.ok(capabilityPreview.body.actions.some(action => action.requirementKey === 'site_visit'));
  assert.ok(capabilityPreview.body.actions.some(action => action.sourceVendors.includes('Procore') || action.sourceVendors.includes('Autodesk')));
  const previewCoverage = capabilityPreview.body.coverage.summary.averageCoverage;

  const capabilityApply = await request(baseUrl, `/api/ledger/jobs/${jobId}/capability-plan`, {
    method: 'POST',
    body: JSON.stringify({ requirementKeys: ['site_visit', 'documents'], actor: 'capability-test' })
  });
  assert.equal(capabilityApply.response.status, 201);
  assert.equal(capabilityApply.body.success, true);
  assert.equal(capabilityApply.body.mode, 'applied');
  assert.equal(capabilityApply.body.summary.externalCommitments, 0);
  assert.ok(capabilityApply.body.created.length >= 2);
  assert.ok(capabilityApply.body.created.some(item => item.requirementKey === 'site_visit' && item.id));
  assert.ok(capabilityApply.body.created.some(item => item.requirementKey === 'documents' && item.id));
  assert.ok(capabilityApply.body.summary.averageCoverageAfter >= previewCoverage);
  assert.ok(capabilityApply.body.job.siteVisits.length >= 1);
  assert.ok(capabilityApply.body.job.documents.length >= 1);
  assert.ok(capabilityApply.body.job.audit.some(event => event.action === 'apply_capability_gap_plan'));

  const contextualDraftJob = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Contextual capability patio painting',
      service: 'Exterior painting',
      description: 'Paint the patio doors, protect the garden path, and confirm colour before opening paint.',
      client: {
        name: 'Context Client',
        email: 'context@example.test',
        phone: '+31600000001',
        address: 'Keizersgracht 10, Amsterdam',
        country: 'NL'
      },
      address: 'Keizersgracht 10, Amsterdam',
      city: 'Amsterdam',
      priority: 'medium',
      estimatedCost: 2400,
      estimatedHours: 18,
      assignAutomatically: false
    })
  });
  assert.equal(contextualDraftJob.response.status, 201);
  const contextualJobId = contextualDraftJob.body.job.id;

  const contextualApply = await request(baseUrl, `/api/ledger/jobs/${contextualJobId}/capability-plan`, {
    method: 'POST',
    body: JSON.stringify({
      requirementKeys: ['change_order', 'selection', 'incident', 'expense', 'instructions'],
      actor: 'contextual-draft-test'
    })
  });
  assert.equal(contextualApply.response.status, 201);
  assert.equal(contextualApply.body.success, true);
  assert.equal(contextualApply.body.summary.externalCommitments, 0);
  assert.ok(contextualApply.body.created.some(item => item.requirementKey === 'change_order'));
  assert.ok(contextualApply.body.created.some(item => item.requirementKey === 'selection'));
  assert.ok(contextualApply.body.created.some(item => item.requirementKey === 'incident'));
  assert.ok(contextualApply.body.created.some(item => item.requirementKey === 'expense'));
  assert.ok(contextualApply.body.created.some(item => item.requirementKey === 'instructions'));

  const contextualDetail = contextualApply.body.job;
  const contextualText = [
    contextualDetail.changeOrders[0]?.title,
    contextualDetail.changeOrders[0]?.scopeDelta,
    contextualDetail.clientSelections[0]?.title,
    contextualDetail.incidents[0]?.title,
    contextualDetail.incidents[0]?.data?.description,
    contextualDetail.expenses[0]?.notes,
    contextualDetail.workerInstructions[0]?.body
  ].join(' ');
  assert.match(contextualText, /Contextual capability patio painting/);
  assert.doesNotMatch(contextualText, /placeholder/i);
  assert.match(contextualDetail.changeOrders[0].scopeDelta, /Robert approves/);
  assert.ok(contextualDetail.clientSelections[0].options.length >= 3);
  assert.ok(!contextualDetail.clientSelections[0].options.includes('Option A'));
  assert.match(contextualDetail.workerInstructions[0].body, /Stop and ask Robert/);

  const commandJob = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Today command plan deck repair',
      service: 'Deck repair',
      client: {
        name: 'Command Plan Client',
        email: 'command-plan@example.test',
        phone: '+31600000002',
        address: 'Herengracht 44, Amsterdam',
        country: 'NL'
      },
      address: 'Herengracht 44, Amsterdam',
      city: 'Amsterdam',
      priority: 'high',
      riskLevel: 'medium',
      estimatedCost: 1800,
      estimatedHours: 16
    })
  });
  assert.equal(commandJob.response.status, 201);
  const commandJobId = commandJob.body.job.id;

  const commandPlan = await request(baseUrl, `/api/ledger/command-plan?limit=80&jobId=${encodeURIComponent(commandJobId)}`);
  assert.equal(commandPlan.response.status, 200);
  assert.equal(commandPlan.body.success, true);
  assert.equal(commandPlan.body.summary.externalCommitments, 0);
  const siteVisitCommand = commandPlan.body.actions.find(action =>
    action.actionType === 'draft_capability_gap'
    && action.requirementKey === 'site_visit'
    && action.jobId === commandJobId
  );
  assert.ok(siteVisitCommand);
  assert.equal(siteVisitCommand.safeDraftable, true);

  const commandApply = await request(baseUrl, '/api/ledger/command-plan', {
    method: 'POST',
    body: JSON.stringify({ actionIds: [siteVisitCommand.id], actor: 'command-plan-test', limit: 1 })
  });
  assert.equal(commandApply.response.status, 201);
  assert.equal(commandApply.body.success, true);
  assert.equal(commandApply.body.summary.externalCommitments, 0);
  assert.ok(commandApply.body.applied.some(item =>
    item.type === 'draft_capability_gap'
    && item.jobId === commandJobId
    && item.created.some(record => record.requirementKey === 'site_visit' && record.id)
  ));

  const commandDetail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(commandJobId)}`);
  assert.equal(commandDetail.response.status, 200);
  assert.ok(commandDetail.body.job.siteVisits.length >= 1);
  assert.ok(commandDetail.body.job.audit.some(event => event.action === 'apply_today_command_plan'));
  assert.ok(commandDetail.body.job.audit.some(event => event.action === 'apply_capability_gap_plan'));

  const clients = await request(baseUrl, '/api/clients?search=Ledger%20Client');
  assert.equal(clients.response.status, 200);
  const ledgerClient = clients.body.clients.find(client => client.name === 'Ledger Client BV');
  assert.ok(ledgerClient);

  const updatedClient = await request(baseUrl, `/api/clients/${ledgerClient.id}`, {
    method: 'PUT',
    body: JSON.stringify({ preferredLanguage: 'nl', city: 'Amsterdam' })
  });
  assert.equal(updatedClient.response.status, 200);
  assert.equal(updatedClient.body.client.city, 'Amsterdam');

  const progress = await request(baseUrl, `/api/ledger/jobs/${jobId}/progress`, {
    method: 'POST',
    body: JSON.stringify({ status: 'in_progress', progressPercent: 35, note: 'Site survey complete.' })
  });
  assert.equal(progress.response.status, 201);
  assert.equal(progress.body.job.status, 'in_progress');
  assert.equal(progress.body.job.progressPercent, 35);

  const communication = await request(baseUrl, `/api/ledger/jobs/${jobId}/communication`, {
    method: 'POST',
    body: JSON.stringify({
      channel: 'email',
      direction: 'outbound',
      subject: 'Kitchen refit update',
      body: 'Draft external update waiting for approval.'
    })
  });
  assert.equal(communication.response.status, 201);
  assert.equal(communication.body.communication.status, 'draft');
  assert.ok(communication.body.communication.approvalId);

  const timeLog = await request(baseUrl, `/api/ledger/jobs/${jobId}/time-logs`, {
    method: 'POST',
    body: JSON.stringify({ workDate: '2026-06-28', hours: 6.5, rate: 72, notes: 'Survey and preparation.' })
  });
  assert.equal(timeLog.response.status, 201);
  assert.equal(timeLog.body.timeLog.hours, 6.5);

  const expense = await request(baseUrl, `/api/ledger/jobs/${jobId}/expenses`, {
    method: 'POST',
    body: JSON.stringify({ category: 'materials', amount: 188.25, vendor: 'Bouwmaat', notes: 'Adhesive and fixings.' })
  });
  assert.equal(expense.response.status, 201);
  assert.equal(expense.body.expense.amount, 188.25);

  const invoice = await request(baseUrl, `/api/ledger/jobs/${jobId}/invoices`, {
    method: 'POST',
    body: JSON.stringify({ amount: 2300, taxAmount: 483, total: 2783, peppolReady: true })
  });
  assert.equal(invoice.response.status, 201);
  assert.ok(invoice.body.invoice.approvalId);

  const approvals = await request(baseUrl, '/api/ledger/approvals');
  assert.equal(approvals.response.status, 200);
  const quoteApproval = approvals.body.approvals.find(approval => approval.jobId === jobId && approval.targetType === 'quote');
  assert.ok(quoteApproval);

  const topLevelApprovals = await request(baseUrl, '/api/approvals');
  assert.equal(topLevelApprovals.response.status, 200);
  assert.ok(topLevelApprovals.body.approvals.some(approval => approval.id === quoteApproval.id));

  const resolved = await request(baseUrl, `/api/ledger/approvals/${quoteApproval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Test Approver', reason: 'Quote checked.' })
  });
  assert.equal(resolved.response.status, 200);
  assert.equal(resolved.body.approval.status, 'approved');

  const jobDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(jobDetail.response.status, 200);
  assert.equal(jobDetail.body.job.quotes.find(quote => quote.id === quoteApproval.targetId).status, 'approved');
  assert.ok(jobDetail.body.job.invoices.some(item => item.approvalId === invoice.body.invoice.approvalId));
  assert.ok(jobDetail.body.job.audit.some(event => event.action === 'resolve_approved'));

  const weather = await request(baseUrl, '/api/weather/assess', {
    method: 'POST',
    body: JSON.stringify({ jobId, condition: 'rain_risk', precipitationPercent: 72 })
  });
  assert.equal(weather.response.status, 201);
  assert.equal(weather.body.weather.precipitationPercent, 72);
  assert.equal(weather.body.recommendation.requiresApproval, true);
  assert.equal(weather.body.recommendation.status, 'needs_approval');
  assert.equal(weather.body.recommendation.readiness.weather.status, 'risk');
  assert.ok(weather.body.recommendation.blockers.some(blocker => blocker.type === 'weather_risk'));
  assert.ok(weather.body.nextActions.some(action => action.type === 'request_schedule_approval'));
  assert.ok(weather.body.nextAction?.type);
  assert.ok(weather.body.job.weather.some(item => item.id === weather.body.weather.id));
  assert.ok(weather.body.dispatch.weatherRisks >= 1);

  const schedule = await request(baseUrl, '/api/schedule/recommend', {
    method: 'POST',
    body: JSON.stringify({ jobId, plannedStart: '2026-07-01T08:00:00.000Z' })
  });
  assert.equal(schedule.response.status, 200);
  assert.equal(schedule.body.recommendation.requiresApproval, true);
  assert.equal(schedule.body.recommendation.status, 'needs_approval');
  assert.equal(schedule.body.recommendation.readiness.weather.status, 'risk');
  assert.ok(schedule.body.recommendation.plannedEnd);
  assert.ok(schedule.body.recommendation.recommendedWorker);
  assert.ok(schedule.body.recommendation.workerCandidates.length >= 1);
  assert.ok(schedule.body.recommendation.missing.includes('route_plan'));
  assert.ok(schedule.body.recommendation.missing.includes('loading_plan'));
  assert.ok(schedule.body.recommendation.missing.includes('procurement_plan'));
  assert.ok(schedule.body.recommendation.missing.includes('site_access'));
  assert.ok(schedule.body.recommendation.missing.includes('safety_pack'));
  assert.equal(schedule.body.recommendation.readiness.procurement.status, 'missing');
  assert.equal(schedule.body.recommendation.readiness.siteAccess.status, 'missing');
  assert.equal(schedule.body.recommendation.readiness.safety.status, 'missing');
  assert.ok(schedule.body.recommendation.readiness.approvals.pending >= 1);
  assert.ok(schedule.body.recommendation.blockers.some(blocker => blocker.type === 'approval_gate'));
  assert.ok(schedule.body.recommendation.nextActions.some(action => action.type === 'review_pending_approvals'));
  assert.ok(schedule.body.recommendation.nextActions.some(action => action.type === 'plan_procurement'));
  assert.ok(schedule.body.recommendation.nextActions.some(action => action.type === 'prepare_site_access'));
  assert.ok(schedule.body.recommendation.nextActions.some(action => action.type === 'prepare_safety_pack'));
  assert.ok(schedule.body.recommendation.nextActions.some(action => action.type === 'request_schedule_approval'));

  const prep = await request(baseUrl, '/api/schedule/prepare-dispatch', {
    method: 'POST',
    body: JSON.stringify({ jobId, plannedStart: '2026-07-01T08:00:00.000Z' })
  });
  assert.equal(prep.response.status, 201);
  const prepTypes = new Set(prep.body.created.map(item => item.type));
  assert.ok(prepTypes.has('route_plan'));
  assert.ok(prepTypes.has('loading_plan'));
  assert.ok(prepTypes.has('procurement_order'));
  assert.ok(prepTypes.has('worker_instruction'));
  assert.ok(prepTypes.has('safety_meeting'));
  assert.ok(prepTypes.has('jha_record'));
  assert.ok(prepTypes.has('sds_sheet'));
  assert.ok(prepTypes.has('worker_orientation'));
  assert.ok(prepTypes.has('site_access_log'));
  assert.equal(prep.body.approvals.length, 0);
  assert.ok(!prep.body.created.some(item => item.approvalId));
  assert.equal(prep.body.recommendationBefore.readiness.route.status, 'missing');
  assert.equal(prep.body.recommendationAfter.readiness.route.status, 'ready');
  assert.equal(prep.body.recommendationAfter.readiness.loading.status, 'ready');
  assert.equal(prep.body.recommendationAfter.readiness.instructions.status, 'ready');
  assert.equal(prep.body.recommendationAfter.readiness.procurement.status, 'approval');
  assert.equal(prep.body.recommendationAfter.readiness.siteAccess.status, 'blocked');
  assert.equal(prep.body.recommendationAfter.readiness.safety.status, 'review');
  const createdRecord = type => prep.body.created.find(item => item.type === type);
  assert.ok(prep.body.job.routePlans.some(item => item.id === createdRecord('route_plan').id && item.status === 'draft'));
  assert.ok(prep.body.job.loadingPlans.some(item => item.id === createdRecord('loading_plan').id && item.status === 'draft'));
  assert.ok(prep.body.job.procurementOrders.some(item => item.id === createdRecord('procurement_order').id && item.status === 'draft'));
  assert.ok(prep.body.job.workerInstructions.some(item => item.id === createdRecord('worker_instruction').id && item.status === 'draft'));
  assert.ok(prep.body.job.safetyMeetings.some(item => item.id === createdRecord('safety_meeting').id && item.status === 'scheduled'));
  assert.ok(prep.body.job.jhas.some(item => item.id === createdRecord('jha_record').id && item.status === 'draft'));
  assert.ok(prep.body.job.sdsSheets.some(item => item.id === createdRecord('sds_sheet').id && item.status === 'requested'));
  assert.ok(prep.body.job.orientations.some(item => item.id === createdRecord('worker_orientation').id && item.status === 'scheduled'));
  const preparedAccess = prep.body.job.siteAccessLogs.find(item => item.id === createdRecord('site_access_log').id);
  assert.ok(preparedAccess);
  assert.equal(preparedAccess.status, 'blocked');
  assert.equal(preparedAccess.orientationValid, false);
  assert.ok(prep.body.job.audit.some(event => event.action === 'prepare_schedule_dispatch'));

  const prepAgain = await request(baseUrl, '/api/schedule/prepare-dispatch', {
    method: 'POST',
    body: JSON.stringify({ jobId, plannedStart: '2026-07-01T08:00:00.000Z' })
  });
  assert.equal(prepAgain.response.status, 201);
  assert.equal(prepAgain.body.created.length, 0);
  assert.ok(prepAgain.body.skipped.length >= 1);
  assert.ok(prepAgain.body.skipped.some(item => item.type === 'site_access_log' && item.reason === 'active_record_exists'));

  const siteVisit = await request(baseUrl, `/api/ledger/jobs/${jobId}/site-visits`, {
    method: 'POST',
    body: JSON.stringify({
      visitType: 'site_survey',
      status: 'confirmed',
      scheduledAt: '2026-06-30T08:00:00.000Z',
      assignee: 'Robert',
      checklist: ['Confirm access', 'Measure work area', 'Take before photos'],
      findings: 'Client wants an added backsplash repair checked before dispatch.'
    })
  });
  assert.equal(siteVisit.response.status, 201);
  assert.equal(siteVisit.body.siteVisit.status, 'pending_approval');
  assert.ok(siteVisit.body.siteVisit.approvalId);

  const siteVisitApproval = await request(baseUrl, `/api/ledger/approvals/${siteVisit.body.siteVisit.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Survey Test', reason: 'Appointment confirmed with client.' })
  });
  assert.equal(siteVisitApproval.response.status, 200);
  assert.equal(siteVisitApproval.body.approval.status, 'approved');

  const changeOrder = await request(baseUrl, `/api/ledger/jobs/${jobId}/change-orders`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Backsplash repair addition',
      status: 'submitted',
      scopeDelta: 'Add backsplash repair discovered during site survey.',
      amount: 480,
      taxRate: 21,
      taxAmount: 100.8,
      total: 580.8,
      scheduleDeltaDays: 1,
      lineItems: [{ description: 'Backsplash repair', quantity: 1, unitPrice: 480 }]
    })
  });
  assert.equal(changeOrder.response.status, 201);
  assert.equal(changeOrder.body.changeOrder.status, 'pending_approval');
  assert.ok(changeOrder.body.changeOrder.approvalId);

  const changeOrderApproval = await request(baseUrl, `/api/ledger/approvals/${changeOrder.body.changeOrder.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Scope Test', reason: 'Client-approved extra scope.' })
  });
  assert.equal(changeOrderApproval.response.status, 200);
  assert.equal(changeOrderApproval.body.approval.status, 'approved');

  const scopeDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(scopeDetail.response.status, 200);
  assert.ok(scopeDetail.body.job.siteVisits.some(item => item.id === siteVisit.body.siteVisit.id && item.status === 'confirmed'));
  assert.ok(scopeDetail.body.job.changeOrders.some(item => item.id === changeOrder.body.changeOrder.id && item.status === 'approved'));

  const fieldReport = await request(baseUrl, `/api/ledger/jobs/${jobId}/field-reports`, {
    method: 'POST',
    body: JSON.stringify({
      reportDate: '2026-06-30',
      status: 'submitted',
      weather: 'Dry and workable',
      manpower: 2,
      workCompleted: 'Measured kitchen, protected hallway, confirmed delivery route.',
      blockers: ['Client decision needed on tile trim'],
      photos: ['before-kitchen.jpg']
    })
  });
  assert.equal(fieldReport.response.status, 201);
  assert.equal(fieldReport.body.fieldReport.status, 'pending_approval');
  assert.ok(fieldReport.body.fieldReport.approvalId);

  const fieldReportApproval = await request(baseUrl, `/api/ledger/approvals/${fieldReport.body.fieldReport.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Field Test', reason: 'Field report checked.' })
  });
  assert.equal(fieldReportApproval.response.status, 200);
  assert.equal(fieldReportApproval.body.approval.status, 'approved');

  const rfi = await request(baseUrl, `/api/ledger/jobs/${jobId}/rfis`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Tile trim decision',
      status: 'closed',
      responsible: 'Robert',
      dueAt: '2026-07-01',
      question: 'Which tile trim finish should be installed?',
      response: 'Use brushed stainless trim approved by client.'
    })
  });
  assert.equal(rfi.response.status, 201);
  assert.equal(rfi.body.rfi.status, 'pending_approval');
  assert.ok(rfi.body.rfi.approvalId);

  const rfiApproval = await request(baseUrl, `/api/ledger/approvals/${rfi.body.rfi.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'RFI Test', reason: 'Decision checked against scope.' })
  });
  assert.equal(rfiApproval.response.status, 200);
  assert.equal(rfiApproval.body.approval.status, 'approved');

  const submittal = await request(baseUrl, `/api/ledger/jobs/${jobId}/submittals`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Regression tile adhesive submittal',
      packageName: '09 30 00',
      status: 'approved',
      responsible: 'Project team',
      reviewer: 'Robert',
      dueAt: '2026-07-01',
      material: 'Tile adhesive',
      specification: 'Use approved waterproof adhesive for kitchen splash zone.',
      attachments: ['adhesive-spec.pdf']
    })
  });
  assert.equal(submittal.response.status, 201);
  assert.equal(submittal.body.submittal.status, 'pending_approval');
  assert.ok(submittal.body.submittal.approvalId);

  const submittalApproval = await request(baseUrl, `/api/ledger/approvals/${submittal.body.submittal.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Submittal Test', reason: 'Material package matches scope.' })
  });
  assert.equal(submittalApproval.response.status, 200);
  assert.equal(submittalApproval.body.approval.status, 'approved');

  const clientSelection = await request(baseUrl, `/api/ledger/jobs/${jobId}/client-selections`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Regression tile trim finish',
      category: 'finish',
      status: 'locked',
      clientName: 'Regression Client',
      value: 1650,
      dueAt: '2026-07-01',
      options: ['brushed stainless', 'black powder coat'],
      selectedOption: 'brushed stainless'
    })
  });
  assert.equal(clientSelection.response.status, 201);
  assert.equal(clientSelection.body.clientSelection.status, 'pending_approval');
  assert.ok(clientSelection.body.clientSelection.approvalId);

  const selectionApproval = await request(baseUrl, `/api/ledger/approvals/${clientSelection.body.clientSelection.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Selection Test', reason: 'Client decision and value checked.' })
  });
  assert.equal(selectionApproval.response.status, 200);
  assert.equal(selectionApproval.body.approval.status, 'approved');

  const permit = await request(baseUrl, `/api/ledger/jobs/${jobId}/permits`, {
    method: 'POST',
    body: JSON.stringify({
      permitType: 'public_space',
      title: 'Temporary hallway access protection',
      status: 'active',
      holder: 'Project team',
      location: 'Prinsengracht 1 shared hallway',
      expiresAt: '2026-07-02',
      notes: 'Protect shared hallway and keep access clear.'
    })
  });
  assert.equal(permit.response.status, 201);
  assert.equal(permit.body.permit.status, 'pending_approval');
  assert.ok(permit.body.permit.approvalId);

  const permitApproval = await request(baseUrl, `/api/ledger/approvals/${permit.body.permit.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Permit Test', reason: 'Permit reliance approved.' })
  });
  assert.equal(permitApproval.response.status, 200);
  assert.equal(permitApproval.body.approval.status, 'approved');

  const inspection = await request(baseUrl, `/api/ledger/jobs/${jobId}/inspections`, {
    method: 'POST',
    body: JSON.stringify({
      inspectionType: 'pre_task_inspection',
      title: 'Regression pre-task inspection',
      status: 'passed',
      result: 'passed',
      inspector: 'Robert',
      checklist: ['Access safe', 'PPE ready'],
      defects: [],
      photos: ['inspection-pass.jpg']
    })
  });
  assert.equal(inspection.response.status, 201);
  assert.equal(inspection.body.inspection.status, 'pending_approval');
  assert.ok(inspection.body.inspection.approvalId);

  const inspectionApproval = await request(baseUrl, `/api/ledger/approvals/${inspection.body.inspection.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Inspection Test', reason: 'Inspection checked.' })
  });
  assert.equal(inspectionApproval.response.status, 200);
  assert.equal(inspectionApproval.body.approval.status, 'approved');

  const observation = await request(baseUrl, `/api/ledger/jobs/${jobId}/observations`, {
    method: 'POST',
    body: JSON.stringify({
      category: 'safety',
      title: 'Regression temporary access observation',
      status: 'open',
      severity: 'high',
      responsible: 'Robert',
      correctiveAction: 'Add temporary ramp and inspect before work continues.',
      photos: ['access-observation.jpg']
    })
  });
  assert.equal(observation.response.status, 201);
  assert.equal(observation.body.observation.status, 'open');
  assert.ok(observation.body.observation.approvalId);

  const observationApproval = await request(baseUrl, `/api/ledger/approvals/${observation.body.observation.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Observation Test', reason: 'Risk reviewed but remains open.' })
  });
  assert.equal(observationApproval.response.status, 200);
  assert.equal(observationApproval.body.approval.status, 'approved');

  const incident = await request(baseUrl, `/api/ledger/jobs/${jobId}/incidents`, {
    method: 'POST',
    body: JSON.stringify({
      incidentType: 'near_miss',
      title: 'Regression near miss',
      status: 'resolved',
      severity: 'high',
      reportedBy: 'Marco',
      description: 'Trip hazard found at shared hallway.',
      immediateAction: 'Stopped work and cleared the pathway.',
      correctiveAction: 'Add access control to dispatch checklist.'
    })
  });
  assert.equal(incident.response.status, 201);
  assert.equal(incident.body.incident.status, 'pending_approval');
  assert.ok(incident.body.incident.approvalId);

  const incidentApproval = await request(baseUrl, `/api/ledger/approvals/${incident.body.incident.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Incident Test', reason: 'Incident resolution verified.' })
  });
  assert.equal(incidentApproval.response.status, 200);
  assert.equal(incidentApproval.body.approval.status, 'approved');

  const safetyMeeting = await request(baseUrl, `/api/ledger/jobs/${jobId}/safety-meetings`, {
    method: 'POST',
    body: JSON.stringify({
      meetingType: 'pre_task_talk',
      title: 'Regression pre-task safety talk',
      status: 'completed',
      facilitator: 'Robert',
      attendees: ['Robert', 'Marco'],
      topics: ['PPE', 'Shared hallway access', 'Stop-work trigger']
    })
  });
  assert.equal(safetyMeeting.response.status, 201);
  assert.equal(safetyMeeting.body.safetyMeeting.status, 'pending_approval');
  assert.ok(safetyMeeting.body.safetyMeeting.approvalId);

  const safetyMeetingApproval = await request(baseUrl, `/api/ledger/approvals/${safetyMeeting.body.safetyMeeting.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Safety Talk Test', reason: 'Attendees and topics verified.' })
  });
  assert.equal(safetyMeetingApproval.response.status, 200);
  assert.equal(safetyMeetingApproval.body.approval.status, 'approved');

  const orientation = await request(baseUrl, `/api/ledger/jobs/${jobId}/orientations`, {
    method: 'POST',
    body: JSON.stringify({
      workerName: 'Marco',
      company: 'NO Crew',
      language: 'nl',
      status: 'completed',
      topics: ['Site rules', 'PPE', 'Emergency route'],
      documents: ['orientation-marco.pdf']
    })
  });
  assert.equal(orientation.response.status, 201);
  assert.equal(orientation.body.orientation.status, 'pending_approval');
  assert.ok(orientation.body.orientation.approvalId);

  const orientationApproval = await request(baseUrl, `/api/ledger/approvals/${orientation.body.orientation.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Orientation Test', reason: 'Orientation evidence verified.' })
  });
  assert.equal(orientationApproval.response.status, 200);
  assert.equal(orientationApproval.body.approval.status, 'approved');

  const jha = await request(baseUrl, `/api/ledger/jobs/${jobId}/jhas`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Regression access JHA',
      status: 'approved',
      riskLevel: 'high',
      assignee: 'Robert',
      hazards: ['Shared hallway', 'Manual handling'],
      controls: ['Protect hallway', 'Two-person lift', 'Stop work on changed conditions']
    })
  });
  assert.equal(jha.response.status, 201);
  assert.equal(jha.body.jha.status, 'pending_approval');
  assert.ok(jha.body.jha.approvalId);

  const jhaApproval = await request(baseUrl, `/api/ledger/approvals/${jha.body.jha.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'JHA Test', reason: 'Controls reviewed.' })
  });
  assert.equal(jhaApproval.response.status, 200);
  assert.equal(jhaApproval.body.approval.status, 'approved');

  const sdsSheet = await request(baseUrl, `/api/ledger/jobs/${jobId}/sds-sheets`, {
    method: 'POST',
    body: JSON.stringify({
      material: 'Regression adhesive',
      supplier: 'Bouwmaat',
      status: 'current',
      expiresAt: '2026-12-31',
      documentRef: 'adhesive-sds.pdf',
      hazardClass: 'irritant'
    })
  });
  assert.equal(sdsSheet.response.status, 201);
  assert.equal(sdsSheet.body.sdsSheet.status, 'pending_approval');
  assert.ok(sdsSheet.body.sdsSheet.approvalId);

  const sdsApproval = await request(baseUrl, `/api/ledger/approvals/${sdsSheet.body.sdsSheet.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'SDS Test', reason: 'SDS expiry and material match checked.' })
  });
  assert.equal(sdsApproval.response.status, 200);
  assert.equal(sdsApproval.body.approval.status, 'approved');

  const siteAccess = await request(baseUrl, `/api/ledger/jobs/${jobId}/site-access`, {
    method: 'POST',
    body: JSON.stringify({
      orientationId: orientation.body.orientation.id,
      workerName: 'Marco',
      company: 'NO Crew',
      status: 'checked_in',
      orientationValid: true,
      accessPoint: 'Shared hallway',
      location: 'Prinsengracht 1'
    })
  });
  assert.equal(siteAccess.response.status, 201);
  assert.equal(siteAccess.body.siteAccessLog.status, 'pending_approval');
  assert.equal(siteAccess.body.siteAccessLog.orientationValid, true);
  assert.ok(siteAccess.body.siteAccessLog.approvalId);

  const siteAccessApproval = await request(baseUrl, `/api/ledger/approvals/${siteAccess.body.siteAccessLog.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Access Test', reason: 'Orientation and access point checked.' })
  });
  assert.equal(siteAccessApproval.response.status, 200);
  assert.equal(siteAccessApproval.body.approval.status, 'approved');

  const fieldDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(fieldDetail.response.status, 200);
  assert.ok(fieldDetail.body.job.fieldReports.some(item => item.id === fieldReport.body.fieldReport.id && item.status === 'submitted'));
  assert.ok(fieldDetail.body.job.rfis.some(item => item.id === rfi.body.rfi.id && item.status === 'closed'));
  assert.ok(fieldDetail.body.job.submittals.some(item => item.id === submittal.body.submittal.id && item.status === 'approved'));
  assert.ok(fieldDetail.body.job.clientSelections.some(item => item.id === clientSelection.body.clientSelection.id && item.status === 'locked'));
  assert.ok(fieldDetail.body.job.permits.some(item => item.id === permit.body.permit.id && item.status === 'active'));
  assert.ok(fieldDetail.body.job.inspections.some(item => item.id === inspection.body.inspection.id && item.status === 'passed'));
  assert.ok(fieldDetail.body.job.observations.some(item => item.id === observation.body.observation.id && item.status === 'open'));
  assert.ok(fieldDetail.body.job.incidents.some(item => item.id === incident.body.incident.id && item.status === 'resolved'));
  assert.ok(fieldDetail.body.job.safetyMeetings.some(item => item.id === safetyMeeting.body.safetyMeeting.id && item.status === 'completed'));
  assert.ok(fieldDetail.body.job.orientations.some(item => item.id === orientation.body.orientation.id && item.status === 'completed'));
  assert.ok(fieldDetail.body.job.jhas.some(item => item.id === jha.body.jha.id && item.status === 'approved'));
  assert.ok(fieldDetail.body.job.sdsSheets.some(item => item.id === sdsSheet.body.sdsSheet.id && item.status === 'current'));
  assert.ok(fieldDetail.body.job.siteAccessLogs.some(item => item.id === siteAccess.body.siteAccessLog.id && item.status === 'checked_in'));

  const dispatch = await request(baseUrl, `/api/ledger/jobs/${jobId}/dispatch`, {
    method: 'POST',
    body: JSON.stringify({
      origin: 'Amsterdam depot',
      destination: 'Prinsengracht 1, Amsterdam',
      vehicle: 'Transit van with trailer',
      trailerRequired: true,
      procurementSupplier: 'Bouwmaat',
      procurementAmount: 650,
      procurementStatus: 'ready_to_order',
      requiredBy: '2026-07-01',
      workerInstructionTitle: 'Kitchen refit dispatch brief',
      workerInstructionBody: 'Arrive at 08:00, protect the hallway, take before photos, and flag blockers before extra work.'
    })
  });
  assert.equal(dispatch.response.status, 201);
  assert.ok(dispatch.body.dispatch.routePlan.id);
  assert.ok(dispatch.body.dispatch.loadingPlan.id);
  assert.ok(dispatch.body.dispatch.procurementOrder.id);
  assert.equal(dispatch.body.dispatch.procurementOrder.status, 'pending_approval');
  assert.ok(dispatch.body.dispatch.procurementOrder.approvalId);
  assert.ok(dispatch.body.dispatch.workerInstruction.id);
  assert.ok(dispatch.body.job.routePlans.some(item => item.id === dispatch.body.dispatch.routePlan.id));
  assert.ok(dispatch.body.job.loadingPlans.some(item => item.id === dispatch.body.dispatch.loadingPlan.id));
  assert.ok(dispatch.body.job.procurementOrders.some(item => item.id === dispatch.body.dispatch.procurementOrder.id));
  assert.ok(dispatch.body.job.workerInstructions.some(item => item.id === dispatch.body.dispatch.workerInstruction.id));
  assert.ok(dispatch.body.job.audit.some(event => event.action === 'create_dispatch_pack'));

  const procurementApproval = await request(baseUrl, `/api/ledger/approvals/${dispatch.body.dispatch.procurementOrder.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Procurement Test', reason: 'Spend approved but not externally ordered.' })
  });
  assert.equal(procurementApproval.response.status, 200);
  assert.equal(procurementApproval.body.approval.status, 'approved');

  const publishedInstruction = await request(baseUrl, `/api/ledger/jobs/${jobId}/worker-instructions`, {
    method: 'POST',
    body: JSON.stringify({
      audience: 'crew',
      channel: 'app',
      status: 'sent',
      title: 'Published regression dispatch instructions',
      body: 'Confirm arrival and upload before photos.'
    })
  });
  assert.equal(publishedInstruction.response.status, 201);
  assert.equal(publishedInstruction.body.workerInstruction.status, 'pending_approval');
  assert.ok(publishedInstruction.body.workerInstruction.approvalId);

  const instructionApproval = await request(baseUrl, `/api/ledger/approvals/${publishedInstruction.body.workerInstruction.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Dispatch Test', reason: 'Crew instruction checked.' })
  });
  assert.equal(instructionApproval.response.status, 200);
  assert.equal(instructionApproval.body.approval.status, 'approved');

  const dispatchDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(dispatchDetail.response.status, 200);
  assert.ok(dispatchDetail.body.job.procurementOrders.some(item => item.id === dispatch.body.dispatch.procurementOrder.id && item.status === 'ready_to_order'));
  assert.ok(dispatchDetail.body.job.workerInstructions.some(item => item.id === publishedInstruction.body.workerInstruction.id && item.status === 'approved'));

  const closeout = await request(baseUrl, `/api/ledger/jobs/${jobId}/closeout`, {
    method: 'POST',
    body: JSON.stringify({
      amount: 2300,
      taxAmount: 483,
      total: 2783,
      createRecurringPlan: true,
      intervalRule: 'quarterly',
      completionNote: 'Closeout package regression check.'
    })
  });
  assert.equal(closeout.response.status, 201);
  assert.ok(closeout.body.closeout.quality.id);
  assert.ok(closeout.body.closeout.safety.id);
  assert.ok(closeout.body.closeout.aftercare.id);
  assert.ok(closeout.body.closeout.payment.id);
  assert.ok(closeout.body.closeout.communication.approvalId);
  assert.ok(closeout.body.closeout.recurringPlan.id);
  assert.equal(closeout.body.closeout.completion.requiresApproval, true);
  assert.ok(closeout.body.closeout.completion.approval.id);
  assert.equal(closeout.body.closeout.completion.approval.targetType, 'job_update');
  assert.equal(closeout.body.closeout.completion.proposedPatch.status, 'completed');
  assert.notEqual(closeout.body.job.status, 'completed');
  assert.ok(closeout.body.job.qualityChecks.length >= 1);
  assert.ok(closeout.body.job.safetyChecks.length >= 1);
  assert.ok(closeout.body.job.payments.length >= 1);
  assert.ok(closeout.body.job.aftercare.length >= 1);
  assert.ok(closeout.body.job.recurringPlans.some(plan => plan.intervalRule === 'quarterly'));

  const closeoutCompletionApproval = await request(baseUrl, `/api/ledger/approvals/${closeout.body.closeout.completion.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Closeout Test', reason: 'Completion verified before closeout.' })
  });
  assert.equal(closeoutCompletionApproval.response.status, 200);
  assert.equal(closeoutCompletionApproval.body.approval.status, 'approved');

  const closeoutCompletedDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(closeoutCompletedDetail.response.status, 200);
  assert.equal(closeoutCompletedDetail.body.job.status, 'completed');
  assert.equal(closeoutCompletedDetail.body.job.progressPercent, 100);

  const qualitySignoff = await request(baseUrl, `/api/ledger/jobs/${jobId}/quality-checks`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Regression quality signoff', status: 'passed', result: 'passed' })
  });
  assert.equal(qualitySignoff.response.status, 201);
  assert.ok(qualitySignoff.body.qualityCheck.approvalId);

  const punchItem = await request(baseUrl, `/api/ledger/jobs/${jobId}/punch-items`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Regression backsplash correction',
      status: 'closed',
      severity: 'medium',
      assignee: 'Robert',
      dueAt: '2026-07-02',
      location: 'Kitchen backsplash',
      description: 'Correction completed and photo evidence attached.',
      photos: ['punch-closed.jpg']
    })
  });
  assert.equal(punchItem.response.status, 201);
  assert.equal(punchItem.body.punchItem.status, 'pending_approval');
  assert.ok(punchItem.body.punchItem.approvalId);

  const punchApproval = await request(baseUrl, `/api/ledger/approvals/${punchItem.body.punchItem.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Punch Test', reason: 'Closeout evidence verified.' })
  });
  assert.equal(punchApproval.response.status, 200);
  assert.equal(punchApproval.body.approval.status, 'approved');

  const warrantyClaim = await request(baseUrl, `/api/ledger/jobs/${jobId}/warranty-claims`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Regression workmanship aftercare',
      status: 'resolved',
      clientName: 'Regression Client',
      severity: 'medium',
      dueAt: '2026-07-08',
      warrantyType: 'workmanship',
      issue: 'Client reported minor trim movement after completion.',
      resolution: 'Trim resecured and client informed.',
      photos: ['warranty-resolved.jpg']
    })
  });
  assert.equal(warrantyClaim.response.status, 201);
  assert.equal(warrantyClaim.body.warrantyClaim.status, 'pending_approval');
  assert.ok(warrantyClaim.body.warrantyClaim.approvalId);

  const warrantyApproval = await request(baseUrl, `/api/ledger/approvals/${warrantyClaim.body.warrantyClaim.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Warranty Test', reason: 'Resolution checked against aftercare obligation.' })
  });
  assert.equal(warrantyApproval.response.status, 200);
  assert.equal(warrantyApproval.body.approval.status, 'approved');

  const safetyReview = await request(baseUrl, `/api/ledger/jobs/${jobId}/safety-checks`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Regression high-risk safety review', riskLevel: 'high', hazards: ['temporary access'] })
  });
  assert.equal(safetyReview.response.status, 201);
  assert.ok(safetyReview.body.safetyCheck.approvalId);

  const paymentReceived = await request(baseUrl, `/api/ledger/jobs/${jobId}/payments`, {
    method: 'POST',
    body: JSON.stringify({ status: 'received', amount: 2783, method: 'bank_transfer', reference: 'REG-PAY-1' })
  });
  assert.equal(paymentReceived.response.status, 201);
  assert.equal(paymentReceived.body.payment.status, 'pending_confirmation');
  assert.ok(paymentReceived.body.payment.approvalId);

  const paymentApproval = await request(baseUrl, `/api/ledger/approvals/${paymentReceived.body.payment.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Finance Test', reason: 'Payment matched bank export.' })
  });
  assert.equal(paymentApproval.response.status, 200);
  assert.equal(paymentApproval.body.approval.status, 'approved');

  const budgetLine = await request(baseUrl, `/api/ledger/jobs/${jobId}/budget-lines`, {
    method: 'POST',
    body: JSON.stringify({
      costCode: 'REG-100',
      description: 'Regression finance baseline',
      category: 'materials',
      status: 'locked',
      budgetAmount: 1800,
      committedAmount: 950,
      actualAmount: 188.25,
      forecastAmount: 1900
    })
  });
  assert.equal(budgetLine.response.status, 201);
  assert.equal(budgetLine.body.budgetLine.status, 'pending_approval');
  assert.ok(budgetLine.body.budgetLine.approvalId);

  const budgetApproval = await request(baseUrl, `/api/ledger/approvals/${budgetLine.body.budgetLine.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Budget Test', reason: 'Baseline reviewed.' })
  });
  assert.equal(budgetApproval.response.status, 200);
  assert.equal(budgetApproval.body.approval.status, 'approved');

  const purchaseOrder = await request(baseUrl, `/api/ledger/jobs/${jobId}/purchase-orders`, {
    method: 'POST',
    body: JSON.stringify({
      budgetLineId: budgetLine.body.budgetLine.id,
      supplier: 'Bouwmaat',
      status: 'ordered',
      amount: 950,
      requiredBy: '2026-07-01',
      items: [{ name: 'Regression worktop materials', quantity: 1, unitCost: 950 }]
    })
  });
  assert.equal(purchaseOrder.response.status, 201);
  assert.equal(purchaseOrder.body.purchaseOrder.status, 'pending_approval');
  assert.ok(purchaseOrder.body.purchaseOrder.approvalId);

  const purchaseOrderApproval = await request(baseUrl, `/api/ledger/approvals/${purchaseOrder.body.purchaseOrder.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'PO Test', reason: 'Supplier commitment approved for internal ordering.' })
  });
  assert.equal(purchaseOrderApproval.response.status, 200);
  assert.equal(purchaseOrderApproval.body.approval.status, 'approved');

  const drawRequest = await request(baseUrl, `/api/ledger/jobs/${jobId}/draw-requests`, {
    method: 'POST',
    body: JSON.stringify({
      invoiceId: invoice.body.invoice.id,
      title: 'Regression progress draw',
      status: 'submitted',
      requestedAmount: 2783,
      percentComplete: 80,
      dueAt: '2026-07-05'
    })
  });
  assert.equal(drawRequest.response.status, 201);
  assert.equal(drawRequest.body.drawRequest.status, 'pending_approval');
  assert.ok(drawRequest.body.drawRequest.approvalId);

  const drawApproval = await request(baseUrl, `/api/ledger/approvals/${drawRequest.body.drawRequest.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Draw Test', reason: 'Draw package checked.' })
  });
  assert.equal(drawApproval.response.status, 200);
  assert.equal(drawApproval.body.approval.status, 'approved');

  const lienWaiver = await request(baseUrl, `/api/ledger/jobs/${jobId}/lien-waivers`, {
    method: 'POST',
    body: JSON.stringify({
      paymentId: paymentReceived.body.payment.id,
      supplier: 'Bouwmaat',
      waiverType: 'conditional',
      status: 'received',
      amount: 2783,
      documentRef: 'waiver-regression.pdf'
    })
  });
  assert.equal(lienWaiver.response.status, 201);
  assert.equal(lienWaiver.body.lienWaiver.status, 'pending_approval');
  assert.ok(lienWaiver.body.lienWaiver.approvalId);

  const waiverApproval = await request(baseUrl, `/api/ledger/approvals/${lienWaiver.body.lienWaiver.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Waiver Test', reason: 'Waiver matched payment record.' })
  });
  assert.equal(waiverApproval.response.status, 200);
  assert.equal(waiverApproval.body.approval.status, 'approved');

  const financeHandoff = await request(baseUrl, `/api/ledger/jobs/${jobId}/finance-handoffs`, {
    method: 'POST',
    body: JSON.stringify({
      targetSystem: 'FAB',
      packageType: 'job_finance',
      status: 'submitted',
      exportFormat: 'json',
      notes: 'Regression finance package.'
    })
  });
  assert.equal(financeHandoff.response.status, 201);
  assert.equal(financeHandoff.body.financeHandoff.status, 'pending_approval');
  assert.ok(financeHandoff.body.financeHandoff.approvalId);

  const handoffApproval = await request(baseUrl, `/api/ledger/approvals/${financeHandoff.body.financeHandoff.approvalId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'FAB Test', reason: 'Bookkeeping handoff package approved.' })
  });
  assert.equal(handoffApproval.response.status, 200);
  assert.equal(handoffApproval.body.approval.status, 'approved');

  const closeoutDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(closeoutDetail.response.status, 200);
  assert.ok(closeoutDetail.body.job.payments.some(item => item.id === paymentReceived.body.payment.id && item.status === 'received'));
  assert.ok(closeoutDetail.body.job.budgetLines.some(item => item.id === budgetLine.body.budgetLine.id && item.status === 'locked'));
  assert.ok(closeoutDetail.body.job.purchaseOrders.some(item => item.id === purchaseOrder.body.purchaseOrder.id && item.status === 'ready_to_order'));
  assert.ok(closeoutDetail.body.job.drawRequests.some(item => item.id === drawRequest.body.drawRequest.id && item.status === 'submitted'));
  assert.ok(closeoutDetail.body.job.lienWaivers.some(item => item.id === lienWaiver.body.lienWaiver.id && item.status === 'received'));
  assert.ok(closeoutDetail.body.job.financeHandoffs.some(item => item.id === financeHandoff.body.financeHandoff.id && item.status === 'ready_to_export'));
  assert.ok(closeoutDetail.body.job.punchItems.some(item => item.id === punchItem.body.punchItem.id && item.status === 'closed'));
  assert.ok(closeoutDetail.body.job.warrantyClaims.some(item => item.id === warrantyClaim.body.warrantyClaim.id && item.status === 'resolved'));
  assert.ok(closeoutDetail.body.job.audit.some(event => event.action === 'create_closeout_package'));

  const cycle = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: false, actor: 'test-cycle' })
  });
  assert.equal(cycle.response.status, 200);
  assert.equal(cycle.body.success, true);
  assert.ok(Array.isArray(cycle.body.preview));
  assert.ok(Array.isArray(cycle.body.applied));
  assert.ok(cycle.body.dashboard.metrics.pendingApprovals >= 1);

  const debug = await request(baseUrl, '/api/ledger/debug');
  assert.equal(debug.response.status, 200);
  assert.equal(debug.body.diagnostics.valid, true);
  assert.ok(debug.body.diagnostics.counts.qualityChecks >= 2);
  assert.ok(debug.body.diagnostics.counts.safetyChecks >= 2);
  assert.ok(debug.body.diagnostics.counts.payments >= 2);
  assert.ok(debug.body.diagnostics.counts.budgetLines >= 1);
  assert.ok(debug.body.diagnostics.counts.purchaseOrders >= 1);
  assert.ok(debug.body.diagnostics.counts.drawRequests >= 1);
  assert.ok(debug.body.diagnostics.counts.lienWaivers >= 1);
  assert.ok(debug.body.diagnostics.counts.financeHandoffs >= 1);
  assert.ok(debug.body.diagnostics.counts.aftercareItems >= 1);
  assert.ok(debug.body.diagnostics.counts.recurringPlans >= 1);
  assert.ok(debug.body.diagnostics.counts.siteVisits >= 1);
  assert.ok(debug.body.diagnostics.counts.changeOrders >= 1);
  assert.ok(debug.body.diagnostics.counts.fieldReports >= 1);
  assert.ok(debug.body.diagnostics.counts.rfiRecords >= 1);
  assert.ok(debug.body.diagnostics.counts.submittals >= 1);
  assert.ok(debug.body.diagnostics.counts.clientSelections >= 1);
  assert.ok(debug.body.diagnostics.counts.permitRecords >= 1);
  assert.ok(debug.body.diagnostics.counts.inspectionRecords >= 1);
  assert.ok(debug.body.diagnostics.counts.observationRecords >= 1);
  assert.ok(debug.body.diagnostics.counts.incidentRecords >= 1);
  assert.ok(debug.body.diagnostics.counts.safetyMeetings >= 1);
  assert.ok(debug.body.diagnostics.counts.orientations >= 1);
  assert.ok(debug.body.diagnostics.counts.jhas >= 1);
  assert.ok(debug.body.diagnostics.counts.sdsSheets >= 1);
  assert.ok(debug.body.diagnostics.counts.siteAccessLogs >= 1);
  assert.ok(debug.body.diagnostics.counts.routePlans >= 1);
  assert.ok(debug.body.diagnostics.counts.loadingPlans >= 1);
  assert.ok(debug.body.diagnostics.counts.procurementOrders >= 1);
  assert.ok(debug.body.diagnostics.counts.workerInstructions >= 2);
  assert.ok(debug.body.diagnostics.counts.punchItems >= 1);
  assert.ok(debug.body.diagnostics.counts.warrantyClaims >= 1);
  assert.ok(debug.body.dashboard.metrics.auditEvents >= 1);
  assert.ok(debug.body.dashboard.metrics.openAftercare >= 1);
  assert.ok(debug.body.dashboard.metrics.activeRecurringPlans >= 1);
  assert.ok(debug.body.dashboard.metrics.siteVisits >= 1);
  assert.ok(debug.body.dashboard.metrics.changeOrders >= 1);
  assert.ok(debug.body.dashboard.metrics.fieldReports >= 1);
  assert.ok(debug.body.dashboard.metrics.submittals >= 1);
  assert.ok(debug.body.dashboard.metrics.clientSelections >= 1);
  assert.ok(debug.body.dashboard.metrics.permitRecords >= 1);
  assert.ok(debug.body.dashboard.metrics.inspections >= 1);
  assert.ok(debug.body.dashboard.metrics.openObservations >= 1);
  assert.ok(debug.body.dashboard.metrics.safetyMeetings >= 1);
  assert.ok(debug.body.dashboard.metrics.orientations >= 1);
  assert.ok(debug.body.dashboard.metrics.jhas >= 1);
  assert.ok(debug.body.dashboard.metrics.sdsSheets >= 1);
  assert.ok(debug.body.dashboard.metrics.siteAccessLogs >= 1);
  assert.ok(debug.body.dashboard.metrics.dispatchReadyJobs >= 1);
  assert.ok(debug.body.dashboard.metrics.budgetLines >= 1);
  assert.ok(debug.body.dashboard.metrics.purchaseOrders >= 1);
  assert.ok(debug.body.dashboard.metrics.drawRequests >= 1);
  assert.ok(debug.body.dashboard.metrics.lienWaivers >= 1);
  assert.ok(debug.body.dashboard.metrics.financeHandoffs >= 1);
  assert.ok(debug.body.dashboard.metrics.punchItems >= 1);
  assert.ok(debug.body.dashboard.metrics.warrantyClaims >= 1);
  assert.ok(debug.body.dashboard.money.changeOrderValue >= 580.8);
  assert.ok(debug.body.dashboard.money.procurementValue >= 650);
  assert.ok(debug.body.dashboard.money.budgetValue >= 1800);
  assert.ok(debug.body.dashboard.money.purchaseOrderValue >= 950);
  assert.ok(debug.body.dashboard.money.drawRequestValue >= 2783);
  assert.ok(debug.body.dashboard.money.financeHandoffValue >= 1);

  const audit = await request(baseUrl, `/api/ledger/audit?jobId=${encodeURIComponent(jobId)}`);
  assert.equal(audit.response.status, 200);
  assert.ok(audit.body.events.some(event => event.action === 'create_intake_job'));
  assert.ok(audit.body.events.some(event => event.action === 'record_time'));

  const topLevelAudit = await request(baseUrl, `/api/audit?jobId=${encodeURIComponent(jobId)}`);
  assert.equal(topLevelAudit.response.status, 200);
  assert.ok(topLevelAudit.body.events.some(event => event.action === 'assess_weather'));

  const ledgerOnlyIntake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Ledger-only dashboard merge job',
      client: { name: 'Ledger Merge Client', address: 'Utrecht' },
      service: 'Painting',
      description: 'Persisted directly through the operating ledger.',
      priority: 'high',
      status: 'planned',
      assignAutomatically: false
    })
  });
  assert.equal(ledgerOnlyIntake.response.status, 201);

  const ledgerOnlyWorker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Ledger-only Crew Lead',
      role: 'Painting',
      status: 'available',
      homeRegion: 'Utrecht',
      skills: ['painting', 'client handover']
    })
  });
  assert.equal(ledgerOnlyWorker.response.status, 201);

  const ledgerOnlyTool = await request(baseUrl, '/api/ledger/tools', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Ledger-only Paint Sprayer',
      category: 'painting',
      status: 'available',
      currentLocation: 'Utrecht Depot'
    })
  });
  assert.equal(ledgerOnlyTool.response.status, 201);

  const firstToolReservation = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}/tools`, {
    method: 'POST',
    body: JSON.stringify({
      toolId: ledgerOnlyTool.body.tool.id,
      toolName: 'Ledger-only Paint Sprayer',
      neededFrom: '2026-07-01T08:00:00.000Z',
      neededUntil: '2026-07-01T12:00:00.000Z'
    })
  });
  assert.equal(firstToolReservation.response.status, 201);
  assert.equal(firstToolReservation.body.toolReservation.status, 'reserved');
  assert.equal(firstToolReservation.body.toolReservation.requiresApproval, false);

  const conflictJob = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Ledger-only conflicting tool job',
      client: { name: 'Ledger Tool Conflict Client', address: 'Rotterdam' },
      service: 'Painting',
      description: 'Second persisted job needs the same paint sprayer.',
      priority: 'medium',
      status: 'planned',
      assignAutomatically: false
    })
  });
  assert.equal(conflictJob.response.status, 201);

  const firstWorkerAssignment = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}/assignments`, {
    method: 'POST',
    body: JSON.stringify({
      workerId: ledgerOnlyWorker.body.worker.id,
      workerName: 'Ledger-only Crew Lead',
      role: 'Painter',
      scheduledStart: '2026-07-02T08:00:00.000Z',
      scheduledEnd: '2026-07-02T12:00:00.000Z',
      allocationHours: 4
    })
  });
  assert.equal(firstWorkerAssignment.response.status, 201);
  assert.equal(firstWorkerAssignment.body.assignment.status, 'planned');
  assert.equal(firstWorkerAssignment.body.assignment.requiresApproval, false);

  const conflictingAssignment = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}/assignments`, {
    method: 'POST',
    body: JSON.stringify({
      workerId: ledgerOnlyWorker.body.worker.id,
      workerName: 'Ledger-only Crew Lead',
      role: 'Painter',
      scheduledStart: '2026-07-02T10:00:00.000Z',
      scheduledEnd: '2026-07-02T14:00:00.000Z',
      allocationHours: 4
    })
  });
  assert.equal(conflictingAssignment.response.status, 201);
  assert.equal(conflictingAssignment.body.assignment.status, 'pending_approval');
  assert.equal(conflictingAssignment.body.assignment.requiresApproval, true);
  assert.ok(conflictingAssignment.body.assignment.approval.id);
  assert.equal(conflictingAssignment.body.assignment.approval.targetType, 'assignment');
  assert.ok(conflictingAssignment.body.assignment.conflicts.some(conflict => conflict.assignmentId === firstWorkerAssignment.body.assignment.id));

  const assignmentConflictDashboard = await request(baseUrl, '/api/dashboard');
  assert.equal(assignmentConflictDashboard.response.status, 200);
  assert.ok(assignmentConflictDashboard.body.ledger.metrics.assignmentConflicts >= 1);
  assert.ok(assignmentConflictDashboard.body.ledger.nextActions.some(action => action.type === 'resolve_worker_conflict'));

  const approvedWorkerConflict = await request(baseUrl, `/api/ledger/approvals/${conflictingAssignment.body.assignment.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Assignment Test', reason: 'Worker conflict intentionally approved for regression coverage.' })
  });
  assert.equal(approvedWorkerConflict.response.status, 200);
  assert.equal(approvedWorkerConflict.body.approval.status, 'approved');

  const approvedAssignmentDetail = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}`);
  assert.equal(approvedAssignmentDetail.response.status, 200);
  assert.ok(approvedAssignmentDetail.body.job.assignments.some(item => item.id === conflictingAssignment.body.assignment.id && item.status === 'planned'));

  const firstAssignmentRelease = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}/assignments/${firstWorkerAssignment.body.assignment.id}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Regression release clears original worker booking.' })
  });
  assert.equal(firstAssignmentRelease.response.status, 200);
  assert.equal(firstAssignmentRelease.body.assignment.status, 'released');

  const conflictingAssignmentRelease = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}/assignments/${conflictingAssignment.body.assignment.id}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Regression release clears approved worker conflict booking.' })
  });
  assert.equal(conflictingAssignmentRelease.response.status, 200);
  assert.equal(conflictingAssignmentRelease.body.assignment.status, 'released');

  const postReleaseAssignment = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}/assignments`, {
    method: 'POST',
    body: JSON.stringify({
      workerId: ledgerOnlyWorker.body.worker.id,
      workerName: 'Ledger-only Crew Lead',
      role: 'Painter',
      scheduledStart: '2026-07-02T10:00:00.000Z',
      scheduledEnd: '2026-07-02T14:00:00.000Z',
      allocationHours: 4
    })
  });
  assert.equal(postReleaseAssignment.response.status, 201);
  assert.equal(postReleaseAssignment.body.assignment.status, 'planned');
  assert.equal(postReleaseAssignment.body.assignment.requiresApproval, false);
  assert.equal(postReleaseAssignment.body.assignment.conflicts.length, 0);

  const conflictingReservation = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}/tools`, {
    method: 'POST',
    body: JSON.stringify({
      toolId: ledgerOnlyTool.body.tool.id,
      toolName: 'Ledger-only Paint Sprayer',
      neededFrom: '2026-07-01T10:00:00.000Z',
      neededUntil: '2026-07-01T14:00:00.000Z'
    })
  });
  assert.equal(conflictingReservation.response.status, 201);
  assert.equal(conflictingReservation.body.toolReservation.status, 'pending_approval');
  assert.equal(conflictingReservation.body.toolReservation.requiresApproval, true);
  assert.ok(conflictingReservation.body.toolReservation.approval.id);
  assert.equal(conflictingReservation.body.toolReservation.approval.targetType, 'tool_reservation');
  assert.ok(conflictingReservation.body.toolReservation.conflicts.some(conflict => conflict.reservationId === firstToolReservation.body.toolReservation.id));

  const conflictDashboard = await request(baseUrl, '/api/dashboard');
  assert.equal(conflictDashboard.response.status, 200);
  assert.ok(conflictDashboard.body.ledger.metrics.toolReservationConflicts >= 1);
  assert.ok(conflictDashboard.body.ledger.nextActions.some(action => action.type === 'resolve_tool_conflict'));

  const approvedToolConflict = await request(baseUrl, `/api/ledger/approvals/${conflictingReservation.body.toolReservation.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Tool Test', reason: 'Conflict intentionally approved for regression coverage.' })
  });
  assert.equal(approvedToolConflict.response.status, 200);
  assert.equal(approvedToolConflict.body.approval.status, 'approved');

  const approvedConflictDetail = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}`);
  assert.equal(approvedConflictDetail.response.status, 200);
  assert.ok(approvedConflictDetail.body.job.tools.some(item => item.id === conflictingReservation.body.toolReservation.id && item.status === 'reserved'));

  const firstToolRelease = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}/tools/${firstToolReservation.body.toolReservation.id}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Regression release clears original booking.' })
  });
  assert.equal(firstToolRelease.response.status, 200);
  assert.equal(firstToolRelease.body.toolReservation.status, 'released');

  const conflictingToolRelease = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}/tools/${conflictingReservation.body.toolReservation.id}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Regression release clears approved conflict booking.' })
  });
  assert.equal(conflictingToolRelease.response.status, 200);
  assert.equal(conflictingToolRelease.body.toolReservation.status, 'released');

  const postReleaseReservation = await request(baseUrl, `/api/ledger/jobs/${conflictJob.body.job.id}/tools`, {
    method: 'POST',
    body: JSON.stringify({
      toolId: ledgerOnlyTool.body.tool.id,
      toolName: 'Ledger-only Paint Sprayer',
      neededFrom: '2026-07-01T10:00:00.000Z',
      neededUntil: '2026-07-01T14:00:00.000Z'
    })
  });
  assert.equal(postReleaseReservation.response.status, 201);
  assert.equal(postReleaseReservation.body.toolReservation.status, 'reserved');
  assert.equal(postReleaseReservation.body.toolReservation.requiresApproval, false);
  assert.equal(postReleaseReservation.body.toolReservation.conflicts.length, 0);

  const lowRiskJobUpdate = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: 'Ledger-only edited dashboard merge job',
      priority: 'medium'
    })
  });
  assert.equal(lowRiskJobUpdate.response.status, 200);
  assert.equal(lowRiskJobUpdate.body.status, 'updated');
  assert.equal(lowRiskJobUpdate.body.requiresApproval, false);
  assert.equal(lowRiskJobUpdate.body.job.title, 'Ledger-only edited dashboard merge job');

  const completionProposal = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      status: 'completed',
      progressPercent: 100,
      reason: 'Regression test verifies completion requires approval.'
    })
  });
  assert.equal(completionProposal.response.status, 200);
  assert.equal(completionProposal.body.status, 'pending_approval');
  assert.equal(completionProposal.body.requiresApproval, true);
  assert.ok(completionProposal.body.approval.id);
  assert.equal(completionProposal.body.approval.targetType, 'job_update');
  assert.equal(completionProposal.body.approval.data.patch.status, 'completed');

  const pendingCompletionDetail = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}`);
  assert.equal(pendingCompletionDetail.response.status, 200);
  assert.notEqual(pendingCompletionDetail.body.job.status, 'completed');

  const approvedCompletion = await request(baseUrl, `/api/ledger/approvals/${completionProposal.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Job Update Test', reason: 'Completion was verified.' })
  });
  assert.equal(approvedCompletion.response.status, 200);
  assert.equal(approvedCompletion.body.approval.status, 'approved');

  const completedDetail = await request(baseUrl, `/api/ledger/jobs/${ledgerOnlyIntake.body.job.id}`);
  assert.equal(completedDetail.response.status, 200);
  assert.equal(completedDetail.body.job.status, 'completed');
  assert.equal(completedDetail.body.job.progressPercent, 100);
  assert.ok(completedDetail.body.job.audit.some(event => event.action === 'propose_job_update'));
  assert.ok(completedDetail.body.job.audit.some(event => event.action === 'apply_job_update_approval'));

  const mergedDashboard = await request(baseUrl, '/api/dashboard');
  assert.equal(mergedDashboard.response.status, 200);
  assert.ok(mergedDashboard.body.jobs.some(job => job.id === ledgerOnlyIntake.body.job.id));
  assert.ok(mergedDashboard.body.workers.some(worker => worker.id === ledgerOnlyWorker.body.worker.id));
  assert.ok(mergedDashboard.body.tools.some(tool => tool.id === ledgerOnlyTool.body.tool.id));

  const mergedWorkers = await request(baseUrl, '/api/workers?search=Ledger-only');
  assert.equal(mergedWorkers.response.status, 200);
  assert.ok(mergedWorkers.body.some(worker => worker.id === ledgerOnlyWorker.body.worker.id));

  const mergedTools = await request(baseUrl, '/api/tools?search=Ledger-only');
  assert.equal(mergedTools.response.status, 200);
  assert.ok(mergedTools.body.some(tool => tool.id === ledgerOnlyTool.body.tool.id));

  const ledgerWorkerRetirement = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(ledgerOnlyWorker.body.worker.id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason: 'Direct ledger resource retirement requires approval.' })
  });
  assert.equal(ledgerWorkerRetirement.response.status, 200);
  assert.equal(ledgerWorkerRetirement.body.success, true);
  assert.equal(ledgerWorkerRetirement.body.deleted, false);
  assert.equal(ledgerWorkerRetirement.body.retained, true);
  assert.equal(ledgerWorkerRetirement.body.retired, false);
  assert.equal(ledgerWorkerRetirement.body.requiresApproval, true);
  assert.equal(ledgerWorkerRetirement.body.operationStatus, 'pending_approval');
  assert.equal(ledgerWorkerRetirement.body.approval.targetType, 'worker_retirement');
  assert.equal(ledgerWorkerRetirement.body.worker.status, 'available');

  const approvedLedgerWorkerRetirement = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(ledgerWorkerRetirement.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Resource Approval Test', reason: 'Worker retirement approved.' })
  });
  assert.equal(approvedLedgerWorkerRetirement.response.status, 200);
  assert.equal(approvedLedgerWorkerRetirement.body.approval.status, 'approved');

  const retiredLedgerWorkers = await request(baseUrl, '/api/ledger/workers?status=retired&limit=100');
  assert.equal(retiredLedgerWorkers.response.status, 200);
  assert.ok(retiredLedgerWorkers.body.workers.some(worker => worker.id === ledgerOnlyWorker.body.worker.id));

  const ledgerToolRetirement = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(ledgerOnlyTool.body.tool.id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason: 'Direct ledger equipment retirement requires approval.' })
  });
  assert.equal(ledgerToolRetirement.response.status, 200);
  assert.equal(ledgerToolRetirement.body.success, true);
  assert.equal(ledgerToolRetirement.body.deleted, false);
  assert.equal(ledgerToolRetirement.body.retained, true);
  assert.equal(ledgerToolRetirement.body.retired, false);
  assert.equal(ledgerToolRetirement.body.requiresApproval, true);
  assert.equal(ledgerToolRetirement.body.operationStatus, 'pending_approval');
  assert.equal(ledgerToolRetirement.body.approval.targetType, 'tool_retirement');
  assert.equal(ledgerToolRetirement.body.tool.status, 'available');

  const approvedLedgerToolRetirement = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(ledgerToolRetirement.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Resource Approval Test', reason: 'Tool retirement approved.' })
  });
  assert.equal(approvedLedgerToolRetirement.response.status, 200);
  assert.equal(approvedLedgerToolRetirement.body.approval.status, 'approved');

  const retiredLedgerTools = await request(baseUrl, '/api/ledger/tools?status=retired&limit=100');
  assert.equal(retiredLedgerTools.response.status, 200);
  assert.ok(retiredLedgerTools.body.tools.some(tool => tool.id === ledgerOnlyTool.body.tool.id));
});
