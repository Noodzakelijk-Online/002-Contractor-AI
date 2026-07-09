const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { AutonomousContractorEngine } = require('./autonomous-engine');
const { ContractorOperatingLedger, LEDGER_CAPABILITY_BLUEPRINT, JOB_OPERATING_PLAYBOOKS } = require('./operating-ledger');
const { OpenMeteoWeatherService } = require('./weather-service');

const app = express();
const port = process.env.PORT || 3000;
const autonomousEngine = new AutonomousContractorEngine();
const weatherService = new OpenMeteoWeatherService({
  enabled: process.env.WEATHER_PROVIDER_ENABLED !== 'false'
});
const dataDir = path.join(__dirname, 'data');
const stateFile = process.env.STATE_FILE
  ? path.resolve(process.env.STATE_FILE)
  : path.join(dataDir, 'server-state.json');
const ledgerFile = process.env.LEDGER_DB_FILE
  ? path.resolve(process.env.LEDGER_DB_FILE)
  : path.join(dataDir, 'contractor-ledger.sqlite');
const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(dataDir, 'uploads');
const maxUploadBytes = Math.max(1024, Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024));
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const isProduction = process.env.NODE_ENV === 'production';
const dashboardAuthRequired = process.env.CONTRACTOR_AI_REQUIRE_AUTH === 'true'
  || (isProduction && process.env.CONTRACTOR_AI_REQUIRE_AUTH !== 'false');
const dashboardAuthToken = process.env.CONTRACTOR_AI_AUTH_TOKEN || process.env.DASHBOARD_AUTH_TOKEN || '';
const CONSTRUCTION_COLLECTIONS = [
  'projects',
  'tenders',
  'estimates',
  'budgets',
  'contracts',
  'changeOrders',
  'invoices',
  'rfis',
  'submittals',
  'drawings',
  'documents',
  'transmittals',
  'dailyLogs',
  'dayworkSheets',
  'collaboratorReports',
  'segmentedDailyReports',
  'schedules',
  'inspections',
  'observations',
  'incidents',
  'punchItems',
  'equipment',
  'timecards',
  'kioskSessions',
  'laborMap',
  'formsChecklists',
  'qualityReports',
  'resourcePlans',
  'trainingItems',
  'clientSelections',
  'clientMessages',
  'closeoutItems',
  'warrantyClaims',
  'productionReports',
  'permits',
  'safetyMeetings',
  'preTaskPlans',
  'jobCostEntries',
  'payrollRuns',
  'certifiedPayroll',
  'aiaBillings',
  'payments',
  'drawRequests',
  'drawInspections',
  'riskMitigations',
  'lienWaivers',
  'complianceItems',
  'purchaseOrders',
  'costDatabase',
  'serviceTickets',
  'workOrders',
  'opportunities',
  'dealPipelines',
  'omExtractions',
  'leadActivities',
  'takeoffs',
  'modelIssues',
  'specifications',
  'tasks',
  'photoRecords',
  'materials',
  'orientations',
  'jhas',
  'sdsSheets',
  'safetyPlans',
  'bulletins',
  'bookings',
  'siteAccessLogs',
  'directoryContacts',
  'integrationConnectors',
  'capitalRequests',
  'underwritingReviews',
  'portfolioReports',
  'euVatReturns',
  'peppolInvoices',
  'gdprRequests',
  'wkbDossiers',
  'vcaCertificates',
  'co2Reports'
];

const CONSTRUCTION_WORKFLOWS = [
  {
    key: 'preconstruction-pursuit',
    title: 'Preconstruction pursuit',
    source: 'Buildr + Autodesk + Sage',
    group: 'precon',
    detail: 'Qualifies a new opportunity, starts bid control, estimate review, takeoff validation, cost benchmark, resource plan and lead follow-up.',
    collections: ['opportunities', 'tenders', 'estimates', 'takeoffs', 'costDatabase', 'resourcePlans', 'leadActivities'],
    steps: ['Opportunity', 'Tender', 'Estimate', 'Takeoff', 'Resources', 'Follow-up']
  },
  {
    key: 'field-daily-close',
    title: 'Field daily close',
    source: 'Raken + Buildertrend',
    group: 'field',
    detail: 'Closes the field loop with a daily log, subcontractor report, production report, timecard, photo evidence, task and client portal update.',
    collections: ['dailyLogs', 'collaboratorReports', 'productionReports', 'timecards', 'photoRecords', 'tasks', 'clientMessages'],
    steps: ['Daily log', 'Crew report', 'Production', 'Timecard', 'Photo', 'Portal']
  },
  {
    key: 'site-coordination',
    title: 'Site coordination command',
    source: 'Procore + Contractor Foreman + HammerTech + Buildertrend',
    group: 'field',
    detail: 'Coordinates a field commitment with a schedule item, booking, work order, daywork sheet, task, bulletin and client portal update.',
    collections: ['schedules', 'bookings', 'workOrders', 'dayworkSheets', 'tasks', 'bulletins', 'clientMessages'],
    steps: ['Schedule', 'Booking', 'Work order', 'Daywork', 'Task', 'Bulletin', 'Portal']
  },
  {
    key: 'safety-mobilization',
    title: 'Safety mobilization',
    source: 'HammerTech + Raken',
    group: 'safety',
    detail: 'Creates the onboarding, orientation, pre-task plan, JHA, SDS, checklist, toolbox talk and site-access controls needed before work starts.',
    collections: ['orientations', 'preTaskPlans', 'jhas', 'sdsSheets', 'formsChecklists', 'safetyMeetings', 'siteAccessLogs'],
    steps: ['Orientation', 'Pre-task', 'JHA', 'SDS', 'Checklist', 'Access']
  },
  {
    key: 'payment-release',
    title: 'Payment release',
    source: 'Built + Sage + Contractor Foreman',
    group: 'finance',
    detail: 'Builds a payment pack with invoice, Peppol/UBL, payment hold, lien waiver, draw request, draw inspection and risk control.',
    collections: ['invoices', 'peppolInvoices', 'payments', 'lienWaivers', 'drawRequests', 'drawInspections', 'riskMitigations'],
    steps: ['Invoice', 'Peppol', 'Payment', 'Waiver', 'Draw', 'Risk']
  },
  {
    key: 'eu-handover',
    title: 'EU handover pack',
    source: 'Wkb + VCA + GDPR + CO2',
    group: 'handover',
    detail: 'Prepares client handover with Wkb dossier, closeout item, as-built document, CO2 report, GDPR check and client portal message.',
    collections: ['wkbDossiers', 'closeoutItems', 'documents', 'co2Reports', 'gdprRequests', 'clientMessages'],
    steps: ['Wkb', 'Closeout', 'As-built', 'CO2', 'GDPR', 'Client']
  }
];

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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

