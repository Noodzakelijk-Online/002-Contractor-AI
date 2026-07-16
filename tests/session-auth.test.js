const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadServerWithAuth(options = {}) {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-session-auth-'));
  Object.assign(process.env, {
    NODE_ENV: options.production ? 'production' : 'test',
    CONTRACTOR_AI_RUNTIME_MODE: 'local',
    CONTRACTOR_AI_STORAGE_MODE: 'local',
    CONTRACTOR_AI_REQUIRE_AUTH: 'true',
    CONTRACTOR_AI_AUTH_TOKEN: options.ownerToken || '',
    CONTRACTOR_AI_ROLE_TOKENS: options.roleTokens ? JSON.stringify(options.roleTokens) : '',
    CONTRACTOR_AI_LOGIN_RATE_LIMIT: String(options.loginRateLimit || 10),
    CONTRACTOR_AI_LOGIN_RATE_WINDOW_MS: '900000',
    CONTRACTOR_AI_SESSION_TTL_SECONDS: '3600',
    STATE_FILE: path.join(stateDirectory, 'state.json'),
    LEDGER_DB_FILE: path.join(stateDirectory, 'ledger.sqlite'),
    UPLOAD_DIR: path.join(stateDirectory, 'uploads')
  });
  delete process.env.DASHBOARD_AUTH_TOKEN;
  delete require.cache[require.resolve('../server')];
  return require('../server');
}

async function withServer(app, run) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const bodyText = await response.text();
  return { response, body: bodyText ? JSON.parse(bodyText) : null };
}

function sessionCookie(response) {
  const setCookie = response.headers.get('set-cookie') || '';
  return { setCookie, cookie: setCookie.split(';', 1)[0] };
}

