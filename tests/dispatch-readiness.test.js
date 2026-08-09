const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-dispatch-'));
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

async function createVerifiedTradePartner(baseUrl, name) {
  const result = await request(baseUrl, '/api/ledger/trade-partners', {
    method: 'POST',
    body: JSON.stringify({
      name,
      partnerType: 'supplier',
      registrationNumber: '12345678',
      vatNumber: 'NL123456789B01',
      verificationReference: 'Dispatch QA registry check',
      verifiedAt: new Date(Date.now() - 86_400_000).toISOString()
    })
  });
  assert.equal(result.response.status, 201);
  return result.body.partner;
}

test('dispatch readiness API summarizes blockers and reflects prepared dispatch records', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tradePartner = await createVerifiedTradePartner(baseUrl, 'Bouwmaat');

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'Dispatch Client',
      clientPhone: '+31 6 12345678',
      address: 'Keizersgracht 10, Amsterdam',
      service: 'garden maintenance',
      title: 'Dispatch readiness garden job',
      description: 'Trim hedge, remove green waste, and clean access path.',
      status: 'scheduled',
      priority: 'high',
      scheduledStart: '2026-07-06T08:00:00.000Z',
      scheduledEnd: '2026-07-06T13:00:00.000Z',
      estimatedHours: 5,
      tools: ['hedge trimmer', 'ladder', 'trailer'],
      materials: [
        { name: 'green waste bags', quantity: 12, unit: 'bags', cost: 3.5, supplier: 'Bouwmaat' }
      ]
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const worker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Dispatch readiness crew',
      role: 'Garden maintenance',
      status: 'available',
      homeRegion: 'Amsterdam',
      skills: ['garden maintenance']
    })
  });
  assert.equal(worker.response.status, 201);

  const assignment = await request(baseUrl, `/api/ledger/jobs/${jobId}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: worker.body.worker.id, workerName: worker.body.worker.name, status: 'planned' })
  });
  assert.equal(assignment.response.status, 201);

  const rfi = await request(baseUrl, `/api/ledger/jobs/${jobId}/rfis`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Confirm hedge-boundary protection',
      status: 'open',
      question: 'Which retained protection detail applies at the shared boundary?'
    })
  });
  assert.equal(rfi.response.status, 201);

  const before = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=100');
  assert.equal(before.response.status, 200);
  assert.ok(before.body.summary.total >= 1);
  const beforeJob = before.body.jobs.find(job => job.jobId === jobId);
  assert.ok(beforeJob);
  assert.ok(beforeJob.missing.includes('route_plan'));
  assert.ok(beforeJob.missing.includes('loading_plan'));
  assert.ok(beforeJob.missing.includes('worker_instruction'));
  assert.ok(beforeJob.missing.includes('procurement_plan'));
  assert.ok(beforeJob.counts.pendingApprovals >= 1);
  assert.equal(beforeJob.counts.routePlans, 0);
  assert.equal(beforeJob.counts.designOpenRecords, 1);
  assert.equal(beforeJob.counts.toolReadinessBlockers, 3);
  assert.equal(beforeJob.blockers.filter(blocker => blocker.type === 'tool_record_missing').length, 3);
  assert.ok(before.body.summary.unregisteredTools >= 3);
  const designAction = beforeJob.nextActions.find(action => action.type === 'resolve_design_documents');
  assert.ok(designAction);
  assert.equal(designAction.recordType, 'rfi');
  assert.equal(designAction.recordId, rfi.body.rfi.id);
  assert.equal(designAction.targetStatus, 'answered');
  assert.equal(designAction.requiresApproval, true);

  const prep = await request(baseUrl, '/api/ledger/schedule/prepare-dispatch', {
    method: 'POST',
    body: JSON.stringify({ jobId, actor: 'dispatch-readiness-test' })
  });
  assert.equal(prep.response.status, 201);
  assert.ok(prep.body.created.some(item => item.type === 'route_plan'));
  assert.ok(prep.body.created.some(item => item.type === 'loading_plan'));
  assert.ok(prep.body.created.some(item => item.type === 'procurement_order'));
  assert.ok(prep.body.created.some(item => item.type === 'worker_instruction'));

  const after = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=100');
  assert.equal(after.response.status, 200);
  const afterJob = after.body.jobs.find(job => job.jobId === jobId);
  assert.ok(afterJob);
  assert.equal(afterJob.counts.routePlans, 1);
  assert.equal(afterJob.counts.loadingPlans, 1);
  assert.equal(afterJob.counts.procurementOrders, 1);
  assert.equal(afterJob.counts.workerInstructions, 1);
  assert.ok(afterJob.counts.pendingApprovals >= beforeJob.counts.pendingApprovals);
  assert.ok(['approval_required', 'blocked', 'needs_plan', 'ready_with_warnings', 'ready'].includes(afterJob.readinessStatus));
  assert.ok(afterJob.nextActions.some(action => action.type === 'resolve_design_documents' && action.recordId === rfi.body.rfi.id));
  const procurementAction = afterJob.nextActions.find(action => action.type === 'review_procurement');
  assert.ok(procurementAction);
  assert.equal(procurementAction.recordType, 'procurement_order');
  assert.equal(procurementAction.recordStatus, 'draft');
  const accessAction = afterJob.nextActions.find(action => action.type === 'complete_site_orientation');
  assert.ok(accessAction);
  assert.equal(accessAction.recordType, 'orientation');
  assert.equal(accessAction.targetStatus, 'completed');
  const safetyAction = afterJob.nextActions.find(action => action.type === 'complete_safety_pack');
  assert.ok(safetyAction);
  assert.equal(safetyAction.recordType, 'jha');
  assert.equal(safetyAction.targetStatus, 'approved');

  const missingProcurementEvidence = await request(baseUrl, `/api/ledger/jobs/${jobId}/procurement-orders/${encodeURIComponent(procurementAction.recordId)}/request-approval`, {
    method: 'POST',
    body: JSON.stringify({ supplier: 'Bouwmaat', tradePartnerId: tradePartner.id, amount: 42, requiredBy: '2026-07-06T08:00:00.000Z' })
  });
  assert.equal(missingProcurementEvidence.response.status, 400);

  const procurementReview = await request(baseUrl, `/api/ledger/jobs/${jobId}/procurement-orders/${encodeURIComponent(procurementAction.recordId)}/request-approval`, {
    method: 'POST',
    body: JSON.stringify({
      supplier: 'Bouwmaat',
      tradePartnerId: tradePartner.id,
      amount: 42,
      requiredBy: '2026-07-06T08:00:00.000Z',
      notes: 'Twelve retained waste bags are priced and required before dispatch.'
    })
  });
  assert.equal(procurementReview.response.status, 200);
  assert.equal(procurementReview.body.procurementOrder.status, 'pending_approval');
  assert.equal(procurementReview.body.approvalRequired, true);

  const rejectedProcurement = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(procurementReview.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'rejected', reason: 'Supplier quote reference needs correction.' })
  });
  assert.equal(rejectedProcurement.response.status, 200);
  const procurementRestoredDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  const restoredProcurement = procurementRestoredDetail.body.job.procurementOrders.find(order => order.id === procurementAction.recordId);
  assert.equal(restoredProcurement.status, 'draft');
  assert.equal(restoredProcurement.approvalId, null);

  const procurementRetry = await request(baseUrl, `/api/ledger/jobs/${jobId}/procurement-orders/${encodeURIComponent(procurementAction.recordId)}/request-approval`, {
    method: 'POST',
    body: JSON.stringify({
      supplier: 'Bouwmaat',
      tradePartnerId: tradePartner.id,
      amount: 42,
      requiredBy: '2026-07-06T08:00:00.000Z',
      notes: 'Corrected supplier evidence and retained item values are ready for review.'
    })
  });
  assert.equal(procurementRetry.response.status, 200);
  const procurementApproved = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(procurementRetry.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', reason: 'Procurement evidence is complete.' })
  });
  assert.equal(procurementApproved.response.status, 200);

  const materialReviewQueue = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=100');
  const materialReviewJob = materialReviewQueue.body.jobs.find(job => job.jobId === jobId);
  const materialAction = materialReviewJob.nextActions.find(action => action.type === 'confirm_material_availability');
  assert.ok(materialAction);
  assert.equal(materialAction.recordType, 'material_requirement');
  const materialConfirmation = await request(baseUrl, `/api/ledger/jobs/${jobId}/materials/${encodeURIComponent(materialAction.recordId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'available',
      availableQuantity: 12,
      location: 'Dispatch shelf A-04',
      verificationReference: 'DISPATCH-MATERIAL-001',
      notes: 'Twelve sealed waste bags were counted and allocated to this job.'
    })
  });
  assert.equal(materialConfirmation.response.status, 200);
  const materialClearedQueue = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=100');
  const materialClearedJob = materialClearedQueue.body.jobs.find(job => job.jobId === jobId);
  assert.equal(materialClearedJob.readiness.procurement.status, 'ready');
  assert.equal(materialClearedJob.readiness.procurement.unresolvedRequirements, 0);
  assert.equal(materialClearedJob.blockers.some(blocker => blocker.type === 'procurement_gate'), false);

  const attemptedBypass = await request(baseUrl, `/api/ledger/jobs/${jobId}/lifecycle/rfi/${encodeURIComponent(rfi.body.rfi.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'answered',
      response: 'Use the retained boundary-protection detail from the approved work plan.',
      notes: 'Office review matched the response to the retained site record.',
      requiresApproval: false
    })
  });
  assert.equal(attemptedBypass.response.status, 200);
  assert.equal(attemptedBypass.body.approvalRequired, true);
  assert.equal(attemptedBypass.body.record.status, 'pending_approval');

  const rejectedReview = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(attemptedBypass.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'rejected', reason: 'The cited work-plan detail needs revision.' })
  });
  assert.equal(rejectedReview.response.status, 200);

  const restoredDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  const restoredRfi = restoredDetail.body.job.rfis.find(item => item.id === rfi.body.rfi.id);
  assert.equal(restoredRfi.status, 'open');
  assert.equal(restoredRfi.approvalId, null);

  const retryQueue = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=100');
  const retryJob = retryQueue.body.jobs.find(job => job.jobId === jobId);
  assert.ok(retryJob.nextActions.some(action => action.type === 'resolve_design_documents' && action.recordId === rfi.body.rfi.id));

  const retriedReview = await request(baseUrl, `/api/ledger/jobs/${jobId}/lifecycle/rfi/${encodeURIComponent(rfi.body.rfi.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'answered',
      response: 'Use revised boundary protection detail BP-02.',
      notes: 'Revised detail BP-02 and engineer response are retained for approval.'
    })
  });
  assert.equal(retriedReview.response.status, 200);
  const approvedReview = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(retriedReview.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', reason: 'Revised evidence is complete.' })
  });
  assert.equal(approvedReview.response.status, 200);

  const clearedQueue = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=100');
  const clearedJob = clearedQueue.body.jobs.find(job => job.jobId === jobId);
  assert.equal(clearedJob.readiness.design.openRecords, 0);
  assert.equal(clearedJob.nextActions.some(action => action.type === 'resolve_design_documents'), false);

  const approvalQueue = await request(baseUrl, '/api/ledger/dispatch?mode=approval&limit=100');
  assert.equal(approvalQueue.response.status, 200);
  assert.ok(approvalQueue.body.summary.pendingApprovals >= 1);
});