function storeUploadedFile(file) {
  fs.mkdirSync(uploadDir, { recursive: true });
  const extension = path.extname(file.originalName).slice(0, 20);
  const stem = path.basename(file.originalName, extension).slice(0, 80) || 'evidence';
  const storageName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${stem}${extension}`;
  const target = path.resolve(uploadDir, storageName);
  const root = path.resolve(uploadDir);
  if (!(target === root || target.startsWith(`${root}${path.sep}`))) {
    throw new UploadRequestError(400, 'invalid_upload_path', 'Upload path could not be resolved safely');
  }
  fs.writeFileSync(target, file.buffer);
  return {
    originalName: file.originalName,
    filename: storageName,
    mimeType: file.mimeType,
    size: file.size,
    storageRef: path.relative(__dirname, target).replace(/\\/g, '/')
  };
}

async function readUploadPayload(req) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return { payload: req.body || {}, storedFile: null };
  }

  const buffer = await readRequestBuffer(req, maxUploadBytes);
  const parsed = parseMultipartBody(buffer, contentType);
  const file = parsed.files.find(item => item.fieldName === 'evidenceFile') || parsed.files[0] || null;
  const storedFile = file ? storeUploadedFile(file) : null;
  const payload = {
    ...parsed.fields,
    ...(storedFile ? {
      filename: parsed.fields.filename || storedFile.originalName,
      name: parsed.fields.name || storedFile.originalName,
      fileType: parsed.fields.fileType || storedFile.mimeType,
      mimeType: storedFile.mimeType,
      size: storedFile.size,
      storageRef: storedFile.storageRef,
      uploadedFile: {
        originalName: storedFile.originalName,
        storedName: storedFile.filename,
        storageRef: storedFile.storageRef,
        mimeType: storedFile.mimeType,
        size: storedFile.size
      }
    } : {})
  };

  return { payload, storedFile };
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

function logSafeRequestPath(req) {
  return String(req.originalUrl || req.path || '')
    .replace(/(\/api\/client-portal\/)[^/?#]+/g, '$1[redacted]');
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

function safeEqualToken(candidate, expected) {
  const candidateBuffer = Buffer.from(String(candidate || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
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

function requireDashboardAuth(req, res, next) {
  const clientPortalRoute = /^\/api\/client-portal\/[^/]+(?:\/messages)?$/.test(req.path);
  if (!dashboardAuthRequired || req.method === 'OPTIONS' || req.path === '/api/health' || req.path === '/client-portal.html' || clientPortalRoute) {
    return next();
  }

  if (!dashboardAuthToken || dashboardAuthToken.length < 16) {
    return sendError(
      req,
      res,
      503,
      'auth_not_configured',
      'Contractor.AI is locked because dashboard/API auth is required but CONTRACTOR_AI_AUTH_TOKEN is missing or too short'
    );
  }

  const suppliedToken = extractAuthToken(req);
  if (suppliedToken && safeEqualToken(suppliedToken, dashboardAuthToken)) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Contractor.AI", charset="UTF-8"');
  return sendError(req, res, 401, 'authentication_required', 'Authentication is required for Contractor.AI dashboard and API access');
}

// Middleware
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  }
}));
app.use((req, res, next) => {
  const incomingRequestId = req.headers['x-request-id'];
  req.requestId = typeof incomingRequestId === 'string' && incomingRequestId.trim()
    ? incomingRequestId.trim().slice(0, 100)
    : createRequestId();
  res.setHeader('X-Request-Id', req.requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    if (!req.path.startsWith('/api')) {
      return;
    }

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
});
app.use(requireDashboardAuth);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function loadState() {
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : null,
      workers: Array.isArray(parsed.workers) ? parsed.workers : null,
      tools: Array.isArray(parsed.tools) ? parsed.tools : null,
      construction: parsed.construction && typeof parsed.construction === 'object'
        ? parsed.construction
        : null
    };
  } catch {
    return { jobs: null, workers: null, tools: null, construction: null };
  }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ jobs, workers, tools, construction }, null, 2));
  } catch (error) {
    log('warn', 'state_persistence_unavailable', { error: serializeError(error) });
  }
}

function currentState() {
  return { jobs, workers, tools, construction };
}

function findJob(jobId) {
  return jobs.find(job => String(job.id) === String(jobId));
}

function findWorker(workerId) {
  return workers.find(worker => String(worker.id) === String(workerId));
}

function releaseJobResources(job) {
  return autonomousEngine.releaseJobResources(job, currentState());
}

function normalizeDateStart(value) {
  if (!value) return null;
  const raw = String(value);
  const parsed = new Date(raw.length === 10 ? `${raw}T09:00:00` : raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function reservePlannedTools(job) {
  const normalizedJob = autonomousEngine.normalizeJob(job);
  const toolPlan = autonomousEngine.planTools(normalizedJob, tools);
  for (const plannedTool of toolPlan.reserved) {
    const tool = tools.find(item => String(item.id) === String(plannedTool.id));
    if (!tool) continue;
    tool.status = job.status === 'in_progress' ? 'in_use' : 'reserved';
    tool.assignedJobId = job.id;
    tool.assignedWorkerId = job.assignedWorkerId || null;
    tool.currentLocation = job.address || job.location || 'Reserved for job';
  }
  return toolPlan;
}

function validateState() {
  const issues = [];
  const checkDuplicateIds = (collectionName, collection) => {
    const seen = new Set();
    collection.forEach((item, index) => {
      if (item.id === undefined || item.id === null || item.id === '') {
        issues.push({
          severity: 'error',
          collection: collectionName,
          index,
          message: 'Record is missing an id'
        });
        return;
      }

      const id = String(item.id);
      if (seen.has(id)) {
        issues.push({
          severity: 'error',
          collection: collectionName,
          id: item.id,
          message: 'Duplicate id detected'
        });
      }
      seen.add(id);
    });
  };

  checkDuplicateIds('jobs', jobs);
  checkDuplicateIds('workers', workers);
  checkDuplicateIds('tools', tools);

  const workerNames = new Set(workers.map(worker => worker.name).filter(Boolean));
  const workerIds = new Set(workers.map(worker => String(worker.id)));
  const jobTitles = new Set(jobs.map(job => job.title).filter(Boolean));
  const jobIds = new Set(jobs.map(job => String(job.id)));

  jobs.forEach(job => {
    const status = job.status || 'unknown';
    const progress = Number(job.progress ?? job.progress_percentage ?? 0);

    if (Number.isFinite(progress) && (progress < 0 || progress > 100)) {
      issues.push({
        severity: 'warning',
        collection: 'jobs',
        id: job.id,
        message: 'Job progress is outside the expected 0-100 range'
      });
    }

    if (job.worker && !workerNames.has(job.worker)) {
      issues.push({
        severity: 'error',
        collection: 'jobs',
        id: job.id,
        message: `Assigned worker "${job.worker}" does not exist`
      });
    }

    if (job.assignedWorkerId && !workerIds.has(String(job.assignedWorkerId))) {
      issues.push({
        severity: 'error',
        collection: 'jobs',
        id: job.id,
        message: `Assigned worker id "${job.assignedWorkerId}" does not exist`
      });
    }

    if (['scheduled', 'in_progress'].includes(status) && !job.worker && !job.assigned_worker_id) {
      issues.push({
        severity: 'warning',
        collection: 'jobs',
        id: job.id,
        message: 'Active job has no assigned worker'
      });
    }

    if (status === 'completed' && Number.isFinite(progress) && progress < 100) {
      issues.push({
        severity: 'warning',
        collection: 'jobs',
        id: job.id,
        message: 'Completed job has progress below 100'
      });
    }
  });

  workers.forEach(worker => {
    if (worker.currentJob && !jobTitles.has(worker.currentJob)) {
      issues.push({
        severity: 'warning',
        collection: 'workers',
        id: worker.id,
        message: `Worker currentJob "${worker.currentJob}" does not match an existing job`
      });
    }

    if (worker.currentJobId && !jobIds.has(String(worker.currentJobId))) {
      issues.push({
        severity: 'warning',
        collection: 'workers',
        id: worker.id,
        message: `Worker currentJobId "${worker.currentJobId}" does not match an existing job`
      });
    }

    if (['active', 'busy', 'traveling'].includes(worker.status) && !worker.currentJob && worker.status !== 'traveling') {
      issues.push({
        severity: 'warning',
        collection: 'workers',
        id: worker.id,
        message: 'Busy worker has no current job reference'
      });
    }
  });

  tools.forEach(tool => {
    if (['in_use', 'reserved'].includes(tool.status) && !tool.currentLocation && !tool.current_location) {
      issues.push({
        severity: 'warning',
        collection: 'tools',
        id: tool.id,
        message: 'Reserved or in-use tool has no current location'
      });
    }

    if (tool.assignedJobId && !jobIds.has(String(tool.assignedJobId))) {
      issues.push({
        severity: 'error',
        collection: 'tools',
        id: tool.id,
        message: `Tool assignedJobId "${tool.assignedJobId}" does not match an existing job`
      });
    }

    if (tool.assignedWorkerId && !workerIds.has(String(tool.assignedWorkerId))) {
      issues.push({
        severity: 'warning',
        collection: 'tools',
        id: tool.id,
        message: `Tool assignedWorkerId "${tool.assignedWorkerId}" does not match an existing worker`
      });
    }
  });

  return {
    valid: !issues.some(issue => issue.severity === 'error'),
    issueCount: issues.length,
    issues
  };
}

// Contractor configuration
const CONTRACTOR_CONFIG = {
  email: 'noodzakelijkonline@gmail.com',
  phone: '+31068351517',
  company: 'Contractor AI Solutions',
  services: ['Garden Maintenance', 'General House Services', 'Renovations']
};

function relativeDate(days, hour = 9) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

// Coherent starter data for a fresh local install.
let jobs = [
  {
    id: 1,
    title: 'Bathroom Renovation',
    client: 'Maria van der Berg',
    address: 'Hoofdstraat 123, Amsterdam',
    status: 'in_progress',
    priority: 'critical',
    worker: 'Anna Kowalski',
    assignedWorkerId: 1,
    estimatedCost: 1512,
    actualCost: 1200,
    progress: 65,
    startDate: relativeDate(-1, 8),
    scheduledStart: relativeDate(-1, 8),
    actualStart: relativeDate(-1, 8),
    estimatedCompletion: relativeDate(1, 16),
    tools: ['Tile saw', 'Plumbing tools', 'Safety equipment'],
    description: 'Complete bathroom renovation including tiles, plumbing, and fixtures'
  },
  {
    id: 2,
    title: 'Gutter Cleaning & Inspection',
    client: 'Jan de Vries',
    address: 'Kerkstraat 45, Utrecht',
    status: 'scheduled',
    priority: 'high',
    worker: 'Marco Silva',
    assignedWorkerId: 2,
    estimatedCost: 90,
    actualCost: 0,
    progress: 0,
    startDate: relativeDate(1, 10),
    scheduledStart: relativeDate(1, 10),
    estimatedCompletion: relativeDate(1, 13),
    tools: ['Ladder', 'Pressure washer', 'Safety harness'],
    description: 'Clean gutters and inspect for damage or blockages'
  },
  {
    id: 3,
    title: 'Weekly Lawn Maintenance',
    client: 'Sophie Janssen',
    address: 'Parkweg 78, Rotterdam',
    status: 'completed',
    priority: 'medium',
    worker: 'Lisa Chen',
    assignedWorkerId: 3,
    estimatedCost: 45,
    actualCost: 45,
    progress: 100,
    startDate: relativeDate(-1, 9),
    actualStart: relativeDate(-1, 9),
    actualEnd: relativeDate(-1, 11),
    estimatedCompletion: relativeDate(-1, 11),
    tools: ['Lawn mower', 'Trimmer', 'Rake'],
    description: 'Regular lawn mowing and garden maintenance'
  }
];

let workers = [
  {
    id: 1,
    name: 'Anna Kowalski',
    specialty: 'Bathroom Specialist',
    status: 'active',
    location: 'Amsterdam',
    rating: 4.9,
    completedJobs: 127,
    currentJob: 'Bathroom Renovation',
    currentJobId: 1
  },
  {
    id: 2,
    name: 'Marco Silva',
    specialty: 'Gutter Specialist',
    status: 'busy',
    location: 'Utrecht',
    rating: 4.7,
    completedJobs: 89,
    currentJob: 'Gutter Cleaning & Inspection',
    currentJobId: 2
  },
  {
    id: 3,
    name: 'Lisa Chen',
    specialty: 'Garden Maintenance',
    status: 'available',
    location: 'Rotterdam',
    rating: 4.8,
    completedJobs: 156,
    currentJob: null
  }
];

let tools = [
  { id: 1, name: 'Tile Saw', category: 'power_tools', status: 'in_use', currentLocation: 'Amsterdam job site', assignedJobId: 1, assignedWorkerId: 1 },
  { id: 2, name: 'Pressure Washer', category: 'cleaning', status: 'reserved', currentLocation: 'Utrecht depot', assignedJobId: 2, assignedWorkerId: 2, returnDate: relativeDate(1, 14) },
  { id: 3, name: 'Extension Ladder', category: 'access', status: 'reserved', currentLocation: 'Van #2', assignedJobId: 2, assignedWorkerId: 2 },
  { id: 4, name: 'Plumbing Kit', category: 'hand_tools', status: 'in_use', currentLocation: 'Amsterdam job site', assignedJobId: 1, assignedWorkerId: 1 }
];

function createDefaultConstructionState() {
  return {
    projects: [
      {
        id: 1,
        name: 'Canal House Retrofit',
        number: 'PRJ-1001',
        client: 'Van Dijk Properties',
        status: 'active',
        phase: 'Execution',
        location: 'Amsterdam',
        budget: 185000,
        committedCost: 118500,
        forecastAtCompletion: 179250,
        progress: 58,
        startDate: relativeDate(-18, 8).slice(0, 10),
        dueDate: relativeDate(24, 17).slice(0, 10),
        manager: 'Anna Kowalski',
        riskLevel: 'medium'
      },
      {
        id: 2,
        name: 'Retail Fit-Out Utrecht',
        number: 'PRJ-1002',
        client: 'Northline Retail',
        status: 'preconstruction',
        phase: 'Tendering',
        location: 'Utrecht',
        budget: 94000,
        committedCost: 24000,
        forecastAtCompletion: 91000,
        progress: 18,
        startDate: relativeDate(12, 8).slice(0, 10),
        dueDate: relativeDate(55, 17).slice(0, 10),
        manager: 'Marco Silva',
        riskLevel: 'low'
      }
    ],
    tenders: [
      { id: 1, projectId: 2, package: 'Interior Carpentry', status: 'open', dueDate: relativeDate(5, 17), coverage: 4, bidders: ['OakWorks', 'Noord Build', 'Studio Hout'], estimateValue: 18500 },
      { id: 2, projectId: 2, package: 'Electrical Rough-In', status: 'draft', dueDate: relativeDate(8, 17), coverage: 2, bidders: ['Volt Partners'], estimateValue: 21200 }
    ],
    estimates: [
      { id: 1, projectId: 2, name: 'Retail Fit-Out baseline estimate', status: 'approved', value: 94000, marginPercent: 18, alternates: ['LED upgrade', 'After-hours install'] }
    ],
    budgets: [
      { id: 1, projectId: 1, costCode: '01-100', description: 'General Conditions', budget: 22000, committed: 14200, actual: 11950, forecast: 21900 },
      { id: 2, projectId: 1, costCode: '06-200', description: 'Carpentry', budget: 42000, committed: 31800, actual: 26750, forecast: 43800 },
      { id: 3, projectId: 1, costCode: '22-100', description: 'Plumbing', budget: 36000, committed: 22100, actual: 20100, forecast: 35400 }
    ],
    contracts: [
      { id: 1, projectId: 1, vendor: 'Noord Build', type: 'subcontract', status: 'executed', value: 31800, paidToDate: 14200 },
      { id: 2, projectId: 1, vendor: 'Flow Plumbing', type: 'subcontract', status: 'executed', value: 22100, paidToDate: 8700 }
    ],
    changeOrders: [
      { id: 1, projectId: 1, title: 'Hidden joist repair', status: 'pending_client', value: 4200, costImpact: 2850, scheduleImpactDays: 2 }
    ],
    invoices: [
      { id: 1, projectId: 1, vendor: 'Noord Build', status: 'pending_review', amount: 6400, period: 'June 2026', dueDate: relativeDate(3, 17) },
      { id: 2, projectId: 1, vendor: 'Flow Plumbing', status: 'approved', amount: 3100, period: 'June 2026', dueDate: relativeDate(7, 17) }
    ],
    rfis: [
      { id: 1, projectId: 1, subject: 'Confirm fire-stopping detail at riser', status: 'open', assignee: 'Design Team', dueDate: relativeDate(2, 17), priority: 'high' },
      { id: 2, projectId: 1, subject: 'Clarify cabinet hardware finish', status: 'answered', assignee: 'Client', dueDate: relativeDate(-1, 17), priority: 'medium' }
    ],
    submittals: [
      { id: 1, projectId: 1, title: 'Bathroom tile data sheet', status: 'approved', dueDate: relativeDate(-5, 17), responsible: 'Anna Kowalski' },
      { id: 2, projectId: 1, title: 'MEP valve package', status: 'revise_resubmit', dueDate: relativeDate(1, 17), responsible: 'Flow Plumbing' }
    ],
    drawings: [
      { id: 1, projectId: 1, number: 'A-201', title: 'Level 2 Finish Plan', revision: 'C', status: 'current', uploadedAt: relativeDate(-2, 10) },
      { id: 2, projectId: 1, number: 'M-101', title: 'Mechanical Layout', revision: 'B', status: 'superseded', uploadedAt: relativeDate(-12, 10) }
    ],
    documents: [
      { id: 1, projectId: 1, title: 'Site logistics plan', type: 'plan', status: 'current', owner: 'Project Team' },
      { id: 2, projectId: 1, title: 'Client finish approvals', type: 'approval_log', status: 'needs_update', owner: 'Client' }
    ],
    transmittals: [
      { id: 1, projectId: 1, title: 'Issued for construction drawing set', status: 'sent', recipient: 'Noord Build', sentAt: relativeDate(-2, 11), documentCount: 8 },
      { id: 2, projectId: 2, title: 'Tender addendum package', status: 'draft', recipient: 'Bidder list', dueDate: relativeDate(1, 12), documentCount: 4 }
    ],
    dailyLogs: [
      { id: 1, projectId: 1, date: relativeDate(0, 8).slice(0, 10), weather: 'Light rain', manpower: 6, notes: 'Interior work continued. Delivery held for morning inspection.' }
    ],
    dayworkSheets: [
      { id: 1, projectId: 1, title: 'Out-of-scope riser fire-stopping', status: 'submitted', crew: 'Flow Plumbing', hours: 5.5, amount: 920, dueDate: relativeDate(1, 17), description: 'Documented daywork for owner approval and change control.' }
    ],
    collaboratorReports: [
      { id: 1, projectId: 1, title: 'Subcontractor daily report - plumbing', company: 'Flow Plumbing', status: 'pending_review', manpower: 2, submittedAt: relativeDate(0, 15) }
    ],
    segmentedDailyReports: [
      { id: 1, projectId: 1, title: 'Occupied building access segment', segment: 'Level 2 residents', status: 'draft', blockers: 1, dueDate: relativeDate(1, 10) }
    ],
    schedules: [
      { id: 1, projectId: 1, title: 'Bathroom finishes lookahead', status: 'active', startAt: relativeDate(0, 8), endAt: relativeDate(5, 17), owner: 'Anna Kowalski', percentComplete: 58 },
      { id: 2, projectId: 2, title: 'Tender milestone plan', status: 'draft', startAt: relativeDate(1, 8), endAt: relativeDate(18, 17), owner: 'Marco Silva', percentComplete: 15 }
    ],
    inspections: [
      { id: 1, projectId: 1, title: 'Tile substrate inspection', status: 'passed', inspector: 'Anna Kowalski', dueDate: relativeDate(-2, 15) },
      { id: 2, projectId: 1, title: 'Temporary works safety check', status: 'scheduled', inspector: 'Marco Silva', dueDate: relativeDate(1, 9) }
    ],
    observations: [
      { id: 1, projectId: 1, title: 'Materials stored in access path', status: 'open', assignee: 'Site Team', priority: 'medium', dueDate: relativeDate(1, 12) }
    ],
    incidents: [
      { id: 1, projectId: 1, title: 'Near miss - blocked stair landing', severity: 'low', status: 'closed', date: relativeDate(-4, 14).slice(0, 10) }
    ],
    punchItems: [
      { id: 1, projectId: 1, title: 'Touch up door casing paint', status: 'open', assignee: 'Noord Build', dueDate: relativeDate(6, 17) }
    ],
    equipment: [
      { id: 1, name: 'Mini Excavator', status: 'available', location: 'Depot', assignedProjectId: null, nextInspection: relativeDate(12, 9) },
      { id: 2, name: 'Material Hoist', status: 'assigned', location: 'Canal House Retrofit', assignedProjectId: 1, nextInspection: relativeDate(4, 9) }
    ],
    timecards: [
      { id: 1, projectId: 1, worker: 'Anna Kowalski', date: relativeDate(0, 8).slice(0, 10), hours: 7.5, costCode: '09-300', status: 'submitted' },
      { id: 2, projectId: 1, worker: 'Marco Silva', date: relativeDate(0, 8).slice(0, 10), hours: 6.0, costCode: '01-100', status: 'approved' }
    ],
    kioskSessions: [
      { id: 1, projectId: 1, title: 'Lobby kiosk check-in', location: 'Canal House Retrofit', status: 'open', workersCheckedIn: 6, verificationRequired: true }
    ],
    laborMap: [
      { id: 1, projectId: 1, title: 'VCA-certified labor coverage', region: 'Amsterdam', status: 'needs_review', certifiedWorkers: 5, gapCount: 1 }
    ],
    formsChecklists: [
      { id: 1, projectId: 1, title: 'Daily quality checklist', status: 'in_progress', category: 'quality', owner: 'Site Team', dueDate: relativeDate(0, 16), completionPercent: 72 },
      { id: 2, projectId: 1, title: 'Hot works pre-task checklist', status: 'open', category: 'safety', owner: 'Flow Plumbing', dueDate: relativeDate(1, 8), completionPercent: 25 }
    ],
    qualityReports: [
      { id: 1, projectId: 1, title: 'Tile substrate QA report', status: 'open', inspector: 'Anna Kowalski', defectsOpen: 2, dueDate: relativeDate(1, 16) }
    ],
    resourcePlans: [
      { id: 1, projectId: 1, role: 'Finish Carpenter', neededFrom: relativeDate(3, 8).slice(0, 10), neededTo: relativeDate(12, 17).slice(0, 10), quantity: 2, status: 'partially_filled' },
      { id: 2, projectId: 2, role: 'Electrician', neededFrom: relativeDate(14, 8).slice(0, 10), neededTo: relativeDate(25, 17).slice(0, 10), quantity: 1, status: 'unfilled' }
    ],
    trainingItems: [
      { id: 1, title: 'SOP: Daily site diary closeout', category: 'field_operations', status: 'published', assignedTo: 'All site leads' },
      { id: 2, title: 'Toolbox talk: Working around public access', category: 'safety', status: 'draft', assignedTo: 'Site Team' }
    ],
    clientSelections: [
      { id: 1, projectId: 1, title: 'Bathroom wall tile selection', status: 'approved', category: 'finishes', dueDate: relativeDate(-4, 17), client: 'Van Dijk Properties', value: 4200 },
      { id: 2, projectId: 2, title: 'Retail lighting fixture package', status: 'pending_client', category: 'lighting', dueDate: relativeDate(2, 17), client: 'Northline Retail', value: 6800 }
    ],
    clientMessages: [
      { id: 1, projectId: 1, subject: 'Weekly owner update', status: 'sent', channel: 'portal', recipient: 'Van Dijk Properties', sentAt: relativeDate(-1, 16), sentiment: 'positive' },
      { id: 2, projectId: 2, subject: 'Selection reminder', status: 'draft', channel: 'portal', recipient: 'Northline Retail', dueDate: relativeDate(1, 12), sentiment: 'neutral' }
    ],
    closeoutItems: [
      { id: 1, projectId: 1, title: 'O&M manual - plumbing fixtures', status: 'open', assignee: 'Flow Plumbing', dueDate: relativeDate(12, 17), category: 'owner_handover' },
      { id: 2, projectId: 1, title: 'As-built drawing package', status: 'pending_review', assignee: 'Project Team', dueDate: relativeDate(18, 17), category: 'as_builts' }
    ],
    warrantyClaims: [
      { id: 1, projectId: 1, title: 'Cabinet hinge adjustment', status: 'triage', assignee: 'Noord Build', dueDate: relativeDate(9, 17), client: 'Van Dijk Properties' }
    ],
    productionReports: [
      { id: 1, projectId: 1, costCode: '09-300', activity: 'Tile install', status: 'submitted', date: relativeDate(0, 8).slice(0, 10), plannedUnits: 42, actualUnits: 34, unit: 'sqm', crewSize: 3 },
      { id: 2, projectId: 1, costCode: '06-200', activity: 'Trim carpentry', status: 'draft', date: relativeDate(0, 8).slice(0, 10), plannedUnits: 28, actualUnits: 30, unit: 'lm', crewSize: 2 }
    ],
    permits: [
      { id: 1, projectId: 1, title: 'Hot work permit', status: 'active', holder: 'Flow Plumbing', expiresAt: relativeDate(1, 17), location: 'Level 2 riser' },
      { id: 2, projectId: 1, title: 'Public access permit', status: 'needs_renewal', holder: 'Project Team', expiresAt: relativeDate(-1, 17), location: 'Front pavement' }
    ],
    safetyMeetings: [
      { id: 1, projectId: 1, title: 'Toolbox talk - occupied building work', status: 'completed', date: relativeDate(-1, 7).slice(0, 10), attendees: 8 },
      { id: 2, projectId: 1, title: 'Pre-task plan - riser works', status: 'scheduled', date: relativeDate(1, 7).slice(0, 10), attendees: 0 }
    ],
    preTaskPlans: [
      { id: 1, projectId: 1, title: 'Riser works pre-task plan', owner: 'Marco Silva', status: 'draft', crew: 'Flow Plumbing', dueDate: relativeDate(1, 8) }
    ],
    jobCostEntries: [
      { id: 1, projectId: 1, costCode: '09-300', description: 'Tile crew labor', status: 'posted', actualCost: 1850, committedCost: 0, source: 'timecard' },
      { id: 2, projectId: 1, costCode: '06-200', description: 'Custom casing materials', status: 'pending_review', actualCost: 0, committedCost: 5200, source: 'purchase_order' }
    ],
    payrollRuns: [
      { id: 1, period: '2026-W26', status: 'pending_approval', regularHours: 62, overtimeHours: 7, grossCost: 4280, dueDate: relativeDate(2, 12) }
    ],
    certifiedPayroll: [
      { id: 1, period: '2026-W26', status: 'pending_certification', workers: 8, grossCost: 4280, dueDate: relativeDate(2, 12) }
    ],
    aiaBillings: [
      { id: 1, projectId: 1, title: 'Progress billing application', status: 'draft', applicationNumber: 3, amount: 28500, retention: 1425 }
    ],
    payments: [
      { id: 1, projectId: 1, vendor: 'Noord Build', status: 'scheduled', amount: 6400, method: 'bank_transfer', dueDate: relativeDate(3, 12), lienWaiverRequired: true },
      { id: 2, projectId: 1, vendor: 'Flow Plumbing', status: 'ready_to_release', amount: 3100, method: 'bank_transfer', dueDate: relativeDate(1, 12), lienWaiverRequired: true }
    ],
    drawRequests: [
      { id: 1, projectId: 1, title: 'June progress draw', status: 'pending_lender', requestedAmount: 28500, approvedAmount: 0, dueDate: relativeDate(4, 17) }
    ],
    drawInspections: [
      { id: 1, projectId: 1, title: 'June draw inspection', status: 'scheduled', inspector: 'Owner representative', drawRequest: 'June progress draw', dueDate: relativeDate(2, 14) }
    ],
    riskMitigations: [
      { id: 1, projectId: 1, title: 'Payment chain risk mitigation', status: 'open', riskLevel: 'medium', owner: 'Finance', dueDate: relativeDate(3, 17) }
    ],
    lienWaivers: [
      { id: 1, projectId: 1, vendor: 'Noord Build', status: 'requested', amount: 6400, paymentId: 1, dueDate: relativeDate(2, 17) },
      { id: 2, projectId: 1, vendor: 'Flow Plumbing', status: 'received', amount: 3100, paymentId: 2, dueDate: relativeDate(-1, 17) }
    ],
    complianceItems: [
      { id: 1, vendor: 'Noord Build', projectId: 1, title: 'Insurance certificate', status: 'current', expiresAt: relativeDate(45, 17), riskLevel: 'low' },
      { id: 2, vendor: 'Flow Plumbing', projectId: 1, title: 'VCA safety certificate', status: 'expiring', expiresAt: relativeDate(5, 17), riskLevel: 'medium' }
    ],
    purchaseOrders: [
      { id: 1, projectId: 1, vendor: 'Tile Supply NL', status: 'issued', amount: 7800, expectedDelivery: relativeDate(3, 9), costCode: '09-300' },
      { id: 2, projectId: 1, vendor: 'Joinery Depot', status: 'pending_approval', amount: 5200, expectedDelivery: relativeDate(8, 9), costCode: '06-200' }
    ],
    costDatabase: [
      { id: 1, title: 'Amsterdam tile install benchmark', status: 'current', trade: 'finishes', unit: 'sqm', unitCost: 72, updatedAt: relativeDate(-12, 9) },
      { id: 2, title: 'Retail lighting rough-in benchmark', status: 'stale', trade: 'electrical', unit: 'lm', unitCost: 48, updatedAt: relativeDate(-95, 9) }
    ],
    serviceTickets: [
      { id: 1, projectId: 1, title: 'Post-handover cabinet adjustment', status: 'triage', client: 'Van Dijk Properties', priority: 'medium', dueDate: relativeDate(10, 17) }
    ],
    workOrders: [
      { id: 1, projectId: 1, title: 'Resident access protection work order', status: 'open', client: 'Van Dijk Properties', priority: 'high', dueDate: relativeDate(2, 17), assignedTo: 'Site Team', description: 'Protect access route before the next occupied-unit work sequence.' }
    ],
    opportunities: [
      { id: 1, title: 'Hotel Lobby Renovation Rotterdam', status: 'qualified', client: 'Harbor Hospitality', stage: 'proposal', value: 240000, probability: 45, dueDate: relativeDate(18, 17) },
      { id: 2, title: 'School Maintenance Framework', status: 'lead', client: 'Gemeente Utrecht', stage: 'discovery', value: 120000, probability: 25, dueDate: relativeDate(10, 17) }
    ],
    dealPipelines: [
      { id: 1, title: 'Owner-financed hotel renovation deal', client: 'Harbor Hospitality', status: 'underwriting', value: 240000, probability: 45 }
    ],
    omExtractions: [
      { id: 1, title: 'Offering memo extraction - hotel renovation', status: 'needs_review', extractedFields: 21, reviewer: 'Finance' }
    ],
    leadActivities: [
      { id: 1, opportunityId: 1, title: 'Send proposal follow-up', status: 'open', owner: 'Business Development', dueDate: relativeDate(1, 10), channel: 'email' },
      { id: 2, opportunityId: 2, title: 'Qualify procurement route', status: 'scheduled', owner: 'Business Development', dueDate: relativeDate(3, 10), channel: 'call' }
    ],
    takeoffs: [
      { id: 1, projectId: 2, title: 'Retail flooring takeoff', status: 'review_required', discipline: 'finishes', quantity: 420, unit: 'sqm', confidence: 91 },
      { id: 2, projectId: 1, title: 'Riser firestopping takeoff', status: 'approved', discipline: 'firestopping', quantity: 18, unit: 'locations', confidence: 88 }
    ],
    modelIssues: [
      { id: 1, projectId: 1, title: 'MEP clash at level 2 riser', status: 'open', discipline: 'BIM', assignee: 'Design Team', dueDate: relativeDate(2, 17), priority: 'high' }
    ],
    specifications: [
      { id: 1, projectId: 1, title: 'Section 09 30 00 Tile', status: 'mapped', submittalsGenerated: 2, reviewer: 'Anna Kowalski' },
      { id: 2, projectId: 2, title: 'Section 26 50 00 Lighting', status: 'needs_review', submittalsGenerated: 0, reviewer: 'Marco Silva' }
    ],
    tasks: [
      { id: 1, projectId: 1, title: 'Confirm lift booking for material delivery', status: 'open', assignee: 'Site Team', dueDate: relativeDate(1, 12), priority: 'medium' }
    ],
    photoRecords: [
      { id: 1, projectId: 1, title: 'Bathroom waterproofing progress', status: 'tagged', location: 'Level 2 Bath', capturedAt: relativeDate(0, 10), tags: ['waterproofing', 'progress'] }
    ],
    materials: [
      { id: 1, projectId: 1, title: 'Tile adhesive stock', status: 'low_stock', quantity: 6, unit: 'bags', reorderPoint: 10, expectedDelivery: relativeDate(3, 9) },
      { id: 2, projectId: 2, title: 'Track lighting rails', status: 'ordered', quantity: 42, unit: 'lm', expectedDelivery: relativeDate(7, 9) }
    ],
    orientations: [
      { id: 1, projectId: 1, worker: 'New subcontractor crew', company: 'Noord Build', status: 'pending', dueDate: relativeDate(1, 8), language: 'nl' }
    ],
    jhas: [
      { id: 1, projectId: 1, title: 'Riser hot works JHA', status: 'pending_review', assignee: 'Flow Plumbing', dueDate: relativeDate(1, 8) }
    ],
    sdsSheets: [
      { id: 1, projectId: 1, title: 'Tile adhesive SDS', status: 'current', expiresAt: relativeDate(180, 17), supplier: 'Tile Supply NL' },
      { id: 2, projectId: 1, title: 'Solvent primer SDS', status: 'missing', expiresAt: null, supplier: 'Flow Plumbing' }
    ],
    safetyPlans: [
      { id: 1, projectId: 1, title: 'Occupied building safety plan', status: 'approved', reviewer: 'Anna Kowalski' }
    ],
    bulletins: [
      { id: 1, projectId: 1, title: 'Public access route change', status: 'draft', audience: 'All site users', dueDate: relativeDate(0, 15) }
    ],
    bookings: [
      { id: 1, projectId: 1, title: 'Material hoist booking', status: 'confirmed', resource: 'Material Hoist', startAt: relativeDate(1, 8), endAt: relativeDate(1, 12) }
    ],
    siteAccessLogs: [
      { id: 1, projectId: 1, worker: 'Anna Kowalski', company: 'Internal', status: 'checked_in', checkedInAt: relativeDate(0, 7), orientationValid: true },
      { id: 2, projectId: 1, worker: 'Noord Build Crew', company: 'Noord Build', status: 'blocked', checkedInAt: null, orientationValid: false }
    ],
    directoryContacts: [
      { id: 1, name: 'Noord Build', type: 'subcontractor', status: 'active', email: 'ops@noordbuild.example', phone: '+31 20 555 0191', complianceStatus: 'current' },
      { id: 2, name: 'Flow Plumbing', type: 'subcontractor', status: 'active', email: 'planning@flow.example', phone: '+31 30 555 0142', complianceStatus: 'expiring' }
    ],
    integrationConnectors: [
      { id: 1, title: 'Peppol e-invoicing', provider: 'Peppol', status: 'connected', category: 'finance', lastSyncAt: relativeDate(0, 9) },
      { id: 2, title: 'Accounting export', provider: 'Exact Online', status: 'needs_auth', category: 'accounting', lastSyncAt: relativeDate(-9, 9) },
      { id: 3, title: 'Calendar sync', provider: 'Google / Outlook', status: 'connected', category: 'schedule', lastSyncAt: relativeDate(-1, 9) }
    ],
    capitalRequests: [
      { id: 1, projectId: 1, title: 'Owner contingency release', status: 'pending_owner', amount: 12500, dueDate: relativeDate(6, 17) }
    ],
    underwritingReviews: [
      { id: 1, projectId: 2, title: 'Retail client credit review', status: 'approved', riskLevel: 'low', reviewer: 'Finance' }
    ],
    portfolioReports: [
      { id: 1, title: 'Q2 active projects portfolio', status: 'current', totalValue: 279000, riskProjects: 1, generatedAt: relativeDate(0, 8) }
    ],
    euVatReturns: [
      { id: 1, period: '2026-Q2', status: 'draft', country: 'NL', vatDue: 18420, dueDate: relativeDate(22, 17), reverseChargeAmount: 6400 }
    ],
    peppolInvoices: [
      { id: 1, projectId: 1, recipient: 'Van Dijk Properties', status: 'ready', amount: 28500, standard: 'UBL 2.1', dueDate: relativeDate(3, 17) }
    ],
    gdprRequests: [
      { id: 1, requester: 'Site visitor', status: 'open', type: 'access_request', dueDate: relativeDate(18, 17) }
    ],
    wkbDossiers: [
      { id: 1, projectId: 1, title: 'Wkb quality assurance file', status: 'in_progress', evidenceItems: 34, requiredItems: 48, dueDate: relativeDate(21, 17) }
    ],
    vcaCertificates: [
      { id: 1, vendor: 'Flow Plumbing', status: 'expiring', expiresAt: relativeDate(5, 17), certificateNumber: 'VCA-2026-4421' }
    ],
    co2Reports: [
      { id: 1, projectId: 1, period: 'June 2026', status: 'draft', kgCo2e: 1840, transportKm: 420, materialKgCo2e: 1320 }
    ],
    workflowRuns: [],
    insights: [],
    lastReview: null
  };
}

function normalizeConstructionState(input = {}) {
  const baseline = createDefaultConstructionState();
  const normalized = {};
  for (const collection of CONSTRUCTION_COLLECTIONS) {
    normalized[collection] = Array.isArray(input[collection])
      ? input[collection]
      : baseline[collection];
  }
  normalized.workflowRuns = Array.isArray(input.workflowRuns) ? input.workflowRuns : baseline.workflowRuns;
  normalized.insights = Array.isArray(input.insights) ? input.insights : baseline.insights;
  normalized.lastReview = input.lastReview || baseline.lastReview;
  return normalized;
}

function collectionNextId(collection) {
  const records = construction[collection] || [];
  return Math.max(0, ...records.map(record => Number(record.id) || 0)) + 1;
}

function addConstructionRecord(collection, record) {
  const now = new Date().toISOString();
  const created = {
    ...record,
    id: collectionNextId(collection),
    createdAt: now,
    updatedAt: now
  };
  construction[collection].unshift(created);
  return created;
}

function getConstructionWorkflow(workflowKey) {
  return CONSTRUCTION_WORKFLOWS.find(workflow => workflow.key === workflowKey) || null;
}

function constructionWorkflowProjectContext(projectId) {
  const selected = projectId
    ? (construction.projects || []).find(project => String(project.id) === String(projectId))
    : null;
  const fallback = selected
    || (construction.projects || []).find(project => ['active', 'preconstruction'].includes(String(project.status || '').toLowerCase()))
    || (construction.projects || [])[0]
    || null;
  return {
    project: fallback,
    projectId: fallback?.id || null,
    projectName: fallback?.name || fallback?.title || 'Portfolio',
    client: fallback?.client || fallback?.owner || 'Client'
  };
}

function createConstructionWorkflowRecords(workflowKey, payload = {}) {
  const workflow = getConstructionWorkflow(workflowKey);
  if (!workflow) {
    const error = new Error('Unknown construction workflow');
    error.statusCode = 404;
    throw error;
  }

  const context = constructionWorkflowProjectContext(payload.projectId);
  const runId = createRequestId();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const common = {
    projectId: context.projectId,
    sourceWorkflow: workflowKey,
    workflowRunId: runId
  };
  const records = {};
  const actions = [];
  const recordRefs = [];
  const add = (key, collection, record, message) => {
    const created = addConstructionRecord(collection, { ...common, ...record });
    records[key] = created;
    recordRefs.push({
      key,
      collection,
      id: created.id,
      label: created.title || created.subject || created.number || created.package || created.worker || created.vendor || created.recipient || key
    });
    actions.push({ type: `create_${collection}`, id: created.id, collection, message });
    return created;
  };

  if (workflowKey === 'preconstruction-pursuit') {
    add('opportunity', 'opportunities', { title: `${context.projectName} pursuit`, client: context.client, status: 'qualified', stage: 'proposal', value: 125000, probability: 55, dueDate: relativeDate(10, 17) }, 'Qualified opportunity created.');
    add('tender', 'tenders', { package: `${context.projectName} bid package`, client: context.client, status: 'open', coverage: 0, estimateValue: 125000, bidDue: relativeDate(7, 17) }, 'Tender package opened.');
    add('estimate', 'estimates', { title: `${context.projectName} concept estimate`, status: 'draft', estimateValue: 125000, estimator: 'Contractor.AI' }, 'Estimate draft created.');
    add('takeoff', 'takeoffs', { title: `${context.projectName} quantity takeoff`, status: 'review_required', confidence: 86, reviewer: 'Estimator' }, 'Takeoff review queued.');
    add('costBenchmark', 'costDatabase', { item: `${context.projectName} benchmark`, status: 'needs_update', unitCost: 0, source: 'workflow benchmark' }, 'Cost benchmark queued.');
    add('resourcePlan', 'resourcePlans', { role: 'Estimator / project lead', status: 'unfilled', neededFrom: today, neededTo: relativeDate(14, 17) }, 'Resource plan created.');
    add('leadActivity', 'leadActivities', { title: `Follow up with ${context.client}`, status: 'open', dueDate: relativeDate(2, 17), owner: 'Business development' }, 'Lead follow-up created.');
  } else if (workflowKey === 'field-daily-close') {
    add('dailyLog', 'dailyLogs', { date: today, status: 'draft', manpower: 4, notes: `${context.projectName} daily field closeout.` }, 'Daily log drafted.');
    add('collaboratorReport', 'collaboratorReports', { title: `${context.projectName} subcontractor report`, company: 'Site partner', status: 'pending_review', manpower: 3, submittedAt: now }, 'Collaborator report queued.');
    add('productionReport', 'productionReports', { activity: 'Main production activity', status: 'submitted', plannedUnits: 100, actualUnits: 92, unit: 'units' }, 'Production report created.');
    add('timecard', 'timecards', { worker: 'Crew lead', date: today, hours: 8, hourlyRate: 65, status: 'submitted', costCode: 'LABOR' }, 'Timecard submitted.');
    add('photoRecord', 'photoRecords', { title: `${context.projectName} progress photos`, status: 'captured', capturedAt: now, tags: ['daily', 'progress'] }, 'Photo record created.');
    add('task', 'tasks', { title: `${context.projectName} next-day readiness`, status: 'open', priority: 'medium', dueDate: relativeDate(1, 17), assignee: 'Site Team' }, 'Next-day task created.');
    add('clientMessage', 'clientMessages', { subject: `${context.projectName} daily update`, channel: 'portal', recipient: context.client, status: 'draft', dueDate: today }, 'Client portal update drafted.');
  } else if (workflowKey === 'site-coordination') {
    add('schedule', 'schedules', { title: `${context.projectName} coordinated field window`, status: 'draft', owner: 'Site Manager', startAt: relativeDate(1, 8), endAt: relativeDate(1, 17), percentComplete: 0 }, 'Field schedule window drafted.');
    add('booking', 'bookings', { title: `${context.projectName} site resource booking`, status: 'pending', resource: 'Loading zone / lift', startAt: relativeDate(1, 8), endAt: relativeDate(1, 12), location: context.projectName }, 'Resource booking requested.');
    add('workOrder', 'workOrders', { title: `${context.projectName} field work order`, status: 'open', client: context.client, priority: 'high', dueDate: relativeDate(2, 17), assignedTo: 'Site Team', description: 'Execute coordinated site work and capture evidence.' }, 'Work order opened.');
    add('dayworkSheet', 'dayworkSheets', { title: `${context.projectName} daywork authorization`, status: 'draft', crew: 'Site crew', hours: 0, amount: 0, dueDate: relativeDate(1, 17), description: 'Capture out-of-scope labor, equipment and material for approval.' }, 'Daywork sheet drafted.');
    add('task', 'tasks', { title: `${context.projectName} coordination checklist`, status: 'open', priority: 'high', dueDate: relativeDate(1, 12), assignee: 'Site Team' }, 'Coordination task created.');
    add('bulletin', 'bulletins', { title: `${context.projectName} site coordination bulletin`, status: 'draft', audience: 'All site users', dueDate: today }, 'Site bulletin drafted.');
    add('clientMessage', 'clientMessages', { subject: `${context.projectName} coordinated field window`, channel: 'portal', recipient: context.client, status: 'draft', dueDate: today }, 'Client coordination update drafted.');
  } else if (workflowKey === 'safety-mobilization') {
    add('orientation', 'orientations', { worker: 'New crew', company: 'Site partner', status: 'scheduled', dueDate: relativeDate(1, 8), orientationValid: false }, 'Orientation scheduled.');
    add('preTaskPlan', 'preTaskPlans', { title: `${context.projectName} pre-task plan`, status: 'review_required', crew: 'Site crew', dueDate: relativeDate(1, 8), owner: 'Site Manager' }, 'Pre-task plan queued.');
    add('jha', 'jhas', { title: `${context.projectName} JHA`, status: 'draft', hazardCount: 3, dueDate: relativeDate(1, 8) }, 'JHA drafted.');
    add('sdsSheet', 'sdsSheets', { title: `${context.projectName} SDS register`, status: 'missing', material: 'Site materials' }, 'SDS request created.');
    add('formsChecklist', 'formsChecklists', { title: `${context.projectName} mobilization checklist`, category: 'safety', status: 'open', owner: 'Safety Lead', dueDate: relativeDate(1, 8), completionPercent: 0 }, 'Safety checklist opened.');
    add('safetyMeeting', 'safetyMeetings', { title: `${context.projectName} toolbox talk`, category: 'safety', status: 'draft', assignedTo: 'Site Team' }, 'Toolbox talk drafted.');
    add('siteAccessLog', 'siteAccessLogs', { worker: 'New crew', company: 'Site partner', status: 'blocked', orientationValid: false, checkedInAt: null }, 'Site access gate prepared.');
  } else if (workflowKey === 'payment-release') {
    add('invoice', 'invoices', { vendor: context.client, number: `WF-${Date.now()}`, status: 'pending_review', amount: 18500, dueDate: relativeDate(7, 12) }, 'Invoice review created.');
    add('peppolInvoice', 'peppolInvoices', { recipient: context.client, amount: 18500, status: 'ready', standard: 'UBL 2.1', dueDate: relativeDate(7, 12) }, 'Peppol invoice queued.');
    add('payment', 'payments', { vendor: 'Site partner', status: 'ready_to_release', amount: 8200, method: 'bank_transfer', lienWaiverRequired: true, dueDate: relativeDate(2, 12) }, 'Payment release staged.');
    add('lienWaiver', 'lienWaivers', { vendor: 'Site partner', status: 'requested', amount: 8200, dueDate: relativeDate(2, 12) }, 'Lien waiver requested.');
    add('drawRequest', 'drawRequests', { title: `${context.projectName} workflow draw`, status: 'pending_lender', requestedAmount: 18500, approvedAmount: 0, dueDate: relativeDate(4, 17) }, 'Draw request created.');
    add('drawInspection', 'drawInspections', { title: `${context.projectName} draw inspection`, status: 'scheduled', inspector: 'Owner representative', drawRequest: `${context.projectName} workflow draw`, dueDate: relativeDate(2, 14) }, 'Draw inspection scheduled.');
    add('riskMitigation', 'riskMitigations', { title: `${context.projectName} payment risk control`, status: 'open', riskLevel: 'medium', owner: 'Finance' }, 'Payment risk control opened.');
  } else if (workflowKey === 'eu-handover') {
    add('wkbDossier', 'wkbDossiers', { title: `${context.projectName} Wkb dossier`, status: 'in_progress', evidenceItems: 8, requiredItems: 12, reviewer: 'Quality Lead' }, 'Wkb dossier prepared.');
    add('closeoutItem', 'closeoutItems', { title: `${context.projectName} client handover`, category: 'handover', status: 'open', assignee: 'Project Team', dueDate: relativeDate(5, 17) }, 'Closeout item opened.');
    add('document', 'documents', { title: `${context.projectName} as-built package`, type: 'closeout', category: 'as_builts', status: 'pending_review', owner: 'Project Team' }, 'As-built document package created.');
    add('co2Report', 'co2Reports', { period: new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }), status: 'draft', kgCo2e: 0, transportKm: 0, materialKgCo2e: 0 }, 'CO2 report drafted.');
    add('gdprRequest', 'gdprRequests', { title: `${context.projectName} handover data check`, requester: context.client, status: 'open', dueDate: relativeDate(5, 17) }, 'GDPR handover check opened.');
    add('clientMessage', 'clientMessages', { subject: `${context.projectName} handover pack`, channel: 'portal', recipient: context.client, status: 'draft', dueDate: relativeDate(1, 17) }, 'Client handover message drafted.');
  }

  const run = {
    id: runId,
    runId,
    workflowKey,
    title: workflow.title,
    projectId: context.projectId,
    projectName: context.projectName,
    status: 'completed',
    createdAt: now,
    recordCount: recordRefs.length,
    actionCount: actions.length,
    recordRefs
  };
  construction.workflowRuns = [
    run,
    ...(Array.isArray(construction.workflowRuns) ? construction.workflowRuns : []).filter(item => String(item.runId || item.id) !== String(runId))
  ].slice(0, 12);

  return {
    success: true,
    workflow,
    workflowKey,
    runId,
    projectId: context.projectId,
    projectName: context.projectName,
    records,
    recordRefs,
    actions,
    createdAt: now,
    run,
    summary: constructionSummary(),
    capabilities: constructionCapabilities()
  };
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

function createUploadBuildRecords(payload = {}, analysis = {}) {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const filename = String(payload.filename || payload.name || 'field-evidence').trim() || 'field-evidence';
  const notes = String(payload.notes || payload.observation || payload.description || analysis.summary || '').trim();
  const job = payload.jobId ? findJob(payload.jobId) : null;
  const activeProject = (construction.projects || []).find(project =>
    ['active', 'preconstruction'].includes(String(project.status || '').toLowerCase())
  );
  const projectId = payload.projectId || activeProject?.id || null;
  const sourceJobId = job?.id || payload.jobId || null;
  const records = {};
  const actions = [];

  if (analysis.category === 'field_photo') {
    records.photoRecord = addConstructionRecord('photoRecords', {
      projectId,
      title: filename,
      status: analysis.riskDetected ? 'needs_review' : 'tagged',
      location: payload.location || job?.address || 'Site',
      capturedAt: now,
      tags: ['ai_upload', analysis.riskDetected ? 'risk' : 'progress'].filter(Boolean),
      notes,
      sourceJobId
    });
    records.dailyLog = addConstructionRecord('dailyLogs', {
      projectId,
      date: today,
      status: 'draft',
      manpower: Number(payload.manpower || 0),
      notes: `AI file analysis: ${analysis.summary}. ${notes}`,
      sourceJobId
    });
    actions.push({ type: 'create_photo_record', id: records.photoRecord.id, message: 'Photo evidence tagged.' });
    actions.push({ type: 'draft_daily_log', id: records.dailyLog.id, message: 'Daily log evidence entry drafted.' });
  } else if (analysis.category === 'invoice') {
    records.invoice = addConstructionRecord('invoices', {
      projectId,
      vendor: payload.vendor || payload.owner || 'Vendor',
      number: payload.invoiceNumber || filename,
      status: 'pending_review',
      amount: analysis.amount,
      period: payload.period || today.slice(0, 7),
      dueDate: payload.dueDate || today,
      sourceJobId,
      notes
    });
    records.jobCostEntry = addConstructionRecord('jobCostEntries', {
      projectId,
      costCode: payload.costCode || '00-000',
      description: `Invoice analysis: ${filename}`,
      status: 'pending_review',
      actualCost: analysis.amount,
      committedCost: 0,
      source: 'ai_upload',
      sourceJobId
    });
    actions.push({ type: 'queue_invoice_review', id: records.invoice.id, message: 'Invoice queued for finance review.' });
    actions.push({ type: 'create_job_cost_entry', id: records.jobCostEntry.id, message: 'Job cost entry created.' });
  } else if (analysis.category === 'safety') {
    records.formsChecklist = addConstructionRecord('formsChecklists', {
      projectId,
      title: `Review uploaded safety evidence: ${filename}`,
      status: 'open',
      category: 'safety',
      owner: payload.owner || job?.worker || 'Safety Lead',
      dueDate: today,
      completionPercent: 0,
      notes,
      sourceJobId
    });
    if (analysis.riskDetected) {
      records.incident = addConstructionRecord('incidents', {
        projectId,
        title: `AI-detected risk: ${filename}`,
        severity: analysis.riskLevel,
        status: 'open',
        date: today,
        notes,
        sourceJobId
      });
      actions.push({ type: 'open_incident', id: records.incident.id, message: 'Incident opened from uploaded evidence.' });
    }
    actions.push({ type: 'create_safety_checklist', id: records.formsChecklist.id, message: 'Safety checklist follow-up created.' });
  } else if (analysis.category === 'closeout') {
    records.document = addConstructionRecord('documents', {
      projectId,
      title: filename,
      type: 'closeout',
      category: 'handover',
      status: 'pending_review',
      owner: payload.owner || 'Project Team',
      notes,
      sourceJobId
    });
    records.closeoutItem = addConstructionRecord('closeoutItems', {
      projectId,
      title: `Review closeout evidence: ${filename}`,
      status: 'open',
      assignee: payload.owner || 'Project Team',
      dueDate: payload.dueDate || today,
      category: 'owner_handover',
      sourceJobId
    });
    actions.push({ type: 'store_closeout_document', id: records.document.id, message: 'Closeout document stored.' });
    actions.push({ type: 'create_closeout_item', id: records.closeoutItem.id, message: 'Closeout review item created.' });
  } else {
    records.document = addConstructionRecord('documents', {
      projectId,
      title: filename,
      type: payload.documentType || 'project',
      category: payload.category || 'project_controls',
      status: 'pending_review',
      owner: payload.owner || 'Project Team',
      notes,
      sourceJobId
    });
    records.task = addConstructionRecord('tasks', {
      projectId,
      title: `Review uploaded document: ${filename}`,
      assignee: payload.owner || 'Project Team',
      priority: analysis.riskDetected ? 'high' : 'medium',
      status: 'open',
      dueDate: payload.dueDate || today,
      sourceJobId
    });
    actions.push({ type: 'store_document', id: records.document.id, message: 'Document stored for review.' });
    actions.push({ type: 'create_review_task', id: records.task.id, message: 'Review task created.' });
  }

  if (job) {
    job.ai = {
      ...(job.ai || {}),
      confidence: analysis.confidence,
      reasoning: `Latest uploaded evidence: ${analysis.summary}`,
      lastDecisionAt: now
    };
    actions.push({ type: 'update_job_evidence', id: job.id, message: `Linked upload analysis to ${job.title}.` });
  }

  return { records, actions, job };
}

function findCompletionBuildRecords(jobId) {
  const matchesJob = record => String(record.sourceJobId || '') === String(jobId || '')
    && String(record.sourceWorkflow || '') === 'job_completion';
  return {
    invoice: (construction.invoices || []).find(matchesJob) || null,
    peppolInvoice: (construction.peppolInvoices || []).find(matchesJob) || null,
    clientMessage: (construction.clientMessages || []).find(matchesJob) || null,
    dailyLog: (construction.dailyLogs || []).find(matchesJob) || null,
    closeoutItem: (construction.closeoutItems || []).find(matchesJob) || null,
    payment: (construction.payments || []).find(matchesJob) || null
  };
}

function createCompletionBuildRecords(job, payload = {}, released = {}) {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const activeProject = (construction.projects || []).find(project =>
    ['active', 'preconstruction'].includes(String(project.status || '').toLowerCase())
  );
  const projectId = payload.projectId || activeProject?.id || null;
  const client = job.client || job.client_name || payload.client || 'Client';
  const amount = Number(payload.actualCost || payload.actual_cost || job.actualCost || job.actual_cost || job.estimatedCost || job.estimated_cost || 0);
  const completionNote = String(payload.completionNote || payload.completion_note || '').trim()
    || `Work completed for ${client}.`;
  const workerName = released.worker?.name || job.worker || 'Project Team';
  const releasedToolNames = (released.tools || []).map(tool => tool.name).filter(Boolean);

  const records = {
    invoice: addConstructionRecord('invoices', {
      projectId,
      vendor: CONTRACTOR_CONFIG.company,
      number: `INV-JOB-${job.id}`,
      status: 'pending_review',
      amount,
      period: today.slice(0, 7),
      dueDate,
      sourceJobId: job.id,
      sourceWorkflow: 'job_completion',
      notes: `Drafted from completed job: ${job.title}. ${completionNote}`
    }),
    peppolInvoice: addConstructionRecord('peppolInvoices', {
      projectId,
      recipient: client,
      amount,
      status: 'ready',
      standard: 'UBL 2.1',
      dueDate,
      sourceJobId: job.id,
      sourceWorkflow: 'job_completion',
      notes: 'Ready for Peppol/UBL e-invoicing review.'
    }),
    clientMessage: addConstructionRecord('clientMessages', {
      projectId,
      subject: `Completion update: ${job.title}`,
      channel: 'portal',
      recipient: client,
      status: 'draft',
      dueDate: now,
      sourceJobId: job.id,
      sourceWorkflow: 'job_completion',
      notes: completionNote
    }),
    dailyLog: addConstructionRecord('dailyLogs', {
      projectId,
      date: today,
      status: 'draft',
      manpower: released.worker ? 1 : 0,
      notes: `Completed ${job.title}. ${workerName} released${releasedToolNames.length ? ` with tools: ${releasedToolNames.join(', ')}` : ''}. ${completionNote}`,
      sourceJobId: job.id,
      sourceWorkflow: 'job_completion'
    }),
    closeoutItem: addConstructionRecord('closeoutItems', {
      projectId,
      title: `Client acceptance and closeout for ${job.title}`,
      category: 'client_acceptance',
      status: 'open',
      assignee: 'Project Team',
      dueDate: today,
      sourceJobId: job.id,
      sourceWorkflow: 'job_completion',
      notes: 'Confirm acceptance, attach final evidence and close warranty handoff.'
    }),
    payment: addConstructionRecord('payments', {
      projectId,
      vendor: client,
      amount,
      status: 'awaiting_invoice',
      method: 'bank_transfer',
      lienWaiverRequired: false,
      sourceJobId: job.id,
      sourceWorkflow: 'job_completion',
      notes: 'Created from completed job invoice workflow.'
    })
  };

  const actions = [
    { type: 'release_resources', id: job.id, message: `${released.worker ? released.worker.name : 'Worker'} and ${released.tools?.length || 0} tool(s) released.` },
    { type: 'draft_invoice', id: records.invoice.id, message: `Invoice draft created for EUR ${Math.round(amount).toLocaleString()}.` },
    { type: 'queue_peppol_invoice', id: records.peppolInvoice.id, message: 'Peppol/UBL invoice queued for review.' },
    { type: 'draft_client_update', id: records.clientMessage.id, message: 'Client portal completion update drafted.' },
    { type: 'draft_daily_log', id: records.dailyLog.id, message: 'Daily log completion entry drafted.' },
    { type: 'create_closeout_item', id: records.closeoutItem.id, message: 'Client acceptance closeout item opened.' },
    { type: 'track_payment', id: records.payment.id, message: 'Payment follow-up created.' }
  ];

  return { records, actions };
}

function completeConstructionStatus(collection) {
  return {
    projects: 'completed',
    tenders: 'submitted',
    estimates: 'approved',
    budgets: 'locked',
    contracts: 'executed',
    changeOrders: 'approved',
    invoices: 'paid',
    rfis: 'closed',
    submittals: 'approved',
    drawings: 'current',
    documents: 'current',
    transmittals: 'sent',
    dailyLogs: 'submitted',
    dayworkSheets: 'approved',
    collaboratorReports: 'accepted',
    segmentedDailyReports: 'submitted',
    schedules: 'active',
    inspections: 'passed',
    observations: 'closed',
    incidents: 'closed',
    punchItems: 'closed',
    equipment: 'available',
    timecards: 'approved',
    kioskSessions: 'verified',
    laborMap: 'current',
    formsChecklists: 'completed',
    qualityReports: 'approved',
    resourcePlans: 'filled',
    trainingItems: 'published',
    clientSelections: 'approved',
    clientMessages: 'sent',
    closeoutItems: 'submitted',
    warrantyClaims: 'closed',
    productionReports: 'submitted',
    permits: 'active',
    safetyMeetings: 'completed',
    preTaskPlans: 'approved',
    jobCostEntries: 'posted',
    payrollRuns: 'approved',
    certifiedPayroll: 'certified',
    aiaBillings: 'submitted',
    payments: 'paid',
    drawRequests: 'funded',
    drawInspections: 'passed',
    riskMitigations: 'mitigated',
    lienWaivers: 'received',
    complianceItems: 'current',
    purchaseOrders: 'issued',
    costDatabase: 'current',
    serviceTickets: 'closed',
    workOrders: 'completed',
    opportunities: 'qualified',
    dealPipelines: 'approved',
    omExtractions: 'reviewed',
    leadActivities: 'completed',
    takeoffs: 'approved',
    modelIssues: 'resolved',
    specifications: 'mapped',
    tasks: 'completed',
    photoRecords: 'tagged',
    materials: 'ordered',
    orientations: 'completed',
    jhas: 'approved',
    sdsSheets: 'current',
    safetyPlans: 'approved',
    bulletins: 'sent',
    bookings: 'confirmed',
    siteAccessLogs: 'checked_in',
    directoryContacts: 'active',
    integrationConnectors: 'connected',
    capitalRequests: 'approved',
    underwritingReviews: 'approved',
    portfolioReports: 'current',
    euVatReturns: 'filed',
    peppolInvoices: 'sent',
    gdprRequests: 'closed',
    wkbDossiers: 'complete',
    vcaCertificates: 'current',
    co2Reports: 'submitted'
  }[collection] || 'closed';
}

function actionTimestampField(status) {
  return {
    sent: 'sentAt',
    paid: 'paidAt',
    funded: 'fundedAt',
    filed: 'filedAt',
    approved: 'approvedAt',
    submitted: 'submittedAt',
    closed: 'closedAt',
    completed: 'completedAt',
    complete: 'completedAt',
    current: 'currentAt',
    active: 'activatedAt',
    connected: 'connectedAt',
    received: 'receivedAt',
    issued: 'issuedAt',
    locked: 'lockedAt',
    executed: 'executedAt',
    posted: 'postedAt',
    ordered: 'orderedAt',
    confirmed: 'confirmedAt',
    checked_in: 'checkedInAt',
    accepted: 'acceptedAt',
    certified: 'certifiedAt',
    verified: 'verifiedAt',
    reviewed: 'reviewedAt',
    mitigated: 'mitigatedAt'
  }[status] || 'actedAt';
}

function createConstructionActionArtifacts(collection, record, previousStatus, targetStatus, payload = {}) {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const title = record.title
    || record.subject
    || record.number
    || record.package
    || record.worker
    || record.activity
    || record.description
    || record.role
    || record.resource
    || record.company
    || record.vendor
    || record.supplier
    || record.provider
    || record.recipient
    || record.requester
    || record.period
    || record.costCode
    || `${collection} #${record.id}`;
  const projectId = record.projectId || payload.projectId || null;
  const note = String(payload.note || '').trim();
  const records = {};
  const actions = [
    {
      type: 'update_construction_status',
      id: record.id,
      collection,
      message: `${title} moved from ${previousStatus || 'open'} to ${targetStatus}.`
    }
  ];

  record.status = targetStatus;
  record.updatedAt = now;
  record.lastActionAt = now;
  record.lastActionStatus = targetStatus;
  record.lastActionNote = note || undefined;
  record.actionHistory = [
    ...(Array.isArray(record.actionHistory) ? record.actionHistory : []),
    { at: now, from: previousStatus || 'open', to: targetStatus, note, actor: 'Contractor.AI' }
  ].slice(-12);
  record[actionTimestampField(targetStatus)] = record[actionTimestampField(targetStatus)] || now;

  if (['clientMessages', 'transmittals', 'bulletins', 'peppolInvoices'].includes(collection) && targetStatus === 'sent') {
    record.deliveryStatus = 'sent';
    actions.push({ type: 'confirm_delivery', id: record.id, collection, message: `${title} delivery marked sent.` });
  }

  if (collection === 'rfis' && targetStatus === 'closed') {
    records.transmittal = addConstructionRecord('transmittals', {
      projectId,
      title: `RFI response issued: ${title}`,
      status: 'draft',
      recipient: record.assignee || record.responsible || 'Project Team',
      documentCount: 1,
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Package the final RFI response and notify impacted field teams.'
    });
    actions.push({ type: 'draft_rfi_transmittal', id: records.transmittal.id, message: 'RFI response transmittal drafted.' });
  }

  if (collection === 'submittals' && targetStatus === 'approved') {
    records.task = addConstructionRecord('tasks', {
      projectId,
      title: `Release approved submittal: ${title}`,
      status: 'open',
      priority: 'medium',
      assignee: record.responsible || record.assignee || 'Project Team',
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Confirm procurement, field install readiness, and approved-data distribution.'
    });
    actions.push({ type: 'create_submittal_release_task', id: records.task.id, message: 'Approved submittal release task created.' });
  }

  if (collection === 'drawings' && targetStatus === 'current') {
    records.transmittal = addConstructionRecord('transmittals', {
      projectId,
      title: `Issue current drawing: ${record.number || title}`,
      status: 'draft',
      recipient: 'Field and subcontractors',
      documentCount: 1,
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `Current revision ${record.revision || ''} is ready for distribution.`.trim()
    });
    actions.push({ type: 'draft_drawing_transmittal', id: records.transmittal.id, message: 'Current drawing transmittal drafted.' });
  }

  if (collection === 'changeOrders' && targetStatus === 'approved') {
    const value = Number(record.value || record.costImpact || 0);
    records.budget = addConstructionRecord('budgets', {
      projectId,
      costCode: record.costCode || 'CO',
      description: `Approved change order: ${title}`,
      budget: value,
      committed: Number(record.costImpact || value),
      actual: 0,
      forecast: value,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action'
    });
    records.clientMessage = addConstructionRecord('clientMessages', {
      projectId,
      subject: `Change order approved: ${title}`,
      channel: 'portal',
      recipient: record.client || 'Client',
      status: 'draft',
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `Approved value ${value}. Schedule impact ${record.scheduleImpactDays || 0} day(s).`
    });
    actions.push({ type: 'update_budget_from_change_order', id: records.budget.id, message: 'Budget line created from approved change order.' });
    actions.push({ type: 'draft_change_order_client_update', id: records.clientMessage.id, message: 'Client change order update drafted.' });
  }

  if (collection === 'invoices' && targetStatus === 'paid') {
    const amount = Number(record.amount || payload.amount || 0);
    let payment = (construction.payments || []).find(item =>
      String(item.sourceInvoiceId || '') === String(record.id)
      || (record.sourceJobId && String(item.sourceJobId || '') === String(record.sourceJobId) && String(item.sourceWorkflow || '') === String(record.sourceWorkflow || ''))
    );
    if (payment) {
      payment.status = 'paid';
      payment.amount = Number(payment.amount || amount);
      payment.paidAt = now;
      payment.updatedAt = now;
    } else {
      payment = addConstructionRecord('payments', {
        projectId,
        vendor: record.vendor || record.recipient || 'Vendor',
        amount,
        status: 'paid',
        method: 'bank_transfer',
        lienWaiverRequired: false,
        sourceInvoiceId: record.id,
        sourceCollection: collection,
        sourceWorkflow: 'construction_action',
        paidAt: now
      });
    }
    records.payment = payment;
    actions.push({ type: 'sync_payment', id: payment.id, message: `Payment record ${payment.id} synchronized.` });
  }

  if (collection === 'payments' && targetStatus === 'paid' && record.lienWaiverRequired) {
    const existingWaiver = (construction.lienWaivers || []).find(item =>
      String(item.sourcePaymentId || '') === String(record.id)
    );
    records.lienWaiver = existingWaiver || addConstructionRecord('lienWaivers', {
      projectId,
      vendor: record.vendor || 'Vendor',
      amount: Number(record.amount || 0),
      status: 'requested',
      dueDate: today,
      sourcePaymentId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Collect lien waiver after payment release.'
    });
    actions.push({ type: 'request_lien_waiver', id: records.lienWaiver.id, message: 'Lien waiver follow-up created.' });
  }

  if (['dailyLogs', 'productionReports', 'formsChecklists', 'inspections'].includes(collection) && ['submitted', 'completed', 'passed'].includes(targetStatus)) {
    records.clientMessage = addConstructionRecord('clientMessages', {
      projectId,
      subject: `Field update: ${title}`,
      channel: 'portal',
      recipient: record.client || 'Client',
      status: 'draft',
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `Share approved field progress from ${title}.`
    });
    actions.push({ type: 'draft_client_update', id: records.clientMessage.id, message: 'Client field update drafted.' });
  }

  if (collection === 'dayworkSheets' && targetStatus === 'approved') {
    const amount = Number(record.amount || record.value || 0);
    records.changeOrder = addConstructionRecord('changeOrders', {
      projectId,
      title: `Daywork approved: ${title}`,
      status: 'pending_client',
      value: amount,
      costImpact: amount,
      scheduleImpactDays: Number(record.scheduleImpactDays || 0),
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: record.description || record.notes || 'Approved daywork routed into change control.'
    });
    records.clientMessage = addConstructionRecord('clientMessages', {
      projectId,
      subject: `Daywork approval: ${title}`,
      channel: 'portal',
      recipient: record.client || 'Client',
      status: 'draft',
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `Approved daywork amount ${amount}.`
    });
    actions.push({ type: 'create_daywork_change_order', id: records.changeOrder.id, message: 'Daywork sheet converted into change control.' });
    actions.push({ type: 'draft_daywork_client_update', id: records.clientMessage.id, message: 'Client daywork update drafted.' });
  }

  if (collection === 'inspections' && targetStatus === 'passed') {
    records.document = addConstructionRecord('documents', {
      projectId,
      title: `Inspection evidence: ${title}`,
      type: 'quality',
      category: 'inspection',
      status: 'current',
      owner: record.inspector || 'Inspector',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Passed inspection evidence stored for QA/Wkb traceability.'
    });
    actions.push({ type: 'store_inspection_evidence', id: records.document.id, message: 'Inspection evidence stored.' });
  }

  if (collection === 'collaboratorReports' && targetStatus === 'accepted') {
    records.dailyLog = addConstructionRecord('dailyLogs', {
      projectId,
      date: today,
      status: 'draft',
      manpower: Number(record.manpower || 0),
      notes: `Accepted collaborator report from ${record.company || 'subcontractor'}: ${title}.`,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action'
    });
    actions.push({ type: 'draft_daily_log', id: records.dailyLog.id, message: 'Collaborator report converted into a daily log draft.' });
  }

  if (collection === 'segmentedDailyReports' && targetStatus === 'submitted' && Number(record.blockers || 0) > 0) {
    records.task = addConstructionRecord('tasks', {
      projectId,
      title: `Resolve segment blockers: ${record.segment || title}`,
      status: 'open',
      priority: 'high',
      assignee: record.owner || 'Site Team',
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `${record.blockers} blocker(s) reported in ${title}.`
    });
    actions.push({ type: 'create_blocker_task', id: records.task.id, message: 'Segment blocker task created.' });
  }

  if (collection === 'kioskSessions' && targetStatus === 'verified') {
    records.siteAccessLog = addConstructionRecord('siteAccessLogs', {
      projectId,
      worker: `${Number(record.workersCheckedIn || 0)} worker(s)`,
      company: record.company || 'Verified crew',
      status: 'checked_in',
      checkedInAt: now,
      orientationValid: true,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `Verified kiosk session at ${record.location || 'site'}.`
    });
    actions.push({ type: 'sync_site_access', id: records.siteAccessLog.id, message: 'Verified kiosk check-ins synchronized to site access.' });
  }

  if (collection === 'qualityReports' && targetStatus === 'approved' && Number(record.defectsOpen || 0) > 0) {
    records.punchItem = addConstructionRecord('punchItems', {
      projectId,
      title: `Resolve QA defects: ${title}`,
      status: 'open',
      assignee: record.inspector || record.owner || 'QA Lead',
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `${record.defectsOpen} defect(s) remained when QA report was approved.`
    });
    actions.push({ type: 'create_punch_followup', id: records.punchItem.id, message: 'Quality defects converted into a punch follow-up.' });
  }

  if (collection === 'preTaskPlans' && targetStatus === 'approved') {
    records.formsChecklist = addConstructionRecord('formsChecklists', {
      projectId,
      title: `Field verification checklist: ${title}`,
      category: 'safety',
      status: 'open',
      owner: record.owner || 'Site Manager',
      dueDate: today,
      completionPercent: 0,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `Confirm crew execution for ${record.crew || 'planned crew'}.`
    });
    actions.push({ type: 'create_pre_task_checklist', id: records.formsChecklist.id, message: 'Pre-task plan converted into a field verification checklist.' });
  }

  if (collection === 'timecards' && targetStatus === 'approved') {
    const hours = Number(record.hours || 0);
    const hourlyRate = Number(record.hourlyRate || payload.hourlyRate || 65);
    const actualCost = Math.round(hours * hourlyRate * 100) / 100;
    records.jobCostEntry = addConstructionRecord('jobCostEntries', {
      projectId,
      costCode: record.costCode || 'LABOR',
      description: `Approved timecard: ${record.worker || title}`,
      status: 'posted',
      actualCost,
      committedCost: 0,
      source: 'timecard',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action'
    });
    records.payrollRun = addConstructionRecord('payrollRuns', {
      projectId,
      period: record.date || today,
      status: 'pending_approval',
      regularHours: hours,
      overtimeHours: Number(record.overtimeHours || 0),
      grossCost: actualCost,
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action'
    });
    actions.push({ type: 'post_timecard_job_cost', id: records.jobCostEntry.id, message: 'Approved timecard posted to job cost.' });
    actions.push({ type: 'queue_timecard_payroll', id: records.payrollRun.id, message: 'Payroll run queued from approved timecard.' });
  }

  if (collection === 'certifiedPayroll' && targetStatus === 'certified') {
    records.document = addConstructionRecord('documents', {
      projectId,
      title: `Certified payroll ${record.period || today}`,
      type: 'finance',
      category: 'certified_payroll',
      status: 'current',
      owner: 'Finance',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `${record.workers || 0} worker(s), gross cost ${record.grossCost || 0}.`
    });
    actions.push({ type: 'store_certified_payroll', id: records.document.id, message: 'Certified payroll document stored.' });
  }

  if (collection === 'aiaBillings' && targetStatus === 'submitted') {
    const amount = Number(record.amount || 0);
    records.invoice = addConstructionRecord('invoices', {
      projectId,
      vendor: record.vendor || 'Contractor.AI',
      number: `AIA-${record.applicationNumber || record.id}`,
      status: 'pending_review',
      amount,
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `Created from submitted progress billing ${title}.`
    });
    records.drawRequest = addConstructionRecord('drawRequests', {
      projectId,
      title: `Draw request from ${title}`,
      status: 'pending_lender',
      requestedAmount: amount,
      approvedAmount: 0,
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action'
    });
    actions.push({ type: 'draft_invoice', id: records.invoice.id, message: 'Invoice created from AIA billing.' });
    actions.push({ type: 'create_draw_request', id: records.drawRequest.id, message: 'Draw request created from AIA billing.' });
  }

  if (collection === 'drawInspections' && targetStatus === 'passed') {
    const draw = (construction.drawRequests || []).find(item =>
      String(item.id) === String(record.drawRequestId || '')
      || String(item.title || '') === String(record.drawRequest || '')
    );
    if (draw) {
      draw.status = 'approved_for_funding';
      draw.approvedAmount = Number(draw.approvedAmount || draw.requestedAmount || 0);
      draw.updatedAt = now;
      records.drawRequest = draw;
      actions.push({ type: 'approve_draw_request', id: draw.id, message: `${draw.title} approved for funding after inspection.` });
    }
    records.document = addConstructionRecord('documents', {
      projectId,
      title: `Draw inspection evidence: ${title}`,
      type: 'finance',
      category: 'draw_inspection',
      status: 'current',
      owner: record.inspector || 'Inspector',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action'
    });
    actions.push({ type: 'store_draw_inspection', id: records.document.id, message: 'Draw inspection evidence stored.' });
  }

  if (collection === 'drawRequests' && targetStatus === 'funded') {
    const amount = Number(record.approvedAmount || record.requestedAmount || record.amount || record.value || 0);
    records.payment = addConstructionRecord('payments', {
      projectId,
      vendor: record.vendor || record.requester || 'Funding source',
      amount,
      status: 'ready_to_release',
      method: 'bank_transfer',
      lienWaiverRequired: true,
      sourceDrawRequestId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      dueDate: today,
      notes: 'Payment release created from funded draw request.'
    });
    records.portfolioReport = addConstructionRecord('portfolioReports', {
      projectId,
      title: `Draw funded: ${title}`,
      status: 'current',
      totalValue: amount,
      riskProjects: 0,
      generatedAt: now,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Portfolio visibility updated after draw funding.'
    });
    actions.push({ type: 'create_draw_payment_release', id: records.payment.id, message: 'Payment release created from funded draw.' });
    actions.push({ type: 'update_portfolio_draw_report', id: records.portfolioReport.id, message: 'Portfolio report updated for funded draw.' });
  }

  if (collection === 'riskMitigations' && targetStatus === 'mitigated') {
    record.riskLevel = 'low';
    records.document = addConstructionRecord('documents', {
      projectId,
      title: `Risk mitigation record: ${title}`,
      type: 'finance',
      category: 'risk_control',
      status: 'current',
      owner: record.owner || 'Risk owner',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Risk control marked mitigated.'
    });
    actions.push({ type: 'store_risk_evidence', id: records.document.id, message: 'Risk mitigation evidence stored.' });
  }

  if (collection === 'lienWaivers' && targetStatus === 'received') {
    const payment = (construction.payments || []).find(item =>
      String(item.id) === String(record.paymentId || record.sourcePaymentId || '')
      || (
        String(item.vendor || '').toLowerCase() === String(record.vendor || '').toLowerCase()
        && Number(item.amount || 0) === Number(record.amount || 0)
        && !['paid', 'void'].includes(String(item.status || '').toLowerCase())
      )
    );
    if (payment) {
      payment.status = 'ready_to_release';
      payment.lienWaiverRequired = false;
      payment.updatedAt = now;
      records.payment = payment;
      actions.push({ type: 'unblock_payment_release', id: payment.id, message: `${payment.vendor || 'Payment'} is ready for release after waiver receipt.` });
    }
    records.document = addConstructionRecord('documents', {
      projectId,
      title: `Lien waiver received: ${record.vendor || title}`,
      type: 'finance',
      category: 'lien_waiver',
      status: 'current',
      owner: record.vendor || 'Vendor',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `Waiver amount ${Number(record.amount || 0)} received.`
    });
    actions.push({ type: 'store_lien_waiver', id: records.document.id, message: 'Lien waiver evidence stored.' });
  }

  if (collection === 'capitalRequests' && targetStatus === 'approved') {
    const amount = Number(record.amount || record.value || 0);
    records.drawRequest = addConstructionRecord('drawRequests', {
      projectId,
      title: `Capital release draw: ${title}`,
      status: 'pending_lender',
      requestedAmount: amount,
      approvedAmount: 0,
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Created from approved capital request.'
    });
    actions.push({ type: 'create_capital_draw_request', id: records.drawRequest.id, message: 'Draw request created from approved capital request.' });
  }

  if (collection === 'underwritingReviews' && targetStatus === 'approved') {
    record.riskLevel = 'low';
    records.riskMitigation = addConstructionRecord('riskMitigations', {
      projectId,
      title: `Underwriting control: ${title}`,
      status: 'mitigated',
      riskLevel: 'low',
      owner: record.reviewer || 'Finance',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Underwriting approved and risk control documented.'
    });
    actions.push({ type: 'create_underwriting_risk_control', id: records.riskMitigation.id, message: 'Underwriting risk control documented.' });
  }

  if (collection === 'materials' && targetStatus === 'ordered') {
    const quantity = Number(record.quantity || record.reorderPoint || 1);
    records.purchaseOrder = addConstructionRecord('purchaseOrders', {
      projectId,
      vendor: record.vendor || record.supplier || 'Preferred supplier',
      status: 'issued',
      amount: Number(record.amount || record.value || 0),
      expectedDelivery: record.expectedDelivery || today,
      costCode: record.costCode || 'MAT',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `Order ${quantity} ${record.unit || 'unit(s)'} for ${title}.`
    });
    actions.push({ type: 'create_material_purchase_order', id: records.purchaseOrder.id, message: 'Purchase order created from material order.' });
  }

  if (collection === 'bookings' && targetStatus === 'confirmed') {
    records.task = addConstructionRecord('tasks', {
      projectId,
      title: `Prepare booking: ${record.resource || title}`,
      status: 'open',
      priority: 'medium',
      assignee: record.owner || 'Site Team',
      dueDate: record.startAt || today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `Confirmed booking window ${record.startAt || today} to ${record.endAt || record.startAt || today}.`
    });
    records.bulletin = addConstructionRecord('bulletins', {
      projectId,
      title: `Confirmed booking: ${record.resource || title}`,
      status: 'draft',
      audience: 'All site users',
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `Coordinate access for ${record.location || 'site'} booking.`
    });
    actions.push({ type: 'create_booking_task', id: records.task.id, message: 'Booking preparation task created.' });
    actions.push({ type: 'draft_booking_bulletin', id: records.bulletin.id, message: 'Booking coordination bulletin drafted.' });
  }

  if (['observations', 'incidents'].includes(collection) && targetStatus === 'closed') {
    records.document = addConstructionRecord('documents', {
      projectId,
      title: `Safety closeout evidence: ${title}`,
      type: 'safety',
      category: collection,
      status: 'current',
      owner: record.assignee || record.owner || 'Safety Lead',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Corrective action closeout evidence stored.'
    });
    actions.push({ type: 'store_safety_closeout', id: records.document.id, message: 'Safety closeout evidence stored.' });
  }

  if (collection === 'orientations' && targetStatus === 'completed') {
    records.siteAccessLog = addConstructionRecord('siteAccessLogs', {
      projectId,
      worker: record.worker || title,
      company: record.company || record.vendor || 'Subcontractor',
      status: 'checked_in',
      checkedInAt: now,
      orientationValid: true,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Orientation completed and access cleared.'
    });
    actions.push({ type: 'clear_orientation_access', id: records.siteAccessLog.id, message: 'Site access clearance created from completed orientation.' });
  }

  if (collection === 'jhas' && targetStatus === 'approved') {
    records.formsChecklist = addConstructionRecord('formsChecklists', {
      projectId,
      title: `JHA execution checklist: ${title}`,
      category: 'safety',
      status: 'open',
      owner: record.assignee || 'Safety Lead',
      dueDate: today,
      completionPercent: 0,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Verify the approved JHA controls in the field.'
    });
    actions.push({ type: 'create_jha_execution_checklist', id: records.formsChecklist.id, message: 'Execution checklist created from approved JHA.' });
  }

  if (collection === 'sdsSheets' && targetStatus === 'current') {
    records.complianceItem = addConstructionRecord('complianceItems', {
      projectId,
      vendor: record.supplier || record.vendor || 'Supplier',
      title: `Current SDS: ${title}`,
      status: 'current',
      expiresAt: record.expiresAt,
      riskLevel: 'low',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'SDS marked current and synchronized to compliance.'
    });
    actions.push({ type: 'sync_sds_compliance', id: records.complianceItem.id, message: 'Current SDS compliance item created.' });
  }

  if (collection === 'safetyPlans' && targetStatus === 'approved') {
    records.document = addConstructionRecord('documents', {
      projectId,
      title: `Approved safety plan: ${title}`,
      type: 'safety',
      category: 'safety_plan',
      status: 'current',
      owner: record.reviewer || 'Safety Lead',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Approved safety plan stored in document control.'
    });
    actions.push({ type: 'store_safety_plan', id: records.document.id, message: 'Approved safety plan stored.' });
  }

  if (collection === 'permits' && targetStatus === 'active') {
    records.bulletin = addConstructionRecord('bulletins', {
      projectId,
      title: `Permit active: ${title}`,
      status: 'draft',
      audience: record.holder || 'All site users',
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `Notify site users about active permit at ${record.location || 'site'}.`
    });
    actions.push({ type: 'draft_permit_bulletin', id: records.bulletin.id, message: 'Permit coordination bulletin drafted.' });
  }

  if (collection === 'dealPipelines' && targetStatus === 'approved') {
    records.opportunity = addConstructionRecord('opportunities', {
      title,
      client: record.client || 'Prospect',
      status: 'qualified',
      stage: 'approved_deal',
      value: Number(record.value || 0),
      probability: Number(record.probability || 100),
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action'
    });
    actions.push({ type: 'qualify_opportunity', id: records.opportunity.id, message: 'Approved deal promoted into the opportunity pipeline.' });
  }

  if (collection === 'omExtractions' && targetStatus === 'reviewed') {
    records.document = addConstructionRecord('documents', {
      projectId,
      title: `Reviewed OM extraction: ${title}`,
      type: 'preconstruction',
      category: 'om_extraction',
      status: 'current',
      owner: record.reviewer || 'Finance',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `${record.extractedFields || 0} extracted field(s) reviewed.`
    });
    actions.push({ type: 'store_om_review', id: records.document.id, message: 'Reviewed OM extraction stored as a preconstruction document.' });
  }

  if (collection === 'opportunities' && targetStatus === 'qualified') {
    const value = Number(record.value || 0);
    records.dealPipeline = addConstructionRecord('dealPipelines', {
      title,
      client: record.client || 'Prospect',
      status: 'underwriting',
      value,
      probability: Number(record.probability || 35),
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Qualified opportunity promoted into preconstruction deal pipeline.'
    });
    records.leadActivity = addConstructionRecord('leadActivities', {
      title: `Next pursuit step: ${title}`,
      owner: record.owner || 'Business Development',
      channel: 'email',
      status: 'scheduled',
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Follow up on qualified opportunity.'
    });
    actions.push({ type: 'create_deal_pipeline', id: records.dealPipeline.id, message: 'Deal pipeline record created from qualified opportunity.' });
    actions.push({ type: 'schedule_lead_followup', id: records.leadActivity.id, message: 'Lead follow-up scheduled.' });
  }

  if (collection === 'takeoffs' && targetStatus === 'approved') {
    records.estimate = addConstructionRecord('estimates', {
      projectId,
      title: `Estimate from takeoff: ${title}`,
      status: 'pending_review',
      estimateValue: Number(record.value || record.quantity || 0) * Number(record.unitCost || 1),
      estimator: record.reviewer || record.assignee || 'Estimator',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `${record.quantity || 0} ${record.unit || 'units'} approved for estimating.`
    });
    actions.push({ type: 'draft_estimate_from_takeoff', id: records.estimate.id, message: 'Estimate draft created from approved takeoff.' });
  }

  if (collection === 'specifications' && targetStatus === 'mapped') {
    records.submittal = addConstructionRecord('submittals', {
      projectId,
      title: `Submittal from spec: ${title}`,
      status: 'pending_review',
      package: record.section || record.title || 'Specification',
      responsible: record.reviewer || 'Project Team',
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Submittal log item generated from mapped specification.'
    });
    actions.push({ type: 'create_spec_submittal', id: records.submittal.id, message: 'Submittal created from mapped specification.' });
  }

  if (['closeoutItems', 'punchItems', 'warrantyClaims'].includes(collection) && ['submitted', 'closed'].includes(targetStatus)) {
    records.document = addConstructionRecord('documents', {
      projectId,
      title: `Evidence package: ${title}`,
      type: 'closeout',
      category: collection === 'warrantyClaims' ? 'warranty' : 'handover',
      status: 'current',
      owner: record.assignee || record.owner || 'Project Team',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `Generated when ${title} was ${targetStatus}.`
    });
    actions.push({ type: 'store_closeout_evidence', id: records.document.id, message: 'Closeout evidence document created.' });
  }

  if (collection === 'serviceTickets' && targetStatus === 'closed') {
    records.document = addConstructionRecord('documents', {
      projectId,
      title: `Service closeout evidence: ${title}`,
      type: 'service',
      category: 'service_ticket',
      status: 'current',
      owner: record.assignee || record.owner || 'Service Team',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Service ticket resolved with warranty/service evidence.'
    });
    actions.push({ type: 'store_service_closeout', id: records.document.id, message: 'Service closeout evidence stored.' });
  }

  if (collection === 'workOrders' && targetStatus === 'completed') {
    records.dailyLog = addConstructionRecord('dailyLogs', {
      projectId,
      date: today,
      status: 'draft',
      manpower: Number(record.manpower || 0),
      notes: `Work order completed: ${title}. ${record.description || record.notes || ''}`.trim(),
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action'
    });
    records.document = addConstructionRecord('documents', {
      projectId,
      title: `Work order evidence: ${title}`,
      type: 'field',
      category: 'work_order',
      status: 'current',
      owner: record.assignedTo || record.assignee || record.owner || 'Site Team',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Completed work order evidence stored for field and client history.'
    });
    actions.push({ type: 'draft_work_order_daily_log', id: records.dailyLog.id, message: 'Work order completion drafted into the daily log.' });
    actions.push({ type: 'store_work_order_evidence', id: records.document.id, message: 'Work order evidence stored.' });
  }

  if (collection === 'euVatReturns' && targetStatus === 'filed') {
    records.document = addConstructionRecord('documents', {
      projectId,
      title: `VAT filing receipt ${record.period || today}`,
      type: 'finance',
      category: 'eu_vat',
      status: 'current',
      owner: 'Finance',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `VAT return filed for ${record.country || 'EU'}.`
    });
    actions.push({ type: 'store_vat_receipt', id: records.document.id, message: 'VAT filing receipt stored.' });
  }

  if (collection === 'peppolInvoices' && targetStatus === 'sent') {
    records.invoice = addConstructionRecord('invoices', {
      projectId,
      vendor: record.recipient || 'Client',
      number: record.number || `PEPPOL-${record.id}`,
      status: 'sent',
      amount: Number(record.amount || 0),
      dueDate: record.dueDate || today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `Peppol/UBL invoice sent using ${record.standard || 'UBL'}.`
    });
    actions.push({ type: 'sync_peppol_invoice', id: records.invoice.id, message: 'Peppol invoice synchronized to accounts receivable.' });
  }

  if (collection === 'complianceItems' && targetStatus === 'current') {
    const contact = (construction.directoryContacts || []).find(item =>
      String(item.name || '').toLowerCase() === String(record.vendor || record.owner || '').toLowerCase()
    );
    if (contact) {
      contact.complianceStatus = 'current';
      contact.updatedAt = now;
      records.directoryContact = contact;
      actions.push({ type: 'sync_directory_compliance', id: contact.id, message: `${contact.name} directory compliance marked current.` });
    }
    records.document = addConstructionRecord('documents', {
      projectId,
      title: `Compliance evidence: ${title}`,
      type: 'compliance',
      category: 'vendor_compliance',
      status: 'current',
      owner: record.vendor || record.owner || 'Compliance',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action'
    });
    actions.push({ type: 'store_compliance_evidence', id: records.document.id, message: 'Compliance evidence stored.' });
  }

  if (collection === 'vcaCertificates' && targetStatus === 'current') {
    records.complianceItem = addConstructionRecord('complianceItems', {
      projectId,
      vendor: record.vendor || 'Vendor',
      title: `VCA certificate ${record.certificateNumber || title}`,
      status: 'current',
      expiresAt: record.expiresAt,
      riskLevel: 'low',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action'
    });
    (construction.siteAccessLogs || [])
      .filter(item => String(item.company || '').toLowerCase() === String(record.vendor || '').toLowerCase() && item.orientationValid === false)
      .forEach(item => {
        item.orientationValid = true;
        item.status = item.status === 'blocked' ? 'checked_in' : item.status;
        item.updatedAt = now;
      });
    actions.push({ type: 'sync_vca_compliance', id: records.complianceItem.id, message: 'VCA renewal synchronized to compliance records.' });
  }

  if (collection === 'co2Reports' && targetStatus === 'submitted') {
    records.document = addConstructionRecord('documents', {
      projectId,
      title: `CO2 report ${record.period || today}`,
      type: 'sustainability',
      category: 'co2_report',
      status: 'current',
      owner: 'Sustainability',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `${record.kgCo2e || 0} kgCO2e reported.`
    });
    actions.push({ type: 'store_co2_report', id: records.document.id, message: 'CO2 report evidence stored.' });
  }

  if (collection === 'wkbDossiers' && targetStatus === 'complete') {
    records.closeoutItem = addConstructionRecord('closeoutItems', {
      projectId,
      title: `Submit Wkb dossier: ${title}`,
      category: 'wkb_handover',
      status: 'open',
      assignee: 'Quality Lead',
      dueDate: today,
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: 'Final dossier is complete and ready for handover.'
    });
    actions.push({ type: 'queue_wkb_handover', id: records.closeoutItem.id, message: 'Wkb handover item created.' });
  }

  if (collection === 'integrationConnectors' && targetStatus === 'connected') {
    record.lastSyncAt = now;
    records.document = addConstructionRecord('documents', {
      projectId,
      title: `Integration sync proof: ${record.provider || title}`,
      type: 'platform',
      category: 'integration_sync',
      status: 'current',
      owner: record.provider || 'Integration',
      sourceRecordId: record.id,
      sourceCollection: collection,
      sourceWorkflow: 'construction_action',
      notes: `Connector ${record.title || record.provider || title} marked connected.`
    });
    actions.push({ type: 'store_integration_sync_proof', id: records.document.id, message: 'Integration sync proof stored.' });
  }

  return { records, actions };
}