test('browser operator session preserves role authorization without storing the access key client-side', async () => {
  const roleTokens = {
    owner: 'owner-session-token-at-least-32-characters',
    approver: 'approver-session-token-at-least-32-characters',
    office_operator: 'office-session-token-at-least-32-characters',
    field_worker: {
      token: 'field-session-token-at-least-32-characters',
      jobIds: ['job_session_scope']
    }
  };
  const app = loadServerWithAuth({ roleTokens });

  await withServer(app, async baseUrl => {
    const sessionBeforeLogin = await request(baseUrl, '/api/session');
    assert.equal(sessionBeforeLogin.response.status, 200);
    assert.deepEqual(sessionBeforeLogin.body.authentication, {
      required: true,
      authenticated: false,
      method: null,
      sessionTtlSeconds: 3600
    });

    const protectedRequest = await request(baseUrl, '/api/ledger/jobs');
    assert.equal(protectedRequest.response.status, 401);
    assert.equal(protectedRequest.body.error.code, 'authentication_required');

    const failedLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid-session-access-key' })
    });
    assert.equal(failedLogin.response.status, 401);
    assert.equal(failedLogin.body.error.code, 'authentication_failed');
    assert.equal(failedLogin.response.headers.get('set-cookie'), null);

    const login = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: roleTokens.office_operator })
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.body.authenticated, true);
    assert.equal(login.body.role, 'office_operator');
    assert.ok(Date.parse(login.body.expiresAt) > Date.now());
    const issued = sessionCookie(login.response);
    assert.match(issued.setCookie, /^contractor_ai_session=/);
    assert.match(issued.setCookie, /HttpOnly/i);
    assert.match(issued.setCookie, /SameSite=Strict/i);
    assert.match(issued.setCookie, /Max-Age=3600/i);
    assert.doesNotMatch(issued.setCookie, new RegExp(roleTokens.office_operator));
    assert.doesNotMatch(issued.setCookie, /Secure/i);

    const authenticatedSession = await request(baseUrl, '/api/session', { headers: { Cookie: issued.cookie } });
    assert.equal(authenticatedSession.response.status, 200);
    assert.equal(authenticatedSession.body.authentication.authenticated, true);
    assert.equal(authenticatedSession.body.authentication.method, 'session');
    assert.equal(authenticatedSession.body.operator.role, 'office_operator');
    assert.equal(authenticatedSession.body.operator.capabilities.intake, true);
    assert.equal(authenticatedSession.body.operator.capabilities.tenders, true);
    assert.equal(authenticatedSession.body.operator.capabilities.approvals, false);

    const permittedRead = await request(baseUrl, '/api/ledger/jobs', { headers: { Cookie: issued.cookie } });
    assert.equal(permittedRead.response.status, 200);

    const missingOrigin = await request(baseUrl, '/api/ledger/intake', {
      method: 'POST',
      headers: { Cookie: issued.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Missing origin intake', client: { name: 'Rejected browser mutation' } })
    });
    assert.equal(missingOrigin.response.status, 403);
    assert.equal(missingOrigin.body.error.code, 'session_origin_required');

    const foreignOrigin = await request(baseUrl, '/api/ledger/intake', {
      method: 'POST',
      headers: { Cookie: issued.cookie, Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Foreign origin intake', client: { name: 'Rejected browser mutation' } })
    });
    assert.equal(foreignOrigin.response.status, 403);
    assert.equal(foreignOrigin.body.error.code, 'session_origin_forbidden');

    const sameOriginMutation = await request(baseUrl, '/api/ledger/intake', {
      method: 'POST',
      headers: { Cookie: issued.cookie, Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Signed session intake', client: { name: 'Same-origin operator' } })
    });
    assert.equal(sameOriginMutation.response.status, 201);

    const deniedApproval = await request(baseUrl, '/api/ledger/approvals/not-authorized/resolve', {
      method: 'POST',
      headers: { Cookie: issued.cookie, Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' })
    });
    assert.equal(deniedApproval.response.status, 403);
    assert.equal(deniedApproval.body.error.code, 'insufficient_role');

    const tamperedCookie = `${issued.cookie.slice(0, -1)}${issued.cookie.endsWith('a') ? 'b' : 'a'}`;
    const tamperedRequest = await request(baseUrl, '/api/ledger/jobs', { headers: { Cookie: tamperedCookie } });
    assert.equal(tamperedRequest.response.status, 401);

    const logout = await request(baseUrl, '/api/auth/logout', { method: 'POST', headers: { Cookie: issued.cookie, Origin: baseUrl } });
    assert.equal(logout.response.status, 204);
    assert.match(logout.response.headers.get('set-cookie') || '', /Max-Age=0/i);

    const replayAfterLogout = await request(baseUrl, '/api/ledger/jobs', { headers: { Cookie: issued.cookie } });
    assert.equal(replayAfterLogout.response.status, 401);
    assert.equal(replayAfterLogout.body.error.code, 'authentication_required');

    const sessionAfterLogout = await request(baseUrl, '/api/session');
    assert.equal(sessionAfterLogout.body.authentication.authenticated, false);
  });
});

