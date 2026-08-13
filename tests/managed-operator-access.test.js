const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { ContractorOperatingLedger } = require('../operating-ledger');

function credential(accessKey) {
  return {
    tokenHash: crypto.createHash('sha256')
      .update('contractor-ai-managed-operator\0')
      .update(accessKey, 'utf8')
      .digest('hex'),
    tokenFingerprint: crypto.createHash('sha256').update(accessKey, 'utf8').digest('base64url').slice(0, 24)
  };
}

function loadServer(directory, ownerToken) {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    CONTRACTOR_AI_RUNTIME_MODE: 'local',
    CONTRACTOR_AI_STORAGE_MODE: 'local',
    CONTRACTOR_AI_REQUIRE_AUTH: 'true',
    CONTRACTOR_AI_AUTH_TOKEN: ownerToken,
    CONTRACTOR_AI_ROLE_TOKENS: '',
    CONTRACTOR_AI_AUTONOMOUS_SCHEDULER_ENABLED: 'false',
    CONTRACTOR_AI_SESSION_TTL_SECONDS: '3600',
    CONTRACTOR_AI_LOGIN_RATE_LIMIT: '10',
    STATE_FILE: path.join(directory, 'state.json'),
    LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
    UPLOAD_DIR: path.join(directory, 'uploads')
  });
  delete process.env.DASHBOARD_AUTH_TOKEN;
  delete process.env.CONTRACTOR_AI_DATABASE_URL;
  delete require.cache[require.resolve('../server')];
  return require('../server');
}

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

function bearer(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test('managed operator lifecycle retains only credential hashes and revokes sessions', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-managed-operator-ledger-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const firstKey = 'cai_first-managed-access-key-with-more-than-32-characters';
  const secondKey = 'cai_second-managed-access-key-with-more-than-32-characters';

  const ledger = new ContractorOperatingLedger({ dbFile });
  assert.equal(ledger.migrationStatus().currentVersion, '072_operator_locale_preferences');
  const worker = ledger.upsertWorker({ name: 'Managed field worker', status: 'available' });
  const fieldAccount = ledger.createManagedOperatorAccount({
    id: 'field-managed-1',
    name: 'Managed field worker',
    role: 'field_worker',
    scope: { workerId: worker.id },
    ...credential(firstKey)
  }, { actor: 'role:owner:bootstrap' });
  assert.deepEqual(fieldAccount.scope, { workerId: worker.id, jobIds: [] });
  assert.equal(fieldAccount.keyVersion, 1);
  assert.equal(fieldAccount.status, 'active');
  assert.equal(JSON.stringify(fieldAccount).includes(firstKey), false);
  assert.equal(ledger.diagnose().counts.managedOperatorAccounts, 1);
  assert.equal(ledger.diagnose().counts.activeManagedOperatorAccounts, 1);

  const retainedCredential = ledger.db.prepare(`
    SELECT token_hash, token_fingerprint, scope_json FROM managed_operator_accounts WHERE operator_id = ?
  `).get(fieldAccount.id);
  assert.equal(retainedCredential.token_hash, credential(firstKey).tokenHash);
  assert.equal(retainedCredential.token_hash.includes(firstKey), false);
  assert.equal(retainedCredential.token_fingerprint, credential(firstKey).tokenFingerprint);
  assert.equal(JSON.parse(retainedCredential.scope_json).workerId, worker.id);

  const now = Date.now();
  ledger.createOperatorSession({
    sessionIdHash: 'managed-operator-session-hash',
    operatorId: fieldAccount.id,
    role: fieldAccount.role,
    tokenFingerprint: retainedCredential.token_fingerprint,
    issuedAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 3_600_000).toISOString()
  });
  const rotated = ledger.rotateManagedOperatorAccess(fieldAccount.id, credential(secondKey), { actor: 'role:owner:bootstrap' });
  assert.equal(rotated.account.keyVersion, 2);
  assert.equal(rotated.revokedSessions, 1);
  assert.equal(ledger.getOperatorSession('managed-operator-session-hash'), null);
  assert.equal(ledger.authenticateManagedOperator(credential(firstKey).tokenHash), null);
  assert.equal(ledger.authenticateManagedOperator(credential(secondKey).tokenHash).id, fieldAccount.id);

  const deactivated = ledger.deactivateManagedOperatorAccount(fieldAccount.id, { actor: 'role:owner:bootstrap' });
  assert.equal(deactivated.account.status, 'deactivated');
  assert.equal(ledger.authenticateManagedOperator(credential(secondKey).tokenHash), null);
  assert.equal(ledger.diagnose().counts.activeManagedOperatorAccounts, 0);
  assert.deepEqual(
    ledger.listAudit({ entityType: 'managed_operator_account', entityId: fieldAccount.id, limit: 10 }).map(event => event.action),
    ['deactivate_managed_operator_access', 'rotate_managed_operator_access', 'create_managed_operator_access']
  );
  assert.equal(JSON.stringify(ledger.listAudit({ entityType: 'managed_operator_account', limit: 10 })).includes(firstKey), false);
  ledger.close();

  const restarted = new ContractorOperatingLedger({ dbFile });
  assert.equal(restarted.getManagedOperatorAccount(fieldAccount.id).status, 'deactivated');
  assert.equal(restarted.getManagedOperatorAccount(fieldAccount.id).keyVersion, 2);
  restarted.close();
});

