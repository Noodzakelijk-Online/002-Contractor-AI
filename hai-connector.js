const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const HAI_CONNECTOR_ID = 'contractor-ai-hai-readonly-v2';
const HAI_FEED_FORMAT = 'hai-accountfeed-generic-item/v1';
const HAI_ITEM_PROVIDER = 'generic_json_feed';
const HAI_ITEM_TYPE = 'document';
const HAI_FEED_OPERATION = 'review_document';
const HAI_SOURCE_URI_PREFIX = 'contractor-ai://review-actions/';
const DEFAULT_HAI_FEED_LIMIT = 100;
const MAX_HAI_FEED_LIMIT = 250;
const MAX_HAI_FEED_FILE_BYTES = 5 * 1024 * 1024;

function boundedFeedLimit(value, fallback = DEFAULT_HAI_FEED_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_HAI_FEED_LIMIT, Math.max(1, Math.floor(parsed)));
}

function cleanText(value, maximumLength) {
  return String(value || '')
    .split('')
    .map(character => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength);
}

function normalizeSeverity(value) {
  const normalized = cleanText(value, 16).toLowerCase();
  return ['critical', 'high', 'medium', 'low'].includes(normalized) ? normalized : 'medium';
}

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
}

function stableActionIdentity(action = {}) {
  const preferred = [
    action.idempotencyKey,
    action.taskId,
    action.id,
    action.sourceHash,
    action.approvalId,
    action.communicationId,
    action.assignmentId,
    action.reservationId,
    action.materialRequirementId,
    action.paymentId,
    action.aftercareId,
    action.recurringPlanId
  ].map(value => cleanText(value, 256)).find(Boolean);
  if (preferred) return preferred;
  return JSON.stringify({
    type: cleanText(action.type, 80),
    jobId: cleanText(action.jobId, 120),
    opportunityId: cleanText(action.opportunityId, 120),
    title: cleanText(action.title || action.jobTitle, 180),
    message: cleanText(action.message, 500)
  });
}