function getProject(projectId) {
  return (construction.projects || []).find(project => String(project.id) === String(projectId));
}

function isPastDue(value) {
  if (!value) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date < new Date();
}

function constructionSummary() {
  const projects = construction.projects || [];
  const budgets = construction.budgets || [];
  const invoices = construction.invoices || [];
  const rfis = construction.rfis || [];
  const submittals = construction.submittals || [];
  const transmittals = construction.transmittals || [];
  const dayworkSheets = construction.dayworkSheets || [];
  const collaboratorReports = construction.collaboratorReports || [];
  const segmentedDailyReports = construction.segmentedDailyReports || [];
  const schedules = construction.schedules || [];
  const inspections = construction.inspections || [];
  const observations = construction.observations || [];
  const punchItems = construction.punchItems || [];
  const equipment = construction.equipment || [];
  const kioskSessions = construction.kioskSessions || [];
  const laborMap = construction.laborMap || [];
  const tenders = construction.tenders || [];
  const resourcePlans = construction.resourcePlans || [];
  const clientSelections = construction.clientSelections || [];
  const closeoutItems = construction.closeoutItems || [];
  const warrantyClaims = construction.warrantyClaims || [];
  const productionReports = construction.productionReports || [];
  const permits = construction.permits || [];
  const safetyMeetings = construction.safetyMeetings || [];
  const qualityReports = construction.qualityReports || [];
  const preTaskPlans = construction.preTaskPlans || [];
  const jobCostEntries = construction.jobCostEntries || [];
  const payrollRuns = construction.payrollRuns || [];
  const certifiedPayroll = construction.certifiedPayroll || [];
  const aiaBillings = construction.aiaBillings || [];
  const formsChecklists = construction.formsChecklists || [];
  const payments = construction.payments || [];
  const drawRequests = construction.drawRequests || [];
  const drawInspections = construction.drawInspections || [];
  const riskMitigations = construction.riskMitigations || [];
  const lienWaivers = construction.lienWaivers || [];
  const complianceItems = construction.complianceItems || [];
  const purchaseOrders = construction.purchaseOrders || [];
  const costDatabase = construction.costDatabase || [];
  const serviceTickets = construction.serviceTickets || [];
  const workOrders = construction.workOrders || [];
  const opportunities = construction.opportunities || [];
  const dealPipelines = construction.dealPipelines || [];
  const omExtractions = construction.omExtractions || [];
  const leadActivities = construction.leadActivities || [];
  const takeoffs = construction.takeoffs || [];
  const modelIssues = construction.modelIssues || [];
  const specifications = construction.specifications || [];
  const tasks = construction.tasks || [];
  const materials = construction.materials || [];
  const orientations = construction.orientations || [];
  const jhas = construction.jhas || [];
  const sdsSheets = construction.sdsSheets || [];
  const bookings = construction.bookings || [];
  const siteAccessLogs = construction.siteAccessLogs || [];
  const directoryContacts = construction.directoryContacts || [];
  const integrationConnectors = construction.integrationConnectors || [];
  const capitalRequests = construction.capitalRequests || [];
  const euVatReturns = construction.euVatReturns || [];
  const peppolInvoices = construction.peppolInvoices || [];
  const gdprRequests = construction.gdprRequests || [];
  const wkbDossiers = construction.wkbDossiers || [];
  const vcaCertificates = construction.vcaCertificates || [];
  const co2Reports = construction.co2Reports || [];

  const budgetTotal = budgets.reduce((sum, item) => sum + Number(item.budget || 0), 0);
  const forecastTotal = budgets.reduce((sum, item) => sum + Number(item.forecast || item.committed || 0), 0);
  const actualTotal = budgets.reduce((sum, item) => sum + Number(item.actual || 0), 0);
  const jobCostActual = jobCostEntries.reduce((sum, item) => sum + Number(item.actualCost || 0), 0);
  const jobCostCommitted = jobCostEntries.reduce((sum, item) => sum + Number(item.committedCost || 0), 0);
  const pendingPoValue = purchaseOrders
    .filter(item => ['pending_approval', 'issued'].includes(item.status))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const invoiceExposure = invoices
    .filter(invoice => !['paid', 'rejected'].includes(invoice.status))
    .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const paymentExposure = payments
    .filter(payment => !['paid', 'void'].includes(payment.status))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const openLienWaiverValue = lienWaivers
    .filter(item => !['received', 'waived'].includes(item.status))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const productionPlanned = productionReports.reduce((sum, item) => sum + Number(item.plannedUnits || 0), 0);
  const productionActual = productionReports.reduce((sum, item) => sum + Number(item.actualUnits || 0), 0);
  const productionVariancePercent = productionPlanned
    ? Math.round(((productionActual - productionPlanned) / productionPlanned) * 100)
    : 0;

  return {
    activeProjects: projects.filter(project => ['active', 'preconstruction'].includes(project.status)).length,
    totalProjects: projects.length,
    pendingTenders: tenders.filter(tender => ['open', 'draft'].includes(tender.status)).length,
    budgetTotal,
    forecastTotal,
    actualTotal,
    budgetVariance: forecastTotal - budgetTotal,
    invoiceExposure,
    openRfis: rfis.filter(rfi => rfi.status === 'open').length,
    overdueRfis: rfis.filter(rfi => rfi.status === 'open' && isPastDue(rfi.dueDate)).length,
    openSubmittals: submittals.filter(item => !['approved', 'closed'].includes(item.status)).length,
    overdueSubmittals: submittals.filter(item => !['approved', 'closed'].includes(item.status) && isPastDue(item.dueDate)).length,
    openTransmittals: transmittals.filter(item => !['sent', 'closed', 'received'].includes(item.status)).length,
    pendingDayworkSheets: dayworkSheets.filter(item => !['approved', 'closed', 'rejected'].includes(item.status)).length,
    pendingCollaboratorReports: collaboratorReports.filter(item => !['accepted', 'closed'].includes(item.status)).length,
    segmentedReportBlockers: segmentedDailyReports.reduce((sum, item) => sum + Number(item.blockers || 0), 0),
    activeScheduleItems: schedules.filter(item => !['closed', 'completed', 'cancelled'].includes(item.status)).length,
    openKioskSessions: kioskSessions.filter(item => !['verified', 'closed'].includes(item.status) || item.verificationRequired).length,
    laborCertificationGaps: laborMap.reduce((sum, item) => sum + Number(item.gapCount || 0), 0),
    openSafetyActions: [...inspections, ...observations].filter(item => ['open', 'scheduled', 'failed'].includes(item.status)).length,
    openQualityReports: qualityReports.filter(item => !['approved', 'closed'].includes(item.status) || Number(item.defectsOpen || 0) > 0).length,
    pendingPreTaskPlans: preTaskPlans.filter(item => !['approved', 'closed'].includes(item.status)).length,
    openPunchItems: punchItems.filter(item => item.status !== 'closed').length,
    availableEquipment: equipment.filter(item => item.status === 'available').length,
    unfilledResourcePlans: resourcePlans.filter(plan => ['unfilled', 'partially_filled'].includes(plan.status)).length,
    pendingSelections: clientSelections.filter(item => !['approved', 'closed'].includes(item.status)).length,
    overdueSelections: clientSelections.filter(item => !['approved', 'closed'].includes(item.status) && isPastDue(item.dueDate)).length,
    openCloseoutItems: closeoutItems.filter(item => !['approved', 'closed', 'submitted'].includes(item.status)).length,
    openWarrantyClaims: warrantyClaims.filter(item => !['closed', 'rejected'].includes(item.status)).length,
    productionVariancePercent,
    openPermits: permits.filter(item => ['active', 'needs_renewal', 'pending'].includes(item.status)).length,
    expiringPermits: permits.filter(item => !['closed', 'expired'].includes(item.status) && isPastDue(item.expiresAt)).length,
    scheduledSafetyMeetings: safetyMeetings.filter(item => ['scheduled', 'draft'].includes(item.status)).length,
    jobCostActual,
    jobCostCommitted,
    pendingPayrollRuns: payrollRuns.filter(item => ['pending_approval', 'draft'].includes(item.status)).length,
    pendingCertifiedPayroll: certifiedPayroll.filter(item => !['certified', 'approved', 'closed'].includes(item.status)).length,
    draftAiaBillings: aiaBillings.filter(item => ['draft', 'pending_review'].includes(item.status)).length,
    openChecklistItems: formsChecklists.filter(item => !['closed', 'completed', 'approved'].includes(item.status)).length,
    pendingPaymentValue: paymentExposure,
    pendingDrawRequests: drawRequests.filter(item => !['funded', 'rejected'].includes(item.status)).length,
    pendingDrawInspections: drawInspections.filter(item => !['passed', 'closed'].includes(item.status)).length,
    openRiskMitigations: riskMitigations.filter(item => !['mitigated', 'closed'].includes(item.status)).length,
    openLienWaiverValue,
    openComplianceItems: complianceItems.filter(item => !['current', 'closed'].includes(item.status)).length,
    expiringComplianceItems: complianceItems.filter(item => ['expiring', 'expired'].includes(item.status) || isPastDue(item.expiresAt)).length,
    pendingPoValue,
    staleCostItems: costDatabase.filter(item => ['stale', 'review_required'].includes(item.status) || isPastDue(item.reviewBy)).length,
    openServiceTickets: serviceTickets.filter(item => !['closed', 'cancelled'].includes(item.status)).length,
    openWorkOrders: workOrders.filter(item => !['completed', 'closed', 'cancelled'].includes(item.status)).length,
    qualifiedPipelineValue: opportunities
      .filter(item => !['lost', 'won', 'closed'].includes(item.status))
      .reduce((sum, item) => sum + Number(item.value || 0) * (Number(item.probability || 0) / 100), 0),
    activeDealPipelineValue: dealPipelines
      .filter(item => !['lost', 'closed', 'rejected'].includes(item.status))
      .reduce((sum, item) => sum + Number(item.value || 0) * (Number(item.probability || 0) / 100), 0),
    pendingOmExtractions: omExtractions.filter(item => !['reviewed', 'closed'].includes(item.status)).length,
    openLeadActivities: leadActivities.filter(item => !['closed', 'completed', 'cancelled'].includes(item.status)).length,
    openModelIssues: modelIssues.filter(item => !['closed', 'resolved'].includes(item.status)).length,
    takeoffsNeedingReview: takeoffs.filter(item => ['review_required', 'needs_review'].includes(item.status)).length,
    specsNeedingReview: specifications.filter(item => ['needs_review', 'draft'].includes(item.status)).length,
    openTasks: tasks.filter(item => !['closed', 'completed'].includes(item.status)).length,
    lowStockMaterials: materials.filter(item => item.status === 'low_stock' || Number(item.quantity || 0) <= Number(item.reorderPoint || 0)).length,
    pendingOrientations: orientations.filter(item => !['complete', 'completed', 'approved'].includes(item.status)).length,
    pendingJhas: jhas.filter(item => !['approved', 'closed'].includes(item.status)).length,
    missingSdsSheets: sdsSheets.filter(item => ['missing', 'expired'].includes(item.status)).length,
    pendingBookings: bookings.filter(item => !['confirmed', 'closed', 'cancelled'].includes(item.status)).length,
    blockedSiteAccess: siteAccessLogs.filter(item => item.status === 'blocked' || item.orientationValid === false).length,
    directoryComplianceGaps: directoryContacts.filter(item => !['current', 'approved'].includes(item.complianceStatus || item.status)).length,
    integrationIssues: integrationConnectors.filter(item => !['connected', 'active'].includes(item.status)).length,
    pendingCapitalRequests: capitalRequests.filter(item => !['approved', 'funded', 'rejected'].includes(item.status)).length,
    draftVatReturns: euVatReturns.filter(item => ['draft', 'open'].includes(item.status)).length,
    readyPeppolInvoices: peppolInvoices.filter(item => ['ready', 'queued'].includes(item.status)).length,
    openGdprRequests: gdprRequests.filter(item => !['closed', 'rejected'].includes(item.status)).length,
    wkbCompletionPercent: wkbDossiers.length
      ? Math.round((wkbDossiers.reduce((sum, item) => sum + Number(item.evidenceItems || 0), 0) / Math.max(1, wkbDossiers.reduce((sum, item) => sum + Number(item.requiredItems || 0), 0))) * 100)
      : 100,
    expiringVcaCertificates: vcaCertificates.filter(item => ['expiring', 'expired'].includes(item.status) || isPastDue(item.expiresAt)).length,
    draftCo2Reports: co2Reports.filter(item => ['draft', 'open'].includes(item.status)).length,
    lastReview: construction.lastReview
  };
}

