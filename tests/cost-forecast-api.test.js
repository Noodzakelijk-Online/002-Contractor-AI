const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-cost-forecast-api-'));
const tokens = {
  owner: 'cost-forecast-owner-token-at-least-32-characters',
  approver: 'cost-forecast-approver-token-at-least-32-characters',
  office_operator: 'cost-forecast-office-token-at-least-32-characters',
  field_worker: { token: 'cost-forecast-field-token-at-least-32-characters', jobIds: ['none'] }
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify(tokens),
  STATE_FILE: path.join(directory, 'state.json'),
  LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(directory, 'uploads')
});
delete process.env.CONTRACTOR_AI_AUTH_TOKEN;
delete process.env.DASHBOARD_AUTH_TOKEN;

const app = require('../server');

async function request(baseUrl, route, token, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test('cost forecast API enforces role, source, approval, and stale-snapshot controls', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'cost_forecast_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      title: 'API cost forecast',
      client: { name: 'API Forecast Client' },
      status: 'in_progress',
      progressPercent: 40,
      contractValue: 2400,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;

  const blocked = await request(baseUrl, `/api/ledger/jobs/${jobId}/cost-forecast/snapshots`, tokens.office_operator, {
    method: 'POST', body: '{}'
  });
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.body.error.code, 'cost_forecast_not_ready');

  const budget = await request(baseUrl, `/api/ledger/jobs/${jobId}/budget-lines`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      status: 'baseline',
      costCode: 'API-100',
      description: 'API forecast baseline',
      budgetAmount: 1200,
      forecastAmount: 1100
    })
  });
  assert.equal(budget.response.status, 201, JSON.stringify(budget.body));
  const budgetApproval = await request(baseUrl, `/api/ledger/approvals/${budget.body.budgetLine.approval.id}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'API budget approver', reason: 'Budget checked.' })
  });
  assert.equal(budgetApproval.response.status, 200, JSON.stringify(budgetApproval.body));
  const costs = await request(baseUrl, `/api/ledger/jobs/${jobId}/finance-costs`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      timeLog: { workDate: '2026-07-16', hours: 4, rate: 50, costCode: 'API-100', notes: 'API labor evidence.' },
      expense: { amount: 100, category: 'materials', costCode: 'API-100', vendor: 'API Vendor', receiptRef: 'API-100' }
    })
  });
  assert.equal(costs.response.status, 201, JSON.stringify(costs.body));

  const fieldRead = await request(baseUrl, `/api/ledger/jobs/${jobId}/cost-forecast`, tokens.field_worker.token);
  assert.equal(fieldRead.response.status, 403);
  const approverRead = await request(baseUrl, `/api/ledger/jobs/${jobId}/cost-forecast`, tokens.approver);
  assert.equal(approverRead.response.status, 200, JSON.stringify(approverRead.body));
  assert.equal(approverRead.body.forecast.summary.actual, 300);
  assert.equal(approverRead.body.forecast.summary.forecast, 1100);

  const deniedPrepare = await request(baseUrl, `/api/ledger/jobs/${jobId}/cost-forecast/snapshots`, tokens.approver, {
    method: 'POST', body: '{}'
  });
  assert.equal(deniedPrepare.response.status, 403);
  const prepared = await request(baseUrl, `/api/ledger/jobs/${jobId}/cost-forecast/snapshots`, tokens.office_operator, {
    method: 'POST', body: '{}'
  });
  assert.equal(prepared.response.status, 201, JSON.stringify(prepared.body));
  assert.match(prepared.body.snapshot.forecastNumber, /^FC-\d{4}-000001$/);
  assert.equal(prepared.body.approval.targetType, 'cost_forecast');
  assert.equal(prepared.body.snapshot.integrityValid, true);
  const replay = await request(baseUrl, `/api/ledger/jobs/${jobId}/cost-forecast/snapshots`, tokens.office_operator, {
    method: 'POST', body: '{}'
  });
  assert.equal(replay.response.status, 201, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.snapshot.id, prepared.body.snapshot.id);

  const approved = await request(baseUrl, `/api/ledger/approvals/${prepared.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'API forecast approver', reason: 'Source-linked forecast checked.' })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  const finance = await request(baseUrl, '/api/ledger/finance?mode=all&limit=100', tokens.office_operator);
  const financeJob = finance.body.jobs.find(item => item.jobId === jobId);
  assert.ok(financeJob);
  assert.equal(financeJob.costForecast.snapshotCurrent, true);
  assert.equal(financeJob.costForecast.activeSnapshot.forecastNumber, prepared.body.snapshot.forecastNumber);
  assert.equal(financeJob.nextActions.some(action => action.type === 'prepare_cost_forecast'), false);

  const changed = await request(baseUrl, `/api/ledger/jobs/${jobId}/expenses`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ amount: 25, category: 'materials', costCode: 'API-100', vendor: 'API Vendor', status: 'submitted' })
  });
  assert.equal(changed.response.status, 201, JSON.stringify(changed.body));
  const revisedFinance = await request(baseUrl, '/api/ledger/finance?mode=forecast&limit=100', tokens.office_operator);
  const revisedJob = revisedFinance.body.jobs.find(item => item.jobId === jobId);
  assert.ok(revisedJob);
  assert.equal(revisedJob.costForecast.snapshotCurrent, false);
  assert.equal(revisedJob.flags.costForecastStale, true);
  assert.ok(revisedJob.nextActions.some(action => action.type === 'prepare_cost_forecast'));

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200, JSON.stringify(capabilities.body));
  assert.equal(capabilities.body.capabilities.costForecasting.sourceLinked, true);
  assert.equal(capabilities.body.capabilities.costForecasting.doubleCountControl, 'supplier_invoice_reduces_linked_order_commitment');
});
