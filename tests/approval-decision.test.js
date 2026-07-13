const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-approvals-'));
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

test('approval queue exposes exact decision effects and safeguards', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Approval decision visibility job',
      service: 'garden maintenance',
      client: {
        name: 'Approval Client',
        email: 'approval@example.test',
        phone: '+31633333333',
        address: 'Singel 1, Amsterdam',
        country: 'NL'
      },
      address: 'Singel 1, Amsterdam',
      city: 'Amsterdam',
      priority: 'high',
      estimatedHours: 5,
      estimatedCost: 450,
      tools: ['Hedge trimmer'],
      materials: [{ name: 'Green waste bags', quantity: 10, unit: 'bags' }]
    })
  });
  assert.equal(intake.response.status, 201);

  const approvals = await request(baseUrl, '/api/ledger/approvals?status=pending&limit=100');
  assert.equal(approvals.response.status, 200);
  const quoteApproval = approvals.body.approvals.find(item => item.targetType === 'quote');
  const communicationApproval = approvals.body.approvals.find(item => item.targetType === 'communication');
  assert.ok(quoteApproval);
  assert.ok(communicationApproval);

  assert.equal(quoteApproval.decision.riskLevel, 'high');
  assert.match(quoteApproval.decision.primaryEffect, /Approve quote/);
  assert.ok(quoteApproval.decision.effects.some(effect => effect.includes('quote approved')));
  assert.ok(quoteApproval.decision.safeguards.some(effect => effect.includes('Does not send the quote')));
  assert.ok(Array.isArray(quoteApproval.decision.preview.lineItems));
  assert.ok(quoteApproval.decision.preview.lineItems.length >= 1);

  assert.equal(communicationApproval.decision.riskLevel, 'high');
  assert.match(communicationApproval.decision.primaryEffect, /Approve .*draft/);
  assert.ok(communicationApproval.decision.effects.some(effect => effect.includes('communication draft')));
  assert.ok(communicationApproval.decision.safeguards.some(effect => effect.includes('Does not send the message')));
  assert.match(communicationApproval.decision.preview.subject, /Intake received/);
  assert.match(communicationApproval.decision.preview.body, /Draft acknowledgement/);
});