const CONTRACTOR_CAPABILITIES = [
  {
    key: 'project-controls',
    label: 'Connected project controls',
    source: 'Autodesk, Procore, Buildertrend',
    collections: ['projects', 'documents', 'drawings', 'transmittals', 'rfis', 'submittals', 'dailyLogs', 'dayworkSheets', 'collaboratorReports', 'segmentedDailyReports', 'modelIssues'],
    promise: 'Single source of truth for drawings, documents, RFIs, submittals, daily reports, daywork sheets, collaborator reports, segmented reports and BIM coordination.'
  },
  {
    key: 'preconstruction',
    label: 'Preconstruction pipeline',
    source: 'Buildr, Autodesk, Contractor Foreman, Built',
    collections: ['opportunities', 'dealPipelines', 'omExtractions', 'leadActivities', 'tenders', 'estimates', 'takeoffs', 'costDatabase', 'resourcePlans'],
    promise: 'CRM, deal pipeline, OM extraction, bid tracking, takeoff, estimating, cost benchmarks, resource allocation and forecasted margin.'
  },
  {
    key: 'field-production',
    label: 'Field production',
    source: 'Raken, Buildertrend, Contractor Foreman',
    collections: ['schedules', 'bookings', 'tasks', 'workOrders', 'dailyLogs', 'dayworkSheets', 'collaboratorReports', 'segmentedDailyReports', 'timecards', 'kioskSessions', 'laborMap', 'productionReports', 'materials', 'equipment', 'photoRecords'],
    promise: 'Lookaheads, bookings, work orders, daily logs, daywork sheets, collaborator reports, kiosk time, labor maps, production quantities, material/equipment tracking and field photos.'
  },
  {
    key: 'safety-quality',
    label: 'Safety and quality',
    source: 'HammerTech, Raken, Contractor Foreman',
    collections: ['formsChecklists', 'qualityReports', 'inspections', 'observations', 'incidents', 'permits', 'safetyMeetings', 'preTaskPlans', 'orientations', 'jhas', 'sdsSheets', 'safetyPlans', 'bulletins', 'bookings', 'siteAccessLogs'],
    promise: 'Managed checklists, quality reports, incidents, permits, pre-task plans, toolbox talks, orientations, JHAs, SDS, safety plans, bookings and access control.'
  },
  {
    key: 'financial-control',
    label: 'Financial control',
    source: 'Sage, Built, Contractor Foreman',
    collections: ['budgets', 'jobCostEntries', 'purchaseOrders', 'invoices', 'aiaBillings', 'payments', 'drawRequests', 'drawInspections', 'riskMitigations', 'lienWaivers', 'capitalRequests', 'payrollRuns', 'certifiedPayroll'],
    promise: 'Job cost, commitments, POs, invoices, AIA billing, payments, draw inspections, risk controls, lien waivers, payroll and capital controls.'
  },
  {
    key: 'client-service',
    label: 'Client portal and service',
    source: 'Buildertrend, Contractor Foreman',
    collections: ['clientSelections', 'clientMessages', 'workOrders', 'serviceTickets', 'warrantyClaims', 'closeoutItems', 'punchItems'],
    promise: 'Selections, portal messages, work orders, service tickets, warranty, punch and closeout communication.'
  },
  {
    key: 'eu-compliance',
    label: 'Netherlands and EU compliance',
    source: 'Regional requirements plus Built finance controls',
    collections: ['wkbDossiers', 'vcaCertificates', 'euVatReturns', 'peppolInvoices', 'gdprRequests', 'co2Reports', 'complianceItems'],
    promise: 'Wkb dossier evidence, VCA certificates, VAT, Peppol/UBL invoicing, GDPR requests, CO2 reporting and vendor compliance.'
  },
  {
    key: 'integrations-directory',
    label: 'Integrations and directory',
    source: 'Autodesk, Raken, Contractor Foreman, Built',
    collections: ['integrationConnectors', 'directoryContacts', 'contracts'],
    promise: 'Connected accounting, calendar, finance, document, contact and subcontractor data.'
  }
];

const CONTRACTOR_SUITE_BASE_BLUEPRINT = [
  {
    vendor: 'Procore',
    url: 'https://www.procore.com/en-gb/products',
    focus: 'analytics, tender management, budgets, BIM, contracts, site diary, forms, inspections, observations, project financials, invoice management, photos, punch, quality, safety, resource tracking, schedules, submittals, daywork, timecards, estimating, equipment, insights and resource planning',
    modules: ['portfolioReports', 'tenders', 'budgets', 'modelIssues', 'contracts', 'drawings', 'dailyLogs', 'dayworkSheets', 'formsChecklists', 'inspections', 'observations', 'jobCostEntries', 'invoices', 'photoRecords', 'punchItems', 'qualityReports', 'timecards', 'estimates', 'equipment', 'resourcePlans', 'submittals']
  },
  {
    vendor: 'Autodesk Construction Cloud',
    url: 'https://construction.autodesk.com/',
    focus: 'single source of truth, document control, bid management, BIM/model coordination, project management, AI, product integrations and construction data management',
    modules: ['documents', 'drawings', 'transmittals', 'rfis', 'submittals', 'modelIssues', 'tenders', 'integrationConnectors']
  },
  {
    vendor: 'Buildr',
    url: 'https://buildr.com/platform/',
    focus: 'preconstruction CRM, deal pipeline, estimate tracking, resource planning, forecasting, handover and cross-team collaboration',
    modules: ['opportunities', 'dealPipelines', 'leadActivities', 'tenders', 'estimates', 'resourcePlans', 'portfolioReports', 'closeoutItems']
  },
  {
    vendor: 'Buildertrend',
    url: 'https://buildertrend.com/',
    focus: 'residential client portal, scheduling, selections, change orders, service, warranty and templates',
    modules: ['clientSelections', 'clientMessages', 'schedules', 'changeOrders', 'serviceTickets', 'warrantyClaims', 'tasks']
  },
  {
    vendor: 'Sage 100 Contractor',
    url: 'https://www.sage.com/en-us/products/sage-100-contractor/',
    focus: 'job cost, project accounting, estimating, budgets, subcontracts, purchase orders, certified payroll, AIA billings, service management and reports',
    modules: ['budgets', 'jobCostEntries', 'estimates', 'contracts', 'purchaseOrders', 'payrollRuns', 'certifiedPayroll', 'aiaBillings', 'invoices', 'serviceTickets']
  },
  {
    vendor: 'Contractor Foreman',
    url: 'https://contractorforeman.com/',
    focus: 'all-in-one project management, permits, punch, work orders, bids, takeoffs, invoices, payments and directory',
    modules: ['projects', 'permits', 'punchItems', 'workOrders', 'serviceTickets', 'takeoffs', 'invoices', 'payments', 'directoryContacts']
  },
  {
    vendor: 'Raken',
    url: 'https://www.rakenapp.com/',
    focus: 'daily reports, collaborator reports, segmented reports, time clock, kiosk mode, labor map, production, materials, equipment, photos, tasks, RFIs and safety/quality reporting',
    modules: ['dailyLogs', 'collaboratorReports', 'segmentedDailyReports', 'timecards', 'kioskSessions', 'laborMap', 'productionReports', 'materials', 'equipment', 'photoRecords', 'tasks', 'inspections', 'qualityReports']
  },
  {
    vendor: 'HammerTech',
    url: 'https://www.hammertech.com/en-us/',
    focus: 'safety mobilization, subcontractor onboarding, orientations, pre-task plans, JHAs, SDS, permits, meetings, bulletins, bookings, equipment and access',
    modules: ['orientations', 'preTaskPlans', 'jhas', 'sdsSheets', 'safetyPlans', 'permits', 'safetyMeetings', 'bulletins', 'bookings', 'siteAccessLogs', 'equipment']
  },
  {
    vendor: 'Built',
    url: 'https://getbuilt.com/',
    focus: 'construction finance, draw inspections, risk mitigation, underwriting, budget management, invoices, lien waivers, capital requests, compliance, payments and portfolio risk',
    modules: ['budgets', 'drawRequests', 'drawInspections', 'riskMitigations', 'invoices', 'lienWaivers', 'capitalRequests', 'underwritingReviews', 'dealPipelines', 'omExtractions', 'complianceItems', 'payments', 'portfolioReports']
  }
];

const CONTRACTOR_MARKET_SERVICE_DETAILS = {
  Procore: {
    sourceReviewedAt: '2026-07-01',
    sourceEvidence: [
      'Public UK products page lists capabilities for analytics, tender management, budgets, BIM, contracts, site diary, forms, inspections, observations, project financials, invoice management, photos, snag/punch, quality and safety, resource tracking, schedules, submittals, daywork, timecards, estimating, equipment, insights and resource planning.',
      'Mapped into Contractor.AI as project execution, cost management, resource management and lifecycle management modules.'
    ],
    serviceGroups: [
      { name: 'Project execution', services: ['Project management', 'RFIs', 'submittals', 'site diary', 'forms', 'photos and videos', 'snag/punch list', 'daywork sheets'] },
      { name: 'Cost and resources', services: ['Budget', 'project financials', 'invoice management', 'subcontractor invoicing', 'resource tracking', 'timecards', 'equipment', 'resource planning'] },
      { name: 'Quality, safety and data', services: ['Inspections', 'observations', 'quality and safety', 'analytics', 'insights', 'BIM', 'contract/drawing management'] }
    ],
    netherlandsEuEnhancements: ['Translate snag lists into Wkb evidence packs', 'Connect invoices to Peppol/UBL approval gates', 'Track VCA and subcontractor compliance before resource release']
  },
  'Autodesk Construction Cloud': {
    sourceReviewedAt: '2026-07-01',
    sourceEvidence: [
      'Public construction page presents Autodesk Forma/ACC products for construction operations, preconstruction, model management, data management, takeoff, estimate, bid management and integrations.',
      'Mapped into Contractor.AI as document control, bid management, model coordination, takeoff/estimate and integration connectors.'
    ],
    serviceGroups: [
      { name: 'Construction operations', services: ['Document management', 'project management', 'RFIs', 'submittals', 'daily reports', 'AI workflow support'] },
      { name: 'Preconstruction', services: ['Takeoff', 'estimating', 'bid management', 'BuildingConnected style tender coverage', 'TradeTapp qualification'] },
      { name: 'Model and data', services: ['Model coordination', 'design collaboration', 'data management', 'integration ecosystem'] }
    ],
    netherlandsEuEnhancements: ['Use drawing/document revisions as Wkb proof sources', 'Attach model issues to field correction tasks', 'Keep GDPR-safe document access audit events']
  },
  Buildr: {
    sourceReviewedAt: '2026-07-01',
    sourceEvidence: [
      'Public platform page describes a unified preconstruction system with business development, estimating/project management, operations, finance, leadership dashboards, collaboration, APIs and webhooks.',
      'Mapped into Contractor.AI as CRM, pursuits, estimates, workforce planning, forecasting, handover and reporting.'
    ],
    serviceGroups: [
      { name: 'Business development', services: ['Construction CRM', 'clients and prospects', 'phase/deadline tracking', 'marketing materials', 'lead follow-up'] },
      { name: 'Estimating and operations', services: ['Estimate tracking', 'budget management', 'value engineering', 'workforce planning', 'project handover'] },
      { name: 'Forecasting and integrations', services: ['Revenue forecasting', 'profit forecasting', 'pipeline dashboards', 'REST APIs', 'webhooks', 'custom schema'] }
    ],
    netherlandsEuEnhancements: ['Score opportunities against Dutch crew capacity and travel time', 'Convert won pursuits into operating-ledger jobs', 'Preserve tender audit records for client transparency']
  },
  Buildertrend: {
    sourceReviewedAt: '2026-07-01',
    sourceEvidence: [
      'Public site navigation highlights business owner, project manager and client roles plus templates, onboarding, academy/training and client transparency workflows.',
      'Mapped into Contractor.AI as client portal, selections, scheduling, service/warranty, templates and customer-facing updates.'
    ],
    serviceGroups: [
      { name: 'Client experience', services: ['Client portal', 'messages', 'selections', 'change approvals', 'client transparency'] },
      { name: 'Project delivery', services: ['Schedule', 'tasks', 'templates', 'project manager controls', 'progress updates'] },
      { name: 'Service and support', services: ['Service work', 'warranty', 'learning academy style help', 'setup/onboarding'] }
    ],
    netherlandsEuEnhancements: ['Use Dutch/English client update templates', 'Gate scope changes through approval records', 'Attach warranty claims to aftercare jobs']
  },
  'Sage 100 Contractor': {
    sourceReviewedAt: '2026-07-01',
    sourceEvidence: [
      'Public Sage 100 Contractor page describes managing construction and service management, job cost/project details, dashboards, reports, estimating, budgets, proposals, subcontracts and purchase orders.',
      'It also calls out certified payroll, AIA billings, lien waivers, project accounting and construction management integration.'
    ],
    serviceGroups: [
      { name: 'Accounting and job cost', services: ['Job costing', 'project accounting', 'dashboards', 'industry reports', 'margin protection'] },
      { name: 'Commercial controls', services: ['Estimating', 'budgets', 'proposals', 'subcontracts', 'purchase orders'] },
      { name: 'Billing and payroll', services: ['AIA/progress billing', 'lien waivers', 'certified payroll', 'service management'] }
    ],
    netherlandsEuEnhancements: ['Adapt financial handoff to VAT and Peppol/UBL', 'Keep invoice send actions behind human approval', 'Map job-cost records to Dutch chart-of-accounts export later']
  },
  'Contractor Foreman': {
    sourceReviewedAt: '2026-07-01',
    sourceEvidence: [
      'Public home/features page lists project management, financials, people, documents, integrations and CRM with to-dos, client portal, scheduling, service tickets, projects, opportunities, punchlists, work orders, permits, daily logs and inspections.',
      'Financial/service links include takeoffs, cost database, change orders, subcontracts, estimates, invoices, online payments, purchase orders and bid management.'
    ],
    serviceGroups: [
      { name: 'All-in-one operations', services: ['Projects', 'to-dos', 'scheduling', 'service tickets', 'work orders', 'permits', 'daily logs', 'inspections', 'punchlists'] },
      { name: 'Financials', services: ['Takeoffs', 'real-time cost database', 'change orders', 'subcontracts', 'estimates', 'invoices', 'online payments', 'purchase orders', 'bid management'] },
      { name: 'People, documents and CRM', services: ['Team chat', 'crew schedule', 'incidents', 'leads manager', 'safety meetings', 'time cards', 'calendar', 'directory', 'submittals', 'PDF markup', 'forms/checklists', 'document writer'] }
    ],
    netherlandsEuEnhancements: ['Prioritize small contractor workflows over enterprise complexity', 'Tie team chat and client portal updates to audit events', 'Add work orders for maintenance and service-call jobs']
  },
  Raken: {
    sourceReviewedAt: '2026-07-01',
    sourceEvidence: [
      'Public navigation lists progress reporting, time tracking, production tracking, project management, safety and quality, and integrations.',
      'Feature links include daily reports, collaborator reports, segmented reports, photo documentation, tasks, messaging, time clock, kiosk mode, policies/verification, material tracking, equipment management, production insights, certifications/labor map, RFIs, document management, managed checklists, observations, incidents and toolbox talks.'
    ],
    serviceGroups: [
      { name: 'Field reporting', services: ['Daily reports', 'collaborator reports', 'segmented daily reports', 'photo documentation', 'tasks', 'messaging'] },
      { name: 'Labor and production', services: ['Time tracking', 'time clock', 'kiosk mode', 'policies and verification', 'production tracking', 'resource scheduling', 'materials', 'equipment', 'production insights', 'certifications and labor map'] },
      { name: 'Quality and integrations', services: ['RFIs', 'document management', 'safety management', 'quality management', 'managed checklists', 'observations', 'incidents', 'toolbox talks', 'accounting/payroll integrations'] }
    ],
    netherlandsEuEnhancements: ['Turn daily reports into client-ready Dutch summaries', 'Use labor map for VCA coverage gaps', 'Tie material tracking to local supplier purchase-order reminders']
  },
  HammerTech: {
    sourceReviewedAt: '2026-07-01',
    sourceEvidence: [
      'Public site navigation groups platform services into mobilize, coordinate and report, including subcontractor management, orientations/worker info, JHAs, SDS, safety plans, pre-task plans, permits, safety meetings, bulletins, bookings, equipment management, incidents/injuries, daily report, inspections and site access.',
      'Mapped into Contractor.AI as safety mobilization, access gating, compliance evidence and field safety reporting.'
    ],
    serviceGroups: [
      { name: 'Mobilize', services: ['Subcontractor management', 'orientations and worker info', 'JHAs', 'SDS', 'safety plans'] },
      { name: 'Coordinate', services: ['Pre-task plans', 'permits', 'safety meetings', 'bulletins', 'bookings', 'equipment management'] },
      { name: 'Report', services: ['Incidents and injuries', 'daily report', 'inspections', 'site access', 'reporting and insights', 'safety intelligence'] }
    ],
    netherlandsEuEnhancements: ['Gate site access on VCA and orientation status', 'Store JHA/SDS/safety-plan evidence per job', 'Escalate unsafe work before schedule commitments move']
  },
  Built: {
    sourceReviewedAt: '2026-07-01',
    sourceEvidence: [
      'Public site lists construction loan administration, AI draw agent, draw inspections, draw/budget management, risk mitigation, deal management, underwriting, portfolio reporting, construction financials, budget management, invoice management, lien waiver management, capital requests, compliance tracking and payments.',
      'Mapped into Contractor.AI as finance controls, draw/payment approvals, risk controls, lien-waiver-style document gates and portfolio reporting.'
    ],
    serviceGroups: [
      { name: 'Construction finance', services: ['Budget management', 'invoice management', 'compliance tracking', 'payments', 'portfolio reporting'] },
      { name: 'Draw and risk', services: ['AI draw agent', 'draw inspections', 'draw and budget management', 'risk mitigation', 'capital requests'] },
      { name: 'Deal and waiver controls', services: ['Origination pipeline', 'OM extraction', 'underwriting', 'lien waiver creation/sending/tracking', 'integrations'] }
    ],
    netherlandsEuEnhancements: ['Use draw/payment gates as invoice approval workflow analogues', 'Adapt lien waiver checks into EU subcontractor compliance holds', 'Surface funding/payment risk before materials are ordered']
  }
};

const CONTRACTOR_SUITE_BLUEPRINT = CONTRACTOR_SUITE_BASE_BLUEPRINT.map(vendor => ({
  ...vendor,
  ...(CONTRACTOR_MARKET_SERVICE_DETAILS[vendor.vendor] || {})
}));

function recordIsOpen(record = {}) {
  const status = String(record.status || record.riskLevel || record.priority || 'open').toLowerCase();
  return !['accepted', 'approved', 'certified', 'checked_in', 'closed', 'completed', 'complete', 'confirmed', 'connected', 'current', 'executed', 'filed', 'funded', 'issued', 'locked', 'mapped', 'mitigated', 'ordered', 'paid', 'passed', 'posted', 'received', 'rejected', 'resolved', 'reviewed', 'sent', 'submitted', 'tagged', 'verified', 'waived', 'cancelled', 'active'].includes(status);
}

