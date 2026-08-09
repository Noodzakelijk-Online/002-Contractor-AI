const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const {
  HAI_FEED_FORMAT,
  HAI_FEED_OPERATION,
  HAI_ITEM_PROVIDER,
  HAI_ITEM_TYPE,
  buildHaiFeed,
  connectorManifest,
  validateHaiFeed,
  writeHaiFeedAtomically
} = require('../hai-connector');
const { exportHaiFeed } = require('../scripts/export-hai-feed');
const { verifyHaiContract } = require('../scripts/verify-hai-contract');

test('HAI feed is deterministic, bounded, deduplicated, and read-only', () => {
  const actions = [
    {
      type: 'draft_opportunity_follow_up',
      opportunityId: 'opp_1',
      idempotencyKey: 'follow-up:opp_1:2026-08-09',
      title: 'Roof inspection',
      message: 'Prepare an internal follow-up draft. No message will be sent.',
      severity: 'high',
      dueAt: '2026-08-09T08:00:00.000Z'
    },
    {
      type: 'draft_opportunity_follow_up',
      opportunityId: 'opp_1',
      idempotencyKey: 'follow-up:opp_1:2026-08-09',
      title: 'Duplicate must collapse',
      message: 'Duplicate.',
      severity: 'low'
    },
    {
      type: 'review_approval',
      jobId: 'job_1',
      approvalId: 'approval_1',
      message: 'Review retained approval evidence.',
      requiresApproval: true,
      severity: 'critical'
    }
  ];
  const first = buildHaiFeed(actions, { limit: 2 });
  const second = buildHaiFeed([...actions].reverse(), { limit: 2 });
  assert.deepEqual(first, second);
  assert.equal(first.length, 2);
  assert.equal(first[0].metadata.severity, 'critical');
  assert.ok(first.every(item => item.provider === HAI_ITEM_PROVIDER));
  assert.ok(first.every(item => item.itemType === HAI_ITEM_TYPE));
  assert.ok(first.every(item => typeof item.content === 'string' && item.content.length > 0));
  assert.ok(first.every(item => item.sourceUri.startsWith('contractor-ai://review-actions/')));
  assert.ok(first.every(item => !Object.hasOwn(item, 'body') && !Object.hasOwn(item, 'operationType')));
  assert.ok(first.every(item => item.metadata.canExecute === false));
  assert.ok(first.every(item => item.metadata.externalCommitments === 0));
  assert.doesNotMatch(JSON.stringify(first), /token|password|secret/i);
  validateHaiFeed(first);
  const manifest = connectorManifest();
  assert.equal(manifest.recommendedTransport, 'local_json_file');
  assert.equal(manifest.format, HAI_FEED_FORMAT);
  assert.equal(manifest.schema, 'accountfeed.GenericItem');
  assert.equal(manifest.itemProvider, HAI_ITEM_PROVIDER);
  assert.equal(manifest.itemType, HAI_ITEM_TYPE);
  assert.equal(manifest.operationType, HAI_FEED_OPERATION);
  assert.equal(manifest.operationTypeSource, 'derived_by_hai_from_item_type');
});

test('HAI feed rejects the retired normalized shape and verifies its native contract', () => {
  const current = buildHaiFeed([{ type: 'review', id: 'shape-one', message: 'Review shape.' }]);
  const stale = [{ ...current[0], body: current[0].content, operationType: 'review_contractor_ai_action' }];
  assert.throws(() => validateHaiFeed(stale), /retired normalized-feed field/);
  assert.throws(() => validateHaiFeed([{ ...current[0], provider: 'contractor_ai' }]), /unsupported provider/);
  const verification = verifyHaiContract();
  assert.deepEqual(verification, {
    valid: true,
    format: HAI_FEED_FORMAT,
    schema: 'accountfeed.GenericItem',
    provider: HAI_ITEM_PROVIDER,
    itemType: HAI_ITEM_TYPE,
    operationType: HAI_FEED_OPERATION,
    canExecute: false,
    externalCommitments: 0,
    fixtureSha256: verification.fixtureSha256,
    actualHaiParser: false
  });
});

test('HAI feed writes an operator-selected absolute local file with stable integrity', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-hai-file-'));
  const outputFile = path.join(directory, 'contractor-ai.json');
  const feed = buildHaiFeed([{ type: 'review', id: 'one', message: 'Review one.' }]);
  const first = writeHaiFeedAtomically(outputFile, feed);
  const second = writeHaiFeedAtomically(outputFile, feed);
  assert.equal(first.sha256, second.sha256);
  assert.equal(second.itemCount, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(outputFile, 'utf8')), feed);
  assert.throws(() => writeHaiFeedAtomically('relative-feed.json', feed), /absolute/);
});

test('HAI exporter authenticates to a loopback API and never puts its owner key in the URL', async () => {
  const token = 'hai-export-owner-token-at-least-32-characters';
  const feed = buildHaiFeed([{ type: 'review', id: 'export-one', message: 'Review export.' }]);
  let requestedUrl = '';
  const server = http.createServer((req, res) => {
    requestedUrl = req.url;
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(feed));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const outputFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-hai-export-')), 'feed.json');
  try {
    const result = await exportHaiFeed({
      url: `http://127.0.0.1:${server.address().port}`,
      token,
      output: outputFile,
      limit: 25
    });
    assert.equal(result.itemCount, 1);
    assert.doesNotMatch(requestedUrl, new RegExp(token));
    assert.equal(new URL(`http://localhost${requestedUrl}`).searchParams.get('limit'), '25');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('HAI API is owner-only and returns the generic JSON root array', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-hai-api-'));
  const tokens = {
    owner: 'hai-api-owner-token-at-least-32-characters',
    office_operator: 'hai-api-office-token-at-least-32-characters'
  };
  Object.assign(process.env, {
    NODE_ENV: 'production',
    CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify(tokens),
    CONTRACTOR_AI_DATA_DIR: directory,
    LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
    UPLOAD_DIR: path.join(directory, 'uploads')
  });
  delete process.env.CONTRACTOR_AI_AUTH_TOKEN;
  delete require.cache[require.resolve('../server')];
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (route, token) => fetch(`${baseUrl}${route}`, { headers: { Authorization: `Bearer ${token}` } });
  try {
    const manifest = await request('/api/integrations/hai/manifest', tokens.owner);
    assert.equal(manifest.status, 200);
    const manifestBody = await manifest.json();
    assert.equal(manifestBody.canExecute, false);
    assert.equal(manifestBody.schema, 'accountfeed.GenericItem');
    assert.equal(manifestBody.itemProvider, HAI_ITEM_PROVIDER);
    assert.equal(manifestBody.itemType, HAI_ITEM_TYPE);
    assert.equal(manifestBody.operationType, HAI_FEED_OPERATION);
    const feed = await request('/api/integrations/hai/feed?limit=5', tokens.owner);
    assert.equal(feed.status, 200);
    assert.ok(Array.isArray(await feed.json()));
    assert.equal(feed.headers.get('cache-control'), 'no-store');
    const denied = await request('/api/integrations/hai/feed', tokens.office_operator);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'insufficient_role');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
