const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const STANDALONE_CONFIG_FORMAT = 'contractor-ai-windows-standalone/v1';

function standaloneRoot(environment = process.env) {
  const configured = String(environment.CONTRACTOR_AI_STANDALONE_ROOT || '').trim();
  if (configured) return path.resolve(configured);
  const localAppData = String(environment.LOCALAPPDATA || '').trim();
  return path.join(localAppData || os.homedir(), 'ContractorAI');
}

function standalonePaths(environment = process.env) {
  const root = standaloneRoot(environment);
  return {
    root,
    configFile: path.join(root, 'config', 'runtime.json'),
    dataDir: path.join(root, 'data'),
    ledgerFile: path.join(root, 'data', 'contractor-ledger.sqlite'),
    uploadDir: path.join(root, 'data', 'uploads')
  };
}

function validPort(value, fallback = 3000) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) return fallback;
  return parsed;
}

function protectWindowsFile(file) {
  try { fs.chmodSync(file, 0o600); } catch { /* Windows ACL hardening below remains authoritative. */ }
  if (process.platform !== 'win32') return;
  const username = String(process.env.USERNAME || '').trim();
  if (!username) return;
  spawnSync('icacls.exe', [file, '/inheritance:r', '/grant:r', `${username}:(R,W)`], {
    windowsHide: true,
    stdio: 'ignore'
  });
}

function readStandaloneConfig(configFile) {
  const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (parsed.format !== STANDALONE_CONFIG_FORMAT) throw new Error('Unsupported Contractor.AI standalone configuration format.');
  if (typeof parsed.ownerToken !== 'string' || parsed.ownerToken.length < 32) throw new Error('Standalone owner access key is invalid.');
  return { ...parsed, port: validPort(parsed.port) };
}

function ensureStandaloneConfig(options = {}) {
  const paths = standalonePaths(options.environment);
  fs.mkdirSync(path.dirname(paths.configFile), { recursive: true });
  fs.mkdirSync(paths.uploadDir, { recursive: true });
  let created = false;
  let config;
  try {
    config = readStandaloneConfig(paths.configFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    created = true;
    config = {
      format: STANDALONE_CONFIG_FORMAT,
      ownerToken: crypto.randomBytes(32).toString('base64url'),
      port: validPort(options.port || options.environment?.PORT || process.env.PORT),
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }
  protectWindowsFile(paths.configFile);
  return { config, created, paths };
}

function applyStandaloneEnvironment(options = {}) {
  const environment = options.environment || process.env;
  const runtime = ensureStandaloneConfig({ environment, port: options.port });
  Object.assign(environment, {
    NODE_ENV: 'production',
    PORT: String(runtime.config.port),
    CONTRACTOR_AI_RUNTIME_MODE: 'local',
    CONTRACTOR_AI_STORAGE_MODE: 'local',
    CONTRACTOR_AI_REQUIRE_AUTH: 'true',
    CONTRACTOR_AI_AUTH_TOKEN: runtime.config.ownerToken,
    CONTRACTOR_AI_BIND_HOST: '127.0.0.1',
    CONTRACTOR_AI_DATA_DIR: runtime.paths.dataDir,
    LEDGER_DB_FILE: runtime.paths.ledgerFile,
    UPLOAD_DIR: runtime.paths.uploadDir,
    CORS_ORIGINS: `http://127.0.0.1:${runtime.config.port},http://localhost:${runtime.config.port}`
  });
  delete environment.STATE_FILE;
  return runtime;
}

module.exports = {
  STANDALONE_CONFIG_FORMAT,
  applyStandaloneEnvironment,
  ensureStandaloneConfig,
  readStandaloneConfig,
  standalonePaths,
  validPort
};