function constructionCapabilities() {
  const summary = constructionSummary();
  return CONTRACTOR_CAPABILITIES.map(capability => {
    const records = capability.collections.flatMap(collection => construction[collection] || []);
    const openRecords = records.filter(recordIsOpen);
    const missingCollections = capability.collections.filter(collection => !(construction[collection] || []).length);
    const coverage = Math.round(((capability.collections.length - missingCollections.length) / capability.collections.length) * 100);
    const automationScore = openRecords.length
      ? Math.max(35, Math.min(95, 100 - openRecords.length * 6))
      : 100;
    return {
      ...capability,
      recordCount: records.length,
      openCount: openRecords.length,
      missingCollections,
      coverage,
      automationScore,
      status: missingCollections.length ? 'needs_data' : openRecords.length ? 'action_required' : 'ready',
      signals: {
        budgetVariance: summary.budgetVariance,
        openRfis: summary.openRfis,
        openSafetyActions: summary.openSafetyActions,
        pendingPaymentValue: summary.pendingPaymentValue,
        integrationIssues: summary.integrationIssues,
        wkbCompletionPercent: summary.wkbCompletionPercent
      }
    };
  });
}

function collectionLabel(collection) {
  return String(collection || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function getContractorSuiteVendor(identifier) {
  const raw = String(identifier || '').trim().toLowerCase();
  if (!raw) return null;
  const index = Number(identifier);
  if (Number.isInteger(index) && CONTRACTOR_SUITE_BLUEPRINT[index]) {
    return CONTRACTOR_SUITE_BLUEPRINT[index];
  }
  return CONTRACTOR_SUITE_BLUEPRINT.find(vendor => vendor.vendor.toLowerCase() === raw) || null;
}

function buildContractorSuiteVendorCoverage(data = construction) {
  return CONTRACTOR_SUITE_BLUEPRINT.map((vendor, index) => {
    const modules = vendor.modules.filter(module => CONSTRUCTION_COLLECTIONS.includes(module));
    const missingModules = modules.filter(module => !(data[module] || []).length);
    const coveredModules = modules.filter(module => (data[module] || []).length);
    const openRecords = modules.flatMap(module =>
      (data[module] || [])
        .filter(recordIsOpen)
        .map(record => ({
          module,
          id: record.id,
          title: record.title || record.name || record.subject || record.number || record.package || record.vendor || `${collectionLabel(module)} #${record.id}`,
          status: record.status || record.riskLevel || record.priority || 'open',
          targetStatus: completeConstructionStatus(module)
        }))
    );
    const bestWorkflow = CONSTRUCTION_WORKFLOWS
      .map(workflow => ({
        ...workflow,
        matchScore: workflow.collections.filter(collection => modules.includes(collection)).length
      }))
      .filter(workflow => workflow.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore || a.title.localeCompare(b.title))[0] || null;

    return {
      ...vendor,
      index,
      modules,
      coveredModules,
      missingModules,
      openRecords,
      bestWorkflow,
      coverage: Math.round((coveredModules.length / Math.max(1, modules.length)) * 100),
      recommendedAction: missingModules.length
        ? 'install_missing_modules'
        : openRecords.length
          ? 'run_open_actions'
          : 'monitor'
    };
  });
}

function buildContractorCapabilityGapPlan() {
  const vendors = buildContractorSuiteVendorCoverage(construction);
  const averageCoverage = Math.round(vendors.reduce((sum, vendor) => sum + vendor.coverage, 0) / Math.max(1, vendors.length));
  const missingModules = vendors.reduce((sum, vendor) => sum + vendor.missingModules.length, 0);
  const openRecords = vendors.reduce((sum, vendor) => sum + vendor.openRecords.length, 0);
  const recommendations = vendors
    .flatMap(vendor => vendor.missingModules.map(module => ({
      vendor: vendor.vendor,
      url: vendor.url,
      module,
      label: collectionLabel(module),
      action: 'install_missing_module',
      reason: `${vendor.vendor} coverage expects ${collectionLabel(module)} for ${vendor.focus}.`
    })))
    .slice(0, 30);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      averageCoverage,
      missingModules,
      openRecords,
      readyVendors: vendors.filter(vendor => vendor.recommendedAction === 'monitor').length,
      actionVendors: vendors.filter(vendor => vendor.recommendedAction !== 'monitor').length,
      topRecommendation: recommendations[0] || null
    },
    vendors,
    recommendations
  };
}

function buildContractorMarketMap() {
  const plan = buildContractorCapabilityGapPlan();
  const serviceCount = plan.vendors.reduce((sum, vendor) =>
    sum + (vendor.serviceGroups || []).reduce((groupSum, group) => groupSum + (group.services || []).length, 0),
  0);
  const sourceCount = plan.vendors.reduce((sum, vendor) => sum + (vendor.sourceEvidence || []).length, 0);
  const euEnhancementCount = plan.vendors.reduce((sum, vendor) => sum + (vendor.netherlandsEuEnhancements || []).length, 0);

  return {
    generatedAt: plan.generatedAt,
    summary: {
      vendors: plan.vendors.length,
      serviceGroups: plan.vendors.reduce((sum, vendor) => sum + (vendor.serviceGroups || []).length, 0),
      services: serviceCount,
      sourceEvidenceItems: sourceCount,
      netherlandsEuEnhancements: euEnhancementCount,
      averageCoverage: plan.summary.averageCoverage,
      missingModules: plan.summary.missingModules,
      openRecords: plan.summary.openRecords
    },
    vendors: plan.vendors,
    recommendations: plan.recommendations,
    capabilities: constructionCapabilities(),
    workflows: CONSTRUCTION_WORKFLOWS
  };
}

function buildContractorOperatingCatalog(data = construction) {
  const plan = buildContractorCapabilityGapPlan();
  const marketMap = buildContractorMarketMap();
  const capabilities = constructionCapabilities();
  const ledgerCoverage = operatingLedger.ledgerCapabilityCoverage();
  const serviceCount = plan.vendors.reduce((sum, vendor) =>
    sum + (vendor.serviceGroups || []).reduce((groupSum, group) => groupSum + (group.services || []).length, 0),
  0);
  const approvalGates = [
    { action: 'quote_issue', label: 'Issue quote or estimate', reason: 'Pricing and contract terms must stay reviewable before the client sees them.' },
    { action: 'client_message_send', label: 'Send client/subcontractor message', reason: 'External communication remains a draft until Robert approves it.' },
    { action: 'schedule_commit', label: 'Commit schedule or start date', reason: 'Crew availability, weather, approvals and access must be verified first.' },
    { action: 'purchase_order_release', label: 'Release purchase order or material order', reason: 'Orders create cost and supplier commitments.' },
    { action: 'invoice_or_peppol_send', label: 'Send invoice, UBL or Peppol record', reason: 'Finance handoff requires VAT, client, amount and evidence review.' },
    { action: 'payment_or_draw_release', label: 'Release payment or draw request', reason: 'Payment actions require invoice, waiver/compliance and approval proof.' },
    { action: 'archive_or_delete_record', label: 'Archive/delete operational record', reason: 'Records are retained and routed through approval before removal.' },
    { action: 'complete_job_or_close_warranty', label: 'Complete job or close warranty', reason: 'Closeout, evidence, aftercare and client obligations must be checked.' }
  ];
  const regionalControls = [
    { key: 'wkb', label: 'Wkb evidence dossier', modules: ['wkbDossiers', 'documents', 'photoRecords', 'qualityReports'], reason: 'Dutch quality evidence should be assembled from photos, documents, inspections and closeout records.' },
    { key: 'vca', label: 'VCA and site safety proof', modules: ['vcaCertificates', 'orientations', 'jhas', 'sdsSheets', 'siteAccessLogs'], reason: 'Site access and field scheduling should be blocked when safety proof is missing or expired.' },
    { key: 'vat-peppol', label: 'VAT, UBL and Peppol finance handoff', modules: ['euVatReturns', 'peppolInvoices', 'invoices', 'financeHandoffs'], reason: 'European finance workflows need structured invoice readiness before sending or payment.' },
    { key: 'gdpr', label: 'GDPR access audit', modules: ['gdprRequests', 'documents', 'directoryContacts', 'audit_events'], reason: 'Client, worker and subcontractor data needs access and change traceability.' },
    { key: 'co2', label: 'CO2 and sustainability reporting', modules: ['co2Reports', 'materials', 'route_plans'], reason: 'Transport, materials and project records should support later emissions reporting.' }
  ];
  const lanes = capabilities.map(capability => {
    const vendorMatches = plan.vendors.filter(vendor =>
      vendor.modules.some(module => capability.collections.includes(module))
      || capability.source.toLowerCase().split(',').some(source => vendor.vendor.toLowerCase().includes(source.trim()))
    );
    const services = vendorMatches.flatMap(vendor =>
      (vendor.serviceGroups || []).flatMap(group => group.services || [])
    );
    const uniqueServices = Array.from(new Set(services)).slice(0, 18);
    const euEnhancements = Array.from(new Set(vendorMatches.flatMap(vendor => vendor.netherlandsEuEnhancements || []))).slice(0, 8);
    const missingModules = capability.missingCollections || [];
    const modules = capability.collections || [];
    const coveredModules = modules.filter(module => !missingModules.includes(module));
    const openRecords = modules.flatMap(module =>
      (data[module] || [])
        .filter(recordIsOpen)
        .map(record => ({
          module,
          id: record.id,
          title: record.title || record.name || record.subject || record.number || record.vendor || `${collectionLabel(module)} #${record.id}`,
          status: record.status || record.riskLevel || record.priority || 'open'
        }))
    ).slice(0, 10);

    return {
      key: capability.key,
      label: capability.label,
      source: capability.source,
      promise: capability.promise,
      status: capability.status,
      coverage: capability.coverage,
      automationScore: capability.automationScore,
      modules,
      coveredModules,
      missingModules,
      openRecords,
      vendors: vendorMatches.map(vendor => vendor.vendor),
      serviceExamples: uniqueServices,
      euEnhancements,
      safeAutonomy: {
        canDraft: true,
        canCreateInternalRecords: true,
        canSendExternally: false,
        requiresApprovalFor: approvalGates.map(gate => gate.action)
      },
      recommendedNextAction: missingModules.length
        ? {
            type: 'install_missing_modules',
            modules: missingModules.slice(0, 5),
            label: `Create ${collectionLabel(missingModules[0])} operating record`,
            reason: `${capability.label} needs ${missingModules.slice(0, 3).map(collectionLabel).join(', ')} to match the researched contractor-platform baseline.`
          }
        : openRecords.length
          ? {
              type: 'resolve_open_records',
              modules: Array.from(new Set(openRecords.map(record => record.module))).slice(0, 5),
              label: `Resolve ${openRecords.length} open ${capability.label} record(s)`,
              reason: 'Existing records are present but still need review, approval, submission, or closeout.'
            }
          : {
              type: 'monitor',
              modules: [],
              label: 'Monitor lane',
              reason: 'Coverage exists and no open action is currently blocking this lane.'
            }
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      vendors: plan.vendors.length,
      services: serviceCount,
      serviceGroups: marketMap.summary.serviceGroups,
      constructionCapabilities: capabilities.length,
      ledgerCapabilities: ledgerCoverage.capabilities.length,
      constructionCoverage: plan.summary.averageCoverage,
      ledgerCoverage: ledgerCoverage.summary.averageCoverage,
      missingModules: plan.summary.missingModules,
      openRecords: plan.summary.openRecords,
      approvalGates: approvalGates.length,
      regionalControls: regionalControls.length
    },
    lanes,
    vendors: plan.vendors,
    workflows: CONSTRUCTION_WORKFLOWS,
    ledgerCapabilities: ledgerCoverage.capabilities,
    approvalGates,
    regionalControls,
    recommendations: plan.recommendations
  };
}

function initialCapabilityGapStatus(collection) {
  return {
    dailyLogs: 'draft',
    dayworkSheets: 'draft',
    collaboratorReports: 'pending_review',
    segmentedDailyReports: 'draft',
    clientMessages: 'draft',
    documents: 'draft',
    drawings: 'open',
    transmittals: 'draft',
    estimates: 'draft',
    tenders: 'open',
    opportunities: 'lead',
    dealPipelines: 'underwriting',
    integrationConnectors: 'needs_auth',
    safetyMeetings: 'scheduled',
    bookings: 'pending',
    permits: 'pending',
    siteAccessLogs: 'blocked',
    invoices: 'pending_review',
    workOrders: 'open',
    payments: 'scheduled',
    peppolInvoices: 'ready',
    euVatReturns: 'draft',
    co2Reports: 'draft'
  }[collection] || 'open';
}

function buildCapabilityGapRecord(vendor, collection, payload = {}) {
  const context = constructionWorkflowProjectContext(payload.projectId);
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const label = collectionLabel(collection);
  const value = Number(payload.value || 0);
  const dueDate = payload.dueDate || relativeDate(['rfis', 'submittals', 'permits', 'inspections', 'observations', 'clientMessages', 'siteAccessLogs'].includes(collection) ? 1 : 7, 17);
  const base = {
    projectId: context.projectId,
    title: `${vendor.vendor} ${label} accelerator`,
    status: initialCapabilityGapStatus(collection),
    sourceWorkflow: 'capability_gap_install',
    sourceVendor: vendor.vendor,
    sourceCapability: vendor.focus,
    dueDate,
    owner: payload.owner || 'Contractor.AI',
    value,
    notes: `Installed from ${vendor.vendor} service map: ${vendor.focus}.`
  };

  if (collection === 'projects') return { ...base, name: base.title, client: context.client, budget: value || 100000, phase: 'preconstruction', progress: 0 };
  if (collection === 'tenders') return { ...base, package: base.title, client: context.client, estimateValue: value || 45000, bidDue: dueDate };
  if (collection === 'budgets') return { ...base, description: base.title, costCode: 'CAP-GAP', budget: value || 25000, forecast: value || 25000, actual: 0 };
  if (collection === 'contracts') return { ...base, vendor: context.client, value: value || 25000 };
  if (collection === 'invoices') return { ...base, vendor: context.client, number: `CAP-${Date.now()}`, amount: value || 0 };
  if (collection === 'rfis') return { ...base, subject: base.title, responsible: 'Design Team' };
  if (collection === 'submittals') return { ...base, package: 'Capability package' };
  if (collection === 'dayworkSheets') return { ...base, title: base.title, crew: payload.owner || 'Site crew', hours: value || 0, amount: value || 0, description: base.notes };
  if (collection === 'dailyLogs') return { ...base, date: today, manpower: 0 };
  if (collection === 'timecards') return { ...base, worker: 'Crew lead', date: today, hours: value || 0 };
  if (collection === 'equipment') return { ...base, name: base.title, location: 'Depot', nextInspection: dueDate };
  if (collection === 'clientMessages') return { ...base, subject: base.title, channel: 'portal', recipient: context.client };
  if (collection === 'payments') return { ...base, vendor: context.client, amount: value || 0, method: 'bank_transfer', lienWaiverRequired: true };
  if (collection === 'purchaseOrders') return { ...base, vendor: context.client, amount: value || 0, expectedDelivery: dueDate, costCode: 'CAP-GAP' };
  if (collection === 'opportunities') return { ...base, client: context.client, stage: 'qualification', probability: 25 };
  if (collection === 'dealPipelines') return { ...base, client: context.client, probability: 25 };
  if (collection === 'orientations') return { ...base, worker: 'New crew', company: context.client, orientationValid: false };
  if (collection === 'bookings') return { ...base, title: base.title, resource: payload.resource || 'Site resource', location: context.projectName, startAt: dueDate, endAt: dueDate };
  if (collection === 'siteAccessLogs') return { ...base, worker: 'New crew', company: context.client, checkedInAt: null, orientationValid: false };
  if (collection === 'workOrders') return { ...base, title: base.title, client: context.client, priority: 'medium', dueDate, assignedTo: payload.owner || 'Site Team', description: base.notes };
  if (collection === 'directoryContacts') return { ...base, name: context.client, type: 'subcontractor', email: '', complianceStatus: 'pending_review' };
  if (collection === 'portfolioReports') return { ...base, totalValue: value || 0, riskProjects: 0, generatedAt: now };
  if (collection === 'peppolInvoices') return { ...base, recipient: context.client, amount: value || 0, standard: 'UBL 2.1' };
  if (collection === 'wkbDossiers') return { ...base, evidenceItems: 0, requiredItems: 1 };
  if (collection === 'co2Reports') return { ...base, period: `${new Date().getFullYear()}-Q${Math.ceil((new Date().getMonth() + 1) / 3)}`, kgCo2e: value || 0 };
  return base;
}

function runConstructionAutopilot() {
  const actions = [];
  const insights = [];
  const now = new Date().toISOString();

  for (const project of construction.projects || []) {
    const projectBudgets = (construction.budgets || []).filter(item => String(item.projectId) === String(project.id));
    if (projectBudgets.length) {
      const forecast = projectBudgets.reduce((sum, item) => sum + Number(item.forecast || item.committed || 0), 0);
      project.forecastAtCompletion = forecast;
      if (forecast > Number(project.budget || 0)) {
        project.riskLevel = 'high';
        insights.push({
          type: 'cost_risk',
          severity: 'high',
          projectId: project.id,
          message: `${project.name} forecast is above budget by EUR ${Math.round(forecast - Number(project.budget || 0)).toLocaleString()}.`
        });
      }
    }
  }

  for (const rfi of construction.rfis || []) {
    if (rfi.status === 'open' && isPastDue(rfi.dueDate)) {
      rfi.priority = 'critical';
      actions.push({ type: 'escalate_rfi', id: rfi.id, message: `RFI escalated: ${rfi.subject}` });
    }
  }

  for (const submittal of construction.submittals || []) {
    if (!['approved', 'closed'].includes(submittal.status) && isPastDue(submittal.dueDate)) {
      submittal.status = 'overdue';
      actions.push({ type: 'flag_submittal', id: submittal.id, message: `Submittal flagged overdue: ${submittal.title}` });
    }
  }

  for (const report of construction.collaboratorReports || []) {
    if (['pending_review', 'draft'].includes(report.status)) {
      actions.push({ type: 'review_collaborator_report', id: report.id, message: `${report.title} is waiting for field review.` });
    }
  }

  for (const report of construction.segmentedDailyReports || []) {
    if (Number(report.blockers || 0) > 0) {
      insights.push({ type: 'segment_blocker', severity: 'medium', projectId: report.projectId, message: `${report.title} has ${report.blockers} blocker(s).` });
    }
  }

  for (const sheet of construction.dayworkSheets || []) {
    if (!['approved', 'closed', 'rejected'].includes(String(sheet.status || '').toLowerCase())) {
      actions.push({ type: 'approve_daywork_sheet', id: sheet.id, message: `${sheet.title || 'Daywork sheet'} needs approval before change control.` });
    }
  }

  for (const order of construction.workOrders || []) {
    if (!['completed', 'closed', 'cancelled'].includes(String(order.status || '').toLowerCase())) {
      actions.push({ type: 'complete_work_order', id: order.id, message: `${order.title || 'Work order'} is open for field completion.` });
    }
  }

  for (const booking of construction.bookings || []) {
    if (!['confirmed', 'closed', 'cancelled'].includes(String(booking.status || '').toLowerCase())) {
      actions.push({ type: 'confirm_booking', id: booking.id, message: `${booking.title || 'Booking'} needs resource confirmation.` });
    }
  }

  for (const session of construction.kioskSessions || []) {
    if (session.verificationRequired || session.status === 'open') {
      actions.push({ type: 'verify_kiosk_session', id: session.id, message: `${session.title} needs check-in verification.` });
    }
  }

  for (const map of construction.laborMap || []) {
    if (Number(map.gapCount || 0) > 0) {
      insights.push({ type: 'labor_certification_gap', severity: 'medium', projectId: map.projectId, message: `${map.title} shows ${map.gapCount} certification gap(s).` });
    }
  }

  for (const report of construction.qualityReports || []) {
    if (Number(report.defectsOpen || 0) > 0 && !['approved', 'closed'].includes(report.status)) {
      actions.push({ type: 'resolve_quality_report', id: report.id, message: `${report.title} has ${report.defectsOpen} open defect(s).` });
    }
  }

  const openObservation = (construction.observations || []).find(item => item.status === 'open');
  if (openObservation && !construction.trainingItems.some(item => item.title.includes(openObservation.title))) {
    const trainingItem = {
      id: collectionNextId('trainingItems'),
      title: `Toolbox talk: ${openObservation.title}`,
      category: 'safety',
      status: 'draft',
      assignedTo: openObservation.assignee || 'Site Team',
      sourceObservationId: openObservation.id
    };
    construction.trainingItems.push(trainingItem);
    actions.push({ type: 'draft_training', id: trainingItem.id, message: `Drafted safety training for ${openObservation.title}` });
  }

  const unfilledPlan = (construction.resourcePlans || []).find(plan => plan.status === 'unfilled');
  if (unfilledPlan) {
    const project = getProject(unfilledPlan.projectId);
    insights.push({
      type: 'resource_gap',
      severity: 'medium',
      projectId: unfilledPlan.projectId,
      message: `${unfilledPlan.role} is unfilled for ${project?.name || 'project'} from ${unfilledPlan.neededFrom}.`
    });
  }

  for (const selection of construction.clientSelections || []) {
    if (!['approved', 'closed'].includes(selection.status) && isPastDue(selection.dueDate)) {
      selection.status = 'overdue';
      actions.push({ type: 'escalate_selection', id: selection.id, message: `Client selection overdue: ${selection.title}` });
    }
  }

  const pendingSelection = (construction.clientSelections || []).find(item => ['pending_client', 'overdue'].includes(item.status));
  if (pendingSelection && !(construction.clientMessages || []).some(item => item.sourceSelectionId === pendingSelection.id)) {
    const message = {
      id: collectionNextId('clientMessages'),
      projectId: pendingSelection.projectId,
      subject: `Selection reminder: ${pendingSelection.title}`,
      status: 'draft',
      channel: 'portal',
      recipient: pendingSelection.client || 'Client',
      dueDate: relativeDate(0, 16),
      sourceSelectionId: pendingSelection.id
    };
    construction.clientMessages.push(message);
    actions.push({ type: 'draft_client_message', id: message.id, message: `Drafted portal reminder for ${pendingSelection.title}` });
  }

  for (const activity of construction.leadActivities || []) {
    if (!['closed', 'completed', 'cancelled'].includes(activity.status) && isPastDue(activity.dueDate)) {
      activity.status = 'overdue';
      actions.push({ type: 'escalate_lead_activity', id: activity.id, message: `BD follow-up overdue: ${activity.title}` });
    }
  }

  for (const transmittal of construction.transmittals || []) {
    if (transmittal.status === 'draft' && isPastDue(transmittal.dueDate)) {
      transmittal.status = 'ready_to_send';
      actions.push({ type: 'prepare_transmittal', id: transmittal.id, message: `Transmittal ready to send: ${transmittal.title}` });
    }
  }

  for (const schedule of construction.schedules || []) {
    if (['draft', 'open'].includes(schedule.status) && isPastDue(schedule.startAt)) {
      schedule.status = 'needs_commitment';
      actions.push({ type: 'commit_schedule', id: schedule.id, message: `Schedule needs commitment: ${schedule.title}` });
    }
  }

  for (const report of construction.productionReports || []) {
    const planned = Number(report.plannedUnits || 0);
    const actual = Number(report.actualUnits || 0);
    if (planned > 0 && actual < planned * 0.85) {
      report.status = report.status === 'submitted' ? 'review_required' : report.status;
      insights.push({
        type: 'production_variance',
        severity: 'medium',
        projectId: report.projectId,
        message: `${report.activity} production is ${Math.round(((actual - planned) / planned) * 100)}% against plan.`
      });
    }
  }

  for (const checklist of construction.formsChecklists || []) {
    if (!['closed', 'completed', 'approved'].includes(checklist.status) && isPastDue(checklist.dueDate)) {
      checklist.status = 'overdue';
      actions.push({ type: 'complete_checklist', id: checklist.id, message: `Checklist overdue: ${checklist.title}` });
    }
  }

  for (const permit of construction.permits || []) {
    if (!['closed', 'expired'].includes(permit.status) && isPastDue(permit.expiresAt)) {
      permit.status = 'needs_renewal';
      actions.push({ type: 'renew_permit', id: permit.id, message: `Permit needs renewal: ${permit.title}` });
    }
  }

  for (const plan of construction.preTaskPlans || []) {
    if (!['approved', 'closed'].includes(plan.status) && isPastDue(plan.dueDate)) {
      plan.status = 'review_required';
      actions.push({ type: 'review_pre_task_plan', id: plan.id, message: `Pre-task plan needs approval: ${plan.title}` });
    }
  }

  for (const compliance of construction.complianceItems || []) {
    if (['expired', 'expiring'].includes(compliance.status) || isPastDue(compliance.expiresAt)) {
      compliance.riskLevel = 'high';
      insights.push({
        type: 'compliance_risk',
        severity: 'high',
        projectId: compliance.projectId,
        message: `${compliance.vendor} compliance item needs attention: ${compliance.title}.`
      });
    }
  }

  for (const costItem of construction.costDatabase || []) {
    if (['stale', 'review_required'].includes(costItem.status) || isPastDue(costItem.reviewBy)) {
      insights.push({
        type: 'cost_database_stale',
        severity: 'medium',
        message: `${costItem.title} needs a current market-rate review.`
      });
    }
  }

  for (const contact of construction.directoryContacts || []) {
    if (!['current', 'approved'].includes(contact.complianceStatus || contact.status)) {
      insights.push({
        type: 'directory_compliance_gap',
        severity: 'medium',
        message: `${contact.name} has a directory compliance gap.`
      });
    }
  }

  for (const connector of construction.integrationConnectors || []) {
    if (!['connected', 'active'].includes(connector.status)) {
      actions.push({ type: 'repair_integration', id: connector.id, message: `${connector.title} integration needs attention (${connector.status}).` });
    }
  }

  const readyPayment = (construction.payments || []).find(payment => payment.status === 'ready_to_release' && payment.lienWaiverRequired);
  if (readyPayment && !(construction.lienWaivers || []).some(item => String(item.paymentId) === String(readyPayment.id))) {
    const waiver = {
      id: collectionNextId('lienWaivers'),
      projectId: readyPayment.projectId,
      vendor: readyPayment.vendor,
      status: 'requested',
      amount: readyPayment.amount,
      paymentId: readyPayment.id,
      dueDate: relativeDate(1, 17)
    };
    construction.lienWaivers.push(waiver);
    readyPayment.status = 'hold_for_waiver';
    actions.push({ type: 'request_lien_waiver', id: waiver.id, message: `Requested lien waiver from ${readyPayment.vendor}` });
  }

  for (const payroll of construction.certifiedPayroll || []) {
    if (!['certified', 'approved', 'closed'].includes(payroll.status)) {
      actions.push({ type: 'certify_payroll', id: payroll.id, message: `${payroll.period || payroll.title} certified payroll is pending.` });
    }
  }

  for (const billing of construction.aiaBillings || []) {
    if (['draft', 'pending_review'].includes(billing.status)) {
      actions.push({ type: 'submit_progress_billing', id: billing.id, message: `${billing.title} is ready for billing review.` });
    }
  }

  for (const inspection of construction.drawInspections || []) {
    if (!['passed', 'closed'].includes(inspection.status) && isPastDue(inspection.dueDate)) {
      inspection.status = 'due';
      actions.push({ type: 'complete_draw_inspection', id: inspection.id, message: `Draw inspection due: ${inspection.title}` });
    }
  }

  for (const risk of construction.riskMitigations || []) {
    if (!['mitigated', 'closed'].includes(risk.status)) {
      insights.push({ type: 'finance_risk_control', severity: risk.riskLevel || 'medium', projectId: risk.projectId, message: `${risk.title} is still open.` });
    }
  }

  for (const deal of construction.dealPipelines || []) {
    if (['underwriting', 'pending_review'].includes(deal.status)) {
      insights.push({ type: 'deal_underwriting', severity: 'medium', projectId: deal.projectId, message: `${deal.title} is in underwriting at ${deal.probability || 0}% probability.` });
    }
  }

  for (const extraction of construction.omExtractions || []) {
    if (['needs_review', 'draft'].includes(extraction.status)) {
      actions.push({ type: 'review_om_extraction', id: extraction.id, message: `${extraction.title} needs extracted field review.` });
    }
  }

  const openCloseout = (construction.closeoutItems || []).filter(item => !['approved', 'closed', 'submitted'].includes(item.status));
  const advancedProject = (construction.projects || []).find(project => Number(project.progress || 0) >= 50);
  if (advancedProject && !openCloseout.length) {
    const closeoutItem = {
      id: collectionNextId('closeoutItems'),
      projectId: advancedProject.id,
      title: 'Owner handover checklist',
      status: 'open',
      assignee: advancedProject.manager || 'Project Team',
      dueDate: relativeDate(14, 17),
      category: 'owner_handover'
    };
    construction.closeoutItems.push(closeoutItem);
    actions.push({ type: 'seed_closeout', id: closeoutItem.id, message: `Created closeout checklist for ${advancedProject.name}` });
  }

  const pendingDraw = (construction.drawRequests || []).find(draw => draw.status === 'pending_lender' && isPastDue(draw.dueDate));
  if (pendingDraw) {
    pendingDraw.status = 'escalated';
    insights.push({
      type: 'draw_delay',
      severity: 'medium',
      projectId: pendingDraw.projectId,
      message: `${pendingDraw.title} is waiting on lender approval.`
    });
  }

  for (const issue of construction.modelIssues || []) {
    if (!['closed', 'resolved'].includes(issue.status) && isPastDue(issue.dueDate)) {
      issue.status = 'coordination_required';
      actions.push({ type: 'coordinate_model_issue', id: issue.id, message: `Model issue needs coordination: ${issue.title}` });
    }
  }

  for (const takeoff of construction.takeoffs || []) {
    if (['review_required', 'needs_review'].includes(takeoff.status) || Number(takeoff.confidence || 100) < 90) {
      insights.push({
        type: 'takeoff_review',
        severity: 'medium',
        projectId: takeoff.projectId,
        message: `${takeoff.title} should be reviewed before estimate lock.`
      });
    }
  }

  for (const spec of construction.specifications || []) {
    if (['needs_review', 'draft'].includes(spec.status)) {
      spec.status = 'submittal_log_required';
      actions.push({ type: 'generate_submittal_log', id: spec.id, message: `Generate submittal log from ${spec.title}` });
    }
  }

  for (const material of construction.materials || []) {
    if (material.status === 'low_stock' || Number(material.quantity || 0) <= Number(material.reorderPoint || 0)) {
      insights.push({
        type: 'material_shortage',
        severity: 'medium',
        projectId: material.projectId,
        message: `${material.title} is below reorder point.`
      });
    }
  }

  for (const orientation of construction.orientations || []) {
    if (!['complete', 'completed', 'approved'].includes(orientation.status) && isPastDue(orientation.dueDate)) {
      orientation.status = 'blocked';
      actions.push({ type: 'block_unoriented_worker', id: orientation.id, message: `Orientation required for ${orientation.worker}` });
    }
  }

  for (const jha of construction.jhas || []) {
    if (!['approved', 'closed'].includes(jha.status) && isPastDue(jha.dueDate)) {
      jha.status = 'overdue';
      actions.push({ type: 'escalate_jha', id: jha.id, message: `JHA overdue: ${jha.title}` });
    }
  }

  for (const sds of construction.sdsSheets || []) {
    if (['missing', 'expired'].includes(sds.status)) {
      actions.push({ type: 'request_sds', id: sds.id, message: `Request SDS: ${sds.title}` });
    }
  }

  const blockedAccess = (construction.siteAccessLogs || []).find(item => item.status === 'blocked' || item.orientationValid === false);
  if (blockedAccess) {
    insights.push({
      type: 'site_access_block',
      severity: 'high',
      projectId: blockedAccess.projectId,
      message: `${blockedAccess.worker} is blocked from site access until onboarding is complete.`
    });
  }

  for (const vatReturn of construction.euVatReturns || []) {
    if (['draft', 'open'].includes(vatReturn.status) && isPastDue(vatReturn.dueDate)) {
      vatReturn.status = 'overdue';
      actions.push({ type: 'file_vat_return', id: vatReturn.id, message: `VAT return overdue: ${vatReturn.period}` });
    }
  }

  for (const invoice of construction.peppolInvoices || []) {
    if (invoice.status === 'ready') {
      invoice.status = 'queued';
      actions.push({ type: 'queue_peppol_invoice', id: invoice.id, message: `Queued Peppol invoice for ${invoice.recipient}` });
    }
  }

  for (const request of construction.gdprRequests || []) {
    if (!['closed', 'rejected'].includes(request.status) && isPastDue(request.dueDate)) {
      request.status = 'overdue';
      insights.push({
        type: 'gdpr_deadline',
        severity: 'high',
        message: `GDPR request is overdue for ${request.requester}.`
      });
    }
  }

  for (const dossier of construction.wkbDossiers || []) {
    const completion = Number(dossier.requiredItems || 0)
      ? Number(dossier.evidenceItems || 0) / Number(dossier.requiredItems)
      : 1;
    if (completion < 0.9) {
      insights.push({
        type: 'wkb_dossier_gap',
        severity: 'medium',
        projectId: dossier.projectId,
        message: `${dossier.title} is ${Math.round(completion * 100)}% complete.`
      });
    }
  }

  for (const certificate of construction.vcaCertificates || []) {
    if (['expiring', 'expired'].includes(certificate.status) || isPastDue(certificate.expiresAt)) {
      certificate.riskLevel = 'high';
      actions.push({ type: 'renew_vca_certificate', id: certificate.id, message: `VCA renewal required for ${certificate.vendor}` });
    }
  }

  construction.insights = [...insights, ...(construction.insights || [])].slice(0, 25);
  construction.lastReview = now;

  return {
    success: true,
    ranAt: now,
    actions,
    insights,
    summary: constructionSummary(),
    capabilities: constructionCapabilities()
  };
}

let construction = createDefaultConstructionState();

const savedState = loadState();
if (savedState.jobs) {
  jobs = savedState.jobs;
}
if (savedState.workers) {
  workers = savedState.workers;
}
if (savedState.tools) {
  tools = savedState.tools;
}
if (savedState.construction) {
  construction = normalizeConstructionState(savedState.construction);
}

const operatingLedger = new ContractorOperatingLedger({
  dbFile: ledgerFile,
  stateProvider: currentState,
  logger: log
});

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
      serializeError(error)
    );
  }
}

