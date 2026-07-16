const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-inventory-'));
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

async function createJob(baseUrl, payload) {
  const result = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: payload.clientName || 'Inventory QA Client',
      clientEmail: payload.clientEmail || 'inventory@example.test',
      clientPhone: payload.clientPhone || '+31 6 66666666',
      address: payload.address || 'Amstel 1, Amsterdam',
      city: payload.city || 'Amsterdam',
      service: payload.service || 'renovation',
      title: payload.title,
      description: payload.description || payload.title,
      priority: payload.priority || 'medium',
      estimatedCost: payload.estimatedCost || 1600,
      contractValue: payload.contractValue || payload.estimatedCost || 1600,
      estimatedHours: payload.estimatedHours || 6,
      assignAutomatically: false,
      ...payload
    })
  });
  assert.equal(result.response.status, 201);
  return result.body.job.id;
}

async function createVerifiedTradePartner(baseUrl, name) {
  const result = await request(baseUrl, '/api/ledger/trade-partners', {
    method: 'POST',
    body: JSON.stringify({
      name,
      partnerType: 'supplier',
      registrationNumber: '87654321',
      vatNumber: 'NL123456789B01',
      verificationReference: 'Inventory QA registry check',
      verifiedAt: new Date(Date.now() - 86_400_000).toISOString()
    })
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.partner.compliance.status, 'verified');
  return result.body.partner;
}

test('inventory readiness coordinates materials, procurement, loading and tool conflicts', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const start = new Date(Date.now() + 48 * 60 * 60 * 1000);
  start.setUTCHours(8, 0, 0, 0);
  const end = new Date(start.getTime() + 5 * 60 * 60 * 1000);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const tradePartner = await createVerifiedTradePartner(baseUrl, 'Bouwmaat');

  const materialJobId = await createJob(baseUrl, {
    title: 'Inventory QA material job',
    status: 'scheduled',
    scheduledStart: startIso,
    scheduledEnd: endIso,
    priority: 'high'
  });

  const material = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(materialJobId)}/materials`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Inventory QA adhesive',
      quantity: 8,
      unit: 'tubes',
      status: 'needed',
      supplier: 'Bouwmaat',
      cost: 12.5,
      neededBy: yesterday
    })
  });
  assert.equal(material.response.status, 201);
  assert.equal(material.body.materialRequirement.name, 'Inventory QA adhesive');
  assert.ok(material.body.dashboard.metrics);

  const procurementQueue = await request(baseUrl, '/api/ledger/inventory?mode=procurement&limit=100');
  assert.equal(procurementQueue.response.status, 200);
  const procurementJob = procurementQueue.body.jobs.find(job => job.jobId === materialJobId);
  assert.ok(procurementJob);
  assert.equal(procurementJob.flags.procurementNeeded, true);
  assert.equal(procurementJob.flags.materialNeeded, true);
  assert.equal(procurementJob.counts.dueMaterials, 1);
  assert.ok(procurementJob.nextActions.some(action => action.type === 'create_procurement_order'));
  assert.ok(procurementQueue.body.summary.procurementNeeded >= 1);

  const loadingQueue = await request(baseUrl, '/api/ledger/inventory?mode=loading&limit=100');
  assert.equal(loadingQueue.response.status, 200);
  const loadingGap = loadingQueue.body.jobs.find(job => job.jobId === materialJobId);
  assert.ok(loadingGap);
  assert.equal(loadingGap.flags.loadingMissing, true);
  assert.ok(loadingGap.nextActions.some(action => action.type === 'prepare_loading_plan'));

  const procurement = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(materialJobId)}/procurement-orders`, {
    method: 'POST',
    body: JSON.stringify({
      supplier: 'Bouwmaat',
      tradePartnerId: tradePartner.id,
      status: 'ready_to_order',
      amount: 300,
      items: [{ name: 'Inventory QA adhesive', quantity: 8, unitCost: 12.5 }],
      requiredBy: startIso
    })
  });
  assert.equal(procurement.response.status, 201);
  assert.equal(procurement.body.procurementOrder.status, 'pending_approval');
  assert.ok(procurement.body.procurementOrder.approvalId);

  const approvalQueue = await request(baseUrl, '/api/ledger/inventory?mode=approval&limit=100');
  assert.equal(approvalQueue.response.status, 200);
  const approvalJob = approvalQueue.body.jobs.find(job => job.jobId === materialJobId);
  assert.ok(approvalJob);
  assert.equal(approvalJob.flags.approvalRequired, true);
  const reviewApprovalAction = approvalJob.nextActions.find(action => action.type === 'review_inventory_approval');
  assert.ok(reviewApprovalAction);
  assert.equal(reviewApprovalAction.approvalId, procurement.body.procurementOrder.approvalId);

  const approvedProcurement = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(procurement.body.procurementOrder.approvalId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Inventory QA approver' })
  });
  assert.equal(approvedProcurement.response.status, 200);

  const materialQueue = await request(baseUrl, '/api/ledger/inventory?mode=material&limit=100');
  assert.equal(materialQueue.response.status, 200);
  const materialReviewJob = materialQueue.body.jobs.find(job => job.jobId === materialJobId);
  assert.ok(materialReviewJob);
  const materialStatusAction = materialReviewJob.nextActions.find(action => action.type === 'review_material_status');
  assert.ok(materialStatusAction);
  assert.equal(materialStatusAction.materialRequirementId, material.body.materialRequirement.id);

  const blockedOrderStatus = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(materialJobId)}/materials/${encodeURIComponent(materialStatusAction.materialRequirementId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'ordered', notes: 'Attempted supplier commitment through an internal status route.' })
  });
  assert.equal(blockedOrderStatus.response.status, 400);
  assert.match(blockedOrderStatus.body.error.message, /unsupported internal material status/i);

  const missingMaterialEvidence = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(materialJobId)}/materials/${encodeURIComponent(materialStatusAction.materialRequirementId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'available', availableQuantity: 8, notes: 'No retained verification reference.' })
  });
  assert.equal(missingMaterialEvidence.response.status, 400);
  assert.match(missingMaterialEvidence.body.error.message, /verification reference/i);

  const materialStatus = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(materialJobId)}/materials/${encodeURIComponent(materialStatusAction.materialRequirementId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'available',
      availableQuantity: 8,
      location: 'Warehouse A-12',
      verificationReference: 'COUNT-QA-001',
      notes: 'Eight sealed tubes were counted and reserved for the job.'
    })
  });
  assert.equal(materialStatus.response.status, 200);
  assert.equal(materialStatus.body.materialRequirement.status, 'available');
  assert.equal(materialStatus.body.materialRequirement.data.availableQuantity, 8);
  assert.equal(materialStatus.body.materialRequirement.data.location, 'Warehouse A-12');
  assert.equal(materialStatus.body.materialRequirement.data.lastStatusTransition.externalCommitments, 0);
  assert.equal(materialStatus.body.externalCommitments, 0);

  const clearedMaterialQueue = await request(baseUrl, '/api/ledger/inventory?mode=material&limit=100');
  assert.equal(clearedMaterialQueue.response.status, 200);
  assert.equal(clearedMaterialQueue.body.jobs.some(job => job.jobId === materialJobId), false);

  const materialJobTool = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(materialJobId)}/tools`, {
    method: 'POST',
    body: JSON.stringify({
      toolName: 'Inventory QA extension ladder',
      status: 'reserved',
      neededFrom: startIso,
      neededUntil: endIso
    })
  });
  assert.equal(materialJobTool.response.status, 201);
  assert.equal(materialJobTool.body.toolReservation.status, 'reserved');

  const loadPlan = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(materialJobId)}/loading-plans`, {
    method: 'POST',
    body: JSON.stringify({
      vehicle: 'Work van',
      status: 'draft'
    })
  });
  assert.equal(loadPlan.response.status, 201);
  assert.equal(loadPlan.body.loadingPlan.trailerRequired, true);
  assert.ok(loadPlan.body.loadingPlan.loadItems.some(item => item.type === 'material' && item.name === 'Inventory QA adhesive'));
  assert.ok(loadPlan.body.loadingPlan.loadItems.some(item => item.type === 'tool' && item.name === 'Inventory QA extension ladder'));
  assert.ok(loadPlan.body.loadingPlan.checklist.some(item => item.includes('Confirm material: 8 tubes Inventory QA adhesive')));
  assert.ok(loadPlan.body.loadingPlan.checklist.some(item => item.includes('Load reserved tool: Inventory QA extension ladder')));
  assert.ok(loadPlan.body.loadingPlan.checklist.some(item => item.includes('Check trailer lights')));
  assert.equal(loadPlan.body.loadingPlan.data.readiness.itemCounts.materials, 1);
  assert.equal(loadPlan.body.loadingPlan.data.readiness.itemCounts.tools, 1);
  assert.equal(loadPlan.body.loadingPlan.data.readiness.externalCommitments, 0);
  assert.equal(loadPlan.body.loadingPlan.data.readiness.approvalSafe, true);

  const enrichedInventory = await request(baseUrl, '/api/ledger/inventory?mode=all&limit=100');
  assert.equal(enrichedInventory.response.status, 200);
  const enrichedJob = enrichedInventory.body.jobs.find(job => job.jobId === materialJobId);
  assert.ok(enrichedJob);
  assert.equal(enrichedJob.loadingReadiness.itemCounts.materials, 1);
  assert.equal(enrichedJob.loadingReadiness.itemCounts.tools, 1);
  assert.equal(enrichedJob.loadingReadiness.trailerRequired, true);
  assert.equal(enrichedJob.loadingReadiness.externalCommitments, 0);
  assert.equal(enrichedJob.counts.loadingItems, 2);
  assert.ok(enrichedInventory.body.summary.loadingItems >= 2);
  assert.ok(enrichedInventory.body.summary.trailerLoads >= 1);

  const clearedLoadingQueue = await request(baseUrl, '/api/ledger/inventory?mode=loading&limit=100');
  assert.equal(clearedLoadingQueue.response.status, 200);
  assert.equal(clearedLoadingQueue.body.jobs.some(job => job.jobId === materialJobId), false);

  const tool = await request(baseUrl, '/api/ledger/tools', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Inventory QA Paint Sprayer',
      category: 'equipment',
      status: 'available',
      currentLocation: 'Warehouse'
    })
  });
  assert.equal(tool.response.status, 201);
  const toolId = tool.body.tool.id;

  const firstToolJobId = await createJob(baseUrl, {
    title: 'Inventory QA first tool job',
    status: 'scheduled',
    scheduledStart: startIso,
    scheduledEnd: endIso
  });
  const firstReservation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(firstToolJobId)}/tools`, {
    method: 'POST',
    body: JSON.stringify({
      toolId,
      status: 'reserved',
      neededFrom: startIso,
      neededUntil: endIso
    })
  });
  assert.equal(firstReservation.response.status, 201);
  assert.equal(firstReservation.body.toolReservation.status, 'reserved');

  const conflictToolJobId = await createJob(baseUrl, {
    title: 'Inventory QA conflicting tool job',
    status: 'scheduled',
    scheduledStart: startIso,
    scheduledEnd: endIso,
    priority: 'critical'
  });
  const conflictReservation = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(conflictToolJobId)}/tools`, {
    method: 'POST',
    body: JSON.stringify({
      toolId,
      status: 'reserved',
      neededFrom: startIso,
      neededUntil: endIso
    })
  });
  assert.equal(conflictReservation.response.status, 201);
  assert.equal(conflictReservation.body.toolReservation.status, 'pending_approval');

  const conflictQueue = await request(baseUrl, '/api/ledger/inventory?mode=conflict&limit=100');
  assert.equal(conflictQueue.response.status, 200);
  const conflictJob = conflictQueue.body.jobs.find(job => job.jobId === conflictToolJobId);
  assert.ok(conflictJob);
  assert.equal(conflictJob.flags.toolConflict, true);
  assert.equal(conflictJob.flags.approvalRequired, true);
  assert.ok(conflictJob.nextActions.some(action => action.type === 'resolve_tool_conflict'));
  assert.ok(conflictQueue.body.summary.toolConflicts >= 1);
});
