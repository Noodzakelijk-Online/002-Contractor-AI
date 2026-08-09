const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const {
  ContractorOperatingLedger,
  LEDGER_CAPABILITY_BLUEPRINT,
  BID_DECISION_CRITERIA,
  BID_DECISION_GATES,
  RISK_REGISTER_CATEGORIES,
  RISK_RESPONSE_STRATEGIES,
  PRICING_BASIS_FACTORS,
  MARKET_FIT_CRITERIA,
  PERFORMANCE_SCORECARD_POINT_IN_TIME_METRICS,
  JOB_OPERATING_PLAYBOOKS
} = require('./operating-ledger');
const { OpenMeteoWeatherService } = require('./weather-service');
const { EvidenceStorageError, createEvidenceStorage } = require('./evidence-storage');
const { verifySqliteBackupDatabase } = require('./scripts/restore-local-backup');
const { boundedFeedLimit, buildHaiFeed, connectorManifest } = require('./hai-connector');
const packageMetadata = require('./package.json');

const app = express();
const port = process.env.PORT || 3000;
const configuredBindHost = String(process.env.CONTRACTOR_AI_BIND_HOST || '').trim();
const weatherService = new OpenMeteoWeatherService({
  enabled: process.env.WEATHER_PROVIDER_ENABLED !== 'false'
});
const configuredStateFile = process.env.STATE_FILE ? path.resolve(process.env.STATE_FILE) : null;
const dataDir = process.env.CONTRACTOR_AI_DATA_DIR
  ? path.resolve(process.env.CONTRACTOR_AI_DATA_DIR)
  : configuredStateFile
    ? path.dirname(configuredStateFile)
    : path.join(__dirname, 'data');
const distDir = path.join(__dirname, 'dist');
const runtimeMode = String(process.env.CONTRACTOR_AI_RUNTIME_MODE || 'local').trim().toLowerCase();
const storageMode = String(process.env.CONTRACTOR_AI_STORAGE_MODE || 'local').trim().toLowerCase();
const trustedProxyRaw = String(process.env.CONTRACTOR_AI_TRUST_PROXY || '').trim();
const trustedProxyEntries = trustedProxyRaw.split(',').map(value => value.trim()).filter(Boolean);
let trustedProxyError = null;
if (trustedProxyRaw) {
  const unsafeShortcut = trustedProxyEntries.some(value => /^(?:true|false|\d+|\*|0\.0\.0\.0\/0|::\/0)$/i.test(value));
  try {
    if (unsafeShortcut || trustedProxyEntries.length === 0) {
      throw new Error('Use explicit proxy IP addresses, CIDR ranges, or Express subnet names instead of a universal or hop-count trust rule.');
    }
    app.set('trust proxy', trustedProxyEntries.join(', '));
  } catch (error) {
    trustedProxyError = error;
    app.set('trust proxy', false);
  }
} else {
  app.set('trust proxy', false);
}
const hostedDatabaseUrl = runtimeMode === 'hosted' ? String(process.env.CONTRACTOR_AI_DATABASE_URL || '').trim() : '';
const hostedPublicUrl = String(process.env.CONTRACTOR_AI_PUBLIC_URL || '').trim();
const hostedPublicUrlDetails = (() => {
  if (!hostedPublicUrl) return { protocol: '', origin: '', valid: false };
  try {
    const url = new URL(hostedPublicUrl);
    return {
      protocol: url.protocol,
      origin: url.origin,
      valid: !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
    };
  } catch {
    return { protocol: 'invalid', origin: '', valid: false };
  }
})();
const hostingProvider = String(process.env.CONTRACTOR_AI_HOSTING_PROVIDER || '').trim();
const hostingRegion = String(process.env.CONTRACTOR_AI_HOSTING_REGION || '').trim();
const dataResidency = String(process.env.CONTRACTOR_AI_DATA_RESIDENCY || '').trim().toUpperCase();
const dpaReference = String(process.env.CONTRACTOR_AI_DPA_REFERENCE || '').trim();
const postgresBackupMode = String(process.env.CONTRACTOR_AI_POSTGRES_BACKUP_MODE || '').trim().toLowerCase();
const objectVersioningEnabled = process.env.CONTRACTOR_AI_OBJECT_VERSIONING_ENABLED === 'true';
const backupPolicyReference = String(process.env.CONTRACTOR_AI_BACKUP_POLICY_REFERENCE || '').trim();
const retentionPolicyReference = String(process.env.CONTRACTOR_AI_RETENTION_POLICY_REFERENCE || '').trim();
const releaseSha = String(process.env.CONTRACTOR_AI_RELEASE_SHA || '').trim();
const hostedDatabaseSslMode = (() => {
  if (!hostedDatabaseUrl) return '';
  try {
    return String(new URL(hostedDatabaseUrl).searchParams.get('sslmode') || 'verify-full').trim().toLowerCase();
  } catch {
    return 'invalid';
  }
})();
const stateFile = configuredStateFile
  ? configuredStateFile
  : path.join(dataDir, 'server-state.json');
const ledgerFile = process.env.LEDGER_DB_FILE
  ? path.resolve(process.env.LEDGER_DB_FILE)
  : path.join(dataDir, 'contractor-ledger.sqlite');
const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(dataDir, 'uploads');
const evidenceStorageOptions = {
  endpoint: process.env.CONTRACTOR_AI_S3_ENDPOINT,
  bucket: process.env.CONTRACTOR_AI_S3_BUCKET,
  region: process.env.CONTRACTOR_AI_S3_REGION || 'eu-central-1',
  accessKeyId: process.env.CONTRACTOR_AI_S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.CONTRACTOR_AI_S3_SECRET_ACCESS_KEY,
  prefix: process.env.CONTRACTOR_AI_S3_PREFIX || 'contractor-ai/evidence',
  timeoutMs: process.env.CONTRACTOR_AI_STORAGE_TIMEOUT_MS
};
let evidenceStorage;
let evidenceStorageInitError = null;
try {
  evidenceStorage = createEvidenceStorage({ mode: storageMode, rootDir: uploadDir, projectRoot: __dirname, s3: evidenceStorageOptions });
} catch (error) {
  evidenceStorageInitError = error;
}
const evidenceStorageEndpointProtocol = (() => {
  if (!evidenceStorageOptions.endpoint) return '';
  try {
    return new URL(evidenceStorageOptions.endpoint).protocol;
  } catch {
    return 'invalid';
  }
})();
const evidenceStorageVerificationTtlMs = Math.max(5_000, Number(process.env.CONTRACTOR_AI_STORAGE_VERIFY_TTL_MS || 60_000));
const ledgerDiagnosticsCacheTtlMs = boundedInteger(process.env.CONTRACTOR_AI_DIAGNOSTICS_CACHE_TTL_MS, 2_000, 250, 30_000);
let evidenceStorageVerificationCache = evidenceStorageInitError
  ? {
      ready: false,
      status: 'unavailable',
      mode: storageMode,
      checkedAt: new Date().toISOString(),
      code: evidenceStorageInitError.code || 'storage_initialization_failed'
    }
  : null;
let evidenceStorageVerificationPromise = null;
let ledgerDiagnosticsCache = null;
const maxUploadBytes = Math.max(1024, Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024));
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const isProduction = process.env.NODE_ENV === 'production';
const dashboardAuthRequired = isProduction || process.env.CONTRACTOR_AI_REQUIRE_AUTH === 'true';
const dashboardAuthToken = process.env.CONTRACTOR_AI_AUTH_TOKEN || process.env.DASHBOARD_AUTH_TOKEN || '';
const minimumOperatorTokenLength = 32;
const roleTokenConfig = parseRoleTokens(process.env.CONTRACTOR_AI_ROLE_TOKENS);
const operatorSessionCookieName = 'contractor_ai_session';
const operatorSessionTtlSeconds = boundedInteger(process.env.CONTRACTOR_AI_SESSION_TTL_SECONDS, 28_800, 900, 86_400);
const authLoginRateWindowMs = boundedInteger(process.env.CONTRACTOR_AI_LOGIN_RATE_WINDOW_MS, 900_000, 60_000, 86_400_000);
const authLoginRateLimit = boundedInteger(process.env.CONTRACTOR_AI_LOGIN_RATE_LIMIT, 10, 3, 100);
const operatorSessionSigningKey = createOperatorSessionSigningKey();
const httpKeepAliveTimeoutMs = boundedInteger(process.env.CONTRACTOR_AI_HTTP_KEEP_ALIVE_TIMEOUT_MS, 65_000, 5_000, 300_000);
const httpHeadersTimeoutMs = boundedInteger(
  process.env.CONTRACTOR_AI_HTTP_HEADERS_TIMEOUT_MS,
  70_000,
  httpKeepAliveTimeoutMs + 1_000,
  310_000
);
const verifiedIntegrationIds = new Set(
  String(process.env.CONTRACTOR_AI_VERIFIED_INTEGRATIONS || '').split(',').map(value => value.trim()).filter(Boolean)
);
const autonomousSchedulerEnabled = process.env.CONTRACTOR_AI_AUTONOMOUS_SCHEDULER_ENABLED === 'true';
const autonomousSchedulerIntervalSeconds = Math.max(30, Number(process.env.CONTRACTOR_AI_AUTONOMOUS_INTERVAL_SECONDS || 300));
const autonomousSchedulerLeaseSeconds = Math.max(30, Number(process.env.CONTRACTOR_AI_AUTONOMOUS_LEASE_SECONDS || 120));
const AUTONOMOUS_SCHEDULER_KEY = 'ledger_autonomous_cycle';
const apiRateWindowMs = boundedInteger(process.env.CONTRACTOR_AI_RATE_WINDOW_MS, 60_000, 1_000, 86_400_000);
const apiRateLimit = boundedInteger(process.env.CONTRACTOR_AI_RATE_LIMIT, 1_000, 50, 1_000_000);
const apiRateBucketLimit = boundedInteger(process.env.CONTRACTOR_AI_RATE_BUCKET_LIMIT, 5_000, 100, 100_000);
const apiRateSigningKey = configuredOperatorTokens().length
  ? operatorSessionSigningKey
  : crypto.createHash('sha256').update('contractor-ai-local-api-rate\0').update(path.resolve(ledgerFile)).digest();
function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function configureHttpServer(server) {
  if (!server) return server;
  server.keepAliveTimeout = httpKeepAliveTimeoutMs;
  server.headersTimeout = httpHeadersTimeoutMs;
  return server;
}

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isTemplatePlaceholder(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.includes('replace-with')
    || normalized.includes('example-provider')
    || normalized.includes('contractor.example.eu');
}

function isConfiguredReference(value, minimumLength = 8) {
  const normalized = String(value || '').trim();
  return normalized.length >= minimumLength && !isTemplatePlaceholder(normalized);
}

function isStrongOperatorToken(value) {
  return typeof value === 'string'
    && value.length >= minimumOperatorTokenLength
    && value === value.trim()
    && !isTemplatePlaceholder(value);
}

function runtimeConfiguration(options = {}) {
  const issues = [];
  const hosted = runtimeMode === 'hosted';
  const storageVerification = options.storageVerification ?? evidenceStorageVerificationCache;
  const hasConfiguredAuthToken = isStrongOperatorToken(dashboardAuthToken) || roleTokenConfig.principals.length > 0;
  const templateValues = [
    ['authentication', dashboardAuthToken],
    ['database', hostedDatabaseUrl],
    ['public_url', hostedPublicUrl],
    ['hosting_provider', hostingProvider],
    ['hosting_region', hostingRegion],
    ['dpa_reference', dpaReference],
    ['backup_policy_reference', backupPolicyReference],
    ['retention_policy_reference', retentionPolicyReference],
    ['trusted_proxy', trustedProxyRaw],
    ['cors', process.env.CORS_ORIGINS],
    ['object_storage_endpoint', evidenceStorageOptions.endpoint],
    ['object_storage_bucket', evidenceStorageOptions.bucket],
    ['object_storage_access_key', evidenceStorageOptions.accessKeyId],
    ['object_storage_secret', evidenceStorageOptions.secretAccessKey]
  ].filter(([, value]) => isTemplatePlaceholder(value)).map(([key]) => key);
  if (!['local', 'hosted'].includes(runtimeMode)) {
    issues.push({ code: 'invalid_runtime_mode', message: 'CONTRACTOR_AI_RUNTIME_MODE must be local or hosted.' });
  }
  if (!['local', 's3'].includes(storageMode)) {
    issues.push({ code: 'invalid_storage_mode', message: 'CONTRACTOR_AI_STORAGE_MODE must be local or s3.' });
  }
  if (hosted && !dashboardAuthRequired) {
    issues.push({ code: 'hosted_auth_required', message: 'Hosted mode requires dashboard/API authentication.' });
  }
  if (roleTokenConfig.issues.length) {
    issues.push(...roleTokenConfig.issues);
  }
  if (dashboardAuthToken && !isStrongOperatorToken(dashboardAuthToken)) {
    issues.push({
      code: 'weak_auth_token',
      message: `CONTRACTOR_AI_AUTH_TOKEN must be an unpadded, non-template secret containing at least ${minimumOperatorTokenLength} characters.`
    });
  }
  const legacyOwnerTokenConflict = isStrongOperatorToken(dashboardAuthToken)
    ? roleTokenConfig.principals.find(principal => principal.token === dashboardAuthToken && principal.role !== 'owner')
    : null;
  if (legacyOwnerTokenConflict) {
    issues.push({
      code: 'ambiguous_owner_token',
      message: `CONTRACTOR_AI_AUTH_TOKEN cannot also identify the ${legacyOwnerTokenConflict.id} ${legacyOwnerTokenConflict.role} principal.`
    });
  }
  if (isProduction && !hasConfiguredAuthToken) {
    issues.push({ code: 'production_auth_token_required', message: 'Production requires a strong CONTRACTOR_AI_AUTH_TOKEN or role token configuration.' });
  }
  if (isProduction && templateValues.length) {
    issues.push({ code: 'template_placeholder_configured', message: `Production configuration contains template placeholder values for: ${templateValues.join(', ')}.` });
  }
  if (hosted && !hasConfiguredAuthToken) {
    issues.push({ code: 'hosted_auth_token_required', message: 'Hosted mode requires a strong authentication token or role token configuration.' });
  }
  if (hosted && (!hostedPublicUrlDetails.valid || hostedPublicUrlDetails.protocol !== 'https:')) {
    issues.push({ code: 'hosted_public_https_required', message: 'Hosted mode requires CONTRACTOR_AI_PUBLIC_URL to be an HTTPS origin without credentials, query parameters, or a path.' });
  }
  if (hosted && hostedPublicUrlDetails.origin && !allowedOrigins.includes(hostedPublicUrlDetails.origin)) {
    issues.push({ code: 'hosted_public_origin_not_allowed', message: 'CORS_ORIGINS must include the exact CONTRACTOR_AI_PUBLIC_URL origin.' });
  }
  if (trustedProxyError) {
    issues.push({ code: 'invalid_trusted_proxy', message: trustedProxyError.message || 'CONTRACTOR_AI_TRUST_PROXY is invalid.' });
  } else if (hosted && trustedProxyEntries.length === 0) {
    issues.push({ code: 'hosted_trusted_proxy_required', message: 'Hosted mode requires an explicit CONTRACTOR_AI_TRUST_PROXY ingress IP, CIDR range, or named subnet.' });
  }
  if (hosted && !isConfiguredReference(hostingProvider, 2)) {
    issues.push({ code: 'hosted_provider_required', message: 'Hosted mode requires the contracted EU hosting provider name in CONTRACTOR_AI_HOSTING_PROVIDER.' });
  }
  if (hosted && !isConfiguredReference(hostingRegion, 2)) {
    issues.push({ code: 'hosted_region_required', message: 'Hosted mode requires the provider region in CONTRACTOR_AI_HOSTING_REGION.' });
  }
  if (hosted && dataResidency !== 'EU') {
    issues.push({ code: 'hosted_eu_residency_required', message: 'Hosted mode requires an explicit CONTRACTOR_AI_DATA_RESIDENCY=EU declaration.' });
  }
  if (hosted && !isConfiguredReference(dpaReference)) {
    issues.push({ code: 'hosted_dpa_required', message: 'Hosted mode requires a retained DPA reference in CONTRACTOR_AI_DPA_REFERENCE.' });
  }
  if (hosted && !['snapshot', 'pitr'].includes(postgresBackupMode)) {
    issues.push({ code: 'hosted_postgres_backup_required', message: 'Hosted mode requires CONTRACTOR_AI_POSTGRES_BACKUP_MODE to be snapshot or pitr.' });
  }
  if (hosted && !objectVersioningEnabled) {
    issues.push({ code: 'hosted_object_versioning_required', message: 'Hosted mode requires versioning on the private evidence bucket and CONTRACTOR_AI_OBJECT_VERSIONING_ENABLED=true.' });
  }
  if (hosted && !isConfiguredReference(backupPolicyReference)) {
    issues.push({ code: 'hosted_backup_policy_required', message: 'Hosted mode requires a retained recovery-policy reference in CONTRACTOR_AI_BACKUP_POLICY_REFERENCE.' });
  }
  if (hosted && !isConfiguredReference(retentionPolicyReference)) {
    issues.push({ code: 'hosted_retention_policy_required', message: 'Hosted mode requires a retained data-retention policy reference in CONTRACTOR_AI_RETENTION_POLICY_REFERENCE.' });
  }
  if (hosted && storageMode !== 's3') {
    issues.push({ code: 'durable_object_storage_required', message: 'Hosted mode requires S3-compatible EU object storage for evidence files.' });
  }
  if (hosted && storageMode === 's3' && evidenceStorageEndpointProtocol !== 'https:') {
    issues.push({ code: 'hosted_object_storage_tls_required', message: 'Hosted mode requires an HTTPS S3-compatible object storage endpoint.' });
  }
  if (evidenceStorageInitError) {
    issues.push({ code: evidenceStorageInitError.code || 'storage_initialization_failed', message: evidenceStorageInitError.message });
  }
  if (hosted && storageMode === 's3' && !storageVerification) {
    issues.push({ code: 'object_storage_verification_pending', message: 'Hosted object storage has not completed a read/write verification.' });
  } else if (storageVerification && !storageVerification.ready) {
    issues.push({
      code: storageVerification.code || 'object_storage_unavailable',
      message: 'Evidence storage is not currently readable and writable.'
    });
  }
  if (hosted && !hostedDatabaseUrl) {
    issues.push({ code: 'durable_database_required', message: 'Hosted mode requires CONTRACTOR_AI_DATABASE_URL for the managed PostgreSQL migration target.' });
  }
  if (hosted && ['disable', 'allow', 'prefer', 'invalid'].includes(hostedDatabaseSslMode)) {
    issues.push({ code: 'hosted_postgres_tls_required', message: 'Hosted mode requires a valid PostgreSQL connection with TLS required; use sslmode=require or verify-full.' });
  }
  if (hosted && operatingLedger?.databaseMode !== 'postgres') {
    issues.push({ code: 'hosted_postgres_adapter_required', message: 'Hosted mode requires the PostgreSQL ledger adapter.' });
  }
  return {
    mode: runtimeMode,
    storageMode,
    databaseMode: operatingLedger?.databaseMode || (hostedDatabaseUrl ? 'postgres' : 'sqlite'),
    exposure: {
      bindHost: configuredBindHost || null,
      loopbackOnly: ['127.0.0.1', '::1', 'localhost'].includes(configuredBindHost.toLowerCase()),
      publicTunnel: runtimeMode === 'local' && process.env.CONTRACTOR_AI_NGROK_ACTIVE === 'true',
      publicOrigin: hostedPublicUrlDetails.valid ? hostedPublicUrlDetails.origin : null
    },
    auth: {
      required: dashboardAuthRequired,
      legacyOwnerTokenConfigured: isStrongOperatorToken(dashboardAuthToken),
      minimumTokenLength: minimumOperatorTokenLength,
      configuredRoles: [...new Set(roleTokenConfig.principals.map(principal => principal.role))],
      configuredPrincipalCount: configuredOperatorTokens().length,
      loginRateLimit: {
        durability: 'ledger',
        keyMaterial: 'hmac-sha256',
        limit: authLoginRateLimit,
        windowMs: authLoginRateWindowMs,
        successfulLoginResetsFailures: true,
        multiReplicaSafe: true
      }
    },
    hosting: {
      publicHttps: hostedPublicUrlDetails.protocol === 'https:' && hostedPublicUrlDetails.valid,
      publicOriginAllowed: Boolean(hostedPublicUrlDetails.origin && allowedOrigins.includes(hostedPublicUrlDetails.origin)),
      trustedProxyConfigured: trustedProxyEntries.length > 0 && !trustedProxyError,
      trustedProxyEntryCount: trustedProxyError ? 0 : trustedProxyEntries.length,
      provider: hostingProvider || null,
      region: hostingRegion || null,
      dataResidency: dataResidency || null,
      dpaConfigured: isConfiguredReference(dpaReference),
      recovery: {
        postgresBackupMode: ['snapshot', 'pitr'].includes(postgresBackupMode) ? postgresBackupMode : null,
        objectVersioningEnabled,
        policyConfigured: isConfiguredReference(backupPolicyReference)
      },
      retentionPolicyConfigured: isConfiguredReference(retentionPolicyReference)
    },
    evidenceStorage: {
      status: storageVerification?.status || 'unverified',
      verified: Boolean(storageVerification?.ready),
      checkedAt: storageVerification?.checkedAt || null,
      code: storageVerification?.code || null
    },
    autonomousScheduler: {
      enabled: autonomousSchedulerEnabled,
      intervalSeconds: autonomousSchedulerIntervalSeconds
    },
    requestRateLimit: {
      durability: 'ledger',
      keyMaterial: 'hmac-sha256-bucket',
      limit: apiRateLimit,
      windowMs: apiRateWindowMs,
      bucketCount: apiRateBucketLimit,
      boundedCardinality: true,
      multiReplicaSafe: true
    },
    ready: issues.length === 0,
    issues
  };
}

function setSecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "connect-src 'self'"
  ].join('; '));
  if (req.path === '/client-portal.html') res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