test('multiple named operator principals keep sessions and ledger audit actors distinct', async () => {
  const roleTokens = {
    operators: [
      { id: 'owner-main', name: 'Main owner', role: 'owner', token: 'multi-principal-owner-token-at-least-32-characters' },
      { id: 'office-utrecht', name: 'Utrecht office', role: 'office_operator', token: 'multi-principal-utrecht-token-at-least-32-characters' },
      { id: 'office-brabant', name: 'Brabant office', role: 'office_operator', token: 'multi-principal-brabant-token-at-least-32-characters' }
    ]
  };
  const app = loadServerWithAuth({ roleTokens });

  await withServer(app, async baseUrl => {
    const login = async principal => {
      const result = await request(baseUrl, '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: principal.token })
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.body.operatorId, principal.id);
      assert.equal(result.body.name, principal.name);
      return sessionCookie(result.response).cookie;
    };

    const utrechtCookie = await login(roleTokens.operators[1]);
    const brabantCookie = await login(roleTokens.operators[2]);
    assert.notEqual(utrechtCookie, brabantCookie);

    const utrechtSession = await request(baseUrl, '/api/session', { headers: { Cookie: utrechtCookie } });
    const brabantSession = await request(baseUrl, '/api/session', { headers: { Cookie: brabantCookie } });
    assert.equal(utrechtSession.body.operator.id, 'office-utrecht');
    assert.equal(utrechtSession.body.operator.name, 'Utrecht office');
    assert.equal(brabantSession.body.operator.id, 'office-brabant');
    assert.equal(brabantSession.body.operator.name, 'Brabant office');

    const createIntake = (cookie, title) => request(baseUrl, '/api/ledger/intake', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: baseUrl, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, client: { name: `${title} client` } })
    });
    const utrechtJob = await createIntake(utrechtCookie, 'Utrecht principal job');
    const brabantJob = await createIntake(brabantCookie, 'Brabant principal job');
    assert.equal(utrechtJob.response.status, 201);
    assert.equal(brabantJob.response.status, 201);

    const ownerHeaders = { Authorization: `Bearer ${roleTokens.operators[0].token}` };
    const utrechtDetail = await request(baseUrl, `/api/ledger/jobs/${utrechtJob.body.job.id}`, { headers: ownerHeaders });
    const brabantDetail = await request(baseUrl, `/api/ledger/jobs/${brabantJob.body.job.id}`, { headers: ownerHeaders });
    assert.ok(utrechtDetail.body.job.audit.some(event => event.action === 'create_intake_job' && event.actor === 'role:office_operator:office-utrecht'));
    assert.ok(brabantDetail.body.job.audit.some(event => event.action === 'create_intake_job' && event.actor === 'role:office_operator:office-brabant'));

    const capabilities = await request(baseUrl, '/api/operations/capabilities', { headers: ownerHeaders });
    assert.equal(capabilities.response.status, 200);
    assert.equal(capabilities.body.runtime.auth.configuredPrincipalCount, 3);
    assert.deepEqual(capabilities.body.runtime.auth.configuredRoles.sort(), ['office_operator', 'owner']);
  });
});

test('production operator sessions require secure transport cookies', async () => {
  const ownerToken = 'production-owner-session-token-at-least-32-characters';
  const app = loadServerWithAuth({ production: true, ownerToken });

  await withServer(app, async baseUrl => {
    const login = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: ownerToken })
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.body.role, 'owner');
    assert.match(login.response.headers.get('set-cookie') || '', /; Secure(?:;|$)/i);
    assert.equal(login.response.headers.get('cache-control'), 'no-store');
  });
});

test('operator sign-in has a dedicated bounded brute-force limiter', async () => {
  const ownerToken = 'rate-limited-owner-session-token-at-least-32-characters';
  const app = loadServerWithAuth({ ownerToken, loginRateLimit: 3 });

  await withServer(app, async baseUrl => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const denied = await request(baseUrl, '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: `pre-success-wrong-key-${attempt}` })
      });
      assert.equal(denied.response.status, 401);
      assert.equal(denied.response.headers.get('ratelimit-remaining'), String(3 - attempt));
    }

    const successful = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: ownerToken })
    });
    assert.equal(successful.response.status, 200);
    assert.equal(successful.response.headers.get('ratelimit-remaining'), '3');

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const denied = await request(baseUrl, '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: `wrong-access-key-attempt-${attempt}` })
      });
      assert.equal(denied.response.status, 401);
      assert.equal(denied.response.headers.get('ratelimit-limit'), '3');
      assert.equal(denied.response.headers.get('ratelimit-remaining'), String(3 - attempt));
    }

    const throttled = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'wrong-access-key-attempt-4' })
    });
    assert.equal(throttled.response.status, 429);
    assert.equal(throttled.body.error.code, 'authentication_rate_limited');
    assert.equal(throttled.response.headers.get('ratelimit-remaining'), '0');
    assert.ok(Number(throttled.response.headers.get('retry-after')) > 0);
    assert.ok(throttled.response.headers.get('x-request-id'));
  });
});