test('dispatch revalidates reserved equipment through maintenance and reinspection', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const inspectedAt = new Date().toISOString().slice(0, 10);
  const nextDueAt = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'Live equipment readiness client',
      title: `Live equipment readiness ${Date.now()}`,
      service: 'equipment readiness validation',
      description: 'Validate current equipment state immediately before dispatch.',
      status: 'scheduled',
      scheduledStart: new Date(Date.now() + 7 * 86_400_000).toISOString()
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const createdTool = await request(baseUrl, '/api/ledger/tools', {
    method: 'POST',
    body: JSON.stringify({
      name: `Reserved dispatch lift ${Date.now()}`,
      category: 'access',
      status: 'available',
      currentLocation: 'Dispatch depot',
      data: { inspectionRequired: true, inspectionDueAt: nextDueAt }
    })
  });
  assert.equal(createdTool.response.status, 201);
  const tool = createdTool.body.tool;
  const reservation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/tools`, {
    method: 'POST',
    body: JSON.stringify({ toolId: tool.id, status: 'reserved' })
  });
  assert.equal(reservation.response.status, 201);

  const initiallyReady = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=500');
  const initiallyReadyJob = initiallyReady.body.jobs.find(job => job.jobId === jobId);
  assert.equal(initiallyReadyJob.readiness.tools.status, 'ready');
  assert.equal(initiallyReadyJob.counts.toolReadinessBlockers, 0);

  const failedInspection = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}/inspections`, {
    method: 'POST',
    body: JSON.stringify({
      result: 'failed',
      inspector: 'Dispatch readiness inspector',
      inspectedAt,
      reference: 'DISPATCH-DEFECT-001',
      notes: 'Hydraulic guard defect requires corrective maintenance.'
    })
  });
  assert.equal(failedInspection.response.status, 201);

  const failedQueue = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=500');
  const failedJob = failedQueue.body.jobs.find(job => job.jobId === jobId);
  const failedBlocker = failedJob.blockers.find(blocker => blocker.type === 'tool_inspection_readiness');
  assert.equal(failedJob.readinessStatus, 'blocked');
  assert.equal(failedJob.readiness.tools.status, 'blocked');
  assert.equal(failedJob.counts.toolReadinessBlockers, 1);
  assert.equal(failedBlocker.toolId, tool.id);
  assert.equal(failedBlocker.inspectionStatus, 'failed');
  assert.ok(failedQueue.body.summary.inspectionToolBlockers >= 1);

  const maintenance = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}/maintenance`, {
    method: 'POST',
    body: JSON.stringify({
      outcome: 'completed',
      maintenanceType: 'corrective',
      performedBy: 'Dispatch depot technician',
      performedAt: inspectedAt,
      reference: 'DISPATCH-WORK-001',
      notes: 'Hydraulic guard was replaced and the retained function check completed.'
    })
  });
  assert.equal(maintenance.response.status, 201);
  assert.equal(maintenance.body.reinspectionRequired, true);

  const reinspectionQueue = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=500');
  const reinspectionJob = reinspectionQueue.body.jobs.find(job => job.jobId === jobId);
  assert.equal(reinspectionJob.readinessStatus, 'blocked');
  assert.equal(reinspectionJob.blockers.find(blocker => blocker.type === 'tool_inspection_readiness').inspectionStatus, 'reinspection_required');

  const passedReinspection = await request(baseUrl, `/api/ledger/tools/${encodeURIComponent(tool.id)}/inspections`, {
    method: 'POST',
    body: JSON.stringify({
      result: 'passed',
      inspector: 'Dispatch readiness inspector',
      inspectedAt,
      nextDueAt,
      reference: 'DISPATCH-RECHECK-001',
      notes: 'Post-maintenance internal operational reinspection passed.'
    })
  });
  assert.equal(passedReinspection.response.status, 201);

  const clearedQueue = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=500');
  const clearedJob = clearedQueue.body.jobs.find(job => job.jobId === jobId);
  assert.equal(clearedJob.readiness.tools.status, 'ready');
  assert.equal(clearedJob.counts.toolReadinessBlockers, 0);
  assert.equal(clearedJob.blockers.some(blocker => ['tool_record_missing', 'tool_retirement_pending', 'tool_inspection_readiness', 'tool_unavailable'].includes(blocker.type)), false);
});

test('dispatch revalidates assigned crew against current worker availability and retirement state', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const scheduledStart = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const scheduledEnd = new Date(Date.now() + 7 * 86_400_000 + 6 * 3_600_000).toISOString();
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'Live workforce readiness client',
      title: `Live workforce readiness ${Date.now()}`,
      service: 'crew readiness validation',
      description: 'Validate current crew state immediately before dispatch.',
      status: 'scheduled',
      scheduledStart,
      scheduledEnd,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const createdWorker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({
      name: `Reserved dispatch crew ${Date.now()}`,
      role: 'Site carpenter',
      status: 'available',
      homeRegion: 'Amsterdam',
      skills: ['carpentry']
    })
  });
  assert.equal(createdWorker.response.status, 201);
  const worker = createdWorker.body.worker;
  const assignment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: worker.id, status: 'planned', scheduledStart, scheduledEnd })
  });
  assert.equal(assignment.response.status, 201);

  const initiallyReady = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=500');
  const initiallyReadyJob = initiallyReady.body.jobs.find(job => job.jobId === jobId);
  assert.equal(initiallyReadyJob.readiness.workforce.status, 'ready');
  assert.equal(initiallyReadyJob.counts.workerReadinessBlockers, 0);

  const leave = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(worker.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'on_leave' })
  });
  assert.equal(leave.response.status, 200);

  const leaveQueue = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=500');
  const leaveJob = leaveQueue.body.jobs.find(job => job.jobId === jobId);
  const unavailableBlocker = leaveJob.blockers.find(blocker => blocker.type === 'worker_unavailable');
  assert.equal(leaveJob.readinessStatus, 'blocked');
  assert.equal(leaveJob.readiness.workforce.status, 'blocked');
  assert.equal(leaveJob.counts.workerReadinessBlockers, 1);
  assert.equal(unavailableBlocker.workerId, worker.id);
  assert.equal(unavailableBlocker.workerStatus, 'on_leave');
  assert.ok(leaveJob.nextActions.some(action => action.type === 'review_workforce_readiness' && action.workerId === worker.id));
  assert.ok(leaveQueue.body.summary.unavailableWorkers >= 1);

  const workforceQueue = await request(baseUrl, '/api/ledger/workforce?mode=conflict&limit=500');
  const workforceJob = workforceQueue.body.jobs.find(job => job.jobId === jobId);
  assert.equal(workforceJob.flags.offlineAssigned, true);
  assert.equal(workforceJob.workers.find(item => item.id === worker.id).workerStatus, 'on_leave');

  const available = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(worker.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'available' })
  });
  assert.equal(available.response.status, 200);

  const retirement = await request(baseUrl, `/api/ledger/workers/${encodeURIComponent(worker.id)}/retirement`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Validate the pending retirement dispatch gate.' })
  });
  assert.equal(retirement.response.status, 200);
  const retirementQueue = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=500');
  const retirementJob = retirementQueue.body.jobs.find(job => job.jobId === jobId);
  const retirementBlocker = retirementJob.blockers.find(blocker => blocker.type === 'worker_retirement_pending');
  assert.equal(retirementJob.readinessStatus, 'blocked');
  assert.equal(retirementBlocker.workerId, worker.id);
  assert.equal(retirementBlocker.approvalId, retirement.body.approval.id);
  assert.ok(retirementQueue.body.summary.retirementPendingWorkers >= 1);

  const rejectedRetirement = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(retirement.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'rejected', reason: 'Crew member remains available for this retained assignment.' })
  });
  assert.equal(rejectedRetirement.response.status, 200);
  const clearedQueue = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=500');
  const clearedJob = clearedQueue.body.jobs.find(job => job.jobId === jobId);
  assert.equal(clearedJob.readiness.workforce.status, 'ready');
  assert.equal(clearedJob.counts.workerReadinessBlockers, 0);
  assert.equal(clearedJob.blockers.some(blocker => ['worker_record_missing', 'worker_retirement_pending', 'worker_unavailable', 'worker_conflict'].includes(blocker.type)), false);
});

test('replacement crew cannot inherit released worker instructions, orientation, or site access', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const scheduledStart = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const scheduledEnd = new Date(Date.now() + 10 * 86_400_000 + 5 * 3_600_000).toISOString();
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'Crew replacement integrity client',
      title: `Crew replacement integrity ${Date.now()}`,
      service: 'assignment-scoped dispatch validation',
      description: 'Prove released crew evidence cannot clear a replacement worker.',
      status: 'scheduled',
      scheduledStart,
      scheduledEnd,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const createWorker = async name => {
    const result = await request(baseUrl, '/api/ledger/workers', {
      method: 'POST',
      body: JSON.stringify({ name, role: 'Site installer', status: 'available', skills: ['installation'] })
    });
    assert.equal(result.response.status, 201);
    return result.body.worker;
  };
  const workerA = await createWorker(`Crew evidence A ${Date.now()}`);
  const workerB = await createWorker(`Crew evidence B ${Date.now()}`);
  const assignmentA = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: workerA.id, status: 'planned', scheduledStart, scheduledEnd })
  });
  assert.equal(assignmentA.response.status, 201);

  const preparedA = await request(baseUrl, '/api/ledger/schedule/prepare-dispatch', {
    method: 'POST',
    body: JSON.stringify({ jobId, actor: 'crew-evidence-test' })
  });
  assert.equal(preparedA.response.status, 201);
  const instructionA = preparedA.body.job.workerInstructions.find(record => record.assignmentId === assignmentA.body.assignment.id);
  const orientationA = preparedA.body.job.orientations.find(record => record.assignmentId === assignmentA.body.assignment.id);
  const accessA = preparedA.body.job.siteAccessLogs.find(record => record.assignmentId === assignmentA.body.assignment.id);
  assert.ok(instructionA);
  assert.ok(orientationA);
  assert.ok(accessA);
  assert.equal(instructionA.workerId, workerA.id);
  assert.equal(orientationA.workerId, workerA.id);
  assert.equal(accessA.workerId, workerA.id);

  const approveTransition = async (recordType, recordId, payload) => {
    const transition = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/${recordType}/${encodeURIComponent(recordId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    assert.equal(transition.response.status, 200);
    assert.equal(transition.body.record.status, 'pending_approval');
    const resolution = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(transition.body.approval.id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ status: 'approved', resolvedBy: 'Crew evidence approver' })
    });
    assert.equal(resolution.response.status, 200);
    return transition;
  };
  const instructionTransition = await approveTransition('worker_instruction', instructionA.id, {
    status: 'published',
    notes: 'Crew A scope, route, tools, PPE, and stop-work controls were reviewed for approval.',
    reviewedBy: 'submitted:spoofed-instruction-reviewer'
  });
  assert.notEqual(instructionTransition.body.record.data.reviewedBy, 'submitted:spoofed-instruction-reviewer');
  await approveTransition('orientation', orientationA.id, {
    status: 'completed',
    verificationReference: 'CREW-A-ORIENTATION-001',
    notes: 'Crew A identity, site rules, PPE, emergency controls, and access boundaries were verified.'
  });
  await approveTransition('site_access', accessA.id, {
    status: 'cleared',
    notes: 'Crew A identity, approved orientation, access point, and assignment were verified.'
  });

  const clearedA = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=500');
  const clearedAJob = clearedA.body.jobs.find(job => job.jobId === jobId);
  assert.equal(clearedAJob.readiness.instructions.status, 'ready');
  assert.equal(clearedAJob.readiness.siteAccess.status, 'ready');

  const releasedA = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments/${encodeURIComponent(assignmentA.body.assignment.id)}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Replace retained crew before dispatch.' })
  });
  assert.equal(releasedA.response.status, 200);
  assert.deepEqual(releasedA.body.assignment.invalidatedCrewEvidence, {
    instructions: 1,
    orientations: 1,
    siteAccess: 1,
    approvalTargets: 3
  });

  const assignmentB = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: workerB.id, status: 'planned', scheduledStart, scheduledEnd })
  });
  assert.equal(assignmentB.response.status, 201);

  const replacementQueue = await request(baseUrl, '/api/ledger/dispatch?mode=all&limit=500');
  const replacementJob = replacementQueue.body.jobs.find(job => job.jobId === jobId);
  assert.ok(replacementJob.missing.includes('worker_instruction'));
  assert.ok(replacementJob.missing.includes('site_access'));
  assert.equal(replacementJob.readiness.instructions.status, 'missing');
  assert.equal(replacementJob.readiness.instructions.staleRecords, 1);
  assert.equal(replacementJob.readiness.siteAccess.staleRecords, 1);
  assert.equal(replacementJob.readiness.crewEvidence.staleRecords.orientations, 1);
  assert.equal(replacementJob.nextActions.some(action => action.recordId === instructionA.id || action.recordId === orientationA.id || action.recordId === accessA.id), false);

  const mismatchedAccess = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/site-access`, {
    method: 'POST',
    body: JSON.stringify({
      assignmentId: assignmentB.body.assignment.id,
      workerId: workerB.id,
      orientationId: orientationA.id,
      workerName: workerB.name,
      status: 'blocked'
    })
  });
  assert.equal(mismatchedAccess.response.status, 409);

  const preparedB = await request(baseUrl, '/api/ledger/schedule/prepare-dispatch', {
    method: 'POST',
    body: JSON.stringify({ jobId, actor: 'crew-evidence-test' })
  });
  assert.equal(preparedB.response.status, 201);
  assert.ok(preparedB.body.created.some(record => record.type === 'worker_instruction'));
  assert.ok(preparedB.body.created.some(record => record.type === 'worker_orientation'));
  assert.ok(preparedB.body.created.some(record => record.type === 'site_access_log'));
  const instructionB = preparedB.body.job.workerInstructions.find(record => record.assignmentId === assignmentB.body.assignment.id);
  const orientationB = preparedB.body.job.orientations.find(record => record.assignmentId === assignmentB.body.assignment.id);
  const accessB = preparedB.body.job.siteAccessLogs.find(record => record.assignmentId === assignmentB.body.assignment.id);
  assert.equal(instructionB.workerId, workerB.id);
  assert.equal(orientationB.workerId, workerB.id);
  assert.equal(accessB.workerId, workerB.id);
  assert.equal(accessB.orientationId, orientationB.id);

  const workforce = await request(baseUrl, '/api/ledger/workforce?mode=all&limit=500');
  const workforceJob = workforce.body.jobs.find(job => job.jobId === jobId);
  assert.equal(workforceJob.latest.assignment.id, assignmentB.body.assignment.id);
  assert.equal(workforceJob.latest.instruction.id, instructionB.id);
  assert.equal(workforceJob.latest.orientation.id, orientationB.id);
  assert.equal(workforceJob.latest.siteAccess.id, accessB.id);
  assert.equal(workforceJob.counts.staleCrewEvidence, 3);
  assert.ok(workforceJob.nextActions.some(action => action.type === 'publish_worker_instruction' && action.recordId === instructionB.id));
  assert.ok(workforceJob.nextActions.some(action => action.type === 'complete_worker_orientation' && action.orientationId === orientationB.id));
});
