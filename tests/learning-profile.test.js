const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-learning-'));
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createCompletedJob(baseUrl, suffix, overrides = {}) {
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: `Learning hedge maintenance ${suffix}`,
      service: 'hedge_maintenance',
      jobType: 'hedge_maintenance',
      status: 'completed',
      progressPercent: 100,
      client: {
        name: `Learning Client ${suffix}`,
        email: `learning-${suffix}@example.test`,
        phone: '+31600000000',
        address: `${suffix} Prinsengracht, Amsterdam`,
        country: 'NL'
      },
      address: `${suffix} Prinsengracht, Amsterdam`,
      city: 'Amsterdam',
      priority: 'medium',
      estimatedCost: 420 + suffix * 40,
      estimatedHours: 5 + suffix,
      tasks: [
        { title: 'Trim hedge line', priority: 'high' },
        { title: 'Clean green waste', priority: 'medium' },
        ...(overrides.tasks || [])
      ],
      tools: ['Hedge Trimmer', 'Leaf Blower', ...(overrides.tools || [])],
      materials: [
        { name: 'Green waste bags', quantity: 4 + suffix, unit: 'bags', supplier: 'Bouwmaat', cost: 28 + suffix },
        ...(overrides.materials || [])
      ],
      lineItems: [
        { description: 'Hedge trimming labor', quantity: 1, unitPrice: 360 + suffix * 35, costCode: 'garden-labor' },
        { description: 'Green waste handling', quantity: 1, unitPrice: 80, costCode: 'garden-waste' }
      ],
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const timeLog = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/time-logs`, {
    method: 'POST',
    body: JSON.stringify({ workerName: `Crew ${suffix}`, hours: 4 + suffix, status: 'approved', notes: 'Actual hedge maintenance hours.' })
  });
  assert.equal(timeLog.response.status, 201);

  const expense = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/expenses`, {
    method: 'POST',
    body: JSON.stringify({ category: 'materials', amount: 120 + suffix * 25, vendor: 'Bouwmaat', status: 'approved', notes: 'Green waste and consumables.' })
  });
  assert.equal(expense.response.status, 201);

  const completion = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/progress`, {
    method: 'POST',
    body: JSON.stringify({ status: 'completed', progressPercent: 100, note: 'Historical completed job sample for learning.' })
  });
  assert.equal(completion.response.status, 201);
  assert.equal(completion.body.job.status, 'completed');

  return jobId;
}

test('learning profiles rebuild from completed jobs and produce approval-safe recommendations', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  await createCompletedJob(baseUrl, 1);
  await createCompletedJob(baseUrl, 2, {
    tools: ['Extension Ladder'],
    tasks: [{ title: 'Check client garden access', priority: 'medium' }]
  });

  const rebuild = await request(baseUrl, '/api/ledger/learning/rebuild', {
    method: 'POST',
    body: JSON.stringify({ jobType: 'hedge_maintenance', actor: 'test' })
  });
  assert.equal(rebuild.response.status, 200);
  assert.equal(rebuild.body.profile.jobType, 'hedge_maintenance');
  assert.equal(rebuild.body.profile.sampleCount, 2);
  assert.equal(rebuild.body.profile.confidence, 'medium');
  assert.ok(rebuild.body.profile.avgActualHours > 0);
  assert.ok(rebuild.body.profile.avgActualCost > 0);
  assert.ok(rebuild.body.profile.tasks.some(task => task.title === 'Trim hedge line' && task.frequency === 2));
  assert.ok(rebuild.body.profile.tools.some(tool => tool.toolName === 'Hedge Trimmer' && tool.frequency === 2));
  assert.ok(rebuild.body.profile.materials.some(material => material.name === 'Green waste bags' && material.frequency === 2));
  assert.ok(rebuild.body.dashboard.metrics.learningProfiles >= 1);

  const recommendation = await request(baseUrl, '/api/ledger/learning/recommend', {
    method: 'POST',
    body: JSON.stringify({ jobType: 'hedge_maintenance', title: 'New hedge maintenance estimate', rebuild: false })
  });
  assert.equal(recommendation.response.status, 200);
  assert.equal(recommendation.body.available, true);
  assert.equal(recommendation.body.confidence, 'medium');
  assert.ok(recommendation.body.recommendation.estimatedHours > 0);
  assert.ok(recommendation.body.recommendation.quote.total > recommendation.body.recommendation.quote.subtotal);
  assert.ok(recommendation.body.recommendation.tasks.some(task => task.title === 'Trim hedge line'));
  assert.ok(recommendation.body.recommendation.tools.some(tool => tool.toolName === 'Hedge Trimmer'));
  assert.match(recommendation.body.explanation, /approval/i);

  const profiles = await request(baseUrl, '/api/ledger/learning');
  assert.equal(profiles.response.status, 200);
  assert.ok(profiles.body.profiles.some(profile => profile.jobType === 'hedge_maintenance' && profile.sampleCount === 2));

  const debug = await request(baseUrl, '/api/ledger/debug');
  assert.equal(debug.response.status, 200);
  assert.ok(debug.body.diagnostics.counts.learningProfiles >= 1);
});

test('autonomous cycle refreshes stale learning profiles as internal low-risk work', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const jobType = 'hedge_maintenance_autonomous';

  const first = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Autonomous learning seed',
      service: jobType,
      jobType,
      status: 'completed',
      progressPercent: 100,
      client: { name: 'Autonomous Learning Client', email: 'autonomous-learning@example.test', country: 'NL' },
      estimatedCost: 300,
      estimatedHours: 3,
      tasks: [{ title: 'Autonomous hedge task', priority: 'medium' }],
      tools: ['Autonomous Hedge Trimmer'],
      materials: [{ name: 'Autonomous waste bags', quantity: 2, unit: 'bags' }],
      lineItems: [{ description: 'Autonomous hedge work', quantity: 1, unitPrice: 300 }],
      assignAutomatically: false
    })
  });
  assert.equal(first.response.status, 201);
  const firstComplete = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(first.body.job.id)}/progress`, {
    method: 'POST',
    body: JSON.stringify({ status: 'completed', progressPercent: 100, note: 'Initial autonomous learning sample complete.' })
  });
  assert.equal(firstComplete.response.status, 201);

  const initialProfile = await request(baseUrl, '/api/ledger/learning/rebuild', {
    method: 'POST',
    body: JSON.stringify({ jobType, actor: 'test' })
  });
  assert.equal(initialProfile.response.status, 200);
  assert.equal(initialProfile.body.profile.sampleCount, 1);

  await sleep(20);

  const second = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Autonomous learning refresh sample',
      service: jobType,
      jobType,
      status: 'completed',
      progressPercent: 100,
      client: { name: 'Autonomous Learning Client 2', email: 'autonomous-learning-2@example.test', country: 'NL' },
      estimatedCost: 360,
      estimatedHours: 4,
      tasks: [{ title: 'Autonomous hedge task', priority: 'medium' }],
      tools: ['Autonomous Hedge Trimmer'],
      materials: [{ name: 'Autonomous waste bags', quantity: 3, unit: 'bags' }],
      lineItems: [{ description: 'Autonomous hedge work', quantity: 1, unitPrice: 360 }],
      assignAutomatically: false
    })
  });
  assert.equal(second.response.status, 201);
  const secondComplete = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(second.body.job.id)}/progress`, {
    method: 'POST',
    body: JSON.stringify({ status: 'completed', progressPercent: 100, note: 'New autonomous learning sample complete.' })
  });
  assert.equal(secondComplete.response.status, 201);

  const dryRun = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, actor: 'test' })
  });
  assert.equal(dryRun.response.status, 200);
  const previewAction = dryRun.body.preview.find(action =>
    action.type === 'refresh_learning_profile'
    && action.jobType === jobType
  );
  assert.ok(previewAction);
  assert.equal(previewAction.requiresApproval, false);

  const cycle = await request(baseUrl, '/api/ledger/autonomous-cycle', {
    method: 'POST',
    body: JSON.stringify({
      dryRun: false,
      actor: 'test',
      actionTypes: ['refresh_learning_profile'],
      maxActions: 1
    })
  });
  assert.equal(cycle.response.status, 200);
  const applied = cycle.body.applied.find(action =>
    action.type === 'refresh_learning_profile'
    && action.jobType === jobType
  );
  assert.ok(applied);
  assert.equal(applied.status, 'refreshed');
  assert.equal(applied.sampleCount, 2);
  assert.equal(applied.confidence, 'medium');

  const profiles = await request(baseUrl, '/api/ledger/learning');
  assert.equal(profiles.response.status, 200);
  assert.ok(profiles.body.profiles.some(profile => profile.jobType === jobType && profile.sampleCount === 2));
});
