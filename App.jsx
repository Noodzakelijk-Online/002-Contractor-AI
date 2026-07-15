import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Archive,
  ArrowUpRight,
  BadgeCheck,
  Ban,
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  CloudOff,
  FileDown,
  FileUp,
  Copy,
  Eye,
  EyeOff,
  FolderArchive,
  Gauge,
  GitBranch,
  HardHat,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MailCheck,
  MapPin,
  MessageSquareText,
  Menu,
  PackageCheck,
  Pencil,
  Plus,
  ReceiptEuro,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Target,
  Timer,
  TriangleAlert,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import {
  createFieldEvidenceDraftId,
  enqueueFieldEvidenceDraft,
  enqueueFieldOperationDraft,
  fieldOutboxAvailable,
  fieldOutboxOperatorScope,
  fieldOutboxSnapshot,
  flushFieldOutbox,
  shouldQueueFieldMutation,
} from './field-outbox'
import './App.css'

const navItems = [
  ['today', 'Today', LayoutDashboard],
  ['pipeline', 'Pipeline', Target],
  ['jobs', 'Jobs', BriefcaseBusiness],
  ['approvals', 'Approvals', ClipboardCheck],
  ['dispatch', 'Dispatch', MapPin],
  ['resources', 'Resources', Wrench],
  ['finance', 'Finance', ReceiptEuro],
  ['clients', 'Clients', BadgeCheck],
  ['field', 'Field updates', HardHat],
  ['operations', 'Operations', Gauge],
]

const currency = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const EMPTY_LIST = []
const EQUIPMENT_EDITABLE_STATUSES = new Set(['available', 'in_use', 'maintenance', 'inspection_due', 'inactive', 'lost'])
const FIELD_ASSURANCE_REVIEW_PRIORITY = [
  'resolve_incident',
  'clear_site_access',
  'review_rfi',
  'review_permit',
  'review_document',
  'review_inspection',
  'resolve_observation',
  'review_submittal',
  'complete_quality_review',
  'complete_safety_check',
  'resolve_punch_item',
  'review_jha',
  'request_sds',
  'complete_safety_meeting',
  'complete_orientation',
]
const FINANCE_ACTION_LABELS = {
  create_credit_note: 'Credit invoice',
  record_supplier_invoice: 'Supplier invoice',
  record_supplier_payment: 'Supplier payment',
  record_payment_reconciliation: 'Record payment',
  record_payment_follow_up: 'Payment follow-up',
  prepare_finance_handoff: 'Finance handoff',
  record_time_expense: 'Record costs',
  create_budget_line: 'Budget baseline',
  create_billing_milestone: 'Billing milestone',
  create_draw_request: 'Progress draw',
  request_lien_waiver: 'Waiver request',
}
const RESOURCE_ACTION_LABELS = {
  complete_worker_orientation: 'Orientation evidence',
  prepare_site_access: 'Site-access gate',
  record_time_log: 'Record time',
  review_material_status: 'Confirm material',
  request_procurement_approval: 'Request procurement approval',
}

const TRANSIENT_REQUEST_RETRY_DELAYS_MS = [250, 750]

function isTransientRequestError(error) {
  if (Number.isInteger(error?.status)) return false
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(String(error?.message || ''))
}

async function retryTransientRequest(operation) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const delay = TRANSIENT_REQUEST_RETRY_DELAYS_MS[attempt]
      if (!isTransientRequestError(error) || delay === undefined) throw error
      await new Promise((resolve) => window.setTimeout(resolve, delay))
    }
  }
}

async function api(path, options = {}) {
  const request = async () => {
    const headers = options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers
    const response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      headers,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(payload.error?.message || 'The ledger request could not be completed.')
      error.code = payload.error?.code || 'request_failed'
      error.status = response.status
      throw error
    }
    return payload
  }
  return String(options.method || 'GET').toUpperCase() === 'GET' ? retryTransientRequest(request) : request()
}

async function recordFieldEvidence({ id, jobId, notes, riskLevel, file }) {
  const payload = new FormData()
  payload.append('evidenceFile', file)
  payload.append('jobId', jobId)
  payload.append('notes', notes)
  payload.append('riskLevel', riskLevel)
  payload.append('category', file.type.startsWith('image/') ? 'field_photo' : 'document')
  payload.append('attachToBuild', 'false')
  const response = await fetch('/api/ledger/upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Idempotency-Key': id || createFieldEvidenceDraftId() },
    body: payload,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(result.error?.message || 'Evidence could not be recorded.')
    error.code = result.error?.code || 'upload_failed'
    throw error
  }
  return result
}

async function recordFieldOperation({ id, type, jobId, payload }) {
  const route = type === 'daily_log' ? 'daily-logs' : type === 'progress' ? 'progress' : null
  if (!route) throw new Error('This queued field operation is not supported.')
  return api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/${route}`, {
    method: 'POST',
    body: JSON.stringify({ ...payload, entryKey: id }),
  })
}

function formatStatus(value) {
  return String(value || 'pending').replace(/_/g, ' ')
}

function formatDate(value) {
  if (!value) return 'Not scheduled'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' }).format(parsed)
}

function formatDateTime(value) {
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

function roundDisplay(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0'
  return new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 }).format(number)
}

function shortHash(value) {
  const hash = String(value || '')
  return hash.length > 16 ? `${hash.slice(0, 8)}...${hash.slice(-8)}` : hash || 'Not retained'
}

function toLocalDateTimeInput(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function toIsoDateTime(value) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function suggestedEndInput(startValue, estimatedHours = 4) {
  const start = new Date(startValue)
  if (Number.isNaN(start.getTime())) return ''
  return toLocalDateTimeInput(new Date(start.getTime() + Math.max(1, Number(estimatedHours) || 4) * 60 * 60 * 1000))
}

function futureDateInput(days) {
  const future = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  return future.toISOString().slice(0, 10)
}

function emptyFieldDailyLog() {
  return {
    entryKey: createFieldEvidenceDraftId(),
    jobId: '',
    workerId: '',
    workDate: futureDateInput(0),
    hours: '',
    manpower: '1',
    weather: 'clear',
    workCompleted: '',
    blockers: '',
    safetyConcern: false,
    safetyRiskLevel: 'high',
    safetyNotes: '',
  }
}

function emptyFieldProgress() {
  return {
    entryKey: createFieldEvidenceDraftId(),
    jobId: '',
    progressPercent: '',
    status: 'in_progress',
    note: '',
  }
}

function emptyTaskDraft() {
  return {
    title: '',
    priority: 'medium',
    dueAt: futureDateInput(1),
    assigneeId: '',
    durationHours: '8',
    predecessorTaskId: '',
  }
}

function emptyQuoteDraft(job = null) {
  return {
    validUntil: futureDateInput(30),
    taxRate: '21',
    notes: '',
    lineItems: [
      {
        description: job?.title || '',
        quantity: '1',
        unitPrice: job?.estimatedCost ? String(job.estimatedCost) : '',
        costCode: 'contract',
      },
    ],
  }
}

function emptyChangeOrderDraft(job = null) {
  const referenceQuote = (job?.quotes || []).find((quote) => ['accepted', 'approved'].includes(quote.status))
  return {
    quoteId: referenceQuote?.id || '',
    title: '',
    scopeDelta: '',
    scheduleDeltaDays: '0',
    taxRate: referenceQuote?.taxRate == null ? '21' : String(referenceQuote.taxRate),
    notes: '',
    lineItems: [{ description: '', quantity: '1', unitPrice: '', costCode: 'change_order' }],
  }
}

function emptyCommercialAcceptanceDraft() {
  return {
    acceptedAt: new Date().toISOString().slice(0, 10),
    evidenceReference: '',
    notes: '',
  }
}

function emptyFinanceActionDraft() {
  return {
    outcome: 'follow_up_recorded',
    amount: '',
    taxRate: '21',
    forecastAmount: '',
    hours: '',
    rate: '52',
    expenseAmount: '',
    plannedIssueAt: futureDateInput(7),
    dueAt: futureDateInput(7),
    paidAt: futureDateInput(0),
    method: 'bank_transfer',
    reference: '',
    vendor: '',
    category: 'materials',
    costCode: '00-100',
    description: '',
    targetSystem: 'FAB',
    exportFormat: 'json',
    percentComplete: '0',
    followUpChannel: 'internal',
    waiverType: 'conditional',
    invoiceNumber: '',
    invoiceDate: futureDateInput(0),
    taxAmount: '',
    deliveryReference: '',
    notes: '',
  }
}

function emptyResourceActionDraft() {
  return {
    workerName: '',
    company: 'Internal crew',
    workDate: futureDateInput(0),
    hours: '',
    rate: '52',
    costCode: 'labor',
    materialStatus: 'available',
    availableQuantity: '',
    location: '',
    reference: '',
    supplier: '',
    tradePartnerId: '',
    amount: '',
    requiredBy: futureDateInput(7),
    notes: '',
  }
}

function emptyTradePartnerDraft(partner = null) {
  const data = partner?.data || {}
  return {
    id: partner?.id || '',
    name: partner?.name || '',
    partnerType: partner?.partnerType || 'supplier',
    status: partner?.status === 'on_hold' ? 'on_hold' : 'active',
    contactName: partner?.contactName || '',
    email: partner?.email || '',
    phone: partner?.phone || '',
    city: partner?.city || '',
    country: partner?.country || 'NL',
    registrationNumber: partner?.registrationNumber || '',
    vatNumber: partner?.vatNumber || '',
    vatExempt: data.vatExempt === true,
    specialties: (partner?.specialties || []).join(', '),
    requiresInsurance: data.requiresInsurance === true,
    insuranceExpiresAt: partner?.insuranceExpiresAt ? String(partner.insuranceExpiresAt).slice(0, 10) : '',
    requiresVca: data.requiresVca === true,
    vcaExpiresAt: partner?.vcaExpiresAt ? String(partner.vcaExpiresAt).slice(0, 10) : '',
    verificationReference: data.verificationReference || '',
    verifiedAt: data.verifiedAt ? String(data.verifiedAt).slice(0, 10) : new Date().toISOString().slice(0, 10),
    notes: data.notes || '',
  }
}

function emptyWorkerDraft(worker = null) {
  const data = worker?.data || {}
  return {
    id: worker?.id || '',
    name: worker?.name || '',
    role: worker?.role || '',
    status: worker?.status && worker.status !== 'retired' ? worker.status : 'available',
    email: worker?.email || '',
    phone: worker?.phone || '',
    homeRegion: worker?.homeRegion || '',
    hourlyRate: worker?.hourlyRate === null || worker?.hourlyRate === undefined ? '' : String(worker.hourlyRate),
    skills: (worker?.skills || []).join(', '),
    notes: data.notes || '',
  }
}

function emptyEquipmentDraft(tool = null) {
  const data = tool?.data || {}
  const retainedStatus = tool?.status || 'available'
  return {
    id: tool?.id || '',
    name: tool?.name || '',
    category: tool?.category || 'general',
    status: EQUIPMENT_EDITABLE_STATUSES.has(retainedStatus) ? retainedStatus : retainedStatus === 'retired' ? 'available' : 'in_use',
    homeLocation: tool?.homeLocation || '',
    currentLocation: tool?.currentLocation || '',
    serialNumber: data.serialNumber || '',
    inspectionRequired: data.inspectionRequired === true || Boolean(data.inspectionDueAt),
    inspectionDueAt: data.inspectionDueAt ? String(data.inspectionDueAt).slice(0, 10) : '',
    notes: data.notes || '',
  }
}

function emptyEquipmentInspectionDraft() {
  return {
    result: 'passed',
    inspector: '',
    inspectedAt: new Date().toISOString().slice(0, 10),
    nextDueAt: futureDateInput(365),
    reference: '',
    notes: '',
  }
}

function emptyEquipmentMaintenanceDraft() {
  return {
    outcome: 'completed',
    maintenanceType: 'corrective',
    performedBy: '',
    performedAt: new Date().toISOString().slice(0, 10),
    reference: '',
    notes: '',
  }
}

function organizationDraft(profile = {}) {
  return {
    legalName: profile.legalName || '',
    tradingName: profile.tradingName || '',
    registrationNumber: profile.registrationNumber || '',
    electronicAddressScheme: profile.data?.electronicAddressScheme || '',
    electronicAddress: profile.data?.electronicAddress || '',
    vatNumber: profile.vatNumber || '',
    vatExempt: profile.data?.vatExempt === true,
    email: profile.email || '',
    phone: profile.phone || '',
    website: profile.website || '',
    address: profile.address || '',
    postalCode: profile.postalCode || '',
    city: profile.city || '',
    country: profile.country || 'NL',
    iban: profile.iban || '',
    bic: profile.bic || '',
    defaultPaymentTermsDays: String(profile.defaultPaymentTermsDays || 30),
    defaultQuoteValidityDays: String(profile.defaultQuoteValidityDays || 30),
    quoteTerms: profile.data?.quoteTerms || '',
    notes: profile.data?.notes || '',
  }
}

function emptyInvoiceDraft() {
  return {
    billingMilestoneId: '',
    amount: '',
    taxRate: '21',
    dueAt: futureDateInput(14),
    peppolReady: true,
    buyerReference: '',
    purchaseOrderReference: '',
    buyerLegalName: '',
    buyerRegistrationNumber: '',
    buyerEndpointScheme: '0106',
    buyerEndpointId: '',
    buyerAddress: '',
    buyerPostalCode: '',
    buyerCity: '',
    buyerCountry: 'NL',
    notes: '',
  }
}

function emptyOpportunityDraft(opportunity = null) {
  return {
    clientName: opportunity?.client?.name || '',
    company: opportunity?.client?.company || '',
    email: opportunity?.client?.email || '',
    phone: opportunity?.client?.phone || '',
    title: opportunity?.title || '',
    stage: opportunity?.stage || 'new',
    service: opportunity?.service || '',
    sourceChannel: opportunity?.sourceChannel || 'manual',
    description: opportunity?.description || '',
    address: opportunity?.address || '',
    city: opportunity?.city || '',
    estimatedValue: opportunity ? String(opportunity.estimatedValue || '') : '',
    probabilityPercent: opportunity ? String(opportunity.probabilityPercent ?? 10) : '10',
    targetDecisionAt: toLocalDateTimeInput(opportunity?.targetDecisionAt),
    nextFollowUpAt: toLocalDateTimeInput(opportunity?.nextFollowUpAt),
    ownerName: opportunity?.ownerName || '',
    lostReason: opportunity?.lostReason || '',
  }
}

function emptyOpportunityActivityDraft() {
  return {
    activityType: 'follow_up',
    summary: '',
    dueAt: '',
    notes: '',
  }
}

function emptyRfiDraft() {
  return {
    title: '',
    question: '',
    responsible: '',
    discipline: 'general',
    dueAt: futureDateInput(3),
  }
}

function emptySubmittalDraft() {
  return {
    title: '',
    packageName: '',
    material: '',
    responsible: '',
    reviewer: '',
    dueAt: futureDateInput(7),
    attachments: '',
  }
}

function emptyControlledDocumentDraft() {
  return {
    title: '',
    documentNumber: '',
    revision: 'P01',
    discipline: 'general',
    purpose: 'construction',
    sourceReference: '',
    revisionReason: '',
  }
}

function emptyTransmittalDraft() {
  return {
    subject: '',
    purpose: 'for_information',
    dueAt: futureDateInput(7),
    recipients: '',
    documentIds: [],
    message: '',
  }
}

function parseTransmittalRecipients(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const named = line.match(/^(.+?)\s*<([^<>]+)>$/)
      const email = (named?.[2] || line).trim()
      return {
        name: (named?.[1] || email.split('@')[0] || '').trim(),
        email,
      }
    })
}

function emptyMeetingActionDraft() {
  return {
    key: `meeting-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    ownerName: '',
    dueAt: futureDateInput(7),
    priority: 'medium',
    description: '',
  }
}

function emptyProjectMeetingDraft() {
  return {
    title: '',
    meetingType: 'coordination',
    scheduledAt: toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    location: '',
    chair: '',
    attendees: '',
    agenda: '',
    minutesSummary: '',
    decisions: '',
    actions: [emptyMeetingActionDraft()],
  }
}

function parseMeetingAttendees(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const named = line.match(/^(.+?)\s*<([^<>]+)>$/)
      return {
        name: (named?.[1] || line).trim(),
        email: named?.[2]?.trim() || '',
      }
    })
}

function parseMeetingLines(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function emptyProjectControlReview() {
  return {
    type: '',
    record: null,
    status: '',
    notes: '',
    reference: '',
    receiptId: '',
    acknowledgedBy: '',
    actionId: '',
    completedBy: '',
    scheduledAt: '',
  }
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function fieldScopedDashboard(jobs) {
  const active = jobs.filter((job) => !['archived', 'completed', 'cancelled', 'rejected'].includes(job.status))
  return {
    fieldScoped: true,
    metrics: {
      openJobs: active.length,
      completedJobs: jobs.filter((job) => job.status === 'completed').length,
      pendingApprovals: 0,
      dispatchReadyJobs: 0,
      storedDocuments: 0,
      fieldReports: 0,
      openIncidents: 0,
      safetyChecks: 0,
    },
    money: { estimatedPipeline: 0 },
    nextActions: [],
  }
}

function initialOperatorDashboard(jobs) {
  return { ...fieldScopedDashboard(jobs), fieldScoped: false }
}

function Metric({ icon, label, value, hint, tone = 'default' }) {
  return (
    <article className={`metric metric-${tone}`}>
      <span className="metric-icon">{createElement(icon, { size: 18 })}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </article>
  )
}

function Empty({ title, detail }) {
  return (
    <div className="empty">
      <BadgeCheck size={22} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

const PIPELINE_STAGES = ['new', 'qualifying', 'site_visit', 'estimating', 'proposal', 'negotiating', 'won', 'lost', 'archived']

function PipelineWorkspace({
  opportunities,
  forecast,
  selectedOpportunity,
  canCoordinate,
  submitting,
  onCreate,
  onEdit,
  onSelect,
  onFollowUp,
  onCompleteActivity,
  onConvert,
  onOpenJob,
}) {
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('open')
  const normalizedQuery = query.trim().toLowerCase()
  const rows = useMemo(
    () =>
      opportunities.filter((opportunity) => {
        const stageMatches =
          stage === 'all' ||
          (stage === 'open'
            ? !['won', 'lost', 'archived'].includes(opportunity.stage)
            : opportunity.stage === stage)
        return stageMatches && (!normalizedQuery || JSON.stringify(opportunity).toLowerCase().includes(normalizedQuery))
      }),
    [normalizedQuery, opportunities, stage],
  )
  const summary = forecast?.summary || {}

  return (
    <section className="page-grid pipeline-workspace" data-testid="pipeline-workspace">
      <div className="metrics-grid pipeline-metrics">
        <Metric icon={Target} label="Open opportunities" value={summary.open || 0} hint={`${summary.total || 0} retained leads`} />
        <Metric
          icon={ReceiptEuro}
          label="Weighted forecast"
          value={currency.format(summary.weightedValue || 0)}
          hint={`${currency.format(summary.estimatedValue || 0)} unweighted`}
          tone="green"
        />
        <Metric
          icon={Timer}
          label="Follow-ups due"
          value={summary.overdueFollowUps || 0}
          hint="Internal action required"
          tone={summary.overdueFollowUps ? 'amber' : 'green'}
        />
        <Metric icon={BriefcaseBusiness} label="Converted" value={summary.converted || 0} hint={`${summary.won || 0} verified wins`} tone="blue" />
      </div>

      <section className="panel pipeline-panel">
        <div className="panel-heading pipeline-heading">
          <div>
            <h2>Preconstruction pipeline</h2>
            <p>Qualify demand before work enters planning, resources, or finance.</p>
          </div>
          {canCoordinate ? (
            <button className="primary-button" onClick={onCreate}>
              <Plus size={16} />
              New opportunity
            </button>
          ) : null}
        </div>
        <div className="pipeline-toolbar">
          <label className="search-control">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search client, scope or location" />
          </label>
          <div className="pipeline-stage-tabs" role="group" aria-label="Filter opportunities by stage">
            {['open', 'proposal', 'negotiating', 'won', 'lost', 'all'].map((option) => (
              <button key={option} className={stage === option ? 'active' : ''} onClick={() => setStage(option)}>
                {formatStatus(option)}
              </button>
            ))}
          </div>
        </div>
        {rows.length ? (
          <div className="pipeline-list">
            {rows.map((opportunity) => {
              const overdue =
                opportunity.nextFollowUpAt &&
                Date.parse(opportunity.nextFollowUpAt) <= Date.now() &&
                !['won', 'lost', 'archived'].includes(opportunity.stage)
              return (
                <article
                  className={`pipeline-row ${selectedOpportunity?.id === opportunity.id ? 'pipeline-row-selected' : ''}`}
                  key={opportunity.id}
                >
                  <button className="pipeline-row-main" onClick={() => onSelect(opportunity)} aria-label={`Open ${opportunity.title}`}>
                    <span className={`pipeline-stage-marker pipeline-stage-${opportunity.stage}`} aria-hidden="true" />
                    <span className="pipeline-copy">
                      <span className="pipeline-title">
                        <strong>{opportunity.title}</strong>
                        <span className={`status status-${opportunity.stage}`}>{formatStatus(opportunity.stage)}</span>
                      </span>
                      <small>
                        {opportunity.client?.name || 'Client pending'} / {opportunity.service || 'Service pending'} /{' '}
                        {opportunity.city || opportunity.address || 'Location pending'}
                      </small>
                    </span>
                  </button>
                  <dl className="pipeline-values">
                    <div>
                      <dt>Value</dt>
                      <dd>{currency.format(opportunity.estimatedValue || 0)}</dd>
                    </div>
                    <div>
                      <dt>Weighted</dt>
                      <dd>{currency.format(opportunity.weightedValue || 0)}</dd>
                    </div>
                    <div>
                      <dt>Follow-up</dt>
                      <dd className={overdue ? 'pipeline-overdue' : ''}>
                        {opportunity.nextFollowUpAt ? formatDate(opportunity.nextFollowUpAt) : 'Not planned'}
                      </dd>
                    </div>
                  </dl>
                  <div className="pipeline-actions">
                    {canCoordinate ? (
                      <button className="secondary-button" onClick={() => onEdit(opportunity)}>
                        <Pencil size={15} />
                        Edit
                      </button>
                    ) : null}
                    {canCoordinate && !['won', 'lost', 'archived'].includes(opportunity.stage) ? (
                      <button className="secondary-button" onClick={() => onFollowUp(opportunity)}>
                        <MessageSquareText size={15} />
                        Follow-up
                      </button>
                    ) : null}
                    {opportunity.convertedJobId ? (
                      <button className="icon-button table-action" aria-label={`Open linked job for ${opportunity.title}`} onClick={() => onOpenJob(opportunity)}>
                        <ArrowUpRight size={16} />
                      </button>
                    ) : canCoordinate && !['won', 'lost', 'archived'].includes(opportunity.stage) ? (
                      <button className="primary-button" disabled={submitting} onClick={() => onConvert(opportunity)}>
                        <BriefcaseBusiness size={15} />
                        Create job
                      </button>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <Empty title="No opportunities in this view" detail="Adjust the stage filter or retain a new qualified inquiry." />
        )}
      </section>

      {selectedOpportunity ? (
        <section className="panel pipeline-detail" aria-live="polite">
          <div className="panel-heading">
            <div>
              <h2>{selectedOpportunity.title}</h2>
              <p>
                {selectedOpportunity.client?.name || 'Client pending'} / {formatStatus(selectedOpportunity.stage)} /{' '}
                {selectedOpportunity.probabilityPercent}% probability
              </p>
            </div>
            <button className="icon-button" aria-label="Close opportunity detail" onClick={() => onSelect(null)}>
              <X size={17} />
            </button>
          </div>
          <div className="pipeline-detail-grid">
            <div>
              <span>Owner</span>
              <strong>{selectedOpportunity.ownerName || 'Unassigned'}</strong>
            </div>
            <div>
              <span>Decision target</span>
              <strong>{selectedOpportunity.targetDecisionAt ? formatDate(selectedOpportunity.targetDecisionAt) : 'Not set'}</strong>
            </div>
            <div>
              <span>Source</span>
              <strong>{formatStatus(selectedOpportunity.sourceChannel)}</strong>
            </div>
            <div>
              <span>Linked job</span>
              <strong>{selectedOpportunity.convertedJob?.title || 'Not converted'}</strong>
            </div>
          </div>
          {selectedOpportunity.description ? <p className="pipeline-description">{selectedOpportunity.description}</p> : null}
          <div className="pipeline-activity-heading">
            <div>
              <h3>Activity</h3>
              <p>Internal notes and follow-up drafts; no external delivery occurs here.</p>
            </div>
            {canCoordinate && !['won', 'lost', 'archived'].includes(selectedOpportunity.stage) ? (
              <button className="secondary-button" onClick={() => onFollowUp(selectedOpportunity)}>
                <Plus size={15} />
                Add activity
              </button>
            ) : null}
          </div>
          {selectedOpportunity.activities?.length ? (
            <div className="pipeline-activity-list">
              {selectedOpportunity.activities.map((activity) => (
                <div className="pipeline-activity" key={activity.id}>
                  <span className={`status status-${activity.status}`}>{formatStatus(activity.status)}</span>
                  <div>
                    <strong>{activity.summary}</strong>
                    <small>
                      {formatStatus(activity.activityType)} / {activity.dueAt ? `due ${formatDate(activity.dueAt)}` : formatDate(activity.createdAt)}
                    </small>
                    {activity.notes ? <p>{activity.notes}</p> : null}
                  </div>
                  {canCoordinate && !['completed', 'cancelled'].includes(activity.status) ? (
                    <button className="secondary-button" disabled={submitting} onClick={() => onCompleteActivity(selectedOpportunity, activity)}>
                      <Check size={15} />
                      Complete
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <Empty title="No retained activity" detail="Add the next internal follow-up or qualification note." />
          )}
        </section>
      ) : null}
    </section>
  )
}

function ApprovalQueueItem({ item, submitting, onReview }) {
  const decision = item.decision || {}
  return (
    <article className="approval-item">
      <div className="approval-icon">
        <ShieldCheck size={19} />
      </div>
      <div className="approval-copy">
        <div className="approval-title-row">
          <h3>{item.title || item.summary || formatStatus(item.targetType)}</h3>
          <span className={`tag tag-${decision.riskLevel === 'high' ? 'amber' : 'green'}`}>{decision.riskLevel || 'review'}</span>
        </div>
        <p>{decision.primaryEffect || item.summary || item.reason || 'Review this retained ledger decision.'}</p>
        <small>
          {item.jobTitle || item.jobId || 'Portfolio decision'} / {formatDate(item.createdAt)}
        </small>
      </div>
      <div className="approval-actions">
        <button className="secondary-button" disabled={submitting} onClick={() => onReview(item, 'rejected')}>
          Reject
        </button>
        <button className="primary-button" disabled={submitting} onClick={() => onReview(item, 'approved')}>
          Review and approve
        </button>
      </div>
    </article>
  )
}

function DispatchWorkspace({
  dispatch,
  jobs,
  canCoordinate,
  canApprove,
  submitting,
  onPrepare,
  onControl,
  onReviewWorkforce,
  onReviewEquipment,
  onOpenApprovals,
  onOpen,
}) {
  const rows = dispatch?.jobs || dispatch?.rows || dispatch?.dispatch || EMPTY_LIST
  const summary = dispatch?.summary || {}
  return (
    <section className="panel page-panel dispatch-workspace" data-testid="dispatch-workspace">
      <div className="panel-heading">
        <div>
          <h2>Dispatch readiness</h2>
          <p>Mobilization stays blocked until assignments, access, safety, equipment, and approval controls are ready.</p>
        </div>
        <span className="count-badge">{rows.length}</span>
      </div>
      <div className="dispatch-summary" aria-label="Dispatch summary">
        <div>
          <span>Ready</span>
          <strong>{summary.ready || 0}</strong>
        </div>
        <div>
          <span>Needs plan</span>
          <strong>{summary.needsPlan || 0}</strong>
        </div>
        <div>
          <span>Blocked</span>
          <strong>{summary.blocked || 0}</strong>
        </div>
        <div>
          <span>Approvals</span>
          <strong>{summary.pendingApprovals || 0}</strong>
        </div>
      </div>
      <div className="dispatch-list">
        {rows.map((item) => {
          const job = jobs.find((candidate) => candidate.id === item.jobId) || {
            id: item.jobId,
            title: item.jobTitle || item.title || 'Ledger job',
          }
          const controlActions = (item.nextActions || []).filter((action) => action.recordType && action.recordId).slice(0, 4)
          const workforceBlocker = (item.blockers || []).find((blocker) =>
            ['worker_record_missing', 'worker_retirement_pending', 'worker_unavailable', 'worker_conflict'].includes(blocker.type),
          )
          const equipmentBlocker = (item.blockers || []).find((blocker) =>
            ['tool_record_missing', 'tool_retirement_pending', 'tool_inspection_readiness', 'tool_unavailable'].includes(blocker.type),
          )
          return (
            <article className="dispatch-item" key={item.jobId || item.id}>
              <div className="dispatch-copy">
                <div className="dispatch-title">
                  <h3>{item.jobTitle || item.title || 'Ledger job'}</h3>
                  <span className={`status status-${item.readinessStatus || item.status}`}>
                    {formatStatus(item.readinessStatus || item.status)}
                  </span>
                </div>
                <p>{item.nextAction || item.summary || item.message || 'Review readiness controls before dispatch.'}</p>
                <div className="dispatch-flags">
                  {item.blockers?.length ? (
                    <span className="tag tag-amber">
                      {item.blockers.length} blocker{item.blockers.length === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  {item.missing?.length ? (
                    <span className="tag">
                      {item.missing.length} plan gap{item.missing.length === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  {item.counts?.activeAssignments ? <span className="tag tag-green">{item.counts.activeAssignments} assigned</span> : null}
                </div>
              </div>
              <div className="dispatch-actions">
                {item.counts?.pendingApprovals && canApprove ? (
                  <button
                    className="secondary-button"
                    aria-label={`Review approvals for ${job.title}`}
                    disabled={submitting}
                    onClick={() =>
                      onOpenApprovals({
                        jobId: item.jobId,
                        jobTitle: job.title,
                        approvalId: item.nextActions?.find((action) => action.approvalId)?.approvalId || null,
                      })
                    }
                  >
                    <ShieldCheck size={16} />
                    Review approval
                  </button>
                ) : null}
                {canCoordinate
                  ? controlActions.map((action) => {
                      const actionLabel = action.actionLabel || 'Resolve dispatch control'
                      return (
                        <button
                          key={`${action.type}-${action.recordType}-${action.recordId}`}
                          className="secondary-button"
                          aria-label={`${actionLabel} for ${job.title}`}
                          disabled={submitting}
                          onClick={() => onControl(item, action)}
                        >
                          <ClipboardCheck size={16} />
                          {actionLabel}
                        </button>
                      )
                    })
                  : null}
                {workforceBlocker ? (
                  <button
                    className="secondary-button"
                    aria-label={`Review crew for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onReviewWorkforce(workforceBlocker)}
                  >
                    <Users size={16} />
                    Review crew
                  </button>
                ) : null}
                {equipmentBlocker ? (
                  <button
                    className="secondary-button"
                    aria-label={`Review equipment for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onReviewEquipment(equipmentBlocker)}
                  >
                    <Wrench size={16} />
                    Review equipment
                  </button>
                ) : null}
                {canCoordinate ? (
                  <button
                    className="secondary-button"
                    aria-label={`Prepare internal pack for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onPrepare(item)}
                  >
                    <PackageCheck size={16} />
                    Prepare internal pack
                  </button>
                ) : null}
                <button className="icon-button table-action" aria-label={`Open ${job.title}`} onClick={() => onOpen(job)}>
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </article>
          )
        })}
        {!rows.length ? (
          <Empty title="No active dispatch work" detail="Active ledger jobs will appear here with their retained readiness controls." />
        ) : null}
      </div>
    </section>
  )
}

function WorkerDirectory({ workers, summary, canCoordinate, canApprove, submitting, onCreate, onEdit, onRetire, onOpenApprovals }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('active')
  const visibleWorkers = useMemo(() => {
    const search = query.trim().toLowerCase()
    return (workers || []).filter((worker) => {
      if (filter === 'active' && worker.status === 'retired') return false
      if (filter === 'unavailable' && (worker.status === 'retired' || worker.status === 'available')) return false
      if (filter === 'retired' && worker.status !== 'retired') return false
      if (!search) return true
      return JSON.stringify({
        name: worker.name,
        role: worker.role,
        email: worker.email,
        phone: worker.phone,
        homeRegion: worker.homeRegion,
        skills: worker.skills,
      })
        .toLowerCase()
        .includes(search)
    })
  }, [filter, query, workers])

  return (
    <div className="trade-partner-directory worker-directory" data-testid="worker-directory" role="tabpanel">
      <div className="resource-summary worker-summary" aria-label="Crew summary">
        <div>
          <span>Active crew</span>
          <strong>{summary?.active || 0}</strong>
        </div>
        <div>
          <span>Available</span>
          <strong>{summary?.available || 0}</strong>
        </div>
        <div>
          <span>Unavailable</span>
          <strong>{summary?.unavailable || 0}</strong>
        </div>
        <div>
          <span>Retirement review</span>
          <strong>{summary?.pendingRetirement || 0}</strong>
        </div>
      </div>
      <div className="trade-partner-toolbar worker-toolbar">
        <label className="search-control">
          <Search size={16} />
          <span className="visually-hidden">Search crew directory</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search crew" />
        </label>
        <div className="resource-tabs" role="tablist" aria-label="Crew status">
          {[
            ['active', 'Active'],
            ['unavailable', 'Unavailable'],
            ['retired', 'Retired'],
          ].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              className={filter === key ? 'resource-tab-active' : ''}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {canCoordinate ? (
          <button className="primary-button" disabled={submitting} onClick={onCreate}>
            <Plus size={16} />
            Add crew member
          </button>
        ) : null}
      </div>
      <div className="trade-partner-list worker-list">
        {visibleWorkers.map((worker) => (
          <article className="trade-partner-row worker-row" key={worker.id}>
            <div className="trade-partner-identity worker-identity">
              <span className="partner-icon">
                <HardHat size={18} />
              </span>
              <div>
                <div className="trade-partner-title worker-title">
                  <h3>{worker.name}</h3>
                  <span className={`status status-${worker.status}`}>{formatStatus(worker.status)}</span>
                  {worker.retirementApprovalId ? <span className="tag tag-amber">Retirement pending</span> : null}
                </div>
                <p>
                  {worker.role || 'Role not retained'}
                  {worker.skills?.length ? ` / ${worker.skills.slice(0, 3).join(', ')}` : ''}
                </p>
                <small>{worker.email || worker.phone || 'Contact not retained'}</small>
              </div>
            </div>
            <div className="trade-partner-evidence worker-details">
              <span>
                Home region <strong>{worker.homeRegion || 'Not retained'}</strong>
              </span>
              <span>
                Hourly cost <strong>{currency.format(worker.hourlyRate || 0)}</strong>
              </span>
              <span>
                Active assignments <strong>{worker.activeAssignmentCount || 0}</strong>
              </span>
              <span>
                Last updated <strong>{formatDate(worker.updatedAt)}</strong>
              </span>
              {worker.dormantAssignmentCount ? (
                <span>
                  Dormant assignments <strong>{worker.dormantAssignmentCount}</strong>
                </span>
              ) : null}
            </div>
            <div className="trade-partner-actions worker-actions">
              {worker.retirementApprovalId && canApprove ? (
                <button
                  className="secondary-button"
                  disabled={submitting}
                  onClick={() => onOpenApprovals({ approvalId: worker.retirementApprovalId })}
                >
                  <ShieldCheck size={15} />
                  Review retirement
                </button>
              ) : null}
              {canCoordinate && worker.status !== 'retired' ? (
                <button className="icon-button" aria-label={`Edit ${worker.name}`} disabled={submitting} onClick={() => onEdit(worker)}>
                  <Pencil size={16} />
                </button>
              ) : null}
              {canCoordinate && worker.status !== 'retired' ? (
                <button
                  className="icon-button danger-icon"
                  aria-label={`Request retirement for ${worker.name}`}
                  disabled={submitting || Boolean(worker.retirementApprovalId)}
                  onClick={() => onRetire(worker)}
                >
                  <Archive size={16} />
                </button>
              ) : null}
            </div>
          </article>
        ))}
        {!visibleWorkers.length ? (
          <Empty title="No matching crew members" detail="Retained people records matching this view will appear here." />
        ) : null}
      </div>
    </div>
  )
}

function EquipmentDirectory({
  tools,
  summary,
  canCoordinate,
  canApprove,
  submitting,
  onCreate,
  onEdit,
  onInspect,
  onMaintain,
  onRetire,
  onOpenApprovals,
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('active')
  const visibleTools = useMemo(() => {
    const search = query.trim().toLowerCase()
    return (tools || []).filter((tool) => {
      if (filter === 'active' && tool.status === 'retired') return false
      if (
        filter === 'attention' &&
        ['available', 'retired'].includes(tool.status) &&
        !tool.retirementApprovalId &&
        !tool.inspection?.requiresAttention &&
        !tool.maintenance?.requiresAttention
      )
        return false
      if (filter === 'retired' && tool.status !== 'retired') return false
      if (!search) return true
      return JSON.stringify({
        name: tool.name,
        category: tool.category,
        status: tool.status,
        homeLocation: tool.homeLocation,
        currentLocation: tool.currentLocation,
        serialNumber: tool.data?.serialNumber,
        inspectionStatus: tool.inspection?.status,
        inspectionDueAt: tool.inspection?.dueAt,
        maintenanceStatus: tool.maintenance?.status,
        lastMaintainedAt: tool.maintenance?.lastMaintainedAt,
      })
        .toLowerCase()
        .includes(search)
    })
  }, [filter, query, tools])

  return (
    <div className="trade-partner-directory equipment-directory" data-testid="equipment-directory" role="tabpanel">
      <div className="resource-summary equipment-summary" aria-label="Equipment summary">
        <div>
          <span>Active equipment</span>
          <strong>{summary?.active || 0}</strong>
        </div>
        <div>
          <span>Available</span>
          <strong>{summary?.available || 0}</strong>
        </div>
        <div>
          <span>Attention</span>
          <strong>{summary?.attention || 0}</strong>
        </div>
        <div>
          <span>Retirement review</span>
          <strong>{summary?.pendingRetirement || 0}</strong>
        </div>
      </div>
      <div className="trade-partner-toolbar equipment-toolbar">
        <label className="search-control">
          <Search size={16} />
          <span className="visually-hidden">Search equipment directory</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search equipment" />
        </label>
        <div className="resource-tabs" role="tablist" aria-label="Equipment status">
          {[
            ['active', 'Active'],
            ['attention', 'Attention'],
            ['retired', 'Retired'],
          ].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              className={filter === key ? 'resource-tab-active' : ''}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {canCoordinate ? (
          <button className="primary-button" disabled={submitting} onClick={onCreate}>
            <Plus size={16} />
            Add equipment
          </button>
        ) : null}
      </div>
      <div className="trade-partner-list equipment-list">
        {visibleTools.map((tool) => (
          <article className="trade-partner-row equipment-row" key={tool.id}>
            <div className="trade-partner-identity equipment-identity">
              <span className="partner-icon">
                <Wrench size={18} />
              </span>
              <div>
                <div className="trade-partner-title equipment-title">
                  <h3>{tool.name}</h3>
                  <span className={`status status-${tool.status}`}>{formatStatus(tool.status)}</span>
                  {tool.inspection?.required ? (
                    <span className={`tag ${tool.inspection.requiresAttention ? 'tag-amber' : 'tag-green'}`}>
                      Inspection {formatStatus(tool.inspection.status)}
                    </span>
                  ) : null}
                  {tool.retirementApprovalId ? <span className="tag tag-amber">Retirement pending</span> : null}
                </div>
                <p>{formatStatus(tool.category || 'general equipment')}</p>
                <small>{tool.data?.serialNumber || tool.currentLocation || tool.homeLocation || 'Reference not retained'}</small>
              </div>
            </div>
            <div className="trade-partner-evidence equipment-details">
              <span>
                Current location <strong>{tool.currentLocation || 'Not retained'}</strong>
              </span>
              <span>
                Inspection due <strong>{tool.inspection?.required ? formatDate(tool.inspection.dueAt) : 'Not required'}</strong>
              </span>
              <span>
                Last inspection{' '}
                <strong>
                  {tool.inspection?.lastInspectedAt
                    ? `${formatDate(tool.inspection.lastInspectedAt)} / ${formatStatus(tool.inspection.lastResult)}`
                    : 'Not retained'}
                </strong>
              </span>
              <span>
                Last maintenance{' '}
                <strong>
                  {tool.maintenance?.lastMaintainedAt
                    ? `${formatDate(tool.maintenance.lastMaintainedAt)} / ${formatStatus(tool.maintenance.latestMaintenance?.outcome)}`
                    : 'Not retained'}
                </strong>
              </span>
              <span>
                Active reservations <strong>{tool.activeReservationCount || 0}</strong>
              </span>
              <span>
                Last updated <strong>{formatDate(tool.updatedAt)}</strong>
              </span>
              {tool.dormantReservationCount ? (
                <span>
                  Dormant reservations <strong>{tool.dormantReservationCount}</strong>
                </span>
              ) : null}
            </div>
            <div className="trade-partner-actions equipment-actions">
              {tool.retirementApprovalId && canApprove ? (
                <button
                  className="secondary-button"
                  disabled={submitting}
                  onClick={() => onOpenApprovals({ approvalId: tool.retirementApprovalId })}
                >
                  <ShieldCheck size={15} />
                  Review retirement
                </button>
              ) : null}
              {canCoordinate && tool.status !== 'retired' && !tool.retirementApprovalId ? (
                <button
                  className="secondary-button"
                  aria-label={`Record maintenance for ${tool.name}`}
                  disabled={submitting}
                  onClick={() => onMaintain(tool)}
                >
                  <Wrench size={15} />
                  Maintain
                </button>
              ) : null}
              {canCoordinate && tool.status !== 'retired' && !tool.retirementApprovalId ? (
                <button
                  className="secondary-button"
                  aria-label={`Record inspection for ${tool.name}`}
                  disabled={submitting}
                  onClick={() => onInspect(tool)}
                >
                  <ClipboardCheck size={15} />
                  Inspect
                </button>
              ) : null}
              {canCoordinate && tool.status !== 'retired' ? (
                <button className="icon-button" aria-label={`Edit ${tool.name}`} disabled={submitting} onClick={() => onEdit(tool)}>
                  <Pencil size={16} />
                </button>
              ) : null}
              {canCoordinate && tool.status !== 'retired' ? (
                <button
                  className="icon-button danger-icon"
                  aria-label={`Request retirement for ${tool.name}`}
                  disabled={submitting || Boolean(tool.retirementApprovalId)}
                  onClick={() => onRetire(tool)}
                >
                  <Archive size={16} />
                </button>
              ) : null}
            </div>
          </article>
        ))}
        {!visibleTools.length ? (
          <Empty title="No matching equipment" detail="Retained equipment records matching this view will appear here." />
        ) : null}
      </div>
    </div>
  )
}

function TradePartnerDirectory({ partners, summary, canCoordinate, canApprove, submitting, onCreate, onEdit, onRetire, onOpenApprovals }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('active')
  const visiblePartners = useMemo(() => {
    const search = query.trim().toLowerCase()
    return (partners || []).filter((partner) => {
      if (filter === 'active' && partner.status === 'retired') return false
      if (filter === 'attention' && !['needs_review', 'expired', 'blocked', 'expiring'].includes(partner.compliance?.status)) return false
      if (filter === 'retired' && partner.status !== 'retired') return false
      if (!search) return true
      return JSON.stringify({
        name: partner.name,
        partnerType: partner.partnerType,
        contactName: partner.contactName,
        email: partner.email,
        city: partner.city,
        registrationNumber: partner.registrationNumber,
        vatNumber: partner.vatNumber,
        specialties: partner.specialties,
      })
        .toLowerCase()
        .includes(search)
    })
  }, [filter, partners, query])

  return (
    <div className="trade-partner-directory" data-testid="trade-partner-directory">
      <div className="resource-summary trade-partner-summary" aria-label="Trade partner summary">
        <div>
          <span>Active</span>
          <strong>{summary?.active || 0}</strong>
        </div>
        <div>
          <span>Verified</span>
          <strong>{summary?.verified || 0}</strong>
        </div>
        <div>
          <span>Expiring</span>
          <strong>{summary?.expiring || 0}</strong>
        </div>
        <div>
          <span>Action required</span>
          <strong>{summary?.actionRequired || 0}</strong>
        </div>
      </div>
      <div className="trade-partner-toolbar">
        <label className="search-control">
          <Search size={16} />
          <span className="visually-hidden">Search trade partners</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search partners" />
        </label>
        <div className="resource-tabs" role="tablist" aria-label="Trade partner status">
          {[
            ['active', 'Active'],
            ['attention', 'Attention'],
            ['retired', 'Retired'],
          ].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              className={filter === key ? 'resource-tab-active' : ''}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {canCoordinate ? (
          <button className="primary-button" disabled={submitting} onClick={onCreate}>
            <Plus size={16} />
            Add trade partner
          </button>
        ) : null}
      </div>
      <div className="trade-partner-list">
        {visiblePartners.map((partner) => {
          const compliance = partner.compliance || { status: 'needs_review', blockers: [], warnings: [] }
          const evidenceMessage =
            compliance.blockers?.[0]?.message || compliance.warnings?.[0]?.message || 'Required partner evidence is current.'
          return (
            <article className="trade-partner-row" key={partner.id}>
              <div className="trade-partner-identity">
                <span className="partner-icon">
                  <Building2 size={18} />
                </span>
                <div>
                  <div className="trade-partner-title">
                    <h3>{partner.name}</h3>
                    <span className={`status status-${compliance.status}`}>{formatStatus(compliance.status)}</span>
                  </div>
                  <p>
                    {formatStatus(partner.partnerType)}
                    {partner.specialties?.length ? ` · ${partner.specialties.slice(0, 3).join(', ')}` : ''}
                  </p>
                  <small>{partner.contactName || partner.email || partner.city || 'Contact not retained'}</small>
                </div>
              </div>
              <div className="trade-partner-evidence">
                <span>
                  Registration <strong>{partner.registrationNumber || 'Missing'}</strong>
                </span>
                <span>
                  VAT <strong>{partner.data?.vatExempt ? 'Exempt' : partner.vatNumber || 'Missing'}</strong>
                </span>
                <p>{evidenceMessage}</p>
              </div>
              <div className="trade-partner-actions">
                {partner.retirementApprovalId && canApprove ? (
                  <button
                    className="secondary-button"
                    disabled={submitting}
                    onClick={() => onOpenApprovals({ approvalId: partner.retirementApprovalId })}
                  >
                    <ShieldCheck size={15} />
                    Review retirement
                  </button>
                ) : null}
                {canCoordinate && partner.status !== 'retired' ? (
                  <button className="icon-button" aria-label={`Edit ${partner.name}`} disabled={submitting} onClick={() => onEdit(partner)}>
                    <Pencil size={16} />
                  </button>
                ) : null}
                {canCoordinate && partner.status !== 'retired' ? (
                  <button
                    className="icon-button danger-icon"
                    aria-label={`Request retirement for ${partner.name}`}
                    disabled={submitting || Boolean(partner.retirementApprovalId)}
                    onClick={() => onRetire(partner)}
                  >
                    <Archive size={16} />
                  </button>
                ) : null}
              </div>
            </article>
          )
        })}
        {!visiblePartners.length ? (
          <Empty title="No matching trade partners" detail="Supplier and subcontractor records matching this view will appear here." />
        ) : null}
      </div>
    </div>
  )
}

function ResourcesWorkspace({
  workforce,
  inventory,
  workers,
  workerSummary,
  tools,
  toolSummary,
  tradePartners,
  tradePartnerSummary,
  jobs,
  view,
  onViewChange,
  canCoordinate,
  canApprove,
  submitting,
  onPlan,
  onDraftInstruction,
  onReviewCrewEvidence,
  onPrepareLoading,
  onDraftProcurement,
  onAction,
  onCreateWorker,
  onEditWorker,
  onRetireWorker,
  onCreateEquipment,
  onEditEquipment,
  onInspectEquipment,
  onMaintainEquipment,
  onRetireEquipment,
  onCreatePartner,
  onEditPartner,
  onRetirePartner,
  onOpenApprovals,
  onOpen,
}) {
  const [workforceMode, setWorkforceMode] = useState('readiness')
  const isWorkforce = view === 'workforce'
  const isInventory = view === 'inventory'
  const isEquipment = view === 'equipment'
  const isPartners = view === 'partners'
  const isCrewDirectory = isWorkforce && workforceMode === 'crew'
  const stream = isWorkforce ? workforce : inventory
  const rows = stream?.jobs || EMPTY_LIST
  const summary = stream?.summary || {}

  return (
    <section className="panel page-panel resources-workspace" data-testid="resources-workspace">
      <div className="panel-heading resources-heading">
        <div>
          <h2>Resource readiness</h2>
          <p>
            {isPartners
              ? 'Retain supplier and subcontractor identity, compliance, and expiry evidence before purchasing approval.'
              : isEquipment
                ? 'Maintain retained equipment identity, condition, location, reservation, and retirement safeguards.'
                : isCrewDirectory
                  ? 'Maintain retained crew identity, availability, skills, cost, and assignment safeguards.'
                  : 'Coordinate retained crew, equipment, material, procurement, and loading records before work is committed.'}
          </p>
        </div>
        <div className="resource-tabs" role="tablist" aria-label="Resource readiness view">
          <button
            role="tab"
            aria-selected={isWorkforce}
            className={isWorkforce ? 'resource-tab-active' : ''}
            onClick={() => onViewChange('workforce')}
          >
            <Users size={15} />
            Workforce
          </button>
          <button
            role="tab"
            aria-selected={isInventory}
            className={isInventory ? 'resource-tab-active' : ''}
            onClick={() => onViewChange('inventory')}
          >
            <PackageCheck size={15} />
            Inventory
          </button>
          <button
            role="tab"
            aria-selected={isEquipment}
            className={isEquipment ? 'resource-tab-active' : ''}
            onClick={() => onViewChange('equipment')}
          >
            <Wrench size={15} />
            Equipment
          </button>
          <button
            role="tab"
            aria-selected={isPartners}
            className={isPartners ? 'resource-tab-active' : ''}
            onClick={() => onViewChange('partners')}
          >
            <Building2 size={15} />
            Trade partners
          </button>
        </div>
      </div>
      {isWorkforce ? (
        <div className="workforce-mode-toolbar">
          <div className="resource-tabs" role="tablist" aria-label="Workforce workspace mode">
            <button
              role="tab"
              aria-selected={workforceMode === 'readiness'}
              className={workforceMode === 'readiness' ? 'resource-tab-active' : ''}
              onClick={() => setWorkforceMode('readiness')}
            >
              <ClipboardCheck size={15} />
              Readiness
            </button>
            <button
              role="tab"
              aria-selected={workforceMode === 'crew'}
              className={workforceMode === 'crew' ? 'resource-tab-active' : ''}
              onClick={() => setWorkforceMode('crew')}
            >
              <Users size={15} />
              Crew directory
            </button>
          </div>
        </div>
      ) : null}
      {isPartners ? (
        <TradePartnerDirectory
          partners={tradePartners}
          summary={tradePartnerSummary}
          canCoordinate={canCoordinate}
          canApprove={canApprove}
          submitting={submitting}
          onCreate={onCreatePartner}
          onEdit={onEditPartner}
          onRetire={onRetirePartner}
          onOpenApprovals={onOpenApprovals}
        />
      ) : isEquipment ? (
        <EquipmentDirectory
          tools={tools}
          summary={toolSummary}
          canCoordinate={canCoordinate}
          canApprove={canApprove}
          submitting={submitting}
          onCreate={onCreateEquipment}
          onEdit={onEditEquipment}
          onInspect={onInspectEquipment}
          onMaintain={onMaintainEquipment}
          onRetire={onRetireEquipment}
          onOpenApprovals={onOpenApprovals}
        />
      ) : isCrewDirectory ? (
        <WorkerDirectory
          workers={workers}
          summary={workerSummary}
          canCoordinate={canCoordinate}
          canApprove={canApprove}
          submitting={submitting}
          onCreate={onCreateWorker}
          onEdit={onEditWorker}
          onRetire={onRetireWorker}
          onOpenApprovals={onOpenApprovals}
        />
      ) : (
        <>
          <div className="resource-summary" aria-label={`${isWorkforce ? 'Workforce' : 'Inventory'} summary`}>
            {isWorkforce ? (
              <>
                <div>
                  <span>Needs crew</span>
                  <strong>{summary.needsAssignment || 0}</strong>
                </div>
                <div>
                  <span>Conflicts</span>
                  <strong>{summary.workerConflicts || 0}</strong>
                </div>
                <div>
                  <span>Instructions</span>
                  <strong>{summary.needsInstruction || 0}</strong>
                </div>
                <div>
                  <span>Site access</span>
                  <strong>{summary.siteAccess || 0}</strong>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>Procurement</span>
                  <strong>{summary.procurementNeeded || 0}</strong>
                </div>
                <div>
                  <span>Partner holds</span>
                  <strong>{summary.partnerComplianceBlocks || 0}</strong>
                </div>
                <div>
                  <span>Loading gaps</span>
                  <strong>{summary.loadingMissing || 0}</strong>
                </div>
                <div>
                  <span>Approvals</span>
                  <strong>{summary.pendingApprovals || 0}</strong>
                </div>
              </>
            )}
          </div>
          <div className="resource-readiness-list" role="tabpanel">
            {rows.map((item) => {
              const job = jobs.find((candidate) => candidate.id === item.jobId) || { id: item.jobId, title: item.jobTitle || 'Ledger job' }
              const status = isWorkforce ? item.workforceStatus : item.inventoryStatus
              const canAct = canCoordinate && !item.flags?.approvalRequired
              const canPlan =
                canAct &&
                (isWorkforce
                  ? item.flags?.needsAssignment || item.flags?.workerConflict || item.flags?.offlineAssigned
                  : item.flags?.toolConflict)
              const canDraftInstruction =
                canAct && isWorkforce && item.nextActions?.some((action) => action.type === 'draft_worker_instruction')
              const canDraftProcurement = canAct && !isWorkforce && item.flags?.procurementNeeded && !item.counts?.procurementOrders
              const canPrepareLoading = canAct && !isWorkforce && item.flags?.loadingMissing && !item.counts?.loadingPlans
              const resourceAction = canAct ? item.nextActions?.find((action) => RESOURCE_ACTION_LABELS[action.type]) : null
              const resourceActionLabel = RESOURCE_ACTION_LABELS[resourceAction?.type]
              const crewReviewActions =
                canAct && isWorkforce
                  ? item.nextActions?.filter((action) => ['publish_worker_instruction', 'clear_site_access'].includes(action.type)) || []
                  : []
              return (
                <article className="resource-readiness-item" key={`${view}-${item.jobId}`}>
                  <div className="resource-readiness-copy">
                    <div className="resource-readiness-title">
                      <h3>{item.jobTitle || 'Ledger job'}</h3>
                      <span className={`status status-${status}`}>{formatStatus(status)}</span>
                    </div>
                    <p>{item.nextAction || 'Resource records are stable.'}</p>
                    {isWorkforce ? (
                      <div className="resource-readiness-values">
                        <span>
                          Assigned <strong>{item.counts?.activeAssignments || 0}</strong>
                        </span>
                        <span>
                          Conflicts <strong>{item.counts?.workerConflicts || 0}</strong>
                        </span>
                        <span>
                          Unavailable <strong>{item.counts?.offlineAssignments || 0}</strong>
                        </span>
                        <span>
                          Instructions <strong>{item.counts?.workerInstructions || 0}</strong>
                        </span>
                        <span>
                          Hours logged <strong>{item.counts?.billableHours || 0}</strong>
                        </span>
                      </div>
                    ) : (
                      <div className="resource-readiness-values">
                        <span>
                          Open materials <strong>{item.counts?.openMaterials || 0}</strong>
                        </span>
                        <span>
                          Reserved tools <strong>{item.counts?.toolReservations || 0}</strong>
                        </span>
                        <span>
                          Load items <strong>{item.counts?.loadingItems || 0}</strong>
                        </span>
                        <span>
                          Material cost <strong>{currency.format(item.money?.materialCost || 0)}</strong>
                        </span>
                      </div>
                    )}
                    <div className="resource-readiness-flags">
                      {item.counts?.pendingApprovals ? (
                        <span className="tag tag-amber">
                          {item.counts.pendingApprovals} approval{item.counts.pendingApprovals === 1 ? '' : 's'}
                        </span>
                      ) : null}
                      {!isWorkforce && item.counts?.partnerComplianceBlocks ? (
                        <span className="tag tag-amber">
                          {item.counts.partnerComplianceBlocks} partner hold{item.counts.partnerComplianceBlocks === 1 ? '' : 's'}
                        </span>
                      ) : null}
                      {isWorkforce && item.counts?.dueOrientations ? (
                        <span className="tag tag-amber">{item.counts.dueOrientations} orientation due</span>
                      ) : null}
                      {isWorkforce && item.counts?.staleCrewEvidence ? (
                        <span className="tag">
                          {item.counts.staleCrewEvidence} historical crew record{item.counts.staleCrewEvidence === 1 ? '' : 's'}
                        </span>
                      ) : null}
                      {!isWorkforce && item.counts?.dueMaterials ? (
                        <span className="tag tag-amber">
                          {item.counts.dueMaterials} material item{item.counts.dueMaterials === 1 ? '' : 's'} due
                        </span>
                      ) : null}
                      {!isWorkforce && item.loadingReadiness?.trailerRequired ? <span className="tag">Trailer required</span> : null}
                    </div>
                  </div>
                  <div className="resource-readiness-actions">
                    {item.flags?.approvalRequired && canApprove ? (
                      <button
                        className="secondary-button"
                        disabled={submitting}
                        onClick={() =>
                          onOpenApprovals({
                            jobId: item.jobId,
                            jobTitle: job.title,
                            approvalId: item.nextActions?.find((action) => action.approvalId)?.approvalId || null,
                          })
                        }
                      >
                        <ShieldCheck size={16} />
                        Review approval
                      </button>
                    ) : null}
                    {!isWorkforce && item.flags?.supplierComplianceBlocked && canCoordinate ? (
                      <button className="secondary-button" disabled={submitting} onClick={() => onViewChange('partners')}>
                        <Building2 size={16} />
                        Trade partners
                      </button>
                    ) : null}
                    {canPlan ? (
                      <button className="secondary-button" disabled={submitting} onClick={() => onPlan(item)}>
                        <Users size={16} />
                        Plan resources
                      </button>
                    ) : null}
                    {canDraftInstruction ? (
                      <button
                        className="secondary-button"
                        aria-label={`Draft crew instructions for ${job.title}`}
                        disabled={submitting}
                        onClick={() => onDraftInstruction(item)}
                      >
                        <ClipboardCheck size={16} />
                        Draft instructions
                      </button>
                    ) : null}
                    {crewReviewActions.map((action) => (
                      <button
                        className="secondary-button"
                        key={`${action.type}-${action.recordId || action.assignmentId || action.workerId}`}
                        aria-label={`${action.label} for ${job.title}`}
                        disabled={submitting}
                        onClick={() => onReviewCrewEvidence(item, action)}
                      >
                        <ShieldCheck size={16} />
                        {action.type === 'publish_worker_instruction' ? 'Review instructions' : 'Clear site access'}
                      </button>
                    ))}
                    {canDraftProcurement ? (
                      <button
                        className="secondary-button"
                        aria-label={`Draft procurement for ${job.title}`}
                        disabled={submitting}
                        onClick={() => onDraftProcurement(item)}
                      >
                        <ReceiptEuro size={16} />
                        Draft procurement
                      </button>
                    ) : null}
                    {canPrepareLoading ? (
                      <button
                        className="secondary-button"
                        aria-label={`Prepare loading checklist for ${job.title}`}
                        disabled={submitting}
                        onClick={() => onPrepareLoading(item)}
                      >
                        <PackageCheck size={16} />
                        Loading checklist
                      </button>
                    ) : null}
                    {resourceAction && resourceActionLabel ? (
                      <button
                        className="secondary-button"
                        aria-label={`${resourceActionLabel} for ${job.title}`}
                        disabled={submitting}
                        onClick={() => onAction(item, resourceAction)}
                      >
                        <ClipboardCheck size={16} />
                        {resourceActionLabel}
                      </button>
                    ) : null}
                    <button className="icon-button table-action" aria-label={`Open ${job.title}`} onClick={() => onOpen(job)}>
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                </article>
              )
            })}
            {!rows.length ? (
              <Empty
                title={isWorkforce ? 'No workforce work' : 'No inventory work'}
                detail={
                  isWorkforce
                    ? 'Scheduled ledger jobs will appear here with crew readiness and time controls.'
                    : 'Material and equipment requirements will appear here with procurement and loading controls.'
                }
              />
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}

function FinanceWorkspace({
  finance,
  jobs,
  canCoordinate,
  canApprove,
  submitting,
  onDraftInvoice,
  onPrepareInvoice,
  onAction,
  onOpenApprovals,
  onOpen,
}) {
  const rows = finance?.jobs || EMPTY_LIST
  const summary = finance?.summary || {}
  return (
    <section className="panel page-panel finance-workspace" data-testid="finance-workspace">
      <div className="panel-heading">
        <div>
          <h2>Finance readiness</h2>
          <p>Review earned value, costs, receivables, supplier payables, and approval gates from the retained ledger.</p>
        </div>
        <span className="count-badge">{rows.length}</span>
      </div>
      <div className="finance-summary" aria-label="Finance summary">
        <div>
          <span>Invoice ready</span>
          <strong>{summary.invoiceReady || 0}</strong>
        </div>
        <div>
          <span>Planned billing</span>
          <strong>{currency.format(summary.plannedBillingValue || 0)}</strong>
        </div>
        <div>
          <span>Uninvoiced net</span>
          <strong>{currency.format(summary.uninvoicedNetValue ?? summary.uninvoicedValue ?? 0)}</strong>
        </div>
        <div>
          <span>Unpaid</span>
          <strong>{currency.format(summary.unpaidValue || 0)}</strong>
        </div>
        <div>
          <span>Supplier payable</span>
          <strong>{currency.format(summary.supplierPayableValue || 0)}</strong>
        </div>
        <div>
          <span>Approvals</span>
          <strong>{summary.pendingApprovals || 0}</strong>
        </div>
      </div>
      <div className="finance-list">
        {rows.map((item) => {
          const job = jobs.find((candidate) => candidate.id === item.jobId) || { id: item.jobId, title: item.jobTitle || 'Ledger job' }
          const canAct = canCoordinate && !item.flags?.approvalRequired
          const draftInvoiceAction = canAct ? item.nextActions?.find((action) => action.type === 'draft_invoice') : null
          const canDraftInvoice = Boolean(draftInvoiceAction) && !item.counts?.draftInvoices
          const prepareAction = canAct
            ? item.nextActions?.find((action) => ['prepare_invoice_package', 'prepare_credit_note_package'].includes(action.type))
            : null
          const issuePackage = item.latest?.invoice?.data?.issuePackage
          const creditNotePackage = item.latest?.creditNote?.data?.issuePackage
          const financeActions = canAct
            ? item.nextActions
                ?.filter(
                  (action) =>
                    action.type !== 'review_finance_approval' &&
                    action.type !== 'draft_invoice' &&
                    !['prepare_invoice_package', 'prepare_credit_note_package'].includes(action.type) &&
                    FINANCE_ACTION_LABELS[action.type],
                )
                .slice(0, 3)
            : EMPTY_LIST
          return (
            <article className="finance-item" key={item.jobId}>
              <div className="finance-copy">
                <div className="finance-title">
                  <h3>{item.jobTitle || 'Ledger job'}</h3>
                  <span className={`status status-${item.financeStatus}`}>{formatStatus(item.financeStatus)}</span>
                </div>
                <p>{item.nextAction || 'Finance records are stable.'}</p>
                <div className="finance-values">
                  <span>
                    Contract net <strong>{currency.format(item.money?.contractValue || 0)}</strong>
                  </span>
                  <span>
                    Planned billing <strong>{currency.format(item.money?.plannedBillingValue || 0)}</strong>
                  </span>
                  <span>
                    Billing due <strong>{currency.format(item.money?.dueBillingValue || 0)}</strong>
                  </span>
                  <span>
                    Unpaid gross <strong>{currency.format(item.money?.unpaidValue || 0)}</strong>
                  </span>
                  <span>
                    Supplier payable <strong>{currency.format(item.money?.supplierPayableValue || 0)}</strong>
                  </span>
                  <span>
                    Margin net <strong>{currency.format(item.money?.projectedMargin || 0)}</strong>
                  </span>
                </div>
                <div className="finance-flags">
                  {item.counts?.billingMilestones ? (
                    <span className="tag tag-green">
                      {item.counts.billingMilestones} billing milestone{item.counts.billingMilestones === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  {item.counts?.dueBillingMilestones ? (
                    <span className="tag tag-amber">
                      {item.counts.dueBillingMilestones} milestone{item.counts.dueBillingMilestones === 1 ? '' : 's'} due
                    </span>
                  ) : null}
                  {item.money?.creditedValue > 0 ? (
                    <span className="tag tag-amber">{currency.format(item.money.creditedValue)} credited</span>
                  ) : null}
                  {item.money?.pendingCreditValue > 0 ? (
                    <span className="tag tag-amber">{currency.format(item.money.pendingCreditValue)} credit pending</span>
                  ) : null}
                  {item.money?.writtenOffValue > 0 ? (
                    <span className="tag tag-amber">{currency.format(item.money.writtenOffValue)} written off</span>
                  ) : null}
                  {item.money?.pendingPaymentValue > 0 ? (
                    <span className="tag tag-amber">{currency.format(item.money.pendingPaymentValue)} client payment pending</span>
                  ) : null}
                  {item.money?.pendingSupplierPaymentValue > 0 ? (
                    <span className="tag tag-amber">
                      {currency.format(item.money.pendingSupplierPaymentValue)} supplier payment pending
                    </span>
                  ) : null}
                  {item.counts?.dueSupplierInvoices ? (
                    <span className="tag tag-amber">
                      {item.counts.dueSupplierInvoices} supplier invoice{item.counts.dueSupplierInvoices === 1 ? '' : 's'} due
                    </span>
                  ) : null}
                  {item.counts?.timeLogs ? (
                    <span className="tag tag-green">
                      {item.counts.timeLogs} time log{item.counts.timeLogs === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  {item.counts?.expenses ? (
                    <span className="tag">
                      {item.counts.expenses} expense{item.counts.expenses === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  {item.latest?.invoice?.data?.structuredExportRequested ? (
                    <span className={`tag ${item.latest.invoice.data.structuredReadiness?.ready ? 'tag-green' : 'tag-amber'}`}>
                      UBL {item.latest.invoice.data.structuredReadiness?.ready ? 'ready' : 'incomplete'}
                    </span>
                  ) : null}
                  {issuePackage ? <span className="tag tag-green">{issuePackage.issueReference}</span> : null}
                  {creditNotePackage ? <span className="tag tag-green">{creditNotePackage.issueReference}</span> : null}
                  {item.counts?.pendingApprovals ? (
                    <span className="tag tag-amber">
                      {item.counts.pendingApprovals} approval{item.counts.pendingApprovals === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="finance-actions">
                {item.flags?.approvalRequired && canApprove ? (
                  <button
                    className="secondary-button"
                    disabled={submitting}
                    onClick={() =>
                      onOpenApprovals({
                        jobId: item.jobId,
                        jobTitle: job.title,
                        approvalId: item.nextActions?.find((action) => action.approvalId)?.approvalId || null,
                      })
                    }
                  >
                    <ShieldCheck size={16} />
                    Review approval
                  </button>
                ) : null}
                {canDraftInvoice ? (
                  <button
                    className="secondary-button"
                    aria-label={`Draft invoice for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onDraftInvoice(item, draftInvoiceAction)}
                  >
                    <ReceiptEuro size={16} />
                    {draftInvoiceAction.billingMilestoneId ? 'Invoice milestone' : 'Draft invoice'}
                  </button>
                ) : null}
                {prepareAction ? (
                  <button
                    className="secondary-button"
                    aria-label={`Prepare ${prepareAction.type === 'prepare_credit_note_package' ? 'credit note' : 'invoice'} package for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onPrepareInvoice(item, prepareAction)}
                  >
                    <PackageCheck size={16} />
                    {prepareAction.type === 'prepare_credit_note_package' ? 'Prepare credit' : 'Prepare package'}
                  </button>
                ) : null}
                {issuePackage?.htmlDocumentId ? (
                  <a
                    className="secondary-button"
                    aria-label={`Download invoice for ${job.title}`}
                    href={`/api/ledger/documents/${encodeURIComponent(issuePackage.htmlDocumentId)}/issue-package`}
                    download
                  >
                    <FileDown size={16} />
                    Invoice
                  </a>
                ) : null}
                {issuePackage?.ublDocumentId ? (
                  <a
                    className="secondary-button"
                    aria-label={`Download UBL for ${job.title}`}
                    href={`/api/ledger/documents/${encodeURIComponent(issuePackage.ublDocumentId)}/issue-package`}
                    download
                  >
                    <FileDown size={16} />
                    UBL
                  </a>
                ) : null}
                {creditNotePackage?.htmlDocumentId ? (
                  <a
                    className="secondary-button"
                    aria-label={`Download credit note for ${job.title}`}
                    href={`/api/ledger/documents/${encodeURIComponent(creditNotePackage.htmlDocumentId)}/issue-package`}
                    download
                  >
                    <FileDown size={16} />
                    Credit note
                  </a>
                ) : null}
                {creditNotePackage?.ublDocumentId ? (
                  <a
                    className="secondary-button"
                    aria-label={`Download credit note UBL for ${job.title}`}
                    href={`/api/ledger/documents/${encodeURIComponent(creditNotePackage.ublDocumentId)}/issue-package`}
                    download
                  >
                    <FileDown size={16} />
                    Credit UBL
                  </a>
                ) : null}
                {financeActions.map((action) => (
                  <button
                    className="secondary-button"
                    key={`${action.type}-${action.creditNoteId || action.supplierInvoiceId || action.purchaseOrderId || action.invoiceId || action.paymentId || item.jobId}`}
                    aria-label={`${FINANCE_ACTION_LABELS[action.type]} for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onAction(item, action)}
                  >
                    <ClipboardCheck size={16} />
                    {FINANCE_ACTION_LABELS[action.type]}
                  </button>
                ))}
                <button className="icon-button table-action" aria-label={`Open ${job.title}`} onClick={() => onOpen(job)}>
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </article>
          )
        })}
        {!rows.length ? (
          <Empty title="No finance work" detail="Active and completed ledger jobs will appear here with their finance readiness state." />
        ) : null}
      </div>
    </section>
  )
}

function CommercialControl({
  job,
  canCoordinate,
  canApprove,
  submitting,
  onNewQuote,
  onNewChangeOrder,
  onRequestAcceptance,
  onOpenApprovals,
}) {
  const quotes = job.quotes || EMPTY_LIST
  const changeOrders = job.changeOrders || EMPTY_LIST
  const pendingApprovals = job.approvals?.filter((approval) => approval.status === 'pending') || EMPTY_LIST
  const pendingFor = (targetType, targetId) =>
    pendingApprovals.find((approval) => approval.targetType === targetType && approval.targetId === targetId)
  const acceptedQuote = quotes.find((quote) => quote.status === 'accepted')
  const acceptedChanges = changeOrders.filter((changeOrder) => changeOrder.status === 'accepted')
  const acceptedChangeNet = acceptedChanges.reduce((sum, changeOrder) => sum + Number(changeOrder.amount || 0), 0)
  const commercialCurrency = acceptedQuote?.currency || quotes[0]?.currency || 'EUR'

  return (
    <section className="job-workspace-section commercial-control" data-testid="commercial-control">
      <div className="section-heading commercial-heading">
        <ReceiptEuro size={18} />
        <div>
          <h3>Commercial control</h3>
          <p>Separate internal approval from retained client acceptance before contract value changes.</p>
        </div>
      </div>
      <div className="commercial-summary" aria-label="Accepted commercial value">
        <div>
          <span>Accepted contract net</span>
          <strong>{currency.format(job.contractValue || 0)}</strong>
        </div>
        <div>
          <span>Accepted quote</span>
          <strong>{acceptedQuote ? currency.format(acceptedQuote.subtotal || 0) : 'Not retained'}</strong>
        </div>
        <div>
          <span>Accepted changes</span>
          <strong>{currency.format(acceptedChangeNet)}</strong>
        </div>
        <div>
          <span>Pending decisions</span>
          <strong>
            {
              pendingApprovals.filter((approval) =>
                ['quote', 'quote_acceptance', 'change_order', 'change_order_acceptance'].includes(approval.targetType),
              ).length
            }
          </strong>
        </div>
      </div>
      {canCoordinate ? (
        <div className="commercial-actions">
          <button type="button" className="secondary-button" disabled={submitting} onClick={onNewQuote}>
            <Plus size={15} />
            New estimate
          </button>
          <button type="button" className="secondary-button" disabled={submitting} onClick={onNewChangeOrder}>
            <Plus size={15} />
            Scope change
          </button>
        </div>
      ) : null}
      <div className="commercial-ledger">
        <section aria-labelledby="quote-ledger-title">
          <div className="commercial-list-heading">
            <h4 id="quote-ledger-title">Estimates and quotes</h4>
            <span>{quotes.length}</span>
          </div>
          {quotes.length ? (
            <div className="activity-list commercial-list">
              {quotes.map((quote) => {
                const issueApproval = pendingFor('quote', quote.id)
                const acceptanceApproval = pendingFor('quote_acceptance', quote.id)
                const issuePackage = job.documents?.find(
                  (document) => document.type === 'quote_issue_package' && document.data?.sourceRecordId === quote.id,
                )
                const deliveryDraft = issuePackage
                  ? job.communications?.find(
                      (communication) =>
                        communication.data?.source === 'quote_issue_package' && communication.data?.sourceRecordId === quote.id,
                    )
                  : null
                const deliveryApproval = deliveryDraft ? pendingFor('communication', deliveryDraft.id) : null
                const canPrepare = ['approved', 'accepted'].includes(quote.status) && canCoordinate && !issuePackage
                return (
                  <div className="activity-row commercial-row" key={quote.id} data-testid={`commercial-quote-${quote.id}`}>
                    <div className="commercial-record">
                      <div>
                        <strong>{currency.format(quote.subtotal || 0)} net</strong>
                        <span className={`status status-${quote.status}`}>{formatStatus(quote.status)}</span>
                      </div>
                      <small>
                        {quote.lineItems?.length || 0} line item{quote.lineItems?.length === 1 ? '' : 's'} · VAT {quote.taxRate || 0}% ·
                        gross {currency.format(quote.total || 0)}
                      </small>
                      <small>
                        Valid until {formatDate(quote.validUntil)}
                        {issuePackage ? ` · package ${issuePackage.data?.issueReference || 'retained'}` : ''}
                        {quote.data?.acceptance?.evidenceReference ? ` · evidence ${quote.data.acceptance.evidenceReference}` : ''}
                      </small>
                    </div>
                    <div className="commercial-row-actions">
                      {issueApproval && canApprove ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={submitting}
                          onClick={() => onOpenApprovals({ approvalId: issueApproval.id })}
                        >
                          <ShieldCheck size={15} />
                          Review quote
                        </button>
                      ) : null}
                      {canPrepare ? (
                        <button
                          type="button"
                          className="secondary-button"
                          data-testid={`prepare-quote-package-${quote.id}`}
                          disabled={submitting}
                          title="Prepare an immutable quote package and approval-gated delivery draft"
                          onClick={() => onRequestAcceptance('issue_package', quote)}
                        >
                          <FileDown size={15} />
                          Prepare issue package
                        </button>
                      ) : null}
                      {issuePackage ? (
                        <a
                          className="secondary-button"
                          data-testid={`download-quote-package-${quote.id}`}
                          href={`/api/ledger/documents/${encodeURIComponent(issuePackage.id)}/issue-package`}
                          download
                        >
                          <FileDown size={15} />
                          Download package
                        </a>
                      ) : null}
                      {deliveryApproval && canApprove ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={submitting}
                          onClick={() => onOpenApprovals({ approvalId: deliveryApproval.id })}
                        >
                          <ShieldCheck size={15} />
                          Review delivery
                        </button>
                      ) : null}
                      {acceptanceApproval && canApprove ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={submitting}
                          onClick={() => onOpenApprovals({ approvalId: acceptanceApproval.id })}
                        >
                          <ShieldCheck size={15} />
                          Verify acceptance
                        </button>
                      ) : null}
                      {quote.status === 'approved' && canCoordinate && !acceptanceApproval ? (
                        <button
                          type="button"
                          className="primary-button"
                          disabled={submitting}
                          onClick={() => onRequestAcceptance('quote', quote)}
                        >
                          <Check size={15} />
                          Record acceptance
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="workflow-note">No retained estimate exists for this job.</p>
          )}
        </section>
        <section aria-labelledby="change-ledger-title">
          <div className="commercial-list-heading">
            <h4 id="change-ledger-title">Scope changes</h4>
            <span>{changeOrders.length}</span>
          </div>
          {changeOrders.length ? (
            <div className="activity-list commercial-list">
              {changeOrders.map((changeOrder) => {
                const approval = pendingFor('change_order', changeOrder.id)
                const acceptanceApproval = pendingFor('change_order_acceptance', changeOrder.id)
                return (
                  <div className="activity-row commercial-row" key={changeOrder.id} data-testid={`commercial-change-${changeOrder.id}`}>
                    <div className="commercial-record">
                      <div>
                        <strong>{changeOrder.title}</strong>
                        <span className={`status status-${changeOrder.status}`}>{formatStatus(changeOrder.status)}</span>
                      </div>
                      <small>
                        {currency.format(changeOrder.amount || 0)} net · {changeOrder.scheduleDeltaDays || 0} day schedule impact ·{' '}
                        {commercialCurrency}
                      </small>
                      <small>
                        {changeOrder.scopeDelta || 'Scope evidence not retained'}
                        {changeOrder.data?.acceptance?.evidenceReference
                          ? ` · evidence ${changeOrder.data.acceptance.evidenceReference}`
                          : ''}
                      </small>
                    </div>
                    <div className="commercial-row-actions">
                      {approval && canApprove ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={submitting}
                          onClick={() => onOpenApprovals({ approvalId: approval.id })}
                        >
                          <ShieldCheck size={15} />
                          Review change
                        </button>
                      ) : null}
                      {acceptanceApproval && canApprove ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={submitting}
                          onClick={() => onOpenApprovals({ approvalId: acceptanceApproval.id })}
                        >
                          <ShieldCheck size={15} />
                          Verify acceptance
                        </button>
                      ) : null}
                      {changeOrder.status === 'approved' && canCoordinate && !acceptanceApproval ? (
                        <button
                          type="button"
                          className="primary-button"
                          disabled={submitting}
                          onClick={() => onRequestAcceptance('change_order', changeOrder)}
                        >
                          <Check size={15} />
                          Record acceptance
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="workflow-note">No retained scope change exists for this job.</p>
          )}
        </section>
      </div>
    </section>
  )
}

function ClientSuccessWorkspace({
  clients,
  jobs,
  canCoordinate,
  canApprove,
  submitting,
  onPrepareCloseout,
  onPrepareHandover,
  onDraftFollowup,
  onDraftRecurring,
  onLifecycle,
  onOpenApprovals,
  onOpen,
}) {
  const rows = clients?.jobs || EMPTY_LIST
  const summary = clients?.summary || {}
  return (
    <section className="panel page-panel client-workspace" data-testid="client-workspace">
      <div className="panel-heading">
        <div>
          <h2>Client success</h2>
          <p>Coordinate decisions, handover, punch, warranty, aftercare, and recurring service through retained approval gates.</p>
        </div>
        <span className="count-badge">{rows.length}</span>
      </div>
      <div className="client-summary" aria-label="Client success summary">
        <div>
          <span>Waiting client</span>
          <strong>{summary.waitingClient || 0}</strong>
        </div>
        <div>
          <span>Handover ready</span>
          <strong>{summary.handoverReady || 0}</strong>
        </div>
        <div>
          <span>Closeout ready</span>
          <strong>{summary.closeoutReady || 0}</strong>
        </div>
        <div>
          <span>Punch / warranty</span>
          <strong>{summary.punchWarranty || 0}</strong>
        </div>
        <div>
          <span>Aftercare due</span>
          <strong>{summary.aftercareDue || 0}</strong>
        </div>
      </div>
      <div className="client-list">
        {rows.map((item) => {
          const job = jobs.find((candidate) => candidate.id === item.jobId) || { id: item.jobId, title: item.jobTitle || 'Ledger job' }
          const action = (type) => item.nextActions?.find((candidate) => candidate.type === type)
          const canAct = canCoordinate && !item.flags?.approvalRequired
          const canPrepareCloseout = canAct && item.flags?.closeoutReady
          const handoverAction = action('prepare_handover_package')
          const canPrepareHandover = canAct && Boolean(handoverAction)
          const followupAction = action('selection_follow_up') || action('client_reply_follow_up')
          const canDraftFollowup = canAct && Boolean(followupAction) && !item.counts?.outboundDrafts
          const selectionAction = canAct ? action('review_client_selection') : null
          const punchAction = canAct ? action('resolve_punch_item') : null
          const warrantyAction = canAct ? action('resolve_warranty_claim') : null
          const aftercareAction = canAct ? action('complete_aftercare') : null
          const canDraftRecurring = canAct && !item.counts?.recurringPlans && Boolean(action('propose_recurring_plan'))
          return (
            <article className="client-item" key={item.jobId}>
              <div className="client-copy">
                <div className="client-title">
                  <h3>{item.jobTitle || 'Ledger job'}</h3>
                  <span className={`status status-${item.clientStatus}`}>{formatStatus(item.clientStatus)}</span>
                </div>
                <p>{item.nextAction || 'Client records are stable.'}</p>
                <div className="client-values">
                  <span>
                    Client value <strong>{currency.format(item.money?.clientValue || 0)}</strong>
                  </span>
                  <span>
                    Selections <strong>{item.counts?.pendingSelections || 0}</strong>
                  </span>
                  <span>
                    Waiting replies <strong>{item.counts?.waitingReplies || 0}</strong>
                  </span>
                  <span>
                    Open service{' '}
                    <strong>
                      {(item.counts?.openPunchItems || 0) + (item.counts?.openWarrantyClaims || 0) + (item.counts?.openAftercare || 0)}
                    </strong>
                  </span>
                </div>
                <div className="client-flags">
                  {item.counts?.pendingApprovals ? (
                    <span className="tag tag-amber">
                      {item.counts.pendingApprovals} approval{item.counts.pendingApprovals === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  {item.counts?.overdueSelections ? (
                    <span className="tag tag-amber">{item.counts.overdueSelections} selection overdue</span>
                  ) : null}
                  {item.counts?.overdueReplies ? <span className="tag tag-amber">{item.counts.overdueReplies} reply overdue</span> : null}
                  {item.counts?.dueAftercare ? <span className="tag">{item.counts.dueAftercare} aftercare due</span> : null}
                  {item.counts?.handoverBlockers ? (
                    <span className="tag tag-amber">
                      {item.counts.handoverBlockers} handover blocker{item.counts.handoverBlockers === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  {item.counts?.handoverMissing ? (
                    <span className="tag">
                      {item.counts.handoverMissing} handover requirement{item.counts.handoverMissing === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  {item.latest?.handoverPackage ? (
                    <span className={item.handoverReadiness?.currentPackageId ? 'tag tag-green' : 'tag tag-amber'}>
                      {item.handoverReadiness?.currentPackageId ? 'Dossier current' : 'Dossier refresh due'}
                    </span>
                  ) : null}
                  {item.counts?.handoverDelivered ? <span className="tag tag-green">Handover delivered</span> : null}
                </div>
              </div>
              <div className="client-actions">
                {item.flags?.approvalRequired && canApprove ? (
                  <button
                    className="secondary-button"
                    disabled={submitting}
                    onClick={() =>
                      onOpenApprovals({
                        jobId: item.jobId,
                        jobTitle: job.title,
                        approvalId: item.nextActions?.find((action) => action.approvalId)?.approvalId || null,
                      })
                    }
                  >
                    <ShieldCheck size={16} />
                    Review approval
                  </button>
                ) : null}
                {canPrepareCloseout ? (
                  <button
                    className="secondary-button"
                    aria-label={`Prepare closeout for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onPrepareCloseout(item)}
                  >
                    <Archive size={16} />
                    Prepare closeout
                  </button>
                ) : null}
                {canPrepareHandover ? (
                  <button
                    className="primary-button"
                    aria-label={`Prepare handover dossier for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onPrepareHandover(item)}
                  >
                    <PackageCheck size={16} />
                    Prepare dossier
                  </button>
                ) : null}
                {item.latest?.handoverPackage ? (
                  <a
                    className="secondary-button"
                    aria-label={`Download handover dossier for ${job.title}`}
                    href={`/api/ledger/documents/${encodeURIComponent(item.latest.handoverPackage.id)}/issue-package`}
                    download
                  >
                    <FileDown size={16} />
                    Download dossier
                  </a>
                ) : null}
                {canDraftFollowup ? (
                  <button
                    className="secondary-button"
                    aria-label={`Draft client follow-up for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onDraftFollowup(item)}
                  >
                    <MessageSquareText size={16} />
                    Draft follow-up
                  </button>
                ) : null}
                {selectionAction ? (
                  <button
                    className="secondary-button"
                    aria-label={`Record client selection for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onLifecycle(item, 'selection', selectionAction.selectionId)}
                  >
                    <ClipboardCheck size={16} />
                    Record selection
                  </button>
                ) : null}
                {punchAction ? (
                  <button
                    className="secondary-button"
                    aria-label={`Request punch resolution for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onLifecycle(item, 'punch_item', punchAction.punchItemId)}
                  >
                    <ShieldCheck size={16} />
                    Punch review
                  </button>
                ) : null}
                {warrantyAction ? (
                  <button
                    className="secondary-button"
                    aria-label={`Request warranty resolution for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onLifecycle(item, 'warranty_claim', warrantyAction.warrantyClaimId)}
                  >
                    <ShieldCheck size={16} />
                    Warranty review
                  </button>
                ) : null}
                {aftercareAction ? (
                  <button
                    className="secondary-button"
                    aria-label={`Complete aftercare for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onLifecycle(item, 'aftercare', aftercareAction.aftercareId)}
                  >
                    <BadgeCheck size={16} />
                    Complete aftercare
                  </button>
                ) : null}
                {canDraftRecurring ? (
                  <button
                    className="secondary-button"
                    aria-label={`Draft recurring plan for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onDraftRecurring(item)}
                  >
                    <RefreshCw size={16} />
                    Service plan
                  </button>
                ) : null}
                <button className="icon-button table-action" aria-label={`Open ${job.title}`} onClick={() => onOpen(job)}>
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </article>
          )
        })}
        {!rows.length ? (
          <Empty
            title="No client work"
            detail="Client decisions, closeout, warranty, and aftercare records will appear here when action is needed."
          />
        ) : null}
      </div>
    </section>
  )
}

function ProjectControls({
  job,
  canCoordinate,
  canApprove,
  submitting,
  onCreate,
  onTransition,
  onIssueTransmittal,
  onAcknowledgeTransmittal,
  onSubmitMeeting,
  onIssueMeeting,
  onCompleteMeetingAction,
  onCreateMeetingFollowUp,
  onOpenApprovals,
}) {
  const [view, setView] = useState('rfi')
  const [creating, setCreating] = useState(false)
  const [rfiDraft, setRfiDraft] = useState(emptyRfiDraft)
  const [submittalDraft, setSubmittalDraft] = useState(emptySubmittalDraft)
  const [documentDraft, setDocumentDraft] = useState(emptyControlledDocumentDraft)
  const [transmittalDraft, setTransmittalDraft] = useState(emptyTransmittalDraft)
  const [meetingDraft, setMeetingDraft] = useState(emptyProjectMeetingDraft)
  const [review, setReview] = useState(emptyProjectControlReview)
  const rfis = job.rfis || EMPTY_LIST
  const submittals = job.submittals || EMPTY_LIST
  const documents = (job.documents || EMPTY_LIST).filter((document) => document.type === 'controlled_document')
  const currentDocumentOptions = documents.filter((record) => record.status === 'approved' && record.data?.isCurrent === true)
  const transmittals = job.transmittals || EMPTY_LIST
  const meetings = job.projectMeetings || EMPTY_LIST
  const pendingApprovals = job.approvals?.filter((approval) => approval.status === 'pending') || EMPTY_LIST
  const records = view === 'rfi'
    ? rfis
    : view === 'submittal'
      ? submittals
      : view === 'document'
        ? documents
        : view === 'transmittal'
          ? transmittals
          : meetings
  const activeRfis = rfis.filter((record) => !['answered', 'resolved', 'closed', 'rejected'].includes(record.status)).length
  const activeSubmittals = submittals.filter((record) => !['approved', 'accepted', 'closed', 'rejected'].includes(record.status)).length
  const currentDocuments = documents.filter((record) => record.status === 'approved' && record.data?.isCurrent !== false).length
  const pendingTransmittalReceipts = transmittals.reduce(
    (count, record) => count + (record.receipts || EMPTY_LIST).filter((receipt) => receipt.status === 'awaiting_acknowledgment').length,
    0,
  )
  const openMeetingActions = meetings.reduce(
    (count, record) => count + (record.actions || EMPTY_LIST).filter((action) => action.status === 'open').length,
    0,
  )
  const pendingFor = (type, recordId) => {
    const targetType = type === 'rfi'
      ? 'rfi_record'
      : type === 'submittal'
        ? 'submittal_record'
        : type === 'document'
          ? 'document'
          : type === 'transmittal'
            ? 'document_transmittal'
            : 'project_meeting_minutes'
    return pendingApprovals.find((approval) => approval.targetType === targetType && approval.targetId === recordId)
  }

  function selectView(nextView) {
    setView(nextView)
    setCreating(false)
    setReview(emptyProjectControlReview())
  }

  function updateMeetingAction(key, patch) {
    setMeetingDraft((current) => ({
      ...current,
      actions: current.actions.map((action) => action.key === key ? { ...action, ...patch } : action),
    }))
  }

  function removeMeetingAction(key) {
    setMeetingDraft((current) => ({ ...current, actions: current.actions.filter((action) => action.key !== key) }))
  }

  async function submitCreate(event) {
    event.preventDefault()
    const draft = view === 'rfi'
      ? rfiDraft
      : view === 'submittal'
        ? submittalDraft
        : view === 'document'
          ? documentDraft
          : view === 'transmittal'
            ? transmittalDraft
            : meetingDraft
    const result = await onCreate(view, draft)
    if (!result) return
    if (view === 'rfi') setRfiDraft(emptyRfiDraft())
    else if (view === 'submittal') setSubmittalDraft(emptySubmittalDraft())
    else if (view === 'document') setDocumentDraft(emptyControlledDocumentDraft())
    else if (view === 'transmittal') setTransmittalDraft(emptyTransmittalDraft())
    else setMeetingDraft(emptyProjectMeetingDraft())
    setCreating(false)
  }

  async function submitReview(event) {
    event.preventDefault()
    if (!review.record) return
    const payload = { status: review.status, notes: review.notes.trim() }
    if (review.type === 'rfi') payload.response = review.notes.trim()
    if (review.type === 'document') payload.verificationReference = review.reference.trim()
    if (review.type === 'transmittal_issue') payload.deliveryReference = review.reference.trim()
    if (review.type === 'transmittal_ack') {
      payload.evidenceReference = review.reference.trim()
      payload.acknowledgedBy = review.acknowledgedBy.trim()
    }
    if (review.type === 'meeting_issue') payload.deliveryReference = review.reference.trim()
    if (review.type === 'meeting_action') {
      payload.evidenceReference = review.reference.trim()
      payload.completedBy = review.completedBy.trim()
    }
    if (review.type === 'meeting_followup') {
      payload.scheduledAt = toIsoDateTime(review.scheduledAt)
      payload.minutesSummary = review.notes.trim()
      payload.agenda = []
    }
    const result = review.type === 'transmittal_issue'
      ? await onIssueTransmittal(review.record, payload)
      : review.type === 'transmittal_ack'
        ? await onAcknowledgeTransmittal(review.record, review.receiptId, payload)
        : review.type === 'meeting_submit'
          ? await onSubmitMeeting(review.record, payload)
          : review.type === 'meeting_issue'
            ? await onIssueMeeting(review.record, payload)
            : review.type === 'meeting_action'
              ? await onCompleteMeetingAction(review.record, review.actionId, payload)
              : review.type === 'meeting_followup'
                ? await onCreateMeetingFollowUp(review.record, payload)
        : await onTransition(review.type, review.record, payload)
    if (result) setReview(emptyProjectControlReview())
  }

  function openReview(type, record, status, context = null) {
    setCreating(false)
    setReview({
      type,
      record,
      status,
      notes: type === 'submittal' && status === 'submitted'
        ? 'Package retained and ready for technical review.'
        : type === 'transmittal_issue'
          ? 'Delivery was performed outside Contractor.AI and the retained reference identifies the real issue evidence.'
          : type === 'transmittal_ack'
            ? 'Recipient acknowledgment evidence reviewed and retained.'
            : type === 'meeting_submit'
              ? 'Agenda, attendance, decisions, and assigned actions reviewed for approval.'
              : type === 'meeting_issue'
                ? 'Distribution was performed outside Contractor.AI and this reference identifies the retained delivery evidence.'
                : type === 'meeting_action'
                  ? 'Completion evidence reviewed against the assigned meeting action and linked task.'
                  : type === 'meeting_followup'
                    ? 'Review unresolved actions and retain the next coordination date.'
            : '',
      reference: '',
      receiptId: type === 'transmittal_ack' ? context?.id || '' : '',
      acknowledgedBy: type === 'transmittal_ack' ? context?.recipientName || '' : '',
      actionId: type === 'meeting_action' ? context?.id || '' : '',
      completedBy: type === 'meeting_action' ? context?.ownerName || '' : '',
      scheduledAt: type === 'meeting_followup' ? toLocalDateTimeInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) : '',
    })
  }

  const reviewLabel = review.type === 'rfi'
    ? 'Request answer approval'
    : review.type === 'document'
      ? 'Request revision approval'
      : review.type === 'transmittal_issue'
        ? 'Record transmittal issue'
        : review.type === 'transmittal_ack'
          ? 'Record acknowledgment'
          : review.type === 'meeting_submit'
            ? 'Request minutes approval'
            : review.type === 'meeting_issue'
              ? 'Record minutes issue'
              : review.type === 'meeting_action'
                ? 'Complete action'
                : review.type === 'meeting_followup'
                  ? 'Create follow-up'
      : review.status === 'submitted'
        ? 'Mark submitted'
        : 'Request submittal approval'

  return (
    <section className="job-workspace-section project-controls" data-testid="project-controls">
      <div className="section-heading project-controls-heading">
        <ClipboardList size={18} />
        <div>
          <h3>Project controls</h3>
          <p>Control design questions, reviews, current revisions, distribution, meeting decisions, and assigned actions.</p>
        </div>
        {canCoordinate ? (
          <button
            type="button"
            className="secondary-button"
            disabled={submitting}
            aria-expanded={creating}
            onClick={() => {
              setReview(emptyProjectControlReview())
              setCreating((current) => !current)
            }}
          >
            <Plus size={15} />
            New {view === 'rfi' ? 'RFI' : view === 'submittal' ? 'submittal' : view === 'document' ? 'revision' : view === 'transmittal' ? 'transmittal' : 'meeting'}
          </button>
        ) : null}
      </div>
      <div className="project-control-metrics" aria-label="Project control status">
        <div><span>Open RFIs</span><strong>{activeRfis}</strong></div>
        <div><span>Submittal queue</span><strong>{activeSubmittals}</strong></div>
        <div><span>Current revisions</span><strong>{currentDocuments}</strong></div>
        <div><span>Receipt queue</span><strong>{pendingTransmittalReceipts}</strong></div>
        <div><span>Open meeting actions</span><strong>{openMeetingActions}</strong></div>
      </div>
      <div className="segmented-control project-control-tabs" role="tablist" aria-label="Project control register">
        {[
          ['rfi', 'RFIs', rfis.length],
          ['submittal', 'Submittals', submittals.length],
          ['document', 'Documents', documents.length],
          ['transmittal', 'Transmittals', transmittals.length],
          ['meeting', 'Meetings', meetings.length],
        ].map(([key, label, count]) => (
          <button
            type="button"
            role="tab"
            aria-selected={view === key}
            className={view === key ? 'active' : ''}
            key={key}
            onClick={() => selectView(key)}
          >
            {label}<span>{count}</span>
          </button>
        ))}
      </div>
      {creating && view === 'rfi' ? (
        <form className="project-control-form form-grid compact-form" data-testid="create-rfi-form" onSubmit={submitCreate}>
          <label className="form-span">RFI subject<input required minLength="2" value={rfiDraft.title} onChange={(event) => setRfiDraft({ ...rfiDraft, title: event.target.value })} placeholder="Decision needed before work continues" /></label>
          <label className="form-span">Question<textarea required minLength="4" value={rfiDraft.question} onChange={(event) => setRfiDraft({ ...rfiDraft, question: event.target.value })} placeholder="State the condition, requested decision, and affected work." /></label>
          <label>Responsible<input value={rfiDraft.responsible} onChange={(event) => setRfiDraft({ ...rfiDraft, responsible: event.target.value })} placeholder="Designer, client, or project lead" /></label>
          <label>Discipline<select value={rfiDraft.discipline} onChange={(event) => setRfiDraft({ ...rfiDraft, discipline: event.target.value })}><option value="general">General</option><option value="architectural">Architectural</option><option value="structural">Structural</option><option value="mechanical">Mechanical</option><option value="electrical">Electrical</option><option value="civil">Civil</option></select></label>
          <label>Response due<input required type="date" value={rfiDraft.dueAt} onChange={(event) => setRfiDraft({ ...rfiDraft, dueAt: event.target.value })} /></label>
          <div className="form-actions form-span"><button className="primary-button" disabled={submitting}><Plus size={15} />Retain RFI</button><button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      ) : null}
      {creating && view === 'submittal' ? (
        <form className="project-control-form form-grid compact-form" data-testid="create-submittal-form" onSubmit={submitCreate}>
          <label className="form-span">Submittal title<input required minLength="2" value={submittalDraft.title} onChange={(event) => setSubmittalDraft({ ...submittalDraft, title: event.target.value })} placeholder="Product data, sample, or shop drawing package" /></label>
          <label>Package / spec section<input value={submittalDraft.packageName} onChange={(event) => setSubmittalDraft({ ...submittalDraft, packageName: event.target.value })} placeholder="09 91 00 / finishes" /></label>
          <label>Material<input value={submittalDraft.material} onChange={(event) => setSubmittalDraft({ ...submittalDraft, material: event.target.value })} placeholder="Retained material name" /></label>
          <label>Responsible<input value={submittalDraft.responsible} onChange={(event) => setSubmittalDraft({ ...submittalDraft, responsible: event.target.value })} placeholder="Supplier or project team" /></label>
          <label>Reviewer<input value={submittalDraft.reviewer} onChange={(event) => setSubmittalDraft({ ...submittalDraft, reviewer: event.target.value })} placeholder="Technical reviewer" /></label>
          <label>Decision due<input required type="date" value={submittalDraft.dueAt} onChange={(event) => setSubmittalDraft({ ...submittalDraft, dueAt: event.target.value })} /></label>
          <label className="form-span">Attachment references<input value={submittalDraft.attachments} onChange={(event) => setSubmittalDraft({ ...submittalDraft, attachments: event.target.value })} placeholder="Comma-separated retained document references" /></label>
          <div className="form-actions form-span"><button className="primary-button" disabled={submitting}><Plus size={15} />Retain submittal</button><button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      ) : null}
      {creating && view === 'document' ? (
        <form className="project-control-form form-grid compact-form" data-testid="create-controlled-document-form" onSubmit={submitCreate}>
          <label className="form-span">Document title<input required minLength="2" value={documentDraft.title} onChange={(event) => setDocumentDraft({ ...documentDraft, title: event.target.value })} placeholder="Construction floor plan" /></label>
          <label>Document number<input required minLength="2" value={documentDraft.documentNumber} onChange={(event) => setDocumentDraft({ ...documentDraft, documentNumber: event.target.value })} placeholder="A-101" /></label>
          <label>Revision<input required value={documentDraft.revision} onChange={(event) => setDocumentDraft({ ...documentDraft, revision: event.target.value })} placeholder="P01" /></label>
          <label>Discipline<select value={documentDraft.discipline} onChange={(event) => setDocumentDraft({ ...documentDraft, discipline: event.target.value })}><option value="general">General</option><option value="architectural">Architectural</option><option value="structural">Structural</option><option value="mechanical">Mechanical</option><option value="electrical">Electrical</option><option value="civil">Civil</option></select></label>
          <label>Purpose<select value={documentDraft.purpose} onChange={(event) => setDocumentDraft({ ...documentDraft, purpose: event.target.value })}><option value="construction">For construction</option><option value="review">For review</option><option value="coordination">For coordination</option><option value="record">Record / as-built</option></select></label>
          <label className="form-span">Retained file or source reference<input required minLength="3" value={documentDraft.sourceReference} onChange={(event) => setDocumentDraft({ ...documentDraft, sourceReference: event.target.value })} placeholder="Private storage object, evidence ID, or controlled source reference" /></label>
          <label className="form-span">Revision reason<input value={documentDraft.revisionReason} onChange={(event) => setDocumentDraft({ ...documentDraft, revisionReason: event.target.value })} placeholder="Required when this document number already has a revision" /></label>
          <div className="form-actions form-span"><button className="primary-button" disabled={submitting}><Plus size={15} />Retain revision</button><button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      ) : null}
      {creating && view === 'transmittal' ? (
        <form className="project-control-form form-grid compact-form" data-testid="create-transmittal-form" onSubmit={submitCreate}>
          <label className="form-span">Transmittal subject<input required minLength="3" value={transmittalDraft.subject} onChange={(event) => setTransmittalDraft({ ...transmittalDraft, subject: event.target.value })} placeholder="Construction issue package" /></label>
          <label>Purpose<select value={transmittalDraft.purpose} onChange={(event) => setTransmittalDraft({ ...transmittalDraft, purpose: event.target.value })}><option value="for_information">For information</option><option value="for_review">For review</option><option value="for_approval">For approval</option><option value="for_construction">For construction</option><option value="as_built">As built</option></select></label>
          <label>Acknowledgment due<input required type="date" value={transmittalDraft.dueAt} onChange={(event) => setTransmittalDraft({ ...transmittalDraft, dueAt: event.target.value })} /></label>
          <label className="form-span">Recipients<textarea required minLength="5" value={transmittalDraft.recipients} onChange={(event) => setTransmittalDraft({ ...transmittalDraft, recipients: event.target.value })} placeholder={'One recipient per line: Name <name@example.eu>'} /></label>
          <fieldset className="form-span document-selection">
            <legend>Current controlled revisions</legend>
            {currentDocumentOptions.length ? currentDocumentOptions.map((document) => (
              <label className="checkbox-label" key={document.id}>
                <input
                  type="checkbox"
                  checked={transmittalDraft.documentIds.includes(document.id)}
                  onChange={(event) => setTransmittalDraft({
                    ...transmittalDraft,
                    documentIds: event.target.checked
                      ? [...transmittalDraft.documentIds, document.id]
                      : transmittalDraft.documentIds.filter((id) => id !== document.id),
                  })}
                />
                <span><strong>{document.documentNumber} / rev {document.revision}</strong><small>{document.title}</small></span>
              </label>
            )) : <p className="workflow-note">Approve a controlled revision before preparing a transmittal.</p>}
          </fieldset>
          <label className="form-span">Message<textarea value={transmittalDraft.message} onChange={(event) => setTransmittalDraft({ ...transmittalDraft, message: event.target.value })} placeholder="Purpose, requested action, and response instructions" /></label>
          <div className="form-actions form-span"><button className="primary-button" disabled={submitting || !currentDocumentOptions.length || !transmittalDraft.documentIds.length}><Send size={15} />Prepare transmittal</button><button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      ) : null}
      {creating && view === 'meeting' ? (
        <form className="project-control-form meeting-form form-grid compact-form" data-testid="create-project-meeting-form" onSubmit={submitCreate}>
          <label className="form-span">Meeting title<input required minLength="3" value={meetingDraft.title} onChange={(event) => setMeetingDraft({ ...meetingDraft, title: event.target.value })} placeholder="Weekly project coordination" /></label>
          <label>Meeting type<select value={meetingDraft.meetingType} onChange={(event) => setMeetingDraft({ ...meetingDraft, meetingType: event.target.value })}><option value="coordination">Coordination</option><option value="progress">Progress</option><option value="design">Design</option><option value="client">Client</option><option value="commercial">Commercial</option><option value="closeout">Closeout</option><option value="kickoff">Kickoff</option></select></label>
          <label>Scheduled date and time<input required type="datetime-local" value={meetingDraft.scheduledAt} onChange={(event) => setMeetingDraft({ ...meetingDraft, scheduledAt: event.target.value })} /></label>
          <label>Chair<input value={meetingDraft.chair} onChange={(event) => setMeetingDraft({ ...meetingDraft, chair: event.target.value })} placeholder="Project manager" /></label>
          <label>Location<input value={meetingDraft.location} onChange={(event) => setMeetingDraft({ ...meetingDraft, location: event.target.value })} placeholder="Site office or retained meeting link" /></label>
          <label className="form-span">Attendees<textarea required minLength="2" value={meetingDraft.attendees} onChange={(event) => setMeetingDraft({ ...meetingDraft, attendees: event.target.value })} placeholder={'One per line: Name or Name <name@example.eu>'} /></label>
          <label className="form-span">Agenda<textarea required minLength="3" value={meetingDraft.agenda} onChange={(event) => setMeetingDraft({ ...meetingDraft, agenda: event.target.value })} placeholder="One agenda item per line" /></label>
          <label className="form-span">Minutes summary<textarea required minLength="4" value={meetingDraft.minutesSummary} onChange={(event) => setMeetingDraft({ ...meetingDraft, minutesSummary: event.target.value })} placeholder="Record progress, constraints, information reviewed, and the agreed path forward." /></label>
          <label className="form-span">Decisions<textarea value={meetingDraft.decisions} onChange={(event) => setMeetingDraft({ ...meetingDraft, decisions: event.target.value })} placeholder="One retained decision per line" /></label>
          <fieldset className="form-span meeting-action-editor">
            <legend>Assigned action items</legend>
            {meetingDraft.actions.map((action, index) => (
              <div className="meeting-action-draft" key={action.key} data-testid={`meeting-action-draft-${index + 1}`}>
                <label>Action<input required minLength="3" value={action.title} onChange={(event) => updateMeetingAction(action.key, { title: event.target.value })} placeholder="Confirm delivery window" /></label>
                <label>Owner<input required minLength="2" value={action.ownerName} onChange={(event) => updateMeetingAction(action.key, { ownerName: event.target.value })} placeholder="Named responsible person" /></label>
                <label>Due date<input type="date" value={action.dueAt} onChange={(event) => updateMeetingAction(action.key, { dueAt: event.target.value })} /></label>
                <label>Priority<select value={action.priority} onChange={(event) => updateMeetingAction(action.key, { priority: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
                <label className="meeting-action-description">Details<input value={action.description} onChange={(event) => updateMeetingAction(action.key, { description: event.target.value })} placeholder="Completion condition or retained context" /></label>
                <button type="button" className="icon-button" aria-label={`Remove action ${index + 1}`} onClick={() => removeMeetingAction(action.key)}><X size={15} /></button>
              </div>
            ))}
            <button type="button" className="secondary-button meeting-action-add" onClick={() => setMeetingDraft((current) => ({ ...current, actions: [...current.actions, emptyMeetingActionDraft()] }))}><Plus size={15} />Add action</button>
          </fieldset>
          <div className="form-actions form-span"><button className="primary-button" disabled={submitting}><ClipboardCheck size={15} />Retain draft minutes</button><button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      ) : null}
      <div className="project-control-register" role="tabpanel">
        {records.length ? records.map((record) => {
          const pending = pendingFor(view, record.id)
          const recordTitle = view === 'transmittal' ? record.subject : record.title
          const isRfiOpen = view === 'rfi' && !['answered', 'resolved', 'closed', 'rejected', 'pending_approval'].includes(record.status)
          const isSubmittalDraft = view === 'submittal' && record.status === 'draft'
          const isSubmittalReview = view === 'submittal' && ['submitted', 'pending_review', 'revise_resubmit'].includes(record.status)
          const isDocumentReview = view === 'document' && ['draft', 'stored', 'needs_review', 'needs_update', 'expired'].includes(record.status)
          const canRecordTransmittalIssue = view === 'transmittal' && record.status === 'approved'
          const openReceipts = view === 'transmittal'
            ? (record.receipts || EMPTY_LIST).filter((receipt) => receipt.status === 'awaiting_acknowledgment')
            : EMPTY_LIST
          const meetingActions = view === 'meeting' ? record.actions || EMPTY_LIST : EMPTY_LIST
          const openMeetingItems = meetingActions.filter((action) => action.status === 'open')
          const canSubmitMeeting = view === 'meeting' && record.status === 'draft'
          const canIssueMeeting = view === 'meeting' && record.status === 'approved'
          const canFollowUpMeeting = view === 'meeting' && ['approved', 'issued'].includes(record.status) && openMeetingItems.length > 0
          return (
            <article className="project-control-row" key={record.id} data-testid={`project-control-${view}-${record.id}`}>
              <div className="project-control-copy">
                <div><strong>{recordTitle}</strong><span className={`status status-${record.status}`}>{formatStatus(record.status)}</span>{view === 'document' && record.status === 'approved' && record.data?.isCurrent !== false ? <span className="tag tag-green">Current</span> : null}</div>
                <small>{view === 'rfi' ? `${formatStatus(record.data?.discipline || 'general')} / due ${formatDate(record.dueAt)}` : view === 'submittal' ? `${record.packageName || record.data?.material || 'Package'} / due ${formatDate(record.dueAt)}` : view === 'document' ? `${record.documentNumber || 'Unnumbered'} / rev ${record.revision || '-'} / ${formatStatus(record.discipline || 'general')}` : view === 'transmittal' ? `${record.transmittalNumber} / ${formatStatus(record.purpose)} / ${record.documents?.length || 0} revision(s) / ${record.recipients?.length || 0} recipient(s)` : `${record.meetingNumber} / ${formatStatus(record.meetingType)} / ${formatDateTime(record.scheduledAt)} / ${record.attendees?.length || 0} attendee(s)`}</small>
                {view === 'rfi' ? <p>{record.response || record.question || 'Question details not retained.'}</p> : null}
                {view === 'document' ? <p>{record.data?.revisionReason || record.data?.sourceReference || 'Controlled source retained.'}</p> : null}
                {view === 'transmittal' ? <p>{record.issuedAt ? `Issued ${formatDateTime(record.issuedAt)} / ${openReceipts.length} receipt(s) open` : `Approval and recorded delivery evidence are required before issue / due ${formatDate(record.dueAt)}`}</p> : null}
                {view === 'meeting' ? <p>{record.minutesSummary || 'Draft minutes have no retained summary.'}</p> : null}
                {view === 'meeting' && meetingActions.length ? (
                  <div className="meeting-action-register" aria-label={`${record.meetingNumber} action items`}>
                    {meetingActions.map((action) => (
                      <span key={action.id} className={`meeting-action-chip meeting-action-${action.status}`}>
                        <strong>{action.itemNumber}. {action.title}</strong>
                        <small>{action.ownerName} / due {formatDate(action.dueAt)} / {formatStatus(action.status)}</small>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="project-control-actions">
                {pending && canApprove ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => onOpenApprovals({ approvalId: pending.id })}><ShieldCheck size={14} />Review decision</button> : null}
                {canCoordinate && !pending && isRfiOpen ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => openReview('rfi', record, 'answered')}><MessageSquareText size={14} />Answer</button> : null}
                {canCoordinate && !pending && isSubmittalDraft ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => openReview('submittal', record, 'submitted')}><FileUp size={14} />Submit</button> : null}
                {canCoordinate && !pending && isSubmittalReview ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => openReview('submittal', record, 'approved')}><ShieldCheck size={14} />Request approval</button> : null}
                {canCoordinate && !pending && isDocumentReview ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => openReview('document', record, 'approved')}><ShieldCheck size={14} />Review revision</button> : null}
                {canCoordinate && !pending && canRecordTransmittalIssue ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => openReview('transmittal_issue', record, 'issued')}><Send size={14} />Record issue</button> : null}
                {canCoordinate && openReceipts.length ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => openReview('transmittal_ack', record, 'acknowledged', openReceipts[0])}><MailCheck size={14} />Record receipt</button> : null}
                {canCoordinate && !pending && canSubmitMeeting ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => openReview('meeting_submit', record, 'pending_approval')}><ShieldCheck size={14} />Submit minutes</button> : null}
                {canCoordinate && !pending && canIssueMeeting ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => openReview('meeting_issue', record, 'issued')}><Send size={14} />Record issue</button> : null}
                {canCoordinate && openMeetingItems.length ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => openReview('meeting_action', record, 'completed', openMeetingItems[0])}><Check size={14} />Complete action</button> : null}
                {canCoordinate && canFollowUpMeeting ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => openReview('meeting_followup', record, 'draft')}><CalendarDays size={14} />Follow-up</button> : null}
              </div>
            </article>
          )
        }) : <p className="workflow-note">No {view === 'rfi' ? 'RFIs' : view === 'submittal' ? 'submittals' : view === 'document' ? 'controlled document revisions' : view === 'transmittal' ? 'document transmittals' : 'project meeting minutes'} have been retained for this job.</p>}
      </div>
      {review.record ? (
        <form className="project-control-review" data-testid="project-control-review-form" onSubmit={submitReview}>
          <div><strong>{reviewLabel}</strong><small>{review.record.title || review.record.subject} / target {formatStatus(review.status)}</small></div>
          {review.type === 'transmittal_ack' ? (
            <label>Recipient receipt<select value={review.receiptId} onChange={(event) => {
              const receipt = (review.record.receipts || EMPTY_LIST).find((item) => item.id === event.target.value)
              setReview({ ...review, receiptId: event.target.value, acknowledgedBy: receipt?.recipientName || review.acknowledgedBy })
            }}>{(review.record.receipts || EMPTY_LIST).filter((receipt) => receipt.status === 'awaiting_acknowledgment').map((receipt) => <option value={receipt.id} key={receipt.id}>{receipt.recipientName} / {receipt.recipientEmail}</option>)}</select></label>
          ) : null}
          {review.type === 'meeting_action' ? (
            <label>Open action<select value={review.actionId} onChange={(event) => {
              const action = (review.record.actions || EMPTY_LIST).find((item) => item.id === event.target.value)
              setReview({ ...review, actionId: event.target.value, completedBy: action?.ownerName || review.completedBy })
            }}>{(review.record.actions || EMPTY_LIST).filter((action) => action.status === 'open').map((action) => <option value={action.id} key={action.id}>{action.itemNumber}. {action.title} / {action.ownerName}</option>)}</select></label>
          ) : null}
          {review.type === 'meeting_followup' ? <label>Follow-up date and time<input required type="datetime-local" value={review.scheduledAt} onChange={(event) => setReview({ ...review, scheduledAt: event.target.value })} /></label> : null}
          {['document', 'transmittal_issue', 'transmittal_ack', 'meeting_issue', 'meeting_action'].includes(review.type) ? <label>{review.type === 'document' ? 'Review reference' : review.type === 'transmittal_issue' || review.type === 'meeting_issue' ? 'Delivery evidence reference' : review.type === 'meeting_action' ? 'Completion evidence reference' : 'Acknowledgment evidence reference'}<input required minLength="3" value={review.reference} onChange={(event) => setReview({ ...review, reference: event.target.value })} placeholder={review.type === 'document' ? 'Checker record or retained review evidence' : 'Provider receipt, email evidence, signed record, or retained document ID'} /></label> : null}
          {review.type === 'transmittal_ack' ? <label>Acknowledged by<input required minLength="2" value={review.acknowledgedBy} onChange={(event) => setReview({ ...review, acknowledgedBy: event.target.value })} placeholder="Recipient shown on the evidence" /></label> : null}
          {review.type === 'meeting_action' ? <label>Completed by<input required minLength="2" value={review.completedBy} onChange={(event) => setReview({ ...review, completedBy: event.target.value })} placeholder="Person verified on the completion evidence" /></label> : null}
          <label>{review.type === 'rfi' ? 'Response and evidence' : review.type === 'meeting_followup' ? 'Follow-up minutes summary' : review.type.startsWith('transmittal_') || review.type.startsWith('meeting_') ? 'Evidence notes' : 'Review evidence'}<textarea required minLength="4" value={review.notes} onChange={(event) => setReview({ ...review, notes: event.target.value })} placeholder="Record the technical basis and evidence for this status change." /></label>
          <div className="form-actions"><button className="primary-button" disabled={submitting || review.notes.trim().length < 4 || (['document', 'transmittal_issue', 'transmittal_ack', 'meeting_issue', 'meeting_action'].includes(review.type) && review.reference.trim().length < 3) || (review.type === 'transmittal_ack' && (!review.receiptId || review.acknowledgedBy.trim().length < 2)) || (review.type === 'meeting_action' && (!review.actionId || review.completedBy.trim().length < 2)) || (review.type === 'meeting_followup' && !toIsoDateTime(review.scheduledAt))}><ShieldCheck size={15} />{reviewLabel}</button><button type="button" className="secondary-button" onClick={() => setReview(emptyProjectControlReview())}>Cancel</button></div>
        </form>
      ) : null}
      {!canCoordinate ? <p className="workflow-note">Field access is read-only for project controls. Design responses and revision status remain office-controlled.</p> : null}
    </section>
  )
}

function FieldAssuranceWorkspace({
  field,
  jobs,
  canCoordinate,
  canApprove,
  submitting,
  onPrepareSafety,
  onReview,
  onCapture,
  onOpenApprovals,
  onOpen,
}) {
  const rows = field?.jobs || field?.rows || EMPTY_LIST
  const summary = field?.summary || {}
  const targetFor = (item, action) => {
    const targets = {
      resolve_incident: {
        type: 'incident',
        recordId: action.incidentId,
        record: item.latest?.incident,
        label: 'Resolve incident',
        status: 'resolved',
      },
      resolve_observation: {
        type: 'observation',
        recordId: action.observationId,
        record: item.latest?.observation,
        label: 'Resolve observation',
        status: 'resolved',
      },
      review_rfi: { type: 'rfi', recordId: action.rfiId, record: item.latest?.rfi, label: 'Answer RFI', status: 'answered' },
      review_submittal: {
        type: 'submittal',
        recordId: action.submittalId,
        record: item.latest?.submittal,
        label: 'Approve submittal',
        status: 'approved',
      },
      review_permit: {
        type: 'permit',
        recordId: action.permitId,
        record: item.latest?.permit,
        label: 'Submit permit review',
        status: 'submitted',
      },
      review_document: {
        type: 'document',
        recordId: action.documentId,
        record: item.latest?.document,
        label: 'Approve document review',
        status: 'approved',
      },
      review_inspection: {
        type: 'inspection',
        recordId: action.inspectionId,
        record: item.latest?.inspection,
        label: 'Request inspection sign-off',
        status: 'passed',
      },
      clear_site_access: {
        type: 'site_access',
        recordId: action.siteAccessId,
        record: item.latest?.siteAccess,
        label: 'Clear site access',
        status: 'cleared',
      },
      review_jha: { type: 'jha', recordId: action.jhaId, record: item.latest?.jha, label: 'Approve JHA', status: 'approved' },
      request_sds: { type: 'sds', recordId: action.sdsSheetId, record: item.latest?.sdsSheet, label: 'Approve SDS', status: 'current' },
      complete_safety_meeting: {
        type: 'safety_meeting',
        recordId: action.safetyMeetingId,
        record: item.latest?.safetyMeeting,
        label: 'Complete safety talk',
        status: 'completed',
      },
      complete_orientation: {
        type: 'orientation',
        recordId: action.orientationId,
        record: item.latest?.orientation,
        label: 'Complete orientation',
        status: 'completed',
      },
      complete_quality_review: {
        type: 'quality_check',
        recordId: action.qualityCheckId,
        record: item.latest?.qualityCheck,
        label: 'Complete quality review',
        status: 'passed',
      },
      complete_safety_check: {
        type: 'safety_check',
        recordId: action.safetyCheckId,
        record: item.latest?.safetyCheck,
        label: 'Complete safety check',
        status: 'completed',
      },
      resolve_punch_item: {
        type: 'punch_item',
        recordId: action.punchItemId,
        record: item.latest?.punchItem,
        label: 'Resolve punch item',
        status: 'resolved',
      },
    }
    return targets[action.type]
  }

  return (
    <div className="field-assurance-workspace" data-testid="field-assurance-workspace">
      <div className="assurance-heading">
        <div>
          <h2>Assurance queue</h2>
          <p>Safety, design, permit, inspection, quality, and evidence controls ranked from the retained ledger.</p>
        </div>
        <span className="count-badge">{rows.length}</span>
      </div>
      <div className="assurance-summary" aria-label="Field assurance summary">
        <div>
          <span>Incident blocked</span>
          <strong>{summary.incidentBlocked || 0}</strong>
        </div>
        <div>
          <span>Design review</span>
          <strong>{summary.designReviews || 0}</strong>
        </div>
        <div>
          <span>Quality review</span>
          <strong>{summary.qualityReviews || 0}</strong>
        </div>
        <div>
          <span>Evidence missing</span>
          <strong>{summary.evidenceMissing || 0}</strong>
        </div>
      </div>
      <div className="assurance-list">
        {rows.map((item) => {
          const job = jobs.find((candidate) => candidate.id === item.jobId) || { id: item.jobId, title: item.jobTitle || 'Ledger job' }
          const canAct = canCoordinate && !item.flags?.approvalRequired
          const safetyAction = canAct ? item.nextActions?.find((action) => action.type === 'prepare_safety_pack') : null
          const accessPrerequisiteAction =
            canAct && item.latest?.siteAccess?.orientationValid === false
              ? item.nextActions?.find((action) => action.type === 'complete_orientation')
              : null
          const reviewAction = canAct
            ? accessPrerequisiteAction ||
              FIELD_ASSURANCE_REVIEW_PRIORITY.map((type) => item.nextActions?.find((action) => action.type === type)).find(Boolean)
            : null
          const reviewTarget = reviewAction ? targetFor(item, reviewAction) : null
          const captureAction = canAct ? item.nextActions?.find((action) => action.type === 'capture_field_evidence') : null
          return (
            <article className="assurance-item" key={item.jobId}>
              <div className="assurance-copy">
                <div className="assurance-title">
                  <h3>{item.jobTitle || 'Ledger job'}</h3>
                  <span className={`status status-${item.fieldStatus}`}>{formatStatus(item.fieldStatus)}</span>
                </div>
                <p>{item.nextAction || 'Field assurance records are stable.'}</p>
                <div className="assurance-values">
                  <span>
                    Incidents <strong>{item.counts?.openIncidents || 0}</strong>
                  </span>
                  <span>
                    Design controls{' '}
                    <strong>
                      {(item.counts?.openRfis || 0) +
                        (item.counts?.submittalReviews || 0) +
                        (item.counts?.permitReviews || 0) +
                        (item.counts?.documentReviews || 0)}
                    </strong>
                  </span>
                  <span>
                    Quality controls{' '}
                    <strong>
                      {(item.counts?.inspectionReviews || 0) +
                        (item.counts?.openObservations || 0) +
                        (item.counts?.qualityOpen || 0) +
                        (item.counts?.punchOpen || 0)}
                    </strong>
                  </span>
                  <span>
                    Evidence <strong>{item.counts?.evidenceRecords || 0}</strong>
                  </span>
                </div>
                <div className="assurance-flags">
                  {item.counts?.pendingApprovals ? (
                    <span className="tag tag-amber">
                      {item.counts.pendingApprovals} approval{item.counts.pendingApprovals === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  {item.flags?.safetyGap ? <span className="tag tag-amber">Safety pack missing</span> : null}
                  {item.counts?.expiringPermits ? <span className="tag tag-amber">{item.counts.expiringPermits} permit due</span> : null}
                  {item.counts?.siteAccessBlocks ? (
                    <span className="tag">
                      {item.counts.siteAccessBlocks} access block{item.counts.siteAccessBlocks === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="assurance-actions">
                {item.flags?.approvalRequired && canApprove ? (
                  <button
                    className="secondary-button"
                    disabled={submitting}
                    onClick={() =>
                      onOpenApprovals({
                        jobId: item.jobId,
                        jobTitle: job.title,
                        approvalId: item.nextActions?.find((action) => action.approvalId)?.approvalId || null,
                      })
                    }
                  >
                    <ShieldCheck size={16} />
                    Review approval
                  </button>
                ) : null}
                {safetyAction ? (
                  <button
                    className="secondary-button"
                    aria-label={`Prepare safety pack for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onPrepareSafety(item)}
                  >
                    <PackageCheck size={16} />
                    Safety pack
                  </button>
                ) : null}
                {reviewTarget?.recordId ? (
                  <button
                    className="secondary-button"
                    aria-label={`${reviewTarget.label} for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onReview(item, reviewTarget)}
                  >
                    <ClipboardCheck size={16} />
                    {reviewTarget.label}
                  </button>
                ) : null}
                {captureAction ? (
                  <button
                    className="secondary-button"
                    aria-label={`Capture field evidence for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onCapture(item)}
                  >
                    <FileUp size={16} />
                    Capture evidence
                  </button>
                ) : null}
                <button className="icon-button table-action" aria-label={`Open ${job.title}`} onClick={() => onOpen(job)}>
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </article>
          )
        })}
        {!rows.length ? (
          <Empty
            title="Assurance queue is clear"
            detail="Safety, design, quality, and evidence controls will appear here when review is required."
          />
        ) : null}
      </div>
    </div>
  )
}

function AutomationControl({
  commandPlan,
  scheduler,
  jobs,
  view,
  selectedIds,
  submitting,
  onViewChange,
  onToggle,
  onSelectVisible,
  onApply,
  onRun,
  onOpenApprovals,
  onOpen,
}) {
  const allActions = commandPlan?.actions || EMPTY_LIST
  const actions = allActions.filter((action) => {
    if (view === 'safe') return action.safeDraftable
    if (view === 'approval') return action.requiresApproval
    if (view === 'blocked') return action.blocked
    return true
  })
  const selected = new Set(selectedIds)
  const visibleSafeIds = actions.filter((action) => action.safeDraftable && !action.blocked).map((action) => action.id)
  const allVisibleSafeSelected = visibleSafeIds.length > 0 && visibleSafeIds.every((id) => selected.has(id))
  const summary = commandPlan?.summary || {}
  const schedulerJob = scheduler?.job || null

  return (
    <section className="panel page-panel automation-panel" data-testid="automation-control">
      <div className="panel-heading automation-heading">
        <div>
          <h2>Automation control</h2>
          <p>Prioritized ledger work, retained drafts, and durable scheduler outcomes.</p>
        </div>
        <span className={`status ${schedulerJob?.status === 'running' ? 'status-attention' : 'status-ready'}`}>
          {schedulerJob?.status || 'idle'}
        </span>
      </div>
      <div className="automation-summary" aria-label="Automation summary">
        <div>
          <span>Safe drafts</span>
          <strong>{summary.safeDraftable || 0}</strong>
        </div>
        <div>
          <span>Approval gates</span>
          <strong>{summary.approvalRequired || 0}</strong>
        </div>
        <div>
          <span>Blocked</span>
          <strong>{summary.blocked || 0}</strong>
        </div>
        <div>
          <span>External commitments</span>
          <strong>{summary.externalCommitments || 0}</strong>
        </div>
      </div>
      <div className="automation-toolbar">
        <div className="automation-tabs" role="tablist" aria-label="Automation action view">
          {[
            ['all', 'All'],
            ['safe', 'Safe drafts'],
            ['approval', 'Approvals'],
            ['blocked', 'Blocked'],
          ].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={view === key}
              className={view === key ? 'automation-tab-active' : ''}
              onClick={() => onViewChange(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="automation-commands">
          <button
            className="secondary-button"
            disabled={submitting || !visibleSafeIds.length}
            onClick={() => onSelectVisible(allVisibleSafeSelected ? [] : visibleSafeIds)}
          >
            {allVisibleSafeSelected ? <X size={15} /> : <Check size={15} />}
            {allVisibleSafeSelected ? 'Clear visible' : 'Select safe'}
          </button>
          <button className="primary-button" disabled={submitting || !selectedIds.length} onClick={onApply}>
            <ClipboardCheck size={16} />
            {selectedIds.length ? `Apply ${selectedIds.length} draft${selectedIds.length === 1 ? '' : 's'}` : 'Apply selected'}
          </button>
          <button className="secondary-button" disabled={submitting || schedulerJob?.status === 'running'} onClick={onRun}>
            <Activity size={16} />
            Run due cycle
          </button>
        </div>
      </div>
      {schedulerJob ? (
        <div className="automation-run-state">
          <span>Last completed</span>
          <strong>{formatDate(schedulerJob.lastCompletedAt)}</strong>
          <span>
            {schedulerJob.lastResult?.actionCount || 0} action(s), {schedulerJob.lastResult?.blockedCount || 0} blocked
          </span>
        </div>
      ) : null}
      <div className="automation-list">
        {actions.map((action) => {
          const job =
            jobs.find((candidate) => candidate.id === action.jobId) ||
            (action.jobId ? { id: action.jobId, title: action.jobTitle || 'Ledger job' } : null)
          const selectable = action.safeDraftable && !action.blocked
          return (
            <article className="automation-item" key={action.id}>
              <label className="automation-select">
                <input
                  type="checkbox"
                  disabled={!selectable || submitting}
                  checked={selectable && selected.has(action.id)}
                  onChange={(event) => onToggle(action.id, event.target.checked)}
                />
                <span className="visually-hidden">Select {action.message}</span>
              </label>
              <span className={`severity severity-${action.severity || 'medium'}`}>
                <Activity size={14} />
              </span>
              <div className="automation-copy">
                <strong>{action.jobTitle || formatStatus(action.actionType)}</strong>
                <p>{action.message}</p>
                <small>
                  {formatStatus(action.stream)} · {formatStatus(action.actionType)}
                </small>
              </div>
              <div className="automation-flags">
                {action.safeDraftable ? <span className="tag tag-green">Safe draft</span> : null}
                {action.requiresApproval ? <span className="tag tag-amber">Approval</span> : null}
                {action.blocked ? <span className="tag">Blocked</span> : null}
              </div>
              {action.approvalId ? (
                <button
                  className="icon-button table-action"
                  aria-label={`Review approval for ${action.jobTitle || 'ledger action'}`}
                  onClick={() => onOpenApprovals({ jobId: action.jobId, jobTitle: action.jobTitle, approvalId: action.approvalId })}
                >
                  <ShieldCheck size={16} />
                </button>
              ) : job ? (
                <button className="icon-button table-action" aria-label={`Open ${job.title}`} onClick={() => onOpen(job)}>
                  <ArrowUpRight size={16} />
                </button>
              ) : (
                <span className="automation-action-spacer" />
              )}
            </article>
          )
        })}
        {!actions.length ? (
          <Empty title="No matching automation work" detail="The selected command-plan view has no retained action waiting." />
        ) : null}
      </div>
    </section>
  )
}

function WorkPlanControl({
  job,
  canCoordinate,
  canApprove,
  fieldScoped,
  operator,
  submitting,
  taskDraft,
  setTaskDraft,
  assignees,
  onCreateTask,
  onTaskTransition,
  onUpdateTaskSchedule,
  onAddDependency,
  onCancelDependency,
  onCalculate,
  onRequestBaseline,
  onOpenApprovals,
}) {
  const fallbackStartRef = useRef(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
  const initialStart =
    job.scheduleControl?.pendingBaseline?.plannedStart ||
    job.scheduleControl?.activeBaseline?.plannedStart ||
    job.scheduleControl?.plannedStart ||
    job.scheduledStart ||
    fallbackStartRef.current
  const [plannedStart, setPlannedStart] = useState(() => toLocalDateTimeInput(initialStart))
  const [plan, setPlan] = useState(job.scheduleControl || null)
  const [dependencyDraft, setDependencyDraft] = useState({ predecessorTaskId: '', successorTaskId: '', lagHours: '0' })
  const [durationEdits, setDurationEdits] = useState(() =>
    Object.fromEntries((job.tasks || EMPTY_LIST).map((task) => [task.id, String(task.durationHours || '')])),
  )

  useEffect(() => {
    const control = job.scheduleControl || null
    setPlan(control)
    setPlannedStart(
      toLocalDateTimeInput(
        control?.pendingBaseline?.plannedStart ||
          control?.activeBaseline?.plannedStart ||
          control?.plannedStart ||
          job.scheduledStart ||
          initialStart,
      ),
    )
    setDurationEdits(Object.fromEntries((job.tasks || EMPTY_LIST).map((task) => [task.id, String(task.durationHours || '')])))
    setDependencyDraft({ predecessorTaskId: '', successorTaskId: '', lagHours: '0' })
  }, [initialStart, job])

  const tasks = job.tasks || EMPTY_LIST
  const activeTasks = tasks.filter((task) => !['completed', 'cancelled'].includes(task.status))
  const dependencies = (job.taskDependencies || EMPTY_LIST).filter((dependency) => dependency.status === 'active')
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const calculatedById = new Map((plan?.tasks || EMPTY_LIST).map((task) => [task.id, task]))
  const pendingBaseline = job.scheduleControl?.pendingBaseline || null
  const activeBaseline = job.scheduleControl?.activeBaseline || null
  const baselineState = pendingBaseline
    ? { label: `Baseline v${pendingBaseline.versionNumber} pending`, className: 'tag-amber' }
    : job.scheduleControl?.baselineStale
      ? { label: `Baseline v${activeBaseline?.versionNumber || '?'} stale`, className: 'tag-amber' }
      : job.scheduleControl?.baselineCurrent
        ? { label: `Baseline v${activeBaseline?.versionNumber} current`, className: 'tag-green' }
        : { label: 'No approved baseline', className: '' }
  const totalDuration = activeTasks.reduce((sum, task) => sum + Number(task.durationHours || 0), 0)

  async function calculate(event) {
    event.preventDefault()
    const result = await onCalculate({ plannedStart: toIsoDateTime(plannedStart), horizonDays: 14 })
    if (result) setPlan(result)
  }

  async function requestBaseline() {
    const result = await onRequestBaseline({ plannedStart: toIsoDateTime(plannedStart) })
    if (result?.plan) setPlan(result.plan)
  }

  async function addDependency(event) {
    event.preventDefault()
    const result = await onAddDependency({ ...dependencyDraft, lagHours: Number(dependencyDraft.lagHours || 0) })
    if (result) setDependencyDraft({ predecessorTaskId: '', successorTaskId: '', lagHours: '0' })
  }

  async function saveDuration(task) {
    const durationHours = Number(durationEdits[task.id])
    if (!Number.isFinite(durationHours) || durationHours <= 0) return
    await onUpdateTaskSchedule(task, { durationHours })
  }

  return (
    <section className="job-workspace-section work-plan-control" data-testid="job-task-control">
      <div className="section-heading work-plan-heading">
        <GitBranch size={18} />
        <div>
          <h3>Work plan</h3>
          <p>
            {activeTasks.length} active / {dependencies.length} dependencies
          </p>
        </div>
        <span className={`tag ${baselineState.className}`}>{baselineState.label}</span>
      </div>

      <div className="work-plan-metrics" aria-label="Work plan summary">
        <div>
          <span>Active work</span>
          <strong>{activeTasks.length}</strong>
        </div>
        <div>
          <span>Task hours</span>
          <strong>{roundDisplay(totalDuration)}h</strong>
        </div>
        <div>
          <span>Plan span</span>
          <strong>{plan?.ready ? `${roundDisplay(plan.projectDurationHours)}h` : 'Incomplete'}</strong>
        </div>
        <div>
          <span>Critical tasks</span>
          <strong>{plan?.criticalPathTaskIds?.length || 0}</strong>
        </div>
      </div>

      {canCoordinate ? (
        <form className="form-grid compact-form task-create-form work-plan-task-form" onSubmit={onCreateTask}>
          <label className="form-span">
            Task title
            <input
              required
              value={taskDraft.title}
              onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })}
              placeholder="Work item"
            />
          </label>
          <label>
            Duration (hours)
            <input
              required
              type="number"
              min="0.25"
              max="10000"
              step="0.25"
              value={taskDraft.durationHours}
              onChange={(event) => setTaskDraft({ ...taskDraft, durationHours: event.target.value })}
            />
          </label>
          <label>
            Priority
            <select value={taskDraft.priority} onChange={(event) => setTaskDraft({ ...taskDraft, priority: event.target.value })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>
            Due date
            <input type="date" value={taskDraft.dueAt} onChange={(event) => setTaskDraft({ ...taskDraft, dueAt: event.target.value })} />
          </label>
          <label>
            Predecessor
            <select
              value={taskDraft.predecessorTaskId}
              onChange={(event) => setTaskDraft({ ...taskDraft, predecessorTaskId: event.target.value })}
            >
              <option value="">No predecessor</option>
              {activeTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>
          <label className="form-span">
            Assignee
            <select value={taskDraft.assigneeId} onChange={(event) => setTaskDraft({ ...taskDraft, assigneeId: event.target.value })}>
              <option value="">Unassigned</option>
              {assignees.map((assignee) => (
                <option key={assignee.id} value={assignee.id}>
                  {assignee.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions form-span">
            <button className="secondary-button" disabled={submitting || !taskDraft.title.trim() || Number(taskDraft.durationHours) <= 0}>
              <Plus size={16} />
              Add task
            </button>
          </div>
        </form>
      ) : null}

      {tasks.length ? (
        <div className="work-plan-task-list" role="list">
          {tasks.map((task) => {
            const terminal = ['completed', 'cancelled'].includes(task.status)
            const scheduled = calculatedById.get(task.id) || task
            const assignedWorker = assignees.find((assignee) => assignee.id === task.assigneeId)
            const canUpdateTask = canCoordinate || (fieldScoped && (!task.assigneeId || task.assigneeId === operator.worker?.id))
            return (
              <article
                className={`work-plan-task ${scheduled.critical ? 'is-critical' : ''} ${terminal ? 'is-terminal' : ''}`}
                key={task.id}
                role="listitem"
                data-testid={`job-task-${task.id}`}
              >
                <div className="work-plan-task-index" aria-hidden="true">
                  <span />
                </div>
                <div className="work-plan-task-copy">
                  <div>
                    <strong>{task.title}</strong>
                    {scheduled.critical ? <span className="tag tag-red">Critical</span> : null}
                    {!terminal && Number(scheduled.totalFloatHours) > 0 ? (
                      <span className="tag">{roundDisplay(scheduled.totalFloatHours)}h float</span>
                    ) : null}
                  </div>
                  <small>
                    {assignedWorker?.name || (task.assigneeId ? 'Assigned crew' : 'Unassigned')} / {formatStatus(task.priority)} / due{' '}
                    {formatDate(task.dueAt)}
                  </small>
                  {scheduled.plannedStart && scheduled.plannedEnd ? (
                    <span className="work-plan-window">
                      <CalendarDays size={14} />
                      {formatDateTime(scheduled.plannedStart)} to {formatDateTime(scheduled.plannedEnd)}
                    </span>
                  ) : null}
                </div>
                <div className="work-plan-duration">
                  {canCoordinate && !terminal ? (
                    <>
                      <label>
                        <span className="visually-hidden">Duration hours for {task.title}</span>
                        <input
                          type="number"
                          min="0.25"
                          max="10000"
                          step="0.25"
                          value={durationEdits[task.id] ?? ''}
                          onChange={(event) => setDurationEdits({ ...durationEdits, [task.id]: event.target.value })}
                        />
                      </label>
                      <button
                        type="button"
                        className="icon-button"
                        title="Save duration"
                        aria-label={`Save duration for ${task.title}`}
                        disabled={
                          submitting || Number(durationEdits[task.id]) <= 0 || Number(durationEdits[task.id]) === Number(task.durationHours)
                        }
                        onClick={() => saveDuration(task)}
                      >
                        <Check size={15} />
                      </button>
                    </>
                  ) : (
                    <strong>{roundDisplay(task.durationHours)}h</strong>
                  )}
                </div>
                <div className="task-actions work-plan-task-actions">
                  <span className={`status status-${task.status}`}>{formatStatus(task.status)}</span>
                  {canUpdateTask && !terminal && task.status !== 'in_progress' ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={submitting}
                      aria-label={`Start ${task.title}`}
                      onClick={() => onTaskTransition(task, 'in_progress')}
                    >
                      <Activity size={15} />
                      Start
                    </button>
                  ) : null}
                  {canUpdateTask && !terminal ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={submitting}
                      aria-label={`Complete ${task.title}`}
                      onClick={() => onTaskTransition(task, 'completed')}
                    >
                      <Check size={15} />
                      Complete
                    </button>
                  ) : null}
                  {canUpdateTask && !terminal && task.status !== 'blocked' ? (
                    <button
                      type="button"
                      className="icon-button"
                      disabled={submitting}
                      title="Block task"
                      aria-label={`Block ${task.title}`}
                      onClick={() => onTaskTransition(task, 'blocked')}
                    >
                      <TriangleAlert size={15} />
                    </button>
                  ) : null}
                  {canCoordinate && !terminal ? (
                    <button
                      type="button"
                      className="icon-button"
                      disabled={submitting}
                      title="Cancel task"
                      aria-label={`Cancel ${task.title}`}
                      onClick={() => onTaskTransition(task, 'cancelled')}
                    >
                      <Ban size={15} />
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <p className="workflow-note task-empty">No retained tasks for this job.</p>
      )}

      {canCoordinate && activeTasks.length > 1 ? (
        <div className="work-plan-dependencies">
          <div className="work-plan-subheading">
            <div>
              <GitBranch size={16} />
              <h4>Dependencies</h4>
            </div>
            <span>{dependencies.length} active</span>
          </div>
          <form className="dependency-form" onSubmit={addDependency}>
            <label>
              Predecessor
              <select
                required
                value={dependencyDraft.predecessorTaskId}
                onChange={(event) => setDependencyDraft({ ...dependencyDraft, predecessorTaskId: event.target.value })}
              >
                <option value="">Select task</option>
                {activeTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Successor
              <select
                required
                value={dependencyDraft.successorTaskId}
                onChange={(event) => setDependencyDraft({ ...dependencyDraft, successorTaskId: event.target.value })}
              >
                <option value="">Select task</option>
                {activeTasks
                  .filter((task) => task.id !== dependencyDraft.predecessorTaskId)
                  .map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Lag (hours)
              <input
                type="number"
                min="-1000"
                max="10000"
                step="0.25"
                value={dependencyDraft.lagHours}
                onChange={(event) => setDependencyDraft({ ...dependencyDraft, lagHours: event.target.value })}
              />
            </label>
            <button
              className="secondary-button"
              disabled={submitting || !dependencyDraft.predecessorTaskId || !dependencyDraft.successorTaskId}
            >
              <Plus size={15} />
              Add link
            </button>
          </form>
          {dependencies.length ? (
            <div className="dependency-list">
              {dependencies.map((dependency) => (
                <div key={dependency.id}>
                  <span>{taskById.get(dependency.predecessorTaskId)?.title || 'Task'}</span>
                  <ChevronRight size={15} />
                  <strong>{taskById.get(dependency.successorTaskId)?.title || 'Task'}</strong>
                  {dependency.lagHours ? (
                    <small>
                      {dependency.lagHours > 0 ? '+' : ''}
                      {roundDisplay(dependency.lagHours)}h
                    </small>
                  ) : null}
                  <button
                    type="button"
                    className="icon-button"
                    title="Remove dependency"
                    aria-label={`Remove dependency to ${taskById.get(dependency.successorTaskId)?.title || 'task'}`}
                    disabled={submitting}
                    onClick={() => onCancelDependency(dependency)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {canCoordinate ? (
        <div className="work-plan-baseline">
          <div className="work-plan-subheading">
            <div>
              <Timer size={16} />
              <h4>Baseline control</h4>
            </div>
            <span className="tag">Elapsed-hour basis</span>
          </div>
          <form className="baseline-form" onSubmit={calculate}>
            <label>
              Plan start
              <input required type="datetime-local" value={plannedStart} onChange={(event) => setPlannedStart(event.target.value)} />
            </label>
            <div className="form-actions">
              <button className="secondary-button" disabled={submitting || !plannedStart}>
                <RefreshCw size={15} />
                Calculate
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={submitting || !plan?.ready || Boolean(pendingBaseline)}
                title={pendingBaseline ? 'Resolve the pending baseline first' : !plan?.ready ? 'Complete task durations first' : undefined}
                onClick={requestBaseline}
              >
                <ShieldCheck size={15} />
                Request baseline
              </button>
            </div>
          </form>
          {!plan?.ready ? (
            <div className="work-plan-alert" role="status">
              <TriangleAlert size={16} />
              <span>
                {plan?.reason === 'planned_start_required'
                  ? 'Set the plan start.'
                  : `${plan?.unscheduledTasks?.length || activeTasks.filter((task) => !Number(task.durationHours)).length} task duration(s) missing.`}
              </span>
            </div>
          ) : (
            <div className="work-plan-result" aria-live="polite">
              <div>
                <span>Calculated finish</span>
                <strong>{formatDateTime(plan.plannedEnd)}</strong>
              </div>
              <div>
                <span>Critical path</span>
                <strong>{plan.criticalPathTaskIds?.length || 0} tasks</strong>
              </div>
              <div>
                <span>14-day look-ahead</span>
                <strong>{plan.lookAhead?.length || 0} tasks</strong>
              </div>
            </div>
          )}
          {pendingBaseline && canApprove ? (
            <button
              type="button"
              className="secondary-button baseline-review-button"
              onClick={() => onOpenApprovals({ jobId: job.id, jobTitle: job.title, approvalId: pendingBaseline.approvalId })}
            >
              <ShieldCheck size={15} />
              Review baseline v{pendingBaseline.versionNumber}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

const EMPTY_AUDIT_HISTORY_FILTERS = Object.freeze({ query: '', entityType: '', action: '', actor: '', from: '', until: '' })

function auditHistoryRequestPath(filters, { beforeSequence = null, includeFacets = false } = {}) {
  const parameters = new URLSearchParams({ limit: '25' })
  for (const [key, value] of Object.entries(filters || {})) {
    if (String(value || '').trim()) parameters.set(key, String(value).trim())
  }
  if (beforeSequence) parameters.set('beforeSequence', String(beforeSequence))
  if (includeFacets) parameters.set('includeFacets', 'true')
  return `/api/ledger/audit?${parameters.toString()}`
}

function AuditHistory({ totalEvents = 0 }) {
  const [filters, setFilters] = useState({ ...EMPTY_AUDIT_HISTORY_FILTERS })
  const [appliedFilters, setAppliedFilters] = useState({ ...EMPTY_AUDIT_HISTORY_FILTERS })
  const [events, setEvents] = useState([])
  const [page, setPage] = useState(null)
  const [facets, setFacets] = useState({ entityTypes: [], actions: [], actors: [] })
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [auditLoading, setAuditLoading] = useState(true)
  const [auditError, setAuditError] = useState('')
  const detailCloseRef = useRef(null)
  const detailOpenerRef = useRef(null)

  async function loadHistory(nextFilters, options = {}) {
    setAuditLoading(true)
    setAuditError('')
    try {
      const result = await api(auditHistoryRequestPath(nextFilters, options))
      setEvents((current) => {
        if (!options.append) return result.events || []
        const retained = new Set(current.map((event) => event.id))
        return [...current, ...(result.events || []).filter((event) => !retained.has(event.id))]
      })
      setPage((current) => {
        const nextPage = result.page || null
        if (!options.append || !nextPage) return nextPage
        return { ...nextPage, newestSequence: current?.newestSequence || nextPage.newestSequence }
      })
      if (result.facets) setFacets(result.facets)
      if (!options.append) setAppliedFilters({ ...nextFilters })
      return true
    } catch (requestError) {
      setAuditError(requestError.message)
      return false
    } finally {
      setAuditLoading(false)
    }
  }

  useEffect(() => {
    let retained = true
    async function initializeAuditHistory() {
      try {
        const result = await api(auditHistoryRequestPath(EMPTY_AUDIT_HISTORY_FILTERS, { includeFacets: true }))
        if (!retained) return
        setEvents(result.events || [])
        setPage(result.page || null)
        setFacets(result.facets || { entityTypes: [], actions: [], actors: [] })
      } catch (requestError) {
        if (retained) setAuditError(requestError.message)
      } finally {
        if (retained) setAuditLoading(false)
      }
    }
    initializeAuditHistory()
    return () => {
      retained = false
    }
  }, [])

  useEffect(() => {
    if (!selectedEvent) return undefined
    detailCloseRef.current?.focus()
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setSelectedEvent(null)
      window.requestAnimationFrame(() => detailOpenerRef.current?.focus())
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEvent])

  function closeAuditDetail() {
    setSelectedEvent(null)
    window.requestAnimationFrame(() => detailOpenerRef.current?.focus())
  }

  async function applyFilters(event) {
    event.preventDefault()
    await loadHistory(filters)
  }

  async function clearFilters() {
    const empty = { ...EMPTY_AUDIT_HISTORY_FILTERS }
    setFilters(empty)
    await loadHistory(empty)
  }

  const activeFilterCount = Object.values(appliedFilters).filter((value) => String(value || '').trim()).length
  const facetOptions = (items, label) => (
    <>
      <option value="">All {label}</option>
      {(items || []).map((item) => (
        <option key={item.value} value={item.value}>
          {formatStatus(item.value)} ({item.count})
        </option>
      ))}
    </>
  )

  return (
    <section className="panel page-panel audit-history-panel" data-testid="audit-history-panel" aria-busy={auditLoading || undefined}>
      <div className="panel-heading audit-history-heading">
        <div>
          <h2>Audit history</h2>
          <p>Inspect retained operator, automation, approval, and lifecycle evidence in chain order.</p>
        </div>
        <div className="audit-history-heading-actions">
          <span className="count-badge">{events.length} loaded</span>
          <button
            className="icon-button"
            aria-label="Refresh audit history"
            disabled={auditLoading}
            onClick={() => loadHistory(appliedFilters, { includeFacets: true })}
          >
            <RefreshCw size={16} className={auditLoading ? 'spin' : ''} />
          </button>
        </div>
      </div>
      <form className="audit-filter-toolbar" data-testid="audit-history-filters" onSubmit={applyFilters}>
        <label className="search-control audit-search">
          <Search size={16} />
          <span className="visually-hidden">Search audit history</span>
          <input
            type="search"
            maxLength="120"
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            placeholder="Search action, record, job, or actor"
          />
        </label>
        <label>
          <span>Record type</span>
          <select value={filters.entityType} onChange={(event) => setFilters({ ...filters, entityType: event.target.value })}>
            {facetOptions(facets.entityTypes, 'record types')}
          </select>
        </label>
        <label>
          <span>Action</span>
          <select value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })}>
            {facetOptions(facets.actions, 'actions')}
          </select>
        </label>
        <label>
          <span>Actor</span>
          <select value={filters.actor} onChange={(event) => setFilters({ ...filters, actor: event.target.value })}>
            {facetOptions(facets.actors, 'actors')}
          </select>
        </label>
        <label>
          <span>From</span>
          <input
            type="date"
            value={filters.from}
            max={filters.until || undefined}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
        </label>
        <label>
          <span>Until</span>
          <input
            type="date"
            value={filters.until}
            min={filters.from || undefined}
            onChange={(event) => setFilters({ ...filters, until: event.target.value })}
          />
        </label>
        <div className="audit-filter-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={auditLoading || (!activeFilterCount && !Object.values(filters).some(Boolean))}
            onClick={clearFilters}
          >
            <X size={15} />
            Clear
          </button>
          <button className="primary-button" disabled={auditLoading}>
            <Search size={15} />
            Apply
          </button>
        </div>
      </form>
      <div className="audit-history-summary" aria-live="polite">
        <span>
          {totalEvents} chained event{totalEvents === 1 ? '' : 's'} retained
        </span>
        <strong>
          {activeFilterCount ? `${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}` : 'Latest chain activity'}
        </strong>
        {page?.newestSequence ? (
          <code>
            #{page.newestSequence} to #{page.oldestSequence}
          </code>
        ) : null}
      </div>
      {auditError ? (
        <div className="audit-history-error" role="alert">
          <TriangleAlert size={16} />
          <span>{auditError}</span>
          <button className="secondary-button" onClick={() => loadHistory(appliedFilters, { includeFacets: true })}>
            Retry
          </button>
        </div>
      ) : null}
      <div className="audit-history-list" role="list">
        {events.map((event) => (
          <article className="audit-history-row" role="listitem" key={event.id}>
            <div className="audit-sequence">
              <span>Sequence</span>
              <strong>#{event.sequenceNumber}</strong>
              <code title={event.eventHash}>{shortHash(event.eventHash)}</code>
            </div>
            <div className="audit-event-copy">
              <div>
                <strong>{formatStatus(event.action)}</strong>
                <span className="tag tag-green">Chained</span>
              </div>
              <p>
                {formatStatus(event.entityType)} / {event.entityId}
              </p>
              {event.jobId ? <small>Job {event.jobId}</small> : <small>Portfolio record</small>}
            </div>
            <div className="audit-event-context">
              <strong>{event.actor}</strong>
              <span>{formatDateTime(event.createdAt)}</span>
            </div>
            <button
              className="icon-button table-action"
              aria-label={`Inspect audit event ${event.sequenceNumber}`}
              onClick={(clickEvent) => {
                detailOpenerRef.current = clickEvent.currentTarget
                setSelectedEvent(event)
              }}
            >
              <Eye size={16} />
            </button>
          </article>
        ))}
        {!events.length && !auditLoading && !auditError ? (
          <Empty title="No audit events match" detail="Adjust the filters or refresh to inspect the latest retained chain activity." />
        ) : null}
        {auditLoading && !events.length ? (
          <div className="audit-history-loading">
            <LoaderCircle className="spin" size={22} />
            <span>Loading retained audit history</span>
          </div>
        ) : null}
      </div>
      {page?.hasMore ? (
        <div className="audit-history-more">
          <button
            className="secondary-button"
            disabled={auditLoading}
            onClick={() => loadHistory(appliedFilters, { append: true, beforeSequence: page.nextBeforeSequence })}
          >
            {auditLoading ? <LoaderCircle className="spin" size={15} /> : <ChevronRight size={15} />}Load older events
          </button>
        </div>
      ) : null}

      {selectedEvent ? (
        <div className="modal-backdrop audit-detail-backdrop" role="presentation">
          <section
            className="modal audit-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-detail-title"
            data-testid="audit-event-detail"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Chained event #{selectedEvent.sequenceNumber}</p>
                <h2 id="audit-detail-title">{formatStatus(selectedEvent.action)}</h2>
                <p>
                  {formatDateTime(selectedEvent.createdAt)} / {selectedEvent.actor}
                </p>
              </div>
              <button ref={detailCloseRef} className="icon-button" aria-label="Close audit event detail" onClick={closeAuditDetail}>
                <X size={18} />
              </button>
            </div>
            <div className="audit-detail-body">
              <dl className="audit-detail-facts">
                <div>
                  <dt>Record type</dt>
                  <dd>{formatStatus(selectedEvent.entityType)}</dd>
                </div>
                <div>
                  <dt>Record id</dt>
                  <dd>{selectedEvent.entityId}</dd>
                </div>
                <div>
                  <dt>Job</dt>
                  <dd>{selectedEvent.jobId || 'Portfolio record'}</dd>
                </div>
                <div>
                  <dt>Event id</dt>
                  <dd>{selectedEvent.id}</dd>
                </div>
              </dl>
              <div className="audit-chain-proof">
                <div>
                  <span>Previous hash</span>
                  <code>{selectedEvent.previousHash}</code>
                </div>
                <ChevronRight size={18} />
                <div>
                  <span>Event hash</span>
                  <code>{selectedEvent.eventHash}</code>
                </div>
              </div>
              <div className="audit-payload-grid">
                <section>
                  <h3>Before</h3>
                  <pre>{JSON.stringify(selectedEvent.before ?? null, null, 2)}</pre>
                </section>
                <section>
                  <h3>After</h3>
                  <pre>{JSON.stringify(selectedEvent.after ?? null, null, 2)}</pre>
                </section>
                <section>
                  <h3>Metadata</h3>
                  <pre>{JSON.stringify(selectedEvent.metadata ?? null, null, 2)}</pre>
                </section>
              </div>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={closeAuditDetail}>
                Close
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}

function AuthenticationScreen({ checking, error, submitting, onLogin }) {
  const [token, setToken] = useState('')
  const [visible, setVisible] = useState(false)

  async function submit(event) {
    event.preventDefault()
    const succeeded = await onLogin(token)
    if (succeeded) setToken('')
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-busy={checking || submitting}>
        <div className="auth-brand">
          <span className="brand-mark">
            <HardHat size={18} />
          </span>
          <strong>Contractor.AI</strong>
        </div>
        {checking ? (
          <div className="auth-loading">
            <LoaderCircle className="spin" size={25} />
            <span>Checking operator access</span>
          </div>
        ) : (
          <>
            <div className="auth-heading">
              <span className="auth-icon">
                <LockKeyhole size={21} />
              </span>
              <div>
                <h1>Operator sign in</h1>
                <p>Use the access key issued for your role.</p>
              </div>
            </div>
            <form className="auth-form" onSubmit={submit}>
              <label htmlFor="operator-access-key">Access key</label>
              <div className="auth-input-wrap">
                <input
                  id="operator-access-key"
                  autoComplete="current-password"
                  autoFocus
                  minLength="32"
                  required
                  type={visible ? 'text' : 'password'}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={visible ? 'Hide access key' : 'Show access key'}
                  onClick={() => setVisible((current) => !current)}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {error ? (
                <div className="auth-error" role="alert">
                  <TriangleAlert size={16} />
                  <span>{error}</span>
                </div>
              ) : null}
              <button className="primary-button auth-submit" disabled={submitting || token.length < 32}>
                <LockKeyhole size={16} />
                {submitting ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  )
}

function App() {
  const [section, setSection] = useState('today')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [data, setData] = useState(null)
  const [authState, setAuthState] = useState('checking')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [authError, setAuthError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showIntake, setShowIntake] = useState(false)
  const [opportunityEditor, setOpportunityEditor] = useState(null)
  const [opportunityDraft, setOpportunityDraft] = useState(() => emptyOpportunityDraft())
  const [selectedOpportunity, setSelectedOpportunity] = useState(null)
  const [opportunityActivity, setOpportunityActivity] = useState(null)
  const [opportunityActivityDraft, setOpportunityActivityDraft] = useState(() => emptyOpportunityActivityDraft())
  const [approvalFocus, setApprovalFocus] = useState(null)
  const [approvalReview, setApprovalReview] = useState(null)
  const [approvalReason, setApprovalReason] = useState('')
  const [selectedJobId, setSelectedJobId] = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [selectedJobLoading, setSelectedJobLoading] = useState(false)
  const [taskDraft, setTaskDraft] = useState(emptyTaskDraft)
  const [taskAction, setTaskAction] = useState(null)
  const [taskActionNote, setTaskActionNote] = useState('')
  const [commercialDraftMode, setCommercialDraftMode] = useState(null)
  const [quoteDraft, setQuoteDraft] = useState(emptyQuoteDraft)
  const [changeOrderDraft, setChangeOrderDraft] = useState(emptyChangeOrderDraft)
  const [commercialAcceptance, setCommercialAcceptance] = useState(null)
  const [commercialAcceptanceDraft, setCommercialAcceptanceDraft] = useState(emptyCommercialAcceptanceDraft)
  const [jobLifecycleAction, setJobLifecycleAction] = useState(null)
  const [jobLifecycleReason, setJobLifecycleReason] = useState('')
  const [showResourcePlanner, setShowResourcePlanner] = useState(false)
  const [resourceView, setResourceView] = useState('workforce')
  const [commandPlanView, setCommandPlanView] = useState('all')
  const [selectedCommandIds, setSelectedCommandIds] = useState([])
  const [resourceAction, setResourceAction] = useState(null)
  const [resourceActionDraft, setResourceActionDraft] = useState(emptyResourceActionDraft)
  const [workerEditor, setWorkerEditor] = useState(null)
  const [workerDraft, setWorkerDraft] = useState(emptyWorkerDraft)
  const [workerRetirement, setWorkerRetirement] = useState(null)
  const [workerRetirementReason, setWorkerRetirementReason] = useState('')
  const [equipmentEditor, setEquipmentEditor] = useState(null)
  const [equipmentDraft, setEquipmentDraft] = useState(emptyEquipmentDraft)
  const [equipmentInspection, setEquipmentInspection] = useState(null)
  const [equipmentInspectionDraft, setEquipmentInspectionDraft] = useState(emptyEquipmentInspectionDraft)
  const [equipmentMaintenance, setEquipmentMaintenance] = useState(null)
  const [equipmentMaintenanceDraft, setEquipmentMaintenanceDraft] = useState(emptyEquipmentMaintenanceDraft)
  const [equipmentRetirement, setEquipmentRetirement] = useState(null)
  const [equipmentRetirementReason, setEquipmentRetirementReason] = useState('')
  const [tradePartnerEditor, setTradePartnerEditor] = useState(null)
  const [tradePartnerDraft, setTradePartnerDraft] = useState(emptyTradePartnerDraft)
  const [tradePartnerRetirement, setTradePartnerRetirement] = useState(null)
  const [tradePartnerRetirementReason, setTradePartnerRetirementReason] = useState('')
  const [organizationProfileDraft, setOrganizationProfileDraft] = useState(() => organizationDraft())
  const [invoiceJob, setInvoiceJob] = useState(null)
  const [invoiceDraft, setInvoiceDraft] = useState(() => emptyInvoiceDraft())
  const [financeAction, setFinanceAction] = useState(null)
  const [financeActionDraft, setFinanceActionDraft] = useState(emptyFinanceActionDraft)
  const [clientAction, setClientAction] = useState(null)
  const [clientActionNotes, setClientActionNotes] = useState('')
  const [clientActionOption, setClientActionOption] = useState('')
  const [clientActionReference, setClientActionReference] = useState('')
  const [fieldAction, setFieldAction] = useState(null)
  const [fieldActionNotes, setFieldActionNotes] = useState('')
  const [fieldActionDate, setFieldActionDate] = useState(futureDateInput(365))
  const [fieldActionReference, setFieldActionReference] = useState('')
  const [scheduleDraft, setScheduleDraft] = useState({ plannedStart: '', plannedEnd: '' })
  const [scheduleReview, setScheduleReview] = useState(null)
  const [weatherDraft, setWeatherDraft] = useState({ condition: 'workable', precipitationPercent: '0', weatherSensitive: false })
  const [resourceDraft, setResourceDraft] = useState({ workerId: '', toolId: '' })
  const [resourceOptions, setResourceOptions] = useState({ workers: [], tools: [] })
  const [communicationDraft, setCommunicationDraft] = useState({ channel: 'email', subject: '', body: '', expectsReply: true })
  const [portalDraft, setPortalDraft] = useState({ label: 'Client job portal', expiresAt: futureDateInput(30) })
  const [portalLink, setPortalLink] = useState('')
  const [notice, setNotice] = useState(null)
  const [intake, setIntake] = useState({ clientName: '', title: '', service: '', address: '', description: '', priority: 'medium' })
  const [evidence, setEvidence] = useState({ jobId: '', notes: '', riskLevel: 'medium' })
  const [fieldProgress, setFieldProgress] = useState(emptyFieldProgress)
  const [fieldDailyLog, setFieldDailyLog] = useState(emptyFieldDailyLog)
  const [outboxPending, setOutboxPending] = useState(0)
  const [outboxQuarantined, setOutboxQuarantined] = useState(0)
  const [outboxSyncing, setOutboxSyncing] = useState(false)
  const exportInputRef = useRef(null)
  const evidenceInputRef = useRef(null)
  const fieldCaptureRef = useRef(null)
  const workerDialogOpenerRef = useRef(null)
  const equipmentDialogOpenerRef = useRef(null)
  const equipmentInspectionOpenerRef = useRef(null)
  const equipmentMaintenanceOpenerRef = useRef(null)
  const commercialDialogOpenerRef = useRef(null)
  const noticeSequenceRef = useRef(0)
  const hasLoadedDataRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!hasLoadedDataRef.current) setLoading(true)
    setError('')
    try {
      const sessionResult = await api('/api/session')
      if (sessionResult.authentication?.required && !sessionResult.authentication.authenticated) {
        setData(null)
        setAuthState('required')
        return
      }
      setAuthState('active')
      setAuthError('')
      const operator = sessionResult.operator || { role: 'owner', capabilities: {} }
      const fieldScoped = operator.fieldScoped === true
      const [jobsResult, healthResult, readinessResult] = await Promise.all([
        api('/api/ledger/jobs?limit=100'),
        api('/api/health'),
        api('/api/readiness').catch(() => null),
      ])
      if (fieldScoped) {
        const scopedJobs = jobsResult.jobs || []
        hasLoadedDataRef.current = true
        setData({
          session: sessionResult,
          dashboard: fieldScopedDashboard(scopedJobs),
          jobs: scopedJobs,
          approvals: [],
          dispatch: { rows: [] },
          workforce: { jobs: [], summary: {} },
          workers: [],
          workerSummary: {},
          tools: [],
          toolSummary: {},
          inventory: { jobs: [], summary: {} },
          tradePartners: [],
          tradePartnerSummary: {},
          finance: { jobs: [], summary: {} },
          clients: { jobs: [], summary: {} },
          field: { rows: [] },
          health: healthResult,
          readiness: readinessResult,
          scheduler: null,
          commandPlan: null,
          backups: [],
          archivedJobs: [],
          operationsCapabilities: null,
          organization: null,
          opportunities: [],
          opportunityForecast: null,
        })
        return
      }
      if (!hasLoadedDataRef.current) {
        const initialJobs = jobsResult.jobs || []
        setData({
          session: sessionResult,
          dashboard: initialOperatorDashboard(initialJobs),
          jobs: initialJobs,
          approvals: [],
          dispatch: { rows: [] },
          workforce: { jobs: [], summary: {} },
          workers: [],
          workerSummary: {},
          tools: [],
          toolSummary: {},
          inventory: { jobs: [], summary: {} },
          tradePartners: [],
          tradePartnerSummary: {},
          finance: { jobs: [], summary: {} },
          clients: { jobs: [], summary: {} },
          field: { rows: [] },
          health: healthResult,
          readiness: readinessResult,
          scheduler: null,
          commandPlan: null,
          backups: [],
          archivedJobs: [],
          operationsCapabilities: null,
          organization: null,
          opportunities: [],
          opportunityForecast: null,
        })
      }
      const [
        dashboardResult,
        opportunitiesResult,
        approvalsResult,
        dispatchResult,
        workforceResult,
        workersResult,
        toolsResult,
        inventoryResult,
        partnersResult,
        financeResult,
        clientsResult,
        fieldResult,
        schedulerResult,
        organizationResult,
      ] = await Promise.all([
        api('/api/ledger/dashboard'),
        api('/api/ledger/opportunities?includeClosed=true&limit=500'),
        api('/api/ledger/approvals?status=pending&limit=100'),
        api('/api/ledger/dispatch?limit=100'),
        api('/api/ledger/workforce?limit=100'),
        api('/api/ledger/workers?limit=500'),
        api('/api/ledger/tools?limit=500'),
        api('/api/ledger/inventory?limit=100'),
        api('/api/ledger/trade-partners?includeRetired=true&limit=200'),
        api('/api/ledger/finance?limit=100'),
        api('/api/ledger/client-success?limit=100'),
        api('/api/ledger/field-assurance?limit=100'),
        api('/api/ledger/scheduler').catch(() => null),
        api('/api/ledger/organization'),
      ])
      setOrganizationProfileDraft(organizationDraft(organizationResult.organization))
      const [backupResult, capabilitiesResult, commandPlanResult, archivedJobsResult] = operator.capabilities.maintenance
        ? await Promise.all([
            api('/api/operations/backups').catch(() => ({ backups: [] })),
            api('/api/operations/capabilities').catch(() => null),
            api('/api/ledger/command-plan?limit=100').catch(() => null),
            api('/api/ledger/jobs?archiveOnly=true&limit=100').catch(() => ({ jobs: [] })),
          ])
        : [{ backups: [] }, null, null, { jobs: [] }]
      hasLoadedDataRef.current = true
      setData({
        session: sessionResult,
        dashboard: dashboardResult.dashboard,
        opportunities: opportunitiesResult.opportunities || [],
        opportunityForecast: opportunitiesResult.forecast || null,
        jobs: jobsResult.jobs || [],
        approvals: approvalsResult.approvals || [],
        dispatch: dispatchResult,
        workforce: workforceResult,
        workers: workersResult.workers || [],
        workerSummary: workersResult.summary || {},
        tools: toolsResult.tools || [],
        toolSummary: toolsResult.summary || {},
        inventory: inventoryResult,
        tradePartners: partnersResult.partners || [],
        tradePartnerSummary: partnersResult.summary || {},
        finance: financeResult,
        clients: clientsResult,
        field: fieldResult,
        health: healthResult,
        readiness: readinessResult,
        scheduler: schedulerResult?.scheduler || null,
        commandPlan: commandPlanResult,
        backups: backupResult.backups || [],
        archivedJobs: archivedJobsResult.jobs || [],
        operationsCapabilities: capabilitiesResult,
        organization: organizationResult.organization,
      })
    } catch (requestError) {
      if (requestError.status === 401 || requestError.code === 'authentication_required') {
        setData(null)
        setAuthState('required')
        setAuthError('Your operator session has expired. Sign in again.')
      } else {
        setAuthState('active')
        setError(requestError.message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const dashboard = data?.dashboard
  const operator = data?.session?.operator || { role: 'owner' }
  const fieldScoped = operator.fieldScoped === true
  const outboxScope = fieldOutboxOperatorScope(operator)
  const sessionCapabilities = data?.session?.operator?.capabilities
  const capabilities = useMemo(() => sessionCapabilities || {}, [sessionCapabilities])
  const canCoordinate = !fieldScoped && capabilities.intake === true
  const operationCapabilities = data?.operationsCapabilities?.capabilities || null
  const evidenceStorageCapability = operationCapabilities?.evidenceStorage || null
  const exportValidationAvailable = operationCapabilities?.export?.integrity === 'sha256'
  const localBackupAvailable = operationCapabilities?.backup?.available === true
  const localRestoreAvailable = operationCapabilities?.restore?.available === true
  const providerRecovery = operationCapabilities?.providerRecovery
  const loginRateLimitCapability = operationCapabilities?.authentication?.loginRateLimit
  const loginDefenseLabel =
    loginRateLimitCapability?.durability === 'ledger' && loginRateLimitCapability?.multiReplicaSafe
      ? `${loginRateLimitCapability.limit} failures / ${Math.round(loginRateLimitCapability.windowMs / 60_000)} min, durable`
      : operationCapabilities
        ? 'attention'
        : 'checking'
  const apiRateLimitCapability = operationCapabilities?.requestSafety?.apiRateLimit
  const apiDefenseLabel =
    apiRateLimitCapability?.durability === 'ledger' && apiRateLimitCapability?.multiReplicaSafe
      ? `${apiRateLimitCapability.limit} requests / ${Math.round(apiRateLimitCapability.windowMs / 60_000)} min, durable`
      : operationCapabilities
        ? 'attention'
        : 'checking'
  const auditIntegrityCapability = operationCapabilities?.auditIntegrity
  const auditIntegrityLabel =
    auditIntegrityCapability?.valid && auditIntegrityCapability?.appendMode === 'atomic_hash_chain'
      ? `verified / ${auditIntegrityCapability.eventCount || 0} event${auditIntegrityCapability.eventCount === 1 ? '' : 's'}`
      : operationCapabilities
        ? 'attention'
        : 'checking'
  const recoveryLabel = localRestoreAvailable
    ? 'verified local package'
    : providerRecovery?.available
      ? `${providerRecovery.postgresBackupMode || 'provider backup'} + ${providerRecovery.objectVersioningEnabled ? 'versioned evidence' : 'object recovery pending'}`
      : 'checking'
  const evidenceStorageLabel = evidenceStorageCapability
    ? `${evidenceStorageCapability.mode} / ${evidenceStorageCapability.status}`
    : `${data?.health?.runtime?.storageMode || 'local'} / checking`
  const metrics = dashboard?.metrics || {}
  const jobs = data?.jobs ?? EMPTY_LIST
  const archivedJobs = data?.archivedJobs ?? EMPTY_LIST
  const workers = data?.workers ?? EMPTY_LIST
  const tools = data?.tools ?? EMPTY_LIST
  const tradePartners = data?.tradePartners ?? EMPTY_LIST
  const approvals = data?.approvals ?? EMPTY_LIST
  const visibleApprovals = useMemo(() => {
    if (!approvalFocus) return approvals
    if (approvalFocus.approvalId) return approvals.filter((approval) => approval.id === approvalFocus.approvalId)
    return approvals.filter((approval) => approval.jobId === approvalFocus.jobId)
  }, [approvalFocus, approvals])
  const activeJobs = useMemo(
    () => jobs.filter((job) => !['archived', 'completed', 'cancelled', 'rejected'].includes(job.status)).slice(0, 8),
    [jobs],
  )
  const taskAssigneeOptions = Array.from(
    new Map(
      (selectedJob?.assignments || [])
        .filter(
          (assignment) => assignment.workerId && !['released', 'cancelled', 'completed', 'closed', 'rejected'].includes(assignment.status),
        )
        .map((assignment) => [assignment.workerId, { id: assignment.workerId, name: assignment.workerName || 'Crew member' }]),
    ).values(),
  )
  const nextActions = dashboard?.nextActions?.slice(0, 6) || []
  const invoiceAmount = Number(invoiceDraft.amount) || 0
  const invoiceTaxAmount = roundMoney((invoiceAmount * (Number(invoiceDraft.taxRate) || 0)) / 100)
  const invoiceTotal = roundMoney(invoiceAmount + invoiceTaxAmount)
  const financeControlAmount = Number(financeActionDraft.amount) || 0
  const financeCreditTaxRate = Number(financeAction?.action?.taxRate) || 0
  const financeCreditTax = roundMoney((financeControlAmount * financeCreditTaxRate) / 100)
  const financeCreditTotal = roundMoney(financeControlAmount + financeCreditTax)
  const financeSupplierTax = Number(financeActionDraft.taxAmount) || 0
  const financeSupplierTotal = roundMoney(financeControlAmount + financeSupplierTax)
  const financeControlForecast = Number(financeActionDraft.forecastAmount) || 0
  const financeControlHours = Number(financeActionDraft.hours) || 0
  const financeControlRate = Number(financeActionDraft.rate) || 0
  const financeControlExpense = Number(financeActionDraft.expenseAmount) || 0
  const activeCommercialDraft = commercialDraftMode === 'quote' ? quoteDraft : changeOrderDraft
  const commercialDraftNet = roundMoney(
    (activeCommercialDraft.lineItems || []).reduce((sum, item) => {
      const quantity = Number(item.quantity)
      const unitPrice = Number(item.unitPrice)
      return sum + (Number.isFinite(quantity) && Number.isFinite(unitPrice) ? quantity * unitPrice : 0)
    }, 0),
  )
  const commercialDraftTax = roundMoney((commercialDraftNet * (Number(activeCommercialDraft.taxRate) || 0)) / 100)
  const commercialDraftTotal = roundMoney(commercialDraftNet + commercialDraftTax)
  const commercialLinesValid =
    (activeCommercialDraft.lineItems || []).length > 0 &&
    activeCommercialDraft.lineItems.every(
      (item) =>
        item.description.trim().length >= 2 &&
        Number.isFinite(Number(item.quantity)) &&
        Number(item.quantity) > 0 &&
        Number.isFinite(Number(item.unitPrice)),
    )
  const commercialDraftReady =
    commercialLinesValid &&
    (commercialDraftMode !== 'change_order' ||
      (changeOrderDraft.title.trim().length >= 2 && changeOrderDraft.scopeDelta.trim().length >= 3))
  const initialDataLoading = !hasLoadedDataRef.current
  const visibleNavItems = useMemo(
    () =>
      navItems.filter(([key]) => {
        if (key === 'pipeline') return capabilities.pipeline
        if (key === 'approvals') return capabilities.approvals
        if (key === 'dispatch') return capabilities.dispatch
        if (key === 'resources') return capabilities.resources
        if (key === 'finance') return capabilities.finance
        if (key === 'clients') return capabilities.clientSuccess
        if (key === 'field') return capabilities.fieldEvidence
        if (key === 'operations') return capabilities.maintenance
        return true
      }),
    [capabilities],
  )

  const selectSection = (next) => {
    if (initialDataLoading && !['today', 'jobs'].includes(next)) return
    setApprovalFocus(null)
    setSection(next)
    setMobileNavOpen(false)
  }
  const openApprovals = (focus = null) => {
    if (selectedJobId) closeJobWorkspace()
    setApprovalFocus(focus)
    setSection('approvals')
    setMobileNavOpen(false)
    if (focus?.approvalId || focus?.jobId) {
      const parameters = new URLSearchParams({ status: 'pending', limit: '100' })
      if (focus.approvalId) parameters.set('id', focus.approvalId)
      else parameters.set('jobId', focus.jobId)
      void api(`/api/ledger/approvals?${parameters.toString()}`)
        .then((result) => {
          const focusedApprovals = result.approvals || []
          if (!focusedApprovals.length) return
          setData((current) => {
            if (!current) return current
            const focusedIds = new Set(focusedApprovals.map((approval) => approval.id))
            return {
              ...current,
              approvals: [...focusedApprovals, ...(current.approvals || []).filter((approval) => !focusedIds.has(approval.id))],
            }
          })
        })
        .catch((requestError) => setError(requestError.message))
    }
  }
  const notify = useCallback((message) => {
    noticeSequenceRef.current += 1
    setNotice({ id: noticeSequenceRef.current, message })
  }, [])

  const loginOperator = useCallback(
    async (token) => {
      setAuthSubmitting(true)
      setAuthError('')
      try {
        await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ token }) })
        await refresh()
        return true
      } catch (requestError) {
        setAuthError(requestError.message)
        return false
      } finally {
        setAuthSubmitting(false)
      }
    },
    [refresh],
  )

  const logoutOperator = useCallback(async () => {
    setSubmitting(true)
    try {
      await api('/api/auth/logout', { method: 'POST' })
      setData(null)
      setAuthError('')
      setAuthState('required')
      setSection('today')
      setOutboxPending(0)
      setOutboxQuarantined(0)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }, [])

  const refreshOutboxState = useCallback(async () => {
    const snapshot = await fieldOutboxSnapshot(outboxScope)
    setOutboxPending(snapshot.pending)
    setOutboxQuarantined(snapshot.quarantined)
    return snapshot
  }, [outboxScope])

  const syncFieldOutbox = useCallback(
    async ({ announce = false } = {}) => {
      if (!fieldOutboxAvailable()) return
      setOutboxSyncing(true)
      try {
        const result = await flushFieldOutbox({
          operatorScope: outboxScope,
          sendEvidence: recordFieldEvidence,
          sendOperation: recordFieldOperation,
        })
        setOutboxPending(result.pending)
        setOutboxQuarantined(result.quarantined)
        if (result.sent) {
          if (announce) notify(`${result.sent} queued field update(s) were recorded in the operating ledger.`)
          await refresh()
        }
        if (announce && result.stopped && result.stopped !== 'offline')
          setError(result.stopped.message || 'A queued field update could not be recorded.')
      } catch (requestError) {
        if (announce) setError(requestError.message)
      } finally {
        setOutboxSyncing(false)
      }
    },
    [notify, outboxScope, refresh],
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!notice || loading || submitting || outboxSyncing) return undefined
    const timer = window.setTimeout(() => setNotice(null), 8000)
    return () => window.clearTimeout(timer)
  }, [loading, notice, outboxSyncing, submitting])

  useEffect(() => {
    if (!visibleNavItems.some(([key]) => key === section)) setSection('today')
  }, [section, visibleNavItems])

  useEffect(() => {
    if (authState !== 'active' || !fieldOutboxAvailable()) return undefined
    const initializeOutbox = async () => {
      try {
        const snapshot = await fieldOutboxSnapshot(outboxScope)
        setOutboxPending(snapshot.pending)
        setOutboxQuarantined(snapshot.quarantined)
        if (navigator.onLine !== false) await syncFieldOutbox()
      } catch {
        setOutboxPending(0)
        setOutboxQuarantined(0)
      }
    }
    initializeOutbox()
    const handleOnline = () => {
      syncFieldOutbox()
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [authState, outboxScope, syncFieldOutbox])

  function openApprovalReview(item, status) {
    setApprovalReview({ item, status })
    setApprovalReason('')
  }

  function closeApprovalReview() {
    if (submitting) return
    setApprovalReview(null)
    setApprovalReason('')
  }

  async function resolveApproval(event) {
    event.preventDefault()
    const reasonRequired =
      approvalReview?.status === 'rejected' ||
      (approvalReview?.status === 'approved' && approvalReview?.item?.data?.requiresExceptionOverride === true)
    if (!approvalReview || (reasonRequired && !approvalReason.trim())) return
    const { item, status } = approvalReview
    setSubmitting(true)
    try {
      await api(`/api/ledger/approvals/${item.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          status,
          resolvedBy: 'Owner',
          reason: approvalReason.trim() || `Reviewed ${item.summary || item.targetType} and its retained safeguards.`,
        }),
      })
      setApprovalReview(null)
      setApprovalReason('')
      notify(`Approval ${status}. The ledger and audit trail were updated.`)
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function createIntake(event) {
    event.preventDefault()
    setSubmitting(true)
    try {
      await api('/api/ledger/intake', { method: 'POST', body: JSON.stringify({ ...intake, actor: 'office_operator' }) })
      setShowIntake(false)
      setIntake({ clientName: '', title: '', service: '', address: '', description: '', priority: 'medium' })
      notify('New intake saved to the operating ledger.')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openOpportunityEditor(opportunity = null) {
    setOpportunityEditor({ mode: opportunity ? 'edit' : 'create', opportunity })
    setOpportunityDraft(emptyOpportunityDraft(opportunity))
  }

  function closeOpportunityEditor() {
    setOpportunityEditor(null)
    setOpportunityDraft(emptyOpportunityDraft())
  }

  async function submitOpportunity(event) {
    event.preventDefault()
    if (!opportunityEditor) return
    setSubmitting(true)
    setError('')
    try {
      const payload = {
        ...opportunityDraft,
        estimatedValue: Number(opportunityDraft.estimatedValue) || 0,
        probabilityPercent: Number(opportunityDraft.probabilityPercent) || 0,
        targetDecisionAt: toIsoDateTime(opportunityDraft.targetDecisionAt),
        nextFollowUpAt: toIsoDateTime(opportunityDraft.nextFollowUpAt),
      }
      const result = opportunityEditor.mode === 'create'
        ? await api('/api/ledger/opportunities', { method: 'POST', body: JSON.stringify(payload) })
        : await api(`/api/ledger/opportunities/${encodeURIComponent(opportunityEditor.opportunity.id)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
      closeOpportunityEditor()
      setData((current) => {
        if (!current || !result.opportunity) return current
        const retained = current.opportunities || []
        const opportunityExists = retained.some((opportunity) => opportunity.id === result.opportunity.id)
        return {
          ...current,
          opportunities: opportunityExists
            ? retained.map((opportunity) => (opportunity.id === result.opportunity.id ? result.opportunity : opportunity))
            : [result.opportunity, ...retained],
        }
      })
      setSelectedOpportunity(result.opportunity)
      notify(opportunityEditor.mode === 'create' ? 'Opportunity retained in the preconstruction pipeline.' : 'Opportunity updated in the ledger.')
      await refresh()
      if (result.opportunity?.id) {
        const detail = await api(`/api/ledger/opportunities/${encodeURIComponent(result.opportunity.id)}`)
        setSelectedOpportunity(detail.opportunity)
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function selectOpportunity(opportunity) {
    if (!opportunity) {
      setSelectedOpportunity(null)
      return
    }
    setError('')
    try {
      const result = await api(`/api/ledger/opportunities/${encodeURIComponent(opportunity.id)}`)
      setSelectedOpportunity(result.opportunity)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  function openOpportunityActivity(opportunity) {
    setOpportunityActivity(opportunity)
    setOpportunityActivityDraft(emptyOpportunityActivityDraft())
  }

  async function submitOpportunityActivity(event) {
    event.preventDefault()
    if (!opportunityActivity) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/opportunities/${encodeURIComponent(opportunityActivity.id)}/activities`, {
        method: 'POST',
        body: JSON.stringify({
          ...opportunityActivityDraft,
          dueAt: toIsoDateTime(opportunityActivityDraft.dueAt),
          internalOnly: true,
        }),
      })
      setOpportunityActivity(null)
      setOpportunityActivityDraft(emptyOpportunityActivityDraft())
      setSelectedOpportunity(result.opportunity)
      notify('Internal opportunity activity retained. No external message was sent.')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function completeOpportunityActivity(opportunity, activity) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/opportunities/${encodeURIComponent(opportunity.id)}/activities/${encodeURIComponent(activity.id)}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) },
      )
      setSelectedOpportunity(result.opportunity)
      notify('Opportunity activity completed in the internal ledger.')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function convertOpportunity(opportunity) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/opportunities/${encodeURIComponent(opportunity.id)}/convert`, {
        method: 'POST',
        body: JSON.stringify({ priority: 'medium' }),
      })
      setData((current) => {
        if (!current || !result.opportunity) return current
        return {
          ...current,
          opportunities: (current.opportunities || []).map((record) =>
            record.id === result.opportunity.id ? result.opportunity : record,
          ),
        }
      })
      setSelectedOpportunity(result.opportunity)
      notify(result.replayed ? 'The existing linked job was reopened.' : 'Qualified opportunity converted to an internal job. No external commitment was made.')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openOpportunityJob(opportunity) {
    if (!opportunity.convertedJobId) return
    const linkedJob = jobs.find((job) => job.id === opportunity.convertedJobId) || {
      id: opportunity.convertedJobId,
      title: opportunity.title,
    }
    setSection('jobs')
    void openJobWorkspace(linkedJob)
  }

  async function runCycle() {
    setSubmitting(true)
    try {
      const result = await api('/api/ledger/scheduler/run', {
        method: 'POST',
        body: JSON.stringify({ actor: 'owner_scheduler', maxActions: 10 }),
      })
      if (result.ran) {
        notify(
          `Durable cycle completed with ${result.result?.applied?.length || 0} internal draft action(s) and ${result.result?.blocked?.length || 0} blocked action(s). No external commitment was made.`,
        )
      } else {
        notify(`Durable cycle was not due: ${formatStatus(result.claim?.reason || 'lease retained')}.`)
      }
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function toggleCommandSelection(actionId, checked) {
    setSelectedCommandIds((current) => (checked ? [...new Set([...current, actionId])] : current.filter((id) => id !== actionId)))
  }

  async function applySelectedCommands() {
    if (!selectedCommandIds.length) return
    setSubmitting(true)
    try {
      const result = await api('/api/ledger/command-plan', {
        method: 'POST',
        body: JSON.stringify({
          actionIds: selectedCommandIds,
          limit: selectedCommandIds.length,
          actor: 'owner_command_plan',
        }),
      })
      setSelectedCommandIds([])
      notify(
        `${result.summary?.applied || 0} safe command-plan draft(s) retained; ${result.summary?.skipped || 0} action(s) skipped. External commitments remain zero.`,
      )
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function backup() {
    setSubmitting(true)
    try {
      const result = await api('/api/operations/backup', { method: 'POST', body: JSON.stringify({ actor: 'office_operator' }) })
      notify(
        `Local backup created with ${result.backup.verification.checkedFiles} checksummed file(s), including ${result.backup.evidenceFiles || 0} evidence file(s).`,
      )
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function verifyBackup(backupId) {
    setSubmitting(true)
    try {
      const result = await api('/api/operations/restore/validate', { method: 'POST', body: JSON.stringify({ backupId }) })
      notify(`Backup ${result.verification.backupId} passed ${result.verification.checkedFiles} file checks and the SQLite restore check.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function saveOrganizationProfile(event) {
    event.preventDefault()
    setSubmitting(true)
    try {
      const result = await api('/api/ledger/organization', {
        method: 'PUT',
        body: JSON.stringify({
          ...organizationProfileDraft,
          defaultPaymentTermsDays: Number(organizationProfileDraft.defaultPaymentTermsDays),
          defaultQuoteValidityDays: Number(organizationProfileDraft.defaultQuoteValidityDays),
        }),
      })
      setOrganizationProfileDraft(organizationDraft(result.organization))
      await refresh()
      notify(
        result.organization.readiness.ready
          ? 'Business identity retained and ready for controlled commercial packages.'
          : `Business identity retained. ${result.organization.readiness.missing.length} required item(s) remain.`,
      )
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function validateExport(file) {
    if (!file) return
    setSubmitting(true)
    try {
      const snapshot = JSON.parse(await file.text())
      const result = await api('/api/operations/exports/validate', { method: 'POST', body: JSON.stringify({ snapshot }) })
      notify(
        `Export checksum verified: ${result.counts.jobs} jobs and ${result.counts.approvals} approvals. This artifact is for reconciliation, not restore.`,
      )
    } catch (requestError) {
      setError(requestError instanceof SyntaxError ? 'The selected file is not valid JSON.' : requestError.message)
    } finally {
      if (exportInputRef.current) exportInputRef.current.value = ''
      setSubmitting(false)
    }
  }

  async function uploadEvidence(event) {
    event.preventDefault()
    const file = evidenceInputRef.current?.files?.[0]
    if (!evidence.jobId || !file) {
      setError('Choose a job and an evidence file before recording a field update.')
      return
    }
    const draft = {
      id: createFieldEvidenceDraftId(),
      jobId: evidence.jobId,
      notes: evidence.notes,
      riskLevel: evidence.riskLevel,
      file,
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    try {
      if (navigator.onLine === false) {
        await enqueueFieldEvidenceDraft(draft)
        await refreshOutboxState()
        setEvidence({ jobId: '', notes: '', riskLevel: 'medium' })
        evidenceInputRef.current.value = ''
        notify('Field evidence was saved locally and will be recorded when this device reconnects.')
        return
      }
      const result = await recordFieldEvidence(draft)
      setEvidence({ jobId: '', notes: '', riskLevel: 'medium' })
      evidenceInputRef.current.value = ''
      notify(`${result.ledgerDocument?.filename || file.name} was recorded in the operating ledger.`)
      await refresh()
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldEvidenceDraft(draft)
          await refreshOutboxState()
          setEvidence({ jobId: '', notes: '', riskLevel: 'medium' })
          evidenceInputRef.current.value = ''
          notify('Connection interrupted. Field evidence was saved locally for a controlled retry.')
          return
        } catch (outboxError) {
          setError(outboxError.message)
          return
        }
      }
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function recordFieldProgress(event) {
    event.preventDefault()
    const progressPercent = Number(fieldProgress.progressPercent)
    if (
      !fieldProgress.jobId ||
      !Number.isFinite(progressPercent) ||
      progressPercent < 0 ||
      progressPercent > 100 ||
      !fieldProgress.note.trim()
    ) {
      setError('Choose a job, enter a progress value from 0 to 100, and record a field note.')
      return
    }
    const payload = {
      status: fieldProgress.status,
      progressPercent,
      note: fieldProgress.note.trim(),
      source: 'field_dashboard',
    }
    const draft = {
      id: fieldProgress.entryKey,
      type: 'progress',
      jobId: fieldProgress.jobId,
      payload,
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        setFieldProgress(emptyFieldProgress())
        notify('Field progress was saved locally and will be recorded when this operator reconnects.')
        return
      }
      const result = await recordFieldOperation(draft)
      setFieldProgress(emptyFieldProgress())
      notify(
        result.progress?.replayed
          ? 'This field progress update was already retained; no duplicate was created.'
          : 'Field progress was recorded in the operating ledger.',
      )
      await refresh()
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          setFieldProgress(emptyFieldProgress())
          notify('Connection interrupted. Field progress was saved locally for an exact retry.')
          return
        } catch (outboxError) {
          setError(outboxError.message)
          return
        }
      }
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function recordFieldDailyLog(event) {
    event.preventDefault()
    const hours = Number(fieldDailyLog.hours)
    const manpower = Number(fieldDailyLog.manpower)
    if (
      !fieldDailyLog.jobId ||
      !fieldDailyLog.workDate ||
      !(hours > 0 && hours <= 24) ||
      !(manpower > 0 && manpower <= 500) ||
      !fieldDailyLog.workCompleted.trim()
    ) {
      setError('Choose a job and date, record positive hours and manpower, and describe the completed work.')
      return
    }
    if (!fieldScoped && !fieldDailyLog.workerId) {
      setError('Select the crew member whose time is being recorded.')
      return
    }
    if (fieldDailyLog.safetyConcern && fieldDailyLog.safetyNotes.trim().length < 5) {
      setError('Describe the safety concern before submitting the daily site log.')
      return
    }
    const payload = {
      workerId: fieldScoped ? undefined : fieldDailyLog.workerId,
      workDate: fieldDailyLog.workDate,
      hours,
      manpower,
      weather: fieldDailyLog.weather,
      workCompleted: fieldDailyLog.workCompleted.trim(),
      blockers: fieldDailyLog.blockers,
      safetyConcern: fieldDailyLog.safetyConcern,
      safetyRiskLevel: fieldDailyLog.safetyRiskLevel,
      safetyNotes: fieldDailyLog.safetyNotes.trim(),
      source: 'field_dashboard',
    }
    const draft = {
      id: fieldDailyLog.entryKey,
      type: 'daily_log',
      jobId: fieldDailyLog.jobId,
      payload,
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        setFieldDailyLog(emptyFieldDailyLog())
        notify('Daily site log was saved locally with its time and safety data. It will sync for this operator after reconnection.')
        return
      }
      const result = await recordFieldOperation(draft)
      const approvalCount = Array.isArray(result.dailyLog?.approvals)
        ? result.dailyLog.approvals.length
        : Number(result.dailyLog?.approvals || 0)
      setFieldDailyLog(emptyFieldDailyLog())
      notify(
        result.dailyLog?.replayed
          ? 'This daily site log was already retained; the existing ledger entry was returned without duplication.'
          : `Daily site log recorded with its time card and safety state. ${approvalCount} review${approvalCount === 1 ? '' : 's'} added to the ledger.`,
      )
      await refresh()
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          setFieldDailyLog(emptyFieldDailyLog())
          notify('Connection interrupted. The complete daily site log was saved locally for an exact retry.')
          return
        } catch (outboxError) {
          setError(outboxError.message)
          return
        }
      }
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function loadSelectedJob(jobId) {
    setSelectedJobLoading(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(jobId)}`)
      setSelectedJob(result.job)
      return result.job
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSelectedJobLoading(false)
    }
  }

  async function loadResourceOptions() {
    try {
      const [workersResult, toolsResult] = await Promise.all([api('/api/ledger/workers?limit=100'), api('/api/ledger/tools?limit=100')])
      setResourceOptions({
        workers: (workersResult.workers || []).filter((worker) => !['retired', 'inactive'].includes(worker.status)),
        tools: (toolsResult.tools || []).filter(
          (tool) => tool.status === 'available' && !tool.retirementApprovalId && tool.inspection?.reservationReady !== false,
        ),
      })
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function openJobWorkspace(job) {
    const start = toLocalDateTimeInput(job.scheduledStart || job.targetCompletion)
    setSelectedJobId(job.id)
    setSelectedJob(null)
    setShowResourcePlanner(false)
    setScheduleReview(null)
    setScheduleDraft({
      plannedStart: start,
      plannedEnd: suggestedEndInput(start, job.estimatedHours),
    })
    setWeatherDraft({
      condition: 'workable',
      precipitationPercent: '0',
      weatherSensitive: /garden|pav|roof|fence|outside|outdoor|painting|clean/i.test(
        `${job.jobType || ''} ${job.title || ''} ${job.description || ''}`,
      ),
    })
    setResourceDraft({ workerId: '', toolId: '' })
    setCommunicationDraft({ channel: 'email', subject: '', body: '', expectsReply: true })
    setPortalDraft({ label: 'Client job portal', expiresAt: futureDateInput(30) })
    setPortalLink('')
    setTaskDraft(emptyTaskDraft())
    setTaskAction(null)
    setTaskActionNote('')
    await Promise.all([loadSelectedJob(job.id), canCoordinate ? loadResourceOptions() : Promise.resolve()])
  }

  function closeJobWorkspace() {
    setSelectedJobId(null)
    setSelectedJob(null)
    setScheduleReview(null)
    setPortalLink('')
    setShowResourcePlanner(false)
    setTaskAction(null)
    setTaskActionNote('')
    setCommercialDraftMode(null)
    setCommercialAcceptance(null)
  }

  function openCommercialDraft(mode) {
    if (!selectedJob) return
    commercialDialogOpenerRef.current = document.activeElement
    setCommercialDraftMode(mode)
    if (mode === 'quote') setQuoteDraft(emptyQuoteDraft(selectedJob))
    else setChangeOrderDraft(emptyChangeOrderDraft(selectedJob))
  }

  function restoreCommercialDialogFocus() {
    const opener = commercialDialogOpenerRef.current
    commercialDialogOpenerRef.current = null
    requestAnimationFrame(() => opener?.focus?.())
  }

  function closeCommercialDialog() {
    if (submitting) return
    setCommercialDraftMode(null)
    setCommercialAcceptance(null)
    setCommercialAcceptanceDraft(emptyCommercialAcceptanceDraft())
    restoreCommercialDialogFocus()
  }

  function updateCommercialLineItem(mode, index, key, value) {
    const update = (current) => ({
      ...current,
      lineItems: current.lineItems.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)),
    })
    if (mode === 'quote') setQuoteDraft(update)
    else setChangeOrderDraft(update)
  }

  function addCommercialLineItem(mode) {
    const item = { description: '', quantity: '1', unitPrice: '', costCode: mode === 'quote' ? 'contract' : 'change_order' }
    if (mode === 'quote') setQuoteDraft((current) => ({ ...current, lineItems: [...current.lineItems, item] }))
    else setChangeOrderDraft((current) => ({ ...current, lineItems: [...current.lineItems, item] }))
  }

  function removeCommercialLineItem(mode, index) {
    const update = (current) => ({ ...current, lineItems: current.lineItems.filter((_, itemIndex) => itemIndex !== index) })
    if (mode === 'quote') setQuoteDraft(update)
    else setChangeOrderDraft(update)
  }

  async function submitCommercialDraft(event) {
    event.preventDefault()
    if (!selectedJobId || !commercialDraftMode) return
    const mode = commercialDraftMode
    const draft = mode === 'quote' ? quoteDraft : changeOrderDraft
    const lineItems = draft.lineItems.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      costCode: item.costCode.trim(),
    }))
    if (
      !lineItems.length ||
      lineItems.some(
        (item) => item.description.length < 2 || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitPrice),
      )
    )
      return
    setSubmitting(true)
    try {
      const route = mode === 'quote' ? 'quote' : 'change-orders'
      const payload =
        mode === 'quote'
          ? {
              currency: 'EUR',
              taxRate: Number(draft.taxRate),
              validUntil: draft.validUntil || null,
              notes: draft.notes.trim() || null,
              lineItems,
            }
          : {
              quoteId: draft.quoteId || null,
              title: draft.title.trim(),
              scopeDelta: draft.scopeDelta.trim(),
              scheduleDeltaDays: Number(draft.scheduleDeltaDays),
              currency: 'EUR',
              taxRate: Number(draft.taxRate),
              notes: draft.notes.trim() || null,
              lineItems,
              status: 'submitted',
              requiresApproval: true,
            }
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/${route}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setSelectedJob(result.job)
      setCommercialDraftMode(null)
      await refresh()
      restoreCommercialDialogFocus()
      notify(
        mode === 'quote'
          ? `Estimate retained at ${currency.format(result.quote.subtotal)} net. Internal approval is required before issue.`
          : `Scope change retained at ${currency.format(result.changeOrder.amount)} net. Contract value remains unchanged until client acceptance is verified.`,
      )
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function prepareQuoteIssuePackage(quote) {
    if (!selectedJobId || !quote?.id) return
    setSubmitting(true)
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/quotes/${encodeURIComponent(quote.id)}/issue-package`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      )
      setSelectedJob(result.job)
      await refresh()
      notify(
        result.replayed
          ? `Quote package ${result.issueReference} is already retained with its delivery approval.`
          : `Quote package ${result.issueReference} retained. Delivery remains blocked until its separate approval is resolved.`,
      )
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openCommercialAcceptance(type, record) {
    if (type === 'issue_package') {
      prepareQuoteIssuePackage(record)
      return
    }
    commercialDialogOpenerRef.current = document.activeElement
    setCommercialAcceptance({ type, record })
    setCommercialAcceptanceDraft(emptyCommercialAcceptanceDraft())
  }

  async function submitCommercialAcceptance(event) {
    event.preventDefault()
    if (!selectedJobId || !commercialAcceptance || commercialAcceptanceDraft.evidenceReference.trim().length < 3) return
    const { type, record } = commercialAcceptance
    const route =
      type === 'quote' ? `quotes/${encodeURIComponent(record.id)}/acceptance` : `change-orders/${encodeURIComponent(record.id)}/acceptance`
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/${route}`, {
        method: 'POST',
        body: JSON.stringify({
          acceptedAt: commercialAcceptanceDraft.acceptedAt,
          evidenceReference: commercialAcceptanceDraft.evidenceReference.trim(),
          notes: commercialAcceptanceDraft.notes.trim() || null,
        }),
      })
      setSelectedJob(result.job)
      setCommercialAcceptance(null)
      setCommercialAcceptanceDraft(emptyCommercialAcceptanceDraft())
      await refresh()
      restoreCommercialDialogFocus()
      notify(
        result.replayed
          ? 'The existing client-acceptance verification is already waiting in Approvals.'
          : 'Client acceptance evidence retained. Contract value remains unchanged until an approver verifies it.',
      )
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function createJobTask(event) {
    event.preventDefault()
    const title = taskDraft.title.trim()
    if (!selectedJobId || !title) return
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          priority: taskDraft.priority,
          assigneeId: taskDraft.assigneeId || null,
          durationHours: Number(taskDraft.durationHours),
          predecessorTaskId: taskDraft.predecessorTaskId || null,
          dueAt: taskDraft.dueAt ? new Date(`${taskDraft.dueAt}T17:00:00`).toISOString() : null,
          actor: 'office_operator',
        }),
      })
      setTaskDraft(emptyTaskDraft())
      await Promise.all([refresh(), loadSelectedJob(selectedJobId)])
      notify(`Task retained: ${result.task.title}.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function updateJobTaskSchedule(task, patch) {
    if (!selectedJobId || !task?.id) return null
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/tasks/${encodeURIComponent(task.id)}/schedule`, {
        method: 'PATCH',
        body: JSON.stringify({ ...patch, actor: 'office_operator' }),
      })
      setSelectedJob(result.job)
      await refresh()
      notify(`Planning duration updated for ${task.title}.`)
      return result.task
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function addJobTaskDependency(payload) {
    if (!selectedJobId) return null
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/task-dependencies`, {
        method: 'POST',
        body: JSON.stringify({ ...payload, actor: 'office_operator' }),
      })
      setSelectedJob(result.job)
      await refresh()
      notify('Task dependency retained in the work plan.')
      return result.dependency
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelJobTaskDependency(dependency) {
    if (!selectedJobId || !dependency?.id) return null
    setSubmitting(true)
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/task-dependencies/${encodeURIComponent(dependency.id)}/cancel`,
        {
          method: 'POST',
          body: JSON.stringify({ reason: 'Removed from the current operator work plan.', actor: 'office_operator' }),
        },
      )
      setSelectedJob(result.job)
      await refresh()
      notify('Task dependency removed from the current plan and retained in history.')
      return result.dependency
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function calculateJobWorkPlan(payload) {
    if (!selectedJobId || !payload.plannedStart) return null
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/work-plan/calculate`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      notify(result.plan.ready ? 'Work plan calculated.' : 'Complete the missing planning inputs.')
      return result.plan
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function requestJobScheduleBaseline(payload) {
    if (!selectedJobId || !payload.plannedStart) return null
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/schedule-baselines`, {
        method: 'POST',
        body: JSON.stringify({ ...payload, reason: 'Operator work-plan baseline review.', actor: 'office_operator' }),
      })
      setSelectedJob(result.job)
      notify(result.idempotent ? 'The same work-plan baseline is already pending.' : 'Work-plan baseline added to the approval queue.')
      await refresh()
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function createProjectControl(type, draft) {
    if (!selectedJobId || !canCoordinate) return null
    const routes = {
      rfi: 'rfis',
      submittal: 'submittals',
      document: 'controlled-document-revisions',
      transmittal: 'document-transmittals',
      meeting: 'project-meetings',
    }
    const route = routes[type]
    if (!route) return null
    const payload = type === 'submittal'
      ? {
          ...draft,
          status: 'draft',
          attachments: String(draft.attachments || '').split(',').map((value) => value.trim()).filter(Boolean),
        }
      : type === 'transmittal'
        ? {
            ...draft,
            recipients: parseTransmittalRecipients(draft.recipients),
            documentIds: draft.documentIds,
          }
        : type === 'meeting'
          ? {
              ...draft,
              scheduledAt: toIsoDateTime(draft.scheduledAt),
              attendees: parseMeetingAttendees(draft.attendees),
              agenda: parseMeetingLines(draft.agenda),
              decisions: parseMeetingLines(draft.decisions),
              actions: draft.actions.map((action) => ({
                title: action.title,
                ownerName: action.ownerName,
                dueAt: action.dueAt || null,
                priority: action.priority,
                description: action.description,
              })),
            }
        : { ...draft, status: type === 'rfi' ? 'open' : 'draft' }
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/${route}`, {
        method: 'POST',
        body: JSON.stringify({ ...payload, actor: 'office_operator' }),
      })
      setSelectedJob(result.job)
      notify(
        type === 'rfi'
          ? 'RFI retained in the project decision trail.'
          : type === 'submittal'
            ? 'Submittal draft retained for technical review.'
            : type === 'document'
              ? 'Controlled revision retained. The prior approved revision remains current until approval.'
              : type === 'transmittal'
                ? 'Transmittal package retained for approval. No files or messages were sent.'
                : 'Draft meeting minutes retained with decisions and proposed actions.',
      )
      await refresh()
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function transitionProjectControl(type, record, payload) {
    if (!selectedJobId || !record?.id || !canCoordinate) return null
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/lifecycle/${encodeURIComponent(type)}/${encodeURIComponent(record.id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ ...payload, actor: 'office_operator' }),
        },
      )
      setSelectedJob(result.job)
      notify(
        result.approvalRequired
          ? `${record.title} is retained for explicit approval. No field or external reliance was created.`
          : `${record.title} is now ${formatStatus(payload.status)}.`,
      )
      await refresh()
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function issueDocumentTransmittal(record, payload) {
    if (!selectedJobId || !record?.id || !canCoordinate) return null
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/document-transmittals/${encodeURIComponent(record.id)}/issue`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      setSelectedJob(result.job)
      notify(`${record.transmittalNumber} issue evidence retained. Contractor.AI did not send the package.`)
      await refresh()
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function acknowledgeDocumentTransmittal(record, receiptId, payload) {
    if (!selectedJobId || !record?.id || !receiptId || !canCoordinate) return null
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/document-transmittals/${encodeURIComponent(record.id)}/receipts/${encodeURIComponent(receiptId)}/acknowledge`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      setSelectedJob(result.job)
      notify(result.transmittal.status === 'acknowledged' ? `${record.transmittalNumber} is fully acknowledged.` : 'Recipient acknowledgment evidence retained.')
      await refresh()
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function submitProjectMeeting(record, payload) {
    if (!selectedJobId || !record?.id || !canCoordinate) return null
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/project-meetings/${encodeURIComponent(record.id)}/submit`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      setSelectedJob(result.job)
      notify(result.replayed ? 'These meeting minutes are already pending approval.' : 'Meeting minutes added to the approval queue. Proposed actions are not active yet.')
      await refresh()
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function issueProjectMeeting(record, payload) {
    if (!selectedJobId || !record?.id || !canCoordinate) return null
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/project-meetings/${encodeURIComponent(record.id)}/issue`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      setSelectedJob(result.job)
      notify(`${record.meetingNumber} distribution evidence retained. Contractor.AI did not send the minutes.`)
      await refresh()
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function completeProjectMeetingAction(record, actionId, payload) {
    if (!selectedJobId || !record?.id || !actionId || !canCoordinate) return null
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/project-meetings/${encodeURIComponent(record.id)}/actions/${encodeURIComponent(actionId)}/complete`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      setSelectedJob(result.job)
      notify('Meeting action and its linked job task completed with retained evidence.')
      await refresh()
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function createProjectMeetingFollowUp(record, payload) {
    if (!selectedJobId || !record?.id || !canCoordinate) return null
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/project-meetings/${encodeURIComponent(record.id)}/follow-up`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      setSelectedJob(result.job)
      notify(`${result.carriedActionCount} unresolved action(s) retained on a new draft follow-up meeting.`)
      await refresh()
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function transitionJobTask(task, status, note = '') {
    if (!selectedJobId || !task?.id) return
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/lifecycle/task/${encodeURIComponent(task.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, notes: note.trim(), actor: fieldScoped ? 'field_worker' : 'office_operator' }),
      })
      setSelectedJob(result.job)
      setTaskAction(null)
      setTaskActionNote('')
      await refresh()
      notify(`${task.title} is now ${formatStatus(status)}.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openTaskTransition(task, status) {
    if (status === 'in_progress') {
      transitionJobTask(task, status, 'Task started from the job workspace.')
      return
    }
    setTaskAction({ task, status })
    setTaskActionNote('')
  }

  async function submitTaskTransition(event) {
    event.preventDefault()
    if (!taskAction || taskActionNote.trim().length < 4) return
    await transitionJobTask(taskAction.task, taskAction.status, taskActionNote)
  }

  function openJobLifecycle(mode, job) {
    setJobLifecycleAction({ mode, job })
    setJobLifecycleReason('')
  }

  function closeJobLifecycle() {
    if (submitting) return
    setJobLifecycleAction(null)
    setJobLifecycleReason('')
  }

  async function submitJobLifecycle(event) {
    event.preventDefault()
    if (!jobLifecycleAction || jobLifecycleReason.trim().length < 8) return
    const { mode, job } = jobLifecycleAction
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(job.id)}/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ reason: jobLifecycleReason.trim(), actor: 'office_operator' }),
      })
      setJobLifecycleAction(null)
      setJobLifecycleReason('')
      if (selectedJobId === job.id) closeJobWorkspace()
      notify(
        mode === 'archive'
          ? 'Archive decision retained. The job remains active until an approver confirms the exact effects.'
          : 'Restore decision retained. The job remains archived until an approver confirms the retained state.',
      )
      if (capabilities.approvals && result.approval?.id) {
        openApprovals({ jobId: job.id, jobTitle: job.title, approvalId: result.approval.id })
      }
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function plannedResourceWindow() {
    const scheduledStart = toIsoDateTime(scheduleDraft.plannedStart)
    const scheduledEnd = toIsoDateTime(scheduleDraft.plannedEnd)
    if (!scheduledStart || !scheduledEnd || new Date(scheduledEnd) <= new Date(scheduledStart)) {
      setError('Set a valid proposed start and end time before planning crew or equipment.')
      return null
    }
    return { scheduledStart, scheduledEnd }
  }

  async function assignWorker(event) {
    event.preventDefault()
    const worker = resourceOptions.workers.find((item) => item.id === resourceDraft.workerId)
    const window = plannedResourceWindow()
    if (!selectedJobId || !worker || !window) {
      if (!worker) setError('Choose an available crew member before adding an assignment.')
      return
    }
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/assignments`, {
        method: 'POST',
        body: JSON.stringify({
          workerId: worker.id,
          workerName: worker.name,
          role: worker.role || 'Contractor',
          status: 'planned',
          ...window,
          actor: 'office_operator',
        }),
      })
      setResourceDraft((draft) => ({ ...draft, workerId: '' }))
      notify(
        result.assignment.requiresApproval
          ? 'Crew assignment was added as a conflict-aware approval request.'
          : 'Crew assignment was added to the internal work plan.',
      )
      await Promise.all([refresh(), loadSelectedJob(selectedJobId), loadResourceOptions()])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function reserveTool(event) {
    event.preventDefault()
    const tool = resourceOptions.tools.find((item) => item.id === resourceDraft.toolId)
    const window = plannedResourceWindow()
    if (!selectedJobId || !tool || !window) {
      if (!tool) setError('Choose equipment before adding a reservation.')
      return
    }
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/tools`, {
        method: 'POST',
        body: JSON.stringify({
          toolId: tool.id,
          toolName: tool.name,
          status: 'reserved',
          neededFrom: window.scheduledStart,
          neededUntil: window.scheduledEnd,
          actor: 'office_operator',
        }),
      })
      setResourceDraft((draft) => ({ ...draft, toolId: '' }))
      notify(
        result.toolReservation.requiresApproval
          ? 'Equipment reservation was added as a conflict-aware approval request.'
          : 'Equipment reservation was added to the internal work plan.',
      )
      await Promise.all([refresh(), loadSelectedJob(selectedJobId), loadResourceOptions()])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function releaseAssignment(assignmentId) {
    setSubmitting(true)
    try {
      await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/assignments/${encodeURIComponent(assignmentId)}/release`, {
        method: 'POST',
        body: JSON.stringify({ status: 'released', reason: 'Released from the operator job workspace.', actor: 'office_operator' }),
      })
      notify('Crew assignment released from the internal work plan.')
      await Promise.all([refresh(), loadSelectedJob(selectedJobId), loadResourceOptions()])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function releaseToolReservation(reservationId) {
    setSubmitting(true)
    try {
      await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/tools/${encodeURIComponent(reservationId)}/release`, {
        method: 'POST',
        body: JSON.stringify({ status: 'released', reason: 'Released from the operator job workspace.', actor: 'office_operator' }),
      })
      notify('Equipment reservation released from the internal work plan.')
      await Promise.all([refresh(), loadSelectedJob(selectedJobId), loadResourceOptions()])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function reviewSchedule(event) {
    event.preventDefault()
    const plannedStart = toIsoDateTime(scheduleDraft.plannedStart)
    const plannedEnd = toIsoDateTime(scheduleDraft.plannedEnd)
    if (!selectedJobId || !plannedStart || !plannedEnd || new Date(plannedEnd) <= new Date(plannedStart)) {
      setError('Enter a valid proposed start and end time before reviewing the schedule.')
      return
    }
    setSubmitting(true)
    try {
      const result = await api('/api/ledger/schedule/recommend', {
        method: 'POST',
        body: JSON.stringify({ jobId: selectedJobId, plannedStart, plannedEnd, actor: 'office_operator' }),
      })
      setScheduleReview(result.recommendation)
      notify('Schedule review completed. No date has been committed.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function requestScheduleApproval() {
    const plannedStart = toIsoDateTime(scheduleDraft.plannedStart)
    const plannedEnd = toIsoDateTime(scheduleDraft.plannedEnd)
    if (!selectedJobId || !plannedStart || !plannedEnd || new Date(plannedEnd) <= new Date(plannedStart)) {
      setError('Enter a valid proposed start and end time before requesting approval.')
      return
    }
    setSubmitting(true)
    try {
      const result = await api('/api/ledger/schedule/request-approval', {
        method: 'POST',
        body: JSON.stringify({ jobId: selectedJobId, plannedStart, plannedEnd, clientCommitment: true, actor: 'office_operator' }),
      })
      setScheduleReview(result.recommendation || scheduleReview)
      notify('Schedule approval was added to the ledger. The date remains uncommitted until it is resolved.')
      await Promise.all([refresh(), loadSelectedJob(selectedJobId)])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function recordWeatherAssessment(event) {
    event.preventDefault()
    const precipitationPercent = Number(weatherDraft.precipitationPercent)
    if (!selectedJobId || !Number.isFinite(precipitationPercent) || precipitationPercent < 0 || precipitationPercent > 100) {
      setError('Enter a precipitation risk from 0 to 100 before recording the weather assessment.')
      return
    }
    setSubmitting(true)
    try {
      const result = await api('/api/ledger/weather/assess', {
        method: 'POST',
        body: JSON.stringify({
          jobId: selectedJobId,
          condition: weatherDraft.condition,
          precipitationPercent,
          weatherSensitive: weatherDraft.weatherSensitive,
          actor: 'office_operator',
        }),
      })
      setScheduleReview(null)
      notify(`Weather assessment recorded: ${result.weather.recommendation}`)
      await Promise.all([refresh(), loadSelectedJob(selectedJobId)])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function createCommunicationDraft(event) {
    event.preventDefault()
    if (!selectedJobId || !communicationDraft.subject.trim() || !communicationDraft.body.trim()) {
      setError('Enter a subject and message before creating a client communication draft.')
      return
    }
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/communication`, {
        method: 'POST',
        body: JSON.stringify({
          channel: communicationDraft.channel,
          direction: 'outbound',
          subject: communicationDraft.subject.trim(),
          body: communicationDraft.body.trim(),
          expectsReply: communicationDraft.expectsReply,
          actor: 'office_operator',
        }),
      })
      setCommunicationDraft({ channel: communicationDraft.channel, subject: '', body: '', expectsReply: true })
      notify(
        `Client ${communicationDraft.channel} draft created. Approval ${result.approval?.id ? 'is required before delivery' : 'status was recorded'}.`,
      )
      await Promise.all([refresh(), loadSelectedJob(selectedJobId)])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function requestClientPortalAccess(event) {
    event.preventDefault()
    if (!selectedJobId || !portalDraft.label.trim() || !portalDraft.expiresAt) {
      setError('Enter a portal label and future expiry before requesting client access.')
      return
    }
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/client-portal-access`, {
        method: 'POST',
        body: JSON.stringify({
          label: portalDraft.label.trim(),
          expiresAt: new Date(`${portalDraft.expiresAt}T23:59:59`).toISOString(),
          source: 'job_workspace',
          actor: 'office_operator',
        }),
      })
      setPortalLink(`${window.location.origin}/client-portal.html#token=${result.access.portalToken}`)
      notify('Client portal access is pending approval. The one-time link remains inactive until that approval is resolved.')
      await Promise.all([refresh(), loadSelectedJob(selectedJobId)])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function copyPortalLink() {
    if (!portalLink) return
    try {
      await navigator.clipboard.writeText(portalLink)
      notify('The client portal link was copied. Keep it secure until access is approved.')
    } catch {
      setError('The browser could not copy the portal link. Select and copy it manually before closing this workspace.')
    }
  }

  async function revokeClientPortalAccess(accessId) {
    setSubmitting(true)
    try {
      await api(`/api/ledger/client-portal-access/${encodeURIComponent(accessId)}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ actor: 'office_operator' }),
      })
      notify('Client portal access was revoked and the link can no longer open the job portal.')
      await Promise.all([refresh(), loadSelectedJob(selectedJobId)])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function prepareDispatchPack(item) {
    if (!item?.jobId) {
      setError('The dispatch row is not linked to a retained ledger job.')
      return
    }
    setSubmitting(true)
    try {
      const result = await api('/api/ledger/schedule/prepare-dispatch', {
        method: 'POST',
        body: JSON.stringify({
          jobId: item.jobId,
          plannedStart: item.scheduledStart || item.targetCompletion || undefined,
          actor: 'office_operator',
        }),
      })
      const createdCount = result.created?.length || 0
      const skippedCount = result.skipped?.length || 0
      notify(
        createdCount
          ? `${createdCount} internal dispatch record(s) prepared; ${skippedCount} existing or inapplicable record(s) skipped.`
          : `Dispatch pack already retained; ${skippedCount} duplicate or inapplicable record(s) skipped.`,
      )
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function openResourcePlan(item) {
    const job = jobs.find((candidate) => candidate.id === item?.jobId)
    if (!job) {
      setError('The resource row is not linked to an available ledger job.')
      return
    }
    await openJobWorkspace(job)
    setShowResourcePlanner(true)
  }

  async function draftWorkerInstruction(item) {
    if (!item?.jobId) return
    const draftAction = item.nextActions?.find((action) => action.type === 'draft_worker_instruction')
    if (!draftAction) return
    setSubmitting(true)
    try {
      await api(`/api/ledger/jobs/${encodeURIComponent(item.jobId)}/worker-instructions`, {
        method: 'POST',
        body: JSON.stringify({
          assignmentId: draftAction?.assignmentId || item.latest?.assignment?.id,
          workerId: draftAction?.workerId || item.latest?.assignment?.workerId || null,
          audience: 'crew',
          channel: 'app',
          status: 'draft',
          title: `Crew brief: ${item.jobTitle || 'ledger job'}`,
          notes: 'Internal draft prepared from the retained job scope. Publishing remains approval-gated.',
          actor: 'office_operator',
        }),
      })
      notify('Internal crew instructions were drafted. Nothing was published or delivered.')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openWorkerEditor(worker = null) {
    workerDialogOpenerRef.current = document.activeElement
    setWorkerEditor(worker || { id: null })
    setWorkerDraft(emptyWorkerDraft(worker))
  }

  function closeWorkerEditor() {
    if (submitting) return
    const opener = workerDialogOpenerRef.current
    workerDialogOpenerRef.current = null
    setWorkerEditor(null)
    setWorkerDraft(emptyWorkerDraft())
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus()
    })
  }

  async function saveWorker(event) {
    event.preventDefault()
    if (workerDraft.name.trim().length < 2) {
      setError('Record a crew member name with at least two characters before saving.')
      return
    }
    setSubmitting(true)
    try {
      const editing = Boolean(workerDraft.id)
      const result = await api(editing ? `/api/ledger/workers/${encodeURIComponent(workerDraft.id)}` : '/api/ledger/workers', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: workerDraft.name.trim(),
          role: workerDraft.role.trim() || null,
          status: workerDraft.status,
          email: workerDraft.email.trim() || null,
          phone: workerDraft.phone.trim() || null,
          homeRegion: workerDraft.homeRegion.trim() || null,
          hourlyRate: workerDraft.hourlyRate === '' ? 0 : Number(workerDraft.hourlyRate),
          skills: workerDraft.skills
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          notes: workerDraft.notes.trim() || null,
          actor: 'office_operator',
        }),
      })
      setWorkerEditor(null)
      setWorkerDraft(emptyWorkerDraft())
      notify(
        `${result.worker.name} retained as ${formatStatus(result.worker.status)}. No schedule, payroll, or contact action was created.`,
      )
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openWorkerRetirement(worker) {
    workerDialogOpenerRef.current = document.activeElement
    setWorkerRetirement(worker)
    setWorkerRetirementReason('')
  }

  function closeWorkerRetirement() {
    if (submitting) return
    const opener = workerDialogOpenerRef.current
    workerDialogOpenerRef.current = null
    setWorkerRetirement(null)
    setWorkerRetirementReason('')
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus()
    })
  }

  async function requestWorkerRetirement(event) {
    event.preventDefault()
    if (!workerRetirement || workerRetirementReason.trim().length < 8) return
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/workers/${encodeURIComponent(workerRetirement.id)}/retirement`, {
        method: 'POST',
        body: JSON.stringify({ reason: workerRetirementReason.trim(), actor: 'office_operator' }),
      })
      setWorkerRetirement(null)
      setWorkerRetirementReason('')
      notify(
        result.requiresApproval
          ? `Retirement approval requested for ${result.worker.name}. New assignments are now blocked.`
          : `${result.worker.name} is already retired.`,
      )
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openEquipmentEditor(tool = null) {
    equipmentDialogOpenerRef.current = document.activeElement
    setEquipmentEditor(tool || { id: null })
    setEquipmentDraft(emptyEquipmentDraft(tool))
  }

  function closeEquipmentEditor() {
    if (submitting) return
    const opener = equipmentDialogOpenerRef.current
    equipmentDialogOpenerRef.current = null
    setEquipmentEditor(null)
    setEquipmentDraft(emptyEquipmentDraft())
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus()
    })
  }

  async function saveEquipment(event) {
    event.preventDefault()
    if (equipmentDraft.name.trim().length < 2) {
      setError('Record an equipment name with at least two characters before saving.')
      return
    }
    if (equipmentDraft.inspectionRequired && !equipmentDraft.inspectionDueAt) {
      setError('Record the next inspection due date before marking inspection as required.')
      return
    }
    setSubmitting(true)
    try {
      const editing = Boolean(equipmentDraft.id)
      const result = await api(editing ? `/api/ledger/tools/${encodeURIComponent(equipmentDraft.id)}` : '/api/ledger/tools', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: equipmentDraft.name.trim(),
          category: equipmentDraft.category.trim() || 'general',
          status: equipmentDraft.status,
          homeLocation: equipmentDraft.homeLocation.trim() || null,
          currentLocation: equipmentDraft.currentLocation.trim() || null,
          data: {
            serialNumber: equipmentDraft.serialNumber.trim() || null,
            inspectionRequired: equipmentDraft.inspectionRequired,
            inspectionDueAt: equipmentDraft.inspectionRequired ? equipmentDraft.inspectionDueAt || null : null,
            notes: equipmentDraft.notes.trim() || null,
          },
          actor: 'office_operator',
        }),
      })
      setEquipmentEditor(null)
      setEquipmentDraft(emptyEquipmentDraft())
      notify(`${result.tool.name} retained as ${formatStatus(result.tool.status)}. No dispatch, purchase, or assignment was created.`)
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openEquipmentInspection(tool) {
    equipmentInspectionOpenerRef.current = document.activeElement
    setEquipmentInspection(tool)
    setEquipmentInspectionDraft(emptyEquipmentInspectionDraft())
  }

  function closeEquipmentInspection() {
    if (submitting) return
    const opener = equipmentInspectionOpenerRef.current
    equipmentInspectionOpenerRef.current = null
    setEquipmentInspection(null)
    setEquipmentInspectionDraft(emptyEquipmentInspectionDraft())
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus()
    })
  }

  async function recordEquipmentInspection(event) {
    event.preventDefault()
    if (!equipmentInspection || equipmentInspectionDraft.inspector.trim().length < 2) return
    const requiresNextDue = equipmentInspection.inspection?.required && equipmentInspectionDraft.result === 'passed'
    if (requiresNextDue && !equipmentInspectionDraft.nextDueAt) return
    if (equipmentInspectionDraft.result !== 'passed' && equipmentInspectionDraft.notes.trim().length < 8) return
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/tools/${encodeURIComponent(equipmentInspection.id)}/inspections`, {
        method: 'POST',
        body: JSON.stringify({
          result: equipmentInspectionDraft.result,
          inspector: equipmentInspectionDraft.inspector.trim(),
          inspectedAt: equipmentInspectionDraft.inspectedAt,
          nextDueAt: equipmentInspectionDraft.result === 'passed' ? equipmentInspectionDraft.nextDueAt || null : null,
          reference: equipmentInspectionDraft.reference.trim() || null,
          notes: equipmentInspectionDraft.notes.trim() || null,
          actor: 'office_operator',
        }),
      })
      setEquipmentInspection(null)
      setEquipmentInspectionDraft(emptyEquipmentInspectionDraft())
      notify(
        `${result.tool.name} inspection retained as ${formatStatus(result.inspection.result)}. ${result.reservationReady ? 'Inspection readiness is clear.' : 'New reservations remain blocked.'}`,
      )
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openEquipmentMaintenance(tool) {
    equipmentMaintenanceOpenerRef.current = document.activeElement
    setEquipmentMaintenance(tool)
    setEquipmentMaintenanceDraft(emptyEquipmentMaintenanceDraft())
  }

  function closeEquipmentMaintenance() {
    if (submitting) return
    const opener = equipmentMaintenanceOpenerRef.current
    equipmentMaintenanceOpenerRef.current = null
    setEquipmentMaintenance(null)
    setEquipmentMaintenanceDraft(emptyEquipmentMaintenanceDraft())
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus()
    })
  }

  async function recordEquipmentMaintenance(event) {
    event.preventDefault()
    if (
      !equipmentMaintenance ||
      equipmentMaintenanceDraft.performedBy.trim().length < 2 ||
      equipmentMaintenanceDraft.notes.trim().length < 8
    )
      return
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/tools/${encodeURIComponent(equipmentMaintenance.id)}/maintenance`, {
        method: 'POST',
        body: JSON.stringify({
          outcome: equipmentMaintenanceDraft.outcome,
          maintenanceType: equipmentMaintenanceDraft.maintenanceType,
          performedBy: equipmentMaintenanceDraft.performedBy.trim(),
          performedAt: equipmentMaintenanceDraft.performedAt,
          reference: equipmentMaintenanceDraft.reference.trim() || null,
          notes: equipmentMaintenanceDraft.notes.trim(),
          actor: 'office_operator',
        }),
      })
      setEquipmentMaintenance(null)
      setEquipmentMaintenanceDraft(emptyEquipmentMaintenanceDraft())
      notify(
        result.reinspectionRequired
          ? `${result.tool.name} maintenance retained as completed. A passing reinspection is required before a new reservation.`
          : `${result.tool.name} maintenance retained as ${formatStatus(result.maintenance.outcome)}. ${result.reservationReady ? 'Equipment readiness is clear.' : 'New reservations remain blocked.'}`,
      )
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openEquipmentRetirement(tool) {
    equipmentDialogOpenerRef.current = document.activeElement
    setEquipmentRetirement(tool)
    setEquipmentRetirementReason('')
  }

  function closeEquipmentRetirement() {
    if (submitting) return
    const opener = equipmentDialogOpenerRef.current
    equipmentDialogOpenerRef.current = null
    setEquipmentRetirement(null)
    setEquipmentRetirementReason('')
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus()
    })
  }

  async function requestEquipmentRetirement(event) {
    event.preventDefault()
    if (!equipmentRetirement || equipmentRetirementReason.trim().length < 8) return
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/tools/${encodeURIComponent(equipmentRetirement.id)}/retirement`, {
        method: 'POST',
        body: JSON.stringify({ reason: equipmentRetirementReason.trim(), actor: 'office_operator' }),
      })
      setEquipmentRetirement(null)
      setEquipmentRetirementReason('')
      notify(
        result.requiresApproval
          ? `Retirement approval requested for ${result.tool.name}. New reservations are now blocked.`
          : `${result.tool.name} is already retired.`,
      )
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openTradePartnerEditor(partner = null) {
    setTradePartnerEditor(partner || { id: null })
    setTradePartnerDraft(emptyTradePartnerDraft(partner))
  }

  function closeTradePartnerEditor() {
    if (submitting) return
    setTradePartnerEditor(null)
    setTradePartnerDraft(emptyTradePartnerDraft())
  }

  async function saveTradePartner(event) {
    event.preventDefault()
    if (!tradePartnerDraft.name.trim()) {
      setError('Record the trade partner name before saving.')
      return
    }
    setSubmitting(true)
    try {
      const editing = Boolean(tradePartnerDraft.id)
      const result = await api(
        editing ? `/api/ledger/trade-partners/${encodeURIComponent(tradePartnerDraft.id)}` : '/api/ledger/trade-partners',
        {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...tradePartnerDraft,
            name: tradePartnerDraft.name.trim(),
            contactName: tradePartnerDraft.contactName.trim() || null,
            email: tradePartnerDraft.email.trim() || null,
            phone: tradePartnerDraft.phone.trim() || null,
            city: tradePartnerDraft.city.trim() || null,
            registrationNumber: tradePartnerDraft.registrationNumber.trim() || null,
            vatNumber: tradePartnerDraft.vatExempt ? null : tradePartnerDraft.vatNumber.trim() || null,
            specialties: tradePartnerDraft.specialties
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
            insuranceExpiresAt: tradePartnerDraft.insuranceExpiresAt || null,
            vcaExpiresAt: tradePartnerDraft.vcaExpiresAt || null,
            verificationReference: tradePartnerDraft.verificationReference.trim() || null,
            verifiedAt: tradePartnerDraft.verifiedAt || null,
            notes: tradePartnerDraft.notes.trim() || null,
            actor: 'office_operator',
          }),
        },
      )
      setTradePartnerEditor(null)
      setTradePartnerDraft(emptyTradePartnerDraft())
      notify(`${result.partner.name} retained with ${formatStatus(result.partner.compliance.status)} compliance status.`)
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openTradePartnerRetirement(partner) {
    setTradePartnerRetirement(partner)
    setTradePartnerRetirementReason('')
  }

  function closeTradePartnerRetirement() {
    if (submitting) return
    setTradePartnerRetirement(null)
    setTradePartnerRetirementReason('')
  }

  async function requestTradePartnerRetirement(event) {
    event.preventDefault()
    if (!tradePartnerRetirement || tradePartnerRetirementReason.trim().length < 8) return
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/trade-partners/${encodeURIComponent(tradePartnerRetirement.id)}/retirement`, {
        method: 'POST',
        body: JSON.stringify({ reason: tradePartnerRetirementReason.trim(), actor: 'office_operator' }),
      })
      setTradePartnerRetirement(null)
      setTradePartnerRetirementReason('')
      notify(
        result.requiresApproval
          ? `Retirement approval requested for ${result.partner.name}. Existing purchasing records remain retained.`
          : `${result.partner.name} is already retired.`,
      )
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openTradePartnerDirectory() {
    closeResourceControl()
    setResourceView('partners')
    setSection('resources')
  }

  async function prepareLoadingChecklist(item) {
    if (!item?.jobId || item.counts?.loadingPlans) return
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(item.jobId)}/loading-plans`, {
        method: 'POST',
        body: JSON.stringify({
          status: 'draft',
          vehicle: 'Vehicle assignment pending',
          notes: 'Internal loading checklist prepared from retained material and equipment requirements.',
          actor: 'office_operator',
        }),
      })
      const itemCount = result.loadingPlan?.data?.readiness?.itemCounts?.total || 0
      notify(`Loading checklist retained with ${itemCount} item(s). No vehicle or dispatch commitment was made.`)
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function draftProcurementOrder(item) {
    if (!item?.jobId || item.counts?.procurementOrders) return
    const materials = (item.materials || []).map((material) => ({
      name: material.name,
      quantity: material.quantity,
      unit: material.unit,
      unitCost: material.cost,
      supplier: material.supplier,
    }))
    const supplierName = materials.find((material) => material.supplier)?.supplier || ''
    const tradePartner = tradePartners.find(
      (partner) => partner.status === 'active' && partner.name.toLowerCase() === supplierName.toLowerCase(),
    )
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(item.jobId)}/procurement-orders`, {
        method: 'POST',
        body: JSON.stringify({
          status: 'draft',
          requiresApproval: true,
          items: materials,
          supplier: tradePartner?.name || supplierName || null,
          tradePartnerId: tradePartner?.id || null,
          amount: item.money?.materialCost || 0,
          requiredBy: item.scheduledStart || item.targetCompletion,
          notes: 'Approval-gated procurement draft. No supplier order or spending commitment has been made.',
          actor: 'office_operator',
        }),
      })
      notify(
        `Procurement draft retained for ${currency.format(result.procurementOrder?.amount || 0)}. Approval is required before supplier commitment.`,
      )
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openResourceControl(item, action) {
    if (!item?.jobId || !action?.type || !RESOURCE_ACTION_LABELS[action.type]) {
      setError('The resource action is not linked to a supported ledger workflow.')
      return
    }
    const material = item.materials?.find((candidate) => candidate.id === action.materialRequirementId) || item.latest?.material || null
    const workerName = action.workerName || item.latest?.assignment?.workerName || item.workers?.[0]?.name || ''
    const procurementOrder = action.recordType === 'procurement_order' ? action.record : null
    const matchedPartner =
      tradePartners.find((partner) => partner.id === procurementOrder?.tradePartnerId) ||
      tradePartners.find((partner) => partner.name.toLowerCase() === String(procurementOrder?.supplier || '').toLowerCase())
    setResourceAction({ item, action, material, procurementOrder, label: RESOURCE_ACTION_LABELS[action.type] })
    setResourceActionDraft({
      ...emptyResourceActionDraft(),
      workerName,
      company: item.latest?.orientation?.company || action.company || 'Internal crew',
      rate: String(item.latest?.assignment?.hourlyRate || 52),
      availableQuantity: material?.quantity != null ? String(material.quantity) : '',
      location: material?.data?.location || '',
      reference: item.latest?.orientation?.data?.verificationReference || material?.data?.verificationReference || '',
      supplier: matchedPartner?.name || procurementOrder?.supplier || '',
      tradePartnerId: matchedPartner?.id || '',
      amount: procurementOrder?.amount != null ? String(procurementOrder.amount) : '',
      requiredBy: procurementOrder?.requiredBy ? String(procurementOrder.requiredBy).slice(0, 10) : futureDateInput(7),
    })
  }

  function reviewCrewEvidence(item, action) {
    if (!item?.jobId || !action?.recordType || !action?.recordId) {
      setError('The crew evidence action is not linked to a retained assignment record.')
      return
    }
    openFieldReview(item, {
      type: action.recordType,
      recordId: action.recordId,
      record: action.record,
      label: action.label,
      status: action.targetStatus,
    })
  }

  function closeResourceControl() {
    setResourceAction(null)
    setResourceActionDraft(emptyResourceActionDraft())
  }

  async function submitResourceControl(event) {
    event.preventDefault()
    const type = resourceAction?.action?.type
    const jobId = resourceAction?.item?.jobId
    const notes = resourceActionDraft.notes.trim()
    const reference = resourceActionDraft.reference.trim()
    const workerName = resourceActionDraft.workerName.trim()
    if (!jobId || !type || !notes) {
      setError('Record the internal resource evidence before continuing.')
      return
    }

    let route = ''
    let method = 'POST'
    let body = {}
    if (type === 'complete_worker_orientation') {
      if (!workerName || !reference) {
        setError('Worker name and orientation verification reference are required.')
        return
      }
      const orientationId = resourceAction.action.orientationId
      route = orientationId
        ? `/api/ledger/jobs/${encodeURIComponent(jobId)}/lifecycle/orientation/${encodeURIComponent(orientationId)}`
        : `/api/ledger/jobs/${encodeURIComponent(jobId)}/orientations`
      method = orientationId ? 'PATCH' : 'POST'
      body = {
        status: 'completed',
        requiresApproval: true,
        grantsAccess: true,
        assignmentId: resourceAction.action.assignmentId || null,
        workerId: resourceAction.action.workerId || null,
        workerName,
        company: resourceActionDraft.company.trim() || 'Internal crew',
        completedAt: new Date().toISOString(),
        verificationReference: reference,
        topics: ['Site rules', 'PPE and VCA controls', 'Emergency and stop-work procedure'],
        notes,
      }
    } else if (type === 'prepare_site_access') {
      if (!workerName || !resourceAction.action.orientationId) {
        setError('A current worker and approved orientation are required before preparing site access.')
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/site-access`
      body = {
        assignmentId: resourceAction.action.assignmentId || null,
        workerId: resourceAction.action.workerId || null,
        orientationId: resourceAction.action.orientationId,
        workerName,
        company: resourceActionDraft.company.trim() || 'Internal crew',
        status: 'blocked',
        orientationValid: true,
        accessPoint: 'Main site access',
        notes,
      }
    } else if (type === 'record_time_log') {
      const hours = Number(resourceActionDraft.hours)
      const rate = Number(resourceActionDraft.rate)
      if (!workerName || !resourceActionDraft.workDate || !(hours > 0 && hours <= 24) || !Number.isFinite(rate) || rate < 0) {
        setError('Record a worker, date, positive hours up to 24, and a non-negative rate.')
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/time-logs`
      body = {
        workerId: resourceAction.action.workerId || null,
        workerName,
        workDate: resourceActionDraft.workDate,
        hours,
        billable: true,
        rate,
        status: 'submitted',
        costCode: resourceActionDraft.costCode.trim() || 'labor',
        verificationReference: reference || null,
        notes,
      }
    } else if (type === 'request_procurement_approval') {
      const procurementOrderId = resourceAction.action.procurementOrderId || resourceAction.procurementOrder?.id
      const amount = Number(resourceActionDraft.amount)
      if (
        !procurementOrderId ||
        !resourceActionDraft.tradePartnerId ||
        !resourceActionDraft.supplier.trim() ||
        !(amount > 0) ||
        !resourceActionDraft.requiredBy
      ) {
        setError('Select a retained trade partner, positive order value, and required-by date before requesting approval.')
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/procurement-orders/${encodeURIComponent(procurementOrderId)}/request-approval`
      body = {
        supplier: resourceActionDraft.supplier.trim(),
        tradePartnerId: resourceActionDraft.tradePartnerId,
        amount: roundMoney(amount),
        requiredBy: new Date(`${resourceActionDraft.requiredBy}T23:59:59`).toISOString(),
        notes,
      }
    } else if (type === 'review_material_status') {
      const materialRequirementId = resourceAction.action.materialRequirementId || resourceAction.material?.id
      const availableQuantity = Number(resourceActionDraft.availableQuantity)
      if (!materialRequirementId || !(availableQuantity > 0) || !resourceActionDraft.location.trim() || !reference) {
        setError('Record a positive verified quantity, location, and material reference.')
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/materials/${encodeURIComponent(materialRequirementId)}/status`
      method = 'PATCH'
      body = {
        status: resourceActionDraft.materialStatus,
        availableQuantity,
        location: resourceActionDraft.location.trim(),
        verificationReference: reference,
        notes,
      }
    }

    if (!route) {
      setError('This resource action is not available in the current ledger runtime.')
      return
    }

    setSubmitting(true)
    try {
      const result = await api(route, { method, body: JSON.stringify({ ...body, actor: 'office_operator' }) })
      if (type === 'complete_worker_orientation') {
        notify('Orientation completion evidence retained for approval. Site access remains blocked until review.')
      } else if (type === 'prepare_site_access') {
        notify('The assignment-scoped site-access gate was retained. Clearance still requires explicit approval.')
      } else if (type === 'request_procurement_approval') {
        notify(
          `Procurement approval requested for ${currency.format(result.procurementOrder?.amount || 0)}. No supplier order or spend commitment was made.`,
        )
      } else if (type === 'record_time_log') {
        notify('Worker time was recorded in the retained job ledger.')
      } else {
        notify(
          `${formatStatus(result.materialRequirement?.status)} material evidence retained. No supplier order or spend commitment was made.`,
        )
      }
      closeResourceControl()
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function openInvoiceDraft(item, action = null) {
    if (!item?.jobId) {
      setError('The finance row is not linked to a retained ledger job.')
      return
    }
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(item.jobId)}`)
      const quote =
        result.job?.quotes?.find((candidate) => !['cancelled', 'rejected', 'expired'].includes(candidate.status)) || result.job?.quotes?.[0]
      const milestone = action?.billingMilestoneId
        ? result.job?.billingMilestones?.find((candidate) => candidate.id === action.billingMilestoneId)
        : null
      const amount = Math.max(
        0,
        Number(milestone?.amount ?? action?.amount ?? item.money?.invoiceDraftAmount ?? quote?.subtotal ?? item.money?.contractValue ?? 0),
      )
      const client = result.job?.client || {}
      setInvoiceJob({ ...item, billingMilestone: milestone || null })
      setInvoiceDraft({
        ...emptyInvoiceDraft(),
        billingMilestoneId: milestone?.id || '',
        amount: amount ? amount.toFixed(2) : '',
        taxRate: milestone?.taxRate != null ? String(milestone.taxRate) : quote?.taxRate != null ? String(quote.taxRate) : '21',
        dueAt: milestone?.dueAt ? String(milestone.dueAt).slice(0, 10) : futureDateInput(14),
        peppolReady: true,
        buyerLegalName: client.company || client.name || item.clientName || '',
        buyerRegistrationNumber: client.data?.registrationNumber || '',
        buyerEndpointScheme: client.data?.electronicAddressScheme || '0106',
        buyerEndpointId: client.data?.electronicAddress || '',
        buyerAddress: client.address || result.job?.address || '',
        buyerPostalCode: client.data?.postalCode || '',
        buyerCity: client.city || result.job?.city || '',
        buyerCountry: client.country || result.job?.country || 'NL',
        notes: milestone
          ? `Approval-gated invoice draft derived from billing milestone ${milestone.sequenceNumber}: ${milestone.title}. No invoice has been issued or sent.`
          : 'Approval-gated invoice draft prepared from retained quote or contract value. No invoice has been issued or sent.',
      })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function closeInvoiceDraft() {
    setInvoiceJob(null)
    setInvoiceDraft(emptyInvoiceDraft())
  }

  async function createInvoiceDraft(event) {
    event.preventDefault()
    const amount = Number(invoiceDraft.amount)
    const taxRate = Number(invoiceDraft.taxRate)
    if (
      !invoiceJob?.jobId ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isFinite(taxRate) ||
      taxRate < 0 ||
      taxRate > 100 ||
      !invoiceDraft.dueAt
    ) {
      setError('Enter a positive invoice amount, a VAT rate from 0 to 100, and a due date.')
      return
    }
    if (
      invoiceDraft.peppolReady &&
      (!invoiceDraft.buyerLegalName.trim() ||
        !invoiceDraft.buyerAddress.trim() ||
        !invoiceDraft.buyerPostalCode.trim() ||
        !invoiceDraft.buyerCity.trim() ||
        !/^[A-Za-z]{2}$/.test(invoiceDraft.buyerCountry.trim()) ||
        !invoiceDraft.buyerEndpointScheme.trim() ||
        !invoiceDraft.buyerEndpointId.trim() ||
        (!invoiceDraft.buyerReference.trim() && !invoiceDraft.purchaseOrderReference.trim()))
    ) {
      setError('Complete the buyer identity, address, electronic endpoint, and buyer or order reference for the requested UBL export.')
      return
    }
    const taxAmount = roundMoney((amount * taxRate) / 100)
    const total = roundMoney(amount + taxAmount)
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(invoiceJob.jobId)}/invoices`, {
        method: 'POST',
        body: JSON.stringify({
          status: 'draft',
          currency: 'EUR',
          amount: roundMoney(amount),
          billingMilestoneId: invoiceDraft.billingMilestoneId || null,
          taxAmount,
          total,
          dueAt: new Date(`${invoiceDraft.dueAt}T23:59:59`).toISOString(),
          peppolReady: invoiceDraft.peppolReady,
          structuredExportRequested: invoiceDraft.peppolReady,
          buyerReference: invoiceDraft.buyerReference.trim(),
          purchaseOrderReference: invoiceDraft.purchaseOrderReference.trim(),
          buyerLegalName: invoiceDraft.buyerLegalName.trim(),
          buyerRegistrationNumber: invoiceDraft.buyerRegistrationNumber.trim(),
          buyerEndpointScheme: invoiceDraft.peppolReady ? invoiceDraft.buyerEndpointScheme.trim() : '',
          buyerEndpointId: invoiceDraft.peppolReady ? invoiceDraft.buyerEndpointId.trim() : '',
          buyerAddress: invoiceDraft.buyerAddress.trim(),
          buyerPostalCode: invoiceDraft.buyerPostalCode.trim(),
          buyerCity: invoiceDraft.buyerCity.trim(),
          buyerCountry: invoiceDraft.buyerCountry.trim().toUpperCase(),
          notes: invoiceDraft.notes.trim(),
          actor: 'office_operator',
        }),
      })
      notify(
        `Invoice draft retained for ${currency.format(total)}. Approval ${result.invoice?.approvalId ? 'is required before issue or delivery' : 'status needs review'}.`,
      )
      closeInvoiceDraft()
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function prepareInvoicePackage(item, action) {
    const creditNotePackage = action?.type === 'prepare_credit_note_package'
    if (!item?.jobId || (creditNotePackage ? !action?.creditNoteId : !action?.invoiceId)) {
      setError(`The approved ${creditNotePackage ? 'credit note' : 'invoice'} is not linked to a retained finance row.`)
      return
    }
    setSubmitting(true)
    try {
      const route = creditNotePackage
        ? `/api/ledger/jobs/${encodeURIComponent(item.jobId)}/credit-notes/${encodeURIComponent(action.creditNoteId)}/issue-package`
        : `/api/ledger/jobs/${encodeURIComponent(item.jobId)}/invoices/${encodeURIComponent(action.invoiceId)}/issue-package`
      const result = await api(route, {
        method: 'POST',
        body: JSON.stringify({ actor: 'office_operator' }),
      })
      notify(
        `${creditNotePackage ? 'Credit note' : 'Invoice'} ${result.issueReference} retained with ${result.structuredExportIncluded ? 'HTML and UBL attachments' : 'a human-readable attachment'}. ${creditNotePackage ? 'The receivable was adjusted; delivery' : 'Delivery'} still requires approval and a verified receipt.`,
      )
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openFinanceControl(item, action) {
    if (!item?.jobId || !action?.type || !FINANCE_ACTION_LABELS[action.type]) {
      setError('The finance action is not linked to a supported ledger workflow.')
      return
    }
    const paymentAmount = Number(
      action.availableAmount ||
        action.outstandingAmount ||
        item.money?.unpaidValue ||
        item.latest?.payment?.amount ||
        item.latest?.invoice?.total ||
        0,
    )
    const creditNoteAmount = Number(action.availableNetAmount || 0)
    const contractAmount = Number(item.money?.contractValue || item.money?.quotedNetValue || 0)
    const drawAmount = Number(item.latest?.invoice?.total || item.money?.invoiceValue || item.money?.unpaidValue || 0)
    const supplierInvoiceAmount = Number(action.committedAmount || 0)
    const amount =
      action.type === 'create_credit_note'
        ? creditNoteAmount
        : action.type === 'record_supplier_invoice'
          ? supplierInvoiceAmount
          : ['create_budget_line', 'create_billing_milestone'].includes(action.type)
            ? Number(action.suggestedAmount || contractAmount)
            : action.type === 'create_draw_request'
              ? drawAmount
              : paymentAmount
    setFinanceAction({ item, action, label: FINANCE_ACTION_LABELS[action.type] })
    setFinanceActionDraft({
      ...emptyFinanceActionDraft(),
      outcome: action.type === 'record_payment_reconciliation' ? 'received' : 'follow_up_recorded',
      amount: amount > 0 ? amount.toFixed(2) : '',
      taxRate: action.taxRate == null ? '21' : String(action.taxRate),
      taxAmount: action.type === 'record_supplier_invoice' && amount > 0 ? roundMoney(amount * 0.21).toFixed(2) : '',
      forecastAmount: contractAmount > 0 ? contractAmount.toFixed(2) : '',
      plannedIssueAt: action.plannedIssueAt ? String(action.plannedIssueAt).slice(0, 10) : futureDateInput(7),
      dueAt: action.dueAt ? String(action.dueAt).slice(0, 10) : futureDateInput(action.type === 'create_billing_milestone' ? 37 : 7),
      vendor: action.supplier || item.latest?.purchaseOrder?.supplier || '',
      description:
        action.type === 'create_billing_milestone'
          ? `${item.jobTitle || 'Job'} billing milestone ${action.nextSequenceNumber || ''}`.trim()
          : `${item.jobTitle || 'Job'} finance baseline`,
      percentComplete: String(Math.max(0, Math.min(100, Number(item.progressPercent) || 0))),
    })
  }

  function closeFinanceControl() {
    setFinanceAction(null)
    setFinanceActionDraft(emptyFinanceActionDraft())
  }

  async function submitFinanceControl(event) {
    event.preventDefault()
    const type = financeAction?.action?.type
    const jobId = financeAction?.item?.jobId
    const notes = financeActionDraft.notes.trim()
    const reference = financeActionDraft.reference.trim()
    const vendor = financeActionDraft.vendor.trim()
    if (!jobId || !type || !notes) {
      setError('Record the internal finance evidence before continuing.')
      return
    }

    let route = ''
    let body = {}
    if (type === 'create_credit_note') {
      if (!(financeControlAmount > 0) || !financeAction.action.invoiceId) {
        setError('Record a positive net correction amount against the retained invoice.')
        return
      }
      const availableAmount = Number(financeAction.action.availableAmount || 0)
      if (availableAmount > 0 && financeCreditTotal - availableAmount > 0.01) {
        setError(`The credit-note total cannot exceed the available invoice balance of ${currency.format(availableAmount)}.`)
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/invoices/${encodeURIComponent(financeAction.action.invoiceId)}/credit-notes`
      body = {
        amount: roundMoney(financeControlAmount),
        taxRate: financeCreditTaxRate,
        currency: 'EUR',
        reason: notes,
        description:
          financeActionDraft.description.trim() ||
          `Correction for invoice ${financeAction.action.invoiceReference || financeAction.action.invoiceId}`,
        structuredExportRequested: financeAction.action.structuredExportRequested === true,
      }
    } else if (type === 'record_supplier_invoice') {
      const invoiceNumber = financeActionDraft.invoiceNumber.trim()
      const deliveryReference = financeActionDraft.deliveryReference.trim()
      if (
        !(financeControlAmount > 0) ||
        financeSupplierTax < 0 ||
        !invoiceNumber ||
        !vendor ||
        !financeActionDraft.invoiceDate ||
        !financeActionDraft.dueAt ||
        !deliveryReference
      ) {
        setError('Record the supplier, invoice number, positive net amount, VAT, invoice and due dates, and delivery evidence reference.')
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/supplier-invoices`
      body = {
        purchaseOrderId: financeAction.action.purchaseOrderId || null,
        supplier: vendor,
        invoiceNumber,
        invoiceDate: financeActionDraft.invoiceDate,
        dueAt: new Date(`${financeActionDraft.dueAt}T23:59:59`).toISOString(),
        netAmount: roundMoney(financeControlAmount),
        taxAmount: roundMoney(financeSupplierTax),
        total: financeSupplierTotal,
        currency: financeAction.action.currency || 'EUR',
        deliveryReference,
        notes,
      }
    } else if (type === 'record_supplier_payment') {
      if (!(financeControlAmount > 0) || !financeAction.action.supplierInvoiceId || !reference || !financeActionDraft.paidAt) {
        setError('Record a positive supplier payment, retained supplier invoice, payment date, and bank or bookkeeping reference.')
        return
      }
      const availableAmount = Number(financeAction.action.availableAmount || financeAction.action.outstandingAmount || 0)
      if (availableAmount > 0 && financeControlAmount - availableAmount > 0.01) {
        setError(`The payment confirmation cannot exceed the available supplier balance of ${currency.format(availableAmount)}.`)
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/supplier-invoices/${encodeURIComponent(financeAction.action.supplierInvoiceId)}/payments`
      body = {
        amount: roundMoney(financeControlAmount),
        paidAt: new Date(`${financeActionDraft.paidAt}T12:00:00`).toISOString(),
        method: financeActionDraft.method,
        reference,
        notes,
      }
    } else if (type === 'record_payment_reconciliation') {
      if (!(financeControlAmount > 0) || !financeAction.action.invoiceId || !reference) {
        setError('Record a positive settlement amount, retained invoice, and payment or authority reference.')
        return
      }
      const availableAmount = Number(financeAction.action.availableAmount || financeAction.action.outstandingAmount || 0)
      if (availableAmount > 0 && financeControlAmount - availableAmount > 0.01) {
        setError(`The settlement amount cannot exceed the available invoice balance of ${currency.format(availableAmount)}.`)
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/invoices/${encodeURIComponent(financeAction.action.invoiceId)}/payments`
      body = {
        status: financeActionDraft.outcome,
        amount: roundMoney(financeControlAmount),
        paidAt:
          financeActionDraft.outcome === 'received' && financeActionDraft.paidAt
            ? new Date(`${financeActionDraft.paidAt}T12:00:00`).toISOString()
            : null,
        method: financeActionDraft.outcome === 'received' ? financeActionDraft.method : 'write_off',
        reference,
        notes,
      }
    } else if (type === 'record_payment_follow_up') {
      if (!(financeControlAmount > 0) || !financeActionDraft.dueAt) {
        setError('Record a positive receivable amount and the next follow-up date.')
        return
      }
      if (['received', 'written_off'].includes(financeActionDraft.outcome) && !reference) {
        setError('Payment confirmation and write-off requests require a retained reference.')
        return
      }
      const paymentId = financeAction.action.paymentId
      route = paymentId
        ? `/api/ledger/jobs/${encodeURIComponent(jobId)}/payments/${encodeURIComponent(paymentId)}/follow-up`
        : `/api/ledger/jobs/${encodeURIComponent(jobId)}/payments/follow-up`
      body = {
        invoiceId: financeAction.action.invoiceId || null,
        status: financeActionDraft.outcome,
        amount: roundMoney(financeControlAmount),
        nextFollowUpAt: new Date(`${financeActionDraft.dueAt}T23:59:59`).toISOString(),
        followUpChannel: financeActionDraft.followUpChannel,
        reference: reference || null,
        notes,
      }
    } else if (type === 'prepare_finance_handoff') {
      if (!financeActionDraft.targetSystem.trim()) {
        setError('Choose the bookkeeping target for this retained handoff package.')
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/finance-handoffs/prepare`
      body = {
        targetSystem: financeActionDraft.targetSystem.trim(),
        packageType: 'job_finance',
        exportFormat: financeActionDraft.exportFormat,
        notes,
      }
    } else if (type === 'record_time_expense') {
      if (
        !(financeControlHours > 0 || financeControlExpense > 0) ||
        financeControlHours > 24 ||
        financeControlRate < 0 ||
        financeControlExpense < 0
      ) {
        setError('Record positive hours or a positive expense. Hours cannot exceed 24 and the rate cannot be negative.')
        return
      }
      if (financeControlExpense > 0 && !vendor) {
        setError('Record the vendor for retained expense evidence.')
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/finance-costs`
      body = {
        timeLog:
          financeControlHours > 0
            ? {
                workDate: financeActionDraft.dueAt,
                hours: financeControlHours,
                rate: financeControlRate,
                billable: true,
                status: 'submitted',
                costCode: financeActionDraft.costCode.trim() || null,
                notes,
              }
            : {},
        expense:
          financeControlExpense > 0
            ? {
                category: financeActionDraft.category,
                amount: roundMoney(financeControlExpense),
                vendor,
                receiptRef: reference || null,
                status: 'submitted',
                costCode: financeActionDraft.costCode.trim() || null,
                notes,
              }
            : {},
      }
    } else if (type === 'create_budget_line') {
      if (
        !(financeControlAmount > 0) ||
        financeControlForecast < 0 ||
        !financeActionDraft.costCode.trim() ||
        !financeActionDraft.description.trim()
      ) {
        setError('Record a positive budget, a valid forecast, cost code, and description.')
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/budget-lines`
      body = {
        status: 'baseline',
        costCode: financeActionDraft.costCode.trim(),
        description: financeActionDraft.description.trim(),
        category: financeActionDraft.category,
        budgetAmount: roundMoney(financeControlAmount),
        forecastAmount: roundMoney(financeControlForecast || financeControlAmount),
        notes,
      }
    } else if (type === 'create_billing_milestone') {
      const taxRate = Number(financeActionDraft.taxRate)
      if (
        !(financeControlAmount > 0) ||
        !Number.isFinite(taxRate) ||
        taxRate < 0 ||
        taxRate > 100 ||
        !financeActionDraft.description.trim() ||
        !financeActionDraft.plannedIssueAt ||
        !financeActionDraft.dueAt
      ) {
        setError('Record a positive milestone amount, VAT rate, description, planned issue date, and due date.')
        return
      }
      const plannedIssueAt = new Date(`${financeActionDraft.plannedIssueAt}T12:00:00`).toISOString()
      const dueAt = new Date(`${financeActionDraft.dueAt}T23:59:59`).toISOString()
      if (Date.parse(dueAt) < Date.parse(plannedIssueAt)) {
        setError('The milestone due date must be on or after its planned issue date.')
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/billing-milestones`
      body = {
        title: financeActionDraft.description.trim(),
        sequenceNumber: financeAction.action.nextSequenceNumber || undefined,
        amount: roundMoney(financeControlAmount),
        taxRate: roundMoney(taxRate),
        currency: 'EUR',
        plannedIssueAt,
        dueAt,
        notes,
      }
    } else if (type === 'create_draw_request') {
      const percentComplete = Number(financeActionDraft.percentComplete)
      if (
        !(financeControlAmount > 0) ||
        !financeActionDraft.dueAt ||
        !Number.isFinite(percentComplete) ||
        percentComplete < 0 ||
        percentComplete > 100
      ) {
        setError('Record a positive draw amount, due date, and completion percentage from 0 to 100.')
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/draw-requests`
      body = {
        invoiceId: financeAction.action.invoiceId || null,
        status: 'approved',
        title: `${financeAction.item.jobTitle || 'Job'} progress draw`,
        requestedAmount: roundMoney(financeControlAmount),
        percentComplete,
        dueAt: new Date(`${financeActionDraft.dueAt}T23:59:59`).toISOString(),
        notes,
      }
    } else if (type === 'request_lien_waiver') {
      if (!(financeControlAmount > 0) || !vendor || !financeActionDraft.dueAt) {
        setError('Record a positive waiver amount, supplier, and due date.')
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/lien-waivers`
      body = {
        paymentId: financeAction.action.paymentId || null,
        status: 'requested',
        waiverType: financeActionDraft.waiverType,
        amount: roundMoney(financeControlAmount),
        supplier: vendor,
        dueAt: new Date(`${financeActionDraft.dueAt}T23:59:59`).toISOString(),
        notes,
      }
    }

    if (!route) {
      setError('This finance action is not available in the current ledger runtime.')
      return
    }

    setSubmitting(true)
    try {
      const result = await api(route, { method: 'POST', body: JSON.stringify({ ...body, actor: 'office_operator' }) })
      if (type === 'create_credit_note') {
        notify(
          `Credit-note draft retained for ${currency.format(financeCreditTotal)} against ${financeAction.action.invoiceReference || 'the issued invoice'}. Approval and immutable package preparation are required before the receivable changes.`,
        )
      } else if (type === 'record_payment_reconciliation') {
        notify('Payment reconciliation retained for approver review. The invoice balance is unchanged until approval and no funds moved.')
      } else if (type === 'record_supplier_invoice') {
        notify(
          `Supplier invoice ${result.supplierInvoice?.invoiceNumber || ''} retained for ${currency.format(result.supplierInvoice?.total || financeSupplierTotal)}. Match evidence and payable recognition remain approval-gated.`,
        )
      } else if (type === 'record_supplier_payment') {
        notify(
          'Supplier payment evidence retained for approver review. The payable balance is unchanged and Contractor.AI did not move funds.',
        )
      } else if (type === 'record_payment_follow_up') {
        notify(
          result.payment?.approvalId
            ? 'Payment outcome retained for approver confirmation. No funds moved and no client message was sent.'
            : 'Internal payment follow-up retained. No reminder or external message was sent.',
        )
      } else if (type === 'record_time_expense') {
        notify('Time and expense evidence retained atomically in the job ledger.')
      } else if (type === 'create_billing_milestone') {
        notify(
          `Billing milestone retained for ${currency.format(result.billingMilestone?.total || financeControlAmount)}. Approval is required before an invoice can be derived.`,
        )
      } else if (type === 'request_lien_waiver') {
        notify('Internal waiver request retained. No supplier request or release was sent.')
      } else {
        notify(`${FINANCE_ACTION_LABELS[type]} retained for approver review. No export, funding request, or external commitment was made.`)
      }
      closeFinanceControl()
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function prepareClientCloseout(item) {
    if (!item?.jobId || !item.flags?.closeoutReady || item.flags?.approvalRequired) return
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(item.jobId)}/closeout`, {
        method: 'POST',
        body: JSON.stringify({
          markCompleted: false,
          createRecurringPlan: false,
          completionNote: 'Closeout preparation does not change job completion status.',
          actor: 'office_operator',
        }),
      })
      const reused = Object.values(result.closeout?.reused || {}).filter(Boolean).length
      notify(
        reused
          ? 'The existing closeout package was retained without creating duplicates.'
          : 'Closeout package retained. Invoice issue and client handover remain approval-gated; nothing was sent.',
      )
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function prepareClientHandover(item) {
    if (!item?.jobId || !item.nextActions?.some((action) => action.type === 'prepare_handover_package') || item.flags?.approvalRequired)
      return
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(item.jobId)}/handover-packages`, {
        method: 'POST',
        body: JSON.stringify({
          channel: item.clientEmail ? 'email' : 'portal',
          actor: 'office_operator',
        }),
      })
      notify(
        result.package?.replayed
          ? 'The current handover dossier was verified and retained without creating duplicates.'
          : 'Immutable handover dossier retained. Client delivery is a separate approval-gated step.',
      )
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function draftClientFollowup(item) {
    if (!item?.jobId || item.counts?.outboundDrafts || item.flags?.approvalRequired) return
    const selection = item.latest?.selection
    const subject = selection?.title ? `Selection reminder: ${selection.title}` : `Client follow-up: ${item.jobTitle || 'project update'}`
    const body = selection?.title
      ? `Please review the retained options for ${selection.title}. Confirm the preferred selection so planning can continue; no choice has been assumed.`
      : `Please confirm the outstanding decision or reply for ${item.jobTitle || 'this project'}. This is a draft for internal review and has not been sent.`
    setSubmitting(true)
    try {
      await api(`/api/ledger/jobs/${encodeURIComponent(item.jobId)}/communication`, {
        method: 'POST',
        body: JSON.stringify({
          channel: item.clientEmail ? 'email' : 'portal',
          direction: 'outbound',
          subject,
          body,
          expectsReply: true,
          replyBy: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          requiresApproval: true,
          actor: 'office_operator',
        }),
      })
      notify('Client follow-up drafted behind an approval gate. No message was delivered.')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function draftRecurringPlan(item) {
    if (!item?.jobId || item.counts?.recurringPlans || item.flags?.approvalRequired) return
    setSubmitting(true)
    try {
      await api(`/api/ledger/jobs/${encodeURIComponent(item.jobId)}/recurring-plans`, {
        method: 'POST',
        body: JSON.stringify({
          service: item.jobType || 'maintenance',
          status: 'draft',
          intervalRule: 'quarterly',
          nextDueAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
          approvalRequiredBeforeBooking: true,
          notes: 'Internal recurring-service proposal. Scope, price, date, and client acceptance remain uncommitted.',
          actor: 'office_operator',
        }),
      })
      notify('Recurring-service proposal retained as an internal draft. Nothing was booked or offered to the client.')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openClientLifecycle(item, type, recordId) {
    if (!item?.jobId || !recordId) {
      setError('The client action is not linked to a retained lifecycle record.')
      return
    }
    const labels = {
      selection: 'Record client selection',
      punch_item: 'Punch resolution review',
      warranty_claim: 'Warranty resolution review',
      aftercare: 'Complete aftercare follow-up',
    }
    const record = type === 'selection' ? item.latest?.selection : null
    setClientAction({ item, type, recordId, record, label: labels[type] || 'Client lifecycle review' })
    setClientActionNotes('')
    setClientActionOption(record?.data?.selectedOption || record?.options?.[0] || '')
    setClientActionReference('')
  }

  function closeClientLifecycle() {
    setClientAction(null)
    setClientActionNotes('')
    setClientActionOption('')
    setClientActionReference('')
  }

  async function submitClientLifecycle(event) {
    event.preventDefault()
    const notes = clientActionNotes.trim()
    const selectionDecision = clientAction?.type === 'selection'
    if (!clientAction?.item?.jobId || !clientAction.recordId || !notes) {
      setError('Record the evidence or outcome before changing this client lifecycle state.')
      return
    }
    if (selectionDecision && (!clientActionOption || !clientActionReference.trim())) {
      setError('Choose the retained client option and record its confirmation reference.')
      return
    }
    const status = clientAction.type === 'aftercare' ? 'completed' : selectionDecision ? 'selected' : 'resolved'
    const payload = { status, notes, resolution: notes, actor: 'office_operator' }
    if (selectionDecision) {
      payload.selectedOption = clientActionOption
      payload.verificationReference = clientActionReference.trim()
      payload.clientConfirmed = true
      payload.source = 'operator_confirmation'
    }
    setSubmitting(true)
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(clientAction.item.jobId)}/lifecycle/${encodeURIComponent(clientAction.type)}/${encodeURIComponent(clientAction.recordId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        },
      )
      notify(
        result.approvalRequired
          ? `${clientAction.label} retained as a pending approval; the client-facing outcome has not been committed.`
          : 'Aftercare outcome completed in the internal ledger. No client message was sent.',
      )
      closeClientLifecycle()
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function prepareFieldSafetyPack(item) {
    if (!item?.jobId || !item.flags?.safetyGap || item.flags?.approvalRequired) return
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(item.jobId)}/field-assurance-pack`, {
        method: 'POST',
        body: JSON.stringify({ actor: 'office_operator' }),
      })
      const reused = Object.values(result.pack?.reused || {}).filter(Boolean).length
      notify(
        reused
          ? 'Existing safety planning records were retained without duplicates.'
          : 'Internal safety pack retained. It does not grant access, publish evidence, or authorize field work.',
      )
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openDispatchControl(item, action) {
    if (!item?.jobId || !action?.recordId || !action?.recordType) {
      setError('The dispatch control is not linked to a retained lifecycle record.')
      return
    }
    if (action.recordType === 'selection') {
      openClientLifecycle({ ...item, latest: { selection: action.record } }, 'selection', action.recordId)
      return
    }
    if (action.recordType === 'procurement_order') {
      openResourceControl(
        { ...item, inventoryStatus: item.readinessStatus },
        { ...action, type: 'request_procurement_approval', procurementOrderId: action.recordId, label: action.message },
      )
      return
    }
    if (action.recordType === 'material_requirement') {
      openResourceControl(
        { ...item, inventoryStatus: item.readinessStatus, materials: [action.record], latest: { material: action.record } },
        { ...action, type: 'review_material_status', materialRequirementId: action.recordId, label: action.message },
      )
      return
    }
    openFieldReview(item, {
      type: action.recordType,
      recordId: action.recordId,
      record: action.record,
      label: action.actionLabel || 'Resolve design control',
      status: action.targetStatus,
    })
  }

  function reviewDispatchEquipment() {
    setResourceView('equipment')
    setSection('resources')
  }

  function reviewDispatchWorkforce() {
    setResourceView('workforce')
    setSection('resources')
  }

  function openFieldReview(item, target) {
    if (!item?.jobId || !target?.recordId) {
      setError('The assurance action is not linked to a retained ledger record.')
      return
    }
    setFieldAction({ item, ...target })
    setFieldActionNotes('')
    setFieldActionDate(futureDateInput(365))
    setFieldActionReference('')
  }

  function closeFieldReview() {
    setFieldAction(null)
    setFieldActionNotes('')
    setFieldActionDate(futureDateInput(365))
    setFieldActionReference('')
  }

  async function submitFieldReview(event) {
    event.preventDefault()
    const notes = fieldActionNotes.trim()
    if (!fieldAction?.item?.jobId || !fieldAction.recordId || !notes) {
      setError('Record the review evidence before requesting this assurance transition.')
      return
    }
    const requiresDate = ['permit', 'sds'].includes(fieldAction.type)
    const requiresReference = ['sds', 'safety_meeting', 'orientation', 'document'].includes(fieldAction.type)
    const reference = fieldActionReference.trim()
    if (requiresDate && !fieldActionDate) {
      setError(
        fieldAction.type === 'sds'
          ? 'Record the SDS expiry before requesting approval.'
          : 'Record the proposed permit expiry before requesting approval.',
      )
      return
    }
    if (requiresReference && !reference) {
      setError('Record the required attendance or document reference before requesting approval.')
      return
    }
    const payload = {
      status: fieldAction.status,
      notes,
      resolution: notes,
      actor: 'office_operator',
    }
    if (fieldAction.type === 'rfi') payload.response = notes
    if (fieldAction.type === 'permit') payload.expiresAt = new Date(`${fieldActionDate}T23:59:59`).toISOString()
    if (fieldAction.type === 'sds') {
      payload.documentRef = reference
      payload.expiresAt = new Date(`${fieldActionDate}T23:59:59`).toISOString()
    }
    if (fieldAction.type === 'safety_meeting') payload.attendees = reference
    if (fieldAction.type === 'orientation') payload.verificationReference = reference
    if (fieldAction.type === 'document') payload.verificationReference = reference
    if (fieldAction.type === 'inspection') {
      payload.result = 'passed'
      payload.defects = []
    }
    if (fieldAction.type === 'quality_check') {
      payload.result = 'passed'
      payload.defects = []
    }
    setSubmitting(true)
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(fieldAction.item.jobId)}/lifecycle/${encodeURIComponent(fieldAction.type)}/${encodeURIComponent(fieldAction.recordId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        },
      )
      notify(
        result.approvalRequired
          ? `${fieldAction.label} retained for approver review. No field reliance or external commitment was made.`
          : `${fieldAction.label} recorded in the internal ledger.`,
      )
      closeFieldReview()
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function focusFieldCapture(item) {
    if (!item?.jobId) return
    setEvidence((current) => ({ ...current, jobId: item.jobId }))
    window.setTimeout(() => fieldCaptureRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  async function resetQa() {
    if (!window.confirm('Archive Browser QA and demo records after creating a backup?')) return
    setSubmitting(true)
    try {
      const result = await api('/api/operations/reset-qa', {
        method: 'POST',
        body: JSON.stringify({ confirmation: 'RESET_QA', actor: 'office_operator' }),
      })
      notify(`${result.archivedCount} QA/demo record(s) archived or retired. Backup created first.`)
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (authState === 'checking' || authState === 'required') {
    return (
      <AuthenticationScreen checking={authState === 'checking'} error={authError} submitting={authSubmitting} onLogin={loginOperator} />
    )
  }

  const pageTitle = visibleNavItems.find(([key]) => key === section)?.[1] || 'Today'

  return (
    <div className="app-shell">
      <aside className={`side-nav ${mobileNavOpen ? 'side-nav-open' : ''}`} aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark">
            <HardHat size={18} />
          </span>
          <span>Contractor.AI</span>
        </div>
        <div className="nav-list">
          {visibleNavItems.map(([key, label, icon]) => (
            <button
              key={key}
              className={section === key ? 'nav-active' : ''}
              onClick={() => selectSection(key)}
              disabled={initialDataLoading && !['today', 'jobs'].includes(key)}
            >
              {createElement(icon, { size: 18 })}
              {label}
              {key === 'approvals' && metrics.pendingApprovals > 0 ? <b>{metrics.pendingApprovals}</b> : null}
            </button>
          ))}
        </div>
        <div className="nav-footer">
          <CloudOff size={16} />
          <span>Local-first ledger</span>
          <small>External actions require approval</small>
        </div>
      </aside>

      <main className="workspace" aria-busy={loading}>
        <header className="topbar">
          <button className="icon-button mobile-only" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
            <Menu size={20} />
          </button>
          <div>
            <h1>{pageTitle}</h1>
            <p>
              {dashboard
                ? `${metrics.openJobs || 0} active jobs, ${metrics.pendingApprovals || 0} decisions awaiting review`
                : 'Loading the local operating ledger'}
            </p>
          </div>
          <div className="topbar-actions">
            <span className="sync-state">
              <CloudOff size={15} />
              {fieldScoped ? 'Field scope' : 'Local-first'}
            </span>
            {operator.authenticated ? (
              <span className="operator-session" title={formatStatus(operator.role)}>
                <ShieldCheck size={14} />
                <span>{operator.name || formatStatus(operator.role)}</span>
              </span>
            ) : null}
            <button className="icon-button" aria-label="Refresh data" onClick={refresh} disabled={loading}>
              <RefreshCw size={18} className={loading ? 'spin' : ''} />
            </button>
            {operator.authenticated ? (
              <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={logoutOperator} disabled={submitting}>
                <LogOut size={17} />
              </button>
            ) : null}
            {capabilities.intake && capabilities.pipeline ? (
              <button className="primary-button" onClick={() => openOpportunityEditor()} disabled={initialDataLoading}>
                <Plus size={17} />
                New opportunity
              </button>
            ) : null}
          </div>
        </header>

        {notice ? (
          <div className="notice">
            <Check size={16} />
            {notice.message}
            <button aria-label="Dismiss notice" onClick={() => setNotice(null)}>
              <X size={15} />
            </button>
          </div>
        ) : null}
        {error ? (
          <div className="error-banner">
            <TriangleAlert size={18} />
            <span>{error}</span>
            <button onClick={refresh}>Retry</button>
          </div>
        ) : null}

        {loading && !data ? (
          <div className="loading">
            <LoaderCircle className="spin" size={26} />
            Loading the operating ledger
          </div>
        ) : null}
        {data ? (
          <>
            {section === 'today' && (
              <section className="page-grid">
                <div className="metrics-grid">
                  <Metric
                    icon={BriefcaseBusiness}
                    label="Jobs today"
                    value={metrics.openJobs || 0}
                    hint={`${metrics.completedJobs || 0} completed`}
                  />
                  <Metric
                    icon={MapPin}
                    label="Dispatch ready"
                    value={metrics.dispatchReadyJobs || 0}
                    hint="Mobilize when cleared"
                    tone="blue"
                  />
                  <Metric
                    icon={ClipboardCheck}
                    label="Approvals"
                    value={metrics.pendingApprovals || 0}
                    hint="Operator decision required"
                    tone="amber"
                  />
                  <Metric
                    icon={Gauge}
                    label="Weighted pipeline"
                    value={currency.format(dashboard.preconstruction?.summary?.weightedValue || 0)}
                    hint={`${dashboard.preconstruction?.summary?.open || 0} open opportunities`}
                    tone="green"
                  />
                </div>
                <div className="content-grid">
                  <section className="panel command-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>{fieldScoped ? 'My field work' : 'Command queue'}</h2>
                        <p>
                          {fieldScoped ? 'Your assigned ledger jobs and retained field updates' : 'Ranked internal work and approval gates'}
                        </p>
                      </div>
                      {capabilities.approvals ? (
                        <button className="text-button" onClick={() => selectSection('approvals')}>
                          Open approvals <ChevronRight size={15} />
                        </button>
                      ) : null}
                    </div>
                    {nextActions.length ? (
                      <div className="queue-list">
                        {nextActions.map((item, index) => (
                          <div className="queue-row" key={`${item.type}-${item.jobId || index}`}>
                            <span className={`severity severity-${item.severity || 'medium'}`}>
                              <TriangleAlert size={15} />
                            </span>
                            <div>
                              <strong>{item.title || formatStatus(item.type)}</strong>
                              <p>{item.message}</p>
                            </div>
                            {item.requiresApproval ? <span className="tag tag-amber">Approval</span> : <span className="tag">Draft</span>}
                            {item.jobId ? (
                              <button
                                className="icon-button table-action"
                                aria-label={`Open ${item.jobTitle || item.title || 'linked job'}`}
                                onClick={() =>
                                  openJobWorkspace(
                                    jobs.find((job) => job.id === item.jobId) || {
                                      id: item.jobId,
                                      title: item.jobTitle || item.title || 'Ledger job',
                                    },
                                  )
                                }
                              >
                                <ArrowUpRight size={16} />
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty title="Queue is clear" detail="No immediate ledger action needs review." />
                    )}
                  </section>
                  <section className="panel schedule-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Jobs schedule</h2>
                        <p>Live work from the ledger</p>
                      </div>
                      <button className="text-button" onClick={() => selectSection('jobs')}>
                        All jobs <ChevronRight size={15} />
                      </button>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>When</th>
                            <th>Job</th>
                            <th>Location</th>
                            <th>Status</th>
                            <th aria-label="Open job" />
                          </tr>
                        </thead>
                        <tbody>
                          {activeJobs.slice(0, 6).map((job) => (
                            <tr key={job.id}>
                              <td>{formatDate(job.scheduledStart || job.targetCompletion)}</td>
                              <td>
                                <strong>{job.title}</strong>
                                <small>{job.clientName || 'Client pending'}</small>
                              </td>
                              <td>{job.city || job.address || 'Location pending'}</td>
                              <td>
                                <span className={`status status-${job.status}`}>{formatStatus(job.status)}</span>
                              </td>
                              <td>
                                <button
                                  className="icon-button table-action"
                                  aria-label={`Open ${job.title}`}
                                  onClick={() => openJobWorkspace(job)}
                                >
                                  <ArrowUpRight size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
                <div className="bottom-grid">
                  {capabilities.approvals ? (
                    <section className="panel compact-panel">
                      <div className="panel-heading">
                        <h2>Approval queue</h2>
                        <button className="text-button" onClick={() => selectSection('approvals')}>
                          Review all <ChevronRight size={15} />
                        </button>
                      </div>
                      {data.approvals.slice(0, 4).map((item) => (
                        <div className="compact-row" key={item.id}>
                          <ClipboardCheck size={16} />
                          <div>
                            <strong>{item.title || formatStatus(item.targetType)}</strong>
                            <small>{item.jobTitle || item.summary || 'Ledger decision'}</small>
                          </div>
                          <span>{formatDate(item.createdAt)}</span>
                        </div>
                      ))}
                    </section>
                  ) : null}
                  {capabilities.fieldEvidence ? (
                    <section className="panel compact-panel">
                      <div className="panel-heading">
                        <h2>Field evidence</h2>
                        <button className="text-button" onClick={() => selectSection('field')}>
                          Open field <ChevronRight size={15} />
                        </button>
                      </div>
                      <div className="field-summary">
                        <PackageCheck size={26} />
                        <div>
                          <strong>{metrics.storedDocuments || 0} stored records</strong>
                          <p>
                            {metrics.fieldReports || 0} field reports, {metrics.openIncidents || 0} open incidents
                          </p>
                        </div>
                      </div>
                      <button className="secondary-button full-button" onClick={() => selectSection('field')}>
                        <HardHat size={16} />
                        Review field assurance
                      </button>
                    </section>
                  ) : null}
                  {capabilities.maintenance ? (
                    <section className="panel compact-panel">
                      <div className="panel-heading">
                        <h2>Automation</h2>
                        <span className="tag tag-green">Ledger-only</span>
                      </div>
                      <p className="panel-copy">
                        The durable cycle creates internal drafts and approval requests. It cannot send messages, commit spend, or confirm
                        dates.
                      </p>
                      <button className="secondary-button full-button" disabled={submitting} onClick={runCycle}>
                        <Activity size={16} />
                        Run due cycle
                      </button>
                    </section>
                  ) : null}
                </div>
              </section>
            )}

            {section === 'pipeline' && capabilities.pipeline ? (
              <PipelineWorkspace
                opportunities={data.opportunities || EMPTY_LIST}
                forecast={data.opportunityForecast}
                selectedOpportunity={selectedOpportunity}
                canCoordinate={canCoordinate}
                submitting={submitting}
                onCreate={() => openOpportunityEditor()}
                onEdit={openOpportunityEditor}
                onSelect={selectOpportunity}
                onFollowUp={openOpportunityActivity}
                onCompleteActivity={completeOpportunityActivity}
                onConvert={convertOpportunity}
                onOpenJob={openOpportunityJob}
              />
            ) : null}

            {section === 'jobs' && (
              <section className="panel page-panel">
                <div className="panel-heading">
                  <div>
                    <h2>{fieldScoped ? 'My assigned jobs' : 'All jobs'}</h2>
                    <p>
                      {fieldScoped
                        ? 'Only jobs available to your field assignment.'
                        : 'Persisted operational work, ordered by latest update.'}
                    </p>
                  </div>
                  {capabilities.intake ? (
                    <button className="primary-button" onClick={() => setShowIntake(true)}>
                      <Plus size={16} />
                      New job
                    </button>
                  ) : null}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Job</th>
                        <th>Client</th>
                        <th>Location</th>
                        {!fieldScoped ? <th>Value</th> : null}
                        <th>Progress</th>
                        <th>Status</th>
                        <th aria-label="Open job" />
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((job) => (
                        <tr key={job.id}>
                          <td>
                            <strong>{job.title}</strong>
                            <small>{job.jobType}</small>
                          </td>
                          <td>{job.clientName || 'Not set'}</td>
                          <td>{job.city || job.address || 'Not set'}</td>
                          {!fieldScoped ? <td>{currency.format(job.contractValue || job.estimatedCost || 0)}</td> : null}
                          <td>
                            <div className="progress">
                              <span style={{ width: `${Math.min(100, job.progressPercent || 0)}%` }} />
                            </div>
                            <small>{Math.round(job.progressPercent || 0)}%</small>
                          </td>
                          <td>
                            <span className={`status status-${job.status}`}>{formatStatus(job.status)}</span>
                          </td>
                          <td>
                            <button
                              className="icon-button table-action"
                              aria-label={`Open ${job.title}`}
                              onClick={() => openJobWorkspace(job)}
                            >
                              <ArrowUpRight size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {section === 'approvals' && capabilities.approvals && (
              <section className="panel page-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Approval queue</h2>
                    <p>
                      {approvalFocus
                        ? `Focused on the retained decision for ${approvalFocus.jobTitle || 'this job'}.`
                        : 'Review the exact effects and safeguards before resolving a retained decision.'}
                    </p>
                  </div>
                  {approvalFocus ? (
                    <button className="text-button" onClick={() => setApprovalFocus(null)}>
                      Show all approvals <span className="count-badge">{approvals.length}</span>
                    </button>
                  ) : (
                    <span className="count-badge">{approvals.length}</span>
                  )}
                </div>
                {visibleApprovals.length ? (
                  <div className="approval-list">
                    {visibleApprovals.map((item) => (
                      <ApprovalQueueItem key={item.id} item={item} submitting={submitting} onReview={openApprovalReview} />
                    ))}
                  </div>
                ) : (
                  <Empty
                    title={approvalFocus ? 'Decision no longer waiting' : 'No approvals waiting'}
                    detail={
                      approvalFocus
                        ? 'The focused decision was resolved or is no longer pending. Show all approvals to continue reviewing the queue.'
                        : 'The current ledger has no pending consequential decision.'
                    }
                  />
                )}
              </section>
            )}

            {section === 'dispatch' && capabilities.dispatch ? (
              <DispatchWorkspace
                dispatch={data.dispatch}
                jobs={jobs}
                canCoordinate={canCoordinate}
                canApprove={capabilities.approvals === true}
                submitting={submitting}
                onPrepare={prepareDispatchPack}
                onControl={openDispatchControl}
                onReviewWorkforce={reviewDispatchWorkforce}
                onReviewEquipment={reviewDispatchEquipment}
                onOpenApprovals={openApprovals}
                onOpen={openJobWorkspace}
              />
            ) : null}

            {section === 'resources' && capabilities.resources ? (
              <ResourcesWorkspace
                workforce={data.workforce}
                inventory={data.inventory}
                workers={workers}
                workerSummary={data.workerSummary}
                tools={tools}
                toolSummary={data.toolSummary}
                tradePartners={tradePartners}
                tradePartnerSummary={data.tradePartnerSummary}
                jobs={jobs}
                view={resourceView}
                onViewChange={setResourceView}
                canCoordinate={canCoordinate}
                canApprove={capabilities.approvals === true}
                submitting={submitting}
                onPlan={openResourcePlan}
                onDraftInstruction={draftWorkerInstruction}
                onReviewCrewEvidence={reviewCrewEvidence}
                onPrepareLoading={prepareLoadingChecklist}
                onDraftProcurement={draftProcurementOrder}
                onAction={openResourceControl}
                onCreateWorker={() => openWorkerEditor()}
                onEditWorker={openWorkerEditor}
                onRetireWorker={openWorkerRetirement}
                onCreateEquipment={() => openEquipmentEditor()}
                onEditEquipment={openEquipmentEditor}
                onInspectEquipment={openEquipmentInspection}
                onMaintainEquipment={openEquipmentMaintenance}
                onRetireEquipment={openEquipmentRetirement}
                onCreatePartner={() => openTradePartnerEditor()}
                onEditPartner={openTradePartnerEditor}
                onRetirePartner={openTradePartnerRetirement}
                onOpenApprovals={openApprovals}
                onOpen={openJobWorkspace}
              />
            ) : null}

            {section === 'finance' && capabilities.finance ? (
              <FinanceWorkspace
                finance={data.finance}
                jobs={jobs}
                canCoordinate={canCoordinate}
                canApprove={capabilities.approvals === true}
                submitting={submitting}
                onDraftInvoice={openInvoiceDraft}
                onPrepareInvoice={prepareInvoicePackage}
                onAction={openFinanceControl}
                onOpenApprovals={openApprovals}
                onOpen={openJobWorkspace}
              />
            ) : null}

            {section === 'clients' && capabilities.clientSuccess ? (
              <ClientSuccessWorkspace
                clients={data.clients}
                jobs={jobs}
                canCoordinate={canCoordinate}
                canApprove={capabilities.approvals === true}
                submitting={submitting}
                onPrepareCloseout={prepareClientCloseout}
                onPrepareHandover={prepareClientHandover}
                onDraftFollowup={draftClientFollowup}
                onDraftRecurring={draftRecurringPlan}
                onLifecycle={openClientLifecycle}
                onOpenApprovals={openApprovals}
                onOpen={openJobWorkspace}
              />
            ) : null}

            {section === 'field' && capabilities.fieldEvidence && (
              <section className="panel page-panel field-workspace" data-testid="field-workspace" aria-busy={loading || undefined}>
                <div className="panel-heading">
                  <div>
                    <h2>Field updates</h2>
                    <p>Evidence, safety and quality assurance from the operating ledger.</p>
                  </div>
                  <button className="secondary-button" onClick={() => selectSection('jobs')}>
                    <BriefcaseBusiness size={16} />
                    Open jobs
                  </button>
                </div>
                {!fieldScoped ? (
                  <FieldAssuranceWorkspace
                    field={data.field}
                    jobs={jobs}
                    canCoordinate={canCoordinate}
                    canApprove={capabilities.approvals === true}
                    submitting={submitting}
                    onPrepareSafety={prepareFieldSafetyPack}
                    onReview={openFieldReview}
                    onCapture={focusFieldCapture}
                    onOpenApprovals={openApprovals}
                    onOpen={openJobWorkspace}
                  />
                ) : null}
                <div className="field-grid">
                  <Metric icon={FolderArchive} label="Evidence stored" value={metrics.storedDocuments || 0} hint="Photos and documents" />
                  <Metric
                    icon={TriangleAlert}
                    label="Open incidents"
                    value={metrics.openIncidents || 0}
                    hint="Require a review"
                    tone="amber"
                  />
                  <Metric
                    icon={ShieldCheck}
                    label="Safety checks"
                    value={metrics.safetyChecks || 0}
                    hint="Ledger safety controls"
                    tone="green"
                  />
                </div>
                <div className="field-note">
                  <HardHat size={20} />
                  <div>
                    <strong>Field records remain local and auditable.</strong>
                    <p>
                      Evidence, progress, time, and daily safety records use a bounded offline outbox. Exact retries are scoped to this
                      operator and cannot create duplicate ledger entries.
                    </p>
                  </div>
                  <div className="field-outbox-status" aria-live="polite">
                    {outboxPending ? (
                      <span className="tag tag-amber">{outboxPending} queued</span>
                    ) : (
                      <span className="tag tag-green">Outbox clear</span>
                    )}
                    {outboxQuarantined ? <span className="tag">{outboxQuarantined} other scope</span> : null}
                  </div>
                </div>
                <form className="evidence-form daily-site-log" data-testid="daily-site-log-form" onSubmit={recordFieldDailyLog}>
                  <div className="panel-heading">
                    <div>
                      <h2>Daily site log</h2>
                      <p>Submit the site report, crew time card, and safety state as one retained ledger entry.</p>
                    </div>
                    {fieldScoped && operator.worker?.name ? <span className="tag tag-green">{operator.worker.name}</span> : null}
                  </div>
                  <div className="form-grid">
                    <label>
                      Job
                      <select
                        required
                        value={fieldDailyLog.jobId}
                        onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, jobId: event.target.value })}
                      >
                        <option value="">Select an active job</option>
                        {activeJobs.map((job) => (
                          <option key={job.id} value={job.id}>
                            {job.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!fieldScoped ? (
                      <label>
                        Crew member
                        <select
                          required
                          value={fieldDailyLog.workerId}
                          onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, workerId: event.target.value })}
                        >
                          <option value="">Select a crew member</option>
                          {workers
                            .filter((worker) => !['retired', 'inactive'].includes(worker.status))
                            .map((worker) => (
                              <option key={worker.id} value={worker.id}>
                                {worker.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : null}
                    <label>
                      Work date
                      <input
                        required
                        type="date"
                        value={fieldDailyLog.workDate}
                        onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, workDate: event.target.value })}
                      />
                    </label>
                    <label>
                      Hours worked
                      <input
                        required
                        type="number"
                        min="0.25"
                        max="24"
                        step="0.25"
                        inputMode="decimal"
                        value={fieldDailyLog.hours}
                        onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, hours: event.target.value })}
                      />
                    </label>
                    <label>
                      People on site
                      <input
                        required
                        type="number"
                        min="1"
                        max="500"
                        step="1"
                        inputMode="numeric"
                        value={fieldDailyLog.manpower}
                        onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, manpower: event.target.value })}
                      />
                    </label>
                    <label>
                      Weather
                      <select
                        value={fieldDailyLog.weather}
                        onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, weather: event.target.value })}
                      >
                        <option value="clear">Clear</option>
                        <option value="cloudy">Cloudy</option>
                        <option value="rain">Rain</option>
                        <option value="wind">High wind</option>
                        <option value="heat">Heat</option>
                        <option value="cold">Cold</option>
                      </select>
                    </label>
                    <label className="form-span">
                      Work completed
                      <textarea
                        required
                        minLength="3"
                        value={fieldDailyLog.workCompleted}
                        onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, workCompleted: event.target.value })}
                        placeholder="Record the work completed during this shift."
                      />
                    </label>
                    <label className="form-span">
                      Blockers or follow-up
                      <textarea
                        value={fieldDailyLog.blockers}
                        onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, blockers: event.target.value })}
                        placeholder="One blocker or follow-up per line."
                      />
                    </label>
                    <label className="form-span checkbox-label">
                      <input
                        type="checkbox"
                        checked={fieldDailyLog.safetyConcern}
                        onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, safetyConcern: event.target.checked })}
                      />
                      A safety concern requires office review
                    </label>
                    {fieldDailyLog.safetyConcern ? (
                      <>
                        <label>
                          Risk level
                          <select
                            value={fieldDailyLog.safetyRiskLevel}
                            onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, safetyRiskLevel: event.target.value })}
                          >
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="critical">Critical</option>
                          </select>
                        </label>
                        <label className="form-span">
                          Safety concern
                          <textarea
                            required
                            minLength="5"
                            value={fieldDailyLog.safetyNotes}
                            onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, safetyNotes: event.target.value })}
                            placeholder="Describe the hazard, immediate control, and required follow-up."
                          />
                        </label>
                      </>
                    ) : null}
                  </div>
                  <div className="modal-actions">
                    <button className="primary-button" disabled={submitting}>
                      <ClipboardList size={16} />
                      {submitting ? 'Submitting...' : navigator.onLine === false ? 'Save daily log offline' : 'Submit daily log'}
                    </button>
                  </div>
                </form>
                <form ref={fieldCaptureRef} className="evidence-form" data-testid="field-evidence-form" onSubmit={uploadEvidence}>
                  <div className="panel-heading">
                    <div>
                      <h2>Record field evidence</h2>
                      <p>Photos, PDFs, and DOCX files remain behind authenticated ledger access.</p>
                    </div>
                    {outboxPending ? <span className="tag tag-amber">{outboxPending} queued</span> : null}
                  </div>
                  <div className="form-grid">
                    <label>
                      Job
                      <select required value={evidence.jobId} onChange={(event) => setEvidence({ ...evidence, jobId: event.target.value })}>
                        <option value="">Select an active job</option>
                        {activeJobs.map((job) => (
                          <option key={job.id} value={job.id}>
                            {job.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Risk level
                      <select value={evidence.riskLevel} onChange={(event) => setEvidence({ ...evidence, riskLevel: event.target.value })}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </label>
                    <label className="form-span">
                      Evidence file
                      <input
                        ref={evidenceInputRef}
                        required
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      />
                    </label>
                    <label className="form-span">
                      Site note
                      <textarea
                        value={evidence.notes}
                        onChange={(event) => setEvidence({ ...evidence, notes: event.target.value })}
                        placeholder="Describe what this file proves, what changed, or what needs review."
                      />
                    </label>
                  </div>
                  <div className="modal-actions">
                    {outboxPending ? (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={outboxSyncing || submitting || navigator.onLine === false}
                        onClick={() => syncFieldOutbox({ announce: true })}
                      >
                        <RefreshCw size={16} className={outboxSyncing ? 'spin' : ''} />
                        {outboxSyncing ? 'Syncing...' : `Sync ${outboxPending} queued`}
                      </button>
                    ) : null}
                    <button className="primary-button" disabled={submitting}>
                      <FileUp size={16} />
                      {submitting ? 'Recording...' : navigator.onLine === false ? 'Save offline draft' : 'Record evidence'}
                    </button>
                  </div>
                </form>
                <form className="evidence-form" data-testid="field-progress-form" onSubmit={recordFieldProgress}>
                  <div className="panel-heading">
                    <div>
                      <h2>Record progress</h2>
                      <p>Field updates stay auditable. Completing a job remains an office-controlled decision.</p>
                    </div>
                  </div>
                  <div className="form-grid">
                    <label>
                      Job
                      <select
                        required
                        value={fieldProgress.jobId}
                        onChange={(event) => setFieldProgress({ ...fieldProgress, jobId: event.target.value })}
                      >
                        <option value="">Select an active job</option>
                        {activeJobs.map((job) => (
                          <option key={job.id} value={job.id}>
                            {job.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Work state
                      <select
                        value={fieldProgress.status}
                        onChange={(event) => setFieldProgress({ ...fieldProgress, status: event.target.value })}
                      >
                        <option value="in_progress">In progress</option>
                        <option value="blocked">Blocked</option>
                        <option value="on_hold">On hold</option>
                      </select>
                    </label>
                    <label>
                      Progress (%)
                      <input
                        required
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={fieldProgress.progressPercent}
                        onChange={(event) => setFieldProgress({ ...fieldProgress, progressPercent: event.target.value })}
                      />
                    </label>
                    <label className="form-span">
                      Field note
                      <textarea
                        required
                        value={fieldProgress.note}
                        onChange={(event) => setFieldProgress({ ...fieldProgress, note: event.target.value })}
                        placeholder="Record completed work, blocker, or site condition for the office team."
                      />
                    </label>
                  </div>
                  <div className="modal-actions">
                    <button className="primary-button" disabled={submitting}>
                      <Activity size={16} />
                      {submitting ? 'Recording...' : navigator.onLine === false ? 'Save progress offline' : 'Record progress'}
                    </button>
                  </div>
                </form>
              </section>
            )}

            {section === 'operations' && capabilities.maintenance && (
              <section className="operations-grid">
                <section className="panel page-panel organization-profile-panel" data-testid="organization-profile-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Business identity</h2>
                      <p>The legal, electronic, and payment details captured in controlled quote and invoice packages.</p>
                    </div>
                    <span className={`status ${data.organization?.readiness?.ready ? 'status-ready' : 'status-attention'}`}>
                      {data.organization?.readiness?.ready ? 'issue ready' : 'incomplete'}
                    </span>
                  </div>
                  <form onSubmit={saveOrganizationProfile}>
                    <div className="form-grid organization-profile-form">
                      <label>
                        Legal name
                        <input
                          value={organizationProfileDraft.legalName}
                          onChange={(event) => setOrganizationProfileDraft({ ...organizationProfileDraft, legalName: event.target.value })}
                        />
                      </label>
                      <label>
                        Trading name
                        <input
                          value={organizationProfileDraft.tradingName}
                          onChange={(event) =>
                            setOrganizationProfileDraft({ ...organizationProfileDraft, tradingName: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Registration number
                        <input
                          value={organizationProfileDraft.registrationNumber}
                          onChange={(event) =>
                            setOrganizationProfileDraft({ ...organizationProfileDraft, registrationNumber: event.target.value })
                          }
                          placeholder="KVK or national registry number"
                        />
                      </label>
                      <label>
                        Electronic address scheme
                        <input
                          value={organizationProfileDraft.electronicAddressScheme}
                          onChange={(event) =>
                            setOrganizationProfileDraft({ ...organizationProfileDraft, electronicAddressScheme: event.target.value })
                          }
                          placeholder="0106 for KVK"
                        />
                      </label>
                      <label>
                        Electronic address
                        <input
                          value={organizationProfileDraft.electronicAddress}
                          onChange={(event) =>
                            setOrganizationProfileDraft({ ...organizationProfileDraft, electronicAddress: event.target.value })
                          }
                          placeholder="Defaults to KVK for Dutch entities"
                        />
                      </label>
                      <label>
                        VAT number
                        <input
                          disabled={organizationProfileDraft.vatExempt}
                          value={organizationProfileDraft.vatNumber}
                          onChange={(event) => setOrganizationProfileDraft({ ...organizationProfileDraft, vatNumber: event.target.value })}
                        />
                      </label>
                      <label className="checkbox-label form-span">
                        <input
                          type="checkbox"
                          checked={organizationProfileDraft.vatExempt}
                          onChange={(event) =>
                            setOrganizationProfileDraft({
                              ...organizationProfileDraft,
                              vatExempt: event.target.checked,
                              vatNumber: event.target.checked ? '' : organizationProfileDraft.vatNumber,
                            })
                          }
                        />
                        This legal entity is VAT exempt
                      </label>
                      <label>
                        Email
                        <input
                          type="email"
                          value={organizationProfileDraft.email}
                          onChange={(event) => setOrganizationProfileDraft({ ...organizationProfileDraft, email: event.target.value })}
                        />
                      </label>
                      <label>
                        Phone
                        <input
                          value={organizationProfileDraft.phone}
                          onChange={(event) => setOrganizationProfileDraft({ ...organizationProfileDraft, phone: event.target.value })}
                        />
                      </label>
                      <label className="form-span">
                        Website
                        <input
                          type="url"
                          value={organizationProfileDraft.website}
                          onChange={(event) => setOrganizationProfileDraft({ ...organizationProfileDraft, website: event.target.value })}
                          placeholder="https://"
                        />
                      </label>
                      <label className="form-span">
                        Registered address
                        <input
                          value={organizationProfileDraft.address}
                          onChange={(event) => setOrganizationProfileDraft({ ...organizationProfileDraft, address: event.target.value })}
                        />
                      </label>
                      <label>
                        Postal code
                        <input
                          value={organizationProfileDraft.postalCode}
                          onChange={(event) => setOrganizationProfileDraft({ ...organizationProfileDraft, postalCode: event.target.value })}
                        />
                      </label>
                      <label>
                        City
                        <input
                          value={organizationProfileDraft.city}
                          onChange={(event) => setOrganizationProfileDraft({ ...organizationProfileDraft, city: event.target.value })}
                        />
                      </label>
                      <label>
                        Country code
                        <input
                          required
                          maxLength="2"
                          value={organizationProfileDraft.country}
                          onChange={(event) =>
                            setOrganizationProfileDraft({ ...organizationProfileDraft, country: event.target.value.toUpperCase() })
                          }
                        />
                      </label>
                      <label>
                        IBAN
                        <input
                          value={organizationProfileDraft.iban}
                          onChange={(event) => setOrganizationProfileDraft({ ...organizationProfileDraft, iban: event.target.value })}
                        />
                      </label>
                      <label>
                        BIC
                        <input
                          value={organizationProfileDraft.bic}
                          onChange={(event) => setOrganizationProfileDraft({ ...organizationProfileDraft, bic: event.target.value })}
                        />
                      </label>
                      <label>
                        Payment terms (days)
                        <input
                          required
                          type="number"
                          min="1"
                          max="365"
                          value={organizationProfileDraft.defaultPaymentTermsDays}
                          onChange={(event) =>
                            setOrganizationProfileDraft({ ...organizationProfileDraft, defaultPaymentTermsDays: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Quote validity default (days)
                        <input
                          required
                          type="number"
                          min="1"
                          max="365"
                          value={organizationProfileDraft.defaultQuoteValidityDays}
                          onChange={(event) =>
                            setOrganizationProfileDraft({ ...organizationProfileDraft, defaultQuoteValidityDays: event.target.value })
                          }
                        />
                      </label>
                      <label className="form-span">
                        Quote terms
                        <textarea
                          value={organizationProfileDraft.quoteTerms}
                          onChange={(event) => setOrganizationProfileDraft({ ...organizationProfileDraft, quoteTerms: event.target.value })}
                          placeholder="Commercial terms shown on every new issue package."
                        />
                      </label>
                      <label className="form-span">
                        Internal notes
                        <textarea
                          value={organizationProfileDraft.notes}
                          onChange={(event) => setOrganizationProfileDraft({ ...organizationProfileDraft, notes: event.target.value })}
                        />
                      </label>
                    </div>
                    {data.organization?.readiness?.missing?.length ? (
                      <p className="organization-profile-missing">
                        <TriangleAlert size={15} />
                        Required before quote issue: {data.organization.readiness.missing.map((item) => item.label).join(', ')}.
                      </p>
                    ) : (
                      <p className="organization-profile-ready">
                        <ShieldCheck size={15} />
                        Identity is ready. Each package still requires an internally approved quote and a separate delivery approval.
                      </p>
                    )}
                    <div className="modal-actions">
                      <button className="primary-button" disabled={submitting}>
                        <Building2 size={16} />
                        {submitting ? 'Saving...' : 'Save business identity'}
                      </button>
                    </div>
                  </form>
                </section>
                <AutomationControl
                  commandPlan={data.commandPlan}
                  scheduler={data.scheduler}
                  jobs={jobs}
                  view={commandPlanView}
                  selectedIds={selectedCommandIds}
                  submitting={submitting}
                  onViewChange={setCommandPlanView}
                  onToggle={toggleCommandSelection}
                  onSelectVisible={setSelectedCommandIds}
                  onApply={applySelectedCommands}
                  onRun={runCycle}
                  onOpenApprovals={openApprovals}
                  onOpen={openJobWorkspace}
                />
                <section className="panel page-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Runtime readiness</h2>
                      <p>Local-first operational health and EU-hosting prerequisites.</p>
                    </div>
                    <span className={`status ${data.readiness?.status === 'ready' ? 'status-ready' : 'status-attention'}`}>
                      {data.readiness?.status || 'local ready'}
                    </span>
                  </div>
                  <div className="readiness-list">
                    <div>
                      <span>Runtime</span>
                      <strong>{data.health.runtime?.mode || 'local'}</strong>
                    </div>
                    <div data-testid="storage-readiness">
                      <span>Storage</span>
                      <strong>{evidenceStorageLabel}</strong>
                    </div>
                    <div>
                      <span>Authorization</span>
                      <strong>
                        {data.health.runtime?.auth?.configuredRoles?.length
                          ? data.health.runtime.auth.configuredRoles.join(', ')
                          : data.health.runtime?.auth?.legacyOwnerTokenConfigured
                            ? 'owner token'
                            : 'local owner'}
                      </strong>
                    </div>
                    <div data-testid="login-defense-readiness">
                      <span>Login defense</span>
                      <strong>{loginDefenseLabel}</strong>
                    </div>
                    <div data-testid="api-defense-readiness">
                      <span>API defense</span>
                      <strong>{apiDefenseLabel}</strong>
                    </div>
                    <div data-testid="audit-integrity-readiness">
                      <span>Audit integrity</span>
                      <strong>{auditIntegrityLabel}</strong>
                    </div>
                    <div>
                      <span>Scheduler</span>
                      <strong>{data.scheduler?.enabled ? `every ${data.scheduler.intervalSeconds}s` : 'manual only'}</strong>
                    </div>
                    <div>
                      <span>Field retries</span>
                      <strong>
                        {operationCapabilities?.requestSafety?.evidenceUploadIdempotency === 'durable' &&
                        operationCapabilities?.requestSafety?.progressEntryKey === 'durable' &&
                        operationCapabilities?.requestSafety?.dailyLogEntryKey === 'durable'
                          ? 'scoped + deduplicated'
                          : 'checking'}
                      </strong>
                    </div>
                    <div>
                      <span>Backups</span>
                      <strong>
                        {operationCapabilities?.backup?.portableDownload
                          ? 'verified + portable'
                          : providerRecovery?.available
                            ? 'provider-managed'
                            : operationCapabilities
                              ? 'unavailable'
                              : 'checking'}
                      </strong>
                    </div>
                    <div>
                      <span>EU migration</span>
                      <strong>
                        {operationCapabilities?.hostedMigration?.available
                          ? 'backup to hosted'
                          : operationCapabilities
                            ? 'provider recovery'
                            : 'checking'}
                      </strong>
                    </div>
                    <div>
                      <span>Recovery</span>
                      <strong>{recoveryLabel}</strong>
                    </div>
                    <div>
                      <span>Data residency</span>
                      <strong>{data.health.runtime?.hosting?.dataResidency || 'local'}</strong>
                    </div>
                    <div>
                      <span>DPA</span>
                      <strong>
                        {data.health.runtime?.mode === 'hosted'
                          ? data.health.runtime?.hosting?.dpaConfigured
                            ? 'configured'
                            : 'attention'
                          : 'not applicable'}
                      </strong>
                    </div>
                    <div>
                      <span>Ledger</span>
                      <strong>{data.health.services.ledger}</strong>
                    </div>
                    <div>
                      <span>Diagnostics</span>
                      <strong>{data.health.diagnostics.issueCount} issue(s)</strong>
                    </div>
                  </div>
                  <p className="panel-copy">
                    Hosted mode fails closed until EU object storage, managed PostgreSQL, HTTPS, authentication, DPA, residency, and
                    recovery declarations are ready.
                  </p>
                </section>
                <section className="panel page-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Data safety</h2>
                      <p>
                        {localBackupAvailable
                          ? 'Create a verified recovery package before operational maintenance.'
                          : 'Hosted recovery is controlled by the configured provider policy.'}
                      </p>
                    </div>
                  </div>
                  <div className="operations-actions">
                    <a className="secondary-button" href="/api/operations/export">
                      <FileDown size={16} />
                      Export ledger
                    </a>
                    <button
                      className="secondary-button"
                      disabled={submitting || !localBackupAvailable}
                      title={localBackupAvailable ? 'Create verified local backup' : 'Hosted backups are provider-managed'}
                      onClick={backup}
                    >
                      <FolderArchive size={16} />
                      Create backup
                    </button>
                    <input
                      ref={exportInputRef}
                      className="visually-hidden"
                      type="file"
                      accept="application/json"
                      onChange={(event) => validateExport(event.target.files?.[0])}
                    />
                    <button
                      className="secondary-button"
                      disabled={submitting || !exportValidationAvailable}
                      title="Verify the checksum of a human-readable ledger export"
                      onClick={() => exportInputRef.current?.click()}
                    >
                      <FileUp size={16} />
                      Validate export
                    </button>
                    <button
                      className="danger-button"
                      disabled={submitting || !localBackupAvailable}
                      title={
                        localBackupAvailable ? 'Archive QA records after backup' : 'Hosted maintenance requires a provider recovery point'
                      }
                      onClick={resetQa}
                    >
                      <Archive size={16} />
                      Archive QA records
                    </button>
                  </div>
                  <p className="panel-copy">
                    The JSON export is a checksummed, human-readable reconciliation record. It cannot restore the database or evidence
                    files.
                  </p>
                  {data.backups?.length ? (
                    <div className="backup-list">
                      {data.backups.slice(0, 5).map((backup) => (
                        <div className="compact-row" key={backup.backupId}>
                          <FolderArchive size={16} />
                          <div>
                            <strong>{formatDate(backup.createdAt)}</strong>
                            <small>
                              {backup.databaseMode} / {backup.files} protected file(s) / {backup.evidenceFiles || 0} evidence
                            </small>
                          </div>
                          <span className="backup-actions">
                            <button
                              className="secondary-button"
                              title="Verify file checksums and SQLite restore readiness"
                              disabled={submitting || backup.manifestStatus === 'unreadable'}
                              onClick={() => verifyBackup(backup.backupId)}
                            >
                              <ShieldCheck size={15} />
                              Check restore
                            </button>
                            {backup.downloadAvailable ? (
                              <a
                                className="secondary-button"
                                href={`/api/operations/backups/${encodeURIComponent(backup.backupId)}/download`}
                                download
                              >
                                <FileDown size={15} />
                                Download
                              </a>
                            ) : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="panel-copy">
                      {localBackupAvailable ? 'No controlled local backup has been created yet.' : `Provider recovery: ${recoveryLabel}.`}
                    </p>
                  )}
                  <p className="panel-copy">
                    {localBackupAvailable
                      ? 'Local backup v2 is the recovery artifact: it retains the SQLite ledger and private evidence with checksums. Download it to encrypted off-device storage; restore it only while the application is stopped.'
                      : 'Application-local packages are disabled in hosted mode because they cannot contain managed PostgreSQL and private object-store data.'}
                  </p>
                </section>
                <AuditHistory totalEvents={auditIntegrityCapability?.eventCount || 0} />
                <section className="panel page-panel archive-registry-panel" data-testid="job-archive-registry">
                  <div className="panel-heading">
                    <div>
                      <h2>Archived jobs</h2>
                      <p>Retained work removed from active operations, with approval-gated restore.</p>
                    </div>
                    <span className="count-badge">{archivedJobs.length}</span>
                  </div>
                  {archivedJobs.length ? (
                    <div className="archive-registry-list">
                      {archivedJobs.map((job) => {
                        const pendingRestore = approvals.find(
                          (approval) => approval.jobId === job.id && approval.targetType === 'job_restore',
                        )
                        return (
                          <div className="archive-registry-row" key={job.id}>
                            <span className="archive-registry-icon">
                              <Archive size={16} />
                            </span>
                            <div className="archive-registry-copy">
                              <strong>{job.title}</strong>
                              <small>
                                {job.clientName || 'Client pending'} · archived {formatDate(job.data?.archive?.approvedAt || job.updatedAt)}{' '}
                                · from {formatStatus(job.data?.archive?.previousStatus || 'retained state')}
                              </small>
                              {job.data?.archive?.reason ? <p>{job.data.archive.reason}</p> : null}
                            </div>
                            <button
                              className="secondary-button"
                              disabled={submitting || Boolean(pendingRestore)}
                              onClick={() => openJobLifecycle('restore', job)}
                            >
                              <RefreshCw size={15} />
                              {pendingRestore ? 'Restore pending' : 'Request restore'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <Empty title="No archived jobs" detail="Approved archives will remain available here for controlled restore." />
                  )}
                </section>
              </section>
            )}
          </>
        ) : null}
      </main>

      {jobLifecycleAction ? (
        <div className="modal-backdrop job-lifecycle-backdrop" role="presentation">
          <section
            className="modal job-lifecycle-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="job-lifecycle-title"
            data-testid="job-lifecycle-modal"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Approval-gated lifecycle</p>
                <h2 id="job-lifecycle-title">{jobLifecycleAction.mode === 'archive' ? 'Request job archive' : 'Request job restore'}</h2>
                <p>
                  {jobLifecycleAction.job.title} · {jobLifecycleAction.job.clientName || 'Client record'}
                </p>
              </div>
              <button className="icon-button" aria-label="Close job lifecycle request" onClick={closeJobLifecycle}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitJobLifecycle}>
              <div className="job-lifecycle-body">
                <div className="job-lifecycle-effect">
                  <Archive size={20} />
                  <div>
                    <strong>
                      {jobLifecycleAction.mode === 'archive'
                        ? 'Remove from active operations'
                        : `Return to ${formatStatus(jobLifecycleAction.job.data?.archive?.previousStatus || 'retained state')}`}
                    </strong>
                    <p>
                      {jobLifecycleAction.mode === 'archive'
                        ? 'Schedules, queues, conflicts, automation, and rollups stop including this job only after approval.'
                        : 'Applicable internal queues include the job again only after approval and current operating checks still apply.'}
                    </p>
                  </div>
                </div>
                <ul className="job-lifecycle-safeguards">
                  <li>The complete job ledger, evidence, finance, field, client, resource, and audit history remains retained.</li>
                  <li>No message, cancellation, supplier order, payment, safety clearance, or schedule commitment is triggered.</li>
                  {jobLifecycleAction.mode === 'archive' ? (
                    <li>Approval makes the job read-only and revokes active client portal links. Restore never reactivates those links.</li>
                  ) : null}
                  <li>
                    {jobLifecycleAction.mode === 'archive'
                      ? 'Returning the job later requires a separate restore approval.'
                      : 'The archive and restore decisions remain visible in the audit history.'}
                  </li>
                </ul>
                <label>
                  Operational reason
                  <textarea
                    required
                    minLength="8"
                    value={jobLifecycleReason}
                    onChange={(event) => setJobLifecycleReason(event.target.value)}
                    placeholder={
                      jobLifecycleAction.mode === 'archive'
                        ? 'Explain why this job should leave active operations.'
                        : 'Explain why this retained job should return to operations.'
                    }
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeJobLifecycle}>
                  Cancel
                </button>
                <button
                  className={jobLifecycleAction.mode === 'archive' ? 'danger-button' : 'primary-button'}
                  disabled={submitting || jobLifecycleReason.trim().length < 8}
                >
                  {jobLifecycleAction.mode === 'archive' ? <Archive size={16} /> : <RefreshCw size={16} />}
                  {submitting
                    ? 'Submitting...'
                    : jobLifecycleAction.mode === 'archive'
                      ? 'Request archive approval'
                      : 'Request restore approval'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {workerEditor ? (
        <div className="modal-backdrop worker-backdrop" role="presentation">
          <section
            className="modal worker-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="worker-editor-title"
            data-testid="worker-editor"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeWorkerEditor()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Retained crew record</p>
                <h2 id="worker-editor-title">{workerDraft.id ? `Edit ${workerDraft.name || 'crew member'}` : 'Add crew member'}</h2>
                <p>Identity, availability, skills, and internal cost evidence for resource planning.</p>
              </div>
              <button className="icon-button" aria-label="Close crew member editor" onClick={closeWorkerEditor}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={saveWorker}>
              <div className="form-grid worker-form">
                <label className="form-span">
                  Full name
                  <input
                    autoFocus
                    required
                    minLength="2"
                    value={workerDraft.name}
                    onChange={(event) => setWorkerDraft({ ...workerDraft, name: event.target.value })}
                  />
                </label>
                <label>
                  Role or trade
                  <input
                    value={workerDraft.role}
                    onChange={(event) => setWorkerDraft({ ...workerDraft, role: event.target.value })}
                    placeholder="Carpenter, site lead, electrician"
                  />
                </label>
                <label>
                  Availability status
                  <select value={workerDraft.status} onChange={(event) => setWorkerDraft({ ...workerDraft, status: event.target.value })}>
                    <option value="available">Available</option>
                    <option value="busy">Busy</option>
                    <option value="traveling">Traveling</option>
                    <option value="offline">Offline</option>
                    <option value="on_leave">On leave</option>
                    <option value="on_hold">On hold</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={workerDraft.email}
                    onChange={(event) => setWorkerDraft({ ...workerDraft, email: event.target.value })}
                  />
                </label>
                <label>
                  Phone
                  <input value={workerDraft.phone} onChange={(event) => setWorkerDraft({ ...workerDraft, phone: event.target.value })} />
                </label>
                <label>
                  Home region
                  <input
                    value={workerDraft.homeRegion}
                    onChange={(event) => setWorkerDraft({ ...workerDraft, homeRegion: event.target.value })}
                    placeholder="Utrecht, Randstad, Noord-Brabant"
                  />
                </label>
                <label>
                  Hourly cost rate (EUR)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={workerDraft.hourlyRate}
                    onChange={(event) => setWorkerDraft({ ...workerDraft, hourlyRate: event.target.value })}
                  />
                </label>
                <label className="form-span">
                  Skills
                  <input
                    value={workerDraft.skills}
                    onChange={(event) => setWorkerDraft({ ...workerDraft, skills: event.target.value })}
                    placeholder="Carpentry, renovation, VCA"
                  />
                </label>
                <label className="form-span">
                  Internal notes
                  <textarea
                    value={workerDraft.notes}
                    onChange={(event) => setWorkerDraft({ ...workerDraft, notes: event.target.value })}
                    placeholder="Record restrictions, qualifications, or resource planning context."
                  />
                </label>
                <p className="workflow-note form-span">
                  Saving this record does not contact the crew member, submit payroll, clear site access, or commit a schedule.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeWorkerEditor}>
                  Cancel
                </button>
                <button
                  className="primary-button"
                  disabled={
                    submitting ||
                    workerDraft.name.trim().length < 2 ||
                    (workerDraft.hourlyRate !== '' && Number(workerDraft.hourlyRate) < 0)
                  }
                >
                  <ShieldCheck size={16} />
                  {submitting ? 'Saving...' : 'Save retained crew member'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {workerRetirement ? (
        <div className="modal-backdrop worker-backdrop" role="presentation">
          <section
            className="modal worker-retirement-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="worker-retirement-title"
            data-testid="worker-retirement-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeWorkerRetirement()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Approval-gated lifecycle</p>
                <h2 id="worker-retirement-title">Request crew retirement</h2>
                <p>
                  {workerRetirement.name} / {workerRetirement.role || 'Role not retained'}
                </p>
              </div>
              <button className="icon-button" aria-label="Close crew retirement request" onClick={closeWorkerRetirement}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={requestWorkerRetirement}>
              <div className="job-lifecycle-body">
                <div className="job-lifecycle-effect">
                  <Archive size={20} />
                  <div>
                    <strong>Block this crew member from new assignments</strong>
                    <p>
                      The retained status changes to retired only after approval and after all operational assignments have been released or
                      reassigned.
                    </p>
                  </div>
                </div>
                <ul className="job-lifecycle-safeguards">
                  <li>The complete crew, assignment, time, approval, and audit history remains retained.</li>
                  <li>New assignments are blocked as soon as this request enters the approval queue.</li>
                  <li>
                    {workerRetirement.activeAssignmentCount > 0
                      ? `Approval cannot complete while ${workerRetirement.activeAssignmentCount} operational assignment${workerRetirement.activeAssignmentCount === 1 ? '' : 's'} remain.`
                      : 'No operational assignments currently block this retirement.'}
                  </li>
                  {workerRetirement.dormantAssignmentCount > 0 ? (
                    <li>
                      Approval will release {workerRetirement.dormantAssignmentCount} dormant assignment
                      {workerRetirement.dormantAssignmentCount === 1 ? '' : 's'} retained on inactive jobs, so any later job restore
                      requires reassignment.
                    </li>
                  ) : null}
                  <li>No crew member, client, payroll provider, or site contact is notified.</li>
                </ul>
                <label>
                  Operational reason
                  <textarea
                    autoFocus
                    required
                    minLength="8"
                    value={workerRetirementReason}
                    onChange={(event) => setWorkerRetirementReason(event.target.value)}
                    placeholder="Explain why this person should no longer be selected for new work."
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeWorkerRetirement}>
                  Cancel
                </button>
                <button className="danger-button" disabled={submitting || workerRetirementReason.trim().length < 8}>
                  <Archive size={16} />
                  {submitting ? 'Submitting...' : 'Request retirement approval'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {equipmentEditor ? (
        <div className="modal-backdrop equipment-backdrop" role="presentation">
          <section
            className="modal equipment-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="equipment-editor-title"
            data-testid="equipment-editor"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeEquipmentEditor()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Retained equipment record</p>
                <h2 id="equipment-editor-title">{equipmentDraft.id ? `Edit ${equipmentDraft.name || 'equipment'}` : 'Add equipment'}</h2>
                <p>Identity, condition, location, inspection, and internal reference evidence for resource planning.</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close equipment editor" onClick={closeEquipmentEditor}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={saveEquipment}>
              <div className="form-grid equipment-form">
                <label className="form-span">
                  Equipment name
                  <input
                    autoFocus
                    required
                    minLength="2"
                    value={equipmentDraft.name}
                    onChange={(event) => setEquipmentDraft({ ...equipmentDraft, name: event.target.value })}
                    placeholder="Site laser, tower scaffold, service van"
                  />
                </label>
                <label>
                  Category
                  <input
                    required
                    value={equipmentDraft.category}
                    onChange={(event) => setEquipmentDraft({ ...equipmentDraft, category: event.target.value })}
                    placeholder="Measurement, access, vehicle"
                  />
                </label>
                <label>
                  Operational status
                  <select
                    value={equipmentDraft.status}
                    onChange={(event) => setEquipmentDraft({ ...equipmentDraft, status: event.target.value })}
                  >
                    <option value="available">Available</option>
                    <option value="in_use">In use</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="inspection_due">Inspection due</option>
                    <option value="inactive">Inactive</option>
                    <option value="lost">Lost</option>
                  </select>
                </label>
                <label>
                  Home location
                  <input
                    value={equipmentDraft.homeLocation}
                    onChange={(event) => setEquipmentDraft({ ...equipmentDraft, homeLocation: event.target.value })}
                    placeholder="Utrecht depot"
                  />
                </label>
                <label>
                  Current location
                  <input
                    value={equipmentDraft.currentLocation}
                    onChange={(event) => setEquipmentDraft({ ...equipmentDraft, currentLocation: event.target.value })}
                    placeholder="Depot, site, or vehicle"
                  />
                </label>
                <label>
                  Serial or asset reference
                  <input
                    value={equipmentDraft.serialNumber}
                    onChange={(event) => setEquipmentDraft({ ...equipmentDraft, serialNumber: event.target.value })}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={equipmentDraft.inspectionRequired}
                    onChange={(event) =>
                      setEquipmentDraft({
                        ...equipmentDraft,
                        inspectionRequired: event.target.checked,
                        inspectionDueAt: event.target.checked ? equipmentDraft.inspectionDueAt : '',
                      })
                    }
                  />
                  Inspection required before reservation
                </label>
                <label>
                  Inspection due
                  <input
                    type="date"
                    required={equipmentDraft.inspectionRequired}
                    disabled={!equipmentDraft.inspectionRequired}
                    value={equipmentDraft.inspectionDueAt}
                    onChange={(event) => setEquipmentDraft({ ...equipmentDraft, inspectionDueAt: event.target.value })}
                  />
                </label>
                <label className="form-span">
                  Internal notes
                  <textarea
                    value={equipmentDraft.notes}
                    onChange={(event) => setEquipmentDraft({ ...equipmentDraft, notes: event.target.value })}
                    placeholder="Record condition, restrictions, certificates, or planning context."
                  />
                </label>
                <p className="workflow-note form-span">
                  Saving this record does not reserve, dispatch, inspect, purchase, or assign equipment.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeEquipmentEditor}>
                  Cancel
                </button>
                <button
                  className="primary-button"
                  disabled={
                    submitting ||
                    equipmentDraft.name.trim().length < 2 ||
                    !equipmentDraft.category.trim() ||
                    (equipmentDraft.inspectionRequired && !equipmentDraft.inspectionDueAt)
                  }
                >
                  <ShieldCheck size={16} />
                  {submitting ? 'Saving...' : 'Save retained equipment'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {equipmentInspection ? (
        <div className="modal-backdrop equipment-backdrop" role="presentation">
          <section
            className="modal equipment-inspection-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="equipment-inspection-title"
            data-testid="equipment-inspection-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeEquipmentInspection()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Internal inspection evidence</p>
                <h2 id="equipment-inspection-title">Record equipment inspection</h2>
                <p>
                  {equipmentInspection.name} / {formatStatus(equipmentInspection.category || 'general')}
                </p>
              </div>
              <button type="button" className="icon-button" aria-label="Close equipment inspection" onClick={closeEquipmentInspection}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={recordEquipmentInspection}>
              <div className="form-grid equipment-inspection-form">
                <label>
                  Inspection result
                  <select
                    autoFocus
                    value={equipmentInspectionDraft.result}
                    onChange={(event) => setEquipmentInspectionDraft({ ...equipmentInspectionDraft, result: event.target.value })}
                  >
                    <option value="passed">Passed</option>
                    <option value="limited">Limited</option>
                    <option value="failed">Failed</option>
                  </select>
                </label>
                <label>
                  Inspection date
                  <input
                    type="date"
                    required
                    max={new Date().toISOString().slice(0, 10)}
                    value={equipmentInspectionDraft.inspectedAt}
                    onChange={(event) => setEquipmentInspectionDraft({ ...equipmentInspectionDraft, inspectedAt: event.target.value })}
                  />
                </label>
                <label>
                  Inspector or internal reference
                  <input
                    required
                    minLength="2"
                    value={equipmentInspectionDraft.inspector}
                    onChange={(event) => setEquipmentInspectionDraft({ ...equipmentInspectionDraft, inspector: event.target.value })}
                    placeholder="Name or retained staff reference"
                  />
                </label>
                <label>
                  Next inspection due
                  <input
                    type="date"
                    required={equipmentInspection.inspection?.required && equipmentInspectionDraft.result === 'passed'}
                    disabled={equipmentInspectionDraft.result !== 'passed'}
                    min={equipmentInspectionDraft.inspectedAt}
                    value={equipmentInspectionDraft.nextDueAt}
                    onChange={(event) => setEquipmentInspectionDraft({ ...equipmentInspectionDraft, nextDueAt: event.target.value })}
                  />
                </label>
                <label className="form-span">
                  Evidence reference
                  <input
                    value={equipmentInspectionDraft.reference}
                    onChange={(event) => setEquipmentInspectionDraft({ ...equipmentInspectionDraft, reference: event.target.value })}
                    placeholder="Checklist, document, or service reference"
                  />
                </label>
                <label className="form-span">
                  Findings
                  <textarea
                    required={equipmentInspectionDraft.result !== 'passed'}
                    minLength={equipmentInspectionDraft.result !== 'passed' ? 8 : undefined}
                    value={equipmentInspectionDraft.notes}
                    onChange={(event) => setEquipmentInspectionDraft({ ...equipmentInspectionDraft, notes: event.target.value })}
                    placeholder="Retain findings, restrictions, or follow-up work."
                  />
                </label>
                <p className="workflow-note form-span">
                  This creates internal operational evidence only. It does not claim statutory inspection, certification, supplier service,
                  or external approval. Failed and limited results block new reservations.
                  {['failed', 'limited'].includes(equipmentInspection.inspection?.status)
                    ? ' Retain completed maintenance before recording a passing reinspection.'
                    : equipmentInspection.inspection?.status === 'reinspection_required'
                      ? ' Completed maintenance is retained; record a passing reinspection before reservation readiness can return.'
                      : ''}
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeEquipmentInspection}>
                  Cancel
                </button>
                <button
                  className="primary-button"
                  disabled={
                    submitting ||
                    equipmentInspectionDraft.inspector.trim().length < 2 ||
                    !equipmentInspectionDraft.inspectedAt ||
                    (equipmentInspection.inspection?.required &&
                      equipmentInspectionDraft.result === 'passed' &&
                      !equipmentInspectionDraft.nextDueAt) ||
                    (equipmentInspectionDraft.result !== 'passed' && equipmentInspectionDraft.notes.trim().length < 8)
                  }
                >
                  <ClipboardCheck size={16} />
                  {submitting ? 'Recording...' : 'Record inspection'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {equipmentMaintenance ? (
        <div className="modal-backdrop equipment-backdrop" role="presentation">
          <section
            className="modal equipment-maintenance-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="equipment-maintenance-title"
            data-testid="equipment-maintenance-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeEquipmentMaintenance()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Internal maintenance evidence</p>
                <h2 id="equipment-maintenance-title">Record equipment maintenance</h2>
                <p>
                  {equipmentMaintenance.name} / {formatStatus(equipmentMaintenance.category || 'general')}
                </p>
              </div>
              <button type="button" className="icon-button" aria-label="Close equipment maintenance" onClick={closeEquipmentMaintenance}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={recordEquipmentMaintenance}>
              <div className="form-grid equipment-maintenance-form">
                <label>
                  Maintenance outcome
                  <select
                    autoFocus
                    value={equipmentMaintenanceDraft.outcome}
                    onChange={(event) => setEquipmentMaintenanceDraft({ ...equipmentMaintenanceDraft, outcome: event.target.value })}
                  >
                    <option value="completed">Completed</option>
                    <option value="follow_up_required">Follow up required</option>
                  </select>
                </label>
                <label>
                  Maintenance type
                  <select
                    value={equipmentMaintenanceDraft.maintenanceType}
                    onChange={(event) =>
                      setEquipmentMaintenanceDraft({ ...equipmentMaintenanceDraft, maintenanceType: event.target.value })
                    }
                  >
                    <option value="corrective">Corrective</option>
                    <option value="preventive">Preventive</option>
                    <option value="repair">Repair</option>
                    <option value="service">Service</option>
                  </select>
                </label>
                <label>
                  Maintenance date
                  <input
                    type="date"
                    required
                    max={new Date().toISOString().slice(0, 10)}
                    value={equipmentMaintenanceDraft.performedAt}
                    onChange={(event) => setEquipmentMaintenanceDraft({ ...equipmentMaintenanceDraft, performedAt: event.target.value })}
                  />
                </label>
                <label>
                  Person or internal reference
                  <input
                    required
                    minLength="2"
                    value={equipmentMaintenanceDraft.performedBy}
                    onChange={(event) => setEquipmentMaintenanceDraft({ ...equipmentMaintenanceDraft, performedBy: event.target.value })}
                    placeholder="Name or retained staff reference"
                  />
                </label>
                <label className="form-span">
                  Evidence reference
                  <input
                    value={equipmentMaintenanceDraft.reference}
                    onChange={(event) => setEquipmentMaintenanceDraft({ ...equipmentMaintenanceDraft, reference: event.target.value })}
                    placeholder="Work order, checklist, or internal reference"
                  />
                </label>
                <label className="form-span">
                  Work performed
                  <textarea
                    required
                    minLength="8"
                    value={equipmentMaintenanceDraft.notes}
                    onChange={(event) => setEquipmentMaintenanceDraft({ ...equipmentMaintenanceDraft, notes: event.target.value })}
                    placeholder="Retain the work completed, remaining defect, or follow-up requirement."
                  />
                </label>
                <p className="workflow-note form-span">
                  This retains internal maintenance evidence only. It does not place a supplier order, commit spend, claim external service,
                  or clear a failed inspection. A passing reinspection is required after failed or limited inspection evidence.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeEquipmentMaintenance}>
                  Cancel
                </button>
                <button
                  className="primary-button"
                  disabled={
                    submitting ||
                    equipmentMaintenanceDraft.performedBy.trim().length < 2 ||
                    !equipmentMaintenanceDraft.performedAt ||
                    equipmentMaintenanceDraft.notes.trim().length < 8
                  }
                >
                  <Wrench size={16} />
                  {submitting ? 'Recording...' : 'Record maintenance'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {equipmentRetirement ? (
        <div className="modal-backdrop equipment-backdrop" role="presentation">
          <section
            className="modal equipment-retirement-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="equipment-retirement-title"
            data-testid="equipment-retirement-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeEquipmentRetirement()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Approval-gated lifecycle</p>
                <h2 id="equipment-retirement-title">Request equipment retirement</h2>
                <p>
                  {equipmentRetirement.name} / {formatStatus(equipmentRetirement.category || 'general')}
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close equipment retirement request"
                onClick={closeEquipmentRetirement}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={requestEquipmentRetirement}>
              <div className="job-lifecycle-body">
                <div className="job-lifecycle-effect">
                  <Archive size={20} />
                  <div>
                    <strong>Block this equipment from new reservations</strong>
                    <p>
                      The retained status changes to retired only after approval and after every operational reservation has been released.
                    </p>
                  </div>
                </div>
                <ul className="job-lifecycle-safeguards">
                  <li>The complete equipment, reservation, approval, and audit history remains retained.</li>
                  <li>New reservations are blocked as soon as this request enters the approval queue.</li>
                  <li>
                    {equipmentRetirement.activeReservationCount > 0
                      ? `Approval cannot complete while ${equipmentRetirement.activeReservationCount} operational reservation${equipmentRetirement.activeReservationCount === 1 ? '' : 's'} remain.`
                      : 'No operational reservations currently block this retirement.'}
                  </li>
                  {equipmentRetirement.dormantReservationCount > 0 ? (
                    <li>
                      Approval will release {equipmentRetirement.dormantReservationCount} dormant reservation
                      {equipmentRetirement.dormantReservationCount === 1 ? '' : 's'} retained on inactive jobs, so any later job restore
                      requires a new reservation.
                    </li>
                  ) : null}
                  <li>No crew member, client, supplier, finance provider, or site contact is notified.</li>
                </ul>
                <label>
                  Operational reason
                  <textarea
                    autoFocus
                    required
                    minLength="8"
                    value={equipmentRetirementReason}
                    onChange={(event) => setEquipmentRetirementReason(event.target.value)}
                    placeholder="Explain why this equipment should no longer be selected for work."
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeEquipmentRetirement}>
                  Cancel
                </button>
                <button className="danger-button" disabled={submitting || equipmentRetirementReason.trim().length < 8}>
                  <Archive size={16} />
                  {submitting ? 'Submitting...' : 'Request retirement approval'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {tradePartnerEditor ? (
        <div className="modal-backdrop trade-partner-backdrop" role="presentation">
          <section
            className="modal trade-partner-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trade-partner-editor-title"
            data-testid="trade-partner-editor"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Retained commercial evidence</p>
                <h2 id="trade-partner-editor-title">
                  {tradePartnerDraft.id ? `Edit ${tradePartnerDraft.name || 'trade partner'}` : 'Add trade partner'}
                </h2>
                <p>Identity and compliance evidence used by approval-gated purchasing.</p>
              </div>
              <button className="icon-button" aria-label="Close trade partner editor" onClick={closeTradePartnerEditor}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={saveTradePartner}>
              <div className="form-grid trade-partner-form">
                <label className="form-span">
                  Legal or trading name
                  <input
                    required
                    value={tradePartnerDraft.name}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, name: event.target.value })}
                  />
                </label>
                <label>
                  Partner type
                  <select
                    value={tradePartnerDraft.partnerType}
                    onChange={(event) => {
                      const partnerType = event.target.value
                      setTradePartnerDraft({
                        ...tradePartnerDraft,
                        partnerType,
                        requiresInsurance: tradePartnerDraft.requiresInsurance || ['subcontractor', 'both'].includes(partnerType),
                      })
                    }}
                  >
                    <option value="supplier">Supplier</option>
                    <option value="subcontractor">Subcontractor</option>
                    <option value="both">Supplier and subcontractor</option>
                  </select>
                </label>
                <label>
                  Internal status
                  <select
                    value={tradePartnerDraft.status}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, status: event.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="on_hold">On hold</option>
                  </select>
                </label>
                <label>
                  Contact name
                  <input
                    value={tradePartnerDraft.contactName}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, contactName: event.target.value })}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={tradePartnerDraft.email}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, email: event.target.value })}
                  />
                </label>
                <label>
                  Phone
                  <input
                    value={tradePartnerDraft.phone}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, phone: event.target.value })}
                  />
                </label>
                <label>
                  City
                  <input
                    value={tradePartnerDraft.city}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, city: event.target.value })}
                  />
                </label>
                <label>
                  Country
                  <input
                    required
                    maxLength="2"
                    value={tradePartnerDraft.country}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, country: event.target.value.toUpperCase() })}
                    placeholder="NL"
                  />
                </label>
                <label>
                  Registration / KVK
                  <input
                    value={tradePartnerDraft.registrationNumber}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, registrationNumber: event.target.value })}
                  />
                </label>
                <label>
                  VAT number
                  <input
                    disabled={tradePartnerDraft.vatExempt}
                    value={tradePartnerDraft.vatNumber}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, vatNumber: event.target.value })}
                  />
                </label>
                <label className="form-span checkbox-label">
                  <input
                    type="checkbox"
                    checked={tradePartnerDraft.vatExempt}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, vatExempt: event.target.checked })}
                  />
                  VAT exemption has been verified
                </label>
                <label className="form-span">
                  Specialties
                  <input
                    value={tradePartnerDraft.specialties}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, specialties: event.target.value })}
                    placeholder="Roofing, electrical, timber"
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={tradePartnerDraft.requiresInsurance}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, requiresInsurance: event.target.checked })}
                  />
                  Insurance evidence required
                </label>
                <label>
                  Insurance expiry
                  <input
                    type="date"
                    disabled={!tradePartnerDraft.requiresInsurance}
                    required={tradePartnerDraft.requiresInsurance}
                    value={tradePartnerDraft.insuranceExpiresAt}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, insuranceExpiresAt: event.target.value })}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={tradePartnerDraft.requiresVca}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, requiresVca: event.target.checked })}
                  />
                  VCA evidence required
                </label>
                <label>
                  VCA expiry
                  <input
                    type="date"
                    disabled={!tradePartnerDraft.requiresVca}
                    required={tradePartnerDraft.requiresVca}
                    value={tradePartnerDraft.vcaExpiresAt}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, vcaExpiresAt: event.target.value })}
                  />
                </label>
                <label>
                  Verification reference
                  <input
                    value={tradePartnerDraft.verificationReference}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, verificationReference: event.target.value })}
                    placeholder="Registry check or evidence record"
                  />
                </label>
                <label>
                  Verified on
                  <input
                    type="date"
                    value={tradePartnerDraft.verifiedAt}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, verifiedAt: event.target.value })}
                  />
                </label>
                <label className="form-span">
                  Internal notes
                  <textarea
                    value={tradePartnerDraft.notes}
                    onChange={(event) => setTradePartnerDraft({ ...tradePartnerDraft, notes: event.target.value })}
                    placeholder="Record scope, restrictions, or evidence context."
                  />
                </label>
                <p className="workflow-note form-span">
                  Saving this record does not contact the partner, place an order, commit spend, or approve site access.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeTradePartnerEditor}>
                  Cancel
                </button>
                <button className="primary-button" disabled={submitting || !tradePartnerDraft.name.trim()}>
                  <ShieldCheck size={16} />
                  {submitting ? 'Saving...' : 'Save retained partner'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {tradePartnerRetirement ? (
        <div className="modal-backdrop trade-partner-backdrop" role="presentation">
          <section
            className="modal trade-partner-retirement-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trade-partner-retirement-title"
            data-testid="trade-partner-retirement-modal"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Approval-gated lifecycle</p>
                <h2 id="trade-partner-retirement-title">Request partner retirement</h2>
                <p>
                  {tradePartnerRetirement.name} / {formatStatus(tradePartnerRetirement.partnerType)}
                </p>
              </div>
              <button className="icon-button" aria-label="Close trade partner retirement request" onClick={closeTradePartnerRetirement}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={requestTradePartnerRetirement}>
              <div className="job-lifecycle-body">
                <div className="job-lifecycle-effect">
                  <Archive size={20} />
                  <div>
                    <strong>Block this partner from new procurement</strong>
                    <p>The status changes to retired only after approval. Open work remains visible for operator review.</p>
                  </div>
                </div>
                <ul className="job-lifecycle-safeguards">
                  <li>All identity, compliance, purchasing, approval, and audit history remains retained.</li>
                  <li>No open order, contract, payment, delivery, or site assignment is cancelled.</li>
                  <li>No partner, supplier, client, or worker is contacted from this action.</li>
                </ul>
                <label>
                  Operational reason
                  <textarea
                    required
                    minLength="8"
                    value={tradePartnerRetirementReason}
                    onChange={(event) => setTradePartnerRetirementReason(event.target.value)}
                    placeholder="Explain why this partner should no longer be selected for new work."
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeTradePartnerRetirement}>
                  Cancel
                </button>
                <button className="danger-button" disabled={submitting || tradePartnerRetirementReason.trim().length < 8}>
                  <Archive size={16} />
                  {submitting ? 'Submitting...' : 'Request retirement approval'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {approvalReview ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal approval-review-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="approval-review-title"
            data-testid="approval-review-modal"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Retained decision review</p>
                <h2 id="approval-review-title">{approvalReview.status === 'approved' ? 'Approve decision' : 'Reject decision'}</h2>
                <p>{approvalReview.item.summary || formatStatus(approvalReview.item.targetType)}</p>
              </div>
              <button className="icon-button" aria-label="Close approval review" onClick={closeApprovalReview}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={resolveApproval}>
              <div className="approval-review-body">
                <div className="approval-review-primary">
                  <TriangleAlert size={20} />
                  <div>
                    <span className={`tag tag-${approvalReview.item.decision?.riskLevel === 'high' ? 'amber' : 'green'}`}>
                      {approvalReview.item.decision?.riskLevel || 'review'} risk
                    </span>
                    <strong>
                      {approvalReview.item.decision?.primaryEffect ||
                        approvalReview.item.reason ||
                        'Resolve this retained ledger decision.'}
                    </strong>
                  </div>
                </div>
                {approvalReview.item.decision?.effects?.length ? (
                  <div className="approval-review-section">
                    <h3>Ledger effects</h3>
                    <ul>
                      {approvalReview.item.decision.effects.map((effect) => (
                        <li key={effect}>{effect}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {Object.keys(approvalReview.item.decision?.preview || {}).length ? (
                  <div className="approval-review-section">
                    <h3>Submitted details</h3>
                    <dl>
                      {Object.entries(approvalReview.item.decision.preview)
                        .filter(([, value]) => value !== null && value !== undefined && value !== '')
                        .map(([key, value]) => (
                          <div key={key}>
                            <dt>{formatStatus(key)}</dt>
                            <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                          </div>
                        ))}
                    </dl>
                  </div>
                ) : null}
                {approvalReview.item.decision?.safeguards?.length ? (
                  <div className="approval-review-section approval-review-safeguards">
                    <h3>Safeguards</h3>
                    <ul>
                      {approvalReview.item.decision.safeguards.map((safeguard) => (
                        <li key={safeguard}>{safeguard}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <label className="approval-review-reason">
                  Reviewer reason
                  {approvalReview.status === 'rejected' || approvalReview.item.data?.requiresExceptionOverride ? ' (required)' : ''}
                  <textarea
                    required={approvalReview.status === 'rejected' || approvalReview.item.data?.requiresExceptionOverride === true}
                    value={approvalReason}
                    onChange={(event) => setApprovalReason(event.target.value)}
                    placeholder={
                      approvalReview.status === 'rejected'
                        ? 'Explain what must change before this can be resubmitted.'
                        : approvalReview.item.data?.requiresExceptionOverride
                          ? 'Explain why the retained match exceptions are accepted.'
                          : 'Record what was verified before approval.'
                    }
                  />
                </label>
                <p className="workflow-note">
                  This action updates the local ledger and audit trail only. The listed safeguards remain in force after resolution.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeApprovalReview}>
                  Cancel
                </button>
                <button
                  className={approvalReview.status === 'approved' ? 'primary-button' : 'danger-button'}
                  disabled={
                    submitting ||
                    ((approvalReview.status === 'rejected' || approvalReview.item.data?.requiresExceptionOverride === true) &&
                      !approvalReason.trim())
                  }
                >
                  <ShieldCheck size={16} />
                  {submitting ? 'Resolving...' : approvalReview.status === 'approved' ? 'Confirm approval' : 'Confirm rejection'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {selectedJobId ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal job-workspace"
            role="dialog"
            aria-modal="true"
            aria-labelledby="job-workspace-title"
            data-testid="job-workspace"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Ledger job workspace</p>
                <h2 id="job-workspace-title">{selectedJob?.title || 'Loading job record'}</h2>
                <p>
                  {selectedJob?.clientName || 'Client pending'}
                  {selectedJob?.city ? ` · ${selectedJob.city}` : ''}
                </p>
              </div>
              <div className="modal-heading-actions">
                {selectedJob && canCoordinate ? (
                  <button
                    className="secondary-button job-resource-button"
                    type="button"
                    aria-label="Open resource planner"
                    onClick={() => setShowResourcePlanner(true)}
                  >
                    <Users size={16} />
                    Resources
                  </button>
                ) : null}
                <button className="icon-button" aria-label="Close job workspace" onClick={closeJobWorkspace}>
                  <X size={18} />
                </button>
              </div>
            </div>
            {selectedJobLoading || !selectedJob ? (
              <div className="loading job-workspace-loading">
                <LoaderCircle className="spin" size={24} />
                Loading the retained job record
              </div>
            ) : (
              <div className="job-workspace-body">
                <div className="job-facts">
                  <div>
                    <span>State</span>
                    <strong>
                      <span className={`status status-${selectedJob.status}`}>{formatStatus(selectedJob.status)}</span>
                    </strong>
                  </div>
                  <div>
                    <span>Progress</span>
                    <strong>{Math.round(selectedJob.progressPercent || 0)}%</strong>
                  </div>
                  <div>
                    <span>Proposed work</span>
                    <strong>{formatDate(selectedJob.scheduledStart || selectedJob.targetCompletion)}</strong>
                  </div>
                  <div>
                    <span>Open approvals</span>
                    <strong>{(selectedJob.approvals || []).filter((item) => item.status === 'pending').length}</strong>
                  </div>
                </div>
                {!fieldScoped ? (
                  <CommercialControl
                    job={selectedJob}
                    canCoordinate={canCoordinate}
                    canApprove={capabilities.approvals === true}
                    submitting={submitting}
                    onNewQuote={() => openCommercialDraft('quote')}
                    onNewChangeOrder={() => openCommercialDraft('change_order')}
                    onRequestAcceptance={openCommercialAcceptance}
                    onOpenApprovals={openApprovals}
                  />
                ) : null}
                <WorkPlanControl
                  job={selectedJob}
                  canCoordinate={canCoordinate}
                  canApprove={capabilities.approvals === true}
                  fieldScoped={fieldScoped}
                  operator={operator}
                  submitting={submitting}
                  taskDraft={taskDraft}
                  setTaskDraft={setTaskDraft}
                  assignees={taskAssigneeOptions}
                  onCreateTask={createJobTask}
                  onTaskTransition={openTaskTransition}
                  onUpdateTaskSchedule={updateJobTaskSchedule}
                  onAddDependency={addJobTaskDependency}
                  onCancelDependency={cancelJobTaskDependency}
                  onCalculate={calculateJobWorkPlan}
                  onRequestBaseline={requestJobScheduleBaseline}
                  onOpenApprovals={openApprovals}
                />
                <ProjectControls
                  job={selectedJob}
                  canCoordinate={canCoordinate}
                  canApprove={capabilities.approvals === true}
                  submitting={submitting}
                  onCreate={createProjectControl}
                  onTransition={transitionProjectControl}
                  onIssueTransmittal={issueDocumentTransmittal}
                  onAcknowledgeTransmittal={acknowledgeDocumentTransmittal}
                  onSubmitMeeting={submitProjectMeeting}
                  onIssueMeeting={issueProjectMeeting}
                  onCompleteMeetingAction={completeProjectMeetingAction}
                  onCreateMeetingFollowUp={createProjectMeetingFollowUp}
                  onOpenApprovals={openApprovals}
                />
                {canCoordinate ? (
                  <div className="job-workspace-lifecycle" data-testid="job-archive-control">
                    <div>
                      <Archive size={18} />
                      <span>
                        <strong>Archive control</strong>
                        <small>Remove this job from active operations after approval while retaining its complete ledger.</small>
                      </span>
                    </div>
                    <button
                      type="button"
                      className="danger-button"
                      data-testid="request-job-archive"
                      disabled={submitting || (selectedJob.approvals || []).some((item) => item.status === 'pending')}
                      title={
                        (selectedJob.approvals || []).some((item) => item.status === 'pending')
                          ? 'Resolve pending job decisions before archive'
                          : 'Request approval to archive this job'
                      }
                      onClick={() => openJobLifecycle('archive', selectedJob)}
                    >
                      <Archive size={15} />
                      {(selectedJob.approvals || []).some((item) => item.status === 'pending' && item.targetType === 'job_archive')
                        ? 'Archive pending'
                        : (selectedJob.approvals || []).some((item) => item.status === 'pending')
                          ? 'Resolve approvals first'
                          : 'Request archive'}
                    </button>
                  </div>
                ) : null}
                {canCoordinate ? (
                  <>
                    <section className="job-workspace-section">
                      <div className="section-heading">
                        <CalendarDays size={18} />
                        <div>
                          <h3>Schedule review</h3>
                          <p>Review planning readiness first. A client or crew commitment is created only through the approval queue.</p>
                        </div>
                      </div>
                      <form className="form-grid compact-form" onSubmit={reviewSchedule}>
                        <label>
                          Proposed start
                          <input
                            required
                            type="datetime-local"
                            value={scheduleDraft.plannedStart}
                            onChange={(event) =>
                              setScheduleDraft({
                                ...scheduleDraft,
                                plannedStart: event.target.value,
                                plannedEnd: scheduleDraft.plannedEnd || suggestedEndInput(event.target.value, selectedJob.estimatedHours),
                              })
                            }
                          />
                        </label>
                        <label>
                          Proposed end
                          <input
                            required
                            type="datetime-local"
                            value={scheduleDraft.plannedEnd}
                            onChange={(event) => setScheduleDraft({ ...scheduleDraft, plannedEnd: event.target.value })}
                          />
                        </label>
                        <div className="form-actions form-span">
                          <button className="secondary-button" disabled={submitting}>
                            <CalendarDays size={16} />
                            Review schedule
                          </button>
                          <button type="button" className="primary-button" disabled={submitting} onClick={requestScheduleApproval}>
                            <ShieldCheck size={16} />
                            Request approval
                          </button>
                        </div>
                      </form>
                      {scheduleReview ? (
                        <div className="workflow-result">
                          <div>
                            <strong>{formatStatus(scheduleReview.status)}</strong>
                            <span>{scheduleReview.nextAction}</span>
                          </div>
                          {scheduleReview.recommendedWorker?.name ? (
                            <span className="tag tag-green">Worker: {scheduleReview.recommendedWorker.name}</span>
                          ) : null}
                          {scheduleReview.blockers?.length ? (
                            <ul>
                              {scheduleReview.blockers.slice(0, 3).map((blocker) => (
                                <li key={blocker.type}>{blocker.message}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </section>
                    <section className="job-workspace-section">
                      <div className="section-heading">
                        <CloudOff size={18} />
                        <div>
                          <h3>Weather assessment</h3>
                          <p>Record a local weather condition for this job. It updates readiness but never commits a date.</p>
                        </div>
                      </div>
                      <form className="form-grid compact-form" onSubmit={recordWeatherAssessment}>
                        <label>
                          Condition
                          <select
                            value={weatherDraft.condition}
                            onChange={(event) => setWeatherDraft({ ...weatherDraft, condition: event.target.value })}
                          >
                            <option value="workable">Workable</option>
                            <option value="rain_risk">Rain risk</option>
                            <option value="wind_risk">Wind risk</option>
                            <option value="heat_risk">Heat risk</option>
                            <option value="unsafe">Unsafe</option>
                          </select>
                        </label>
                        <label>
                          Precipitation risk (%)
                          <input
                            required
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={weatherDraft.precipitationPercent}
                            onChange={(event) => setWeatherDraft({ ...weatherDraft, precipitationPercent: event.target.value })}
                          />
                        </label>
                        <label className="form-span checkbox-label">
                          <input
                            type="checkbox"
                            checked={weatherDraft.weatherSensitive}
                            onChange={(event) => setWeatherDraft({ ...weatherDraft, weatherSensitive: event.target.checked })}
                          />
                          This work is weather-sensitive
                        </label>
                        <div className="form-actions form-span">
                          <button className="secondary-button" disabled={submitting}>
                            <CloudOff size={16} />
                            Record assessment
                          </button>
                        </div>
                      </form>
                      {selectedJob.weather?.[0] ? (
                        <p className="workflow-note">
                          <strong>Latest:</strong> {formatStatus(selectedJob.weather[0].condition)} ·{' '}
                          {selectedJob.weather[0].precipitationPercent}% · {selectedJob.weather[0].recommendation}
                        </p>
                      ) : null}
                    </section>
                    <section className="job-workspace-section">
                      <div className="section-heading">
                        <MessageSquareText size={18} />
                        <div>
                          <h3>Client communication draft</h3>
                          <p>Creates a retained draft and approval record. This interface cannot deliver a message.</p>
                        </div>
                      </div>
                      <form className="form-grid compact-form" onSubmit={createCommunicationDraft}>
                        <label>
                          Channel
                          <select
                            value={communicationDraft.channel}
                            onChange={(event) => setCommunicationDraft({ ...communicationDraft, channel: event.target.value })}
                          >
                            <option value="email">Email</option>
                            <option value="portal">Client portal</option>
                            <option value="phone">Phone follow-up</option>
                          </select>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={communicationDraft.expectsReply}
                            onChange={(event) => setCommunicationDraft({ ...communicationDraft, expectsReply: event.target.checked })}
                          />
                          Reply expected
                        </label>
                        <label className="form-span">
                          Subject
                          <input
                            required
                            value={communicationDraft.subject}
                            onChange={(event) => setCommunicationDraft({ ...communicationDraft, subject: event.target.value })}
                            placeholder="Describe the client decision or update"
                          />
                        </label>
                        <label className="form-span">
                          Draft message
                          <textarea
                            required
                            value={communicationDraft.body}
                            onChange={(event) => setCommunicationDraft({ ...communicationDraft, body: event.target.value })}
                            placeholder="Prepare the approved wording. Delivery stays blocked until a verified integration receipt is recorded."
                          />
                        </label>
                        <div className="form-actions form-span">
                          <button className="primary-button" disabled={submitting}>
                            <MessageSquareText size={16} />
                            Create approval-gated draft
                          </button>
                        </div>
                      </form>
                    </section>
                    <section className="job-workspace-section">
                      <div className="section-heading">
                        <Link2 size={18} />
                        <div>
                          <h3>Client portal access</h3>
                          <p>Generate a restricted job portal link. The client cannot open it until the access approval is resolved.</p>
                        </div>
                      </div>
                      <form className="form-grid compact-form" onSubmit={requestClientPortalAccess}>
                        <label>
                          Portal label
                          <input
                            required
                            value={portalDraft.label}
                            onChange={(event) => setPortalDraft({ ...portalDraft, label: event.target.value })}
                          />
                        </label>
                        <label>
                          Expiry
                          <input
                            required
                            type="date"
                            value={portalDraft.expiresAt}
                            onChange={(event) => setPortalDraft({ ...portalDraft, expiresAt: event.target.value })}
                          />
                        </label>
                        <div className="form-actions form-span">
                          <button className="secondary-button" disabled={submitting}>
                            <Link2 size={16} />
                            Request portal access
                          </button>
                        </div>
                      </form>
                      {portalLink ? (
                        <div className="workflow-result portal-secret">
                          <div>
                            <strong>One-time portal link</strong>
                            <span>
                              Copy this link securely now. It is inactive until approval and cannot be recovered from the ledger after this
                              workspace closes.
                            </span>
                          </div>
                          <input aria-label="One-time client portal link" readOnly value={portalLink} />
                          <button type="button" className="secondary-button" onClick={copyPortalLink}>
                            <Copy size={16} />
                            Copy link
                          </button>
                        </div>
                      ) : null}
                      {selectedJob.portalAccess?.length ? (
                        <div className="activity-list">
                          {selectedJob.portalAccess.slice(0, 3).map((access) => (
                            <div className="activity-row" key={access.id}>
                              <div>
                                <strong>{access.data?.label || 'Client job portal'}</strong>
                                <small>
                                  Expires {formatDate(access.expiresAt)} · {formatStatus(access.status)}
                                </small>
                              </div>
                              {!['revoked', 'expired'].includes(access.status) ? (
                                <button
                                  type="button"
                                  className="secondary-button"
                                  disabled={submitting}
                                  onClick={() => revokeClientPortalAccess(access.id)}
                                >
                                  <Ban size={15} />
                                  Revoke
                                </button>
                              ) : (
                                <span className={`status status-${access.status}`}>{formatStatus(access.status)}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  </>
                ) : (
                  <div className="field-note">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>Field-scoped job workspace</strong>
                      <p>
                        Task updates and field records remain available. Schedule and client communication actions stay reserved for the
                        office role.
                      </p>
                    </div>
                  </div>
                )}
                <section className="job-workspace-section activity-section">
                  <div className="section-heading">
                    <Bell size={18} />
                    <div>
                      <h3>Recent communications</h3>
                      <p>Every client record remains linked to approval and delivery evidence.</p>
                    </div>
                  </div>
                  {selectedJob.communications?.length ? (
                    <div className="activity-list">
                      {selectedJob.communications.slice(0, 5).map((item) => (
                        <div className="activity-row" key={item.id}>
                          <div>
                            <strong>{item.subject || formatStatus(item.channel)}</strong>
                            <small>
                              {formatStatus(item.direction)} · {formatDate(item.createdAt)}
                            </small>
                          </div>
                          <span className={`status status-${item.status}`}>{formatStatus(item.status)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="workflow-note">No client communication has been recorded for this job.</p>
                  )}
                </section>
              </div>
            )}
          </section>
        </div>
      ) : null}
      {commercialDraftMode ? (
        <div className="modal-backdrop commercial-backdrop" role="presentation">
          <section
            className="modal commercial-draft-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="commercial-draft-title"
            data-testid="commercial-draft-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeCommercialDialog()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Approval-gated commercial record</p>
                <h2 id="commercial-draft-title">{commercialDraftMode === 'quote' ? 'New estimate' : 'New scope change'}</h2>
                <p>{selectedJob?.title} / server-derived totals</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close commercial draft" onClick={closeCommercialDialog}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitCommercialDraft}>
              <div className="commercial-draft-body">
                {commercialDraftMode === 'quote' ? (
                  <div className="form-grid compact-form">
                    <label>
                      Valid until
                      <input
                        autoFocus
                        required
                        type="date"
                        min={new Date().toISOString().slice(0, 10)}
                        value={quoteDraft.validUntil}
                        onChange={(event) => setQuoteDraft({ ...quoteDraft, validUntil: event.target.value })}
                      />
                    </label>
                    <label>
                      VAT rate (%)
                      <input
                        required
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={quoteDraft.taxRate}
                        onChange={(event) => setQuoteDraft({ ...quoteDraft, taxRate: event.target.value })}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="form-grid compact-form">
                    <label className="form-span">
                      Change title
                      <input
                        autoFocus
                        required
                        minLength="2"
                        value={changeOrderDraft.title}
                        onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, title: event.target.value })}
                        placeholder="Describe the commercial decision"
                      />
                    </label>
                    <label className="form-span">
                      Scope change
                      <textarea
                        required
                        minLength="3"
                        value={changeOrderDraft.scopeDelta}
                        onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, scopeDelta: event.target.value })}
                        placeholder="Record added, omitted, or revised scope."
                      />
                    </label>
                    <label>
                      Reference quote
                      <select
                        value={changeOrderDraft.quoteId}
                        onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, quoteId: event.target.value })}
                      >
                        <option value="">Current retained contract</option>
                        {(selectedJob?.quotes || [])
                          .filter((quote) => ['approved', 'accepted'].includes(quote.status))
                          .map((quote) => (
                            <option key={quote.id} value={quote.id}>
                              {formatStatus(quote.status)} / {currency.format(quote.subtotal || 0)} net
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Schedule impact (days)
                      <input
                        required
                        type="number"
                        min="-3650"
                        max="3650"
                        step="1"
                        value={changeOrderDraft.scheduleDeltaDays}
                        onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, scheduleDeltaDays: event.target.value })}
                      />
                    </label>
                    <label>
                      VAT rate (%)
                      <input
                        required
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={changeOrderDraft.taxRate}
                        onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, taxRate: event.target.value })}
                      />
                    </label>
                  </div>
                )}
                <div className="commercial-line-heading">
                  <div>
                    <h3>Line items</h3>
                    <p>Amounts are recalculated by the ledger.</p>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={(activeCommercialDraft.lineItems || []).length >= 50}
                    onClick={() => addCommercialLineItem(commercialDraftMode)}
                  >
                    <Plus size={15} />
                    Add line
                  </button>
                </div>
                <div className="commercial-line-items">
                  {activeCommercialDraft.lineItems.map((item, index) => (
                    <div className="commercial-line-item" key={index}>
                      <label>
                        Description
                        <input
                          required
                          minLength="2"
                          maxLength="240"
                          value={item.description}
                          onChange={(event) => updateCommercialLineItem(commercialDraftMode, index, 'description', event.target.value)}
                        />
                      </label>
                      <label>
                        Quantity
                        <input
                          required
                          type="number"
                          min="0.01"
                          max="1000000"
                          step="0.01"
                          value={item.quantity}
                          onChange={(event) => updateCommercialLineItem(commercialDraftMode, index, 'quantity', event.target.value)}
                        />
                      </label>
                      <label>
                        Unit price
                        <input
                          required
                          type="number"
                          min={commercialDraftMode === 'quote' ? '0' : '-1000000000'}
                          max="1000000000"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(event) => updateCommercialLineItem(commercialDraftMode, index, 'unitPrice', event.target.value)}
                        />
                      </label>
                      <label>
                        Cost code
                        <input
                          maxLength="80"
                          value={item.costCode}
                          onChange={(event) => updateCommercialLineItem(commercialDraftMode, index, 'costCode', event.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className="icon-button commercial-line-remove"
                        aria-label={`Remove line ${index + 1}`}
                        disabled={activeCommercialDraft.lineItems.length === 1}
                        onClick={() => removeCommercialLineItem(commercialDraftMode, index)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="commercial-total-strip" aria-label="Commercial totals">
                  <span>
                    Net <strong>{currency.format(commercialDraftNet)}</strong>
                  </span>
                  <span>
                    VAT <strong>{currency.format(commercialDraftTax)}</strong>
                  </span>
                  <span>
                    Gross <strong>{currency.format(commercialDraftTotal)}</strong>
                  </span>
                </div>
                <label>
                  Internal notes
                  <textarea
                    maxLength="4000"
                    value={activeCommercialDraft.notes}
                    onChange={(event) =>
                      commercialDraftMode === 'quote'
                        ? setQuoteDraft({ ...quoteDraft, notes: event.target.value })
                        : setChangeOrderDraft({ ...changeOrderDraft, notes: event.target.value })
                    }
                    placeholder="Record assumptions, exclusions, and reviewer context."
                  />
                </label>
                <p className="workflow-note">
                  Saving creates an internal approval request. It does not send a quote, commit scope, alter contract value, or contact the
                  client.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeCommercialDialog}>
                  Cancel
                </button>
                <button className="primary-button" disabled={submitting || !commercialDraftReady}>
                  <ShieldCheck size={16} />
                  {submitting ? 'Saving...' : commercialDraftMode === 'quote' ? 'Retain estimate' : 'Request change approval'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {commercialAcceptance ? (
        <div className="modal-backdrop commercial-backdrop" role="presentation">
          <section
            className="modal commercial-acceptance-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="commercial-acceptance-title"
            data-testid="commercial-acceptance-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeCommercialDialog()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Client evidence verification</p>
                <h2 id="commercial-acceptance-title">Record client acceptance</h2>
                <p>
                  {commercialAcceptance.type === 'quote'
                    ? `Quote ${currency.format(commercialAcceptance.record.subtotal || 0)} net`
                    : commercialAcceptance.record.title}
                </p>
              </div>
              <button type="button" className="icon-button" aria-label="Close client acceptance" onClick={closeCommercialDialog}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitCommercialAcceptance}>
              <div className="form-grid commercial-acceptance-form">
                <label>
                  Accepted on
                  <input
                    autoFocus
                    required
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    value={commercialAcceptanceDraft.acceptedAt}
                    onChange={(event) => setCommercialAcceptanceDraft({ ...commercialAcceptanceDraft, acceptedAt: event.target.value })}
                  />
                </label>
                <label className="form-span">
                  Evidence reference
                  <input
                    required
                    minLength="3"
                    maxLength="240"
                    value={commercialAcceptanceDraft.evidenceReference}
                    onChange={(event) =>
                      setCommercialAcceptanceDraft({ ...commercialAcceptanceDraft, evidenceReference: event.target.value })
                    }
                    placeholder="Signed quote, portal decision, email, or document reference"
                  />
                </label>
                <label className="form-span">
                  Verification notes
                  <textarea
                    maxLength="2000"
                    value={commercialAcceptanceDraft.notes}
                    onChange={(event) => setCommercialAcceptanceDraft({ ...commercialAcceptanceDraft, notes: event.target.value })}
                    placeholder="Record where the evidence is retained and any conditions."
                  />
                </label>
                <p className="workflow-note form-span">
                  This request does not claim acceptance by itself. Contract value changes only after a separate approver verifies the
                  retained evidence.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeCommercialDialog}>
                  Cancel
                </button>
                <button className="primary-button" disabled={submitting || commercialAcceptanceDraft.evidenceReference.trim().length < 3}>
                  <ShieldCheck size={16} />
                  {submitting ? 'Recording...' : 'Request verification'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {taskAction ? (
        <div className="modal-backdrop task-action-backdrop" role="presentation">
          <section
            className="modal task-action-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-action-title"
            data-testid="task-action-modal"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Retained task lifecycle</p>
                <h2 id="task-action-title">{formatStatus(taskAction.status)} task</h2>
                <p>{taskAction.task.title}</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close task action"
                disabled={submitting}
                onClick={() => {
                  setTaskAction(null)
                  setTaskActionNote('')
                }}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitTaskTransition}>
              <div className="form-grid">
                <label className="form-span">
                  Evidence and outcome
                  <textarea
                    required
                    minLength="4"
                    autoFocus
                    value={taskActionNote}
                    onChange={(event) => setTaskActionNote(event.target.value)}
                    placeholder="Record the work, blocker, or cancellation basis"
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={submitting}
                  onClick={() => {
                    setTaskAction(null)
                    setTaskActionNote('')
                  }}
                >
                  Cancel
                </button>
                <button
                  className={taskAction.status === 'cancelled' ? 'danger-button' : 'primary-button'}
                  disabled={submitting || taskActionNote.trim().length < 4}
                >
                  {taskAction.status === 'completed' ? (
                    <Check size={16} />
                  ) : taskAction.status === 'blocked' ? (
                    <TriangleAlert size={16} />
                  ) : (
                    <Ban size={16} />
                  )}
                  {submitting ? 'Saving...' : `Mark ${formatStatus(taskAction.status)}`}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {opportunityEditor ? (
        <div className="modal-backdrop opportunity-backdrop" role="presentation">
          <section
            className="modal opportunity-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="opportunity-title"
            data-testid="opportunity-modal"
          >
            <div className="modal-heading">
              <div>
                <h2 id="opportunity-title">{opportunityEditor.mode === 'create' ? 'New opportunity' : 'Edit opportunity'}</h2>
                <p>Retain qualification and forecast data before operational job creation.</p>
              </div>
              <button className="icon-button" aria-label="Close opportunity" onClick={closeOpportunityEditor}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitOpportunity}>
              <div className="form-grid opportunity-form-grid">
                <label>
                  Client name
                  <input
                    required
                    disabled={opportunityEditor.mode === 'edit'}
                    value={opportunityDraft.clientName}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, clientName: event.target.value })}
                  />
                </label>
                <label>
                  Company
                  <input
                    disabled={opportunityEditor.mode === 'edit'}
                    value={opportunityDraft.company}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, company: event.target.value })}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    disabled={opportunityEditor.mode === 'edit'}
                    value={opportunityDraft.email}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, email: event.target.value })}
                  />
                </label>
                <label>
                  Phone
                  <input
                    disabled={opportunityEditor.mode === 'edit'}
                    value={opportunityDraft.phone}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, phone: event.target.value })}
                  />
                </label>
                <label className="form-span">
                  Opportunity title
                  <input
                    required
                    minLength="2"
                    value={opportunityDraft.title}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, title: event.target.value })}
                  />
                </label>
                <label>
                  Stage
                  <select
                    value={opportunityDraft.stage}
                    disabled={opportunityDraft.stage === 'won'}
                    onChange={(event) => {
                      const nextStage = event.target.value
                      const defaultProbability = {
                        new: 10,
                        qualifying: 20,
                        site_visit: 35,
                        estimating: 50,
                        proposal: 65,
                        negotiating: 80,
                        lost: 0,
                        archived: 0,
                      }[nextStage]
                      setOpportunityDraft({
                        ...opportunityDraft,
                        stage: nextStage,
                        probabilityPercent: String(defaultProbability ?? opportunityDraft.probabilityPercent),
                      })
                    }}
                  >
                    {PIPELINE_STAGES.map((option) => (
                      <option key={option} value={option} disabled={option === 'won' && opportunityDraft.stage !== 'won'}>
                        {formatStatus(option)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Probability
                  <div className="probability-control">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      disabled={['won', 'lost', 'archived'].includes(opportunityDraft.stage)}
                      value={opportunityDraft.probabilityPercent}
                      onChange={(event) => setOpportunityDraft({ ...opportunityDraft, probabilityPercent: event.target.value })}
                    />
                    <output>{opportunityDraft.probabilityPercent}%</output>
                  </div>
                </label>
                <label>
                  Service
                  <input
                    value={opportunityDraft.service}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, service: event.target.value })}
                    placeholder="Renovation, maintenance..."
                  />
                </label>
                <label>
                  Source
                  <input
                    value={opportunityDraft.sourceChannel}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, sourceChannel: event.target.value })}
                    placeholder="Referral, website, tender..."
                  />
                </label>
                <label>
                  Estimated value
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={opportunityDraft.estimatedValue}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, estimatedValue: event.target.value })}
                  />
                </label>
                <label>
                  Owner
                  <input
                    value={opportunityDraft.ownerName}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, ownerName: event.target.value })}
                  />
                </label>
                <label>
                  Next follow-up
                  <input
                    type="datetime-local"
                    value={opportunityDraft.nextFollowUpAt}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, nextFollowUpAt: event.target.value })}
                  />
                </label>
                <label>
                  Decision target
                  <input
                    type="datetime-local"
                    value={opportunityDraft.targetDecisionAt}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, targetDecisionAt: event.target.value })}
                  />
                </label>
                <label>
                  Address
                  <input
                    value={opportunityDraft.address}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, address: event.target.value })}
                  />
                </label>
                <label>
                  City
                  <input
                    value={opportunityDraft.city}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, city: event.target.value })}
                  />
                </label>
                {opportunityDraft.stage === 'lost' ? (
                  <label className="form-span">
                    Loss reason
                    <textarea
                      required
                      minLength="4"
                      value={opportunityDraft.lostReason}
                      onChange={(event) => setOpportunityDraft({ ...opportunityDraft, lostReason: event.target.value })}
                      placeholder="Retain why this opportunity was not won."
                    />
                  </label>
                ) : null}
                <label className="form-span">
                  Scope and qualification notes
                  <textarea
                    value={opportunityDraft.description}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, description: event.target.value })}
                    placeholder="Need, access, constraints, decision process and scope assumptions."
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeOpportunityEditor}>
                  Cancel
                </button>
                <button className="primary-button" disabled={submitting || opportunityDraft.title.trim().length < 2}>
                  {submitting ? 'Saving...' : opportunityEditor.mode === 'create' ? 'Retain opportunity' : 'Save changes'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {opportunityActivity ? (
        <div className="modal-backdrop opportunity-activity-backdrop" role="presentation">
          <section
            className="modal opportunity-activity-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="opportunity-activity-title"
            data-testid="opportunity-activity-modal"
          >
            <div className="modal-heading">
              <div>
                <h2 id="opportunity-activity-title">Add pipeline activity</h2>
                <p>{opportunityActivity.title} / internal ledger only</p>
              </div>
              <button className="icon-button" aria-label="Close opportunity activity" onClick={() => setOpportunityActivity(null)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitOpportunityActivity}>
              <div className="form-grid opportunity-activity-form">
                <label>
                  Activity type
                  <select
                    value={opportunityActivityDraft.activityType}
                    onChange={(event) => setOpportunityActivityDraft({ ...opportunityActivityDraft, activityType: event.target.value })}
                  >
                    <option value="follow_up">Follow-up</option>
                    <option value="qualification">Qualification</option>
                    <option value="site_visit">Site visit</option>
                    <option value="estimate_review">Estimate review</option>
                    <option value="note">Note</option>
                  </select>
                </label>
                <label>
                  Due
                  <input
                    type="datetime-local"
                    value={opportunityActivityDraft.dueAt}
                    onChange={(event) => setOpportunityActivityDraft({ ...opportunityActivityDraft, dueAt: event.target.value })}
                  />
                </label>
                <label className="form-span">
                  Summary
                  <input
                    required
                    minLength="3"
                    value={opportunityActivityDraft.summary}
                    onChange={(event) => setOpportunityActivityDraft({ ...opportunityActivityDraft, summary: event.target.value })}
                    placeholder="Confirm site visit availability"
                  />
                </label>
                <label className="form-span">
                  Internal notes
                  <textarea
                    value={opportunityActivityDraft.notes}
                    onChange={(event) => setOpportunityActivityDraft({ ...opportunityActivityDraft, notes: event.target.value })}
                    placeholder="Context for the office. This does not send a message."
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setOpportunityActivity(null)}>
                  Cancel
                </button>
                <button className="primary-button" disabled={submitting || opportunityActivityDraft.summary.trim().length < 3}>
                  {submitting ? 'Saving...' : 'Retain activity'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {showIntake ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="intake-title">
            <div className="modal-heading">
              <div>
                <h2 id="intake-title">New intake</h2>
                <p>Create an auditable local job record.</p>
              </div>
              <button className="icon-button" aria-label="Close intake" onClick={() => setShowIntake(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={createIntake}>
              <div className="form-grid">
                <label>
                  Client name
                  <input
                    required
                    value={intake.clientName}
                    onChange={(event) => setIntake({ ...intake, clientName: event.target.value })}
                  />
                </label>
                <label>
                  Job title
                  <input required value={intake.title} onChange={(event) => setIntake({ ...intake, title: event.target.value })} />
                </label>
                <label>
                  Service
                  <input
                    value={intake.service}
                    onChange={(event) => setIntake({ ...intake, service: event.target.value })}
                    placeholder="Renovation, maintenance..."
                  />
                </label>
                <label>
                  Location
                  <input value={intake.address} onChange={(event) => setIntake({ ...intake, address: event.target.value })} />
                </label>
                <label>
                  Priority
                  <select value={intake.priority} onChange={(event) => setIntake({ ...intake, priority: event.target.value })}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </label>
                <label className="form-span">
                  Scope
                  <textarea
                    value={intake.description}
                    onChange={(event) => setIntake({ ...intake, description: event.target.value })}
                    placeholder="Describe the work, constraints and desired timing."
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setShowIntake(false)}>
                  Cancel
                </button>
                <button className="primary-button" disabled={submitting}>
                  {submitting ? 'Saving...' : 'Create intake'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {resourceAction ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal resource-control-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="resource-control-title"
            data-testid="resource-control-modal"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Retained resource control</p>
                <h2 id="resource-control-title">{resourceAction.label}</h2>
                <p>
                  {resourceAction.item.jobTitle} /{' '}
                  {resourceAction.material?.name ||
                    resourceAction.procurementOrder?.supplier ||
                    resourceActionDraft.workerName ||
                    'Resource record'}
                </p>
              </div>
              <button className="icon-button" aria-label="Close resource control" onClick={closeResourceControl}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitResourceControl}>
              <div className="form-grid">
                <div className="field-record-context form-span">
                  <span>Queue state</span>
                  <strong>{formatStatus(resourceAction.item.workforceStatus || resourceAction.item.inventoryStatus)}</strong>
                  <p>{resourceAction.action.label}</p>
                </div>

                {['complete_worker_orientation', 'prepare_site_access'].includes(resourceAction.action.type) ? (
                  <>
                    <label>
                      Worker name
                      <input
                        required
                        value={resourceActionDraft.workerName}
                        onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, workerName: event.target.value })}
                      />
                    </label>
                    <label>
                      Company
                      <input
                        required
                        value={resourceActionDraft.company}
                        onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, company: event.target.value })}
                      />
                    </label>
                    {resourceAction.action.type === 'complete_worker_orientation' ? (
                      <label className="form-span">
                        Orientation verification reference
                        <input
                          required
                          value={resourceActionDraft.reference}
                          onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, reference: event.target.value })}
                          placeholder="Induction record, credential, or signed evidence reference"
                        />
                      </label>
                    ) : null}
                  </>
                ) : null}

                {resourceAction.action.type === 'record_time_log' ? (
                  <>
                    <label>
                      Worker name
                      <input
                        required
                        value={resourceActionDraft.workerName}
                        onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, workerName: event.target.value })}
                      />
                    </label>
                    <label>
                      Work date
                      <input
                        required
                        type="date"
                        value={resourceActionDraft.workDate}
                        onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, workDate: event.target.value })}
                      />
                    </label>
                    <label>
                      Hours
                      <input
                        required
                        type="number"
                        min="0.25"
                        max="24"
                        step="0.25"
                        value={resourceActionDraft.hours}
                        onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, hours: event.target.value })}
                      />
                    </label>
                    <label>
                      Hourly rate (EUR)
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={resourceActionDraft.rate}
                        onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, rate: event.target.value })}
                      />
                    </label>
                    <label>
                      Cost code
                      <input
                        value={resourceActionDraft.costCode}
                        onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, costCode: event.target.value })}
                      />
                    </label>
                    <label>
                      Time evidence reference
                      <input
                        value={resourceActionDraft.reference}
                        onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, reference: event.target.value })}
                        placeholder="Timesheet, field report, or supervisor reference"
                      />
                    </label>
                  </>
                ) : null}

                {resourceAction.action.type === 'review_material_status' ? (
                  <>
                    <label>
                      Internal state
                      <select
                        value={resourceActionDraft.materialStatus}
                        onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, materialStatus: event.target.value })}
                      >
                        <option value="available">Available</option>
                        <option value="received">Received</option>
                        <option value="allocated">Allocated to job</option>
                        <option value="loaded">Loaded for dispatch</option>
                        <option value="used">Used on job</option>
                      </select>
                    </label>
                    <label>
                      Verified quantity
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={resourceActionDraft.availableQuantity}
                        onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, availableQuantity: event.target.value })}
                      />
                    </label>
                    <label>
                      Storage or job location
                      <input
                        required
                        value={resourceActionDraft.location}
                        onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, location: event.target.value })}
                        placeholder="Warehouse bay, vehicle, or job area"
                      />
                    </label>
                    <label>
                      Verification reference
                      <input
                        required
                        value={resourceActionDraft.reference}
                        onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, reference: event.target.value })}
                        placeholder="Delivery note, count sheet, or inspection reference"
                      />
                    </label>
                  </>
                ) : null}

                {resourceAction.action.type === 'request_procurement_approval' ? (
                  <>
                    <label className="form-span">
                      Trade partner
                      <select
                        required
                        value={resourceActionDraft.tradePartnerId}
                        onChange={(event) => {
                          const partner = tradePartners.find((candidate) => candidate.id === event.target.value)
                          setResourceActionDraft({
                            ...resourceActionDraft,
                            tradePartnerId: partner?.id || '',
                            supplier: partner?.name || '',
                          })
                        }}
                      >
                        <option value="">Select a retained supplier</option>
                        {tradePartners
                          .filter((partner) => partner.status !== 'retired')
                          .map((partner) => (
                            <option key={partner.id} value={partner.id}>
                              {partner.name} / {formatStatus(partner.compliance?.status || 'needs_review')}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className="partner-selection-note form-span">
                      <p>
                        {resourceActionDraft.tradePartnerId
                          ? 'Compliance is checked again when an approver resolves this request.'
                          : 'A retained partner with current registration, tax, and required safety evidence is mandatory.'}
                      </p>
                      <button type="button" className="secondary-button" onClick={openTradePartnerDirectory}>
                        <Building2 size={15} />
                        Manage trade partners
                      </button>
                    </div>
                    <label>
                      Order value (EUR)
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={resourceActionDraft.amount}
                        onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, amount: event.target.value })}
                      />
                    </label>
                    <label>
                      Required by
                      <input
                        required
                        type="date"
                        value={resourceActionDraft.requiredBy}
                        onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, requiredBy: event.target.value })}
                      />
                    </label>
                  </>
                ) : null}

                <label className="form-span">
                  Internal evidence and notes
                  <textarea
                    required
                    value={resourceActionDraft.notes}
                    onChange={(event) => setResourceActionDraft({ ...resourceActionDraft, notes: event.target.value })}
                    placeholder="Record what was checked, by whom, and what this status can safely be used for."
                  />
                </label>
                <p className="workflow-note form-span">
                  This screen changes retained internal evidence only. It cannot clear site access without approval, contact a worker or
                  supplier, place an order, commit spend, or submit payroll.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeResourceControl}>
                  Cancel
                </button>
                <button
                  className="primary-button"
                  disabled={
                    submitting ||
                    !resourceActionDraft.notes.trim() ||
                    (resourceAction.action.type === 'request_procurement_approval' &&
                      (!resourceActionDraft.tradePartnerId || !(Number(resourceActionDraft.amount) > 0) || !resourceActionDraft.requiredBy))
                  }
                >
                  <ShieldCheck size={16} />
                  {submitting
                    ? 'Recording...'
                    : resourceAction.action.type === 'complete_worker_orientation'
                      ? 'Request orientation approval'
                      : resourceAction.action.type === 'prepare_site_access'
                        ? 'Create access gate'
                        : resourceAction.action.type === 'request_procurement_approval'
                          ? 'Request procurement approval'
                          : 'Record internal evidence'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {invoiceJob ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal invoice-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-draft-title"
            data-testid="invoice-draft-modal"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Approval-gated finance</p>
                <h2 id="invoice-draft-title">{invoiceJob.billingMilestone ? 'Draft milestone invoice' : 'Draft invoice'}</h2>
                <p>
                  {invoiceJob.jobTitle} / {invoiceJob.clientName || 'Client not set'}
                </p>
              </div>
              <button className="icon-button" aria-label="Close invoice draft" onClick={closeInvoiceDraft}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={createInvoiceDraft}>
              <div className="form-grid">
                {invoiceJob.billingMilestone ? (
                  <div className="workflow-result form-span" data-testid="invoice-milestone-source">
                    <div>
                      <strong>
                        Milestone {invoiceJob.billingMilestone.sequenceNumber}: {invoiceJob.billingMilestone.title}
                      </strong>
                      <span>The approved net amount, VAT rate, and payment date are locked to this retained billing plan.</span>
                    </div>
                    <span className="tag tag-green">Approved source</span>
                  </div>
                ) : null}
                <label>
                  Net amount (EUR)
                  <input
                    required
                    readOnly={Boolean(invoiceDraft.billingMilestoneId)}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={invoiceDraft.amount}
                    onChange={(event) => setInvoiceDraft({ ...invoiceDraft, amount: event.target.value })}
                  />
                </label>
                <label>
                  VAT rate (%)
                  <input
                    required
                    readOnly={Boolean(invoiceDraft.billingMilestoneId)}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={invoiceDraft.taxRate}
                    onChange={(event) => setInvoiceDraft({ ...invoiceDraft, taxRate: event.target.value })}
                  />
                </label>
                <label>
                  Due date
                  <input
                    required
                    readOnly={Boolean(invoiceDraft.billingMilestoneId)}
                    type="date"
                    value={invoiceDraft.dueAt}
                    onChange={(event) => setInvoiceDraft({ ...invoiceDraft, dueAt: event.target.value })}
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={invoiceDraft.peppolReady}
                    onChange={(event) => setInvoiceDraft({ ...invoiceDraft, peppolReady: event.target.checked })}
                  />
                  Prepare Peppol BIS / UBL 2.1 export
                </label>
                {invoiceDraft.peppolReady ? (
                  <>
                    <label>
                      Buyer reference
                      <input
                        required={!invoiceDraft.purchaseOrderReference.trim()}
                        value={invoiceDraft.buyerReference}
                        onChange={(event) => setInvoiceDraft({ ...invoiceDraft, buyerReference: event.target.value })}
                        placeholder="Reference supplied by the buyer"
                      />
                    </label>
                    <label>
                      Purchase-order reference
                      <input
                        required={!invoiceDraft.buyerReference.trim()}
                        value={invoiceDraft.purchaseOrderReference}
                        onChange={(event) => setInvoiceDraft({ ...invoiceDraft, purchaseOrderReference: event.target.value })}
                      />
                    </label>
                    <label className="form-span">
                      Buyer legal name
                      <input
                        required
                        value={invoiceDraft.buyerLegalName}
                        onChange={(event) => setInvoiceDraft({ ...invoiceDraft, buyerLegalName: event.target.value })}
                      />
                    </label>
                    <label>
                      Buyer KVK / OIN
                      <input
                        value={invoiceDraft.buyerRegistrationNumber}
                        onChange={(event) => setInvoiceDraft({ ...invoiceDraft, buyerRegistrationNumber: event.target.value })}
                      />
                    </label>
                    <label>
                      Endpoint scheme
                      <input
                        required
                        value={invoiceDraft.buyerEndpointScheme}
                        onChange={(event) => setInvoiceDraft({ ...invoiceDraft, buyerEndpointScheme: event.target.value })}
                        placeholder="0106 for KVK"
                      />
                    </label>
                    <label>
                      Buyer electronic address
                      <input
                        required
                        value={invoiceDraft.buyerEndpointId}
                        onChange={(event) => setInvoiceDraft({ ...invoiceDraft, buyerEndpointId: event.target.value })}
                      />
                    </label>
                    <label className="form-span">
                      Buyer street address
                      <input
                        required
                        value={invoiceDraft.buyerAddress}
                        onChange={(event) => setInvoiceDraft({ ...invoiceDraft, buyerAddress: event.target.value })}
                      />
                    </label>
                    <label>
                      Buyer postal code
                      <input
                        required
                        value={invoiceDraft.buyerPostalCode}
                        onChange={(event) => setInvoiceDraft({ ...invoiceDraft, buyerPostalCode: event.target.value })}
                      />
                    </label>
                    <label>
                      Buyer city
                      <input
                        required
                        value={invoiceDraft.buyerCity}
                        onChange={(event) => setInvoiceDraft({ ...invoiceDraft, buyerCity: event.target.value })}
                      />
                    </label>
                    <label>
                      Buyer country
                      <input
                        required
                        maxLength="2"
                        value={invoiceDraft.buyerCountry}
                        onChange={(event) => setInvoiceDraft({ ...invoiceDraft, buyerCountry: event.target.value.toUpperCase() })}
                      />
                    </label>
                  </>
                ) : null}
                <label className="form-span">
                  Internal finance note
                  <textarea
                    value={invoiceDraft.notes}
                    onChange={(event) => setInvoiceDraft({ ...invoiceDraft, notes: event.target.value })}
                  />
                </label>
                <div className="invoice-preview form-span" aria-label="Invoice calculation">
                  <span>
                    Net <strong>{currency.format(invoiceAmount)}</strong>
                  </span>
                  <span>
                    VAT <strong>{currency.format(invoiceTaxAmount)}</strong>
                  </span>
                  <span>
                    Total <strong>{currency.format(invoiceTotal)}</strong>
                  </span>
                </div>
                <p className="workflow-note form-span">
                  This creates a retained draft and approval record only. Structured export is generated after invoice approval; delivery
                  and Peppol transport remain blocked until separately verified.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeInvoiceDraft}>
                  Cancel
                </button>
                <button className="primary-button" disabled={submitting || invoiceAmount <= 0}>
                  <ReceiptEuro size={16} />
                  {submitting ? 'Creating...' : 'Create approval-gated draft'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {clientAction ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal client-action-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-action-title"
            data-testid="client-lifecycle-modal"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Retained client lifecycle</p>
                <h2 id="client-action-title">{clientAction.label}</h2>
                <p>
                  {clientAction.item.jobTitle} · {clientAction.item.clientName || 'Client record'}
                </p>
              </div>
              <button className="icon-button" aria-label="Close client lifecycle review" onClick={closeClientLifecycle}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitClientLifecycle}>
              <div className="form-grid">
                {clientAction.type === 'selection' ? (
                  <>
                    <label>
                      Retained option
                      <select required value={clientActionOption} onChange={(event) => setClientActionOption(event.target.value)}>
                        <option value="">Select the confirmed option</option>
                        {(clientAction.record?.options || []).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Client confirmation reference
                      <input
                        required
                        value={clientActionReference}
                        onChange={(event) => setClientActionReference(event.target.value)}
                        placeholder="Portal reply, signed form, email, or call record"
                      />
                    </label>
                  </>
                ) : null}
                <label className="form-span">
                  Evidence and outcome
                  <textarea
                    required
                    value={clientActionNotes}
                    onChange={(event) => setClientActionNotes(event.target.value)}
                    placeholder="Record what was inspected, completed, agreed, or still needs review."
                  />
                </label>
                <p className="workflow-note form-span">
                  {clientAction.type === 'aftercare'
                    ? 'Completing aftercare updates the internal ledger only. It does not send a client message.'
                    : clientAction.type === 'selection'
                      ? 'The selected option remains pending until an approver reviews the confirmation evidence. No procurement, scope, price, or schedule commitment is made here.'
                      : 'The requested resolution remains pending until an approver reviews it. No acceptance or warranty commitment is communicated from this screen.'}
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeClientLifecycle}>
                  Cancel
                </button>
                <button
                  className="primary-button"
                  disabled={
                    submitting ||
                    !clientActionNotes.trim() ||
                    (clientAction.type === 'selection' && (!clientActionOption || !clientActionReference.trim()))
                  }
                >
                  <ShieldCheck size={16} />
                  {submitting
                    ? 'Recording...'
                    : clientAction.type === 'aftercare'
                      ? 'Complete internal follow-up'
                      : clientAction.type === 'selection'
                        ? 'Request selection approval'
                        : 'Request resolution approval'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {financeAction ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal finance-control-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="finance-control-title"
            data-testid="finance-control-modal"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Retained finance control</p>
                <h2 id="finance-control-title">{financeAction.label}</h2>
                <p>
                  {financeAction.item.jobTitle} / {financeAction.item.clientName || 'Client finance record'}
                </p>
              </div>
              <button className="icon-button" aria-label="Close finance control" onClick={closeFinanceControl}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitFinanceControl}>
              <div className="form-grid">
                <div className="field-record-context form-span">
                  <span>Ledger context</span>
                  <strong>{formatStatus(financeAction.item.financeStatus)}</strong>
                  <p>
                    Contract {currency.format(financeAction.item.money?.contractValue || 0)} / unpaid{' '}
                    {currency.format(financeAction.item.money?.unpaidValue || 0)} / received{' '}
                    {currency.format(financeAction.item.money?.receivedValue || 0)}
                  </p>
                </div>

                {financeAction.action.type === 'create_credit_note' ? (
                  <>
                    <label>
                      Net credit amount (EUR)
                      <input
                        required
                        type="number"
                        min="0.01"
                        max={financeAction.action.availableNetAmount || undefined}
                        step="0.01"
                        value={financeActionDraft.amount}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, amount: event.target.value })}
                      />
                    </label>
                    <label>
                      VAT rate (%)
                      <input readOnly value={financeCreditTaxRate} />
                    </label>
                    <label className="form-span">
                      Credit-line description
                      <input
                        maxLength={500}
                        value={financeActionDraft.description}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, description: event.target.value })}
                        placeholder={`Correction for invoice ${financeAction.action.invoiceReference || ''}`}
                      />
                    </label>
                    <div className="invoice-preview form-span" aria-label="Credit note calculation">
                      <span>
                        Net credit <strong>{currency.format(financeControlAmount)}</strong>
                      </span>
                      <span>
                        VAT correction <strong>{currency.format(financeCreditTax)}</strong>
                      </span>
                      <span>
                        Total credit <strong>{currency.format(financeCreditTotal)}</strong>
                      </span>
                    </div>
                    <p className="workflow-note form-span">
                      Available invoice balance: {currency.format(financeAction.action.availableAmount || 0)}. The draft reserves that
                      amount against concurrent payment or credit requests; only approved immutable package preparation reduces the
                      receivable. Delivery and Peppol transport remain separately gated.
                    </p>
                  </>
                ) : null}

                {financeAction.action.type === 'record_supplier_invoice' ? (
                  <>
                    <label>
                      Supplier
                      <input
                        required
                        maxLength={240}
                        value={financeActionDraft.vendor}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, vendor: event.target.value })}
                      />
                    </label>
                    <label>
                      Supplier invoice number
                      <input
                        required
                        maxLength={120}
                        value={financeActionDraft.invoiceNumber}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, invoiceNumber: event.target.value })}
                      />
                    </label>
                    <label>
                      Invoice date
                      <input
                        required
                        type="date"
                        value={financeActionDraft.invoiceDate}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, invoiceDate: event.target.value })}
                      />
                    </label>
                    <label>
                      Due date
                      <input
                        required
                        type="date"
                        min={financeActionDraft.invoiceDate}
                        value={financeActionDraft.dueAt}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, dueAt: event.target.value })}
                      />
                    </label>
                    <label>
                      Net amount (EUR)
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={financeActionDraft.amount}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, amount: event.target.value })}
                      />
                    </label>
                    <label>
                      VAT amount (EUR)
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={financeActionDraft.taxAmount}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, taxAmount: event.target.value })}
                      />
                    </label>
                    <label className="form-span">
                      Delivery or service evidence reference
                      <input
                        required
                        maxLength={240}
                        value={financeActionDraft.deliveryReference}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, deliveryReference: event.target.value })}
                        placeholder="Goods receipt, signed work ticket, or retained document reference"
                      />
                    </label>
                    <div className="invoice-preview form-span" aria-label="Supplier invoice calculation">
                      <span>
                        Purchase commitment <strong>{currency.format(financeAction.action.committedAmount || 0)}</strong>
                      </span>
                      <span>
                        Net invoice <strong>{currency.format(financeControlAmount)}</strong>
                      </span>
                      <span>
                        VAT <strong>{currency.format(financeSupplierTax)}</strong>
                      </span>
                      <span>
                        Total payable <strong>{currency.format(financeSupplierTotal)}</strong>
                      </span>
                    </div>
                    <p className="workflow-note form-span">
                      The ledger checks supplier, currency, net amount, approved purchase order, delivery evidence, duplicate invoice
                      number, and supplier compliance. Any exception requires an explicit approver override.
                    </p>
                  </>
                ) : null}

                {financeAction.action.type === 'record_supplier_payment' ? (
                  <>
                    <div className="field-record-context form-span">
                      <span>Supplier payable</span>
                      <strong>{financeAction.action.supplierInvoiceNumber || financeAction.action.supplierInvoiceId}</strong>
                      <p>
                        {financeAction.action.supplier || 'Retained supplier'} / available{' '}
                        {currency.format(financeAction.action.availableAmount || financeAction.action.outstandingAmount || 0)}
                      </p>
                    </div>
                    <label>
                      Payment amount (EUR)
                      <input
                        required
                        type="number"
                        min="0.01"
                        max={financeAction.action.availableAmount || financeAction.action.outstandingAmount || undefined}
                        step="0.01"
                        value={financeActionDraft.amount}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, amount: event.target.value })}
                      />
                    </label>
                    <label>
                      Payment date
                      <input
                        required
                        type="date"
                        value={financeActionDraft.paidAt}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, paidAt: event.target.value })}
                      />
                    </label>
                    <label>
                      Payment method
                      <select
                        value={financeActionDraft.method}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, method: event.target.value })}
                      >
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="direct_debit">Direct debit</option>
                        <option value="card">Card</option>
                        <option value="cash">Cash</option>
                        <option value="other">Other retained evidence</option>
                      </select>
                    </label>
                    <label>
                      Bank or bookkeeping reference
                      <input
                        required
                        maxLength={240}
                        value={financeActionDraft.reference}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, reference: event.target.value })}
                      />
                    </label>
                    <p className="workflow-note form-span">
                      This confirms evidence of a payment made outside Contractor.AI. Approval is required before the payable balance
                      changes; this action cannot initiate or schedule funds movement.
                    </p>
                  </>
                ) : null}

                {financeAction.action.type === 'record_payment_reconciliation' ? (
                  <>
                    <label>
                      Reconciliation type
                      <select
                        value={financeActionDraft.outcome}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, outcome: event.target.value })}
                      >
                        <option value="received">Payment received</option>
                        <option value="written_off">Approved write-off request</option>
                      </select>
                    </label>
                    <label>
                      Settlement amount (EUR)
                      <input
                        required
                        type="number"
                        min="0.01"
                        max={financeAction.action.availableAmount || financeAction.action.outstandingAmount || undefined}
                        step="0.01"
                        value={financeActionDraft.amount}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, amount: event.target.value })}
                      />
                    </label>
                    {financeActionDraft.outcome === 'received' ? (
                      <>
                        <label>
                          Received date
                          <input
                            required
                            type="date"
                            value={financeActionDraft.paidAt}
                            onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, paidAt: event.target.value })}
                          />
                        </label>
                        <label>
                          Payment method
                          <select
                            value={financeActionDraft.method}
                            onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, method: event.target.value })}
                          >
                            <option value="bank_transfer">Bank transfer</option>
                            <option value="card">Card</option>
                            <option value="cash">Cash</option>
                            <option value="direct_debit">Direct debit</option>
                            <option value="other">Other retained evidence</option>
                          </select>
                        </label>
                      </>
                    ) : null}
                    <label className="form-span">
                      Payment or authority reference
                      <input
                        required
                        maxLength={240}
                        value={financeActionDraft.reference}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, reference: event.target.value })}
                        placeholder="Bank statement ID or approved write-off authority"
                      />
                    </label>
                    <p className="workflow-note form-span">
                      Available to reconcile:{' '}
                      {currency.format(financeAction.action.availableAmount || financeAction.action.outstandingAmount || 0)}. Approval
                      updates the invoice to partially paid, paid, or settled; duplicate references and overpayments are refused.
                    </p>
                  </>
                ) : null}

                {financeAction.action.type === 'record_payment_follow_up' ? (
                  <>
                    <label>
                      Outcome
                      <select
                        value={financeActionDraft.outcome}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, outcome: event.target.value })}
                      >
                        <option value="follow_up_recorded">Internal collection note</option>
                        <option value="received">Confirm payment received</option>
                        <option value="written_off">Request write-off</option>
                      </select>
                    </label>
                    <label>
                      Receivable amount (EUR)
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={financeActionDraft.amount}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, amount: event.target.value })}
                      />
                    </label>
                    <label>
                      Next follow-up date
                      <input
                        required
                        type="date"
                        value={financeActionDraft.dueAt}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, dueAt: event.target.value })}
                      />
                    </label>
                    <label>
                      Internal channel
                      <select
                        value={financeActionDraft.followUpChannel}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, followUpChannel: event.target.value })}
                      >
                        <option value="internal">Internal review</option>
                        <option value="phone">Phone evidence</option>
                        <option value="email">Email evidence</option>
                        <option value="portal">Portal evidence</option>
                      </select>
                    </label>
                    {financeActionDraft.outcome !== 'follow_up_recorded' ? (
                      <label className="form-span">
                        Payment or authority reference
                        <input
                          required
                          value={financeActionDraft.reference}
                          onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, reference: event.target.value })}
                          placeholder="Bank reference, statement ID, or approved write-off authority"
                        />
                      </label>
                    ) : null}
                  </>
                ) : null}

                {financeAction.action.type === 'prepare_finance_handoff' ? (
                  <>
                    <label>
                      Bookkeeping target
                      <select
                        value={financeActionDraft.targetSystem}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, targetSystem: event.target.value })}
                      >
                        <option value="FAB">FAB</option>
                        <option value="Exact Online">Exact Online</option>
                        <option value="Twinfield">Twinfield</option>
                        <option value="AFAS">AFAS</option>
                        <option value="Internal accounting">Internal accounting</option>
                      </select>
                    </label>
                    <label>
                      Package format
                      <select
                        value={financeActionDraft.exportFormat}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, exportFormat: event.target.value })}
                      >
                        <option value="json">Structured JSON</option>
                        <option value="csv">CSV package</option>
                        <option value="ubl">UBL metadata</option>
                      </select>
                    </label>
                  </>
                ) : null}

                {financeAction.action.type === 'record_time_expense' ? (
                  <>
                    <label>
                      Record date
                      <input
                        required
                        type="date"
                        value={financeActionDraft.dueAt}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, dueAt: event.target.value })}
                      />
                    </label>
                    <label>
                      Cost code
                      <input
                        value={financeActionDraft.costCode}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, costCode: event.target.value })}
                      />
                    </label>
                    <label>
                      Hours
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.25"
                        value={financeActionDraft.hours}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, hours: event.target.value })}
                      />
                    </label>
                    <label>
                      Hourly rate (EUR)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={financeActionDraft.rate}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, rate: event.target.value })}
                      />
                    </label>
                    <label>
                      Expense amount (EUR)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={financeActionDraft.expenseAmount}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, expenseAmount: event.target.value })}
                      />
                    </label>
                    <label>
                      Expense category
                      <select
                        value={financeActionDraft.category}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, category: event.target.value })}
                      >
                        <option value="materials">Materials</option>
                        <option value="equipment">Equipment</option>
                        <option value="subcontractor">Subcontractor</option>
                        <option value="travel">Travel</option>
                        <option value="general">General</option>
                      </select>
                    </label>
                    {financeControlExpense > 0 ? (
                      <>
                        <label>
                          Vendor
                          <input
                            required
                            value={financeActionDraft.vendor}
                            onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, vendor: event.target.value })}
                          />
                        </label>
                        <label>
                          Receipt reference
                          <input
                            value={financeActionDraft.reference}
                            onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, reference: event.target.value })}
                          />
                        </label>
                      </>
                    ) : null}
                  </>
                ) : null}

                {financeAction.action.type === 'create_budget_line' ? (
                  <>
                    <label>
                      Budget amount (EUR)
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={financeActionDraft.amount}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, amount: event.target.value })}
                      />
                    </label>
                    <label>
                      Forecast amount (EUR)
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={financeActionDraft.forecastAmount}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, forecastAmount: event.target.value })}
                      />
                    </label>
                    <label>
                      Cost code
                      <input
                        required
                        value={financeActionDraft.costCode}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, costCode: event.target.value })}
                      />
                    </label>
                    <label>
                      Category
                      <select
                        value={financeActionDraft.category}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, category: event.target.value })}
                      >
                        <option value="general">General</option>
                        <option value="labor">Labor</option>
                        <option value="materials">Materials</option>
                        <option value="equipment">Equipment</option>
                        <option value="subcontractor">Subcontractor</option>
                      </select>
                    </label>
                    <label className="form-span">
                      Budget description
                      <input
                        required
                        value={financeActionDraft.description}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, description: event.target.value })}
                      />
                    </label>
                  </>
                ) : null}

                {financeAction.action.type === 'create_billing_milestone' ? (
                  <>
                    <label>
                      Net milestone (EUR)
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={financeActionDraft.amount}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, amount: event.target.value })}
                      />
                    </label>
                    <label>
                      VAT rate (%)
                      <input
                        required
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={financeActionDraft.taxRate}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, taxRate: event.target.value })}
                      />
                    </label>
                    <label>
                      Planned invoice date
                      <input
                        required
                        type="date"
                        value={financeActionDraft.plannedIssueAt}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, plannedIssueAt: event.target.value })}
                      />
                    </label>
                    <label>
                      Payment due date
                      <input
                        required
                        type="date"
                        value={financeActionDraft.dueAt}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, dueAt: event.target.value })}
                      />
                    </label>
                    <label className="form-span">
                      Milestone description
                      <input
                        required
                        value={financeActionDraft.description}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, description: event.target.value })}
                      />
                    </label>
                    <div className="invoice-preview form-span" aria-label="Billing milestone calculation">
                      <span>
                        Net <strong>{currency.format(financeControlAmount)}</strong>
                      </span>
                      <span>
                        VAT{' '}
                        <strong>
                          {currency.format(roundMoney((financeControlAmount * (Number(financeActionDraft.taxRate) || 0)) / 100))}
                        </strong>
                      </span>
                      <span>
                        Total{' '}
                        <strong>
                          {currency.format(roundMoney(financeControlAmount * (1 + (Number(financeActionDraft.taxRate) || 0) / 100)))}
                        </strong>
                      </span>
                    </div>
                  </>
                ) : null}

                {financeAction.action.type === 'create_draw_request' ? (
                  <>
                    <label>
                      Draw amount (EUR)
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={financeActionDraft.amount}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, amount: event.target.value })}
                      />
                    </label>
                    <label>
                      Work complete (%)
                      <input
                        required
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={financeActionDraft.percentComplete}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, percentComplete: event.target.value })}
                      />
                    </label>
                    <label>
                      Review due date
                      <input
                        required
                        type="date"
                        value={financeActionDraft.dueAt}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, dueAt: event.target.value })}
                      />
                    </label>
                  </>
                ) : null}

                {financeAction.action.type === 'request_lien_waiver' ? (
                  <>
                    <label>
                      Waiver amount (EUR)
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={financeActionDraft.amount}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, amount: event.target.value })}
                      />
                    </label>
                    <label>
                      Supplier or party
                      <input
                        required
                        value={financeActionDraft.vendor}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, vendor: event.target.value })}
                      />
                    </label>
                    <label>
                      Waiver type
                      <select
                        value={financeActionDraft.waiverType}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, waiverType: event.target.value })}
                      >
                        <option value="conditional">Conditional</option>
                        <option value="unconditional">Unconditional</option>
                      </select>
                    </label>
                    <label>
                      Request due date
                      <input
                        required
                        type="date"
                        value={financeActionDraft.dueAt}
                        onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, dueAt: event.target.value })}
                      />
                    </label>
                  </>
                ) : null}

                <label className="form-span">
                  Internal evidence and notes
                  <textarea
                    required
                    value={financeActionDraft.notes}
                    onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, notes: event.target.value })}
                    placeholder="Record the source evidence, calculation, collection history, receipt, or review basis."
                  />
                </label>
                <p className="workflow-note form-span">
                  This screen only changes the retained ledger. It cannot move funds, contact a client or supplier, submit a draw, release a
                  waiver, or export bookkeeping data.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeFinanceControl}>
                  Cancel
                </button>
                <button className="primary-button" disabled={submitting || !financeActionDraft.notes.trim()}>
                  <ShieldCheck size={16} />
                  {submitting
                    ? 'Recording...'
                    : financeAction.action.type === 'create_credit_note'
                      ? 'Request credit-note approval'
                      : financeAction.action.type === 'record_supplier_invoice'
                        ? 'Request payable approval'
                        : financeAction.action.type === 'record_supplier_payment'
                          ? 'Request payment confirmation'
                          : financeAction.action.type === 'create_billing_milestone'
                            ? 'Request milestone approval'
                            : financeAction.action.type === 'record_time_expense'
                              ? 'Record ledger costs'
                              : financeAction.action.type === 'request_lien_waiver'
                                ? 'Retain waiver request'
                                : financeAction.action.type === 'record_payment_follow_up' &&
                                    financeActionDraft.outcome === 'follow_up_recorded'
                                  ? 'Record internal follow-up'
                                  : 'Request approver review'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {fieldAction ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal field-action-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="field-action-title"
            data-testid="field-assurance-modal"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Retained assurance review</p>
                <h2 id="field-action-title">{fieldAction.label}</h2>
                <p>
                  {fieldAction.item.jobTitle} /{' '}
                  {fieldAction.record?.title ||
                    fieldAction.record?.material ||
                    fieldAction.record?.workerName ||
                    formatStatus(fieldAction.type)}
                </p>
              </div>
              <button className="icon-button" aria-label="Close assurance review" onClick={closeFieldReview}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitFieldReview}>
              <div className="form-grid">
                <div className="field-record-context form-span">
                  <span>Current state</span>
                  <strong>{formatStatus(fieldAction.record?.status)}</strong>
                  {fieldAction.record?.question ? <p>{fieldAction.record.question}</p> : null}
                  {fieldAction.record?.workerName ? (
                    <p>
                      Worker: {fieldAction.record.workerName}
                      {fieldAction.record.company ? ' / ' + fieldAction.record.company : ''}
                    </p>
                  ) : null}
                  {fieldAction.record?.hazards?.length ? (
                    <p>
                      {fieldAction.record.hazards.length} hazard{fieldAction.record.hazards.length === 1 ? '' : 's'} retained with controls
                      for review.
                    </p>
                  ) : null}
                  {fieldAction.record?.defects?.length ? (
                    <p>
                      {fieldAction.record.defects.length} retained defect{fieldAction.record.defects.length === 1 ? '' : 's'} require
                      resolution evidence.
                    </p>
                  ) : null}
                  {fieldAction.record?.expiresAt ? <p>Current expiry: {formatDate(fieldAction.record.expiresAt)}</p> : null}
                </div>
                {['permit', 'sds'].includes(fieldAction.type) ? (
                  <label>
                    {fieldAction.type === 'sds' ? 'SDS expiry' : 'Proposed expiry'}
                    <input required type="date" value={fieldActionDate} onChange={(event) => setFieldActionDate(event.target.value)} />
                  </label>
                ) : null}
                {fieldAction.type === 'sds' ? (
                  <label className="form-span">
                    SDS document reference
                    <input
                      required
                      value={fieldActionReference}
                      onChange={(event) => setFieldActionReference(event.target.value)}
                      placeholder="Storage reference, controlled document ID, or verified source"
                    />
                  </label>
                ) : null}
                {fieldAction.type === 'safety_meeting' ? (
                  <label className="form-span">
                    Attendees
                    <input
                      required
                      value={fieldActionReference}
                      onChange={(event) => setFieldActionReference(event.target.value)}
                      placeholder="Names or retained attendance reference"
                    />
                  </label>
                ) : null}
                {fieldAction.type === 'orientation' ? (
                  <label className="form-span">
                    Verification reference
                    <input
                      required
                      value={fieldActionReference}
                      onChange={(event) => setFieldActionReference(event.target.value)}
                      placeholder="Induction record, credential, or checked evidence reference"
                    />
                  </label>
                ) : null}
                {fieldAction.type === 'document' ? (
                  <label className="form-span">
                    Document review reference
                    <input
                      required
                      value={fieldActionReference}
                      onChange={(event) => setFieldActionReference(event.target.value)}
                      placeholder="Controlled document revision, reviewer record, or storage reference"
                    />
                  </label>
                ) : null}
                <label className="form-span">
                  {fieldAction.type === 'rfi' ? 'Response and evidence' : 'Evidence and decision'}
                  <textarea
                    required
                    value={fieldActionNotes}
                    onChange={(event) => setFieldActionNotes(event.target.value)}
                    placeholder="Record the source, inspection, corrective work, or decision evidence an approver should rely on."
                  />
                </label>
                <p className="workflow-note form-span">
                  This records a proposed lifecycle transition. Field reliance, acceptance, publication, and external commitments remain
                  blocked until the approval is resolved.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeFieldReview}>
                  Cancel
                </button>
                <button
                  className="primary-button"
                  disabled={
                    submitting ||
                    !fieldActionNotes.trim() ||
                    (['permit', 'sds'].includes(fieldAction.type) && !fieldActionDate) ||
                    (['sds', 'safety_meeting', 'orientation', 'document'].includes(fieldAction.type) && !fieldActionReference.trim())
                  }
                >
                  <ShieldCheck size={16} />
                  {submitting ? 'Recording...' : 'Request approver review'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {showResourcePlanner && selectedJob ? (
        <div className="modal-backdrop resource-backdrop" role="presentation">
          <section
            className="modal resource-planner"
            role="dialog"
            aria-modal="true"
            aria-labelledby="resource-planner-title"
            data-testid="resource-planner"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Internal work plan</p>
                <h2 id="resource-planner-title">Crew and equipment</h2>
                <p>
                  {selectedJob.title} · {formatDate(scheduleDraft.plannedStart)}
                </p>
              </div>
              <button className="icon-button" aria-label="Close resource planner" onClick={() => setShowResourcePlanner(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="resource-planner-body">
              <p className="workflow-note">
                Planning remains internal. Conflicts become approval records; this screen cannot contact crew, suppliers, or clients.
              </p>
              <div className="resource-forms">
                <form className="form-grid compact-form" onSubmit={assignWorker}>
                  <label className="form-span">
                    Crew member
                    <select
                      aria-label="Crew member"
                      required
                      value={resourceDraft.workerId}
                      onChange={(event) => setResourceDraft({ ...resourceDraft, workerId: event.target.value })}
                    >
                      <option value="">Select a ledger worker</option>
                      {resourceOptions.workers.map((worker) => (
                        <option key={worker.id} value={worker.id}>
                          {worker.name} · {worker.role || 'Contractor'} · {formatStatus(worker.status)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="form-actions form-span">
                    <button className="secondary-button" disabled={submitting || !resourceOptions.workers.length}>
                      <Users size={16} />
                      Add crew assignment
                    </button>
                  </div>
                </form>
                <form className="form-grid compact-form" onSubmit={reserveTool}>
                  <label className="form-span">
                    Equipment
                    <select
                      aria-label="Equipment"
                      required
                      value={resourceDraft.toolId}
                      onChange={(event) => setResourceDraft({ ...resourceDraft, toolId: event.target.value })}
                    >
                      <option value="">Select registered equipment</option>
                      {resourceOptions.tools.map((tool) => (
                        <option key={tool.id} value={tool.id}>
                          {tool.name} · {tool.category || 'Equipment'} · {formatStatus(tool.status)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="form-actions form-span">
                    <button className="secondary-button" disabled={submitting || !resourceOptions.tools.length}>
                      <Wrench size={16} />
                      Reserve equipment
                    </button>
                  </div>
                </form>
              </div>
              <div className="resource-ledger">
                <section>
                  <h3>Crew plan</h3>
                  {selectedJob.assignments?.length ? (
                    <div className="activity-list">
                      {selectedJob.assignments.map((assignment) => (
                        <div className="activity-row" key={assignment.id}>
                          <div>
                            <strong>
                              {assignment.workerName || 'Ledger worker'} · {assignment.role || 'Contractor'}
                            </strong>
                            <small>
                              {formatDate(assignment.scheduledStart)} · {formatStatus(assignment.status)}
                              {assignment.requiresApproval ? ' · approval required' : ''}
                            </small>
                          </div>
                          {!['released', 'cancelled', 'completed', 'closed', 'rejected', 'declined'].includes(assignment.status) ? (
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={submitting}
                              aria-label={`Release assignment for ${assignment.workerName || 'worker'}`}
                              onClick={() => releaseAssignment(assignment.id)}
                            >
                              <Ban size={15} />
                              Release
                            </button>
                          ) : (
                            <span className={`status status-${assignment.status}`}>{formatStatus(assignment.status)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="workflow-note">No crew member is allocated to this job window.</p>
                  )}
                </section>
                <section>
                  <h3>Equipment plan</h3>
                  {selectedJob.tools?.length ? (
                    <div className="activity-list">
                      {selectedJob.tools.map((reservation) => (
                        <div className="activity-row" key={reservation.id}>
                          <div>
                            <strong>{reservation.toolName}</strong>
                            <small>
                              {formatDate(reservation.neededFrom)} · {formatStatus(reservation.status)}
                              {reservation.requiresApproval ? ' · approval required' : ''}
                            </small>
                          </div>
                          {!['released', 'returned', 'cancelled', 'rejected', 'declined', 'completed', 'closed'].includes(
                            reservation.status,
                          ) ? (
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={submitting}
                              aria-label={`Release ${reservation.toolName}`}
                              onClick={() => releaseToolReservation(reservation.id)}
                            >
                              <Ban size={15} />
                              Release
                            </button>
                          ) : (
                            <span className={`status status-${reservation.status}`}>{formatStatus(reservation.status)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="workflow-note">No equipment is reserved for this job window.</p>
                  )}
                </section>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {mobileNavOpen ? <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} /> : null}
    </div>
  )
}

export default App