test('owner manages redacted operator access through the production authorization boundary', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-managed-operator-api-'));
  const ownerToken = 'managed-operator-bootstrap-owner-token-at-least-32-characters';
  const app = loadServer(directory, ownerToken);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server }).catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const initial = await request(baseUrl, '/api/operations/operators', { headers: bearer(ownerToken) });
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.summary.environment, 1);
  assert.equal(initial.body.accounts[0].source, 'environment');
  assert.equal(initial.body.accounts[0].mutable, false);
  assert.equal(JSON.stringify(initial.body).includes(ownerToken), false);
  assert.equal(Object.hasOwn(initial.body.accounts[0], 'tokenHash'), false);

  const environmentConflict = await request(baseUrl, '/api/operations/operators', {
    method: 'POST',
    headers: bearer(ownerToken),
    body: JSON.stringify({ id: 'owner', name: 'Conflicting owner', role: 'owner', confirmation: 'CREATE_OWNER_ACCESS' })
  });
  assert.equal(environmentConflict.response.status, 409);
  assert.equal(environmentConflict.body.error.code, 'environment_operator_id_conflict');
  const immutableEnvironment = await request(baseUrl, '/api/operations/operators/owner/deactivate', {
    method: 'POST',
    headers: bearer(ownerToken),
    body: JSON.stringify({ confirmation: 'DEACTIVATE_OPERATOR_ACCESS' })
  });
  assert.equal(immutableEnvironment.response.status, 409);
  assert.equal(immutableEnvironment.body.error.code, 'environment_operator_immutable');
  const unconfirmedOwner = await request(baseUrl, '/api/operations/operators', {
    method: 'POST',
    headers: bearer(ownerToken),
    body: JSON.stringify({ id: 'managed-owner', name: 'Managed owner', role: 'owner' })
  });
  assert.equal(unconfirmedOwner.response.status, 400);
  assert.equal(unconfirmedOwner.body.error.code, 'confirmation_required');

  const fieldWorker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    headers: bearer(ownerToken),
    body: JSON.stringify({ name: 'Managed scoped field worker', status: 'available' })
  });
  assert.equal(fieldWorker.response.status, 201);
  const scopedJob = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    headers: bearer(ownerToken),
    body: JSON.stringify({ title: 'Managed field scope job', client: { name: 'Scoped client' }, assignAutomatically: false })
  });
  const otherJob = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    headers: bearer(ownerToken),
    body: JSON.stringify({ title: 'Managed field hidden job', client: { name: 'Hidden client' }, assignAutomatically: false })
  });
  assert.equal(scopedJob.response.status, 201);
  assert.equal(otherJob.response.status, 201);
  const fieldAccount = await request(baseUrl, '/api/operations/operators', {
    method: 'POST',
    headers: bearer(ownerToken),
    body: JSON.stringify({
      id: 'field-managed',
      name: 'Managed field operator',
      role: 'field_worker',
      scope: { workerId: fieldWorker.body.worker.id, jobIds: [scopedJob.body.job.id] }
    })
  });
  assert.equal(fieldAccount.response.status, 201);
  const managedFieldKey = fieldAccount.body.accessKey;
  const scopedJobs = await request(baseUrl, '/api/ledger/jobs?limit=100', { headers: bearer(managedFieldKey) });
  assert.equal(scopedJobs.response.status, 200);
  assert.deepEqual(scopedJobs.body.jobs.map(job => job.id), [scopedJob.body.job.id]);
  const deniedOtherJob = await request(baseUrl, `/api/ledger/jobs/${otherJob.body.job.id}`, { headers: bearer(managedFieldKey) });
  assert.equal(deniedOtherJob.response.status, 403);
  assert.equal(deniedOtherJob.body.error.code, 'field_job_scope_forbidden');
  const deactivatedField = await request(baseUrl, '/api/operations/operators/field-managed/deactivate', {
    method: 'POST',
    headers: bearer(ownerToken),
    body: JSON.stringify({ confirmation: 'DEACTIVATE_OPERATOR_ACCESS' })
  });
  assert.equal(deactivatedField.response.status, 200);

  const created = await request(baseUrl, '/api/operations/operators', {
    method: 'POST',
    headers: bearer(ownerToken),
    body: JSON.stringify({ id: 'office-managed', name: 'Managed office', role: 'office_operator' })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.account.id, 'office-managed');
  assert.equal(created.body.account.source, 'managed');
  assert.equal(created.body.shownOnce, true);
  assert.match(created.body.accessKey, /^cai_[A-Za-z0-9_-]{43}$/);
  assert.equal(created.response.headers.get('cache-control'), 'no-store');
  const firstAccessKey = created.body.accessKey;

  const managedLogin = await request(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: firstAccessKey })
  });
  assert.equal(managedLogin.response.status, 200);
  assert.equal(managedLogin.body.operatorId, 'office-managed');
  const managedCookie = (managedLogin.response.headers.get('set-cookie') || '').split(';', 1)[0];

  const deniedTeamList = await request(baseUrl, '/api/operations/operators', { headers: { Cookie: managedCookie } });
  assert.equal(deniedTeamList.response.status, 403);
  assert.equal(deniedTeamList.body.error.code, 'insufficient_role');

  const rotated = await request(baseUrl, '/api/operations/operators/office-managed/rotate', {
    method: 'POST',
    headers: bearer(ownerToken),
    body: JSON.stringify({ confirmation: 'ROTATE_OPERATOR_ACCESS' })
  });
  assert.equal(rotated.response.status, 200);
  assert.equal(rotated.body.account.keyVersion, 2);
  assert.equal(rotated.body.revokedSessions, 1);
  assert.notEqual(rotated.body.accessKey, firstAccessKey);
  const secondAccessKey = rotated.body.accessKey;

  const revokedCookie = await request(baseUrl, '/api/ledger/jobs', { headers: { Cookie: managedCookie } });
  assert.equal(revokedCookie.response.status, 401);
  const oldKeyLogin = await request(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: firstAccessKey })
  });
  assert.equal(oldKeyLogin.response.status, 401);
  const newKeyLogin = await request(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: secondAccessKey })
  });
  assert.equal(newKeyLogin.response.status, 200);

  const deactivated = await request(baseUrl, '/api/operations/operators/office-managed/deactivate', {
    method: 'POST',
    headers: bearer(ownerToken),
    body: JSON.stringify({ confirmation: 'DEACTIVATE_OPERATOR_ACCESS' })
  });
  assert.equal(deactivated.response.status, 200);
  assert.equal(deactivated.body.account.status, 'deactivated');
  const inactiveLogin = await request(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: secondAccessKey })
  });
  assert.equal(inactiveLogin.response.status, 401);

  const register = await request(baseUrl, '/api/operations/operators', { headers: bearer(ownerToken) });
  assert.equal(register.body.summary.managed, 2);
  assert.equal(register.body.summary.deactivated, 2);
  assert.equal(JSON.stringify(register.body).includes(firstAccessKey), false);
  assert.equal(JSON.stringify(register.body).includes(secondAccessKey), false);
  assert.equal(Object.hasOwn(register.body.accounts.find(account => account.id === 'office-managed'), 'tokenFingerprint'), false);

  const database = new DatabaseSync(path.join(directory, 'ledger.sqlite'), { readOnly: true });
  try {
    const row = database.prepare('SELECT token_hash, token_fingerprint FROM managed_operator_accounts WHERE operator_id = ?').get('office-managed');
    assert.equal(row.token_hash, credential(secondAccessKey).tokenHash);
    assert.equal(JSON.stringify(row).includes(secondAccessKey), false);
    const actions = database.prepare(`
      SELECT action FROM audit_events
      WHERE entity_type = 'managed_operator_account' AND entity_id = ?
      ORDER BY sequence_number
    `).all('office-managed').map(event => event.action);
    assert.deepEqual(actions, [
      'create_managed_operator_access',
      'rotate_managed_operator_access',
      'deactivate_managed_operator_access'
    ]);
  } finally {
    database.close();
  }
});

test('readiness rejects a managed principal id that later conflicts with deployment configuration', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-managed-operator-conflict-'));
  const ownerToken = 'managed-conflict-bootstrap-owner-token-at-least-32-characters';
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  ledger.createManagedOperatorAccount({
    id: 'owner',
    name: 'Former managed owner',
    role: 'owner',
    ...credential('cai_managed-owner-key-created-before-deployment-conflict')
  }, { actor: 'conflict_fixture' });
  ledger.close();

  const app = loadServer(directory, ownerToken);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server }).catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const readiness = await request(baseUrl, '/api/readiness', { headers: bearer(ownerToken) });
  assert.equal(readiness.response.status, 503);
  assert.equal(readiness.body.runtime.issues.some(issue => issue.code === 'operator_principal_id_conflict'), true);
});