function legacyLedgerJobId(jobOrId) {
  const value = typeof jobOrId === 'object' && jobOrId !== null
    ? jobOrId.ledgerJobId || jobOrId.id
    : jobOrId;
  const id = String(value || '').trim();
  if (!id) return null;
  if (id.startsWith('job_') || id.startsWith('legacy_job_')) return id;
  return `legacy_job_${id}`;
}

function legacyLedgerWorkerId(workerOrId) {
  const value = typeof workerOrId === 'object' && workerOrId !== null
    ? workerOrId.ledgerWorkerId || workerOrId.id
    : workerOrId;
  const id = String(value || '').trim();
  if (!id) return null;
  if (id.startsWith('worker_') || id.startsWith('legacy_worker_')) return id;
  return `legacy_worker_${id}`;
}

function legacyLedgerToolId(toolOrId) {
  const value = typeof toolOrId === 'object' && toolOrId !== null
    ? toolOrId.ledgerToolId || toolOrId.id
    : toolOrId;
  const id = String(value || '').trim();
  if (!id) return null;
  if (id.startsWith('tool_') || id.startsWith('legacy_tool_')) return id;
  return `legacy_tool_${id}`;
}

function recordLabel(record = {}, fallback = 'record') {
  return record.title
    || record.subject
    || record.number
    || record.package
    || record.name
    || record.client
    || record.vendor
    || record.company
    || record.worker
    || record.description
    || fallback;
}

function findPendingArchiveApproval(targetType, targetId) {
  const approvals = operatingLedger.listApprovals({ status: 'pending', limit: 500 });
  return approvals.find(approval =>
    approval.targetType === targetType
    && String(approval.targetId) === String(targetId)
  ) || null;
}

function requestConstructionArchive(collection, id, payload = {}, options = {}) {
  const records = construction[collection] || [];
  const record = records.find(item => String(item.id) === String(id));
  if (!record) {
    const error = new Error('Construction record not found');
    error.statusCode = 404;
    throw error;
  }

  const actor = options.actor || payload.actor || 'dashboard';
  const reason = payload.reason || payload.notes || 'Destructive archive requested; retained until human approval is resolved.';
  const before = { ...record };
  const targetId = `${collection}:${id}`;

  if (record.status === 'archived') {
    return { record, approval: null, before, alreadyArchived: true };
  }

  const pendingApproval = findPendingArchiveApproval('construction_record_archive', targetId);
  if (record.status === 'pending_archive_approval' && pendingApproval) {
    return { record, approval: pendingApproval, before, alreadyPending: true };
  }

  const timestamp = new Date().toISOString();
  const approval = operatingLedger.createApproval({
    targetType: 'construction_record_archive',
    targetId,
    approvalType: 'destructive_action',
    requestedBy: actor,
    summary: `Archive ${collection} record: ${recordLabel(record, id)}`,
    reason,
    data: {
      collection,
      recordId: id,
      label: recordLabel(record, id),
      requestedAction: 'archive',
      before
    }
  }, { actor });

  Object.assign(record, {
    status: 'pending_archive_approval',
    archiveApprovalId: approval.id,
    archiveRequestedAt: timestamp,
    archiveRequestedBy: actor,
    archiveReason: reason,
    updatedAt: timestamp
  });

  operatingLedger.audit({
    entityType: 'construction_record',
    entityId: targetId,
    action: 'request_construction_archive',
    actor,
    before,
    after: record,
    metadata: { approvalId: approval.id, collection, id }
  });

  saveState();
  return { record, approval, before };
}

function requestLegacyJobArchive(job, payload = {}, options = {}) {
  const actor = options.actor || payload.actor || 'legacy_jobs_api';
  const reason = payload.reason || payload.notes || 'Legacy job delete requested; retained until human approval is resolved.';
  const before = { ...job };

  if (job.status === 'archived') {
    return { job, approval: null, before, alreadyArchived: true };
  }

  const pendingApproval = findPendingArchiveApproval('legacy_job_archive', job.id);
  if (job.status === 'pending_archive_approval' && pendingApproval) {
    return { job, approval: pendingApproval, before, alreadyPending: true };
  }

  const timestamp = new Date().toISOString();
  const approval = operatingLedger.createApproval({
    targetType: 'legacy_job_archive',
    targetId: String(job.id),
    jobId: legacyLedgerJobId(job),
    approvalType: 'destructive_action',
    requestedBy: actor,
    summary: `Archive legacy job: ${job.title || job.id}`,
    reason,
    data: {
      legacyJobId: job.id,
      ledgerJobId: legacyLedgerJobId(job),
      title: job.title || null,
      requestedAction: 'archive',
      before
    }
  }, { actor });

  Object.assign(job, {
    status: 'pending_archive_approval',
    archiveApprovalId: approval.id,
    archiveRequestedAt: timestamp,
    archiveRequestedBy: actor,
    archiveReason: reason,
    updatedAt: timestamp
  });

  mirrorLegacyJobToLedger(job, {
    actor,
    status: 'pending_archive_approval',
    progressNote: 'Job archive requested; record retained until approval is resolved.'
  });

  operatingLedger.audit({
    entityType: 'legacy_job',
    entityId: job.id,
    jobId: legacyLedgerJobId(job),
    action: 'request_legacy_job_archive',
    actor,
    before,
    after: job,
    metadata: { approvalId: approval.id }
  });

  saveState();
  return { job, approval, before };
}

function applyServerApprovalSideEffects(approval, actor = 'approval') {
  if (!approval || approval.status !== 'approved') {
    return null;
  }

  const targetType = String(approval.targetType || '');
  const data = approval.data || {};
  const timestamp = new Date().toISOString();

  if (targetType === 'construction_record_archive') {
    const collection = data.collection;
    const recordId = data.recordId;
    if (!CONSTRUCTION_COLLECTIONS.includes(collection)) return null;
    const records = construction[collection] || [];
    const record = records.find(item => String(item.id) === String(recordId));
    if (!record) return null;
    const before = { ...record };
    Object.assign(record, {
      status: 'archived',
      archivedAt: timestamp,
      archivedBy: approval.resolvedBy || actor,
      archiveApprovalId: approval.id,
      updatedAt: timestamp
    });
    operatingLedger.audit({
      entityType: 'construction_record',
      entityId: `${collection}:${recordId}`,
      action: 'archive_construction_record',
      actor: approval.resolvedBy || actor,
      before,
      after: record,
      metadata: { approvalId: approval.id, collection, recordId }
    });
    saveState();
    return { type: 'construction_record_archive', collection, record };
  }

  if (targetType === 'legacy_job_archive') {
    const legacyJobId = data.legacyJobId || approval.targetId;
    const job = jobs.find(item => String(item.id) === String(legacyJobId));
    if (!job) return null;
    const before = { ...job };
    releaseJobResources(job);
    Object.assign(job, {
      status: 'archived',
      progress: Math.max(0, Math.min(100, Number(job.progress || 0))),
      archivedAt: timestamp,
      archivedBy: approval.resolvedBy || actor,
      archiveApprovalId: approval.id,
      updatedAt: timestamp
    });
    mirrorLegacyJobToLedger(job, {
      actor: approval.resolvedBy || actor,
      status: 'archived',
      progressNote: 'Job archived after explicit approval; operational record retained.'
    });
    operatingLedger.audit({
      entityType: 'legacy_job',
      entityId: job.id,
      jobId: legacyLedgerJobId(job),
      action: 'archive_legacy_job',
      actor: approval.resolvedBy || actor,
      before,
      after: job,
      metadata: { approvalId: approval.id }
    });
    saveState();
    return { type: 'legacy_job_archive', job };
  }

  if (targetType === 'worker_retirement' && data.legacyWorkerId != null) {
    const worker = workers.find(item => String(item.id) === String(data.legacyWorkerId));
    if (!worker) return null;
    const before = { ...worker };
    Object.assign(worker, {
      status: 'retired',
      retiredAt: timestamp,
      retiredBy: approval.resolvedBy || actor,
      retirementApprovalId: approval.id,
      updatedAt: timestamp
    });
    for (const job of jobs.filter(item =>
      String(item.assignedWorkerId) === String(worker.id)
      || item.worker === worker.name
    )) {
      releaseJobResources(job);
      job.worker = null;
      job.assignedWorkerId = null;
      if (['scheduled', 'in_progress'].includes(job.status)) {
        job.status = 'pending';
        job.startDate = null;
        job.scheduledStart = null;
        job.scheduledEnd = null;
        job.estimatedCompletion = null;
        job.ai = {
          ...(job.ai || {}),
          confidence: 'low',
          reasoning: 'Assigned worker retirement was approved. Job returned to pending for replanning.',
          lastDecisionAt: timestamp
        };
      }
      mirrorLegacyJobToLedger(job, {
        actor: approval.resolvedBy || actor,
        status: job.status,
        progressNote: 'Worker retirement approved; job resources released for replanning.'
      });
    }
    syncLegacyWorkerToLedger(worker, approval.resolvedBy || actor);
    operatingLedger.audit({
      entityType: 'legacy_worker',
      entityId: worker.id,
      action: 'retire_legacy_worker',
      actor: approval.resolvedBy || actor,
      before,
      after: worker,
      metadata: { approvalId: approval.id, ledgerWorkerId: approval.targetId }
    });
    saveState();
    return { type: 'worker_retirement', worker };
  }

  if (targetType === 'tool_retirement' && data.legacyToolId != null) {
    const tool = tools.find(item => String(item.id) === String(data.legacyToolId));
    if (!tool) return null;
    const before = { ...tool };
    Object.assign(tool, {
      status: 'retired',
      assignedJobId: null,
      assignedWorkerId: null,
      retiredAt: timestamp,
      retiredBy: approval.resolvedBy || actor,
      retirementApprovalId: approval.id,
      updatedAt: timestamp
    });
    syncLegacyToolToLedger(tool, approval.resolvedBy || actor);
    operatingLedger.audit({
      entityType: 'legacy_tool',
      entityId: tool.id,
      action: 'retire_legacy_tool',
      actor: approval.resolvedBy || actor,
      before,
      after: tool,
      metadata: { approvalId: approval.id, ledgerToolId: approval.targetId }
    });
    saveState();
    return { type: 'tool_retirement', tool };
  }

  return null;
}

function syncLegacyWorkerToLedger(worker, actor = 'legacy_api') {
  if (!worker) return null;
  const ledgerWorkerId = legacyLedgerWorkerId(worker);
  const ledgerWorker = operatingLedger.upsertWorker({
    ...worker,
    id: ledgerWorkerId,
    legacyId: worker.id,
    role: worker.role || worker.specialty,
    homeRegion: worker.homeRegion || worker.location,
    hourlyRate: worker.hourlyRate
  }, { actor });
  worker.ledgerWorkerId = ledgerWorker.id;
  return ledgerWorker;
}

function syncLegacyToolToLedger(tool, actor = 'legacy_api') {
  if (!tool) return null;
  const ledgerToolId = legacyLedgerToolId(tool);
  const ledgerTool = operatingLedger.upsertTool({
    ...tool,
    id: ledgerToolId,
    legacyId: tool.id,
    homeLocation: tool.homeLocation || tool.currentLocation || tool.location,
    currentLocation: tool.currentLocation || tool.location
  }, { actor });
  tool.ledgerToolId = ledgerTool.id;
  return ledgerTool;
}

function legacyJobToLedgerPayload(job) {
  return {
    ledgerJobId: legacyLedgerJobId(job),
    legacyId: job.id,
    title: job.title || job.service || 'Contractor job',
    service: job.service || job.jobType || job.job_type || job.title || 'contracting',
    jobType: job.jobType || job.job_type || job.service || 'general',
    description: job.description || job.notes || '',
    address: job.address || job.location || '',
    city: job.city || '',
    region: job.region || '',
    country: job.country || 'NL',
    priority: job.priority || 'medium',
    status: job.status || 'pending',
    phase: job.phase || job.status || 'intake',
    estimatedHours: job.estimatedHours || job.estimated_hours || 0,
    estimatedCost: job.estimatedCost || job.estimated_cost || 0,
    contractValue: job.contractValue || job.value || job.estimatedCost || job.estimated_cost || 0,
    progressPercent: job.progress ?? job.progressPercent ?? 0,
    scheduledStart: job.scheduledStart || job.startDate || null,
    scheduledEnd: job.scheduledEnd || job.estimatedCompletion || null,
    targetCompletion: job.estimatedCompletion || null,
    assignAutomatically: false,
    workerId: job.assignedWorkerId ? legacyLedgerWorkerId(job.assignedWorkerId) : null,
    workerName: job.worker || null,
    tools: Array.isArray(job.tools) ? job.tools : Array.isArray(job.requiredTools) ? job.requiredTools : [],
    client: {
      name: job.client || job.client_name || 'Unknown client',
      phone: job.phone || job.client_phone || null,
      email: job.email || job.client_email || null,
      address: job.address || job.location || null,
      country: job.country || 'NL'
    },
    data: {
      legacyId: job.id,
      legacyUpdatedAt: new Date().toISOString()
    }
  };
}

function mirrorLegacyJobToLedger(job, options = {}) {
  if (!job) return null;
  const actor = options.actor || 'legacy_api';
  const ledgerJobId = legacyLedgerJobId(job);
  const existing = ledgerJobId ? operatingLedger.getJobRow(ledgerJobId) : null;
  let detail = existing
    ? operatingLedger.updateJob(ledgerJobId, legacyJobToLedgerPayload(job), { actor })
    : operatingLedger.createIntake(legacyJobToLedgerPayload(job), { actor, jobId: ledgerJobId });
  const detailJobId = detail?.job?.id || detail?.id || ledgerJobId;
  detail = operatingLedger.getJobDetail(detailJobId);

  job.ledgerJobId = detail.id;

  const worker = workers.find(item =>
    String(item.id) === String(job.assignedWorkerId)
    || item.name === job.worker
  );
  if (worker) {
    const ledgerWorker = syncLegacyWorkerToLedger(worker, actor);
    const hasAssignment = detail.assignments.some(assignment => assignment.workerId === ledgerWorker.id);
    if (!hasAssignment) {
      operatingLedger.addAssignment(detail.id, {
        workerId: ledgerWorker.id,
        role: worker.specialty || worker.role || 'Contractor',
        scheduledStart: job.scheduledStart || null,
        scheduledEnd: job.scheduledEnd || null,
        allocationHours: job.estimatedHours || 0
      }, { actor, optional: true });
    }
  }

  const requestedTools = Array.isArray(job.tools) ? job.tools : Array.isArray(job.requiredTools) ? job.requiredTools : [];
  for (const requestedTool of requestedTools) {
    const toolName = typeof requestedTool === 'string' ? requestedTool : requestedTool.name;
    if (!toolName) continue;
    const legacyTool = tools.find(tool => String(tool.name || '').toLowerCase() === String(toolName).toLowerCase());
    const ledgerTool = legacyTool ? syncLegacyToolToLedger(legacyTool, actor) : null;
    detail = operatingLedger.getJobDetail(detail.id);
    const hasReservation = detail.tools.some(reservation => String(reservation.toolName || '').toLowerCase() === String(toolName).toLowerCase());
    if (!hasReservation) {
      operatingLedger.reserveTool(detail.id, {
        toolId: ledgerTool?.id,
        toolName,
        neededFrom: job.scheduledStart || null,
        neededUntil: job.scheduledEnd || null
      }, { actor });
    }
  }

  if (options.progressNote || options.status) {
    operatingLedger.addProgressUpdate(detail.id, {
      status: options.status || job.status || 'note',
      progressPercent: job.progress ?? job.progressPercent ?? 0,
      note: options.progressNote || `Legacy job ${job.id} synchronized.`
    }, { actor });
  }

  if (options.createInvoiceOnComplete) {
    detail = operatingLedger.getJobDetail(detail.id);
    if (!detail.invoices.length) {
      operatingLedger.createInvoice(detail.id, {
        amount: job.actualCost || job.estimatedCost || 0,
        total: job.actualCost || job.estimatedCost || 0,
        notes: 'Drafted from completed legacy job lifecycle.'
      }, { actor });
    }
  }

  return operatingLedger.getJobDetail(job.ledgerJobId);
}

function resolveJobDetailForApiRoute(jobId, actor = 'legacy_jobs_api') {
  const legacyJob = findJob(jobId);
  if (legacyJob) {
    return mirrorLegacyJobToLedger(legacyJob, { actor });
  }
  return operatingLedger.getJobDetail(jobId, { includeAudit: true });
}

function resolveUploadLedgerJobDetail(payload = {}, actor = 'upload_api') {
  const explicitLedgerJobId = payload.ledgerJobId || payload.ledger_job_id || null;
  if (explicitLedgerJobId) {
    return operatingLedger.getJobDetail(explicitLedgerJobId);
  }

  const submittedJobId = payload.jobId || payload.job_id || null;
  if (!submittedJobId) return null;

  const legacyJob = findJob(submittedJobId);
  if (legacyJob) {
    return mirrorLegacyJobToLedger(legacyJob, { actor });
  }

  try {
    return operatingLedger.getJobDetail(submittedJobId);
  } catch {
    const fallbackLedgerId = legacyLedgerJobId(submittedJobId);
    if (fallbackLedgerId && fallbackLedgerId !== String(submittedJobId)) {
      try {
        return operatingLedger.getJobDetail(fallbackLedgerId);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function createLedgerUploadFollowUps(ledgerDetail, ledgerDocument, payload = {}, analysis = {}) {
  if (!ledgerDetail?.id || !ledgerDocument?.id) {
    return { records: {}, actions: [] };
  }

  const filename = ledgerDocument.filename || payload.filename || payload.name || 'uploaded evidence';
  const notes = String(payload.notes || payload.observation || payload.description || analysis.summary || '').trim();
  const evidenceRef = ledgerDocument.storageRef || ledgerDocument.filename || ledgerDocument.id;
  const photos = ledgerDocument.type === 'photo' ? [evidenceRef].filter(Boolean) : [];
  const records = {};
  const actions = [];

  records.progress = operatingLedger.addProgressUpdate(ledgerDetail.id, {
    progressPercent: ledgerDetail.progressPercent || ledgerDetail.progress || 0,
    note: `Uploaded evidence recorded: ${filename}. ${analysis.summary || notes}`.trim(),
    photos,
    source: 'upload_evidence'
  }, { actor: 'upload_api' });
  actions.push({ type: 'record_ledger_progress_evidence', id: records.progress.id, message: 'Ledger progress evidence recorded.' });

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

function createLegacyJobSubresourceAlias(route, responseKey, createRecord, successStatus = 201) {
  app.post(`/api/jobs/:id/${route}`, (req, res) => {
    return handleLedgerRequest(req, res, () => {
      const actor = req.body?.actor || 'legacy_jobs_api';
      const detail = resolveJobDetailForApiRoute(req.params.id, actor);
      const record = createRecord(detail.id, req.body || {}, actor);
      const job = operatingLedger.getJobDetail(detail.id, { includeAudit: true });
      return {
        success: true,
        [responseKey]: record,
        job: mapLedgerJobForLegacy(job),
        ledgerJob: job,
        dashboard: operatingLedger.dashboardSummary()
      };
    }, successStatus);
  });
}

function mapLedgerJobForLegacy(jobOrDetail) {
  const detail = Array.isArray(jobOrDetail?.tasks) || Array.isArray(jobOrDetail?.invoices) ? jobOrDetail : null;
  const job = detail || jobOrDetail;
  const client = detail?.client || {};
  return {
    id: job.id,
    ledgerJobId: job.id,
    source: 'ledger',
    title: job.title,
    client: client.name || job.clientName || 'Client',
    client_name: client.name || job.clientName || 'Client',
    client_phone: client.phone || job.clientPhone || '',
    client_email: client.email || job.clientEmail || '',
    address: job.address,
    location: job.address || job.city || '',
    description: job.description,
    service: job.jobType,
    jobType: job.jobType,
    status: job.status,
    priority: job.priority,
    progress: job.progressPercent,
    estimatedCost: job.estimatedCost,
    actualCost: detail?.expenses?.reduce((sum, expense) => sum + Number(expense.amount || 0), 0) || 0,
    estimatedHours: job.estimatedHours,
    startDate: job.scheduledStart ? String(job.scheduledStart).slice(0, 10) : null,
    scheduledStart: job.scheduledStart,
    scheduledEnd: job.scheduledEnd,
    estimatedCompletion: job.targetCompletion || job.scheduledEnd,
    worker: detail?.assignments?.[0]?.workerName || null,
    tools: detail?.tools?.map(tool => tool.toolName) || [],
    ledger: detail || { job }
  };
}

function mapLedgerWorkerForLegacy(worker) {
  const data = worker?.data || {};
  return {
    id: worker.id,
    ledgerWorkerId: worker.id,
    legacyId: data.legacyId || null,
    source: 'ledger',
    name: worker.name,
    specialty: worker.role || (worker.skills || [])[0] || 'General Maintenance',
    specialties: worker.skills || [],
    skills: worker.skills || [],
    status: worker.status,
    location: worker.homeRegion || 'Unassigned',
    rating: Number(data.rating || 5),
    completedJobs: Number(data.completedJobs || 0),
    hourlyRate: Number(worker.hourlyRate || 0),
    currentJob: data.currentJob || null,
    currentJobId: data.currentJobId || null,
    ledger: worker
  };
}

function mapLedgerToolForLegacy(tool) {
  const data = tool?.data || {};
  return {
    id: tool.id,
    ledgerToolId: tool.id,
    legacyId: data.legacyId || null,
    source: 'ledger',
    name: tool.name,
    category: tool.category || 'general',
    status: tool.status,
    currentLocation: tool.currentLocation || tool.homeLocation || 'Warehouse',
    homeLocation: tool.homeLocation || tool.currentLocation || 'Warehouse',
    returnDate: data.returnDate || null,
    assignedJobId: data.assignedJobId || null,
    assignedWorkerId: data.assignedWorkerId || null,
    ledger: tool
  };
}

const LEGACY_JOB_ARCHIVE_STATUSES = new Set(['archived', 'pending_archive_approval']);
const LEGACY_JOB_INACTIVE_STATUSES = new Set([
  'archived',
  'pending_archive_approval',
  'cancelled',
  'canceled',
  'rejected',
  'deleted',
  'void'
]);

function normalizeLegacyJobStatus(value, fallback = 'pending') {
  return String(value || fallback).trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function booleanQuery(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function isArchivedLegacyJob(job) {
  return LEGACY_JOB_ARCHIVE_STATUSES.has(normalizeLegacyJobStatus(job?.status));
}

function isInactiveLegacyJob(job) {
  return LEGACY_JOB_INACTIVE_STATUSES.has(normalizeLegacyJobStatus(job?.status));
}

function findLedgerWorkerForLegacyRoute(workerId) {
  const directId = String(workerId || '').trim();
  if (!directId) return null;
  const candidateIds = new Set([directId, legacyLedgerWorkerId(directId)].filter(Boolean));
  return operatingLedger.listWorkers({ limit: 500 })
    .find(worker => candidateIds.has(String(worker.id))) || null;
}

function findLedgerToolForLegacyRoute(toolId) {
  const directId = String(toolId || '').trim();
  if (!directId) return null;
  const candidateIds = new Set([directId, legacyLedgerToolId(directId)].filter(Boolean));
  return operatingLedger.listTools({ limit: 500 })
    .find(tool => candidateIds.has(String(tool.id))) || null;
}

function mergedLegacyAndLedgerJobs(filters = {}) {
  const requestedStatus = normalizeLegacyJobStatus(filters.status || '', '');
  const archiveOnly = ['archive', 'archives', 'archived'].includes(requestedStatus);
  const includeArchived = archiveOnly || booleanQuery(filters.includeArchived ?? filters.include_archived, false);
  const status = archiveOnly ? '' : requestedStatus;
  const priority = String(filters.priority || '').trim().toLowerCase();
  const search = String(filters.search || '').trim().toLowerCase();
  const filteredJobs = jobs.filter(job => {
    const jobStatus = normalizeLegacyJobStatus(job.status);
    if (archiveOnly && !isArchivedLegacyJob(job)) return false;
    if (!includeArchived && isInactiveLegacyJob(job)) return false;
    if (status && jobStatus !== status) return false;
    if (priority && String(job.priority || '').toLowerCase() !== priority) return false;
    if (search && !JSON.stringify(job).toLowerCase().includes(search)) return false;
    return true;
  });
  const representedLedgerIds = new Set(filteredJobs.map(job => legacyLedgerJobId(job)).filter(Boolean));
  const ledgerJobs = operatingLedger.listJobs({
    status,
    search,
    limit: 500,
    includeArchived,
    archiveOnly
  })
    .filter(job => !representedLedgerIds.has(job.id))
    .filter(job => !priority || String(job.priority || '').toLowerCase() === priority)
    .map(job => mapLedgerJobForLegacy(job));
  return [...filteredJobs, ...ledgerJobs];
}

function mergedLegacyAndLedgerWorkers(filters = {}) {
  const status = String(filters.status || '').trim().toLowerCase();
  const search = String(filters.search || '').trim().toLowerCase();
  const filteredWorkers = workers.filter(worker => {
    if (status && String(worker.status || '').toLowerCase() !== status) return false;
    if (search && !JSON.stringify(worker).toLowerCase().includes(search)) return false;
    return true;
  });
  const representedLedgerIds = new Set(filteredWorkers.map(worker => legacyLedgerWorkerId(worker)).filter(Boolean));
  const ledgerWorkers = operatingLedger.listWorkers({ status, search, limit: 500 })
    .filter(worker => !representedLedgerIds.has(worker.id))
    .map(worker => mapLedgerWorkerForLegacy(worker));
  return [...filteredWorkers, ...ledgerWorkers];
}

function mergedLegacyAndLedgerTools(filters = {}) {
  const status = String(filters.status || '').trim().toLowerCase();
  const search = String(filters.search || '').trim().toLowerCase();
  const filteredTools = tools.filter(tool => {
    if (status && String(tool.status || '').toLowerCase() !== status) return false;
    if (search && !JSON.stringify(tool).toLowerCase().includes(search)) return false;
    return true;
  });
  const representedLedgerIds = new Set(filteredTools.map(tool => legacyLedgerToolId(tool)).filter(Boolean));
  const ledgerTools = operatingLedger.listTools({ status, search, limit: 500 })
    .filter(tool => !representedLedgerIds.has(tool.id))
    .map(tool => mapLedgerToolForLegacy(tool));
  return [...filteredTools, ...ledgerTools];
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes
app.get('/api/dashboard', (req, res) => {
  const ledgerJobs = operatingLedger.listJobs({ limit: 500 }).map(mapLedgerJobForLegacy);
  const ledgerWorkers = operatingLedger.listWorkers({ limit: 500 }).map(mapLedgerWorkerForLegacy);
  const ledgerTools = operatingLedger.listTools({ limit: 500 }).map(mapLedgerToolForLegacy);
  const ledgerSummary = operatingLedger.dashboardSummary();
  const weather = operatingLedger.weatherOverview();
  const criticalJobs = ledgerJobs.filter(job => job.priority === 'critical').length;
  const aiHandling = ledgerJobs.filter(job => job.status === 'in_progress').length;
  const ledgerInsights = (ledgerSummary.nextActions || []).slice(0, 8).map(action => ({
    title: action.label || action.type || 'Ledger action',
    description: action.message || 'A persisted contractor record needs review.',
    confidence: 'ledger',
    actionType: action.type || null,
    requiresApproval: action.requiresApproval === true,
    jobId: action.jobId || null
  }));

  res.json({
    apiVersion: '1.1.0',
    source: 'node',
    dashboardSource: 'ledger',
    metrics: {
      criticalJobs,
      aiHandling,
      todayRevenue: 0,
      onTimeRate: null,
      ledgerOnly: true
    },
    jobs: ledgerJobs,
    workers: ledgerWorkers,
    tools: ledgerTools,
    ledgerJobs,
    ledgerWorkers,
    ledgerTools,
    construction: {
      summary: constructionSummary(),
      data: construction,
      capabilities: constructionCapabilities(),
      operatingCatalog: buildContractorOperatingCatalog()
    },
    ledger: ledgerSummary,
    weather,
    aiInsights: ledgerInsights
  });
});

app.get('/api/ledger/dashboard', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    dashboard: operatingLedger.dashboardSummary()
  }));
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
  return handleLedgerRequest(req, res, () => {
    const payload = req.body || {};
    const mode = String(payload.mode || payload.action || 'apply').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const result = mode === 'preview'
      ? operatingLedger.buildTodayCommandPlan(payload)
      : operatingLedger.applyTodayCommandPlan(payload, { actor: payload.actor || 'dashboard' });
    return {
      success: true,
      ...result,
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
    jobs: operatingLedger.listJobs(req.query || {}),
    dashboard: operatingLedger.dashboardSummary()
  }));
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
    job: operatingLedger.getJobDetail(req.params.id, { includeAudit: true })
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
      : operatingLedger.applyJobCapabilityPlan(req.params.id, payload, { actor: payload.actor || 'dashboard' });
    return {
      success: true,
      ...result,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/ledger/jobs/:id/tasks', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    task: operatingLedger.addTask(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
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

app.post('/api/ledger/jobs/:id/field-reports', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    fieldReport: operatingLedger.createFieldReport(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/rfis', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    rfi: operatingLedger.createRfi(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/submittals', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    submittal: operatingLedger.createSubmittalRecord(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
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

app.post('/api/ledger/jobs/:id/inspections', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    inspection: operatingLedger.createInspectionRecord(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/observations', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    observation: operatingLedger.createObservationRecord(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/incidents', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    incident: operatingLedger.createIncidentRecord(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/safety-meetings', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    safetyMeeting: operatingLedger.createSafetyMeeting(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
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
    jha: operatingLedger.createJhaRecord(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/sds-sheets', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    sdsSheet: operatingLedger.createSdsSheet(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/site-access', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    siteAccessLog: operatingLedger.createSiteAccessLog(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
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

app.post('/api/ledger/jobs/:id/tools', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    toolReservation: operatingLedger.reserveTool(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/tools/:reservationId/release', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    toolReservation: operatingLedger.releaseToolReservation(req.params.id, req.params.reservationId, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/ledger/jobs/:id/materials', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    materialRequirement: operatingLedger.addMaterialRequirement(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
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

app.get('/api/ledger/finance', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.listFinanceReadiness(req.query || {}),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.get('/api/ledger/client-success', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.listClientSuccess(req.query || {}),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/ledger/jobs/:id/progress', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    progress: operatingLedger.addProgressUpdate(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/communication', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    communication: operatingLedger.addCommunication(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
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

app.post('/api/ledger/jobs/:id/documents', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    document: operatingLedger.addDocument(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/time-logs', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    timeLog: operatingLedger.addTimeLog(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/expenses', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    expense: operatingLedger.addExpense(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
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
    safetyCheck: operatingLedger.addSafetyCheck(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
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

app.post('/api/ledger/jobs/:id/budget-lines', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    budgetLine: operatingLedger.createBudgetLine(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
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

app.post('/api/ledger/jobs/:id/punch-items', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    punchItem: operatingLedger.createPunchItem(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/warranty-claims', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    warrantyClaim: operatingLedger.createWarrantyClaim(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/ledger/jobs/:id/aftercare', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    aftercare: operatingLedger.addAftercareItem(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    job: operatingLedger.getJobDetail(req.params.id),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.patch('/api/ledger/jobs/:id/lifecycle/:recordType/:recordId', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const result = operatingLedger.transitionLifecycleRecord(
      req.params.id,
      req.params.recordType,
      req.params.recordId,
      req.body || {},
      { actor: req.body?.actor || 'dashboard' }
    );
    return {
      success: true,
      record: result.record,
      approval: result.approval,
      approvalRequired: result.approvalRequired,
      job: operatingLedger.getJobDetail(req.params.id, { includeAudit: true }),
      dashboard: operatingLedger.dashboardSummary()
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

app.get('/api/ledger/approvals', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    approvals: operatingLedger.listApprovals(req.query || {})
  }));
});

app.post('/api/ledger/approvals/:id/resolve', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const approval = operatingLedger.resolveApproval(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' });
    const sideEffect = applyServerApprovalSideEffects(approval, req.body?.actor || 'dashboard');
    return {
      success: true,
      approval,
      sideEffect,
      dashboard: operatingLedger.dashboardSummary()
    };
  });
});

app.get('/api/ledger/audit', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    events: operatingLedger.listAudit(req.query || {})
  }));
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
  return handleLedgerRequest(req, res, () => operatingLedger.runAutonomousCycle(req.body || {}));
});

app.get('/api/ledger/debug', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    diagnostics: operatingLedger.diagnose(),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.get('/api/ledger/workers', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    workers: operatingLedger.listWorkers(req.query || {}),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/ledger/workers', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    worker: operatingLedger.upsertWorker(req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.put('/api/ledger/workers/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    worker: operatingLedger.upsertWorker({ ...(req.body || {}), id: req.params.id }, { actor: req.body?.actor || 'dashboard' }),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.delete('/api/ledger/workers/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const retirement = operatingLedger.requestWorkerRetirement(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' });
    if (!retirement) {
      const error = new Error('Worker not found');
      error.statusCode = 404;
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
});

app.get('/api/ledger/tools', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    tools: operatingLedger.listTools(req.query || {}),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/ledger/tools', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    tool: operatingLedger.upsertTool(req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.put('/api/ledger/tools/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    tool: operatingLedger.upsertTool({ ...(req.body || {}), id: req.params.id }, { actor: req.body?.actor || 'dashboard' }),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.delete('/api/ledger/tools/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const retirement = operatingLedger.requestToolRetirement(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' });
    if (!retirement) {
      const error = new Error('Tool not found');
      error.statusCode = 404;
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
});

app.get('/api/clients', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    clients: operatingLedger.listClients(req.query || {})
  }));
});

app.post('/api/clients', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    client: operatingLedger.findOrCreateClient(req.body || {}, { actor: req.body?.actor || 'dashboard' })
  }), 201);
});

app.put('/api/clients/:id', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    client: operatingLedger.updateClient(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' })
  }));
});

app.get('/api/approvals', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    approvals: operatingLedger.listApprovals(req.query || {})
  }));
});

app.post('/api/approvals/:id/resolve', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const approval = operatingLedger.resolveApproval(req.params.id, req.body || {}, { actor: req.body?.actor || 'dashboard' });
    const sideEffect = applyServerApprovalSideEffects(approval, req.body?.actor || 'dashboard');
    return {
      success: true,
      approval,
      sideEffect,
      dashboard: operatingLedger.dashboardSummary()
    };
  });
});

app.get('/api/audit', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    events: operatingLedger.listAudit(req.query || {})
  }));
});