function attachRequestContext(req, res, next) {
  const incomingRequestId = req.headers['x-request-id'];
  req.requestId = typeof incomingRequestId === 'string' && incomingRequestId.trim()
    ? incomingRequestId.trim().slice(0, 100)
    : createRequestId();
  res.setHeader('X-Request-Id', req.requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    if (!req.path.startsWith('/api')) return;
    const statusCode = res.statusCode;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    log(level, 'api_request', {
      requestId: req.requestId,
      method: req.method,
      path: logSafeRequestPath(req),
      statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  next();
}

function rateLimitApi(req, res, next) {
  if (!req.path.startsWith('/api/') || req.path === '/api/health/ready') return next();
  try {
    const state = operatingLedger.recordApiRateLimitRequest(apiRateLimitKey(req), {
      limit: apiRateLimit,
      windowMs: apiRateWindowMs
    });
    const resetSeconds = setApiRateLimitHeaders(res, state);
    if (state.limited) {
      res.setHeader('Retry-After', String(resetSeconds));
      return sendError(req, res, 429, 'rate_limited', 'Too many requests. Try again shortly.');
    }
    return next();
  } catch (error) {
    log('error', 'api_rate_limit_unavailable', { requestId: req.requestId, error: serializeError(error) });
    return sendError(req, res, 503, 'api_rate_limit_unavailable', 'Request protection is temporarily unavailable.');
  }
}

function apiRateLimitKey(req) {
  const remoteAddress = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const clientDigest = crypto.createHmac('sha256', apiRateSigningKey)
    .update('contractor-ai-api-client\0')
    .update(remoteAddress)
    .digest();
  const bucket = clientDigest.readUInt32BE(0) % apiRateBucketLimit;
  return crypto.createHmac('sha256', apiRateSigningKey)
    .update('contractor-ai-api-bucket\0')
    .update(String(bucket))
    .digest('hex');
}

function setApiRateLimitHeaders(res, state) {
  const resetSeconds = Math.max(1, Math.ceil((Date.parse(state.expiresAt) - Date.now()) / 1000));
  res.setHeader('RateLimit-Limit', String(state.limit));
  res.setHeader('RateLimit-Remaining', String(state.remaining));
  res.setHeader('RateLimit-Reset', String(resetSeconds));
  res.setHeader('RateLimit-Policy', `${state.limit};w=${Math.ceil(apiRateWindowMs / 1000)}`);
  return resetSeconds;
}

function authenticationRateLimitKey(req) {
  const remoteAddress = String(req.ip || req.socket?.remoteAddress || 'unknown');
  return crypto.createHmac('sha256', operatorSessionSigningKey).update('contractor-ai-auth-login\0').update(remoteAddress).digest('hex');
}

function setAuthenticationRateLimitHeaders(res, state) {
  const resetSeconds = Math.max(1, Math.ceil((Date.parse(state.expiresAt) - Date.now()) / 1000));
  res.setHeader('RateLimit-Limit', String(authLoginRateLimit));
  res.setHeader('RateLimit-Remaining', String(state.remaining));
  res.setHeader('RateLimit-Reset', String(resetSeconds));
  res.setHeader('RateLimit-Policy', `${authLoginRateLimit};w=${Math.ceil(authLoginRateWindowMs / 1000)}`);
  return resetSeconds;
}

function authenticationRateLimitUnavailable(req, res, error) {
  log('error', 'authentication_rate_limit_unavailable', { requestId: req.requestId, error: serializeError(error) });
  return sendError(req, res, 503, 'authentication_rate_limit_unavailable', 'Sign-in protection is temporarily unavailable.');
}

function rateLimitAuthLogin(req, res, next) {
  try {
    const keyHash = authenticationRateLimitKey(req);
    const state = operatingLedger.getAuthenticationRateLimit(keyHash, {
      limit: authLoginRateLimit,
      windowMs: authLoginRateWindowMs
    });
    req.authenticationRateLimit = { keyHash };
    const resetSeconds = setAuthenticationRateLimitHeaders(res, state);
    if (state.limited) {
      res.setHeader('Retry-After', String(resetSeconds));
      return sendError(req, res, 429, 'authentication_rate_limited', 'Too many sign-in attempts. Try again later.');
    }
    return next();
  } catch (error) {
    return authenticationRateLimitUnavailable(req, res, error);
  }
}

function recordAuthenticationFailure(req, res) {
  try {
    const state = operatingLedger.recordAuthenticationFailure(req.authenticationRateLimit.keyHash, {
      limit: authLoginRateLimit,
      windowMs: authLoginRateWindowMs
    });
    const resetSeconds = setAuthenticationRateLimitHeaders(res, state);
    if (state.attemptCount > authLoginRateLimit) {
      res.setHeader('Retry-After', String(resetSeconds));
      return sendError(req, res, 429, 'authentication_rate_limited', 'Too many sign-in attempts. Try again later.');
    }
    return sendError(req, res, 401, 'authentication_failed', 'The supplied access key is not valid.');
  } catch (error) {
    return authenticationRateLimitUnavailable(req, res, error);
  }
}

function validateEvidenceUpload(file) {
  const mimeType = String(file?.mimeType || '').toLowerCase();
  const extension = path.extname(String(file?.originalName || '')).toLowerCase();
  const allowed = new Map([
    ['image/jpeg', new Set(['.jpg', '.jpeg'])],
    ['image/png', new Set(['.png'])],
    ['image/webp', new Set(['.webp'])],
    ['application/pdf', new Set(['.pdf'])],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', new Set(['.docx'])]
  ]);
  if (allowed.get(mimeType)?.has(extension) !== true) {
    return { valid: false, code: 'unsupported_upload_type', message: 'Evidence uploads must be JPEG, PNG, WebP, PDF, or DOCX with a matching filename extension.' };
  }

  const bytes = Buffer.isBuffer(file?.buffer) ? file.buffer : Buffer.from(file?.buffer || '');
  const startsWith = signature => bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(Buffer.from(signature));
  const signatureMatches = (
    (mimeType === 'image/jpeg' && startsWith([0xff, 0xd8, 0xff])) ||
    (mimeType === 'image/png' && startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (mimeType === 'image/webp' && startsWith([0x52, 0x49, 0x46, 0x46]) && bytes.subarray(8, 12).equals(Buffer.from('WEBP'))) ||
    (mimeType === 'application/pdf' && startsWith('%PDF-')) ||
    (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && startsWith([0x50, 0x4b, 0x03, 0x04]))
  );
  if (!signatureMatches) {
    return { valid: false, code: 'upload_signature_mismatch', message: 'The file contents do not match the declared evidence type.' };
  }
  return { valid: true };
}

function sanitizeUploadFilename(value) {
  const base = path.basename(String(value || 'upload.bin')).replace(/[^\w.\- ]+/g, '_').trim();
  const normalized = base.replace(/\s+/g, '-').slice(0, 120);
  return normalized || 'upload.bin';
}

function safeFieldName(value) {
  return String(value || '').replace(/[^\w.\-:[\]]+/g, '').slice(0, 120);
}

class UploadRequestError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function readRequestBuffer(req, limitBytes = maxUploadBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new UploadRequestError(413, 'upload_too_large', `Upload exceeds ${limitBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipartDisposition(value = '') {
  const result = {};
  for (const part of String(value).split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey || !rawValue.length) continue;
    const key = rawKey.trim().toLowerCase();
    const joined = rawValue.join('=').trim();
    result[key] = joined.replace(/^"|"$/g, '');
  }
  return result;
}

function parseMultipartBody(buffer, contentType = '') {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) {
    throw new UploadRequestError(400, 'missing_multipart_boundary', 'Multipart boundary is missing');
  }

  const body = buffer.toString('latin1');
  const delimiter = `--${boundary}`;
  const parts = body.split(delimiter).slice(1, -1);
  const fields = {};
  const files = [];

  for (let rawPart of parts) {
    if (rawPart.startsWith('\r\n')) rawPart = rawPart.slice(2);
    if (rawPart.endsWith('\r\n')) rawPart = rawPart.slice(0, -2);
    const headerEnd = rawPart.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headerLines = rawPart.slice(0, headerEnd).split('\r\n');
    const headers = {};
    for (const line of headerLines) {
      const separator = line.indexOf(':');
      if (separator === -1) continue;
      headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }

    const disposition = parseMultipartDisposition(headers['content-disposition']);
    const fieldName = safeFieldName(disposition.name);
    if (!fieldName) continue;

    const content = rawPart.slice(headerEnd + 4);
    if (disposition.filename !== undefined) {
      const originalName = sanitizeUploadFilename(disposition.filename);
      const bytes = Buffer.from(content, 'latin1');
      if (!bytes.length || !originalName) continue;
      files.push({
        fieldName,
        originalName,
        mimeType: headers['content-type'] || 'application/octet-stream',
        size: bytes.length,
        buffer: bytes
      });
      continue;
    }

    const value = Buffer.from(content, 'latin1').toString('utf8');
    if (fields[fieldName] === undefined) {
      fields[fieldName] = value;
    } else if (Array.isArray(fields[fieldName])) {
      fields[fieldName].push(value);
    } else {
      fields[fieldName] = [fields[fieldName], value];
    }
  }

  return { fields, files };
}

async function storeUploadedFile(file) {
  const validation = validateEvidenceUpload(file);
  if (!validation.valid) {
    throw new UploadRequestError(415, validation.code, validation.message);
  }
  if (!evidenceStorage) {
    throw new UploadRequestError(503, evidenceStorageInitError?.code || 'storage_unavailable', evidenceStorageInitError?.message || 'Evidence storage is unavailable.');
  }
  try {
    const stored = await evidenceStorage.store(file);
    return { originalName: file.originalName, ...stored };
  } catch (error) {
    if (error instanceof EvidenceStorageError) {
      throw new UploadRequestError(error.statusCode, error.code, error.message);
    }
    throw error;
  }
}

async function readUploadPayload(req, options = {}) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    const payload = req.body || {};
    options.authorizePayload?.(payload);
    return { payload, file: null };
  }

  const buffer = await readRequestBuffer(req, maxUploadBytes);
  const parsed = parseMultipartBody(buffer, contentType);
  options.authorizePayload?.(parsed.fields);
  const file = parsed.files.find(item => item.fieldName === 'evidenceFile') || parsed.files[0] || null;
  const payload = {
    ...parsed.fields,
    ...(file ? {
      filename: parsed.fields.filename || file.originalName,
      name: parsed.fields.name || file.originalName,
      fileType: parsed.fields.fileType || file.mimeType,
      mimeType: file.mimeType,
      size: file.size
    } : {})
  };

  return { payload, file };
}

function withStoredUpload(payload, storedFile) {
  if (!storedFile) return payload;
  return {
    ...payload,
    filename: payload.filename || storedFile.originalName,
    name: payload.name || storedFile.originalName,
    fileType: payload.fileType || storedFile.mimeType,
    mimeType: storedFile.mimeType,
    size: storedFile.size,
    storageRef: storedFile.storageRef,
    uploadedFile: {
      originalName: storedFile.originalName,
      storedName: storedFile.filename,
      storageRef: storedFile.storageRef,
      mimeType: storedFile.mimeType,
      size: storedFile.size,
      sha256: storedFile.sha256 || null
    }
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function uploadIdempotencyClaim(req, payload, file) {
  const supplied = req.headers['idempotency-key'];
  const key = String(Array.isArray(supplied) ? supplied[0] : supplied || '').trim();
  if (!key) return null;
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) {
    throw new UploadRequestError(400, 'invalid_idempotency_key', 'Idempotency-Key must contain 8 to 200 safe characters.');
  }

  const principal = req.operator?.authenticated
    ? `${req.operator.role}:${req.operator.id || 'authenticated'}`
    : `${req.operator?.role || 'owner'}:local`;
  const principalHash = crypto.createHash('sha256').update(principal).digest('hex');
  const scope = `POST /api/ledger/upload:${principalHash}`;
  const keyHash = crypto.createHash('sha256').update(`${scope}\0${key}`).digest('hex');
  const requestHash = crypto.createHash('sha256').update(stableJson({
    payload,
    file: file ? {
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      sha256: crypto.createHash('sha256').update(file.buffer).digest('hex')
    } : null
  })).digest('hex');
  const claim = operatingLedger.claimIdempotentRequest({ keyHash, scope, requestHash });
  return { ...claim, keyHash, requestHash };
}

function serializeError(error) {
  if (!error) {
    return { message: 'Unknown error' };
  }
  return {
    message: error.message || String(error),
    name: error.name || 'Error',
    stack: isProduction ? undefined : error.stack
  };
}

function log(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  const output = JSON.stringify(entry);
  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

async function verifyEvidenceStorage({ force = false } = {}) {
  const cachedAt = Date.parse(evidenceStorageVerificationCache?.checkedAt || '');
  const cacheFresh = Number.isFinite(cachedAt) && Date.now() - cachedAt < evidenceStorageVerificationTtlMs;
  if (!force && evidenceStorageVerificationCache && cacheFresh) {
    return evidenceStorageVerificationCache;
  }
  if (evidenceStorageVerificationPromise) {
    return evidenceStorageVerificationPromise;
  }
  if (!evidenceStorage || typeof evidenceStorage.verify !== 'function') {
    evidenceStorageVerificationCache = {
      ready: false,
      status: 'unavailable',
      mode: storageMode,
      checkedAt: new Date().toISOString(),
      code: evidenceStorageInitError?.code || 'storage_verification_unavailable'
    };
    return evidenceStorageVerificationCache;
  }

  evidenceStorageVerificationPromise = (async () => {
    const startedAt = Date.now();
    try {
      const result = await evidenceStorage.verify();
      evidenceStorageVerificationCache = {
        ready: true,
        status: 'verified',
        mode: result?.mode || storageMode,
        checkedAt: result?.checkedAt || new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        code: null
      };
    } catch (error) {
      evidenceStorageVerificationCache = {
        ready: false,
        status: 'unavailable',
        mode: storageMode,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        code: error?.code || 'storage_verification_failed'
      };
      log('warn', 'evidence_storage_verification_failed', {
        mode: storageMode,
        code: evidenceStorageVerificationCache.code,
        latencyMs: evidenceStorageVerificationCache.latencyMs
      });
    }
    return evidenceStorageVerificationCache;
  })();

  try {
    return await evidenceStorageVerificationPromise;
  } finally {
    evidenceStorageVerificationPromise = null;
  }
}

function logSafeRequestPath(req) {
  return String(req.originalUrl || req.path || '')
    .replace(/(\/api\/client-portal\/)[^/?#]+/g, '$1[redacted]');
}

function isClientPortalApiPath(pathname) {
  return /^\/api\/client-portal\/[^/]+(?:\/messages|\/feedback|\/selections\/[^/]+\/responses|\/change-orders\/[^/]+(?:\/responses|\/package))?$/.test(String(pathname || ''));
}

function sendError(req, res, statusCode, code, message, details) {
  const payload = {
    error: {
      code,
      message,
      requestId: req.requestId
    }
  };

  if (details && (!isProduction || statusCode < 500)) {
    payload.error.details = details;
  }

  return res.status(statusCode).json(payload);
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function safeEqualToken(candidate, expected) {
  const candidateBuffer = Buffer.from(String(candidate || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

function parseRoleTokens(rawValue) {
  if (!rawValue) return { principals: [], issues: [] };
  const allowedRoles = new Set(['owner', 'approver', 'office_operator', 'field_worker']);
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object') {
      return { principals: [], issues: [{ code: 'invalid_role_tokens', message: 'CONTRACTOR_AI_ROLE_TOKENS must be a role map or an operator principal list.' }] };
    }
    const candidates = [];
    const issues = [];

    if (Array.isArray(parsed)) {
      parsed.forEach((configuredValue, index) => candidates.push({ configuredValue, source: 'principal_list', index }));
    } else if (Object.prototype.hasOwnProperty.call(parsed, 'operators')) {
      if (!Array.isArray(parsed.operators)) {
        issues.push({ code: 'invalid_operator_principals', message: 'CONTRACTOR_AI_ROLE_TOKENS.operators must be an array.' });
      } else {
        parsed.operators.forEach((configuredValue, index) => candidates.push({ configuredValue, source: 'principal_list', index }));
      }
      for (const key of Object.keys(parsed).filter(key => key !== 'operators')) {
        issues.push({ code: 'ambiguous_operator_config', message: `Do not mix the operators list with the legacy ${key} role key.` });
      }
    } else {
      for (const [role, configuredRole] of Object.entries(parsed)) {
        if (!allowedRoles.has(role)) {
          issues.push({ code: 'invalid_role_tokens', message: `Unsupported operator role: ${role}.` });
          continue;
        }
        const values = Array.isArray(configuredRole) ? configuredRole : [configuredRole];
        values.forEach((configuredValue, index) => candidates.push({ configuredValue, role, source: values.length === 1 ? 'legacy_role' : 'role_list', index }));
      }
    }

    const principals = [];
    const principalIds = new Set();
    const tokens = new Set();
    for (const candidate of candidates) {
      const isStructuredToken = candidate.configuredValue && typeof candidate.configuredValue === 'object' && !Array.isArray(candidate.configuredValue);
      if (!isStructuredToken && typeof candidate.configuredValue !== 'string') {
        issues.push({ code: 'invalid_operator_principal', message: 'Each configured operator must be a token string or an object containing role and token.' });
        continue;
      }
      const role = String(candidate.role || candidate.configuredValue.role || '').trim();
      if (!allowedRoles.has(role)) {
        issues.push({ code: 'invalid_role_tokens', message: `Unsupported operator role: ${role || '(missing)'}.` });
        continue;
      }
      const token = isStructuredToken ? candidate.configuredValue.token : candidate.configuredValue;
      if (!isStrongOperatorToken(token)) {
        issues.push({ code: 'weak_role_token', message: `The ${role} token must be an unpadded, non-template secret containing at least ${minimumOperatorTokenLength} characters.` });
        continue;
      }
      const configuredId = isStructuredToken ? candidate.configuredValue.id || candidate.configuredValue.operatorId : null;
      const id = String(configuredId || (candidate.source === 'legacy_role' ? role : '')).trim();
      if (!id) {
        issues.push({ code: 'operator_id_required', message: `Operator ${candidate.index + 1} in the ${role} list requires a stable id.` });
        continue;
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/.test(id)) {
        issues.push({ code: 'invalid_operator_id', message: `Operator id ${id || '(missing)'} must contain 2 to 80 safe characters.` });
        continue;
      }
      if (principalIds.has(id)) {
        issues.push({ code: 'duplicate_operator_id', message: `Operator id ${id} is configured more than once.` });
        continue;
      }
      if (tokens.has(token)) {
        issues.push({ code: 'duplicate_operator_token', message: `Operator ${id} reuses another operator token.` });
        continue;
      }

      let scope = null;
      if (role === 'field_worker') {
        const jobIds = isStructuredToken && Array.isArray(candidate.configuredValue.jobIds)
          ? [...new Set(candidate.configuredValue.jobIds.map(value => String(value || '').trim()).filter(Boolean))]
          : [];
        const workerId = isStructuredToken ? String(candidate.configuredValue.workerId || '').trim() : '';
        if (!workerId && jobIds.length === 0) {
          issues.push({ code: 'field_worker_scope_required', message: 'A field_worker token must declare a workerId or one or more jobIds.' });
          continue;
        }
        scope = { workerId: workerId || null, jobIds };
      }
      const name = isStructuredToken ? String(candidate.configuredValue.name || candidate.configuredValue.displayName || '').trim() : '';
      principals.push({ id, name: name.slice(0, 120) || null, role, token, scope });
      principalIds.add(id);
      tokens.add(token);
    }
    return { principals, issues };
  } catch {
    return { principals: [], issues: [{ code: 'invalid_role_tokens', message: 'CONTRACTOR_AI_ROLE_TOKENS is not valid JSON.' }] };
  }
}

function configuredOperatorTokens() {
  const entries = roleTokenConfig.principals.map(principal => ({ ...principal }));
  if (isStrongOperatorToken(dashboardAuthToken) && !entries.some(entry => entry.token === dashboardAuthToken)) {
    entries.push({
      id: entries.some(entry => entry.id === 'owner') ? 'legacy_owner' : 'owner',
      name: 'Owner',
      role: 'owner',
      token: dashboardAuthToken,
      scope: null
    });
  }
  return entries;
}

function createOperatorSessionSigningKey() {
  const material = configuredOperatorTokens()
    .map(entry => `${entry.id}:${entry.role}:${entry.token}`)
    .sort()
    .join('\u0000');
  return material
    ? crypto.createHash('sha256').update('contractor-ai-operator-session\u0000').update(material).digest()
    : crypto.randomBytes(32);
}

function operatorTokenFingerprint(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('base64url').slice(0, 24);
}

function operatorSessionIdHash(sessionId) {
  return crypto.createHash('sha256').update(String(sessionId || ''), 'utf8').digest('base64url');
}

function resolveOperatorToken(suppliedToken) {
  for (const entry of configuredOperatorTokens()) {
    if (safeEqualToken(suppliedToken, entry.token)) {
      return { id: entry.id, name: entry.name, role: entry.role, scope: entry.scope, token: entry.token };
    }
  }
  return null;
}

function requestCookie(req, name) {
  const cookieHeader = String(req.headers.cookie || '');
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName !== name) continue;
    try {
      return decodeURIComponent(rawValue.join('='));
    } catch {
      return '';
    }
  }
  return '';
}

function signOperatorSession(operator) {
  const now = Math.floor(Date.now() / 1000);
  const sessionId = crypto.randomBytes(24).toString('base64url');
  const payload = {
    version: 2,
    audience: 'contractor-ai-dashboard',
    sessionId,
    operatorId: operator.id,
    role: operator.role,
    tokenFingerprint: operatorTokenFingerprint(operator.token),
    issuedAt: now,
    expiresAt: now + operatorSessionTtlSeconds
  };
  operatingLedger.createOperatorSession({
    sessionIdHash: operatorSessionIdHash(sessionId),
    operatorId: operator.id,
    role: operator.role,
    tokenFingerprint: payload.tokenFingerprint,
    issuedAt: new Date(payload.issuedAt * 1000).toISOString(),
    expiresAt: new Date(payload.expiresAt * 1000).toISOString()
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', operatorSessionSigningKey).update(encodedPayload).digest('base64url');
  return { value: `${encodedPayload}.${signature}`, expiresAt: new Date(payload.expiresAt * 1000).toISOString() };
}

function verifyOperatorSession(value) {
  if (!value || value.length > 4096) return null;
  const parts = value.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expectedSignature = crypto.createHmac('sha256', operatorSessionSigningKey).update(parts[0]).digest('base64url');
  if (!safeEqualToken(parts[1], expectedSignature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.version !== 2 || payload.audience !== 'contractor-ai-dashboard') return null;
    if (typeof payload.sessionId !== 'string' || payload.sessionId.length !== 32) return null;
    if (!Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)) return null;
    if (payload.issuedAt > now + 60 || payload.expiresAt <= now || payload.expiresAt - payload.issuedAt > operatorSessionTtlSeconds) return null;
    const configured = configuredOperatorTokens().find(entry => (
      entry.id === payload.operatorId
      && entry.role === payload.role
      && safeEqualToken(operatorTokenFingerprint(entry.token), payload.tokenFingerprint)
    ));
    if (!configured) return null;
    const sessionIdHash = operatorSessionIdHash(payload.sessionId);
    const retainedSession = operatingLedger.getOperatorSession(sessionIdHash, { at: new Date(now * 1000).toISOString() });
    if (
      !retainedSession
      || retainedSession.operatorId !== configured.id
      || retainedSession.role !== configured.role
      || !safeEqualToken(retainedSession.tokenFingerprint, payload.tokenFingerprint)
      || Date.parse(retainedSession.issuedAt) !== payload.issuedAt * 1000
      || Date.parse(retainedSession.expiresAt) !== payload.expiresAt * 1000
    ) return null;
    return {
      id: configured.id,
      name: configured.name,
      role: configured.role,
      scope: configured.scope,
      authMethod: 'session',
      sessionIdHash
    };
  } catch {
    return null;
  }
}

function operatorSessionCookie(value, maxAgeSeconds) {
  const secure = isProduction || runtimeMode === 'hosted';
  const attributes = [
    `${operatorSessionCookieName}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    `Expires=${new Date(Date.now() + Math.max(0, maxAgeSeconds) * 1000).toUTCString()}`,
    'Priority=High'
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

function extractAuthToken(req) {
  const headerToken = req.headers['x-contractor-ai-token'] || req.headers['x-api-key'];
  if (Array.isArray(headerToken)) return headerToken[0];
  if (headerToken) return String(headerToken);

  const authorization = req.headers.authorization || '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();

  const basic = authorization.match(/^Basic\s+(.+)$/i);
  if (basic) {
    try {
      const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      return separator >= 0 ? decoded.slice(separator + 1) : decoded;
    } catch {
      return '';
    }
  }

  return '';
}

function resolveOperatorRole(req) {
  const suppliedToken = extractAuthToken(req);
  if (suppliedToken) {
    const operator = resolveOperatorToken(suppliedToken);
    return operator ? { id: operator.id, name: operator.name, role: operator.role, scope: operator.scope, authMethod: 'token' } : null;
  }
  return verifyOperatorSession(requestCookie(req, operatorSessionCookieName));
}

function actorFromRequest(req, fallback = 'Contractor.AI') {
  if (!req.operator?.authenticated) return fallback;
  const role = req.operator.role;
  const id = req.operator.id;
  return id && id !== role ? `role:${role}:${id}` : `role:${role}`;
}

function requireDashboardAuth(req, res, next) {
  const clientPortalRoute = isClientPortalApiPath(req.path);
  const publicAuthRoute = req.path === '/api/session' || req.path === '/api/auth/login' || req.path === '/api/auth/logout';
  const operatorAppShell = ['GET', 'HEAD'].includes(req.method) && !req.path.startsWith('/api/');
  const operator = dashboardAuthRequired ? resolveOperatorRole(req) : null;
  req.operator = operator
    ? { ...operator, authenticated: true }
    : { role: 'owner', scope: null, authenticated: false, authMethod: dashboardAuthRequired ? null : 'local' };

  if (!dashboardAuthRequired || req.method === 'OPTIONS' || req.path === '/api/health/ready' || clientPortalRoute || publicAuthRoute || operatorAppShell) {
    return next();
  }

  if (configuredOperatorTokens().length === 0) {
    return sendError(
      req,
      res,
      503,
      'auth_not_configured',
      'Contractor.AI is locked because dashboard/API auth is required but no strong authentication token is configured'
    );
  }

  if (operator) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Bearer realm="Contractor.AI"');
  return sendError(req, res, 401, 'authentication_required', 'Authentication is required for Contractor.AI dashboard and API access');
}

function allowsOperatorRequest(role, req) {
  if (!req.path.startsWith('/api/') || req.method === 'OPTIONS') return true;
  if (role === 'owner') return true;
  const isRead = ['GET', 'HEAD'].includes(req.method);
  const pathName = req.path;
  if (isRead && pathName === '/api/session') return true;
  const ledgerRead = pathName.startsWith('/api/ledger/');

  if (role === 'approver') {
    return (isRead && ledgerRead) || (req.method === 'POST' && /^\/api\/ledger\/approvals\/[^/]+\/resolve$/.test(pathName));
  }

  if (role === 'office_operator') {
    if (isRead && (ledgerRead || pathName === '/api/health' || pathName === '/api/readiness')) return true;
    if (!['POST', 'PUT', 'PATCH'].includes(req.method) || !ledgerRead) return false;
    return !/^\/api\/ledger\/approvals\/[^/]+\/resolve$/.test(pathName);
  }

  if (role === 'field_worker') {
    if (isRead) {
      return pathName === '/api/health'
        || pathName === '/api/readiness'
        || /^\/api\/ledger\/jobs(?:\/[^/]+)?$/.test(pathName)
        || /^\/api\/ledger\/jobs\/[^/]+\/production$/.test(pathName)
        || /^\/api\/ledger\/jobs\/[^/]+\/daywork-tickets$/.test(pathName)
        || /^\/api\/ledger\/jobs\/[^/]+\/nonconformances$/.test(pathName)
        || /^\/api\/ledger\/jobs\/[^/]+\/material-receipts$/.test(pathName)
        || /^\/api\/ledger\/jobs\/[^/]+\/material-receiving-plan$/.test(pathName)
        || /^\/api\/ledger\/jobs\/[^/]+\/daily-cycles$/.test(pathName)
        || /^\/api\/ledger\/jobs\/[^/]+\/expense-receipts$/.test(pathName)
        || /^\/api\/ledger\/jobs\/[^/]+\/environmental-activities$/.test(pathName)
        || /^\/api\/ledger\/jobs\/[^/]+\/equipment-custody$/.test(pathName)
        || /^\/api\/ledger\/jobs\/[^/]+\/equipment-custody-plan$/.test(pathName)
        || pathName === '/api/ledger/five-s'
        || pathName === '/api/ledger/work-permits'
        || /^\/api\/ledger\/jobs\/[^/]+\/work-permits$/.test(pathName)
        || pathName === '/api/ledger/pre-task-plans'
        || /^\/api\/ledger\/jobs\/[^/]+\/pre-task-plans$/.test(pathName)
        || pathName === '/api/ledger/lmra'
        || /^\/api\/ledger\/jobs\/[^/]+\/lmra$/.test(pathName)
        || pathName === '/api/ledger/installation-qc'
        || /^\/api\/ledger\/jobs\/[^/]+\/installation-qc$/.test(pathName)
        || pathName === '/api/ledger/photo-evidence'
        || /^\/api\/ledger\/jobs\/[^/]+\/photo-evidence$/.test(pathName)
        || pathName === '/api/ledger/sds-sheets'
        || /^\/api\/ledger\/jobs\/[^/]+\/sds-sheets$/.test(pathName)
        || pathName === '/api/ledger/drawings'
        || /^\/api\/ledger\/jobs\/[^/]+\/drawings$/.test(pathName)
        || pathName === '/api/ledger/safety-briefings'
        || /^\/api\/ledger\/jobs\/[^/]+\/safety-meetings$/.test(pathName)
        || pathName === '/api/ledger/attendance'
        || /^\/api\/ledger\/jobs\/[^/]+\/attendance$/.test(pathName)
        || /^\/api\/ledger\/documents\/[^/]+\/content$/.test(pathName);
    }
    if (req.method === 'POST' && pathName === '/api/ledger/upload') return true;
    if (req.method === 'PATCH' && /^\/api\/ledger\/jobs\/[^/]+\/lifecycle\/task\/[^/]+$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/inspections\/[^/]+\/checklist-submissions$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/attendance\/check-in$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/attendance\/[^/]+\/check-out$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/equipment-custody\/check-out$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/equipment-custody\/[^/]+\/return$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/five-s\/locations\/[^/]+\/audits$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/expense-receipts$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/daywork-tickets$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/nonconformances$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/environmental-activities$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/work-permits\/[^/]+\/acknowledgments$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/pre-task-plans\/[^/]+\/(acknowledgments|suspend)$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/lmra$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/safety-meetings\/[^/]+\/acknowledgments$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/daily-cycles$/.test(pathName)) return true;
    if (req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/daily-cycles\/[^/]+\/end-of-day$/.test(pathName)) return true;
    return req.method === 'POST' && /^\/api\/ledger\/jobs\/[^/]+\/(progress|production-entries|field-reports|observations|incidents|punch-items|safety-checks|time-logs|daily-logs|material-receipts)$/.test(pathName);
  }

  return false;
}

function fieldWorkerCanAccessJob(req, jobId) {
  if (req.operator?.role !== 'field_worker') return true;
  const scope = req.operator.scope;
  if (!scope || !jobId) return false;
  const normalizedJobId = String(jobId);
  if (scope.jobIds?.includes(normalizedJobId)) return true;
  if (!scope.workerId) return false;
  try {
    const detail = operatingLedger.getJobDetail(normalizedJobId);
    return detail.assignments.some(assignment => (
      String(assignment.workerId || '') === scope.workerId
      && !['released', 'cancelled', 'completed', 'closed', 'rejected'].includes(String(assignment.status || '').toLowerCase())
    ));
  } catch {
    return false;
  }
}

function scopedLedgerJobs(req, filters = {}) {
  const jobs = operatingLedger.listJobs(filters);
  return req.operator?.role === 'field_worker'
    ? jobs.filter(job => fieldWorkerCanAccessJob(req, job.id)).map(projectFieldJobSummary)
    : jobs;
}

const FIELD_RECORD_PRIVATE_KEYS = new Set([
  'amount', 'approval', 'approvalId', 'capturedByActor', 'checkInEntryFingerprint', 'checkInEntryKey', 'checkOutEntryFingerprint', 'checkOutEntryKey', 'clientEmail', 'clientId', 'clientPhone', 'closureApprovalId', 'closureHash', 'conflicts', 'correctionApprovalId', 'correctiveActionHash', 'cost', 'currency',
  'checkoutEntryKey', 'checkoutFingerprint', 'data', 'email', 'entryFingerprint', 'entryKey', 'estimatedCost', 'hourlyRate', 'lineItems', 'marginTargetPercent', 'phone', 'planHash', 'portalToken',
  'latestApproval', 'providerMessageId', 'rate', 'receipt', 'receiptRef', 'storageRef', 'subtotal', 'supplier',
  'returnEntryKey', 'returnFingerprint', 'snapshot', 'snapshotHash', 'sourceCurrentHash', 'sourceHash',
  'huddleEntryKey', 'huddleSnapshot', 'huddleSnapshotHash', 'huddleSourceHash', 'eodEntryKey', 'eodSnapshot', 'eodSnapshotHash', 'eodSourceHash',
  'taxAmount', 'taxRate', 'token', 'total'
]);

function projectFieldRecord(record) {
  if (!record || typeof record !== 'object') return record;
  if (Array.isArray(record)) return record.map(projectFieldRecord);
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !FIELD_RECORD_PRIVATE_KEYS.has(key))
      .map(([key, value]) => [key, projectFieldRecord(value)])
  );
}

function projectFieldRecords(records) {
  return Array.isArray(records) ? records.map(projectFieldRecord) : [];
}

function projectFieldExpenseReceipt(expense) {
  if (!expense) return null;
  return {
    id: expense.id,
    jobId: expense.jobId,
    workerId: expense.workerId,
    workerName: expense.workerName,
    expenseDate: expense.expenseDate,
    category: expense.category,
    vendor: expense.vendor,
    receiptReference: expense.receiptReference,
    currency: expense.currency,
    netAmount: expense.netAmount,
    taxAmount: expense.taxAmount,
    totalAmount: expense.totalAmount,
    taxTreatment: expense.taxTreatment,
    paymentMethod: expense.paymentMethod,
    costCode: expense.costCode,
    status: expense.status,
    notes: expense.notes,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt
  };
}

function projectFieldEnvironmentalActivity(activity) {
  if (!activity) return null;
  return {
    id: activity.id,
    jobId: activity.jobId,
    workerId: activity.workerId,
    workerName: activity.workerName,
    activityDate: activity.activityDate,
    category: activity.category,
    ghgScope: activity.ghgScope,
    description: activity.description,
    quantity: activity.quantity,
    unit: activity.unit,
    emissionFactor: activity.emissionFactor,
    emissionsKgCo2e: activity.emissionsKgCo2e,
    factorSource: activity.factorSource,
    factorReference: activity.factorReference,
    evidenceReference: activity.evidenceReference,
    status: activity.status,
    notes: activity.notes,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt
  };
}

function projectFieldDayworkTicket(ticket) {
  if (!ticket) return null;
  return {
    id: ticket.id,
    jobId: ticket.jobId,
    ticketNumber: ticket.ticketNumber,
    workDate: ticket.workDate,
    workerId: ticket.workerId,
    workerName: ticket.workerName,
    title: ticket.title,
    description: ticket.description,
    reason: ticket.reason,
    status: ticket.status,
    evidenceReference: ticket.evidenceReference,
    evidenceDocumentId: ticket.evidenceDocumentId,
    lines: (ticket.lines || []).map(line => ({
      lineKey: line.lineKey,
      lineType: line.lineType,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      costCode: line.costCode,
      sourceReference: line.sourceReference || null
    })),
    lineCount: ticket.lineCount,
    acknowledged: Boolean(ticket.acknowledgementReference),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    fieldScoped: true
  };
}

function projectFieldJobSummary(job = {}) {
  return {
    id: job.id,
    title: job.title,
    clientName: job.clientName,
    jobType: job.jobType,
    description: job.description,
    address: job.address,
    city: job.city,
    region: job.region,
    country: job.country,
    priority: job.priority,
    status: job.status,
    phase: job.phase,
    riskLevel: job.riskLevel,
    estimatedHours: job.estimatedHours,
    progressPercent: job.progressPercent,
    scheduledStart: job.scheduledStart,
    scheduledEnd: job.scheduledEnd,
    targetCompletion: job.targetCompletion,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    fieldScoped: true
  };
}

function fieldWorkerIdentity(req) {
  const workerId = req.operator?.role === 'field_worker' ? req.operator.scope?.workerId : null;
  if (!workerId) return { workerId: null, workerName: req.operator?.name || 'Field worker', hourlyRate: 0 };
  try {
    const worker = operatingLedger.getWorker(workerId);
    return { workerId: worker.id, workerName: worker.name, hourlyRate: Number(worker.hourlyRate || 0) };
  } catch {
    return { workerId, workerName: req.operator?.name || 'Field worker', hourlyRate: 0 };
  }
}

function projectFieldJobDetail(req, detail) {
  const scopeWorkerId = req.operator?.scope?.workerId || null;
  const timeLogs = scopeWorkerId
    ? (detail.timeLogs || []).filter(log => String(log.workerId || '') === String(scopeWorkerId))
    : [];
  return {
    ...projectFieldJobSummary(detail),
    tasks: projectFieldRecords(detail.tasks),
    fieldReports: projectFieldRecords(detail.fieldReports),
    dailyOperatingCycles: projectFieldRecords(detail.dailyOperatingCycles),
    rfis: projectFieldRecords(detail.rfis),
    submittals: projectFieldRecords(detail.submittals),
    permits: projectFieldRecords(detail.permits),
    preTaskPlans: (detail.preTaskPlans || []).map(plan => preTaskPlanForOperator(req, plan)),
    lmraAssessments: (detail.lmraAssessments || [])
      .filter(assessment => scopeWorkerId && String(assessment.workerId || '') === String(scopeWorkerId))
      .map(projectFieldRecord),
    inspections: projectFieldRecords((detail.inspections || []).filter(inspection => (
      !inspection.installationQc
      || (scopeWorkerId && String(inspection.installationQc.assignedWorkerId || '') === String(scopeWorkerId))
    ))),
    installationQcControls: projectFieldRecords((detail.installationQcControls || []).filter(control => (
      scopeWorkerId && String(control.assignedWorkerId || '') === String(scopeWorkerId)
    ))),
    photoEvidenceSets: projectFieldRecords((detail.photoEvidenceSets || []).filter(set => (
      scopeWorkerId && String(set.assignedWorkerId || '') === String(scopeWorkerId)
    ))),
    nonconformances: projectFieldRecords(detail.nonconformances),
    observations: projectFieldRecords(detail.observations),
    incidents: projectFieldRecords(detail.incidents),
    safetyMeetings: (detail.safetyMeetings || []).map(meeting => safetyMeetingForOperator(req, meeting)),
    orientations: projectFieldRecords(detail.orientations),
    jhas: projectFieldRecords(detail.jhas),
    sdsSheets: projectFieldRecords((detail.sdsSheets || []).filter(sheet => sheet.current === true)),
    drawings: projectFieldRecords((detail.drawings || []).filter(drawing => drawing.current === true)),
    siteAccessLogs: projectFieldRecords(detail.siteAccessLogs),
    qualificationRequirements: projectFieldRecords(detail.qualificationRequirements),
    assignments: projectFieldRecords(detail.assignments),
    tools: projectFieldRecords(detail.tools),
    equipmentCustody: projectFieldRecords(detail.equipmentCustody),
    materials: projectFieldRecords(detail.materials),
    materialReceipts: projectFieldRecords(detail.materialReceipts),
    documents: projectFieldRecords((detail.documents || []).filter(document => (
      document.type !== 'drawing_revision' || document.current === true
    ))),
    progress: projectFieldRecords(detail.progress),
    productionBaselines: projectFieldRecords(detail.productionBaselines),
    productionEntries: projectFieldRecords(detail.productionEntries),
    productionControl: projectFieldRecord(detail.productionControl),
    dayworkTickets: (detail.dayworkTickets || [])
      .filter(ticket => scopeWorkerId && String(ticket.workerId || '') === String(scopeWorkerId))
      .map(projectFieldDayworkTicket),
    attendanceSessions: projectFieldRecords(
      scopeWorkerId
        ? (detail.attendanceSessions || []).filter(session => String(session.workerId || '') === String(scopeWorkerId))
        : []
    ),
    timeLogs: projectFieldRecords(timeLogs),
    environmentalActivities: (detail.environmentalActivities || [])
      .filter(activity => scopeWorkerId && String(activity.workerId || '') === String(scopeWorkerId))
      .map(projectFieldEnvironmentalActivity),
    qualityChecks: projectFieldRecords(detail.qualityChecks),
    safetyChecks: projectFieldRecords(detail.safetyChecks),
    punchItems: projectFieldRecords(detail.punchItems),
    workerInstructions: projectFieldRecords(detail.workerInstructions),
    weather: projectFieldRecords(detail.weather),
    approvals: [],
    communications: []
  };
}

function jobForOperator(req, jobId, options = {}) {
  const detail = operatingLedger.getJobDetail(jobId, {
    includeAudit: req.operator?.role === 'field_worker' ? false : options.includeAudit === true
  });
  return req.operator?.role === 'field_worker' ? projectFieldJobDetail(req, detail) : detail;
}

function dashboardForOperator(req) {
  if (req.operator?.role !== 'field_worker') return operatingLedger.dashboardSummary();
  const jobs = scopedLedgerJobs(req, { limit: 500 });
  return { fieldScoped: true, jobCount: jobs.length };
}

function compactLedgerResponseRequested(req) {
  if (req.operator?.role === 'field_worker') return false;
  return ['1', 'true'].includes(String(req.query?.compact || '').trim().toLowerCase());
}

function timeLogPayloadForOperator(req, payload = {}) {
  if (req.operator?.role !== 'field_worker') return payload;
  const identity = fieldWorkerIdentity(req);
  return {
    ...payload,
    workerId: identity.workerId,
    worker_id: identity.workerId,
    workerName: identity.workerName,
    worker_name: identity.workerName,
    rate: identity.hourlyRate,
    hourlyRate: identity.hourlyRate,
    hourly_rate: identity.hourlyRate
  };
}

function expenseReceiptPayloadForOperator(req, payload = {}) {
  if (req.operator?.role !== 'field_worker') return payload;
  const identity = fieldWorkerIdentity(req);
  if (!identity.workerId) {
    const error = new Error('Field expense capture requires an operator token linked to one worker identity.');
    error.statusCode = 403;
    error.code = 'field_worker_identity_required';
    throw error;
  }
  return {
    ...payload,
    workerId: identity.workerId,
    worker_id: identity.workerId,
    workerName: identity.workerName,
    worker_name: identity.workerName,
    submittedBy: identity.workerName,
    submitted_by: identity.workerName,
    source: 'field_expense_receipt'
  };
}

function dayworkTicketPayloadForOperator(req, payload = {}) {
  if (req.operator?.role !== 'field_worker') return payload;
  const identity = fieldWorkerIdentity(req);
  if (!identity.workerId) {
    const error = new Error('Field daywork capture requires an operator token linked to one worker identity.');
    error.statusCode = 403;
    error.code = 'field_worker_identity_required';
    throw error;
  }
  return {
    ...payload,
    workerId: identity.workerId,
    worker_id: identity.workerId,
    workerName: identity.workerName,
    worker_name: identity.workerName,
    submittedBy: identity.workerName,
    submitted_by: identity.workerName,
    source: 'field_daywork_ticket'
  };
}

function nonconformancePayloadForOperator(req, payload = {}) {
  if (req.operator?.role !== 'field_worker') return payload;
  const identity = fieldWorkerIdentity(req);
  if (!identity.workerId) {
    const error = new Error('Field NCR capture requires an operator token linked to one worker identity.');
    error.statusCode = 403;
    error.code = 'field_worker_identity_required';
    throw error;
  }
  return {
    ...payload,
    workerId: identity.workerId,
    worker_id: identity.workerId,
    workerName: identity.workerName,
    worker_name: identity.workerName,
    raisedBy: identity.workerName,
    raised_by: identity.workerName,
    source: 'field_nonconformance_register'
  };
}

function environmentalActivityPayloadForOperator(req, payload = {}) {
  if (req.operator?.role !== 'field_worker') return payload;
  const identity = fieldWorkerIdentity(req);
  if (!identity.workerId) {
    const error = new Error('Field environmental capture requires an operator token linked to one worker identity.');
    error.statusCode = 403;
    error.code = 'field_worker_identity_required';
    throw error;
  }
  return {
    ...payload,
    workerId: identity.workerId,
    worker_id: identity.workerId,
    workerName: identity.workerName,
    worker_name: identity.workerName,
    submittedBy: identity.workerName,
    submitted_by: identity.workerName,
    source: 'field_environmental_activity'
  };
}

function safetyAcknowledgementPayloadForOperator(req, payload = {}) {
  if (req.operator?.role !== 'field_worker') return payload;
  const identity = fieldWorkerIdentity(req);
  if (!identity.workerId) {
    const error = new Error('Field safety acknowledgement requires an operator token linked to one worker identity.');
    error.statusCode = 403;
    error.code = 'field_worker_identity_required';
    throw error;
  }
  return {
    ...payload,
    workerId: identity.workerId,
    worker_id: identity.workerId,
    workerName: identity.workerName,
    worker_name: identity.workerName,
    attendeeName: identity.workerName,
    attendee_name: identity.workerName,
    acknowledgedBy: identity.workerName,
    acknowledged_by: identity.workerName,
    source: 'field_safety_briefing_acknowledgement'
  };
}

function safetyMeetingForOperator(req, meeting) {
  if (req.operator?.role !== 'field_worker') return meeting;
  const workerId = req.operator.scope?.workerId || null;
  const attendeeRecords = workerId
    ? (meeting.attendeeRecords || []).filter(attendee => String(attendee.workerId || '') === String(workerId))
    : [];
  return projectFieldRecord({
    ...meeting,
    attendees: attendeeRecords.map(attendee => attendee.attendeeName),
    attendeeRecords,
    attendanceSummary: {
      total: attendeeRecords.length,
      expected: attendeeRecords.filter(attendee => attendee.status === 'expected').length,
      acknowledged: attendeeRecords.filter(attendee => attendee.status === 'acknowledged').length,
      excused: attendeeRecords.filter(attendee => attendee.status === 'excused').length,
      outstanding: attendeeRecords.filter(attendee => attendee.status === 'expected').length,
      readyForSignoff: false
    },
    fieldScoped: true
  });
}

function workPermitAcknowledgementPayloadForOperator(req, payload = {}) {
  if (req.operator?.role !== 'field_worker') return payload;
  const identity = fieldWorkerIdentity(req);
  if (!identity.workerId) {
    const error = new Error('Field permit acknowledgement requires an operator token linked to one worker identity.');
    error.statusCode = 403;
    error.code = 'field_worker_identity_required';
    throw error;
  }
  return {
    ...payload,
    workerId: identity.workerId,
    worker_id: identity.workerId,
    acknowledgedBy: identity.workerName,
    acknowledged_by: identity.workerName,
    source: 'field_work_permit_acknowledgement'
  };
}

function workPermitForOperator(req, permit) {
  if (req.operator?.role !== 'field_worker') return permit;
  const workerId = req.operator.scope?.workerId || null;
  const attendees = workerId
    ? (permit.attendees || []).filter(attendee => String(attendee.workerId || '') === String(workerId))
    : [];
  const ownAcknowledgement = attendees[0] || null;
  return projectFieldRecord({
    ...permit,
    attendees,
    attendanceSummary: {
      total: attendees.length,
      expected: attendees.filter(attendee => attendee.status === 'expected').length,
      acknowledged: attendees.filter(attendee => attendee.status === 'acknowledged').length,
      integrityFailures: attendees.filter(attendee => attendee.status === 'acknowledged' && attendee.integrityValid !== true).length
    },
    readyForWork: permit.readyForWork === true
      && ownAcknowledgement?.status === 'acknowledged'
      && ownAcknowledgement.integrityValid === true,
    fieldScoped: true
  });
}

function preTaskPlanAcknowledgementPayloadForOperator(req, payload = {}) {
  if (req.operator?.role !== 'field_worker') return payload;
  const identity = fieldWorkerIdentity(req);
  if (!identity.workerId) {
    const error = new Error('Field pre-task acknowledgement requires an operator token linked to one worker identity.');
    error.statusCode = 403;
    error.code = 'field_worker_identity_required';
    throw error;
  }
  return {
    ...payload,
    workerId: identity.workerId,
    worker_id: identity.workerId,
    acknowledgedBy: identity.workerName,
    acknowledged_by: identity.workerName,
    source: 'field_pre_task_plan_acknowledgement'
  };
}

function preTaskPlanForOperator(req, plan) {
  if (req.operator?.role !== 'field_worker') return plan;
  const workerId = req.operator.scope?.workerId || null;
  const attendees = workerId
    ? (plan.attendees || []).filter(attendee => String(attendee.workerId || '') === String(workerId))
    : [];
  const ownAcknowledgement = attendees[0] || null;
  return projectFieldRecord({
    ...plan,
    attendees,
    attendanceSummary: {
      total: attendees.length,
      expected: attendees.filter(attendee => attendee.status === 'expected').length,
      acknowledged: attendees.filter(attendee => attendee.status === 'acknowledged').length,
      integrityFailures: attendees.filter(attendee => attendee.status === 'acknowledged' && attendee.integrityValid !== true).length
    },
    readyForWork: plan.readyForWork === true
      && ownAcknowledgement?.status === 'acknowledged'
      && ownAcknowledgement.integrityValid === true,
    fieldScoped: true
  });
}

function lmraPayloadForOperator(req, payload = {}) {
  if (req.operator?.role !== 'field_worker') {
    const error = new Error('LMRA evidence must be completed by an authenticated field worker.');
    error.statusCode = 403;
    error.code = 'lmra_field_worker_required';
    throw error;
  }
  const identity = fieldWorkerIdentity(req);
  if (!identity.workerId) {
    const error = new Error('Field LMRA capture requires an operator token linked to one worker identity.');
    error.statusCode = 403;
    error.code = 'field_worker_identity_required';
    throw error;
  }
  return {
    ...payload,
    workerId: identity.workerId,
    worker_id: identity.workerId,
    workerName: identity.workerName,
    worker_name: identity.workerName,
    source: 'field_lmra_assessment'
  };
}

function lmraForOperator(req, assessment) {
  return req.operator?.role === 'field_worker' ? projectFieldRecord(assessment) : assessment;
}

function getLedgerDiagnostics({ force = false } = {}) {
  const checkedAt = Number(ledgerDiagnosticsCache?.checkedAt || 0);
  if (!force && ledgerDiagnosticsCache && Date.now() - checkedAt < ledgerDiagnosticsCacheTtlMs) {
    return ledgerDiagnosticsCache.value;
  }
  const value = operatingLedger.diagnose();
  ledgerDiagnosticsCache = { checkedAt: Date.now(), value };
  return value;
}

function attendancePayloadForOperator(req, payload = {}) {
  if (req.operator?.role !== 'field_worker') return payload;
  const identity = fieldWorkerIdentity(req);
  if (!identity.workerId) {
    const error = new Error('Field attendance requires an operator token linked to one worker identity.');
    error.statusCode = 403;
    error.code = 'field_worker_identity_required';
    throw error;
  }
  return {
    ...payload,
    workerId: identity.workerId,
    worker_id: identity.workerId,
    workerName: identity.workerName,
    worker_name: identity.workerName
  };
}

function inspectionChecklistPayloadForOperator(req, payload = {}, options = {}) {
  if (req.operator?.role !== 'field_worker' || options.requireWorkerIdentity !== true) return payload;
  const identity = fieldWorkerIdentity(req);
  if (!identity.workerId) {
    const error = new Error('Installation and inspection checklist capture requires an operator token linked to one worker identity.');
    error.statusCode = 403;
    error.code = 'field_worker_identity_required';
    throw error;
  }
  return {
    ...payload,
    workerId: identity.workerId,
    worker_id: identity.workerId
  };
}

function taskLifecyclePayloadForOperator(req) {
  const payload = req.body || {};
  if (req.operator?.role !== 'field_worker') return payload;

  const requestedStatus = String(payload.status || '').trim().toLowerCase();
  if (!['in_progress', 'blocked', 'completed'].includes(requestedStatus)) {
    const error = new Error('Field workers can start, block, or complete assigned job tasks.');
    error.statusCode = 403;
    error.code = 'field_task_transition_forbidden';
    throw error;
  }

  const detail = operatingLedger.getJobDetail(req.params.id, { includeAudit: false });
  const task = (detail.tasks || []).find(item => String(item.id) === String(req.params.recordId));
  if (!task) {
    const error = new Error('Task not found for this job');
    error.statusCode = 404;
    error.code = 'task_not_found';
    throw error;
  }
  const workerId = req.operator.scope?.workerId || null;
  if (task.assigneeId && (!workerId || String(task.assigneeId) !== String(workerId))) {
    const error = new Error('This task is assigned to another crew member.');
    error.statusCode = 403;
    error.code = 'field_task_scope_forbidden';
    throw error;
  }

  return {
    status: requestedStatus,
    notes: payload.notes || payload.note || null,
    evidence: Array.isArray(payload.evidence) ? payload.evidence : []
  };
}

function recordForOperator(req, record) {
  return req.operator?.role === 'field_worker' ? projectFieldRecord(record) : record;
}

function requestedLedgerJobId(req) {
  const match = String(req.path || '').match(/^\/api\/ledger\/jobs\/([^/]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function requireOperatorAuthorization(req, res, next) {
  const clientPortalRoute = isClientPortalApiPath(req.path);
  if (clientPortalRoute || req.path === '/api/session' || req.path === '/api/auth/login' || req.path === '/api/auth/logout') return next();
  if (!allowsOperatorRequest(req.operator?.role || 'owner', req)) {
    return sendError(req, res, 403, 'insufficient_role', 'Your operator role cannot perform this action.');
  }
  const jobId = requestedLedgerJobId(req);
  if (jobId && !fieldWorkerCanAccessJob(req, jobId)) {
    return sendError(req, res, 403, 'field_job_scope_forbidden', 'This field worker is not assigned to the requested job.');
  }
  return next();
}

function requireSessionMutationOrigin(req, res, next) {
  if (req.operator?.authMethod !== 'session' || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = String(req.headers.origin || '').trim();
  if (!origin) {
    return sendError(req, res, 403, 'session_origin_required', 'Cookie-authenticated changes require a same-origin browser request.');
  }
  let requestOrigin = '';
  try {
    requestOrigin = new URL(`${req.protocol}://${req.get('host')}`).origin;
  } catch {
    requestOrigin = '';
  }
  if (origin !== requestOrigin && !allowedOrigins.includes(origin)) {
    return sendError(req, res, 403, 'session_origin_forbidden', 'The browser origin is not allowed to change Contractor.AI records.');
  }
  return next();
}

// Middleware
app.disable('x-powered-by');
app.use(setSecurityHeaders);
app.use(attachRequestContext);
app.use(compression({
  threshold: 1_024,
  filter: (req, res) => req.headers['x-no-compression'] !== 'true' && compression.filter(req, res)
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  }
}));
app.use(rateLimitApi);
app.use(requireDashboardAuth);
app.use(requireSessionMutationOrigin);
app.use(requireOperatorAuthorization);
const standardJsonParser = express.json({ limit: '2mb' });
const operationalExportJsonParser = express.json({ limit: '16mb' });
app.use((req, res, next) => (
  req.path === '/api/operations/exports/validate'
    ? operationalExportJsonParser(req, res, next)
    : standardJsonParser(req, res, next)
));
app.use((req, res, next) => {
  if (
    req.operator?.authenticated
    && req.body
    && typeof req.body === 'object'
    && !Array.isArray(req.body)
  ) {
    req.body.actor = actorFromRequest(req);
  }
  next();
});
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use((req, res, next) => {
  if (req.operator?.authenticated && req.body && typeof req.body === 'object') {
    Object.defineProperty(req.body, 'actor', {
      value: actorFromRequest(req),
      enumerable: false,
      configurable: true
    });
  }
  next();
});

app.post('/api/auth/login', rateLimitAuthLogin, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!dashboardAuthRequired) {
    return sendError(req, res, 409, 'authentication_not_required', 'This local runtime does not require operator authentication.');
  }
  if (configuredOperatorTokens().length === 0) {
    return sendError(req, res, 503, 'auth_not_configured', 'Contractor.AI authentication is not configured.');
  }
  const suppliedToken = typeof req.body?.token === 'string' ? req.body.token : '';
  const operator = resolveOperatorToken(suppliedToken);
  if (!operator) {
    return recordAuthenticationFailure(req, res);
  }
  try {
    operatingLedger.clearAuthenticationRateLimit(req.authenticationRateLimit.keyHash);
    setAuthenticationRateLimitHeaders(res, operatingLedger.getAuthenticationRateLimit(req.authenticationRateLimit.keyHash, {
      limit: authLoginRateLimit,
      windowMs: authLoginRateWindowMs
    }));
  } catch (error) {
    return authenticationRateLimitUnavailable(req, res, error);
  }
  const session = signOperatorSession(operator);
  res.setHeader('Set-Cookie', operatorSessionCookie(session.value, operatorSessionTtlSeconds));
  log('info', 'operator_session_started', { requestId: req.requestId, operatorId: operator.id, role: operator.role, expiresAt: session.expiresAt });
  return res.json({
    authenticated: true,
    operatorId: operator.id,
    name: operator.name,
    role: operator.role,
    expiresAt: session.expiresAt
  });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', operatorSessionCookie('', 0));
  if (req.operator?.authMethod === 'session' && req.operator.sessionIdHash) {
    const revoked = operatingLedger.revokeOperatorSession(req.operator.sessionIdHash, {
      reason: 'operator_logout'
    });
    log('info', 'operator_session_ended', {
      requestId: req.requestId,
      operatorId: req.operator.id,
      role: req.operator.role,
      revoked
    });
  }
  return res.status(204).end();
});

app.get('/api/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const role = req.operator?.role || 'owner';
  const fieldWorker = role === 'field_worker';
  const fieldIdentity = fieldWorker ? fieldWorkerIdentity(req) : null;
  return res.json({
    authentication: {
      required: dashboardAuthRequired,
      authenticated: Boolean(req.operator?.authenticated),
      method: req.operator?.authMethod || null,
      sessionTtlSeconds: dashboardAuthRequired ? operatorSessionTtlSeconds : null
    },
    operator: {
      id: req.operator?.id || (req.operator?.authenticated ? role : 'local_owner'),
      name: req.operator?.name || (fieldIdentity?.workerName ?? null),
      role,
      authenticated: Boolean(req.operator?.authenticated),
      fieldScoped: fieldWorker,
      worker: fieldIdentity ? { id: fieldIdentity.workerId, name: fieldIdentity.workerName } : null,
      capabilities: {
        dashboard: !fieldWorker,
        intake: role === 'owner' || role === 'office_operator',
        pipeline: !fieldWorker,
        tenders: !fieldWorker,
        takeoffs: !fieldWorker,
        estimateRates: !fieldWorker,
        commercialScope: !fieldWorker,
        riskRegister: !fieldWorker,
        pricingBasis: !fieldWorker,
        schedule: !fieldWorker,
        crewCapacity: !fieldWorker,
        lastPlanner: !fieldWorker,
        fiveS: true,
        approvals: role === 'owner' || role === 'approver',
        dispatch: !fieldWorker,
        resources: !fieldWorker,
        finance: !fieldWorker,
        performance: !fieldWorker,
        clientSuccess: !fieldWorker,
        fieldEvidence: role === 'owner' || role === 'office_operator' || fieldWorker,
        maintenance: role === 'owner'
      }
    }
  });
});

function loadLegacyStateForMigration() {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      workers: Array.isArray(parsed.workers) ? parsed.workers : [],
      tools: Array.isArray(parsed.tools) ? parsed.tools : []
    };
  } catch {
    return { jobs: [], workers: [], tools: [] };
  }
}

function analyzeUploadPayload(payload = {}) {
  const filename = String(payload.filename || payload.name || 'field-evidence').trim() || 'field-evidence';
  const fileType = String(payload.fileType || payload.type || 'unknown').toLowerCase();
  const categoryInput = String(payload.category || payload.documentCategory || '').toLowerCase();
  const notes = String(payload.notes || payload.observation || payload.description || '').trim();
  const combined = `${filename} ${fileType} ${categoryInput} ${notes}`.toLowerCase();
  const size = Math.max(0, Number(payload.size || 0));
  const riskLevel = String(payload.riskLevel || payload.risk || '').toLowerCase();
  const amount = Number(payload.amount || payload.value || 0);

  let category = 'document';
  if (fileType.startsWith('image/') || /\.(jpg|jpeg|png|webp|heic)$/i.test(filename) || combined.includes('photo')) {
    category = 'field_photo';
  }
  if (combined.includes('invoice') || combined.includes('factuur') || amount > 0) {
    category = 'invoice';
  }
  if (combined.includes('safety') || combined.includes('vca') || combined.includes('jha') || combined.includes('incident') || combined.includes('veilig')) {
    category = 'safety';
  }
  if (combined.includes('closeout') || combined.includes('handover') || combined.includes('as-built') || combined.includes('wkb') || combined.includes('oplever')) {
    category = 'closeout';
  }

  const riskDetected = ['high', 'critical'].includes(riskLevel)
    || /blocked|unsafe|incident|damage|leak|injury|near miss|gevaar|schade/i.test(notes);
  const suggestions = [];
  if (category === 'field_photo') suggestions.push('Attach the photo to today\'s daily log', 'Tag the location and job for Wkb evidence');
  if (category === 'invoice') suggestions.push('Route invoice to finance review', 'Create a job cost entry for budget tracking');
  if (category === 'safety') suggestions.push('Create a safety checklist follow-up', 'Escalate high-risk observations immediately');
  if (category === 'closeout') suggestions.push('Add to handover package', 'Review Wkb and client closeout completeness');
  if (category === 'document') suggestions.push('Store in project document control', 'Create a review task for the project team');
  if (riskDetected) suggestions.unshift('Open a safety or quality follow-up before closing the day');

  return {
    fileType,
    size,
    category,
    confidence: category === 'document' && fileType === 'unknown' ? 'medium' : 'high',
    riskDetected,
    riskLevel: riskLevel || (riskDetected ? 'high' : 'low'),
    amount,
    summary: `${filename} classified as ${category.replace('_', ' ')}${riskDetected ? ' with risk follow-up required' : ''}.`,
    suggestions
  };
}

let legacyStateForMigration = loadLegacyStateForMigration();
const operatingLedger = new ContractorOperatingLedger({
  dbFile: ledgerFile,
  databaseUrl: hostedDatabaseUrl || null,
  stateProvider: () => legacyStateForMigration,
  logger: log
});
// The legacy JSON file is only an import source during construction. All live
// reads and writes are ledger-backed after the synchronous migration completes.
legacyStateForMigration = { jobs: [], workers: [], tools: [] };
function autonomousSchedulerStatus() {
  return {
    enabled: autonomousSchedulerEnabled,
    intervalSeconds: autonomousSchedulerIntervalSeconds,
    leaseSeconds: autonomousSchedulerLeaseSeconds,
    control: operatingLedger.getAutomationControl(),
    job: operatingLedger.getScheduledJob(AUTONOMOUS_SCHEDULER_KEY)
  };
}

function runDurableAutonomousCycle(options = {}) {
  const control = operatingLedger.getAutomationControl();
  if (control.suspended) {
    return {
      success: true,
      ran: false,
      claim: { claimed: false, reason: 'automation_suspended', control },
      scheduler: autonomousSchedulerStatus()
    };
  }
  const claim = operatingLedger.claimScheduledJob(AUTONOMOUS_SCHEDULER_KEY, {
    intervalSeconds: autonomousSchedulerIntervalSeconds,
    leaseSeconds: autonomousSchedulerLeaseSeconds,
    now: options.now
  });
  if (!claim.claimed) return { success: true, ran: false, claim, scheduler: autonomousSchedulerStatus() };

  try {
    const result = operatingLedger.runAutonomousCycle({
      actor: 'durable_scheduler',
      maxActions: Math.max(1, Math.min(25, Number(options.maxActions || 10))),
      source: 'durable_scheduler',
      actionType: options.actionType ?? options.action_type,
      actionTypes: options.actionTypes ?? options.action_types,
      jobId: options.jobId ?? options.job_id,
      jobIds: options.jobIds ?? options.job_ids
    });
    const completion = operatingLedger.completeScheduledJob(AUTONOMOUS_SCHEDULER_KEY, claim.leaseId, {
      success: true,
      actionCount: result.applied?.length || 0,
      blockedCount: result.blocked?.length || 0,
      ranAt: result.ranAt || new Date().toISOString()
    }, { actor: 'durable_scheduler', now: options.now });
    return { success: true, ran: true, result, completion, scheduler: autonomousSchedulerStatus() };
  } catch (error) {
    const completion = operatingLedger.completeScheduledJob(AUTONOMOUS_SCHEDULER_KEY, claim.leaseId, {
      success: false,
      error: error.message || 'Autonomous scheduler failed.'
    }, { actor: 'durable_scheduler', now: options.now });
    log('error', 'durable_autonomous_cycle_failed', { error: serializeError(error) });
    return { success: false, ran: true, error: serializeError(error), completion, scheduler: autonomousSchedulerStatus() };
  }
}

function durableAutonomousCycleResponse(execution, options = {}) {
  if (!execution.success) return execution;
  if (execution.ran) {
    return {
      ...execution.result,
      durable: {
        ran: true,
        completed: Boolean(execution.completion?.completed),
        schedulerKey: AUTONOMOUS_SCHEDULER_KEY
      },
      scheduler: execution.scheduler
    };
  }
  const preview = operatingLedger.runAutonomousCycle({
    ...options,
    actor: 'durable_scheduler_preview',
    dryRun: true
  });
  return {
    ...preview,
    dryRun: false,
    ranAt: null,
    applied: [],
    blocked: [],
    durable: {
      ran: false,
      reason: execution.claim?.reason || 'not_due',
      schedulerKey: AUTONOMOUS_SCHEDULER_KEY
    },
    scheduler: execution.scheduler
  };
}

const autonomousSchedulerTimers = new Set();

function registerAutonomousSchedulerTimer(timer) {
  timer.unref();
  autonomousSchedulerTimers.add(timer);
  return timer;
}

function clearAutonomousSchedulerTimers() {
  const count = autonomousSchedulerTimers.size;
  for (const timer of autonomousSchedulerTimers) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  autonomousSchedulerTimers.clear();
  return count;
}

if (autonomousSchedulerEnabled) {
  registerAutonomousSchedulerTimer(setInterval(
    () => runDurableAutonomousCycle(),
    autonomousSchedulerIntervalSeconds * 1000
  ));
  registerAutonomousSchedulerTimer(setTimeout(() => runDurableAutonomousCycle(), 500));
}

async function handleLedgerRequest(req, res, action, successStatus = 200) {
  try {
    const payload = await action();
    return res.status(successStatus).json(payload);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return sendError(
      req,
      res,
      statusCode,
      error.code || (statusCode === 404 ? 'not_found' : statusCode === 400 ? 'bad_request' : statusCode === 409 ? 'conflict' : 'ledger_error'),
      error.message || 'Ledger request failed',
      error.details || serializeError(error)
    );
  }
}

function resolveUploadLedgerJobDetail(payload = {}) {
  const jobId = payload.ledgerJobId || payload.ledger_job_id || payload.jobId || payload.job_id || null;
  if (!jobId) return null;
  try {
    return operatingLedger.getJobDetail(jobId);
  } catch {
    return null;
  }
}

function createLedgerUploadFollowUps(ledgerDetail, ledgerDocument, payload = {}, analysis = {}, options = {}) {
  if (!ledgerDetail?.id || !ledgerDocument?.id) return { records: {}, actions: [] };

  const filename = ledgerDocument.filename || payload.filename || payload.name || 'uploaded evidence';
  const notes = String(payload.notes || payload.observation || payload.description || analysis.summary || '').trim();
  const evidenceRef = ledgerDocument.storageRef || ledgerDocument.filename || ledgerDocument.id;
  const photos = ledgerDocument.type === 'photo' ? [evidenceRef].filter(Boolean) : [];
  const records = {
    progress: operatingLedger.addProgressUpdate(ledgerDetail.id, {
      progressPercent: ledgerDetail.progressPercent || ledgerDetail.progress || 0,
      note: `Uploaded evidence recorded: ${filename}. ${analysis.summary || notes}`.trim(),
      photos,
      source: 'upload_evidence'
    }, { actor: 'upload_api' })
  };
  const actions = [{ type: 'record_ledger_progress_evidence', id: records.progress.id, message: 'Ledger progress evidence recorded.' }];
  const photoEvidenceSetId = String(
    payload.photoEvidenceSetId || payload.photo_evidence_set_id || ''
  ).trim();
  if (photoEvidenceSetId) {
    const captureEntryKey = String(
      payload.photoEvidenceEntryKey || payload.photo_evidence_entry_key
      || payload.captureEntryKey || payload.capture_entry_key || ''
    ).trim();
    const result = operatingLedger.recordPhotoEvidenceCapture(
      ledgerDetail.id,
      photoEvidenceSetId,
      ledgerDocument.id,
      {
        phase: payload.photoEvidencePhase || payload.photo_evidence_phase || payload.phase,
        capturedAt: payload.capturedAt || payload.captured_at,
        caption: payload.caption || notes,
        capturedByWorkerId: options.workerId,
        entryKey: captureEntryKey
      },
      {
        actor: options.actor || 'upload_api',
        workerId: options.workerId || null,
        enforceWorkerScope: options.enforceWorkerScope === true
      }
    );
    records.photoEvidenceCapture = result.capture;
    records.photoEvidenceSet = result.photoEvidenceSet;
    actions.push({
      type: 'record_governed_photo_evidence',
      id: result.capture.id,
      message: `${result.capture.phase} photo evidence was retained against the scheduled task.`
    });
  }

  if (analysis.riskDetected) {
    records.task = operatingLedger.addTask(ledgerDetail.id, {
      title: `Review uploaded evidence: ${filename}`,
      description: `${analysis.summary || 'Uploaded evidence requires review.'} ${notes}`.trim(),
      status: 'open',
      priority: ['high', 'critical'].includes(String(analysis.riskLevel || '').toLowerCase()) ? 'high' : 'medium',
      source: 'upload_evidence'
    }, { actor: 'upload_api' });
    actions.push({ type: 'create_ledger_evidence_review_task', id: records.task.id, message: 'Ledger review task created from uploaded evidence.' });
  }

  if (analysis.category === 'safety' || ['high', 'critical'].includes(String(analysis.riskLevel || '').toLowerCase())) {
    records.safetyCheck = operatingLedger.addSafetyCheck(ledgerDetail.id, {
      title: `Review uploaded safety evidence: ${filename}`,
      status: 'pending_review',
      riskLevel: analysis.riskLevel || 'high',
      notes: notes || analysis.summary,
      hazards: [analysis.summary || 'Uploaded safety evidence requires review'],
      requiresApproval: true
    }, { actor: 'upload_api' });
    actions.push({ type: 'create_ledger_safety_review', id: records.safetyCheck.id, approvalId: records.safetyCheck.approvalId || records.safetyCheck.approval?.id || null, message: 'Ledger safety review created.' });
  }

  const qualityTerms = `${filename} ${notes} ${analysis.summary || ''}`.toLowerCase();
  if (analysis.category === 'field_photo' && (analysis.riskDetected || /defect|damage|crack|quality|issue|poor|leak|schade/i.test(qualityTerms))) {
    records.qualityCheck = operatingLedger.addQualityCheck(ledgerDetail.id, {
      title: `Review uploaded quality evidence: ${filename}`,
      status: 'pending_review',
      result: 'pending',
      defectsOpen: 1,
      defects: [{ title: 'Uploaded evidence needs quality review', documentId: ledgerDocument.id }],
      notes: notes || analysis.summary,
      photos,
      wkbEvidence: true,
      requiresApproval: true
    }, { actor: 'upload_api' });
    actions.push({ type: 'create_ledger_quality_review', id: records.qualityCheck.id, approvalId: records.qualityCheck.approvalId || records.qualityCheck.approval?.id || null, message: 'Ledger quality review created.' });
  }

  return { records, actions };
}

// API Routes
app.all('/api/dashboard', (req, res) => res.status(410).json({
  error: {
    code: 'dashboard_facade_retired',
    message: 'The unversioned dashboard facade is retired. Use the operating-ledger dashboard and resource routes.',
    requestId: req.requestId
  },
  migration: {
    dashboard: '/api/ledger/dashboard',
    jobs: '/api/ledger/jobs',
    workers: '/api/ledger/workers',
    tools: '/api/ledger/tools',
    weather: '/api/ledger/weather'
  }
}));

app.get('/api/ledger/dashboard', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.get('/api/ledger/organization', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    organization: operatingLedger.getOrganizationProfile()
  }));
});

