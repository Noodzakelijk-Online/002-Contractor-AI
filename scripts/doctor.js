const DEFAULT_TIMEOUT_MS = 8_000;

function parseArguments(args = process.argv.slice(2)) {
  const options = {
    baseUrl: process.env.CONTRACTOR_AI_DOCTOR_URL || `http://127.0.0.1:${process.env.PORT || 3000}`,
    token: process.env.CONTRACTOR_AI_DOCTOR_TOKEN || process.env.CONTRACTOR_AI_AUTH_TOKEN || '',
    timeoutMs: DEFAULT_TIMEOUT_MS
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--url') options.baseUrl = args[++index] || '';
    else if (value === '--token') options.token = args[++index] || '';
    else if (value === '--timeout-ms') options.timeoutMs = Number(args[++index] || DEFAULT_TIMEOUT_MS);
    else throw new Error(`Unsupported doctor option: ${value}`);
  }
  const parsed = new URL(options.baseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Doctor URL must use HTTP or HTTPS.');
  options.baseUrl = parsed.origin;
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 60_000) {
    throw new Error('Doctor timeout must be between 1,000 and 60,000 milliseconds.');
  }
  return options;
}

async function readJson(baseUrl, route, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function runDoctor(options = parseArguments()) {
  const [readiness, support] = await Promise.all([
    readJson(options.baseUrl, '/api/health/ready', options),
    readJson(options.baseUrl, '/api/operations/support-bundle', options)
  ]);
  const report = {
    checkedAt: new Date().toISOString(),
    target: options.baseUrl,
    ready: readiness.ok && support.ok && support.payload?.readiness?.runtimeReady === true,
    readiness: {
      httpStatus: readiness.status,
      status: readiness.payload?.status || readiness.payload?.error?.code || 'unavailable',
      checks: readiness.payload?.checks || null,
      requestId: readiness.payload?.requestId || null
    },
    support: support.ok ? {
      httpStatus: support.status,
      format: support.payload.format,
      application: support.payload.application,
      database: {
        mode: support.payload.database?.mode,
        currentMigration: support.payload.database?.migrations?.currentVersion,
        pendingMigrations: support.payload.database?.migrations?.pending?.length || 0
      },
      integrity: support.payload.integrity,
      automation: support.payload.control?.automation
    } : {
      httpStatus: support.status,
      status: support.payload?.error?.code || 'unavailable',
      requestId: support.payload?.error?.requestId || null
    }
  };
  return report;
}

if (require.main === module) {
  runDoctor()
    .then(report => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.ready ? 0 : 1;
    })
    .catch(error => {
      process.stderr.write(`${JSON.stringify({ ready: false, error: error.message }, null, 2)}\n`);
      process.exitCode = 1;
    });
}

module.exports = { parseArguments, readJson, runDoctor };