app.get('/api/communication', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    communications: operatingLedger.listCommunications(req.query || {}),
    summary: operatingLedger.communicationSummary(),
    dashboard: operatingLedger.dashboardSummary()
  }));
});

app.post('/api/communication', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const payload = req.body || {};
    const detail = resolveUploadLedgerJobDetail(payload, 'communication_api');
    if (!detail?.id) {
      const error = new Error('A valid jobId or ledgerJobId is required to record communication');
      error.statusCode = 400;
      throw error;
    }

    const direction = String(payload.direction || 'outbound').trim().toLowerCase();
    const outbound = direction !== 'inbound';
    const communicationPayload = outbound
      ? {
          ...payload,
          direction: 'outbound',
          status: 'draft',
          sentAt: null,
          sent_at: null,
          requiresApproval: true
        }
      : {
          ...payload,
          direction: 'inbound',
          status: 'received',
          requiresApproval: false
        };
    const communication = operatingLedger.addCommunication(detail.id, communicationPayload, { actor: payload.actor || 'communication_api' });

    return {
      success: true,
      communication,
      job: operatingLedger.getJobDetail(detail.id),
      deliveryMode: outbound ? 'draft_only' : 'record_only',
      notSent: outbound,
      approvalRequired: outbound,
      approval: communication.approval || null,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/weather/assess', (req, res) => {
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

app.post('/api/schedule/recommend', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    recommendation: operatingLedger.recommendSchedule(req.body?.jobId || req.body?.job_id, req.body || {}, { actor: req.body?.actor || 'dashboard' })
  }));
});

app.post('/api/schedule/prepare-dispatch', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.prepareScheduleDispatch(req.body?.jobId || req.body?.job_id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.post('/api/schedule/request-approval', (req, res) => {
  return handleLedgerRequest(req, res, () => ({
    success: true,
    ...operatingLedger.requestScheduleApproval(req.body?.jobId || req.body?.job_id, req.body || {}, { actor: req.body?.actor || 'dashboard' }),
    dashboard: operatingLedger.dashboardSummary()
  }), 201);
});

app.get('/api/construction', (req, res) => {
  res.json({
    collections: CONSTRUCTION_COLLECTIONS,
    workflows: CONSTRUCTION_WORKFLOWS,
    workflowRuns: construction.workflowRuns || [],
    summary: constructionSummary(),
    data: construction,
    capabilities: constructionCapabilities(),
    operatingCatalog: buildContractorOperatingCatalog()
  });
});

app.post('/api/construction/autonomous-review', (req, res) => {
  const result = runConstructionAutopilot();
  saveState();
  res.json(result);
});

app.post('/api/operations/cycle', (req, res) => {
  const payload = req.body || {};
  const maxActions = Math.max(1, Math.min(25, Number(payload.maxActions || 8)));
  const jobCycle = operatingLedger.runAutonomousCycle({
    actor: payload.actor || 'operations_cycle',
    maxActions,
    jobIds: payload.jobIds || payload.job_ids,
    actionTypes: payload.actionTypes || payload.action_types
  });
  const constructionReview = runConstructionAutopilot();
  const capabilityGapPlan = buildContractorCapabilityGapPlan();
  const ledgerMetrics = jobCycle.dashboard?.metrics || {};
  const summary = {
    jobActions: jobCycle.applied?.length || 0,
    jobAlerts: jobCycle.blocked?.length || 0,
    jobInsights: jobCycle.preview?.length || 0,
    constructionActions: constructionReview.actions?.length || 0,
    constructionInsights: constructionReview.insights?.length || 0,
    pendingJobs: ledgerMetrics.openJobs || 0,
    scheduledJobs: Number(operatingLedger.listJobs({ status: 'scheduled' }).length || 0),
    inProgressJobs: Number(operatingLedger.listJobs({ status: 'in_progress' }).length || 0),
    activeProjects: constructionReview.summary?.activeProjects || 0,
    openRfis: constructionReview.summary?.openRfis || 0,
    openSafetyActions: constructionReview.summary?.openSafetyActions || 0,
    openComplianceItems: constructionReview.summary?.openComplianceItems || 0,
    capabilityCoverage: capabilityGapPlan.summary.averageCoverage,
    capabilityGaps: capabilityGapPlan.summary.missingModules,
    recommendedCapabilityVendor: capabilityGapPlan.summary.topRecommendation?.vendor || null
  };

  saveState();
  res.json({
    success: true,
    ranAt: new Date().toISOString(),
    source: 'server',
    summary,
    jobCycle,
    constructionReview,
    capabilityGapPlan,
    capabilities: constructionCapabilities()
  });
});

app.post('/api/construction/actions/batch', (req, res) => {
  const payload = req.body || {};
  const requested = Array.isArray(payload.actions) ? payload.actions : [];
  const limit = Math.max(1, Math.min(10, Number(payload.limit || requested.length || 1)));
  const results = [];
  const errors = [];

  requested.slice(0, limit).forEach((item, index) => {
    const collection = String(item.collection || '');
    const id = item.id;
    if (!CONSTRUCTION_COLLECTIONS.includes(collection)) {
      errors.push({ index, collection, id, error: 'Unknown construction collection' });
      return;
    }

    const record = (construction[collection] || []).find(candidate => String(candidate.id) === String(id));
    if (!record) {
      errors.push({ index, collection, id, error: 'Construction record not found' });
      return;
    }

    const targetStatus = String(item.status || completeConstructionStatus(collection));
    const previousStatus = record.status || record.riskLevel || record.priority || 'open';
    const result = createConstructionActionArtifacts(collection, record, previousStatus, targetStatus, item.payload || {});
    results.push({
      success: true,
      collection,
      id: record.id,
      record,
      previousStatus,
      status: targetStatus,
      records: result.records,
      actions: result.actions
    });
  });

  saveState();
  res.json({
    success: errors.length === 0,
    requested: requested.length,
    executed: results.length,
    failed: errors.length,
    results,
    errors,
    summary: constructionSummary(),
    capabilities: constructionCapabilities()
  });
});

app.get('/api/construction/workflows', (req, res) => {
  res.json({
    workflows: CONSTRUCTION_WORKFLOWS,
    workflowRuns: construction.workflowRuns || [],
    summary: constructionSummary(),
    capabilities: constructionCapabilities()
  });
});

app.get('/api/construction/capability-gaps', (req, res) => {
  res.json({
    success: true,
    blueprint: CONTRACTOR_SUITE_BLUEPRINT,
    plan: buildContractorCapabilityGapPlan(),
    summary: constructionSummary(),
    capabilities: constructionCapabilities()
  });
});

app.get('/api/construction/market-map', (req, res) => {
  res.json({
    success: true,
    marketMap: buildContractorMarketMap()
  });
});

app.get('/api/construction/operating-catalog', (req, res) => {
  res.json({
    success: true,
    catalog: buildContractorOperatingCatalog()
  });
});

app.post('/api/construction/capability-gaps/run', (req, res) => {
  const payload = req.body || {};
  const vendor = getContractorSuiteVendor(payload.vendor ?? payload.vendorIndex ?? payload.index);
  if (!vendor) {
    return res.status(404).json({ error: 'Unknown contractor suite vendor' });
  }

  const vendorCoverage = buildContractorSuiteVendorCoverage(construction)
    .find(item => item.vendor === vendor.vendor);
  const force = payload.force === true;
  const requestedModules = Array.isArray(payload.modules) && payload.modules.length
    ? payload.modules
    : vendorCoverage?.missingModules || [];
  const modules = requestedModules
    .map(module => String(module || ''))
    .filter(module => CONSTRUCTION_COLLECTIONS.includes(module) && vendor.modules.includes(module));
  const limit = Math.max(1, Math.min(50, Number(payload.limit || modules.length || 1)));
  const selected = modules
    .filter(module => force || !(construction[module] || []).length)
    .slice(0, limit);
  const skipped = modules.filter(module => !selected.includes(module));
  const records = selected.map(module => {
    const record = addConstructionRecord(module, buildCapabilityGapRecord(vendor, module, payload));
    return {
      collection: module,
      id: record.id,
      title: record.title || record.name || record.subject || record.package || record.vendor || `${collectionLabel(module)} #${record.id}`,
      status: record.status,
      sourceVendor: record.sourceVendor
    };
  });

  const review = payload.runReview === true ? runConstructionAutopilot() : null;
  saveState();
  res.json({
    success: true,
    vendor: vendor.vendor,
    created: records.length,
    records,
    skipped,
    review,
    summary: constructionSummary(),
    capabilities: constructionCapabilities(),
    gapPlan: buildContractorCapabilityGapPlan()
  });
});

app.post('/api/construction/workflows/:workflowKey/run', (req, res) => {
  try {
    const result = createConstructionWorkflowRecords(req.params.workflowKey, req.body || {});
    saveState();
    res.json(result);
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ error: error.message });
    }
    throw error;
  }
});

app.get('/api/construction/:collection', (req, res) => {
  const { collection } = req.params;
  if (!CONSTRUCTION_COLLECTIONS.includes(collection)) {
    return res.status(404).json({ error: 'Unknown construction collection' });
  }

  res.json({
    collection,
    records: construction[collection] || [],
    summary: constructionSummary()
  });
});

app.post('/api/construction/:collection', (req, res) => {
  const { collection } = req.params;
  if (!CONSTRUCTION_COLLECTIONS.includes(collection)) {
    return res.status(404).json({ error: 'Unknown construction collection' });
  }

  const now = new Date().toISOString();
  const record = {
    ...(req.body || {}),
    id: collectionNextId(collection),
    createdAt: now,
    updatedAt: now
  };

  construction[collection].unshift(record);
  saveState();
  res.status(201).json({
    collection,
    record,
    summary: constructionSummary()
  });
});

app.put('/api/construction/:collection/:id', (req, res) => {
  const { collection, id } = req.params;
  if (!CONSTRUCTION_COLLECTIONS.includes(collection)) {
    return res.status(404).json({ error: 'Unknown construction collection' });
  }

  const records = construction[collection] || [];
  const index = records.findIndex(record => String(record.id) === String(id));
  if (index === -1) {
    return res.status(404).json({ error: 'Construction record not found' });
  }

  records[index] = {
    ...records[index],
    ...(req.body || {}),
    id: records[index].id,
    updatedAt: new Date().toISOString()
  };
  saveState();
  res.json({
    collection,
    record: records[index],
    summary: constructionSummary()
  });
});

app.post('/api/construction/:collection/:id/action', (req, res) => {
  const { collection, id } = req.params;
  if (!CONSTRUCTION_COLLECTIONS.includes(collection)) {
    return res.status(404).json({ error: 'Unknown construction collection' });
  }

  const records = construction[collection] || [];
  const record = records.find(item => String(item.id) === String(id));
  if (!record) {
    return res.status(404).json({ error: 'Construction record not found' });
  }

  const payload = req.body || {};
  const targetStatus = String(payload.status || completeConstructionStatus(collection));
  const previousStatus = record.status || record.riskLevel || record.priority || 'open';
  const result = createConstructionActionArtifacts(collection, record, previousStatus, targetStatus, payload);
  saveState();
  res.json({
    success: true,
    collection,
    record,
    previousStatus,
    status: targetStatus,
    records: result.records,
    actions: result.actions,
    summary: constructionSummary(),
    capabilities: constructionCapabilities()
  });
});