app.put('/api/ledger/organization', (req, res) => {
  if (req.operator?.role !== 'owner') {
    return sendError(req, res, 403, 'insufficient_role', 'Only an owner can change the retained business identity.');
  }
  return handleLedgerRequest(req, res, () => ({
    success: true,
    organization: operatingLedger.updateOrganizationProfile(req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    })
  }));
});

app.get('/api/ledger/weather', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    weather: operatingLedger.weatherOverview()
  }));
});

app.get('/api/ledger/documents/:id/content', async (req, res) => {
  try {
    const document = operatingLedger.getDocument(req.params.id);
    if (!fieldWorkerCanAccessJob(req, document.jobId)) {
      return sendError(req, res, 403, 'field_job_scope_forbidden', 'This field worker is not assigned to the evidence job.');
    }
    if (!evidenceStorage) throw evidenceStorageInitError || new EvidenceStorageError('storage_unavailable', 'Evidence storage is unavailable.');
    const evidence = await evidenceStorage.read(document.storageRef);
    const expectedChecksum = String(
      document.data?.sourceDocumentChecksum
      || document.data?.analysis?.upload?.sha256
      || document.data?.contentHash
      || ''
    ).trim().toLowerCase();
    if (expectedChecksum) {
      const actualChecksum = crypto.createHash('sha256').update(evidence).digest('hex');
      if (actualChecksum !== expectedChecksum) {
        const error = new Error('The retained evidence bytes no longer match the upload checksum.');
        error.statusCode = 409;
        error.code = 'evidence_content_integrity_failed';
        throw error;
      }
    }
    operatingLedger.audit({
      entityType: 'document',
      entityId: document.id,
      jobId: document.jobId,
      action: 'download_document',
      actor: req.operator?.role || 'authenticated_operator',
      after: { storageRef: document.storageRef, filename: document.filename }
    });
    res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(evidence.length));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(document.filename || 'evidence')}`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.end(evidence);
  } catch (error) {
    return sendError(req, res, error.statusCode || 500, error.code || (error.statusCode ? 'not_found' : 'evidence_download_failed'), error.statusCode ? error.message : 'Unable to retrieve the retained evidence file.', serializeError(error));
  }
});

app.get('/api/ledger/opportunity-evidence/:id/content', async (req, res) => {
  try {
    if (req.operator?.role === 'field_worker') {
      return sendError(req, res, 403, 'opportunity_evidence_forbidden', 'Field workers cannot access private preconstruction opportunity evidence.');
    }
    const retained = operatingLedger.getOpportunityEvidence(req.params.id);
    if (!retained.storageRef || !retained.contentHash) {
      return sendError(req, res, 409, 'opportunity_evidence_content_missing', 'This evidence record has no retained private file and checksum.');
    }
    if (!evidenceStorage) throw evidenceStorageInitError || new EvidenceStorageError('storage_unavailable', 'Evidence storage is unavailable.');
    const evidence = await evidenceStorage.read(retained.storageRef);
    const actualChecksum = crypto.createHash('sha256').update(evidence).digest('hex');
    if (actualChecksum !== retained.contentHash) {
      const error = new Error('The retained opportunity evidence bytes no longer match the upload checksum.');
      error.statusCode = 409;
      error.code = 'opportunity_evidence_integrity_failed';
      throw error;
    }
    operatingLedger.audit({
      entityType: 'opportunity_evidence',
      entityId: retained.id,
      action: 'download_opportunity_evidence',
      actor: actorFromRequest(req, 'authenticated_operator'),
      after: { opportunityId: retained.opportunityId, storageRef: retained.storageRef, filename: retained.filename },
      metadata: { contentHash: retained.contentHash, private: true, externalCommitments: 0 }
    });
    res.setHeader('Content-Type', retained.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(evidence.length));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(retained.filename || 'opportunity-evidence')}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end(evidence);
  } catch (error) {
    return sendError(
      req,
      res,
      error.statusCode || 500,
      error.code || 'opportunity_evidence_download_failed',
      error.statusCode ? error.message : 'Unable to retrieve the retained opportunity evidence file.',
      serializeError(error)
    );
  }
});

app.get('/api/ledger/documents/:id/issue-package', (req, res) => {
  try {
    const issuePackage = operatingLedger.getIssuePackage(req.params.id, {
      actor: actorFromRequest(req, 'authenticated_operator')
    });
    res.setHeader('Content-Type', issuePackage.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(Buffer.byteLength(issuePackage.content, 'utf8')));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(issuePackage.filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end(issuePackage.content);
  } catch (error) {
    return sendError(
      req,
      res,
      error.statusCode || 500,
      error.code || 'issue_package_download_failed',
      error.statusCode ? error.message : 'Unable to prepare the retained issue package for download.',
      serializeError(error)
    );
  }
});

app.get('/api/ledger/capabilities', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const coverage = operatingLedger.ledgerCapabilityCoverage();
    return {
      success: true,
      summary: coverage.summary,
      capabilities: coverage.capabilities,
      blueprint: LEDGER_CAPABILITY_BLUEPRINT,
      playbooks: JOB_OPERATING_PLAYBOOKS.map(playbook => ({
        key: playbook.key,
        label: playbook.label,
        keywords: playbook.keywords,
        tasks: playbook.tasks.length,
        tools: playbook.tools.length,
        materials: playbook.materials.length
      })),
      dashboard: operatingLedger.dashboardSummary()
    };
  });
});

app.get('/api/ledger/command-plan', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.buildTodayCommandPlan(req.query || {}),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/ledger/command-plan', (req, res) => {
  if (req.operator?.role !== 'owner') {
    return sendError(req, res, 403, 'insufficient_role', 'Only an owner can apply command-plan automation.');
  }
  return handleLedgerRequest(req, res, () => {
    const payload = req.body || {};
    const mode = String(payload.mode || payload.action || 'apply').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const result = mode === 'preview'
      ? operatingLedger.buildTodayCommandPlan(payload)
      : operatingLedger.applyTodayCommandPlan(payload, { actor: payload.actor || 'dashboard' });
    return {
      success: true,
      ...result,
      commandPlan: mode === 'preview'
        ? result
        : operatingLedger.buildTodayCommandPlan({
            mode: payload.refreshMode || 'all',
            limit: 100,
            jobLimit: payload.jobLimit || payload.job_limit || 12
          }),
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.get('/api/ledger/playbooks', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    playbooks: operatingLedger.listJobPlaybooks()
  }));
});

app.get('/api/ledger/jobs', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    jobs: scopedLedgerJobs(req, req.query || {}),
    dashboard: req.operator?.role === 'field_worker'
      ? { fieldScoped: true, jobCount: scopedLedgerJobs(req, req.query || {}).length }
      : operatingLedger.dashboardSummary()
  }));
});

app.get('/api/ledger/opportunities', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    opportunities: operatingLedger.listOpportunities(req.query || {}),
    forecast: operatingLedger.opportunityForecast(req.query || {})
  }));
});

app.post('/api/ledger/opportunities', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    opportunity: operatingLedger.createOpportunity(req.body || {}, {
      actor: actorFromRequest(req, 'pipeline')
    }),
    forecast: operatingLedger.opportunityForecast()
  }), 201);
});

app.get('/api/ledger/market-fit', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    marketFit: operatingLedger.marketFitRegister(req.query || {})
  }));
});

app.post('/api/ledger/market-fit/profiles', (req, res) => {
  if (req.operator?.role !== 'owner') {
    return sendError(req, res, 403, 'insufficient_role', 'Only an owner can request an ICP and service-area policy revision.');
  }
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestMarketFitProfile(req.body || {}, {
      actor: actorFromRequest(req, 'market_fit_policy')
    }),
    marketFit: operatingLedger.marketFitRegister()
  }), 201);
});

app.get('/api/ledger/opportunities/:id/market-fit', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    evaluation: operatingLedger.assessOpportunityMarketFit(req.params.id),
    assessments: operatingLedger.listOpportunityFitAssessments({ opportunityId: req.params.id, limit: 100 })
  }));
});

app.post('/api/ledger/opportunities/:id/market-fit-assessments', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.retainOpportunityFitAssessment(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'market_fit_assessment')
    }),
    evaluation: operatingLedger.assessOpportunityMarketFit(req.params.id)
  }), 201);
});

app.get('/api/ledger/bid-decisions', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    bidDecisions: operatingLedger.bidDecisionRegister(req.query || {})
  }));
});

app.post('/api/ledger/bid-decisions/policies', (req, res) => {
  if (req.operator?.role !== 'owner') {
    return sendError(req, res, 403, 'insufficient_role', 'Only an owner can request a bid/no-bid scorecard policy revision.');
  }
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestBidDecisionPolicy(req.body || {}, {
      actor: actorFromRequest(req, 'bid_decision_policy')
    }),
    bidDecisions: operatingLedger.bidDecisionRegister()
  }), 201);
});

app.get('/api/ledger/estimate-rates', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    estimateRates: operatingLedger.estimateRateRegister(req.query || {})
  }));
});

app.post('/api/ledger/estimate-rates/policies', (req, res) => {
  if (req.operator?.role !== 'owner') {
    return sendError(req, res, 403, 'insufficient_role', 'Only an owner can request an estimating rate policy revision.');
  }
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestEstimateRatePolicy(req.body || {}, {
      actor: actorFromRequest(req, 'estimate_rate_policy')
    }),
    estimateRates: operatingLedger.estimateRateRegister()
  }), 201);
});

app.get('/api/ledger/opportunities/:id/bid-decision', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    bidDecision: operatingLedger.bidDecisionForOpportunity(req.params.id)
  }));
});

app.post('/api/ledger/opportunities/:id/bid-decisions', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestOpportunityBidDecision(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'bid_decision')
    }),
    bidDecision: operatingLedger.bidDecisionForOpportunity(req.params.id)
  }), 201);
});

app.get('/api/ledger/site-surveys', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    siteSurveys: operatingLedger.siteSurveyRegister(req.query || {})
  }));
});

app.get('/api/ledger/opportunities/:id/site-surveys', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    siteSurvey: operatingLedger.siteSurveyForOpportunity(req.params.id),
    evidence: operatingLedger.listOpportunityEvidence({ opportunityId: req.params.id, limit: 500 })
  }));
});

app.post('/api/ledger/opportunities/:id/site-surveys', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestOpportunitySiteSurvey(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'site_survey_plan')
    }),
    siteSurvey: operatingLedger.siteSurveyForOpportunity(req.params.id)
  }), 201);
});

app.post('/api/ledger/opportunities/:id/site-surveys/:surveyId/submissions', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.submitOpportunitySiteSurvey(req.params.id, req.params.surveyId, req.body || {}, {
      actor: actorFromRequest(req, 'site_survey_completion')
    }),
    siteSurvey: operatingLedger.siteSurveyForOpportunity(req.params.id)
  }), 201);
});

app.get('/api/ledger/opportunities/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    opportunity: operatingLedger.getOpportunity(req.params.id)
  }));
});

app.patch('/api/ledger/opportunities/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    opportunity: operatingLedger.updateOpportunity(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'pipeline')
    }),
    forecast: operatingLedger.opportunityForecast()
  }));
});

app.post('/api/ledger/opportunities/:id/activities', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.createOpportunityActivity(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'pipeline')
    }),
    opportunity: operatingLedger.getOpportunity(req.params.id)
  }), 201);
});

app.patch('/api/ledger/opportunities/:id/activities/:activityId', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    activity: operatingLedger.updateOpportunityActivity(req.params.id, req.params.activityId, req.body || {}, {
      actor: actorFromRequest(req, 'pipeline')
    }),
    opportunity: operatingLedger.getOpportunity(req.params.id)
  }));
});

app.post('/api/ledger/opportunities/:id/convert', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.convertOpportunityToJob(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'pipeline')
    }),
    forecast: operatingLedger.opportunityForecast()
  }), 201);
});

app.get('/api/ledger/bid-packages', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const bidPackages = operatingLedger.listBidPackages(req.query || {});
    return {
      success: true,
      bidPackages,
      summary: operatingLedger.summarizeBidPackages(
        operatingLedger.listBidPackages({ includeClosed: true, limit: 500 })
      )
    };
  });
});

app.post('/api/ledger/bid-packages', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const payload = req.body || {};
    return {
      success: true,
      bidPackage: operatingLedger.createBidPackage(
        payload.opportunityId || payload.opportunity_id,
        payload,
        { actor: actorFromRequest(req, 'pipeline') }
      )
    };
  }, 201);
});

app.get('/api/ledger/bid-packages/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    bidPackage: operatingLedger.getBidPackage(req.params.id)
  }));
});

app.post('/api/ledger/bid-packages/:id/participants', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.addBidPackageParticipants(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'pipeline')
    })
  }), 201);
});

app.put('/api/ledger/bid-packages/:id/participants/:participantId/return', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.recordBidReturn(req.params.id, req.params.participantId, req.body || {}, {
      actor: actorFromRequest(req, 'pipeline')
    })
  }));
});

app.post('/api/ledger/bid-packages/:id/selection', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestBidPackageSelection(
      req.params.id,
      req.body?.participantId || req.body?.participant_id,
      req.body || {},
      { actor: actorFromRequest(req, 'pipeline') }
    )
  }), 201);
});

app.post('/api/ledger/bid-packages/:id/commitment', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const commitment = operatingLedger.createBidPackageCommitment(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'pipeline')
    });
    return {
      success: true,
      ...commitment,
      job: commitment.bidPackage.jobId ? operatingLedger.getJobDetail(commitment.bidPackage.jobId) : null,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/ledger/intake', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    job: operatingLedger.createIntake(req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.get('/api/ledger/jobs/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    job: jobForOperator(req, req.params.id, { includeAudit: true })
  }));
});

app.put('/api/ledger/jobs/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.updateJobWithApproval(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.patch('/api/ledger/jobs/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.updateJobWithApproval(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/ledger/jobs/:id/archive', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestJobArchive(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    dashboard: String(req.query.includeDashboard ?? req.query.include_dashboard ?? 'true').toLowerCase() !== 'false'
      ? operatingLedger.dashboardSummary()
      : null
  }), 201);
});

app.post('/api/ledger/jobs/:id/restore', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestJobRestore(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    dashboard: String(req.query.includeDashboard ?? req.query.include_dashboard ?? 'true').toLowerCase() !== 'false'
      ? operatingLedger.dashboardSummary()
      : null
  }), 201);
});

app.get('/api/ledger/jobs/:id/playbook', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.buildJobPlaybookPlan(req.params.id, req.query || {}),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/ledger/jobs/:id/playbook', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const payload = req.body || {};
    const mode = String(payload.mode || payload.action || 'apply').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const result = mode === 'preview'
      ? operatingLedger.buildJobPlaybookPlan(req.params.id, payload)
      : operatingLedger.applyJobPlaybook(req.params.id, payload, { actor: payload.actor || 'dashboard' });
    return {
      success: true,
      ...result,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.get('/api/ledger/jobs/:id/capability-plan', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.buildJobCapabilityPlan(req.params.id, req.query || {}),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/ledger/jobs/:id/capability-plan', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const payload = req.body || {};
    const mode = String(payload.mode || payload.action || 'apply').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const result = mode === 'preview'
      ? operatingLedger.buildJobCapabilityPlan(req.params.id, payload)
      : operatingLedger.applyJobCapabilityPlan(req.params.id, payload, { actor: actorFromRequest(req, payload.actor || 'dashboard') });
    return {
      success: true,
      ...result,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/tasks', (req, res) => {
  return handleLedgerRequest(req, res, () => operatingLedger.transaction(() => {
    const payload = req.body || {};
    const actor = actorFromRequest(req, payload.actor || 'dashboard');
    const task = operatingLedger.addTask(req.params.id, payload, { actor });
    const predecessorTaskId = payload.predecessorTaskId || payload.predecessor_task_id || null;
    const dependency = predecessorTaskId
      ? operatingLedger.addTaskDependency(req.params.id, {
        predecessorTaskId,
        successorTaskId: task.id,
        lagHours: payload.lagHours || payload.lag_hours || 0,
        source: payload.source || 'task_create'
      }, { actor })
      : null;
    return {
      success: true,
      task,
      dependency,
      job: operatingLedger.getJobDetail(req.params.id)
    };
  }), 201);
});

app.patch('/api/ledger/jobs/:id/tasks/:taskId/schedule', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    task: operatingLedger.updateTaskSchedule(req.params.id, req.params.taskId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: operatingLedger.getJobDetail(req.params.id)
  }));
});

app.post('/api/ledger/jobs/:id/work-plan/calculate', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    plan: operatingLedger.calculateJobSchedule(req.params.id, req.body || {})
  }));
});

app.post('/api/ledger/jobs/:id/task-dependencies', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    dependency: operatingLedger.addTaskDependency(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: operatingLedger.getJobDetail(req.params.id)
  }), 201);
});

app.post('/api/ledger/jobs/:id/task-dependencies/:dependencyId/cancel', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    dependency: operatingLedger.cancelTaskDependency(req.params.id, req.params.dependencyId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: operatingLedger.getJobDetail(req.params.id)
  }));
});

app.post('/api/ledger/jobs/:id/schedule-baselines', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestScheduleBaseline(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.get('/api/ledger/jobs/:id/takeoffs', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    takeoffs: operatingLedger.listTakeoffs(req.params.id)
  }));
});

app.post('/api/ledger/jobs/:id/takeoffs', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    takeoff: operatingLedger.createTakeoff(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'commercial')
    }),
    job: operatingLedger.getJobDetail(req.params.id)
  }), 201);
});

app.get('/api/ledger/jobs/:id/takeoffs/:takeoffId', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    takeoff: operatingLedger.getTakeoff(req.params.id, req.params.takeoffId)
  }));
});

app.put('/api/ledger/jobs/:id/takeoffs/:takeoffId', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    takeoff: operatingLedger.updateTakeoff(req.params.id, req.params.takeoffId, req.body || {}, {
      actor: actorFromRequest(req, 'commercial')
    }),
    job: operatingLedger.getJobDetail(req.params.id)
  }));
});

app.post('/api/ledger/jobs/:id/takeoffs/:takeoffId/items', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.addTakeoffItem(req.params.id, req.params.takeoffId, req.body || {}, {
      actor: actorFromRequest(req, 'commercial')
    }),
    job: operatingLedger.getJobDetail(req.params.id)
  }), 201);
});

app.put('/api/ledger/jobs/:id/takeoffs/:takeoffId/items/:itemId', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.updateTakeoffItem(req.params.id, req.params.takeoffId, req.params.itemId, req.body || {}, {
      actor: actorFromRequest(req, 'commercial')
    }),
    job: operatingLedger.getJobDetail(req.params.id)
  }));
});

app.post('/api/ledger/jobs/:id/takeoffs/:takeoffId/items/:itemId/rate-build-up', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.applyTakeoffUnitRate(req.params.id, req.params.takeoffId, req.params.itemId, req.body || {}, {
      actor: actorFromRequest(req, 'commercial')
    }),
    job: operatingLedger.getJobDetail(req.params.id)
  }));
});

app.post('/api/ledger/jobs/:id/takeoffs/:takeoffId/items/:itemId/remove', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.removeTakeoffItem(req.params.id, req.params.takeoffId, req.params.itemId, {
      actor: actorFromRequest(req, 'commercial')
    }),
    job: operatingLedger.getJobDetail(req.params.id)
  }));
});

app.post('/api/ledger/jobs/:id/takeoffs/:takeoffId/convert', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.convertTakeoffToQuote(req.params.id, req.params.takeoffId, req.body || {}, {
      actor: actorFromRequest(req, 'commercial')
    }),
    job: operatingLedger.getJobDetail(req.params.id)
  }), 201);
});

app.get('/api/ledger/jobs/:id/commercial-scope', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    commercialScope: operatingLedger.commercialScopeForJob(req.params.id)
  }));
});

app.post('/api/ledger/jobs/:id/commercial-scope/revisions', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestCommercialScopeRevision(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'commercial')
    }),
    commercialScope: operatingLedger.commercialScopeForJob(req.params.id),
    job: operatingLedger.getJobDetail(req.params.id)
  }), 201);
});

app.get('/api/ledger/jobs/:id/risk-register', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    riskRegister: operatingLedger.riskRegisterForJob(req.params.id)
  }));
});

app.post('/api/ledger/jobs/:id/risk-register/revisions', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestRiskRegisterRevision(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'commercial')
    }),
    riskRegister: operatingLedger.riskRegisterForJob(req.params.id),
    job: operatingLedger.getJobDetail(req.params.id)
  }), 201);
});

app.get('/api/ledger/jobs/:id/pricing-basis', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    pricingBasis: operatingLedger.pricingBasisForJob(req.params.id)
  }));
});

app.post('/api/ledger/jobs/:id/pricing-decisions', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.retainPricingBasisDecision(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'commercial')
    }),
    pricingBasis: operatingLedger.pricingBasisForJob(req.params.id),
    job: operatingLedger.getJobDetail(req.params.id)
  }), 201);
});

app.post('/api/ledger/jobs/:id/quote', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    quote: operatingLedger.createQuote(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id)
  }), 201);
});

app.post('/api/ledger/jobs/:id/quotes/:quoteId/issue-package', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const issuePackage = operatingLedger.prepareQuoteIssuePackage(
      req.params.id,
      req.params.quoteId,
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      ...issuePackage,
      job: operatingLedger.getJobDetail(req.params.id)
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/quotes/:quoteId/acceptance', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const acceptance = operatingLedger.requestQuoteAcceptance(
      req.params.id,
      req.params.quoteId,
      req.body || {},
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      ...acceptance,
      job: operatingLedger.getJobDetail(req.params.id)
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/site-visits', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    siteVisit: operatingLedger.createSiteVisit(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/change-orders', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    changeOrder: operatingLedger.createChangeOrder(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/change-orders/:changeOrderId/issue-package', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const issuePackage = operatingLedger.prepareChangeOrderIssuePackage(
      req.params.id,
      req.params.changeOrderId,
      req.body || {},
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      ...issuePackage,
      job: operatingLedger.getJobDetail(req.params.id),
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/change-orders/:changeOrderId/acceptance', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const acceptance = operatingLedger.requestChangeOrderAcceptance(
      req.params.id,
      req.params.changeOrderId,
      req.body || {},
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      ...acceptance,
      job: operatingLedger.getJobDetail(req.params.id),
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.get('/api/ledger/jobs/:id/daywork-tickets', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const filters = { ...(req.query || {}), jobId: req.params.id };
    if (req.operator?.role === 'field_worker') filters.workerId = fieldWorkerIdentity(req).workerId;
    const dayworkTickets = operatingLedger.listDayworkTickets(filters);
    return {
      success: true,
      dayworkTickets: req.operator?.role === 'field_worker'
        ? dayworkTickets.map(projectFieldDayworkTicket)
        : dayworkTickets,
      policy: {
        quantityCapture: 'observed_evidence_only',
        internalApprovalRequired: true,
        clientAcknowledgementMeansReceiptOnly: true,
        commercialConversionApprovalRequired: true,
        externalCommitments: 0
      }
    };
  });
});

app.post('/api/ledger/jobs/:id/daywork-tickets', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.createDayworkTicket(
      req.params.id,
      dayworkTicketPayloadForOperator(req, req.body || {}),
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      dayworkTicket: req.operator?.role === 'field_worker' ? projectFieldDayworkTicket(result.ticket) : result.ticket,
      approval: req.operator?.role === 'field_worker' ? undefined : result.approval,
      replayed: result.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      externalCommitments: 0
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/daywork-tickets/:ticketId/acknowledgement', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.requestDayworkAcknowledgement(
      req.params.id,
      req.params.ticketId,
      req.body || {},
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      dayworkTicket: result.ticket,
      approval: result.approval,
      replayed: result.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      externalCommitments: 0
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/daywork-tickets/:ticketId/convert', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.convertDayworkTicketToChangeOrder(
      req.params.id,
      req.params.ticketId,
      req.body || {},
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      ...result,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      externalCommitments: 0
    };
  }, 201);
});

app.get('/api/ledger/jobs/:id/nonconformances', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    nonconformances: req.operator?.role === 'field_worker'
      ? operatingLedger.listNonconformances({ jobId: req.params.id, limit: req.query.limit }).map(projectFieldRecord)
      : operatingLedger.listNonconformances({ ...(req.query || {}), jobId: req.params.id }),
    policy: {
      fieldCapture: true,
      correctiveActionApprovalRequired: true,
      independentClosureApprovalRequired: true,
      externalCommitments: 0
    }
  }));
});

app.post('/api/ledger/jobs/:id/nonconformances', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.createNonconformance(
      req.params.id,
      nonconformancePayloadForOperator(req, req.body || {}),
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      nonconformance: recordForOperator(req, result.nonconformance),
      replayed: result.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      externalCommitments: 0
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/nonconformances/:recordId/corrective-action', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.requestNonconformanceCorrectiveAction(
      req.params.id,
      req.params.recordId,
      req.body || {},
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      ...result,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      externalCommitments: 0
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/nonconformances/:recordId/closure', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.requestNonconformanceClosure(
      req.params.id,
      req.params.recordId,
      req.body || {},
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      ...result,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      externalCommitments: 0
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/field-reports', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    fieldReport: recordForOperator(req, operatingLedger.createFieldReport(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' })),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.post('/api/ledger/jobs/:id/rfis', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    rfi: recordForOperator(req, operatingLedger.createRfi(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' })),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.post('/api/ledger/jobs/:id/submittals', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    submittal: recordForOperator(req, operatingLedger.createSubmittalRecord(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' })),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.post('/api/ledger/jobs/:id/client-selections', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    clientSelection: operatingLedger.createClientSelection(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/permits', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    permit: operatingLedger.createPermitRecord(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.get('/api/ledger/pre-task-plans', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const filters = { ...(req.query || {}) };
    if (req.operator?.role === 'field_worker') filters.workerId = fieldWorkerIdentity(req).workerId;
    const plans = operatingLedger.listPreTaskPlans(filters)
      .filter(plan => fieldWorkerCanAccessJob(req, plan.jobId))
      .map(plan => preTaskPlanForOperator(req, plan));
    return {
      success: true,
      preTaskPlans: plans,
      policy: {
        approvalRequired: true,
        sourceCurrentApproval: true,
        exactWorkerAcknowledgementRequired: true,
        immediateSafetySuspension: true,
        revisionSupersession: true,
        activationInference: false,
        acknowledgementInference: false,
        externalCommitments: 0
      }
    };
  });
});

app.get('/api/ledger/jobs/:id/pre-task-plans', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const filters = { ...(req.query || {}), jobId: req.params.id };
    if (req.operator?.role === 'field_worker') filters.workerId = fieldWorkerIdentity(req).workerId;
    return {
      success: true,
      preTaskPlans: operatingLedger.listPreTaskPlans(filters).map(plan => preTaskPlanForOperator(req, plan))
    };
  });
});

app.post('/api/ledger/jobs/:id/pre-task-plans', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.createPreTaskPlan(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      preTaskPlan: result.plan,
      approval: result.approval,
      replayed: result.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      externalCommitments: 0
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/pre-task-plans/:planId/acknowledgments', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.acknowledgePreTaskPlan(
      req.params.id,
      req.params.planId,
      preTaskPlanAcknowledgementPayloadForOperator(req, req.body || {}),
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      preTaskPlan: preTaskPlanForOperator(req, result.plan),
      attendee: recordForOperator(req, result.attendee),
      replayed: result.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      externalCommitments: 0
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/pre-task-plans/:planId/suspend', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const identity = req.operator?.role === 'field_worker' ? fieldWorkerIdentity(req) : { workerId: null };
    const result = operatingLedger.suspendPreTaskPlan(req.params.id, req.params.planId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard'),
      workerId: identity.workerId
    });
    return {
      success: true,
      preTaskPlan: preTaskPlanForOperator(req, result.plan),
      replayed: result.replayed === true,
      stopWorkImmediate: true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      externalCommitments: 0
    };
  });
});

app.post('/api/ledger/jobs/:id/pre-task-plans/:planId/close', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.closePreTaskPlan(req.params.id, req.params.planId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      preTaskPlan: result.plan,
      replayed: result.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      externalCommitments: 0
    };
  });
});

app.get('/api/ledger/lmra', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const filters = { ...(req.query || {}) };
    if (req.operator?.role === 'field_worker') filters.workerId = fieldWorkerIdentity(req).workerId;
    const assessments = operatingLedger.listLmraAssessments(filters)
      .filter(assessment => fieldWorkerCanAccessJob(req, assessment.jobId))
      .map(assessment => lmraForOperator(req, assessment));
    return {
      success: true,
      lmraAssessments: assessments,
      policy: {
        workerScopedActualEvidence: true,
        exactReplay: true,
        sourceCurrentAtServerReceipt: true,
        queuedOfflineAuthorizesWork: false,
        validityMinutesMaximum: 240,
        changedConditionsRequireReassessment: true,
        stopWorkImmediate: true,
        authorizationInference: false,
        externalCommitments: 0
      }
    };
  });
});

app.get('/api/ledger/jobs/:id/lmra', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const filters = { ...(req.query || {}), jobId: req.params.id };
    if (req.operator?.role === 'field_worker') filters.workerId = fieldWorkerIdentity(req).workerId;
    return {
      success: true,
      lmraAssessments: operatingLedger.listLmraAssessments(filters).map(assessment => lmraForOperator(req, assessment))
    };
  });
});

app.post('/api/ledger/jobs/:id/lmra', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.createLmraAssessment(
      req.params.id,
      lmraPayloadForOperator(req, req.body || {}),
      { actor: actorFromRequest(req, 'field_lmra_assessment') }
    );
    return {
      success: true,
      lmraAssessment: lmraForOperator(req, result.assessment),
      replayed: result.replayed === true,
      stopWorkImmediate: result.stopWorkImmediate === true,
      authorizationInferred: false,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      externalCommitments: 0
    };
  }, 201);
});

app.get('/api/ledger/work-permits', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const filters = { ...(req.query || {}) };
    if (req.operator?.role === 'field_worker') filters.workerId = fieldWorkerIdentity(req).workerId;
    const permits = operatingLedger.listWorkPermits(filters)
      .filter(permit => fieldWorkerCanAccessJob(req, permit.jobId))
      .map(permit => workPermitForOperator(req, permit));
    return {
      success: true,
      workPermits: permits,
      policy: {
        approvalRequired: true,
        sourceCurrentApproval: true,
        workerAcknowledgementRequired: true,
        immediateSafetySuspension: true,
        externalCommitments: 0
      }
    };
  });
});

app.get('/api/ledger/jobs/:id/work-permits', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const filters = { ...(req.query || {}), jobId: req.params.id };
    if (req.operator?.role === 'field_worker') filters.workerId = fieldWorkerIdentity(req).workerId;
    return {
      success: true,
      workPermits: operatingLedger.listWorkPermits(filters).map(permit => workPermitForOperator(req, permit))
    };
  });
});

app.post('/api/ledger/jobs/:id/work-permits', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.createWorkPermit(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      workPermit: result.permit,
      approval: result.approval,
      replayed: result.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      externalCommitments: 0
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/work-permits/:permitId/acknowledgments', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.acknowledgeWorkPermit(
      req.params.id,
      req.params.permitId,
      workPermitAcknowledgementPayloadForOperator(req, req.body || {}),
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      workPermit: workPermitForOperator(req, result.permit),
      attendee: recordForOperator(req, result.attendee),
      replayed: result.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      externalCommitments: 0
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/work-permits/:permitId/suspend', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.suspendWorkPermit(req.params.id, req.params.permitId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }));
});

app.post('/api/ledger/jobs/:id/work-permits/:permitId/close', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.closeWorkPermit(req.params.id, req.params.permitId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }));
});

app.get('/api/ledger/inspection-templates', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    templates: operatingLedger.listInspectionTemplates({
      includeSuperseded: req.query.includeSuperseded === 'true',
      discipline: req.query.discipline
    })
  }));
});

app.get('/api/ledger/installation-qc', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const workerId = req.operator?.role === 'field_worker'
      ? req.operator.scope?.workerId
      : (req.query.workerId || req.query.worker_id);
    return {
      success: true,
      controls: operatingLedger.listInstallationQcControls({
        jobId: req.query.jobId || req.query.job_id,
        taskId: req.query.taskId || req.query.task_id,
        workerId,
        limit: req.query.limit
      }).map(control => recordForOperator(req, control))
    };
  });
});

app.get('/api/ledger/jobs/:id/installation-qc', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const workerId = req.operator?.role === 'field_worker'
      ? req.operator.scope?.workerId
      : (req.query.workerId || req.query.worker_id);
    return {
      success: true,
      controls: operatingLedger.listInstallationQcControls({
        jobId: req.params.id,
        taskId: req.query.taskId || req.query.task_id,
        workerId,
        limit: req.query.limit
      }).map(control => recordForOperator(req, control))
    };
  });
});

app.get('/api/ledger/photo-evidence', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const workerId = req.operator?.role === 'field_worker'
      ? req.operator.scope?.workerId
      : (req.query.workerId || req.query.worker_id);
    return {
      success: true,
      photoEvidenceSets: operatingLedger.listPhotoEvidenceSets({
        jobId: req.query.jobId || req.query.job_id,
        taskId: req.query.taskId || req.query.task_id,
        workerId,
        status: req.query.status,
        limit: req.query.limit
      }).map(set => recordForOperator(req, set))
    };
  });
});

app.get('/api/ledger/jobs/:id/photo-evidence', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const workerId = req.operator?.role === 'field_worker'
      ? req.operator.scope?.workerId
      : (req.query.workerId || req.query.worker_id);
    return {
      success: true,
      photoEvidenceSets: operatingLedger.listPhotoEvidenceSets({
        jobId: req.params.id,
        taskId: req.query.taskId || req.query.task_id,
        workerId,
        status: req.query.status,
        limit: req.query.limit
      }).map(set => recordForOperator(req, set))
    };
  });
});

app.post('/api/ledger/jobs/:id/photo-evidence', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    photoEvidenceSet: operatingLedger.createPhotoEvidenceSet(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.post('/api/ledger/jobs/:id/photo-evidence/:setId/review', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestPhotoEvidenceReview(req.params.id, req.params.setId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.post('/api/ledger/inspection-templates', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    template: operatingLedger.createInspectionTemplate(req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    })
  }), 201);
});

app.post('/api/ledger/jobs/:id/inspection-checklists', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    inspection: operatingLedger.createInspectionFromTemplate(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.post('/api/ledger/jobs/:id/inspections', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    inspection: operatingLedger.createInspectionRecord(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.post('/api/ledger/jobs/:id/inspections/:inspectionId/checklist-submissions', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const installationQc = operatingLedger.getInstallationQcControl(req.params.inspectionId, {
      jobId: req.params.id
    });
    const payload = inspectionChecklistPayloadForOperator(req, req.body || {}, {
      requireWorkerIdentity: Boolean(installationQc)
    });
    const result = operatingLedger.submitInspectionChecklist(req.params.id, req.params.inspectionId, payload, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard'),
      workerId: installationQc && req.operator?.role === 'field_worker' ? req.operator.scope?.workerId : null,
      enforceWorkerScope: Boolean(installationQc && req.operator?.authenticated === true)
    });
    return {
      success: true,
      inspection: recordForOperator(req, result.inspection),
      submission: recordForOperator(req, result.submission),
      observations: (result.observations || []).map(record => recordForOperator(req, record)),
      approval: req.operator?.role === 'field_worker' ? null : result.approval,
      replayed: result.replayed,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/observations', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const observation = operatingLedger.createObservationRecord(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      observation: recordForOperator(req, observation),
      replayed: observation.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/incidents', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const incident = operatingLedger.createIncidentRecord(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      incident: recordForOperator(req, incident),
      replayed: incident.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/safety-meetings', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const safetyMeeting = operatingLedger.createSafetyMeeting(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      safetyMeeting: safetyMeetingForOperator(req, safetyMeeting),
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.get('/api/ledger/safety-briefings', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const meetings = operatingLedger.listSafetyMeetings(req.query || {})
      .filter(meeting => fieldWorkerCanAccessJob(req, meeting.jobId))
      .map(meeting => safetyMeetingForOperator(req, meeting));
    return { success: true, safetyMeetings: meetings };
  });
});

app.get('/api/ledger/jobs/:id/safety-meetings', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    safetyMeetings: operatingLedger.listSafetyMeetings({ ...(req.query || {}), jobId: req.params.id })
      .map(meeting => safetyMeetingForOperator(req, meeting))
  }));
});

app.post('/api/ledger/jobs/:id/safety-meetings/:meetingId/acknowledgments', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.acknowledgeSafetyMeeting(
      req.params.id,
      req.params.meetingId,
      safetyAcknowledgementPayloadForOperator(req, req.body || {}),
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      safetyMeeting: safetyMeetingForOperator(req, result.meeting),
      attendee: recordForOperator(req, result.attendee),
      replayed: result.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/safety-meetings/:meetingId/signoff', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.signOffSafetyMeeting(req.params.id, req.params.meetingId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      safetyMeeting: result.meeting,
      approval: result.approval,
      replayed: result.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  }, 202);
});

app.post('/api/ledger/jobs/:id/safety-meetings/:meetingId/attendees/:attendeeId/excuse', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.excuseSafetyMeetingAttendee(
      req.params.id,
      req.params.meetingId,
      req.params.attendeeId,
      req.body || {},
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      safetyMeeting: result.meeting,
      attendee: result.attendee,
      replayed: result.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  });
});

app.post('/api/ledger/jobs/:id/orientations', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    orientation: operatingLedger.createWorkerOrientation(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/jhas', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    jha: operatingLedger.createJhaRecord(req.params.id, req.body || {}, { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.post('/api/ledger/jobs/:id/sds-sheets', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    sdsSheet: operatingLedger.createSdsSheet(req.params.id, req.body || {}, { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.get('/api/ledger/sds-sheets', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    sdsSheets: operatingLedger.listSdsSheets(req.query || {})
      .filter(sheet => fieldWorkerCanAccessJob(req, sheet.jobId))
      .filter(sheet => req.operator?.role !== 'field_worker' || sheet.current === true)
      .map(sheet => recordForOperator(req, sheet))
  }));
});

app.get('/api/ledger/jobs/:id/sds-sheets', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    sdsSheets: operatingLedger.listSdsSheets({ ...(req.query || {}), jobId: req.params.id })
      .filter(sheet => req.operator?.role !== 'field_worker' || sheet.current === true)
      .map(sheet => recordForOperator(req, sheet))
  }));
});

app.post('/api/ledger/jobs/:id/sds-revisions', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const revision = operatingLedger.createSdsRevision(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      sdsSheet: revision,
      approval: revision.approval,
      replayed: revision.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.get('/api/ledger/drawings', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    drawings: operatingLedger.listDrawingRevisions(req.query || {})
      .filter(drawing => fieldWorkerCanAccessJob(req, drawing.jobId))
      .filter(drawing => req.operator?.role !== 'field_worker' || drawing.current === true)
      .map(drawing => recordForOperator(req, drawing))
  }));
});

app.get('/api/ledger/jobs/:id/drawings', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    drawings: operatingLedger.listDrawingRevisions({ ...(req.query || {}), jobId: req.params.id })
      .filter(drawing => req.operator?.role !== 'field_worker' || drawing.current === true)
      .map(drawing => recordForOperator(req, drawing))
  }));
});

app.post('/api/ledger/jobs/:id/drawing-revisions', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const revision = operatingLedger.createDrawingRevision(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      drawing: revision,
      approval: revision.approval,
      replayed: revision.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/site-access', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = {
      success: true,
      siteAccessLog: operatingLedger.createSiteAccessLog(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' })
    };
    if (!compactLedgerResponseRequested(req)) {
      result.job = operatingLedger.getJobDetail(req.params.id);
      result.dashboard = operatingLedger.dashboardSummary();
    }
    return result;
  }, 201);
});

app.get('/api/ledger/attendance', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const filters = { ...(req.query || {}) };
    if (req.operator?.role === 'field_worker' && req.operator.scope?.workerId) {
      filters.workerId = req.operator.scope.workerId;
    }
    const board = operatingLedger.listAttendanceBoard(filters);
    if (req.operator?.role === 'field_worker') {
      board.rows = board.rows.filter(row => fieldWorkerCanAccessJob(req, row.jobId)).map(projectFieldRecord);
      board.summary = {
        sessions: board.rows.length,
        checkedIn: board.rows.filter(row => row.status === 'checked_in').length,
        checkedOut: board.rows.filter(row => row.status === 'checked_out').length,
        stale: board.rows.filter(row => row.stale).length,
        adjusted: board.rows.filter(row => row.adjustment).length,
        retainedHours: board.rows.reduce((sum, row) => sum + (row.status === 'checked_out' ? Number(row.durationHours || 0) : 0), 0)
      };
    }
    return { success: true, attendance: board };
  });
});

app.get('/api/ledger/jobs/:id/attendance', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const filters = { ...(req.query || {}), jobId: req.params.id };
    if (req.operator?.role === 'field_worker' && req.operator.scope?.workerId) filters.workerId = req.operator.scope.workerId;
    return { success: true, attendance: recordForOperator(req, operatingLedger.listAttendanceBoard(filters)) };
  });
});

app.post('/api/ledger/jobs/:id/attendance/check-in', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const payload = attendancePayloadForOperator(req, req.body || {});
    const result = operatingLedger.recordAttendanceCheckIn(req.params.id, payload, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      session: recordForOperator(req, result.session),
      attendance: recordForOperator(req, result.board),
      replayed: result.replayed,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/attendance/:sessionId/check-out', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const payload = attendancePayloadForOperator(req, req.body || {});
    const result = operatingLedger.recordAttendanceCheckOut(req.params.id, req.params.sessionId, payload, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      session: recordForOperator(req, result.session),
      attendance: recordForOperator(req, result.board),
      replayed: result.replayed,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/attendance/:sessionId/adjustments', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestAttendanceAdjustment(req.params.id, req.params.sessionId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    attendance: operatingLedger.listAttendanceBoard({ jobId: req.params.id }),
    job: operatingLedger.getJobDetail(req.params.id, { includeAudit: true }),
    dashboard: operatingLedger.dashboardSummary(),
    externalCommitments: 0
  }), 201);
});

app.get('/api/ledger/timesheets', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    timesheets: operatingLedger.listTimesheetBoard({
      periodStart: req.query.periodStart || req.query.period_start,
      workerId: req.query.workerId || req.query.worker_id
    })
  }));
});

app.get('/api/ledger/timesheets/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    timesheet: operatingLedger.getWeeklyTimesheet(req.params.id)
  }));
});

app.post('/api/ledger/workers/:id/timesheets', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestWeeklyTimesheet(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    timesheets: operatingLedger.listTimesheetBoard({ periodStart: req.body?.periodStart || req.body?.period_start })
  }), 201);
});

app.post('/api/ledger/timesheet-exports', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.prepareTimesheetExport(req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    timesheets: operatingLedger.listTimesheetBoard({ periodStart: req.body?.periodStart || req.body?.period_start })
  }), 201);
});

app.get('/api/ledger/timesheet-exports/:id/content', (req, res) => {
  try {
    const result = operatingLedger.getTimesheetExportContent(req.params.id);
    operatingLedger.audit({
      entityType: 'timesheet_export',
      entityId: result.export.id,
      action: 'download_timesheet_export',
      actor: actorFromRequest(req, 'authenticated_operator'),
      after: { csvChecksum: result.export.csvChecksum, periodStart: result.export.periodStart, payrollExecuted: false }
    });
    const filename = `contractor-ai-timesheets-${result.export.periodStart}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Length', String(Buffer.byteLength(result.content, 'utf8')));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Contractor-AI-SHA256', result.export.csvChecksum);
    return res.end(result.content);
  } catch (error) {
    return sendError(req, res, error.statusCode || 500, error.code || 'timesheet_export_download_failed', error.statusCode ? error.message : 'Unable to retrieve the retained timesheet handoff package.', serializeError(error));
  }
});

