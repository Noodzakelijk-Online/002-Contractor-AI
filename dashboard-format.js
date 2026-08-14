import { normalizeLocale } from './locale'

let dashboardLocale = 'en-GB'
const numberFormatters = new Map()
const dateFormatters = new Map()

const STATUS_NL = Object.freeze({
  accepted: 'geaccepteerd',
  acknowledged: 'bevestigd',
  active: 'actief',
  approved: 'goedgekeurd',
  archived: 'gearchiveerd',
  assigned: 'toegewezen',
  available: 'beschikbaar',
  blocked: 'geblokkeerd',
  cancelled: 'geannuleerd',
  chained: 'gekoppeld',
  checked_out: 'uitgegeven',
  closed: 'gesloten',
  completed: 'voltooid',
  conflict: 'conflict',
  current: 'geldig',
  damaged: 'beschadigd',
  declined: 'afgewezen',
  delayed: 'vertraagd',
  discrepancy: 'afwijking',
  draft: 'concept',
  due: 'verschuldigd',
  expired: 'verlopen',
  expiring: 'verloopt binnenkort',
  failed: 'mislukt',
  in_progress: 'in uitvoering',
  invalid: 'ongeldig',
  issued: 'uitgegeven',
  lost: 'vermist',
  maintenance: 'onderhoud',
  missing: 'ontbreekt',
  needs_assignment: 'toewijzing nodig',
  needs_attention: 'aandacht nodig',
  needs_instruction: 'instructie nodig',
  not_started: 'niet gestart',
  open: 'open',
  operator_preference: 'operatorvoorkeur',
  overdue: 'te laat',
  paid: 'betaald',
  paused: 'gepauzeerd',
  pending: 'in afwachting',
  pending_approval: 'wacht op goedkeuring',
  pending_cancellation: 'annulering in behandeling',
  pending_reversal: 'terugboeking in behandeling',
  planned: 'gepland',
  quarantined: 'in quarantaine',
  ready: 'gereed',
  ready_to_schedule: 'gereed om te plannen',
  received: 'ontvangen',
  rejected: 'afgewezen',
  resolved: 'opgelost',
  restored: 'hersteld',
  retired: 'beindigd',
  review_required: 'beoordeling vereist',
  scheduled: 'ingepland',
  stable: 'stabiel',
  submitted: 'ingediend',
  superseded: 'vervangen',
  unsafe: 'onveilig',
  unavailable: 'niet beschikbaar',
  upcoming: 'aankomend',
  update_operator_locale: 'operator-taal bijgewerkt',
  verified: 'geverifieerd',
  void: 'vervallen',
})

const STATUS_TOKEN_NL = Object.freeze({
  access: 'toegang',
  action: 'actie',
  approval: 'goedkeuring',
  assignment: 'toewijzing',
  audit: 'audit',
  availability: 'beschikbaarheid',
  cancellation: 'annulering',
  client: 'klant',
  closeout: 'oplevering',
  created: 'aangemaakt',
  credential: 'kwalificatie',
  deleted: 'verwijderd',
  document: 'document',
  equipment: 'materieel',
  event: 'gebeurtenis',
  evidence: 'onderbouwing',
  general: 'algemeen',
  inspection: 'inspectie',
  instruction: 'instructie',
  invoice: 'factuur',
  job: 'opdracht',
  log: 'registratie',
  maintenance: 'onderhoud',
  material: 'materiaal',
  orientation: 'introductie',
  partner: 'partner',
  payment: 'betaling',
  receipt: 'ontvangst',
  recorded: 'vastgelegd',
  requirement: 'vereiste',
  resolved: 'afgehandeld',
  retirement: 'beeindiging',
  reversed: 'teruggeboekt',
  review: 'beoordeling',
  schedule: 'planning',
  site: 'locatie',
  status: 'status',
  submitted: 'ingediend',
  task: 'taak',
  time: 'uren',
  tool: 'materieel',
  trade: 'handel',
  updated: 'bijgewerkt',
  worker: 'medewerker',
})

const FALLBACK_NL = Object.freeze({
  'Not retained': 'Niet vastgelegd',
  'Not scheduled': 'Niet ingepland',
})

function localizedFallback(key) {
  return dashboardLocale === 'nl-NL' ? FALLBACK_NL[key] || key : key
}

function numberFormatter(locale, options) {
  const key = `${locale}:${JSON.stringify(options)}`
  if (!numberFormatters.has(key)) numberFormatters.set(key, new Intl.NumberFormat(locale, options))
  return numberFormatters.get(key)
}

function dateFormatter(locale, options) {
  const key = `${locale}:${JSON.stringify(options)}`
  if (!dateFormatters.has(key)) dateFormatters.set(key, new Intl.DateTimeFormat(locale, options))
  return dateFormatters.get(key)
}

export function setDashboardLocale(locale) {
  dashboardLocale = normalizeLocale(locale)
}

export const currency = {
  format(value) {
    return formatCurrency(value)
  },
}

export function formatCurrency(value, currencyCode = 'EUR') {
  const code = /^[A-Z]{3}$/.test(String(currencyCode || '').toUpperCase())
    ? String(currencyCode).toUpperCase()
    : 'EUR'
  try {
    return numberFormatter(dashboardLocale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${code} ${Number(value || 0).toFixed(2)}`
  }
}

export function formatNumber(value, options = {}) {
  const number = Number(value)
  return numberFormatter(dashboardLocale, options).format(Number.isFinite(number) ? number : 0)
}

export const EMPTY_LIST = []

export const RESOURCE_ACTION_LABELS = {
  complete_worker_orientation: 'Orientation evidence',
  prepare_site_access: 'Site-access gate',
  record_time_log: 'Record time',
  review_material_status: 'Confirm material',
  request_procurement_approval: 'Request procurement approval',
}

export function formatStatus(value) {
  const status = String(value || 'pending')
  if (dashboardLocale === 'nl-NL' && STATUS_NL[status]) return STATUS_NL[status]
  if (dashboardLocale === 'nl-NL') {
    return status
      .split('_')
      .map(token => STATUS_TOKEN_NL[token] || token)
      .join(' ')
  }
  return status.replace(/_/g, ' ')
}

export function formatDate(value) {
  if (!value) return localizedFallback('Not scheduled')
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : dateFormatter(dashboardLocale, { day: 'numeric', month: 'short' }).format(parsed)
}

export function formatDateTime(value) {
  if (!value) return localizedFallback('Not retained')
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : dateFormatter(dashboardLocale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(parsed)
}

export function formatReadableDate(value, includeTime = false) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return dateFormatter(dashboardLocale, includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(parsed)
}

export function formatWeekday(value) {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : dateFormatter(dashboardLocale, { weekday: 'short', timeZone: 'UTC' }).format(parsed)
}

export function roundDisplay(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0'
  return formatNumber(number, { maximumFractionDigits: 2 })
}

export function shortHash(value) {
  const hash = String(value || '')
  return hash.length > 16
    ? `${hash.slice(0, 8)}...${hash.slice(-8)}`
    : hash || localizedFallback('Not retained')
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
