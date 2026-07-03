const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-legacy-resources-'));
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

test('legacy workers and tools API updates and retires ledger-only resources', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const ledgerWorker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Ledger-only Legacy Painter',
      role: 'Painter',
      status: 'available',
      homeRegion: 'Amsterdam',
      hourlyRate: 55,
      skills: ['painting']
    })
  });
  assert.equal(ledgerWorker.response.status, 201);

  const ledgerTool = await request(baseUrl, '/api/ledger/tools', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Ledger-only Legacy Sander',
      category: 'power_tool',
      status: 'available',
      homeLocation: 'Amsterdam Depot',
      currentLocation: 'Amsterdam Depot'
    })
  });
  assert.equal(ledgerTool.response.status, 201);

  const listedWorkers = await request(baseUrl, '/api/workers?search=Ledger-only%20Legacy%20Painter');
  assert.equal(listedWorkers.response.status, 200);
  assert.ok(listedWorkers.body.some(worker => worker.id === ledgerWorker.body.worker.id && worker.source === 'ledger'));

  const listedTools = await request(baseUrl, '/api/tools?search=Ledger-only%20Legacy%20Sander');
  assert.equal(listedTools.response.status, 200);
  assert.ok(listedTools.body.some(tool => tool.id === ledgerTool.body.tool.id && tool.source === 'ledger'));

  const editedWorker = await request(baseUrl, `/api/workers/${encodeURIComponent(ledgerWorker.body.worker.id)}`, {
    method: 'PUT',
    body: JSON.stringify({
      specialty: 'Senior Painter',
      status: 'offline',
      hourlyRate: 62,
      skills: ['painting', 'preparation'],
      currentJob: 'Warranty paint touch-up',
      currentJobId: 'job-visible-through-legacy'
    })
  });
  assert.equal(editedWorker.response.status, 200);
  assert.equal(editedWorker.body.success, true);
  assert.equal(editedWorker.body.operationStatus, 'updated');
  assert.equal(editedWorker.body.source, 'ledger');
  assert.equal(editedWorker.body.specialty, 'Senior Painter');
  assert.equal(editedWorker.body.status, 'offline');
  assert.equal(editedWorker.body.hourlyRate, 62);
  assert.equal(editedWorker.body.currentJob, 'Warranty paint touch-up');
  assert.equal(editedWorker.body.currentJobId, 'job-visible-through-legacy');

  const editedTool = await request(baseUrl, `/api/tools/${encodeURIComponent(ledgerTool.body.tool.id)}`, {
    method: 'PUT',
    body: JSON.stringify({
      status: 'maintenance',
      currentLocation: 'Service Bench',
      returnDate: '2026-07-03',
      assignedJobId: 'job-visible-through-legacy',
      assignedWorkerId: ledgerWorker.body.worker.id
    })
  });
  assert.equal(editedTool.response.status, 200);
  assert.equal(editedTool.body.success, true);
  assert.equal(editedTool.body.operationStatus, 'updated');
  assert.equal(editedTool.body.source, 'ledger');
  assert.equal(editedTool.body.status, 'maintenance');
  assert.equal(editedTool.body.currentLocation, 'Service Bench');
  assert.equal(editedTool.body.returnDate, '2026-07-03');
  assert.equal(editedTool.body.assignedJobId, 'job-visible-through-legacy');
  assert.equal(editedTool.body.assignedWorkerId, ledgerWorker.body.worker.id);

  const retiredWorker = await request(baseUrl, `/api/workers/${encodeURIComponent(ledgerWorker.body.worker.id)}`, {
    method: 'DELETE'
  });
  assert.equal(retiredWorker.response.status, 200);
  assert.equal(retiredWorker.body.success, true);
  assert.equal(retiredWorker.body.deleted, false);
  assert.equal(retiredWorker.body.retained, true);
  assert.equal(retiredWorker.body.retired, false);
  assert.equal(retiredWorker.body.requiresApproval, true);
  assert.equal(retiredWorker.body.operationStatus, 'pending_approval');
  assert.equal(retiredWorker.body.approval.targetType, 'worker_retirement');
  assert.equal(retiredWorker.body.approval.approvalType, 'destructive_action');
  assert.equal(retiredWorker.body.worker.status, 'offline');

  const repeatedWorkerRetirement = await request(baseUrl, `/api/workers/${encodeURIComponent(ledgerWorker.body.worker.id)}`, {
    method: 'DELETE'
  });
  assert.equal(repeatedWorkerRetirement.response.status, 200);
  assert.equal(repeatedWorkerRetirement.body.approval.id, retiredWorker.body.approval.id);

  const approvedWorkerRetirement = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(retiredWorker.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Resource Test', reason: 'Worker removed from available crew.' })
  });
  assert.equal(approvedWorkerRetirement.response.status, 200);
  assert.equal(approvedWorkerRetirement.body.approval.status, 'approved');

  const workersAfterApproval = await request(baseUrl, '/api/workers?search=Ledger-only%20Legacy%20Painter');
  assert.equal(workersAfterApproval.response.status, 200);
  assert.ok(workersAfterApproval.body.some(worker => worker.id === ledgerWorker.body.worker.id && worker.status === 'retired'));

  const retiredTool = await request(baseUrl, `/api/tools/${encodeURIComponent(ledgerTool.body.tool.id)}`, {
    method: 'DELETE'
  });
  assert.equal(retiredTool.response.status, 200);
  assert.equal(retiredTool.body.success, true);
  assert.equal(retiredTool.body.deleted, false);
  assert.equal(retiredTool.body.retained, true);
  assert.equal(retiredTool.body.retired, false);
  assert.equal(retiredTool.body.requiresApproval, true);
  assert.equal(retiredTool.body.operationStatus, 'pending_approval');
  assert.equal(retiredTool.body.approval.targetType, 'tool_retirement');
  assert.equal(retiredTool.body.approval.approvalType, 'destructive_action');
  assert.equal(retiredTool.body.tool.status, 'maintenance');

  const approvedToolRetirement = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(retiredTool.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Resource Test', reason: 'Tool removed from equipment planning.' })
  });
  assert.equal(approvedToolRetirement.response.status, 200);
  assert.equal(approvedToolRetirement.body.approval.status, 'approved');

  const toolsAfterApproval = await request(baseUrl, '/api/tools?search=Ledger-only%20Legacy%20Sander');
  assert.equal(toolsAfterApproval.response.status, 200);
  assert.ok(toolsAfterApproval.body.some(tool => tool.id === ledgerTool.body.tool.id && tool.status === 'retired'));

  const missingLedgerWorkerDelete = await request(baseUrl, '/api/ledger/workers/worker_missing_resource', {
    method: 'DELETE'
  });
  assert.equal(missingLedgerWorkerDelete.response.status, 404);
  assert.equal(missingLedgerWorkerDelete.body.error.code, 'not_found');

  const missingLedgerToolDelete = await request(baseUrl, '/api/ledger/tools/tool_missing_resource', {
    method: 'DELETE'
  });
  assert.equal(missingLedgerToolDelete.response.status, 404);
  assert.equal(missingLedgerToolDelete.body.error.code, 'not_found');
});