app.post('/api/ledger/jobs/:id/assignments', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    assignment: operatingLedger.addAssignment(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard', optional: false }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/assignments/:assignmentId/release', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    assignment: operatingLedger.releaseAssignment(req.params.id, req.params.assignmentId, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.get('/api/ledger/jobs/:id/qualification-requirements', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    requirements: operatingLedger.listQualificationRequirements({
      jobId: req.params.id,
      includeRetired: req.query.includeRetired || req.query.include_retired,
      limit: req.query.limit
    })
  }));
});

app.post('/api/ledger/jobs/:id/qualification-requirements', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.createQualificationRequirement(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: operatingLedger.getJobDetail(req.params.id),
    qualificationRegister: operatingLedger.listQualificationRegister(),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/qualification-requirements/:requirementId/retirement', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestQualificationRequirementRetirement(
      req.params.id,
      req.params.requirementId,
      req.body || {},
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    ),
    job: operatingLedger.getJobDetail(req.params.id),
    qualificationRegister: operatingLedger.listQualificationRegister(),
    dashboard: operatingLedger.dashboardSummary()
  }), 202);
});

app.post('/api/ledger/jobs/:id/tools', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    toolReservation: operatingLedger.reserveTool(req.params.id, req.body || {}, { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/tools/:reservationId/release', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    toolReservation: operatingLedger.releaseToolReservation(req.params.id, req.params.reservationId, req.body || {}, { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.get('/api/ledger/jobs/:id/equipment-custody-plan', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    plans: operatingLedger.equipmentCustodyPlanForJob(req.params.id).map(plan => ({
      reservation: recordForOperator(req, plan.reservation),
      tool: recordForOperator(req, plan.tool),
      activeCustody: recordForOperator(req, plan.activeCustody),
      checkoutReady: plan.checkoutReady
    }))
  }));
});

app.get('/api/ledger/jobs/:id/equipment-custody', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const custody = operatingLedger.listEquipmentCustodySessions({
      jobId: req.params.id,
      workerId: req.operator?.role === 'field_worker' ? req.operator.scope?.workerId : req.query.workerId,
      status: req.query.status,
      limit: req.query.limit
    });
    return {
      success: true,
      custody: req.operator?.role === 'field_worker' ? projectFieldRecords(custody) : custody
    };
  });
});

app.post('/api/ledger/jobs/:id/equipment-custody/check-out', (req, res) => {
  const payload = { ...(req.body || {}) };
  if (req.operator?.role === 'field_worker') {
    const identity = fieldWorkerIdentity(req);
    payload.workerId = identity.workerId;
    payload.checkedOutBy = identity.workerName;
  }
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.checkoutEquipment(req.params.id, payload, {
      actor: actorFromRequest(req, payload.actor || 'dashboard')
    });
    return {
      success: true,
      custody: recordForOperator(req, result.custody),
      replayed: result.replayed,
      job: jobForOperator(req, req.params.id),
      equipmentCustody: req.operator?.role === 'field_worker' ? null : operatingLedger.listEquipmentCustodyRegister(),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/equipment-custody/:custodySessionId/return', (req, res) => {
  const payload = { ...(req.body || {}) };
  if (req.operator?.role === 'field_worker') payload.returnedBy = fieldWorkerIdentity(req).workerName;
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.returnEquipment(req.params.id, req.params.custodySessionId, payload, {
      actor: actorFromRequest(req, payload.actor || 'dashboard')
    });
    return {
      success: true,
      custody: recordForOperator(req, result.custody),
      replayed: result.replayed,
      job: jobForOperator(req, req.params.id),
      equipmentCustody: req.operator?.role === 'field_worker' ? null : operatingLedger.listEquipmentCustodyRegister(),
      dashboard: dashboardForOperator(req)
    };
  });
});

app.post('/api/ledger/jobs/:id/materials', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    materialRequirement: operatingLedger.addMaterialRequirement(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.patch('/api/ledger/jobs/:id/materials/:materialId/status', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    materialRequirement: operatingLedger.updateMaterialRequirementStatus(
      req.params.id,
      req.params.materialId,
      req.body || {},
      { actor: req.body?.actor || 'dashboard' }
    ),
    deliveryMode: 'record_only',
    externalCommitments: 0,
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.get('/api/ledger/material-receipts', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    materialReceiving: operatingLedger.listMaterialReceivingRegister(req.query || {})
  }));
});

app.get('/api/ledger/jobs/:id/material-receipts', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const receipts = operatingLedger.listMaterialReceipts({
      jobId: req.params.id,
      includeReversed: req.query.includeReversed || req.query.include_reversed,
      limit: req.query.limit
    });
    return {
      success: true,
      receipts: req.operator?.role === 'field_worker' ? projectFieldRecords(receipts) : receipts
    };
  });
});

app.get('/api/ledger/jobs/:id/material-receiving-plan', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    plans: operatingLedger.listMaterialReceivingPlansForJob(req.params.id).map(plan => ({
      purchaseOrder: {
        id: plan.purchaseOrder.id,
        jobId: plan.purchaseOrder.jobId,
        status: plan.purchaseOrder.status,
        issueReference: plan.purchaseOrder.issueReference || plan.purchaseOrder.orderNumber || null,
        requiredBy: plan.purchaseOrder.requiredBy || null
      },
      lines: plan.lines.map(line => ({
        lineKey: line.lineKey,
        materialRequirementId: line.materialRequirementId,
        itemName: line.itemName,
        unit: line.unit,
        orderedQuantity: line.orderedQuantity,
        receivedQuantity: line.receivedQuantity,
        remainingQuantity: line.remainingQuantity,
        complete: line.complete
      })),
      summary: plan.summary
    }))
  }));
});

app.post('/api/ledger/jobs/:id/material-receipts', (req, res) => {
  const payload = { ...(req.body || {}) };
  if (req.operator?.role === 'field_worker') {
    const identity = fieldWorkerIdentity(req);
    payload.receivedBy = identity.workerName;
  }
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.createMaterialReceipt(req.params.id, payload, {
      actor: actorFromRequest(req, payload.actor || 'dashboard')
    });
    const response = {
      success: true,
      receipt: recordForOperator(req, result.receipt),
      replayed: result.replayed
    };
    if (!compactLedgerResponseRequested(req)) {
      response.job = jobForOperator(req, req.params.id);
      response.materialReceiving = req.operator?.role === 'field_worker' ? null : operatingLedger.listMaterialReceivingRegister();
      response.dashboard = dashboardForOperator(req);
    }
    return response;
  }, 201);
});

app.post('/api/ledger/jobs/:id/material-receipts/:receiptId/reversal', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestMaterialReceiptReversal(req.params.id, req.params.receiptId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: operatingLedger.getJobDetail(req.params.id),
    materialReceiving: operatingLedger.listMaterialReceivingRegister(),
    dashboard: operatingLedger.dashboardSummary()
  }), 202);
});

app.post('/api/ledger/jobs/:id/route-plans', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    routePlan: operatingLedger.createRoutePlan(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/loading-plans', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    loadingPlan: operatingLedger.createLoadingPlan(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/procurement-orders', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    procurementOrder: operatingLedger.createProcurementOrder(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/procurement-orders/:orderId/request-approval', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestProcurementApproval(req.params.id, req.params.orderId, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/ledger/jobs/:id/worker-instructions', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    workerInstruction: operatingLedger.createWorkerInstruction(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/dispatch', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    dispatch: operatingLedger.createDispatchPack(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id, { includeAudit: true }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.get('/api/ledger/dispatch', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.listDispatchReadiness(req.query || {}),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.get('/api/ledger/workforce', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.listWorkforceReadiness(req.query || {}),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.get('/api/ledger/inventory', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.listInventoryReadiness(req.query || {}),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.get('/api/ledger/field-assurance', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.listFieldAssurance(req.query || {}),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/ledger/jobs/:id/field-assurance-pack', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    pack: operatingLedger.prepareFieldAssurancePack(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.get('/api/ledger/finance', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.listFinanceReadiness(req.query || {}),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.get('/api/ledger/cash-flow', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    cashFlow: operatingLedger.calculateCashFlowForecast(req.query || {})
  }));
});

app.post('/api/ledger/cash-flow/items', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.createCashFlowItem(req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    cashFlow: operatingLedger.calculateCashFlowForecast()
  }), 201);
});

app.post('/api/ledger/cash-flow/items/:itemId/archive', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.archiveCashFlowItem(req.params.itemId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    cashFlow: operatingLedger.calculateCashFlowForecast()
  }));
});

app.post('/api/ledger/cash-flow/snapshots', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestCashFlowForecastSnapshot(req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    })
  }), 201);
});

