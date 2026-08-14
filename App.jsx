import { createElement, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  CalendarOff,
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
  Leaf,
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
  Ruler,
  Search,
  Send,
  ShieldCheck,
  Target,
  Timer,
  TriangleAlert,
  Undo2,
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
import {
  currency,
  EMPTY_LIST,
  formatDate,
  formatDateTime,
  formatStatus,
  futureDateInput,
  mondayDateInput,
  RESOURCE_ACTION_LABELS,
  roundDisplay,
  setDashboardLocale,
  shortHash,
  toIsoDateTime,
  toLocalDateTimeInput,
} from './dashboard-format'
import { appText, normalizeLocale, SUPPORTED_LOCALES } from './locale'
import {
  browserDraftStorage,
  clearSessionDraftScope,
  useSessionDraftRecovery,
} from './draft-recovery'
import Empty from './components/EmptyState'
import './App.css'

const ResourcesWorkspace = lazy(() => import('./components/ResourcesWorkspace'))
const AuditHistory = lazy(() => import('./components/AuditHistory'))
const CashFlowForecastControl = lazy(() => import('./components/CashFlowForecastControl'))
const PerformanceScorecard = lazy(() => import('./components/PerformanceScorecard'))
const FrameworkWorkspace = lazy(() => import('./components/FrameworkWorkspace'))
const MarketFitControl = lazy(() => import('./components/MarketFitControl'))
const BidDecisionControl = lazy(() => import('./components/BidDecisionControl'))
const SiteSurveyControl = lazy(() => import('./components/SiteSurveyControl'))
const PreTaskPlanControl = lazy(() => import('./components/PreTaskPlanControl'))
const LmraControl = lazy(() => import('./components/LmraControl'))
const SdsRegisterControl = lazy(() => import('./components/SdsRegisterControl'))
const DrawingRegisterControl = lazy(() => import('./components/DrawingRegisterControl'))
const EnergyPerformanceControl = lazy(() => import('./components/EnergyPerformanceControl'))
const CrewCapacityBoard = lazy(() => import('./components/CrewCapacityBoard'))
const LastPlannerBoard = lazy(() => import('./components/LastPlannerBoard'))
const FiveSWorkspace = lazy(() => import('./components/FiveSWorkspace'))
const OrganizationOnboarding = lazy(() => import('./components/OrganizationOnboarding'))
const AutomationSafetyDialog = lazy(() => import('./components/AutomationSafetyDialog'))
const QaResetDialog = lazy(() => import('./components/QaResetDialog'))
const TeamAccessControl = lazy(() => import('./components/TeamAccessControl'))
const PrivacyRequestsControl = lazy(() => import('./components/PrivacyRequestsControl'))
const loadJobWorkspaceControls = () => import('./components/JobWorkspaceControls')
const AutomationControl = lazy(() => loadJobWorkspaceControls().then((module) => ({ default: module.AutomationControl })))
const CapabilitySetupControl = lazy(() => loadJobWorkspaceControls().then((module) => ({ default: module.CapabilitySetupControl })))
const ClientsWorkspace = lazy(() => loadJobWorkspaceControls().then((module) => ({ default: module.ClientsWorkspace })))
const CloseoutRegister = lazy(() => loadJobWorkspaceControls().then((module) => ({ default: module.CloseoutRegister })))
const CommercialControl = lazy(() => loadJobWorkspaceControls().then((module) => ({ default: module.CommercialControl })))
const DayworkControl = lazy(() => loadJobWorkspaceControls().then((module) => ({ default: module.DayworkControl })))
const FieldAssuranceWorkspace = lazy(() => loadJobWorkspaceControls().then((module) => ({ default: module.FieldAssuranceWorkspace })))
const FieldRiskControl = lazy(() => loadJobWorkspaceControls().then((module) => ({ default: module.FieldRiskControl })))
const InspectionChecklistControl = lazy(() => loadJobWorkspaceControls().then((module) => ({ default: module.InspectionChecklistControl })))
const NonconformanceControl = lazy(() => loadJobWorkspaceControls().then((module) => ({ default: module.NonconformanceControl })))
const PhotoEvidenceControl = lazy(() => loadJobWorkspaceControls().then((module) => ({ default: module.PhotoEvidenceControl })))
const ProductionControl = lazy(() => loadJobWorkspaceControls().then((module) => ({ default: module.ProductionControl })))
const ProjectControls = lazy(() => loadJobWorkspaceControls().then((module) => ({ default: module.ProjectControls })))
const TakeoffControl = lazy(() => loadJobWorkspaceControls().then((module) => ({ default: module.TakeoffControl })))
const WorkPlanControl = lazy(() => loadJobWorkspaceControls().then((module) => ({ default: module.WorkPlanControl })))

const navItems = [
  ['today', LayoutDashboard],
  ['pipeline', Target],
  ['jobs', BriefcaseBusiness],
  ['schedule', CalendarDays],
  ['approvals', ClipboardCheck],
  ['dispatch', MapPin],
  ['resources', Wrench],
  ['finance', ReceiptEuro],
  ['performance', Activity],
  ['clients', BadgeCheck],
  ['field', HardHat],
  ['operations', Gauge],
]

const EQUIPMENT_EDITABLE_STATUSES = new Set(['available', 'in_use', 'maintenance', 'inspection_due', 'inactive', 'lost'])
const FINANCE_ACTION_LABELS = {
  create_credit_note: 'Credit invoice',
  record_purchase_order_delivery: 'Record order delivery',
  record_supplier_invoice: 'Supplier invoice',
  record_supplier_payment: 'Supplier payment',
  record_payment_reconciliation: 'Record payment',
  record_payment_follow_up: 'Payment follow-up',
  prepare_finance_handoff: 'Finance handoff',
  review_cost_evidence: 'Review cost evidence',
  record_time_expense: 'Record costs',
  request_expense_reversal: 'Reverse expense',
  create_budget_line: 'Budget baseline',
  prepare_cost_forecast: 'Freeze forecast',
  create_billing_milestone: 'Billing milestone',
  create_draw_request: 'Progress draw',
  request_lien_waiver: 'Waiver request',
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

async function recordFieldEvidence({
  id,
  jobId,
  notes,
  riskLevel,
  file,
  photoEvidenceSetId,
  photoEvidencePhase,
  capturedAt,
}) {
  const payload = new FormData()
  payload.append('evidenceFile', file)
  payload.append('jobId', jobId)
  payload.append('notes', notes)
  payload.append('riskLevel', riskLevel)
  payload.append('category', photoEvidenceSetId ? 'governed_field_photo' : file.type.startsWith('image/') ? 'field_photo' : 'document')
  payload.append('attachToBuild', 'false')
  if (photoEvidenceSetId) {
    payload.append('photoEvidenceSetId', photoEvidenceSetId)
    payload.append('photoEvidencePhase', photoEvidencePhase)
    payload.append('capturedAt', new Date(capturedAt).toISOString())
    payload.append('caption', notes)
    payload.append('photoEvidenceEntryKey', id || createFieldEvidenceDraftId())
  }
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

function emptyFieldEvidenceDraft() {
  return {
    jobId: '',
    notes: '',
    riskLevel: 'medium',
    photoEvidenceSetId: '',
    photoEvidencePhase: 'before',
    capturedAt: toLocalDateTimeInput(new Date()),
  }
}

async function recordFieldOperation({ id, type, jobId, payload }) {
  const inspectionId = type === 'inspection_checklist' ? String(payload?.inspectionId || '') : ''
  const attendanceSessionId = type === 'attendance_check_out' ? String(payload?.sessionId || '') : ''
  const custodySessionId = type === 'equipment_return' ? String(payload?.custodySessionId || '') : ''
  const safetyMeetingId = type === 'safety_briefing_acknowledgement' ? String(payload?.meetingId || '') : ''
  const workPermitId = type === 'work_permit_acknowledgement' ? String(payload?.permitId || '') : ''
  const preTaskPlanId = ['pre_task_plan_acknowledgement', 'pre_task_plan_suspension'].includes(type) ? String(payload?.planId || '') : ''
  const dailyCycleId = type === 'daily_cycle_close' ? String(payload?.cycleId || '') : ''
  const fiveSLocationId = type === 'five_s_audit' ? String(payload?.locationId || '') : ''
  const route =
    type === 'daily_huddle'
      ? 'daily-cycles'
      : type === 'daily_cycle_close' && dailyCycleId
        ? `daily-cycles/${encodeURIComponent(dailyCycleId)}/end-of-day`
      : type === 'daily_log'
      ? 'daily-logs'
      : type === 'attendance_check_in'
        ? 'attendance/check-in'
      : type === 'attendance_check_out' && attendanceSessionId
          ? `attendance/${encodeURIComponent(attendanceSessionId)}/check-out`
      : type === 'safety_briefing_acknowledgement' && safetyMeetingId
        ? `safety-meetings/${encodeURIComponent(safetyMeetingId)}/acknowledgments`
      : type === 'work_permit_acknowledgement' && workPermitId
        ? `work-permits/${encodeURIComponent(workPermitId)}/acknowledgments`
      : type === 'pre_task_plan_acknowledgement' && preTaskPlanId
        ? `pre-task-plans/${encodeURIComponent(preTaskPlanId)}/acknowledgments`
      : type === 'pre_task_plan_suspension' && preTaskPlanId
        ? `pre-task-plans/${encodeURIComponent(preTaskPlanId)}/suspend`
      : type === 'lmra_assessment'
        ? 'lmra'
      : type === 'production_entry'
        ? 'production-entries'
      : type === 'daywork_ticket'
        ? 'daywork-tickets'
      : type === 'nonconformance'
        ? 'nonconformances'
      : type === 'material_receipt'
        ? 'material-receipts'
      : type === 'expense_receipt'
        ? 'expense-receipts'
      : type === 'environmental_activity'
        ? 'environmental-activities'
      : type === 'equipment_check_out'
        ? 'equipment-custody/check-out'
      : type === 'equipment_return' && custodySessionId
        ? `equipment-custody/${encodeURIComponent(custodySessionId)}/return`
      : type === 'five_s_audit' && fiveSLocationId
        ? `five-s/locations/${encodeURIComponent(fiveSLocationId)}/audits`
      : type === 'progress'
        ? 'progress'
        : type === 'observation'
          ? 'observations'
          : type === 'incident'
            ? 'incidents'
            : type === 'punch_item'
              ? 'punch-items'
              : type === 'inspection_checklist' && inspectionId
                ? `inspections/${encodeURIComponent(inspectionId)}/checklist-submissions`
                : null
  if (!route) throw new Error('This queued field operation is not supported.')
  const requestPayload = { ...payload, entryKey: id }
  delete requestPayload.inspectionId
  delete requestPayload.sessionId
  delete requestPayload.custodySessionId
  delete requestPayload.meetingId
  delete requestPayload.permitId
  delete requestPayload.planId
  delete requestPayload.cycleId
  delete requestPayload.locationId
  return api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/${route}`, {
    method: 'POST',
    body: JSON.stringify(requestPayload),
  })
}

function suggestedEndInput(startValue, estimatedHours = 4) {
  const start = new Date(startValue)
  if (Number.isNaN(start.getTime())) return ''
  return toLocalDateTimeInput(new Date(start.getTime() + Math.max(1, Number(estimatedHours) || 4) * 60 * 60 * 1000))
}

function emptyFieldDailyLog() {
  return {
    entryKey: createFieldEvidenceDraftId(),
    jobId: '',
    cycleId: '',
    workerId: '',
    workDate: futureDateInput(0),
    hours: '',
    manpower: '1',
    weather: 'clear',
    workCompleted: '',
    blockers: '',
    planAchieved: true,
    varianceReasons: '',
    unresolvedActions: '',
    tomorrowPlan: '',
    evidenceReferences: '',
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

function emptyDailyHuddle() {
  return {
    entryKey: createFieldEvidenceDraftId(),
    jobId: '',
    workDate: futureDateInput(0),
    shiftLabel: 'day',
    facilitator: '',
    leadWorkerId: '',
    workerIds: [],
    plannedWork: '',
    productionTarget: '',
    weather: 'clear',
    siteConditions: '',
    safetyFocus: '',
    qualityHoldPoints: '',
    constraints: '',
    blockingIssues: '',
    stopWorkRequired: false,
    evidenceReference: '',
  }
}

function emptyMaterialReceiptLine(source = {}) {
  const remaining = Number(source.remainingQuantity ?? source.orderedQuantity ?? 0)
  return {
    lineKey: source.lineKey || '',
    materialRequirementId: source.materialRequirementId || '',
    itemName: source.itemName || '',
    unit: source.unit || 'unit',
    receivedQuantity: remaining > 0 ? String(remaining) : '1',
    acceptedQuantity: remaining > 0 ? String(remaining) : '1',
    damagedQuantity: '0',
    notes: '',
  }
}

function emptyMaterialReceiptDraft(plan = null) {
  const purchaseOrder = plan?.purchaseOrder || null
  const lines = (plan?.lines || []).filter((line) => !line.complete).map(emptyMaterialReceiptLine)
  return {
    entryKey: createFieldEvidenceDraftId(),
    jobId: purchaseOrder?.jobId || '',
    purchaseOrderId: purchaseOrder?.id || '',
    receiptReference: '',
    evidenceReference: '',
    deliveredAt: toLocalDateTimeInput(new Date()),
    receivedBy: '',
    location: '',
    finalDelivery: plan?.summary?.remainingLines === lines.length && lines.length > 0,
    notes: '',
    lines: lines.length ? lines : [emptyMaterialReceiptLine()],
  }
}

function emptyFieldExpenseReceiptDraft() {
  return {
    entryKey: createFieldEvidenceDraftId(),
    jobId: '',
    expenseDate: futureDateInput(0),
    category: 'materials',
    vendor: '',
    receiptReference: '',
    totalAmount: '',
    taxAmount: '',
    taxTreatment: 'recoverable',
    paymentMethod: 'company_card',
    costCode: 'MAT-100',
    notes: '',
  }
}

function emptyFieldEnvironmentalDraft() {
  return {
    entryKey: createFieldEvidenceDraftId(),
    jobId: '',
    activityDate: futureDateInput(0),
    category: 'fuel',
    ghgScope: 'scope_1',
    description: '',
    quantity: '',
    unit: 'litre',
    emissionFactor: '',
    factorSource: '',
    factorReference: '',
    evidenceReference: '',
    notes: '',
  }
}

function emptyEnvironmentalReportDraft() {
  const today = futureDateInput(0)
  return { periodStart: `${today.slice(0, 4)}-01-01`, periodEnd: today }
}

function emptyAttendanceDraft() {
  return {
    jobId: '',
    workerId: '',
    note: '',
    accessPoint: '',
  }
}

function emptySafetyBriefingDraft() {
  return {
    entryKey: createFieldEvidenceDraftId(),
    jobId: '',
    meetingId: '',
    title: '',
    scheduledAt: toLocalDateTimeInput(new Date()),
    topics: '',
    evidenceReference: '',
    acknowledged: false,
    completionEvidence: '',
    excusalReason: '',
  }
}

function emptyWorkPermitDraft() {
  return {
    entryKey: createFieldEvidenceDraftId(),
    jobId: '',
    permitId: '',
    permitType: 'general_work',
    title: '',
    location: '',
    validFrom: toLocalDateTimeInput(new Date()),
    expiresAt: toLocalDateTimeInput(new Date(Date.now() + 8 * 60 * 60 * 1000)),
    hazards: '',
    controls: '',
    conditions: '',
    sourceEvidence: '',
    acknowledgementEvidence: '',
    acknowledged: false,
    suspensionReason: '',
    suspensionEvidence: '',
    closureNote: '',
    closureEvidence: '',
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

function emptyChangeOrderDraft(job = null, supersedes = null) {
  const referenceQuote = (job?.quotes || []).find((quote) => quote.status === 'accepted')
  const formalControl = supersedes?.formalControl || {}
  return {
    entryKey: createFieldEvidenceDraftId(),
    quoteId: referenceQuote?.id || '',
    supersedesChangeOrderId: supersedes?.id || '',
    title: supersedes?.title ? `${supersedes.title} - revision` : '',
    scopeDelta: supersedes?.scopeDelta || '',
    variationType: formalControl.variationType || 'client_request',
    initiatedBy: formalControl.initiatedBy || 'client',
    cause: formalControl.cause || '',
    justification: formalControl.justification || '',
    contractReference: formalControl.contractReference || referenceQuote?.id || 'Current retained contract baseline',
    noticeReference: formalControl.noticeReference || '',
    noticeNotApplicableReason: formalControl.noticeNotApplicableReason || '',
    requestedAt: new Date().toISOString().slice(0, 10),
    responseDueAt: futureDateInput(7),
    scheduleDeltaDays: supersedes?.scheduleDeltaDays == null ? '0' : String(supersedes.scheduleDeltaDays),
    scheduleImpactNarrative: formalControl.scheduleImpactNarrative || '',
    riskImpact: formalControl.riskImpact || 'medium',
    riskImpactStatement: formalControl.riskImpactStatement || '',
    assumptions: (formalControl.assumptions || []).join('\n'),
    exclusions: (formalControl.exclusions || []).join('\n'),
    evidenceReferences: (formalControl.evidenceReferences || []).join('\n'),
    taxRate: referenceQuote?.taxRate == null ? '21' : String(referenceQuote.taxRate),
    notes: supersedes?.data?.notes || '',
    lineItems: supersedes?.lineItems?.length
      ? supersedes.lineItems.map((item) => ({
          description: item.description || '',
          quantity: String(item.quantity ?? 1),
          unitPrice: String(item.unitPrice ?? ''),
          costCode: item.costCode || 'change_order',
        }))
      : [{ description: '', quantity: '1', unitPrice: '', costCode: 'change_order' }],
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
    entryKey: createFieldEvidenceDraftId(),
    outcome: 'follow_up_recorded',
    amount: '',
    taxRate: '21',
    forecastAmount: '',
    workerId: '',
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
    taxTreatment: 'recoverable',
    paymentMethod: 'company_card',
    materialReceiptId: '',
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

function emptyClientDraft(client = null) {
  const data = client?.data || {}
  return {
    id: client?.id || '',
    name: client?.name || '',
    company: client?.company || '',
    clientType: data.clientType || (client?.company ? 'business' : 'consumer'),
    email: client?.email || '',
    billingEmail: data.billingEmail || '',
    phone: client?.phone || '',
    address: client?.address || '',
    postalCode: data.postalCode || '',
    city: client?.city || '',
    country: client?.country || 'NL',
    registrationNumber: data.registrationNumber || '',
    vatNumber: client?.vatNumber || '',
    electronicAddressScheme: data.electronicAddressScheme || '',
    electronicAddress: data.electronicAddress || '',
    preferredLanguage: client?.preferredLanguage || 'nl',
    notes: data.notes || '',
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
    postalCode: opportunity?.postalCode || '',
    country: opportunity?.country || 'NL',
    clientSegment: opportunity?.data?.clientSegment || '',
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

function emptyEquipmentCheckoutDraft(plan = null) {
  const dueBackAt = plan?.reservation?.neededUntil
    ? toLocalDateTimeInput(new Date(plan.reservation.neededUntil))
    : toLocalDateTimeInput(new Date(Date.now() + 8 * 60 * 60 * 1000))
  return {
    jobId: plan?.reservation?.jobId || '',
    reservationId: plan?.reservation?.id || '',
    workerId: '',
    checkedOutAt: toLocalDateTimeInput(new Date()),
    dueBackAt,
    checkedOutBy: '',
    condition: 'good',
    location: '',
    meter: '',
    evidenceReference: '',
    notes: '',
    entryKey: createFieldEvidenceDraftId(),
  }
}

function emptyEquipmentReturnDraft(session = null) {
  return {
    jobId: session?.jobId || '',
    custodySessionId: session?.id || '',
    returnedAt: toLocalDateTimeInput(new Date()),
    returnedBy: '',
    condition: 'serviceable',
    location: session?.checkoutLocation || '',
    meter: session?.checkoutMeter === null || session?.checkoutMeter === undefined ? '' : String(session.checkoutMeter),
    evidenceReference: '',
    notes: '',
    entryKey: createFieldEvidenceDraftId(),
  }
}

function emptyWorkerCredentialDraft(worker = null) {
  return {
    workerId: worker?.id || '',
    credentialType: 'vca_basic',
    title: '',
    issuer: '',
    credentialNumber: '',
    issuedOn: new Date().toISOString().slice(0, 10),
    expiresOn: '',
    evidenceReference: '',
  }
}

function emptyQualificationRequirementDraft(job = null) {
  return {
    jobId: job?.id || '',
    credentialType: 'vca',
    title: '',
    role: '',
    mandatory: true,
  }
}

function emptyWorkerAvailabilityDraft(worker = null) {
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  startsAt.setHours(8, 0, 0, 0)
  const endsAt = new Date(startsAt)
  endsAt.setHours(17, 0, 0, 0)
  return {
    workerId: worker?.id || '',
    periodType: 'leave',
    title: '',
    startsAt: toLocalDateTimeInput(startsAt.toISOString()),
    endsAt: toLocalDateTimeInput(endsAt.toISOString()),
    notes: '',
  }
}





function emptyTakeoffDraft(job = null) {
  return {
    title: job?.title ? `${job.title} measured scope` : '',
    taxRate: '21',
    notes: '',
  }
}

function emptyTakeoffItemDraft(item = null, takeoff = null) {
  const fallbackPackage = takeoff?.items?.[takeoff.items.length - 1] || null
  return {
    id: item?.id || '',
    description: item?.description || '',
    category: item?.category || 'material',
    measurementType: item?.measurementType || 'area',
    count: item ? String(item.count ?? 1) : '1',
    length: item ? String(item.length ?? 0) : '',
    width: item ? String(item.width ?? 0) : '',
    height: item ? String(item.height ?? 0) : '',
    quantity: item ? String(item.quantity ?? 0) : '',
    unit: item?.unit || 'm2',
    wastePercent: item ? String(item.wastePercent ?? 0) : '0',
    unitCost: item ? String(item.unitCost ?? 0) : '',
    unitPrice: item ? String(item.unitPrice ?? 0) : '',
    costCode: item?.costCode || 'estimate',
    wbsCode: item?.wbsCode || fallbackPackage?.wbsCode || '01',
    workPackage: item?.workPackage || fallbackPackage?.workPackage || 'General scope',
    sourceReference: item?.sourceReference || '',
  }
}

function emptyTakeoffConversionDraft() {
  return { validUntil: futureDateInput(30), notes: '' }
}

function takeoffDraftQuantity(draft = {}) {
  const type = draft.measurementType || 'manual'
  const count = Number(draft.count)
  const length = Number(draft.length)
  const width = Number(draft.width)
  const height = Number(draft.height)
  const manual = Number(draft.quantity)
  const waste = Number(draft.wastePercent)
  let quantity = 0
  if (type === 'manual') quantity = manual
  else if (type === 'count') quantity = count
  else if (type === 'linear') quantity = count * length
  else if (type === 'area') quantity = count * length * width
  else if (type === 'volume') quantity = count * length * width * height
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(waste) || waste < 0) return 0
  return Math.round(quantity * (1 + waste / 100) * 10_000) / 10_000
}



function emptyBidPackageDraft() {
  return {
    opportunityId: '',
    title: '',
    trade: '',
    scope: '',
    dueAt: futureDateInput(10),
    ownerName: '',
    tradePartnerIds: [],
  }
}

function emptyBidReturnDraft() {
  return {
    netAmount: '',
    taxRate: '21',
    receivedAt: futureDateInput(0),
    validUntil: futureDateInput(30),
    durationDays: '',
    evidenceReference: '',
    exclusions: '',
    qualifications: '',
  }
}

function emptyBidCommitmentDraft() {
  return {
    requiredBy: futureDateInput(21),
    costCode: 'SUBCONTRACT',
    notes: '',
  }
}

function emptyBidOrderDraft() {
  return { recipient: '', channel: 'email' }
}

function emptyBidOrderDeliveryDraft() {
  return { integration: '', providerMessageId: '', sentAt: toLocalDateTimeInput(new Date().toISOString()) }
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

function upsertById(records, record) {
  if (!record?.id) return records || EMPTY_LIST
  return [record, ...(records || EMPTY_LIST).filter((item) => item.id !== record.id)]
}

function reconcileJobCollections(data, job) {
  if (!data || !job?.id) return data
  const archived = job.status === 'archived'
  return {
    ...data,
    jobs: archived ? (data.jobs || EMPTY_LIST).filter((item) => item.id !== job.id) : upsertById(data.jobs, job),
    archivedJobs: archived
      ? upsertById(data.archivedJobs, job)
      : (data.archivedJobs || EMPTY_LIST).filter((item) => item.id !== job.id),
  }
}

function reconcileApprovalResolution(data, approvalId, dashboard = null) {
  if (!data) return data
  const currentDashboard = data.dashboard
  const nextDashboard = dashboard || (currentDashboard ? {
    ...currentDashboard,
    metrics: currentDashboard.metrics ? {
      ...currentDashboard.metrics,
      pendingApprovals: Math.max(0, Number(currentDashboard.metrics.pendingApprovals || 0) - 1),
    } : currentDashboard.metrics,
    nextActions: (currentDashboard.nextActions || EMPTY_LIST)
      .filter((action) => action.approvalId !== approvalId),
  } : currentDashboard)
  return {
    ...data,
    dashboard: nextDashboard,
    approvals: (data.approvals || EMPTY_LIST).filter((approval) => approval.id !== approvalId),
  }
}

async function loadSectionPatch(section, resourceView = 'workforce', fieldScoped = false, viewContext = {}) {
  if (section === 'today' && !fieldScoped) {
    const [organization, scheduler, capabilities] = await Promise.all([
      api('/api/ledger/organization').catch(() => null),
      api('/api/ledger/scheduler').catch(() => null),
      api('/api/operations/capabilities').catch(() => null),
    ])
    return {
      organization: organization?.organization || null,
      scheduler: scheduler?.scheduler || null,
      operationsCapabilities: capabilities,
    }
  }
  if (section === 'pipeline') {
    const [opportunities, marketFit, bidDecisions, bids, partners] = await Promise.all([
      api('/api/ledger/opportunities?includeClosed=true&limit=500'),
      api('/api/ledger/market-fit?limit=500'),
      api('/api/ledger/bid-decisions?limit=500'),
      api('/api/ledger/bid-packages?includeClosed=true&limit=500'),
      api('/api/ledger/trade-partners?includeRetired=true&limit=500'),
    ])
    return {
      opportunities: opportunities.opportunities || [],
      opportunityForecast: opportunities.forecast || null,
      marketFit: marketFit.marketFit || null,
      bidDecisions: bidDecisions.bidDecisions || null,
      bidPackages: bids.bidPackages || [],
      bidPackageSummary: bids.summary || {},
      tradePartners: partners.partners || [],
      tradePartnerSummary: partners.summary || {},
    }
  }
  if (section === 'jobs') {
    const [jobs, templates] = await Promise.all([
      api('/api/ledger/jobs?limit=100'),
      api('/api/ledger/inspection-templates'),
    ])
    return { jobs: jobs.jobs || [], inspectionTemplates: templates.templates || [] }
  }
  if (section === 'schedule') {
    const lastPlannerParameters = new URLSearchParams()
    if (viewContext.lastPlannerWeekStart) lastPlannerParameters.set('weekStart', viewContext.lastPlannerWeekStart)
    const lastPlannerPath = `/api/ledger/last-planner${lastPlannerParameters.size ? `?${lastPlannerParameters.toString()}` : ''}`
    const [schedule, crewCapacity, lastPlanner] = await Promise.all([
      api('/api/ledger/schedule?horizonDays=180&limit=500'),
      api('/api/ledger/crew-capacity'),
      api(lastPlannerPath),
    ])
    return { schedule, crewCapacity: crewCapacity.board || null, lastPlanner: lastPlanner.board || null }
  }
  if (section === 'approvals') {
    const result = await api('/api/ledger/approvals?status=pending&limit=100')
    return { approvals: result.approvals || [] }
  }
  if (section === 'dispatch') {
    const [dispatch, partners] = await Promise.all([
      api('/api/ledger/dispatch?limit=100'),
      api('/api/ledger/trade-partners?includeRetired=true&limit=200'),
    ])
    return {
      dispatch,
      tradePartners: partners.partners || [],
      tradePartnerSummary: partners.summary || {},
    }
  }
  if (section === 'resources') {
    if (resourceView === 'timesheets') {
      const result = await api(`/api/ledger/timesheets?periodStart=${encodeURIComponent(mondayDateInput())}`)
      return { timesheets: result.timesheets || { rows: [], exports: [], summary: {} } }
    }
    if (resourceView === 'inventory') return { inventory: await api('/api/ledger/inventory?limit=100') }
    if (resourceView === 'receiving') {
      const result = await api('/api/ledger/material-receipts?limit=500')
      return { materialReceiving: result.materialReceiving || { summary: {}, receipts: [], purchaseOrders: [], actions: [], policy: {} } }
    }
    if (resourceView === 'equipment') {
      const [result, custody] = await Promise.all([
        api('/api/ledger/tools?limit=500'),
        api('/api/ledger/equipment-custody?limit=500'),
      ])
      return {
        tools: result.tools || [],
        toolSummary: result.summary || {},
        equipmentCustody: custody.equipmentCustody || { summary: {}, sessions: [], active: [], exceptions: [], actions: [], policy: {} },
      }
    }
    if (resourceView === 'five_s') {
      const [fiveS, tools] = await Promise.all([
        api('/api/ledger/five-s'),
        api('/api/ledger/tools?limit=500'),
      ])
      return {
        fiveS: fiveS.board || null,
        tools: tools.tools || [],
        toolSummary: tools.summary || {},
      }
    }
    if (resourceView === 'partners') {
      const result = await api('/api/ledger/trade-partners?includeRetired=true&limit=200')
      return { tradePartners: result.partners || [], tradePartnerSummary: result.summary || {} }
    }
    const [workforce, workers, qualifications, availability] = await Promise.all([
      api('/api/ledger/workforce?limit=100'),
      api('/api/ledger/workers?limit=500'),
      api('/api/ledger/qualifications'),
      api('/api/ledger/availability'),
    ])
    return {
      workforce,
      workers: workers.workers || [],
      workerSummary: workers.summary || {},
      qualificationRegister: qualifications.qualificationRegister || { catalog: { credentials: [], requirements: [] }, summary: {}, workers: [], requirements: [], jobs: [] },
      availabilityRegister: availability.availabilityRegister || { catalog: [], summary: {}, workers: [], periods: [], conflicts: [] },
    }
  }
  if (section === 'finance') {
    const [finance, cashFlow, workers] = await Promise.all([
      api('/api/ledger/finance?limit=100'),
      api('/api/ledger/cash-flow'),
      api('/api/ledger/workers?limit=500'),
    ])
    return {
      finance,
      cashFlow: cashFlow.cashFlow,
      workers: workers.workers || [],
      workerSummary: workers.summary || {},
    }
  }
  if (section === 'performance') {
    const [result, catalog, frameworks] = await Promise.all([
      api('/api/ledger/performance-scorecard'),
      api('/api/ledger/frameworks/catalog?limit=1000&compact_families=true'),
      api('/api/ledger/frameworks?limit=2000'),
    ])
    return {
      performanceScorecard: result.scorecard,
      frameworkCatalog: catalog.catalog,
      frameworkWorkspace: frameworks.workspace,
    }
  }
  if (section === 'clients') {
    const [clientSuccess, directory] = await Promise.all([
      api('/api/ledger/client-success?limit=100'),
      api('/api/ledger/clients?limit=500'),
    ])
    return {
      clients: clientSuccess,
      clientDirectory: directory,
    }
  }
  if (section === 'field') {
    const [field, attendance, safetyBriefings, workPermits, workers] = await Promise.all([
      fieldScoped ? Promise.resolve({ rows: [], summary: {} }) : api('/api/ledger/field-assurance?limit=100'),
      api('/api/ledger/attendance?limit=250'),
      api('/api/ledger/safety-briefings?limit=100'),
      api('/api/ledger/work-permits?limit=100'),
      fieldScoped ? Promise.resolve(null) : api('/api/ledger/workers?limit=500'),
    ])
    return {
      field,
      attendance: attendance.attendance || { rows: [], summary: {} },
      safetyMeetings: safetyBriefings.safetyMeetings || [],
      workPermits: workPermits.workPermits || [],
      ...(workers
        ? { workers: workers.workers || [], workerSummary: workers.summary || {} }
        : {}),
    }
  }
  if (section === 'operations') {
    const [templates, scheduler, organization, backups, capabilities, archivedJobs, operatorRegister, workers, operatorScopeJobs, privacyRequests, clientDirectory] = await Promise.all([
      api('/api/ledger/inspection-templates'),
      api('/api/ledger/scheduler').catch(() => null),
      api('/api/ledger/organization'),
      api('/api/operations/backups').catch(() => ({ backups: [] })),
      api('/api/operations/capabilities').catch(() => null),
      api('/api/ledger/jobs?archiveOnly=true&limit=100').catch(() => ({ jobs: [] })),
      api('/api/operations/operators'),
      api('/api/ledger/workers?limit=500'),
      api('/api/ledger/jobs?limit=500'),
      api('/api/operations/privacy/requests?status=all&limit=500'),
      api('/api/ledger/clients?limit=500'),
    ])
    return {
      inspectionTemplates: templates.templates || [],
      scheduler: scheduler?.scheduler || null,
      organization: organization.organization,
      backups: backups.backups || [],
      operationsCapabilities: capabilities,
      archivedJobs: archivedJobs.jobs || [],
      operatorRegister,
      operatorScopeJobs: operatorScopeJobs.jobs || [],
      privacyRequests: { requests: privacyRequests.requests || [], summary: privacyRequests.summary || {} },
      clientDirectory,
      workers: workers.workers || [],
      workerSummary: workers.summary || {},
    }
  }
  return {}
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

function LazyControlBoundary({ label, mode = 'section', children }) {
  const className = mode === 'job' ? 'loading job-workspace-loading' : 'loading section-loading'
  return (
    <Suspense fallback={<div className={className} role="status"><LoaderCircle className="spin" size={16} /> Loading {label}</div>}>
      {children}
    </Suspense>
  )
}

const PIPELINE_STAGES = ['new', 'qualifying', 'site_visit', 'estimating', 'proposal', 'negotiating', 'won', 'lost', 'archived']

function BidPackageWorkspace({
  bidPackages,
  selectedBidPackage,
  canCoordinate,
  canApprove,
  submitting,
  onCreate,
  onSelect,
  onAddBidders,
  onRecordReturn,
  onRequestSelection,
  onReviewApproval,
  onPrepareCommitment,
  onReviewCommitment,
  onPrepareOrderPackage,
  onReviewOrderDelivery,
  onRecordOrderDelivery,
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('open')
  const normalizedQuery = query.trim().toLowerCase()
  useEffect(() => {
    if (selectedBidPackage?.status === 'selected') setStatus('selected')
  }, [selectedBidPackage?.id, selectedBidPackage?.status])
  const rows = useMemo(
    () =>
      bidPackages.filter((bidPackage) => {
        const statusMatches =
          status === 'all' ||
          (status === 'open'
            ? !['selected', 'closed', 'cancelled'].includes(bidPackage.status)
            : bidPackage.status === status)
        return statusMatches && (!normalizedQuery || JSON.stringify(bidPackage).toLowerCase().includes(normalizedQuery))
      }),
    [bidPackages, normalizedQuery, status],
  )

  return (
    <>
      <section className="panel bid-register" data-testid="bid-package-workspace">
        <div className="panel-heading pipeline-heading">
          <div>
            <h2>Bid package register</h2>
            <p>Compare retained trade-partner returns before a preferred bidder enters approval.</p>
          </div>
          {canCoordinate ? (
            <button className="primary-button" onClick={onCreate}>
              <Plus size={16} />
              New bid package
            </button>
          ) : null}
        </div>
        <div className="pipeline-toolbar">
          <label className="search-control">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search package, client, trade or bidder" />
          </label>
          <div className="pipeline-stage-tabs bid-status-tabs" role="group" aria-label="Filter bid packages by status">
            {['open', 'under_review', 'pending_selection_approval', 'selected', 'all'].map((option) => (
              <button key={option} className={status === option ? 'active' : ''} onClick={() => setStatus(option)}>
                {formatStatus(option)}
              </button>
            ))}
          </div>
        </div>
        {rows.length ? (
          <div className="bid-package-list">
            {rows.map((bidPackage) => (
              <article className={`bid-package-row ${selectedBidPackage?.id === bidPackage.id ? 'bid-package-row-selected' : ''}`} key={bidPackage.id}>
                <button className="bid-package-main" onClick={() => onSelect(bidPackage)} aria-label={`Open bid package ${bidPackage.packageNumber}`}>
                  <span className="bid-package-icon"><ClipboardList size={17} /></span>
                  <span>
                    <span className="pipeline-title">
                      <strong>{bidPackage.packageNumber} / {bidPackage.title}</strong>
                      <span className={`status status-${bidPackage.status}`}>{formatStatus(bidPackage.status)}</span>
                    </span>
                    <small>{bidPackage.client?.name || 'Client pending'} / {bidPackage.trade} / {bidPackage.opportunity?.title || 'Opportunity pending'}</small>
                  </span>
                </button>
                <dl className="bid-package-values">
                  <div><dt>Due</dt><dd className={bidPackage.flags?.overdue ? 'pipeline-overdue' : ''}>{bidPackage.dueAt ? formatDate(bidPackage.dueAt) : 'Not set'}</dd></div>
                  <div><dt>Returns</dt><dd>{bidPackage.comparison?.returned || 0} / {bidPackage.comparison?.invited || 0}</dd></div>
                  <div><dt>Lowest</dt><dd>{bidPackage.comparison?.returned ? currency.format(bidPackage.comparison.lowestTotal || 0) : 'Pending'}</dd></div>
                </dl>
                <button className="icon-button table-action" aria-label={`Open bid package details for ${bidPackage.packageNumber}`} onClick={() => onSelect(bidPackage)}>
                  <ArrowUpRight size={16} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="No bid packages in this view" detail="Adjust the status filter or retain a new internal tender package." />
        )}
      </section>

      {selectedBidPackage ? (
        <section className="panel bid-package-detail" aria-live="polite">
          <div className="panel-heading">
            <div>
              <h2>{selectedBidPackage.packageNumber} / {selectedBidPackage.title}</h2>
              <p>{selectedBidPackage.trade} / {formatStatus(selectedBidPackage.status)} / {selectedBidPackage.comparison?.returned || 0} retained return(s)</p>
            </div>
            <div className="bid-package-heading-actions">
              {canCoordinate && ['draft', 'open_for_returns', 'under_review'].includes(selectedBidPackage.status) ? (
                <button className="secondary-button" onClick={() => onAddBidders(selectedBidPackage)}>
                  <Users size={15} /> Add bidders
                </button>
              ) : null}
              {selectedBidPackage.approvalId && selectedBidPackage.status === 'pending_selection_approval' && canApprove ? (
                <button className="primary-button" onClick={() => onReviewApproval(selectedBidPackage)}>
                  <ShieldCheck size={15} /> Review approval
                </button>
              ) : null}
              {selectedBidPackage.status === 'selected' && canCoordinate && (!selectedBidPackage.commitment || selectedBidPackage.flags?.commitmentRejected) ? (
                <button
                  className="primary-button"
                  disabled={!selectedBidPackage.jobId || submitting}
                  title={selectedBidPackage.jobId ? 'Prepare the selected return for purchasing approval' : 'Convert the opportunity to a job first'}
                  onClick={() => onPrepareCommitment(selectedBidPackage)}
                >
                  <ReceiptEuro size={15} /> {selectedBidPackage.flags?.commitmentRejected ? 'Revise commitment' : selectedBidPackage.jobId ? 'Prepare commitment' : 'Job required'}
                </button>
              ) : null}
              {selectedBidPackage.commitment?.status === 'pending_approval' && canApprove ? (
                <button className="primary-button" onClick={() => onReviewCommitment(selectedBidPackage)}>
                  <ShieldCheck size={15} /> Review commitment
                </button>
              ) : null}
              {selectedBidPackage.flags?.orderPackageReady && canCoordinate ? (
                <button className="primary-button" disabled={submitting} onClick={() => onPrepareOrderPackage(selectedBidPackage)}>
                  <PackageCheck size={15} /> Prepare order package
                </button>
              ) : null}
              {selectedBidPackage.flags?.orderDeliveryApprovalPending && canApprove ? (
                <button className="primary-button" disabled={submitting} onClick={() => onReviewOrderDelivery(selectedBidPackage)}>
                  <ShieldCheck size={15} /> Review transmission
                </button>
              ) : null}
              {selectedBidPackage.flags?.orderDeliveryApproved && canCoordinate ? (
                <button className="primary-button" disabled={submitting} onClick={() => onRecordOrderDelivery(selectedBidPackage)}>
                  <MailCheck size={15} /> Record delivery receipt
                </button>
              ) : null}
              <button className="icon-button" aria-label="Close bid package detail" onClick={() => onSelect(null)}><X size={17} /></button>
            </div>
          </div>
          <div className="bid-package-summary">
            <div><span>Scope</span><strong>{selectedBidPackage.scope}</strong></div>
            <div><span>Comparison</span><strong>{selectedBidPackage.comparison?.returned ? `${currency.format(selectedBidPackage.comparison.lowestTotal)} to ${currency.format(selectedBidPackage.comparison.highestTotal)}` : 'No returns retained'}</strong></div>
            <div>
              <span>Control</span>
              <strong>
                {selectedBidPackage.flags?.orderIssued
                  ? 'Order issued with verified provider receipt'
                  : selectedBidPackage.flags?.orderDeliveryApproved
                    ? 'Transmission approved; provider receipt required'
                    : selectedBidPackage.flags?.orderDeliveryApprovalPending
                      ? 'Order package retained; transmission approval pending'
                      : selectedBidPackage.commitment?.status === 'ready_to_order'
                        ? 'Purchasing envelope approved; no award sent'
                  : selectedBidPackage.commitment?.status === 'pending_approval'
                    ? 'Commitment approval pending; no award sent'
                    : selectedBidPackage.flags?.commitmentRejected
                      ? 'Commitment rejected; retained for revision'
                      : selectedBidPackage.status === 'selected'
                        ? 'Preferred bidder retained; no commitment prepared'
                        : 'Internal only; no invitations sent'}
              </strong>
            </div>
          </div>
          {selectedBidPackage.commitment ? (
            <div className={`bid-commitment ${selectedBidPackage.commitment.integrityValid ? '' : 'bid-commitment-invalid'}`} data-testid="bid-commitment">
              <div className="bid-commitment-heading">
                <div>
                  <span className="eyebrow">Purchasing commitment</span>
                  <strong>{selectedBidPackage.commitment.purchaseOrder.supplier}</strong>
                </div>
                <div className="bid-commitment-tags">
                  <span className={`status status-${selectedBidPackage.commitment.status}`}>{formatStatus(selectedBidPackage.commitment.status)}</span>
                  <span className={`tag ${selectedBidPackage.commitment.integrityValid ? 'tag-green' : 'tag-red'}`}>
                    {selectedBidPackage.commitment.integrityValid ? 'Source verified' : 'Integrity failed'}
                  </span>
                </div>
              </div>
              <dl className="bid-commitment-values">
                <div><dt>Net envelope</dt><dd>{currency.format(selectedBidPackage.commitment.purchaseOrder.amount || 0)}</dd></div>
                <div><dt>Required by</dt><dd>{formatDate(selectedBidPackage.commitment.purchaseOrder.requiredBy)}</dd></div>
                <div><dt>Cost code</dt><dd>{selectedBidPackage.commitment.purchaseOrder.data?.source?.terms?.costCode || 'SUBCONTRACT'}</dd></div>
                <div><dt>Hash</dt><dd><code>{shortHash(selectedBidPackage.commitmentHash)}</code></dd></div>
              </dl>
              <p>
                {selectedBidPackage.commitment.orderIssued
                  ? 'The retained order was issued only after transmission approval and a configured provider receipt. No payment or subcontract signature was performed.'
                  : <>{selectedBidPackage.commitment.spendAuthorized
                    ? 'The exact internal spend envelope is approved and ready for a separate ordering action.'
                    : 'Approval is required before this exact internal spend envelope becomes ready to order.'}{' '}
                    No supplier contact, award, order transmission, subcontract signature, or payment occurred.</>}
              </p>
              {selectedBidPackage.commitment.issuePackage ? (
                <div className="bid-order-package" data-testid="bid-order-package">
                  <div>
                    <span className="eyebrow">Controlled order package</span>
                    <strong>{selectedBidPackage.commitment.issuePackage.issueReference}</strong>
                    <small>
                      {selectedBidPackage.commitment.issuePackage.communication?.data?.recipient || 'Supplier recipient retained'} / {formatStatus(selectedBidPackage.commitment.issuePackage.transportStatus)}
                    </small>
                  </div>
                  <div className="bid-order-package-actions">
                    <span className={`tag ${selectedBidPackage.commitment.orderIssued ? 'tag-green' : 'tag-amber'}`}>
                      {selectedBidPackage.commitment.orderIssued ? 'Provider receipt retained' : formatStatus(selectedBidPackage.commitment.issuePackage.communicationStatus || 'draft')}
                    </span>
                    <a
                      className="secondary-button"
                      aria-label={`Download purchase order ${selectedBidPackage.commitment.issuePackage.issueReference}`}
                      href={`/api/ledger/documents/${encodeURIComponent(selectedBidPackage.commitment.issuePackage.htmlDocumentId)}/issue-package`}
                      download
                    >
                      <FileDown size={15} /> Order
                    </a>
                    <a
                      className="secondary-button"
                      aria-label={`Download purchase order UBL ${selectedBidPackage.commitment.issuePackage.issueReference}`}
                      href={`/api/ledger/documents/${encodeURIComponent(selectedBidPackage.commitment.issuePackage.ublDocumentId)}/issue-package`}
                      download
                    >
                      <FileDown size={15} /> UBL
                    </a>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="bid-participant-list">
            {selectedBidPackage.participants.map((participant) => {
              const canEditReturn = canCoordinate && ['open_for_returns', 'under_review'].includes(selectedBidPackage.status)
              const canSelect = canCoordinate && participant.status === 'returned' && ['open_for_returns', 'under_review'].includes(selectedBidPackage.status)
              return (
                <article className="bid-participant-row" key={participant.id}>
                  <div className="bid-participant-copy">
                    <span className="pipeline-title">
                      <strong>{participant.partner?.name || 'Trade partner unavailable'}</strong>
                      <span className={`status status-${participant.status}`}>{formatStatus(participant.status)}</span>
                    </span>
                    <small>{formatStatus(participant.partner?.compliance?.status || 'needs_review')} compliance / {participant.data?.deliveryStatus === 'not_sent' ? 'internal invite only' : 'retained record'}</small>
                    {participant.evidenceReference ? <p>Evidence: {participant.evidenceReference}</p> : null}
                  </div>
                  <dl className="bid-participant-values">
                    <div><dt>Total</dt><dd>{participant.status === 'internal_invite' ? 'Awaiting return' : currency.format(participant.total || 0)}</dd></div>
                    <div><dt>Duration</dt><dd>{participant.durationDays === null ? 'Not retained' : `${participant.durationDays} days`}</dd></div>
                    <div><dt>Valid until</dt><dd>{participant.validUntil ? formatDate(participant.validUntil) : 'Not retained'}</dd></div>
                  </dl>
                  <div className="bid-participant-actions">
                    {canEditReturn && ['internal_invite', 'returned'].includes(participant.status) ? (
                      <button className="secondary-button" disabled={submitting} onClick={() => onRecordReturn(selectedBidPackage, participant)}>
                        <ReceiptEuro size={15} /> {participant.status === 'returned' ? 'Update return' : 'Record return'}
                      </button>
                    ) : null}
                    {canSelect ? (
                      <button className="primary-button" disabled={submitting || participant.partner?.compliance?.compliant !== true} onClick={() => onRequestSelection(selectedBidPackage, participant)}>
                        <ShieldCheck size={15} /> Request selection approval
                      </button>
                    ) : null}
                    {participant.status === 'selected' ? <span className="tag tag-green">Preferred / no award sent</span> : null}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      ) : null}
    </>
  )
}

function PipelineWorkspace({
  view,
  onViewChange,
  opportunities,
  forecast,
  marketFit,
  bidDecisions,
  bidPackages,
  bidSummary,
  selectedBidPackage,
  selectedOpportunity,
  canCoordinate,
  canManagePolicy,
  canApprove,
  submitting,
  onCreate,
  onEdit,
  onSelect,
  onFollowUp,
  onCompleteActivity,
  onConvert,
  onRequestMarketFitPolicy,
  onRetainMarketFitAssessment,
  onRequestBidDecisionPolicy,
  onRequestBidDecision,
  onPlanSiteSurvey,
  onUploadSiteSurveyEvidence,
  onSubmitSiteSurvey,
  onReviewSiteSurveyApproval,
  onOpenJob,
  onCreateBidPackage,
  onSelectBidPackage,
  onAddBidders,
  onRecordBidReturn,
  onRequestBidSelection,
  onReviewBidApproval,
  onPrepareBidCommitment,
  onReviewBidCommitment,
  onPrepareBidOrderPackage,
  onReviewBidOrderDelivery,
  onRecordBidOrderDelivery,
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
  const tenderSummary = bidSummary || {}

  return (
    <section className="page-grid pipeline-workspace" data-testid="pipeline-workspace">
      <div className="metrics-grid pipeline-metrics">
        {view === 'opportunities' ? (
          <>
            <Metric icon={Target} label="Open opportunities" value={summary.open || 0} hint={`${summary.total || 0} retained leads`} />
            <Metric icon={ReceiptEuro} label="Weighted forecast" value={currency.format(summary.weightedValue || 0)} hint={`${currency.format(summary.estimatedValue || 0)} unweighted`} tone="green" />
            <Metric icon={Timer} label="Follow-ups due" value={summary.overdueFollowUps || 0} hint="Internal action required" tone={summary.overdueFollowUps ? 'amber' : 'green'} />
            <Metric icon={BriefcaseBusiness} label="Converted" value={summary.converted || 0} hint={`${summary.won || 0} verified wins`} tone="blue" />
          </>
        ) : (
          <>
            <Metric icon={ClipboardList} label="Bid packages" value={tenderSummary.total || 0} hint={`${tenderSummary.invited || 0} internal bidders`} />
            <Metric icon={ReceiptEuro} label="Returns retained" value={tenderSummary.returns || 0} hint="Comparable evidence" tone="green" />
            <Metric icon={Timer} label="Overdue" value={tenderSummary.overdue || 0} hint="Return deadline passed" tone={tenderSummary.overdue ? 'amber' : 'green'} />
            <Metric icon={ShieldCheck} label="Selections" value={tenderSummary.selected || 0} hint={`${tenderSummary.pendingApproval || 0} awaiting approval`} tone="blue" />
          </>
        )}
      </div>

      <div className="pipeline-view-tabs" role="tablist" aria-label="Preconstruction views">
        <button role="tab" aria-selected={view === 'opportunities'} className={view === 'opportunities' ? 'active' : ''} onClick={() => onViewChange('opportunities')}>
          <Target size={15} /> Opportunities
        </button>
        <button role="tab" aria-selected={view === 'bids'} className={view === 'bids' ? 'active' : ''} onClick={() => onViewChange('bids')}>
          <ClipboardList size={15} /> Bid packages
        </button>
      </div>

      {view === 'opportunities' ? (
        <>

      <LazyControlBoundary label="market-fit controls">
        <MarketFitControl
          marketFit={marketFit}
          canManagePolicy={canManagePolicy}
          canCoordinate={canCoordinate}
          submitting={submitting}
          onRequestPolicy={onRequestMarketFitPolicy}
          onRetainAssessment={onRetainMarketFitAssessment}
        />
      </LazyControlBoundary>

      <LazyControlBoundary label="bid/no-bid controls">
        <BidDecisionControl
          bidDecisions={bidDecisions}
          canManagePolicy={canManagePolicy}
          canCoordinate={canCoordinate}
          submitting={submitting}
          onRequestPolicy={onRequestBidDecisionPolicy}
          onRequestDecision={onRequestBidDecision}
        />
      </LazyControlBoundary>

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
          {selectedOpportunity.marketFit ? (
            <div className={`pipeline-market-fit status-${selectedOpportunity.marketFit.recommendation || 'review'}`}>
              <Target size={15} />
              <strong>{formatStatus(selectedOpportunity.marketFit.recommendation || 'review')}</strong>
              <span>
                {selectedOpportunity.marketFit.score !== null && selectedOpportunity.marketFit.score !== undefined && Number.isFinite(Number(selectedOpportunity.marketFit.score))
                  ? `${selectedOpportunity.marketFit.score}% fit`
                  : 'Policy setup required'}
                {selectedOpportunity.marketFit.evidenceGaps?.length ? ` / ${selectedOpportunity.marketFit.evidenceGaps.length} evidence gap(s)` : ''}
              </span>
            </div>
          ) : null}
          {selectedOpportunity.bidDecision ? (
            <div className={`pipeline-market-fit status-${selectedOpportunity.bidDecision.evaluation?.recommendation || 'review'}`}>
              <ClipboardCheck size={15} />
              <strong>{formatStatus(selectedOpportunity.bidDecision.currentDecision?.proposedDecision || selectedOpportunity.bidDecision.pendingDecision?.proposedDecision || 'review')}</strong>
              <span>
                {selectedOpportunity.bidDecision.evaluation?.score !== null && selectedOpportunity.bidDecision.evaluation?.score !== undefined && Number.isFinite(Number(selectedOpportunity.bidDecision.evaluation.score))
                  ? `${selectedOpportunity.bidDecision.evaluation.score}% pursuit score`
                  : 'Scorecard evidence required'}
                {selectedOpportunity.bidDecision.pendingDecision ? ' / approval pending' : ''}
                {selectedOpportunity.bidDecision.stale ? ' / evidence stale' : ''}
              </span>
            </div>
          ) : null}
          <LazyControlBoundary label="site survey controls">
            <SiteSurveyControl
              opportunity={selectedOpportunity}
              canCoordinate={canCoordinate}
              canApprove={canApprove}
              submitting={submitting}
              onPlan={onPlanSiteSurvey}
              onUploadEvidence={onUploadSiteSurveyEvidence}
              onSubmit={onSubmitSiteSurvey}
              onReviewApproval={onReviewSiteSurveyApproval}
            />
          </LazyControlBoundary>
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
        </>
      ) : (
        <BidPackageWorkspace
          bidPackages={bidPackages}
          selectedBidPackage={selectedBidPackage}
          canCoordinate={canCoordinate}
          canApprove={canApprove}
          submitting={submitting}
          onCreate={onCreateBidPackage}
          onSelect={onSelectBidPackage}
          onAddBidders={onAddBidders}
          onRecordReturn={onRecordBidReturn}
          onRequestSelection={onRequestBidSelection}
          onReviewApproval={onReviewBidApproval}
          onPrepareCommitment={onPrepareBidCommitment}
          onReviewCommitment={onReviewBidCommitment}
          onPrepareOrderPackage={onPrepareBidOrderPackage}
          onReviewOrderDelivery={onReviewBidOrderDelivery}
          onRecordOrderDelivery={onRecordBidOrderDelivery}
        />
      )}
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
          const controlActions = (item.nextActions || []).filter((action) => action.recordType && action.recordId)
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

const PORTFOLIO_SCHEDULE_FILTERS = [
  ['all', 'Look-ahead'],
  ['risk', 'At risk'],
  ['conflict', 'Conflicts'],
  ['overdue', 'Overdue'],
  ['unscheduled', 'Unscheduled'],
  ['baseline', 'Baselines'],
]

function PortfolioScheduleWorkspace({ schedule, jobs, canApprove, onOpenApprovals, onOpenDispatch, onOpen }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [horizonDays, setHorizonDays] = useState(30)
  const rows = schedule?.jobs || EMPTY_LIST
  const referenceAt = schedule?.window?.referenceAt || new Date().toISOString()
  const referenceMs = Date.parse(referenceAt)
  const horizonEndMs = referenceMs + horizonDays * 24 * 60 * 60 * 1000
  const horizonEnd = new Date(horizonEndMs).toISOString()
  const rowInWindow = useCallback((row) => {
    const start = Date.parse(row.plannedStart || '')
    const end = Date.parse(row.plannedEnd || row.targetCompletion || '')
    return Number.isFinite(start) && Number.isFinite(end) && end >= referenceMs && start <= horizonEndMs
  }, [horizonEndMs, referenceMs])
  const rowAtRisk = useCallback((row) => (
    row.flags?.conflict || row.flags?.overdue || row.flags?.baselineStale || row.flags?.invalidPlan
  ), [])
  const visibleRows = useMemo(() => {
    const search = query.trim().toLowerCase()
    return rows.filter((row) => {
      const inWindow = rowInWindow(row)
      if (filter === 'all' && !(inWindow || rowAtRisk(row) || row.flags?.unscheduled || row.flags?.baselinePending)) return false
      if (filter === 'risk' && !rowAtRisk(row)) return false
      if (filter === 'conflict' && !row.flags?.conflict) return false
      if (filter === 'overdue' && !row.flags?.overdue) return false
      if (filter === 'unscheduled' && !(row.flags?.unscheduled || row.flags?.invalidPlan)) return false
      if (filter === 'baseline' && !(row.flags?.baselinePending || row.flags?.baselineStale)) return false
      if (!search) return true
      return JSON.stringify({
        jobTitle: row.jobTitle,
        clientName: row.clientName,
        address: row.address,
        phase: row.phase,
        tasks: row.tasks?.map((task) => task.title),
      }).toLowerCase().includes(search)
    })
  }, [filter, query, rowAtRisk, rowInWindow, rows])
  const summary = useMemo(() => rows.reduce((result, row) => {
    if (rowInWindow(row)) result.inWindow += 1
    if (row.flags?.conflict) result.conflicts += 1
    if (row.flags?.overdue) result.overdue += 1
    if (row.flags?.unscheduled || row.flags?.invalidPlan) result.unscheduled += 1
    if (row.flags?.baselinePending || row.flags?.baselineStale) result.baselinePending += 1
    result.openTasks += Number(row.counts?.openTasks || 0)
    return result
  }, { inWindow: 0, conflicts: 0, overdue: 0, unscheduled: 0, baselinePending: 0, openTasks: 0 }), [rowInWindow, rows])
  const timelineTicks = useMemo(() => Array.from({ length: 5 }, (_, index) => (
    new Date(referenceMs + ((horizonEndMs - referenceMs) * index) / 4).toISOString()
  )), [horizonEndMs, referenceMs])

  const timelineGeometry = (row) => {
    const start = Date.parse(row.plannedStart || '')
    const end = Date.parse(row.plannedEnd || row.targetCompletion || '')
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
    const span = Math.max(1, horizonEndMs - referenceMs)
    const left = Math.max(0, Math.min(100, ((start - referenceMs) / span) * 100))
    const right = Math.max(0, Math.min(100, ((end - referenceMs) / span) * 100))
    return { left: `${left}%`, width: `${Math.max(2, right - left)}%` }
  }

  return (
    <section className="panel page-panel portfolio-schedule" data-testid="portfolio-schedule">
      <div className="panel-heading portfolio-schedule-heading">
        <div>
          <h2>Portfolio schedule</h2>
          <p>One retained look-ahead across task plans, baselines, overdue work, and current resource conflicts.</p>
        </div>
        {summary.conflicts ? (
          <button className="secondary-button" onClick={onOpenDispatch}>
            <MapPin size={16} />
            Review dispatch
          </button>
        ) : <span className="count-badge">{visibleRows.length}</span>}
      </div>
      <div className="portfolio-schedule-summary" aria-label="Portfolio schedule summary">
        <div><span>In look-ahead</span><strong>{summary.inWindow}</strong></div>
        <div><span>Conflicts</span><strong>{summary.conflicts}</strong></div>
        <div><span>Overdue</span><strong>{summary.overdue}</strong></div>
        <div><span>Unscheduled</span><strong>{summary.unscheduled}</strong></div>
        <div><span>Baseline review</span><strong>{summary.baselinePending}</strong></div>
        <div><span>Open tasks</span><strong>{summary.openTasks}</strong></div>
      </div>
      <div className="portfolio-schedule-toolbar">
        <div className="tab-switch portfolio-schedule-filters" role="tablist" aria-label="Schedule view">
          {PORTFOLIO_SCHEDULE_FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={filter === key ? 'tab-active' : ''}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="search-control portfolio-schedule-search">
          <Search size={16} />
          <span>Search schedule</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Job, client, location, or task"
          />
        </label>
        <label className="portfolio-horizon-control">
          <span>Horizon</span>
          <select value={horizonDays} onChange={(event) => setHorizonDays(Number(event.target.value))}>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
          </select>
        </label>
      </div>
      <div className="portfolio-timeline-heading" aria-hidden="true">
        <span>Job and plan state</span>
        <div>
          {timelineTicks.map((tick) => <span key={tick}>{formatDate(tick)}</span>)}
        </div>
      </div>
      <div className="portfolio-schedule-list">
        {visibleRows.map((item) => {
          const job = jobs.find((candidate) => candidate.id === item.jobId) || {
            id: item.jobId,
            title: item.jobTitle || 'Ledger job',
          }
          const geometry = timelineGeometry(item)
          const visibleTasks = (item.tasks || [])
            .filter((task) => task.overdue || task.inWindow || rowInWindow({ plannedStart: task.plannedStart, plannedEnd: task.plannedEnd || task.dueAt }))
            .sort((left, right) => String(left.plannedStart || left.dueAt || '').localeCompare(String(right.plannedStart || right.dueAt || '')))
            .slice(0, 3)
          return (
            <article className={`portfolio-schedule-row schedule-${item.scheduleStatus}`} key={item.jobId}>
              <div className="portfolio-schedule-copy">
                <div className="portfolio-schedule-title">
                  <div>
                    <h3>{item.jobTitle}</h3>
                    <p>{item.clientName || 'Client not set'} / {item.address || formatStatus(item.phase)}</p>
                  </div>
                  <span className={`status status-${item.scheduleStatus}`}>{formatStatus(item.scheduleStatus)}</span>
                </div>
                <div className="portfolio-schedule-flags">
                  {item.baseline ? (
                    <span className={item.flags?.baselineStale ? 'tag tag-amber' : 'tag tag-green'}>
                      Baseline v{item.baseline.versionNumber} {item.flags?.baselineStale ? 'stale' : formatStatus(item.baseline.status)}
                    </span>
                  ) : <span className="tag">No baseline</span>}
                  {item.counts?.criticalTasks ? <span className="tag tag-red">{item.counts.criticalTasks} critical</span> : null}
                  {item.counts?.overdueTasks ? <span className="tag tag-amber">{item.counts.overdueTasks} overdue</span> : null}
                  {item.counts?.workerConflicts ? <span className="tag tag-red">Crew conflict</span> : null}
                  {item.counts?.toolConflicts ? <span className="tag tag-red">Equipment conflict</span> : null}
                </div>
                <p className="portfolio-schedule-action">{item.planError?.message || item.nextAction}</p>
                <div className="portfolio-task-list">
                  {visibleTasks.map((task) => (
                    <div key={task.id}>
                      <span className={task.critical ? 'portfolio-task-critical' : ''}>{task.title}</span>
                      <small>{task.plannedStart ? `${formatDate(task.plannedStart)} to ${formatDate(task.plannedEnd || task.dueAt)}` : 'Date not retained'}</small>
                    </div>
                  ))}
                </div>
              </div>
              <div className="portfolio-timeline-cell">
                <div className="portfolio-timeline-track">
                  {geometry ? (
                    <span
                      className={`portfolio-timeline-span timeline-${item.scheduleStatus}`}
                      style={geometry}
                      title={`${formatDateTime(item.plannedStart)} to ${formatDateTime(item.plannedEnd)}`}
                    />
                  ) : <span className="portfolio-timeline-empty">Not scheduled</span>}
                </div>
                <div className="portfolio-timeline-dates">
                  <span>{item.plannedStart ? formatDate(item.plannedStart) : 'No start'}</span>
                  <span>{item.plannedEnd ? formatDate(item.plannedEnd) : 'No finish'}</span>
                </div>
                <div className="portfolio-schedule-actions">
                  {item.flags?.baselinePending && item.baseline?.approvalId && canApprove ? (
                    <button
                      className="secondary-button"
                      onClick={() => onOpenApprovals({
                        jobId: item.jobId,
                        jobTitle: item.jobTitle,
                        approvalId: item.baseline.approvalId,
                      })}
                    >
                      <ShieldCheck size={15} />
                      Review baseline
                    </button>
                  ) : null}
                  <button className="secondary-button" onClick={() => onOpen(job)}>
                    <ArrowUpRight size={15} />
                    Open job
                  </button>
                </div>
              </div>
            </article>
          )
        })}
        {!visibleRows.length ? (
          <Empty
            title="No schedule rows match"
            detail={`No retained work matches this filter between ${formatDate(referenceAt)} and ${formatDate(horizonEnd)}.`}
          />
        ) : null}
      </div>
    </section>
  )
}

function FinanceWorkspace({
  finance,
  cashFlow,
  jobs,
  canCoordinate,
  canApprove,
  submitting,
  onDraftInvoice,
  onPreparePackage,
  onAction,
  onOpenApprovals,
  onOpen,
  onCashFlowChange,
}) {
  const rows = finance?.jobs || EMPTY_LIST
  const summary = finance?.summary || {}
  return (
    <section className="panel page-panel finance-workspace" data-testid="finance-workspace">
      <div className="panel-heading">
        <div>
          <h2>Finance readiness</h2>
          <p>Review source-linked cost forecasts, commitments, receivables, supplier payables, and approval gates.</p>
        </div>
        <span className="count-badge">{rows.length}</span>
      </div>
      <LazyControlBoundary label="cash-flow forecast">
        <CashFlowForecastControl
          cashFlow={cashFlow}
          jobs={jobs}
          request={api}
          canCoordinate={canCoordinate}
          canApprove={canApprove}
          onChange={onCashFlowChange}
          onOpenApprovals={onOpenApprovals}
        />
      </LazyControlBoundary>
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
          <span>Forecast cost</span>
          <strong>{currency.format(summary.forecastCostValue || 0)}</strong>
        </div>
        <div>
          <span>Approved actual</span>
          <strong>{currency.format(summary.actualCostValue || 0)}</strong>
        </div>
        <div>
          <span>Unreviewed cost</span>
          <strong>{currency.format(summary.unreviewedCostValue || 0)}</strong>
        </div>
        <div>
          <span>Cost to complete</span>
          <strong>{currency.format(summary.costToCompleteValue || 0)}</strong>
        </div>
        <div>
          <span>Forecast margin</span>
          <strong>{currency.format(summary.forecastMarginValue || 0)}</strong>
        </div>
        <div>
          <span>Approvals</span>
          <strong>{summary.pendingApprovals || 0}</strong>
        </div>
      </div>
      <div className="finance-list">
        {rows.map((item) => {
          const job = jobs.find((candidate) => candidate.id === item.jobId) || { id: item.jobId, title: item.jobTitle || 'Ledger job' }
          const costForecast = item.costForecast || {}
          const forecastSummary = costForecast.summary || {}
          const canAct = canCoordinate && !item.flags?.approvalRequired
          const draftInvoiceAction = canAct ? item.nextActions?.find((action) => action.type === 'draft_invoice') : null
          const canDraftInvoice = Boolean(draftInvoiceAction) && !item.counts?.draftInvoices
          const prepareAction = canAct
            ? item.nextActions?.find((action) =>
                ['prepare_invoice_package', 'prepare_credit_note_package', 'prepare_purchase_order_package'].includes(action.type),
              )
            : null
          const issuePackage = item.latest?.invoice?.data?.issuePackage
          const creditNotePackage = item.latest?.creditNote?.data?.issuePackage
          const purchaseOrderPackage = item.latest?.purchaseOrder?.issuePackage
          const forecastAction = canAct ? item.nextActions?.find((action) => action.type === 'prepare_cost_forecast') : null
          const forecastRiskLines = (costForecast.lines || [])
            .filter((line) => line.overBudget || line.unbudgeted)
            .sort((left, right) => Number(left.variance || 0) - Number(right.variance || 0))
            .slice(0, 3)
          const forecastHistory = (costForecast.snapshots || []).slice(0, 4)
          const financeActions = canAct
            ? item.nextActions
                ?.filter(
                  (action) =>
                    action.type !== 'review_finance_approval' &&
                    action.type !== 'draft_invoice' &&
                    action.type !== 'prepare_cost_forecast' &&
                    !['prepare_invoice_package', 'prepare_credit_note_package', 'prepare_purchase_order_package'].includes(action.type) &&
                    FINANCE_ACTION_LABELS[action.type],
                )
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
                    Cost budget <strong>{currency.format(forecastSummary.budget || 0)}</strong>
                  </span>
                  <span>
                    Approved actual <strong>{currency.format(forecastSummary.actual || 0)}</strong>
                  </span>
                  <span>
                    Unreviewed cost <strong>{currency.format(forecastSummary.unreviewedCost || 0)}</strong>
                  </span>
                  <span>
                    Incurred evidence <strong>{currency.format(forecastSummary.incurredCost || 0)}</strong>
                  </span>
                  <span>
                    Issued commitments <strong>{currency.format(forecastSummary.externalCommitment || 0)}</strong>
                  </span>
                  <span>
                    Authorized, not issued <strong>{currency.format(forecastSummary.authorizedNotIssued || 0)}</strong>
                  </span>
                  <span>
                    Cost to complete <strong>{currency.format(forecastSummary.costToComplete || 0)}</strong>
                  </span>
                  <span>
                    EAC <strong>{currency.format(forecastSummary.estimateAtCompletion ?? forecastSummary.forecast ?? 0)}</strong>
                  </span>
                  <span>
                    VAC <strong>{currency.format(forecastSummary.varianceAtCompletion ?? forecastSummary.budgetVariance ?? 0)}</strong>
                  </span>
                  <span>
                    Forecast margin <strong>{currency.format(forecastSummary.projectedMargin || 0)}</strong>
                  </span>
                </div>
                {forecastRiskLines.length ? (
                  <div className="cost-forecast-risks" aria-label={`${item.jobTitle} cost forecast risks`}>
                    {forecastRiskLines.map((line) => (
                      <span key={line.costCode}>
                        <code>{line.costCode}</code>
                        {line.unbudgeted ? 'Unbudgeted' : `${currency.format(Math.abs(line.variance || 0))} over`}
                      </span>
                    ))}
                  </div>
                ) : null}
                {(costForecast.lines || []).length ? (
                  <details className="cost-forecast-detail">
                    <summary>
                      <span>Cost-code review</span>
                      <small>
                        {(costForecast.lines || []).length} code{(costForecast.lines || []).length === 1 ? '' : 's'}
                        {' / '}
                        {forecastSummary.reviewRequiredCostCodes || 0} awaiting source review
                      </small>
                    </summary>
                    <div className="cost-forecast-table-wrap">
                      <table className="cost-forecast-table">
                        <thead>
                          <tr>
                            <th scope="col">Cost code</th>
                            <th scope="col">Budget</th>
                            <th scope="col">Approved</th>
                            <th scope="col">Unreviewed</th>
                            <th scope="col">Commitments</th>
                            <th scope="col">CTC</th>
                            <th scope="col">EAC</th>
                            <th scope="col">VAC</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(costForecast.lines || []).map((line) => (
                            <tr key={line.costCode}>
                              <th scope="row">
                                <code>{line.costCode}</code>
                                <small>{line.description}</small>
                              </th>
                              <td>{currency.format(line.budget || 0)}</td>
                              <td>{currency.format(line.actual || 0)}</td>
                              <td className={line.unreviewedExposure > 0 ? 'cost-review-required' : ''}>
                                {currency.format(line.unreviewedExposure || 0)}
                              </td>
                              <td>
                                {currency.format(
                                  Number(line.externalCommitment || 0)
                                  + Number(line.authorizedNotIssued || 0)
                                  + Number(line.unreviewedCommitment || 0),
                                )}
                              </td>
                              <td>{currency.format(line.costToComplete || 0)}</td>
                              <td>{currency.format(line.estimateAtCompletion ?? line.forecast ?? 0)}</td>
                              <td className={line.varianceAtCompletion < 0 ? 'cost-over-budget' : ''}>
                                {currency.format(line.varianceAtCompletion ?? line.variance ?? 0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {(costForecast.warnings || []).length ? (
                      <ul className="cost-forecast-warnings" aria-label={`${item.jobTitle} cost forecast warnings`}>
                        {(costForecast.warnings || []).map((warning) => (
                          <li key={warning.code}>{warning.message}</li>
                        ))}
                      </ul>
                    ) : null}
                    {forecastHistory.length ? (
                      <div className="cost-forecast-history" aria-label={`${item.jobTitle} retained cost forecast history`}>
                        {forecastHistory.map((snapshot) => (
                          <span key={snapshot.id}>
                            <strong>{snapshot.forecastNumber}</strong>
                            <small>{formatStatus(snapshot.status)} / {formatDate(snapshot.asOfDate)}</small>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="cost-forecast-policy">
                      Forecast approval freezes this review only. Timesheets, receipts, supplier invoices, and purchase commitments retain their own approval gates.
                    </p>
                  </details>
                ) : null}
                <div className="finance-flags">
                  {costForecast.activeSnapshot ? (
                    <span className={`tag ${costForecast.snapshotCurrent ? 'tag-green' : 'tag-amber'}`}>
                      {costForecast.activeSnapshot.forecastNumber} {costForecast.snapshotCurrent ? 'current' : 'stale'}
                    </span>
                  ) : null}
                  {costForecast.pendingSnapshot ? (
                    <span className="tag tag-amber">{costForecast.pendingSnapshot.forecastNumber} awaiting approval</span>
                  ) : null}
                  {forecastSummary.costPerformanceIndex != null ? (
                    <span className={`tag ${forecastSummary.costPerformanceIndex >= 1 ? 'tag-green' : 'tag-amber'}`}>
                      CPI {Number(forecastSummary.costPerformanceIndex).toFixed(2)}
                    </span>
                  ) : null}
                  {forecastSummary.unbudgetedCostCodes ? (
                    <span className="tag tag-amber">{forecastSummary.unbudgetedCostCodes} unbudgeted cost code{forecastSummary.unbudgetedCostCodes === 1 ? '' : 's'}</span>
                  ) : null}
                  {forecastSummary.reviewRequired ? (
                    <span className="tag tag-amber">
                      {currency.format(forecastSummary.unreviewedExposure || 0)} awaiting source review
                    </span>
                  ) : null}
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
                  {item.counts?.pendingExpenses ? (
                    <span className="tag tag-amber">
                      {item.counts.pendingExpenses} expense receipt{item.counts.pendingExpenses === 1 ? '' : 's'} pending
                    </span>
                  ) : null}
                  {item.latest?.expense ? (
                    <span className={`tag ${item.latest.expense.status === 'approved' ? 'tag-green' : 'tag-amber'}`}>
                      {item.latest.expense.receiptReference || 'Expense'} / {formatStatus(item.latest.expense.status)}
                    </span>
                  ) : null}
                  {item.latest?.invoice?.data?.structuredExportRequested ? (
                    <span className={`tag ${item.latest.invoice.data.structuredReadiness?.ready ? 'tag-green' : 'tag-amber'}`}>
                      UBL {item.latest.invoice.data.structuredReadiness?.ready ? 'ready' : 'incomplete'}
                    </span>
                  ) : null}
                  {issuePackage ? <span className="tag tag-green">{issuePackage.issueReference}</span> : null}
                  {creditNotePackage ? <span className="tag tag-green">{creditNotePackage.issueReference}</span> : null}
                  {purchaseOrderPackage ? (
                    <span className={`tag ${item.latest?.purchaseOrder?.orderIssued ? 'tag-green' : 'tag-amber'}`}>
                      {purchaseOrderPackage.issueReference} {item.latest?.purchaseOrder?.orderIssued ? 'issued' : 'prepared'}
                    </span>
                  ) : null}
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
                    aria-label={`Prepare ${
                      prepareAction.type === 'prepare_credit_note_package'
                        ? 'credit note'
                        : prepareAction.type === 'prepare_purchase_order_package'
                          ? 'purchase order'
                          : 'invoice'
                    } package for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onPreparePackage(item, prepareAction)}
                  >
                    <PackageCheck size={16} />
                    {prepareAction.type === 'prepare_credit_note_package'
                      ? 'Prepare credit'
                      : prepareAction.type === 'prepare_purchase_order_package'
                        ? 'Prepare order'
                        : 'Prepare package'}
                  </button>
                ) : null}
                {forecastAction ? (
                  <button
                    className="secondary-button"
                    aria-label={`${forecastAction.label} for ${job.title}`}
                    disabled={submitting}
                    onClick={() => onAction(item, forecastAction)}
                  >
                    <Gauge size={16} />
                    {forecastAction.label}
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
                {purchaseOrderPackage?.htmlDocumentId ? (
                  <a
                    className="secondary-button"
                    aria-label={`Download purchase order ${purchaseOrderPackage.issueReference} for ${job.title}`}
                    href={`/api/ledger/documents/${encodeURIComponent(purchaseOrderPackage.htmlDocumentId)}/issue-package`}
                    download
                  >
                    <FileDown size={16} />
                    Order
                  </a>
                ) : null}
                {purchaseOrderPackage?.ublDocumentId ? (
                  <a
                    className="secondary-button"
                    aria-label={`Download purchase order UBL ${purchaseOrderPackage.issueReference} for ${job.title}`}
                    href={`/api/ledger/documents/${encodeURIComponent(purchaseOrderPackage.ublDocumentId)}/issue-package`}
                    download
                  >
                    <FileDown size={16} />
                    Order UBL
                  </a>
                ) : null}
                {financeActions.map((action) => (
                  <button
                    className="secondary-button"
                    key={`${action.type}-${action.creditNoteId || action.supplierInvoiceId || action.purchaseOrderId || action.invoiceId || action.paymentId || action.expenseId || item.jobId}`}
                    aria-label={`${FINANCE_ACTION_LABELS[action.type]} for ${job.title}`}
                    disabled={submitting}
                    onClick={() => action.type === 'review_cost_evidence' ? onOpen(job) : onAction(item, action)}
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
  const [pipelineView, setPipelineView] = useState('opportunities')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [data, setData] = useState(null)
  const [authState, setAuthState] = useState('checking')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [authError, setAuthError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [sectionLoading, setSectionLoading] = useState(false)
  const [commandPlanLoading, setCommandPlanLoading] = useState(false)
  const [commandPlanError, setCommandPlanError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showIntake, setShowIntake] = useState(false)
  const [opportunityEditor, setOpportunityEditor] = useState(null)
  const [opportunityDraft, setOpportunityDraft] = useState(() => emptyOpportunityDraft())
  const [selectedOpportunity, setSelectedOpportunity] = useState(null)
  const [opportunityActivity, setOpportunityActivity] = useState(null)
  const [opportunityActivityDraft, setOpportunityActivityDraft] = useState(() => emptyOpportunityActivityDraft())
  const [bidPackageEditor, setBidPackageEditor] = useState(false)
  const [bidPackageDraft, setBidPackageDraft] = useState(() => emptyBidPackageDraft())
  const [selectedBidPackage, setSelectedBidPackage] = useState(null)
  const [bidPackageAction, setBidPackageAction] = useState(null)
  const [bidReturnDraft, setBidReturnDraft] = useState(() => emptyBidReturnDraft())
  const [bidSelectionRationale, setBidSelectionRationale] = useState('')
  const [bidAddPartnerIds, setBidAddPartnerIds] = useState([])
  const [bidCommitmentDraft, setBidCommitmentDraft] = useState(() => emptyBidCommitmentDraft())
  const [bidOrderDraft, setBidOrderDraft] = useState(() => emptyBidOrderDraft())
  const [bidOrderDeliveryDraft, setBidOrderDeliveryDraft] = useState(() => emptyBidOrderDeliveryDraft())
  const [approvalFocus, setApprovalFocus] = useState(null)
  const [approvalReview, setApprovalReview] = useState(null)
  const [approvalReason, setApprovalReason] = useState('')
  const [selectedJobId, setSelectedJobId] = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [selectedJobLoading, setSelectedJobLoading] = useState(false)
  const [estimateRates, setEstimateRates] = useState(null)
  const [taskDraft, setTaskDraft] = useState(emptyTaskDraft)
  const [taskAction, setTaskAction] = useState(null)
  const [taskActionNote, setTaskActionNote] = useState('')
  const [takeoffDialog, setTakeoffDialog] = useState(null)
  const [takeoffDraft, setTakeoffDraft] = useState(() => emptyTakeoffDraft())
  const [takeoffItemDraft, setTakeoffItemDraft] = useState(() => emptyTakeoffItemDraft())
  const [takeoffConversionDraft, setTakeoffConversionDraft] = useState(emptyTakeoffConversionDraft)
  const [commercialDraftMode, setCommercialDraftMode] = useState(null)
  const [quoteDraft, setQuoteDraft] = useState(emptyQuoteDraft)
  const [changeOrderDraft, setChangeOrderDraft] = useState(emptyChangeOrderDraft)
  const [commercialAcceptance, setCommercialAcceptance] = useState(null)
  const [commercialAcceptanceDraft, setCommercialAcceptanceDraft] = useState(emptyCommercialAcceptanceDraft)
  const [commercialDelivery, setCommercialDelivery] = useState(null)
  const [commercialDeliveryDraft, setCommercialDeliveryDraft] = useState(() => emptyBidOrderDeliveryDraft())
  const [jobLifecycleAction, setJobLifecycleAction] = useState(null)
  const [jobLifecycleReason, setJobLifecycleReason] = useState('')
  const [showResourcePlanner, setShowResourcePlanner] = useState(false)
  const [resourceView, setResourceView] = useState('workforce')
  const [commandPlanView, setCommandPlanView] = useState('all')
  const [selectedCommandIds, setSelectedCommandIds] = useState([])
  const [automationControlDialog, setAutomationControlDialog] = useState(null)
  const [automationControlError, setAutomationControlError] = useState('')
  const automationControlOpenerRef = useRef(null)
  const [qaResetDialog, setQaResetDialog] = useState(null)
  const [qaResetError, setQaResetError] = useState('')
  const qaResetOpenerRef = useRef(null)
  const qaResetPreviewRequestRef = useRef(0)
  const [resourceAction, setResourceAction] = useState(null)
  const [resourceActionDraft, setResourceActionDraft] = useState(emptyResourceActionDraft)
  const [workerEditor, setWorkerEditor] = useState(null)
  const [workerDraft, setWorkerDraft] = useState(emptyWorkerDraft)
  const [workerRetirement, setWorkerRetirement] = useState(null)
  const [workerRetirementReason, setWorkerRetirementReason] = useState('')
  const [credentialEditor, setCredentialEditor] = useState(null)
  const [credentialDraft, setCredentialDraft] = useState(() => emptyWorkerCredentialDraft())
  const [qualificationRequirementEditor, setQualificationRequirementEditor] = useState(false)
  const [qualificationRequirementDraft, setQualificationRequirementDraft] = useState(() => emptyQualificationRequirementDraft())
  const [qualificationRequirementRetirement, setQualificationRequirementRetirement] = useState(null)
  const [qualificationRequirementRetirementReason, setQualificationRequirementRetirementReason] = useState('')
  const [availabilityEditor, setAvailabilityEditor] = useState(false)
  const [availabilityDraft, setAvailabilityDraft] = useState(() => emptyWorkerAvailabilityDraft())
  const [availabilityCancellation, setAvailabilityCancellation] = useState(null)
  const [availabilityCancellationReason, setAvailabilityCancellationReason] = useState('')
  const [materialReceiptEditor, setMaterialReceiptEditor] = useState(false)
  const [materialReceiptDraft, setMaterialReceiptDraft] = useState(() => emptyMaterialReceiptDraft())
  const [materialReceiptReversal, setMaterialReceiptReversal] = useState(null)
  const [materialReceiptReversalReason, setMaterialReceiptReversalReason] = useState('')
  const [equipmentEditor, setEquipmentEditor] = useState(null)
  const [equipmentDraft, setEquipmentDraft] = useState(emptyEquipmentDraft)
  const [equipmentInspection, setEquipmentInspection] = useState(null)
  const [equipmentInspectionDraft, setEquipmentInspectionDraft] = useState(emptyEquipmentInspectionDraft)
  const [equipmentMaintenance, setEquipmentMaintenance] = useState(null)
  const [equipmentMaintenanceDraft, setEquipmentMaintenanceDraft] = useState(emptyEquipmentMaintenanceDraft)
  const [equipmentRetirement, setEquipmentRetirement] = useState(null)
  const [equipmentRetirementReason, setEquipmentRetirementReason] = useState('')
  const [equipmentCheckoutEditor, setEquipmentCheckoutEditor] = useState(false)
  const [equipmentCheckoutDraft, setEquipmentCheckoutDraft] = useState(() => emptyEquipmentCheckoutDraft())
  const [equipmentCheckoutPlans, setEquipmentCheckoutPlans] = useState([])
  const [equipmentReturnEditor, setEquipmentReturnEditor] = useState(null)
  const [equipmentReturnDraft, setEquipmentReturnDraft] = useState(() => emptyEquipmentReturnDraft())
  const [tradePartnerEditor, setTradePartnerEditor] = useState(null)
  const [tradePartnerDraft, setTradePartnerDraft] = useState(emptyTradePartnerDraft)
  const [tradePartnerRetirement, setTradePartnerRetirement] = useState(null)
  const [tradePartnerRetirementReason, setTradePartnerRetirementReason] = useState('')
  const [organizationProfileDraft, setOrganizationProfileDraft] = useState(() => organizationDraft())
  const [showOrganizationOnboarding, setShowOrganizationOnboarding] = useState(false)
  const organizationOnboardingOpenerRef = useRef(null)
  const [invoiceJob, setInvoiceJob] = useState(null)
  const [invoiceDraft, setInvoiceDraft] = useState(() => emptyInvoiceDraft())
  const [financeAction, setFinanceAction] = useState(null)
  const [financeActionDraft, setFinanceActionDraft] = useState(emptyFinanceActionDraft)
  const [financeOrderDelivery, setFinanceOrderDelivery] = useState(null)
  const [financeOrderDeliveryDraft, setFinanceOrderDeliveryDraft] = useState(() => emptyBidOrderDeliveryDraft())
  const [clientEditor, setClientEditor] = useState(null)
  const [clientDraft, setClientDraft] = useState(() => emptyClientDraft())
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
  const [portalDraft, setPortalDraft] = useState({ label: 'Client job portal', expiresAt: futureDateInput(30), locale: 'nl-NL' })
  const [portalLink, setPortalLink] = useState('')
  const [notice, setNotice] = useState(null)
  const [localeSaving, setLocaleSaving] = useState(false)
  const [intake, setIntake] = useState({ clientName: '', title: '', service: '', address: '', description: '', priority: 'medium' })
  const [evidence, setEvidence] = useState(() => emptyFieldEvidenceDraft())
  const [fieldPhotoEvidenceSets, setFieldPhotoEvidenceSets] = useState([])
  const [fieldProgress, setFieldProgress] = useState(emptyFieldProgress)
  const [dailyHuddle, setDailyHuddle] = useState(emptyDailyHuddle)
  const [fieldDailyCycles, setFieldDailyCycles] = useState([])
  const [dailyCycleLoading, setDailyCycleLoading] = useState(false)
  const [fieldDailyLog, setFieldDailyLog] = useState(emptyFieldDailyLog)
  const [fieldMaterialReceipt, setFieldMaterialReceipt] = useState(() => emptyMaterialReceiptDraft())
  const [fieldMaterialReceiptPlans, setFieldMaterialReceiptPlans] = useState([])
  const [materialReceiptLoading, setMaterialReceiptLoading] = useState(false)
  const [fieldExpenseReceipt, setFieldExpenseReceipt] = useState(() => emptyFieldExpenseReceiptDraft())
  const [fieldExpenseReceipts, setFieldExpenseReceipts] = useState([])
  const [expenseReceiptLoading, setExpenseReceiptLoading] = useState(false)
  const [fieldEnvironmentalActivity, setFieldEnvironmentalActivity] = useState(() => emptyFieldEnvironmentalDraft())
  const [fieldEnvironmentalActivities, setFieldEnvironmentalActivities] = useState([])
  const [environmentalRegister, setEnvironmentalRegister] = useState(null)
  const [environmentalReports, setEnvironmentalReports] = useState([])
  const [environmentalLoading, setEnvironmentalLoading] = useState(false)
  const [environmentalReportDraft, setEnvironmentalReportDraft] = useState(() => emptyEnvironmentalReportDraft())
  const [environmentalReversal, setEnvironmentalReversal] = useState(null)
  const [environmentalReversalReason, setEnvironmentalReversalReason] = useState('')
  const [fieldEquipmentCheckout, setFieldEquipmentCheckout] = useState(() => emptyEquipmentCheckoutDraft())
  const [fieldEquipmentReturn, setFieldEquipmentReturn] = useState(() => emptyEquipmentReturnDraft())
  const [fieldEquipmentPlans, setFieldEquipmentPlans] = useState([])
  const [fieldEquipmentCustody, setFieldEquipmentCustody] = useState([])
  const [attendanceDraft, setAttendanceDraft] = useState(emptyAttendanceDraft)
  const [safetyBriefingDraft, setSafetyBriefingDraft] = useState(emptySafetyBriefingDraft)
  const [safetyBriefingLoading, setSafetyBriefingLoading] = useState(false)
  const [workPermitDraft, setWorkPermitDraft] = useState(emptyWorkPermitDraft)
  const [workPermitLoading, setWorkPermitLoading] = useState(false)
  const [outboxPending, setOutboxPending] = useState(0)
  const [outboxQuarantined, setOutboxQuarantined] = useState(0)
  const [outboxSyncing, setOutboxSyncing] = useState(false)
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine !== false)
  const exportInputRef = useRef(null)
  const evidenceInputRef = useRef(null)
  const fieldCaptureRef = useRef(null)
  const workerDialogOpenerRef = useRef(null)
  const qualificationDialogOpenerRef = useRef(null)
  const availabilityDialogOpenerRef = useRef(null)
  const equipmentDialogOpenerRef = useRef(null)
  const equipmentInspectionOpenerRef = useRef(null)
  const equipmentMaintenanceOpenerRef = useRef(null)
  const commercialDialogOpenerRef = useRef(null)
  const commercialDialogReturnFocusRef = useRef(false)
  const noticeSequenceRef = useRef(0)
  const hasLoadedDataRef = useRef(false)
  const fullLoadSequenceRef = useRef(0)
  const sectionRef = useRef('today')
  const resourceViewRef = useRef('workforce')
  const sectionLoadSequenceRef = useRef(0)
  const dailyCycleLoadSequenceRef = useRef(0)
  const materialReceiptLoadSequenceRef = useRef(0)
  const expenseReceiptLoadSequenceRef = useRef(0)
  const environmentalLoadSequenceRef = useRef(0)
  const safetyBriefingLoadSequenceRef = useRef(0)
  const workPermitLoadSequenceRef = useRef(0)
  const lastPlannerWeekRef = useRef('')
  const resourceViewLoadTimerRef = useRef(null)

  useEffect(() => () => {
    if (resourceViewLoadTimerRef.current) clearTimeout(resourceViewLoadTimerRef.current)
  }, [])

  useEffect(() => {
    const updateNetworkState = () => setNetworkOnline(navigator.onLine !== false)
    window.addEventListener('online', updateNetworkState)
    window.addEventListener('offline', updateNetworkState)
    return () => {
      window.removeEventListener('online', updateNetworkState)
      window.removeEventListener('offline', updateNetworkState)
    }
  }, [])

  const refresh = useCallback(async () => {
    const sequence = ++fullLoadSequenceRef.current
    setLoading(true)
    setError('')
    try {
      const sessionResult = await api('/api/session')
      if (sequence !== fullLoadSequenceRef.current) return
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
      if (sequence !== fullLoadSequenceRef.current) return
      if (fieldScoped) {
        const scopedJobs = jobsResult.jobs || []
        hasLoadedDataRef.current = true
        setData({
          session: sessionResult,
          dashboard: fieldScopedDashboard(scopedJobs),
          jobs: scopedJobs,
          approvals: [],
          dispatch: { rows: [] },
          schedule: { jobs: [], summary: {}, window: null },
          crewCapacity: null,
          lastPlanner: null,
          workforce: { jobs: [], summary: {} },
          workers: [],
          workerSummary: {},
          qualificationRegister: { catalog: { credentials: [], requirements: [] }, summary: {}, workers: [], requirements: [], jobs: [] },
          availabilityRegister: { catalog: [], summary: {}, workers: [], periods: [], conflicts: [] },
          timesheets: { rows: [], exports: [], summary: {} },
          tools: [],
          toolSummary: {},
          inventory: { jobs: [], summary: {} },
          materialReceiving: { summary: {}, receipts: [], purchaseOrders: [], actions: [], policy: {} },
          equipmentCustody: { summary: {}, sessions: [], active: [], exceptions: [], actions: [], policy: {} },
          fiveS: null,
          tradePartners: [],
          tradePartnerSummary: {},
          finance: { jobs: [], summary: {} },
          clients: { jobs: [], summary: {} },
          field: { rows: [] },
          attendance: { rows: [], summary: {} },
          safetyMeetings: [],
          workPermits: [],
          inspectionTemplates: [],
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
          marketFit: null,
          bidDecisions: null,
          bidPackages: [],
          bidPackageSummary: {},
          performanceScorecard: null,
          frameworkCatalog: null,
          frameworkWorkspace: null,
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
          schedule: { jobs: [], summary: {}, window: null },
          crewCapacity: null,
          lastPlanner: null,
          workforce: { jobs: [], summary: {} },
          workers: [],
          workerSummary: {},
          qualificationRegister: { catalog: { credentials: [], requirements: [] }, summary: {}, workers: [], requirements: [], jobs: [] },
          availabilityRegister: { catalog: [], summary: {}, workers: [], periods: [], conflicts: [] },
          timesheets: { rows: [], exports: [], summary: {} },
          tools: [],
          toolSummary: {},
          inventory: { jobs: [], summary: {} },
          materialReceiving: { summary: {}, receipts: [], purchaseOrders: [], actions: [], policy: {} },
          equipmentCustody: { summary: {}, sessions: [], active: [], exceptions: [], actions: [], policy: {} },
          fiveS: null,
          tradePartners: [],
          tradePartnerSummary: {},
          finance: { jobs: [], summary: {} },
          clients: { jobs: [], summary: {} },
          field: { rows: [] },
          attendance: { rows: [], summary: {} },
          safetyMeetings: [],
          workPermits: [],
          inspectionTemplates: [],
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
          marketFit: null,
          bidDecisions: null,
          bidPackages: [],
          bidPackageSummary: {},
          performanceScorecard: null,
          frameworkCatalog: null,
          frameworkWorkspace: null,
        })
      }
      const currentSection = sectionRef.current
      const [dashboardResult, approvalsResult, sectionPatch] = await Promise.all([
        api('/api/ledger/dashboard'),
        api('/api/ledger/approvals?status=pending&limit=100'),
        loadSectionPatch(currentSection, resourceViewRef.current, fieldScoped, {
          lastPlannerWeekStart: lastPlannerWeekRef.current,
        }),
      ])
      if (sequence !== fullLoadSequenceRef.current) return
      const currentSectionPatch = sectionRef.current === currentSection ? sectionPatch : {}
      if (currentSectionPatch.lastPlanner?.week?.weekStart) {
        lastPlannerWeekRef.current = currentSectionPatch.lastPlanner.week.weekStart
      }
      if (currentSectionPatch.organization) setOrganizationProfileDraft(organizationDraft(currentSectionPatch.organization))
      hasLoadedDataRef.current = true
      setData((current) => ({
        ...current,
        ...currentSectionPatch,
        session: sessionResult,
        dashboard: dashboardResult.dashboard,
        jobs: jobsResult.jobs || [],
        approvals: approvalsResult.approvals || [],
        health: healthResult,
        readiness: readinessResult,
      }))
    } catch (requestError) {
      if (sequence !== fullLoadSequenceRef.current) return
      if (requestError.status === 401 || requestError.code === 'authentication_required') {
        setData(null)
        setAuthState('required')
        setAuthError('Your operator session has expired. Sign in again.')
      } else {
        setAuthState('active')
        if (navigator.onLine === false && hasLoadedDataRef.current) setError('')
        else setError(requestError.message)
      }
    } finally {
      if (sequence === fullLoadSequenceRef.current) setLoading(false)
    }
  }, [])

  const dashboard = data?.dashboard
  const operator = data?.session?.operator || { role: 'owner' }
  const operatorLocale = normalizeLocale(operator.preferences?.locale)
  setDashboardLocale(operatorLocale)
  const fieldScoped = operator.fieldScoped === true
  const outboxScope = fieldOutboxOperatorScope(operator)
  const draftRecoveryEnabled = authState === 'active' && Boolean(data?.session?.operator)
  useEffect(() => {
    document.documentElement.lang = operatorLocale.slice(0, 2)
  }, [operatorLocale])
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'intake-open', value: showIntake, setValue: setShowIntake })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'intake', value: intake, setValue: setIntake })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'opportunity-editor', value: opportunityEditor, setValue: setOpportunityEditor })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'opportunity', value: opportunityDraft, setValue: setOpportunityDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'bid-package-open', value: bidPackageEditor, setValue: setBidPackageEditor })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'bid-package', value: bidPackageDraft, setValue: setBidPackageDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'task', value: taskDraft, setValue: setTaskDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'takeoff', value: takeoffDraft, setValue: setTakeoffDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'takeoff-item', value: takeoffItemDraft, setValue: setTakeoffItemDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'takeoff-conversion', value: takeoffConversionDraft, setValue: setTakeoffConversionDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'commercial-mode', value: commercialDraftMode, setValue: setCommercialDraftMode })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'quote', value: quoteDraft, setValue: setQuoteDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'change-order', value: changeOrderDraft, setValue: setChangeOrderDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'worker-editor', value: workerEditor, setValue: setWorkerEditor })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'worker', value: workerDraft, setValue: setWorkerDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'equipment-editor', value: equipmentEditor, setValue: setEquipmentEditor })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'equipment', value: equipmentDraft, setValue: setEquipmentDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'trade-partner-editor', value: tradePartnerEditor, setValue: setTradePartnerEditor })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'trade-partner', value: tradePartnerDraft, setValue: setTradePartnerDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'client-editor', value: clientEditor, setValue: setClientEditor })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'client', value: clientDraft, setValue: setClientDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'schedule', value: scheduleDraft, setValue: setScheduleDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'weather', value: weatherDraft, setValue: setWeatherDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'resource', value: resourceDraft, setValue: setResourceDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'communication', value: communicationDraft, setValue: setCommunicationDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'portal-link', value: portalDraft, setValue: setPortalDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'field-progress', value: fieldProgress, setValue: setFieldProgress })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'daily-huddle', value: dailyHuddle, setValue: setDailyHuddle })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'daily-log', value: fieldDailyLog, setValue: setFieldDailyLog })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'material-receipt', value: fieldMaterialReceipt, setValue: setFieldMaterialReceipt })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'expense-receipt', value: fieldExpenseReceipt, setValue: setFieldExpenseReceipt })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'environmental-activity', value: fieldEnvironmentalActivity, setValue: setFieldEnvironmentalActivity })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'attendance', value: attendanceDraft, setValue: setAttendanceDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'safety-briefing', value: safetyBriefingDraft, setValue: setSafetyBriefingDraft })
  useSessionDraftRecovery({ enabled: draftRecoveryEnabled, scope: outboxScope, name: 'work-permit', value: workPermitDraft, setValue: setWorkPermitDraft })

  const sessionCapabilities = data?.session?.operator?.capabilities
  const capabilities = useMemo(() => sessionCapabilities || {}, [sessionCapabilities])
  const canCoordinate = !fieldScoped && capabilities.intake === true
  const canManageMarketFitPolicy = operator.role === 'owner'
  const operationCapabilities = data?.operationsCapabilities?.capabilities || null
  const automationControl = operationCapabilities?.automation?.control || data?.scheduler?.control || null
  const automationSuspended = automationControl?.suspended === true
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
  const inspectionTemplates = data?.inspectionTemplates ?? EMPTY_LIST
  const attendance = data?.attendance || { rows: EMPTY_LIST, summary: {} }
  const safetyMeetings = data?.safetyMeetings ?? EMPTY_LIST
  const workPermits = data?.workPermits ?? EMPTY_LIST
  const visibleApprovals = useMemo(() => {
    if (!approvalFocus) return approvals
    if (approvalFocus.approvalId) return approvals.filter((approval) => approval.id === approvalFocus.approvalId)
    return approvals.filter((approval) => approval.jobId === approvalFocus.jobId)
  }, [approvalFocus, approvals])
  const activeJobs = useMemo(
    () => jobs.filter((job) => !['archived', 'completed', 'cancelled', 'rejected'].includes(job.status)).slice(0, 8),
    [jobs],
  )
  const selectedFieldPhotoEvidenceSet = fieldPhotoEvidenceSets.find(set => set.id === evidence.photoEvidenceSetId) || null
  const availableFieldPhotoEvidenceSets = fieldPhotoEvidenceSets.filter(set => (
    !['captures_complete', 'pending_review', 'released'].includes(set.status)
    && set.integrityValid !== false
    && set.sourceCurrent !== false
  ))
  const selectedFieldMaterialReceiptPlan = fieldMaterialReceiptPlans.find(plan => plan.purchaseOrder?.id === fieldMaterialReceipt.purchaseOrderId) || null
  const selectedDailyCycle = fieldDailyCycles.find(cycle => cycle.id === fieldDailyLog.cycleId) || null
  const selectedEquipmentCheckoutPlan = equipmentCheckoutPlans.find(plan => plan.reservation?.id === equipmentCheckoutDraft.reservationId) || null
  const selectedFieldEquipmentPlan = fieldEquipmentPlans.find(plan => plan.reservation?.id === fieldEquipmentCheckout.reservationId) || null
  const attendanceWorkerId = fieldScoped ? operator.worker?.id || null : attendanceDraft.workerId || null
  const currentAttendanceSession = useMemo(
    () => (attendance.rows || []).find((session) => (
      session.status === 'checked_in'
      && (!attendanceDraft.jobId || session.jobId === attendanceDraft.jobId)
      && (!attendanceWorkerId || session.workerId === attendanceWorkerId)
    )) || null,
    [attendance.rows, attendanceDraft.jobId, attendanceWorkerId],
  )
  const selectedSafetyMeeting = safetyMeetings.find((meeting) => meeting.id === safetyBriefingDraft.meetingId) || null
  const selectedJobSafetyMeetings = safetyMeetings.filter((meeting) => meeting.jobId === safetyBriefingDraft.jobId)
  const selectedWorkPermit = workPermits.find((permit) => permit.id === workPermitDraft.permitId) || null
  const selectedJobWorkPermits = workPermits.filter((permit) => permit.jobId === workPermitDraft.jobId)
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
    (commercialDraftMode !== 'quote' || Boolean(
      selectedJob?.commercialScope?.ready === true
      && selectedJob?.pricingBasis?.currentDecision
      && selectedJob?.pricingBasis?.stale !== true
    )) &&
    (commercialDraftMode !== 'change_order' ||
      (changeOrderDraft.title.trim().length >= 2 &&
        changeOrderDraft.scopeDelta.trim().length >= 3 &&
        changeOrderDraft.cause.trim().length >= 8 &&
        changeOrderDraft.justification.trim().length >= 8 &&
        changeOrderDraft.contractReference.trim().length >= 3 &&
        (changeOrderDraft.noticeReference.trim().length >= 3 || changeOrderDraft.noticeNotApplicableReason.trim().length >= 8) &&
        changeOrderDraft.scheduleImpactNarrative.trim().length >= 8 &&
        changeOrderDraft.riskImpactStatement.trim().length >= 8 &&
        changeOrderDraft.assumptions.trim().length >= 3 &&
        changeOrderDraft.exclusions.trim().length >= 3))
  const takeoffPreviewQuantity = takeoffDraftQuantity(takeoffItemDraft)
  const takeoffPreviewCost = roundMoney(takeoffPreviewQuantity * (Number(takeoffItemDraft.unitCost) || 0))
  const takeoffPreviewSell = roundMoney(takeoffPreviewQuantity * (Number(takeoffItemDraft.unitPrice) || 0))
  const takeoffItemDraftReady =
    takeoffItemDraft.description.trim().length >= 2 &&
    /^[A-Za-z0-9][A-Za-z0-9-]{0,11}(?:\.[A-Za-z0-9][A-Za-z0-9-]{0,11}){0,7}$/.test(takeoffItemDraft.wbsCode.trim()) &&
    takeoffItemDraft.workPackage.trim().length >= 2 &&
    takeoffPreviewQuantity > 0 &&
    Number.isFinite(Number(takeoffItemDraft.unitCost)) &&
    Number(takeoffItemDraft.unitCost) >= 0 &&
    Number.isFinite(Number(takeoffItemDraft.unitPrice)) &&
    Number(takeoffItemDraft.unitPrice) >= 0 &&
    takeoffItemDraft.unit.trim().length > 0
  const initialDataLoading = !hasLoadedDataRef.current
  const visibleNavItems = useMemo(
    () =>
      navItems.filter(([key]) => {
        if (key === 'pipeline') return capabilities.pipeline
        if (key === 'schedule') return capabilities.schedule
        if (key === 'approvals') return capabilities.approvals
        if (key === 'dispatch') return capabilities.dispatch
        if (key === 'resources') return capabilities.resources
        if (key === 'finance') return capabilities.finance
        if (key === 'performance') return capabilities.performance
        if (key === 'clients') return capabilities.clientSuccess
        if (key === 'field') return capabilities.fieldEvidence
        if (key === 'operations') return capabilities.maintenance
        return true
      }).map(([key, icon]) => [key, appText(operatorLocale, `nav.${key}`), icon]),
    [capabilities, operatorLocale],
  )

  async function refreshOperationsCommandPlan(sequence = sectionLoadSequenceRef.current) {
    setCommandPlanLoading(true)
    setCommandPlanError('')
    try {
      const commandPlan = await api('/api/ledger/command-plan?limit=100&jobLimit=12')
      if (sequence !== sectionLoadSequenceRef.current || sectionRef.current !== 'operations') return
      setData((current) => current ? { ...current, commandPlan } : current)
    } catch (requestError) {
      if (sequence === sectionLoadSequenceRef.current && sectionRef.current === 'operations') {
        setCommandPlanError(requestError.message)
      }
    } finally {
      if (sequence === sectionLoadSequenceRef.current && sectionRef.current === 'operations') {
        setCommandPlanLoading(false)
      }
    }
  }

  function refreshCurrentView() {
    void refresh()
    if (sectionRef.current === 'operations') void refreshOperationsCommandPlan()
  }

  async function refreshSection(next, nextResourceView = resourceViewRef.current) {
    if (next === 'today') return
    const sequence = ++sectionLoadSequenceRef.current
    setSectionLoading(true)
    setError('')
    try {
      const patch = await loadSectionPatch(next, nextResourceView, fieldScoped, {
        lastPlannerWeekStart: lastPlannerWeekRef.current,
      })
      if (sequence !== sectionLoadSequenceRef.current) return
      if (patch.lastPlanner?.week?.weekStart) {
        lastPlannerWeekRef.current = patch.lastPlanner.week.weekStart
      }
      if (patch.organization) setOrganizationProfileDraft(organizationDraft(patch.organization))
      setData((current) => current ? { ...current, ...patch } : current)
      if (next === 'operations') void refreshOperationsCommandPlan(sequence)
    } catch (requestError) {
      if (sequence === sectionLoadSequenceRef.current) setError(requestError.message)
    } finally {
      if (sequence === sectionLoadSequenceRef.current) setSectionLoading(false)
    }
  }

  const selectSection = (next) => {
    if (initialDataLoading && !['today', 'jobs'].includes(next)) return
    if (resourceViewLoadTimerRef.current) {
      clearTimeout(resourceViewLoadTimerRef.current)
      resourceViewLoadTimerRef.current = null
      setSectionLoading(false)
    }
    setApprovalFocus(null)
    sectionRef.current = next
    setSection(next)
    setMobileNavOpen(false)
    void refreshSection(next)
  }
  const selectResourceView = (next) => {
    resourceViewRef.current = next
    setResourceView(next)
    if (sectionRef.current !== 'resources') return
    if (resourceViewLoadTimerRef.current) clearTimeout(resourceViewLoadTimerRef.current)
    setSectionLoading(true)
    resourceViewLoadTimerRef.current = setTimeout(() => {
      resourceViewLoadTimerRef.current = null
      void refreshSection('resources', next)
    }, 120)
  }

  async function loadTimesheetPeriod(periodStart) {
    const sequence = ++sectionLoadSequenceRef.current
    setSectionLoading(true)
    setError('')
    try {
      const result = await api(`/api/ledger/timesheets?periodStart=${encodeURIComponent(periodStart)}`)
      if (sequence !== sectionLoadSequenceRef.current) return
      setData((current) => current ? { ...current, timesheets: result.timesheets || { rows: [], exports: [], summary: {} } } : current)
    } catch (requestError) {
      if (sequence === sectionLoadSequenceRef.current) setError(requestError.message)
    } finally {
      if (sequence === sectionLoadSequenceRef.current) setSectionLoading(false)
    }
  }

  async function requestWorkerTimesheet(workerId, periodStart) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/workers/${encodeURIComponent(workerId)}/timesheets`, {
        method: 'POST',
        body: JSON.stringify({ periodStart }),
      })
      setData((current) => current ? {
        ...current,
        timesheets: result.timesheets || current.timesheets,
        approvals: result.approval ? upsertById(current.approvals, result.approval) : current.approvals,
      } : current)
      notify(result.replayed ? 'The current weekly timesheet review already exists.' : 'Weekly timesheet frozen and sent to the internal approval queue.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function prepareTimesheetHandoff(periodStart) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api('/api/ledger/timesheet-exports', {
        method: 'POST',
        body: JSON.stringify({ periodStart }),
      })
      setData((current) => current ? { ...current, timesheets: result.timesheets || current.timesheets } : current)
      notify(result.replayed ? 'The current checksum-protected handoff already exists.' : 'Checksum-protected timesheet handoff prepared. No payroll or provider action was performed.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }
  const openApprovals = (focus = null) => {
    if (selectedJobId) closeJobWorkspace()
    setApprovalFocus(focus)
    sectionRef.current = 'approvals'
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
      clearSessionDraftScope(browserDraftStorage(), outboxScope)
      setData(null)
      setAuthError('')
      setAuthState('required')
      sectionRef.current = 'today'
      setSection('today')
      setOutboxPending(0)
      setOutboxQuarantined(0)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }, [outboxScope])

  async function updateOperatorLocale(nextLocale) {
    const locale = normalizeLocale(nextLocale)
    if (locale === operatorLocale || localeSaving) return
    setLocaleSaving(true)
    try {
      const result = await api('/api/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ locale }),
      })
      setData((current) => current ? {
        ...current,
        session: {
          ...current.session,
          operator: { ...current.session.operator, preferences: result.preferences },
        },
      } : current)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLocaleSaving(false)
    }
  }

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
          if (selectedJobId) {
            const selected = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}`)
            setSelectedJob(selected.job)
          }
        }
        if (announce && result.stopped && result.stopped !== 'offline')
          setError(result.stopped.message || 'A queued field update could not be recorded.')
      } catch (requestError) {
        if (announce) setError(requestError.message)
      } finally {
        setOutboxSyncing(false)
      }
    },
    [notify, outboxScope, refresh, selectedJobId],
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (
      !commercialDialogReturnFocusRef.current ||
      submitting ||
      commercialDraftMode ||
      commercialAcceptance ||
      commercialDelivery ||
      takeoffDialog
    )
      return
    const opener = commercialDialogOpenerRef.current
    commercialDialogReturnFocusRef.current = false
    commercialDialogOpenerRef.current = null
    requestAnimationFrame(() => {
      if (opener?.isConnected && !opener.disabled) opener.focus()
    })
  }, [commercialAcceptance, commercialDelivery, commercialDraftMode, submitting, takeoffDialog])

  useEffect(() => {
    if (!notice || loading || submitting || outboxSyncing) return undefined
    const timer = window.setTimeout(() => setNotice(null), 8000)
    return () => window.clearTimeout(timer)
  }, [loading, notice, outboxSyncing, submitting])

  useEffect(() => {
    if (!visibleNavItems.some(([key]) => key === section)) {
      sectionRef.current = 'today'
      setSection('today')
    }
  }, [section, visibleNavItems])

  useEffect(() => {
    const jobId = safetyBriefingDraft.jobId
    if (!jobId) return
    const currentIsValid = safetyMeetings.some((meeting) => (
      meeting.id === safetyBriefingDraft.meetingId && meeting.jobId === jobId
    ))
    if (currentIsValid) return
    const firstMeeting = safetyMeetings.find((meeting) => (
      meeting.jobId === jobId && ['scheduled', 'in_progress', 'pending_approval'].includes(meeting.status)
    )) || safetyMeetings.find((meeting) => meeting.jobId === jobId)
    if (!firstMeeting) return
    setSafetyBriefingDraft((current) => (
      current.jobId === jobId && current.meetingId !== firstMeeting.id
        ? { ...current, meetingId: firstMeeting.id }
        : current
    ))
  }, [safetyBriefingDraft.jobId, safetyBriefingDraft.meetingId, safetyMeetings])

  useEffect(() => {
    const jobId = workPermitDraft.jobId
    if (!jobId) return
    const currentIsValid = workPermits.some((permit) => (
      permit.id === workPermitDraft.permitId && permit.jobId === jobId
    ))
    if (currentIsValid) return
    const firstPermit = workPermits.find((permit) => (
      permit.jobId === jobId && ['active', 'pending_approval', 'suspended'].includes(permit.status)
    )) || workPermits.find((permit) => permit.jobId === jobId)
    if (!firstPermit) return
    setWorkPermitDraft((current) => (
      current.jobId === jobId && current.permitId !== firstPermit.id
        ? { ...current, permitId: firstPermit.id }
        : current
    ))
  }, [workPermitDraft.jobId, workPermitDraft.permitId, workPermits])

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
      const result = await api(`/api/ledger/approvals/${item.id}/resolve?includeDashboard=false`, {
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
      if (result.bidPackage) {
        setSelectedBidPackage(result.bidPackage)
        setData((current) => {
          if (!current) return current
          const next = reconcileApprovalResolution({
            ...current,
            bidPackages: upsertById(current.bidPackages, result.bidPackage),
          }, item.id, result.dashboard)
          return result.job ? reconcileJobCollections(next, result.job) : next
        })
        if (result.job && selectedJobId === result.job.id) setSelectedJob(result.job)
      } else if (result.job) {
        setData((current) => reconcileJobCollections(
          reconcileApprovalResolution(current, item.id, result.dashboard),
          result.job,
        ))
        if (selectedJobId === result.job.id) setSelectedJob(result.job)
      } else {
        await refresh()
      }
      if (item.targetType === 'opportunity_site_survey' && item.data?.opportunityId) {
        const detail = await api(`/api/ledger/opportunities/${encodeURIComponent(item.data.opportunityId)}`)
        setSelectedOpportunity((current) => current?.id === item.data.opportunityId ? detail.opportunity : current)
        setData((current) => current ? {
          ...current,
          opportunities: (current.opportunities || EMPTY_LIST).map((opportunity) =>
            opportunity.id === detail.opportunity.id ? detail.opportunity : opportunity,
          ),
        } : current)
      }
      setSubmitting(false)
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

  async function refreshOpportunityDetail(opportunityId) {
    const detail = await api(`/api/ledger/opportunities/${encodeURIComponent(opportunityId)}`)
    setSelectedOpportunity((current) => current?.id === opportunityId ? detail.opportunity : current)
    setData((current) => current ? {
      ...current,
      opportunities: (current.opportunities || EMPTY_LIST).map((opportunity) =>
        opportunity.id === opportunityId ? detail.opportunity : opportunity,
      ),
    } : current)
    return detail.opportunity
  }

  async function planOpportunitySiteSurvey(payload) {
    if (!selectedOpportunity?.id) return null
    const opportunityId = selectedOpportunity.id
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/opportunities/${encodeURIComponent(opportunityId)}/site-surveys`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      await refreshOpportunityDetail(opportunityId)
      notify(result.replayed ? 'The matching internal site-survey plan already exists.' : 'Internal site-survey plan retained. No appointment confirmation was sent.')
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function uploadOpportunitySiteSurveyEvidence(file) {
    if (!selectedOpportunity?.id || !file) return null
    const opportunityId = selectedOpportunity.id
    const payload = new FormData()
    payload.append('evidenceFile', file)
    payload.append('opportunityId', opportunityId)
    payload.append('title', file.name || 'Site-survey evidence')
    payload.append('category', 'site_survey_evidence')
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/ledger/upload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Idempotency-Key': `site-survey-upload:${opportunityId}:${globalThis.crypto.randomUUID()}` },
        body: payload,
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        const requestError = new Error(result.error?.message || 'Site-survey evidence could not be retained.')
        requestError.code = result.error?.code || 'site_survey_upload_failed'
        throw requestError
      }
      await refreshOpportunityDetail(opportunityId)
      notify('Private site-survey evidence retained with checksum verification.')
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function submitOpportunitySiteSurvey(surveyId, payload) {
    if (!selectedOpportunity?.id || !surveyId) return null
    const opportunityId = selectedOpportunity.id
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/opportunities/${encodeURIComponent(opportunityId)}/site-surveys/${encodeURIComponent(surveyId)}/submissions`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setData((current) => current && result.approval ? {
        ...current,
        approvals: upsertById(current.approvals, result.approval),
      } : current)
      await refreshOpportunityDetail(opportunityId)
      notify(result.replayed ? 'The matching site-survey submission already exists.' : 'Site survey retained for source-current office approval.')
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  function reviewOpportunitySiteSurveyApproval(approvalId) {
    if (!approvalId || !selectedOpportunity) return
    openApprovals({
      approvalId,
      jobTitle: `${selectedOpportunity.title} site survey`,
    })
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
    sectionRef.current = 'jobs'
    setSection('jobs')
    void openJobWorkspace(linkedJob)
  }

  async function requestMarketFitPolicy(payload) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api('/api/ledger/market-fit/profiles', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setData((current) => (current ? { ...current, marketFit: result.marketFit || current.marketFit } : current))
      notify('Market-fit policy revision retained for approval.')
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function retainMarketFitAssessment(opportunityId, sourceHash) {
    setSubmitting(true)
    setError('')
    try {
      await api(`/api/ledger/opportunities/${encodeURIComponent(opportunityId)}/market-fit-assessments`, {
        method: 'POST',
        body: JSON.stringify({ entryKey: `fit:${opportunityId}:${String(sourceHash || '').slice(0, 32)}` }),
      })
      const [result, bidDecisionResult] = await Promise.all([
        api('/api/ledger/market-fit?limit=500'),
        api('/api/ledger/bid-decisions?limit=500'),
      ])
      setData((current) => (current ? {
        ...current,
        marketFit: result.marketFit || current.marketFit,
        bidDecisions: bidDecisionResult.bidDecisions || current.bidDecisions,
      } : current))
      notify('Current opportunity fit retained in the ledger.')
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function requestBidDecisionPolicy(payload) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api('/api/ledger/bid-decisions/policies', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setData((current) => (current ? { ...current, bidDecisions: result.bidDecisions || current.bidDecisions } : current))
      notify('Bid/no-bid policy revision retained for approval.')
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function requestBidDecision(opportunityId, payload) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/opportunities/${encodeURIComponent(opportunityId)}/bid-decisions`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const register = await api('/api/ledger/bid-decisions?limit=500')
      setData((current) => (current ? { ...current, bidDecisions: register.bidDecisions || current.bidDecisions } : current))
      if (selectedOpportunity?.id === opportunityId) {
        const detail = await api(`/api/ledger/opportunities/${encodeURIComponent(opportunityId)}`)
        setSelectedOpportunity(detail.opportunity)
      }
      notify(result.replayed ? 'The matching pursuit decision was already retained.' : 'Pursuit decision retained for explicit approval.')
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  function openBidPackageEditor() {
    const preferredOpportunity = selectedOpportunity && !['won', 'lost', 'archived'].includes(selectedOpportunity.stage)
      ? selectedOpportunity.id
      : ''
    setBidPackageDraft({ ...emptyBidPackageDraft(), opportunityId: preferredOpportunity })
    setBidPackageEditor(true)
  }

  async function submitBidPackage(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const result = await api('/api/ledger/bid-packages', {
        method: 'POST',
        body: JSON.stringify({ ...bidPackageDraft, dueAt: toIsoDateTime(bidPackageDraft.dueAt) }),
      })
      setBidPackageEditor(false)
      setBidPackageDraft(emptyBidPackageDraft())
      setSelectedBidPackage(result.bidPackage)
      setData((current) => current ? { ...current, bidPackages: upsertById(current.bidPackages, result.bidPackage) } : current)
      notify('Internal bid package retained. No invitation or message was sent.')
      await refreshSection('pipeline')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function selectBidPackage(bidPackage) {
    if (!bidPackage) {
      setSelectedBidPackage(null)
      return
    }
    setError('')
    try {
      const result = await api(`/api/ledger/bid-packages/${encodeURIComponent(bidPackage.id)}`)
      setSelectedBidPackage(result.bidPackage)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  function openBidReturn(bidPackage, participant) {
    setBidReturnDraft({
      ...emptyBidReturnDraft(),
      netAmount: participant.status === 'returned' ? String(participant.netAmount || '') : '',
      taxRate: String(participant.taxRate ?? 21),
      receivedAt: participant.receivedAt ? toLocalDateTimeInput(participant.receivedAt).slice(0, 10) : futureDateInput(0),
      validUntil: participant.validUntil ? toLocalDateTimeInput(participant.validUntil).slice(0, 10) : futureDateInput(30),
      durationDays: participant.durationDays === null ? '' : String(participant.durationDays),
      evidenceReference: participant.evidenceReference || '',
      exclusions: (participant.exclusions || []).join('\n'),
      qualifications: (participant.qualifications || []).join('\n'),
    })
    setBidPackageAction({ type: 'return', bidPackage, participant })
  }

  async function submitBidReturn(event) {
    event.preventDefault()
    if (bidPackageAction?.type !== 'return') return
    setSubmitting(true)
    setError('')
    try {
      const { bidPackage, participant } = bidPackageAction
      const result = await api(
        `/api/ledger/bid-packages/${encodeURIComponent(bidPackage.id)}/participants/${encodeURIComponent(participant.id)}/return`,
        {
          method: 'PUT',
          body: JSON.stringify({
            ...bidReturnDraft,
            netAmount: Number(bidReturnDraft.netAmount),
            taxRate: Number(bidReturnDraft.taxRate),
            durationDays: bidReturnDraft.durationDays === '' ? null : Number(bidReturnDraft.durationDays),
            receivedAt: toIsoDateTime(bidReturnDraft.receivedAt),
            validUntil: toIsoDateTime(bidReturnDraft.validUntil),
          }),
        },
      )
      setBidPackageAction(null)
      setBidReturnDraft(emptyBidReturnDraft())
      setSelectedBidPackage(result.bidPackage)
      setData((current) => current ? { ...current, bidPackages: upsertById(current.bidPackages, result.bidPackage) } : current)
      notify('Bid return evidence retained for internal comparison. No bidder was contacted.')
      await refreshSection('pipeline')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openBidSelection(bidPackage, participant) {
    setBidSelectionRationale('')
    setBidPackageAction({ type: 'selection', bidPackage, participant })
  }

  async function submitBidSelection(event) {
    event.preventDefault()
    if (bidPackageAction?.type !== 'selection') return
    setSubmitting(true)
    setError('')
    try {
      const { bidPackage, participant } = bidPackageAction
      const result = await api(`/api/ledger/bid-packages/${encodeURIComponent(bidPackage.id)}/selection`, {
        method: 'POST',
        body: JSON.stringify({ participantId: participant.id, rationale: bidSelectionRationale }),
      })
      setBidPackageAction(null)
      setBidSelectionRationale('')
      setSelectedBidPackage(result.bidPackage)
      setData((current) => current ? {
        ...current,
        bidPackages: upsertById(current.bidPackages, result.bidPackage),
        approvals: upsertById(current.approvals, result.approval),
      } : current)
      notify('Preferred-bidder selection added to approvals. No award, order, or message was issued.')
      await refreshSection('pipeline')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openAddBidParticipants(bidPackage) {
    setBidAddPartnerIds([])
    setBidPackageAction({ type: 'add_participants', bidPackage })
  }

  async function submitBidParticipants(event) {
    event.preventDefault()
    if (bidPackageAction?.type !== 'add_participants') return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/bid-packages/${encodeURIComponent(bidPackageAction.bidPackage.id)}/participants`, {
        method: 'POST',
        body: JSON.stringify({ tradePartnerIds: bidAddPartnerIds }),
      })
      setBidPackageAction(null)
      setBidAddPartnerIds([])
      setSelectedBidPackage(result.bidPackage)
      setData((current) => current ? { ...current, bidPackages: upsertById(current.bidPackages, result.bidPackage) } : current)
      notify(result.replayed ? 'All selected bidders were already retained.' : 'Bidders added internally. No invitation or message was sent.')
      await refreshSection('pipeline')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function reviewBidApproval(bidPackage) {
    openApprovals({
      approvalId: bidPackage.approvalId,
      jobId: bidPackage.jobId || null,
      jobTitle: `${bidPackage.packageNumber} ${bidPackage.title}`,
    })
  }

  function openBidCommitment(bidPackage) {
    setBidCommitmentDraft({
      ...emptyBidCommitmentDraft(),
      notes: `Prepare the exact selected return for ${bidPackage.packageNumber} as an internal purchasing commitment.`,
    })
    setBidPackageAction({ type: 'commitment', bidPackage })
  }

  async function submitBidCommitment(event) {
    event.preventDefault()
    if (bidPackageAction?.type !== 'commitment') return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/bid-packages/${encodeURIComponent(bidPackageAction.bidPackage.id)}/commitment`, {
        method: 'POST',
        body: JSON.stringify(bidCommitmentDraft),
      })
      setBidPackageAction(null)
      setBidCommitmentDraft(emptyBidCommitmentDraft())
      setSelectedBidPackage(result.bidPackage)
      setData((current) => {
        if (!current) return current
        const next = {
          ...current,
          dashboard: result.dashboard || current.dashboard,
          bidPackages: upsertById(current.bidPackages, result.bidPackage),
          approvals: result.approval ? upsertById(current.approvals, result.approval) : current.approvals,
        }
        return result.job ? reconcileJobCollections(next, result.job) : next
      })
      notify(result.replayed
        ? 'The existing verified purchasing commitment was reopened. No award or order was sent.'
        : 'Selected bid frozen into purchasing approval. No supplier contact, award, order, or payment occurred.')
      await refreshSection('pipeline')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function reviewBidCommitment(bidPackage) {
    openApprovals({
      approvalId: bidPackage.commitment?.approvalId,
      jobId: bidPackage.jobId || null,
      jobTitle: `${bidPackage.packageNumber} purchasing commitment`,
    })
  }

  function openBidOrderPackage(bidPackage) {
    setBidOrderDraft({
      ...emptyBidOrderDraft(),
      recipient: bidPackage.selectedParticipant?.partner?.email || '',
    })
    setBidPackageAction({ type: 'order_package', bidPackage })
  }

  async function submitBidOrderPackage(event) {
    event.preventDefault()
    if (bidPackageAction?.type !== 'order_package') return
    const { bidPackage } = bidPackageAction
    const purchaseOrderId = bidPackage.commitment?.purchaseOrderId
    if (!bidPackage.jobId || !purchaseOrderId || !bidOrderDraft.recipient.trim()) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(bidPackage.jobId)}/purchase-orders/${encodeURIComponent(purchaseOrderId)}/issue-package`,
        {
          method: 'POST',
          body: JSON.stringify({
            recipient: bidOrderDraft.recipient.trim(),
            channel: bidOrderDraft.channel,
          }),
        },
      )
      setBidPackageAction(null)
      setBidOrderDraft(emptyBidOrderDraft())
      if (result.bidPackage) setSelectedBidPackage(result.bidPackage)
      setData((current) => {
        if (!current) return current
        const next = {
          ...current,
          dashboard: result.dashboard || current.dashboard,
          finance: result.finance || current.finance,
          bidPackages: result.bidPackage ? upsertById(current.bidPackages, result.bidPackage) : current.bidPackages,
          approvals: result.approval ? upsertById(current.approvals, result.approval) : current.approvals,
        }
        return result.job ? reconcileJobCollections(next, result.job) : next
      })
      if (result.job && selectedJobId === result.job.id) setSelectedJob(result.job)
      notify(result.replayed
        ? `Purchase-order package ${result.issueReference} reopened. Its delivery approval and attachments remain retained.`
        : `Purchase-order package ${result.issueReference} retained. Transmission still requires approval and a verified provider receipt.`)
      await refreshSection('pipeline')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function reviewBidOrderDelivery(bidPackage) {
    openApprovals({
      approvalId: bidPackage.commitment?.issuePackage?.deliveryApprovalId,
      jobId: bidPackage.jobId || null,
      jobTitle: `${bidPackage.packageNumber} order transmission`,
    })
  }

  function openBidOrderDelivery(bidPackage) {
    setBidOrderDeliveryDraft(emptyBidOrderDeliveryDraft())
    setBidPackageAction({ type: 'order_delivery', bidPackage })
  }

  async function submitBidOrderDelivery(event) {
    event.preventDefault()
    if (bidPackageAction?.type !== 'order_delivery') return
    const communicationId = bidPackageAction.bidPackage.commitment?.issuePackage?.communicationId
    if (!communicationId || !bidOrderDeliveryDraft.integration.trim() || !bidOrderDeliveryDraft.providerMessageId.trim()) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/communications/${encodeURIComponent(communicationId)}/delivery-receipt`, {
        method: 'POST',
        body: JSON.stringify({
          integration: bidOrderDeliveryDraft.integration.trim(),
          providerMessageId: bidOrderDeliveryDraft.providerMessageId.trim(),
          sentAt: bidOrderDeliveryDraft.sentAt ? toIsoDateTime(bidOrderDeliveryDraft.sentAt) : null,
        }),
      })
      setBidPackageAction(null)
      setBidOrderDeliveryDraft(emptyBidOrderDeliveryDraft())
      if (result.bidPackage) setSelectedBidPackage(result.bidPackage)
      setData((current) => {
        if (!current) return current
        const next = {
          ...current,
          dashboard: result.dashboard || current.dashboard,
          finance: result.finance || current.finance,
          bidPackages: result.bidPackage ? upsertById(current.bidPackages, result.bidPackage) : current.bidPackages,
        }
        return result.job ? reconcileJobCollections(next, result.job) : next
      })
      if (result.job && selectedJobId === result.job.id) setSelectedJob(result.job)
      notify(`Verified provider receipt retained for ${result.purchaseOrder?.issuePackage?.issueReference || 'the purchase order'}. The order is now an external commitment; no payment was initiated.`)
      await refreshSection('pipeline')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function runCycle() {
    setSubmitting(true)
    try {
      const result = await api('/api/ledger/scheduler/run', {
        method: 'POST',
        body: JSON.stringify({ actor: 'owner_scheduler', maxActions: 10 }),
      })
      setData((current) => current ? { ...current, scheduler: result.scheduler || current.scheduler } : current)
      setSubmitting(false)
      if (result.ran) {
        notify(
          `Durable cycle completed with ${result.result?.applied?.length || 0} internal draft action(s) and ${result.result?.blocked?.length || 0} blocked action(s). No external commitment was made.`,
        )
      } else {
        notify(`Durable cycle was not due: ${formatStatus(result.claim?.reason || 'lease retained')}.`)
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openAutomationControlDialog(suspend, opener) {
    automationControlOpenerRef.current = opener || document.activeElement
    setAutomationControlError('')
    setAutomationControlDialog({ suspend })
  }

  function closeAutomationControlDialog() {
    if (submitting) return
    setAutomationControlDialog(null)
    setAutomationControlError('')
    window.setTimeout(() => automationControlOpenerRef.current?.focus(), 0)
  }

  async function changeAutomationControl(reason) {
    const suspend = automationControlDialog?.suspend === true
    const action = suspend ? 'suspend' : 'resume'
    setSubmitting(true)
    setAutomationControlError('')
    try {
      const result = await api(`/api/operations/control/${action}`, {
        method: 'POST',
        body: JSON.stringify({
          confirmation: suspend ? 'SUSPEND_AUTOMATION' : 'RESUME_AUTOMATION',
          reason,
        }),
      })
      setData((current) => current ? {
        ...current,
        scheduler: result.scheduler || current.scheduler,
        operationsCapabilities: current.operationsCapabilities ? {
          ...current.operationsCapabilities,
          capabilities: {
            ...current.operationsCapabilities.capabilities,
            automation: {
              ...current.operationsCapabilities.capabilities?.automation,
              control: result.control,
            },
          },
        } : current.operationsCapabilities,
      } : current)
      notify(
        suspend
          ? 'Autonomous drafting suspended. Direct operator work, evidence capture, and approvals remain available.'
          : 'Autonomous drafting resumed. External commitments remain approval-gated.',
      )
      setAutomationControlDialog(null)
      window.setTimeout(() => automationControlOpenerRef.current?.focus(), 0)
      return true
    } catch (requestError) {
      setAutomationControlError(requestError.message)
      return false
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
          jobLimit: 12,
          actor: 'owner_command_plan',
        }),
      })
      setSelectedCommandIds([])
      setData((current) => current ? {
        ...current,
        commandPlan: result.commandPlan || current.commandPlan,
        dashboard: result.dashboard || current.dashboard,
      } : current)
      setSubmitting(false)
      notify(
        `${result.summary?.applied || 0} safe command-plan draft(s) retained; ${result.summary?.skipped || 0} action(s) skipped. External commitments remain zero.`,
      )
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

  async function persistOrganizationProfile({ announce = true } = {}) {
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
      setData((current) => current ? { ...current, organization: result.organization } : current)
      if (announce) {
        notify(
          result.organization.readiness.ready
            ? 'Business identity retained and ready for controlled commercial packages.'
            : `Business identity retained. ${result.organization.readiness.missing.length} required item(s) remain.`,
        )
      }
      return result.organization
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function saveOrganizationProfile(event) {
    event.preventDefault()
    await persistOrganizationProfile()
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

  async function selectFieldEvidenceJob(jobId) {
    setEvidence({
      ...emptyFieldEvidenceDraft(),
      jobId,
    })
    setFieldPhotoEvidenceSets([])
    if (!jobId) return
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/photo-evidence`)
      setFieldPhotoEvidenceSets(result.photoEvidenceSets || [])
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function uploadEvidence(event) {
    event.preventDefault()
    const file = evidenceInputRef.current?.files?.[0]
    if (!evidence.jobId || !file) {
      setError('Choose a job and an evidence file before recording a field update.')
      return
    }
    if (evidence.photoEvidenceSetId && (
      !file.type.startsWith('image/')
      || !evidence.photoEvidencePhase
      || !evidence.capturedAt
      || evidence.notes.trim().length < 3
    )) {
      setError('Governed evidence requires an image, phase, device capture time, and a caption of at least 3 characters.')
      return
    }
    const draft = {
      id: createFieldEvidenceDraftId(),
      jobId: evidence.jobId,
      notes: evidence.notes,
      riskLevel: evidence.riskLevel,
      photoEvidenceSetId: evidence.photoEvidenceSetId,
      photoEvidencePhase: evidence.photoEvidencePhase,
      capturedAt: evidence.capturedAt,
      file,
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    try {
      if (navigator.onLine === false) {
        await enqueueFieldEvidenceDraft(draft)
        await refreshOutboxState()
        const nextPhase = evidence.photoEvidenceSetId
          ? ['before', 'during', 'after'][['before', 'during', 'after'].indexOf(evidence.photoEvidencePhase) + 1]
          : null
        setEvidence(nextPhase ? {
          ...evidence,
          notes: '',
          photoEvidencePhase: nextPhase,
          capturedAt: toLocalDateTimeInput(new Date()),
        } : emptyFieldEvidenceDraft())
        if (!nextPhase) setFieldPhotoEvidenceSets([])
        evidenceInputRef.current.value = ''
        notify('Field evidence was saved locally and will be recorded when this device reconnects.')
        return
      }
      const result = await recordFieldEvidence(draft)
      const updatedPhotoEvidenceSet = result.ledgerFollowUp?.records?.photoEvidenceSet || null
      if (updatedPhotoEvidenceSet) {
        setFieldPhotoEvidenceSets((current) => upsertById(current, updatedPhotoEvidenceSet))
        setEvidence({
          ...evidence,
          notes: '',
          photoEvidencePhase: updatedPhotoEvidenceSet.missingPhases?.[0] || evidence.photoEvidencePhase,
          capturedAt: toLocalDateTimeInput(new Date()),
        })
      } else {
        setEvidence(emptyFieldEvidenceDraft())
        setFieldPhotoEvidenceSets([])
      }
      evidenceInputRef.current.value = ''
      notify(
        updatedPhotoEvidenceSet
          ? `${formatStatus(result.ledgerFollowUp.records.photoEvidenceCapture.phase)} photo retained. ${updatedPhotoEvidenceSet.complete ? 'The sequence is ready for office review.' : `${formatStatus(updatedPhotoEvidenceSet.missingPhases?.[0] || 'next')} evidence is next.`}`
          : `${result.ledgerDocument?.filename || file.name} was recorded in the operating ledger.`,
      )
      await refresh()
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldEvidenceDraft(draft)
          await refreshOutboxState()
          const nextPhase = evidence.photoEvidenceSetId
            ? ['before', 'during', 'after'][['before', 'during', 'after'].indexOf(evidence.photoEvidencePhase) + 1]
            : null
          setEvidence(nextPhase ? {
            ...evidence,
            notes: '',
            photoEvidencePhase: nextPhase,
            capturedAt: toLocalDateTimeInput(new Date()),
          } : emptyFieldEvidenceDraft())
          if (!nextPhase) setFieldPhotoEvidenceSets([])
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

  async function selectFieldMaterialReceiptJob(jobId) {
    const loadSequence = ++materialReceiptLoadSequenceRef.current
    const shouldLoad = Boolean(jobId) && navigator.onLine !== false
    setMaterialReceiptLoading(shouldLoad)
    setFieldMaterialReceipt({ ...emptyMaterialReceiptDraft(), jobId })
    setFieldMaterialReceiptPlans([])
    if (!shouldLoad) return
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/material-receiving-plan`)
      if (loadSequence !== materialReceiptLoadSequenceRef.current) return
      setFieldMaterialReceiptPlans(result.plans || [])
    } catch (requestError) {
      if (loadSequence === materialReceiptLoadSequenceRef.current) setError(requestError.message)
    } finally {
      if (loadSequence === materialReceiptLoadSequenceRef.current) setMaterialReceiptLoading(false)
    }
  }

  function selectFieldMaterialReceiptPlan(purchaseOrderId) {
    const plan = fieldMaterialReceiptPlans.find(item => item.purchaseOrder?.id === purchaseOrderId)
    if (!plan) {
      setFieldMaterialReceipt((current) => ({
        ...current,
        purchaseOrderId: '',
        lines: [emptyMaterialReceiptLine()],
        finalDelivery: false,
      }))
      return
    }
    const next = emptyMaterialReceiptDraft(plan)
    setFieldMaterialReceipt((current) => ({
      ...current,
      jobId: plan.purchaseOrder.jobId,
      purchaseOrderId,
      finalDelivery: plan.summary?.remainingLines === 1,
      lines: [next.lines[0]],
    }))
  }

  function selectFieldMaterialReceiptLine(lineKey) {
    const line = selectedFieldMaterialReceiptPlan?.lines.find(item => item.lineKey === lineKey)
    if (line) setFieldMaterialReceipt((current) => ({ ...current, lines: [emptyMaterialReceiptLine(line)] }))
  }

  function updateFieldMaterialReceipt(field, value) {
    setFieldMaterialReceipt((current) => ({ ...current, [field]: value }))
  }

  function updateFieldMaterialReceiptLine(field, value) {
    setFieldMaterialReceipt((current) => ({
      ...current,
      lines: [{ ...current.lines[0], [field]: value }],
    }))
  }

  async function recordFieldMaterialReceipt(event) {
    event.preventDefault()
    const line = fieldMaterialReceipt.lines[0]
    const receivedQuantity = Number(line?.receivedQuantity)
    const acceptedQuantity = Number(line?.acceptedQuantity)
    const damagedQuantity = Number(line?.damagedQuantity || 0)
    if (!fieldMaterialReceipt.jobId || fieldMaterialReceipt.receiptReference.trim().length < 3 || fieldMaterialReceipt.evidenceReference.trim().length < 3
      || line?.itemName.trim().length < 2 || !(receivedQuantity > 0) || acceptedQuantity < 0 || damagedQuantity < 0
      || acceptedQuantity + damagedQuantity > receivedQuantity) {
      setError('Choose a job and record a delivery reference, retained evidence, item, and valid received, accepted, and damaged quantities.')
      return
    }
    if (!fieldScoped && fieldMaterialReceipt.receivedBy.trim().length < 2) {
      setError('Record the person who physically received this delivery.')
      return
    }
    const payload = {
      purchaseOrderId: fieldMaterialReceipt.purchaseOrderId || null,
      receiptReference: fieldMaterialReceipt.receiptReference.trim(),
      evidenceReference: fieldMaterialReceipt.evidenceReference.trim(),
      deliveredAt: toIsoDateTime(fieldMaterialReceipt.deliveredAt),
      receivedBy: fieldMaterialReceipt.receivedBy.trim() || undefined,
      location: fieldMaterialReceipt.location.trim() || null,
      finalDelivery: fieldMaterialReceipt.finalDelivery,
      notes: fieldMaterialReceipt.notes.trim() || null,
      lines: [{
        lineKey: line.lineKey || undefined,
        materialRequirementId: line.materialRequirementId || undefined,
        itemName: line.itemName.trim(),
        unit: line.unit.trim() || 'unit',
        receivedQuantity,
        acceptedQuantity,
        damagedQuantity,
        notes: line.notes?.trim() || null,
      }],
    }
    const draft = {
      id: fieldMaterialReceipt.entryKey,
      type: 'material_receipt',
      jobId: fieldMaterialReceipt.jobId,
      payload,
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        setFieldMaterialReceipt(emptyMaterialReceiptDraft())
        setFieldMaterialReceiptPlans([])
        notify('Material delivery was saved locally with its quantities and evidence reference. It will sync after reconnection.')
        return
      }
      const result = await recordFieldOperation(draft)
      setFieldMaterialReceipt(emptyMaterialReceiptDraft())
      setFieldMaterialReceiptPlans([])
      notify(result.replayed ? 'This delivery ticket was already retained; no duplicate receipt was created.' : `Delivery ${result.receipt?.receiptReference || ''} was retained for office review.`)
      await refresh()
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          setFieldMaterialReceipt(emptyMaterialReceiptDraft())
          setFieldMaterialReceiptPlans([])
          notify('Connection interrupted. The complete delivery ticket was saved locally for an exact retry.')
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

  function updateOrganizationProfile(field, value) {
    setOrganizationProfileDraft((current) => ({ ...current, [field]: value }))
  }

  function updateOrganizationVatExemption(vatExempt) {
    setOrganizationProfileDraft((current) => ({
      ...current,
      vatExempt,
      vatNumber: vatExempt ? '' : current.vatNumber,
    }))
  }

  function openOrganizationOnboarding(event) {
    organizationOnboardingOpenerRef.current = event.currentTarget
    setOrganizationProfileDraft(organizationDraft(data?.organization))
    setShowOrganizationOnboarding(true)
  }

  function closeOrganizationOnboarding() {
    if (submitting) return
    setOrganizationProfileDraft(organizationDraft(data?.organization))
    setShowOrganizationOnboarding(false)
    const opener = organizationOnboardingOpenerRef.current
    organizationOnboardingOpenerRef.current = null
    requestAnimationFrame(() => {
      if (opener?.isConnected && !opener.disabled) opener.focus()
    })
  }

  async function selectFieldExpenseJob(jobId) {
    const loadSequence = ++expenseReceiptLoadSequenceRef.current
    const shouldLoad = Boolean(jobId) && navigator.onLine !== false
    setExpenseReceiptLoading(shouldLoad)
    setFieldExpenseReceipt({ ...emptyFieldExpenseReceiptDraft(), jobId })
    setFieldExpenseReceipts([])
    if (!shouldLoad) return
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/expense-receipts?limit=8`)
      if (loadSequence !== expenseReceiptLoadSequenceRef.current) return
      setFieldExpenseReceipts(result.expenses || [])
    } catch (requestError) {
      if (loadSequence === expenseReceiptLoadSequenceRef.current) setError(requestError.message)
    } finally {
      if (loadSequence === expenseReceiptLoadSequenceRef.current) setExpenseReceiptLoading(false)
    }
  }

  function updateFieldExpenseReceipt(field, value) {
    setFieldExpenseReceipt((current) => ({ ...current, [field]: value }))
  }

  function updateFieldExpenseTaxTreatment(taxTreatment) {
    setFieldExpenseReceipt((current) => ({
      ...current,
      taxTreatment,
      taxAmount: ['exempt', 'reverse_charge'].includes(taxTreatment) ? '0' : current.taxAmount,
    }))
  }

  async function recordFieldExpenseReceipt(event) {
    event.preventDefault()
    const totalAmount = Number(fieldExpenseReceipt.totalAmount)
    const taxAmount = fieldExpenseReceipt.taxAmount === '' ? 0 : Number(fieldExpenseReceipt.taxAmount)
    const zeroTaxTreatment = ['exempt', 'reverse_charge'].includes(fieldExpenseReceipt.taxTreatment)
    if (
      !fieldExpenseReceipt.jobId ||
      !fieldExpenseReceipt.expenseDate ||
      fieldExpenseReceipt.vendor.trim().length < 2 ||
      fieldExpenseReceipt.receiptReference.trim().length < 3 ||
      !(totalAmount > 0) ||
      !Number.isFinite(taxAmount) ||
      taxAmount < 0 ||
      taxAmount > totalAmount ||
      (zeroTaxTreatment && taxAmount !== 0) ||
      fieldExpenseReceipt.costCode.trim().length < 2
    ) {
      setError('Choose a job and retain the date, vendor, receipt reference, positive gross total, valid VAT amount, treatment, and cost code.')
      return
    }
    const jobId = fieldExpenseReceipt.jobId
    const payload = {
      expenseDate: fieldExpenseReceipt.expenseDate,
      category: fieldExpenseReceipt.category,
      vendor: fieldExpenseReceipt.vendor.trim(),
      receiptReference: fieldExpenseReceipt.receiptReference.trim(),
      totalAmount: roundMoney(totalAmount),
      taxAmount: roundMoney(taxAmount),
      taxTreatment: fieldExpenseReceipt.taxTreatment,
      paymentMethod: fieldExpenseReceipt.paymentMethod,
      costCode: fieldExpenseReceipt.costCode.trim(),
      currency: 'EUR',
      notes: fieldExpenseReceipt.notes.trim() || null,
      source: 'field_dashboard',
    }
    const draft = {
      id: fieldExpenseReceipt.entryKey,
      type: 'expense_receipt',
      jobId,
      payload,
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        setFieldExpenseReceipt({ ...emptyFieldExpenseReceiptDraft(), jobId })
        notify('Expense receipt was saved locally with its VAT basis and will sync after reconnection.')
        return
      }
      const result = await recordFieldOperation(draft)
      notify(result.replayed
        ? 'This expense receipt was already retained; no duplicate cost record was created.'
        : `Receipt ${result.expense?.receiptReference || ''} was retained for approver review. No reimbursement or payment was initiated.`)
      await selectFieldExpenseJob(jobId)
      await refresh()
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          setFieldExpenseReceipt({ ...emptyFieldExpenseReceiptDraft(), jobId })
          notify('Connection interrupted. The complete expense receipt was saved locally for an exact retry.')
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

  async function selectFieldEnvironmentalJob(jobId) {
    const loadSequence = ++environmentalLoadSequenceRef.current
    const shouldLoad = Boolean(jobId) && navigator.onLine !== false
    setEnvironmentalLoading(shouldLoad)
    setFieldEnvironmentalActivity({ ...emptyFieldEnvironmentalDraft(), jobId })
    setFieldEnvironmentalActivities([])
    setEnvironmentalRegister(null)
    setEnvironmentalReports([])
    setEnvironmentalReportDraft(emptyEnvironmentalReportDraft())
    if (!shouldLoad) return
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/environmental-activities?limit=20`)
      if (loadSequence !== environmentalLoadSequenceRef.current) return
      setFieldEnvironmentalActivities(result.activities || [])
      setEnvironmentalRegister(result.register || null)
      setEnvironmentalReports(result.reports || [])
      if (result.register?.periodStart && result.register?.periodEnd) {
        setEnvironmentalReportDraft({ periodStart: result.register.periodStart, periodEnd: result.register.periodEnd })
      }
    } catch (requestError) {
      if (loadSequence === environmentalLoadSequenceRef.current) setError(requestError.message)
    } finally {
      if (loadSequence === environmentalLoadSequenceRef.current) setEnvironmentalLoading(false)
    }
  }

  function updateEnvironmentalCategory(category) {
    const defaults = {
      fuel: { unit: 'litre', ghgScope: 'scope_1' },
      electricity: { unit: 'kWh', ghgScope: 'scope_2' },
      district_heat: { unit: 'kWh', ghgScope: 'scope_2' },
      refrigerant: { unit: 'kg', ghgScope: 'scope_1' },
      transport: { unit: 'km', ghgScope: 'scope_3' },
      material: { unit: 'kg', ghgScope: 'scope_3' },
      waste: { unit: 'kg', ghgScope: 'scope_3' },
      water: { unit: 'm3', ghgScope: 'scope_3' },
      accommodation: { unit: 'night', ghgScope: 'scope_3' },
      other: { unit: 'unit', ghgScope: 'unclassified' },
    }
    setFieldEnvironmentalActivity((current) => ({ ...current, category, ...(defaults[category] || defaults.other) }))
  }

  function updateFieldEnvironmentalActivity(field, value) {
    setFieldEnvironmentalActivity((current) => ({ ...current, [field]: value }))
  }

  async function recordFieldEnvironmentalActivity(event) {
    event.preventDefault()
    const quantity = Number(fieldEnvironmentalActivity.quantity)
    const emissionFactor = Number(fieldEnvironmentalActivity.emissionFactor)
    if (
      !fieldEnvironmentalActivity.jobId ||
      !fieldEnvironmentalActivity.activityDate ||
      fieldEnvironmentalActivity.description.trim().length < 3 ||
      !(quantity > 0) ||
      !fieldEnvironmentalActivity.unit.trim() ||
      fieldEnvironmentalActivity.emissionFactor === '' ||
      !Number.isFinite(emissionFactor) ||
      emissionFactor < 0 ||
      fieldEnvironmentalActivity.factorSource.trim().length < 3 ||
      fieldEnvironmentalActivity.factorReference.trim().length < 3 ||
      fieldEnvironmentalActivity.evidenceReference.trim().length < 3
    ) {
      setError('Choose a job and retain the date, activity, positive quantity, unit, emission factor, factor source, and source evidence reference.')
      return
    }
    const jobId = fieldEnvironmentalActivity.jobId
    const payload = {
      activityDate: fieldEnvironmentalActivity.activityDate,
      category: fieldEnvironmentalActivity.category,
      ghgScope: fieldEnvironmentalActivity.ghgScope,
      description: fieldEnvironmentalActivity.description.trim(),
      quantity,
      unit: fieldEnvironmentalActivity.unit.trim(),
      emissionFactor,
      factorSource: fieldEnvironmentalActivity.factorSource.trim(),
      factorReference: fieldEnvironmentalActivity.factorReference.trim(),
      evidenceReference: fieldEnvironmentalActivity.evidenceReference.trim(),
      notes: fieldEnvironmentalActivity.notes.trim() || null,
      source: 'field_dashboard',
    }
    const draft = {
      id: fieldEnvironmentalActivity.entryKey,
      type: 'environmental_activity',
      jobId,
      payload,
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        setFieldEnvironmentalActivity({ ...emptyFieldEnvironmentalDraft(), jobId })
        notify('Environmental activity was saved locally with its source and factor provenance. It will sync after reconnection.')
        return
      }
      const result = await recordFieldOperation(draft)
      notify(result.replayed
        ? 'This environmental activity was already retained; no duplicate reporting source was created.'
        : `${result.activity?.description || 'Environmental activity'} was retained for source review. No certification or external submission was made.`)
      await selectFieldEnvironmentalJob(jobId)
      await refresh()
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          setFieldEnvironmentalActivity({ ...emptyFieldEnvironmentalDraft(), jobId })
          notify('Connection interrupted. The complete environmental record was saved locally for an exact retry.')
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

  async function prepareEnvironmentalReport(event) {
    event.preventDefault()
    const jobId = fieldEnvironmentalActivity.jobId
    if (!jobId || !environmentalReportDraft.periodStart || !environmentalReportDraft.periodEnd) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/environmental-reports`, {
        method: 'POST',
        body: JSON.stringify(environmentalReportDraft),
      })
      notify(result.replayed
        ? 'The current environmental report package is already retained.'
        : 'Environmental report package retained for approver review. Nothing was submitted or certified externally.')
      await selectFieldEnvironmentalJob(jobId)
      await refresh()
      if (capabilities.approvals && result.approval?.id) openApprovals({ jobId, approvalId: result.approval.id })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function submitEnvironmentalReversal(event) {
    event.preventDefault()
    if (!environmentalReversal || environmentalReversalReason.trim().length < 8) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(environmentalReversal.jobId)}/environmental-activities/${encodeURIComponent(environmentalReversal.id)}/reversal`, {
        method: 'POST',
        body: JSON.stringify({ reason: environmentalReversalReason.trim() }),
      })
      const jobId = environmentalReversal.jobId
      setEnvironmentalReversal(null)
      setEnvironmentalReversalReason('')
      notify('Environmental correction retained for approver review. The original source and historical reports remain available.')
      await selectFieldEnvironmentalJob(jobId)
      await refresh()
      if (capabilities.approvals && result.approval?.id) openApprovals({ jobId, approvalId: result.approval.id })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function selectFieldEquipmentJob(jobId) {
    setFieldEquipmentCheckout({ ...emptyEquipmentCheckoutDraft(), jobId })
    setFieldEquipmentReturn(emptyEquipmentReturnDraft())
    setFieldEquipmentPlans([])
    setFieldEquipmentCustody([])
    if (!jobId || navigator.onLine === false) return
    setError('')
    try {
      const [planResult, custodyResult] = await Promise.all([
        api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/equipment-custody-plan`),
        api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/equipment-custody`),
      ])
      const plans = planResult.plans || []
      const activeCustody = (custodyResult.custody || []).filter(session => session.status === 'checked_out')
      setFieldEquipmentPlans(plans)
      setFieldEquipmentCustody(activeCustody)
      const firstReady = plans.find(plan => plan.checkoutReady)
      if (firstReady) {
        setFieldEquipmentCheckout({
          ...emptyEquipmentCheckoutDraft(firstReady),
          jobId,
          location: firstReady.tool?.currentLocation || '',
        })
      }
      if (activeCustody.length === 1) setFieldEquipmentReturn(emptyEquipmentReturnDraft(activeCustody[0]))
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  function selectFieldEquipmentPlan(reservationId) {
    const plan = fieldEquipmentPlans.find(item => item.reservation?.id === reservationId)
    if (!plan) {
      setFieldEquipmentCheckout({ ...emptyEquipmentCheckoutDraft(), jobId: fieldEquipmentCheckout.jobId })
      return
    }
    setFieldEquipmentCheckout({
      ...emptyEquipmentCheckoutDraft(plan),
      jobId: fieldEquipmentCheckout.jobId,
      location: plan.tool?.currentLocation || '',
    })
  }

  async function recordFieldEquipmentCheckout(event) {
    event.preventDefault()
    const meter = fieldEquipmentCheckout.meter === '' ? null : Number(fieldEquipmentCheckout.meter)
    if (!fieldEquipmentCheckout.jobId || !fieldEquipmentCheckout.reservationId || fieldEquipmentCheckout.evidenceReference.trim().length < 3
      || (!fieldScoped && fieldEquipmentCheckout.checkedOutBy.trim().length < 2)
      || (meter !== null && (!Number.isFinite(meter) || meter < 0))) {
      setError('Choose a checkout-ready reservation and retain the physical custodian, handoff evidence, and a valid meter value.')
      return
    }
    const jobId = fieldEquipmentCheckout.jobId
    const payload = {
      reservationId: fieldEquipmentCheckout.reservationId,
      checkedOutAt: toIsoDateTime(fieldEquipmentCheckout.checkedOutAt),
      dueBackAt: fieldEquipmentCheckout.dueBackAt ? toIsoDateTime(fieldEquipmentCheckout.dueBackAt) : null,
      ...(fieldScoped ? {} : { checkedOutBy: fieldEquipmentCheckout.checkedOutBy.trim() }),
      condition: fieldEquipmentCheckout.condition,
      location: fieldEquipmentCheckout.location.trim() || null,
      meter,
      evidenceReference: fieldEquipmentCheckout.evidenceReference.trim(),
      notes: fieldEquipmentCheckout.notes.trim() || null,
    }
    const draft = {
      id: fieldEquipmentCheckout.entryKey,
      type: 'equipment_check_out',
      jobId,
      payload,
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        setFieldEquipmentCheckout(emptyEquipmentCheckoutDraft())
        setFieldEquipmentPlans([])
        setFieldEquipmentCustody([])
        notify('Equipment handoff was saved locally with its custody evidence and will sync after reconnection.')
        return
      }
      const result = await recordFieldOperation(draft)
      notify(result.replayed
        ? 'This equipment handoff was already retained; no duplicate custody session was created.'
        : `${result.custody.toolName} custody was retained for ${result.custody.checkedOutBy}.`)
      await selectFieldEquipmentJob(jobId)
      await refresh()
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          setFieldEquipmentCheckout(emptyEquipmentCheckoutDraft())
          setFieldEquipmentPlans([])
          setFieldEquipmentCustody([])
          notify('Connection interrupted. The equipment handoff was saved locally for an exact retry.')
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

  async function recordFieldEquipmentReturn(event) {
    event.preventDefault()
    const meter = fieldEquipmentReturn.meter === '' ? null : Number(fieldEquipmentReturn.meter)
    const exceptional = ['damaged', 'unsafe', 'lost'].includes(fieldEquipmentReturn.condition)
    if (!fieldEquipmentReturn.jobId || !fieldEquipmentReturn.custodySessionId || fieldEquipmentReturn.evidenceReference.trim().length < 3
      || (!fieldScoped && fieldEquipmentReturn.returnedBy.trim().length < 2)
      || (meter !== null && (!Number.isFinite(meter) || meter < 0))
      || (exceptional && fieldEquipmentReturn.notes.trim().length < 8)) {
      setError('Retain the return condition and evidence, a valid meter, and findings for damaged, unsafe, or lost equipment.')
      return
    }
    const jobId = fieldEquipmentReturn.jobId
    const payload = {
      custodySessionId: fieldEquipmentReturn.custodySessionId,
      returnedAt: toIsoDateTime(fieldEquipmentReturn.returnedAt),
      ...(fieldScoped ? {} : { returnedBy: fieldEquipmentReturn.returnedBy.trim() }),
      condition: fieldEquipmentReturn.condition,
      location: fieldEquipmentReturn.location.trim() || null,
      meter,
      evidenceReference: fieldEquipmentReturn.evidenceReference.trim(),
      notes: fieldEquipmentReturn.notes.trim() || null,
    }
    const draft = {
      id: fieldEquipmentReturn.entryKey,
      type: 'equipment_return',
      jobId,
      payload,
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        setFieldEquipmentReturn(emptyEquipmentReturnDraft())
        setFieldEquipmentCustody([])
        notify('Equipment return was saved locally with its condition evidence and will sync after reconnection.')
        return
      }
      const result = await recordFieldOperation(draft)
      notify(result.replayed
        ? 'This equipment return was already retained; no duplicate evidence was created.'
        : exceptional
          ? `${result.custody.toolName} was quarantined for internal review.`
          : `${result.custody.toolName} was returned and released for availability.`)
      await selectFieldEquipmentJob(jobId)
      await refresh()
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          setFieldEquipmentReturn(emptyEquipmentReturnDraft())
          setFieldEquipmentCustody([])
          notify('Connection interrupted. The complete equipment return was saved locally for an exact retry.')
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

  async function submitFieldFiveSAudit({ id, jobId, locationId, payload }) {
    const draft = {
      id,
      type: 'five_s_audit',
      jobId,
      payload: { ...payload, locationId },
      operatorScope: outboxScope,
    }
    if (navigator.onLine === false) {
      await enqueueFieldOperationDraft(draft)
      await refreshOutboxState()
      notify('5S audit saved locally with the exact approved standard revision and will sync after reconnection.')
      return { queued: true }
    }
    try {
      const result = await recordFieldOperation(draft)
      notify(result.replayed
        ? 'This 5S audit was already retained; no duplicate evidence was created.'
        : '5S field condition and corrective actions were retained.')
      return result
    } catch (requestError) {
      if (!shouldQueueFieldMutation(requestError)) throw requestError
      await enqueueFieldOperationDraft(draft)
      await refreshOutboxState()
      notify('Connection interrupted. The complete 5S audit was saved locally for an exact retry.')
      return { queued: true }
    }
  }

  async function recordAttendance(event) {
    event.preventDefault()
    if (!attendanceDraft.jobId) {
      setError('Choose an assigned job before recording site attendance.')
      return
    }
    if (!fieldScoped && !attendanceDraft.workerId) {
      setError('Choose the assigned crew member whose attendance is being recorded.')
      return
    }
    const checkingOut = Boolean(currentAttendanceSession)
    const draft = {
      id: createFieldEvidenceDraftId(),
      type: checkingOut ? 'attendance_check_out' : 'attendance_check_in',
      jobId: attendanceDraft.jobId,
      payload: {
        ...(checkingOut ? { sessionId: currentAttendanceSession.id } : {}),
        ...(fieldScoped ? {} : { workerId: attendanceDraft.workerId }),
        occurredAt: new Date().toISOString(),
        note: attendanceDraft.note.trim() || null,
        accessPoint: attendanceDraft.accessPoint.trim() || null,
        source: 'attendance_control',
      },
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        setAttendanceDraft((current) => ({ ...current, note: '', accessPoint: '' }))
        notify(`${checkingOut ? 'Check-out' : 'Check-in'} was saved locally for an exact retry.`)
        return
      }
      const result = await recordFieldOperation(draft)
      setData((current) => current ? { ...current, attendance: result.attendance || current.attendance } : current)
      setAttendanceDraft((current) => ({ ...current, note: '', accessPoint: '' }))
      notify(
        result.replayed
          ? `This ${checkingOut ? 'check-out' : 'check-in'} was already retained; no duplicate was created.`
          : `${checkingOut ? 'Check-out' : 'Check-in'} retained on the live labor board.`,
      )
      void refresh()
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          setAttendanceDraft((current) => ({ ...current, note: '', accessPoint: '' }))
          notify(`Connection interrupted. ${checkingOut ? 'Check-out' : 'Check-in'} was saved locally for an exact retry.`)
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

  function retainSafetyMeeting(meeting) {
    if (!meeting?.id) return
    setData((current) => current ? {
      ...current,
      safetyMeetings: [meeting, ...(current.safetyMeetings || []).filter((item) => item.id !== meeting.id)],
    } : current)
  }

  async function selectSafetyBriefingJob(jobId) {
    const loadSequence = ++safetyBriefingLoadSequenceRef.current
    const firstMeeting = safetyMeetings.find((meeting) => (
      meeting.jobId === jobId && ['scheduled', 'in_progress', 'pending_approval'].includes(meeting.status)
    )) || safetyMeetings.find((meeting) => meeting.jobId === jobId) || null
    setSafetyBriefingDraft({
      ...emptySafetyBriefingDraft(),
      jobId,
      meetingId: firstMeeting?.id || '',
    })
    const shouldLoad = Boolean(jobId) && navigator.onLine !== false
    setSafetyBriefingLoading(shouldLoad)
    if (!shouldLoad) return
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/safety-meetings`)
      if (loadSequence !== safetyBriefingLoadSequenceRef.current) return
      const meetings = result.safetyMeetings || []
      const selectedMeeting = meetings.find((meeting) => (
        ['scheduled', 'in_progress', 'pending_approval'].includes(meeting.status)
      )) || meetings[0] || null
      setData((current) => current ? {
        ...current,
        safetyMeetings: [
          ...meetings,
          ...(current.safetyMeetings || []).filter((meeting) => meeting.jobId !== jobId),
        ],
      } : current)
      setSafetyBriefingDraft((current) => (
        current.jobId === jobId ? { ...current, meetingId: selectedMeeting?.id || '' } : current
      ))
    } catch (requestError) {
      if (loadSequence === safetyBriefingLoadSequenceRef.current) setError(requestError.message)
    } finally {
      if (loadSequence === safetyBriefingLoadSequenceRef.current) setSafetyBriefingLoading(false)
    }
  }

  function updateSafetyBriefingDraft(field, value) {
    setSafetyBriefingDraft((current) => ({ ...current, [field]: value }))
  }

  async function createSafetyBriefing(event) {
    event.preventDefault()
    const topics = safetyBriefingDraft.topics.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean)
    if (!canCoordinate || !safetyBriefingDraft.jobId || safetyBriefingDraft.title.trim().length < 2 || !topics.length) {
      setError('Choose a job and retain a briefing title plus at least one discussion topic.')
      return
    }
    if (navigator.onLine === false) {
      setError('Reconnect before scheduling a briefing so the assigned crew list can be frozen from the ledger.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(safetyBriefingDraft.jobId)}/safety-meetings`, {
        method: 'POST',
        body: JSON.stringify({
          entryKey: safetyBriefingDraft.entryKey,
          title: safetyBriefingDraft.title.trim(),
          scheduledAt: toIsoDateTime(safetyBriefingDraft.scheduledAt),
          topics,
          status: 'scheduled',
          source: 'field_dashboard',
        }),
      })
      retainSafetyMeeting(result.safetyMeeting)
      setSafetyBriefingDraft({
        ...emptySafetyBriefingDraft(),
        jobId: safetyBriefingDraft.jobId,
        meetingId: result.safetyMeeting.id,
      })
      notify(result.safetyMeeting.replayed
        ? 'This briefing was already retained; no duplicate session was scheduled.'
        : 'Safety briefing scheduled with the current assigned crew as expected attendees.')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function acknowledgeSafetyBriefing(event) {
    event.preventDefault()
    if (!fieldScoped || !selectedSafetyMeeting || !safetyBriefingDraft.acknowledged || safetyBriefingDraft.evidenceReference.trim().length < 3) {
      setError('Select an assigned briefing, confirm the attestation, and retain an evidence reference.')
      return
    }
    const jobId = selectedSafetyMeeting.jobId
    const meetingId = selectedSafetyMeeting.id
    const draft = {
      id: safetyBriefingDraft.entryKey,
      type: 'safety_briefing_acknowledgement',
      jobId,
      payload: {
        meetingId,
        acknowledged: true,
        acknowledgedAt: new Date().toISOString(),
        evidenceReference: safetyBriefingDraft.evidenceReference.trim(),
        attestation: 'I attended this briefing, understood the retained topics, and will stop work if conditions or controls change.',
      },
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        setSafetyBriefingDraft((current) => ({ ...current, entryKey: createFieldEvidenceDraftId(), evidenceReference: '', acknowledged: false }))
        notify('Safety briefing acknowledgement was saved locally for an exact worker-scoped retry.')
        return
      }
      const result = await recordFieldOperation(draft)
      retainSafetyMeeting(result.safetyMeeting)
      setSafetyBriefingDraft((current) => ({ ...current, entryKey: createFieldEvidenceDraftId(), evidenceReference: '', acknowledged: false }))
      notify(result.replayed
        ? 'This acknowledgement was already retained; no duplicate attendance evidence was created.'
        : 'Your safety briefing acknowledgement was retained for facilitator signoff.')
      await refresh()
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          setSafetyBriefingDraft((current) => ({ ...current, entryKey: createFieldEvidenceDraftId(), evidenceReference: '', acknowledged: false }))
          notify('Connection interrupted. The acknowledgement was saved locally for an exact retry.')
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

  async function signOffSafetyBriefing(event) {
    event.preventDefault()
    if (!canCoordinate || !selectedSafetyMeeting || safetyBriefingDraft.completionEvidence.trim().length < 3) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedSafetyMeeting.jobId)}/safety-meetings/${encodeURIComponent(selectedSafetyMeeting.id)}/signoff`, {
        method: 'POST',
        body: JSON.stringify({ evidenceReference: safetyBriefingDraft.completionEvidence.trim(), status: 'completed' }),
      })
      retainSafetyMeeting(result.safetyMeeting)
      if (result.approval?.id) {
        setData((current) => current ? {
          ...current,
          approvals: upsertById(current.approvals, result.approval),
        } : current)
      }
      setSafetyBriefingDraft((current) => ({ ...current, completionEvidence: '' }))
      notify(result.replayed ? 'The briefing signoff request is already pending.' : 'Briefing evidence was frozen and sent to the approval queue.')
      if (capabilities.approvals && result.approval?.id) {
        openApprovals({ jobId: selectedSafetyMeeting.jobId, jobTitle: selectedSafetyMeeting.jobTitle, approvalId: result.approval.id })
      }
      void refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function excuseSafetyBriefingAttendee(attendee) {
    if (!canCoordinate || !selectedSafetyMeeting || !attendee?.id || safetyBriefingDraft.excusalReason.trim().length < 8) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedSafetyMeeting.jobId)}/safety-meetings/${encodeURIComponent(selectedSafetyMeeting.id)}/attendees/${encodeURIComponent(attendee.id)}/excuse`, {
        method: 'POST',
        body: JSON.stringify({ reason: safetyBriefingDraft.excusalReason.trim() }),
      })
      retainSafetyMeeting(result.safetyMeeting)
      setSafetyBriefingDraft((current) => ({ ...current, excusalReason: '' }))
      notify(`${attendee.attendeeName} was explicitly excused with the retained reason.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function retainWorkPermit(permit) {
    if (!permit?.id) return
    setData((current) => current ? {
      ...current,
      workPermits: [permit, ...(current.workPermits || []).filter((item) => item.id !== permit.id)],
    } : current)
  }

  async function selectWorkPermitJob(jobId) {
    const loadSequence = ++workPermitLoadSequenceRef.current
    const firstPermit = workPermits.find((permit) => (
      permit.jobId === jobId && ['active', 'pending_approval', 'suspended'].includes(permit.status)
    )) || workPermits.find((permit) => permit.jobId === jobId) || null
    setWorkPermitDraft({
      ...emptyWorkPermitDraft(),
      jobId,
      permitId: firstPermit?.id || '',
    })
    const shouldLoad = Boolean(jobId) && navigator.onLine !== false
    setWorkPermitLoading(shouldLoad)
    if (!shouldLoad) return
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/work-permits`)
      if (loadSequence !== workPermitLoadSequenceRef.current) return
      const permits = result.workPermits || []
      const selectedPermit = permits.find((permit) => (
        ['active', 'pending_approval', 'suspended'].includes(permit.status)
      )) || permits[0] || null
      setData((current) => current ? {
        ...current,
        workPermits: [
          ...permits,
          ...(current.workPermits || []).filter((permit) => permit.jobId !== jobId),
        ],
      } : current)
      setWorkPermitDraft((current) => (
        current.jobId === jobId ? { ...current, permitId: selectedPermit?.id || '' } : current
      ))
    } catch (requestError) {
      if (loadSequence === workPermitLoadSequenceRef.current) setError(requestError.message)
    } finally {
      if (loadSequence === workPermitLoadSequenceRef.current) setWorkPermitLoading(false)
    }
  }

  function updateWorkPermitDraft(field, value) {
    setWorkPermitDraft((current) => ({ ...current, [field]: value }))
  }

  async function createWorkPermit(event) {
    event.preventDefault()
    const hazards = workPermitDraft.hazards.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean)
    const controls = workPermitDraft.controls.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean)
    const conditions = workPermitDraft.conditions.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean)
    if (
      !canCoordinate
      || !workPermitDraft.jobId
      || workPermitDraft.title.trim().length < 3
      || !hazards.length
      || !controls.length
      || workPermitDraft.sourceEvidence.trim().length < 3
    ) {
      setError('Choose a job and retain the permit title, hazards, controls, validity, and source evidence.')
      return
    }
    if (navigator.onLine === false) {
      setError('Reconnect before requesting a permit so the current assigned crew and approval snapshot can be frozen from the ledger.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(workPermitDraft.jobId)}/work-permits`, {
        method: 'POST',
        body: JSON.stringify({
          entryKey: workPermitDraft.entryKey,
          permitType: workPermitDraft.permitType,
          title: workPermitDraft.title.trim(),
          location: workPermitDraft.location.trim(),
          validFrom: toIsoDateTime(workPermitDraft.validFrom),
          expiresAt: toIsoDateTime(workPermitDraft.expiresAt),
          hazards,
          controls,
          conditions,
          evidenceReference: workPermitDraft.sourceEvidence.trim(),
          source: 'field_dashboard',
        }),
      })
      retainWorkPermit(result.workPermit)
      setWorkPermitDraft({
        ...emptyWorkPermitDraft(),
        jobId: workPermitDraft.jobId,
        permitId: result.workPermit.id,
      })
      notify(result.replayed
        ? 'This permit request was already retained; no duplicate approval was created.'
        : 'Permit definition and assigned crew were frozen for approval.')
      await refresh()
      if (capabilities.approvals && result.approval?.id) {
        openApprovals({ jobId: result.workPermit.jobId, jobTitle: result.workPermit.jobTitle, approvalId: result.approval.id })
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function acknowledgeWorkPermit(event) {
    event.preventDefault()
    if (!fieldScoped || !selectedWorkPermit || !workPermitDraft.acknowledged || workPermitDraft.acknowledgementEvidence.trim().length < 3) {
      setError('Select an active assigned permit, confirm the attestation, and retain an evidence reference.')
      return
    }
    const draft = {
      id: workPermitDraft.entryKey,
      type: 'work_permit_acknowledgement',
      jobId: selectedWorkPermit.jobId,
      payload: {
        permitId: selectedWorkPermit.id,
        acknowledged: true,
        acknowledgedAt: new Date().toISOString(),
        evidenceReference: workPermitDraft.acknowledgementEvidence.trim(),
        attestation: 'I reviewed this permit, understand the retained hazards and controls, and will stop work if conditions change.',
      },
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        setWorkPermitDraft((current) => ({ ...current, entryKey: createFieldEvidenceDraftId(), acknowledgementEvidence: '', acknowledged: false }))
        notify('Permit acknowledgement was saved locally for an exact worker-scoped retry. Stop work until the live ledger confirms readiness.')
        return
      }
      const result = await recordFieldOperation(draft)
      retainWorkPermit(result.workPermit)
      setWorkPermitDraft((current) => ({ ...current, entryKey: createFieldEvidenceDraftId(), acknowledgementEvidence: '', acknowledged: false }))
      notify(result.replayed
        ? 'This permit acknowledgement was already retained; no duplicate evidence was created.'
        : result.workPermit.readyForWork
          ? 'Your acknowledgement was retained and this permit is ready for the assigned work.'
          : 'Your acknowledgement was retained. Other permit blockers remain.')
      await refresh()
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          setWorkPermitDraft((current) => ({ ...current, entryKey: createFieldEvidenceDraftId(), acknowledgementEvidence: '', acknowledged: false }))
          notify('Connection interrupted. The permit acknowledgement was saved locally for an exact retry. Stop work until the live ledger confirms readiness.')
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

  async function suspendWorkPermit(event) {
    event.preventDefault()
    if (!canCoordinate || !selectedWorkPermit || workPermitDraft.suspensionReason.trim().length < 8 || workPermitDraft.suspensionEvidence.trim().length < 3) {
      setError('Retain a specific suspension reason and evidence reference before stopping this permit.')
      return
    }
    if (navigator.onLine === false) {
      setError('The permit cannot be synchronized while offline. Stop work on site now and reconnect to retain the suspension.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedWorkPermit.jobId)}/work-permits/${encodeURIComponent(selectedWorkPermit.id)}/suspend`, {
        method: 'POST',
        body: JSON.stringify({
          entryKey: createFieldEvidenceDraftId(),
          reason: workPermitDraft.suspensionReason.trim(),
          evidenceReference: workPermitDraft.suspensionEvidence.trim(),
        }),
      })
      retainWorkPermit(result.permit)
      setWorkPermitDraft((current) => ({ ...current, suspensionReason: '', suspensionEvidence: '' }))
      notify(result.replayed ? 'This stop-work suspension was already retained.' : 'Permit suspended. Work must remain stopped until a new approved permit is issued.')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function closeWorkPermit(event) {
    event.preventDefault()
    if (!canCoordinate || !selectedWorkPermit || workPermitDraft.closureNote.trim().length < 8 || workPermitDraft.closureEvidence.trim().length < 3) {
      setError('Retain a completion note and closeout evidence reference before closing this permit.')
      return
    }
    if (navigator.onLine === false) {
      setError('Reconnect before closing the permit so closeout evidence is retained in the ledger.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedWorkPermit.jobId)}/work-permits/${encodeURIComponent(selectedWorkPermit.id)}/close`, {
        method: 'POST',
        body: JSON.stringify({
          entryKey: createFieldEvidenceDraftId(),
          note: workPermitDraft.closureNote.trim(),
          evidenceReference: workPermitDraft.closureEvidence.trim(),
        }),
      })
      retainWorkPermit(result.permit)
      setWorkPermitDraft((current) => ({ ...current, closureNote: '', closureEvidence: '' }))
      notify(result.replayed ? 'This permit closure was already retained.' : 'Permit closed with retained closeout evidence.')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function selectDailyCycleJob(jobId) {
    const loadSequence = ++dailyCycleLoadSequenceRef.current
    const shouldLoad = Boolean(jobId) && navigator.onLine !== false
    setDailyCycleLoading(shouldLoad)
    const workerIds = fieldScoped && operator.worker?.id ? [operator.worker.id] : []
    setDailyHuddle({
      ...emptyDailyHuddle(),
      jobId,
      facilitator: fieldScoped ? operator.worker?.name || '' : '',
      leadWorkerId: workerIds[0] || '',
      workerIds,
    })
    setFieldDailyLog({ ...emptyFieldDailyLog(), jobId })
    setFieldDailyCycles([])
    if (!shouldLoad) return
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/daily-cycles?limit=30`)
      if (loadSequence !== dailyCycleLoadSequenceRef.current) return
      const cycles = result.cycles || []
      const openCycle = cycles.find(cycle => ['released', 'blocked'].includes(cycle.status)) || null
      setFieldDailyCycles(cycles)
      if (openCycle) {
        setFieldDailyLog({
          ...emptyFieldDailyLog(),
          jobId,
          cycleId: openCycle.id,
          workDate: openCycle.workDate,
          weather: openCycle.weather || 'clear',
        })
      }
    } catch (requestError) {
      if (loadSequence === dailyCycleLoadSequenceRef.current) setError(requestError.message)
    } finally {
      if (loadSequence === dailyCycleLoadSequenceRef.current) setDailyCycleLoading(false)
    }
  }

  function updateDailyHuddle(field, value) {
    setDailyHuddle((current) => ({ ...current, [field]: value }))
  }

  function toggleDailyHuddleWorker(workerId, checked) {
    setDailyHuddle((current) => {
      const workerIds = checked
        ? [...new Set([...current.workerIds, workerId])]
        : current.workerIds.filter(id => id !== workerId)
      return {
        ...current,
        workerIds,
        leadWorkerId: workerIds.includes(current.leadWorkerId) ? current.leadWorkerId : workerIds[0] || '',
      }
    })
  }

  async function recordDailyStartHuddle(event) {
    event.preventDefault()
    if (
      !dailyHuddle.jobId || !dailyHuddle.workDate || dailyHuddle.plannedWork.trim().length < 8
      || dailyHuddle.productionTarget.trim().length < 3 || dailyHuddle.safetyFocus.trim().length < 5
      || dailyHuddle.evidenceReference.trim().length < 3
    ) {
      setError('Choose a job and date, then retain the work plan, production target, safety focus, and huddle evidence reference.')
      return
    }
    if (!fieldScoped && (dailyHuddle.facilitator.trim().length < 2 || !dailyHuddle.workerIds.length || !dailyHuddle.leadWorkerId)) {
      setError('Record the facilitator, crew, and daily lead before retaining the start huddle.')
      return
    }
    if (dailyHuddle.stopWorkRequired && !dailyHuddle.blockingIssues.trim()) {
      setError('Record at least one blocking issue before setting the stop-work state.')
      return
    }
    const payload = {
      workDate: dailyHuddle.workDate,
      shiftLabel: dailyHuddle.shiftLabel,
      facilitator: dailyHuddle.facilitator.trim() || undefined,
      leadWorkerId: dailyHuddle.leadWorkerId || undefined,
      workerIds: dailyHuddle.workerIds,
      plannedWork: dailyHuddle.plannedWork.trim(),
      productionTarget: dailyHuddle.productionTarget.trim(),
      weather: dailyHuddle.weather,
      siteConditions: dailyHuddle.siteConditions.trim(),
      safetyFocus: dailyHuddle.safetyFocus.trim(),
      qualityHoldPoints: dailyHuddle.qualityHoldPoints,
      constraints: dailyHuddle.constraints,
      blockingIssues: dailyHuddle.blockingIssues,
      stopWorkRequired: dailyHuddle.stopWorkRequired,
      evidenceReference: dailyHuddle.evidenceReference.trim(),
    }
    const draft = {
      id: dailyHuddle.entryKey,
      type: 'daily_huddle',
      jobId: dailyHuddle.jobId,
      payload,
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        setDailyHuddle(emptyDailyHuddle())
        notify('Start huddle was saved locally with its frozen crew, plan, safety focus, and stop-work state. It will sync after reconnection.')
        return
      }
      const result = await recordFieldOperation(draft)
      const cycle = result.cycle
      setFieldDailyCycles((current) => upsertById(current, cycle))
      setDailyHuddle({ ...emptyDailyHuddle(), jobId: dailyHuddle.jobId })
      setFieldDailyLog({
        ...emptyFieldDailyLog(),
        jobId: cycle.jobId,
        cycleId: cycle.id,
        workDate: cycle.workDate,
        weather: cycle.weather || 'clear',
      })
      notify(
        result.replayed
          ? 'This start huddle was already retained; the existing daily cycle was returned.'
          : cycle.status === 'blocked'
            ? `Start huddle retained with ${cycle.blockingIssues.length} blocking issue${cycle.blockingIssues.length === 1 ? '' : 's'}. Work is not released by this record.`
            : 'Start huddle retained with frozen crew, plan, safety focus, and hold points. This record does not replace a permit or safety clearance.',
      )
      await refresh()
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          setDailyHuddle(emptyDailyHuddle())
          notify('Connection interrupted. The complete start huddle was saved locally for an exact retry.')
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
      !fieldDailyLog.cycleId ||
      !fieldDailyLog.workDate ||
      !(hours > 0 && hours <= 24) ||
      !(manpower > 0 && manpower <= 500) ||
      !fieldDailyLog.workCompleted.trim()
    ) {
      setError('Choose an open daily cycle, record positive hours and manpower, and describe the completed work.')
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
    if (!fieldDailyLog.planAchieved && !fieldDailyLog.varianceReasons.trim()) {
      setError('Record at least one reason when the daily production target was not achieved.')
      return
    }
    if (fieldDailyLog.tomorrowPlan.trim().length < 3 || fieldDailyLog.evidenceReferences.trim().length < 3) {
      setError('Record tomorrow\'s plan and at least one retained EOD evidence reference.')
      return
    }
    const payload = {
      cycleId: fieldDailyLog.cycleId,
      workerId: fieldScoped ? undefined : fieldDailyLog.workerId,
      workDate: fieldDailyLog.workDate,
      hours,
      manpower,
      weather: fieldDailyLog.weather,
      workCompleted: fieldDailyLog.workCompleted.trim(),
      blockers: fieldDailyLog.blockers,
      planAchieved: fieldDailyLog.planAchieved,
      varianceReasons: fieldDailyLog.varianceReasons,
      unresolvedActions: fieldDailyLog.unresolvedActions,
      tomorrowPlan: fieldDailyLog.tomorrowPlan.trim(),
      evidenceReferences: fieldDailyLog.evidenceReferences,
      safetyConcern: fieldDailyLog.safetyConcern,
      safetyRiskLevel: fieldDailyLog.safetyRiskLevel,
      safetyNotes: fieldDailyLog.safetyNotes.trim(),
      source: 'field_dashboard',
    }
    const draft = {
      id: fieldDailyLog.entryKey,
      type: 'daily_cycle_close',
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
        notify('End-of-day report was saved locally with its time, safety, variance, and handoff evidence. It will sync after reconnection.')
        return
      }
      const result = await recordFieldOperation(draft)
      const approvalCount = Array.isArray(result.dailyLog?.approvals)
        ? result.dailyLog.approvals.length
        : Number(result.dailyLog?.approvals || 0)
      setFieldDailyCycles((current) => upsertById(current, result.cycle))
      setFieldDailyLog({ ...emptyFieldDailyLog(), jobId: fieldDailyLog.jobId })
      notify(
        result.replayed || result.dailyLog?.replayed
          ? 'This end-of-day report was already retained; the existing daily cycle was returned without duplication.'
          : `End-of-day report retained with plan variance, time card, safety state, and tomorrow handoff. ${approvalCount} review${approvalCount === 1 ? '' : 's'} added to the ledger.`,
      )
      await refresh()
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          setFieldDailyLog(emptyFieldDailyLog())
          notify('Connection interrupted. The complete end-of-day report was saved locally for an exact retry.')
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

  async function requestProductionBaseline(payload) {
    if (!selectedJobId || !Array.isArray(payload?.lines) || !payload.lines.length) {
      setError('Add at least one measured production line before requesting baseline approval.')
      return false
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/production-baselines`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (result.job) setSelectedJob(result.job)
      notify(
        result.replayed
          ? `Production baseline v${result.baseline?.versionNumber || ''} is already retained.`
          : `Production baseline v${result.baseline?.versionNumber || ''} retained for approval. No field output, schedule, budget, or external commitment was created.`,
      )
      await refreshSection(sectionRef.current)
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function recordProductionOutput(payload) {
    if (!selectedJobId || !payload?.entryKey) return false
    const draft = {
      id: payload.entryKey,
      type: 'production_entry',
      jobId: selectedJobId,
      payload: {
        baselineId: payload.baselineId,
        lineKey: payload.lineKey,
        workDate: payload.workDate,
        quantity: payload.quantity,
        crewHours: payload.crewHours,
        note: payload.note,
        source: payload.source || 'job_workspace',
      },
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        notify('Production output was saved locally and will be recorded for this operator after reconnection.')
        return true
      }
      const result = await recordFieldOperation(draft)
      if (result.job) setSelectedJob(result.job)
      notify(
        result.replayed || result.entry?.replayed
          ? 'This production output was already retained; no duplicate was created.'
          : 'Installed quantity and crew hours were recorded against the approved production baseline.',
      )
      await refreshSection(sectionRef.current)
      return true
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          notify('Connection interrupted. Production output was saved locally for an exact retry.')
          return true
        } catch (outboxError) {
          setError(outboxError.message)
          return false
        }
      }
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function recordDayworkTicket(payload) {
    if (!selectedJobId || !payload?.entryKey) return false
    const draft = {
      id: payload.entryKey,
      type: 'daywork_ticket',
      jobId: selectedJobId,
      payload,
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        notify('Daywork quantities were saved locally and will be submitted for review after reconnection.')
        return true
      }
      const result = await recordFieldOperation(draft)
      if (result.job) setSelectedJob(result.job)
      notify(
        result.replayed
          ? 'This daywork ticket was already retained; no duplicate was created.'
          : `${result.dayworkTicket?.ticketNumber || 'Daywork ticket'} retained for quantity and evidence review. No price or external commitment was created.`,
      )
      await refreshSection(sectionRef.current)
      return true
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          notify('Connection interrupted. Daywork quantities were saved locally for an exact retry.')
          return true
        } catch (outboxError) {
          setError(outboxError.message)
          return false
        }
      }
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function requestDayworkAcknowledgement(ticketId, payload) {
    if (!selectedJobId || !ticketId) return false
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/daywork-tickets/${encodeURIComponent(ticketId)}/acknowledgement`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      if (result.job) setSelectedJob(result.job)
      notify(
        result.replayed
          ? 'This acknowledgement review is already pending.'
          : 'Acknowledgement evidence was retained for review. It confirms receipt only and does not accept price or scope.',
      )
      await refreshSection(sectionRef.current)
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function convertDayworkTicket(ticketId, payload) {
    if (!selectedJobId || !ticketId) return false
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/daywork-tickets/${encodeURIComponent(ticketId)}/convert`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      if (result.job) setSelectedJob(result.job)
      notify(
        result.replayed
          ? 'This daywork ticket is already linked to its retained change order.'
          : 'A source-bound change order was prepared for approval. Contract value and external commitments remain unchanged.',
      )
      await refreshSection(sectionRef.current)
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function requestProductionReversal(entryId, reason) {
    if (!selectedJobId || !entryId || reason.length < 5) return false
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/production-entries/${encodeURIComponent(entryId)}/reversal`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      )
      if (result.job) setSelectedJob(result.job)
      notify(
        result.replayed
          ? 'The production reversal is already retained.'
          : 'Production reversal retained for approval. The entry remains included until the decision is approved.',
      )
      await refreshSection(sectionRef.current)
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
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
    setPortalDraft({ label: 'Client job portal', expiresAt: futureDateInput(30), locale: 'nl-NL' })
    setPortalLink('')
    setTaskDraft(emptyTaskDraft())
    setTaskAction(null)
    setTaskActionNote('')
    await Promise.all([
      loadSelectedJob(job.id),
      capabilities.estimateRates === true
        ? api('/api/ledger/estimate-rates').then((result) => setEstimateRates(result.estimateRates || null))
        : Promise.resolve(),
      canCoordinate ? loadResourceOptions() : Promise.resolve(),
      canCoordinate
        ? api('/api/ledger/inspection-templates').then((result) => {
            setData((current) => current ? { ...current, inspectionTemplates: result.templates || [] } : current)
          })
        : Promise.resolve(),
    ])
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

  async function applyCapabilitySetup(requirementKeys) {
    if (!selectedJobId || !canCoordinate || !requirementKeys.length) return null
    setSubmitting(true)
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/capability-plan`, {
        method: 'POST',
        body: JSON.stringify({ requirementKeys }),
      })
      setSelectedJob(result.job)
      await refresh()
      const created = result.created?.length || 0
      const blocked = result.blocked?.length || 0
      notify(
        `${created} internal setup draft${created === 1 ? '' : 's'} retained.${blocked ? ` ${blocked} manual gap${blocked === 1 ? '' : 's'} remained operator-controlled.` : ''}`,
      )
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function requestEstimateRatePolicy(payload) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api('/api/ledger/estimate-rates/policies', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setEstimateRates(result.estimateRates || estimateRates)
      notify('Estimating rate policy revision retained for approval.')
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function applyTakeoffUnitRate(takeoff, item, payload) {
    if (!selectedJobId || !takeoff?.id || !item?.id) return null
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/takeoffs/${encodeURIComponent(takeoff.id)}/items/${encodeURIComponent(item.id)}/rate-build-up`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      setSelectedJob(result.job)
      notify(result.replayed ? 'The matching unit-rate build-up was already retained.' : 'Unit-rate build-up calculated and retained on the draft measurement.')
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  function openTakeoffCreate() {
    if (!selectedJob) return
    commercialDialogReturnFocusRef.current = false
    commercialDialogOpenerRef.current = document.activeElement
    setTakeoffDraft(emptyTakeoffDraft(selectedJob))
    setTakeoffDialog({ mode: 'create' })
  }

  function openTakeoffItem(takeoff, item = null) {
    commercialDialogReturnFocusRef.current = false
    commercialDialogOpenerRef.current = document.activeElement
    setTakeoffItemDraft(emptyTakeoffItemDraft(item, takeoff))
    setTakeoffDialog({ mode: item ? 'edit_item' : 'add_item', takeoff, item })
  }

  function openTakeoffRemoval(takeoff, item) {
    commercialDialogReturnFocusRef.current = false
    commercialDialogOpenerRef.current = document.activeElement
    setTakeoffDialog({ mode: 'remove_item', takeoff, item })
  }

  function openTakeoffConversion(takeoff) {
    commercialDialogReturnFocusRef.current = false
    commercialDialogOpenerRef.current = document.activeElement
    setTakeoffConversionDraft(emptyTakeoffConversionDraft())
    setTakeoffDialog({ mode: 'convert', takeoff })
  }

  function closeTakeoffDialog() {
    if (submitting) return
    setTakeoffDialog(null)
    setTakeoffDraft(emptyTakeoffDraft())
    setTakeoffItemDraft(emptyTakeoffItemDraft())
    setTakeoffConversionDraft(emptyTakeoffConversionDraft())
    restoreCommercialDialogFocus()
  }

  function changeTakeoffMeasurementType(measurementType) {
    const unit = { count: 'ea', linear: 'm', area: 'm2', volume: 'm3', manual: 'unit' }[measurementType]
    setTakeoffItemDraft((current) => ({ ...current, measurementType, unit }))
  }

  async function submitTakeoff(event) {
    event.preventDefault()
    if (!selectedJobId || takeoffDraft.title.trim().length < 2) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/takeoffs`, {
        method: 'POST',
        body: JSON.stringify({
          title: takeoffDraft.title.trim(),
          taxRate: Number(takeoffDraft.taxRate),
          currency: 'EUR',
          notes: takeoffDraft.notes.trim() || null,
        }),
      })
      setSelectedJob(result.job)
      setTakeoffDialog(null)
      restoreCommercialDialogFocus()
      notify('Quantity takeoff retained as an internal draft. No estimate or external commitment was created.')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function submitTakeoffItem(event) {
    event.preventDefault()
    if (!selectedJobId || !takeoffDialog?.takeoff || !takeoffItemDraftReady) return
    const editing = takeoffDialog.mode === 'edit_item'
    const base = `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/takeoffs/${encodeURIComponent(takeoffDialog.takeoff.id)}/items`
    const route = editing ? `${base}/${encodeURIComponent(takeoffDialog.item.id)}` : base
    setSubmitting(true)
    setError('')
    try {
      const result = await api(route, {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({
          description: takeoffItemDraft.description.trim(),
          category: takeoffItemDraft.category,
          measurementType: takeoffItemDraft.measurementType,
          count: Number(takeoffItemDraft.count),
          length: Number(takeoffItemDraft.length) || 0,
          width: Number(takeoffItemDraft.width) || 0,
          height: Number(takeoffItemDraft.height) || 0,
          quantity: Number(takeoffItemDraft.quantity) || 0,
          unit: takeoffItemDraft.unit.trim(),
          wastePercent: Number(takeoffItemDraft.wastePercent) || 0,
          unitCost: Number(takeoffItemDraft.unitCost) || 0,
          unitPrice: Number(takeoffItemDraft.unitPrice) || 0,
          costCode: takeoffItemDraft.costCode.trim() || 'estimate',
          wbsCode: takeoffItemDraft.wbsCode.trim().toUpperCase(),
          workPackage: takeoffItemDraft.workPackage.trim(),
          sourceReference: takeoffItemDraft.sourceReference.trim() || null,
        }),
      })
      setSelectedJob(result.job)
      setTakeoffDialog(null)
      restoreCommercialDialogFocus()
      notify(editing ? 'Takeoff measurement recalculated and retained.' : 'Takeoff measurement calculated and retained.')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function removeTakeoffItem() {
    if (!selectedJobId || takeoffDialog?.mode !== 'remove_item') return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/takeoffs/${encodeURIComponent(takeoffDialog.takeoff.id)}/items/${encodeURIComponent(takeoffDialog.item.id)}/remove`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      setSelectedJob(result.job)
      setTakeoffDialog(null)
      restoreCommercialDialogFocus()
      notify('Takeoff measurement removed and sheet totals recalculated.')
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function convertTakeoff(event) {
    event.preventDefault()
    if (!selectedJobId || takeoffDialog?.mode !== 'convert') return
    const commercialScopeRevision = selectedJob?.commercialScope?.currentRevision
    if (!commercialScopeRevision || selectedJob?.commercialScope?.stale === true) {
      setError('Approve a current scope, assumptions, exclusions, and allowances revision before preparing the estimate.')
      return
    }
    const pricingDecision = selectedJob?.pricingBasis?.currentDecision
    const riskRegisterRevision = selectedJob?.riskRegister?.currentRevision
    if (!riskRegisterRevision || selectedJob?.riskRegister?.stale === true) {
      setError('Approve a current project risk register and premortem before preparing the estimate.')
      return
    }
    if (!pricingDecision || selectedJob?.pricingBasis?.stale === true) {
      setError('Retain a current fixed-price or time-and-materials decision before preparing the estimate.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/takeoffs/${encodeURIComponent(takeoffDialog.takeoff.id)}/convert`,
        {
          method: 'POST',
          body: JSON.stringify({
            validUntil: takeoffConversionDraft.validUntil,
            notes: takeoffConversionDraft.notes.trim() || null,
            commercialScopeRevisionId: commercialScopeRevision.id,
            riskRegisterRevisionId: riskRegisterRevision.id,
            pricingDecisionId: pricingDecision.id,
          }),
        },
      )
      setSelectedJob(result.job)
      setTakeoffDialog(null)
      restoreCommercialDialogFocus()
      notify(`Measured scope sealed and estimate retained at ${currency.format(result.quote.subtotal)} net. Approval is required before issue.`)
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openCommercialDraft(mode, supersedes = null) {
    if (!selectedJob) return
    if (mode === 'quote' && selectedJob.commercialScope?.ready !== true) {
      setError('Approve a current scope, assumptions, exclusions, and allowances revision before creating an estimate.')
      return
    }
    if (mode === 'quote' && selectedJob.riskRegister?.ready !== true) {
      setError('Approve a current project risk register and premortem before creating an estimate.')
      return
    }
    if (mode === 'quote' && (!selectedJob.pricingBasis?.currentDecision || selectedJob.pricingBasis?.stale === true)) {
      setError('Retain a current fixed-price or time-and-materials decision before creating an estimate.')
      return
    }
    commercialDialogReturnFocusRef.current = false
    commercialDialogOpenerRef.current = document.activeElement
    setCommercialDraftMode(mode)
    if (mode === 'quote') setQuoteDraft(emptyQuoteDraft(selectedJob))
    else setChangeOrderDraft(emptyChangeOrderDraft(selectedJob, supersedes))
  }

  function restoreCommercialDialogFocus() {
    commercialDialogReturnFocusRef.current = true
  }

  function closeCommercialDialog() {
    if (submitting) return
    setCommercialDraftMode(null)
    setCommercialAcceptance(null)
    setCommercialAcceptanceDraft(emptyCommercialAcceptanceDraft())
    setCommercialDelivery(null)
    setCommercialDeliveryDraft(emptyBidOrderDeliveryDraft())
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
              commercialScopeRevisionId: selectedJob?.commercialScope?.currentRevision?.id || null,
              riskRegisterRevisionId: selectedJob?.riskRegister?.currentRevision?.id || null,
              pricingDecisionId: selectedJob?.pricingBasis?.currentDecision?.id || null,
              currency: 'EUR',
              taxRate: Number(draft.taxRate),
              validUntil: draft.validUntil || null,
              notes: draft.notes.trim() || null,
              lineItems,
            }
          : {
              entryKey: draft.entryKey,
              quoteId: draft.quoteId || null,
              supersedesChangeOrderId: draft.supersedesChangeOrderId || null,
              title: draft.title.trim(),
              scopeDelta: draft.scopeDelta.trim(),
              variationType: draft.variationType,
              initiatedBy: draft.initiatedBy,
              cause: draft.cause.trim(),
              justification: draft.justification.trim(),
              contractReference: draft.contractReference.trim(),
              noticeReference: draft.noticeReference.trim() || null,
              noticeNotApplicableReason: draft.noticeReference.trim() ? null : draft.noticeNotApplicableReason.trim(),
              requestedAt: draft.requestedAt || null,
              responseDueAt: draft.responseDueAt || null,
              scheduleDeltaDays: Number(draft.scheduleDeltaDays),
              scheduleImpactNarrative: draft.scheduleImpactNarrative.trim(),
              riskImpact: draft.riskImpact,
              riskImpactStatement: draft.riskImpactStatement.trim(),
              assumptions: draft.assumptions.split('\n').map((item) => item.trim()).filter(Boolean),
              exclusions: draft.exclusions.split('\n').map((item) => item.trim()).filter(Boolean),
              evidenceReferences: draft.evidenceReferences.split('\n').map((item) => item.trim()).filter(Boolean),
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
      setData((current) => current
        ? reconcileJobCollections({ ...current, dashboard: result.dashboard || current.dashboard }, result.job)
        : current)
      setCommercialDraftMode(null)
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
      setData((current) => current
        ? reconcileJobCollections({ ...current, dashboard: result.dashboard || current.dashboard }, result.job)
        : current)
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

  async function retainPricingBasisDecision(payload) {
    if (!selectedJobId) return false
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/pricing-decisions`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setSelectedJob(result.job)
      setData((current) => current
        ? reconcileJobCollections({ ...current, dashboard: result.dashboard || current.dashboard }, result.job)
        : current)
      notify(`${formatStatus(result.decision.selectedModel)} pricing basis v${result.decision.versionNumber} retained. Estimates now bind to this exact decision.`)
      return result
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function requestCommercialScopeRevision(payload) {
    if (!selectedJobId) return false
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/commercial-scope/revisions`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setSelectedJob(result.job)
      setData((current) => current
        ? reconcileJobCollections({ ...current, dashboard: result.dashboard || current.dashboard }, result.job)
        : current)
      notify(`Commercial scope v${result.revision.versionNumber} retained for approval. Pricing remains blocked until review.`)
      return result
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function requestRiskRegisterRevision(payload) {
    if (!selectedJobId) return false
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/risk-register/revisions`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setSelectedJob(result.job)
      setData((current) => current
        ? reconcileJobCollections({ ...current, dashboard: result.dashboard || current.dashboard }, result.job)
        : current)
      notify(`Project risk register v${result.revision.versionNumber} retained for approval. Pricing remains blocked until review.`)
      return result
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function prepareChangeOrderIssuePackage(changeOrder) {
    if (!selectedJobId || !changeOrder?.id) return
    setSubmitting(true)
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/change-orders/${encodeURIComponent(changeOrder.id)}/issue-package`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      )
      setSelectedJob(result.job)
      setData((current) => current
        ? reconcileJobCollections({ ...current, dashboard: result.dashboard || current.dashboard }, result.job)
        : current)
      notify(
        result.replayed
          ? `Change-order package ${result.issueReference} is already retained with its delivery approval.`
          : `Change-order package ${result.issueReference} retained. Delivery remains blocked until its separate approval and provider receipt are retained.`,
      )
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openChangeOrderDelivery(changeOrder, communication) {
    if (!changeOrder?.id || !communication?.id) return
    commercialDialogReturnFocusRef.current = false
    commercialDialogOpenerRef.current = document.activeElement
    setCommercialDelivery({ changeOrder, communication })
    setCommercialDeliveryDraft(emptyBidOrderDeliveryDraft())
  }

  async function submitChangeOrderDelivery(event) {
    event.preventDefault()
    if (
      !commercialDelivery?.communication?.id ||
      !commercialDeliveryDraft.integration.trim() ||
      !commercialDeliveryDraft.providerMessageId.trim() ||
      !commercialDeliveryDraft.sentAt
    ) {
      return
    }
    setSubmitting(true)
    try {
      const result = await api(
        `/api/ledger/communications/${encodeURIComponent(commercialDelivery.communication.id)}/delivery-receipt`,
        {
          method: 'POST',
          body: JSON.stringify({
            integration: commercialDeliveryDraft.integration.trim(),
            providerMessageId: commercialDeliveryDraft.providerMessageId.trim(),
            sentAt: toIsoDateTime(commercialDeliveryDraft.sentAt),
          }),
        },
      )
      setSelectedJob(result.job)
      setCommercialDelivery(null)
      setCommercialDeliveryDraft(emptyBidOrderDeliveryDraft())
      restoreCommercialDialogFocus()
      notify(
        `Verified provider receipt retained for ${result.changeOrder?.data?.issuePackage?.issueReference || 'the change order'}. Client acceptance can now be recorded; contract value is unchanged.`,
      )
      await refresh()
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
    if (type === 'change_issue_package') {
      prepareChangeOrderIssuePackage(record)
      return
    }
    commercialDialogReturnFocusRef.current = false
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
      setData((current) => current
        ? reconcileJobCollections({ ...current, dashboard: result.dashboard || current.dashboard }, result.job)
        : current)
      setCommercialAcceptance(null)
      setCommercialAcceptanceDraft(emptyCommercialAcceptanceDraft())
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
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function submitEnergyPerformanceRecord(payload) {
    if (!selectedJobId || !canCoordinate) return null
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/energy-performance`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setSelectedJob(result.job)
      setData((current) => current
        ? reconcileJobCollections({ ...current, dashboard: result.dashboard || current.dashboard }, result.job)
        : current)
      notify(
        result.replayed
          ? 'The exact energy-performance evidence was already retained.'
          : 'Energy-performance evidence retained for independent review. Contractor.AI did not calculate, certify, or register it.',
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
      setSubmitting(false)
      notify(`${record.transmittalNumber} issue evidence retained. Contractor.AI did not send the package.`)
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
      setSubmitting(false)
      notify(result.transmittal.status === 'acknowledged' ? `${record.transmittalNumber} is fully acknowledged.` : 'Recipient acknowledgment evidence retained.')
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

  async function createInspectionTemplate(payload) {
    if (!canCoordinate) return null
    setSubmitting(true)
    setError('')
    try {
      const result = await api('/api/ledger/inspection-templates', {
        method: 'POST',
        body: JSON.stringify({ ...payload, actor: 'office_operator' }),
      })
      setData((current) => current ? {
        ...current,
        inspectionTemplates: [
          result.template,
          ...(current.inspectionTemplates || []).filter((template) => template.id !== result.template.id),
        ],
      } : current)
      notify(`${result.template.name} retained as reusable inspection template v${result.template.versionNumber}.`)
      return result.template
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function schedulePhotoEvidenceSet(payload) {
    if (!selectedJobId || !canCoordinate) return null
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/photo-evidence`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setSelectedJob(result.job)
      notify(`${result.photoEvidenceSet.title} scheduled. Task completion now requires released before, during, and after evidence.`)
      await refresh()
      return result.photoEvidenceSet
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function requestPhotoEvidenceReview(setId, payload) {
    if (!selectedJobId || !setId || !canCoordinate) return null
    setSubmitting(true)
    setError('')
    try {
      const result = await api(
        `/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/photo-evidence/${encodeURIComponent(setId)}/review`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      setSelectedJob(result.job)
      setData((current) => current && result.approval ? {
        ...current,
        approvals: upsertById(current.approvals || [], result.approval),
        dashboard: result.dashboard || current.dashboard,
      } : current)
      notify(
        result.replayed
          ? 'The exact photo-evidence review request was already retained.'
          : 'The checksum-protected before/during/after sequence is waiting for independent approval.',
      )
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function scheduleInspectionChecklist(payload) {
    if (!selectedJobId || !canCoordinate) return null
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/inspection-checklists`, {
        method: 'POST',
        body: JSON.stringify({ ...payload, actor: 'office_operator' }),
      })
      setSelectedJob(result.job)
      notify(`${result.inspection.title} scheduled with an immutable template snapshot.`)
      await refresh()
      return result.inspection
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function submitInspectionChecklist(inspection, payload) {
    const jobId = inspection?.jobId || selectedJobId
    if (!jobId || !inspection?.id) return null
    const draft = {
      id: payload.entryKey,
      type: 'inspection_checklist',
      jobId,
      payload: { ...payload, inspectionId: inspection.id },
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        notify('Inspection checklist saved locally for this operator and scheduled for exact retry after reconnection.')
        return { queued: true }
      }
      const result = await recordFieldOperation(draft)
      setSelectedJob(result.job)
      notify(
        result.replayed
          ? 'This checklist submission was already retained; no duplicate observations or approval were created.'
          : `${result.submission.failedCount} failed item(s) retained with corrective observations. Inspection sign-off is waiting for approval.`,
      )
      await refresh()
      return result
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          notify('Connection interrupted. The complete inspection checklist was saved locally for an exact retry.')
          return { queued: true }
        } catch (outboxError) {
          setError(outboxError.message)
          return null
        }
      }
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function createNonconformance(values) {
    if (!selectedJobId || !values?.entryKey) return null
    const { entryKey, ...payload } = values
    const draft = {
      id: entryKey,
      type: 'nonconformance',
      jobId: selectedJobId,
      payload: { ...payload, source: 'job_nonconformance_register' },
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        notify('NCR saved locally for this operator and scheduled for exact retry after reconnection.')
        return { queued: true }
      }
      const result = await recordFieldOperation(draft)
      setSelectedJob(result.job)
      setData((current) => current ? reconcileJobCollections({ ...current, dashboard: result.dashboard || current.dashboard }, result.job) : current)
      notify(result.replayed ? 'This NCR was already retained; no duplicate record was created.' : `${result.nonconformance?.ncrNumber || 'NCR'} retained with immutable source evidence.`)
      await refresh()
      return result
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          notify('Connection interrupted. The NCR was saved locally for an exact retry.')
          return { queued: true }
        } catch (outboxError) {
          setError(outboxError.message)
          return null
        }
      }
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function requestNonconformanceCorrection(recordId, payload) {
    if (!selectedJobId || !recordId || !canCoordinate || navigator.onLine === false) return null
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/nonconformances/${encodeURIComponent(recordId)}/corrective-action`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setSelectedJob(result.job)
      notify(result.replayed ? 'This corrective-action review is already pending.' : 'Corrective action retained for source-current approval. The NCR remains open.')
      await refresh()
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function requestNonconformanceClosure(recordId, payload) {
    if (!selectedJobId || !recordId || !canCoordinate || navigator.onLine === false) return null
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/nonconformances/${encodeURIComponent(recordId)}/closure`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setSelectedJob(result.job)
      notify(result.replayed ? 'This NCR closure review is already pending.' : 'Independent closure evidence retained for approval. Related inspection and closeout records remain unchanged.')
      await refresh()
      return result
    } catch (requestError) {
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function createFieldRisk(type, values) {
    if (!selectedJobId || !['observation', 'incident'].includes(type)) return null
    const { entryKey, evidenceDocumentId, ...fields } = values
    const payload = type === 'incident'
      ? {
          ...fields,
          occurredAt: toIsoDateTime(fields.occurredAt),
          witnesses: String(fields.witnesses || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
          evidenceDocumentIds: evidenceDocumentId ? [evidenceDocumentId] : [],
          status: 'reported',
          requiresApproval: true,
          source: 'field_risk_register',
        }
      : {
          ...fields,
          evidenceDocumentIds: evidenceDocumentId ? [evidenceDocumentId] : [],
          status: 'open',
          source: 'field_risk_register',
        }
    const draft = {
      id: entryKey,
      type,
      jobId: selectedJobId,
      payload,
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    try {
      if (navigator.onLine === false) {
        await enqueueFieldOperationDraft(draft)
        await refreshOutboxState()
        notify(`${type === 'incident' ? 'Incident' : 'Observation'} saved locally for this operator and scheduled for exact retry after reconnection.`)
        return { queued: true }
      }
      const result = await recordFieldOperation(draft)
      setSelectedJob(result.job)
      setData((current) => current ? reconcileJobCollections({ ...current, dashboard: result.dashboard || current.dashboard }, result.job) : current)
      notify(
        result.replayed
          ? `This ${type} was already retained; no duplicate record or approval was created.`
          : type === 'incident'
            ? 'Incident retained for human review. No external notification, work clearance, or statutory filing was made.'
            : 'Observation retained in the field risk register.',
      )
      await refresh()
      return result
    } catch (requestError) {
      if (shouldQueueFieldMutation(requestError)) {
        try {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          notify(`Connection interrupted. The ${type} was saved locally for an exact retry.`)
          return { queued: true }
        } catch (outboxError) {
          setError(outboxError.message)
          return null
        }
      }
      setError(requestError.message)
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function createCloseoutRecord(recordType, values) {
    if (!selectedJobId || !['punch_item', 'warranty_claim', 'aftercare', 'client_feedback'].includes(recordType)) return null
    if (recordType !== 'punch_item' && (!canCoordinate || navigator.onLine === false)) {
      setError('Reconnect before retaining warranty, aftercare, or feedback records. Offline exact retry is limited to field punch capture.')
      return null
    }

    if (recordType === 'punch_item') {
      const { entryKey, evidenceDocumentId, ...fields } = values
      const draft = {
        id: entryKey,
        type: recordType,
        jobId: selectedJobId,
        payload: {
          ...fields,
          evidenceDocumentIds: evidenceDocumentId ? [evidenceDocumentId] : [],
          status: 'open',
          source: 'closeout_register',
        },
        operatorScope: outboxScope,
      }
      setSubmitting(true)
      setError('')
      try {
        if (navigator.onLine === false) {
          await enqueueFieldOperationDraft(draft)
          await refreshOutboxState()
          notify('Punch item saved locally for this operator and scheduled for exact retry after reconnection.')
          return { queued: true }
        }
        const result = await recordFieldOperation(draft)
        setSelectedJob(result.job)
        setData((current) => current ? reconcileJobCollections({ ...current, dashboard: result.dashboard || current.dashboard }, result.job) : current)
        notify(result.replayed ? 'This punch item was already retained; no duplicate record or approval was created.' : 'Punch item retained. Resolution and client visibility remain approval-gated.')
        await refresh()
        return result
      } catch (requestError) {
        if (shouldQueueFieldMutation(requestError)) {
          try {
            await enqueueFieldOperationDraft(draft)
            await refreshOutboxState()
            notify('Connection interrupted. The punch item was saved locally for an exact retry.')
            return { queued: true }
          } catch (outboxError) {
            setError(outboxError.message)
            return null
          }
        }
        setError(requestError.message)
        return null
      } finally {
        setSubmitting(false)
      }
    }

    const route = recordType === 'warranty_claim'
      ? 'warranty-claims'
      : recordType === 'client_feedback'
        ? 'client-feedback'
        : 'aftercare'
    const payload = recordType === 'warranty_claim'
      ? { ...values, status: 'open', source: 'closeout_register' }
      : recordType === 'client_feedback'
        ? { ...values, source: 'closeout_register' }
        : { ...values, status: 'open' }
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(selectedJobId)}/${route}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setSelectedJob(result.job)
      setData((current) => current ? reconcileJobCollections({ ...current, dashboard: result.dashboard || current.dashboard }, result.job) : current)
      notify(recordType === 'warranty_claim'
        ? 'Warranty claim retained for internal review. No liability, visit, remedy, or client commitment was accepted.'
        : recordType === 'client_feedback'
          ? 'Client feedback retained as immutable NPS, satisfaction, and effort evidence. No review or referral request was sent.'
          : 'Aftercare follow-up retained internally. No message was delivered and no work was booked.')
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
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(job.id)}/${mode}?includeDashboard=false`, {
        method: 'POST',
        body: JSON.stringify({ reason: jobLifecycleReason.trim(), actor: 'office_operator' }),
      })
      setJobLifecycleAction(null)
      setJobLifecycleReason('')
      if (selectedJobId === job.id) closeJobWorkspace()
      setSubmitting(false)
      notify(
        mode === 'archive'
          ? 'Archive decision retained. The job remains active until an approver confirms the exact effects.'
          : 'Restore decision retained. The job remains archived until an approver confirms the retained state.',
      )
      if (capabilities.approvals && result.approval?.id) {
        openApprovals({ jobId: job.id, jobTitle: job.title, approvalId: result.approval.id })
      }
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
          locale: portalDraft.locale,
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

  function openCredentialEditor(worker) {
    qualificationDialogOpenerRef.current = document.activeElement
    setCredentialEditor(worker)
    setCredentialDraft(emptyWorkerCredentialDraft(worker))
  }

  function closeCredentialEditor() {
    if (submitting) return
    const opener = qualificationDialogOpenerRef.current
    qualificationDialogOpenerRef.current = null
    setCredentialEditor(null)
    setCredentialDraft(emptyWorkerCredentialDraft())
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus()
    })
  }

  async function submitWorkerCredential(event) {
    event.preventDefault()
    if (!credentialEditor || credentialDraft.evidenceReference.trim().length < 4) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/workers/${encodeURIComponent(credentialEditor.id)}/credentials`, {
        method: 'POST',
        body: JSON.stringify({
          credentialType: credentialDraft.credentialType,
          title: credentialDraft.title.trim() || null,
          issuer: credentialDraft.issuer.trim() || null,
          credentialNumber: credentialDraft.credentialNumber.trim() || null,
          issuedOn: credentialDraft.issuedOn || null,
          expiresOn: credentialDraft.expiresOn || null,
          evidenceReference: credentialDraft.evidenceReference.trim(),
          actor: 'office_operator',
        }),
      })
      setCredentialEditor(null)
      setCredentialDraft(emptyWorkerCredentialDraft())
      setData((current) => current ? {
        ...current,
        workers: result.worker ? upsertById(current.workers, result.worker) : current.workers,
        qualificationRegister: result.qualificationRegister || current.qualificationRegister,
        dashboard: result.dashboard || current.dashboard,
      } : current)
      notify(
        result.replayed
          ? `The existing ${result.credential.title} review was reopened. No certificate was issued or renewed.`
          : `${result.credential.title} evidence was retained for approval. It does not satisfy job readiness until verified.`,
      )
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openQualificationRequirementEditor() {
    qualificationDialogOpenerRef.current = document.activeElement
    const firstJob = (data?.jobs || EMPTY_LIST).find((job) => !['archived', 'cancelled', 'rejected'].includes(job.status)) || null
    setQualificationRequirementDraft(emptyQualificationRequirementDraft(firstJob))
    setQualificationRequirementEditor(true)
  }

  function closeQualificationRequirementEditor() {
    if (submitting) return
    const opener = qualificationDialogOpenerRef.current
    qualificationDialogOpenerRef.current = null
    setQualificationRequirementEditor(false)
    setQualificationRequirementDraft(emptyQualificationRequirementDraft())
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus()
    })
  }

  async function submitQualificationRequirement(event) {
    event.preventDefault()
    if (!qualificationRequirementDraft.jobId || !qualificationRequirementDraft.credentialType) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(qualificationRequirementDraft.jobId)}/qualification-requirements`, {
        method: 'POST',
        body: JSON.stringify({
          credentialType: qualificationRequirementDraft.credentialType,
          title: qualificationRequirementDraft.title.trim() || null,
          role: qualificationRequirementDraft.role.trim() || null,
          mandatory: qualificationRequirementDraft.mandatory,
          actor: 'office_operator',
        }),
      })
      setQualificationRequirementEditor(false)
      setQualificationRequirementDraft(emptyQualificationRequirementDraft())
      setData((current) => current ? {
        ...reconcileJobCollections(current, result.job),
        qualificationRegister: result.qualificationRegister || current.qualificationRegister,
        dashboard: result.dashboard || current.dashboard,
      } : current)
      notify(
        result.replayed
          ? `${result.requirement.title} is already enforced for this job and role.`
          : `${result.requirement.title} is now enforced in assignment, dispatch, site-access, and attendance readiness.`,
      )
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openQualificationRequirementRetirement(requirement) {
    qualificationDialogOpenerRef.current = document.activeElement
    setQualificationRequirementRetirement(requirement)
    setQualificationRequirementRetirementReason('')
  }

  function closeQualificationRequirementRetirement() {
    if (submitting) return
    const opener = qualificationDialogOpenerRef.current
    qualificationDialogOpenerRef.current = null
    setQualificationRequirementRetirement(null)
    setQualificationRequirementRetirementReason('')
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus()
    })
  }

  async function requestQualificationRequirementRetirement(event) {
    event.preventDefault()
    if (!qualificationRequirementRetirement || qualificationRequirementRetirementReason.trim().length < 8) return
    setSubmitting(true)
    setError('')
    try {
      const requirement = qualificationRequirementRetirement
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(requirement.jobId)}/qualification-requirements/${encodeURIComponent(requirement.id)}/retirement`, {
        method: 'POST',
        body: JSON.stringify({ reason: qualificationRequirementRetirementReason.trim(), actor: 'office_operator' }),
      })
      setQualificationRequirementRetirement(null)
      setQualificationRequirementRetirementReason('')
      setData((current) => current ? {
        ...reconcileJobCollections(current, result.job),
        qualificationRegister: result.qualificationRegister || current.qualificationRegister,
        dashboard: result.dashboard || current.dashboard,
      } : current)
      notify(`Removal approval requested for ${result.requirement.title}. The requirement remains enforced until approval.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openAvailabilityEditor(worker = null) {
    availabilityDialogOpenerRef.current = document.activeElement
    const firstWorker = worker || (data?.workers || EMPTY_LIST).find((item) => item.status !== 'retired') || null
    setAvailabilityDraft(emptyWorkerAvailabilityDraft(firstWorker))
    setAvailabilityEditor(true)
  }

  function closeAvailabilityEditor() {
    if (submitting) return
    const opener = availabilityDialogOpenerRef.current
    availabilityDialogOpenerRef.current = null
    setAvailabilityEditor(false)
    setAvailabilityDraft(emptyWorkerAvailabilityDraft())
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus()
    })
  }

  async function submitWorkerAvailability(event) {
    event.preventDefault()
    if (!availabilityDraft.workerId || !availabilityDraft.startsAt || !availabilityDraft.endsAt) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/workers/${encodeURIComponent(availabilityDraft.workerId)}/availability`, {
        method: 'POST',
        body: JSON.stringify({
          periodType: availabilityDraft.periodType,
          title: availabilityDraft.title.trim() || null,
          startsAt: availabilityDraft.startsAt,
          endsAt: availabilityDraft.endsAt,
          notes: availabilityDraft.notes.trim() || null,
          actor: 'office_operator',
        }),
      })
      setAvailabilityEditor(false)
      setAvailabilityDraft(emptyWorkerAvailabilityDraft())
      setData((current) => current ? {
        ...current,
        workers: result.worker ? upsertById(current.workers, result.worker) : current.workers,
        availabilityRegister: result.availabilityRegister || current.availabilityRegister,
        dashboard: result.dashboard || current.dashboard,
      } : current)
      const conflictCount = result.conflicts?.length || 0
      notify(
        result.replayed
          ? `${result.period.title} already exists with the same retained window.`
          : `${result.period.title} now blocks overlapping scheduling${conflictCount ? ` and exposes ${conflictCount} assignment conflict${conflictCount === 1 ? '' : 's'}` : ''}.`,
      )
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openAvailabilityCancellation(period) {
    availabilityDialogOpenerRef.current = document.activeElement
    setAvailabilityCancellation(period)
    setAvailabilityCancellationReason('')
  }

  function closeAvailabilityCancellation() {
    if (submitting) return
    const opener = availabilityDialogOpenerRef.current
    availabilityDialogOpenerRef.current = null
    setAvailabilityCancellation(null)
    setAvailabilityCancellationReason('')
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus()
    })
  }

  async function requestAvailabilityCancellation(event) {
    event.preventDefault()
    if (!availabilityCancellation || availabilityCancellationReason.trim().length < 8) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/workers/${encodeURIComponent(availabilityCancellation.workerId)}/availability/${encodeURIComponent(availabilityCancellation.id)}/cancellation`, {
        method: 'POST',
        body: JSON.stringify({ reason: availabilityCancellationReason.trim(), actor: 'office_operator' }),
      })
      setAvailabilityCancellation(null)
      setAvailabilityCancellationReason('')
      setData((current) => current ? {
        ...current,
        workers: result.worker ? upsertById(current.workers, result.worker) : current.workers,
        availabilityRegister: result.availabilityRegister || current.availabilityRegister,
        dashboard: result.dashboard || current.dashboard,
      } : current)
      notify(`Cancellation approval requested for ${result.period.title}. The scheduling block remains active until approval.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openMaterialReceiptEditor(plan = null) {
    setMaterialReceiptDraft(emptyMaterialReceiptDraft(plan))
    setMaterialReceiptEditor(true)
  }

  function closeMaterialReceiptEditor() {
    if (submitting) return
    setMaterialReceiptEditor(false)
    setMaterialReceiptDraft(emptyMaterialReceiptDraft())
  }

  async function saveMaterialReceipt(event) {
    event.preventDefault()
    const lines = materialReceiptDraft.lines.map((line) => ({
      lineKey: line.lineKey || undefined,
      materialRequirementId: line.materialRequirementId || undefined,
      itemName: line.itemName.trim(),
      unit: line.unit.trim() || 'unit',
      receivedQuantity: Number(line.receivedQuantity),
      acceptedQuantity: Number(line.acceptedQuantity),
      damagedQuantity: Number(line.damagedQuantity || 0),
      notes: line.notes.trim() || null,
    }))
    const invalidLine = lines.find((line) => line.itemName.length < 2 || !(line.receivedQuantity > 0) || line.acceptedQuantity < 0
      || line.damagedQuantity < 0 || line.acceptedQuantity + line.damagedQuantity > line.receivedQuantity)
    if (!materialReceiptDraft.jobId || materialReceiptDraft.receiptReference.trim().length < 3
      || materialReceiptDraft.evidenceReference.trim().length < 3 || materialReceiptDraft.receivedBy.trim().length < 2 || invalidLine) {
      setError('Record the job, delivery reference, retained evidence, receiver, and a valid quantity breakdown for every line.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(materialReceiptDraft.jobId)}/material-receipts?compact=true`, {
        method: 'POST',
        body: JSON.stringify({
          entryKey: materialReceiptDraft.entryKey,
          purchaseOrderId: materialReceiptDraft.purchaseOrderId || null,
          receiptReference: materialReceiptDraft.receiptReference.trim(),
          evidenceReference: materialReceiptDraft.evidenceReference.trim(),
          deliveredAt: toIsoDateTime(materialReceiptDraft.deliveredAt),
          receivedBy: materialReceiptDraft.receivedBy.trim(),
          location: materialReceiptDraft.location.trim() || null,
          finalDelivery: materialReceiptDraft.finalDelivery,
          notes: materialReceiptDraft.notes.trim() || null,
          lines,
          actor: 'office_operator',
        }),
      })
      setMaterialReceiptEditor(false)
      setMaterialReceiptDraft(emptyMaterialReceiptDraft())
      setData((current) => {
        if (!current) return current
        const materialReceiving = current.materialReceiving || { receipts: [], purchaseOrders: [], actions: [], summary: {} }
        const receipts = [
          result.receipt,
          ...(materialReceiving.receipts || []).filter((receipt) => receipt.id !== result.receipt.id),
        ]
        return {
          ...current,
          materialReceiving: {
            ...materialReceiving,
            receipts,
            summary: {
              ...materialReceiving.summary,
              total: receipts.length,
              received: receipts.filter((receipt) => receipt.status === 'received').length,
              discrepancies: receipts.filter((receipt) => receipt.status === 'discrepancy').length,
              pendingReversal: receipts.filter((receipt) => receipt.status === 'pending_reversal').length,
            },
          },
        }
      })
      notify(result.replayed ? 'The matching delivery ticket was already retained; no duplicate was created.' : `Delivery ${result.receipt.receiptReference} retained as ${formatStatus(result.receipt.status)}.`)
      void refreshSection('resources', 'receiving')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openMaterialReceiptReversal(receipt) {
    setMaterialReceiptReversal(receipt)
    setMaterialReceiptReversalReason('')
  }

  async function requestMaterialReceiptReversal(event) {
    event.preventDefault()
    if (!materialReceiptReversal || materialReceiptReversalReason.trim().length < 8) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(materialReceiptReversal.jobId)}/material-receipts/${encodeURIComponent(materialReceiptReversal.id)}/reversal`, {
        method: 'POST',
        body: JSON.stringify({ reason: materialReceiptReversalReason.trim(), actor: 'office_operator' }),
      })
      setMaterialReceiptReversal(null)
      setMaterialReceiptReversalReason('')
      setData((current) => current ? { ...current, materialReceiving: result.materialReceiving || current.materialReceiving, dashboard: result.dashboard || current.dashboard } : current)
      notify('Receipt reversal approval requested. Accepted quantities remain active until an approver resolves it.')
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
    sectionRef.current = 'resources'
    setSection('resources')
    selectResourceView('partners')
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
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/site-access?compact=true`
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
      let successMessage = ''
      if (type === 'complete_worker_orientation') {
        successMessage = 'Orientation completion evidence retained for approval. Site access remains blocked until review.'
      } else if (type === 'prepare_site_access') {
        successMessage = 'The assignment-scoped site-access gate was retained. Clearance still requires explicit approval.'
      } else if (type === 'request_procurement_approval') {
        successMessage = `Procurement approval requested for ${currency.format(result.procurementOrder?.amount || 0)}. No supplier order or spend commitment was made.`
      } else if (type === 'record_time_log') {
        successMessage = 'Worker time was recorded in the retained job ledger.'
      } else {
        successMessage = `${formatStatus(result.materialRequirement?.status)} material evidence retained. No supplier order or spend commitment was made.`
      }
      closeResourceControl()
      const originatingSection = sectionRef.current
      await refreshSection(
        originatingSection === 'dispatch' ? 'dispatch' : 'resources',
        resourceViewRef.current,
      )
      notify(successMessage)
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

  async function prepareFinancePackage(item, action) {
    const creditNotePackage = action?.type === 'prepare_credit_note_package'
    const purchaseOrderPackage = action?.type === 'prepare_purchase_order_package'
    const sourceId = purchaseOrderPackage ? action?.purchaseOrderId : creditNotePackage ? action?.creditNoteId : action?.invoiceId
    const sourceLabel = purchaseOrderPackage ? 'purchase order' : creditNotePackage ? 'credit note' : 'invoice'
    if (!item?.jobId || !sourceId) {
      setError(`The approved ${sourceLabel} is not linked to a retained finance row.`)
      return
    }
    setSubmitting(true)
    try {
      const route = purchaseOrderPackage
        ? `/api/ledger/jobs/${encodeURIComponent(item.jobId)}/purchase-orders/${encodeURIComponent(action.purchaseOrderId)}/issue-package`
        : creditNotePackage
          ? `/api/ledger/jobs/${encodeURIComponent(item.jobId)}/credit-notes/${encodeURIComponent(action.creditNoteId)}/issue-package`
          : `/api/ledger/jobs/${encodeURIComponent(item.jobId)}/invoices/${encodeURIComponent(action.invoiceId)}/issue-package`
      const result = await api(route, {
        method: 'POST',
        body: JSON.stringify({
          actor: 'office_operator',
          ...(purchaseOrderPackage ? { recipient: action.recipient || undefined, channel: 'email' } : {}),
        }),
      })
      if (purchaseOrderPackage) {
        notify(
          `Purchase order ${result.issueReference} retained with HTML and generic OASIS UBL 2.1 attachments. Transmission still requires approval and a verified provider receipt.`,
        )
      } else {
        notify(
          `${creditNotePackage ? 'Credit note' : 'Invoice'} ${result.issueReference} retained with ${result.structuredExportIncluded ? 'HTML and UBL attachments' : 'a human-readable attachment'}. ${creditNotePackage ? 'The receivable was adjusted; delivery' : 'Delivery'} still requires approval and a verified receipt.`,
        )
      }
      await refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openEquipmentCheckout() {
    equipmentDialogOpenerRef.current = document.activeElement
    setEquipmentCheckoutEditor(true)
    setEquipmentCheckoutDraft(emptyEquipmentCheckoutDraft())
    setEquipmentCheckoutPlans([])
  }

  function closeEquipmentCheckout() {
    if (submitting) return
    const opener = equipmentDialogOpenerRef.current
    equipmentDialogOpenerRef.current = null
    setEquipmentCheckoutEditor(false)
    setEquipmentCheckoutDraft(emptyEquipmentCheckoutDraft())
    setEquipmentCheckoutPlans([])
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus()
    })
  }

  async function selectEquipmentCheckoutJob(jobId) {
    const initial = { ...emptyEquipmentCheckoutDraft(), jobId }
    setEquipmentCheckoutDraft(initial)
    setEquipmentCheckoutPlans([])
    if (!jobId) return
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/equipment-custody-plan`)
      const plans = result.plans || []
      setEquipmentCheckoutPlans(plans)
      const firstReady = plans.find(plan => plan.checkoutReady)
      if (firstReady) {
        setEquipmentCheckoutDraft({
          ...emptyEquipmentCheckoutDraft(firstReady),
          jobId,
          location: firstReady.tool?.currentLocation || '',
        })
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function selectEquipmentCheckoutPlan(reservationId) {
    const plan = equipmentCheckoutPlans.find(item => item.reservation?.id === reservationId)
    if (!plan) {
      setEquipmentCheckoutDraft({ ...emptyEquipmentCheckoutDraft(), jobId: equipmentCheckoutDraft.jobId })
      return
    }
    setEquipmentCheckoutDraft({
      ...emptyEquipmentCheckoutDraft(plan),
      jobId: equipmentCheckoutDraft.jobId,
      location: plan.tool?.currentLocation || '',
    })
  }

  async function saveEquipmentCheckout(event) {
    event.preventDefault()
    const meter = equipmentCheckoutDraft.meter === '' ? null : Number(equipmentCheckoutDraft.meter)
    if (!equipmentCheckoutDraft.jobId || !equipmentCheckoutDraft.reservationId || equipmentCheckoutDraft.checkedOutBy.trim().length < 2
      || equipmentCheckoutDraft.evidenceReference.trim().length < 3 || (meter !== null && (!Number.isFinite(meter) || meter < 0))) {
      setError('Choose a checkout-ready reservation and retain the custodian, handoff evidence, and a valid meter value.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(equipmentCheckoutDraft.jobId)}/equipment-custody/check-out`, {
        method: 'POST',
        body: JSON.stringify({
          reservationId: equipmentCheckoutDraft.reservationId,
          checkedOutAt: toIsoDateTime(equipmentCheckoutDraft.checkedOutAt),
          dueBackAt: equipmentCheckoutDraft.dueBackAt ? toIsoDateTime(equipmentCheckoutDraft.dueBackAt) : null,
          checkedOutBy: equipmentCheckoutDraft.checkedOutBy.trim(),
          condition: equipmentCheckoutDraft.condition,
          location: equipmentCheckoutDraft.location.trim() || null,
          meter,
          evidenceReference: equipmentCheckoutDraft.evidenceReference.trim(),
          entryKey: equipmentCheckoutDraft.entryKey,
          notes: equipmentCheckoutDraft.notes.trim() || null,
          actor: 'office_operator',
        }),
      })
      setEquipmentCheckoutEditor(false)
      setEquipmentCheckoutDraft(emptyEquipmentCheckoutDraft())
      setEquipmentCheckoutPlans([])
      setData((current) => current ? {
        ...current,
        equipmentCustody: result.equipmentCustody || current.equipmentCustody,
        dashboard: result.dashboard || current.dashboard,
      } : current)
      notify(result.replayed
        ? 'This equipment handoff was already retained; no duplicate custody session was created.'
        : `${result.custody.toolName} checked out to ${result.custody.checkedOutBy}.`)
      await refreshSection('resources', 'equipment')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openEquipmentReturn(session) {
    equipmentDialogOpenerRef.current = document.activeElement
    setEquipmentReturnEditor(session)
    setEquipmentReturnDraft(emptyEquipmentReturnDraft(session))
  }

  function closeEquipmentReturn() {
    if (submitting) return
    const opener = equipmentDialogOpenerRef.current
    equipmentDialogOpenerRef.current = null
    setEquipmentReturnEditor(null)
    setEquipmentReturnDraft(emptyEquipmentReturnDraft())
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus()
    })
  }

  async function saveEquipmentReturn(event) {
    event.preventDefault()
    const meter = equipmentReturnDraft.meter === '' ? null : Number(equipmentReturnDraft.meter)
    const exceptional = ['damaged', 'unsafe', 'lost'].includes(equipmentReturnDraft.condition)
    if (!equipmentReturnEditor || equipmentReturnDraft.returnedBy.trim().length < 2
      || equipmentReturnDraft.evidenceReference.trim().length < 3 || (meter !== null && (!Number.isFinite(meter) || meter < 0))
      || (exceptional && equipmentReturnDraft.notes.trim().length < 8)) {
      setError('Retain the returning person, condition evidence, a valid meter, and findings for damaged, unsafe, or lost equipment.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(equipmentReturnDraft.jobId)}/equipment-custody/${encodeURIComponent(equipmentReturnDraft.custodySessionId)}/return`, {
        method: 'POST',
        body: JSON.stringify({
          returnedAt: toIsoDateTime(equipmentReturnDraft.returnedAt),
          returnedBy: equipmentReturnDraft.returnedBy.trim(),
          condition: equipmentReturnDraft.condition,
          location: equipmentReturnDraft.location.trim() || null,
          meter,
          evidenceReference: equipmentReturnDraft.evidenceReference.trim(),
          entryKey: equipmentReturnDraft.entryKey,
          notes: equipmentReturnDraft.notes.trim() || null,
          actor: 'office_operator',
        }),
      })
      setEquipmentReturnEditor(null)
      setEquipmentReturnDraft(emptyEquipmentReturnDraft())
      setData((current) => current ? {
        ...current,
        equipmentCustody: result.equipmentCustody || current.equipmentCustody,
        dashboard: result.dashboard || current.dashboard,
      } : current)
      notify(result.replayed
        ? 'This equipment return was already retained; no duplicate evidence was created.'
        : exceptional
          ? `${result.custody.toolName} returned as ${formatStatus(result.custody.returnCondition)} and moved to quarantine review.`
          : `${result.custody.toolName} returned and released for availability.`)
      await refreshSection('resources', 'equipment')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function requestCostForecastSnapshot(item) {
    if (!item?.jobId) {
      setError('The cost forecast is not linked to a retained job.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(item.jobId)}/cost-forecast/snapshots`, {
        method: 'POST',
        body: JSON.stringify({ actor: 'office_operator' }),
      })
      notify(
        result.replayed
          ? `Cost forecast ${result.snapshot?.forecastNumber || ''} is already awaiting approval.`
          : `Cost forecast ${result.snapshot?.forecastNumber || ''} retained from the current cost-code evidence. Approval is required before it becomes the active forecast.`,
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
    if (action.type === 'record_purchase_order_delivery') {
      if (!action.communicationId || !action.purchaseOrderId) {
        setError('The approved purchase-order delivery is missing its retained communication link.')
        return
      }
      setFinanceOrderDelivery({ item, action })
      setFinanceOrderDeliveryDraft(emptyBidOrderDeliveryDraft())
      return
    }
    if (action.type === 'prepare_cost_forecast') {
      void requestCostForecastSnapshot(item)
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
    const suggestedMaterialReceipt = action.type === 'record_supplier_invoice'
      ? (action.materialReceipts || []).find((receipt) => receipt.status === 'received') || null
      : null
    const amount =
      action.type === 'request_expense_reversal'
        ? Number(action.totalAmount || action.amount || 0)
        : action.type === 'create_credit_note'
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
      dueAt: action.dueAt
        ? String(action.dueAt).slice(0, 10)
        : futureDateInput(action.type === 'record_time_expense' ? 0 : action.type === 'create_billing_milestone' ? 37 : 7),
      reference: action.type === 'request_expense_reversal' ? action.receiptReference || '' : '',
      vendor: action.type === 'request_expense_reversal'
        ? action.vendor || item.latest?.expense?.vendor || ''
        : action.supplier || item.latest?.purchaseOrder?.supplier || '',
      materialReceiptId: suggestedMaterialReceipt?.id || '',
      deliveryReference: suggestedMaterialReceipt?.receiptReference || '',
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

  function closeFinanceOrderDelivery() {
    setFinanceOrderDelivery(null)
    setFinanceOrderDeliveryDraft(emptyBidOrderDeliveryDraft())
  }

  async function submitFinanceOrderDelivery(event) {
    event.preventDefault()
    const communicationId = financeOrderDelivery?.action?.communicationId
    if (
      !communicationId ||
      !financeOrderDeliveryDraft.integration.trim() ||
      !financeOrderDeliveryDraft.providerMessageId.trim() ||
      !financeOrderDeliveryDraft.sentAt
    ) {
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/communications/${encodeURIComponent(communicationId)}/delivery-receipt`, {
        method: 'POST',
        body: JSON.stringify({
          integration: financeOrderDeliveryDraft.integration.trim(),
          providerMessageId: financeOrderDeliveryDraft.providerMessageId.trim(),
          sentAt: toIsoDateTime(financeOrderDeliveryDraft.sentAt),
        }),
      })
      setData((current) => {
        if (!current) return current
        const next = {
          ...current,
          dashboard: result.dashboard || current.dashboard,
          finance: result.finance || current.finance,
        }
        return result.job ? reconcileJobCollections(next, result.job) : next
      })
      if (result.job && selectedJobId === result.job.id) setSelectedJob(result.job)
      notify(
        `Verified provider receipt retained for ${financeOrderDelivery.action.issueReference || 'the purchase order'}. The order is now an external commitment; no payment was initiated.`,
      )
      closeFinanceOrderDelivery()
      await refreshSection('finance')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
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
    if (type === 'request_expense_reversal') {
      if (!financeAction.action.expenseId || notes.length < 8) {
        setError('Record at least eight characters explaining the corrected bookkeeping evidence for this reversal.')
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/expense-receipts/${encodeURIComponent(financeAction.action.expenseId)}/reversal`
      body = { reason: notes }
    } else if (type === 'create_credit_note') {
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
        (!financeActionDraft.materialReceiptId && !deliveryReference)
      ) {
        setError('Record the supplier, invoice number, positive net amount, VAT, invoice and due dates, and retained receipt or service evidence.')
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
        materialReceiptId: financeActionDraft.materialReceiptId || null,
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
      const selectedWorker = workers.find((worker) => worker.id === financeActionDraft.workerId) || null
      if (
        !(financeControlHours > 0 || financeControlExpense > 0) ||
        financeControlHours > 24 ||
        financeControlRate < 0 ||
        financeControlExpense < 0 ||
        (financeControlHours > 0 && !selectedWorker)
      ) {
        setError('Record positive hours or a positive expense. Labor also requires an active worker; hours cannot exceed 24 and the rate cannot be negative.')
        return
      }
      if (financeControlExpense > 0 && !vendor) {
        setError('Record the vendor for retained expense evidence.')
        return
      }
      const expenseTax = Number(financeActionDraft.taxAmount || 0)
      if (
        financeControlExpense > 0 && (
          !reference ||
          !Number.isFinite(expenseTax) ||
          expenseTax < 0 ||
          expenseTax > financeControlExpense ||
          (['exempt', 'reverse_charge'].includes(financeActionDraft.taxTreatment) && expenseTax !== 0)
        )
      ) {
        setError('Expense evidence requires a receipt reference and a VAT amount and treatment that reconcile to the gross total.')
        return
      }
      route = `/api/ledger/jobs/${encodeURIComponent(jobId)}/finance-costs`
      body = {
        timeLog:
          financeControlHours > 0
            ? {
                workerId: selectedWorker.id,
                workerName: selectedWorker.name,
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
                totalAmount: roundMoney(financeControlExpense),
                taxAmount: roundMoney(expenseTax),
                taxTreatment: financeActionDraft.taxTreatment,
                paymentMethod: financeActionDraft.paymentMethod,
                expenseDate: financeActionDraft.dueAt,
                entryKey: financeActionDraft.entryKey,
                vendor,
                receiptReference: reference,
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
      const plannedIssueAt = new Date(`${financeActionDraft.plannedIssueAt}T00:00:00`).toISOString()
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
      const financePatch = await loadSectionPatch('finance', resourceViewRef.current, fieldScoped)
      setData((current) => {
        if (!current) return current
        const next = {
          ...current,
          ...financePatch,
          dashboard: result.dashboard || current.dashboard,
        }
        return result.job ? reconcileJobCollections(next, result.job) : next
      })
      if (type === 'request_expense_reversal') {
        notify(`Expense ${result.expense?.receiptReference || reference || ''} is pending reversal approval. The original evidence remains retained and no funds moved.`)
      } else if (type === 'create_credit_note') {
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
        notify(
          result.costs?.expense
            ? 'Time was retained and the expense receipt is pending source review. No reimbursement, payment, or export was initiated.'
            : 'Time evidence was retained in the job ledger.',
        )
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
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function openClientEditor(client = null) {
    if (!canCoordinate) return
    setClientEditor({ mode: client ? 'edit' : 'create', client })
    setClientDraft(emptyClientDraft(client))
  }

  function closeClientEditor() {
    setClientEditor(null)
    setClientDraft(emptyClientDraft())
  }

  async function submitClientEditor(event) {
    event.preventDefault()
    if (!canCoordinate || !clientEditor) return
    setSubmitting(true)
    setError('')
    try {
      const { id, ...payload } = clientDraft
      const route = id ? `/api/ledger/clients/${encodeURIComponent(id)}` : '/api/ledger/clients'
      const result = await api(route, {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      const patch = await loadSectionPatch('clients', resourceViewRef.current, fieldScoped)
      setData((current) => current ? {
        ...current,
        ...patch,
        jobs: (current.jobs || EMPTY_LIST).map((job) => job.clientId === result.client.id
          ? {
              ...job,
              clientName: result.client.name,
              clientEmail: result.client.email,
              clientPhone: result.client.phone,
            }
          : job),
      } : current)
      notify(id
        ? 'Client identity updated in the ledger. Existing commercial snapshots remain immutable.'
        : 'Client identity retained. No message, project, quote, or invoice was created.')
      closeClientEditor()
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

  function openJobCloseoutLifecycle(type, record) {
    if (!selectedJob?.id || !record?.id || !['punch_item', 'warranty_claim', 'aftercare'].includes(type)) {
      setError('The closeout action is not linked to a retained job record.')
      return
    }
    openClientLifecycle({
      jobId: selectedJob.id,
      jobTitle: selectedJob.title,
      clientName: selectedJob.clientName,
      latest: {
        punchItem: type === 'punch_item' ? record : null,
        warrantyClaim: type === 'warranty_claim' ? record : null,
        aftercare: type === 'aftercare' ? record : null,
      },
    }, type, record.id)
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
      if (result.job?.id === selectedJobId) {
        setSelectedJob(result.job)
        setData((current) => current ? reconcileJobCollections({ ...current, dashboard: result.dashboard || current.dashboard }, result.job) : current)
      }
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
    sectionRef.current = 'resources'
    setSection('resources')
    selectResourceView('equipment')
  }

  function reviewDispatchWorkforce() {
    sectionRef.current = 'resources'
    setSection('resources')
    selectResourceView('workforce')
  }

  async function loadCrewCapacityWindow(referenceDate) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/crew-capacity?referenceDate=${encodeURIComponent(referenceDate)}`)
      setData((current) => current ? { ...current, crewCapacity: result.board || current.crewCapacity } : current)
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function saveCrewCapacityProfile(workerId, payload) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/workers/${encodeURIComponent(workerId)}/capacity-profile`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      setData((current) => current ? { ...current, crewCapacity: result.board || current.crewCapacity } : current)
      notify(result.unchanged ? 'The current capacity profile already retains these hours.' : 'Versioned crew capacity profile retained. Existing approved plans now show stale when their source changed.')
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function createCrewCapacityAllocation(payload) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api('/api/ledger/crew-capacity/allocations', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setData((current) => current ? { ...current, crewCapacity: result.board || current.crewCapacity } : current)
      notify(result.replayed ? 'The exact crew allocation was already retained.' : 'Day-level crew allocation retained without notifications or external commitments.')
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelCrewCapacityAllocation(allocationId, payload) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/crew-capacity/allocations/${encodeURIComponent(allocationId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setData((current) => current ? { ...current, crewCapacity: result.board || current.crewCapacity } : current)
      notify(result.replayed ? 'This crew allocation was already cancelled.' : 'Crew allocation cancelled with retained reason evidence.')
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function requestCrewLookaheadApproval(referenceDate) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api('/api/ledger/crew-lookahead/plans', {
        method: 'POST',
        body: JSON.stringify({
          referenceDate,
          reason: 'Capacity, availability, assignment, task coverage, and schedule evidence reviewed in the two-week board.',
        }),
      })
      setData((current) => current ? {
        ...current,
        crewCapacity: result.board || current.crewCapacity,
        approvals: result.approval ? upsertById(current.approvals, result.approval) : current.approvals,
      } : current)
      notify(result.replayed ? 'The source-current crew plan is already waiting for approval.' : 'Immutable two-week crew plan sent to the internal approval queue. No notifications or commitments were made.')
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  function reviewCrewLookaheadApproval(plan) {
    if (!plan?.approvalId) {
      setError('The retained crew plan is not linked to an approval decision.')
      return
    }
    openApprovals({ approvalId: plan.approvalId, jobTitle: `Crew look-ahead v${plan.versionNumber}` })
  }

  function openCrewCapacityJob(jobId) {
    const job = jobs.find((candidate) => candidate.id === jobId)
    if (!job) {
      setError('The crew-planning record is not linked to an active job in this view.')
      return
    }
    openJobWorkspace(job)
  }

  async function loadLastPlannerWeek(weekStart) {
    const sequence = ++sectionLoadSequenceRef.current
    setSectionLoading(false)
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/last-planner?weekStart=${encodeURIComponent(weekStart)}`)
      if (sequence !== sectionLoadSequenceRef.current || sectionRef.current !== 'schedule') return false
      if (result.board?.week?.weekStart) lastPlannerWeekRef.current = result.board.week.weekStart
      setData((current) => current ? { ...current, lastPlanner: result.board || current.lastPlanner } : current)
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function createLastPlannerConstraint(jobId, payload) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/last-planner/constraints`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setData((current) => current ? { ...current, lastPlanner: result.board || current.lastPlanner } : current)
      notify(result.replayed ? 'The exact make-ready constraint was already retained.' : 'Make-ready constraint retained without changing the schedule or creating external commitments.')
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function releaseLastPlannerConstraint(jobId, constraintId, payload) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/last-planner/constraints/${encodeURIComponent(constraintId)}/release`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setData((current) => current ? { ...current, lastPlanner: result.board || current.lastPlanner } : current)
      notify(result.replayed ? 'This make-ready release was already retained.' : 'Constraint released against retained evidence. No permit or compliance claim was created.')
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function requestLastPlannerPlan(jobId, payload) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/last-planner/plans`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setData((current) => current ? {
        ...current,
        lastPlanner: result.board || current.lastPlanner,
        approvals: result.approval ? upsertById(current.approvals, result.approval) : current.approvals,
      } : current)
      notify(result.replayed ? 'The exact weekly plan is already waiting for review.' : 'Immutable weekly promises sent to the internal approval queue. No schedule or external commitment was changed.')
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  function reviewLastPlannerApproval(plan) {
    if (!plan?.approvalId) {
      setError('The retained weekly plan is not linked to an approval decision.')
      return
    }
    openApprovals({ approvalId: plan.approvalId, jobTitle: `${plan.jobTitle || 'Weekly plan'} / ${formatDate(plan.weekStart)}` })
  }

  async function recordLastPlannerOutcome(jobId, planId, commitmentId, payload) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api(`/api/ledger/jobs/${encodeURIComponent(jobId)}/last-planner/plans/${encodeURIComponent(planId)}/commitments/${encodeURIComponent(commitmentId)}/outcome`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setData((current) => current ? { ...current, lastPlanner: result.board || current.lastPlanner } : current)
      notify(result.replayed ? 'The exact weekly outcome was already retained.' : 'Weekly outcome retained against closed daily-cycle evidence and included in PPC.')
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setSubmitting(false)
    }
  }

  function reviewPortfolioDispatch() {
    sectionRef.current = 'dispatch'
    setSection('dispatch')
    setMobileNavOpen(false)
    void refreshSection('dispatch')
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

  async function loadQaResetPreview() {
    const requestId = ++qaResetPreviewRequestRef.current
    setQaResetError('')
    setQaResetDialog((current) => ({ ...(current || {}), loading: true }))
    try {
      const preview = await api('/api/operations/reset-qa/preview')
      if (requestId !== qaResetPreviewRequestRef.current) return null
      setQaResetDialog({ loading: false, plan: preview })
      return preview
    } catch (requestError) {
      if (requestId !== qaResetPreviewRequestRef.current) return null
      setQaResetDialog((current) => ({ ...(current || {}), loading: false, plan: null }))
      setQaResetError(requestError.message)
      return null
    }
  }

  async function openQaResetDialog(opener) {
    qaResetOpenerRef.current = opener || document.activeElement
    setQaResetError('')
    setQaResetDialog({ loading: true, plan: null })
    await loadQaResetPreview()
  }

  function closeQaResetDialog() {
    if (submitting) return
    qaResetPreviewRequestRef.current += 1
    setQaResetDialog(null)
    setQaResetError('')
    window.setTimeout(() => qaResetOpenerRef.current?.focus(), 0)
  }

  async function resetQa({ reason, planHash }) {
    setSubmitting(true)
    setQaResetError('')
    try {
      const result = await api('/api/operations/reset-qa', {
        method: 'POST',
        body: JSON.stringify({ confirmation: 'RESET_QA', planHash, reason }),
      })
      notify(`${result.archivedCount} QA/demo record(s) archived or retired after backup ${result.backup?.backupId || 'verification'}.`)
      qaResetPreviewRequestRef.current += 1
      setQaResetDialog(null)
      await refresh()
      window.setTimeout(() => qaResetOpenerRef.current?.focus(), 0)
      return true
    } catch (requestError) {
      if (requestError.code === 'qa_reset_plan_changed') {
        const refreshed = await loadQaResetPreview()
        setQaResetError(
          refreshed
            ? `${requestError.message} The preview is current now; review it and confirm again.`
            : requestError.message,
        )
      } else {
        setQaResetError(requestError.message)
      }
      return false
    } finally {
      setSubmitting(false)
    }
  }

  if (authState === 'checking' || authState === 'required') {
    return (
      <AuthenticationScreen checking={authState === 'checking'} error={authError} submitting={authSubmitting} onLogin={loginOperator} />
    )
  }

  const pageTitle = visibleNavItems.find(([key]) => key === section)?.[1] || appText(operatorLocale, 'nav.today')

  return (
    <div className="app-shell">
      <aside
        className={`side-nav ${mobileNavOpen ? 'side-nav-open' : ''}`}
        aria-label={appText(operatorLocale, 'shell.primaryNavigation')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setMobileNavOpen(false)
        }}
      >
        <div className="brand">
          <span className="brand-mark">
            <HardHat size={18} />
          </span>
          <span>Contractor.AI</span>
          <button
            type="button"
            className="nav-close mobile-only"
            aria-label={appText(operatorLocale, 'shell.closeNavigation')}
            onClick={() => setMobileNavOpen(false)}
          >
            <X size={19} />
          </button>
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
          <span>{networkOnline ? appText(operatorLocale, 'shell.localLedger') : appText(operatorLocale, 'shell.offlineLedger')}</span>
          <small>{appText(operatorLocale, 'shell.approvalNotice')}</small>
        </div>
      </aside>

      <main
        className="workspace"
        aria-busy={loading || sectionLoading}
        inert={loading || sectionLoading ? true : undefined}
      >
        <header className="topbar">
          <button className="icon-button mobile-only" aria-label={appText(operatorLocale, 'shell.openNavigation')} onClick={() => setMobileNavOpen(true)}>
            <Menu size={20} />
          </button>
          <div>
            <h1>{pageTitle}</h1>
            <p>
              {dashboard
                ? appText(operatorLocale, 'shell.activeSummary', { jobs: metrics.openJobs || 0, approvals: metrics.pendingApprovals || 0 })
                : appText(operatorLocale, 'shell.loadingLedger')}
            </p>
          </div>
          <div className="topbar-actions">
            <span className="sync-state">
              <CloudOff size={15} />
              {networkOnline
                ? (fieldScoped ? appText(operatorLocale, 'shell.fieldScope') : appText(operatorLocale, 'shell.localFirst'))
                : appText(operatorLocale, 'shell.offlineQueue')}
            </span>
            <label className="locale-select">
              <span className="visually-hidden">{appText(operatorLocale, 'shell.language')}</span>
              <select
                aria-label={appText(operatorLocale, 'shell.language')}
                value={operatorLocale}
                disabled={localeSaving}
                onChange={(event) => updateOperatorLocale(event.target.value)}
              >
                {SUPPORTED_LOCALES.map((option) => <option key={option.value} value={option.value}>{option.shortLabel}</option>)}
              </select>
            </label>
            {operator.authenticated ? (
              <span className="operator-session" title={formatStatus(operator.role)}>
                <ShieldCheck size={14} />
                <span>{operator.name || formatStatus(operator.role)}</span>
              </span>
            ) : null}
            <button className="icon-button" aria-label={appText(operatorLocale, 'shell.refresh')} onClick={refreshCurrentView} disabled={loading || sectionLoading}>
              <RefreshCw size={18} className={loading || sectionLoading ? 'spin' : ''} />
            </button>
            {operator.authenticated ? (
              <button className="icon-button" aria-label={appText(operatorLocale, 'shell.signOut')} title={appText(operatorLocale, 'shell.signOut')} onClick={logoutOperator} disabled={submitting}>
                <LogOut size={17} />
              </button>
            ) : null}
            {capabilities.intake && capabilities.pipeline ? (
              <button className="primary-button" onClick={() => openOpportunityEditor()} disabled={initialDataLoading}>
                <Plus size={17} />
                {appText(operatorLocale, 'shell.newOpportunity')}
              </button>
            ) : null}
          </div>
        </header>

        {notice ? (
          <div className="notice">
            <Check size={16} />
            {notice.message}
            <button aria-label={appText(operatorLocale, 'shell.dismissNotice')} onClick={() => setNotice(null)}>
              <X size={15} />
            </button>
          </div>
        ) : null}
        {error ? (
          <div className="error-banner">
            <TriangleAlert size={18} />
            <span>{error}</span>
            <button onClick={refreshCurrentView}>{appText(operatorLocale, 'shell.retry')}</button>
          </div>
        ) : null}
        {automationSuspended ? (
          <div className="safety-stop-banner" role="alert" data-testid="automation-safety-stop-banner">
            <Ban size={18} />
            <span>
              <strong>Autonomous drafting suspended.</strong> {automationControl.reason} Direct operator work, evidence capture, and
              approvals remain available.
            </span>
            {capabilities.maintenance ? (
              <button
                className="secondary-button"
                disabled={submitting}
                onClick={(event) => openAutomationControlDialog(false, event.currentTarget)}
              >
                Resume
              </button>
            ) : null}
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
            {sectionLoading ? (
              <div className="loading section-loading" role="status">
                <LoaderCircle className="spin" size={26} />
                {appText(operatorLocale, 'shell.loadingPage', { page: pageTitle.toLowerCase() })}
              </div>
            ) : null}
              <>
            {section === 'today' && (
              <section className="page-grid">
                {capabilities.maintenance && data.organization && !data.organization.readiness?.ready ? (
                  <section className="panel first-run-panel" data-testid="first-run-setup">
                    <div>
                      <p className="eyebrow">Owner setup</p>
                      <h2>Complete the business identity</h2>
                      <p>
                        Commercial issue packages stay blocked until {data.organization.readiness.missing.length} required identity
                        item(s) are retained.
                      </p>
                    </div>
                    <button className="primary-button" onClick={openOrganizationOnboarding}>
                      <Building2 size={16} />
                      Finish setup
                    </button>
                  </section>
                ) : null}
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
                                  disabled={loading}
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
                      <button className="secondary-button full-button" disabled={submitting || automationSuspended} onClick={runCycle}>
                        <Activity size={16} />
                        {automationSuspended ? 'Safety stop active' : 'Run due cycle'}
                      </button>
                    </section>
                  ) : null}
                </div>
              </section>
            )}

            {section === 'pipeline' && capabilities.pipeline ? (
              <PipelineWorkspace
                view={pipelineView}
                onViewChange={setPipelineView}
                opportunities={data.opportunities || EMPTY_LIST}
                forecast={data.opportunityForecast}
                marketFit={data.marketFit}
                bidDecisions={data.bidDecisions}
                bidPackages={data.bidPackages || EMPTY_LIST}
                bidSummary={data.bidPackageSummary || {}}
                selectedBidPackage={selectedBidPackage}
                selectedOpportunity={selectedOpportunity}
                canCoordinate={canCoordinate}
                canManagePolicy={canManageMarketFitPolicy}
                canApprove={capabilities.approvals === true}
                submitting={submitting}
                onCreate={() => openOpportunityEditor()}
                onEdit={openOpportunityEditor}
                onSelect={selectOpportunity}
                onFollowUp={openOpportunityActivity}
                onCompleteActivity={completeOpportunityActivity}
                onConvert={convertOpportunity}
                onRequestMarketFitPolicy={requestMarketFitPolicy}
                onRetainMarketFitAssessment={retainMarketFitAssessment}
                onRequestBidDecisionPolicy={requestBidDecisionPolicy}
                onRequestBidDecision={requestBidDecision}
                onPlanSiteSurvey={planOpportunitySiteSurvey}
                onUploadSiteSurveyEvidence={uploadOpportunitySiteSurveyEvidence}
                onSubmitSiteSurvey={submitOpportunitySiteSurvey}
                onReviewSiteSurveyApproval={reviewOpportunitySiteSurveyApproval}
                onOpenJob={openOpportunityJob}
                onCreateBidPackage={openBidPackageEditor}
                onSelectBidPackage={selectBidPackage}
                onAddBidders={openAddBidParticipants}
                onRecordBidReturn={openBidReturn}
                onRequestBidSelection={openBidSelection}
                onReviewBidApproval={reviewBidApproval}
                onPrepareBidCommitment={openBidCommitment}
                onReviewBidCommitment={reviewBidCommitment}
                onPrepareBidOrderPackage={openBidOrderPackage}
                onReviewBidOrderDelivery={reviewBidOrderDelivery}
                onRecordBidOrderDelivery={openBidOrderDelivery}
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
                              disabled={loading || sectionLoading}
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

            {section === 'schedule' && capabilities.schedule ? (
              <>
                <PortfolioScheduleWorkspace
                  schedule={data.schedule}
                  jobs={jobs}
                  canApprove={capabilities.approvals === true}
                  onOpenApprovals={openApprovals}
                  onOpenDispatch={reviewPortfolioDispatch}
                  onOpen={openJobWorkspace}
                />
                <LazyControlBoundary label="crew capacity board">
                  <CrewCapacityBoard
                    board={data.crewCapacity}
                    canApprove={capabilities.approvals === true}
                    submitting={submitting}
                    onLoadWindow={loadCrewCapacityWindow}
                    onSaveProfile={saveCrewCapacityProfile}
                    onCreateAllocation={createCrewCapacityAllocation}
                    onCancelAllocation={cancelCrewCapacityAllocation}
                    onRequestPlan={requestCrewLookaheadApproval}
                    onReviewApproval={reviewCrewLookaheadApproval}
                    onOpenJob={openCrewCapacityJob}
                  />
                </LazyControlBoundary>
                <LazyControlBoundary label="Last Planner weekly control">
                  <LastPlannerBoard
                    board={data.lastPlanner}
                    jobs={data.operatorScopeJobs || jobs}
                    canApprove={capabilities.approvals === true}
                    submitting={submitting}
                    onLoadWeek={loadLastPlannerWeek}
                    onCreateConstraint={createLastPlannerConstraint}
                    onReleaseConstraint={releaseLastPlannerConstraint}
                    onRequestPlan={requestLastPlannerPlan}
                    onReviewApproval={reviewLastPlannerApproval}
                    onRecordOutcome={recordLastPlannerOutcome}
                    onOpenJob={openCrewCapacityJob}
                  />
                </LazyControlBoundary>
              </>
            ) : null}

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
              <LazyControlBoundary label="resource controls">
                <ResourcesWorkspace
                  workforce={data.workforce}
                  inventory={data.inventory}
                  workers={workers}
                  workerSummary={data.workerSummary}
                  qualificationRegister={data.qualificationRegister}
                  availabilityRegister={data.availabilityRegister}
                  materialReceiving={data.materialReceiving}
                  tools={tools}
                  toolSummary={data.toolSummary}
                  equipmentCustody={data.equipmentCustody}
                  fiveS={data.fiveS}
                  tradePartners={tradePartners}
                  tradePartnerSummary={data.tradePartnerSummary}
                  timesheets={data.timesheets}
                  jobs={jobs}
                  view={resourceView}
                  onViewChange={selectResourceView}
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
                  onAddCredential={openCredentialEditor}
                  onCreateQualificationRequirement={openQualificationRequirementEditor}
                  onRetireQualificationRequirement={openQualificationRequirementRetirement}
                  onCreateAvailability={openAvailabilityEditor}
                  onCancelAvailability={openAvailabilityCancellation}
                  onCreateMaterialReceipt={openMaterialReceiptEditor}
                  onReverseMaterialReceipt={openMaterialReceiptReversal}
                  onCreateEquipment={() => openEquipmentEditor()}
                  onEditEquipment={openEquipmentEditor}
                  onInspectEquipment={openEquipmentInspection}
                  onMaintainEquipment={openEquipmentMaintenance}
                  onRetireEquipment={openEquipmentRetirement}
                  onCheckoutEquipment={openEquipmentCheckout}
                  onReturnEquipment={openEquipmentReturn}
                  onCreatePartner={() => openTradePartnerEditor()}
                  onEditPartner={openTradePartnerEditor}
                  onRetirePartner={openTradePartnerRetirement}
                  onTimesheetPeriodChange={loadTimesheetPeriod}
                  onRequestTimesheet={requestWorkerTimesheet}
                  onPrepareTimesheetExport={prepareTimesheetHandoff}
                  onOpenApprovals={openApprovals}
                  onOpen={openJobWorkspace}
                  request={api}
                />
              </LazyControlBoundary>
            ) : null}

            {section === 'finance' && capabilities.finance ? (
              <FinanceWorkspace
                finance={data.finance}
                cashFlow={data.cashFlow}
                jobs={jobs}
                canCoordinate={canCoordinate}
                canApprove={capabilities.approvals === true}
                submitting={submitting}
                onDraftInvoice={openInvoiceDraft}
                onPreparePackage={prepareFinancePackage}
                onAction={openFinanceControl}
                onOpenApprovals={openApprovals}
                onOpen={openJobWorkspace}
                onCashFlowChange={(cashFlow) => setData((current) => ({ ...current, cashFlow }))}
              />
            ) : null}

            {section === 'performance' && capabilities.performance ? (
              <>
                <LazyControlBoundary label="performance scorecard">
                  <PerformanceScorecard
                    scorecard={data.performanceScorecard}
                    request={api}
                    canCoordinate={canCoordinate}
                    locale={operatorLocale}
                    canApprove={capabilities.approvals === true}
                    onChange={(performanceScorecard) => setData((current) => ({ ...current, performanceScorecard }))}
                    onOpenApprovals={openApprovals}
                  />
                </LazyControlBoundary>
                <LazyControlBoundary label="operating frameworks">
                  <FrameworkWorkspace
                    catalog={data.frameworkCatalog}
                    workspace={data.frameworkWorkspace}
                    jobs={jobs}
                    request={api}
                    canCoordinate={canCoordinate}
                    locale={operatorLocale}
                    onChange={(frameworkWorkspace) => setData((current) => ({ ...current, frameworkWorkspace }))}
                  />
                </LazyControlBoundary>
              </>
            ) : null}

            {section === 'clients' && capabilities.clientSuccess ? (
              <LazyControlBoundary label="client controls">
                <ClientsWorkspace
                  clients={data.clients}
                  directory={data.clientDirectory}
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
                  onCreateClient={() => openClientEditor()}
                  onEditClient={openClientEditor}
                />
              </LazyControlBoundary>
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
                  <LazyControlBoundary label="field assurance controls">
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
                  </LazyControlBoundary>
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
                <section className="attendance-control" data-testid="attendance-control">
                  <div className="panel-heading">
                    <div>
                      <h2>Site attendance</h2>
                      <p>Assignment and approved access are checked before presence reaches the labor board.</p>
                    </div>
                    <div className="attendance-summary" aria-label="Attendance summary">
                      <span className="tag tag-green">{attendance.summary?.checkedIn || 0} on site</span>
                      {attendance.summary?.stale ? <span className="tag tag-amber">{attendance.summary.stale} review</span> : null}
                    </div>
                  </div>
                  <form className="attendance-form" onSubmit={recordAttendance}>
                    <div className="form-grid">
                      <label>
                        Job
                        <select
                          required
                          value={attendanceDraft.jobId}
                          onChange={(event) => setAttendanceDraft({ ...attendanceDraft, jobId: event.target.value })}
                        >
                          <option value="">Select an assigned job</option>
                          {activeJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
                        </select>
                      </label>
                      {!fieldScoped ? (
                        <label>
                          Crew member
                          <select
                            required
                            value={attendanceDraft.workerId}
                            onChange={(event) => setAttendanceDraft({ ...attendanceDraft, workerId: event.target.value })}
                          >
                            <option value="">Select assigned crew</option>
                            {workers.filter((worker) => !['retired', 'inactive', 'offline', 'unavailable'].includes(worker.status)).map((worker) => (
                              <option key={worker.id} value={worker.id}>{worker.name}</option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label>
                        Access point
                        <input
                          maxLength="160"
                          value={attendanceDraft.accessPoint}
                          onChange={(event) => setAttendanceDraft({ ...attendanceDraft, accessPoint: event.target.value })}
                          placeholder="Gate or site entrance"
                        />
                      </label>
                      <label className="form-span">
                        Attendance note
                        <textarea
                          maxLength="2000"
                          value={attendanceDraft.note}
                          onChange={(event) => setAttendanceDraft({ ...attendanceDraft, note: event.target.value })}
                          placeholder="Optional handover or access note"
                        />
                      </label>
                    </div>
                    <div className="modal-actions">
                      <button className={`primary-button ${currentAttendanceSession ? 'attendance-checkout-button' : ''}`} disabled={submitting}>
                        {currentAttendanceSession ? <LogOut size={16} /> : <Timer size={16} />}
                        {submitting
                          ? 'Recording...'
                          : navigator.onLine === false
                            ? `Save ${currentAttendanceSession ? 'check-out' : 'check-in'} offline`
                            : currentAttendanceSession
                              ? 'Check out'
                              : 'Check in'}
                      </button>
                    </div>
                  </form>
                  <div className="attendance-board" aria-live="polite">
                    {(attendance.rows || []).slice(0, 12).map((session) => {
                      const job = jobs.find((item) => item.id === session.jobId)
                      return (
                        <div className="attendance-row" key={session.id}>
                          <span className={`attendance-presence ${session.status === 'checked_in' ? 'attendance-present' : ''}`} aria-hidden="true" />
                          <div>
                            <strong>{session.workerName || 'Crew member'}</strong>
                            <small>{job?.title || session.jobId} / {formatDateTime(session.effectiveCheckInAt)}</small>
                          </div>
                          <div className="attendance-row-state">
                            <span className={`status status-${session.stale ? 'attention' : session.status}`}>{session.stale ? 'review' : formatStatus(session.status)}</span>
                            {session.status === 'checked_in' ? (
                              <button
                                type="button"
                                className="icon-button"
                                title="Select for check-out"
                                aria-label={`Select ${session.workerName || 'crew member'} for check-out`}
                                onClick={() => setAttendanceDraft({
                                  jobId: session.jobId,
                                  workerId: fieldScoped ? '' : session.workerId,
                                  note: '',
                                  accessPoint: session.accessPoint || '',
                                })}
                              >
                                <ChevronRight size={16} />
                              </button>
                            ) : <span>{session.durationHours?.toFixed?.(2) || '0.00'} h</span>}
                          </div>
                        </div>
                      )
                    })}
                    {!attendance.rows?.length ? (
                      <div className="attendance-empty"><Users size={20} /><span>No retained attendance sessions.</span></div>
                    ) : null}
                  </div>
                  <p className="attendance-policy">Operational self-reported presence only. Payroll, statutory registers, and location tracking remain separate.</p>
                </section>
                <section className="safety-briefing-control" data-testid="safety-briefing-control" aria-busy={safetyBriefingLoading}>
                  <div className="panel-heading">
                    <div>
                      <h2>Safety briefings</h2>
                      <p>Worker-scoped acknowledgement, explicit attendance exceptions, and approval-backed facilitator signoff.</p>
                    </div>
                    <div className="safety-briefing-summary" aria-label="Safety briefing summary">
                      <span className="tag">{safetyMeetings.filter((meeting) => ['scheduled', 'in_progress'].includes(meeting.status)).length} active</span>
                      {safetyMeetings.some((meeting) => meeting.status === 'pending_approval') ? <span className="tag tag-amber">Signoff review</span> : null}
                    </div>
                  </div>
                  <div className="safety-briefing-selector">
                    <label>
                      Job
                      <select required value={safetyBriefingDraft.jobId} onChange={(event) => void selectSafetyBriefingJob(event.target.value)}>
                        <option value="">Select an assigned job</option>
                        {activeJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
                      </select>
                    </label>
                    <label>
                      Briefing
                      <select
                        value={safetyBriefingDraft.meetingId}
                        disabled={safetyBriefingLoading || !safetyBriefingDraft.jobId || !selectedJobSafetyMeetings.length}
                        onChange={(event) => {
                          const meetingId = event.target.value
                          setSafetyBriefingDraft((current) => ({ ...current, meetingId, evidenceReference: '', acknowledged: false, completionEvidence: '', excusalReason: '' }))
                        }}
                      >
                        <option value="">{selectedJobSafetyMeetings.length ? 'Select a briefing' : 'No retained briefing'}</option>
                        {selectedJobSafetyMeetings.map((meeting) => (
                          <option key={meeting.id} value={meeting.id}>{meeting.title} / {formatStatus(meeting.status)}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {selectedSafetyMeeting ? (
                    <div className="safety-briefing-detail" aria-live="polite">
                      <div className="safety-briefing-context">
                        <div>
                          <strong>{selectedSafetyMeeting.title}</strong>
                          <small>{formatDateTime(selectedSafetyMeeting.scheduledAt)} / {selectedSafetyMeeting.facilitator || 'Facilitator not assigned'}</small>
                        </div>
                        <span className={`status status-${selectedSafetyMeeting.status}`}>{formatStatus(selectedSafetyMeeting.status)}</span>
                      </div>
                      <div className="safety-briefing-topics">
                        <strong>Retained topics</strong>
                        <ul>{(selectedSafetyMeeting.topics || []).map((topic) => <li key={topic}>{topic}</li>)}</ul>
                      </div>
                      <div className="safety-attendee-list" aria-label="Briefing attendance">
                        {(selectedSafetyMeeting.attendeeRecords || []).map((attendee) => (
                          <div className="safety-attendee-row" key={attendee.id}>
                            <span className={`attendance-presence ${attendee.status === 'acknowledged' ? 'attendance-present' : ''}`} aria-hidden="true" />
                            <div>
                              <strong>{attendee.attendeeName}</strong>
                              <small>{attendee.company || 'Assigned crew'}{attendee.acknowledgedAt ? ` / ${formatDateTime(attendee.acknowledgedAt)}` : ''}</small>
                            </div>
                            <span className={`status status-${attendee.status}`}>{formatStatus(attendee.status)}</span>
                            {canCoordinate && attendee.status === 'expected' ? (
                              <button
                                type="button"
                                className="secondary-button"
                                disabled={submitting || safetyBriefingDraft.excusalReason.trim().length < 8}
                                onClick={() => void excuseSafetyBriefingAttendee(attendee)}
                              >
                                <Ban size={15} /> Excuse
                              </button>
                            ) : null}
                          </div>
                        ))}
                        {!selectedSafetyMeeting.attendeeRecords?.length ? <div className="attendance-empty"><Users size={20} /><span>No assigned attendee is retained for this briefing.</span></div> : null}
                      </div>
                      {fieldScoped && ['scheduled', 'in_progress'].includes(selectedSafetyMeeting.status) ? (
                        <form className="safety-acknowledgement-form" onSubmit={acknowledgeSafetyBriefing}>
                          <label>
                            Evidence reference
                            <input
                              required
                              minLength="3"
                              maxLength="240"
                              value={safetyBriefingDraft.evidenceReference}
                              onChange={(event) => updateSafetyBriefingDraft('evidenceReference', event.target.value)}
                              placeholder="Device, badge, signature, or retained field record"
                            />
                          </label>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={safetyBriefingDraft.acknowledged}
                              onChange={(event) => updateSafetyBriefingDraft('acknowledged', event.target.checked)}
                            />
                            I attended, understood the retained topics, and will stop work if conditions or controls change.
                          </label>
                          <button
                            className="primary-button"
                            disabled={submitting || selectedSafetyMeeting.attendeeRecords?.[0]?.status === 'acknowledged'}
                          >
                            <ShieldCheck size={16} />
                            {selectedSafetyMeeting.attendeeRecords?.[0]?.status === 'acknowledged'
                              ? 'Acknowledged'
                              : navigator.onLine === false ? 'Save acknowledgement offline' : 'Acknowledge briefing'}
                          </button>
                        </form>
                      ) : null}
                      {canCoordinate && ['scheduled', 'in_progress'].includes(selectedSafetyMeeting.status) ? (
                        <form className="safety-signoff-form" onSubmit={signOffSafetyBriefing}>
                          {selectedSafetyMeeting.attendanceSummary?.expected ? (
                            <label>
                              Attendance exception reason
                              <input
                                minLength="8"
                                maxLength="500"
                                value={safetyBriefingDraft.excusalReason}
                                onChange={(event) => updateSafetyBriefingDraft('excusalReason', event.target.value)}
                                placeholder="Retained reason for an expected attendee absence"
                              />
                            </label>
                          ) : null}
                          <label>
                            Completion evidence
                            <input
                              required
                              minLength="3"
                              maxLength="240"
                              value={safetyBriefingDraft.completionEvidence}
                              onChange={(event) => updateSafetyBriefingDraft('completionEvidence', event.target.value)}
                              placeholder="Signed register, minutes, photo, or document reference"
                            />
                          </label>
                          <button className="primary-button" disabled={submitting || !selectedSafetyMeeting.attendanceSummary?.readyForSignoff}>
                            <ClipboardCheck size={16} /> Request signoff approval
                          </button>
                        </form>
                      ) : null}
                    </div>
                  ) : safetyBriefingDraft.jobId ? (
                    <div className="attendance-empty"><ClipboardList size={20} /><span>No briefing is retained for this job.</span></div>
                  ) : null}
                  {canCoordinate ? (
                    <form className="safety-briefing-create" aria-busy={safetyBriefingLoading || submitting} inert={safetyBriefingLoading || submitting ? true : undefined} onSubmit={createSafetyBriefing}>
                      <div className="safety-briefing-create-heading">
                        <strong>Schedule briefing</strong>
                        <span>Assigned crew are frozen as expected attendees.</span>
                      </div>
                      <label>
                        Title
                        <input required disabled={safetyBriefingLoading || submitting} minLength="2" maxLength="240" value={safetyBriefingDraft.title} onChange={(event) => updateSafetyBriefingDraft('title', event.target.value)} placeholder="Pre-start or toolbox talk" />
                      </label>
                      <label>
                        Scheduled time
                        <input required disabled={safetyBriefingLoading || submitting} type="datetime-local" value={safetyBriefingDraft.scheduledAt} onChange={(event) => updateSafetyBriefingDraft('scheduledAt', event.target.value)} />
                      </label>
                      <label className="form-span">
                        Discussion topics
                        <textarea required disabled={safetyBriefingLoading || submitting} minLength="2" maxLength="4000" value={safetyBriefingDraft.topics} onChange={(event) => updateSafetyBriefingDraft('topics', event.target.value)} placeholder="One retained topic per line" />
                      </label>
                      <button className="secondary-button" disabled={safetyBriefingLoading || submitting || !safetyBriefingDraft.jobId}>
                        <Plus size={16} /> Schedule briefing
                      </button>
                    </form>
                  ) : null}
                  <p className="attendance-policy">Acknowledgements prove only the retained briefing event. They do not certify legal compliance, worker competence, or unchanged site conditions.</p>
                </section>
                <LazyControlBoundary label="drawing register controls">
                  <DrawingRegisterControl
                    jobs={activeJobs}
                    fieldScoped={fieldScoped}
                    canCoordinate={canCoordinate}
                    apiRequest={api}
                    notify={notify}
                    refresh={refresh}
                    onOpenApprovals={openApprovals}
                  />
                </LazyControlBoundary>
                <LazyControlBoundary label="SDS register controls">
                  <SdsRegisterControl
                    jobs={activeJobs}
                    fieldScoped={fieldScoped}
                    canCoordinate={canCoordinate}
                    apiRequest={api}
                    notify={notify}
                    refresh={refresh}
                    onOpenApprovals={openApprovals}
                  />
                </LazyControlBoundary>
                <LazyControlBoundary label="pre-task plan controls">
                  <PreTaskPlanControl
                    jobs={activeJobs}
                    operator={operator}
                    fieldScoped={fieldScoped}
                    canCoordinate={canCoordinate}
                    apiRequest={api}
                    recordFieldOperation={recordFieldOperation}
                    notify={notify}
                    refresh={refresh}
                    outboxScope={outboxScope}
                    refreshOutboxState={refreshOutboxState}
                  />
                </LazyControlBoundary>
                <LazyControlBoundary label="last-minute risk assessment controls">
                  <LmraControl
                    jobs={activeJobs}
                    fieldScoped={fieldScoped}
                    apiRequest={api}
                    recordFieldOperation={recordFieldOperation}
                    notify={notify}
                    refresh={refresh}
                    outboxScope={outboxScope}
                    refreshOutboxState={refreshOutboxState}
                  />
                </LazyControlBoundary>
                <section className="work-permit-control" data-testid="work-permit-control" aria-busy={workPermitLoading}>
                  <div className="panel-heading">
                    <div>
                      <h2>Work permits</h2>
                      <p>Approved hazards, controls, validity, and assigned-worker acceptance</p>
                    </div>
                    <div className="work-permit-summary" aria-label="Work permit summary">
                      <span className="tag">{workPermits.filter((permit) => permit.status === 'active').length} active</span>
                      {workPermits.some((permit) => permit.status === 'active' && permit.attendanceSummary?.expected > 0) ? <span className="tag tag-amber">Crew action</span> : null}
                      {workPermits.some((permit) => permit.status === 'suspended') ? <span className="tag tag-red">Stop work</span> : null}
                    </div>
                  </div>
                  <div className="work-permit-selector">
                    <label>
                      Job
                      <select required value={workPermitDraft.jobId} onChange={(event) => void selectWorkPermitJob(event.target.value)}>
                        <option value="">Select an assigned job</option>
                        {activeJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
                      </select>
                    </label>
                    <label>
                      Permit
                      <select
                        value={workPermitDraft.permitId}
                        disabled={workPermitLoading || !workPermitDraft.jobId || !selectedJobWorkPermits.length}
                        onChange={(event) => {
                          const permitId = event.target.value
                          setWorkPermitDraft((current) => ({
                            ...current,
                            permitId,
                            acknowledgementEvidence: '',
                            acknowledged: false,
                            suspensionReason: '',
                            suspensionEvidence: '',
                            closureNote: '',
                            closureEvidence: '',
                          }))
                        }}
                      >
                        <option value="">{selectedJobWorkPermits.length ? 'Select a permit' : 'No retained permit'}</option>
                        {selectedJobWorkPermits.map((permit) => (
                          <option key={permit.id} value={permit.id}>{permit.title} / {formatStatus(permit.effectiveStatus || permit.status)}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {selectedWorkPermit ? (
                    <div className="work-permit-detail" aria-live="polite">
                      <div className="work-permit-context">
                        <div>
                          <strong>{selectedWorkPermit.title}</strong>
                          <small>{formatStatus(selectedWorkPermit.permitType)} / {selectedWorkPermit.location || 'Jobsite'} / {selectedWorkPermit.holder || 'Project team'}</small>
                        </div>
                        <div className="work-permit-state">
                          {selectedWorkPermit.readyForWork ? <span className="tag tag-green"><Check size={13} /> Ready</span> : null}
                          <span className={`status status-${selectedWorkPermit.status}`}>{formatStatus(selectedWorkPermit.effectiveStatus || selectedWorkPermit.status)}</span>
                        </div>
                      </div>
                      <div className="work-permit-validity">
                        <span><strong>Valid from</strong>{formatDateTime(selectedWorkPermit.validFrom)}</span>
                        <span><strong>Expires</strong>{formatDateTime(selectedWorkPermit.expiresAt)}</span>
                        <span><strong>Source</strong>{selectedWorkPermit.evidenceReference || 'Not retained'}</span>
                      </div>
                      <div className="work-permit-definition">
                        <div>
                          <strong>Hazards</strong>
                          <ul>{(selectedWorkPermit.hazards || []).map((hazard) => <li key={hazard}>{hazard}</li>)}</ul>
                        </div>
                        <div>
                          <strong>Controls</strong>
                          <ul>{(selectedWorkPermit.controls || []).map((control) => <li key={control}>{control}</li>)}</ul>
                        </div>
                        {selectedWorkPermit.conditions?.length ? (
                          <div>
                            <strong>Conditions</strong>
                            <ul>{selectedWorkPermit.conditions.map((condition) => <li key={condition}>{condition}</li>)}</ul>
                          </div>
                        ) : null}
                      </div>
                      <div className="safety-attendee-list" aria-label="Permit crew acknowledgements">
                        {(selectedWorkPermit.attendees || []).map((attendee) => (
                          <div className="safety-attendee-row" key={attendee.id}>
                            <span className={`attendance-presence ${attendee.status === 'acknowledged' ? 'attendance-present' : ''}`} aria-hidden="true" />
                            <div>
                              <strong>{attendee.attendeeName}</strong>
                              <small>{attendee.company || 'Assigned crew'}{attendee.acknowledgedAt ? ` / ${formatDateTime(attendee.acknowledgedAt)}` : ''}</small>
                            </div>
                            <span className={`status status-${attendee.status}`}>{formatStatus(attendee.status)}</span>
                          </div>
                        ))}
                        {!selectedWorkPermit.attendees?.length ? <div className="attendance-empty"><Users size={20} /><span>No assigned permit worker is retained.</span></div> : null}
                      </div>
                      {selectedWorkPermit.blockers?.length ? (
                        <div className="work-permit-blockers" role="status">
                          <TriangleAlert size={17} />
                          <ul>{selectedWorkPermit.blockers.map((blocker) => <li key={blocker.type}>{blocker.message}</li>)}</ul>
                        </div>
                      ) : null}
                      {fieldScoped && selectedWorkPermit.status === 'active' ? (
                        <form className="work-permit-acknowledgement" onSubmit={acknowledgeWorkPermit}>
                          <label>
                            Evidence reference
                            <input
                              required
                              minLength="3"
                              maxLength="240"
                              value={workPermitDraft.acknowledgementEvidence}
                              onChange={(event) => updateWorkPermitDraft('acknowledgementEvidence', event.target.value)}
                              placeholder="Device, badge, signature, or retained field record"
                            />
                          </label>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={workPermitDraft.acknowledged}
                              onChange={(event) => updateWorkPermitDraft('acknowledged', event.target.checked)}
                            />
                            I reviewed this permit, understand the hazards and controls, and will stop work if conditions change.
                          </label>
                          <button
                            className="primary-button"
                            disabled={submitting || selectedWorkPermit.attendees?.[0]?.status === 'acknowledged' || selectedWorkPermit.notStarted || selectedWorkPermit.expired}
                          >
                            <ShieldCheck size={16} />
                            {selectedWorkPermit.attendees?.[0]?.status === 'acknowledged'
                              ? 'Acknowledged'
                              : navigator.onLine === false ? 'Save acknowledgement offline' : 'Acknowledge permit'}
                          </button>
                        </form>
                      ) : null}
                      {canCoordinate && ['active', 'suspended'].includes(selectedWorkPermit.status) ? (
                        <div className="work-permit-actions">
                          {selectedWorkPermit.status === 'active' ? (
                            <form onSubmit={suspendWorkPermit}>
                              <div className="work-permit-action-heading">
                                <strong>Suspend permit</strong>
                                <span>Stops reliance on this permit immediately.</span>
                              </div>
                              <label>
                                Stop-work reason
                                <input required disabled={submitting} minLength="8" maxLength="500" value={workPermitDraft.suspensionReason} onChange={(event) => updateWorkPermitDraft('suspensionReason', event.target.value)} />
                              </label>
                              <label>
                                Evidence reference
                                <input required disabled={submitting} minLength="3" maxLength="240" value={workPermitDraft.suspensionEvidence} onChange={(event) => updateWorkPermitDraft('suspensionEvidence', event.target.value)} />
                              </label>
                              <button className="secondary-button danger-button" disabled={submitting}><Ban size={15} /> Suspend</button>
                            </form>
                          ) : null}
                          <form onSubmit={closeWorkPermit}>
                            <div className="work-permit-action-heading">
                              <strong>Close permit</strong>
                              <span>Retains completion and hand-back evidence.</span>
                            </div>
                            <label>
                              Completion note
                              <input required disabled={submitting} minLength="8" maxLength="500" value={workPermitDraft.closureNote} onChange={(event) => updateWorkPermitDraft('closureNote', event.target.value)} />
                            </label>
                            <label>
                              Closeout evidence
                              <input required disabled={submitting} minLength="3" maxLength="240" value={workPermitDraft.closureEvidence} onChange={(event) => updateWorkPermitDraft('closureEvidence', event.target.value)} />
                            </label>
                            <button className="secondary-button" disabled={submitting}><Check size={15} /> Close permit</button>
                          </form>
                        </div>
                      ) : null}
                    </div>
                  ) : workPermitDraft.jobId ? (
                    <div className="attendance-empty"><LockKeyhole size={20} /><span>No governed work permit is retained for this job.</span></div>
                  ) : null}
                  {canCoordinate ? (
                    <form className="work-permit-create" aria-busy={workPermitLoading || submitting} inert={workPermitLoading || submitting ? true : undefined} onSubmit={createWorkPermit}>
                      <div className="work-permit-create-heading">
                        <strong>Request permit activation</strong>
                        <span>Current assigned crew are frozen into the approval snapshot.</span>
                      </div>
                      <div className="work-permit-field">
                        <label htmlFor="work-permit-type">Permit type</label>
                        <select id="work-permit-type" disabled={workPermitLoading || submitting} value={workPermitDraft.permitType} onChange={(event) => updateWorkPermitDraft('permitType', event.target.value)}>
                          <option value="general_work">General work</option>
                          <option value="hot_work">Hot work</option>
                          <option value="confined_space">Confined space</option>
                          <option value="electrical_isolation">Electrical isolation</option>
                          <option value="excavation">Excavation</option>
                          <option value="lifting">Lifting</option>
                          <option value="work_at_height">Work at height</option>
                        </select>
                      </div>
                      <div className="work-permit-field">
                        <label htmlFor="work-permit-title">Title</label>
                        <input id="work-permit-title" required disabled={workPermitLoading || submitting} minLength="3" maxLength="240" value={workPermitDraft.title} onChange={(event) => updateWorkPermitDraft('title', event.target.value)} />
                      </div>
                      <div className="work-permit-field">
                        <label htmlFor="work-permit-location">Location</label>
                        <input id="work-permit-location" disabled={workPermitLoading || submitting} maxLength="240" value={workPermitDraft.location} onChange={(event) => updateWorkPermitDraft('location', event.target.value)} />
                      </div>
                      <div className="work-permit-field">
                        <label htmlFor="work-permit-valid-from">Valid from</label>
                        <input id="work-permit-valid-from" required disabled={workPermitLoading || submitting} type="datetime-local" value={workPermitDraft.validFrom} onChange={(event) => updateWorkPermitDraft('validFrom', event.target.value)} />
                      </div>
                      <div className="work-permit-field">
                        <label htmlFor="work-permit-expires-at">Expires</label>
                        <input id="work-permit-expires-at" required disabled={workPermitLoading || submitting} type="datetime-local" value={workPermitDraft.expiresAt} onChange={(event) => updateWorkPermitDraft('expiresAt', event.target.value)} />
                      </div>
                      <div className="work-permit-field">
                        <label htmlFor="work-permit-source-evidence">Source evidence</label>
                        <input id="work-permit-source-evidence" required disabled={workPermitLoading || submitting} minLength="3" maxLength="240" value={workPermitDraft.sourceEvidence} onChange={(event) => updateWorkPermitDraft('sourceEvidence', event.target.value)} />
                      </div>
                      <div className="work-permit-field">
                        <label htmlFor="work-permit-hazards">Hazards</label>
                        <textarea id="work-permit-hazards" required disabled={workPermitLoading || submitting} minLength="2" maxLength="4000" value={workPermitDraft.hazards} onChange={(event) => updateWorkPermitDraft('hazards', event.target.value)} placeholder="One retained hazard per line" />
                      </div>
                      <div className="work-permit-field">
                        <label htmlFor="work-permit-controls">Controls</label>
                        <textarea id="work-permit-controls" required disabled={workPermitLoading || submitting} minLength="2" maxLength="4000" value={workPermitDraft.controls} onChange={(event) => updateWorkPermitDraft('controls', event.target.value)} placeholder="One retained control per line" />
                      </div>
                      <div className="work-permit-field">
                        <label htmlFor="work-permit-conditions">Conditions</label>
                        <textarea id="work-permit-conditions" disabled={workPermitLoading || submitting} maxLength="4000" value={workPermitDraft.conditions} onChange={(event) => updateWorkPermitDraft('conditions', event.target.value)} placeholder="One stop or revalidation condition per line" />
                      </div>
                      <button className="secondary-button" disabled={workPermitLoading || submitting || !workPermitDraft.jobId}><Plus size={16} /> Request approval</button>
                    </form>
                  ) : null}
                  <p className="attendance-policy">Permit readiness is derived from approval, validity, retained integrity, and every assigned worker acknowledgement. Changed conditions require stop work and a current permit.</p>
                </section>
                <section className="equipment-handoff-control" data-testid="field-equipment-custody">
                  <div className="panel-heading">
                    <div>
                      <h2>Equipment handoff</h2>
                      <p>Physical custody and return condition</p>
                    </div>
                    <div className="equipment-handoff-summary" aria-live="polite">
                      {fieldEquipmentCustody.length ? <span className="tag tag-amber">{fieldEquipmentCustody.length} checked out</span> : null}
                      <Wrench size={20} />
                    </div>
                  </div>
                  <div className="equipment-field-selector">
                    <label>
                      Job
                      <select required value={fieldEquipmentCheckout.jobId || fieldEquipmentReturn.jobId} onChange={(event) => void selectFieldEquipmentJob(event.target.value)}>
                        <option value="">Select an active job</option>
                        {activeJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
                      </select>
                    </label>
                    {navigator.onLine === false && !fieldEquipmentPlans.length && !fieldEquipmentCustody.length ? (
                      <p className="workflow-note">Reconnect to load the retained reservations and active custody for this job.</p>
                    ) : null}
                  </div>
                  {fieldEquipmentCustody.length ? (
                    <div className="equipment-field-custody-list" aria-label="Active equipment custody">
                      {fieldEquipmentCustody.map((session) => (
                        <div className="equipment-field-custody-row" key={session.id}>
                          <span className={`equipment-custody-marker ${session.overdue ? 'equipment-custody-marker-alert' : ''}`} aria-hidden="true" />
                          <div>
                            <strong>{session.toolName}</strong>
                            <small>{session.workerName || session.checkedOutBy} / due {session.dueBackAt ? formatDateTime(session.dueBackAt) : 'open'}</small>
                          </div>
                          <button type="button" className="secondary-button" disabled={submitting} onClick={() => setFieldEquipmentReturn(emptyEquipmentReturnDraft(session))}>
                            <PackageCheck size={15} /> Return
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {fieldEquipmentReturn.custodySessionId ? (
                    <form className="equipment-field-form equipment-return-form" data-testid="field-equipment-return-form" onSubmit={recordFieldEquipmentReturn}>
                      <div className="equipment-field-form-heading">
                        <strong>Return {fieldEquipmentCustody.find(session => session.id === fieldEquipmentReturn.custodySessionId)?.toolName || 'equipment'}</strong>
                        <button type="button" className="icon-button" aria-label="Cancel equipment return" onClick={() => setFieldEquipmentReturn(emptyEquipmentReturnDraft())}><X size={16} /></button>
                      </div>
                      <div className="form-grid">
                        <label>
                          Returned at
                          <input required type="datetime-local" max={toLocalDateTimeInput(new Date())} value={fieldEquipmentReturn.returnedAt} onChange={(event) => setFieldEquipmentReturn({ ...fieldEquipmentReturn, returnedAt: event.target.value })} />
                        </label>
                        {!fieldScoped ? (
                          <label>
                            Returned by
                            <input required minLength="2" maxLength="160" value={fieldEquipmentReturn.returnedBy} onChange={(event) => setFieldEquipmentReturn({ ...fieldEquipmentReturn, returnedBy: event.target.value })} />
                          </label>
                        ) : null}
                        <label>
                          Return condition
                          <select value={fieldEquipmentReturn.condition} onChange={(event) => setFieldEquipmentReturn({ ...fieldEquipmentReturn, condition: event.target.value })}>
                            <option value="serviceable">Serviceable</option>
                            <option value="good">Good</option>
                            <option value="damaged">Damaged</option>
                            <option value="unsafe">Unsafe</option>
                            <option value="lost">Lost</option>
                          </select>
                        </label>
                        <label>
                          Return location
                          <input maxLength="240" value={fieldEquipmentReturn.location} onChange={(event) => setFieldEquipmentReturn({ ...fieldEquipmentReturn, location: event.target.value })} placeholder="Depot, yard, or quarantine bay" />
                        </label>
                        <label>
                          Meter
                          <input type="number" min="0" step="any" inputMode="decimal" value={fieldEquipmentReturn.meter} onChange={(event) => setFieldEquipmentReturn({ ...fieldEquipmentReturn, meter: event.target.value })} />
                        </label>
                        <label className="form-span">
                          Return evidence reference
                          <input required minLength="3" maxLength="240" value={fieldEquipmentReturn.evidenceReference} onChange={(event) => setFieldEquipmentReturn({ ...fieldEquipmentReturn, evidenceReference: event.target.value })} placeholder="Photo, checklist, or signed handoff" />
                        </label>
                        <label className="form-span">
                          Return findings
                          <textarea required={['damaged', 'unsafe', 'lost'].includes(fieldEquipmentReturn.condition)} minLength={['damaged', 'unsafe', 'lost'].includes(fieldEquipmentReturn.condition) ? 8 : undefined} maxLength="2000" value={fieldEquipmentReturn.notes} onChange={(event) => setFieldEquipmentReturn({ ...fieldEquipmentReturn, notes: event.target.value })} placeholder="Condition, missing parts, or isolation detail" />
                        </label>
                      </div>
                      <div className="modal-actions">
                        <button className="primary-button" disabled={submitting}>
                          <PackageCheck size={16} />
                          {submitting ? 'Recording...' : navigator.onLine === false ? 'Save return offline' : 'Retain return'}
                        </button>
                      </div>
                    </form>
                  ) : null}
                  {fieldEquipmentPlans.length ? (
                    <form className="equipment-field-form equipment-checkout-form" data-testid="field-equipment-checkout-form" onSubmit={recordFieldEquipmentCheckout}>
                      <div className="equipment-field-form-heading"><strong>Check out reserved equipment</strong></div>
                      <div className="form-grid">
                        <label className="form-span">
                          Reservation
                          <select required value={fieldEquipmentCheckout.reservationId} onChange={(event) => selectFieldEquipmentPlan(event.target.value)}>
                            <option value="">Select a checkout-ready reservation</option>
                            {fieldEquipmentPlans.map((plan) => (
                              <option key={plan.reservation.id} value={plan.reservation.id} disabled={!plan.checkoutReady}>
                                {plan.tool.name} / {plan.checkoutReady ? 'ready' : plan.activeCustody ? 'already checked out' : `${formatStatus(plan.tool.status)} - blocked`}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Checked out at
                          <input required type="datetime-local" max={toLocalDateTimeInput(new Date())} value={fieldEquipmentCheckout.checkedOutAt} onChange={(event) => setFieldEquipmentCheckout({ ...fieldEquipmentCheckout, checkedOutAt: event.target.value })} />
                        </label>
                        <label>
                          Due back
                          <input type="datetime-local" min={fieldEquipmentCheckout.checkedOutAt} value={fieldEquipmentCheckout.dueBackAt} onChange={(event) => setFieldEquipmentCheckout({ ...fieldEquipmentCheckout, dueBackAt: event.target.value })} />
                        </label>
                        {!fieldScoped ? (
                          <label>
                            Physical custodian
                            <input required minLength="2" maxLength="160" value={fieldEquipmentCheckout.checkedOutBy} onChange={(event) => setFieldEquipmentCheckout({ ...fieldEquipmentCheckout, checkedOutBy: event.target.value })} />
                          </label>
                        ) : null}
                        <label>
                          Checkout condition
                          <select value={fieldEquipmentCheckout.condition} onChange={(event) => setFieldEquipmentCheckout({ ...fieldEquipmentCheckout, condition: event.target.value })}>
                            <option value="good">Good</option>
                            <option value="serviceable">Serviceable</option>
                          </select>
                        </label>
                        <label>
                          Handoff location
                          <input maxLength="240" value={fieldEquipmentCheckout.location} onChange={(event) => setFieldEquipmentCheckout({ ...fieldEquipmentCheckout, location: event.target.value })} placeholder="Depot, yard, or project gate" />
                        </label>
                        <label>
                          Meter
                          <input type="number" min="0" step="any" inputMode="decimal" value={fieldEquipmentCheckout.meter} onChange={(event) => setFieldEquipmentCheckout({ ...fieldEquipmentCheckout, meter: event.target.value })} />
                        </label>
                        <label className="form-span">
                          Handoff evidence reference
                          <input required minLength="3" maxLength="240" value={fieldEquipmentCheckout.evidenceReference} onChange={(event) => setFieldEquipmentCheckout({ ...fieldEquipmentCheckout, evidenceReference: event.target.value })} placeholder="Photo, checklist, or signed handoff" />
                        </label>
                        <label className="form-span">
                          Handoff note
                          <textarea maxLength="2000" value={fieldEquipmentCheckout.notes} onChange={(event) => setFieldEquipmentCheckout({ ...fieldEquipmentCheckout, notes: event.target.value })} placeholder="Keys, accessories, restrictions, or visible condition" />
                        </label>
                      </div>
                      <div className="modal-actions">
                        <button className="primary-button" disabled={submitting || !selectedFieldEquipmentPlan?.checkoutReady}>
                          <ArrowUpRight size={16} />
                          {submitting ? 'Recording...' : navigator.onLine === false ? 'Save handoff offline' : 'Retain checkout'}
                        </button>
                      </div>
                    </form>
                  ) : null}
                  {fieldEquipmentCheckout.jobId && navigator.onLine !== false && !fieldEquipmentPlans.length && !fieldEquipmentCustody.length ? (
                    <Empty title="No equipment handoff available" detail="This job has no checkout-ready retained equipment reservation." />
                  ) : null}
                  <p className="attendance-policy">Custody records are internal operational evidence. External hire, spend, and statutory inspection remain separately governed.</p>
                </section>
                <section className="evidence-form field-five-s-panel">
                  <LazyControlBoundary label="5S field controls">
                    <FiveSWorkspace
                      request={api}
                      jobs={activeJobs}
                      fieldMode
                      operatorName={operator.name || operator.worker?.name || ''}
                      onSubmitFieldAudit={submitFieldFiveSAudit}
                    />
                  </LazyControlBoundary>
                </section>
                <section className="evidence-form field-environmental-panel" data-testid="field-environmental-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Environmental activity</h2>
                      <p>Retain measured site activity with the exact evidence and emission-factor source used for the calculation.</p>
                    </div>
                    <Leaf size={20} />
                  </div>
                  <form data-testid="field-environmental-activity-form" aria-busy={environmentalLoading} onSubmit={recordFieldEnvironmentalActivity}>
                    <div className="form-grid environmental-job-grid">
                      <label>
                        Job
                        <select required value={fieldEnvironmentalActivity.jobId} onChange={(event) => void selectFieldEnvironmentalJob(event.target.value)}>
                          <option value="">Select an active job</option>
                          {activeJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
                        </select>
                      </label>
                    </div>
                    <fieldset className="form-grid environmental-fieldset" disabled={environmentalLoading}>
                      <label>
                        Activity date
                        <input required type="date" max={futureDateInput(0)} value={fieldEnvironmentalActivity.activityDate} onChange={(event) => updateFieldEnvironmentalActivity('activityDate', event.target.value)} />
                      </label>
                      <label>
                        Category
                        <select value={fieldEnvironmentalActivity.category} onChange={(event) => updateEnvironmentalCategory(event.target.value)}>
                          <option value="fuel">Fuel</option>
                          <option value="electricity">Electricity</option>
                          <option value="district_heat">District heat</option>
                          <option value="refrigerant">Refrigerant</option>
                          <option value="transport">Transport</option>
                          <option value="material">Material</option>
                          <option value="waste">Waste</option>
                          <option value="water">Water</option>
                          <option value="accommodation">Accommodation</option>
                          <option value="other">Other</option>
                        </select>
                      </label>
                      <label>
                        GHG scope
                        <select value={fieldEnvironmentalActivity.ghgScope} onChange={(event) => updateFieldEnvironmentalActivity('ghgScope', event.target.value)}>
                          <option value="scope_1">Scope 1</option>
                          <option value="scope_2">Scope 2</option>
                          <option value="scope_3">Scope 3</option>
                          <option value="unclassified">Unclassified</option>
                        </select>
                      </label>
                      <label className="form-span">
                        Activity description
                        <input required minLength="3" maxLength="240" value={fieldEnvironmentalActivity.description} onChange={(event) => updateFieldEnvironmentalActivity('description', event.target.value)} placeholder="Generator diesel, temporary power, delivery distance, waste transfer" />
                      </label>
                      <label>
                        Quantity
                        <input required type="number" min="0.000001" step="any" inputMode="decimal" value={fieldEnvironmentalActivity.quantity} onChange={(event) => updateFieldEnvironmentalActivity('quantity', event.target.value)} />
                      </label>
                      <label>
                        Unit
                        <input required maxLength="24" value={fieldEnvironmentalActivity.unit} onChange={(event) => updateFieldEnvironmentalActivity('unit', event.target.value)} placeholder="litre, kWh, kg, km" />
                      </label>
                      <label>
                        Factor (kg CO2e / unit)
                        <input required type="number" min="0" step="any" inputMode="decimal" value={fieldEnvironmentalActivity.emissionFactor} onChange={(event) => updateFieldEnvironmentalActivity('emissionFactor', event.target.value)} />
                      </label>
                      <div className="environmental-calculation" aria-live="polite">
                        <span>Calculated emissions</span>
                        <strong>{roundDisplay(Number(fieldEnvironmentalActivity.quantity || 0) * Number(fieldEnvironmentalActivity.emissionFactor || 0))} kg CO2e</strong>
                      </div>
                      <label>
                        Factor source
                        <input required minLength="3" maxLength="240" value={fieldEnvironmentalActivity.factorSource} onChange={(event) => updateFieldEnvironmentalActivity('factorSource', event.target.value)} placeholder="Authority, supplier, or retained factor library" />
                      </label>
                      <label>
                        Factor reference
                        <input required minLength="3" maxLength="500" value={fieldEnvironmentalActivity.factorReference} onChange={(event) => updateFieldEnvironmentalActivity('factorReference', event.target.value)} placeholder="Publication version, URL, or controlled record ID" />
                      </label>
                      <label className="form-span">
                        Activity evidence reference
                        <input required minLength="3" maxLength="500" value={fieldEnvironmentalActivity.evidenceReference} onChange={(event) => updateFieldEnvironmentalActivity('evidenceReference', event.target.value)} placeholder="Meter statement, delivery ticket, fuel receipt, or waste transfer note" />
                      </label>
                      <label className="form-span">
                        Review note
                        <textarea maxLength="2000" value={fieldEnvironmentalActivity.notes} onChange={(event) => updateFieldEnvironmentalActivity('notes', event.target.value)} placeholder="Measurement boundary, allocation basis, or retained context" />
                      </label>
                    </fieldset>
                    <div className="modal-actions">
                      <button className="primary-button" disabled={submitting || environmentalLoading}>
                        <Leaf size={16} />
                        {submitting ? 'Recording...' : environmentalLoading ? 'Loading sources...' : navigator.onLine === false ? 'Save activity offline' : 'Request source review'}
                      </button>
                    </div>
                  </form>
                  {environmentalRegister?.summary ? (
                    <div className="environmental-summary" aria-label="Environmental register summary">
                      <div><span>Recognized</span><strong>{roundDisplay(environmentalRegister.summary.totalKgCo2e || 0)} kg CO2e</strong></div>
                      <div><span>Approved sources</span><strong>{environmentalRegister.summary.recognizedRecords || 0}</strong></div>
                      <div><span>Pending review</span><strong>{environmentalRegister.summary.pendingRecords || 0}</strong></div>
                      <div><span>Pending correction</span><strong>{environmentalRegister.summary.pendingReversals || 0}</strong></div>
                    </div>
                  ) : null}
                  {fieldEnvironmentalActivities.length ? (
                    <div className="field-environmental-list" aria-label="Recent environmental activities">
                      {fieldEnvironmentalActivities.map((activity) => (
                        <div className="field-environmental-row" key={activity.id}>
                          <div>
                            <strong>{activity.description}</strong>
                            <small>{formatDate(activity.activityDate)} / {formatStatus(activity.category)} / {roundDisplay(activity.quantity)} {activity.unit} x {roundDisplay(activity.emissionFactor)}</small>
                            <small>{activity.factorSource} / {activity.evidenceReference}</small>
                          </div>
                          <div>
                            <strong>{roundDisplay(activity.emissionsKgCo2e)} kg CO2e</strong>
                            <span className={`status status-${activity.status}`}>{formatStatus(activity.status)}</span>
                            {!fieldScoped && activity.status === 'approved' ? (
                              <button
                                type="button"
                                className="icon-button icon-button-small"
                                aria-label={`Request reversal for ${activity.description}`}
                                title="Request compensating reversal"
                                onClick={() => {
                                  setEnvironmentalReversal(activity)
                                  setEnvironmentalReversalReason('')
                                }}
                              >
                                <Undo2 size={14} />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : fieldEnvironmentalActivity.jobId && navigator.onLine !== false ? (
                    <Empty title="No environmental activity retained" detail="Record the first measured source before preparing a report." />
                  ) : null}
                  {!fieldScoped && fieldEnvironmentalActivity.jobId ? (
                    <form className="environmental-report-control" data-testid="environmental-report-form" onSubmit={prepareEnvironmentalReport}>
                      <div>
                        <strong>Environmental report</strong>
                        <small>Freeze approved sources into a checksum-protected CSV package.</small>
                      </div>
                      <label>
                        From
                        <input required type="date" max={environmentalReportDraft.periodEnd} value={environmentalReportDraft.periodStart} onChange={(event) => setEnvironmentalReportDraft({ ...environmentalReportDraft, periodStart: event.target.value })} />
                      </label>
                      <label>
                        Through
                        <input required type="date" min={environmentalReportDraft.periodStart} max={futureDateInput(0)} value={environmentalReportDraft.periodEnd} onChange={(event) => setEnvironmentalReportDraft({ ...environmentalReportDraft, periodEnd: event.target.value })} />
                      </label>
                      <button className="secondary-button" disabled={submitting || !environmentalRegister?.readyForReport}>
                        <FileDown size={16} />
                        Prepare report
                      </button>
                    </form>
                  ) : null}
                  {!fieldScoped && environmentalReports.length ? (
                    <div className="environmental-report-list" aria-label="Environmental reports">
                      {environmentalReports.map((report) => (
                        <div key={report.id}>
                          <span>
                            <strong>{formatDate(report.periodStart)} to {formatDate(report.periodEnd)}</strong>
                            <small>{report.activityCount} source(s) / {roundDisplay(report.summary?.totalKgCo2e || 0)} kg CO2e</small>
                          </span>
                          <span className={`status status-${report.status}`}>{formatStatus(report.status)}</span>
                          {report.status === 'approved' ? (
                            <a className="icon-button icon-button-small" href={report.downloadPath} aria-label={`Download environmental report ${report.periodStart} to ${report.periodEnd}`} title="Download verified CSV">
                              <FileDown size={14} />
                            </a>
                          ) : null}
                          {!report.sourceCurrent ? <span className="status status-attention">Source changed</span> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <p className="attendance-policy">Calculations use the retained operator-supplied factor source. Approval does not certify a footprint, submit a report, or buy offsets.</p>
                </section>
                <form className="evidence-form field-expense-receipt-form" data-testid="field-expense-receipt-form" aria-busy={expenseReceiptLoading} onSubmit={recordFieldExpenseReceipt}>
                  <div className="panel-heading">
                    <div>
                      <h2>Expense receipt</h2>
                      <p>Retain the original receipt identity, VAT basis, payment method, and job allocation for approval.</p>
                    </div>
                    <ReceiptEuro size={20} />
                  </div>
                  <div className="form-grid expense-receipt-job-grid">
                    <label>
                      Job
                      <select required value={fieldExpenseReceipt.jobId} onChange={(event) => void selectFieldExpenseJob(event.target.value)}>
                        <option value="">Select an active job</option>
                        {activeJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
                      </select>
                    </label>
                  </div>
                  <fieldset className="form-grid expense-receipt-fieldset" disabled={expenseReceiptLoading}>
                    <label>
                      Expense date
                      <input required type="date" max={futureDateInput(0)} value={fieldExpenseReceipt.expenseDate} onChange={(event) => updateFieldExpenseReceipt('expenseDate', event.target.value)} />
                    </label>
                    <label>
                      Category
                      <select value={fieldExpenseReceipt.category} onChange={(event) => updateFieldExpenseReceipt('category', event.target.value)}>
                        <option value="materials">Materials</option>
                        <option value="equipment">Equipment</option>
                        <option value="travel">Travel</option>
                        <option value="parking">Parking</option>
                        <option value="fuel">Fuel</option>
                        <option value="accommodation">Accommodation</option>
                        <option value="meals">Meals</option>
                        <option value="subcontractor">Subcontractor</option>
                        <option value="general">General</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label>
                      Vendor
                      <input required minLength="2" maxLength="160" value={fieldExpenseReceipt.vendor} onChange={(event) => updateFieldExpenseReceipt('vendor', event.target.value)} placeholder="Supplier or merchant" />
                    </label>
                    <label>
                      Receipt reference
                      <input required minLength="3" maxLength="240" value={fieldExpenseReceipt.receiptReference} onChange={(event) => updateFieldExpenseReceipt('receiptReference', event.target.value)} placeholder="Receipt number or retained evidence reference" />
                    </label>
                    <label>
                      Gross total (EUR)
                      <input required type="number" min="0.01" step="0.01" inputMode="decimal" value={fieldExpenseReceipt.totalAmount} onChange={(event) => updateFieldExpenseReceipt('totalAmount', event.target.value)} />
                    </label>
                    <label>
                      VAT amount (EUR)
                      <input required type="number" min="0" max={fieldExpenseReceipt.totalAmount || undefined} step="0.01" inputMode="decimal" value={fieldExpenseReceipt.taxAmount} onChange={(event) => updateFieldExpenseReceipt('taxAmount', event.target.value)} />
                    </label>
                    <label>
                      VAT treatment
                      <select value={fieldExpenseReceipt.taxTreatment} onChange={(event) => updateFieldExpenseTaxTreatment(event.target.value)}>
                        <option value="recoverable">Recoverable VAT</option>
                        <option value="non_recoverable">Non-recoverable VAT</option>
                        <option value="exempt">VAT exempt</option>
                        <option value="reverse_charge">Reverse charge</option>
                      </select>
                    </label>
                    <label>
                      Payment method
                      <select value={fieldExpenseReceipt.paymentMethod} onChange={(event) => updateFieldExpenseReceipt('paymentMethod', event.target.value)}>
                        <option value="company_card">Company card</option>
                        <option value="personal_card">Personal card</option>
                        <option value="cash">Cash</option>
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="direct_debit">Direct debit</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label>
                      Cost code
                      <input required minLength="2" maxLength="80" value={fieldExpenseReceipt.costCode} onChange={(event) => updateFieldExpenseReceipt('costCode', event.target.value)} />
                    </label>
                    <label className="form-span">
                      Receipt note
                      <textarea maxLength="2000" value={fieldExpenseReceipt.notes} onChange={(event) => updateFieldExpenseReceipt('notes', event.target.value)} placeholder="Purpose, allocation, or review context" />
                    </label>
                  </fieldset>
                  {fieldExpenseReceipts.length ? (
                    <div className="field-expense-receipt-list" aria-label="Recent expense receipts">
                      {fieldExpenseReceipts.map((expense) => (
                        <div className="field-expense-receipt-row" key={expense.id}>
                          <div>
                            <strong>{expense.vendor}</strong>
                            <small>{expense.receiptReference} / {formatDate(expense.expenseDate)} / {formatStatus(expense.taxTreatment)}</small>
                          </div>
                          <div>
                            <strong>{currency.format(expense.totalAmount || 0)}</strong>
                            <span className={`status status-${expense.status}`}>{formatStatus(expense.status)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="modal-actions">
                    <button className="primary-button" disabled={submitting || expenseReceiptLoading}>
                      <ReceiptEuro size={16} />
                      {submitting ? 'Recording...' : expenseReceiptLoading ? 'Loading receipts...' : navigator.onLine === false ? 'Save receipt offline' : 'Request expense approval'}
                    </button>
                  </div>
                  <p className="attendance-policy">Approval recognizes the job cost only. Reimbursement, card settlement, bookkeeping export, and supplier contact remain separate.</p>
                </form>
                <form className="evidence-form material-receipt-form" data-testid="field-material-receipt-form" aria-busy={materialReceiptLoading || submitting} onSubmit={recordFieldMaterialReceipt}>
                  <div className="panel-heading">
                    <div>
                      <h2>Receive materials</h2>
                      <p>Retain the delivery note, physical receiver, and accepted or damaged quantities at the point of receipt.</p>
                    </div>
                    <PackageCheck size={20} />
                  </div>
                  <fieldset className="material-receipt-fieldset" disabled={materialReceiptLoading || submitting}>
                  <div className="form-grid">
                    <label>
                      Job
                      <select required value={fieldMaterialReceipt.jobId} onChange={(event) => void selectFieldMaterialReceiptJob(event.target.value)}>
                        <option value="">Select an active job</option>
                        {activeJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
                      </select>
                    </label>
                    {fieldMaterialReceiptPlans.length ? (
                      <label>
                        Purchase order
                        <select value={fieldMaterialReceipt.purchaseOrderId} onChange={(event) => selectFieldMaterialReceiptPlan(event.target.value)}>
                          <option value="">Unlinked delivery</option>
                          {fieldMaterialReceiptPlans.map((plan) => (
                            <option key={plan.purchaseOrder.id} value={plan.purchaseOrder.id}>
                              {plan.purchaseOrder.issueReference || plan.purchaseOrder.id} / {plan.summary.remainingLines} line(s) open
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {selectedFieldMaterialReceiptPlan?.lines.filter((line) => !line.complete).length > 1 ? (
                      <label>
                        Order line
                        <select value={fieldMaterialReceipt.lines[0].lineKey} onChange={(event) => selectFieldMaterialReceiptLine(event.target.value)}>
                          {selectedFieldMaterialReceiptPlan.lines.filter((line) => !line.complete).map((line) => (
                            <option key={line.lineKey} value={line.lineKey}>{line.itemName} / {roundDisplay(line.remainingQuantity)} {line.unit}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <label>
                      Delivery-note reference
                      <input required minLength="3" maxLength="160" value={fieldMaterialReceipt.receiptReference} onChange={(event) => updateFieldMaterialReceipt('receiptReference', event.target.value)} placeholder="Supplier ticket number" />
                    </label>
                    <label>
                      Delivered at
                      <input required type="datetime-local" max={toLocalDateTimeInput(new Date())} value={fieldMaterialReceipt.deliveredAt} onChange={(event) => updateFieldMaterialReceipt('deliveredAt', event.target.value)} />
                    </label>
                    {!fieldScoped ? (
                      <label>
                        Received by
                        <input required minLength="2" maxLength="160" value={fieldMaterialReceipt.receivedBy} onChange={(event) => updateFieldMaterialReceipt('receivedBy', event.target.value)} />
                      </label>
                    ) : null}
                    <label>
                      Delivery location
                      <input maxLength="240" value={fieldMaterialReceipt.location} onChange={(event) => updateFieldMaterialReceipt('location', event.target.value)} placeholder="Gate, floor, or storage area" />
                    </label>
                    <label>
                      Item
                      <input required minLength="2" maxLength="240" value={fieldMaterialReceipt.lines[0].itemName} onChange={(event) => updateFieldMaterialReceiptLine('itemName', event.target.value)} placeholder="Match the planned material name when possible" />
                    </label>
                    <label>
                      Unit
                      <input required maxLength="40" value={fieldMaterialReceipt.lines[0].unit} onChange={(event) => updateFieldMaterialReceiptLine('unit', event.target.value)} />
                    </label>
                    <label>
                      Received
                      <input required type="number" min="0.000001" step="any" inputMode="decimal" value={fieldMaterialReceipt.lines[0].receivedQuantity} onChange={(event) => updateFieldMaterialReceiptLine('receivedQuantity', event.target.value)} />
                    </label>
                    <label>
                      Accepted
                      <input required type="number" min="0" step="any" inputMode="decimal" value={fieldMaterialReceipt.lines[0].acceptedQuantity} onChange={(event) => updateFieldMaterialReceiptLine('acceptedQuantity', event.target.value)} />
                    </label>
                    <label>
                      Damaged
                      <input required type="number" min="0" step="any" inputMode="decimal" value={fieldMaterialReceipt.lines[0].damagedQuantity} onChange={(event) => updateFieldMaterialReceiptLine('damagedQuantity', event.target.value)} />
                    </label>
                    <label className="form-span">
                      Evidence reference
                      <input required minLength="3" maxLength="240" value={fieldMaterialReceipt.evidenceReference} onChange={(event) => updateFieldMaterialReceipt('evidenceReference', event.target.value)} placeholder="Signed ticket, photo, or retained document reference" />
                    </label>
                    <label className="form-span">
                      Delivery note
                      <textarea maxLength="4000" value={fieldMaterialReceipt.notes} onChange={(event) => updateFieldMaterialReceipt('notes', event.target.value)} placeholder="Damage, rejection, storage, or follow-up detail" />
                    </label>
                    <label className="checkbox-label form-span">
                      <input type="checkbox" checked={fieldMaterialReceipt.finalDelivery} onChange={(event) => updateFieldMaterialReceipt('finalDelivery', event.target.checked)} />
                      This is the final delivery against the order
                    </label>
                  </div>
                  </fieldset>
                  <div className="modal-actions">
                    <button className="primary-button" disabled={submitting}>
                      <PackageCheck size={16} />
                      {submitting ? 'Recording...' : navigator.onLine === false ? 'Save receipt offline' : 'Retain delivery ticket'}
                    </button>
                  </div>
                </form>
                <form className="evidence-form daily-cycle-form" data-testid="daily-start-huddle-form" aria-busy={dailyCycleLoading} onSubmit={recordDailyStartHuddle}>
                  <div className="panel-heading">
                    <div>
                      <h2>Daily start huddle</h2>
                      <p>Freeze today&apos;s crew, production target, safety focus, hold points, constraints, and stop-work state before the shift.</p>
                    </div>
                    <span className="tag">Internal control</span>
                  </div>
                  <div className="form-grid daily-cycle-job-grid">
                    <label>
                      Job
                      <select required value={dailyHuddle.jobId} onChange={(event) => void selectDailyCycleJob(event.target.value)}>
                        <option value="">Select an active job</option>
                        {activeJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
                      </select>
                    </label>
                  </div>
                  <fieldset className="form-grid daily-cycle-fieldset" disabled={dailyCycleLoading}>
                    <label>
                      Work date
                      <input required type="date" value={dailyHuddle.workDate} onChange={(event) => updateDailyHuddle('workDate', event.target.value)} />
                    </label>
                    <label>
                      Shift
                      <select value={dailyHuddle.shiftLabel} onChange={(event) => updateDailyHuddle('shiftLabel', event.target.value)}>
                        <option value="day">Day</option>
                        <option value="early">Early</option>
                        <option value="late">Late</option>
                        <option value="night">Night</option>
                      </select>
                    </label>
                    <label>
                      Weather
                      <select value={dailyHuddle.weather} onChange={(event) => updateDailyHuddle('weather', event.target.value)}>
                        <option value="clear">Clear</option>
                        <option value="cloudy">Cloudy</option>
                        <option value="rain">Rain</option>
                        <option value="wind">High wind</option>
                        <option value="heat">Heat</option>
                        <option value="cold">Cold</option>
                      </select>
                    </label>
                    {!fieldScoped ? (
                      <>
                        <label>
                          Facilitator
                          <input required minLength="2" maxLength="160" value={dailyHuddle.facilitator} onChange={(event) => updateDailyHuddle('facilitator', event.target.value)} placeholder="Crew lead or supervisor" />
                        </label>
                        <label>
                          Daily lead
                          <select required value={dailyHuddle.leadWorkerId} onChange={(event) => updateDailyHuddle('leadWorkerId', event.target.value)}>
                            <option value="">Select retained crew first</option>
                            {workers.filter(worker => dailyHuddle.workerIds.includes(worker.id)).map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
                          </select>
                        </label>
                        <fieldset className="daily-crew-picker form-span">
                          <legend>Huddle crew</legend>
                          <div>
                            {workers.filter(worker => !['retired', 'inactive'].includes(worker.status)).map(worker => (
                              <label className="checkbox-label" key={worker.id}>
                                <input type="checkbox" checked={dailyHuddle.workerIds.includes(worker.id)} onChange={(event) => toggleDailyHuddleWorker(worker.id, event.target.checked)} />
                                <span>{worker.name}<small>{worker.role || 'Crew'}</small></span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      </>
                    ) : (
                      <div className="daily-field-identity form-span">
                        <Users size={18} />
                        <span><strong>{operator.worker?.name || 'Field worker'}</strong><small>Your authenticated field identity is the retained huddle lead and attendee.</small></span>
                      </div>
                    )}
                    <label className="form-span">
                      Planned work
                      <textarea required minLength="8" maxLength="4000" value={dailyHuddle.plannedWork} onChange={(event) => updateDailyHuddle('plannedWork', event.target.value)} placeholder="Specific work areas, sequence, and handoffs for this shift." />
                    </label>
                    <label className="form-span">
                      Production target
                      <textarea required minLength="3" maxLength="1000" value={dailyHuddle.productionTarget} onChange={(event) => updateDailyHuddle('productionTarget', event.target.value)} placeholder="A measurable quantity, milestone, or completion state." />
                    </label>
                    <label className="form-span">
                      Site conditions
                      <textarea maxLength="2000" value={dailyHuddle.siteConditions} onChange={(event) => updateDailyHuddle('siteConditions', event.target.value)} placeholder="Access, occupants, logistics, weather exposure, or changed conditions." />
                    </label>
                    <label className="form-span">
                      Safety focus
                      <textarea required minLength="5" maxLength="2000" value={dailyHuddle.safetyFocus} onChange={(event) => updateDailyHuddle('safetyFocus', event.target.value)} placeholder="Today&apos;s hazards, controls, LMRA trigger, and stop-work condition." />
                    </label>
                    <label className="form-span">
                      Quality hold points
                      <textarea value={dailyHuddle.qualityHoldPoints} onChange={(event) => updateDailyHuddle('qualityHoldPoints', event.target.value)} placeholder="One inspection, witness, or approval hold point per line." />
                    </label>
                    <label className="form-span">
                      Constraints
                      <textarea value={dailyHuddle.constraints} onChange={(event) => updateDailyHuddle('constraints', event.target.value)} placeholder="Materials, information, access, equipment, or third-party dependencies." />
                    </label>
                    <label className="form-span">
                      Blocking issues
                      <textarea value={dailyHuddle.blockingIssues} onChange={(event) => updateDailyHuddle('blockingIssues', event.target.value)} placeholder="Only conditions that prevent planned work; one per line." />
                    </label>
                    <label className="checkbox-label form-span daily-stop-work">
                      <input type="checkbox" checked={dailyHuddle.stopWorkRequired} onChange={(event) => updateDailyHuddle('stopWorkRequired', event.target.checked)} />
                      Stop work until the retained blocking issues are resolved
                    </label>
                    <label className="form-span">
                      Huddle evidence reference
                      <input required minLength="3" maxLength="500" value={dailyHuddle.evidenceReference} onChange={(event) => updateDailyHuddle('evidenceReference', event.target.value)} placeholder="Signed sheet, attendance photo, or retained document reference" />
                    </label>
                  </fieldset>
                  <div className="modal-actions">
                    <button className="primary-button" disabled={submitting || dailyCycleLoading}>
                      <ClipboardCheck size={16} />
                      {submitting ? 'Retaining...' : dailyCycleLoading ? 'Loading daily cycles...' : navigator.onLine === false ? 'Save huddle offline' : 'Retain start huddle'}
                    </button>
                  </div>
                  <p className="attendance-policy">A released huddle is an internal coordination record. It does not create a permit, certify compliance, notify the crew, or authorize hazardous work.</p>
                </form>
                <form className="evidence-form daily-site-log" data-testid="daily-site-log-form" onSubmit={recordFieldDailyLog}>
                  <div className="panel-heading">
                    <div>
                      <h2>End-of-day report</h2>
                      <p>Close an open huddle with plan-versus-actual evidence, time, safety state, unresolved actions, and tomorrow&apos;s handoff.</p>
                    </div>
                    {fieldScoped && operator.worker?.name ? <span className="tag tag-green">{operator.worker.name}</span> : null}
                  </div>
                  <div className="form-grid">
                    <label>
                      Job
                      <select
                        required
                        value={fieldDailyLog.jobId}
                        onChange={(event) => void selectDailyCycleJob(event.target.value)}
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
                      Open daily cycle
                      <select
                        required
                        value={fieldDailyLog.cycleId}
                        onChange={(event) => {
                          const cycle = fieldDailyCycles.find(item => item.id === event.target.value)
                          setFieldDailyLog({
                            ...fieldDailyLog,
                            cycleId: event.target.value,
                            workDate: cycle?.workDate || fieldDailyLog.workDate,
                            weather: cycle?.weather || fieldDailyLog.weather,
                          })
                        }}
                      >
                        <option value="">Select a released or blocked huddle</option>
                        {fieldDailyCycles.filter(cycle => ['released', 'blocked'].includes(cycle.status)).map(cycle => (
                          <option key={cycle.id} value={cycle.id}>{formatDate(cycle.workDate)} / {formatStatus(cycle.shiftLabel)} / {formatStatus(cycle.status)}</option>
                        ))}
                      </select>
                    </label>
                    {selectedDailyCycle ? (
                      <div className={`daily-cycle-source form-span daily-cycle-source-${selectedDailyCycle.status}`}>
                        <div><span>Production target</span><strong>{selectedDailyCycle.productionTarget}</strong></div>
                        <div><span>Safety focus</span><strong>{selectedDailyCycle.safetyFocus}</strong></div>
                        <div><span>Start state</span><strong>{formatStatus(selectedDailyCycle.status)}</strong></div>
                      </div>
                    ) : null}
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
                    <label className="form-span checkbox-label daily-target-check">
                      <input
                        type="checkbox"
                        checked={fieldDailyLog.planAchieved}
                        onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, planAchieved: event.target.checked })}
                      />
                      The retained production target was achieved
                    </label>
                    {!fieldDailyLog.planAchieved ? (
                      <label className="form-span">
                        Reasons for variance
                        <textarea
                          required
                          value={fieldDailyLog.varianceReasons}
                          onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, varianceReasons: event.target.value })}
                          placeholder="One source-grounded reason per line; do not infer causes."
                        />
                      </label>
                    ) : null}
                    <label className="form-span">
                      Unresolved actions
                      <textarea
                        value={fieldDailyLog.unresolvedActions}
                        onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, unresolvedActions: event.target.value })}
                        placeholder="Owner, decision, material, access, quality, or safety action still open."
                      />
                    </label>
                    <label className="form-span">
                      Tomorrow&apos;s plan
                      <textarea
                        required
                        minLength="3"
                        maxLength="4000"
                        value={fieldDailyLog.tomorrowPlan}
                        onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, tomorrowPlan: event.target.value })}
                        placeholder="Next work sequence, first handoff, and constraint-removal priority."
                      />
                    </label>
                    <label className="form-span">
                      EOD evidence references
                      <textarea
                        required
                        minLength="3"
                        value={fieldDailyLog.evidenceReferences}
                        onChange={(event) => setFieldDailyLog({ ...fieldDailyLog, evidenceReferences: event.target.value })}
                        placeholder="Photo set, delivery ticket, inspection, measurement, or retained document reference; one per line."
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
                      {submitting ? 'Submitting...' : navigator.onLine === false ? 'Save EOD report offline' : 'Submit EOD report'}
                    </button>
                  </div>
                  <p className="attendance-policy">Approval recognizes the retained daily evidence. It does not send a client update, change the schedule, order materials, or certify safety compliance.</p>
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
                      <select required value={evidence.jobId} onChange={(event) => void selectFieldEvidenceJob(event.target.value)}>
                        <option value="">Select an active job</option>
                        {activeJobs.map((job) => (
                          <option key={job.id} value={job.id}>
                            {job.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Evidence workflow
                      <select
                        value={evidence.photoEvidenceSetId}
                        onChange={(event) => {
                          const selected = fieldPhotoEvidenceSets.find(set => set.id === event.target.value)
                          setEvidence({
                            ...evidence,
                            photoEvidenceSetId: event.target.value,
                            photoEvidencePhase: selected?.status === 'rejected' ? 'before' : selected?.missingPhases?.[0] || 'before',
                            capturedAt: toLocalDateTimeInput(new Date()),
                          })
                        }}
                      >
                        <option value="">General job evidence</option>
                        {availableFieldPhotoEvidenceSets.map((set) => (
                          <option key={set.id} value={set.id}>
                            {set.taskTitle || set.title} / {set.workLocation}
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
                    {selectedFieldPhotoEvidenceSet ? (
                      <>
                        <label>
                          Evidence phase
                          <select
                            required
                            value={evidence.photoEvidencePhase}
                            onChange={(event) => setEvidence({ ...evidence, photoEvidencePhase: event.target.value })}
                          >
                            <option value="before">Before</option>
                            <option value="during">During</option>
                            <option value="after">After</option>
                          </select>
                        </label>
                        <label>
                          Device capture time
                          <input
                            required
                            type="datetime-local"
                            max={toLocalDateTimeInput(new Date())}
                            value={evidence.capturedAt}
                            onChange={(event) => setEvidence({ ...evidence, capturedAt: event.target.value })}
                          />
                        </label>
                        <div className="form-span evidence-governance-context" data-testid="photo-evidence-context">
                          <strong>{selectedFieldPhotoEvidenceSet.taskTitle || selectedFieldPhotoEvidenceSet.title}</strong>
                          <span>{selectedFieldPhotoEvidenceSet.workLocation}</span>
                          <span>
                            Cycle {selectedFieldPhotoEvidenceSet.currentCycle}
                            {' / '}
                            {selectedFieldPhotoEvidenceSet.captureCount || 0} of 3 phases retained
                          </span>
                        </div>
                      </>
                    ) : null}
                    <label className="form-span">
                      Evidence file
                      <input
                        ref={evidenceInputRef}
                        required
                        type="file"
                        accept={selectedFieldPhotoEvidenceSet
                          ? 'image/jpeg,image/png,image/webp'
                          : 'image/jpeg,image/png,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'}
                      />
                    </label>
                    <label className="form-span">
                      {selectedFieldPhotoEvidenceSet ? 'Photo caption' : 'Site note'}
                      <textarea
                        required={Boolean(selectedFieldPhotoEvidenceSet)}
                        minLength={selectedFieldPhotoEvidenceSet ? 3 : undefined}
                        maxLength={600}
                        value={evidence.notes}
                        onChange={(event) => setEvidence({ ...evidence, notes: event.target.value })}
                        placeholder={selectedFieldPhotoEvidenceSet
                          ? 'Describe the visible condition, exact location, and what this phase proves.'
                          : 'Describe what this file proves, what changed, or what needs review.'}
                      />
                    </label>
                  </div>
                  {selectedFieldPhotoEvidenceSet ? (
                    <p className="attendance-policy">
                      Captures sync in sequence and remain private. Offline capture can queue files and metadata, but cannot request review, release evidence, or complete the task.
                    </p>
                  ) : null}
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
                <LazyControlBoundary label="team access">
                  <TeamAccessControl
                    request={api}
                    register={data.operatorRegister}
                    workers={data.workers}
                    jobs={jobs}
                    onRegisterChange={(operatorRegister) => setData((current) => current ? { ...current, operatorRegister } : current)}
                    onError={setError}
                    onNotice={notify}
                  />
                </LazyControlBoundary>
                <LazyControlBoundary label="privacy requests">
                  <PrivacyRequestsControl
                    request={api}
                    register={data.privacyRequests}
                    clients={data.clientDirectory?.clients || EMPTY_LIST}
                    workers={data.workers}
                    onRegisterChange={(privacyRequests) => setData((current) => current ? { ...current, privacyRequests } : current)}
                    onOpenApprovals={openApprovals}
                    onError={setError}
                    onNotice={notify}
                  />
                </LazyControlBoundary>
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
                  <form onSubmit={saveOrganizationProfile} aria-busy={submitting || sectionLoading}>
                    <fieldset className="form-fieldset" disabled={submitting || sectionLoading}>
                    <div className="form-grid organization-profile-form">
                      <label>
                        Legal name
                        <input
                          value={organizationProfileDraft.legalName}
                          onChange={(event) => updateOrganizationProfile('legalName', event.target.value)}
                        />
                      </label>
                      <label>
                        Trading name
                        <input
                          value={organizationProfileDraft.tradingName}
                          onChange={(event) => updateOrganizationProfile('tradingName', event.target.value)}
                        />
                      </label>
                      <label>
                        Registration number
                        <input
                          value={organizationProfileDraft.registrationNumber}
                          onChange={(event) => updateOrganizationProfile('registrationNumber', event.target.value)}
                          placeholder="KVK or national registry number"
                        />
                      </label>
                      <label>
                        Electronic address scheme
                        <input
                          value={organizationProfileDraft.electronicAddressScheme}
                          onChange={(event) => updateOrganizationProfile('electronicAddressScheme', event.target.value)}
                          placeholder="0106 for KVK"
                        />
                      </label>
                      <label>
                        Electronic address
                        <input
                          value={organizationProfileDraft.electronicAddress}
                          onChange={(event) => updateOrganizationProfile('electronicAddress', event.target.value)}
                          placeholder="Defaults to KVK for Dutch entities"
                        />
                      </label>
                      <label>
                        VAT number
                        <input
                          disabled={organizationProfileDraft.vatExempt}
                          value={organizationProfileDraft.vatNumber}
                          onChange={(event) => updateOrganizationProfile('vatNumber', event.target.value)}
                        />
                      </label>
                      <label className="checkbox-label form-span">
                        <input
                          type="checkbox"
                          checked={organizationProfileDraft.vatExempt}
                          onChange={(event) => updateOrganizationVatExemption(event.target.checked)}
                        />
                        This legal entity is VAT exempt
                      </label>
                      <label>
                        Email
                        <input
                          type="email"
                          value={organizationProfileDraft.email}
                          onChange={(event) => updateOrganizationProfile('email', event.target.value)}
                        />
                      </label>
                      <label>
                        Phone
                        <input
                          value={organizationProfileDraft.phone}
                          onChange={(event) => updateOrganizationProfile('phone', event.target.value)}
                        />
                      </label>
                      <label className="form-span">
                        Website
                        <input
                          type="url"
                          value={organizationProfileDraft.website}
                          onChange={(event) => updateOrganizationProfile('website', event.target.value)}
                          placeholder="https://"
                        />
                      </label>
                      <label className="form-span">
                        Registered address
                        <input
                          value={organizationProfileDraft.address}
                          onChange={(event) => updateOrganizationProfile('address', event.target.value)}
                        />
                      </label>
                      <label>
                        Postal code
                        <input
                          value={organizationProfileDraft.postalCode}
                          onChange={(event) => updateOrganizationProfile('postalCode', event.target.value)}
                        />
                      </label>
                      <label>
                        City
                        <input
                          value={organizationProfileDraft.city}
                          onChange={(event) => updateOrganizationProfile('city', event.target.value)}
                        />
                      </label>
                      <label>
                        Country code
                        <input
                          required
                          maxLength="2"
                          value={organizationProfileDraft.country}
                          onChange={(event) => updateOrganizationProfile('country', event.target.value.toUpperCase())}
                        />
                      </label>
                      <label>
                        IBAN
                        <input
                          value={organizationProfileDraft.iban}
                          onChange={(event) => updateOrganizationProfile('iban', event.target.value)}
                        />
                      </label>
                      <label>
                        BIC
                        <input
                          value={organizationProfileDraft.bic}
                          onChange={(event) => updateOrganizationProfile('bic', event.target.value)}
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
                          onChange={(event) => updateOrganizationProfile('defaultPaymentTermsDays', event.target.value)}
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
                          onChange={(event) => updateOrganizationProfile('defaultQuoteValidityDays', event.target.value)}
                        />
                      </label>
                      <label className="form-span">
                        Quote terms
                        <textarea
                          value={organizationProfileDraft.quoteTerms}
                          onChange={(event) => updateOrganizationProfile('quoteTerms', event.target.value)}
                          placeholder="Commercial terms shown on every new issue package."
                        />
                      </label>
                      <label className="form-span">
                        Internal notes
                        <textarea
                          value={organizationProfileDraft.notes}
                          onChange={(event) => updateOrganizationProfile('notes', event.target.value)}
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
                        {sectionLoading ? 'Loading identity...' : submitting ? 'Saving...' : 'Save business identity'}
                      </button>
                    </div>
                    </fieldset>
                  </form>
                </section>
                <LazyControlBoundary label="automation controls">
                  <AutomationControl
                    commandPlan={data.commandPlan}
                    scheduler={data.scheduler}
                    jobs={jobs}
                    loading={commandPlanLoading}
                    error={commandPlanError}
                    view={commandPlanView}
                    selectedIds={selectedCommandIds}
                    submitting={submitting || automationSuspended}
                    onViewChange={setCommandPlanView}
                    onToggle={toggleCommandSelection}
                    onSelectVisible={setSelectedCommandIds}
                    onApply={applySelectedCommands}
                    onRun={runCycle}
                    onRetry={() => refreshOperationsCommandPlan()}
                    onOpenApprovals={openApprovals}
                    onOpen={openJobWorkspace}
                  />
                </LazyControlBoundary>
                <section className={`panel page-panel automation-safety-panel ${automationSuspended ? 'automation-safety-panel-active' : ''}`} data-testid="automation-safety-control">
                  <div className="panel-heading">
                    <div>
                      <h2>Autonomous-work safety stop</h2>
                      <p>Owner control for manual command plans and the durable scheduler.</p>
                    </div>
                    <span className={`status ${automationSuspended ? 'status-attention' : 'status-ready'}`}>
                      {automationSuspended ? 'suspended' : 'active'}
                    </span>
                  </div>
                  <p className="panel-copy">
                    {automationSuspended
                      ? `${automationControl.reason} Direct operator entries, evidence, and approvals are unaffected.`
                      : 'Autonomous work can create internal drafts and review tasks only. External commitments remain approval-gated.'}
                  </p>
                  <div className="operations-actions">
                    <button
                      className={automationSuspended ? 'primary-button' : 'danger-button'}
                      disabled={submitting}
                      onClick={(event) => openAutomationControlDialog(!automationSuspended, event.currentTarget)}
                    >
                      {automationSuspended ? <Activity size={16} /> : <Ban size={16} />}
                      {automationSuspended ? 'Resume autonomous drafting' : 'Suspend autonomous drafting'}
                    </button>
                    <a className="secondary-button" href="/api/operations/support-bundle" download>
                      <FileDown size={16} />
                      Download support bundle
                    </a>
                  </div>
                  <p className="panel-copy">
                    The support bundle contains runtime, migration, aggregate-count, integrity, and control diagnostics only. It excludes
                    customer records, evidence, logs, environment values, and credentials.
                  </p>
                </section>
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
                    <div data-testid="runtime-exposure-readiness">
                      <span>Access</span>
                      <strong>
                        {data.health.runtime?.exposure?.publicTunnel
                          ? 'authenticated tunnel'
                          : data.health.runtime?.exposure?.loopbackOnly
                            ? 'this computer only'
                            : data.health.runtime?.mode === 'hosted'
                              ? 'hosted ingress'
                              : 'local network'}
                      </strong>
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
                        operationCapabilities?.requestSafety?.dailyLogEntryKey === 'durable' &&
                        operationCapabilities?.requestSafety?.materialReceiptEntryKey === 'durable'
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
                    <div data-testid="hai-connector-readiness">
                      <span>HAI feed</span>
                      <strong>{operationCapabilities?.haiConnector?.available ? 'read-only ready' : 'checking'}</strong>
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
                    <a className="secondary-button" href="/api/integrations/hai/feed?limit=100" download="contractor-ai.json">
                      <GitBranch size={16} />
                      Export HAI feed
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
                      aria-label="Ledger export JSON file"
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
                      ref={qaResetOpenerRef}
                      className="danger-button"
                      disabled={submitting || !localBackupAvailable}
                      title={
                        localBackupAvailable ? 'Archive QA records after backup' : 'Hosted maintenance requires a provider recovery point'
                      }
                      onClick={(event) => openQaResetDialog(event.currentTarget)}
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
                              aria-label={`Check restore for backup ${backup.backupId}`}
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
                                aria-label={`Download backup ${backup.backupId}`}
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
                <LazyControlBoundary label="audit history">
                  <AuditHistory request={api} totalEvents={auditIntegrityCapability?.eventCount || 0} />
                </LazyControlBoundary>
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
          </>
        ) : null}
      </main>

      {showOrganizationOnboarding ? (
        <Suspense fallback={<div className="modal-backdrop" role="status"><div className="loading"><LoaderCircle className="spin" size={20} /> Loading business setup</div></div>}>
          <OrganizationOnboarding
            draft={organizationProfileDraft}
            organization={data?.organization}
            busy={submitting}
            onChange={updateOrganizationProfile}
            onVatExemptChange={updateOrganizationVatExemption}
            onSave={() => persistOrganizationProfile({ announce: false })}
            onClose={closeOrganizationOnboarding}
          />
        </Suspense>
      ) : null}

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
                    placeholder="Carpentry, renovation, electrical installation"
                  />
                </label>
                <label className="form-span">
                  Internal notes
                  <textarea
                    value={workerDraft.notes}
                    onChange={(event) => setWorkerDraft({ ...workerDraft, notes: event.target.value })}
                    placeholder="Record restrictions or resource planning context. Use Qualifications for certificate evidence."
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

      {credentialEditor ? (
        <div className="modal-backdrop worker-backdrop" role="presentation">
          <section
            className="modal qualification-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="credential-editor-title"
            data-testid="credential-editor"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeCredentialEditor()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Approval-backed qualification evidence</p>
                <h2 id="credential-editor-title">Add credential for {credentialEditor.name}</h2>
                <p>Retain the source identity and validity dates. Approval verifies this revision before readiness can rely on it.</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close credential editor" onClick={closeCredentialEditor}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitWorkerCredential}>
              <div className="form-grid qualification-form">
                <label>
                  Credential type
                  <select autoFocus value={credentialDraft.credentialType} onChange={(event) => setCredentialDraft({ ...credentialDraft, credentialType: event.target.value })}>
                    {(data.qualificationRegister?.catalog?.credentials || EMPTY_LIST).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                  </select>
                </label>
                <label>
                  Retained title
                  <input value={credentialDraft.title} onChange={(event) => setCredentialDraft({ ...credentialDraft, title: event.target.value })} placeholder="Uses the credential type when blank" />
                </label>
                <label>
                  Issuer
                  <input value={credentialDraft.issuer} onChange={(event) => setCredentialDraft({ ...credentialDraft, issuer: event.target.value })} placeholder="Training or examination authority" />
                </label>
                <label>
                  Credential number
                  <input value={credentialDraft.credentialNumber} onChange={(event) => setCredentialDraft({ ...credentialDraft, credentialNumber: event.target.value })} />
                </label>
                <label>
                  Issued on
                  <input type="date" max={new Date().toISOString().slice(0, 10)} value={credentialDraft.issuedOn} onChange={(event) => setCredentialDraft({ ...credentialDraft, issuedOn: event.target.value })} />
                </label>
                <label>
                  Expires on
                  <input type="date" min={credentialDraft.issuedOn || undefined} value={credentialDraft.expiresOn} onChange={(event) => setCredentialDraft({ ...credentialDraft, expiresOn: event.target.value })} />
                </label>
                <label className="form-span">
                  Evidence reference
                  <textarea required minLength="4" maxLength="500" value={credentialDraft.evidenceReference} onChange={(event) => setCredentialDraft({ ...credentialDraft, evidenceReference: event.target.value })} placeholder="Certificate file, provider register reference, or retained verification source" />
                </label>
                <p className="workflow-note form-span">Submitting creates an immutable pending revision. Contractor.AI does not issue, renew, or contact a certificate authority.</p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeCredentialEditor}>Cancel</button>
                <button className="primary-button" disabled={submitting || credentialDraft.evidenceReference.trim().length < 4}>
                  <ShieldCheck size={16} />
                  {submitting ? 'Submitting...' : 'Request evidence verification'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {qualificationRequirementEditor ? (
        <div className="modal-backdrop worker-backdrop" role="presentation">
          <section
            className="modal qualification-requirement-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qualification-requirement-title"
            data-testid="qualification-requirement-editor"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeQualificationRequirementEditor()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Job readiness control</p>
                <h2 id="qualification-requirement-title">Add qualification requirement</h2>
                <p>This immediately adds a retained readiness gate for matching assigned roles.</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close qualification requirement editor" onClick={closeQualificationRequirementEditor}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitQualificationRequirement}>
              <div className="form-grid qualification-form">
                <label className="form-span">
                  Job
                  <select autoFocus required value={qualificationRequirementDraft.jobId} onChange={(event) => setQualificationRequirementDraft({ ...qualificationRequirementDraft, jobId: event.target.value })}>
                    <option value="">Select a retained job</option>
                    {jobs.filter((job) => !['archived', 'cancelled', 'rejected'].includes(job.status)).map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
                  </select>
                </label>
                <label>
                  Requirement type
                  <select value={qualificationRequirementDraft.credentialType} onChange={(event) => setQualificationRequirementDraft({ ...qualificationRequirementDraft, credentialType: event.target.value })}>
                    {(data.qualificationRegister?.catalog?.requirements || EMPTY_LIST).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                  </select>
                </label>
                <label>
                  Applies to role
                  <input value={qualificationRequirementDraft.role} onChange={(event) => setQualificationRequirementDraft({ ...qualificationRequirementDraft, role: event.target.value })} placeholder="Blank means all assigned roles" />
                </label>
                <label className="form-span">
                  Requirement title
                  <input value={qualificationRequirementDraft.title} onChange={(event) => setQualificationRequirementDraft({ ...qualificationRequirementDraft, title: event.target.value })} placeholder="Uses the requirement type when blank" />
                </label>
                <label className="checkbox-control form-span">
                  <input type="checkbox" checked={qualificationRequirementDraft.mandatory} onChange={(event) => setQualificationRequirementDraft({ ...qualificationRequirementDraft, mandatory: event.target.checked })} />
                  <span>Block dispatch, site access, and attendance when evidence is missing or expired</span>
                </label>
                <p className="workflow-note form-span">Removing a retained requirement later needs an approval and does not delete credential history.</p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeQualificationRequirementEditor}>Cancel</button>
                <button className="primary-button" disabled={submitting || !qualificationRequirementDraft.jobId}>
                  <LockKeyhole size={16} />
                  {submitting ? 'Saving...' : 'Enforce requirement'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {qualificationRequirementRetirement ? (
        <div className="modal-backdrop worker-backdrop" role="presentation">
          <section
            className="modal qualification-retirement-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qualification-retirement-title"
            data-testid="qualification-retirement-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeQualificationRequirementRetirement()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Approval-gated safety change</p>
                <h2 id="qualification-retirement-title">Request requirement removal</h2>
                <p>{qualificationRequirementRetirement.title} / {qualificationRequirementRetirement.jobTitle}</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close qualification removal request" onClick={closeQualificationRequirementRetirement}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={requestQualificationRequirementRetirement}>
              <div className="job-lifecycle-body">
                <div className="job-lifecycle-effect">
                  <TriangleAlert size={20} />
                  <div>
                    <strong>Stop enforcing this readiness gate after approval</strong>
                    <p>The requirement remains active while the decision is pending. Rejection or cancellation restores its normal active state.</p>
                  </div>
                </div>
                <label>
                  Operational reason
                  <textarea autoFocus required minLength="8" value={qualificationRequirementRetirementReason} onChange={(event) => setQualificationRequirementRetirementReason(event.target.value)} placeholder="Reference the accepted scope or safety-plan change." />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeQualificationRequirementRetirement}>Cancel</button>
                <button className="danger-button" disabled={submitting || qualificationRequirementRetirementReason.trim().length < 8}>
                  <Archive size={16} />
                  {submitting ? 'Submitting...' : 'Request removal approval'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {availabilityEditor ? (
        <div className="modal-backdrop worker-backdrop" role="presentation">
          <section
            className="modal availability-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="availability-editor-title"
            data-testid="availability-editor"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeAvailabilityEditor()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Operational capacity ledger</p>
                <h2 id="availability-editor-title">Add worker unavailability</h2>
                <p>The retained time window blocks overlapping scheduling immediately without creating a message, payroll record, or HR case.</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close availability editor" onClick={closeAvailabilityEditor}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitWorkerAvailability}>
              <div className="form-grid availability-form">
                <label className="form-span">
                  Worker
                  <select autoFocus required value={availabilityDraft.workerId} onChange={(event) => setAvailabilityDraft({ ...availabilityDraft, workerId: event.target.value })}>
                    <option value="">Select retained worker</option>
                    {(data.workers || EMPTY_LIST).filter((worker) => worker.status !== 'retired' && !worker.retirementApprovalId).map((worker) => (
                      <option key={worker.id} value={worker.id}>{worker.name} / {worker.role || 'Role not retained'}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Operational type
                  <select value={availabilityDraft.periodType} onChange={(event) => setAvailabilityDraft({ ...availabilityDraft, periodType: event.target.value })}>
                    {(data.availabilityRegister?.catalog || EMPTY_LIST).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                  </select>
                </label>
                <label>
                  Display title
                  <input maxLength="160" value={availabilityDraft.title} onChange={(event) => setAvailabilityDraft({ ...availabilityDraft, title: event.target.value })} placeholder="Uses the operational type when blank" />
                </label>
                <label>
                  Starts
                  <input required type="datetime-local" value={availabilityDraft.startsAt} onChange={(event) => setAvailabilityDraft({ ...availabilityDraft, startsAt: event.target.value })} />
                </label>
                <label>
                  Ends
                  <input required type="datetime-local" min={availabilityDraft.startsAt || undefined} value={availabilityDraft.endsAt} onChange={(event) => setAvailabilityDraft({ ...availabilityDraft, endsAt: event.target.value })} />
                </label>
                <label className="form-span">
                  Operational note
                  <textarea maxLength="1000" value={availabilityDraft.notes} onChange={(event) => setAvailabilityDraft({ ...availabilityDraft, notes: event.target.value })} placeholder="Capacity or planning context only" />
                </label>
                <p className="workflow-note form-span">Do not enter diagnosis, illness, medical details, payroll entitlement, HR case information, or location tracking data.</p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeAvailabilityEditor}>Cancel</button>
                <button className="primary-button" disabled={submitting || !availabilityDraft.workerId || !availabilityDraft.startsAt || !availabilityDraft.endsAt}>
                  <CalendarOff size={16} />
                  {submitting ? 'Saving...' : 'Block availability window'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {availabilityCancellation ? (
        <div className="modal-backdrop worker-backdrop" role="presentation">
          <section
            className="modal availability-cancellation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="availability-cancellation-title"
            data-testid="availability-cancellation-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeAvailabilityCancellation()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Approval-backed capacity change</p>
                <h2 id="availability-cancellation-title">Request availability cancellation</h2>
                <p>{availabilityCancellation.workerName} / {availabilityCancellation.title}</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close availability cancellation" onClick={closeAvailabilityCancellation}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={requestAvailabilityCancellation}>
              <div className="job-lifecycle-body">
                <div className="job-lifecycle-effect">
                  <TriangleAlert size={20} />
                  <div>
                    <strong>Remove this scheduling block only after approval</strong>
                    <p>{formatDateTime(availabilityCancellation.startsAt)} to {formatDateTime(availabilityCancellation.endsAt)} remains unavailable while review is pending.</p>
                  </div>
                </div>
                <label>
                  Operational reason
                  <textarea autoFocus required minLength="8" maxLength="1000" value={availabilityCancellationReason} onChange={(event) => setAvailabilityCancellationReason(event.target.value)} placeholder="Explain the verified planning change." />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeAvailabilityCancellation}>Cancel</button>
                <button className="danger-button" disabled={submitting || availabilityCancellationReason.trim().length < 8}>
                  <Ban size={16} />
                  {submitting ? 'Submitting...' : 'Request cancellation approval'}
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
                    disabled={Boolean(equipmentEditor?.activeCustody)}
                    onChange={(event) => setEquipmentDraft({ ...equipmentDraft, status: event.target.value })}
                  >
                    <option value="available">Available</option>
                    <option value="in_use" disabled={!equipmentEditor?.activeCustody}>In use (custody controlled)</option>
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
                    disabled={Boolean(equipmentEditor?.activeCustody)}
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

      {equipmentCheckoutEditor ? (
        <div className="modal-backdrop equipment-backdrop" role="presentation">
          <section
            className="modal equipment-custody-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="equipment-checkout-title"
            data-testid="equipment-checkout-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeEquipmentCheckout()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Physical custody</p>
                <h2 id="equipment-checkout-title">Check out reserved equipment</h2>
                <p>Reservation-linked handoff evidence</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close equipment checkout" onClick={closeEquipmentCheckout}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={saveEquipmentCheckout}>
              <div className="form-grid equipment-custody-form">
                <label>
                  Job
                  <select autoFocus required disabled={submitting} value={equipmentCheckoutDraft.jobId} onChange={(event) => void selectEquipmentCheckoutJob(event.target.value)}>
                    <option value="">Select an active job</option>
                    {jobs.filter((job) => !['archived', 'completed', 'cancelled', 'rejected'].includes(job.status)).map((job) => (
                      <option key={job.id} value={job.id}>{job.title}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Reservation
                  <select required disabled={!equipmentCheckoutDraft.jobId || submitting} value={equipmentCheckoutDraft.reservationId} onChange={(event) => selectEquipmentCheckoutPlan(event.target.value)}>
                    <option value="">Select checkout-ready equipment</option>
                    {equipmentCheckoutPlans.map((plan) => (
                      <option key={plan.reservation.id} value={plan.reservation.id} disabled={!plan.checkoutReady}>
                        {plan.tool.name} / {plan.checkoutReady ? 'ready' : plan.activeCustody ? 'already checked out' : `${formatStatus(plan.tool.status)} - blocked`}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedEquipmentCheckoutPlan ? (
                  <dl className="equipment-custody-preview form-span">
                    <div><dt>Equipment</dt><dd>{selectedEquipmentCheckoutPlan.tool.name}</dd></div>
                    <div><dt>Current location</dt><dd>{selectedEquipmentCheckoutPlan.tool.currentLocation || 'Not retained'}</dd></div>
                    <div><dt>Reservation until</dt><dd>{selectedEquipmentCheckoutPlan.reservation.neededUntil ? formatDateTime(selectedEquipmentCheckoutPlan.reservation.neededUntil) : 'Open'}</dd></div>
                  </dl>
                ) : equipmentCheckoutDraft.jobId && !submitting ? (
                  <p className="workflow-note form-span">No checkout-ready retained equipment reservation is available for this job.</p>
                ) : null}
                <label>
                  Physical custodian
                  <input required minLength="2" maxLength="160" value={equipmentCheckoutDraft.checkedOutBy} onChange={(event) => setEquipmentCheckoutDraft({ ...equipmentCheckoutDraft, checkedOutBy: event.target.value })} />
                </label>
                <label>
                  Checkout condition
                  <select value={equipmentCheckoutDraft.condition} onChange={(event) => setEquipmentCheckoutDraft({ ...equipmentCheckoutDraft, condition: event.target.value })}>
                    <option value="good">Good</option>
                    <option value="serviceable">Serviceable</option>
                  </select>
                </label>
                <label>
                  Checked out at
                  <input required type="datetime-local" max={toLocalDateTimeInput(new Date())} value={equipmentCheckoutDraft.checkedOutAt} onChange={(event) => setEquipmentCheckoutDraft({ ...equipmentCheckoutDraft, checkedOutAt: event.target.value })} />
                </label>
                <label>
                  Due back
                  <input type="datetime-local" min={equipmentCheckoutDraft.checkedOutAt} value={equipmentCheckoutDraft.dueBackAt} onChange={(event) => setEquipmentCheckoutDraft({ ...equipmentCheckoutDraft, dueBackAt: event.target.value })} />
                </label>
                <label>
                  Handoff location
                  <input maxLength="240" value={equipmentCheckoutDraft.location} onChange={(event) => setEquipmentCheckoutDraft({ ...equipmentCheckoutDraft, location: event.target.value })} placeholder="Depot, yard, or project gate" />
                </label>
                <label>
                  Meter
                  <input type="number" min="0" step="any" inputMode="decimal" value={equipmentCheckoutDraft.meter} onChange={(event) => setEquipmentCheckoutDraft({ ...equipmentCheckoutDraft, meter: event.target.value })} />
                </label>
                <label className="form-span">
                  Handoff evidence reference
                  <input required minLength="3" maxLength="240" value={equipmentCheckoutDraft.evidenceReference} onChange={(event) => setEquipmentCheckoutDraft({ ...equipmentCheckoutDraft, evidenceReference: event.target.value })} placeholder="Photo, checklist, or signed handoff" />
                </label>
                <label className="form-span">
                  Handoff note
                  <textarea maxLength="2000" value={equipmentCheckoutDraft.notes} onChange={(event) => setEquipmentCheckoutDraft({ ...equipmentCheckoutDraft, notes: event.target.value })} placeholder="Keys, accessories, restrictions, or visible condition" />
                </label>
                <p className="workflow-note form-span">Checkout changes equipment availability and reservation state atomically. It creates no purchase, hire, or external communication.</p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeEquipmentCheckout}>Cancel</button>
                <button className="primary-button" disabled={submitting || !selectedEquipmentCheckoutPlan?.checkoutReady || equipmentCheckoutDraft.checkedOutBy.trim().length < 2 || equipmentCheckoutDraft.evidenceReference.trim().length < 3}>
                  <ArrowUpRight size={16} />
                  {submitting ? 'Recording...' : 'Retain checkout'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {equipmentReturnEditor ? (
        <div className="modal-backdrop equipment-backdrop" role="presentation">
          <section
            className="modal equipment-return-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="equipment-return-title"
            data-testid="equipment-return-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeEquipmentReturn()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Physical custody</p>
                <h2 id="equipment-return-title">Return {equipmentReturnEditor.toolName}</h2>
                <p>{equipmentReturnEditor.jobTitle} / {equipmentReturnEditor.workerName || equipmentReturnEditor.checkedOutBy}</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close equipment return" onClick={closeEquipmentReturn}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={saveEquipmentReturn}>
              <div className="form-grid equipment-custody-form">
                <dl className="equipment-custody-preview form-span">
                  <div><dt>Checked out</dt><dd>{formatDateTime(equipmentReturnEditor.checkedOutAt)}</dd></div>
                  <div><dt>Due back</dt><dd>{equipmentReturnEditor.dueBackAt ? formatDateTime(equipmentReturnEditor.dueBackAt) : 'Open'}</dd></div>
                  <div><dt>Checkout condition</dt><dd>{formatStatus(equipmentReturnEditor.checkoutCondition)}</dd></div>
                </dl>
                <label>
                  Returned at
                  <input autoFocus required type="datetime-local" max={toLocalDateTimeInput(new Date())} value={equipmentReturnDraft.returnedAt} onChange={(event) => setEquipmentReturnDraft({ ...equipmentReturnDraft, returnedAt: event.target.value })} />
                </label>
                <label>
                  Returned by
                  <input required minLength="2" maxLength="160" value={equipmentReturnDraft.returnedBy} onChange={(event) => setEquipmentReturnDraft({ ...equipmentReturnDraft, returnedBy: event.target.value })} />
                </label>
                <label>
                  Return condition
                  <select value={equipmentReturnDraft.condition} onChange={(event) => setEquipmentReturnDraft({ ...equipmentReturnDraft, condition: event.target.value })}>
                    <option value="serviceable">Serviceable</option>
                    <option value="good">Good</option>
                    <option value="damaged">Damaged</option>
                    <option value="unsafe">Unsafe</option>
                    <option value="lost">Lost</option>
                  </select>
                </label>
                <label>
                  Return location
                  <input maxLength="240" value={equipmentReturnDraft.location} onChange={(event) => setEquipmentReturnDraft({ ...equipmentReturnDraft, location: event.target.value })} placeholder="Depot, yard, or quarantine bay" />
                </label>
                <label>
                  Meter
                  <input type="number" min={equipmentReturnEditor.checkoutMeter ?? 0} step="any" inputMode="decimal" value={equipmentReturnDraft.meter} onChange={(event) => setEquipmentReturnDraft({ ...equipmentReturnDraft, meter: event.target.value })} />
                </label>
                <label className="form-span">
                  Return evidence reference
                  <input required minLength="3" maxLength="240" value={equipmentReturnDraft.evidenceReference} onChange={(event) => setEquipmentReturnDraft({ ...equipmentReturnDraft, evidenceReference: event.target.value })} placeholder="Photo, checklist, or signed handoff" />
                </label>
                <label className="form-span">
                  Return findings
                  <textarea required={['damaged', 'unsafe', 'lost'].includes(equipmentReturnDraft.condition)} minLength={['damaged', 'unsafe', 'lost'].includes(equipmentReturnDraft.condition) ? 8 : undefined} maxLength="2000" value={equipmentReturnDraft.notes} onChange={(event) => setEquipmentReturnDraft({ ...equipmentReturnDraft, notes: event.target.value })} placeholder="Condition, missing parts, or isolation detail" />
                </label>
                <p className="workflow-note form-span">Damaged, unsafe, and lost returns are quarantined automatically and create an internal review action. No supplier or finance action is executed.</p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeEquipmentReturn}>Cancel</button>
                <button className="primary-button" disabled={submitting || equipmentReturnDraft.returnedBy.trim().length < 2 || equipmentReturnDraft.evidenceReference.trim().length < 3 || (['damaged', 'unsafe', 'lost'].includes(equipmentReturnDraft.condition) && equipmentReturnDraft.notes.trim().length < 8)}>
                  <PackageCheck size={16} />
                  {submitting ? 'Recording...' : 'Retain return'}
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

      {clientEditor ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal client-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-editor-title"
            data-testid="client-editor-modal"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Retained client identity</p>
                <h2 id="client-editor-title">{clientEditor.mode === 'edit' ? 'Edit client' : 'New client'}</h2>
                <p>Contact, billing, and electronic invoicing data used by future controlled records.</p>
              </div>
              <button className="icon-button" type="button" aria-label="Close client editor" onClick={closeClientEditor}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitClientEditor}>
              <div className="form-grid client-editor-form">
                <label>
                  Contact name
                  <input autoFocus required minLength="2" maxLength="160" value={clientDraft.name} onChange={(event) => setClientDraft({ ...clientDraft, name: event.target.value })} />
                </label>
                <label>
                  Client type
                  <select value={clientDraft.clientType} onChange={(event) => setClientDraft({ ...clientDraft, clientType: event.target.value })}>
                    <option value="business">Business</option>
                    <option value="consumer">Consumer</option>
                    <option value="public">Public body</option>
                    <option value="property_manager">Property manager</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="form-span">
                  Legal or company name
                  <input maxLength="200" value={clientDraft.company} onChange={(event) => setClientDraft({ ...clientDraft, company: event.target.value })} />
                </label>
                <label>
                  Contact email
                  <input type="email" maxLength="254" value={clientDraft.email} onChange={(event) => setClientDraft({ ...clientDraft, email: event.target.value })} />
                </label>
                <label>
                  Billing email
                  <input type="email" maxLength="254" value={clientDraft.billingEmail} onChange={(event) => setClientDraft({ ...clientDraft, billingEmail: event.target.value })} />
                </label>
                <label>
                  Phone
                  <input type="tel" maxLength="80" value={clientDraft.phone} onChange={(event) => setClientDraft({ ...clientDraft, phone: event.target.value })} />
                </label>
                <label>
                  Preferred language
                  <select value={clientDraft.preferredLanguage} onChange={(event) => setClientDraft({ ...clientDraft, preferredLanguage: event.target.value })}>
                    <option value="nl">Dutch</option>
                    <option value="en">English</option>
                    <option value="de">German</option>
                    <option value="fr">French</option>
                  </select>
                </label>
                <label className="form-span">
                  Street address
                  <input maxLength="300" value={clientDraft.address} onChange={(event) => setClientDraft({ ...clientDraft, address: event.target.value })} />
                </label>
                <label>
                  Postal code
                  <input maxLength="30" value={clientDraft.postalCode} onChange={(event) => setClientDraft({ ...clientDraft, postalCode: event.target.value })} />
                </label>
                <label>
                  City
                  <input maxLength="120" value={clientDraft.city} onChange={(event) => setClientDraft({ ...clientDraft, city: event.target.value })} />
                </label>
                <label>
                  Country code
                  <input required minLength="2" maxLength="2" value={clientDraft.country} onChange={(event) => setClientDraft({ ...clientDraft, country: event.target.value.toUpperCase() })} />
                </label>
                <label>
                  KVK / registration number
                  <input maxLength="80" value={clientDraft.registrationNumber} onChange={(event) => setClientDraft({ ...clientDraft, registrationNumber: event.target.value })} />
                </label>
                <label>
                  VAT number
                  <input maxLength="80" value={clientDraft.vatNumber} onChange={(event) => setClientDraft({ ...clientDraft, vatNumber: event.target.value })} />
                </label>
                <label>
                  Electronic address scheme
                  <input maxLength="20" placeholder="0106 for KVK or 0190 for OIN" value={clientDraft.electronicAddressScheme} onChange={(event) => setClientDraft({ ...clientDraft, electronicAddressScheme: event.target.value })} />
                </label>
                <label>
                  Electronic address
                  <input maxLength="120" value={clientDraft.electronicAddress} onChange={(event) => setClientDraft({ ...clientDraft, electronicAddress: event.target.value })} />
                </label>
                <label className="form-span">
                  Internal notes
                  <textarea maxLength="4000" value={clientDraft.notes} onChange={(event) => setClientDraft({ ...clientDraft, notes: event.target.value })} />
                </label>
                <p className="workflow-note form-span">
                  Saving changes the client master only. Existing quote, invoice, handover, and communication snapshots remain unchanged, and no external action is performed.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeClientEditor}>Cancel</button>
                <button
                  className="primary-button"
                  disabled={
                    submitting
                    || clientDraft.name.trim().length < 2
                    || clientDraft.country.trim().length !== 2
                    || Boolean(clientDraft.electronicAddressScheme.trim()) !== Boolean(clientDraft.electronicAddress.trim())
                  }
                >
                  <BadgeCheck size={16} />
                  {submitting ? 'Retaining...' : clientEditor.mode === 'edit' ? 'Update client' : 'Retain client'}
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
                <LazyControlBoundary label="job controls" mode="job">
                  {!fieldScoped ? (
                    <TakeoffControl
                      job={selectedJob}
                      estimateRates={estimateRates}
                      canCoordinate={canCoordinate}
                      canManagePolicy={canManageMarketFitPolicy}
                      submitting={submitting}
                      onRequestRatePolicy={requestEstimateRatePolicy}
                      onApplyUnitRate={applyTakeoffUnitRate}
                      onNewTakeoff={openTakeoffCreate}
                      onAddItem={(takeoff) => openTakeoffItem(takeoff)}
                      onEditItem={openTakeoffItem}
                      onRemoveItem={openTakeoffRemoval}
                      onConvert={openTakeoffConversion}
                    />
                  ) : null}
                  <ProductionControl
                    job={selectedJob}
                    canCoordinate={canCoordinate}
                    canReport={canCoordinate || capabilities.fieldEvidence === true}
                    canApprove={capabilities.approvals === true}
                    submitting={submitting}
                    outboxPending={outboxPending}
                    outboxSyncing={outboxSyncing}
                    onRequestBaseline={requestProductionBaseline}
                    onRecordEntry={recordProductionOutput}
                    onRequestReversal={requestProductionReversal}
                    onOpenApprovals={openApprovals}
                    onSyncOutbox={() => syncFieldOutbox({ announce: true })}
                  />
                  <DayworkControl
                    job={selectedJob}
                    canReport={canCoordinate || capabilities.fieldEvidence === true}
                    canCoordinate={canCoordinate}
                    canApprove={capabilities.approvals === true}
                    submitting={submitting}
                    outboxPending={outboxPending}
                    outboxSyncing={outboxSyncing}
                    onSubmit={recordDayworkTicket}
                    onRequestAcknowledgement={requestDayworkAcknowledgement}
                    onConvert={convertDayworkTicket}
                    onOpenApprovals={openApprovals}
                    onSyncOutbox={() => syncFieldOutbox({ announce: true })}
                  />
                  {!fieldScoped ? (
                    <CommercialControl
                      job={selectedJob}
                      canCoordinate={canCoordinate}
                      canApprove={capabilities.approvals === true}
                      submitting={submitting}
                      onNewQuote={() => openCommercialDraft('quote')}
                      onNewChangeOrder={(supersedes) => openCommercialDraft('change_order', supersedes)}
                      onRequestAcceptance={openCommercialAcceptance}
                      onRecordChangeDelivery={openChangeOrderDelivery}
                      onOpenApprovals={openApprovals}
                      onRequestCommercialScope={requestCommercialScopeRevision}
                      onRequestRiskRegister={requestRiskRegisterRevision}
                      onRetainPricingBasis={retainPricingBasisDecision}
                    />
                  ) : null}
                  {!fieldScoped ? (
                    <CapabilitySetupControl
                      job={selectedJob}
                      canCoordinate={canCoordinate}
                      submitting={submitting}
                      onApply={applyCapabilitySetup}
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
                  {!fieldScoped ? (
                    <EnergyPerformanceControl
                      job={selectedJob}
                      canCoordinate={canCoordinate}
                      canApprove={capabilities.approvals === true}
                      submitting={submitting}
                      onSubmit={submitEnergyPerformanceRecord}
                      onOpenApprovals={openApprovals}
                    />
                  ) : null}
                  <PhotoEvidenceControl
                    job={selectedJob}
                    canCoordinate={canCoordinate}
                    canApprove={capabilities.approvals === true}
                    submitting={submitting}
                    onSchedule={schedulePhotoEvidenceSet}
                    onRequestReview={requestPhotoEvidenceReview}
                    onOpenApprovals={openApprovals}
                  />
                  <InspectionChecklistControl
                    job={selectedJob}
                    templates={inspectionTemplates}
                    canCoordinate={canCoordinate}
                    canApprove={capabilities.approvals === true}
                    fieldScoped={fieldScoped}
                    operator={operator}
                    submitting={submitting}
                    onCreateTemplate={createInspectionTemplate}
                    onSchedule={scheduleInspectionChecklist}
                    onSubmit={submitInspectionChecklist}
                    onOpenApprovals={openApprovals}
                  />
                  <NonconformanceControl
                    job={selectedJob}
                    canReport={canCoordinate || capabilities.fieldEvidence === true}
                    canCoordinate={canCoordinate}
                    canApprove={capabilities.approvals === true}
                    fieldScoped={fieldScoped}
                    operator={operator}
                    submitting={submitting}
                    onCreate={createNonconformance}
                    onRequestCorrection={requestNonconformanceCorrection}
                    onRequestClosure={requestNonconformanceClosure}
                    onOpenApprovals={openApprovals}
                  />
                  <FieldRiskControl
                    job={selectedJob}
                    canReport={canCoordinate || capabilities.fieldEvidence === true}
                    canCoordinate={canCoordinate}
                    canApprove={capabilities.approvals === true}
                    fieldScoped={fieldScoped}
                    operator={operator}
                    submitting={submitting}
                    onCreate={createFieldRisk}
                    onReview={openFieldReview}
                    onOpenApprovals={openApprovals}
                  />
                  <CloseoutRegister
                    job={selectedJob}
                    canReportPunch={canCoordinate || capabilities.fieldEvidence === true}
                    canCoordinate={canCoordinate}
                    canApprove={capabilities.approvals === true}
                    fieldScoped={fieldScoped}
                    operator={operator}
                    submitting={submitting}
                    onCreate={createCloseoutRecord}
                    onLifecycle={openJobCloseoutLifecycle}
                    onOpenApprovals={openApprovals}
                  />
                </LazyControlBoundary>
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
                        <label>
                          Portal language
                          <select
                            value={portalDraft.locale}
                            onChange={(event) => setPortalDraft({ ...portalDraft, locale: event.target.value })}
                          >
                            {SUPPORTED_LOCALES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
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
                                  {access.data?.locale === 'en-GB' ? 'EN' : 'NL'} / Expires {formatDate(access.expiresAt)} / {formatStatus(access.status)}
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
      {takeoffDialog?.mode === 'create' ? (
        <div className="modal-backdrop commercial-backdrop" role="presentation">
          <section
            className="modal takeoff-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="takeoff-create-title"
            data-testid="takeoff-create-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeTakeoffDialog()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Measured scope</p>
                <h2 id="takeoff-create-title">New quantity takeoff</h2>
                <p>{selectedJob?.title} / internal draft</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close quantity takeoff" onClick={closeTakeoffDialog}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitTakeoff}>
              <div className="takeoff-modal-body form-grid">
                <label className="form-span">
                  Takeoff title
                  <input
                    autoFocus
                    required
                    minLength="2"
                    maxLength="160"
                    value={takeoffDraft.title}
                    onChange={(event) => setTakeoffDraft({ ...takeoffDraft, title: event.target.value })}
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
                    value={takeoffDraft.taxRate}
                    onChange={(event) => setTakeoffDraft({ ...takeoffDraft, taxRate: event.target.value })}
                  />
                </label>
                <label className="form-span">
                  Internal notes
                  <textarea
                    maxLength="4000"
                    value={takeoffDraft.notes}
                    onChange={(event) => setTakeoffDraft({ ...takeoffDraft, notes: event.target.value })}
                    placeholder="Record drawing revisions, survey assumptions, exclusions, or estimator context."
                  />
                </label>
                <p className="workflow-note form-span">This creates an empty internal measurement sheet. It does not create or issue an estimate.</p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeTakeoffDialog}>Cancel</button>
                <button className="primary-button" disabled={submitting || takeoffDraft.title.trim().length < 2}>
                  <Ruler size={16} />
                  {submitting ? 'Saving...' : 'Retain takeoff'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {['add_item', 'edit_item'].includes(takeoffDialog?.mode) ? (
        <div className="modal-backdrop commercial-backdrop" role="presentation">
          <section
            className="modal takeoff-item-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="takeoff-item-title"
            data-testid="takeoff-item-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeTakeoffDialog()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Server-calculated measurement</p>
                <h2 id="takeoff-item-title">{takeoffDialog.mode === 'edit_item' ? 'Edit measurement' : 'Add measurement'}</h2>
                <p>{takeoffDialog.takeoff.title}</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close takeoff measurement" onClick={closeTakeoffDialog}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitTakeoffItem}>
              <div className="takeoff-modal-body">
                <div className="form-grid takeoff-item-form">
                  <label className="form-span">
                    Description
                    <input
                      autoFocus
                      required
                      minLength="2"
                      maxLength="240"
                      value={takeoffItemDraft.description}
                      onChange={(event) => setTakeoffItemDraft({ ...takeoffItemDraft, description: event.target.value })}
                    />
                  </label>
                  <label>
                    Category
                    <select value={takeoffItemDraft.category} onChange={(event) => setTakeoffItemDraft({ ...takeoffItemDraft, category: event.target.value })}>
                      <option value="material">Material</option>
                      <option value="labor">Labor</option>
                      <option value="equipment">Equipment</option>
                      <option value="subcontract">Subcontract</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label>
                    Measurement type
                    <select value={takeoffItemDraft.measurementType} onChange={(event) => changeTakeoffMeasurementType(event.target.value)}>
                      <option value="count">Count</option>
                      <option value="linear">Linear</option>
                      <option value="area">Area</option>
                      <option value="volume">Volume</option>
                      <option value="manual">Manual quantity</option>
                    </select>
                  </label>
                  {takeoffItemDraft.measurementType === 'manual' ? (
                    <label>
                      Quantity
                      <input required type="number" min="0.0001" max="1000000000" step="0.0001" value={takeoffItemDraft.quantity} onChange={(event) => setTakeoffItemDraft({ ...takeoffItemDraft, quantity: event.target.value })} />
                    </label>
                  ) : (
                    <label>
                      Count
                      <input required type="number" min="0.0001" max="1000000" step="0.0001" value={takeoffItemDraft.count} onChange={(event) => setTakeoffItemDraft({ ...takeoffItemDraft, count: event.target.value })} />
                    </label>
                  )}
                  {['linear', 'area', 'volume'].includes(takeoffItemDraft.measurementType) ? (
                    <label>
                      Length (m)
                      <input required type="number" min="0.0001" max="1000000" step="0.0001" value={takeoffItemDraft.length} onChange={(event) => setTakeoffItemDraft({ ...takeoffItemDraft, length: event.target.value })} />
                    </label>
                  ) : null}
                  {['area', 'volume'].includes(takeoffItemDraft.measurementType) ? (
                    <label>
                      Width (m)
                      <input required type="number" min="0.0001" max="1000000" step="0.0001" value={takeoffItemDraft.width} onChange={(event) => setTakeoffItemDraft({ ...takeoffItemDraft, width: event.target.value })} />
                    </label>
                  ) : null}
                  {takeoffItemDraft.measurementType === 'volume' ? (
                    <label>
                      Height (m)
                      <input required type="number" min="0.0001" max="1000000" step="0.0001" value={takeoffItemDraft.height} onChange={(event) => setTakeoffItemDraft({ ...takeoffItemDraft, height: event.target.value })} />
                    </label>
                  ) : null}
                  <label>
                    Waste (%)
                    <input required type="number" min="0" max="1000" step="0.01" value={takeoffItemDraft.wastePercent} onChange={(event) => setTakeoffItemDraft({ ...takeoffItemDraft, wastePercent: event.target.value })} />
                  </label>
                  <label>
                    Unit
                    <input required maxLength="24" value={takeoffItemDraft.unit} onChange={(event) => setTakeoffItemDraft({ ...takeoffItemDraft, unit: event.target.value })} />
                  </label>
                  <label>
                    Unit cost
                    <input required type="number" min="0" max="1000000000" step="0.01" value={takeoffItemDraft.unitCost} onChange={(event) => setTakeoffItemDraft({ ...takeoffItemDraft, unitCost: event.target.value })} />
                  </label>
                  <label>
                    Unit sell price
                    <input required type="number" min="0" max="1000000000" step="0.01" value={takeoffItemDraft.unitPrice} onChange={(event) => setTakeoffItemDraft({ ...takeoffItemDraft, unitPrice: event.target.value })} />
                  </label>
                  <label>
                    Cost code
                    <input maxLength="80" value={takeoffItemDraft.costCode} onChange={(event) => setTakeoffItemDraft({ ...takeoffItemDraft, costCode: event.target.value })} />
                  </label>
                  <label>
                    WBS code
                    <input
                      required
                      maxLength="80"
                      pattern="[A-Za-z0-9][A-Za-z0-9-]{0,11}(\.[A-Za-z0-9][A-Za-z0-9-]{0,11}){0,7}"
                      title="Use one to eight dot-separated work-breakdown segments, for example 01.20."
                      value={takeoffItemDraft.wbsCode}
                      onChange={(event) => setTakeoffItemDraft({ ...takeoffItemDraft, wbsCode: event.target.value })}
                    />
                  </label>
                  <label>
                    Work package
                    <input
                      required
                      minLength="2"
                      maxLength="120"
                      value={takeoffItemDraft.workPackage}
                      onChange={(event) => setTakeoffItemDraft({ ...takeoffItemDraft, workPackage: event.target.value })}
                    />
                  </label>
                  <label>
                    Drawing / source reference
                    <input maxLength="240" value={takeoffItemDraft.sourceReference} onChange={(event) => setTakeoffItemDraft({ ...takeoffItemDraft, sourceReference: event.target.value })} />
                  </label>
                </div>
                <div className="takeoff-preview" aria-label="Calculated measurement preview">
                  <div><span>Quantity</span><strong>{takeoffPreviewQuantity || 0} {takeoffItemDraft.unit}</strong></div>
                  <div><span>Extended cost</span><strong>{currency.format(takeoffPreviewCost)}</strong></div>
                  <div><span>Extended sell</span><strong>{currency.format(takeoffPreviewSell)}</strong></div>
                </div>
                <p className="workflow-note">The ledger recalculates quantity, cost, and sell totals. Browser preview values are not authoritative.</p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeTakeoffDialog}>Cancel</button>
                <button className="primary-button" disabled={submitting || !takeoffItemDraftReady}>
                  <Ruler size={16} />
                  {submitting ? 'Saving...' : takeoffDialog.mode === 'edit_item' ? 'Recalculate measurement' : 'Retain measurement'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {takeoffDialog?.mode === 'remove_item' ? (
        <div className="modal-backdrop commercial-backdrop" role="presentation">
          <section
            className="modal takeoff-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="takeoff-remove-title"
            data-testid="takeoff-remove-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeTakeoffDialog()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Draft correction</p>
                <h2 id="takeoff-remove-title">Remove measurement?</h2>
                <p>{takeoffDialog.item.description}</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close measurement removal" onClick={closeTakeoffDialog}><X size={18} /></button>
            </div>
            <div className="takeoff-modal-body">
              <p className="workflow-note">The draft sheet will be recalculated. This does not affect any converted estimate.</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={closeTakeoffDialog}>Cancel</button>
              <button type="button" className="danger-button" disabled={submitting} onClick={removeTakeoffItem}>
                <X size={16} />
                {submitting ? 'Removing...' : 'Remove measurement'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {takeoffDialog?.mode === 'convert' ? (
        <div className="modal-backdrop commercial-backdrop" role="presentation">
          <section
            className="modal takeoff-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="takeoff-convert-title"
            data-testid="takeoff-convert-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeTakeoffDialog()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Immutable estimate basis</p>
                <h2 id="takeoff-convert-title">Prepare estimate</h2>
                <p>{takeoffDialog.takeoff.title}</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close estimate preparation" onClick={closeTakeoffDialog}><X size={18} /></button>
            </div>
            <form onSubmit={convertTakeoff}>
              <div className="takeoff-modal-body">
                <div className="commercial-draft-pricing" data-testid="takeoff-conversion-pricing-basis">
                  <GitBranch size={16} />
                  <div>
                    <strong>{formatStatus(selectedJob?.pricingBasis?.currentDecision?.selectedModel || 'review')}</strong>
                    <span>Decision v{selectedJob?.pricingBasis?.currentDecision?.versionNumber || '-'} / {selectedJob?.pricingBasis?.currentDecision?.score || 0}% fixed-price readiness / source current</span>
                  </div>
                </div>
                <div className="takeoff-preview takeoff-convert-preview">
                  <div><span>Work packages</span><strong>{takeoffDialog.takeoff.workBreakdown?.packageCount || 0}</strong></div>
                  <div><span>Measurements</span><strong>{takeoffDialog.takeoff.itemCount}</strong></div>
                  <div><span>Cost</span><strong>{currency.format(takeoffDialog.takeoff.totalCost || 0)}</strong></div>
                  <div><span>Estimate net</span><strong>{currency.format(takeoffDialog.takeoff.subtotal || 0)}</strong></div>
                </div>
                <div className="form-grid">
                  <label>
                    Valid until
                    <input autoFocus required type="date" min={new Date().toISOString().slice(0, 10)} value={takeoffConversionDraft.validUntil} onChange={(event) => setTakeoffConversionDraft({ ...takeoffConversionDraft, validUntil: event.target.value })} />
                  </label>
                  <label className="form-span">
                    Estimate notes
                    <textarea maxLength="4000" value={takeoffConversionDraft.notes} onChange={(event) => setTakeoffConversionDraft({ ...takeoffConversionDraft, notes: event.target.value })} placeholder="Add reviewer context, exclusions, or estimate assumptions." />
                  </label>
                </div>
                <p className="workflow-note">Conversion seals the WBS, measurements, and package rollups with a SHA-256 snapshot and makes them read-only. It creates an internal quote approval only.</p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeTakeoffDialog}>Cancel</button>
                <button className="primary-button" disabled={submitting || !takeoffConversionDraft.validUntil}>
                  <ShieldCheck size={16} />
                  {submitting ? 'Preparing...' : 'Seal and prepare estimate'}
                </button>
              </div>
            </form>
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
                <h2 id="commercial-draft-title">
                  {commercialDraftMode === 'quote'
                    ? selectedJob?.pricingBasis?.currentDecision?.selectedModel === 'time_and_materials' ? 'New T&M budget estimate' : 'New fixed-price estimate'
                    : 'New scope change'}
                </h2>
                <p>{selectedJob?.title} / server-derived totals</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close commercial draft" onClick={closeCommercialDialog}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitCommercialDraft}>
              <div className="commercial-draft-body">
                {commercialDraftMode === 'quote' ? (
                  <>
                    <div className="commercial-draft-pricing" data-testid="commercial-draft-scope">
                      <ClipboardList size={16} />
                      <div>
                        <strong>{selectedJob?.commercialScope?.currentRevision?.title || 'Commercial scope required'}</strong>
                        <span>
                          Revision v{selectedJob?.commercialScope?.currentRevision?.versionNumber || '-'} / {selectedJob?.commercialScope?.currentRevision?.snapshot?.inclusions?.length || 0} inclusions / {selectedJob?.commercialScope?.currentRevision?.snapshot?.exclusions?.length || 0} exclusions / {selectedJob?.commercialScope?.currentRevision?.snapshot?.allowances?.length || 0} allowances / source current
                        </span>
                      </div>
                    </div>
                    <div className="commercial-draft-pricing" data-testid="commercial-draft-pricing-basis">
                      <GitBranch size={16} />
                      <div>
                        <strong>{formatStatus(selectedJob?.pricingBasis?.currentDecision?.selectedModel || 'review')}</strong>
                        <span>
                          {selectedJob?.pricingBasis?.currentDecision?.selectedModel === 'time_and_materials'
                            ? 'Amounts form a budget estimate; actual billing requires retained time, material, rate, and work evidence.'
                            : 'The price applies to the stated scope, assumptions, exclusions, and allowances; approved changes remain separate.'}
                        </span>
                      </div>
                    </div>
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
                  </>
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
                    {changeOrderDraft.supersedesChangeOrderId ? (
                      <div className="form-span commercial-source-notice" role="status">
                        <ShieldCheck size={16} />Preparing the next formal revision of the client-returned variation. The prior revision is superseded only after this revision is approved.
                      </div>
                    ) : null}
                    <label>
                      Variation type
                      <select value={changeOrderDraft.variationType} onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, variationType: event.target.value })}>
                        <option value="client_request">Client request</option>
                        <option value="design_change">Design change</option>
                        <option value="unforeseen_condition">Unforeseen condition</option>
                        <option value="regulatory_change">Regulatory change</option>
                        <option value="allowance_reconciliation">Allowance reconciliation</option>
                        <option value="contractor_proposal">Contractor proposal</option>
                        <option value="error_correction">Error correction</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label>
                      Initiated by
                      <select value={changeOrderDraft.initiatedBy} onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, initiatedBy: event.target.value })}>
                        <option value="client">Client</option>
                        <option value="contractor">Contractor</option>
                        <option value="designer">Designer</option>
                        <option value="authority">Authority</option>
                        <option value="supplier">Supplier</option>
                        <option value="site_condition">Site condition</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="form-span">
                      Cause
                      <textarea required minLength="8" maxLength="2000" value={changeOrderDraft.cause} onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, cause: event.target.value })} placeholder="What event or instruction created this variation?" />
                    </label>
                    <label className="form-span">
                      Contractual justification
                      <textarea required minLength="8" maxLength="2000" value={changeOrderDraft.justification} onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, justification: event.target.value })} placeholder="Why is this outside or different from the retained contract scope?" />
                    </label>
                    <label>
                      Reference quote
                      <select
                        value={changeOrderDraft.quoteId}
                        onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, quoteId: event.target.value })}
                      >
                        <option value="">Current retained contract</option>
                        {(selectedJob?.quotes || [])
                          .filter((quote) => quote.status === 'accepted')
                          .map((quote) => (
                            <option key={quote.id} value={quote.id}>
                              {formatStatus(quote.status)} / {currency.format(quote.subtotal || 0)} net
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Contract / clause reference
                      <input required minLength="3" maxLength="240" value={changeOrderDraft.contractReference} onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, contractReference: event.target.value })} />
                    </label>
                    <label>
                      Notice reference
                      <input maxLength="240" value={changeOrderDraft.noticeReference} onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, noticeReference: event.target.value })} placeholder="Instruction, RFI, email, or notice ID" />
                    </label>
                    <label>
                      If no notice, explain why
                      <input required={!changeOrderDraft.noticeReference.trim()} minLength="8" maxLength="500" value={changeOrderDraft.noticeNotApplicableReason} onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, noticeNotApplicableReason: event.target.value })} />
                    </label>
                    <label>
                      Requested on
                      <input required type="date" value={changeOrderDraft.requestedAt} onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, requestedAt: event.target.value })} />
                    </label>
                    <label>
                      Response due
                      <input type="date" min={changeOrderDraft.requestedAt} value={changeOrderDraft.responseDueAt} onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, responseDueAt: event.target.value })} />
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
                    <label className="form-span">
                      Schedule impact basis
                      <textarea required minLength="8" maxLength="2000" value={changeOrderDraft.scheduleImpactNarrative} onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, scheduleImpactNarrative: event.target.value })} placeholder="Explain the proposed effect or why no date change is needed." />
                    </label>
                    <label>
                      Risk impact
                      <select aria-label="Risk impact" value={changeOrderDraft.riskImpact} onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, riskImpact: event.target.value })}>
                        <option value="none">None</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
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
                    <label className="form-span">
                      Risk impact statement
                      <textarea required minLength="8" maxLength="2000" value={changeOrderDraft.riskImpactStatement} onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, riskImpactStatement: event.target.value })} />
                    </label>
                    <label>
                      Assumptions (one per line)
                      <textarea required value={changeOrderDraft.assumptions} onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, assumptions: event.target.value })} />
                    </label>
                    <label>
                      Exclusions (one per line)
                      <textarea required value={changeOrderDraft.exclusions} onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, exclusions: event.target.value })} />
                    </label>
                    <label className="form-span">
                      Evidence references (one per line)
                      <textarea value={changeOrderDraft.evidenceReferences} onChange={(event) => setChangeOrderDraft({ ...changeOrderDraft, evidenceReferences: event.target.value })} placeholder="Drawing revision, instruction, site photo, RFI, or retained document reference" />
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
                    {commercialDraftMode === 'quote' && selectedJob?.pricingBasis?.currentDecision?.selectedModel === 'time_and_materials' ? 'Budget net' : 'Net'} <strong>{currency.format(commercialDraftNet)}</strong>
                  </span>
                  <span>
                    VAT <strong>{currency.format(commercialDraftTax)}</strong>
                  </span>
                  <span>
                    {commercialDraftMode === 'quote' && selectedJob?.pricingBasis?.currentDecision?.selectedModel === 'time_and_materials' ? 'Budget gross' : 'Gross'} <strong>{currency.format(commercialDraftTotal)}</strong>
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
                  {submitting
                    ? 'Saving...'
                    : commercialDraftMode === 'quote'
                      ? selectedJob?.pricingBasis?.currentDecision?.selectedModel === 'time_and_materials' ? 'Retain T&M budget' : 'Retain fixed-price estimate'
                      : 'Request change approval'}
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

      {commercialDelivery ? (
        <div className="modal-backdrop commercial-backdrop" role="presentation">
          <section
            className="modal commercial-delivery-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="commercial-delivery-title"
            data-testid="commercial-delivery-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeCommercialDialog()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Verified delivery evidence</p>
                <h2 id="commercial-delivery-title">Record change-order delivery</h2>
                <p>
                  {commercialDelivery.changeOrder.data?.issuePackage?.issueReference || commercialDelivery.changeOrder.title} /{' '}
                  {commercialDelivery.communication.data?.recipient}
                </p>
              </div>
              <button type="button" className="icon-button" aria-label="Close change-order delivery" onClick={closeCommercialDialog}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitChangeOrderDelivery}>
              <div className="form-grid commercial-acceptance-form">
                <label>
                  Configured integration ID
                  <input
                    autoFocus
                    required
                    minLength="2"
                    maxLength="120"
                    value={commercialDeliveryDraft.integration}
                    onChange={(event) =>
                      setCommercialDeliveryDraft({ ...commercialDeliveryDraft, integration: event.target.value })
                    }
                    placeholder="verified_client_gateway"
                  />
                </label>
                <label>
                  Provider message ID
                  <input
                    required
                    minLength="3"
                    maxLength="240"
                    value={commercialDeliveryDraft.providerMessageId}
                    onChange={(event) =>
                      setCommercialDeliveryDraft({ ...commercialDeliveryDraft, providerMessageId: event.target.value })
                    }
                    placeholder="provider-change-000123"
                  />
                </label>
                <label>
                  Provider sent at
                  <input
                    required
                    type="datetime-local"
                    value={commercialDeliveryDraft.sentAt}
                    onChange={(event) => setCommercialDeliveryDraft({ ...commercialDeliveryDraft, sentAt: event.target.value })}
                  />
                </label>
                <p className="workflow-note form-span">
                  Record this only after the configured provider returns evidence for the approved recipient and exact package. Delivery
                  does not authorize the work or alter contract value.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" disabled={submitting} onClick={closeCommercialDialog}>
                  Cancel
                </button>
                <button
                  className="primary-button"
                  disabled={
                    submitting ||
                    commercialDeliveryDraft.integration.trim().length < 2 ||
                    commercialDeliveryDraft.providerMessageId.trim().length < 3 ||
                    !commercialDeliveryDraft.sentAt
                  }
                >
                  <MailCheck size={15} /> {submitting ? 'Recording...' : 'Record verified receipt'}
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
                  Client segment
                  <input
                    value={opportunityDraft.clientSegment}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, clientSegment: event.target.value })}
                    placeholder="Homeowner, housing association..."
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
                <label>
                  Postal code
                  <input
                    value={opportunityDraft.postalCode}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, postalCode: event.target.value })}
                    placeholder="6811 AA"
                  />
                </label>
                <label>
                  Country
                  <input
                    value={opportunityDraft.country}
                    onChange={(event) => setOpportunityDraft({ ...opportunityDraft, country: event.target.value })}
                    placeholder="NL"
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

      {bidPackageEditor ? (
        <div className="modal-backdrop bid-package-backdrop" role="presentation">
          <section className="modal bid-package-modal" role="dialog" aria-modal="true" aria-labelledby="bid-package-modal-title" data-testid="bid-package-modal">
            <div className="modal-heading">
              <div>
                <h2 id="bid-package-modal-title">New bid package</h2>
                <p>Retain an internal tender comparison. No invitations are sent from this workflow.</p>
              </div>
              <button className="icon-button" aria-label="Close bid package" onClick={() => setBidPackageEditor(false)}><X size={18} /></button>
            </div>
            <form onSubmit={submitBidPackage}>
              <div className="form-grid bid-package-form">
                <label className="form-span">
                  Opportunity
                  <select required value={bidPackageDraft.opportunityId} onChange={(event) => setBidPackageDraft({ ...bidPackageDraft, opportunityId: event.target.value })}>
                    <option value="">Select an open opportunity</option>
                    {(data.opportunities || EMPTY_LIST).filter((opportunity) => !['won', 'lost', 'archived'].includes(opportunity.stage)).map((opportunity) => (
                      <option key={opportunity.id} value={opportunity.id}>{opportunity.title} / {opportunity.client?.name || 'Client pending'}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Package title
                  <input required minLength="2" value={bidPackageDraft.title} onChange={(event) => setBidPackageDraft({ ...bidPackageDraft, title: event.target.value })} placeholder="Electrical installation package" />
                </label>
                <label>
                  Trade
                  <input required minLength="2" value={bidPackageDraft.trade} onChange={(event) => setBidPackageDraft({ ...bidPackageDraft, trade: event.target.value })} placeholder="Electrical" />
                </label>
                <label>
                  Return due
                  <input required type="date" min={futureDateInput(1)} value={bidPackageDraft.dueAt} onChange={(event) => setBidPackageDraft({ ...bidPackageDraft, dueAt: event.target.value })} />
                </label>
                <label>
                  Owner
                  <input value={bidPackageDraft.ownerName} onChange={(event) => setBidPackageDraft({ ...bidPackageDraft, ownerName: event.target.value })} />
                </label>
                <label className="form-span">
                  Scope
                  <textarea required minLength="5" value={bidPackageDraft.scope} onChange={(event) => setBidPackageDraft({ ...bidPackageDraft, scope: event.target.value })} placeholder="Retained scope, interfaces, evidence, assumptions, and return requirements." />
                </label>
                <fieldset className="form-span bid-partner-picker">
                  <legend>Internal bidder list</legend>
                  {(data.tradePartners || EMPTY_LIST).filter((partner) => partner.status === 'active').length ? (
                    <div>
                      {(data.tradePartners || EMPTY_LIST).filter((partner) => partner.status === 'active').map((partner) => (
                        <label key={partner.id}>
                          <input
                            type="checkbox"
                            checked={bidPackageDraft.tradePartnerIds.includes(partner.id)}
                            onChange={(event) => setBidPackageDraft({
                              ...bidPackageDraft,
                              tradePartnerIds: event.target.checked
                                ? [...bidPackageDraft.tradePartnerIds, partner.id]
                                : bidPackageDraft.tradePartnerIds.filter((id) => id !== partner.id),
                            })}
                          />
                          <span><strong>{partner.name}</strong><small>{formatStatus(partner.partnerType)} / {formatStatus(partner.compliance?.status)}</small></span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p>No active trade partners are retained. Add and verify partners in Resources first.</p>
                  )}
                </fieldset>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setBidPackageEditor(false)}>Cancel</button>
                <button className="primary-button" disabled={submitting || !bidPackageDraft.opportunityId || bidPackageDraft.title.trim().length < 2 || bidPackageDraft.trade.trim().length < 2 || bidPackageDraft.scope.trim().length < 5 || !bidPackageDraft.tradePartnerIds.length}>
                  {submitting ? 'Saving...' : 'Retain bid package'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {bidPackageAction?.type === 'return' ? (
        <div className="modal-backdrop bid-package-backdrop" role="presentation">
          <section className="modal bid-return-modal" role="dialog" aria-modal="true" aria-labelledby="bid-return-modal-title" data-testid="bid-return-modal">
            <div className="modal-heading">
              <div>
                <h2 id="bid-return-modal-title">Record bid return</h2>
                <p>{bidPackageAction.participant.partner?.name} / {bidPackageAction.bidPackage.packageNumber}</p>
              </div>
              <button className="icon-button" aria-label="Close bid return" onClick={() => setBidPackageAction(null)}><X size={18} /></button>
            </div>
            <form onSubmit={submitBidReturn}>
              <div className="form-grid bid-return-form">
                <label>
                  Net amount
                  <input required type="number" min="0.01" step="0.01" value={bidReturnDraft.netAmount} onChange={(event) => setBidReturnDraft({ ...bidReturnDraft, netAmount: event.target.value })} />
                </label>
                <label>
                  VAT rate
                  <input required type="number" min="0" max="100" step="0.01" value={bidReturnDraft.taxRate} onChange={(event) => setBidReturnDraft({ ...bidReturnDraft, taxRate: event.target.value })} />
                </label>
                <label>
                  Received date
                  <input required type="date" max={futureDateInput(1)} value={bidReturnDraft.receivedAt} onChange={(event) => setBidReturnDraft({ ...bidReturnDraft, receivedAt: event.target.value })} />
                </label>
                <label>
                  Valid until
                  <input type="date" min={bidReturnDraft.receivedAt || futureDateInput(0)} value={bidReturnDraft.validUntil} onChange={(event) => setBidReturnDraft({ ...bidReturnDraft, validUntil: event.target.value })} />
                </label>
                <label>
                  Duration days
                  <input type="number" min="0" max="3650" step="1" value={bidReturnDraft.durationDays} onChange={(event) => setBidReturnDraft({ ...bidReturnDraft, durationDays: event.target.value })} />
                </label>
                <label>
                  Evidence reference
                  <input required minLength="3" value={bidReturnDraft.evidenceReference} onChange={(event) => setBidReturnDraft({ ...bidReturnDraft, evidenceReference: event.target.value })} placeholder="Email, document or receipt reference" />
                </label>
                <label className="form-span">
                  Exclusions
                  <textarea value={bidReturnDraft.exclusions} onChange={(event) => setBidReturnDraft({ ...bidReturnDraft, exclusions: event.target.value })} placeholder="One exclusion per line" />
                </label>
                <label className="form-span">
                  Qualifications
                  <textarea value={bidReturnDraft.qualifications} onChange={(event) => setBidReturnDraft({ ...bidReturnDraft, qualifications: event.target.value })} placeholder="One qualification per line" />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setBidPackageAction(null)}>Cancel</button>
                <button className="primary-button" disabled={submitting || Number(bidReturnDraft.netAmount) <= 0 || bidReturnDraft.evidenceReference.trim().length < 3}>
                  {submitting ? 'Saving...' : 'Retain return evidence'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {bidPackageAction?.type === 'selection' ? (
        <div className="modal-backdrop bid-package-backdrop" role="presentation">
          <section className="modal bid-selection-modal" role="dialog" aria-modal="true" aria-labelledby="bid-selection-modal-title" data-testid="bid-selection-modal">
            <div className="modal-heading">
              <div>
                <h2 id="bid-selection-modal-title">Request preferred-bidder approval</h2>
                <p>{bidPackageAction.participant.partner?.name} / {currency.format(bidPackageAction.participant.total || 0)}</p>
              </div>
              <button className="icon-button" aria-label="Close bid selection" onClick={() => setBidPackageAction(null)}><X size={18} /></button>
            </div>
            <form onSubmit={submitBidSelection}>
              <div className="bid-selection-review">
                <div><span>Package</span><strong>{bidPackageAction.bidPackage.packageNumber} / {bidPackageAction.bidPackage.title}</strong></div>
                <div><span>Comparison</span><strong>{bidPackageAction.bidPackage.comparison.returned} return(s), {currency.format(bidPackageAction.bidPackage.comparison.spread || 0)} spread</strong></div>
                <div><span>Safeguard</span><strong>Approval records preference only; it cannot award, order, spend, or send.</strong></div>
              </div>
              <div className="form-grid bid-selection-form">
                <label className="form-span">
                  Selection rationale
                  <textarea required minLength="8" maxLength="1000" value={bidSelectionRationale} onChange={(event) => setBidSelectionRationale(event.target.value)} placeholder="Compare price, scope, exclusions, programme, quality, risk, and compliance." />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setBidPackageAction(null)}>Cancel</button>
                <button className="primary-button" disabled={submitting || bidSelectionRationale.trim().length < 8}>
                  {submitting ? 'Requesting...' : 'Request selection approval'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {bidPackageAction?.type === 'commitment' ? (
        <div className="modal-backdrop bid-package-backdrop" role="presentation">
          <section
            className="modal bid-commitment-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bid-commitment-modal-title"
            data-testid="bid-commitment-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !submitting) setBidPackageAction(null)
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Selected-bid control</p>
                <h2 id="bid-commitment-modal-title">Prepare purchasing commitment</h2>
                <p>{bidPackageAction.bidPackage.packageNumber} / {bidPackageAction.bidPackage.selectedParticipant?.partner?.name}</p>
              </div>
              <button className="icon-button" aria-label="Close purchasing commitment" onClick={() => setBidPackageAction(null)}><X size={18} /></button>
            </div>
            <form onSubmit={submitBidCommitment}>
              <div className="bid-commitment-review">
                <div><span>Selected net</span><strong>{currency.format(bidPackageAction.bidPackage.selectedParticipant?.netAmount || 0)}</strong></div>
                <div><span>VAT / gross</span><strong>{bidPackageAction.bidPackage.selectedParticipant?.taxRate || 0}% / {currency.format(bidPackageAction.bidPackage.selectedParticipant?.total || 0)}</strong></div>
                <div><span>Scope</span><strong>{bidPackageAction.bidPackage.scope}</strong></div>
                <div><span>Source</span><strong>{bidPackageAction.bidPackage.selectedParticipant?.evidenceReference}</strong></div>
              </div>
              <div className="form-grid bid-commitment-form">
                <label>
                  Required by
                  <input autoFocus required type="date" min={futureDateInput(1)} value={bidCommitmentDraft.requiredBy} onChange={(event) => setBidCommitmentDraft({ ...bidCommitmentDraft, requiredBy: event.target.value })} />
                </label>
                <label>
                  Cost code
                  <input required minLength="2" maxLength="80" value={bidCommitmentDraft.costCode} onChange={(event) => setBidCommitmentDraft({ ...bidCommitmentDraft, costCode: event.target.value })} />
                </label>
                <label className="form-span">
                  Purchasing notes
                  <textarea maxLength="4000" value={bidCommitmentDraft.notes} onChange={(event) => setBidCommitmentDraft({ ...bidCommitmentDraft, notes: event.target.value })} placeholder="Record interfaces, required evidence, exclusions, qualifications, and reviewer context." />
                </label>
                <p className="workflow-note form-span">
                  The selected return, scope, exclusions, qualifications, partner, amount, date, and cost code will be frozen behind SHA-256 verification. This creates an internal approval only; it cannot contact the supplier, issue an award or order, sign a subcontract, or move money.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" disabled={submitting} onClick={() => setBidPackageAction(null)}>Cancel</button>
                <button className="primary-button" disabled={submitting || !bidCommitmentDraft.requiredBy || bidCommitmentDraft.costCode.trim().length < 2}>
                  <ShieldCheck size={15} /> {submitting ? 'Preparing...' : 'Freeze and request approval'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {bidPackageAction?.type === 'order_package' ? (
        <div className="modal-backdrop bid-package-backdrop" role="presentation">
          <section
            className="modal bid-order-package-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bid-order-package-modal-title"
            data-testid="bid-order-package-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !submitting) setBidPackageAction(null)
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Controlled order issue</p>
                <h2 id="bid-order-package-modal-title">Prepare purchase-order package</h2>
                <p>{bidPackageAction.bidPackage.packageNumber} / {bidPackageAction.bidPackage.commitment?.purchaseOrder?.supplier}</p>
              </div>
              <button className="icon-button" aria-label="Close purchase-order package" onClick={() => setBidPackageAction(null)}><X size={18} /></button>
            </div>
            <form onSubmit={submitBidOrderPackage}>
              <div className="bid-commitment-review">
                <div><span>Approved net</span><strong>{currency.format(bidPackageAction.bidPackage.commitment?.purchaseOrder?.amount || 0)}</strong></div>
                <div><span>Required by</span><strong>{formatDate(bidPackageAction.bidPackage.commitment?.purchaseOrder?.requiredBy)}</strong></div>
                <div><span>Source</span><strong>{bidPackageAction.bidPackage.commitment?.purchaseOrder?.data?.source?.terms?.costCode || 'SUBCONTRACT'}</strong></div>
                <div><span>Integrity</span><strong>{bidPackageAction.bidPackage.commitment?.integrityValid ? 'Current source verified' : 'Source verification failed'}</strong></div>
              </div>
              <div className="form-grid bid-commitment-form">
                <label>
                  Supplier recipient
                  <input
                    autoFocus
                    required
                    type="email"
                    value={bidOrderDraft.recipient}
                    onChange={(event) => setBidOrderDraft({ ...bidOrderDraft, recipient: event.target.value })}
                    placeholder="orders@supplier.example"
                  />
                </label>
                <label>
                  Delivery channel
                  <select value={bidOrderDraft.channel} onChange={(event) => setBidOrderDraft({ ...bidOrderDraft, channel: event.target.value })}>
                    <option value="email">Email integration</option>
                    <option value="supplier_portal">Supplier portal integration</option>
                  </select>
                </label>
                <p className="workflow-note form-span">
                  This freezes a durable PO number plus human-readable HTML and generic OASIS UBL 2.1 Order attachments. It creates a separate transmission approval and does not send, certify Peppol delivery, sign a subcontract, or move money.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" disabled={submitting} onClick={() => setBidPackageAction(null)}>Cancel</button>
                <button className="primary-button" disabled={submitting || !bidOrderDraft.recipient.trim()}>
                  <PackageCheck size={15} /> {submitting ? 'Preparing...' : 'Freeze package and request approval'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {bidPackageAction?.type === 'order_delivery' ? (
        <div className="modal-backdrop bid-package-backdrop" role="presentation">
          <section
            className="modal bid-order-delivery-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bid-order-delivery-modal-title"
            data-testid="bid-order-delivery-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !submitting) setBidPackageAction(null)
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Verified delivery evidence</p>
                <h2 id="bid-order-delivery-modal-title">Record provider receipt</h2>
                <p>{bidPackageAction.bidPackage.commitment?.issuePackage?.issueReference} / {bidPackageAction.bidPackage.commitment?.issuePackage?.communication?.data?.recipient}</p>
              </div>
              <button className="icon-button" aria-label="Close provider receipt" onClick={() => setBidPackageAction(null)}><X size={18} /></button>
            </div>
            <form onSubmit={submitBidOrderDelivery}>
              <div className="form-grid bid-commitment-form">
                <label>
                  Configured integration ID
                  <input
                    autoFocus
                    required
                    minLength="2"
                    maxLength="120"
                    value={bidOrderDeliveryDraft.integration}
                    onChange={(event) => setBidOrderDeliveryDraft({ ...bidOrderDeliveryDraft, integration: event.target.value })}
                    placeholder="verified_supplier_gateway"
                  />
                </label>
                <label>
                  Provider message ID
                  <input
                    required
                    minLength="3"
                    maxLength="240"
                    value={bidOrderDeliveryDraft.providerMessageId}
                    onChange={(event) => setBidOrderDeliveryDraft({ ...bidOrderDeliveryDraft, providerMessageId: event.target.value })}
                    placeholder="provider-order-000123"
                  />
                </label>
                <label>
                  Provider sent at
                  <input
                    required
                    type="datetime-local"
                    value={bidOrderDeliveryDraft.sentAt}
                    onChange={(event) => setBidOrderDeliveryDraft({ ...bidOrderDeliveryDraft, sentAt: event.target.value })}
                  />
                </label>
                <p className="workflow-note form-span">
                  Record this only after the configured provider has returned delivery evidence for the approved recipient and package. This action marks the purchase order as externally committed; it does not perform the delivery itself or initiate payment.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" disabled={submitting} onClick={() => setBidPackageAction(null)}>Cancel</button>
                <button className="primary-button" disabled={submitting || bidOrderDeliveryDraft.integration.trim().length < 2 || bidOrderDeliveryDraft.providerMessageId.trim().length < 3 || !bidOrderDeliveryDraft.sentAt}>
                  <MailCheck size={15} /> {submitting ? 'Recording...' : 'Record verified receipt'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {bidPackageAction?.type === 'add_participants' ? (
        <div className="modal-backdrop bid-package-backdrop" role="presentation">
          <section className="modal bid-add-participants-modal" role="dialog" aria-modal="true" aria-labelledby="bid-add-participants-title" data-testid="bid-add-participants-modal">
            <div className="modal-heading">
              <div>
                <h2 id="bid-add-participants-title">Add internal bidders</h2>
                <p>{bidPackageAction.bidPackage.packageNumber} / no invitation or message will be sent</p>
              </div>
              <button className="icon-button" aria-label="Close add bidders" onClick={() => setBidPackageAction(null)}><X size={18} /></button>
            </div>
            <form onSubmit={submitBidParticipants}>
              <fieldset className="bid-partner-picker bid-add-partner-picker">
                <legend>Available trade partners</legend>
                <div>
                  {(data.tradePartners || EMPTY_LIST)
                    .filter((partner) => partner.status === 'active' && !bidPackageAction.bidPackage.participants.some((participant) => participant.tradePartnerId === partner.id))
                    .map((partner) => (
                      <label key={partner.id}>
                        <input
                          type="checkbox"
                          checked={bidAddPartnerIds.includes(partner.id)}
                          onChange={(event) => setBidAddPartnerIds((current) => event.target.checked ? [...current, partner.id] : current.filter((id) => id !== partner.id))}
                        />
                        <span><strong>{partner.name}</strong><small>{formatStatus(partner.partnerType)} / {formatStatus(partner.compliance?.status)}</small></span>
                      </label>
                    ))}
                </div>
              </fieldset>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setBidPackageAction(null)}>Cancel</button>
                <button className="primary-button" disabled={submitting || !bidAddPartnerIds.length}>{submitting ? 'Adding...' : 'Add bidders internally'}</button>
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
      {materialReceiptEditor ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal material-receipt-modal" role="dialog" aria-modal="true" aria-labelledby="material-receipt-title" data-testid="material-receipt-modal">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Immutable goods-receipt evidence</p>
                <h2 id="material-receipt-title">Record material delivery</h2>
                <p>Accepted quantities update material readiness; every exception remains visible to operations and finance.</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close material receipt" onClick={closeMaterialReceiptEditor}><X size={18} /></button>
            </div>
            <form onSubmit={saveMaterialReceipt}>
              <div className="form-grid">
                <label>
                  Job
                  <select required disabled={Boolean(materialReceiptDraft.purchaseOrderId)} value={materialReceiptDraft.jobId} onChange={(event) => setMaterialReceiptDraft({ ...materialReceiptDraft, jobId: event.target.value })}>
                    <option value="">Select an active job</option>
                    {activeJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
                  </select>
                </label>
                <label>
                  Delivery-note reference
                  <input autoFocus required minLength="3" maxLength="160" value={materialReceiptDraft.receiptReference} onChange={(event) => setMaterialReceiptDraft({ ...materialReceiptDraft, receiptReference: event.target.value })} />
                </label>
                <label>
                  Delivered at
                  <input required type="datetime-local" max={toLocalDateTimeInput(new Date())} value={materialReceiptDraft.deliveredAt} onChange={(event) => setMaterialReceiptDraft({ ...materialReceiptDraft, deliveredAt: event.target.value })} />
                </label>
                <label>
                  Received by
                  <input required minLength="2" maxLength="160" value={materialReceiptDraft.receivedBy} onChange={(event) => setMaterialReceiptDraft({ ...materialReceiptDraft, receivedBy: event.target.value })} />
                </label>
                <label>
                  Location
                  <input maxLength="240" value={materialReceiptDraft.location} onChange={(event) => setMaterialReceiptDraft({ ...materialReceiptDraft, location: event.target.value })} />
                </label>
                <label className="form-span">
                  Evidence reference
                  <input required minLength="3" maxLength="240" value={materialReceiptDraft.evidenceReference} onChange={(event) => setMaterialReceiptDraft({ ...materialReceiptDraft, evidenceReference: event.target.value })} placeholder="Signed ticket, photo, or private document reference" />
                </label>
                <div className="form-span material-receipt-lines">
                  <div className="panel-heading">
                    <div><h3>Delivered lines</h3><p>Accepted plus damaged cannot exceed the physically received quantity.</p></div>
                    <button type="button" className="secondary-button" onClick={() => setMaterialReceiptDraft({ ...materialReceiptDraft, lines: [...materialReceiptDraft.lines, emptyMaterialReceiptLine()] })}><Plus size={15} /> Add line</button>
                  </div>
                  {materialReceiptDraft.lines.map((line, index) => (
                    <div className="form-grid material-receipt-line" key={`${line.lineKey || 'manual'}-${index}`}>
                      <label>Item<input required minLength="2" maxLength="240" value={line.itemName} onChange={(event) => setMaterialReceiptDraft({ ...materialReceiptDraft, lines: materialReceiptDraft.lines.map((item, itemIndex) => itemIndex === index ? { ...item, itemName: event.target.value } : item) })} /></label>
                      <label>Unit<input required maxLength="40" value={line.unit} onChange={(event) => setMaterialReceiptDraft({ ...materialReceiptDraft, lines: materialReceiptDraft.lines.map((item, itemIndex) => itemIndex === index ? { ...item, unit: event.target.value } : item) })} /></label>
                      <label>Received<input required type="number" min="0.000001" step="any" value={line.receivedQuantity} onChange={(event) => setMaterialReceiptDraft({ ...materialReceiptDraft, lines: materialReceiptDraft.lines.map((item, itemIndex) => itemIndex === index ? { ...item, receivedQuantity: event.target.value } : item) })} /></label>
                      <label>Accepted<input required type="number" min="0" step="any" value={line.acceptedQuantity} onChange={(event) => setMaterialReceiptDraft({ ...materialReceiptDraft, lines: materialReceiptDraft.lines.map((item, itemIndex) => itemIndex === index ? { ...item, acceptedQuantity: event.target.value } : item) })} /></label>
                      <label>Damaged<input required type="number" min="0" step="any" value={line.damagedQuantity} onChange={(event) => setMaterialReceiptDraft({ ...materialReceiptDraft, lines: materialReceiptDraft.lines.map((item, itemIndex) => itemIndex === index ? { ...item, damagedQuantity: event.target.value } : item) })} /></label>
                      {materialReceiptDraft.lines.length > 1 ? <button type="button" className="icon-button" title="Remove line" aria-label={`Remove delivery line ${index + 1}`} onClick={() => setMaterialReceiptDraft({ ...materialReceiptDraft, lines: materialReceiptDraft.lines.filter((_, itemIndex) => itemIndex !== index) })}><X size={16} /></button> : null}
                    </div>
                  ))}
                </div>
                <label className="form-span">Notes<textarea maxLength="4000" value={materialReceiptDraft.notes} onChange={(event) => setMaterialReceiptDraft({ ...materialReceiptDraft, notes: event.target.value })} /></label>
                <label className="checkbox-label form-span"><input type="checkbox" checked={materialReceiptDraft.finalDelivery} onChange={(event) => setMaterialReceiptDraft({ ...materialReceiptDraft, finalDelivery: event.target.checked })} /> This is the final delivery against the order</label>
                <p className="workflow-note form-span">Saving retains the ticket and derives discrepancy evidence. It does not contact a supplier, accept commercial terms, or authorize payment.</p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" disabled={submitting} onClick={closeMaterialReceiptEditor}>Cancel</button>
                <button className="primary-button" disabled={submitting}><PackageCheck size={15} /> {submitting ? 'Recording...' : 'Retain delivery'}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {materialReceiptReversal ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="material-receipt-reversal-title">
            <div className="modal-heading">
              <div><p className="eyebrow">Compensating ledger action</p><h2 id="material-receipt-reversal-title">Request receipt reversal</h2><p>{materialReceiptReversal.receiptReference} / {materialReceiptReversal.jobTitle}</p></div>
              <button type="button" className="icon-button" aria-label="Close receipt reversal" onClick={() => setMaterialReceiptReversal(null)}><X size={18} /></button>
            </div>
            <form onSubmit={requestMaterialReceiptReversal}>
              <label>Reason<textarea autoFocus required minLength="8" maxLength="1000" value={materialReceiptReversalReason} onChange={(event) => setMaterialReceiptReversalReason(event.target.value)} placeholder="Explain the wrong allocation, duplicate ticket, or corrected evidence." /></label>
              <p className="workflow-note">The original ticket remains in history. Quantities stay active until an approver accepts the reversal, and active supplier payables block reversal.</p>
              <div className="modal-actions"><button type="button" className="secondary-button" disabled={submitting} onClick={() => setMaterialReceiptReversal(null)}>Cancel</button><button className="danger-button" disabled={submitting || materialReceiptReversalReason.trim().length < 8}><ShieldCheck size={15} /> {submitting ? 'Requesting...' : 'Request reversal'}</button></div>
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
      {financeOrderDelivery ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal finance-order-delivery-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="finance-order-delivery-title"
            data-testid="finance-order-delivery-modal"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !submitting) closeFinanceOrderDelivery()
            }}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Verified supplier delivery</p>
                <h2 id="finance-order-delivery-title">Record provider receipt</h2>
                <p>
                  {financeOrderDelivery.action.issueReference || 'Purchase order'} /{' '}
                  {financeOrderDelivery.action.recipient || financeOrderDelivery.action.supplier || 'retained supplier'}
                </p>
              </div>
              <button className="icon-button" aria-label="Close order delivery" onClick={closeFinanceOrderDelivery}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitFinanceOrderDelivery}>
              <div className="form-grid">
                <label>
                  Configured integration ID
                  <input
                    autoFocus
                    required
                    minLength="2"
                    maxLength="120"
                    value={financeOrderDeliveryDraft.integration}
                    onChange={(event) =>
                      setFinanceOrderDeliveryDraft({ ...financeOrderDeliveryDraft, integration: event.target.value })
                    }
                    placeholder="verified_supplier_gateway"
                  />
                </label>
                <label>
                  Provider message ID
                  <input
                    required
                    minLength="3"
                    maxLength="240"
                    value={financeOrderDeliveryDraft.providerMessageId}
                    onChange={(event) =>
                      setFinanceOrderDeliveryDraft({ ...financeOrderDeliveryDraft, providerMessageId: event.target.value })
                    }
                    placeholder="provider-order-000123"
                  />
                </label>
                <label>
                  Provider sent at
                  <input
                    required
                    type="datetime-local"
                    value={financeOrderDeliveryDraft.sentAt}
                    onChange={(event) =>
                      setFinanceOrderDeliveryDraft({ ...financeOrderDeliveryDraft, sentAt: event.target.value })
                    }
                  />
                </label>
                <p className="workflow-note form-span">
                  Record this only after the configured provider has returned delivery evidence for the approved recipient and immutable
                  order attachments. This records an existing delivery receipt; it does not contact the supplier or initiate payment.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" disabled={submitting} onClick={closeFinanceOrderDelivery}>
                  Cancel
                </button>
                <button
                  className="primary-button"
                  disabled={
                    submitting ||
                    financeOrderDeliveryDraft.integration.trim().length < 2 ||
                    financeOrderDeliveryDraft.providerMessageId.trim().length < 3 ||
                    !financeOrderDeliveryDraft.sentAt
                  }
                >
                  <MailCheck size={15} /> {submitting ? 'Recording...' : 'Record verified receipt'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {environmentalReversal ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="environmental-reversal-title" data-testid="environmental-reversal-modal">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Compensating correction</p>
                <h2 id="environmental-reversal-title">Reverse environmental activity</h2>
                <p>{environmentalReversal.description}</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close environmental reversal" onClick={() => {
                setEnvironmentalReversal(null)
                setEnvironmentalReversalReason('')
              }}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitEnvironmentalReversal}>
              <div className="form-grid">
                <div className="field-record-context form-span">
                  <span>Recognized source</span>
                  <strong>{roundDisplay(environmentalReversal.emissionsKgCo2e)} kg CO2e</strong>
                  <p>{roundDisplay(environmentalReversal.quantity)} {environmentalReversal.unit} / {environmentalReversal.factorSource}</p>
                </div>
                <label className="form-span">
                  Correction reason
                  <textarea required minLength="8" maxLength="1000" autoFocus value={environmentalReversalReason} onChange={(event) => setEnvironmentalReversalReason(event.target.value)} placeholder="Identify the corrected source or allocation evidence." />
                </label>
                <p className="workflow-note form-span">Approval removes this amount from the current recognized register only. The original activity, source evidence, factor provenance, and historical report packages remain retained.</p>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" disabled={submitting} onClick={() => {
                  setEnvironmentalReversal(null)
                  setEnvironmentalReversalReason('')
                }}>Cancel</button>
                <button className="primary-button" disabled={submitting || environmentalReversalReason.trim().length < 8}>
                  <Undo2 size={16} />
                  {submitting ? 'Requesting...' : 'Request reversal approval'}
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

                {financeAction.action.type === 'request_expense_reversal' ? (
                  <div className="invoice-preview form-span" aria-label="Expense reversal context">
                    <span>
                      Receipt <strong>{financeAction.action.receiptReference || financeAction.action.expenseId}</strong>
                    </span>
                    <span>
                      Vendor <strong>{financeAction.action.vendor || 'Retained vendor'}</strong>
                    </span>
                    <span>
                      Gross total <strong>{currency.format(financeAction.action.totalAmount || 0)}</strong>
                    </span>
                    <span>
                      Recognized cost <strong>{currency.format(financeAction.action.amount || 0)}</strong>
                    </span>
                  </div>
                ) : null}

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
                    {financeAction.action.materialReceipts?.length ? (
                      <label className="form-span">
                        Retained goods receipt
                        <select
                          value={financeActionDraft.materialReceiptId}
                          onChange={(event) => {
                            const receipt = financeAction.action.materialReceipts.find((item) => item.id === event.target.value)
                            setFinanceActionDraft({
                              ...financeActionDraft,
                              materialReceiptId: event.target.value,
                              deliveryReference: receipt?.receiptReference || financeActionDraft.deliveryReference,
                            })
                          }}
                        >
                          <option value="">Use service or other retained evidence</option>
                          {financeAction.action.materialReceipts.map((receipt) => (
                            <option key={receipt.id} value={receipt.id} disabled={receipt.status !== 'received'}>
                              {receipt.receiptReference} / {formatDate(receipt.deliveredAt)} / {formatStatus(receipt.status)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <label className="form-span">
                      Delivery or service evidence reference
                      <input
                        required={!financeActionDraft.materialReceiptId}
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
                      A current retained goods receipt enables a verified three-way match. Free-text service evidence is retained as an
                      explicit matching exception. Supplier, currency, amount, duplicate invoice, and compliance checks still apply.
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
                        max={futureDateInput(0)}
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
                    {financeControlHours > 0 ? (
                      <label>
                        Worker
                        <select
                          required
                          value={financeActionDraft.workerId}
                          onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, workerId: event.target.value })}
                        >
                          <option value="">Select active worker</option>
                          {workers
                            .filter((worker) => !['retired', 'inactive'].includes(worker.status))
                            .map((worker) => (
                              <option key={worker.id} value={worker.id}>
                                {worker.name} / {worker.role || formatStatus(worker.status)}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : null}
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
                            required
                            minLength="3"
                            maxLength="240"
                            value={financeActionDraft.reference}
                            onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, reference: event.target.value })}
                          />
                        </label>
                        <label>
                          VAT amount (EUR)
                          <input
                            required
                            type="number"
                            min="0"
                            max={financeActionDraft.expenseAmount || undefined}
                            step="0.01"
                            value={financeActionDraft.taxAmount}
                            onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, taxAmount: event.target.value })}
                          />
                        </label>
                        <label>
                          VAT treatment
                          <select
                            value={financeActionDraft.taxTreatment}
                            onChange={(event) => setFinanceActionDraft({
                              ...financeActionDraft,
                              taxTreatment: event.target.value,
                              taxAmount: ['exempt', 'reverse_charge'].includes(event.target.value) ? '0' : financeActionDraft.taxAmount,
                            })}
                          >
                            <option value="recoverable">Recoverable VAT</option>
                            <option value="non_recoverable">Non-recoverable VAT</option>
                            <option value="exempt">VAT exempt</option>
                            <option value="reverse_charge">Reverse charge</option>
                          </select>
                        </label>
                        <label>
                          Payment method
                          <select value={financeActionDraft.paymentMethod} onChange={(event) => setFinanceActionDraft({ ...financeActionDraft, paymentMethod: event.target.value })}>
                            <option value="company_card">Company card</option>
                            <option value="personal_card">Personal card</option>
                            <option value="cash">Cash</option>
                            <option value="bank_transfer">Bank transfer</option>
                            <option value="direct_debit">Direct debit</option>
                            <option value="other">Other</option>
                          </select>
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
                    minLength={financeAction.action.type === 'request_expense_reversal' ? 8 : undefined}
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
                      : financeAction.action.type === 'request_expense_reversal'
                        ? 'Request expense reversal'
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
      {automationControlDialog ? (
        <Suspense fallback={null}>
          <AutomationSafetyDialog
            suspend={automationControlDialog.suspend}
            control={automationControl}
            busy={submitting}
            error={automationControlError}
            onClose={closeAutomationControlDialog}
            onSubmit={changeAutomationControl}
          />
        </Suspense>
      ) : null}
      {qaResetDialog ? (
        <Suspense fallback={null}>
          <QaResetDialog
            plan={qaResetDialog.plan}
            loading={qaResetDialog.loading}
            busy={submitting}
            error={qaResetError}
            onClose={closeQaResetDialog}
            onReload={loadQaResetPreview}
            onSubmit={resetQa}
          />
        </Suspense>
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
      {mobileNavOpen ? <button className="nav-scrim" aria-label="Close navigation overlay" onClick={() => setMobileNavOpen(false)} /> : null}
    </div>
  )
}

export default App