function validSourceTimestamp(action = {}) {
  const candidate = action.receivedAt || action.createdAt || action.updatedAt || null;
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function actionTitle(action = {}) {
  const named = cleanText(action.title || action.jobTitle || action.clientName, 180);
  if (named) return named;
  const type = cleanText(action.type || 'review', 80).replace(/_/g, ' ');
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function mapActionToHaiItem(action = {}) {
  const identity = stableActionIdentity(action);
  const actionType = cleanText(action.type || 'review', 80).toLowerCase() || 'review';
  const externalId = `contractor-ai:${sha256(identity).slice(0, 32)}`;
  const sourceTimestamp = validSourceTimestamp(action);
  const sourceFingerprint = sha256(cleanText(action.sourceHash, 512) || identity);
  const metadata = {
    connectorId: HAI_CONNECTOR_ID,
    sourceSystem: 'contractor_ai',
    actionType,
    severity: normalizeSeverity(action.severity),
    requiresApproval: Boolean(action.requiresApproval || action.approvalId),
    canExecute: false,
    externalCommitments: 0,
    sourceFingerprint
  };
  for (const key of ['jobId', 'opportunityId', 'approvalId']) {
    const value = cleanText(action[key], 120);
    if (value) metadata[key] = value;
  }
  return {
    externalId,
    title: actionTitle(action),
    content: cleanText(action.message || action.nextAction || 'Review this Contractor.AI ledger action.', 2_000),
    sourceUri: `${HAI_SOURCE_URI_PREFIX}${externalId.slice('contractor-ai:'.length)}`,
    itemType: HAI_ITEM_TYPE,
    provider: HAI_ITEM_PROVIDER,
    accountLabel: 'contractor-ai',
    projectKey: 'contractor-ai',
    ...(sourceTimestamp ? { receivedAt: sourceTimestamp } : {}),
    metadata
  };
}

function buildHaiFeed(actions, options = {}) {
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  const mapped = (Array.isArray(actions) ? actions : []).map(mapActionToHaiItem);
  mapped.sort((left, right) => {
    const severityDifference = severityRank[left.metadata.severity] - severityRank[right.metadata.severity];
    return severityDifference || left.externalId.localeCompare(right.externalId);
  });
  const unique = [];
  const seen = new Set();
  for (const item of mapped) {
    if (seen.has(item.externalId)) continue;
    seen.add(item.externalId);
    unique.push(item);
    if (unique.length >= boundedFeedLimit(options.limit)) break;
  }
  return unique;
}

function connectorManifest() {
  return {
    connectorId: HAI_CONNECTOR_ID,
    direction: 'contractor_ai_to_hai',
    mode: 'read_only',
    format: HAI_FEED_FORMAT,
    schema: 'accountfeed.GenericItem',
    root: 'array',
    itemProvider: HAI_ITEM_PROVIDER,
    itemType: HAI_ITEM_TYPE,
    operationType: HAI_FEED_OPERATION,
    operationTypeSource: 'derived_by_hai_from_item_type',
    authentication: 'owner_bearer_token',
    recommendedTransport: 'local_json_file',
    externalCommitments: 0,
    canExecute: false,
    endpoints: {
      manifest: '/api/integrations/hai/manifest',
      feed: '/api/integrations/hai/feed'
    }
  };
}

function validateHaiFeed(feed) {
  if (!Array.isArray(feed)) throw new Error('HAI feed must be a root JSON array.');
  for (const [index, item] of feed.entries()) {
    if (!item || typeof item !== 'object') throw new Error(`HAI feed item ${index} must be an object.`);
    if (!cleanText(item.externalId, 512)) throw new Error(`HAI feed item ${index} is missing externalId.`);
    if (!cleanText(item.title, 512) && !cleanText(item.content, 2_000)) throw new Error(`HAI feed item ${index} requires title or content.`);
    if (item.provider !== HAI_ITEM_PROVIDER) throw new Error(`HAI feed item ${index} has an unsupported provider.`);
    if (item.itemType !== HAI_ITEM_TYPE) throw new Error(`HAI feed item ${index} has an unsupported itemType.`);
    if (typeof item.content !== 'string' || Buffer.byteLength(item.content, 'utf8') > 200_000) {
      throw new Error(`HAI feed item ${index} has invalid content.`);
    }
    if (!cleanText(item.sourceUri, 512).startsWith(HAI_SOURCE_URI_PREFIX)
      || /(?:token|auth|api[_-]?key|secret|password|bearer)=/i.test(item.sourceUri)) {
      throw new Error(`HAI feed item ${index} has an unsafe sourceUri.`);
    }
    if (Object.hasOwn(item, 'body') || Object.hasOwn(item, 'operationType')) {
      throw new Error(`HAI feed item ${index} uses a retired normalized-feed field.`);
    }
    if (item.receivedAt && !Number.isFinite(Date.parse(item.receivedAt))) throw new Error(`HAI feed item ${index} has an invalid receivedAt value.`);
    if (Buffer.byteLength(JSON.stringify(item.metadata || {}), 'utf8') > 16_000) throw new Error(`HAI feed item ${index} metadata is too large.`);
    if (item.metadata?.canExecute !== false || item.metadata?.externalCommitments !== 0) {
      throw new Error(`HAI feed item ${index} violates the read-only connector boundary.`);
    }
  }
  return feed;
}

function writeHaiFeedAtomically(outputFile, feed) {
  const resolved = path.resolve(String(outputFile || ''));
  if (!path.isAbsolute(String(outputFile || ''))) throw new Error('HAI feed output path must be absolute.');
  validateHaiFeed(feed);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(feed, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, resolved);
    try { fs.chmodSync(resolved, 0o600); } catch { /* Best-effort on filesystems without POSIX modes. */ }
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch { /* Best-effort temporary-file cleanup. */ }
  }
  return {
    outputFile: resolved,
    itemCount: feed.length,
    sha256: sha256(fs.readFileSync(resolved))
  };
}

function inspectHaiFeedPublication(outputFile) {
  const configuredValue = String(outputFile || '').trim();
  if (!configuredValue) {
    return {
      configured: false,
      status: 'not_configured',
      outputFile: null,
      itemCount: 0,
      sha256: null,
      publishedAt: null
    };
  }
  if (!path.isAbsolute(configuredValue)) {
    return {
      configured: true,
      status: 'invalid_configuration',
      outputFile: configuredValue,
      itemCount: 0,
      sha256: null,
      publishedAt: null,
      issue: 'HAI feed output path must be absolute.'
    };
  }
  const resolved = path.resolve(configuredValue);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        configured: true,
        status: 'not_published',
        outputFile: resolved,
        itemCount: 0,
        sha256: null,
        publishedAt: null
      };
    }
    return {
      configured: true,
      status: 'unavailable',
      outputFile: resolved,
      itemCount: 0,
      sha256: null,
      publishedAt: null,
      issue: error.code || 'feed_unavailable'
    };
  }
  if (!stat.isFile() || stat.size > MAX_HAI_FEED_FILE_BYTES) {
    return {
      configured: true,
      status: 'invalid_feed',
      outputFile: resolved,
      itemCount: 0,
      sha256: null,
      publishedAt: stat.mtime.toISOString(),
      issue: stat.isFile() ? 'HAI feed file exceeds the safe inspection limit.' : 'HAI feed output path is not a file.'
    };
  }
  try {
    const content = fs.readFileSync(resolved);
    const feed = validateHaiFeed(JSON.parse(content.toString('utf8')));
    return {
      configured: true,
      status: 'published',
      outputFile: resolved,
      itemCount: feed.length,
      sha256: sha256(content),
      publishedAt: stat.mtime.toISOString()
    };
  } catch (error) {
    return {
      configured: true,
      status: 'invalid_feed',
      outputFile: resolved,
      itemCount: 0,
      sha256: null,
      publishedAt: stat.mtime.toISOString(),
      issue: cleanText(error.message, 240) || 'HAI feed validation failed.'
    };
  }
}

