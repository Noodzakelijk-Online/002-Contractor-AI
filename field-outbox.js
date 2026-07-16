const DATABASE_NAME = 'contractor-ai-field-outbox';
const DATABASE_VERSION = 2;
const EVIDENCE_STORE_NAME = 'evidence-drafts';
const OPERATION_STORE_NAME = 'operation-drafts';
const MAX_EVIDENCE_DRAFTS = 20;
const MAX_TOTAL_EVIDENCE_BYTES = 50 * 1024 * 1024;
const MAX_OPERATION_DRAFTS = 100;
const MAX_TOTAL_OPERATION_BYTES = 1024 * 1024;
const FIELD_OPERATION_TYPES = new Set(['progress', 'production_entry', 'daily_log', 'inspection_checklist', 'observation', 'incident', 'punch_item']);

function onlineState() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

export function createFieldEvidenceDraftId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function fieldOutboxOperatorScope(operator = {}) {
  const role = String(operator.role || 'owner').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'owner';
  const operatorId = String(operator.id || operator.worker?.id || '').trim().replace(/[^A-Za-z0-9._:-]/g, '');
  if (operator.authenticated && operatorId) return `${role}:${operatorId}`;
  if (role === 'field_worker' && operator.worker?.id) return `${role}:${String(operator.worker.id)}`;
  return `${role}:${operator.authenticated ? 'authenticated' : 'local'}`;
}

export function draftMatchesOperatorScope(draft, operatorScope) {
  if (!operatorScope) return false;
  if (!draft?.operatorScope) return operatorScope === 'owner:local';
  return draft.operatorScope === operatorScope;
}

function requireOperatorScope(operatorScope) {
  const normalized = String(operatorScope || '').trim();
  if (!normalized || normalized.length > 240) {
    throw new Error('Offline field work requires an active operator scope before it can be retained.');
  }
  return normalized;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Field outbox storage failed.'));
  });
}

export function fieldOutboxAvailable() {
  return typeof window !== 'undefined' && Boolean(window.indexedDB);
}

function openDatabase() {
  if (!fieldOutboxAvailable()) throw new Error('Offline field drafts are unavailable in this browser. Keep this update open and retry when connectivity returns.');
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(EVIDENCE_STORE_NAME)) database.createObjectStore(EVIDENCE_STORE_NAME, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(OPERATION_STORE_NAME)) database.createObjectStore(OPERATION_STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Field outbox storage failed.'));
  });
}

async function withStore(storeName, mode, action) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, mode);
    const result = await action(transaction.objectStore(storeName));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Field outbox transaction failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('Field outbox transaction was aborted.'));
    });
    return result;
  } finally {
    database.close();
  }
}

function sortDrafts(drafts) {
  return drafts.sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')));
}

async function listStore(storeName) {
  return sortDrafts(await withStore(storeName, 'readonly', store => requestResult(store.getAll())));
}

export async function listFieldEvidenceDrafts({ operatorScope } = {}) {
  const drafts = await listStore(EVIDENCE_STORE_NAME);
  return operatorScope ? drafts.filter(draft => draftMatchesOperatorScope(draft, operatorScope)) : drafts;
}

export async function listFieldOperationDrafts({ operatorScope } = {}) {
  const drafts = await listStore(OPERATION_STORE_NAME);
  return operatorScope ? drafts.filter(draft => draftMatchesOperatorScope(draft, operatorScope)) : drafts;
}

export async function fieldEvidenceDraftCount(operatorScope) {
  return (await listFieldEvidenceDrafts({ operatorScope })).length;
}

export async function enqueueFieldEvidenceDraft({ id, jobId, notes, riskLevel, file, operatorScope }) {
  if (!jobId || !file) throw new Error('A job and evidence file are required before saving an offline draft.');
  const scope = requireOperatorScope(operatorScope);
  const drafts = await listFieldEvidenceDrafts();
  const nextSize = Number(file.size || 0);
  const existingSize = drafts.reduce((total, draft) => total + Number(draft.file?.size || 0), 0);
  if (drafts.length >= MAX_EVIDENCE_DRAFTS || existingSize + nextSize > MAX_TOTAL_EVIDENCE_BYTES) {
    throw new Error('The field evidence outbox is full. Reconnect and sync existing evidence before saving another file.');
  }
  const draft = {
    id: String(id || createFieldEvidenceDraftId()),
    kind: 'evidence',
    jobId: String(jobId),
    notes: String(notes || ''),
    riskLevel: String(riskLevel || 'medium'),
    file,
    operatorScope: scope,
    createdAt: new Date().toISOString()
  };
  await withStore(EVIDENCE_STORE_NAME, 'readwrite', store => requestResult(store.put(draft)));
  return draft;
}

