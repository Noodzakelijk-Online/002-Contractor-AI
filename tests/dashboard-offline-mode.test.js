const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('offline dashboard never hydrates sample or cached contractor records', () => {
  assert.match(dashboardSource, /jobs:\s*\[\],\s*workers:\s*\[\],\s*tools:\s*\[\]/s);
  assert.match(dashboardSource, /dashboardSource:\s*'offline'/);
  assert.doesNotMatch(dashboardSource, /const jobs = savedData \? savedData\.jobs : sampleJobs;/);
  assert.doesNotMatch(dashboardSource, /const workers = savedData \? savedData\.workers : sampleWorkers;/);
  assert.doesNotMatch(dashboardSource, /const tools = savedData \? savedData\.tools : sampleTools;/);
});

test('offline dashboard intercepts command buttons and routes new jobs to the API-backed intake flow', () => {
  assert.match(dashboardSource, /Start the local Contractor\.AI API before creating or changing operational records\./);
  assert.match(dashboardSource, /if \(!shouldUseServer\(\)\) \{\s*showNotification\('Start the local API before creating a job intake\.'/s);
  assert.match(dashboardSource, /Retry Ledger Connection/);
});