app.get('/api/ledger/performance-scorecard', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    scorecard: operatingLedger.calculatePerformanceScorecard(req.query || {})
  }));
});

app.post('/api/ledger/performance-scorecard/targets', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestPerformanceScorecardTarget(req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    scorecard: operatingLedger.calculatePerformanceScorecard(req.body || {})
  }), 201);
});

app.post('/api/ledger/performance-scorecard/snapshots', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestPerformanceScorecardSnapshot(req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    })
  }), 201);
});

app.get('/api/ledger/client-success', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.listClientSuccess(req.query || {}),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/ledger/jobs/:id/progress', (req, res) => {
  const requestedStatus = String(req.body?.status || '').trim().toLowerCase();
  if (req.operator?.role === 'field_worker' && ['completed', 'closed', 'cancelled', 'archived'].includes(requestedStatus)) {
    return sendError(req, res, 403, 'field_completion_approval_required', 'Field workers can record progress and blockers, but job completion requires an office approval workflow.');
  }
  return handleLedgerRequest(req, res, () => ({
    success: true,
    progress: recordForOperator(req, operatingLedger.addProgressUpdate(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' })),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.get('/api/ledger/jobs/:id/production', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    production: recordForOperator(req, operatingLedger.calculateProductionPerformance(req.params.id))
  }));
});

app.post('/api/ledger/jobs/:id/production-baselines', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestProductionBaseline(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: jobForOperator(req, req.params.id, { includeAudit: true }),
    field: operatingLedger.listFieldAssurance({ limit: 100 }),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.post('/api/ledger/jobs/:id/production-entries', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const payload = timeLogPayloadForOperator(req, req.body || {});
    const result = operatingLedger.recordProductionEntry(req.params.id, payload, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      entry: recordForOperator(req, result.entry),
      production: recordForOperator(req, result.production),
      replayed: result.replayed,
      job: jobForOperator(req, req.params.id, { includeAudit: true }),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/production-entries/:entryId/reversal', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestProductionEntryReversal(req.params.id, req.params.entryId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: jobForOperator(req, req.params.id, { includeAudit: true }),
    field: operatingLedger.listFieldAssurance({ limit: 100 }),
    dashboard: dashboardForOperator(req),
    externalCommitments: 0
  }), 201);
});

app.post('/api/ledger/jobs/:id/communication', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const payload = req.body || {};
    const direction = String(payload.direction || 'outbound').trim().toLowerCase();
    const outbound = direction !== 'inbound';
    const communication = operatingLedger.addCommunication(req.params.id, outbound
      ? { ...payload, direction: 'outbound', status: 'draft', sentAt: null, sent_at: null, requiresApproval: true }
      : { ...payload, direction: 'inbound', status: 'received', requiresApproval: false }, { actor: payload.actor || 'dashboard' });
    return {
      success: true,
      communication,
      job: operatingLedger.getJobDetail(req.params.id),
      deliveryMode: outbound ? 'draft_only' : 'record_only',
      notSent: outbound,
      approvalRequired: outbound,
      approval: communication.approval || null,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.get('/api/ledger/communications', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    communications: operatingLedger.listCommunications(req.query || {}),
    summary: operatingLedger.communicationSummary(),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.get('/api/ledger/jobs/:id/client-portal-access', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    access: operatingLedger.listClientPortalAccess(req.params.id)
  }));
});

app.post('/api/ledger/jobs/:id/client-portal-access', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    access: operatingLedger.createClientPortalAccess(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/client-portal-access/:id/revoke', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    access: operatingLedger.revokeClientPortalAccess(req.params.id, { actor: req.body?.actor || 'dashboard' })
  }));
});

app.get('/api/ledger/client-feedback', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    feedback: operatingLedger.listClientFeedback(req.query || {}),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/ledger/jobs/:id/client-feedback', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.createClientFeedback(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req),
    externalCommitments: 0
  }), 201);
});

app.get('/api/client-portal/:token', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.getClientPortalSnapshot(req.params.token)
  }));
});

app.post('/api/client-portal/:token/messages', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.addClientPortalMessage(req.params.token, req.body || {});
    return {
      success: true,
      deliveryMode: 'record_only',
      notSent: false,
      approvalRequired: false,
      ...result
    };
  }, 201);
});

app.post('/api/client-portal/:token/selections/:selectionId/responses', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.submitClientPortalSelectionResponse(
      req.params.token,
      req.params.selectionId,
      req.body || {},
      { actor: 'client_portal' }
    );
    return {
      success: true,
      approvalRequired: true,
      externalCommitments: 0,
      ...result
    };
  }, 201);
});

app.post('/api/client-portal/:token/feedback', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.submitClientPortalFeedback(req.params.token, req.body || {}, { actor: 'client_portal' }),
    reviewRequested: false,
    referralRequested: false,
    externalCommitments: 0
  }), 201);
});

app.get('/api/client-portal/:token/change-orders/:changeOrderId/package', (req, res) => {
  try {
    const issuePackage = operatingLedger.getClientPortalChangeOrderIssuePackage(
      req.params.token,
      req.params.changeOrderId,
      { actor: 'client_portal' }
    );
    res.setHeader('Content-Type', issuePackage.mimeType || 'text/html; charset=utf-8');
    res.setHeader('Content-Length', String(Buffer.byteLength(issuePackage.content, 'utf8')));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(issuePackage.filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end(issuePackage.content);
  } catch (error) {
    return sendError(
      req,
      res,
      error.statusCode || 500,
      error.code || 'client_variation_package_download_failed',
      error.statusCode ? error.message : 'Unable to retrieve the issued variation package.',
      serializeError(error)
    );
  }
});

app.post('/api/client-portal/:token/change-orders/:changeOrderId/responses', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.submitClientPortalChangeOrderResponse(
      req.params.token,
      req.params.changeOrderId,
      req.body || {},
      { actor: 'client_portal' }
    );
    return {
      success: true,
      approvalRequired: true,
      externalCommitments: 0,
      ...result
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/documents', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    document: recordForOperator(req, operatingLedger.addDocument(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' })),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.post('/api/ledger/jobs/:id/controlled-document-revisions', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.createControlledDocumentRevision(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.post('/api/ledger/jobs/:id/document-transmittals', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.createDocumentTransmittal(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'dashboard')
    }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.post('/api/ledger/jobs/:id/document-transmittals/:transmittalId/issue', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    transmittal: operatingLedger.recordDocumentTransmittalIssue(
      req.params.id,
      req.params.transmittalId,
      req.body || {},
      { actor: actorFromRequest(req, 'dashboard') }
    ),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req),
    externalDeliveryInitiated: false,
    externalDeliveryPerformedByContractorAI: false
  }));
});

app.post('/api/ledger/jobs/:id/document-transmittals/:transmittalId/receipts/:receiptId/acknowledge', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.acknowledgeDocumentTransmittal(
      req.params.id,
      req.params.transmittalId,
      req.params.receiptId,
      req.body || {},
      { actor: actorFromRequest(req, 'dashboard') }
    ),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }));
});

app.post('/api/ledger/jobs/:id/project-meetings', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    meeting: operatingLedger.createProjectMeeting(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'dashboard')
    }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req),
    externalCommitments: 0
  }), 201);
});

app.post('/api/ledger/jobs/:id/project-meetings/:meetingId/submit', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.submitProjectMeetingMinutes(req.params.id, req.params.meetingId, req.body || {}, {
      actor: actorFromRequest(req, 'dashboard')
    }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req),
    externalDeliveryInitiated: false
  }));
});

app.post('/api/ledger/jobs/:id/project-meetings/:meetingId/issue', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    meeting: operatingLedger.recordProjectMeetingIssue(
      req.params.id,
      req.params.meetingId,
      req.body || {},
      { actor: actorFromRequest(req, 'dashboard') }
    ),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req),
    externalDeliveryInitiated: false,
    externalDeliveryPerformedByContractorAI: false
  }));
});

app.post('/api/ledger/jobs/:id/project-meetings/:meetingId/actions/:actionId/complete', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.completeProjectMeetingAction(
      req.params.id,
      req.params.meetingId,
      req.params.actionId,
      req.body || {},
      { actor: actorFromRequest(req, 'dashboard') }
    ),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }));
});

app.post('/api/ledger/jobs/:id/project-meetings/:meetingId/follow-up', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.createProjectMeetingFollowUp(
      req.params.id,
      req.params.meetingId,
      req.body || {},
      { actor: actorFromRequest(req, 'dashboard') }
    ),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req),
    externalCommitments: 0
  }), 201);
});

app.post('/api/ledger/jobs/:id/time-logs', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const payload = timeLogPayloadForOperator(req, req.body || {});
    return {
      success: true,
      timeLog: recordForOperator(req, operatingLedger.addTimeLog(req.params.id, payload, { actor: req.body?.actor || 'dashboard' })),
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.get('/api/ledger/jobs/:id/daily-cycles', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const cycles = operatingLedger.listDailyOperatingCycles({
      jobId: req.params.id,
      workDate: req.query.workDate,
      status: req.query.status,
      limit: req.query.limit
    });
    return {
      success: true,
      cycles: req.operator?.role === 'field_worker' ? cycles.map(projectFieldRecord) : cycles,
      safeguards: {
        internalDailyControlOnly: true,
        approvalRequiredForClose: true,
        externalCommitments: 0
      }
    };
  });
});

app.post('/api/ledger/jobs/:id/daily-cycles', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    let payload = req.body || {};
    if (req.operator?.role === 'field_worker') {
      const identity = fieldWorkerIdentity(req);
      if (!identity.workerId) {
        const error = new Error('A field start huddle requires an operator token linked to one worker identity.');
        error.statusCode = 403;
        error.code = 'field_worker_identity_required';
        throw error;
      }
      payload = {
        ...payload,
        facilitator: identity.workerName,
        leadWorkerId: identity.workerId,
        workerIds: [identity.workerId]
      };
    }
    const result = operatingLedger.createDailyStartHuddle(req.params.id, payload, {
      actor: actorFromRequest(req, 'field_dashboard')
    });
    return {
      success: true,
      ...result,
      cycle: req.operator?.role === 'field_worker' ? projectFieldRecord(result.cycle) : result.cycle,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/daily-cycles/:cycleId/end-of-day', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const payload = timeLogPayloadForOperator(req, req.body || {});
    const result = operatingLedger.closeDailyOperatingCycle(req.params.id, req.params.cycleId, payload, {
      actor: actorFromRequest(req, 'field_dashboard')
    });
    return {
      success: true,
      ...result,
      cycle: req.operator?.role === 'field_worker' ? projectFieldRecord(result.cycle) : result.cycle,
      dailyLog: req.operator?.role === 'field_worker'
        ? {
            ...result.dailyLog,
            fieldReport: projectFieldRecord(result.dailyLog.fieldReport),
            timeLog: projectFieldRecord(result.dailyLog.timeLog),
            safetyCheck: projectFieldRecord(result.dailyLog.safetyCheck),
            approvals: result.dailyLog.approvals.length
          }
        : result.dailyLog,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/daily-logs', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const payload = timeLogPayloadForOperator(req, req.body || {});
    const dailyLog = operatingLedger.recordFieldDailyLog(req.params.id, payload, { actor: req.body?.actor || 'dashboard' });
    return {
      success: true,
      dailyLog: req.operator?.role === 'field_worker'
        ? {
            ...dailyLog,
            fieldReport: projectFieldRecord(dailyLog.fieldReport),
            timeLog: projectFieldRecord(dailyLog.timeLog),
            safetyCheck: projectFieldRecord(dailyLog.safetyCheck),
            approvals: dailyLog.approvals.length
          }
        : dailyLog,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.get('/api/ledger/jobs/:id/expense-receipts', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const filters = {
      jobId: req.params.id,
      workerId: req.operator?.role === 'field_worker' ? fieldWorkerIdentity(req).workerId : req.query.workerId,
      status: req.query.status,
      limit: req.query.limit
    };
    const expenses = operatingLedger.listExpenseReceipts(filters);
    return {
      success: true,
      expenses: req.operator?.role === 'field_worker' ? expenses.map(projectFieldExpenseReceipt) : expenses,
      policy: {
        approvalRequired: true,
        exactReplay: true,
        duplicateReceiptProtection: true,
        compensatingReversal: true,
        fundsMoved: false,
        externalCommitments: 0
      }
    };
  });
});

app.post('/api/ledger/jobs/:id/expense-receipts', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const payload = expenseReceiptPayloadForOperator(req, req.body || {});
    const result = operatingLedger.createExpenseReceipt(req.params.id, payload, {
      actor: actorFromRequest(req, 'dashboard')
    });
    return {
      success: true,
      expense: req.operator?.role === 'field_worker' ? projectFieldExpenseReceipt(result.expense) : result.expense,
      approval: req.operator?.role === 'field_worker' ? null : result.approval,
      replayed: result.replayed,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      externalCommitments: 0,
      fundsMoved: false
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/expense-receipts/:expenseId/reversal', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestExpenseReversal(req.params.id, req.params.expenseId, req.body || {}, {
      actor: actorFromRequest(req, 'dashboard')
    }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req),
    externalCommitments: 0,
    fundsMoved: false
  }), 201);
});

app.get('/api/ledger/jobs/:id/environmental-activities', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const fieldScoped = req.operator?.role === 'field_worker';
    const activities = operatingLedger.listEnvironmentalActivities({
      jobId: req.params.id,
      workerId: fieldScoped ? fieldWorkerIdentity(req).workerId : req.query.workerId,
      status: req.query.status,
      periodStart: req.query.periodStart || req.query.period_start,
      periodEnd: req.query.periodEnd || req.query.period_end,
      limit: req.query.limit
    });
    const projectedActivities = fieldScoped ? activities.map(projectFieldEnvironmentalActivity) : activities;
    const register = fieldScoped
      ? {
          summary: {
            totalRecords: projectedActivities.length,
            recognizedRecords: projectedActivities.filter(activity => activity.status === 'approved').length,
            pendingRecords: projectedActivities.filter(activity => activity.status === 'pending_approval').length,
            pendingReversals: projectedActivities.filter(activity => activity.status === 'pending_reversal').length,
            totalKgCo2e: projectedActivities
              .filter(activity => ['approved', 'pending_reversal'].includes(activity.status))
              .reduce((sum, activity) => sum + Number(activity.emissionsKgCo2e || 0), 0)
          },
          readyForReport: false,
          blockers: [],
          policy: { certificationClaimed: false, externalSubmission: false, reportUnit: 'kg_co2e' }
        }
      : operatingLedger.calculateEnvironmentalRegister(req.params.id, req.query || {});
    return {
      success: true,
      activities: projectedActivities,
      register: {
        periodStart: register.periodStart || null,
        periodEnd: register.periodEnd || null,
        sourceHash: fieldScoped ? null : register.sourceHash,
        summary: register.summary,
        readyForReport: register.readyForReport,
        blockers: register.blockers,
        policy: register.policy
      },
      reports: fieldScoped ? [] : operatingLedger.listEnvironmentalReports({ jobId: req.params.id, limit: 20 }),
      policy: {
        approvalRequired: true,
        exactReplay: true,
        sourcedFactors: true,
        compensatingReversal: true,
        externalSubmission: false,
        certificationClaimed: false,
        externalCommitments: 0
      }
    };
  });
});

app.post('/api/ledger/jobs/:id/environmental-activities', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const payload = environmentalActivityPayloadForOperator(req, req.body || {});
    const result = operatingLedger.createEnvironmentalActivity(req.params.id, payload, {
      actor: actorFromRequest(req, 'dashboard')
    });
    return {
      success: true,
      activity: req.operator?.role === 'field_worker' ? projectFieldEnvironmentalActivity(result.activity) : result.activity,
      approval: req.operator?.role === 'field_worker' ? null : result.approval,
      replayed: result.replayed,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      externalCommitments: 0,
      certificationClaimed: false
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/environmental-activities/:activityId/reversal', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestEnvironmentalActivityReversal(req.params.id, req.params.activityId, req.body || {}, {
      actor: actorFromRequest(req, 'dashboard')
    }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req),
    externalCommitments: 0,
    certificationClaimed: false
  }), 201);
});

app.post('/api/ledger/jobs/:id/environmental-reports', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestEnvironmentalReport(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'dashboard')
    }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req),
    externalCommitments: 0,
    certificationClaimed: false
  }), 201);
});

app.get('/api/ledger/jobs/:id/environmental-reports', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    reports: operatingLedger.listEnvironmentalReports({ jobId: req.params.id, status: req.query.status, limit: req.query.limit })
  }));
});

