const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-weather-operations-'));
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');

const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  return { response, body: await response.json() };
}

test('dashboard weather comes from recorded ledger assessments instead of fixed conditions', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Weather readiness regression',
      client: { name: 'Weather Client', address: 'Rotterdam' },
      address: 'Rotterdam',
      service: 'paving',
      description: 'Outdoor paving work with a weather-sensitive schedule.',
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);

  const beforeAssessment = await request(baseUrl, '/api/ledger/weather');
  assert.equal(beforeAssessment.response.status, 200);
  assert.equal(beforeAssessment.body.weather.source, 'not_assessed');
  assert.notEqual(beforeAssessment.body.weather.location, 'Amsterdam');

  const assessment = await request(baseUrl, '/api/ledger/weather/assess', {
    method: 'POST',
    body: JSON.stringify({
      jobId: intake.body.job.id,
      condition: 'rain_risk',
      precipitationPercent: 72,
      temperatureC: 14,
      windKph: 30,
      recommendation: 'Keep paving work off the schedule until the rain risk clears.'
    })
  });
  assert.equal(assessment.response.status, 201);
  assert.equal(assessment.body.provider.source, 'manual');
  assert.equal(assessment.body.weather.precipitationPercent, 72);

  const dashboard = await request(baseUrl, '/api/ledger/weather');
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.weather.source, 'local_assessment');
  assert.equal(dashboard.body.weather.status, 'risk');
  assert.equal(dashboard.body.weather.location, 'Rotterdam');
  assert.equal(dashboard.body.weather.precipitation, 72);
  assert.equal(dashboard.body.weather.temperature, 14);
  const ledgerDashboard = await request(baseUrl, '/api/ledger/dashboard');
  assert.equal(ledgerDashboard.body.dashboard.metrics.weatherAssessments, 1);
  assert.equal(ledgerDashboard.body.dashboard.metrics.weatherRisks, 1);
});
