const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-job-subresources-'));
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

test('top-level job subresource routes persist operational records in the ledger', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const legacyJob = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Legacy API hedge trimming',
      client: 'Legacy Subresource Client',
      phone: '+31 6 44444444',
      address: 'Prinsengracht 12, Amsterdam',
      description: 'Trim hedge, remove green waste, and clean garden path.',
      priority: 'high',
      estimatedCost: 480,
      estimatedHours: 6,
      weatherSensitive: true
    })
  });
  assert.equal(legacyJob.response.status, 201);
  assert.ok(legacyJob.body.ledgerJobId);

  const worker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Legacy Route Crew',
      role: 'Gardener',
      status: 'available',
      homeRegion: 'Amsterdam',
      skills: ['garden maintenance', 'green waste']
    })
  });
  assert.equal(worker.response.status, 201);

  const task = await request(baseUrl, `/api/jobs/${legacyJob.body.id}/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Confirm green-waste bags and trailer',
      priority: 'high',
      status: 'open'
    })
  });
  assert.equal(task.response.status, 201);
  assert.equal(task.body.task.title, 'Confirm green-waste bags and trailer');
  assert.equal(task.body.ledgerJob.id, legacyJob.body.ledgerJobId);

  const quote = await request(baseUrl, `/api/jobs/${legacyJob.body.id}/quote`, {
    method: 'POST',
    body: JSON.stringify({
      subtotal: 480,
      taxRate: 21,
      status: 'draft',
      notes: 'Legacy route quote draft should require approval before sending.'
    })
  });
  assert.equal(quote.response.status, 201);
  assert.equal(quote.body.quote.status, 'draft');
  assert.ok(quote.body.quote.approvalId);

  const assignment = await request(baseUrl, `/api/jobs/${legacyJob.body.id}/assignments`, {
    method: 'POST',
    body: JSON.stringify({
      workerName: 'Legacy Route Crew',
      role: 'Gardener',
      status: 'planned',
      allocationHours: 6
    })
  });
  assert.equal(assignment.response.status, 201);
  assert.equal(assignment.body.assignment.workerName, 'Legacy Route Crew');

  const tool = await request(baseUrl, `/api/jobs/${legacyJob.body.id}/tools`, {
    method: 'POST',
    body: JSON.stringify({
      toolName: 'Trailer',
      status: 'reserved'
    })
  });
  assert.equal(tool.response.status, 201);
  assert.equal(tool.body.toolReservation.toolName, 'Trailer');

  const material = await request(baseUrl, `/api/jobs/${legacyJob.body.id}/materials`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Green-waste bags',
      quantity: 12,
      unit: 'bags',
      status: 'needed'
    })
  });
  assert.equal(material.response.status, 201);
  assert.equal(material.body.materialRequirement.name, 'Green-waste bags');

  const progress = await request(baseUrl, `/api/jobs/${legacyJob.body.id}/progress`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'field_update',
      progressPercent: 35,
      note: 'Crew confirmed access and staged tools.'
    })
  });
  assert.equal(progress.response.status, 201);
  assert.equal(progress.body.progress.progressPercent, 35);

  const communication = await request(baseUrl, `/api/jobs/${legacyJob.body.id}/communication`, {
    method: 'POST',
    body: JSON.stringify({
      channel: 'client_portal',
      direction: 'outbound',
      status: 'draft',
      subject: 'Garden work preparation',
      body: 'We have prepared the tool and waste plan for review.'
    })
  });
  assert.equal(communication.response.status, 201);
  assert.equal(communication.body.communication.status, 'draft');
  assert.ok(communication.body.communication.approvalId);

  const timeLog = await request(baseUrl, `/api/jobs/${legacyJob.body.id}/time-logs`, {
    method: 'POST',
    body: JSON.stringify({
      workerName: 'Legacy Route Crew',
      hours: 2.5,
      billable: true,
      notes: 'Site preparation'
    })
  });
  assert.equal(timeLog.response.status, 201);
  assert.equal(timeLog.body.timeLog.hours, 2.5);

  const expense = await request(baseUrl, `/api/jobs/${legacyJob.body.id}/expenses`, {
    method: 'POST',
    body: JSON.stringify({
      vendor: 'Garden Depot',
      amount: 42,
      category: 'materials',
      notes: 'Waste bags'
    })
  });
  assert.equal(expense.response.status, 201);
  assert.equal(expense.body.expense.amount, 42);

  const photo = await request(baseUrl, `/api/jobs/${legacyJob.body.id}/photos`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Before hedge photo',
      filename: 'before-hedge.jpg',
      mimeType: 'image/jpeg',
      status: 'stored'
    })
  });
  assert.equal(photo.response.status, 201);
  assert.equal(photo.body.photo.type, 'photo');
  assert.equal(photo.body.photo.title, 'Before hedge photo');
  assert.ok(photo.body.photo.data.tags.includes('jobsite'));

  const invoice = await request(baseUrl, `/api/jobs/${legacyJob.body.id}/invoice`, {
    method: 'POST',
    body: JSON.stringify({
      amount: 480,
      total: 480,
      status: 'draft',
      notes: 'Invoice draft from top-level compatibility route.'
    })
  });
  assert.equal(invoice.response.status, 201);
  assert.equal(invoice.body.invoice.status, 'draft');
  assert.ok(invoice.body.invoice.approvalId);

  const detail = await request(baseUrl, `/api/ledger/jobs/${legacyJob.body.ledgerJobId}`);
  assert.equal(detail.response.status, 200);
  assert.ok(detail.body.job.tasks.some(item => item.id === task.body.task.id));
  assert.ok(detail.body.job.quotes.some(item => item.id === quote.body.quote.id));
  assert.ok(detail.body.job.assignments.some(item => item.id === assignment.body.assignment.id));
  assert.ok(detail.body.job.tools.some(item => item.id === tool.body.toolReservation.id));
  assert.ok(detail.body.job.materials.some(item => item.id === material.body.materialRequirement.id));
  assert.ok(detail.body.job.progress.some(item => item.id === progress.body.progress.id));
  assert.ok(detail.body.job.communications.some(item => item.id === communication.body.communication.id));
  assert.ok(detail.body.job.timeLogs.some(item => item.id === timeLog.body.timeLog.id));
  assert.ok(detail.body.job.expenses.some(item => item.id === expense.body.expense.id));
  assert.ok(detail.body.job.documents.some(item => item.id === photo.body.photo.id));
  assert.ok(detail.body.job.invoices.some(item => item.id === invoice.body.invoice.id));
  assert.ok(detail.body.job.audit.some(event => event.action === 'create_task'));

  const ledgerOnly = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Ledger-only top-level compatibility job',
      client: { name: 'Ledger Alias Client', address: 'Utrecht' },
      service: 'painting',
      description: 'Created directly in the ledger.',
      priority: 'medium',
      assignAutomatically: false
    })
  });
  assert.equal(ledgerOnly.response.status, 201);

  const ledgerProgress = await request(baseUrl, `/api/jobs/${ledgerOnly.body.job.id}/progress`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'field_update',
      progressPercent: 10,
      note: 'Top-level route also works with ledger IDs.'
    })
  });
  assert.equal(ledgerProgress.response.status, 201);
  assert.equal(ledgerProgress.body.ledgerJob.id, ledgerOnly.body.job.id);
  assert.equal(ledgerProgress.body.progress.progressPercent, 10);
});

test('top-level job aliases expose advanced field safety finance and closeout records', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const created = await request(baseUrl, '/api/jobs', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Advanced alias renovation',
      client: 'Advanced Alias Client',
      address: 'Witte de Withstraat 20, Rotterdam',
      description: 'Bathroom renovation with client selections, permits, field reporting, safety controls and finance handoff.',
      priority: 'high',
      estimatedCost: 12000,
      estimatedHours: 80,
      weatherSensitive: false
    })
  });
  assert.equal(created.response.status, 201);
  const jobId = created.body.id;
  const ledgerJobId = created.body.ledgerJobId;

  const advancedCalls = [
    {
      route: 'site-visits',
      key: 'siteVisit',
      detailCollection: 'siteVisits',
      payload: { status: 'draft', purpose: 'measure', checklist: ['measure wet room', 'photo access'] }
    },
    {
      route: 'change-orders',
      key: 'changeOrder',
      detailCollection: 'changeOrders',
      payload: { title: 'Extra waterproofing', scopeDelta: 'Add waterproof membrane behind shower wall', amount: 850, status: 'draft' }
    },
    {
      route: 'field-reports',
      key: 'fieldReport',
      detailCollection: 'fieldReports',
      payload: { title: 'Daily site diary', status: 'draft', manpower: 3, notes: 'Demolition complete and waste removed.' }
    },
    {
      route: 'rfis',
      key: 'rfi',
      detailCollection: 'rfis',
      payload: { title: 'Clarify tile layout', question: 'Should niche align with full tile grid?', responsible: 'Robert', status: 'open' }
    },
    {
      route: 'submittals',
      key: 'submittal',
      detailCollection: 'submittals',
      payload: { title: 'Waterproofing product sheet', packageName: 'Wet room system', responsible: 'Supplier', status: 'draft' }
    },
    {
      route: 'client-selections',
      key: 'clientSelection',
      detailCollection: 'clientSelections',
      payload: { title: 'Tile selection', category: 'finish', options: ['matte white', 'stone grey'], status: 'pending_client' }
    },
    {
      route: 'permits',
      key: 'permit',
      detailCollection: 'permits',
      payload: { title: 'Apartment work notification', permitType: 'building_notification', status: 'draft' }
    },
    {
      route: 'inspections',
      key: 'inspection',
      detailCollection: 'inspections',
      payload: { title: 'Pre-close waterproofing inspection', inspectionType: 'quality', status: 'scheduled', checklist: ['membrane', 'corners'] }
    },
    {
      route: 'observations',
      key: 'observation',
      detailCollection: 'observations',
      payload: { title: 'Existing moisture stain', severity: 'medium', status: 'open', notes: 'Review before closing wall.' }
    },
    {
      route: 'incidents',
      key: 'incident',
      detailCollection: 'incidents',
      payload: { title: 'Minor access issue', severity: 'low', status: 'open', description: 'Elevator blocked during waste removal.' }
    },
    {
      route: 'safety-meetings',
      key: 'safetyMeeting',
      detailCollection: 'safetyMeetings',
      payload: { title: 'Bathroom demolition toolbox talk', status: 'scheduled', topics: ['dust', 'manual handling', 'neighbor access'] }
    },
    {
      route: 'orientations',
      key: 'orientation',
      detailCollection: 'orientations',
      payload: { workerName: 'Renovation crew', status: 'scheduled', topics: ['apartment rules', 'waste route'] }
    },
    {
      route: 'jhas',
      key: 'jha',
      detailCollection: 'jhas',
      payload: { title: 'Wet room JHA', riskLevel: 'medium', status: 'draft', hazards: ['dust', 'water shutoff'], controls: ['PPE', 'client signoff'] }
    },
    {
      route: 'sds-sheets',
      key: 'sdsSheet',
      detailCollection: 'sdsSheets',
      payload: { material: 'Waterproofing primer', supplier: 'Tile Supplier NL', status: 'requested' }
    },
    {
      route: 'site-access',
      key: 'siteAccessLog',
      detailCollection: 'siteAccessLogs',
      payload: { workerName: 'Renovation crew', company: 'Internal crew', status: 'blocked', orientationValid: false }
    },
    {
      route: 'route-plans',
      key: 'routePlan',
      detailCollection: 'routePlans',
      payload: { origin: 'Depot', destination: 'Rotterdam site', status: 'draft', routeRisk: 'low' }
    },
    {
      route: 'loading-plans',
      key: 'loadingPlan',
      detailCollection: 'loadingPlans',
      payload: { vehicle: 'Work van', trailerRequired: false, status: 'draft', loadItems: [{ name: 'tile cutter', quantity: 1 }] }
    },
    {
      route: 'procurement-orders',
      key: 'procurementOrder',
      detailCollection: 'procurementOrders',
      payload: { supplier: 'Tile Supplier NL', amount: 900, status: 'draft', items: [{ description: 'Tiles', amount: 900 }] }
    },
    {
      route: 'worker-instructions',
      key: 'workerInstruction',
      detailCollection: 'workerInstructions',
      payload: { title: 'Crew dispatch brief', audience: 'crew', status: 'draft', body: 'Protect apartment route and capture before photos.' }
    },
    {
      route: 'budget-lines',
      key: 'budgetLine',
      detailCollection: 'budgetLines',
      payload: { costCode: '02-REN', description: 'Renovation labor and materials', budgetAmount: 12000, forecastAmount: 11800, status: 'draft' }
    },
    {
      route: 'purchase-orders',
      key: 'purchaseOrder',
      detailCollection: 'purchaseOrders',
      payload: { supplier: 'Tile Supplier NL', amount: 900, status: 'draft', items: [{ description: 'Tiles', amount: 900 }] }
    },
    {
      route: 'draw-requests',
      key: 'drawRequest',
      detailCollection: 'drawRequests',
      payload: { title: 'Progress draw', requestedAmount: 4000, status: 'draft' }
    },
    {
      route: 'lien-waivers',
      key: 'lienWaiver',
      detailCollection: 'lienWaivers',
      payload: { supplier: 'Tile Supplier NL', amount: 900, status: 'requested', waiverType: 'conditional_progress' }
    },
    {
      route: 'finance-handoffs',
      key: 'financeHandoff',
      detailCollection: 'financeHandoffs',
      payload: { targetSystem: 'FAB', packageType: 'job_cost', amount: 12000, status: 'draft' }
    },
    {
      route: 'punch-items',
      key: 'punchItem',
      detailCollection: 'punchItems',
      payload: { title: 'Seal around vanity', severity: 'medium', status: 'open' }
    },
    {
      route: 'warranty-claims',
      key: 'warrantyClaim',
      detailCollection: 'warrantyClaims',
      payload: { title: 'Post-handover sealant check', clientName: 'Advanced Alias Client', severity: 'low', status: 'open' }
    },
    {
      route: 'aftercare',
      key: 'aftercare',
      detailCollection: 'aftercare',
      payload: { title: '30-day bathroom aftercare call', type: 'aftercare_call', status: 'open' }
    },
    {
      route: 'recurring-plans',
      key: 'recurringPlan',
      detailCollection: 'recurringPlans',
      payload: { service: 'annual bathroom sealant check', status: 'draft', intervalRule: 'FREQ=YEARLY' }
    }
  ];

  for (const call of advancedCalls) {
    const result = await request(baseUrl, `/api/jobs/${jobId}/${call.route}`, {
      method: 'POST',
      body: JSON.stringify(call.payload)
    });
    assert.equal(result.response.status, 201, call.route);
    assert.ok(result.body[call.key]?.id, call.key);
    assert.equal(result.body.ledgerJob.id, ledgerJobId);
  }

  const dispatch = await request(baseUrl, `/api/jobs/${jobId}/dispatch`, {
    method: 'POST',
    body: JSON.stringify({
      vehicle: 'Work van',
      workerInstructionTitle: 'Renovation dispatch pack',
      workerInstructionBody: 'Confirm tools, access, client contact and photo evidence before departure.'
    })
  });
  assert.equal(dispatch.response.status, 201);
  assert.equal(dispatch.body.ledgerJob.id, ledgerJobId);
  assert.ok(dispatch.body.dispatch.routePlan?.id);
  assert.ok(dispatch.body.dispatch.loadingPlan?.id);
  assert.ok(dispatch.body.dispatch.procurementOrder?.id);
  assert.ok(dispatch.body.dispatch.workerInstruction?.id);

  const closeout = await request(baseUrl, `/api/jobs/${jobId}/closeout`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'draft',
      completionNote: 'Closeout pack prepared through top-level job route.'
    })
  });
  assert.equal(closeout.response.status, 201);
  assert.equal(closeout.body.ledgerJob.id, ledgerJobId);
  assert.ok(closeout.body.closeout.quality?.id);
  assert.ok(closeout.body.closeout.safety?.id);
  assert.ok(closeout.body.closeout.aftercare?.id);
  assert.ok(closeout.body.closeout.invoice?.id);
  assert.ok(closeout.body.closeout.communication?.id);

  const detail = await request(baseUrl, `/api/ledger/jobs/${ledgerJobId}`);
  assert.equal(detail.response.status, 200);
  for (const call of advancedCalls) {
    assert.ok(
      detail.body.job[call.detailCollection].length >= 1,
      `${call.detailCollection} should include a record`
    );
  }
  assert.ok(detail.body.job.audit.some(event => event.action === 'create_dispatch_pack'));
  assert.ok(detail.body.job.audit.some(event => event.action === 'create_closeout_package'));
});