app.get('/api/ledger/environmental-reports/:reportId/content', (req, res) => {
  try {
    const result = operatingLedger.getEnvironmentalReportContent(req.params.reportId);
    operatingLedger.audit({
      entityType: 'environmental_report',
      entityId: result.report.id,
      jobId: result.report.jobId,
      action: 'download_environmental_report',
      actor: actorFromRequest(req, 'authenticated_operator'),
      after: {
        periodStart: result.report.periodStart,
        periodEnd: result.report.periodEnd,
        csvChecksum: result.report.csvChecksum,
        externalSubmission: false,
        certificationClaimed: false
      }
    });
    const filename = `contractor-ai-environmental-${result.report.periodStart}-${result.report.periodEnd}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Length', String(Buffer.byteLength(result.content, 'utf8')));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Contractor-AI-SHA256', result.report.csvChecksum);
    return res.end(result.content);
  } catch (error) {
    return sendError(req, res, error.statusCode || 500, error.code || 'environmental_report_download_failed', error.statusCode ? error.message : 'Unable to retrieve the retained environmental report.', serializeError(error));
  }
});

app.get('/api/ledger/jobs/:id/energy-performance', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    energyPerformance: operatingLedger.energyPerformanceForJob(req.params.id)
  }));
});

app.post('/api/ledger/jobs/:id/energy-performance', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.createEnergyPerformanceRecord(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, 'dashboard')
    });
    return {
      success: true,
      ...result,
      energyPerformance: operatingLedger.energyPerformanceForJob(req.params.id),
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req),
      calculationEngine: false,
      certificationClaimed: false,
      externalRegistration: false,
      externalCommitments: 0
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/expenses', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    expense: operatingLedger.addExpense(req.params.id, req.body || {}, { actor: actorFromRequest(req, 'dashboard') }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/finance-costs', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    costs: operatingLedger.recordJobCosts(req.params.id, req.body || {}, { actor: actorFromRequest(req, 'dashboard') }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/invoices', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    invoice: operatingLedger.createInvoice(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/invoices/:invoiceId/issue-package', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const issuePackage = operatingLedger.prepareInvoiceIssuePackage(
      req.params.id,
      req.params.invoiceId,
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      ...issuePackage,
      job: operatingLedger.getJobDetail(req.params.id),
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/invoices/:invoiceId/credit-notes', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    creditNote: operatingLedger.createCreditNote(
      req.params.id,
      req.params.invoiceId,
      req.body || {},
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    ),
    job: operatingLedger.getJobDetail(req.params.id),
    finance: operatingLedger.listFinanceReadiness({ limit: 100 }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/credit-notes/:creditNoteId/issue-package', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const issuePackage = operatingLedger.prepareCreditNoteIssuePackage(
      req.params.id,
      req.params.creditNoteId,
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      ...issuePackage,
      job: operatingLedger.getJobDetail(req.params.id),
      finance: operatingLedger.listFinanceReadiness({ limit: 100 }),
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/quality-checks', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    qualityCheck: operatingLedger.addQualityCheck(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/safety-checks', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    safetyCheck: recordForOperator(req, operatingLedger.addSafetyCheck(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' })),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.post('/api/ledger/jobs/:id/payments', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    payment: operatingLedger.recordPayment(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/invoices/:invoiceId/payments', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    payment: operatingLedger.recordPayment(req.params.id, {
      ...(req.body || {}),
      invoiceId: req.params.invoiceId
    }, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    finance: operatingLedger.listFinanceReadiness({ mode: 'payment', limit: 100 }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/payments/follow-up', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    payment: operatingLedger.recordPaymentFollowUp(req.params.id, null, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/payments/:paymentId/follow-up', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    payment: operatingLedger.recordPaymentFollowUp(req.params.id, req.params.paymentId, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/budget-lines', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    budgetLine: operatingLedger.createBudgetLine(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.get('/api/ledger/jobs/:id/cost-forecast', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    forecast: operatingLedger.calculateCostForecast(req.params.id)
  }));
});

app.get('/api/ledger/jobs/:id/cost-forecast/snapshots', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    snapshots: operatingLedger.listCostForecastSnapshots(req.params.id)
  }));
});

app.post('/api/ledger/jobs/:id/cost-forecast/snapshots', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestCostForecastSnapshot(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: operatingLedger.getJobDetail(req.params.id),
    finance: operatingLedger.listFinanceReadiness({ limit: 100 }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/billing-milestones', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    billingMilestone: operatingLedger.createBillingMilestone(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: operatingLedger.getJobDetail(req.params.id),
    finance: operatingLedger.listFinanceReadiness({ limit: 100 }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/purchase-orders', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    purchaseOrder: operatingLedger.createPurchaseOrder(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/purchase-orders/:purchaseOrderId/issue-package', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const issuePackage = operatingLedger.preparePurchaseOrderIssuePackage(
      req.params.id,
      req.params.purchaseOrderId,
      req.body || {},
      { actor: actorFromRequest(req, 'finance') }
    );
    return {
      success: true,
      ...issuePackage,
      bidPackage: operatingLedger.getBidPackageByPurchaseOrder(req.params.purchaseOrderId),
      job: operatingLedger.getJobDetail(req.params.id),
      finance: operatingLedger.listFinanceReadiness({ limit: 100 }),
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/supplier-invoices', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    supplierInvoice: operatingLedger.createSupplierInvoice(
      req.params.id,
      req.body || {},
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    ),
    job: operatingLedger.getJobDetail(req.params.id),
    finance: operatingLedger.listFinanceReadiness({ limit: 100 }),
    dashboard: operatingLedger.dashboardSummary(),
    externalPaymentInitiated: false
  }), 201);
});

app.post('/api/ledger/jobs/:id/supplier-invoices/:supplierInvoiceId/payments', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    supplierPayment: operatingLedger.recordSupplierInvoicePayment(
      req.params.id,
      req.params.supplierInvoiceId,
      req.body || {},
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    ),
    job: operatingLedger.getJobDetail(req.params.id),
    finance: operatingLedger.listFinanceReadiness({ limit: 100 }),
    dashboard: operatingLedger.dashboardSummary(),
    externalPaymentInitiated: false
  }), 201);
});

app.post('/api/ledger/jobs/:id/draw-requests', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    drawRequest: operatingLedger.createDrawRequest(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/lien-waivers', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    lienWaiver: operatingLedger.createLienWaiver(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/finance-handoffs', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    financeHandoff: operatingLedger.createFinanceHandoff(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/finance-handoffs/prepare', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    financeHandoff: operatingLedger.prepareFinanceHandoff(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/punch-items', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const punchItem = operatingLedger.createPunchItem(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      punchItem: recordForOperator(req, punchItem),
      replayed: punchItem.replayed === true,
      job: jobForOperator(req, req.params.id),
      dashboard: dashboardForOperator(req)
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/warranty-claims', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    warrantyClaim: operatingLedger.createWarrantyClaim(req.params.id, req.body || {}, { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.post('/api/ledger/jobs/:id/aftercare', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    aftercare: operatingLedger.addAftercareItem(req.params.id, req.body || {}, { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }),
    job: jobForOperator(req, req.params.id),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.patch('/api/ledger/jobs/:id/lifecycle/:recordType/:recordId', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const payload = req.params.recordType === 'task' ? taskLifecyclePayloadForOperator(req) : (req.body || {});
    const result = operatingLedger.transitionLifecycleRecord(
      req.params.id,
      req.params.recordType,
      req.params.recordId,
      payload,
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    );
    return {
      success: true,
      record: recordForOperator(req, result.record),
      approval: req.operator?.role === 'field_worker' ? null : result.approval,
      approvalRequired: result.approvalRequired,
      job: jobForOperator(req, req.params.id, { includeAudit: true }),
      dashboard: dashboardForOperator(req)
    };
  });
});

app.post('/api/ledger/jobs/:id/recurring-plans', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    recurringPlan: operatingLedger.createRecurringPlan(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/closeout', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    closeout: operatingLedger.createCloseoutPackage(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id, { includeAudit: true }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.get('/api/ledger/jobs/:id/handover-readiness', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    readiness: operatingLedger.assessHandoverReadiness(req.params.id)
  }));
});

app.post('/api/ledger/jobs/:id/handover-packages', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    package: operatingLedger.prepareHandoverIssuePackage(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    job: jobForOperator(req, req.params.id, { includeAudit: true }),
    dashboard: dashboardForOperator(req)
  }), 201);
});

app.get('/api/ledger/approvals', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    approvals: operatingLedger.listApprovals(req.query || {})
  }));
});

app.post('/api/ledger/approvals/:id/resolve', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const actor = actorFromRequest(req, req.body?.actor || 'dashboard');
    const payload = req.operator?.authenticated
      ? { ...(req.body || {}), actor, resolvedBy: actor }
      : (req.body || {});
    const approval = operatingLedger.resolveApproval(req.params.id, payload, {
      actor,
      enforceSeparation: req.operator?.authenticated === true
    });
    let bidPackage = null;
    let bidDecision = null;
    if (approval.targetType === 'bid_package_selection') {
      bidPackage = operatingLedger.getBidPackage(approval.targetId);
    } else if (approval.targetType === 'purchase_order') {
      bidPackage = operatingLedger.getBidPackageByPurchaseOrder(approval.targetId);
    } else if (approval.targetType === 'communication') {
      const communication = operatingLedger.getCommunication(approval.targetId);
      if (communication.data?.source === 'purchase_order_issue_package') {
        bidPackage = operatingLedger.getBidPackageByPurchaseOrder(communication.data.sourceRecordId);
      }
    }
    if (approval.targetType === 'opportunity_bid_decision') {
      bidDecision = operatingLedger.bidDecisionForOpportunity(
        operatingLedger.getOpportunityBidDecision(approval.targetId).opportunityId
      );
    }
    const includeDashboard = String(
      req.query.includeDashboard ?? req.query.include_dashboard ?? 'true'
    ).toLowerCase() !== 'false';
    return {
      success: true,
      approval,
      job: approval.jobId ? operatingLedger.getJobDetail(approval.jobId) : null,
      bidPackage,
      bidDecision,
      dashboard: includeDashboard ? operatingLedger.dashboardSummary() : null
    };
  });
});

app.get('/api/ledger/audit', (req, res) => {
  if (req.operator?.role !== 'owner') {
    return sendError(req, res, 403, 'insufficient_role', 'Only an owner can inspect the global audit history.');
  }
  return handleLedgerRequest(req, res, () => {
    const history = operatingLedger.listAuditPage(req.query || {});
    return { success: true, ...history };
  });
});

app.get('/api/ledger/learning', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    profiles: operatingLedger.listLearningProfiles(req.query || {})
  }));
});

app.post('/api/ledger/learning/rebuild', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    profile: operatingLedger.rebuildLearningProfile(
      req.body?.jobType || req.body?.job_type || req.body?.service,
      { actor: req.body?.actor || 'dashboard' }
    ),
    profiles: operatingLedger.listLearningProfiles({ limit: 100 }),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/ledger/learning/recommend', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.recommendFromLearning(req.body || {})
  }));
});

app.post('/api/ledger/autonomous-cycle', (req, res) => {
  if (req.operator?.role !== 'owner') {
    return sendError(req, res, 403, 'insufficient_role', 'Only an owner can preview or request autonomous ledger work.');
  }
  return handleLedgerRequest(req, res, () => {
    const options = req.body || {};
    if (options.dryRun === true) return operatingLedger.runAutonomousCycle(options);
    return durableAutonomousCycleResponse(runDurableAutonomousCycle(options), options);
  });
});

app.get('/api/ledger/scheduler', (req, res) => {
  return res.json({ success: true, scheduler: autonomousSchedulerStatus() });
});

app.post('/api/ledger/scheduler/run', (req, res) => {
  if (req.operator?.role !== 'owner') {
    return sendError(req, res, 403, 'insufficient_role', 'Only an owner can request a durable autonomous scheduler run.');
  }
  const result = runDurableAutonomousCycle(req.body || {});
  return res.status(result.success ? 200 : 500).json(result);
});

app.get('/api/ledger/debug', (req, res) => {
  if (req.operator?.role !== 'owner') {
    return sendError(req, res, 403, 'insufficient_role', 'Only an owner can inspect ledger diagnostics.');
  }
  return handleLedgerRequest(req, res, () => ({
    success: true,
    diagnostics: operatingLedger.diagnose(),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.get('/api/ledger/workers', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const workers = operatingLedger.listWorkers(req.query || {});
    return {
      success: true,
      workers,
      summary: operatingLedger.summarizeWorkers(operatingLedger.listWorkers({ limit: 500 })),
      dashboard: operatingLedger.dashboardSummary()
    };
  });
});

app.get('/api/ledger/qualifications', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    qualificationRegister: operatingLedger.listQualificationRegister(req.query || {})
  }));
});

app.get('/api/integrations/hai/manifest', (req, res) => {
  if (req.operator?.role !== 'owner') {
    return sendError(req, res, 403, 'insufficient_role', 'Only an owner can inspect the HAI connector contract.');
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.json(connectorManifest());
});

app.get('/api/integrations/hai/feed', (req, res) => {
  if (req.operator?.role !== 'owner') {
    return sendError(req, res, 403, 'insufficient_role', 'Only an owner can export the read-only HAI action feed.');
  }
  const limit = boundedFeedLimit(req.query.limit);
  const actions = operatingLedger.nextActions({
    includeCrewCapacity: true,
    includeLastPlanner: true,
    includeFiveS: true
  });
  res.setHeader('Cache-Control', 'no-store');
  return res.json(buildHaiFeed(actions, { limit }));
});

app.get('/api/ledger/availability', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    availabilityRegister: operatingLedger.listWorkerAvailabilityRegister(req.query || {})
  }));
});

app.get('/api/ledger/workers/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    worker: operatingLedger.getWorker(req.params.id)
  }));
});

app.post('/api/ledger/workers', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    worker: operatingLedger.upsertWorker(req.body || {}, { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.put('/api/ledger/workers/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    worker: operatingLedger.upsertWorker(
      { ...(req.body || {}), id: req.params.id },
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    ),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.get('/api/ledger/workers/:id/credentials', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    worker: operatingLedger.getWorker(req.params.id),
    credentials: operatingLedger.listWorkerCredentials({
      workerId: req.params.id,
      includeHistory: req.query.includeHistory || req.query.include_history,
      limit: req.query.limit
    }),
    catalog: operatingLedger.workforceQualificationCatalog()
  }));
});

app.post('/api/ledger/workers/:id/credentials', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestWorkerCredential(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    worker: operatingLedger.getWorker(req.params.id),
    qualificationRegister: operatingLedger.listQualificationRegister(),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.get('/api/ledger/workers/:id/availability', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    worker: operatingLedger.getWorker(req.params.id),
    periods: operatingLedger.listWorkerAvailability({
      workerId: req.params.id,
      includeCancelled: req.query.includeCancelled || req.query.include_cancelled,
      limit: req.query.limit
    }),
    catalog: operatingLedger.workforceAvailabilityCatalog()
  }));
});

app.post('/api/ledger/workers/:id/availability', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.createWorkerAvailabilityPeriod(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    worker: operatingLedger.getWorker(req.params.id),
    availabilityRegister: operatingLedger.listWorkerAvailabilityRegister(),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/workers/:id/availability/:periodId/cancellation', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestWorkerAvailabilityCancellation(req.params.id, req.params.periodId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    worker: operatingLedger.getWorker(req.params.id),
    availabilityRegister: operatingLedger.listWorkerAvailabilityRegister(),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

function requestWorkerRetirement(req, res) {
  return handleLedgerRequest(req, res, () => {
    const retirement = operatingLedger.requestWorkerRetirement(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    if (!retirement) {
      const error = new Error('Worker not found');
      error.statusCode = 404;
      error.code = 'worker_not_found';
      throw error;
    }
    return {
      success: true,
      deleted: false,
      retained: true,
      retired: retirement.retired,
      requiresApproval: retirement.requiresApproval,
      operationStatus: retirement.operationStatus,
      approval: retirement.approval,
      worker: retirement.worker,
      dashboard: operatingLedger.dashboardSummary()
    };
  });
}

app.post('/api/ledger/workers/:id/retirement', requestWorkerRetirement);

app.delete('/api/ledger/workers/:id', (req, res) => {
  return requestWorkerRetirement(req, res);
});

app.get('/api/ledger/tools', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const tools = operatingLedger.listTools(req.query || {});
    return {
      success: true,
      tools,
      summary: operatingLedger.summarizeTools(operatingLedger.listTools({ limit: 500 })),
      dashboard: operatingLedger.dashboardSummary()
    };
  });
});

app.get('/api/ledger/equipment-custody', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    equipmentCustody: operatingLedger.listEquipmentCustodyRegister(req.query || {})
  }));
});

app.post('/api/ledger/tools', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    tool: operatingLedger.upsertTool(req.body || {}, { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.put('/api/ledger/tools/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    tool: operatingLedger.upsertTool(
      { ...(req.body || {}), id: req.params.id },
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    ),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/ledger/tools/:id/inspections', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.recordToolInspection(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    if (!result) {
      const error = new Error('Tool not found');
      error.statusCode = 404;
      error.code = 'tool_not_found';
      throw error;
    }
    return {
      success: true,
      ...result,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/ledger/tools/:id/maintenance', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.recordToolMaintenance(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    if (!result) {
      const error = new Error('Tool not found');
      error.statusCode = 404;
      error.code = 'tool_not_found';
      throw error;
    }
    return {
      success: true,
      ...result,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

function requestToolRetirement(req, res) {
  return handleLedgerRequest(req, res, () => {
    const retirement = operatingLedger.requestToolRetirement(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    if (!retirement) {
      const error = new Error('Tool not found');
      error.statusCode = 404;
      error.code = 'tool_not_found';
      throw error;
    }
    return {
      success: true,
      deleted: false,
      retained: true,
      retired: retirement.retired,
      requiresApproval: retirement.requiresApproval,
      operationStatus: retirement.operationStatus,
      approval: retirement.approval,
      tool: retirement.tool,
      dashboard: operatingLedger.dashboardSummary()
    };
  });
}

app.post('/api/ledger/tools/:id/retirement', requestToolRetirement);

app.delete('/api/ledger/tools/:id', requestToolRetirement);

app.get('/api/ledger/clients', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const clients = operatingLedger.listClients(req.query || {});
    return {
      success: true,
      clients,
      summary: operatingLedger.summarizeClients(clients)
    };
  });
});

app.post('/api/ledger/clients', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    client: operatingLedger.createClient(req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    })
  }), 201);
});

app.put('/api/ledger/clients/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    client: operatingLedger.updateClient(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    })
  }));
});

app.get('/api/ledger/trade-partners', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const partners = operatingLedger.listTradePartners(req.query || {});
    return {
      success: true,
      partners,
      summary: operatingLedger.summarizeTradePartners(
        operatingLedger.listTradePartners({ includeRetired: true, limit: 500 })
      )
    };
  });
});

app.get('/api/ledger/trade-partners/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    partner: operatingLedger.getTradePartner(req.params.id)
  }));
});

app.post('/api/ledger/trade-partners', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    partner: operatingLedger.upsertTradePartner(req.body || {}, { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.put('/api/ledger/trade-partners/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    partner: operatingLedger.upsertTradePartner(
      { ...(req.body || {}), id: req.params.id },
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    ),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/ledger/trade-partners/:id/retirement', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestTradePartnerRetirement(
      req.params.id,
      req.body || {},
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    ),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

function retiredLedgerFacadeRoute(req, res) {
  const resource = req.baseUrl.split('/').filter(Boolean).at(-1) || 'resource';
  const targets = {
    clients: '/api/ledger/clients',
    approvals: '/api/ledger/approvals',
    audit: '/api/ledger/audit',
    communication: '/api/ledger/communications',
    weather: '/api/ledger/weather/assess',
    schedule: '/api/ledger/schedule/recommend'
  };
  return res.status(410).json({
    error: {
      code: 'ledger_facade_route_retired',
      message: `The /api/${resource} facade is retired. Use the ledger API.`
    },
    migration: { endpoint: targets[resource] || '/api/ledger/dashboard' }
  });
}

app.use('/api/clients', retiredLedgerFacadeRoute);
app.use('/api/approvals', retiredLedgerFacadeRoute);
app.use('/api/audit', retiredLedgerFacadeRoute);
app.use('/api/communication', retiredLedgerFacadeRoute);
app.post('/api/ledger/weather/assess', (req, res) => {
  return handleLedgerRequest(req, res, async () => {
    const jobId = req.body?.jobId || req.body?.job_id;
    const actor = req.body?.actor || 'dashboard';
    let job = operatingLedger.getJobDetail(jobId, { includeAudit: true });
    const input = req.body || {};
    const liveRequested = input.live === true || input.useLiveWeather === true || input.use_live_weather === true;
    const defaultForecastAt = input.forecastAt
      || input.forecast_at
      || job.scheduledStart
      || job.targetCompletion
      || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const liveForecast = liveRequested
      ? await weatherService.assess({
          ...input,
          location: input.location || job.address || job.city || job.region,
          address: input.address || job.address,
          city: input.city || job.city,
          region: input.region || job.region,
          forecastAt: defaultForecastAt
        })
      : null;
    const weatherPayload = liveForecast
      ? {
          ...input,
          ...liveForecast,
          source: liveForecast.source,
          provider: liveForecast.provider,
          weatherSensitive: input.weatherSensitive ?? input.weather_sensitive
        }
      : input;
    const weather = operatingLedger.assessWeather(jobId, weatherPayload, { actor });
    job = operatingLedger.getJobDetail(jobId, { includeAudit: true });
    const recommendationPayload = { ...weatherPayload };
    if (!recommendationPayload.plannedStart && !recommendationPayload.planned_start) {
      const existingStart = job.scheduledStart || job.scheduled_start || job.plannedStart || job.planned_start || job.targetCompletion || job.requestedDate || job.requested_date;
      const start = existingStart ? new Date(existingStart) : new Date(Date.now() + 24 * 60 * 60 * 1000);
      if (Number.isNaN(start.getTime())) start.setTime(Date.now() + 24 * 60 * 60 * 1000);
      if (!existingStart) start.setHours(8, 0, 0, 0);
      const estimatedHours = Math.max(1, Number(req.body?.estimatedHours || req.body?.estimated_hours || job.estimatedHours || job.estimated_hours || 6) || 6);
      recommendationPayload.plannedStart = start.toISOString();
      recommendationPayload.plannedEnd = recommendationPayload.plannedEnd || recommendationPayload.planned_end || new Date(start.getTime() + estimatedHours * 60 * 60 * 1000).toISOString();
    }
    const recommendation = operatingLedger.recommendSchedule(jobId, recommendationPayload, { actor, audit: false });
    return {
      success: true,
      weather,
      provider: liveForecast ? {
        name: liveForecast.provider.name,
        source: liveForecast.source,
        fetchedAt: liveForecast.fetchedAt,
        weatherDescription: liveForecast.weatherDescription
      } : { name: 'manual_assessment', source: 'manual' },
      recommendation,
      nextActions: recommendation.nextActions || [],
      nextAction: (recommendation.nextActions || [])[0] || null,
      job,
      dispatch: operatingLedger.listDispatchReadiness().summary,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.get('/api/ledger/schedule', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.listPortfolioSchedule(req.query || {})
  }));
});

app.get('/api/ledger/crew-capacity', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    board: operatingLedger.listCrewCapacityBoard(req.query || {})
  }));
});

app.put('/api/ledger/workers/:workerId/capacity-profile', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.setCrewCapacityProfile(req.params.workerId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    board: operatingLedger.listCrewCapacityBoard({
      referenceDate: req.body?.referenceDate || req.body?.reference_date
    })
  }));
});

app.post('/api/ledger/crew-capacity/allocations', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.createCrewCapacityAllocation(req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    board: operatingLedger.listCrewCapacityBoard({
      referenceDate: req.body?.referenceDate || req.body?.reference_date || req.body?.workDate || req.body?.work_date
    })
  }), 201);
});

app.post('/api/ledger/crew-capacity/allocations/:allocationId/cancel', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.cancelCrewCapacityAllocation(req.params.allocationId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    board: operatingLedger.listCrewCapacityBoard({
      referenceDate: req.body?.referenceDate || req.body?.reference_date
    })
  }));
});

app.get('/api/ledger/crew-lookahead/plans', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    plans: operatingLedger.listCrewLookaheadPlans(req.query || {})
  }));
});

app.post('/api/ledger/crew-lookahead/plans', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.requestCrewLookaheadPlan(req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      ...result,
      board: operatingLedger.listCrewCapacityBoard({
        referenceDate: req.body?.referenceDate || req.body?.reference_date
      })
    };
  }, 201);
});

app.get('/api/ledger/last-planner', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    board: operatingLedger.getLastPlannerBoard(req.query || {})
  }));
});

app.get('/api/ledger/last-planner/constraints', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    constraints: operatingLedger.listLastPlannerConstraints(req.query || {})
  }));
});

app.post('/api/ledger/jobs/:id/last-planner/constraints', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.createLastPlannerConstraint(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    board: operatingLedger.getLastPlannerBoard({
      weekStart: req.body?.weekStart || req.body?.week_start || req.body?.dueDate || req.body?.due_date
    })
  }), 201);
});

app.post('/api/ledger/jobs/:id/last-planner/constraints/:constraintId/release', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.releaseLastPlannerConstraint(req.params.id, req.params.constraintId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    board: operatingLedger.getLastPlannerBoard({
      weekStart: req.body?.weekStart || req.body?.week_start
    })
  }));
});

app.get('/api/ledger/last-planner/plans', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    plans: operatingLedger.listLastPlannerWeeklyPlans(req.query || {})
  }));
});

app.post('/api/ledger/jobs/:id/last-planner/plans', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.requestLastPlannerWeeklyPlan(req.params.id, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      ...result,
      board: operatingLedger.getLastPlannerBoard({ weekStart: result.plan.weekStart })
    };
  }, 201);
});

app.get('/api/ledger/last-planner/outcomes', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    outcomes: operatingLedger.listLastPlannerOutcomes(req.query || {})
  }));
});

app.post('/api/ledger/jobs/:id/last-planner/plans/:planId/commitments/:commitmentId/outcome', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.recordLastPlannerOutcome(
      req.params.id,
      req.params.planId,
      req.params.commitmentId,
      req.body || {},
      { actor: actorFromRequest(req, req.body?.actor || 'dashboard') }
    ),
    board: operatingLedger.getLastPlannerBoard({ weekStart: req.body?.weekStart || req.body?.week_start })
  }), 201);
});

app.get('/api/ledger/five-s', (req, res) => {
  if (req.operator?.role === 'field_worker') {
    const jobId = String(req.query.jobId || req.query.job_id || '').trim();
    if (!jobId) {
      return sendError(req, res, 400, 'five_s_job_scope_required', 'Field workers must select an assigned job to view its 5S controls.');
    }
    if (!fieldWorkerCanAccessJob(req, jobId)) {
      return sendError(req, res, 403, 'field_job_scope_forbidden', 'This field worker is not assigned to the requested 5S job.');
    }
    return handleLedgerRequest(req, res, () => ({
      success: true,
      board: projectFieldRecord(operatingLedger.getFiveSBoard({ jobId, includeGlobal: false }))
    }));
  }
  return handleLedgerRequest(req, res, () => ({
    success: true,
    board: operatingLedger.getFiveSBoard(req.query || {})
  }));
});

app.get('/api/ledger/five-s/locations', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    locations: operatingLedger.listFiveSLocations(req.query || {})
  }));
});

app.post('/api/ledger/five-s/locations', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.createFiveSLocation(req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    board: operatingLedger.getFiveSBoard()
  }), 201);
});

app.post('/api/ledger/five-s/locations/:locationId/standards', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestFiveSStandard(req.params.locationId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    board: operatingLedger.getFiveSBoard()
  }), 201);
});

app.post('/api/ledger/five-s/locations/:locationId/audits', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.recordFiveSAudit(req.params.locationId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    });
    return {
      success: true,
      ...result,
      board: operatingLedger.getFiveSBoard()
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/five-s/locations/:locationId/audits', (req, res) => {
  const payload = { ...(req.body || {}) };
  if (req.operator?.role === 'field_worker') payload.auditedBy = fieldWorkerIdentity(req).workerName;
  return handleLedgerRequest(req, res, () => {
    const location = operatingLedger.requireFiveSLocation(req.params.locationId);
    if (String(location.jobId || '') !== String(req.params.id)) {
      const error = new Error('The selected 5S location does not belong to the requested job.');
      error.code = 'five_s_location_job_mismatch';
      error.statusCode = 409;
      error.details = { locationId: location.id, locationJobId: location.jobId, requestedJobId: req.params.id };
      throw error;
    }
    const result = operatingLedger.recordFiveSAudit(req.params.locationId, payload, {
      actor: actorFromRequest(req, payload.actor || 'dashboard')
    });
    return {
      success: true,
      ...recordForOperator(req, result),
      board: recordForOperator(req, operatingLedger.getFiveSBoard({ jobId: req.params.id, includeGlobal: false }))
    };
  }, 201);
});

app.post('/api/ledger/five-s/actions/:actionId/resolve', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.resolveFiveSAction(req.params.actionId, req.body || {}, {
      actor: actorFromRequest(req, req.body?.actor || 'dashboard')
    }),
    board: operatingLedger.getFiveSBoard()
  }));
});

app.post('/api/ledger/schedule/recommend', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    recommendation: operatingLedger.recommendSchedule(req.body?.jobId || req.body?.job_id, req.body || {}, { actor: req.body?.actor || 'dashboard' })
  }));
});

app.post('/api/ledger/schedule/prepare-dispatch', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.prepareScheduleDispatch(req.body?.jobId || req.body?.job_id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/schedule/request-approval', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestScheduleApproval(req.body?.jobId || req.body?.job_id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.use('/api/weather', retiredLedgerFacadeRoute);
app.use('/api/schedule', retiredLedgerFacadeRoute);

function retiredConstructionRoute(req, res) {
  return res.status(410).json({
    error: {
      code: 'legacy_construction_retired',
      message: 'The construction compatibility API is retired. Use the operating-ledger job routes.'
    },
    migration: {
      intake: '/api/ledger/intake',
      dashboard: '/api/ledger/dashboard',
      jobRecords: '/api/ledger/jobs/:jobId/*',
      approvals: '/api/ledger/approvals'
    }
  });
}

app.use('/api/construction', retiredConstructionRoute);
function retiredLegacyResourceRoute(req, res) {
  const resource = req.baseUrl.endsWith('/workers') ? 'workers'
    : req.baseUrl.endsWith('/tools') ? 'tools'
      : 'jobs';
  const migration = resource === 'jobs'
    ? { collection: '/api/ledger/jobs', intake: '/api/ledger/intake', records: '/api/ledger/jobs/:jobId/*' }
    : { collection: `/api/ledger/${resource}` };
  return res.status(410).json({
    error: {
      code: 'legacy_resource_route_retired',
      message: `The /api/${resource} compatibility API is retired. Use the operating-ledger API.`
    },
    migration
  });
}

app.use('/api/jobs', retiredLegacyResourceRoute);
app.use('/api/workers', retiredLegacyResourceRoute);
app.use('/api/tools', retiredLegacyResourceRoute);

function retiredLegacyAutonomyRoute(req, res) {
  return res.status(410).json({
    error: {
      code: 'legacy_autonomy_retired',
      message: 'Legacy simulated autonomy is retired. Use /api/ledger/command-plan for review or /api/ledger/autonomous-cycle for approval-gated ledger automation.',
      requestId: req.requestId
    }
  });
}

app.get('/api/ai/status', retiredLegacyAutonomyRoute);
app.post('/api/ai/analyze', retiredLegacyAutonomyRoute);
app.post('/api/ai/autonomous-cycle', retiredLegacyAutonomyRoute);
app.post('/api/operations/cycle', (req, res) => res.status(410).json({
  error: {
    code: 'legacy_operations_cycle_retired',
    message: 'The mixed legacy operations cycle is retired. Use /api/ledger/autonomous-cycle or the durable ledger scheduler.'
  }
}));

app.post('/api/ledger/communications/:id/delivery-receipt', (req, res) => {
  if (!['owner', 'office_operator'].includes(req.operator?.role || 'owner')) {
    return sendError(req, res, 403, 'delivery_receipt_forbidden', 'Only an owner or office operator can record a verified delivery receipt.');
  }
  return handleLedgerRequest(req, res, () => {
    const payload = req.body || {};
    const integration = String(payload.integration || '').trim();
    if (!integration || !verifiedIntegrationIds.has(integration)) {
      const error = new Error('A configured verified integration is required to record external delivery.');
      error.statusCode = 409;
      error.code = 'verified_integration_required';
      throw error;
    }
    const communication = operatingLedger.recordCommunicationDelivery(req.params.id, {
      integration,
      providerMessageId: payload.providerMessageId || payload.provider_message_id || null,
      sentAt: payload.sentAt || payload.sent_at || null,
      receipt: payload.receipt || null
    }, { actor: payload.actor || actorFromRequest(req, 'delivery_receipt_api') });
    const purchaseOrder = communication.data?.source === 'purchase_order_issue_package'
      ? operatingLedger.getPurchaseOrder(communication.data.sourceRecordId)
      : null;
    const changeOrder = communication.data?.source === 'change_order_issue_package'
      ? operatingLedger.getJobDetail(communication.jobId).changeOrders.find(item => item.id === communication.data.sourceRecordId) || null
      : null;
    return {
      success: true,
      communication,
      purchaseOrder,
      changeOrder,
      bidPackage: purchaseOrder ? operatingLedger.getBidPackageByPurchaseOrder(purchaseOrder.id) : null,
      job: operatingLedger.getJobDetail(communication.jobId),
      finance: purchaseOrder ? operatingLedger.listFinanceReadiness({ limit: 100 }) : null,
      dashboard: operatingLedger.dashboardSummary()
    };
  });
});
app.post('/api/emergency/activate', (req, res) => res.status(410).json({
  error: {
    code: 'emergency_autonomy_retired',
    message: 'Emergency auto-dispatch is retired. Create a ledger intake, record the incident, and resolve the required approval gates before any commitment.',
    requestId: req.requestId
  }
}));
app.post('/api/ai/chat', (req, res) => {
  return res.status(410).json({
    error: {
      code: 'conversational_ai_route_retired',
      message: 'Unpersisted conversational AI is retired. Use the ledger command plan for reviewable operational guidance.',
      requestId: req.requestId
    },
    migration: { endpoint: '/api/ledger/command-plan', method: 'GET' }
  });
});

app.post('/api/simulate/client-request', (req, res) => {
  return res.status(410).json({
    error: {
      code: 'simulation_retired',
      message: 'Sample client requests are retired. Create a persisted job through /api/ledger/intake instead.',
      requestId: req.requestId
    }
  });

});

// Retired compatibility endpoint for pre-ledger clients.
app.post('/api/legacy/ai/chat', (req, res) => {
  return res.status(410).json({
    error: {
      code: 'legacy_chat_retired',
      message: 'Legacy simulated chat is retired. Use the persisted command plan and ledger views instead.',
      requestId: req.requestId
    }
  });
});

// Retired compatibility endpoint for pre-ledger sample intake.
app.post('/api/legacy/simulate/client-request', (req, res) => {
  return res.status(410).json({
    error: {
      code: 'simulation_retired',
      message: 'Sample client requests are retired. Create a persisted job through /api/ledger/intake instead.',
      requestId: req.requestId
    }
  });
});

app.post('/api/test/notifications', (req, res) => {
  return res.status(410).json({
    error: {
      code: 'test_notification_route_retired',
      message: 'Synthetic notification drafts are retired. Create a job-linked communication draft in the operating ledger.',
      requestId: req.requestId
    },
    migration: {
      endpoint: '/api/ledger/jobs/:jobId/communication',
      method: 'POST',
      approvalRequired: true
    }
  });
});

// Ledger evidence intake accepts JSON metadata and bounded multipart uploads.
app.post('/api/ledger/upload', async (req, res) => {
  let uploadPayload;
  let idempotency = null;
  let retainedUpload = null;
  let ledgerCommitted = false;
  try {
    uploadPayload = await readUploadPayload(req, {
      authorizePayload(payload) {
        const requestedJobId = payload.jobId || payload.job_id || payload.ledgerJobId || payload.ledger_job_id;
        const requestedOpportunityId = payload.opportunityId || payload.opportunity_id;
        if (!requestedJobId && !requestedOpportunityId) {
          throw new UploadRequestError(400, 'ledger_job_required', 'Evidence uploads must identify an operating-ledger job or opportunity.');
        }
        if (requestedJobId && requestedOpportunityId) {
          throw new UploadRequestError(400, 'ledger_evidence_owner_invalid', 'Evidence uploads must identify exactly one operating-ledger job or opportunity.');
        }
        if (requestedOpportunityId) {
          if (req.operator?.role === 'field_worker') {
            throw new UploadRequestError(403, 'opportunity_evidence_forbidden', 'Field workers cannot upload private preconstruction opportunity evidence.');
          }
          try {
            operatingLedger.getOpportunity(requestedOpportunityId);
          } catch {
            throw new UploadRequestError(404, 'opportunity_not_found', 'The requested operating-ledger opportunity was not found.');
          }
          return;
        }
        if (req.operator?.role === 'field_worker' && !fieldWorkerCanAccessJob(req, requestedJobId)) {
          throw new UploadRequestError(403, 'field_job_scope_forbidden', 'This field worker is not assigned to the evidence job.');
        }
        const governedPhotoEvidenceSetId = payload.photoEvidenceSetId || payload.photo_evidence_set_id;
        if (governedPhotoEvidenceSetId && req.operator?.authenticated === true && req.operator?.role !== 'field_worker') {
          throw new UploadRequestError(
            403,
            'photo_evidence_worker_scope_forbidden',
            'Authenticated governed photo evidence must be captured by the retained assigned field worker.'
          );
        }
        if (!resolveUploadLedgerJobDetail(payload, actorFromRequest(req, 'upload_api'))?.id) {
          throw new UploadRequestError(404, 'ledger_job_not_found', 'The requested operating-ledger job was not found.');
        }
      }
    });
    idempotency = uploadIdempotencyClaim(req, uploadPayload.payload || {}, uploadPayload.file);
    if (idempotency?.replayed) {
      res.setHeader('Idempotent-Replayed', 'true');
      return res.status(idempotency.responseStatus).json(idempotency.responseBody);
    }
    if (idempotency && !idempotency.claimed) {
      if (idempotency.reason === 'request_conflict') {
        throw new UploadRequestError(409, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different evidence request.');
      }
      if (idempotency.reason === 'request_in_progress') {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(Number(idempotency.retryAfterMs || 1000) / 1000))));
        throw new UploadRequestError(409, 'idempotent_request_in_progress', 'The matching evidence request is still being processed.');
      }
      throw new UploadRequestError(503, 'idempotency_claim_failed', 'The evidence retry identity could not be claimed safely.');
    }

    const storedFile = uploadPayload.file ? await storeUploadedFile(uploadPayload.file) : null;
    retainedUpload = storedFile;
    const payload = withStoredUpload(uploadPayload.payload || {}, storedFile);
    const analysis = {
      ...analyzeUploadPayload(payload),
      upload: storedFile ? {
        storageRef: storedFile.storageRef,
        mimeType: storedFile.mimeType,
        size: storedFile.size,
        sha256: storedFile.sha256 || null
      } : null
    };
    const actor = actorFromRequest(req, 'upload_api');
    const responseBody = operatingLedger.transaction(() => {
      const opportunityId = payload.opportunityId || payload.opportunity_id || null;
      if (opportunityId) {
        const opportunityEvidence = operatingLedger.addOpportunityEvidence(opportunityId, {
          type: analysis.category === 'field_photo' || String(payload.fileType || '').startsWith('image/') ? 'photo' : 'document',
          title: payload.title || storedFile?.originalName || payload.filename || payload.name || 'Uploaded site-survey evidence',
          filename: storedFile?.originalName || payload.filename || payload.name || null,
          mimeType: storedFile?.mimeType || payload.fileType || payload.mimeType || payload.mime_type || null,
          sizeBytes: storedFile?.size || payload.size || payload.sizeBytes || payload.size_bytes || 0,
          storageRef: storedFile?.storageRef || payload.storageRef || null,
          contentHash: storedFile?.sha256 || payload.contentHash || payload.content_hash || null,
          status: 'stored',
          tags: [analysis.category, payload.category, payload.riskLevel].filter(Boolean),
          analysis,
          data: { analysis, private: true, intendedUse: 'preconstruction_site_survey' }
        }, { actor });
        const body = {
          success: true,
          filename: payload.filename || payload.name || 'metadata-only',
          uploadedFile: storedFile,
          analysis,
          opportunityEvidence,
          actions: [],
          migration: {
            opportunity: `/api/ledger/opportunities/${opportunityId}`,
            siteSurvey: `/api/ledger/opportunities/${opportunityId}/site-surveys`
          }
        };
        if (idempotency?.claimed) {
          const completed = operatingLedger.completeIdempotentRequest(
            idempotency.keyHash,
            idempotency.requestHash,
            200,
            body,
            idempotency.leaseId
          );
          if (!completed) {
            throw new UploadRequestError(503, 'idempotency_completion_failed', 'The evidence retry receipt could not be completed safely.');
          }
        }
        return body;
      }
      const ledgerDetail = resolveUploadLedgerJobDetail(payload, actor);
      const ledgerDocument = operatingLedger.addDocument(ledgerDetail.id, {
        type: analysis.category === 'field_photo' || String(payload.fileType || '').startsWith('image/') ? 'photo' : 'document',
        title: payload.title || storedFile?.originalName || payload.filename || payload.name || 'Uploaded evidence',
        filename: storedFile?.originalName || payload.filename || payload.name || null,
        mimeType: storedFile?.mimeType || payload.fileType || payload.mimeType || payload.mime_type || null,
        sizeBytes: storedFile?.size || payload.size || payload.sizeBytes || payload.size_bytes || 0,
        storageRef: storedFile?.storageRef || payload.storageRef || payload.url || null,
        status: analysis.riskDetected ? 'needs_review' : 'stored',
        tags: [analysis.category, payload.category, payload.riskLevel].filter(Boolean),
        analysis
      }, { actor });
      const ledgerFollowUp = createLedgerUploadFollowUps(ledgerDetail, ledgerDocument, payload, analysis, {
        actor,
        workerId: req.operator?.role === 'field_worker' ? req.operator.scope?.workerId : null,
        enforceWorkerScope: req.operator?.role === 'field_worker' && req.operator?.authenticated === true
      });
      const body = {
        success: true,
        filename: payload.filename || payload.name || 'metadata-only',
        uploadedFile: storedFile,
        analysis,
        ledgerDocument,
        ledgerFollowUp,
        actions: ledgerFollowUp.actions,
        migration: {
          legacyBuildAttachmentRetired: payload.attachToBuild !== undefined,
          job: `/api/ledger/jobs/${ledgerDetail.id}`
        }
      };
      if (idempotency?.claimed) {
        const completed = operatingLedger.completeIdempotentRequest(
          idempotency.keyHash,
          idempotency.requestHash,
          200,
          body,
          idempotency.leaseId
        );
        if (!completed) {
          throw new UploadRequestError(503, 'idempotency_completion_failed', 'The evidence retry receipt could not be completed safely.');
        }
      }
      return body;
    });
    ledgerCommitted = true;
    return res.json(responseBody);
  } catch (error) {
    if (retainedUpload && !ledgerCommitted && evidenceStorage?.remove) {
      try {
        await evidenceStorage.remove(retainedUpload.storageRef);
      } catch (cleanupError) {
        log('warn', 'unreferenced_evidence_cleanup_failed', {
          requestId: req.requestId,
          code: cleanupError.code || 'evidence_cleanup_failed'
        });
      }
    }
    if (idempotency?.claimed) {
      operatingLedger.releaseIdempotentRequest(idempotency.keyHash, idempotency.requestHash, idempotency.leaseId);
    }
    if (error instanceof UploadRequestError) {
      return sendError(req, res, error.statusCode, error.code, error.message, error.details);
    }
    if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600) {
      return sendError(
        req,
        res,
        error.statusCode,
        error.code || 'ledger_upload_rejected',
        error.message || 'The evidence upload was rejected.',
        error.details || serializeError(error)
      );
    }
    throw error;
  }
});

app.all('/api/upload', (req, res) => res.status(410).json({
  error: {
    code: 'upload_facade_retired',
    message: 'The unversioned evidence upload facade is retired. Use the operating-ledger evidence endpoint.',
    requestId: req.requestId
  },
  migration: {
    endpoint: '/api/ledger/upload',
    method: 'POST'
  }
}));

// Debug diagnostics. Disabled in production unless DEBUG_DIAGNOSTICS=true.
app.get('/api/debug/diagnostics', (req, res) => {
  if (isProduction && process.env.DEBUG_DIAGNOSTICS !== 'true') {
    return sendError(req, res, 404, 'not_found', 'Diagnostics are disabled');
  }

  const ledgerDiagnostics = operatingLedger.diagnose();
  res.json({
    status: ledgerDiagnostics.valid ? 'ok' : 'attention',
    requestId: req.requestId,
    generatedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    },
    environment: {
      nodeEnv: process.env.NODE_ENV || 'development',
      diagnosticsEnabled: true
    },
    persistence: {
      mode: 'ledger_only',
      ledgerFile: isProduction ? 'hidden' : ledgerFile,
      legacyImportSourcePresent: !isProduction && fs.existsSync(stateFile)
    },
    ledger: {
      diagnostics: ledgerDiagnostics,
      summary: operatingLedger.dashboardSummary()
    }
  });
});

const OPERATIONAL_EXPORT_FORMAT = 'contractor-ai-operational-export/v2';
const OPERATIONAL_EXPORT_CANONICALIZATION = 'contractor-ai-stable-json/v1';

function operationalExport() {
  const dashboard = operatingLedger.dashboardSummary();
  const payload = JSON.parse(JSON.stringify({
    exportedAt: new Date().toISOString(),
    format: OPERATIONAL_EXPORT_FORMAT,
    purpose: 'operator_reconciliation',
    restorable: false,
    runtime: runtimeConfiguration(),
    dashboard,
    organization: operatingLedger.getOrganizationProfile(),
    opportunities: operatingLedger.listOpportunities({ includeClosed: true, limit: 500 }),
    opportunityActivities: operatingLedger.listOpportunityActivities({ limit: 1_000 }),
    marketFitProfiles: operatingLedger.listMarketFitProfiles({ includeHistory: true }),
    opportunityFitAssessments: operatingLedger.listOpportunityFitAssessments({ limit: 5_000 }),
    bidDecisionPolicies: operatingLedger.listBidDecisionPolicies({ includeHistory: true }),
    opportunityBidDecisions: operatingLedger.listOpportunityBidDecisions({ limit: 5_000 }),
    estimateRatePolicies: operatingLedger.listEstimateRatePolicies({ includeHistory: true }),
    commercialScopeRevisions: operatingLedger.listCommercialScopeRevisions({ limit: 5_000 }),
    riskRegisterRevisions: operatingLedger.listRiskRegisterRevisions({ limit: 5_000 }),
    pricingBasisDecisions: operatingLedger.listPricingBasisDecisions({ limit: 5_000 }),
    opportunityEvidence: operatingLedger.listOpportunityEvidence({ limit: 5_000 }),
    opportunitySiteSurveys: operatingLedger.listOpportunitySiteSurveys({ limit: 5_000 }),
    bidPackages: operatingLedger.listBidPackages({ includeClosed: true, limit: 500 }),
    bidPackageParticipants: operatingLedger.listBidPackageParticipants({ limit: 5_000 }),
    takeoffSheets: operatingLedger.listAllTakeoffs({ limit: 5_000 }),
    takeoffItems: operatingLedger.listAllTakeoffItems({ limit: 10_000 }),
    jobs: operatingLedger.listJobs({ includeArchived: true, limit: 500 }),
    formalVariations: operatingLedger.listChangeOrders({ formalOnly: true, limit: 10_000 }),
    tradePartners: operatingLedger.listTradePartners({ includeRetired: true, limit: 500 }),
    purchaseOrders: operatingLedger.listPurchaseOrders({ limit: 5_000 }),
    supplierInvoices: operatingLedger.listSupplierInvoices({ limit: 500 }),
    supplierInvoicePayments: operatingLedger.listSupplierInvoicePayments({ limit: 500 }),
    billingMilestones: operatingLedger.listBillingMilestones({ limit: 500 }),
    costForecastSnapshots: operatingLedger.listAllCostForecastSnapshots({ limit: 5_000 }),
    cashFlowItems: operatingLedger.listCashFlowItems({ includeArchived: true, limit: 5_000 }),
    cashFlowForecastSnapshots: operatingLedger.listCashFlowForecastSnapshots({ limit: 5_000 }),
    performanceScorecardTargets: operatingLedger.listPerformanceScorecardTargets({ includeHistory: true }).revisions,
    performanceScorecardSnapshots: operatingLedger.listPerformanceScorecardSnapshots({ limit: 5_000 }),
    clientFeedback: operatingLedger.listClientFeedback({ limit: 10_000 }),
    energyPerformanceRecords: operatingLedger.listEnergyPerformanceRecords({ limit: 10_000 }),
    productionBaselines: operatingLedger.listAllProductionBaselines({ limit: 5_000 }),
    productionEntries: operatingLedger.listAllProductionEntries({ limit: 10_000 }),
    dayworkTickets: operatingLedger.listDayworkTickets({ limit: 5_000 }),
    nonconformances: operatingLedger.listNonconformances({ limit: 5_000 }),
    attendanceSessions: operatingLedger.listAttendanceSessions({ limit: 10_000 }),
    attendanceAdjustments: operatingLedger.listAttendanceAdjustments({ limit: 10_000 }),
    weeklyTimesheets: operatingLedger.listWeeklyTimesheets({ status: 'all', limit: 10_000 }),
    timesheetExports: operatingLedger.listTimesheetExports({ limit: 5_000 }),
    taskDependencies: operatingLedger.listAllTaskDependencies({ limit: 1000 }),
    scheduleBaselines: operatingLedger.listAllScheduleBaselines({ limit: 500 }),
    crewCapacityProfiles: operatingLedger.listCrewCapacityProfiles({ includeHistory: true, limit: 5_000 }),
    crewCapacityAllocations: operatingLedger.listCrewCapacityAllocations({ status: 'all', limit: 20_000 }),
    crewLookaheadPlans: operatingLedger.listCrewLookaheadPlans({ status: 'all', limit: 5_000 }),
    dailyOperatingCycles: operatingLedger.listDailyOperatingCycles({ limit: 10_000 }),
    lastPlannerConstraints: operatingLedger.listLastPlannerConstraints({ status: 'all', limit: 10_000 }),
    lastPlannerWeeklyPlans: operatingLedger.listLastPlannerWeeklyPlans({ status: 'all', limit: 10_000 }),
    lastPlannerOutcomes: operatingLedger.listLastPlannerOutcomes({ limit: 20_000 }),
    fiveSLocations: operatingLedger.listFiveSLocations({ status: 'all', limit: 5_000 }),
    fiveSStandards: operatingLedger.listFiveSStandards({ status: 'all', limit: 10_000 }),
    fiveSAudits: operatingLedger.listFiveSAudits({ limit: 20_000 }),
    fiveSActions: operatingLedger.listFiveSActions({ status: 'all', limit: 20_000 }),
    lmraAssessments: operatingLedger.listLmraAssessments({ limit: 20_000 }),
    inspectionTemplates: operatingLedger.listInspectionTemplates({ includeSuperseded: true }),
    inspectionChecklistSubmissions: operatingLedger.listInspectionChecklistSubmissions({ limit: 5000 }),
    installationQcControls: operatingLedger.listInstallationQcControls({ limit: 5000 }),
    photoEvidenceSets: operatingLedger.listPhotoEvidenceSets({ limit: 5000 }),
    photoEvidenceCaptures: operatingLedger.listPhotoEvidenceCaptures({ limit: 20_000 }),
    projectControls: operatingLedger.listProjectControls({ limit: 5000 }),
    handoverPackages: operatingLedger.listHandoverPackages({ limit: 500 }),
    approvals: operatingLedger.listApprovals({ status: 'all', limit: 500 }),
    audit: operatingLedger.listAudit({ limit: 1_000 })
  }));
  return {
    ...payload,
    integrity: {
      algorithm: 'sha256',
      canonicalization: OPERATIONAL_EXPORT_CANONICALIZATION,
      digest: crypto.createHash('sha256').update(stableJson(payload)).digest('hex')
    }
  };
}

function validateOperationalExport(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { valid: false, code: 'invalid_operational_export', problems: ['The selected file is not a Contractor.AI operational export.'] };
  }
  if (snapshot.format === 'contractor-ai-operational-export/v1') {
    return { valid: false, code: 'legacy_export_unverifiable', problems: ['Version 1 exports have no integrity digest. Create a new export before relying on it for reconciliation.'] };
  }
  const problems = [];
  if (snapshot.format !== OPERATIONAL_EXPORT_FORMAT) problems.push('The selected file uses an unsupported Contractor.AI export format.');
  if (snapshot.purpose !== 'operator_reconciliation' || snapshot.restorable !== false) {
    problems.push('The export must identify itself as a non-restorable operator reconciliation artifact.');
  }
  if (!snapshot.exportedAt || Number.isNaN(Date.parse(snapshot.exportedAt))) problems.push('Export timestamp is missing or invalid.');
  if (!snapshot.runtime || typeof snapshot.runtime !== 'object' || Array.isArray(snapshot.runtime)) problems.push('Export is missing runtime metadata.');
  if (!snapshot.dashboard || typeof snapshot.dashboard !== 'object' || Array.isArray(snapshot.dashboard)) problems.push('Export is missing the dashboard summary.');
  for (const key of [
    'jobs',
    'tradePartners',
    'supplierInvoices',
    'supplierInvoicePayments',
    'billingMilestones',
    'taskDependencies',
    'scheduleBaselines',
    'productionBaselines',
    'productionEntries',
    'clientFeedback',
    'handoverPackages',
    'approvals',
    'audit'
  ]) {
    if (!Array.isArray(snapshot[key])) problems.push(`Export is missing the ${key} collection.`);
  }
  for (const key of [
    'opportunities',
    'opportunityActivities',
    'bidPackages',
    'bidPackageParticipants',
    'takeoffSheets',
    'takeoffItems',
    'purchaseOrders',
    'costForecastSnapshots',
    'cashFlowItems',
    'cashFlowForecastSnapshots',
    'performanceScorecardTargets',
    'performanceScorecardSnapshots',
    'marketFitProfiles',
    'opportunityFitAssessments',
    'bidDecisionPolicies',
    'opportunityBidDecisions',
    'estimateRatePolicies',
    'commercialScopeRevisions',
    'riskRegisterRevisions',
    'pricingBasisDecisions',
    'opportunityEvidence',
    'opportunitySiteSurveys',
    'attendanceSessions',
    'attendanceAdjustments',
    'weeklyTimesheets',
    'timesheetExports',
    'crewCapacityProfiles',
    'crewCapacityAllocations',
    'crewLookaheadPlans',
    'dailyOperatingCycles',
    'lastPlannerConstraints',
    'lastPlannerWeeklyPlans',
    'lastPlannerOutcomes',
    'fiveSLocations',
    'fiveSStandards',
    'fiveSAudits',
    'fiveSActions',
    'lmraAssessments',
    'inspectionTemplates',
    'inspectionChecklistSubmissions',
    'installationQcControls',
    'photoEvidenceSets',
    'photoEvidenceCaptures',
    'energyPerformanceRecords',
    'dayworkTickets',
    'nonconformances'
  ]) {
    if (snapshot[key] !== undefined && !Array.isArray(snapshot[key])) {
      problems.push(`Export ${key} must be a collection when present.`);
    }
  }
  if (snapshot.projectControls !== undefined) {
    if (!snapshot.projectControls || typeof snapshot.projectControls !== 'object' || Array.isArray(snapshot.projectControls)) {
      problems.push('Export projectControls must be an object when present.');
    } else {
      for (const key of ['rfis', 'submittals', 'controlledDocuments']) {
        if (!Array.isArray(snapshot.projectControls[key])) problems.push(`Export projectControls is missing the ${key} collection.`);
      }
      if (snapshot.projectControls.transmittals !== undefined && !Array.isArray(snapshot.projectControls.transmittals)) {
        problems.push('Export projectControls transmittals must be a collection when present.');
      }
      if (snapshot.projectControls.meetings !== undefined && !Array.isArray(snapshot.projectControls.meetings)) {
        problems.push('Export projectControls meetings must be a collection when present.');
      }
    }
  }
  const integrity = snapshot.integrity;
  if (
    integrity?.algorithm !== 'sha256'
    || integrity?.canonicalization !== OPERATIONAL_EXPORT_CANONICALIZATION
    || !/^[a-f0-9]{64}$/.test(String(integrity?.digest || ''))
  ) {
    problems.push('Export integrity metadata is missing or invalid.');
  }
  if (problems.length) return { valid: false, code: 'invalid_operational_export', problems };

  const { integrity: suppliedIntegrity, ...payload } = snapshot;
  const expectedDigest = crypto.createHash('sha256').update(stableJson(payload)).digest('hex');
  if (suppliedIntegrity.digest !== expectedDigest) {
    return { valid: false, code: 'export_integrity_failed', problems: ['The export contents do not match its SHA-256 integrity digest.'] };
  }
  return {
    valid: true,
    format: snapshot.format,
    exportedAt: snapshot.exportedAt,
    artifactType: 'operational_export',
    purpose: snapshot.purpose,
    restorable: false,
    integrity: { verified: true, algorithm: 'sha256', digest: expectedDigest },
    counts: {
      jobs: snapshot.jobs.length,
      formalVariations: Array.isArray(snapshot.formalVariations) ? snapshot.formalVariations.length : 0,
      opportunities: Array.isArray(snapshot.opportunities) ? snapshot.opportunities.length : 0,
      opportunityActivities: Array.isArray(snapshot.opportunityActivities) ? snapshot.opportunityActivities.length : 0,
      bidPackages: Array.isArray(snapshot.bidPackages) ? snapshot.bidPackages.length : 0,
      bidPackageParticipants: Array.isArray(snapshot.bidPackageParticipants) ? snapshot.bidPackageParticipants.length : 0,
      takeoffSheets: Array.isArray(snapshot.takeoffSheets) ? snapshot.takeoffSheets.length : 0,
      takeoffItems: Array.isArray(snapshot.takeoffItems) ? snapshot.takeoffItems.length : 0,
      tradePartners: snapshot.tradePartners.length,
      purchaseOrders: Array.isArray(snapshot.purchaseOrders) ? snapshot.purchaseOrders.length : 0,
      supplierInvoices: snapshot.supplierInvoices.length,
      supplierInvoicePayments: snapshot.supplierInvoicePayments.length,
      billingMilestones: snapshot.billingMilestones.length,
      costForecastSnapshots: Array.isArray(snapshot.costForecastSnapshots) ? snapshot.costForecastSnapshots.length : 0,
      cashFlowItems: Array.isArray(snapshot.cashFlowItems) ? snapshot.cashFlowItems.length : 0,
      cashFlowForecastSnapshots: Array.isArray(snapshot.cashFlowForecastSnapshots) ? snapshot.cashFlowForecastSnapshots.length : 0,
      performanceScorecardTargets: Array.isArray(snapshot.performanceScorecardTargets) ? snapshot.performanceScorecardTargets.length : 0,
      performanceScorecardSnapshots: Array.isArray(snapshot.performanceScorecardSnapshots) ? snapshot.performanceScorecardSnapshots.length : 0,
      clientFeedback: snapshot.clientFeedback.length,
      energyPerformanceRecords: Array.isArray(snapshot.energyPerformanceRecords) ? snapshot.energyPerformanceRecords.length : 0,
      marketFitProfiles: Array.isArray(snapshot.marketFitProfiles) ? snapshot.marketFitProfiles.length : 0,
      opportunityFitAssessments: Array.isArray(snapshot.opportunityFitAssessments) ? snapshot.opportunityFitAssessments.length : 0,
      bidDecisionPolicies: Array.isArray(snapshot.bidDecisionPolicies) ? snapshot.bidDecisionPolicies.length : 0,
      opportunityBidDecisions: Array.isArray(snapshot.opportunityBidDecisions) ? snapshot.opportunityBidDecisions.length : 0,
      estimateRatePolicies: Array.isArray(snapshot.estimateRatePolicies) ? snapshot.estimateRatePolicies.length : 0,
      commercialScopeRevisions: Array.isArray(snapshot.commercialScopeRevisions) ? snapshot.commercialScopeRevisions.length : 0,
      riskRegisterRevisions: Array.isArray(snapshot.riskRegisterRevisions) ? snapshot.riskRegisterRevisions.length : 0,
      pricingBasisDecisions: Array.isArray(snapshot.pricingBasisDecisions) ? snapshot.pricingBasisDecisions.length : 0,
      opportunityEvidence: Array.isArray(snapshot.opportunityEvidence) ? snapshot.opportunityEvidence.length : 0,
      opportunitySiteSurveys: Array.isArray(snapshot.opportunitySiteSurveys) ? snapshot.opportunitySiteSurveys.length : 0,
      productionBaselines: snapshot.productionBaselines.length,
      productionEntries: snapshot.productionEntries.length,
      dayworkTickets: Array.isArray(snapshot.dayworkTickets) ? snapshot.dayworkTickets.length : 0,
      attendanceSessions: Array.isArray(snapshot.attendanceSessions) ? snapshot.attendanceSessions.length : 0,
      attendanceAdjustments: Array.isArray(snapshot.attendanceAdjustments) ? snapshot.attendanceAdjustments.length : 0,
      weeklyTimesheets: Array.isArray(snapshot.weeklyTimesheets) ? snapshot.weeklyTimesheets.length : 0,
      timesheetExports: Array.isArray(snapshot.timesheetExports) ? snapshot.timesheetExports.length : 0,
      taskDependencies: snapshot.taskDependencies.length,
      scheduleBaselines: snapshot.scheduleBaselines.length,
      crewCapacityProfiles: Array.isArray(snapshot.crewCapacityProfiles) ? snapshot.crewCapacityProfiles.length : 0,
      crewCapacityAllocations: Array.isArray(snapshot.crewCapacityAllocations) ? snapshot.crewCapacityAllocations.length : 0,
      crewLookaheadPlans: Array.isArray(snapshot.crewLookaheadPlans) ? snapshot.crewLookaheadPlans.length : 0,
      dailyOperatingCycles: Array.isArray(snapshot.dailyOperatingCycles) ? snapshot.dailyOperatingCycles.length : 0,
      lastPlannerConstraints: Array.isArray(snapshot.lastPlannerConstraints) ? snapshot.lastPlannerConstraints.length : 0,
      lastPlannerWeeklyPlans: Array.isArray(snapshot.lastPlannerWeeklyPlans) ? snapshot.lastPlannerWeeklyPlans.length : 0,
      lastPlannerOutcomes: Array.isArray(snapshot.lastPlannerOutcomes) ? snapshot.lastPlannerOutcomes.length : 0,
      fiveSLocations: Array.isArray(snapshot.fiveSLocations) ? snapshot.fiveSLocations.length : 0,
      fiveSStandards: Array.isArray(snapshot.fiveSStandards) ? snapshot.fiveSStandards.length : 0,
      fiveSAudits: Array.isArray(snapshot.fiveSAudits) ? snapshot.fiveSAudits.length : 0,
      fiveSActions: Array.isArray(snapshot.fiveSActions) ? snapshot.fiveSActions.length : 0,
      lmraAssessments: Array.isArray(snapshot.lmraAssessments) ? snapshot.lmraAssessments.length : 0,
      inspectionTemplates: Array.isArray(snapshot.inspectionTemplates) ? snapshot.inspectionTemplates.length : 0,
      inspectionChecklistSubmissions: Array.isArray(snapshot.inspectionChecklistSubmissions) ? snapshot.inspectionChecklistSubmissions.length : 0,
      installationQcControls: Array.isArray(snapshot.installationQcControls) ? snapshot.installationQcControls.length : 0,
      photoEvidenceSets: Array.isArray(snapshot.photoEvidenceSets) ? snapshot.photoEvidenceSets.length : 0,
      photoEvidenceCaptures: Array.isArray(snapshot.photoEvidenceCaptures) ? snapshot.photoEvidenceCaptures.length : 0,
      rfis: Array.isArray(snapshot.projectControls?.rfis) ? snapshot.projectControls.rfis.length : 0,
      submittals: Array.isArray(snapshot.projectControls?.submittals) ? snapshot.projectControls.submittals.length : 0,
      transmittals: Array.isArray(snapshot.projectControls?.transmittals) ? snapshot.projectControls.transmittals.length : 0,
      meetings: Array.isArray(snapshot.projectControls?.meetings) ? snapshot.projectControls.meetings.length : 0,
      controlledDocuments: Array.isArray(snapshot.projectControls?.controlledDocuments) ? snapshot.projectControls.controlledDocuments.length : 0,
      handoverPackages: snapshot.handoverPackages.length,
      approvals: snapshot.approvals.length,
      audit: snapshot.audit.length
    }
  };
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyEvidenceBackup(sourceRoot, backupDir) {
  const source = path.resolve(sourceRoot);
  const targetRoot = path.resolve(backupDir, 'evidence');
  if (targetRoot.startsWith(`${source}${path.sep}`) || source.startsWith(`${targetRoot}${path.sep}`) || source === targetRoot) {
    throw new Error('Evidence and backup directories must not overlap.');
  }
  const copied = [];
  const entries = [];
  if (!fs.existsSync(source)) return { copied, entries };
  fs.mkdirSync(targetRoot, { recursive: true });

  const visit = (directory, relativeDirectory = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Evidence backup refuses symbolic link: ${entry.name}`);
      const relative = path.join(relativeDirectory, entry.name);
      const sourcePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(sourcePath, relative);
        continue;
      }
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const target = path.resolve(targetRoot, relative);
      if (!target.startsWith(`${targetRoot}${path.sep}`)) throw new Error('Evidence backup path could not be resolved safely.');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(sourcePath, target);
      const manifestPath = path.posix.join('evidence', relative.replace(/\\/g, '/'));
      copied.push(path.relative(__dirname, target).replace(/\\/g, '/'));
      entries.push({ file: manifestPath, bytes: fs.statSync(target).size, sha256: sha256File(target) });
    }
  };
  visit(source);
  return { copied, entries };
}

