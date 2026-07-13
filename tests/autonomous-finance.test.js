const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-autonomous-finance-'));
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

test('autonomous cycle drafts invoice for completed uninvoiced work behind approval gate', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      clientName: 'Autonomous Finance Client',
      clientPhone: '+31 6 44444444',
      address: 'Weteringschans 44, Amsterdam',
      service: 'garden renovation',
      title: 'Autonomous invoice closeout',
      description: 'Completed garden renovation needing invoice draft and approval.',
      status: 'completed',
      priority: 'medium',
      riskLevel: 'normal',
      progressPercent: 100,
      estimatedCost: 2400,
      contractValue: 2400,
      estimatedHours: 20,
      targetCompletion: '2026-07-03T16:00:00.000Z'
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const financeBefore = await request(baseUrl, '/api/ledger/finance?mode=invoice&limit=100');
  assert.equal(financeBefore.response.status, 200);
  assert.ok(financeBefore.body.jobs.some(job =>
    job.jobId === jobId
    && job.flags.invoiceReady === true
    && job.nextActions.some(action => action.type === 'draft_invoice')
  ));

  const dryRun = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, actor: 'autonomous-finance-test' })
  });
  assert.equal(dryRun.response.status, 200);
  const previewAction = dryRun.body.preview.find(action =>
    action.type === 'draft_invoice'
    && action.jobId === jobId
  );
  assert.ok(previewAction);
  assert.equal(previewAction.suggestedAmount, 2400);
  assert.equal(previewAction.suggestedTotal, 2904);

  const cycle = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({
      dryRun: false,
      actor: 'autonomous-finance-test',
      actionTypes: ['draft_invoice'],
      jobIds: [jobId],
      maxActions: 1
    })
  });
  assert.equal(cycle.response.status, 200);
  const applied = cycle.body.applied.find(action =>
    action.type === 'draft_invoice'
    && action.jobId === jobId
  );
  assert.ok(applied);
  assert.equal(applied.status, 'drafted');
  assert.ok(applied.invoiceId);
  assert.ok(applied.approvalId);

  const detail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(detail.response.status, 200);
  const invoice = detail.body.job.invoices.find(item => item.id === applied.invoiceId);
  assert.ok(invoice);
  assert.equal(invoice.status, 'draft');
  assert.equal(invoice.amount, 2400);
  assert.equal(invoice.taxAmount, 504);
  assert.equal(invoice.total, 2904);
  assert.equal(invoice.data.peppolReady, true);
  assert.match(invoice.data.notes, /Approval required before issuing/);
  assert.equal(invoice.approvalId, applied.approvalId);
  assert.ok(detail.body.job.audit.some(event => event.action === 'autonomous_draft_invoice'));

  const approvals = await request(baseUrl, '/api/ledger/approvals?status=pending&limit=100');
  assert.equal(approvals.response.status, 200);
  assert.ok(approvals.body.approvals.some(approval =>
    approval.id === applied.approvalId
    && approval.targetType === 'invoice'
    && approval.approvalType === 'invoice_issue'
  ));

  const approvalQueue = await request(baseUrl, '/api/ledger/finance?mode=approval&limit=100');
  assert.equal(approvalQueue.response.status, 200);
  assert.ok(approvalQueue.body.jobs.some(job =>
    job.jobId === jobId
    && job.flags.approvalRequired === true
    && job.counts.draftInvoices === 1
  ));
});
