const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-playbooks-'));
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

test('job playbook applies garden operating records once and remains idempotent', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const catalog = await request(baseUrl, '/api/ledger/playbooks');
  assert.equal(catalog.response.status, 200);
  assert.ok(catalog.body.playbooks.some(playbook => playbook.key === 'garden_maintenance'));

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Monthly garden maintenance',
      service: 'garden maintenance',
      description: 'Trim hedges, cut lawn, clear green waste and leave paths clean.',
      client: { name: 'Playbook Garden Client', country: 'NL' },
      address: 'Singel 10, Amsterdam',
      priority: 'medium',
      estimatedCost: 450,
      estimatedHours: 6,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const preview = await request(baseUrl, `/api/ledger/jobs/${jobId}/playbook?playbookKey=garden_maintenance`);
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.playbook.key, 'garden_maintenance');
  assert.equal(preview.body.summary.externalCommitments, 0);
  assert.ok(preview.body.actions.some(action => action.type === 'tool_reservation' && action.label === 'Hedge trimmer'));
  assert.ok(preview.body.actions.some(action => action.type === 'material_requirement' && action.label === 'Green-waste bags'));
  assert.ok(preview.body.actions.some(action => action.type === 'recurring_plan'));

  const applied = await request(baseUrl, `/api/ledger/jobs/${jobId}/playbook`, {
    method: 'POST',
    body: JSON.stringify({ playbookKey: 'garden_maintenance', actor: 'test' })
  });
  assert.equal(applied.response.status, 201);
  assert.equal(applied.body.mode, 'applied');
  assert.ok(applied.body.created.some(record => record.type === 'tool_reservation'));
  assert.ok(applied.body.created.some(record => record.type === 'material_requirement'));
  assert.ok(applied.body.created.some(record => record.type === 'loading_plan'));
  assert.ok(applied.body.created.some(record => record.type === 'safety_meeting'));
  assert.ok(applied.body.created.some(record => record.type === 'worker_instruction'));
  assert.ok(applied.body.created.some(record => record.type === 'recurring_plan'));

  const detail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(detail.response.status, 200);
  assert.ok(detail.body.job.tools.some(tool => tool.toolName === 'Hedge trimmer'));
  assert.ok(detail.body.job.materials.some(material => material.name === 'Green-waste bags'));
  assert.ok(detail.body.job.siteVisits.length >= 1);
  assert.ok(detail.body.job.loadingPlans.length >= 1);
  assert.ok(detail.body.job.safetyMeetings.length >= 1);
  assert.ok(detail.body.job.jhas.length >= 1);
  assert.ok(detail.body.job.workerInstructions.length >= 1);
  assert.ok(detail.body.job.recurringPlans.some(plan => plan.service === 'garden maintenance'));
  assert.ok(detail.body.job.audit.some(event => event.action === 'apply_job_playbook'));

  const secondPreview = await request(baseUrl, `/api/ledger/jobs/${jobId}/playbook?playbookKey=garden_maintenance`);
  assert.equal(secondPreview.response.status, 200);
  assert.equal(secondPreview.body.actions.length, 0);
  assert.ok(secondPreview.body.skipped.length >= preview.body.actions.length);

  const secondApply = await request(baseUrl, `/api/ledger/jobs/${jobId}/playbook`, {
    method: 'POST',
    body: JSON.stringify({ playbookKey: 'garden_maintenance', actor: 'test' })
  });
  assert.equal(secondApply.response.status, 201);
  assert.equal(secondApply.body.created.length, 0);
});

test('intake can attach a matched operating playbook package in one request', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Terrace paving repair',
      service: 'paving',
      description: 'Repair cracked terrace paving, check drainage slope and replace jointing sand.',
      client: { name: 'One-step Playbook Client', country: 'NL' },
      address: 'Nieuwezijds Voorburgwal 50, Amsterdam',
      priority: 'high',
      estimatedCost: 1800,
      estimatedHours: 14,
      assignAutomatically: false,
      applyOperatingPlaybook: true
    })
  });

  assert.equal(intake.response.status, 201);
  assert.equal(intake.body.job.operatingPackage.playbook.key, 'paving');
  assert.equal(intake.body.job.operatingPackage.summary.externalCommitments, 0);
  assert.ok(intake.body.job.operatingPackage.created.some(record => record.type === 'tool_reservation'));
  assert.ok(intake.body.job.operatingPackage.created.some(record => record.type === 'material_requirement'));
  assert.ok(intake.body.job.operatingPackage.created.some(record => record.type === 'loading_plan'));
  assert.ok(intake.body.job.operatingPackage.created.some(record => record.type === 'worker_instruction'));
  assert.ok(intake.body.job.operatingPackage.created.some(record => record.type === 'quality_check'));

  const detail = await request(baseUrl, `/api/ledger/jobs/${intake.body.job.id}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.job.quotes.length, 1);
  assert.ok(detail.body.job.quotes[0].approvalId);
  assert.ok(detail.body.job.tools.some(tool => tool.toolName === 'Plate compactor'));
  assert.ok(detail.body.job.materials.some(material => material.name === 'Paving sand'));
  assert.ok(detail.body.job.loadingPlans.length >= 1);
  assert.ok(detail.body.job.workerInstructions.every(instruction => instruction.status !== 'sent'));
  assert.ok(detail.body.job.audit.some(event => event.action === 'apply_job_playbook'));
});

test('ledger job playbook creates renovation decisions and field controls', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Bathroom renovation playbook',
      client: { name: 'Playbook Client' },
      address: 'Kerkstraat 18, Utrecht',
      description: 'Renovate bathroom, coordinate tile selections, protect site and keep daily evidence.',
      priority: 'high',
      estimatedCost: 14000,
      estimatedHours: 90
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const applied = await request(baseUrl, `/api/ledger/jobs/${jobId}/playbook`, {
    method: 'POST',
    body: JSON.stringify({ playbookKey: 'renovation', actor: 'playbook_test' })
  });
  assert.equal(applied.response.status, 201);
  assert.equal(applied.body.playbook.key, 'renovation');
  assert.equal(applied.body.job.id, jobId);
  assert.ok(applied.body.created.some(record => record.type === 'client_selection'));
  assert.ok(applied.body.created.some(record => record.type === 'rfi'));
  assert.ok(applied.body.created.some(record => record.type === 'field_report'));
  assert.ok(applied.body.created.some(record => record.type === 'budget_line'));

  const detail = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  assert.equal(detail.response.status, 200);
  assert.ok(detail.body.job.clientSelections.some(selection => selection.title === 'Finish selection'));
  assert.ok(detail.body.job.rfis.some(rfi => /Hidden condition/i.test(rfi.title)));
  assert.ok(detail.body.job.fieldReports.length >= 1);
  assert.ok(detail.body.job.budgetLines.length >= 1);
  assert.ok(detail.body.job.communications.every(message => message.status !== 'sent'));
});
