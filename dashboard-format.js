export const currency = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const EMPTY_LIST = []

export const RESOURCE_ACTION_LABELS = {
  complete_worker_orientation: 'Orientation evidence',
  prepare_site_access: 'Site-access gate',
  record_time_log: 'Record time',
  review_material_status: 'Confirm material',
  request_procurement_approval: 'Request procurement approval',
}

export function formatStatus(value) {
  return String(value || 'pending').replace(/_/g, ' ')
}

export function formatDate(value) {
  if (!value) return 'Not scheduled'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' }).format(parsed)
}

export function formatDateTime(value) {
  if (!value) return 'Not retained'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : new Intl.DateTimeFormat('nl-NL', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(parsed)
}

export function roundDisplay(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0'
  return new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 }).format(number)
}

export function shortHash(value) {
  const hash = String(value || '')
  return hash.length > 16 ? `${hash.slice(0, 8)}...${hash.slice(-8)}` : hash || 'Not retained'
}

export function toLocalDateTimeInput(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function toIsoDateTime(value) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function futureDateInput(days) {
  const future = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  return future.toISOString().slice(0, 10)
}

export function mondayDateInput(value = new Date()) {
  const date = value instanceof Date ? new Date(value) : new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const calendarDay = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${calendarDay}`
}
