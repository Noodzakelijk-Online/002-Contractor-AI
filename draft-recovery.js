import { useEffect, useMemo, useRef } from 'react'

export const DRAFT_STORAGE_PREFIX = 'contractor-ai:draft:v1:'
export const DRAFT_SCHEMA_VERSION = 1
export const DRAFT_TTL_MS = 12 * 60 * 60 * 1000
export const MAX_DRAFT_BYTES = 128 * 1024
export const MAX_DRAFT_STORAGE_BYTES = 1024 * 1024

const SENSITIVE_KEY = /access[_-]?key|authorization|cookie|password|secret|token/i

function cleanSegment(value, fallback) {
  const normalized = String(value || '').trim().replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 180)
  return normalized || fallback
}

export function draftScopeFingerprint(value) {
  const input = String(value || '')
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193) >>> 0
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}

export function draftStorageKey(scope, name) {
  return `${DRAFT_STORAGE_PREFIX}${cleanSegment(scope, 'unscoped')}:${cleanSegment(name, 'draft')}`
}

export function browserDraftStorage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

function draftJson(value) {
  return JSON.stringify(value, (key, item) => {
    if (SENSITIVE_KEY.test(key)) return undefined
    if (typeof File !== 'undefined' && item instanceof File) return undefined
    if (typeof Blob !== 'undefined' && item instanceof Blob) return undefined
    if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) return undefined
    return item
  })
}

function entryBytes(key, value) {
  return (String(key).length + String(value).length) * 2
}

function draftEntries(storage) {
  const entries = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key?.startsWith(DRAFT_STORAGE_PREFIX)) continue
    const raw = storage.getItem(key)
    let updatedAt = 0
    try {
      updatedAt = Number(JSON.parse(raw)?.updatedAt || 0)
    } catch {
      updatedAt = 0
    }
    entries.push({ key, raw: raw || '', updatedAt, bytes: entryBytes(key, raw || '') })
  }
  return entries
}

function pruneDraftStorage(storage, requiredBytes, now) {
  const entries = draftEntries(storage)
  let retainedBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
  for (const entry of entries) {
    if (!entry.updatedAt || now - entry.updatedAt > DRAFT_TTL_MS) {
      storage.removeItem(entry.key)
      retainedBytes -= entry.bytes
    }
  }
  const survivors = draftEntries(storage).sort((left, right) => left.updatedAt - right.updatedAt)
  for (const entry of survivors) {
    if (retainedBytes + requiredBytes <= MAX_DRAFT_STORAGE_BYTES) break
    storage.removeItem(entry.key)
    retainedBytes -= entry.bytes
  }
  return retainedBytes + requiredBytes <= MAX_DRAFT_STORAGE_BYTES
}

export function readSessionDraft(storage, scope, name, now = Date.now()) {
  if (!storage) return { found: false, value: null }
  const key = draftStorageKey(scope, name)
  const raw = storage.getItem(key)
  if (!raw) return { found: false, value: null }
  try {
    const entry = JSON.parse(raw)
    if (entry?.version !== DRAFT_SCHEMA_VERSION || !Number.isFinite(entry.updatedAt) || now - entry.updatedAt > DRAFT_TTL_MS) {
      storage.removeItem(key)
      return { found: false, value: null }
    }
    return { found: true, value: entry.value, updatedAt: entry.updatedAt }
  } catch {
    storage.removeItem(key)
    return { found: false, value: null }
  }
}

export function writeSessionDraft(storage, scope, name, value, now = Date.now()) {
  if (!storage) return false
  const key = draftStorageKey(scope, name)
  let raw
  try {
    raw = draftJson({ version: DRAFT_SCHEMA_VERSION, updatedAt: now, value })
  } catch {
    return false
  }
  const bytes = entryBytes(key, raw)
  if (!raw || bytes > MAX_DRAFT_BYTES) {
    storage.removeItem(key)
    return false
  }
  try {
    const previous = storage.getItem(key)
    if (previous) storage.removeItem(key)
    if (!pruneDraftStorage(storage, bytes, now)) {
      if (previous) storage.setItem(key, previous)
      return false
    }
    storage.setItem(key, raw)
    return true
  } catch {
    return false
  }
}

export function removeSessionDraft(storage, scope, name) {
  if (!storage) return
  storage.removeItem(draftStorageKey(scope, name))
}

export function clearSessionDraftScope(storage, scope) {
  if (!storage) return 0
  const prefix = `${DRAFT_STORAGE_PREFIX}${cleanSegment(scope, 'unscoped')}:`
  const keys = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(prefix)) keys.push(key)
  }
  keys.forEach(key => storage.removeItem(key))
  return keys.length
}

export function useSessionDraftRecovery({ enabled, scope, name, value, setValue, delayMs = 180 }) {
  const storage = useMemo(() => browserDraftStorage(), [])
  const key = enabled && scope ? draftStorageKey(scope, name) : ''
  const hydratedKeyRef = useRef('')
  const skipPersistRef = useRef(false)
  const writeTimerRef = useRef(null)

  useEffect(() => {
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current)
    hydratedKeyRef.current = ''
    if (!key || !storage) return
    const restored = readSessionDraft(storage, scope, name)
    hydratedKeyRef.current = key
    skipPersistRef.current = true
    if (restored.found) setValue(restored.value)
  }, [key, name, scope, setValue, storage])

  useEffect(() => {
    if (!key || !storage || hydratedKeyRef.current !== key) return undefined
    if (skipPersistRef.current) {
      skipPersistRef.current = false
      return undefined
    }
    writeTimerRef.current = setTimeout(() => {
      writeSessionDraft(storage, scope, name, value)
      writeTimerRef.current = null
    }, delayMs)
    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current)
      writeTimerRef.current = null
    }
  }, [delayMs, key, name, scope, storage, value])
}