app.delete('/api/construction/:collection/:id', (req, res) => {
  const { collection, id } = req.params;
  if (!CONSTRUCTION_COLLECTIONS.includes(collection)) {
    return res.status(404).json({ error: 'Unknown construction collection' });
  }

  try {
    const result = requestConstructionArchive(collection, id, {
      ...(req.body || {}),
      reason: req.body?.reason || req.query?.reason
    }, { actor: req.body?.actor || 'construction_api' });
    res.json({
      success: true,
      collection,
      deleted: false,
      retained: true,
      status: result.alreadyArchived ? 'archived' : 'pending_approval',
      alreadyPending: Boolean(result.alreadyPending),
      alreadyArchived: Boolean(result.alreadyArchived),
      message: result.alreadyArchived
        ? 'Construction record is already archived and retained.'
        : result.alreadyPending
          ? 'Construction record archive approval is already pending.'
          : 'Construction record retained. Archive requires explicit approval before it is applied.',
      record: result.record,
      approval: result.approval || null,
      summary: constructionSummary(),
      capabilities: constructionCapabilities()
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return sendError(
      req,
      res,
      statusCode,
      statusCode === 404 ? 'not_found' : 'construction_delete_error',
      error.message || 'Construction delete request failed',
      serializeError(error)
    );
  }
});

app.get('/api/jobs', (req, res) => {
  res.json(mergedLegacyAndLedgerJobs(req.query || {}));
});

app.get('/api/jobs/:id', (req, res) => {
  const job = findJob(req.params.id);
  if (job) {
    return res.json(job);
  }

  return handleLedgerRequest(req, res, () => {
    const detail = operatingLedger.getJobDetail(req.params.id, { includeAudit: true });
    return mapLedgerJobForLegacy(detail);
  });
});

app.post('/api/jobs', (req, res) => {
  const jobData = req.body || {};
  if (!jobData.title || !jobData.client) {
    return res.status(400).json({ error: 'Job title and client are required' });
  }

  const newJob = {
    ...autonomousEngine.createJobFromRequest(jobData, currentState()),
    ...jobData,
    id: Math.max(0, ...jobs.map(job => Number(job.id) || 0)) + 1,
    status: jobData.status || 'pending',
    progress: Number(jobData.progress || 0),
    actualCost: Number(jobData.actualCost || 0)
  };

  const ledgerDetail = mirrorLegacyJobToLedger(newJob, {
    actor: 'legacy_jobs_api',
    progressNote: 'Legacy job created and mirrored into the operating ledger.'
  });
  newJob.ledgerJobId = ledgerDetail.id;
  jobs.push(newJob);
  saveState();
  res.status(201).json(newJob);
});

app.put('/api/jobs/:id', (req, res) => {
  const jobId = req.params.id;
  const jobIndex = jobs.findIndex(job => String(job.id) === String(jobId));
  if (jobIndex === -1) {
    return handleLedgerRequest(req, res, () => {
      const result = operatingLedger.updateJobWithApproval(jobId, req.body || {}, { actor: req.body?.actor || 'legacy_jobs_api' });
      return {
        success: true,
        ...mapLedgerJobForLegacy(result.job),
        operationStatus: result.status,
        requiresApproval: result.requiresApproval,
        reasons: result.reasons,
        proposedPatch: result.proposedPatch,
        approval: result.approval || null,
        ledger: result.job,
        dashboard: operatingLedger.dashboardSummary()
      };
    });
  }
  const updates = { ...(req.body || {}) };
  delete updates.id;
  const existingJob = jobs[jobIndex];
  const previousWorkerName = existingJob.worker;
  const updatedJob = {
    ...existingJob,
    ...updates,
    id: existingJob.id,
    progress: Math.max(0, Math.min(100, Number(updates.progress ?? existingJob.progress ?? 0)))
  };
  jobs[jobIndex] = updatedJob;

  if (updates.worker !== undefined && updates.worker !== previousWorkerName) {
    const previousWorker = workers.find(worker => worker.name === previousWorkerName);
    autonomousEngine.releaseWorkerFromJob(previousWorker, existingJob);
    const nextWorker = workers.find(worker => worker.name === updates.worker);
    if (nextWorker) {
      updatedJob.assignedWorkerId = nextWorker.id;
      nextWorker.status = 'active';
      nextWorker.currentJob = updatedJob.title;
      nextWorker.currentJobId = updatedJob.id;
    } else {
      updatedJob.assignedWorkerId = null;
    }
  }

  if (updatedJob.status === 'completed' && existingJob.status !== 'completed') {
    updatedJob.progress = 100;
    releaseJobResources(updatedJob);
  }
  mirrorLegacyJobToLedger(updatedJob, {
    actor: 'legacy_jobs_api',
    status: updatedJob.status,
    progressNote: 'Legacy job update synchronized into the operating ledger.',
    createInvoiceOnComplete: updatedJob.status === 'completed'
  });
  saveState();
  res.json(jobs[jobIndex]);
});

app.delete('/api/jobs/:id', (req, res) => {
  const jobId = req.params.id;
  const jobIndex = jobs.findIndex(job => String(job.id) === String(jobId));
  if (jobIndex === -1) {
    return handleLedgerRequest(req, res, () => {
      const result = operatingLedger.updateJobWithApproval(jobId, {
        status: 'cancelled',
        reason: req.body?.reason || req.query?.reason || 'Legacy-compatible delete requested. Ledger records are retained and cancellation requires approval.'
      }, { actor: req.body?.actor || 'legacy_jobs_api' });
      return {
        success: true,
        deleted: false,
        retained: true,
        message: 'Ledger jobs are retained; cancellation is routed through the approval gate.',
        job: mapLedgerJobForLegacy(result.job),
        operationStatus: result.status,
        requiresApproval: result.requiresApproval,
        reasons: result.reasons,
        proposedPatch: result.proposedPatch,
        approval: result.approval || null,
        ledger: result.job,
        dashboard: operatingLedger.dashboardSummary()
      };
    });
  }

  try {
    const result = requestLegacyJobArchive(jobs[jobIndex], {
      ...(req.body || {}),
      reason: req.body?.reason || req.query?.reason
    }, { actor: req.body?.actor || 'legacy_jobs_api' });
    res.json({
      success: true,
      deleted: false,
      retained: true,
      status: result.alreadyArchived ? 'archived' : 'pending_approval',
      alreadyPending: Boolean(result.alreadyPending),
      alreadyArchived: Boolean(result.alreadyArchived),
      message: result.alreadyArchived
        ? 'Job is already archived and retained.'
        : result.alreadyPending
          ? 'Job archive approval is already pending.'
          : 'Job retained. Archive requires explicit approval before it is applied.',
      job: result.job,
      approval: result.approval || null,
      dashboard: operatingLedger.dashboardSummary()
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return sendError(
      req,
      res,
      statusCode,
      statusCode === 404 ? 'not_found' : 'legacy_job_delete_error',
      error.message || 'Job delete request failed',
      serializeError(error)
    );
  }
});

app.post('/api/jobs/:id/tasks', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const detail = resolveJobDetailForApiRoute(req.params.id, req.body?.actor || 'legacy_jobs_api');
    const task = operatingLedger.addTask(detail.id, req.body || {}, { actor: req.body?.actor || 'legacy_jobs_api' });
    const job = operatingLedger.getJobDetail(detail.id, { includeAudit: true });
    return {
      success: true,
      task,
      job: mapLedgerJobForLegacy(job),
      ledgerJob: job,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/jobs/:id/quote', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const detail = resolveJobDetailForApiRoute(req.params.id, req.body?.actor || 'legacy_jobs_api');
    const quote = operatingLedger.createQuote(detail.id, req.body || {}, { actor: req.body?.actor || 'legacy_jobs_api' });
    const job = operatingLedger.getJobDetail(detail.id, { includeAudit: true });
    return {
      success: true,
      quote,
      job: mapLedgerJobForLegacy(job),
      ledgerJob: job,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/jobs/:id/assignments', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const detail = resolveJobDetailForApiRoute(req.params.id, req.body?.actor || 'legacy_jobs_api');
    const assignment = operatingLedger.addAssignment(detail.id, req.body || {}, { actor: req.body?.actor || 'legacy_jobs_api', optional: false });
    const job = operatingLedger.getJobDetail(detail.id, { includeAudit: true });
    return {
      success: true,
      assignment,
      job: mapLedgerJobForLegacy(job),
      ledgerJob: job,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/jobs/:id/tools', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const detail = resolveJobDetailForApiRoute(req.params.id, req.body?.actor || 'legacy_jobs_api');
    const toolReservation = operatingLedger.reserveTool(detail.id, req.body || {}, { actor: req.body?.actor || 'legacy_jobs_api' });
    const job = operatingLedger.getJobDetail(detail.id, { includeAudit: true });
    return {
      success: true,
      toolReservation,
      job: mapLedgerJobForLegacy(job),
      ledgerJob: job,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/jobs/:id/materials', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const detail = resolveJobDetailForApiRoute(req.params.id, req.body?.actor || 'legacy_jobs_api');
    const materialRequirement = operatingLedger.addMaterialRequirement(detail.id, req.body || {}, { actor: req.body?.actor || 'legacy_jobs_api' });
    const job = operatingLedger.getJobDetail(detail.id, { includeAudit: true });
    return {
      success: true,
      materialRequirement,
      job: mapLedgerJobForLegacy(job),
      ledgerJob: job,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/jobs/:id/documents', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const detail = resolveJobDetailForApiRoute(req.params.id, req.body?.actor || 'legacy_jobs_api');
    const documentRecord = operatingLedger.addDocument(detail.id, req.body || {}, { actor: req.body?.actor || 'legacy_jobs_api' });
    const job = operatingLedger.getJobDetail(detail.id, { includeAudit: true });
    return {
      success: true,
      document: documentRecord,
      job: mapLedgerJobForLegacy(job),
      ledgerJob: job,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/jobs/:id/photos', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const detail = resolveJobDetailForApiRoute(req.params.id, req.body?.actor || 'legacy_jobs_api');
    const photo = operatingLedger.addDocument(detail.id, {
      ...(req.body || {}),
      type: req.body?.type || 'photo',
      tags: Array.from(new Set(['photo', 'jobsite', ...(
        Array.isArray(req.body?.tags)
          ? req.body.tags
          : req.body?.tags
            ? String(req.body.tags).split(',').map(item => item.trim()).filter(Boolean)
            : []
      )]))
    }, { actor: req.body?.actor || 'legacy_jobs_api' });
    const job = operatingLedger.getJobDetail(detail.id, { includeAudit: true });
    return {
      success: true,
      photo,
      document: photo,
      job: mapLedgerJobForLegacy(job),
      ledgerJob: job,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/jobs/:id/progress', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const detail = resolveJobDetailForApiRoute(req.params.id, req.body?.actor || 'legacy_jobs_api');
    const progress = operatingLedger.addProgressUpdate(detail.id, req.body || {}, { actor: req.body?.actor || 'legacy_jobs_api' });
    const job = operatingLedger.getJobDetail(detail.id, { includeAudit: true });
    return {
      success: true,
      progress,
      job: mapLedgerJobForLegacy(job),
      ledgerJob: job,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/jobs/:id/communication', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const detail = resolveJobDetailForApiRoute(req.params.id, req.body?.actor || 'legacy_jobs_api');
    const communication = operatingLedger.addCommunication(detail.id, req.body || {}, { actor: req.body?.actor || 'legacy_jobs_api' });
    const job = operatingLedger.getJobDetail(detail.id, { includeAudit: true });
    return {
      success: true,
      communication,
      job: mapLedgerJobForLegacy(job),
      ledgerJob: job,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/jobs/:id/time-logs', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const detail = resolveJobDetailForApiRoute(req.params.id, req.body?.actor || 'legacy_jobs_api');
    const timeLog = operatingLedger.addTimeLog(detail.id, req.body || {}, { actor: req.body?.actor || 'legacy_jobs_api' });
    const job = operatingLedger.getJobDetail(detail.id, { includeAudit: true });
    return {
      success: true,
      timeLog,
      job: mapLedgerJobForLegacy(job),
      ledgerJob: job,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/jobs/:id/expenses', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const detail = resolveJobDetailForApiRoute(req.params.id, req.body?.actor || 'legacy_jobs_api');
    const expense = operatingLedger.addExpense(detail.id, req.body || {}, { actor: req.body?.actor || 'legacy_jobs_api' });
    const job = operatingLedger.getJobDetail(detail.id, { includeAudit: true });
    return {
      success: true,
      expense,
      job: mapLedgerJobForLegacy(job),
      ledgerJob: job,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/jobs/:id/invoice', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const detail = resolveJobDetailForApiRoute(req.params.id, req.body?.actor || 'legacy_jobs_api');
    const invoice = operatingLedger.createInvoice(detail.id, req.body || {}, { actor: req.body?.actor || 'legacy_jobs_api' });
    const job = operatingLedger.getJobDetail(detail.id, { includeAudit: true });
    return {
      success: true,
      invoice,
      job: mapLedgerJobForLegacy(job),
      ledgerJob: job,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/jobs/:id/invoices', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const detail = resolveJobDetailForApiRoute(req.params.id, req.body?.actor || 'legacy_jobs_api');
    const invoice = operatingLedger.createInvoice(detail.id, req.body || {}, { actor: req.body?.actor || 'legacy_jobs_api' });
    const job = operatingLedger.getJobDetail(detail.id, { includeAudit: true });
    return {
      success: true,
      invoice,
      job: mapLedgerJobForLegacy(job),
      ledgerJob: job,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

createLegacyJobSubresourceAlias('site-visits', 'siteVisit', (jobId, payload, actor) =>
  operatingLedger.createSiteVisit(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('change-orders', 'changeOrder', (jobId, payload, actor) =>
  operatingLedger.createChangeOrder(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('field-reports', 'fieldReport', (jobId, payload, actor) =>
  operatingLedger.createFieldReport(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('rfis', 'rfi', (jobId, payload, actor) =>
  operatingLedger.createRfi(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('submittals', 'submittal', (jobId, payload, actor) =>
  operatingLedger.createSubmittalRecord(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('client-selections', 'clientSelection', (jobId, payload, actor) =>
  operatingLedger.createClientSelection(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('permits', 'permit', (jobId, payload, actor) =>
  operatingLedger.createPermitRecord(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('inspections', 'inspection', (jobId, payload, actor) =>
  operatingLedger.createInspectionRecord(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('observations', 'observation', (jobId, payload, actor) =>
  operatingLedger.createObservationRecord(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('incidents', 'incident', (jobId, payload, actor) =>
  operatingLedger.createIncidentRecord(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('safety-meetings', 'safetyMeeting', (jobId, payload, actor) =>
  operatingLedger.createSafetyMeeting(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('orientations', 'orientation', (jobId, payload, actor) =>
  operatingLedger.createWorkerOrientation(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('jhas', 'jha', (jobId, payload, actor) =>
  operatingLedger.createJhaRecord(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('sds-sheets', 'sdsSheet', (jobId, payload, actor) =>
  operatingLedger.createSdsSheet(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('site-access', 'siteAccessLog', (jobId, payload, actor) =>
  operatingLedger.createSiteAccessLog(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('route-plans', 'routePlan', (jobId, payload, actor) =>
  operatingLedger.createRoutePlan(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('loading-plans', 'loadingPlan', (jobId, payload, actor) =>
  operatingLedger.createLoadingPlan(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('procurement-orders', 'procurementOrder', (jobId, payload, actor) =>
  operatingLedger.createProcurementOrder(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('worker-instructions', 'workerInstruction', (jobId, payload, actor) =>
  operatingLedger.createWorkerInstruction(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('dispatch', 'dispatch', (jobId, payload, actor) =>
  operatingLedger.createDispatchPack(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('quality-checks', 'qualityCheck', (jobId, payload, actor) =>
  operatingLedger.addQualityCheck(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('safety-checks', 'safetyCheck', (jobId, payload, actor) =>
  operatingLedger.addSafetyCheck(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('payments', 'payment', (jobId, payload, actor) =>
  operatingLedger.recordPayment(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('budget-lines', 'budgetLine', (jobId, payload, actor) =>
  operatingLedger.createBudgetLine(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('purchase-orders', 'purchaseOrder', (jobId, payload, actor) =>
  operatingLedger.createPurchaseOrder(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('draw-requests', 'drawRequest', (jobId, payload, actor) =>
  operatingLedger.createDrawRequest(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('lien-waivers', 'lienWaiver', (jobId, payload, actor) =>
  operatingLedger.createLienWaiver(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('finance-handoffs', 'financeHandoff', (jobId, payload, actor) =>
  operatingLedger.createFinanceHandoff(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('punch-items', 'punchItem', (jobId, payload, actor) =>
  operatingLedger.createPunchItem(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('warranty-claims', 'warrantyClaim', (jobId, payload, actor) =>
  operatingLedger.createWarrantyClaim(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('aftercare', 'aftercare', (jobId, payload, actor) =>
  operatingLedger.addAftercareItem(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('recurring-plans', 'recurringPlan', (jobId, payload, actor) =>
  operatingLedger.createRecurringPlan(jobId, payload, { actor }));
createLegacyJobSubresourceAlias('closeout', 'closeout', (jobId, payload, actor) =>
  operatingLedger.createCloseoutPackage(jobId, payload, { actor }));

app.get('/api/jobs/:id/playbook', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const detail = resolveJobDetailForApiRoute(req.params.id, req.query?.actor || 'legacy_jobs_api');
    return {
      success: true,
      ...operatingLedger.buildJobPlaybookPlan(detail.id, req.query || {}),
      dashboard: operatingLedger.dashboardSummary()
    };
  });
});

app.post('/api/jobs/:id/playbook', (req, res) => {
  return handleLedgerRequest(req, res, () => {
    const payload = req.body || {};
    const actor = payload.actor || 'legacy_jobs_api';
    const detail = resolveJobDetailForApiRoute(req.params.id, actor);
    const mode = String(payload.mode || payload.action || 'apply').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const result = mode === 'preview'
      ? operatingLedger.buildJobPlaybookPlan(detail.id, payload)
      : operatingLedger.applyJobPlaybook(detail.id, payload, { actor });
    const job = result.job || operatingLedger.getJobDetail(detail.id, { includeAudit: true });
    return {
      success: true,
      ...result,
      job: mapLedgerJobForLegacy(job),
      ledgerJob: job,
      dashboard: operatingLedger.dashboardSummary()
    };
  }, 201);
});

app.post('/api/jobs/:id/schedule', (req, res) => {
  const jobId = req.params.id;
  const job = findJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (['completed', 'cancelled'].includes(job.status)) {
    return res.status(409).json({ error: `Cannot schedule a ${job.status} job` });
  }

  const { scheduledDate, workerId } = req.body || {};
  if (!scheduledDate && !workerId) {
    const execution = autonomousEngine.executePlan(jobId, currentState());
    if (!execution.success) {
      return res.status(409).json(execution);
    }
    mirrorLegacyJobToLedger(execution.job || job, {
      actor: 'legacy_schedule_api',
      status: execution.job?.status || job.status,
      progressNote: 'Autonomous schedule plan executed and mirrored into the operating ledger.'
    });
    saveState();
    return res.json(execution);
  }

  const worker = workerId
    ? findWorker(workerId)
    : workers.find(item => autonomousEngine.isWorkerAvailable(item, job));
  if (!worker) {
    return res.status(409).json({ error: 'No suitable worker is available' });
  }
  if (!autonomousEngine.isWorkerAvailable(worker, job)) {
    return res.status(409).json({ error: `${worker.name} is not available` });
  }

  const previousWorker = workers.find(item =>
    String(item.id) === String(job.assignedWorkerId)
    || item.name === job.worker
  );
  if (previousWorker && previousWorker.id !== worker.id) {
    autonomousEngine.releaseWorkerFromJob(previousWorker, job);
  }

  const scheduledStart = normalizeDateStart(scheduledDate || new Date().toISOString().split('T')[0]);
  if (!scheduledStart) {
    return res.status(400).json({ error: 'A valid scheduledDate is required' });
  }
  const scheduledEnd = new Date(scheduledStart);
  scheduledEnd.setHours(scheduledEnd.getHours() + Math.max(1, Number(job.estimatedHours || 4)));
  job.status = 'scheduled';
  job.progress = 0;
  job.startDate = scheduledStart.toISOString().slice(0, 10);
  job.scheduledStart = scheduledStart.toISOString();
  job.scheduledEnd = scheduledEnd.toISOString();
  job.estimatedCompletion = scheduledEnd.toISOString();
  job.worker = worker.name;
  job.assignedWorkerId = worker.id;
  worker.status = 'active';
  worker.currentJob = job.title;
  worker.currentJobId = job.id;
  const toolPlan = reservePlannedTools(job);
  mirrorLegacyJobToLedger(job, {
    actor: 'legacy_schedule_api',
    status: 'scheduled',
    progressNote: `${job.title} scheduled for ${job.scheduledStart}.`
  });

  saveState();
  res.json({ job, worker, toolPlan });
});

app.post('/api/jobs/:id/start', (req, res) => {
  const jobId = req.params.id;
  const job = findJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (job.status === 'completed') {
    return res.status(409).json({ error: 'Completed jobs cannot be restarted' });
  }

  if (!job.worker && !job.assignedWorkerId) {
    const execution = autonomousEngine.executePlan(job.id, currentState());
    if (!execution.success) {
      return res.status(409).json(execution);
    }
  }

  job.status = 'in_progress';
  job.progress = Math.max(Number(job.progress || 0), 10);
  job.actualStart = job.actualStart || new Date().toISOString();
  const worker = workers.find(item =>
    String(item.id) === String(job.assignedWorkerId)
    || item.name === job.worker
  );
  if (worker) {
    worker.status = 'active';
    worker.currentJob = job.title;
    worker.currentJobId = job.id;
  }
  const toolPlan = reservePlannedTools(job);
  for (const tool of tools) {
    if (String(tool.assignedJobId) === String(job.id)) {
      tool.status = 'in_use';
    }
  }
  mirrorLegacyJobToLedger(job, {
    actor: 'legacy_start_api',
    status: 'in_progress',
    progressNote: `${job.title} started from the legacy dashboard.`
  });
  saveState();
  res.json({ job, worker: worker || null, toolPlan });
});

app.post('/api/jobs/:id/complete', (req, res) => {
  const jobId = req.params.id;
  const job = findJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (job.status === 'completed') {
    const existingRecords = findCompletionBuildRecords(job.id);
    return res.json({
      success: true,
      alreadyCompleted: true,
      job,
      worker: null,
      releasedTools: [],
      records: existingRecords,
      actions: []
    });
  }

  const payload = req.body || {};
  const { actualCost } = payload;
  job.status = 'completed';
  job.progress = 100;
  job.actualCost = Number(actualCost || job.actualCost || job.estimatedCost || 0);
  job.actualEnd = new Date().toISOString();
  job.ai = {
    ...(job.ai || {}),
    confidence: 'high',
    reasoning: payload.completionNote || payload.completion_note || `Completed and routed into finance, client communication, daily log and closeout workflows.`,
    lastDecisionAt: job.actualEnd
  };

  const worker = workers.find(item =>
    String(item.id) === String(job.assignedWorkerId)
    || item.name === job.worker
  );
  if (worker) {
    worker.completedJobs = Number(worker.completedJobs || 0) + 1;
  }
  const released = releaseJobResources(job);
  const completionWorkflow = createCompletionBuildRecords(job, payload, released);
  const ledgerDetail = mirrorLegacyJobToLedger(job, {
    actor: 'legacy_complete_api',
    status: 'completed',
    progressNote: payload.completionNote || payload.completion_note || `${job.title} completed from the legacy dashboard.`,
    createInvoiceOnComplete: true
  });

  saveState();
  res.json({
    success: true,
    job,
    ledgerJob: ledgerDetail,
    worker: released.worker,
    releasedTools: released.tools,
    records: completionWorkflow.records,
    actions: completionWorkflow.actions,
    summary: constructionSummary(),
    capabilities: constructionCapabilities()
  });
});

app.get('/api/ai/status', (req, res) => {
  res.json({
    status: 'operational',
    autonomous: true,
    summary: autonomousEngine.summarizeState(currentState()),
    insights: autonomousEngine.generateInsights(currentState()),
    timestamp: new Date().toISOString()
  });
});

app.post('/api/ai/analyze', (req, res) => {
  const analysis = autonomousEngine.analyzeJobRequest(req.body || {});
  res.json({ analysis });
});

app.get('/api/jobs/:id/ai-plan', (req, res) => {
  const jobId = parseInt(req.params.id);
  const job = jobs.find(item => item.id === jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(autonomousEngine.createPlan(job, currentState()));
});

app.post('/api/jobs/:id/execute-ai-plan', (req, res) => {
  const jobId = parseInt(req.params.id);
  const execution = autonomousEngine.executePlan(jobId, currentState());
  if (!execution.success) {
    return res.status(409).json(execution);
  }

  mirrorLegacyJobToLedger(execution.job, {
    actor: 'legacy_ai_plan_api',
    status: execution.job.status,
    progressNote: 'AI plan execution synchronized into the operating ledger.'
  });
  saveState();
  res.json(execution);
});

app.post('/api/ai/autonomous-cycle', (req, res) => {
  const payload = req.body || {};
  const explicitApply = payload.dryRun === false
    || (payload.dryRun !== true && (payload.apply === true || payload.execute === true));
  const result = autonomousEngine.runAutonomousCycle(currentState(), {
    ...payload,
    dryRun: !explicitApply
  });
  if (explicitApply) {
    saveState();
  }
  res.json({
    ...result,
    defaultedToDryRun: !explicitApply,
    notApplied: !explicitApply,
    approvalPolicy: explicitApply
      ? 'Legacy internal autonomous changes were explicitly applied by request.'
      : 'Legacy autonomous cycle previews internal worker, tool, schedule and progress changes unless explicitly applied.'
  });
});

app.post('/api/emergency/activate', (req, res) => {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const payload = req.body || {};
  const reason = String(payload.reason || 'Emergency mode activated from dashboard');
  const actions = [];
  const alerts = [];

  let primaryJob = jobs.find(job =>
    job.priority === 'critical' && !['completed', 'cancelled'].includes(job.status)
  ) || jobs.find(job =>
    ['pending', 'scheduled', 'in_progress'].includes(job.status)
    && ['critical', 'high'].includes(job.priority)
  );

  if (!primaryJob) {
    primaryJob = {
      id: Math.max(0, ...jobs.map(job => Number(job.id) || 0)) + 1,
      title: payload.title || 'Emergency Response Standby',
      client: payload.client || 'Emergency Contact',
      phone: payload.phone || CONTRACTOR_CONFIG.phone,
      address: payload.address || 'Netherlands',
      description: reason,
      service: 'Emergency Response',
      jobType: 'emergency_response',
      priority: 'critical',
      status: 'pending',
      progress: 0,
      estimatedCost: Number(payload.estimatedCost || 250),
      requiredTools: ['Safety Harness', 'Plumbing Kit'],
      ai: {
        confidence: 'high',
        reasoning: 'Created by emergency mode because no open critical job existed.',
        lastDecisionAt: now
      },
      createdAt: now
    };
    jobs.unshift(primaryJob);
    actions.push({ type: 'create_emergency_job', id: primaryJob.id, message: `Created ${primaryJob.title}.` });
  }

  primaryJob.priority = 'critical';
  primaryJob.status = 'in_progress';
  primaryJob.progress = Math.max(Number(primaryJob.progress || 0), 15);
  primaryJob.actualStart = primaryJob.actualStart || now;
  primaryJob.startDate = primaryJob.startDate || today;
  primaryJob.ai = {
    ...(primaryJob.ai || {}),
    confidence: 'high',
    reasoning: `${reason}. Emergency mode escalated this job, dispatched response resources, and opened site-safety follow-up.`,
    lastDecisionAt: now
  };

  let responseWorker = workers.find(worker =>
    String(worker.id) === String(primaryJob.assignedWorkerId)
    || worker.name === primaryJob.worker
  );
  if (!responseWorker) {
    responseWorker = workers.find(worker => autonomousEngine.isWorkerAvailable(worker, primaryJob))
      || workers.find(worker => ['available', 'offline'].includes(String(worker.status || '').toLowerCase()));
  }
  if (responseWorker) {
    primaryJob.worker = responseWorker.name;
    primaryJob.assignedWorkerId = responseWorker.id;
    responseWorker.status = 'active';
    responseWorker.currentJob = primaryJob.title;
    responseWorker.currentJobId = primaryJob.id;
    actions.push({ type: 'dispatch_worker', id: responseWorker.id, message: `${responseWorker.name} dispatched to ${primaryJob.title}.` });
  } else {
    alerts.push({ type: 'no_worker_available', severity: 'critical', message: 'No available worker could be dispatched automatically.' });
  }

  const toolPlan = reservePlannedTools(primaryJob);
  for (const tool of tools) {
    if (String(tool.assignedJobId) === String(primaryJob.id)) {
      tool.status = 'in_use';
      tool.assignedWorkerId = responseWorker?.id || tool.assignedWorkerId || null;
    }
  }
  if (toolPlan.reserved?.length) {
    actions.push({ type: 'reserve_tools', id: primaryJob.id, message: `${toolPlan.reserved.length} tool(s) reserved for emergency response.` });
  }

  const project = (construction.projects || []).find(item =>
    ['active', 'preconstruction'].includes(String(item.status || '').toLowerCase())
  );
  const projectId = project?.id || null;
  const records = {
    incident: addConstructionRecord('incidents', {
      projectId,
      title: `Emergency response: ${primaryJob.title}`,
      severity: 'high',
      status: 'open',
      date: today,
      sourceJobId: primaryJob.id,
      notes: reason
    }),
    task: addConstructionRecord('tasks', {
      projectId,
      title: `Coordinate emergency response for ${primaryJob.title}`,
      assignee: responseWorker?.name || 'Operations Lead',
      priority: 'critical',
      status: 'open',
      dueDate: today,
      sourceJobId: primaryJob.id
    }),
    clientMessage: addConstructionRecord('clientMessages', {
      projectId,
      subject: `Emergency update: ${primaryJob.title}`,
      channel: 'portal',
      recipient: primaryJob.client || primaryJob.client_name || 'Client',
      status: 'draft',
      dueDate: now,
      sourceJobId: primaryJob.id
    }),
    safetyMeeting: addConstructionRecord('safetyMeetings', {
      projectId,
      title: `Emergency toolbox talk: ${primaryJob.title}`,
      status: 'scheduled',
      date: today,
      attendees: responseWorker ? 1 : 0,
      sourceJobId: primaryJob.id
    }),
    dailyLog: addConstructionRecord('dailyLogs', {
      projectId,
      date: today,
      status: 'draft',
      manpower: responseWorker ? 1 : 0,
      notes: `Emergency mode activated for ${primaryJob.title}. ${responseWorker ? responseWorker.name : 'Operations lead'} assigned for first response.`,
      sourceJobId: primaryJob.id
    })
  };
  actions.push(
    { type: 'open_incident', id: records.incident.id, message: `Incident ${records.incident.id} opened.` },
    { type: 'create_task', id: records.task.id, message: `Critical task ${records.task.id} created.` },
    { type: 'draft_client_update', id: records.clientMessage.id, message: 'Client portal update drafted.' },
    { type: 'schedule_safety_talk', id: records.safetyMeeting.id, message: 'Emergency toolbox talk scheduled.' },
    { type: 'draft_daily_log', id: records.dailyLog.id, message: 'Daily report entry drafted.' }
  );

  const review = runConstructionAutopilot();
  saveState();
  res.json({
    success: true,
    activatedAt: now,
    reason,
    job: primaryJob,
    worker: responseWorker || null,
    toolPlan,
    records,
    actions: [...actions, ...(review.actions || [])],
    alerts,
    insights: review.insights || [],
    summary: constructionSummary(),
    capabilities: constructionCapabilities()
  });
});

app.get('/api/workers', (req, res) => {
  res.json(mergedLegacyAndLedgerWorkers(req.query || {}));
});

app.post('/api/workers', (req, res) => {
  const workerData = req.body || {};
  if (!workerData.name) {
    return res.status(400).json({ error: 'Worker name is required' });
  }

  const nextId = Math.max(0, ...workers.map(worker => Number(worker.id) || 0)) + 1;
  const newWorker = {
    id: nextId,
    name: workerData.name,
    specialty: workerData.specialty || workerData.specialties?.[0] || 'General Maintenance',
    specialties: Array.isArray(workerData.specialties)
      ? workerData.specialties
      : String(workerData.specialty || 'General Maintenance').split(',').map(item => item.trim()).filter(Boolean),
    skills: Array.isArray(workerData.skills)
      ? workerData.skills
      : Array.isArray(workerData.specialties)
        ? workerData.specialties
        : [],
    status: workerData.status || 'available',
    location: workerData.location || workerData.currentLocation || 'Unassigned',
    rating: Number(workerData.rating || 5),
    completedJobs: Number(workerData.completedJobs || 0),
    hourlyRate: Number(workerData.hourlyRate || workerData.hourly_rate || 0),
    currentJob: workerData.currentJob || null,
    currentJobId: workerData.currentJobId || null
  };
  syncLegacyWorkerToLedger(newWorker, 'legacy_workers_api');
  workers.push(newWorker);
  saveState();
  res.status(201).json(newWorker);
});

app.put('/api/workers/:id', (req, res) => {
  const workerId = parseInt(req.params.id);
  const workerIndex = workers.findIndex(worker => worker.id === workerId);
  if (workerIndex === -1) {
    return handleLedgerRequest(req, res, () => {
      const existingWorker = findLedgerWorkerForLegacyRoute(req.params.id);
      if (!existingWorker) {
        const error = new Error('Worker not found');
        error.statusCode = 404;
        throw error;
      }

      const updates = { ...(req.body || {}) };
      delete updates.id;
      const dataUpdates = { ...(updates.data || {}) };
      if (Object.prototype.hasOwnProperty.call(updates, 'currentJob')) dataUpdates.currentJob = updates.currentJob;
      if (Object.prototype.hasOwnProperty.call(updates, 'currentJobId')) dataUpdates.currentJobId = updates.currentJobId;
      const worker = operatingLedger.upsertWorker({
        ...updates,
        id: existingWorker.id,
        data: dataUpdates
      }, { actor: 'legacy_workers_api' });
      return {
        success: true,
        operationStatus: 'updated',
        ...mapLedgerWorkerForLegacy(worker),
        dashboard: operatingLedger.dashboardSummary()
      };
    });
  }

  const updates = { ...(req.body || {}) };
  delete updates.id;
  workers[workerIndex] = { ...workers[workerIndex], ...updates, id: workerId };
  syncLegacyWorkerToLedger(workers[workerIndex], 'legacy_workers_api');
  saveState();
  res.json(workers[workerIndex]);
});

app.delete('/api/workers/:id', (req, res) => {
  const workerId = req.params.id;
  const workerIndex = workers.findIndex(worker => String(worker.id) === String(workerId));
  if (workerIndex === -1) {
    return handleLedgerRequest(req, res, () => {
      const existingWorker = findLedgerWorkerForLegacyRoute(workerId);
      if (!existingWorker) {
        const error = new Error('Worker not found');
        error.statusCode = 404;
        throw error;
      }

      const retirement = operatingLedger.requestWorkerRetirement(existingWorker.id, req.body || {}, { actor: 'legacy_workers_api' });
      return {
        success: true,
        deleted: false,
        retained: true,
        retired: retirement.retired,
        requiresApproval: retirement.requiresApproval,
        operationStatus: retirement.operationStatus,
        approval: retirement.approval,
        worker: mapLedgerWorkerForLegacy(retirement.worker),
        ledger: retirement.worker,
        dashboard: operatingLedger.dashboardSummary()
      };
    });
  }

  const worker = workers[workerIndex];
  const ledgerWorker = syncLegacyWorkerToLedger(worker, 'legacy_workers_api');
  const retirement = operatingLedger.requestWorkerRetirement(ledgerWorker.id, {
    ...(req.body || {}),
    legacyWorkerId: worker.id
  }, { actor: 'legacy_workers_api' });
  worker.retirementApprovalId = retirement.approval?.id || worker.retirementApprovalId || null;
  worker.retirementRequestedAt = retirement.approval?.createdAt || worker.retirementRequestedAt || null;
  saveState();
  res.json({
    success: true,
    deleted: false,
    retained: true,
    retired: retirement.retired,
    requiresApproval: retirement.requiresApproval,
    operationStatus: retirement.operationStatus,
    approval: retirement.approval,
    worker: { ...worker },
    ledger: retirement.worker
  });
});

app.get('/api/tools', (req, res) => {
  res.json(mergedLegacyAndLedgerTools(req.query || {}));
});

app.post('/api/tools', (req, res) => {
  const toolData = req.body || {};
  if (!toolData.name) {
    return res.status(400).json({ error: 'Tool name is required' });
  }

  const nextId = Math.max(0, ...tools.map(tool => Number(tool.id) || 0)) + 1;
  const newTool = {
    id: nextId,
    name: toolData.name,
    category: toolData.category || 'general',
    status: toolData.status || 'available',
    currentLocation: toolData.currentLocation || toolData.location || 'Warehouse',
    homeLocation: toolData.homeLocation || toolData.currentLocation || toolData.location || 'Warehouse',
    returnDate: toolData.returnDate || null,
    assignedJobId: toolData.assignedJobId || null,
    assignedWorkerId: toolData.assignedWorkerId || null
  };
  syncLegacyToolToLedger(newTool, 'legacy_tools_api');
  tools.push(newTool);
  saveState();
  res.status(201).json(newTool);
});

app.put('/api/tools/:id', (req, res) => {
  const toolId = parseInt(req.params.id);
  const toolIndex = tools.findIndex(tool => tool.id === toolId);
  if (toolIndex === -1) {
    return handleLedgerRequest(req, res, () => {
      const existingTool = findLedgerToolForLegacyRoute(req.params.id);
      if (!existingTool) {
        const error = new Error('Tool not found');
        error.statusCode = 404;
        throw error;
      }

      const updates = { ...(req.body || {}) };
      delete updates.id;
      const dataUpdates = { ...(updates.data || {}) };
      if (Object.prototype.hasOwnProperty.call(updates, 'returnDate')) dataUpdates.returnDate = updates.returnDate;
      if (Object.prototype.hasOwnProperty.call(updates, 'assignedJobId')) dataUpdates.assignedJobId = updates.assignedJobId;
      if (Object.prototype.hasOwnProperty.call(updates, 'assignedWorkerId')) dataUpdates.assignedWorkerId = updates.assignedWorkerId;
      const tool = operatingLedger.upsertTool({
        ...updates,
        id: existingTool.id,
        data: dataUpdates
      }, { actor: 'legacy_tools_api' });
      return {
        success: true,
        operationStatus: 'updated',
        ...mapLedgerToolForLegacy(tool),
        dashboard: operatingLedger.dashboardSummary()
      };
    });
  }

  const updates = { ...(req.body || {}) };
  delete updates.id;
  tools[toolIndex] = { ...tools[toolIndex], ...updates, id: toolId };
  syncLegacyToolToLedger(tools[toolIndex], 'legacy_tools_api');
  saveState();
  res.json(tools[toolIndex]);
});

app.delete('/api/tools/:id', (req, res) => {
  const toolId = req.params.id;
  const toolIndex = tools.findIndex(tool => String(tool.id) === String(toolId));
  if (toolIndex === -1) {
    return handleLedgerRequest(req, res, () => {
      const existingTool = findLedgerToolForLegacyRoute(toolId);
      if (!existingTool) {
        const error = new Error('Tool not found');
        error.statusCode = 404;
        throw error;
      }

      const retirement = operatingLedger.requestToolRetirement(existingTool.id, req.body || {}, { actor: 'legacy_tools_api' });
      return {
        success: true,
        deleted: false,
        retained: true,
        retired: retirement.retired,
        requiresApproval: retirement.requiresApproval,
        operationStatus: retirement.operationStatus,
        approval: retirement.approval,
        tool: mapLedgerToolForLegacy(retirement.tool),
        ledger: retirement.tool,
        dashboard: operatingLedger.dashboardSummary()
      };
    });
  }

  const tool = tools[toolIndex];
  const ledgerTool = syncLegacyToolToLedger(tool, 'legacy_tools_api');
  const retirement = operatingLedger.requestToolRetirement(ledgerTool.id, {
    ...(req.body || {}),
    legacyToolId: tool.id
  }, { actor: 'legacy_tools_api' });
  tool.retirementApprovalId = retirement.approval?.id || tool.retirementApprovalId || null;
  tool.retirementRequestedAt = retirement.approval?.createdAt || tool.retirementRequestedAt || null;
  saveState();
  res.json({
    success: true,
    deleted: false,
    retained: true,
    retired: retirement.retired,
    requiresApproval: retirement.requiresApproval,
    operationStatus: retirement.operationStatus,
    approval: retirement.approval,
    tool: { ...tool },
    ledger: retirement.tool
  });
});

app.post('/api/ai/chat', (req, res) => {
  return res.status(501).json({
    error: {
      code: 'chat_unavailable',
      message: 'Conversational AI is unavailable until a verified provider is configured. Use the persisted command plan and ledger views instead.',
      requestId: req.requestId
    }
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

  const scenarios = [
    {
      client: 'Emma Bakker',
      phone: '+31612345678',
      address: 'Nieuwmarkt 12, Amsterdam',
      service: 'Kitchen renovation',
      urgency: 'medium',
      description: 'Need kitchen cabinets replaced and new countertop installed'
    },
    {
      client: 'Pieter Visser',
      phone: '+31687654321',
      address: 'Lange Voorhout 89, Den Haag',
      service: 'Garden maintenance',
      urgency: 'low',
      description: 'Monthly garden cleanup and hedge trimming'
    },
    {
      client: 'Sanne de Jong',
      phone: '+31655551111',
      address: 'Keizersgracht 321, Amsterdam',
      service: 'Emergency plumbing',
      urgency: 'critical',
      description: 'Urgent pipe leak with water in the kitchen'
    }
  ];

  const selected = scenarios.find(item => item.service.toLowerCase().includes(String(req.body?.scenario || '').toLowerCase()))
    || scenarios[Math.floor(Math.random() * scenarios.length)];
  const job = autonomousEngine.createJobFromRequest(selected, currentState());
  jobs.unshift(job);
  const plan = autonomousEngine.createPlan(job, currentState());
  let execution = null;

  if (req.body?.execute === true && !plan.requiresApproval) {
    execution = autonomousEngine.executePlan(job.id, currentState());
  }

  saveState();
  res.json({
    success: true,
    request: selected,
    job,
    plan,
    execution,
    status: execution?.success ? 'internal_plan_applied' : 'analyzed_with_draft_plan',
    deliveryMode: 'draft_only',
    notSent: true,
    nextSteps: plan.actions.map(action => action.type)
  });
});

// AI Chat endpoint
app.post('/api/legacy/ai/chat', (req, res) => {
  return res.status(410).json({
    error: {
      code: 'legacy_chat_retired',
      message: 'Legacy simulated chat is retired. Use the persisted command plan and ledger views instead.',
      requestId: req.requestId
    }
  });

  const message = String(req.body?.message || '');

  // Simple AI response simulation
  let response = "I'm analyzing your request...";

  if (message.toLowerCase().includes('schedule') || message.toLowerCase().includes('plan')) {
    response = "Based on current weather and worker availability, I recommend scheduling outdoor work for tomorrow morning. Anna is available for bathroom work, and Marco can handle the gutter cleaning after 2 PM.";
  } else if (message.toLowerCase().includes('weather')) {
    response = "Current weather in Amsterdam: 16°C, partly cloudy with 20% chance of rain. Good conditions for most outdoor work. I recommend completing gutter cleaning before tomorrow's forecasted rain.";
  } else if (message.toLowerCase().includes('worker') || message.toLowerCase().includes('team')) {
    response = "Your team status: Anna is currently working on the bathroom renovation (65% complete), Marco is available for new assignments, and Lisa just completed the lawn maintenance job with excellent client feedback.";
  } else if (message.toLowerCase().includes('client') || message.toLowerCase().includes('customer')) {
    response = "Client updates: Maria van der Berg's bathroom renovation is progressing well. A progress update draft with photos is ready for approval before sending. Jan de Vries' availability note should be confirmed in the approval queue before the schedule is committed.";
  }

  res.json({
    response,
    confidence: 'high',
    suggestions: [
      'Review today\'s schedule',
      'Check weather forecast',
      'Send client updates',
      'Optimize routes'
    ]
  });
});

// Simulate client request
app.post('/api/legacy/simulate/client-request', (req, res) => {
  return res.status(410).json({
    error: {
      code: 'simulation_retired',
      message: 'Sample client requests are retired. Create a persisted job through /api/ledger/intake instead.',
      requestId: req.requestId
    }
  });

  const clientRequests = [
    {
      client: 'Emma Bakker',
      phone: '+31612345678',
      address: 'Nieuwmarkt 12, Amsterdam',
      service: 'Kitchen renovation',
      urgency: 'medium',
      budget: 'EUR 2000-3000',
      description: 'Need kitchen cabinets replaced and new countertop installed'
    },
    {
      client: 'Pieter Visser',
      phone: '+31687654321',
      address: 'Lange Voorhout 89, Den Haag',
      service: 'Garden maintenance',
      urgency: 'low',
      budget: 'EUR 100-200',
      description: 'Monthly garden cleanup and hedge trimming'
    }
  ];

  const request = clientRequests[Math.floor(Math.random() * clientRequests.length)];

  // Simulate AI analysis
  const aiAnalysis = {
    estimatedDuration: '2-3 days',
    recommendedWorker: 'Anna Kowalski',
    estimatedCost: request.budget,
    requiredTools: ['Power tools', 'Measuring equipment', 'Safety gear'],
    schedulingSuggestion: 'Next available slot: October 20-22',
    confidence: 'high'
  };

  res.json({
    request,
    aiAnalysis,
    status: 'analyzed',
    deliveryMode: 'draft_only',
    notSent: true,
    nextSteps: [
      'Draft quote for approval',
      'Draft initial consultation schedule',
      'Draft required tool reservation',
      'Propose worker assignment'
    ]
  });
});

// Test email/SMS endpoint
app.post('/api/test/notifications', (req, res) => {
  const type = String(req.body?.type || 'all').toLowerCase();
  if (!['email', 'sms', 'all'].includes(type)) {
    return res.status(400).json({ error: 'Notification type must be email, sms, or all' });
  }

  const channels = (type === 'all' ? ['email', 'sms'] : [type]).map(channel => ({
    channel,
    recipient: channel === 'email' ? CONTRACTOR_CONFIG.email : CONTRACTOR_CONFIG.phone,
    status: 'dry_run',
    notSent: true,
    requiresApproval: true,
    subject: channel === 'email' ? 'Contractor AI System Test' : undefined,
    content: 'Dry-run notification draft from Contractor AI. No external message was sent.'
  }));

  res.json({
    success: true,
    message: `${channels.length} notification channel draft(s) prepared; no external messages were sent`,
    deliveryMode: 'dry_run',
    notSent: true,
    timestamp: new Date().toISOString(),
    channels
  });
});

// File analysis endpoint. Accepts the historical JSON metadata contract and
// bounded local multipart uploads from the dashboard field-evidence form.
app.post('/api/upload', async (req, res) => {
  let uploadPayload;
  try {
    uploadPayload = await readUploadPayload(req);
  } catch (error) {
    if (error instanceof UploadRequestError) {
      return sendError(req, res, error.statusCode, error.code, error.message, error.details);
    }
    throw error;
  }

  const payload = uploadPayload.payload || {};
  const analysis = {
    ...analyzeUploadPayload(payload),
    upload: uploadPayload.storedFile ? {
      storageRef: uploadPayload.storedFile.storageRef,
      mimeType: uploadPayload.storedFile.mimeType,
      size: uploadPayload.storedFile.size
    } : null
  };
  const shouldAttachToBuild = payload.attachToBuild !== false && String(payload.attachToBuild || 'true').toLowerCase() !== 'false';
  const buildResult = shouldAttachToBuild
    ? createUploadBuildRecords(payload, analysis)
    : { records: {}, actions: [], job: null };
  let ledgerDocument = null;
  let ledgerFollowUp = { records: {}, actions: [] };
  if (payload.jobId || payload.job_id || payload.ledgerJobId || payload.ledger_job_id) {
    const storedFile = uploadPayload.storedFile || null;
    const ledgerDetail = resolveUploadLedgerJobDetail(payload, 'upload_api');
    if (ledgerDetail?.id) {
      ledgerDocument = operatingLedger.addDocument(ledgerDetail.id, {
        type: analysis.category === 'field_photo' || String(payload.fileType || '').startsWith('image/') ? 'photo' : 'document',
        title: payload.title || storedFile?.originalName || payload.filename || payload.name || 'Uploaded evidence',
        filename: storedFile?.originalName || payload.filename || payload.name || null,
        mimeType: storedFile?.mimeType || payload.fileType || payload.mimeType || payload.mime_type || null,
        sizeBytes: storedFile?.size || payload.size || payload.sizeBytes || payload.size_bytes || 0,
        storageRef: storedFile?.storageRef || payload.storageRef || payload.url || null,
        status: analysis.riskDetected ? 'needs_review' : 'stored',
        tags: [analysis.category, payload.category, payload.riskLevel].filter(Boolean),
        analysis
      }, { actor: 'upload_api' });
      ledgerFollowUp = createLedgerUploadFollowUps(ledgerDetail, ledgerDocument, payload, analysis);
    }
  }

  if (shouldAttachToBuild) {
    saveState();
  }

  res.json({
    success: true,
    filename: payload.filename || payload.name || 'metadata-only',
    uploadedFile: uploadPayload.storedFile,
    analysis,
    records: buildResult.records,
    ledgerDocument,
    ledgerFollowUp,
    actions: [...buildResult.actions, ...ledgerFollowUp.actions],
    job: buildResult.job,
    summary: constructionSummary(),
    capabilities: constructionCapabilities()
  });
});

// Debug diagnostics. Disabled in production unless DEBUG_DIAGNOSTICS=true.
app.get('/api/debug/diagnostics', (req, res) => {
  if (isProduction && process.env.DEBUG_DIAGNOSTICS !== 'true') {
    return sendError(req, res, 404, 'not_found', 'Diagnostics are disabled');
  }

  const validation = validateState();
  const ledgerDiagnostics = operatingLedger.diagnose();
  const state = currentState();
  res.json({
    status: validation.valid && ledgerDiagnostics.valid ? 'ok' : 'attention',
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
      enabled: true,
      stateFile: isProduction ? 'hidden' : stateFile,
      ledgerFile: isProduction ? 'hidden' : ledgerFile
    },
    state: {
      counts: {
        jobs: state.jobs.length,
        workers: state.workers.length,
        tools: state.tools.length
      },
      summary: autonomousEngine.summarizeState(state),
      validation
    },
    ledger: {
      diagnostics: ledgerDiagnostics,
      summary: operatingLedger.dashboardSummary()
    }
  });
});

// Health check
app.get('/api/health', (req, res) => {
  const validation = validateState();
  const ledgerDiagnostics = operatingLedger.diagnose();
  res.json({
    status: validation.valid && ledgerDiagnostics.valid ? 'healthy' : 'degraded',
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptimeSeconds: Math.round(process.uptime()),
    services: {
      ai: 'operational',
      database: 'operational',
      notifications: 'operational',
      state: validation.valid ? 'operational' : 'attention',
      ledger: ledgerDiagnostics.valid ? 'operational' : 'attention'
    },
    diagnostics: {
      issueCount: validation.issueCount + ledgerDiagnostics.issueCount,
      errorCount: validation.issues.filter(issue => issue.severity === 'error').length + ledgerDiagnostics.issues.filter(issue => issue.severity === 'error').length,
      warningCount: validation.issues.filter(issue => issue.severity === 'warning').length + ledgerDiagnostics.issues.filter(issue => issue.severity === 'warning').length,
      ledgerIssueCount: ledgerDiagnostics.issueCount
    }
  });
});

app.use('/api', (req, res) => {
  return sendError(req, res, 404, 'not_found', 'API endpoint not found');
});

app.use((error, req, res, next) => {
  log('error', 'unhandled_request_error', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    error: serializeError(error)
  });

  if (res.headersSent) {
    return next(error);
  }

  return sendError(req, res, 500, 'internal_error', 'Unexpected server error', serializeError(error));
});

process.on('unhandledRejection', reason => {
  log('error', 'unhandled_rejection', { error: serializeError(reason) });
});

process.on('uncaughtException', error => {
  log('error', 'uncaught_exception', { error: serializeError(error) });
  process.exitCode = 1;
});

// Start server only when run directly. Serverless hosts import the app.
if (require.main === module) {
  app.listen(port, () => {
    log('info', 'server_started', {
      port,
      dashboard: `http://localhost:${port}`,
      health: `http://localhost:${port}/api/health`
    });
  });
}

module.exports = app;