function assertLocalBackupMode() {
  if (operatingLedger.databaseMode === 'sqlite') return;
  const error = new Error('Hosted recovery uses the configured PostgreSQL backup policy and versioned object storage; no incomplete local package was created.');
  error.statusCode = 409;
  error.code = 'provider_recovery_required';
  throw error;
}

function backupOperationalState() {
  assertLocalBackupMode();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = path.join(dataDir, 'backups');
  const backupDir = path.join(backupRoot, timestamp);
  fs.mkdirSync(backupDir, { recursive: true });
  if (operatingLedger.databaseMode === 'sqlite') {
    try {
      operatingLedger.db.exec('PRAGMA wal_checkpoint(FULL)');
    } catch (error) {
      log('warn', 'ledger_backup_checkpoint_failed', { error: serializeError(error) });
    }
  }

  const copied = [];
  const manifestFiles = [];
  const backupSources = operatingLedger.databaseMode === 'sqlite'
    ? [stateFile, ledgerFile, `${ledgerFile}-wal`, `${ledgerFile}-shm`]
    : [stateFile];
  for (const source of backupSources) {
    if (!fs.existsSync(source)) continue;
    const target = path.join(backupDir, path.basename(source));
    fs.copyFileSync(source, target);
    copied.push(path.relative(__dirname, target).replace(/\\/g, '/'));
    manifestFiles.push({ file: path.basename(target), bytes: fs.statSync(target).size, sha256: sha256File(target) });
  }
  const evidenceBackup = operatingLedger.databaseMode === 'sqlite'
    ? copyEvidenceBackup(uploadDir, backupDir)
    : { copied: [], entries: [] };
  copied.push(...evidenceBackup.copied);
  manifestFiles.push(...evidenceBackup.entries);
  const exportFile = path.join(backupDir, 'operational-export.json');
  fs.writeFileSync(exportFile, JSON.stringify(operationalExport(), null, 2));
  copied.push(path.relative(__dirname, exportFile).replace(/\\/g, '/'));
  manifestFiles.push({ file: path.basename(exportFile), bytes: fs.statSync(exportFile).size, sha256: sha256File(exportFile) });
  const manifest = {
    format: 'contractor-ai-backup-manifest/v2',
    backupId: timestamp,
    createdAt: new Date().toISOString(),
    databaseMode: operatingLedger.databaseMode,
    database: operatingLedger.databaseMode === 'sqlite'
      ? { engine: 'sqlite', file: path.basename(ledgerFile) }
      : { engine: operatingLedger.databaseMode, file: null },
    evidence: {
      included: operatingLedger.databaseMode === 'sqlite',
      fileCount: evidenceBackup.entries.length
    },
    files: manifestFiles
  };
  const manifestFile = path.join(backupDir, 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  copied.push(path.relative(__dirname, manifestFile).replace(/\\/g, '/'));
  return {
    backupId: timestamp,
    databaseMode: operatingLedger.databaseMode,
    files: copied,
    evidenceFiles: evidenceBackup.entries.length,
    verification: { valid: true, checkedFiles: manifestFiles.length },
    providerBackupRequired: operatingLedger.databaseMode === 'postgres'
  };
}

function backupDirectoryForId(backupId) {
  const normalizedId = String(backupId || '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(normalizedId)) {
    const error = new Error('Backup id is invalid.');
    error.statusCode = 400;
    error.code = 'invalid_backup_id';
    throw error;
  }
  const backupRoot = path.resolve(dataDir, 'backups');
  const backupDir = path.resolve(backupRoot, normalizedId);
  if (path.dirname(backupDir) !== backupRoot) {
    const error = new Error('Backup id is invalid.');
    error.statusCode = 400;
    error.code = 'invalid_backup_id';
    throw error;
  }
  return backupDir;
}

function readBackupManifest(backupId) {
  const backupDir = backupDirectoryForId(backupId);
  const manifestFile = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) {
    const error = new Error('Backup manifest was not found.');
    error.statusCode = 404;
    error.code = 'backup_not_found';
    throw error;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (!['contractor-ai-backup-manifest/v1', 'contractor-ai-backup-manifest/v2'].includes(manifest?.format) || !Array.isArray(manifest.files)) {
    const error = new Error('Backup manifest is invalid.');
    error.statusCode = 422;
    error.code = 'invalid_backup_manifest';
    throw error;
  }
  if (manifest.backupId && manifest.backupId !== String(backupId)) {
    const error = new Error('Backup manifest id does not match its retained directory.');
    error.statusCode = 422;
    error.code = 'invalid_backup_manifest';
    throw error;
  }
  if (manifest.format === 'contractor-ai-backup-manifest/v2') {
    const evidenceEntries = manifest.files.filter(entry => String(entry?.file || '').replace(/\\/g, '/').startsWith('evidence/'));
    if (manifest.databaseMode === 'sqlite' && (manifest.evidence?.included !== true || Number(manifest.evidence?.fileCount) !== evidenceEntries.length)) {
      const error = new Error('Backup evidence manifest is incomplete.');
      error.statusCode = 422;
      error.code = 'invalid_backup_manifest';
      throw error;
    }
  }
  return { backupDir, manifest };
}

function safeManifestTarget(backupDir, manifestPath) {
  const normalized = String(manifestPath || '').replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (!normalized || path.posix.isAbsolute(normalized) || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    return null;
  }
  const target = path.resolve(backupDir, ...segments);
  return target.startsWith(`${backupDir}${path.sep}`) ? target : null;
}

function verifyOperationalBackup(backupId) {
  const { backupDir, manifest } = readBackupManifest(backupId);
  const failures = [];
  const seenFiles = new Set();
  for (const entry of manifest.files) {
    const file = String(entry?.file || '');
    if (seenFiles.has(file)) {
      failures.push({ file, reason: 'duplicate_manifest_path' });
      continue;
    }
    seenFiles.add(file);
    const target = safeManifestTarget(backupDir, file);
    if (!target) {
      failures.push({ file, reason: 'unsafe_manifest_path' });
      continue;
    }
    if (!fs.existsSync(target)) {
      failures.push({ file, reason: 'missing_file' });
      continue;
    }
    const stats = fs.lstatSync(target);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      failures.push({ file, reason: 'unsafe_file_type' });
      continue;
    }
    const actualBytes = stats.size;
    const actualHash = sha256File(target);
    if (actualBytes !== Number(entry.bytes) || actualHash !== entry.sha256) {
      failures.push({ file, reason: 'checksum_mismatch' });
    }
  }
  return {
    backupId: manifest.backupId,
    createdAt: manifest.createdAt,
    databaseMode: manifest.databaseMode,
    valid: failures.length === 0,
    checkedFiles: manifest.files.length,
    failures,
    providerBackupRequired: manifest.databaseMode === 'postgres'
  };
}

function validateOperationalRestore(backupId) {
  const verification = verifyOperationalBackup(backupId);
  if (!verification.valid) return { ...verification, restorable: false, databaseVerification: null };

  const { backupDir, manifest } = readBackupManifest(backupId);
  const failures = [...verification.failures];
  if (manifest.format !== 'contractor-ai-backup-manifest/v2') {
    failures.push({ file: 'manifest.json', reason: 'legacy_manifest_not_restorable' });
  }
  if (manifest.databaseMode !== 'sqlite') {
    failures.push({ file: 'manifest.json', reason: 'provider_recovery_required' });
  }
  const databaseFile = String(manifest.database?.file || path.basename(ledgerFile));
  const databaseEntry = manifest.files.find(entry => entry.file === databaseFile);
  if (!databaseEntry || !safeManifestTarget(backupDir, databaseFile)) {
    failures.push({ file: databaseFile, reason: 'missing_restore_database' });
  }

  let databaseVerification = null;
  if (failures.length === 0) {
    try {
      databaseVerification = verifySqliteBackupDatabase(path.join(backupDir, databaseFile));
    } catch (error) {
      failures.push({ file: databaseFile, reason: 'sqlite_restore_validation_failed', message: error.message });
    }
  }
  return {
    ...verification,
    valid: failures.length === 0,
    restorable: failures.length === 0,
    failures,
    databaseVerification
  };
}

function writeTarString(header, offset, length, value) {
  const encoded = Buffer.from(String(value || ''), 'utf8');
  if (encoded.length > length) throw new Error(`Backup archive path field exceeds ${length} bytes.`);
  encoded.copy(header, offset);
}

function writeTarOctal(header, offset, length, value) {
  const octal = Math.max(0, Number(value) || 0).toString(8);
  if (octal.length > length - 1) throw new Error('Backup archive numeric field is too large.');
  writeTarString(header, offset, length, `${octal.padStart(length - 1, '0')}\0`);
}

function splitTarPath(archivePath) {
  const normalized = String(archivePath || '').replace(/\\/g, '/');
  if (Buffer.byteLength(normalized, 'utf8') <= 100) return { name: normalized, prefix: '' };
  for (let index = normalized.lastIndexOf('/'); index > 0; index = normalized.lastIndexOf('/', index - 1)) {
    const prefix = normalized.slice(0, index);
    const name = normalized.slice(index + 1);
    if (Buffer.byteLength(name, 'utf8') <= 100 && Buffer.byteLength(prefix, 'utf8') <= 155) {
      return { name, prefix };
    }
  }
  throw new Error(`Backup archive path is too long: ${normalized}`);
}

function createTarHeader(archivePath, stats) {
  const { name, prefix } = splitTarPath(archivePath);
  const header = Buffer.alloc(512, 0);
  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, 0o600);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, stats.size);
  writeTarOctal(header, 136, 12, Math.floor(stats.mtimeMs / 1000));
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  writeTarString(header, 257, 6, 'ustar\0');
  writeTarString(header, 263, 2, '00');
  writeTarString(header, 265, 32, 'contractor-ai');
  writeTarString(header, 297, 32, 'contractor-ai');
  writeTarString(header, 345, 155, prefix);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const encodedChecksum = `${checksum.toString(8).padStart(6, '0')}\0 `;
  writeTarString(header, 148, 8, encodedChecksum);
  return header;
}

async function* backupArchiveChunks(backupId, backupDir, manifest) {
  const root = backupId;
  const sources = [
    { file: 'manifest.json', target: path.join(backupDir, 'manifest.json') },
    ...manifest.files.map(entry => ({ file: String(entry.file), target: safeManifestTarget(backupDir, entry.file) }))
  ];
  const archivePaths = new Set();
  for (const source of sources) {
    if (!source.target) throw new Error(`Backup archive contains an unsafe path: ${source.file}`);
    const archivePath = path.posix.join(root, source.file.replace(/\\/g, '/'));
    if (archivePaths.has(archivePath)) throw new Error(`Backup archive contains a duplicate path: ${source.file}`);
    archivePaths.add(archivePath);
    const stats = fs.lstatSync(source.target);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`Backup archive refuses unsafe file type: ${source.file}`);
    yield createTarHeader(archivePath, stats);
    for await (const chunk of fs.createReadStream(source.target)) yield chunk;
    const padding = (512 - (stats.size % 512)) % 512;
    if (padding) yield Buffer.alloc(padding, 0);
  }
  yield Buffer.alloc(1024, 0);
}

function listOperationalBackups() {
  const backupRoot = path.join(dataDir, 'backups');
  if (!fs.existsSync(backupRoot)) return [];
  return fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      try {
        const { manifest } = readBackupManifest(entry.name);
        return {
          backupId: manifest.backupId,
          createdAt: manifest.createdAt,
          databaseMode: manifest.databaseMode,
          format: manifest.format,
          files: manifest.files.length,
          evidenceFiles: Number(manifest.evidence?.fileCount || 0),
          downloadAvailable: manifest.databaseMode === 'sqlite'
        };
      } catch {
        return { backupId: entry.name, createdAt: null, databaseMode: 'unknown', files: 0, manifestStatus: 'unreadable' };
      }
    })
    .sort((left, right) => String(right.backupId).localeCompare(String(left.backupId)));
}

function isQaRecord(record) {
  const text = [
    record?.id,
    record?.title,
    record?.name,
    record?.description,
    record?.summary,
    record?.reason,
    record?.role,
    record?.category,
    record?.company,
    record?.clientName,
    record?.client_name,
    record?.client?.name,
    record?.client?.company
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/\b(browser|qa|demo|sample)\b/.test(text)) return true;

  // These are the three historical local seed records. Match their full
  // identity rather than every legacy import so a controlled QA reset cannot
  // archive migrated customer work.
  const legacySeedSignatures = new Set([
    'legacy_job_1|bathroom renovation|maria van der berg',
    'legacy_job_2|gutter cleaning & inspection|jan de vries',
    'legacy_job_3|weekly lawn maintenance|sophie janssen'
  ]);
  const signature = [record?.id, record?.title, record?.clientName || record?.client_name]
    .map(value => String(value || '').trim().toLowerCase())
    .join('|');
  if (legacySeedSignatures.has(signature)) return true;

  const exactTestFixtureSignatures = new Set([
    'replay-safe field progress|field progress client|verify exact offline retries and transactional rollback.'
  ]);
  const fixtureSignature = [record?.title, record?.clientName || record?.client_name, record?.description]
    .map(value => String(value || '').trim().toLowerCase())
    .join('|');
  return exactTestFixtureSignatures.has(fixtureSignature);
}

app.get('/api/operations/export', (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="contractor-ai-operational-export.json"');
  res.setHeader('Cache-Control', 'no-store');
  return res.json(operationalExport());
});

app.post('/api/operations/exports/validate', (req, res) => {
  const result = validateOperationalExport(req.body?.snapshot || req.body);
  if (!result.valid) {
    return sendError(req, res, 422, result.code, 'The operational export failed integrity validation.', { problems: result.problems });
  }
  return res.json({
    success: true,
    ...result,
    nextStep: 'Use this export for human-readable reconciliation only. Use a verified backup package for local recovery.'
  });
});

app.post('/api/operations/backup', (req, res) => {
  try {
    return res.status(201).json({ success: true, backup: backupOperationalState() });
  } catch (error) {
    return sendError(req, res, error.statusCode || 500, error.code || 'backup_failed', error.statusCode ? error.message : 'Unable to create a local operational backup.', serializeError(error));
  }
});

app.get('/api/operations/backups', (req, res) => {
  try {
    assertLocalBackupMode();
    return res.json({ backups: listOperationalBackups() });
  } catch (error) {
    return sendError(req, res, error.statusCode || 500, error.code || 'backup_list_failed', error.statusCode ? error.message : 'Unable to list local operational backups.', serializeError(error));
  }
});

app.get('/api/operations/backups/:backupId/verify', (req, res) => {
  try {
    assertLocalBackupMode();
    const verification = verifyOperationalBackup(req.params.backupId);
    return res.status(verification.valid ? 200 : 409).json({ verification });
  } catch (error) {
    return sendError(req, res, error.statusCode || 500, error.code || 'backup_verification_failed', error.statusCode ? error.message : 'Unable to verify backup integrity.', serializeError(error));
  }
});

app.get('/api/operations/backups/:backupId/download', asyncHandler(async (req, res) => {
  if (operatingLedger.databaseMode !== 'sqlite') {
    return sendError(req, res, 409, 'provider_recovery_required', 'Hosted recovery uses the configured PostgreSQL backup policy and versioned object storage.');
  }
  try {
    const verification = verifyOperationalBackup(req.params.backupId);
    if (!verification.valid) {
      return res.status(409).json({
        error: {
          code: 'backup_integrity_failed',
          message: 'The backup package was not downloaded because integrity verification failed.',
          requestId: req.requestId
        },
        verification
      });
    }
    const { backupDir, manifest } = readBackupManifest(req.params.backupId);
    const manifestHash = sha256File(path.join(backupDir, 'manifest.json'));
    const filename = `contractor-ai-backup-${manifest.backupId}.tar.gz`;
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Contractor-AI-Manifest-SHA256', manifestHash);
    log('info', 'backup_package_download', {
      requestId: req.requestId,
      backupId: manifest.backupId,
      actor: actorFromRequest(req, 'local_owner'),
      files: verification.checkedFiles
    });
    await pipeline(
      Readable.from(backupArchiveChunks(manifest.backupId, backupDir, manifest)),
      zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED }),
      res
    );
  } catch (error) {
    if (res.headersSent) throw error;
    return sendError(req, res, error.statusCode || 500, error.code || 'backup_package_failed', error.statusCode ? error.message : 'Unable to create the verified backup package.', serializeError(error));
  }
}));

app.post('/api/operations/restore/validate', (req, res) => {
  if (req.body?.snapshot || req.body?.format) {
    return sendError(req, res, 422, 'operational_export_not_restorable', 'Operational exports are reconciliation artifacts and cannot be used as restore packages.', {
      exportValidationEndpoint: '/api/operations/exports/validate',
      requiredArtifact: 'contractor-ai-backup-manifest/v2'
    });
  }
  const backupId = String(req.body?.backupId || '').trim();
  if (!backupId) return sendError(req, res, 400, 'backup_id_required', 'Select a retained local backup package to validate for restore.');
  try {
    assertLocalBackupMode();
    const verification = validateOperationalRestore(backupId);
    return res.status(verification.valid ? 200 : 409).json({
      success: verification.valid,
      valid: verification.valid,
      artifactType: 'backup_package',
      restorable: verification.restorable,
      verification,
      nextStep: verification.valid
        ? `Stop the application, then run npm run restore:local -- --backup-id ${backupId} --confirm RESTORE_${backupId}.`
        : 'Do not restore this package. Create and verify a new local backup.'
    });
  } catch (error) {
    return sendError(req, res, error.statusCode || 500, error.code || 'restore_validation_failed', error.statusCode ? error.message : 'Unable to validate the local restore package.', serializeError(error));
  }
});

app.get('/api/operations/audit-integrity', (req, res) => {
  const integrity = operatingLedger.verifyAuditIntegrity();
  return res.status(integrity.valid ? 200 : 503).json({
    success: integrity.valid,
    integrity
  });
});

async function operationalReadiness() {
  const storageVerification = await verifyEvidenceStorage();
  const runtime = runtimeConfiguration({ storageVerification });
  const ledgerDiagnostics = getLedgerDiagnostics();
  const status = runtime.ready && ledgerDiagnostics.valid ? 'ready' : 'attention';
  return { status, runtime, ledgerDiagnostics, storageVerification };
}

