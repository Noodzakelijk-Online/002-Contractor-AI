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

test('dispatch readiness API summarizes blockers and reflects prepared dispatch records', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

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

  const prep = await request(baseUrl, '/api/schedule/prepare-dispatch', {
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

  const approvalQueue = await request(baseUrl, '/api/ledger/dispatch?mode=approval&limit=100');
  assert.equal(approvalQueue.response.status, 200);
  assert.ok(approvalQueue.body.summary.pendingApprovals >= 1);
});
