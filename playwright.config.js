const path = require('node:path');
const { defineConfig } = require('@playwright/test');

if (!process.env.CONTRACTOR_AI_BROWSER_RUNTIME_DIR) {
  throw new Error('Run browser tests through npm run test:browser so the temporary ledger is cleaned after Playwright exits.');
}
const runtimeDirectory = path.resolve(process.env.CONTRACTOR_AI_BROWSER_RUNTIME_DIR);
const localRuntimeDirectory = path.join(runtimeDirectory, 'local');
const authRuntimeDirectory = path.join(runtimeDirectory, 'auth');
function configuredPort(name) {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error(`${name} must be an allocated TCP port between 1024 and 65535.`);
  }
  return value;
}
const localPort = configuredPort('CONTRACTOR_AI_BROWSER_LOCAL_PORT');
const authPort = configuredPort('CONTRACTOR_AI_BROWSER_AUTH_PORT');
if (localPort === authPort) throw new Error('Browser test servers require distinct ports.');
const browserRoleTokens = JSON.stringify({
  owner: 'browser-owner-token-at-least-32-characters',
  office_operator: 'browser-office-token-at-least-32-characters',
  field_worker: {
    token: 'browser-field-token-at-least-32-characters',
    workerId: 'browser-field-task-worker'
  }
});

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${localPort}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'operator-workflows',
      testIgnore: '**/auth-session.spec.js'
    },
    {
      name: 'operator-auth',
      testMatch: '**/auth-session.spec.js',
      use: { baseURL: `http://127.0.0.1:${authPort}` }
    }
  ],
  webServer: [
    {
      command: 'node server.js',
      url: `http://127.0.0.1:${localPort}/api/readiness`,
      reuseExistingServer: false,
      env: {
        ...process.env,
        PORT: String(localPort),
        STATE_FILE: path.join(localRuntimeDirectory, 'legacy-state.json'),
        LEDGER_DB_FILE: path.join(localRuntimeDirectory, 'ledger.sqlite'),
        UPLOAD_DIR: path.join(localRuntimeDirectory, 'uploads'),
        CONTRACTOR_AI_REQUIRE_AUTH: 'false',
        CONTRACTOR_AI_AUTH_TOKEN: '',
        CONTRACTOR_AI_ROLE_TOKENS: '',
        CONTRACTOR_AI_RATE_LIMIT: process.env.CONTRACTOR_AI_RATE_LIMIT || '10000',
        CONTRACTOR_AI_VERIFIED_INTEGRATIONS: 'playwright_test_provider'
      }
    },
    {
      command: 'node server.js',
      url: `http://127.0.0.1:${authPort}/api/health/ready`,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(authPort),
        STATE_FILE: path.join(authRuntimeDirectory, 'legacy-state.json'),
        LEDGER_DB_FILE: path.join(authRuntimeDirectory, 'ledger.sqlite'),
        UPLOAD_DIR: path.join(authRuntimeDirectory, 'uploads'),
        CONTRACTOR_AI_REQUIRE_AUTH: 'true',
        CONTRACTOR_AI_AUTH_TOKEN: '',
        CONTRACTOR_AI_ROLE_TOKENS: browserRoleTokens,
        CONTRACTOR_AI_RATE_LIMIT: process.env.CONTRACTOR_AI_RATE_LIMIT || '10000'
      }
    }
  ]
});