app.get('/api/operations/capabilities', asyncHandler(async (req, res) => {
  const { status, runtime, ledgerDiagnostics, storageVerification } = await operationalReadiness();
  const localSQLite = runtime.mode === 'local' && runtime.databaseMode === 'sqlite';
  const hostedPostgres = runtime.mode === 'hosted' && runtime.databaseMode === 'postgres';
  const organization = operatingLedger.getOrganizationProfile();
  return res.json({
    status,
    localFirst: true,
    capabilities: {
      export: {
        available: true,
        format: OPERATIONAL_EXPORT_FORMAT,
        purpose: 'operator_reconciliation',
        restorable: false,
        integrity: 'sha256',
        validationEndpoint: '/api/operations/exports/validate'
      },
      backup: {
        available: localSQLite,
        databaseMode: runtime.databaseMode,
        manifestVerification: localSQLite,
        evidenceIncluded: localSQLite,
        portableDownload: localSQLite,
        packageFormat: localSQLite ? 'tar.gz' : null
      },
      restore: {
        available: localSQLite,
        validation: localSQLite ? 'retained_backup_id' : 'provider_managed',
        stoppedRuntimeRequired: localSQLite,
        providerRecoveryRequired: hostedPostgres
      },
      providerRecovery: {
        available: hostedPostgres,
        postgresBackupMode: runtime.hosting.recovery.postgresBackupMode,
        objectVersioningEnabled: runtime.hosting.recovery.objectVersioningEnabled,
        policyConfigured: runtime.hosting.recovery.policyConfigured,
        applicationPackageAvailable: localSQLite
      },
      hostedMigration: {
        available: localSQLite,
        source: localSQLite ? 'verified_backup_v2' : null,
        target: 'postgresql+s3',
        evidenceReadBackVerification: true,
        emptyTargetRequired: true,
        command: localSQLite ? 'npm run migrate:hosted' : null
      },
      persistence: {
        databaseMode: runtime.databaseMode,
        durable: runtime.mode === 'hosted' ? hostedPostgres : localSQLite,
        schemaInitialization: {
          serialized: true,
          mechanism: runtime.databaseMode === 'postgres' ? 'postgres_advisory_lock' : 'sqlite_write_transaction'
        }
      },
      haiConnector: {
        available: true,
        ...connectorManifest(),
        exportCommand: 'npm run export:hai'
      },
      preconstructionSiteSurvey: {
        available: true,
        template: 'versioned_standard_checklist',
        evidence: 'private_sha256_verified',
        measurementsRequired: true,
        approval: 'source_current',
        estimatingReadiness: 'derived_after_approval',
        convertedJobProvenance: true,
        externalCommitments: 0
      },
      commercialIssue: {
        available: organization.readiness.ready,
        organizationStatus: organization.readiness.status,
        missingFields: organization.readiness.missingFields,
        packageFormat: 'html',
        integrity: 'sha256',
        deliveryMode: 'approval_gated_draft',
        clientAcceptanceRequired: true,
        externalCommitments: 0
      },
      formalVariationControl: {
        available: true,
        framework: 'source_bound_numbered_revision_control',
        contractSource: 'accepted_quote_or_retained_legacy_baseline',
        entryReplay: 'durable_exact_fingerprint',
        clientDecisions: ['accepted', 'changes_requested', 'rejected'],
        clientChannel: 'token_scoped_portal_and_numbered_package',
        internalVerificationRequired: true,
        workAuthorization: 'verified_client_acceptance_only',
        externalCommitments: 0
      },
      crewCapacityPlanning: {
        available: true,
        horizonDays: 14,
        capacityBasis: 'explicit_worker_weekday_profiles',
        allocationBasis: 'day_level_approved_assignment_and_optional_task',
        availabilityConflicts: 'retained_absence_zero_capacity',
        overloadDetection: 'server_derived',
        taskCoverage: 'scheduled_duration_hours',
        planApproval: 'immutable_source_current_snapshot',
        autonomy: 'internal_review_task_only',
        crewNotifications: 0,
        clientCommitments: 0,
        supplierCommitments: 0,
        externalCommitments: 0
      },
      dailyOperatingCycles: {
        available: true,
        startHuddle: 'immutable_assignment_aware_snapshot',
        releaseStates: ['released', 'blocked'],
        endOfDay: 'atomic_field_report_time_and_safety_evidence',
        varianceRequiredWhenPlanMissed: true,
        approvalLinkedClose: true,
        exactReplay: true,
        autonomy: 'internal_review_task_only',
        workPermitCreated: false,
        complianceCertified: false,
        crewNotifications: 0,
        clientCommitments: 0,
        supplierCommitments: 0,
        externalCommitments: 0
      },
      lastPlannerLite: {
        available: true,
        period: 'monday_to_sunday',
        makeReadyConstraints: 'source_and_release_evidence_bound',
        weeklyPromises: 'task_date_crew_allocation_bound',
        planApproval: 'immutable_source_current_snapshot',
        actualEvidence: 'closed_daily_operating_cycle_required',
        measurement: ['percent_plan_complete', 'reasons_for_variance'],
        exactReplay: true,
        autonomy: 'internal_review_task_only',
        scheduleChanged: false,
        assignmentsCreated: 0,
        crewNotifications: 0,
        clientCommitments: 0,
        supplierCommitments: 0,
        externalCommitments: 0
      },
      fiveSOrganization: {
        available: true,
        locations: ['vehicle', 'trailer', 'depot', 'tool_store', 'site_storage', 'work_area', 'other'],
        standardStages: ['sort', 'set_in_order', 'shine', 'standardize', 'sustain'],
        standardApproval: 'immutable_source_current_snapshot',
        canonicalEquipmentChecks: true,
        failedChecks: 'corrective_action_required',
        resolutionEvidence: 'required',
        exactReplay: true,
        autonomy: 'internal_review_task_only',
        toolStatusChanged: false,
        custodyChanged: false,
        vehicleDispatched: false,
        supplierCommitments: 0,
        externalCommitments: 0
      },
      lastMinuteRiskAssessment: {
        available: true,
        timing: 'immediately_before_hazardous_work',
        workerEvidence: 'authenticated_worker_scoped',
        sourceBinding: ['active_pre_task_plan', 'worker_acknowledgement', 'linked_work_permit', 'assigned_task'],
        checks: ['task_understood', 'work_area_safe', 'controls_in_place', 'ppe_ready', 'equipment_ready', 'emergency_ready', 'no_changed_conditions'],
        validityMinutesMaximum: 240,
        offlineCapture: 'queued_evidence_does_not_authorize_until_server_source_check',
        stopWork: 'immediate_and_reassessment_required',
        exactReplay: true,
        autonomy: 'internal_review_task_only',
        assessmentInferred: false,
        authorizationInferred: false,
        scheduleChanged: false,
        supplierCommitments: 0,
        externalCommitments: 0
      },
      installationQualityControl: {
        available: true,
        stages: ['pre_installation', 'first_work', 'in_process', 'pre_concealment', 'testing', 'final_acceptance'],
        controlPoints: ['check', 'witness', 'hold'],
        sourceBinding: ['active_task', 'approved_assignment', 'assigned_worker', 'current_reference_basis', 'immutable_template'],
        workerEvidence: 'authenticated_assigned_worker_scoped',
        passEvidence: 'template_required_documents_measurements_and_witness_identity',
        correctiveClosure: 'independently_approved_before_corrected_release',
        taskCompletion: 'all_controls_source_current_passed_and_independently_released',
        offlineCapture: 'queued_evidence_does_not_release_hold_or_complete_task',
        exactReplay: true,
        autonomy: 'internal_review_task_only',
        releaseInferred: false,
        scheduleChanged: false,
        clientCommitments: 0,
        supplierCommitments: 0,
        externalCommitments: 0
      },
      auditIntegrity: {
        ...ledgerDiagnostics.auditIntegrity,
        verificationEndpoint: '/api/operations/audit-integrity',
        historyEndpoint: '/api/ledger/audit',
        historyAccess: 'owner_only',
        historyPagination: 'sequence_cursor',
        historyFilters: ['query', 'jobId', 'entityType', 'entityId', 'action', 'actor', 'from', 'until'],
        appendMode: 'atomic_hash_chain',
        tamperEvidence: ['modified_event', 'deleted_event', 'sequence_gap', 'stale_head']
      },
      requestSafety: {
        apiRateLimit: runtime.requestRateLimit,
        evidenceUploadIdempotency: 'durable',
        evidenceUploadLeaseOwnership: 'unique_claim_token',
        evidenceUploadReclaimSafe: true,
        progressEntryKey: 'durable',
        productionEntryKey: 'durable',
        productionEntryReversal: 'approval_gated_compensating_record',
        attendanceEntryKey: 'durable',
        attendanceAdjustment: 'approval_gated_compensating_record',
        weeklyTimesheetSnapshot: 'source_current_approval_gated',
        timesheetExportIntegrity: 'sha256',
        cashFlowEntryKey: 'durable',
        cashFlowAssumptionRetirement: 'retained_archive',
        cashFlowForecastSnapshot: 'source_current_approval_gated',
        performanceTargetRevision: 'approval_gated_versioned',
        performanceScorecardSnapshot: 'source_and_target_current_approval_gated',
        marketFitPolicyRevision: 'owner_requested_approval_gated_versioned',
        opportunityFitAssessment: 'source_bound_exact_replay',
        bidDecisionPolicyRevision: 'owner_requested_approval_gated_versioned',
        opportunityBidDecision: 'source_current_approval_gated_exact_replay',
        bidDecisionOverride: 'explicit_reason_and_separate_approval',
        siteSurveyPlanEntryKey: 'durable',
        siteSurveySubmissionEntryKey: 'durable',
        siteSurveyEvidenceIntegrity: 'private_sha256_readback_verified',
        siteSurveyApproval: 'source_current_approval_gated',
        siteSurveyEstimatingReadiness: 'derived_from_approved_snapshot',
        siteSurveyAutonomy: 'internal_review_task_only',
        takeoffWorkBreakdown: 'validated_wbs_codes_and_server_rollups',
        takeoffEstimateTrace: 'snapshot_and_work_breakdown_hash',
        estimateRatePolicyRevision: 'owner_requested_approval_gated_versioned',
        unitRateBuildUp: 'active_policy_source_bound_exact_replay',
        labourBurdenBasis: 'explicit_assumptions_and_productive_utilization',
        overheadRecoveryBasis: 'labor_hour_or_direct_cost_percent',
        unitRateCommercialEffect: 'draft_takeoff_only',
        commercialScopeRevision: 'source_current_approval_gated_versioned',
        commercialScopeEntryKey: 'durable_exact_replay',
        quoteCommercialScopeApproval: 'source_current_required',
        riskRegisterRevision: 'source_current_approval_gated_versioned',
        riskRegisterEntryKey: 'durable_exact_replay',
        riskRegisterPremortem: 'linked_failure_modes_required',
        riskRegisterScoring: 'server_derived_probability_impact_and_exposure',
        quoteRiskRegisterApproval: 'source_current_required',
        crewCapacityProfileRevision: 'versioned_explicit_weekday_hours',
        crewCapacityAllocationEntryKey: 'durable_exact_replay',
        crewLookaheadApproval: 'source_current_approval_gated',
        crewLookaheadAutonomy: 'internal_review_task_only',
        crewLookaheadCommitmentInference: false,
        lastPlannerConstraintEntryKey: 'durable_exact_replay',
        lastPlannerConstraintRelease: 'evidence_bound_exact_replay',
        lastPlannerWeeklyPlanApproval: 'source_current_approval_gated',
        lastPlannerOutcomeEvidence: 'closed_daily_cycle_and_sha256_snapshot',
        lastPlannerAutonomy: 'internal_review_task_only',
        lastPlannerCommitmentInference: false,
        fiveSLocationEntryKey: 'durable_exact_replay',
        fiveSStandardApproval: 'source_current_approval_gated',
        fiveSAuditEntryKey: 'durable_exact_replay',
        fiveSAuditToolState: 'canonical_status_inspection_location_checked',
        fiveSCorrectiveActionResolution: 'evidence_bound_exact_replay',
        fiveSAutonomy: 'internal_review_task_only',
        fiveSVehicleDispatch: false,
        formalVariationEntryKey: 'durable_exact_replay',
        formalVariationSnapshot: 'accepted_contract_source_sha256',
        formalVariationRevision: 'explicit_approved_supersession',
        formalVariationClientResponse: 'package_and_delivery_bound_internal_verification',
        formalVariationWorkAuthorization: 'accepted_status_only',
        pricingBasisDecision: 'versioned_source_bound_exact_replay',
        pricingBasisOverride: 'explicit_reason_retained',
        quotePricingBasisApproval: 'source_current_required',
        dailyLogEntryKey: 'durable',
        safetyBriefingEntryKey: 'durable',
        safetyBriefingAcknowledgement: 'worker_scoped_exact_replay',
        safetyBriefingSignoff: 'source_current_approval_gated',
        safetyBriefingAttendanceInference: false,
        workPermitEntryKey: 'durable',
        workPermitActivation: 'source_current_approval_gated',
        workPermitAcknowledgement: 'worker_scoped_exact_replay',
        workPermitSuspension: 'immediate_evidence_retained',
        workPermitClosure: 'evidence_retained',
        workPermitActivationInference: false,
        workPermitAcknowledgementInference: false,
        preTaskPlanEntryKey: 'durable',
        preTaskPlanRelease: 'source_current_approval_gated',
        preTaskPlanAcknowledgement: 'worker_scoped_exact_replay',
        preTaskPlanActivation: 'all_frozen_crew_acknowledged',
        preTaskPlanRevision: 'explicit_supersession',
        preTaskPlanSuspension: 'immediate_evidence_retained',
        preTaskPlanClosure: 'evidence_retained',
        preTaskPlanActivationInference: false,
        preTaskPlanAcknowledgementInference: false,
        lmraEntryKey: 'durable_exact_replay',
        lmraWorkerEvidence: 'authenticated_worker_scoped',
        lmraSourceValidation: 'server_current_at_receipt',
        lmraOfflineAuthorization: false,
        lmraValidity: 'time_bounded_and_latest_assessment_only',
        lmraStopWork: 'explicit_reassessment_required',
        lmraAutonomy: 'internal_review_task_only',
        lmraAuthorizationInference: false,
        installationQcEntryKey: 'durable_exact_replay',
        installationQcWorkerEvidence: 'authenticated_assigned_worker_scoped',
        installationQcSourceValidation: 'server_current_at_receipt_and_release',
        installationQcTaskCompletionGate: true,
        installationQcOfflineRelease: false,
        installationQcAutonomy: 'internal_review_task_only',
        installationQcReleaseInference: false,
        photoEvidenceEntryKey: 'durable_exact_replay',
        photoEvidenceWorkerCapture: 'authenticated_assigned_worker_scoped',
        photoEvidenceSequence: 'before_during_after_chronological',
        photoEvidenceIntegrity: 'private_document_sha256_and_immutable_snapshots',
        photoEvidenceTaskCompletionGate: true,
        photoEvidenceReview: 'source_current_independent_approval_gated',
        photoEvidenceOfflineRelease: false,
        photoEvidenceAutonomy: 'internal_review_task_only',
        photoEvidenceReleaseInference: false,
        clientFeedbackMetrics: ['nps', 'csat', 'customer_effort'],
        clientFeedbackIntegrity: 'immutable_snapshot_and_entry_fingerprint',
        clientFeedbackPortalScope: 'one_response_per_access_and_survey',
        clientFeedbackAutonomy: 'internal_service_recovery_only',
        clientFeedbackExternalReviewRequest: false,
        clientFeedbackReferralRequest: false,
        energyPerformanceEntryKey: 'durable_exact_replay',
        energyPerformanceEvidenceIntegrity: 'retained_pdf_sha256_and_immutable_snapshot',
        energyPerformanceApproval: 'source_current_independent_review',
        energyPerformancePermitContinuity: 'same_attested_software_version',
        energyPerformanceThresholds: 'operator_retained_server_compared',
        energyPerformanceCalculationEngine: false,
        energyPerformanceLegalCertification: false,
        energyPerformanceExternalRegistration: false,
        sdsRevisionEntryKey: 'durable',
        sdsRevisionSourceIntegrity: 'product_document_snapshot_sha256',
        sdsRevisionApproval: 'source_current_approval_gated',
        sdsRevisionSupersession: 'atomic_single_current_product',
        sdsRevisionAutonomy: 'internal_review_task_only',
        sdsCurrentStatusInference: false,
        drawingRevisionEntryKey: 'durable',
        drawingRevisionSourceIntegrity: 'sheet_document_snapshot_sha256',
        drawingRevisionApproval: 'source_current_approval_gated',
        drawingRevisionSupersession: 'atomic_single_current_sheet',
        drawingRevisionDistribution: 'approval_gated_transmittal_with_receipts',
        drawingRevisionAutonomy: 'internal_review_task_only',
        drawingPublicationInference: false,
        drawingDeliveryInference: false,
        dayworkEntryKey: 'durable',
        dayworkQuantitySnapshot: 'sha256_source_bound',
        dayworkApproval: 'source_current_approval_gated',
        dayworkAcknowledgement: 'receipt_only_separate_approval',
        dayworkCommercialConversion: 'source_bound_change_order_approval_gated',
        nonconformanceEntryKey: 'durable',
        nonconformanceSnapshot: 'sha256_source_bound',
        nonconformanceCorrectiveAction: 'source_current_approval_gated',
        nonconformanceClosure: 'independent_source_current_approval_gated',
        nonconformanceAutonomy: 'internal_review_task_only',
        materialReceiptEntryKey: 'durable',
        expenseReceiptEntryKey: 'durable',
        expenseReceiptDuplicateControl: 'vendor_reference_date_amount_currency',
        expenseReceiptApproval: 'source_current_approval_gated',
        expenseReceiptReversal: 'approval_gated_compensating_record',
        expenseReceiptVatBasis: 'retained_net_tax_total',
        environmentalActivityEntryKey: 'durable',
        environmentalFactorProvenance: 'operator_supplied_and_retained',
        environmentalActivityApproval: 'source_verified_approval_gated',
        environmentalActivityReversal: 'approval_gated_compensating_record',
        environmentalReportIntegrity: 'source_hash_snapshot_hash_csv_sha256',
        environmentalCertificationClaimed: false,
        taskLifecycle: 'retained',
        taskCompletionEvidenceRequired: true,
        fieldTaskScopeEnforced: true,
        fieldMutationAtomicity: true,
        equipmentRetirement: 'approval_gated',
        equipmentActiveReservationGate: true,
        equipmentDormantReservationRelease: 'retained_atomic',
        equipmentInspectionReadiness: 'derived_and_reservation_gated',
        equipmentInspectionEvidence: 'retained_internal_history',
        equipmentMaintenanceEvidence: 'retained_internal_history',
        equipmentReinspectionGate: true,
        equipmentDispatchReadiness: 'live_canonical_state',
        workforceDispatchReadiness: 'live_canonical_state',
        unavailableWorkerDispatchGate: true,
        assignmentScopedCrewEvidence: true,
        releasedAssignmentEvidenceInvalidation: true,
        workerInstructionPublication: 'approval_gated',
        browserOutboxScope: 'operator',
        replayRetentionHours: 24,
        payloadConflictRejected: true
      },
      evidenceStorage: {
        mode: runtime.storageMode,
        privateAccess: Boolean(evidenceStorage),
        status: storageVerification.status,
        verifiedAt: storageVerification.checkedAt,
        latencyMs: storageVerification.latencyMs ?? null,
        errorCode: storageVerification.code || null,
        initializationError: evidenceStorageInitError?.code || null
      },
      authentication: {
        required: runtime.auth.required,
        configuredRoles: runtime.auth.configuredRoles,
        loginRateLimit: runtime.auth.loginRateLimit
      },
      communications: {
        outboundDraftOnly: true,
        deliveryReceiptApprovalRequired: true,
        verifiedIntegrationCount: verifiedIntegrationIds.size
      },
      changeControl: {
        serverCalculatedTotals: true,
        durableNumbering: true,
        dayworkTicketNumbering: true,
        dayworkCommercialPricing: 'office_only_after_internal_approval',
        dayworkAcknowledgementChangesContractValue: false,
        immutableHtmlPackage: true,
        deliveryApprovalRequired: true,
        verifiedProviderReceiptRequired: true,
        acceptanceBoundToIssuedPackage: true,
        contractValueChange: 'verified_acceptance_only'
      },
      qualityControl: {
        nonconformanceRegister: true,
        fieldCapture: true,
        offlineExactReplay: true,
        requirementAndContainmentEvidence: true,
        correctiveActionApprovalRequired: true,
        independentClosureApprovalRequired: true,
        handoverBlockedWhileOpen: true,
        statutoryCertificationClaimed: false,
        externalCommitments: 0
      },
      costForecasting: {
        sourceLinked: true,
        costCodeBreakdown: true,
        actualSources: ['approved_weekly_timesheets', 'approved_expense_receipts', 'approved_supplier_invoices'],
        unreviewedSources: ['unapproved_time_logs', 'pending_or_legacy_expenses', 'pending_supplier_invoices'],
        unreviewedIncludedInEstimateAtCompletion: true,
        unreviewedRecognizedAsActual: false,
        financeHandoffRequiresReviewedEvidence: true,
        financeHandoffRequiresApprovedCostBasis: true,
        financeHandoffSourceCurrentApprovalRequired: true,
        commitmentSources: ['issued_purchase_orders', 'authorized_purchase_orders'],
        doubleCountControl: 'supplier_invoice_reduces_linked_order_commitment',
        historicalBackdatingSupported: false,
        mixedCurrencySnapshots: false,
        immutableSnapshots: true,
        approvalRequired: true,
        sourceCurrentApprovalRequired: true,
        externalCommitments: 0
      },
      cashFlowForecasting: {
        horizonWeeks: 13,
        sourceLinked: true,
        derivedSources: ['client_receivables', 'supplier_payables', 'approved_billing_milestones', 'unallocated_purchase_commitments'],
        manualAssumptions: 'replay_safe_retained',
        recurrence: ['once', 'weekly', 'monthly'],
        confidenceWeightedScenario: true,
        mixedCurrencySnapshots: false,
        immutableSnapshots: true,
        approvalRequired: true,
        sourceCurrentApprovalRequired: true,
        fundsMoved: false,
        externalCommitments: 0
      },
      performanceScorecard: {
        framework: 'contractor_balanced_scorecard',
        perspectives: ['safety', 'quality', 'delivery_reliability', 'customer_satisfaction', 'employee_capacity', 'financial_performance', 'commercial_pipeline', 'asset_productivity', 'compliance', 'sustainability'],
        metricCount: 23,
        customerExperienceEvidence: ['net_promoter_score', 'customer_satisfaction_pct', 'customer_effort_pct'],
        periodWeeks: { default: 13, minimum: 4, maximum: 52 },
        priorPeriodComparison: true,
        sourceHashScope: 'material_metric_inputs',
        pointInTimeMetrics: PERFORMANCE_SCORECARD_POINT_IN_TIME_METRICS,
        pointInTimeMetricCount: PERFORMANCE_SCORECARD_POINT_IN_TIME_METRICS.length,
        historicalPointInTime: 'retained_snapshots_only',
        missingEvidencePasses: false,
        targetRevisions: 'approval_gated_versioned',
        immutableSnapshots: true,
        sourceCurrentApprovalRequired: true,
        targetCurrentApprovalRequired: true,
        fundsMoved: false,
        messagesSent: false,
        externalCommitments: 0
      },
      marketFit: {
        framework: 'ideal_customer_profile_and_service_area_matrix',
        criteria: MARKET_FIT_CRITERIA,
        policyRevisions: 'owner_requested_approval_gated_versioned',
        assessmentMode: 'deterministic_source_bound_advisory',
        retainedAssessments: true,
        autonomousAssessment: 'internal_ledger_only',
        automaticRejection: false,
        messagesSent: false,
        jobsCreated: false,
        externalCommitments: 0
      },
      bidDecisions: {
        framework: 'weighted_bid_no_bid_scorecard',
        criteria: BID_DECISION_CRITERIA,
        gates: BID_DECISION_GATES,
        policyRevisions: 'owner_requested_approval_gated_versioned',
        assessmentMode: 'deterministic_source_bound_operator_evidence',
        marketFitIntegration: 'current_retained_assessment_required',
        decisionApproval: 'source_current_required',
        overrideControl: 'explicit_reason_and_separate_approval',
        autonomousReview: 'internal_task_only',
        opportunityStageMutation: false,
        automaticLeadClosure: false,
        messagesSent: false,
        jobsCreated: false,
        bidPackagesCreated: false,
        externalCommitments: 0
      },
      estimateRates: {
        framework: 'unit_rate_labour_burden_overhead_recovery',
        policyRevisions: 'owner_requested_approval_gated_versioned',
        labourClasses: 'policy_retained_not_worker_directory',
        burdenFormula: 'base_rate_times_one_plus_burden_divided_by_productive_utilization',
        overheadMethods: ['labor_hour', 'direct_cost_percent'],
        marginFormula: 'sell_rate_equals_cost_divided_by_one_minus_margin',
        buildUpIntegrity: 'retained_policy_hash_and_sha256',
        marginOverride: 'explicit_reason_retained',
        draftTakeoffMutationOnly: true,
        workerDirectoryRatesAffected: false,
        quotesIssued: false,
        externalCommitments: 0
      },
      commercialScope: {
        framework: 'written_scope_assumptions_exclusions_allowances',
        sections: ['scope_summary', 'inclusions', 'assumptions', 'exclusions', 'allowances', 'client_responsibilities'],
        allowanceTypes: ['selection_allowance', 'provisional_sum', 'unit_rate'],
        allowanceReconciliation: ['fixed_included', 'actual_cost_variation', 'remeasured_unit_rate'],
        sourceBinding: ['job', 'takeoff', 'approved_site_survey', 'current_drawings', 'approved_client_selections'],
        revisionHistory: 'immutable_approval_gated_supersession',
        quoteBinding: 'revision_snapshot_and_source_hash',
        quoteApproval: 'current_approved_scope_required',
        issuePackage: 'structured_scope_schedule_included',
        autonomousAuthoring: false,
        messagesSent: false,
        contractsCommitted: false,
        externalCommitments: 0
      },
      riskManagement: {
        framework: 'project_risk_register_and_premortem',
        categories: [...RISK_REGISTER_CATEGORIES],
        probabilityScale: [1, 2, 3, 4, 5],
        impactScale: [1, 2, 3, 4, 5],
        responseStrategies: [...RISK_RESPONSE_STRATEGIES],
        riskScores: 'server_derived_probability_times_impact',
        expectedMonetaryValue: 'server_derived_residual_probability_times_cost_exposure',
        highResidualRiskControl: 'explicit_acceptance_or_escalation_reason',
        premortemLinkage: 'every_failure_mode_links_to_retained_risk',
        sourceBinding: ['approved_commercial_scope', 'job', 'takeoff', 'approved_site_survey', 'current_drawings', 'approved_client_selections'],
        revisionHistory: 'immutable_approval_gated_supersession',
        pricingBinding: 'revision_snapshot_and_source_hash',
        quoteBinding: 'revision_snapshot_and_source_hash',
        autonomousAuthoring: false,
        observedFieldIncidentsSeparate: true,
        messagesSent: false,
        contractsCommitted: false,
        externalCommitments: 0
      },
      pricingBasis: {
        framework: 'fixed_price_versus_time_and_materials_decision_tree',
        factors: PRICING_BASIS_FACTORS,
        assessmentMode: 'deterministic_source_bound_operator_evidence',
        recommendationOutcomes: ['fixed_price', 'time_and_materials', 'review'],
        overrideControl: 'explicit_reason_retained',
        decisionHistory: 'immutable_versioned_supersession',
        quoteBinding: 'decision_snapshot_and_source_hash',
        quoteApproval: 'current_source_required',
        timeAndMaterialsEvidence: 'daywork_and_retained_field_evidence',
        autonomousSelection: false,
        messagesSent: false,
        contractsCommitted: false,
        externalCommitments: 0
      },
      productionControl: {
        immutableBaselines: true,
        baselineApprovalRequired: true,
        installedQuantityTracking: true,
        crewHoursTracking: true,
        earnedHoursCalculation: true,
        replaySafeFieldCapture: true,
        reversalMode: 'approval_gated_compensating_record',
        autonomousVarianceReview: 'internal_task_only',
        performanceThreshold: 0.8,
        externalCommitments: 0
      },
      attendanceControl: {
        assignmentScoped: true,
        approvedSiteAccessRequired: true,
        replaySafeFieldCapture: true,
        offlineRetentionHours: 48,
        liveLaborBoard: true,
        adjustmentMode: 'approval_gated_compensating_record',
        autonomousStaleSessionReview: 'internal_task_only',
        payrollDerived: false,
        geolocationCaptured: false,
        statutoryAttendanceRegister: false,
        externalCommitments: 0
      },
      timesheetControl: {
        weeklyPeriods: true,
        immutableVersions: true,
        sourceCurrentApprovalRequired: true,
        timeLogSource: 'retained_worker_submissions',
        attendanceUse: 'advisory_exception_signal_only',
        impossibleDailyHoursBlocked: true,
        completeSubmittedWorkerCoverageRequired: true,
        retainedSnapshotScalarReconciliation: true,
        checksumProtectedCsvHandoff: true,
        autonomousMissingWeekReview: 'internal_task_only',
        autonomousStaleApprovalReview: 'internal_task_only',
        tamperedHandoffReplayBlocked: true,
        payrollExecuted: false,
        providerDeliveryInitiated: false,
        externalCommitments: 0
      },
      invoicing: {
        serverCalculatedTotals: true,
        stagedBillingPlans: true,
        milestoneApprovalRequired: true,
        milestoneInvoiceLinkage: 'one_to_one',
        durableNumbering: true,
        immutableHtmlPackage: true,
        ubl21Export: true,
        peppolProfile: 'billing_3',
        structuredReadinessChecks: true,
        networkSubmission: false,
        deliveryReceiptApprovalRequired: true
      },
      purchasing: {
        durableNumbering: true,
        immutableHtmlPackage: true,
        ubl21OrderExport: true,
        peppolCertified: false,
        networkSubmission: false,
        deliveryApprovalRequired: true,
        verifiedProviderReceiptRequired: true,
        externalCommitmentClaim: 'verified_delivery_only'
      },
      materialReceiving: {
        replaySafeFieldCapture: true,
        normalizedReceiptLines: true,
        purchaseOrderLinkage: true,
        materialRequirementSynchronization: true,
        discrepancyRetention: true,
        reversalMode: 'approval_gated_compensating_record',
        supplierInvoiceMatch: 'retained_receipt_or_service_completion',
        autonomousExceptionReview: 'internal_task_only',
        externalCommitments: 0
      },
      equipmentCustody: {
        canonicalEquipmentRequired: true,
        retainedReservationRequired: true,
        replaySafeCheckoutAndReturn: true,
        exclusiveActiveCustody: true,
        workerAssignmentValidation: true,
        conditionAndMeterEvidence: true,
        damagedUnsafeLostQuarantine: true,
        autonomousOverdueAndExceptionReview: 'internal_task_only',
        externalCommitments: 0
      },
      automation: {
        ledgerOnly: true,
        schedulerEnabled: runtime.autonomousScheduler.enabled,
        intervalSeconds: runtime.autonomousScheduler.intervalSeconds,
        coordination: 'durable_compare_and_swap_lease',
        multiReplicaSafe: true,
        control: operatingLedger.getAutomationControl(),
        safetyStop: {
          ownerControlled: true,
          suspendEndpoint: '/api/operations/control/suspend',
          resumeEndpoint: '/api/operations/control/resume',
          blocks: ['manual_autonomous_cycle', 'durable_scheduler', 'command_plan_application']
        },
        externalCommitments: 0
      },
      support: {
        privacyMinimizedBundle: true,
        endpoint: '/api/operations/support-bundle',
        includesCustomerRecords: false,
        includesSecrets: false,
        includesLogs: false
      },
      retention: {
        policyConfigured: runtime.hosting.retentionPolicyConfigured,
        archiveMode: 'approval_gated_non_destructive',
        automatedDeletion: false,
        legalReviewRequired: true
      }
    },
    runtime,
    ledger: {
      valid: ledgerDiagnostics.valid,
      issueCount: ledgerDiagnostics.issueCount,
      migrations: ledgerDiagnostics.migrations,
      auditIntegrity: ledgerDiagnostics.auditIntegrity
    }
  });
}));

app.get('/api/operations/control', (req, res) => {
  return res.json({
    success: true,
    automation: operatingLedger.getAutomationControl(),
    scheduler: autonomousSchedulerStatus()
  });
});

app.post('/api/operations/control/suspend', (req, res) => {
  if (req.body?.confirmation !== 'SUSPEND_AUTOMATION') {
    return sendError(req, res, 400, 'confirmation_required', 'Set confirmation to SUSPEND_AUTOMATION before activating the autonomous-work safety stop.');
  }
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.setAutomationControl(
      { status: 'suspended', reason: req.body?.reason },
      { actor: actorFromRequest(req, 'owner_safety_stop') }
    ),
    scheduler: autonomousSchedulerStatus()
  }));
});

app.post('/api/operations/control/resume', (req, res) => {
  if (req.body?.confirmation !== 'RESUME_AUTOMATION') {
    return sendError(req, res, 400, 'confirmation_required', 'Set confirmation to RESUME_AUTOMATION before releasing the autonomous-work safety stop.');
  }
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.setAutomationControl(
      { status: 'active', reason: req.body?.reason },
      { actor: actorFromRequest(req, 'owner_safety_resume') }
    ),
    scheduler: autonomousSchedulerStatus()
  }));
});

app.get('/api/operations/support-bundle', asyncHandler(async (req, res) => {
  const { status, runtime, ledgerDiagnostics, storageVerification } = await operationalReadiness();
  const severityCounts = (ledgerDiagnostics.issues || []).reduce((counts, issue) => {
    const severity = ['error', 'warning', 'info'].includes(issue.severity) ? issue.severity : 'other';
    counts[severity] = (counts[severity] || 0) + 1;
    return counts;
  }, {});
  const bundle = {
    format: 'contractor-ai-support-bundle/v1',
    generatedAt: new Date().toISOString(),
    requestId: req.requestId,
    privacy: {
      customerRecordsIncluded: false,
      evidenceIncluded: false,
      logsIncluded: false,
      environmentValuesIncluded: false,
      credentialsIncluded: false,
      aggregateCountsIncluded: true
    },
    application: {
      name: packageMetadata.name,
      version: packageMetadata.version,
      releaseSha: releaseSha || null,
      node: process.version,
      platform: process.platform,
      uptimeSeconds: Math.round(process.uptime())
    },
    readiness: {
      status,
      runtimeReady: runtime.ready,
      issueCodes: runtime.issues.map(issue => issue.code),
      storage: {
        mode: storageVerification.mode || runtime.storageMode,
        status: storageVerification.status,
        checkedAt: storageVerification.checkedAt || null
      }
    },
    database: {
      mode: runtime.databaseMode,
      migrations: ledgerDiagnostics.migrations,
      aggregateCounts: ledgerDiagnostics.counts || {}
    },
    integrity: {
      ledgerValid: ledgerDiagnostics.valid,
      issueCount: ledgerDiagnostics.issueCount,
      issueSeverityCounts: severityCounts,
      auditValid: ledgerDiagnostics.auditIntegrity?.valid === true,
      auditEventCount: Number(ledgerDiagnostics.auditIntegrity?.eventCount || 0),
      auditFormat: ledgerDiagnostics.auditIntegrity?.format || null
    },
    control: {
      automation: operatingLedger.getAutomationControl(),
      scheduler: autonomousSchedulerStatus()
    },
    operatorNextSteps: [
      'Use requestId to correlate the failing API call with infrastructure logs.',
      'Run npm run doctor against the same runtime.',
      'Do not attach customer evidence, exported ledgers, credentials, or environment files to a support ticket.'
    ]
  };
  res.setHeader('Content-Disposition', `attachment; filename="contractor-ai-support-${Date.now()}.json"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.json(bundle);
}));

app.post('/api/operations/reset-qa', (req, res) => {
  if (req.body?.confirmation !== 'RESET_QA') {
    return sendError(req, res, 400, 'confirmation_required', 'Set confirmation to RESET_QA before archiving QA and demo records.');
  }
  try {
    const actor = req.body?.actor || 'operations_reset';
    const backup = backupOperationalState();
    const ledgerJobs = operatingLedger.listJobs({ includeArchived: true, limit: 500 })
      .filter(job => job.status !== 'archived' && isQaRecord(job));
    const qaOpportunities = operatingLedger.listOpportunities({ includeClosed: true, limit: 500 })
      .filter(opportunity => !['archived', 'won'].includes(opportunity.stage) && isQaRecord(opportunity));
    const qaWorkers = operatingLedger.listWorkers({ limit: 500 })
      .filter(worker => worker.status !== 'retired' && isQaRecord(worker));
    const qaTools = operatingLedger.listTools({ limit: 500 })
      .filter(tool => tool.status !== 'retired' && isQaRecord(tool));
    const qaJobIds = new Set(ledgerJobs.map(job => job.id));
    const qaApprovals = operatingLedger.listApprovals({ status: 'pending', limit: 500 })
      .filter(approval => qaJobIds.has(approval.jobId) || isQaRecord(approval));
    for (const approval of qaApprovals) {
      operatingLedger.resolveApproval(approval.id, {
        status: 'rejected',
        resolvedBy: actor,
        reason: 'QA/demo record archived by the controlled local reset.'
      }, { actor });
    }
    for (const job of ledgerJobs) {
      operatingLedger.updateJob(job.id, {
        status: 'archived',
        phase: 'archived',
        data: { qaResetAt: new Date().toISOString(), qaResetBy: actor }
      }, { actor });
    }
    for (const opportunity of qaOpportunities) {
      operatingLedger.updateOpportunity(opportunity.id, {
        stage: 'archived',
        data: { qaResetAt: new Date().toISOString(), qaResetBy: actor }
      }, { actor });
    }
    for (const worker of qaWorkers) {
      operatingLedger.retireWorker(worker.id, { actor });
    }
    for (const tool of qaTools) {
      operatingLedger.retireTool(tool.id, { actor });
    }
    return res.json({
      success: true,
      backup,
      archivedLedgerJobIds: ledgerJobs.map(job => job.id),
      archivedOpportunityIds: qaOpportunities.map(opportunity => opportunity.id),
      retiredWorkerIds: qaWorkers.map(worker => worker.id),
      retiredToolIds: qaTools.map(tool => tool.id),
      rejectedApprovalIds: qaApprovals.map(approval => approval.id),
      archivedCount: ledgerJobs.length + qaOpportunities.length + qaWorkers.length + qaTools.length,
      dashboard: operatingLedger.dashboardSummary()
    });
  } catch (error) {
    return sendError(req, res, error.statusCode || 500, error.code || 'qa_reset_failed', error.statusCode ? error.message : 'Unable to archive QA and demo records.', serializeError(error));
  }
});

app.get('/api/readiness', asyncHandler(async (req, res) => {
  const { status, runtime, ledgerDiagnostics } = await operationalReadiness();
  return res.status(status === 'ready' ? 200 : 503).json({
    status,
    runtime,
    ledger: {
      valid: ledgerDiagnostics.valid,
      issueCount: ledgerDiagnostics.issueCount,
      migrations: ledgerDiagnostics.migrations,
      auditIntegrity: ledgerDiagnostics.auditIntegrity
    },
    deployment: {
      localFirst: true,
      hostedRequirements: [
        'EU-region container host',
        'managed PostgreSQL via CONTRACTOR_AI_DATABASE_URL',
        'S3-compatible EU object storage',
        'HTTPS public origin and a strong auth token',
        'retained DPA, recovery-policy, and retention-policy references',
        'PostgreSQL backups and evidence object versioning'
      ]
    }
  });
}));

app.get('/api/health/ready', asyncHandler(async (req, res) => {
  const { status, runtime, ledgerDiagnostics, storageVerification } = await operationalReadiness();
  return res.status(status === 'ready' ? 200 : 503).json({
    status,
    requestId: req.requestId,
    checkedAt: new Date().toISOString(),
    checks: {
      configuration: runtime.ready ? 'ready' : 'attention',
      database: ledgerDiagnostics.valid ? 'ready' : 'attention',
      evidenceStorage: storageVerification.status
    }
  });
}));

// Health check
app.get('/api/health', (req, res) => {
  const ledgerDiagnostics = getLedgerDiagnostics();
  const runtime = runtimeConfiguration();
  res.json({
    status: ledgerDiagnostics.valid && runtime.ready ? 'healthy' : 'degraded',
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
    version: packageMetadata.version,
    uptimeSeconds: Math.round(process.uptime()),
    services: {
      ai: 'ledger_only',
      database: ledgerDiagnostics.valid ? 'operational' : 'attention',
      evidenceStorage: runtime.evidenceStorage.status,
      notifications: 'draft_only',
      ledger: ledgerDiagnostics.valid ? 'operational' : 'attention'
    },
    runtime,
    diagnostics: {
      issueCount: ledgerDiagnostics.issueCount,
      errorCount: ledgerDiagnostics.issues.filter(issue => issue.severity === 'error').length,
      warningCount: ledgerDiagnostics.issues.filter(issue => issue.severity === 'warning').length,
      ledgerIssueCount: ledgerDiagnostics.issueCount
    },
    migrations: ledgerDiagnostics.migrations
  });
});

app.use('/api', (req, res) => {
  return sendError(req, res, 404, 'not_found', 'API endpoint not found');
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, {
    index: false,
    fallthrough: true,
    setHeaders: (res, filePath) => {
      const relative = path.relative(distDir, filePath).replace(/\\/g, '/');
      if (/^assets\/.+-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(relative)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }));
}

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    return sendError(req, res, 503, 'web_client_not_built', 'Run npm run build before starting the production web client.');
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(path.join(distDir, 'index.html'));
});

app.use((error, req, res, next) => {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const invalidJson = error?.type === 'entity.parse.failed'
    || (error instanceof SyntaxError && statusCode === 400 && Object.prototype.hasOwnProperty.call(error, 'body'));
  const requestTooLarge = error?.type === 'entity.too.large' || statusCode === 413;
  const handledRequestError = invalidJson || requestTooLarge;
  log(handledRequestError ? 'warn' : 'error', handledRequestError ? 'request_body_rejected' : 'unhandled_request_error', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    code: invalidJson ? 'invalid_json' : requestTooLarge ? 'request_body_too_large' : 'internal_error',
    ...(handledRequestError ? {} : { error: serializeError(error) })
  });

  if (res.headersSent) {
    return next(error);
  }

  if (invalidJson) {
    return sendError(req, res, 400, 'invalid_json', 'Request body must contain valid JSON');
  }
  if (requestTooLarge) {
    return sendError(req, res, 413, 'request_body_too_large', 'Request body exceeds the configured size limit');
  }

  return sendError(req, res, 500, 'internal_error', 'Unexpected server error', serializeError(error));
});

async function startDirectServer(options = {}) {
  const storageVerification = await verifyEvidenceStorage({ force: true });
  const startupRuntime = runtimeConfiguration({ storageVerification });
  if (isProduction && !startupRuntime.ready) {
    log('error', 'production_runtime_not_ready', { issues: startupRuntime.issues.map(issue => issue.code) });
    await shutdownRuntime({ signal: 'startup_not_ready' });
    const error = new Error('Contractor.AI production runtime is not ready.');
    error.code = 'production_runtime_not_ready';
    throw error;
  }
  if (directServer?.listening) return directServer;
  const listenPort = options.port ?? port;
  const listenHost = String(options.host ?? configuredBindHost).trim() || undefined;
  directServer = configureHttpServer(app.listen({ port: listenPort, ...(listenHost ? { host: listenHost } : {}) }));
  await new Promise((resolve, reject) => {
    const onError = error => {
      directServer.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      directServer.off('error', onError);
      resolve();
    };
    directServer.once('error', onError);
    directServer.once('listening', onListening);
  });
  const address = directServer.address();
  const activePort = typeof address === 'object' && address ? address.port : listenPort;
  const dashboardOrigin = hostedPublicUrlDetails.valid
    ? hostedPublicUrlDetails.origin
    : `http://localhost:${activePort}`;
  log('info', 'server_started', {
      host: listenHost || 'system_default',
      port: activePort,
      dashboard: dashboardOrigin,
      health: `${dashboardOrigin}/api/health`,
      readiness: `${dashboardOrigin}/api/health/ready`
    });
  return directServer;
}

let directServer = null;
let shutdownPromise = null;

function closeHttpServer(server, timeoutMs = 10_000) {
  if (!server?.listening) return Promise.resolve({ drained: true, forced: false });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve(result);
    };
    const timeout = setTimeout(() => {
      server.closeAllConnections?.();
      finish(null, { drained: false, forced: true });
    }, timeoutMs);
    timeout.unref();
    server.close(error => finish(error, { drained: true, forced: false }));
    server.closeIdleConnections?.();
  });
}

function shutdownRuntime({ server = directServer, signal = 'shutdown', timeoutMs = 10_000 } = {}) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    const timersCleared = clearAutonomousSchedulerTimers();
    log('info', 'runtime_shutdown_started', { signal, timersCleared });
    const http = await closeHttpServer(server, timeoutMs);
    operatingLedger.close();
    log('info', 'runtime_shutdown_completed', { signal, timersCleared, http });
    return { signal, timersCleared, http };
  })().catch(error => {
    log('error', 'runtime_shutdown_failed', { signal, error: serializeError(error) });
    throw error;
  });
  return shutdownPromise;
}

app.locals.runtimeControl = Object.freeze({
  configureHttpServer,
  start: options => startDirectServer(options),
  shutdown: options => shutdownRuntime(options),
  schedulerTimerCount: () => autonomousSchedulerTimers.size,
  httpTimeouts: Object.freeze({
    keepAliveTimeoutMs: httpKeepAliveTimeoutMs,
    headersTimeoutMs: httpHeadersTimeoutMs
  })
});

function handleFatalRuntimeError(event, error) {
  log('error', event, { error: serializeError(error) });
  process.exitCode = 1;
  if (require.main !== module) return;
  shutdownRuntime({ signal: event })
    .catch(() => {})
    .finally(() => process.exit(1));
}

process.on('unhandledRejection', reason => handleFatalRuntimeError('unhandled_rejection', reason));
process.on('uncaughtException', error => handleFatalRuntimeError('uncaught_exception', error));

// Start server only when run directly. Serverless hosts import the app.
if (require.main === module) {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      shutdownRuntime({ signal })
        .then(() => { process.exitCode = 0; })
        .catch(() => { process.exitCode = 1; });
    });
  }
  startDirectServer().catch(error => {
    log('error', 'runtime_startup_failed', { error: serializeError(error) });
    shutdownRuntime({ signal: 'startup_failed' })
      .catch(() => {})
      .finally(() => { process.exitCode = 1; });
  });
}

module.exports = app;