function operationSize(draft) {
  return JSON.stringify({ type: draft.type, jobId: draft.jobId, payload: draft.payload, operatorScope: draft.operatorScope }).length * 2;
}

export async function enqueueFieldOperationDraft({ id, type, jobId, payload, operatorScope }) {
  const normalizedType = String(type || '').trim().toLowerCase();
  if (!FIELD_OPERATION_TYPES.has(normalizedType)) throw new Error('This field operation cannot be retained for an offline retry.');
  if (!jobId || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('A job and structured field operation are required before saving an offline draft.');
  }
  const scope = requireOperatorScope(operatorScope);
  const drafts = await listFieldOperationDrafts();
  const draft = {
    id: String(id || createFieldEvidenceDraftId()),
    kind: 'operation',
    type: normalizedType,
    jobId: String(jobId),
    payload: { ...payload },
    operatorScope: scope,
    createdAt: new Date().toISOString()
  };
  const existingSize = drafts.reduce((total, item) => total + operationSize(item), 0);
  if (drafts.length >= MAX_OPERATION_DRAFTS || existingSize + operationSize(draft) > MAX_TOTAL_OPERATION_BYTES) {
    throw new Error('The field operation outbox is full. Reconnect and sync existing daily logs, production output, progress updates, inspection checklists, field risk reports, and punch items before saving another draft.');
  }
  await withStore(OPERATION_STORE_NAME, 'readwrite', store => requestResult(store.put(draft)));
  return draft;
}

export async function removeFieldEvidenceDraft(id) {
  await withStore(EVIDENCE_STORE_NAME, 'readwrite', store => requestResult(store.delete(id)));
}

export async function removeFieldOperationDraft(id) {
  await withStore(OPERATION_STORE_NAME, 'readwrite', store => requestResult(store.delete(id)));
}

export async function fieldOutboxSnapshot(operatorScope) {
  const [evidence, operations] = await Promise.all([listFieldEvidenceDrafts(), listFieldOperationDrafts()]);
  const currentEvidence = evidence.filter(draft => draftMatchesOperatorScope(draft, operatorScope));
  const currentOperations = operations.filter(draft => draftMatchesOperatorScope(draft, operatorScope));
  const items = sortDrafts([
    ...currentEvidence.map(draft => ({ ...draft, kind: 'evidence' })),
    ...currentOperations.map(draft => ({ ...draft, kind: 'operation' }))
  ]);
  return {
    pending: items.length,
    evidence: currentEvidence.length,
    operations: currentOperations.length,
    quarantined: evidence.length + operations.length - items.length,
    items
  };
}

export function shouldQueueFieldMutation(error, online = onlineState()) {
  return online === false || error?.name === 'TypeError' || error?.code === 'network_error';
}

export const shouldQueueEvidenceUpload = shouldQueueFieldMutation;

export async function flushFieldOutbox({ operatorScope, sendEvidence, sendOperation }) {
  if (!fieldOutboxAvailable()) {
    return { sent: 0, pending: 0, evidence: 0, operations: 0, quarantined: 0, items: [], stopped: 'unavailable' };
  }
  const snapshot = await fieldOutboxSnapshot(operatorScope);
  if (!onlineState()) return { sent: 0, ...snapshot, stopped: 'offline' };
  let sent = 0;
  let stopped = null;
  for (const draft of snapshot.items) {
    try {
      if (draft.kind === 'evidence') {
        if (typeof sendEvidence !== 'function') throw new Error('Evidence outbox transport is unavailable.');
        await sendEvidence(draft);
        await removeFieldEvidenceDraft(draft.id);
      } else {
        if (typeof sendOperation !== 'function') throw new Error('Field operation outbox transport is unavailable.');
        await sendOperation(draft);
        await removeFieldOperationDraft(draft.id);
      }
      sent += 1;
    } catch (error) {
      stopped = error;
      break;
    }
  }
  return { sent, ...(await fieldOutboxSnapshot(operatorScope)), stopped };
}

export async function flushFieldEvidenceDrafts(sendDraft, { operatorScope } = {}) {
  const result = await flushFieldOutbox({ operatorScope, sendEvidence: sendDraft, sendOperation: null });
  return { sent: result.sent, pending: result.evidence, stopped: result.stopped };
}