function publishHaiFeed(actions, options = {}) {
  const publication = inspectHaiFeedPublication(options.outputFile);
  if (!publication.configured) {
    const error = new Error('Configure an absolute CONTRACTOR_AI_HAI_FEED_PATH before publishing to HAI.');
    error.code = 'hai_feed_path_not_configured';
    error.statusCode = 409;
    throw error;
  }
  if (publication.status === 'invalid_configuration') {
    const error = new Error(publication.issue);
    error.code = 'hai_feed_path_invalid';
    error.statusCode = 422;
    throw error;
  }
  const feed = buildHaiFeed(actions, { limit: options.limit });
  writeHaiFeedAtomically(publication.outputFile, feed);
  const result = inspectHaiFeedPublication(publication.outputFile);
  if (result.status !== 'published') {
    const error = new Error('The HAI feed could not be verified after publication.');
    error.code = 'hai_feed_publish_verification_failed';
    error.statusCode = 500;
    throw error;
  }
  return result;
}

module.exports = {
  DEFAULT_HAI_FEED_LIMIT,
  HAI_CONNECTOR_ID,
  HAI_FEED_FORMAT,
  HAI_FEED_OPERATION,
  HAI_ITEM_PROVIDER,
  HAI_ITEM_TYPE,
  MAX_HAI_FEED_FILE_BYTES,
  MAX_HAI_FEED_LIMIT,
  boundedFeedLimit,
  buildHaiFeed,
  connectorManifest,
  inspectHaiFeedPublication,
  mapActionToHaiItem,
  publishHaiFeed,
  validateHaiFeed,
  writeHaiFeedAtomically
};
