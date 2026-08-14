import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Archive,
  ArrowUpRight,
  BadgeCheck,
  Ban,
  Building2,
  CalendarDays,
  Calculator,
  Camera,
  Check,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  ClipboardPenLine,
  FileDown,
  FileUp,
  Gauge,
  GitBranch,
  LoaderCircle,
  LockKeyhole,
  MailCheck,
  MessageSquareText,
  PackageCheck,
  Pencil,
  Plus,
  ReceiptEuro,
  RefreshCw,
  Ruler,
  Search,
  Send,
  ShieldCheck,
  Timer,
  TriangleAlert,
  X,
} from 'lucide-react'
import { createFieldEvidenceDraftId } from '../field-outbox'
import {
  currency,
  EMPTY_LIST,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatStatus,
  futureDateInput,
  roundDisplay,
  toIsoDateTime,
  toLocalDateTimeInput,
} from '../dashboard-format'
import { operatorText } from '../operator-locale'
import Empty from './EmptyState'

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

function emptyNonconformanceDraft(operatorName = '') {
  return {
    entryKey: createFieldEvidenceDraftId(),
    severity: 'medium',
    discipline: 'quality',
    title: '',
    description: '',
    location: '',
    detectedAt: toLocalDateTimeInput(new Date()),
    raisedBy: operatorName,
    requirementReference: '',
    immediateContainment: '',
    responsibleParty: '',
    dueAt: futureDateInput(2),
    sourceInspectionId: '',
    sourceObservationId: '',
    evidenceDocumentId: '',
    notes: '',
  }
}

function emptyPhotoEvidenceSetDraft() {
  return {
    entryKey: createFieldEvidenceDraftId(),
    taskId: '',
    assignmentId: '',
    assignedWorkerId: '',
    title: '',
    workLocation: '',
    notes: '',
  }
}

function emptyNonconformanceCorrection(record = null) {
  return {
    rootCause: '',
    correctiveAction: '',
    responsibleParty: record?.correctiveAction?.responsibleParty || record?.responsibleParty || '',
    dueAt: record?.correctiveAction?.dueAt || record?.dueAt || futureDateInput(2),
    evidenceReference: '',
    evidenceDocumentId: '',
    notes: '',
  }
}

function emptyNonconformanceClosure(operatorName = '') {
  return {
    verificationResult: 'passed',
    verificationEvidence: '',
    evidenceDocumentId: '',
    verifiedBy: operatorName,
    verifiedAt: toLocalDateTimeInput(new Date()),
    notes: '',
  }
}

function emptyFieldRiskDraft(type = 'observation') {
  if (type === 'incident') {
    return {
      entryKey: createFieldEvidenceDraftId(),
      incidentType: 'near_miss',
      title: '',
      severity: 'medium',
      occurredAt: toLocalDateTimeInput(new Date()),
      reportedBy: '',
      description: '',
      immediateAction: '',
      correctiveAction: '',
      witnesses: '',
      evidenceDocumentId: '',
      reportable: false,
    }
  }
  return {
    entryKey: createFieldEvidenceDraftId(),
    category: 'quality',
    title: '',
    severity: 'medium',
    responsible: '',
    dueAt: futureDateInput(2),
    notes: '',
    correctiveAction: '',
    evidenceDocumentId: '',
  }
}

function emptyCloseoutDraft(type = 'punch_item') {
  if (type === 'warranty_claim') {
    return {
      warrantyType: 'workmanship',
      title: '',
      severity: 'medium',
      dueAt: futureDateInput(7),
      issue: '',
    }
  }
  if (type === 'aftercare') {
    return {
      type: 'client_follow_up',
      title: '',
      owner: '',
      dueAt: futureDateInput(7),
      channel: 'portal',
      notes: '',
    }
  }
  if (type === 'client_feedback') {
    return {
      entryKey: createFieldEvidenceDraftId(),
      surveyType: 'project_experience',
      respondentName: '',
      npsScore: '',
      csatScore: '',
      effortScore: '',
      evidenceReference: '',
      comment: '',
      followUpConsent: false,
      testimonialConsent: false,
    }
  }
  return {
    entryKey: createFieldEvidenceDraftId(),
    title: '',
    severity: 'medium',
    assignee: '',
    dueAt: futureDateInput(3),
    location: '',
    description: '',
    evidenceDocumentId: '',
    clientVisible: false,
  }
}

function emptyProductionBaselineLine(index = 0) {
  return {
    lineKey: `production-line-${index + 1}`,
    costCode: 'PRODUCTION',
    description: '',
    unit: 'unit',
    plannedQuantity: '',
    plannedLaborHours: '',
  }
}

function emptyProductionEntry(baselineId = '', lineKey = '') {
  return {
    entryKey: createFieldEvidenceDraftId(),
    baselineId,
    lineKey,
    workDate: futureDateInput(0),
    quantity: '',
    crewHours: '',
    note: '',
  }
}

function emptyDayworkLine(type = 'labor') {
  return {
    lineKey: `daywork-line-${createFieldEvidenceDraftId()}`.slice(0, 80),
    lineType: type,
    description: '',
    quantity: '',
    unit: ['labor', 'equipment'].includes(type) ? 'hour' : 'unit',
    costCode: `DAYWORK_${type.toUpperCase()}`,
    sourceReference: '',
  }
}

function emptyDayworkDraft() {
  return {
    entryKey: createFieldEvidenceDraftId(),
    workerId: '',
    workDate: futureDateInput(0),
    title: '',
    description: '',
    reason: '',
    evidenceReference: '',
    notes: '',
    lines: [emptyDayworkLine()],
  }
}

function emptyDayworkAcknowledgement() {
  return {
    evidenceReference: '',
    acknowledgedBy: '',
    acknowledgedAt: toLocalDateTimeInput(new Date()),
    notes: '',
  }
}

function takeoffMeasurementSummary(item = {}, t = (value) => value) {
  const dimensions = []
  if (item.measurementType !== 'manual') dimensions.push(`${item.count || 0}x`)
  if (['linear', 'area', 'volume'].includes(item.measurementType)) dimensions.push(`${item.length || 0} m`)
  if (['area', 'volume'].includes(item.measurementType)) dimensions.push(`x ${item.width || 0} m`)
  if (item.measurementType === 'volume') dimensions.push(`x ${item.height || 0} m`)
  if (item.wastePercent) dimensions.push(t('+ {percent}% waste', { percent: item.wastePercent }))
  return dimensions.length ? dimensions.join(' ') : t('Manual retained quantity')
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

function estimateRatePolicyDraft(activePolicy) {
  const snapshot = activePolicy?.snapshot || {}
  const burden = snapshot.labourBurden || {}
  const overhead = snapshot.overheadRecovery || {}
  return {
    policyName: snapshot.policyName || 'Standard estimating rates',
    currency: snapshot.currency || 'EUR',
    labourClasses: (snapshot.labourClasses || [{ code: 'STANDARD', name: 'Standard craft labour', baseHourlyRate: 35 }]).map((row) => ({
      code: row.code,
      name: row.name,
      baseHourlyRate: String(row.baseHourlyRate),
    })),
    paidLeavePercent: String(burden.paidLeavePercent ?? 12),
    statutoryEmployerCostsPercent: String(burden.statutoryEmployerCostsPercent ?? 25),
    pensionBenefitsPercent: String(burden.pensionBenefitsPercent ?? 8),
    insuranceOtherPercent: String(burden.insuranceOtherPercent ?? 3),
    productiveUtilizationPercent: String(burden.productiveUtilizationPercent ?? 75),
    overheadMethod: overhead.method || 'labor_hour',
    annualOverhead: String(overhead.annualOverhead ?? 60000),
    annualProductiveLabourHours: String(overhead.annualProductiveLabourHours ?? 2000),
    directCostPercent: String(overhead.directCostPercent ?? 10),
    targetMarginPercent: String(snapshot.targetMarginPercent ?? 25),
    reason: '',
  }
}

function unitRateDraft(activePolicy, item) {
  const retained = item?.rateBuildUp?.input || {}
  const defaultClass = activePolicy?.derived?.labourClasses?.[0]?.code || ''
  const retainedCost = Number(item?.unitCost || 0)
  const category = item?.category || 'other'
  return {
    labourClassCode: retained.labourClassCode || defaultClass,
    labourHoursPerUnit: String(retained.labourHoursPerUnit ?? (category === 'labor' ? 1 : 0)),
    materialCostPerUnit: String(retained.materialCostPerUnit ?? (category === 'material' ? retainedCost : 0)),
    equipmentCostPerUnit: String(retained.equipmentCostPerUnit ?? (category === 'equipment' ? retainedCost : 0)),
    subcontractCostPerUnit: String(retained.subcontractCostPerUnit ?? (category === 'subcontract' ? retainedCost : 0)),
    otherDirectCostPerUnit: String(retained.otherDirectCostPerUnit ?? (category === 'other' ? retainedCost : 0)),
    targetMarginPercent: String(retained.targetMarginPercent ?? activePolicy?.snapshot?.targetMarginPercent ?? 0),
    marginOverrideReason: retained.marginOverrideReason || '',
  }
}

function roundRateValue(value, decimals = 2) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  const factor = 10 ** decimals
  return Math.round((number + Number.EPSILON) * factor) / factor
}

function calculateRatePreview(activePolicy, draft) {
  if (!activePolicy || !draft) return null
  const labourClass = (activePolicy.derived?.labourClasses || EMPTY_LIST).find((row) => row.code === draft.labourClassCode)
  if (!labourClass) return null
  const labourHours = Number(draft.labourHoursPerUnit) || 0
  const labourCost = roundRateValue(labourHours * Number(labourClass.fullyBurdenedHourlyRate || 0))
  const directCost = roundRateValue(
    labourCost
      + (Number(draft.materialCostPerUnit) || 0)
      + (Number(draft.equipmentCostPerUnit) || 0)
      + (Number(draft.subcontractCostPerUnit) || 0)
      + (Number(draft.otherDirectCostPerUnit) || 0),
  )
  const overhead = activePolicy.derived?.overheadMethod === 'labor_hour'
    ? roundRateValue(labourHours * Number(activePolicy.derived?.overheadPerLabourHour || 0))
    : roundRateValue(directCost * Number(activePolicy.derived?.directCostPercent || 0) / 100)
  const unitCost = roundRateValue(directCost + overhead)
  const margin = Number(draft.targetMarginPercent) || 0
  const unitSellRate = margin < 100 ? roundRateValue(unitCost / (1 - margin / 100)) : 0
  const policyMargin = Number(activePolicy.snapshot?.targetMarginPercent || 0)
  return {
    labourCost,
    directCost,
    overhead,
    unitCost,
    unitSellRate,
    markupPercent: unitCost > 0 ? roundRateValue(((unitSellRate - unitCost) / unitCost) * 100) : 0,
    marginOverride: Math.abs(margin - policyMargin) > 0.0001,
  }
}

function rateMoney(value, currencyCode = 'EUR') {
  return formatCurrency(value, currencyCode)
}

const FALLBACK_PRICING_BASIS_FACTORS = [
  { key: 'scope_defined', label: 'Scope is fully defined', weight: 15, critical: true },
  { key: 'design_complete', label: 'Design information is complete', weight: 10, critical: true },
  { key: 'quantities_verifiable', label: 'Quantities can be verified', weight: 15, critical: true },
  { key: 'site_conditions_known', label: 'Site conditions are known', weight: 15, critical: true },
  { key: 'selections_locked', label: 'Client selections are locked', weight: 10, critical: false },
  { key: 'productivity_predictable', label: 'Productivity is predictable', weight: 10, critical: false },
  { key: 'schedule_constraints_defined', label: 'Schedule constraints are defined', weight: 5, critical: false },
  { key: 'price_exposure_controlled', label: 'Supplier and price exposure is controlled', weight: 10, critical: false },
  { key: 'change_risk_low', label: 'Change risk is low', weight: 10, critical: false },
]

function pricingModelLabel(value) {
  if (value === 'fixed_price') return 'Fixed price'
  if (value === 'time_and_materials') return 'Time and materials'
  return 'Review required'
}

function commercialScopeDraft(job = {}, commercialScope = {}) {
  const snapshot = commercialScope.currentRevision?.snapshot || commercialScope.latestRevision?.snapshot || {}
  return {
    title: snapshot.title || `${job.title || 'Project'} scope schedule`,
    scopeSummary: snapshot.scopeSummary || job.description || '',
    inclusions: (snapshot.inclusions || EMPTY_LIST).join('\n'),
    assumptions: (snapshot.assumptions || EMPTY_LIST).join('\n'),
    exclusions: (snapshot.exclusions || EMPTY_LIST).join('\n'),
    clientResponsibilities: (snapshot.clientResponsibilities || EMPTY_LIST).join('\n'),
    contractorResponsibilities: (snapshot.contractorResponsibilities || EMPTY_LIST).join('\n'),
    allowanceMode: snapshot.allowanceMode || 'none',
    noAllowanceReason: snapshot.noAllowanceReason || 'No provisional sums or selection allowances are included in this revision.',
    clarificationDeadline: snapshot.clarificationDeadline ? String(snapshot.clarificationDeadline).slice(0, 10) : '',
    allowances: (snapshot.allowances || EMPTY_LIST).map((allowance) => ({
      allowanceKey: allowance.allowanceKey || '',
      allowanceType: allowance.allowanceType || 'selection_allowance',
      title: allowance.title || '',
      description: allowance.description || '',
      quantity: String(allowance.quantity ?? 1),
      unit: allowance.unit || 'item',
      unitRate: String(allowance.unitRate ?? ''),
      reconciliationMethod: allowance.reconciliationMethod || 'actual_cost_variation',
      selectionBy: allowance.selectionBy || 'client',
      dueAt: allowance.dueAt ? String(allowance.dueAt).slice(0, 10) : '',
      evidenceReference: allowance.evidenceReference || '',
      notes: allowance.notes || '',
    })),
    reason: commercialScope.currentRevision ? '' : 'Establish the initial written commercial scope schedule.',
  }
}

function scopeLines(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function emptyScopeAllowance(index = 0) {
  return {
    allowanceKey: `ALLOW-${String(index + 1).padStart(2, '0')}`,
    allowanceType: 'selection_allowance',
    title: '',
    description: '',
    quantity: '1',
    unit: 'item',
    unitRate: '',
    reconciliationMethod: 'actual_cost_variation',
    selectionBy: 'client',
    dueAt: '',
    evidenceReference: '',
    notes: '',
  }
}

function emptyProjectRisk(index = 0) {
  return {
    riskKey: `RISK-${String(index + 1).padStart(2, '0')}`,
    category: 'schedule',
    title: '',
    cause: '',
    event: '',
    consequence: '',
    owner: '',
    probability: '3',
    impact: '3',
    responseStrategy: 'mitigate',
    mitigationAction: '',
    contingencyAction: '',
    trigger: '',
    dueAt: '',
    residualProbability: '2',
    residualImpact: '2',
    costExposureAmount: '0',
    scheduleExposureDays: '0',
    status: 'open',
    acceptanceReason: '',
    evidenceReference: '',
    failureMode: '',
    earlyWarning: '',
    prevention: '',
  }
}

function projectRiskDraft(job = {}, register = {}) {
  const snapshot = register.currentRevision?.snapshot || register.latestRevision?.snapshot || {}
  const failureModes = snapshot.premortem?.failureModes || EMPTY_LIST
  const risks = (snapshot.risks || EMPTY_LIST).map((risk) => {
    const failureMode = failureModes.find((item) => item.riskKey === risk.riskKey) || {}
    return {
      ...emptyProjectRisk(),
      ...risk,
      probability: String(risk.probability ?? 3),
      impact: String(risk.impact ?? 3),
      residualProbability: String(risk.residualProbability ?? 2),
      residualImpact: String(risk.residualImpact ?? 2),
      costExposureAmount: String(risk.costExposureAmount ?? 0),
      scheduleExposureDays: String(risk.scheduleExposureDays ?? 0),
      dueAt: risk.dueAt ? String(risk.dueAt).slice(0, 10) : '',
      acceptanceReason: risk.acceptanceReason || '',
      evidenceReference: risk.evidenceReference || '',
      failureMode: failureMode.failureMode || '',
      earlyWarning: failureMode.earlyWarning || '',
      prevention: failureMode.prevention || '',
    }
  })
  return {
    title: snapshot.title || `${job.title || 'Project'} risk register`,
    workshopDate: snapshot.premortem?.workshopDate ? String(snapshot.premortem.workshopDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
    failureStatement: snapshot.premortem?.failureStatement || '',
    facilitator: snapshot.premortem?.facilitator || '',
    participants: (snapshot.premortem?.participants || EMPTY_LIST).join('\n'),
    risks: risks.length ? risks : [emptyProjectRisk()],
    reason: register.currentRevision ? '' : 'Retain the initial project risk register and premortem before pricing.',
  }
}

function projectRiskScore(risk, residual = false) {
  const probability = Number(residual ? risk.residualProbability : risk.probability) || 0
  const impact = Number(residual ? risk.residualImpact : risk.impact) || 0
  return probability * impact
}

function projectRiskBand(score) {
  if (score >= 20) return 'critical'
  if (score >= 15) return 'high'
  if (score >= 8) return 'medium'
  return 'low'
}

function pricingBasisDraft(pricingBasis = {}) {
  const definitions = pricingBasis.factors?.length ? pricingBasis.factors : FALLBACK_PRICING_BASIS_FACTORS
  const retained = pricingBasis.currentDecision?.snapshot?.factors || EMPTY_LIST
  return {
    selectedModel: pricingBasis.currentDecision?.selectedModel || 'fixed_price',
    rationale: pricingBasis.currentDecision?.snapshot?.rationale || '',
    overrideReason: '',
    factors: definitions.map((definition) => {
      const current = retained.find((factor) => factor.key === definition.key)
      return {
        ...definition,
        status: current?.status || 'unknown',
        evidence: current?.evidence || '',
      }
    }),
  }
}

function pricingBasisPreview(factors = EMPTY_LIST) {
  const blockers = factors.filter((factor) => factor.critical && factor.status === 'no')
  const evidenceGaps = factors.filter((factor) => factor.status === 'unknown')
  const score = factors.reduce((sum, factor) => sum + (factor.status === 'yes' ? Number(factor.weight || 0) : 0), 0)
  const recommendation = evidenceGaps.length
    ? 'review'
    : blockers.length
      ? 'time_and_materials'
      : score >= 75
        ? 'fixed_price'
        : 'time_and_materials'
  return { blockers, evidenceGaps, score, recommendation }
}

function TakeoffControl({
  job,
  estimateRates,
  locale,
  canCoordinate,
  canManagePolicy,
  submitting,
  onRequestRatePolicy,
  onApplyUnitRate,
  onNewTakeoff,
  onAddItem,
  onEditItem,
  onRemoveItem,
  onConvert,
}) {
  const t = (key, variables = {}) => operatorText(locale, key, variables)
  const activeRatePolicy = estimateRates?.activePolicy || null
  const currentPricingBasis = job.pricingBasis?.currentDecision || null
  const pricingBasisReady = Boolean(currentPricingBasis && job.pricingBasis?.stale !== true)
  const pendingRatePolicies = estimateRates?.pendingPolicies || EMPTY_LIST
  const takeoffs = job.takeoffs || EMPTY_LIST
  const draftCount = takeoffs.filter((takeoff) => takeoff.status === 'draft').length
  const convertedCount = takeoffs.filter((takeoff) => takeoff.status === 'converted').length
  const packageCount = takeoffs.reduce((sum, takeoff) => sum + Number(takeoff.workBreakdown?.packageCount || 0), 0)
  const draftValue = takeoffs
    .filter((takeoff) => takeoff.status === 'draft')
    .reduce((sum, takeoff) => sum + Number(takeoff.subtotal || 0), 0)
  const [editingRatePolicy, setEditingRatePolicy] = useState(false)
  const [ratePolicyDraft, setRatePolicyDraft] = useState(() => estimateRatePolicyDraft(activeRatePolicy))
  const [rateBuildUpTarget, setRateBuildUpTarget] = useState(null)
  const [rateBuildUpDraft, setRateBuildUpDraft] = useState(null)

  useEffect(() => {
    if (!editingRatePolicy) setRatePolicyDraft(estimateRatePolicyDraft(activeRatePolicy))
  }, [activeRatePolicy, editingRatePolicy])

  const ratePreview = useMemo(
    () => calculateRatePreview(activeRatePolicy, rateBuildUpDraft),
    [activeRatePolicy, rateBuildUpDraft],
  )

  function openRatePolicyEditor() {
    setRatePolicyDraft(estimateRatePolicyDraft(activeRatePolicy))
    setEditingRatePolicy(true)
  }

  function updateLabourClass(index, patch) {
    setRatePolicyDraft((current) => ({
      ...current,
      labourClasses: current.labourClasses.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    }))
  }

  async function submitRatePolicy(event) {
    event.preventDefault()
    const result = await onRequestRatePolicy({
      entryKey: `estimate-rate-policy:${Date.now()}`,
      policyName: ratePolicyDraft.policyName,
      currency: ratePolicyDraft.currency,
      labourClasses: ratePolicyDraft.labourClasses.map((row) => ({
        code: row.code,
        name: row.name,
        baseHourlyRate: Number(row.baseHourlyRate),
      })),
      labourBurden: {
        paidLeavePercent: Number(ratePolicyDraft.paidLeavePercent),
        statutoryEmployerCostsPercent: Number(ratePolicyDraft.statutoryEmployerCostsPercent),
        pensionBenefitsPercent: Number(ratePolicyDraft.pensionBenefitsPercent),
        insuranceOtherPercent: Number(ratePolicyDraft.insuranceOtherPercent),
        productiveUtilizationPercent: Number(ratePolicyDraft.productiveUtilizationPercent),
      },
      overheadRecovery: {
        method: ratePolicyDraft.overheadMethod,
        annualOverhead: Number(ratePolicyDraft.annualOverhead),
        annualProductiveLabourHours: Number(ratePolicyDraft.annualProductiveLabourHours),
        directCostPercent: Number(ratePolicyDraft.directCostPercent),
      },
      targetMarginPercent: Number(ratePolicyDraft.targetMarginPercent),
      reason: ratePolicyDraft.reason,
    })
    if (result) setEditingRatePolicy(false)
  }

  function openRateBuildUp(takeoff, item) {
    setRateBuildUpTarget({ takeoff, item })
    setRateBuildUpDraft(unitRateDraft(activeRatePolicy, item))
  }

  async function submitRateBuildUp(event) {
    event.preventDefault()
    if (!rateBuildUpTarget || !rateBuildUpDraft) return
    const result = await onApplyUnitRate(rateBuildUpTarget.takeoff, rateBuildUpTarget.item, {
      entryKey: `unit-rate:${rateBuildUpTarget.item.id}:${Date.now()}`,
      policyId: activeRatePolicy.id,
      labourClassCode: rateBuildUpDraft.labourClassCode,
      labourHoursPerUnit: Number(rateBuildUpDraft.labourHoursPerUnit),
      materialCostPerUnit: Number(rateBuildUpDraft.materialCostPerUnit),
      equipmentCostPerUnit: Number(rateBuildUpDraft.equipmentCostPerUnit),
      subcontractCostPerUnit: Number(rateBuildUpDraft.subcontractCostPerUnit),
      otherDirectCostPerUnit: Number(rateBuildUpDraft.otherDirectCostPerUnit),
      targetMarginPercent: Number(rateBuildUpDraft.targetMarginPercent),
      marginOverrideReason: rateBuildUpDraft.marginOverrideReason,
    })
    if (result) {
      setRateBuildUpTarget(null)
      setRateBuildUpDraft(null)
    }
  }
  const ratePolicyReady = ratePolicyDraft.policyName.trim().length >= 2
    && /^[A-Z]{3}$/.test(ratePolicyDraft.currency.trim().toUpperCase())
    && ratePolicyDraft.labourClasses.length > 0
    && ratePolicyDraft.labourClasses.every((row) => row.code.trim() && row.name.trim().length >= 2 && Number(row.baseHourlyRate) > 0)
    && Number(ratePolicyDraft.productiveUtilizationPercent) > 0
    && Number(ratePolicyDraft.productiveUtilizationPercent) <= 100
    && (ratePolicyDraft.overheadMethod !== 'labor_hour' || Number(ratePolicyDraft.annualProductiveLabourHours) > 0)
    && Number(ratePolicyDraft.targetMarginPercent) >= 0
    && Number(ratePolicyDraft.targetMarginPercent) <= 90
    && ratePolicyDraft.reason.trim().length >= 8
  const rateBuildUpReady = Boolean(
    ratePreview
    && ratePreview.unitCost > 0
    && Number(rateBuildUpDraft?.targetMarginPercent) >= 0
    && Number(rateBuildUpDraft?.targetMarginPercent) <= 90
    && (!ratePreview.marginOverride || rateBuildUpDraft?.marginOverrideReason.trim().length >= 8),
  )

  return (
    <section className="job-workspace-section takeoff-control" data-testid="takeoff-control">
      <div className="section-heading takeoff-heading">
        <Ruler size={18} />
        <div>
          <h3>{t('WBS & quantity takeoff')}</h3>
          <p>{t('Structure work packages, measure retained scope, and convert one sealed basis into the approval-gated estimate workflow.')}</p>
        </div>
        {canCoordinate ? (
          <button type="button" className="secondary-button" disabled={submitting} onClick={onNewTakeoff}>
            <Plus size={15} />
            {t('New takeoff')}
          </button>
        ) : null}
      </div>
      <div className={`estimate-rate-policy-strip ${activeRatePolicy ? 'rate-policy-active' : 'rate-policy-missing'}`} data-testid="estimate-rate-policy-control">
        <Calculator size={17} />
        <div>
          <strong>{activeRatePolicy ? `${activeRatePolicy.policyName} / v${activeRatePolicy.versionNumber}` : t('Estimating rate policy required')}</strong>
          <span>
            {activeRatePolicy
              ? t('{count} labour class(es) / {overhead} / {margin}% target margin', {
                  count: activeRatePolicy.derived?.labourClasses?.length || 0,
                  overhead: activeRatePolicy.derived?.overheadMethod === 'labor_hour'
                    ? t('{amount} overhead per labour hour', { amount: rateMoney(activeRatePolicy.derived?.overheadPerLabourHour, activeRatePolicy.currency) })
                    : t('{percent}% direct-cost overhead', { percent: activeRatePolicy.derived?.directCostPercent || 0 }),
                  margin: activeRatePolicy.snapshot?.targetMarginPercent || 0,
                })
              : t('No governed labour-burden and overhead basis is active.')}
          </span>
        </div>
        {pendingRatePolicies.length ? <span className="tag tag-amber">{t('{count} pending approval', { count: pendingRatePolicies.length })}</span> : null}
        {canManagePolicy ? (
          <button type="button" className="secondary-button" disabled={submitting || pendingRatePolicies.length > 0} onClick={openRatePolicyEditor}>
            <Pencil size={14} />
            {activeRatePolicy ? t('Revise rates') : t('Configure rates')}
          </button>
        ) : null}
      </div>
      <div className={`takeoff-pricing-basis-strip ${pricingBasisReady ? 'pricing-basis-active' : 'pricing-basis-missing'}`} data-testid="takeoff-pricing-basis">
        <GitBranch size={17} />
        <div>
          <strong>{pricingBasisReady ? t(pricingModelLabel(currentPricingBasis.selectedModel)) : job.pricingBasis?.stale ? t('Pricing basis is stale') : t('Pricing basis required')}</strong>
          <span>
            {pricingBasisReady
              ? t('Decision v{version} / {score}% fixed-price readiness / {basis}', {
                  version: currentPricingBasis.versionNumber,
                  score: currentPricingBasis.score,
                  basis: currentPricingBasis.snapshot?.override ? t('operator override retained') : t('recommendation followed'),
                })
              : t('Estimate approval remains blocked until current scope and estimate evidence have been assessed.')}
          </span>
        </div>
        {pricingBasisReady ? <span className="tag tag-green">{t('Source current')}</span> : <span className="tag tag-amber">{t('Action required')}</span>}
      </div>
      <div className="takeoff-summary" aria-label={t('Quantity takeoff summary')}>
        <div><span>{t('Sheets')}</span><strong>{takeoffs.length}</strong></div>
        <div><span>{t('Work packages')}</span><strong>{packageCount}</strong></div>
        <div><span>{t('Drafts')}</span><strong>{draftCount}</strong></div>
        <div><span>{t('Converted')}</span><strong>{convertedCount}</strong></div>
        <div><span>{t('Draft sell value')}</span><strong>{currency.format(draftValue)}</strong></div>
      </div>
      {takeoffs.length ? (
        <div className="takeoff-register">
          {takeoffs.map((takeoff) => (
            <article className="takeoff-sheet" key={takeoff.id} data-testid={`takeoff-sheet-${takeoff.id}`}>
              <div className="takeoff-sheet-heading">
                <div>
                  <div className="takeoff-sheet-title">
                    <strong>{takeoff.title}</strong>
                    <span className={`status status-${takeoff.status}`}>{t(formatStatus(takeoff.status))}</span>
                    {takeoff.status === 'converted' ? (
                      <span className={`tag ${takeoff.integrityValid ? 'tag-green' : 'tag-red'}`}>
                        {takeoff.integrityValid ? t('Snapshot verified') : t('Integrity failed')}
                      </span>
                    ) : null}
                  </div>
                  <small>
                    {t('{packages} work package(s) / {measurements} measurement(s) / VAT {vat}%', {
                      packages: takeoff.workBreakdown?.packageCount || 0,
                      measurements: takeoff.itemCount || 0,
                      vat: takeoff.taxRate || 0,
                    })}
                    {takeoff.quoteId ? ` / ${t('estimate {id}', { id: takeoff.quoteId })}` : ''}
                  </small>
                </div>
                {canCoordinate && takeoff.status === 'draft' ? (
                  <div className="takeoff-sheet-actions">
                    <button type="button" className="secondary-button" disabled={submitting || takeoff.itemCount >= 50} onClick={() => onAddItem(takeoff)}>
                      <Plus size={14} />
                      {t('Measurement')}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={submitting || !takeoff.itemCount || takeoff.subtotal <= 0 || !pricingBasisReady}
                      title={pricingBasisReady ? t('Prepare a {model} estimate', { model: t(pricingModelLabel(currentPricingBasis.selectedModel)).toLowerCase() }) : t('A current pricing-basis decision is required')}
                      onClick={() => onConvert(takeoff)}
                    >
                      <ArrowUpRight size={14} />
                      {t('Prepare estimate')}
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="takeoff-values" aria-label={t('{title} totals', { title: takeoff.title })}>
                <div><span>{t('Cost')}</span><strong>{currency.format(takeoff.totalCost || 0)}</strong></div>
                <div><span>{t('Sell net')}</span><strong>{currency.format(takeoff.subtotal || 0)}</strong></div>
                <div><span>{t('Margin')}</span><strong>{currency.format(takeoff.marginAmount || 0)} / {takeoff.marginPercent || 0}%</strong></div>
                <div><span>{t('Gross')}</span><strong>{currency.format(takeoff.total || 0)}</strong></div>
              </div>
              {takeoff.workBreakdown?.nodes?.length ? (
                <div className="takeoff-wbs" role="table" aria-label={t('{title} work breakdown', { title: takeoff.title })}>
                  <div className="takeoff-wbs-heading" role="row">
                    <strong role="columnheader">{t('WBS work package')}</strong>
                    <span role="columnheader">{t('Measurements')}</span>
                    <span role="columnheader">{t('Cost')}</span>
                    <span role="columnheader">{t('Sell')}</span>
                    <span role="columnheader">{t('Margin')}</span>
                  </div>
                  {takeoff.workBreakdown.nodes.map((node) => (
                    <div className="takeoff-wbs-row" role="row" key={node.code} data-testid={`takeoff-wbs-${takeoff.id}-${node.code}`}>
                      <div role="cell"><strong>{node.code}</strong><span>{node.name}</span></div>
                      <span role="cell"><small>{t('Measurements')}</small><strong>{node.itemCount}</strong></span>
                      <span role="cell"><small>{t('Cost')}</small><strong>{currency.format(node.totalCost || 0)}</strong></span>
                      <span role="cell"><small>{t('Sell')}</small><strong>{currency.format(node.totalPrice || 0)}</strong></span>
                      <span role="cell"><small>{t('Margin')}</small><strong>{currency.format(node.marginAmount || 0)} / {node.marginPercent || 0}%</strong></span>
                    </div>
                  ))}
                </div>
              ) : null}
              {takeoff.items?.length ? (
                <div className="takeoff-items" role="table" aria-label={t('{title} measurements', { title: takeoff.title })}>
                  {takeoff.items.map((item) => (
                    <div className="takeoff-item" role="row" key={item.id}>
                      <div className="takeoff-item-copy" role="cell">
                        <div>
                          <strong>{item.description}</strong>
                          <span className="tag tag-wbs">{item.wbsCode} / {item.workPackage}</span>
                          <span className="tag">{t(formatStatus(item.category))}</span>
                          {item.rateBuildUpHash ? (
                            <span className={`tag ${item.rateIntegrityValid ? 'tag-green' : 'tag-red'}`}>
                              {item.rateIntegrityValid ? t('Rate v{version}', { version: item.rateBuildUp?.policy?.versionNumber }) : t('Rate integrity failed')}
                            </span>
                          ) : null}
                        </div>
                        <small>{takeoffMeasurementSummary(item, t)} / {item.sourceReference || t('No drawing reference')}</small>
                        {item.rateBuildUp?.calculation ? (
                          <small className="takeoff-rate-summary">
                            {t('Labour {labour} / overhead {overhead} / cost {cost} / margin {margin}%', {
                              labour: rateMoney(item.rateBuildUp.calculation.labourCostPerUnit, takeoff.currency),
                              overhead: rateMoney(item.rateBuildUp.calculation.overheadRecoveryPerUnit, takeoff.currency),
                              cost: rateMoney(item.rateBuildUp.calculation.unitCost, takeoff.currency),
                              margin: item.rateBuildUp.calculation.targetMarginPercent,
                            })}
                          </small>
                        ) : null}
                      </div>
                      <div className="takeoff-item-quantity" role="cell">
                        <span>{t('Quantity')}</span>
                        <strong>{item.quantity} {item.unit}</strong>
                      </div>
                      <div className="takeoff-item-money" role="cell">
                        <span>{currency.format(item.unitPrice || 0)} / {item.unit}</span>
                        <strong>{currency.format(item.totalPrice || 0)}</strong>
                      </div>
                      {canCoordinate && takeoff.status === 'draft' ? (
                        <div className="takeoff-item-actions" role="cell">
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={t('Build rate {description}', { description: item.description })}
                            title={activeRatePolicy ? t('Unit-rate build-up') : t('Approve an estimating rate policy first')}
                            disabled={submitting || !activeRatePolicy}
                            onClick={() => openRateBuildUp(takeoff, item)}
                          >
                            <Calculator size={15} />
                          </button>
                          <button type="button" className="icon-button" aria-label={t('Edit {description}', { description: item.description })} disabled={submitting} onClick={() => onEditItem(takeoff, item)}>
                            <Pencil size={15} />
                          </button>
                          <button type="button" className="icon-button" aria-label={t('Remove {description}', { description: item.description })} disabled={submitting} onClick={() => onRemoveItem(takeoff, item)}>
                            <X size={15} />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="workflow-note">{t('No measurements retained yet. Add a count, length, area, volume, or manual quantity.')}</p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty title={t('No WBS or quantity takeoffs')} detail={t('Create a structured measured scope before preparing an estimate from drawings, surveys, or site dimensions.')} />
      )}
      {editingRatePolicy ? (
        <div className="estimate-rate-editor-wrap" role="presentation">
          <form className="estimate-rate-editor" role="dialog" aria-modal="true" aria-labelledby="estimate-rate-policy-title" onSubmit={submitRatePolicy}>
            <div className="panel-heading">
              <div>
                <h3 id="estimate-rate-policy-title">{t('Estimating rate policy revision')}</h3>
                <p>{t('Labour burden, productive utilization, overhead recovery, and target margin.')}</p>
              </div>
              <button type="button" className="icon-button" aria-label={t('Close estimating rate policy editor')} onClick={() => setEditingRatePolicy(false)}><X size={16} /></button>
            </div>
            <div className="form-grid estimate-rate-policy-grid">
              <label className="form-span">{t('Policy name')}<input autoFocus required minLength="2" maxLength="120" value={ratePolicyDraft.policyName} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, policyName: event.target.value })} /></label>
              <label>{t('Currency')}<input required maxLength="3" value={ratePolicyDraft.currency} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, currency: event.target.value.toUpperCase() })} /></label>
              <label>{t('Target margin (%)')}<input required type="number" min="0" max="90" step="0.01" value={ratePolicyDraft.targetMarginPercent} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, targetMarginPercent: event.target.value })} /></label>
            </div>
            <fieldset className="estimate-rate-fieldset">
              <legend>{t('Labour classes')}</legend>
              <div className="estimate-rate-labour-list">
                {ratePolicyDraft.labourClasses.map((row, index) => (
                  <div className="estimate-rate-labour-row" key={`${row.code}-${index}`}>
                    <label>{t('Class code')}<input required maxLength="24" value={row.code} onChange={(event) => updateLabourClass(index, { code: event.target.value.toUpperCase() })} /></label>
                    <label>{t('Class name')}<input required minLength="2" maxLength="80" value={row.name} onChange={(event) => updateLabourClass(index, { name: event.target.value })} /></label>
                    <label>{t('Base hourly rate')}<input required type="number" min="0.01" max="10000" step="0.01" value={row.baseHourlyRate} onChange={(event) => updateLabourClass(index, { baseHourlyRate: event.target.value })} /></label>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t('Remove labour class {name}', { name: row.name || index + 1 })}
                      disabled={ratePolicyDraft.labourClasses.length === 1}
                      onClick={() => setRatePolicyDraft((current) => ({ ...current, labourClasses: current.labourClasses.filter((_, rowIndex) => rowIndex !== index) }))}
                    ><X size={15} /></button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={ratePolicyDraft.labourClasses.length >= 20}
                onClick={() => setRatePolicyDraft((current) => ({
                  ...current,
                  labourClasses: [...current.labourClasses, { code: `CLASS${current.labourClasses.length + 1}`, name: '', baseHourlyRate: '' }],
                }))}
              ><Plus size={14} /> {t('Labour class')}</button>
            </fieldset>
            <fieldset className="estimate-rate-fieldset">
              <legend>{t('Labour burden assumptions')}</legend>
              <div className="form-grid estimate-rate-assumption-grid">
                <label>{t('Paid leave (%)')}<input required type="number" min="0" max="100" step="0.01" value={ratePolicyDraft.paidLeavePercent} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, paidLeavePercent: event.target.value })} /></label>
                <label>{t('Employer costs (%)')}<input required type="number" min="0" max="100" step="0.01" value={ratePolicyDraft.statutoryEmployerCostsPercent} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, statutoryEmployerCostsPercent: event.target.value })} /></label>
                <label>{t('Pension and benefits (%)')}<input required type="number" min="0" max="100" step="0.01" value={ratePolicyDraft.pensionBenefitsPercent} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, pensionBenefitsPercent: event.target.value })} /></label>
                <label>{t('Insurance and other (%)')}<input required type="number" min="0" max="100" step="0.01" value={ratePolicyDraft.insuranceOtherPercent} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, insuranceOtherPercent: event.target.value })} /></label>
                <label>{t('Productive utilization (%)')}<input required type="number" min="1" max="100" step="0.01" value={ratePolicyDraft.productiveUtilizationPercent} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, productiveUtilizationPercent: event.target.value })} /></label>
              </div>
            </fieldset>
            <fieldset className="estimate-rate-fieldset">
              <legend>{t('Overhead recovery')}</legend>
              <div className="form-grid estimate-rate-assumption-grid">
                <label>{t('Method')}<select value={ratePolicyDraft.overheadMethod} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, overheadMethod: event.target.value })}><option value="labor_hour">{t('Per labour hour')}</option><option value="direct_cost_percent">{t('Direct-cost percentage')}</option></select></label>
                <label>{t('Annual overhead')}<input required type="number" min="0" max="1000000000" step="0.01" value={ratePolicyDraft.annualOverhead} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, annualOverhead: event.target.value })} /></label>
                <label>{t('Annual productive labour hours')}<input required={ratePolicyDraft.overheadMethod === 'labor_hour'} type="number" min={ratePolicyDraft.overheadMethod === 'labor_hour' ? '1' : '0'} max="10000000" step="0.01" value={ratePolicyDraft.annualProductiveLabourHours} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, annualProductiveLabourHours: event.target.value })} /></label>
                <label>{t('Direct-cost overhead (%)')}<input required type="number" min="0" max="500" step="0.01" value={ratePolicyDraft.directCostPercent} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, directCostPercent: event.target.value })} /></label>
              </div>
            </fieldset>
            <label className="estimate-rate-reason">{t('Revision reason')}<textarea required minLength="8" maxLength="500" value={ratePolicyDraft.reason} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, reason: event.target.value })} /></label>
            <p className="workflow-note">{t('Policy approval changes only future internal draft calculations. Worker directory rates and existing measurements remain unchanged.')}</p>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditingRatePolicy(false)}>{t('Cancel')}</button>
              <button className="primary-button" disabled={submitting || !ratePolicyReady}><ChevronRight size={15} /> {t('Request approval')}</button>
            </div>
          </form>
        </div>
      ) : null}
      {rateBuildUpTarget && rateBuildUpDraft && activeRatePolicy ? (
        <div className="estimate-rate-editor-wrap" role="presentation">
          <form className="estimate-rate-editor unit-rate-editor" role="dialog" aria-modal="true" aria-labelledby="unit-rate-title" onSubmit={submitRateBuildUp}>
            <div className="panel-heading">
              <div>
                <h3 id="unit-rate-title">{t('Unit-rate build-up')}</h3>
                <p>{rateBuildUpTarget.item.description} / {rateBuildUpTarget.item.unit}</p>
              </div>
              <button type="button" className="icon-button" aria-label={t('Close unit-rate build-up')} onClick={() => { setRateBuildUpTarget(null); setRateBuildUpDraft(null) }}><X size={16} /></button>
            </div>
            <div className="form-grid unit-rate-input-grid">
              <label>{t('Labour class')}<select value={rateBuildUpDraft.labourClassCode} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, labourClassCode: event.target.value })}>{(activeRatePolicy.derived?.labourClasses || EMPTY_LIST).map((row) => <option key={row.code} value={row.code}>{row.name} / {rateMoney(row.fullyBurdenedHourlyRate, activeRatePolicy.currency)}/h</option>)}</select></label>
              <label>{t('Labour hours / unit')}<input required type="number" min="0" max="1000000" step="0.0001" value={rateBuildUpDraft.labourHoursPerUnit} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, labourHoursPerUnit: event.target.value })} /></label>
              <label>{t('Material / unit')}<input required type="number" min="0" max="1000000000" step="0.01" value={rateBuildUpDraft.materialCostPerUnit} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, materialCostPerUnit: event.target.value })} /></label>
              <label>{t('Equipment / unit')}<input required type="number" min="0" max="1000000000" step="0.01" value={rateBuildUpDraft.equipmentCostPerUnit} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, equipmentCostPerUnit: event.target.value })} /></label>
              <label>{t('Subcontract / unit')}<input required type="number" min="0" max="1000000000" step="0.01" value={rateBuildUpDraft.subcontractCostPerUnit} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, subcontractCostPerUnit: event.target.value })} /></label>
              <label>{t('Other direct / unit')}<input required type="number" min="0" max="1000000000" step="0.01" value={rateBuildUpDraft.otherDirectCostPerUnit} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, otherDirectCostPerUnit: event.target.value })} /></label>
              <label>{t('Target margin (%)')}<input required type="number" min="0" max="90" step="0.01" value={rateBuildUpDraft.targetMarginPercent} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, targetMarginPercent: event.target.value })} /></label>
            </div>
            {ratePreview?.marginOverride ? <label className="estimate-rate-reason">{t('Margin override reason')}<textarea required minLength="8" maxLength="500" value={rateBuildUpDraft.marginOverrideReason} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, marginOverrideReason: event.target.value })} /></label> : null}
            {ratePreview ? (
              <div className="unit-rate-preview" aria-label={t('Unit-rate calculation preview')}>
                <div><span>{t('Burdened labour')}</span><strong>{rateMoney(ratePreview.labourCost, activeRatePolicy.currency)}</strong></div>
                <div><span>{t('Direct cost')}</span><strong>{rateMoney(ratePreview.directCost, activeRatePolicy.currency)}</strong></div>
                <div><span>{t('Overhead recovery')}</span><strong>{rateMoney(ratePreview.overhead, activeRatePolicy.currency)}</strong></div>
                <div><span>{t('Unit cost')}</span><strong>{rateMoney(ratePreview.unitCost, activeRatePolicy.currency)}</strong></div>
                <div><span>{t('Unit sell rate')}</span><strong>{rateMoney(ratePreview.unitSellRate, activeRatePolicy.currency)}</strong></div>
                <div><span>{t('Equivalent markup')}</span><strong>{ratePreview.markupPercent}%</strong></div>
              </div>
            ) : null}
            <p className="workflow-note">{t('This updates only the selected draft measurement. Estimate conversion remains approval-gated.')}</p>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => { setRateBuildUpTarget(null); setRateBuildUpDraft(null) }}>{t('Cancel')}</button>
              <button className="primary-button" disabled={submitting || !rateBuildUpReady}><Calculator size={15} /> {t('Apply build-up')}</button>
            </div>
          </form>
        </div>
      ) : null}
      <p className="workflow-note">
        {t('Takeoff conversion seals the WBS, measured basis, and package rollups into one internal quote approval. It does not issue a proposal, contact the client, or alter contract value.')}
      </p>
    </section>
  )
}

function ProductionControl({
  job,
  locale,
  canCoordinate,
  canReport,
  canApprove,
  submitting,
  outboxPending,
  outboxSyncing,
  onRequestBaseline,
  onRecordEntry,
  onRequestReversal,
  onOpenApprovals,
  onSyncOutbox,
}) {
  const t = (key, variables = {}) => operatorText(locale, key, variables)
  const production = job.productionControl || {}
  const activeBaseline = production.activeBaseline || null
  const activeBaselineId = activeBaseline?.id || ''
  const firstProductionLineKey = activeBaseline?.snapshot?.lines?.[0]?.lineKey || ''
  const pendingBaseline = production.pendingBaseline || null
  const lines = production.lines || EMPTY_LIST
  const entries = production.entries || job.productionEntries || EMPTY_LIST
  const [editingBaseline, setEditingBaseline] = useState(false)
  const [baselineLines, setBaselineLines] = useState(() => [emptyProductionBaselineLine(0)])
  const [baselineNotes, setBaselineNotes] = useState('')
  const [entryDraft, setEntryDraft] = useState(() => emptyProductionEntry(activeBaselineId, firstProductionLineKey))
  const [reversalEntryId, setReversalEntryId] = useState(null)
  const [reversalReason, setReversalReason] = useState('')

  useEffect(() => {
    setEntryDraft(emptyProductionEntry(activeBaselineId, firstProductionLineKey))
    setEditingBaseline(false)
    setReversalEntryId(null)
    setReversalReason('')
  }, [job.id, activeBaselineId, firstProductionLineKey])

  function beginBaselineRevision() {
    const retainedLines = activeBaseline?.snapshot?.lines || EMPTY_LIST
    setBaselineLines(retainedLines.length
      ? retainedLines.map((line) => ({
          lineKey: line.lineKey,
          costCode: line.costCode,
          description: line.description,
          unit: line.unit,
          plannedQuantity: String(line.plannedQuantity),
          plannedLaborHours: String(line.plannedLaborHours),
        }))
      : [emptyProductionBaselineLine(0)])
    setBaselineNotes('')
    setEditingBaseline(true)
  }

  function updateBaselineLine(index, patch) {
    setBaselineLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line))
  }

  async function submitBaseline(event) {
    event.preventDefault()
    const retainedLines = baselineLines.map((line) => ({
      ...line,
      plannedQuantity: Number(line.plannedQuantity),
      plannedLaborHours: Number(line.plannedLaborHours),
    }))
    if (retainedLines.some((line) => !line.description.trim() || !(line.plannedQuantity > 0) || !(line.plannedLaborHours > 0))) return
    const retained = await onRequestBaseline({ lines: retainedLines, notes: baselineNotes.trim() })
    if (retained) setEditingBaseline(false)
  }

  async function submitEntry(event) {
    event.preventDefault()
    const quantity = Number(entryDraft.quantity)
    const crewHours = Number(entryDraft.crewHours)
    if (!entryDraft.lineKey || !(quantity > 0) || !(crewHours >= 0) || entryDraft.note.trim().length < 3) return
    const retained = await onRecordEntry({
      ...entryDraft,
      quantity,
      crewHours,
      note: entryDraft.note.trim(),
      source: 'job_workspace',
    })
    if (retained) setEntryDraft(emptyProductionEntry(activeBaselineId, firstProductionLineKey))
  }

  async function submitReversal(event) {
    event.preventDefault()
    if (!reversalEntryId || reversalReason.trim().length < 5) return
    const retained = await onRequestReversal(reversalEntryId, reversalReason.trim())
    if (retained) {
      setReversalEntryId(null)
      setReversalReason('')
    }
  }

  const summary = production.summary || {}
  const performanceStatus = summary.performanceFactor === null || summary.performanceFactor === undefined
    ? t('Not rated')
    : roundDisplay(summary.performanceFactor)

  return (
    <section className="job-workspace-section production-control" data-testid="production-control">
      <div className="section-heading production-heading">
        <Activity size={18} />
        <div>
          <h3>{t('Production control')}</h3>
          <p>{t('Compare measured installed output and crew hours with one approved production baseline.')}</p>
        </div>
        {canCoordinate && !pendingBaseline && !editingBaseline ? (
          <button type="button" className="secondary-button" disabled={submitting} onClick={beginBaselineRevision}>
            <Ruler size={15} />
            {activeBaseline ? t('Revise baseline') : t('Create baseline')}
          </button>
        ) : null}
      </div>

      <div className="production-summary" aria-label={t('Production performance summary')}>
        <div><span>{t('Quantity progress')}</span><strong>{roundDisplay(summary.quantityProgressPercent || 0)}%</strong></div>
        <div><span>{t('Earned / crew hours')}</span><strong>{roundDisplay(summary.earnedHours || 0)} / {roundDisplay(summary.crewHours || 0)}</strong></div>
        <div><span>{t('Performance factor')}</span><strong>{performanceStatus}</strong></div>
        <div><span>{t('At-risk lines')}</span><strong>{summary.atRiskLines || 0}</strong></div>
      </div>

      {pendingBaseline ? (
        <div className="production-pending" role="status">
          <ShieldCheck size={16} />
          <span>{t('Baseline v{version} is awaiting approval. Output remains bound to the current approved baseline.', { version: pendingBaseline.versionNumber })}</span>
          {canApprove ? (
            <button type="button" className="secondary-button" onClick={() => onOpenApprovals({ approvalId: pendingBaseline.approvalId, jobId: job.id, jobTitle: job.title })}>
              {t('Review approval')}
            </button>
          ) : null}
        </div>
      ) : null}

      {editingBaseline ? (
        <form className="production-baseline-editor" data-testid="production-baseline-form" onSubmit={submitBaseline}>
          <div className="production-editor-heading">
            <div>
              <strong>{activeBaseline ? t('Revised production baseline') : t('Initial production baseline')}</strong>
              <small>{t('Keep existing line keys and units when revising lines with retained output.')}</small>
            </div>
            <button type="button" className="icon-button" aria-label={t('Cancel production baseline')} onClick={() => setEditingBaseline(false)}><X size={16} /></button>
          </div>
          <div className="production-baseline-lines">
            {baselineLines.map((line, index) => (
              <div className="production-baseline-line" key={index}>
                <label>{t('Line key')}<input required minLength="2" maxLength="100" value={line.lineKey} onChange={(event) => updateBaselineLine(index, { lineKey: event.target.value })} /></label>
                <label>{t('Cost code')}<input required minLength="2" maxLength="80" value={line.costCode} onChange={(event) => updateBaselineLine(index, { costCode: event.target.value })} /></label>
                <label className="production-description">{t('Description')}<input required minLength="2" maxLength="300" value={line.description} onChange={(event) => updateBaselineLine(index, { description: event.target.value })} /></label>
                <label>{t('Unit')}<input required maxLength="30" value={line.unit} onChange={(event) => updateBaselineLine(index, { unit: event.target.value })} /></label>
                <label>{t('Planned quantity')}<input required type="number" min="0.0001" step="0.0001" value={line.plannedQuantity} onChange={(event) => updateBaselineLine(index, { plannedQuantity: event.target.value })} /></label>
                <label>{t('Labor hours')}<input required type="number" min="0.01" step="0.01" value={line.plannedLaborHours} onChange={(event) => updateBaselineLine(index, { plannedLaborHours: event.target.value })} /></label>
                {baselineLines.length > 1 ? (
                  <button type="button" className="icon-button production-remove-line" aria-label={t('Remove production line {number}', { number: index + 1 })} onClick={() => setBaselineLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><X size={15} /></button>
                ) : null}
              </div>
            ))}
          </div>
          <label className="production-notes">{t('Reviewer context')}<textarea maxLength="4000" value={baselineNotes} onChange={(event) => setBaselineNotes(event.target.value)} placeholder={t('Record measurement basis, crew assumptions, and retained references.')} /></label>
          <div className="modal-actions">
            <button type="button" className="secondary-button" disabled={submitting || baselineLines.length >= 200} onClick={() => setBaselineLines((current) => [...current, emptyProductionBaselineLine(current.length)])}><Plus size={15} />{t('Line')}</button>
            <button className="primary-button" disabled={submitting}><ShieldCheck size={15} />{submitting ? t('Retaining...') : t('Request baseline approval')}</button>
          </div>
        </form>
      ) : null}

      {activeBaseline ? (
        <div className="production-line-register" role="table" aria-label={t('Production baseline lines')}>
          {lines.map((line) => (
            <div className={`production-line-row ${line.atRisk ? 'production-line-risk' : ''}`} role="row" key={line.lineKey}>
              <div className="production-line-copy" role="cell"><strong>{line.description}</strong><small>{line.costCode} / {line.lineKey}</small></div>
              <div role="cell"><span>{t('Installed')}</span><strong>{roundDisplay(line.installedQuantity)} / {roundDisplay(line.plannedQuantity)} {line.unit}</strong></div>
              <div role="cell"><span>{t('Earned / crew')}</span><strong>{roundDisplay(line.earnedHours)} / {roundDisplay(line.crewHours)} h</strong></div>
              <div role="cell"><span>{t('Factor')}</span><strong>{line.performanceFactor === null ? t('Not rated') : roundDisplay(line.performanceFactor)}</strong></div>
            </div>
          ))}
        </div>
      ) : !editingBaseline ? (
        <Empty title={t('No approved production baseline')} detail={t('An office operator must retain measured plan quantities and labor hours before field output can be recorded.')} />
      ) : null}

      {activeBaseline && canReport ? (
        <form className="production-entry-form" data-testid="production-entry-form" onSubmit={submitEntry}>
          <div className="production-entry-heading">
            <div className="production-entry-copy"><strong>{t('Record installed output')}</strong><small>{t('Operational crew hours support productivity review and do not replace payroll time cards.')}</small></div>
            <div className="production-outbox-status" aria-live="polite">
              {outboxPending ? (
                <button type="button" className="secondary-button" disabled={outboxSyncing || navigator.onLine === false} onClick={onSyncOutbox}>
                  <RefreshCw size={14} className={outboxSyncing ? 'spin' : ''} />
                  {outboxSyncing ? t('Syncing...') : t('{count} queued', { count: outboxPending })}
                </button>
              ) : (
                <span className="tag tag-green">{t('Outbox clear')}</span>
              )}
            </div>
          </div>
          <div className="form-grid">
            <label>{t('Production line')}<select required value={entryDraft.lineKey} onChange={(event) => setEntryDraft({ ...entryDraft, lineKey: event.target.value })}>{lines.map((line) => <option key={line.lineKey} value={line.lineKey}>{line.description} ({line.unit})</option>)}</select></label>
            <label>{t('Work date')}<input required type="date" value={entryDraft.workDate} onChange={(event) => setEntryDraft({ ...entryDraft, workDate: event.target.value })} /></label>
            <label>{t('Installed quantity')}<input required type="number" min="0.0001" step="0.0001" value={entryDraft.quantity} onChange={(event) => setEntryDraft({ ...entryDraft, quantity: event.target.value })} /></label>
            <label>{t('Crew hours')}<input required type="number" min="0" max="12000" step="0.01" value={entryDraft.crewHours} onChange={(event) => setEntryDraft({ ...entryDraft, crewHours: event.target.value })} /></label>
            <label className="form-span">{t('Field note')}<textarea required minLength="3" maxLength="4000" value={entryDraft.note} onChange={(event) => setEntryDraft({ ...entryDraft, note: event.target.value })} placeholder={t('Record measured area, work location, crew conditions, and evidence reference.')} /></label>
          </div>
          <div className="modal-actions"><button className="primary-button" disabled={submitting}><Activity size={15} />{submitting ? t('Recording...') : navigator.onLine === false ? t('Save output offline') : t('Record output')}</button></div>
        </form>
      ) : null}

      {entries.length ? (
        <div className="production-entry-register" aria-label={t('Recent production entries')}>
          {entries.slice(0, 10).map((entry) => {
            const line = (activeBaseline?.snapshot?.lines || EMPTY_LIST).find((item) => item.lineKey === entry.lineKey)
            return (
              <div className="production-entry-row" key={entry.id}>
                <div><strong>{line?.description || entry.lineKey}</strong><small>{formatDate(entry.workDate)} / {entry.note || t('No note')}</small></div>
                <div><span>{roundDisplay(entry.quantity)} {line?.unit || t('unit')}</span><span>{roundDisplay(entry.crewHours)} h</span><span className={`status status-${entry.status}`}>{t(formatStatus(entry.status))}</span></div>
                {canCoordinate && entry.status === 'recorded' ? <button type="button" className="icon-button" aria-label={t('Request reversal for {line}', { line: line?.description || entry.lineKey })} onClick={() => { setReversalEntryId(entry.id); setReversalReason('') }}><RefreshCw size={15} /></button> : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {reversalEntryId ? (
        <form className="production-reversal-form" data-testid="production-reversal-form" onSubmit={submitReversal}>
          <label>{t('Reversal reason')}<textarea autoFocus required minLength="5" maxLength="2000" value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} /></label>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setReversalEntryId(null)}>{t('Cancel')}</button><button className="primary-button" disabled={submitting || reversalReason.trim().length < 5}><ShieldCheck size={15} />{t('Request reversal approval')}</button></div>
        </form>
      ) : null}

      <p className="workflow-note">{t('Baseline approval, field capture, and reversals stay internal. Contractor.AI does not alter payroll, budget, schedule, scope, or external commitments from these records.')}</p>
    </section>
  )
}

function DayworkControl({
  job,
  locale,
  canReport,
  canCoordinate,
  canApprove,
  submitting,
  outboxPending,
  outboxSyncing,
  onSubmit,
  onRequestAcknowledgement,
  onConvert,
  onOpenApprovals,
  onSyncOutbox,
}) {
  const t = (key, variables = {}) => operatorText(locale, key, variables)
  const tickets = job.dayworkTickets || EMPTY_LIST
  const pendingApprovals = job.approvals?.filter((approval) => approval.status === 'pending') || EMPTY_LIST
  const assignments = (job.assignments || EMPTY_LIST).filter((assignment) => !['released', 'cancelled', 'completed', 'closed', 'rejected'].includes(assignment.status))
  const [draft, setDraft] = useState(() => emptyDayworkDraft())
  const [acknowledgementTicketId, setAcknowledgementTicketId] = useState('')
  const [acknowledgement, setAcknowledgement] = useState(() => emptyDayworkAcknowledgement())
  const [pricingTicketId, setPricingTicketId] = useState('')
  const [prices, setPrices] = useState({})
  const [scheduleDeltaDays, setScheduleDeltaDays] = useState('0')
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false)
  const pendingCount = tickets.filter((ticket) => ['pending_approval', 'approved', 'acknowledged'].includes(ticket.status)).length
  const acknowledgedCount = tickets.filter((ticket) => ticket.acknowledgementReference || ticket.acknowledged).length
  const convertedCount = tickets.filter((ticket) => ticket.status === 'converted').length

  useEffect(() => {
    setDraft(emptyDayworkDraft())
    setAcknowledgementTicketId('')
    setAcknowledgement(emptyDayworkAcknowledgement())
    setPricingTicketId('')
    setPrices({})
    setScheduleDeltaDays('0')
  }, [job.id])

  useEffect(() => {
    const updateConnectivity = () => setOnline(navigator.onLine !== false)
    window.addEventListener('online', updateConnectivity)
    window.addEventListener('offline', updateConnectivity)
    return () => {
      window.removeEventListener('online', updateConnectivity)
      window.removeEventListener('offline', updateConnectivity)
    }
  }, [])

  function updateLine(index, patch) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
    }))
  }

  function changeLineType(index, lineType) {
    updateLine(index, {
      lineType,
      unit: ['labor', 'equipment'].includes(lineType) ? 'hour' : 'unit',
      costCode: `DAYWORK_${lineType.toUpperCase()}`,
    })
  }

  async function submitTicket(event) {
    event.preventDefault()
    const lines = draft.lines.map((line) => ({
      ...line,
      description: line.description.trim(),
      quantity: Number(line.quantity),
      unit: line.unit.trim(),
      costCode: line.costCode.trim(),
      sourceReference: line.sourceReference.trim() || null,
    }))
    if (
      draft.title.trim().length < 2
      || draft.description.trim().length < 3
      || draft.reason.trim().length < 3
      || draft.evidenceReference.trim().length < 3
      || lines.some((line) => line.description.length < 2 || !(line.quantity > 0) || !line.unit || line.costCode.length < 2)
    ) return
    const selectedAssignment = assignments.find((assignment) => assignment.workerId === draft.workerId)
    const retained = await onSubmit({
      ...draft,
      workerName: selectedAssignment?.workerName || null,
      title: draft.title.trim(),
      description: draft.description.trim(),
      reason: draft.reason.trim(),
      evidenceReference: draft.evidenceReference.trim(),
      notes: draft.notes.trim() || null,
      lines,
      source: 'job_workspace_daywork',
    })
    if (retained) setDraft(emptyDayworkDraft())
  }

  function beginAcknowledgement(ticket) {
    setPricingTicketId('')
    setAcknowledgementTicketId(ticket.id)
    setAcknowledgement(emptyDayworkAcknowledgement())
  }

  async function submitAcknowledgement(event) {
    event.preventDefault()
    if (
      !acknowledgementTicketId
      || acknowledgement.evidenceReference.trim().length < 3
      || acknowledgement.acknowledgedBy.trim().length < 2
      || !acknowledgement.acknowledgedAt
    ) return
    const retained = await onRequestAcknowledgement(acknowledgementTicketId, {
      evidenceReference: acknowledgement.evidenceReference.trim(),
      acknowledgedBy: acknowledgement.acknowledgedBy.trim(),
      acknowledgedAt: toIsoDateTime(acknowledgement.acknowledgedAt),
      notes: acknowledgement.notes.trim() || null,
    })
    if (retained) {
      setAcknowledgementTicketId('')
      setAcknowledgement(emptyDayworkAcknowledgement())
    }
  }

  function beginPricing(ticket) {
    setAcknowledgementTicketId('')
    setPricingTicketId(ticket.id)
    setPrices(Object.fromEntries((ticket.lines || EMPTY_LIST).map((line) => [line.lineKey, ''])))
    setScheduleDeltaDays('0')
  }

  async function submitPricing(event) {
    event.preventDefault()
    const ticket = tickets.find((item) => item.id === pricingTicketId)
    if (!ticket) return
    const retainedPrices = (ticket.lines || EMPTY_LIST).map((line) => ({
      lineKey: line.lineKey,
      unitPrice: Number(prices[line.lineKey]),
    }))
    if (retainedPrices.some((line) => !(line.unitPrice >= 0))) return
    const retained = await onConvert(ticket.id, {
      prices: retainedPrices,
      scheduleDeltaDays: Number(scheduleDeltaDays || 0),
      taxRate: 21,
      currency: 'EUR',
    })
    if (retained) {
      setPricingTicketId('')
      setPrices({})
      setScheduleDeltaDays('0')
    }
  }

  return (
    <section className="job-workspace-section daywork-control" data-testid="daywork-control">
      <div className="section-heading daywork-heading">
        <ClipboardPenLine size={18} />
        <div>
          <h3>{t('Daywork and extra work')}</h3>
          <p>{t('Retain observed site quantities first, then route acknowledgement and pricing through separate approval gates.')}</p>
        </div>
        <div className="daywork-outbox-status" aria-live="polite">
          {outboxPending ? (
            <button type="button" className="secondary-button" disabled={outboxSyncing || !online} onClick={onSyncOutbox}>
              <RefreshCw size={14} className={outboxSyncing ? 'spin' : ''} />
              {outboxSyncing ? t('Syncing...') : t('{count} queued', { count: outboxPending })}
            </button>
          ) : <span className="tag tag-green">{t('Outbox clear')}</span>}
        </div>
      </div>

      <div className="daywork-summary" aria-label={t('Daywork ticket summary')}>
        <div><span>{t('Tickets')}</span><strong>{tickets.length}</strong></div>
        <div><span>{t('Open control')}</span><strong>{pendingCount}</strong></div>
        <div><span>{t('Acknowledged')}</span><strong>{acknowledgedCount}</strong></div>
        <div><span>{t('Converted')}</span><strong>{convertedCount}</strong></div>
      </div>

      {canReport ? (
        <form className="daywork-entry-form" data-testid="daywork-entry-form" onSubmit={submitTicket}>
          <div className="daywork-form-heading">
            <div><strong>{t('Record observed extra work')}</strong><small>{t('Quantities and evidence are retained without price, scope acceptance, or external commitment.')}</small></div>
          </div>
          <div className="form-grid">
            <label>{t('Work date')}<input required type="date" value={draft.workDate} onChange={(event) => setDraft({ ...draft, workDate: event.target.value })} /></label>
            {canCoordinate ? (
              <label>{t('Responsible worker')}<select value={draft.workerId} onChange={(event) => setDraft({ ...draft, workerId: event.target.value })}><option value="">{t('Office record / unassigned')}</option>{assignments.map((assignment) => <option key={assignment.id} value={assignment.workerId}>{assignment.workerName || assignment.workerId}</option>)}</select></label>
            ) : null}
            <label className="form-span">{t('Title')}<input required minLength="2" maxLength="240" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={t('Additional work observed')} /></label>
            <label className="form-span">{t('Work completed')}<textarea required minLength="3" maxLength="4000" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder={t('Record location, completed work, and site conditions.')} /></label>
            <label className="form-span">{t('Reason')}<textarea required minLength="3" maxLength="2000" value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} placeholder={t('Record why this work was outside or changed from the retained basis.')} /></label>
            <label>{t('Evidence reference')}<input required minLength="3" maxLength="500" value={draft.evidenceReference} onChange={(event) => setDraft({ ...draft, evidenceReference: event.target.value })} placeholder={t('Photo set, drawing, instruction')} /></label>
            <label>{t('Internal note')}<input maxLength="2000" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
          </div>
          <div className="daywork-lines" aria-label={t('Observed daywork quantities')}>
            {draft.lines.map((line, index) => (
              <div className="daywork-line-editor" key={line.lineKey}>
                <label>{t('Type')}<select value={line.lineType} onChange={(event) => changeLineType(index, event.target.value)}><option value="labor">{t('Labor')}</option><option value="material">{t('Material')}</option><option value="equipment">{t('Equipment')}</option><option value="subcontract">{t('Subcontract')}</option><option value="other">{t('Other')}</option></select></label>
                <label className="daywork-line-description">{t('Description')}<input required minLength="2" maxLength="240" value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} /></label>
                <label>{t('Quantity')}<input required type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label>
                <label>{t('Unit')}<input required maxLength="24" value={line.unit} onChange={(event) => updateLine(index, { unit: event.target.value })} /></label>
                <label>{t('Cost code')}<input required minLength="2" maxLength="80" value={line.costCode} onChange={(event) => updateLine(index, { costCode: event.target.value })} /></label>
                <label>{t('Line evidence')}<input maxLength="240" value={line.sourceReference} onChange={(event) => updateLine(index, { sourceReference: event.target.value })} /></label>
                {draft.lines.length > 1 ? <button type="button" className="icon-button" aria-label={t('Remove daywork line {number}', { number: index + 1 })} onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }))}><X size={15} /></button> : <span className="daywork-line-spacer" />}
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary-button" disabled={submitting || draft.lines.length >= 50} onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, emptyDayworkLine('material')] }))}><Plus size={15} />{t('Quantity line')}</button>
            <button className="primary-button" disabled={submitting}><ClipboardPenLine size={15} />{submitting ? t('Retaining...') : !online ? t('Save daywork offline') : t('Submit for review')}</button>
          </div>
        </form>
      ) : null}

      {tickets.length ? (
        <div className="daywork-register" aria-label={t('Retained daywork tickets')}>
          {tickets.map((ticket) => {
            const pendingTicketApproval = pendingApprovals.find((approval) => approval.targetType === 'daywork_ticket' && approval.targetId === ticket.id)
            const pendingAcknowledgementApproval = pendingApprovals.find((approval) => approval.targetType === 'daywork_acknowledgement' && approval.targetId === ticket.id)
            const isPricing = pricingTicketId === ticket.id
            const pricingTotal = (ticket.lines || EMPTY_LIST).reduce((sum, line) => sum + Number(line.quantity || 0) * Number(prices[line.lineKey] || 0), 0)
            return (
              <article className="daywork-ticket" key={ticket.id} data-testid={`daywork-ticket-${ticket.id}`}>
                <div className="daywork-ticket-heading">
                  <div><strong>{ticket.ticketNumber || ticket.title}</strong><span className={`status status-${ticket.status}`}>{t(formatStatus(ticket.status))}</span></div>
                  <small>{formatDate(ticket.workDate)} / {ticket.workerName || t('Office record')} / {t('{count} line(s)', { count: ticket.lineCount || ticket.lines?.length || 0 })}</small>
                </div>
                <div className="daywork-ticket-copy"><strong>{ticket.title}</strong><p>{ticket.description}</p><small>{t('Reason: {reason}', { reason: ticket.reason })}</small><small>{t('Evidence: {reference}', { reference: ticket.evidenceReference })}</small></div>
                <div className="daywork-ticket-lines">
                  {(ticket.lines || EMPTY_LIST).map((line) => <div key={line.lineKey}><span>{t(formatStatus(line.lineType))}</span><strong>{roundDisplay(line.quantity)} {line.unit}</strong><small>{line.description} / {line.costCode}</small></div>)}
                </div>
                <div className="daywork-ticket-actions">
                  {pendingTicketApproval && canApprove ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => onOpenApprovals({ approvalId: pendingTicketApproval.id, jobId: job.id, jobTitle: job.title })}><ShieldCheck size={15} />{t('Review quantities')}</button> : null}
                  {pendingAcknowledgementApproval && canApprove ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => onOpenApprovals({ approvalId: pendingAcknowledgementApproval.id, jobId: job.id, jobTitle: job.title })}><ShieldCheck size={15} />{t('Review acknowledgement')}</button> : null}
                  {canCoordinate && ticket.status === 'approved' && !pendingAcknowledgementApproval ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => beginAcknowledgement(ticket)}><BadgeCheck size={15} />{t('Record acknowledgement')}</button> : null}
                  {canCoordinate && ['approved', 'acknowledged'].includes(ticket.status) ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => beginPricing(ticket)}><ReceiptEuro size={15} />{t('Price change')}</button> : null}
                </div>
                {acknowledgementTicketId === ticket.id ? (
                  <form className="daywork-inline-form" data-testid="daywork-acknowledgement-form" onSubmit={submitAcknowledgement}>
                    <div className="form-grid"><label>{t('Evidence reference')}<input required minLength="3" maxLength="500" value={acknowledgement.evidenceReference} onChange={(event) => setAcknowledgement({ ...acknowledgement, evidenceReference: event.target.value })} /></label><label>{t('Acknowledged by')}<input required minLength="2" maxLength="160" value={acknowledgement.acknowledgedBy} onChange={(event) => setAcknowledgement({ ...acknowledgement, acknowledgedBy: event.target.value })} /></label><label>{t('Date and time')}<input required type="datetime-local" value={acknowledgement.acknowledgedAt} onChange={(event) => setAcknowledgement({ ...acknowledgement, acknowledgedAt: event.target.value })} /></label><label>{t('Internal note')}<input maxLength="2000" value={acknowledgement.notes} onChange={(event) => setAcknowledgement({ ...acknowledgement, notes: event.target.value })} /></label></div>
                    <p className="workflow-note">{t('This records receipt of the site record only. It does not accept price or scope.')}</p>
                    <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setAcknowledgementTicketId('')}>{t('Cancel')}</button><button className="primary-button" disabled={submitting}><ShieldCheck size={15} />{t('Request evidence review')}</button></div>
                  </form>
                ) : null}
                {isPricing ? (
                  <form className="daywork-inline-form" data-testid="daywork-pricing-form" onSubmit={submitPricing}>
                    <div className="daywork-price-lines">{(ticket.lines || EMPTY_LIST).map((line) => <label key={line.lineKey}><span>{line.description}<small>{roundDisplay(line.quantity)} {line.unit}</small></span><input required type="number" min="0" max="1000000000" step="0.01" value={prices[line.lineKey] || ''} onChange={(event) => setPrices((current) => ({ ...current, [line.lineKey]: event.target.value }))} placeholder={t('Unit price')} /></label>)}</div>
                    <div className="daywork-price-summary"><label>{t('Schedule impact (days)')}<input type="number" min="-3650" max="3650" step="0.5" value={scheduleDeltaDays} onChange={(event) => setScheduleDeltaDays(event.target.value)} /></label><div><span>{t('Net change preview')}</span><strong>{currency.format(pricingTotal)}</strong></div></div>
                    <p className="workflow-note">{t('Conversion creates a separate approval-gated change order. It does not contact the client or change contract value.')}</p>
                    <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPricingTicketId('')}>{t('Cancel')}</button><button className="primary-button" disabled={submitting || !(pricingTotal > 0)}><ArrowUpRight size={15} />{t('Prepare change order')}</button></div>
                  </form>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : <Empty title={t('No daywork tickets')} detail={t('Observed extra work will appear here after field or office capture.')} />}

      <p className="workflow-note">{t('Autonomy may surface missing reviews, but it cannot invent quantities, acknowledgement, pricing, client acceptance, supplier spend, schedule commitments, invoices, payments, or funds movement.')}</p>
    </section>
  )
}

function CommercialControl({
  job,
  locale,
  canCoordinate,
  canApprove,
  submitting,
  onNewQuote,
  onNewChangeOrder,
  onRequestAcceptance,
  onRecordChangeDelivery,
  onOpenApprovals,
  onRequestCommercialScope,
  onRequestRiskRegister,
  onRetainPricingBasis,
}) {
  const t = (key, variables = {}) => operatorText(locale, key, variables)
  const quotes = job.quotes || EMPTY_LIST
  const changeOrders = job.changeOrders || EMPTY_LIST
  const commercialScope = useMemo(() => job.commercialScope || {}, [job.commercialScope])
  const currentScope = commercialScope.currentRevision || null
  const pendingScope = commercialScope.pendingRevision || null
  const commercialScopeReady = Boolean(currentScope && commercialScope.stale !== true)
  const pricingBasis = useMemo(() => job.pricingBasis || {}, [job.pricingBasis])
  const currentPricingBasis = pricingBasis.currentDecision || null
  const pricingBasisReady = Boolean(currentPricingBasis && pricingBasis.stale !== true)
  const pendingApprovals = job.approvals?.filter((approval) => approval.status === 'pending') || EMPTY_LIST
  const pendingFor = (targetType, targetId) =>
    pendingApprovals.find((approval) => approval.targetType === targetType && approval.targetId === targetId)
  const pendingScopeApproval = pendingScope ? pendingFor('commercial_scope', pendingScope.id) : null
  const riskRegister = useMemo(() => job.riskRegister || {}, [job.riskRegister])
  const currentRiskRegister = riskRegister.currentRevision || null
  const pendingRiskRegister = riskRegister.pendingRevision || null
  const riskRegisterReady = Boolean(currentRiskRegister && riskRegister.stale !== true)
  const pendingRiskApproval = pendingRiskRegister ? pendingFor('risk_register', pendingRiskRegister.id) : null
  const acceptedQuote = quotes.find((quote) => quote.status === 'accepted')
  const acceptedChanges = changeOrders.filter((changeOrder) => changeOrder.status === 'accepted')
  const acceptedChangeNet = acceptedChanges.reduce((sum, changeOrder) => sum + Number(changeOrder.amount || 0), 0)
  const commercialCurrency = acceptedQuote?.currency || quotes[0]?.currency || 'EUR'
  const acceptedPricingModel = acceptedQuote?.pricingModel || job.data?.commercialPricingModel || null
  const [editingCommercialScope, setEditingCommercialScope] = useState(false)
  const [scopeDraft, setScopeDraft] = useState(() => commercialScopeDraft(job, commercialScope))
  const [editingRiskRegister, setEditingRiskRegister] = useState(false)
  const [riskDraft, setRiskDraft] = useState(() => projectRiskDraft(job, riskRegister))
  const [editingPricingBasis, setEditingPricingBasis] = useState(false)
  const [pricingDraft, setPricingDraft] = useState(() => pricingBasisDraft(pricingBasis))
  const pricingPreview = useMemo(() => pricingBasisPreview(pricingDraft.factors), [pricingDraft.factors])
  const pricingOverride = pricingDraft.selectedModel !== pricingPreview.recommendation
  const pricingDraftReady = pricingDraft.factors.length > 0
    && pricingDraft.factors.every((factor) => ['yes', 'no', 'unknown'].includes(factor.status) && factor.evidence.trim().length >= 8)
    && ['fixed_price', 'time_and_materials'].includes(pricingDraft.selectedModel)
    && pricingDraft.rationale.trim().length >= 8
    && (!pricingOverride || pricingDraft.overrideReason.trim().length >= 12)
  const riskDraftReady = riskDraft.title.trim().length >= 3
    && riskDraft.workshopDate
    && riskDraft.failureStatement.trim().length >= 12
    && riskDraft.facilitator.trim().length >= 2
    && scopeLines(riskDraft.participants).length > 0
    && riskDraft.reason.trim().length >= 8
    && riskDraft.risks.length > 0
    && riskDraft.risks.every((risk) => {
      const residualScore = projectRiskScore(risk, true)
      return risk.riskKey.trim().length > 0
        && risk.title.trim().length >= 3
        && risk.cause.trim().length >= 8
        && risk.event.trim().length >= 8
        && risk.consequence.trim().length >= 8
        && risk.owner.trim().length >= 2
        && risk.mitigationAction.trim().length >= 8
        && risk.contingencyAction.trim().length >= 8
        && risk.trigger.trim().length >= 8
        && risk.failureMode.trim().length >= 8
        && risk.earlyWarning.trim().length >= 8
        && risk.prevention.trim().length >= 8
        && (residualScore < 15 || risk.acceptanceReason.trim().length >= 8)
    })
  const scopeAllowanceTotal = scopeDraft.allowances.reduce((sum, allowance) => {
    const quantity = Number(allowance.quantity)
    const unitRate = Number(allowance.unitRate)
    return sum + (Number.isFinite(quantity) && Number.isFinite(unitRate) ? quantity * unitRate : 0)
  }, 0)
  const scopeDraftReady = scopeDraft.title.trim().length >= 3
    && scopeDraft.scopeSummary.trim().length >= 12
    && scopeLines(scopeDraft.inclusions).length > 0
    && scopeLines(scopeDraft.assumptions).length > 0
    && scopeLines(scopeDraft.exclusions).length > 0
    && scopeDraft.reason.trim().length >= 8
    && (scopeDraft.allowanceMode === 'none'
      ? scopeDraft.noAllowanceReason.trim().length >= 8 && scopeDraft.allowances.length === 0
      : scopeDraft.allowances.length > 0 && scopeDraft.allowances.every((allowance) => (
        allowance.allowanceKey.trim().length > 0
        && allowance.title.trim().length >= 3
        && allowance.description.trim().length >= 3
        && Number(allowance.quantity) > 0
        && Number(allowance.unitRate) >= 0
        && allowance.unit.trim().length > 0
      )))

  useEffect(() => {
    if (!editingCommercialScope) setScopeDraft(commercialScopeDraft(job, commercialScope))
  }, [editingCommercialScope, job, commercialScope, currentScope?.id, pendingScope?.id])

  useEffect(() => {
    if (!editingPricingBasis) setPricingDraft(pricingBasisDraft(pricingBasis))
  }, [editingPricingBasis, job.id, currentPricingBasis?.id, pricingBasis, pricingBasis.stale])

  useEffect(() => {
    if (!editingRiskRegister) setRiskDraft(projectRiskDraft(job, riskRegister))
  }, [editingRiskRegister, job, riskRegister, currentRiskRegister?.id, pendingRiskRegister?.id])

  function openCommercialScopeEditor() {
    setScopeDraft(commercialScopeDraft(job, commercialScope))
    setEditingCommercialScope(true)
  }

  function updateScopeAllowance(index, patch) {
    setScopeDraft((current) => ({
      ...current,
      allowances: current.allowances.map((allowance, allowanceIndex) => allowanceIndex === index ? { ...allowance, ...patch } : allowance),
    }))
  }

  async function submitCommercialScope(event) {
    event.preventDefault()
    if (!scopeDraftReady) return
    const result = await onRequestCommercialScope({
      entryKey: `commercial-scope:${job.id}:${Date.now()}`,
      title: scopeDraft.title.trim(),
      scopeSummary: scopeDraft.scopeSummary.trim(),
      inclusions: scopeLines(scopeDraft.inclusions),
      assumptions: scopeLines(scopeDraft.assumptions),
      exclusions: scopeLines(scopeDraft.exclusions),
      clientResponsibilities: scopeLines(scopeDraft.clientResponsibilities),
      contractorResponsibilities: scopeLines(scopeDraft.contractorResponsibilities),
      currency: 'EUR',
      allowanceMode: scopeDraft.allowanceMode,
      noAllowanceReason: scopeDraft.allowanceMode === 'none' ? scopeDraft.noAllowanceReason.trim() : null,
      clarificationDeadline: scopeDraft.clarificationDeadline || null,
      allowances: scopeDraft.allowanceMode === 'defined' ? scopeDraft.allowances.map((allowance) => ({
        allowanceKey: allowance.allowanceKey.trim(),
        allowanceType: allowance.allowanceType,
        title: allowance.title.trim(),
        description: allowance.description.trim(),
        quantity: Number(allowance.quantity),
        unit: allowance.unit.trim(),
        unitRate: Number(allowance.unitRate),
        reconciliationMethod: allowance.reconciliationMethod,
        selectionBy: allowance.selectionBy,
        dueAt: allowance.dueAt || null,
        evidenceReference: allowance.evidenceReference.trim() || null,
        notes: allowance.notes.trim() || null,
      })) : [],
      reason: scopeDraft.reason.trim(),
    })
    if (result) setEditingCommercialScope(false)
  }

  function openPricingBasisEditor() {
    setPricingDraft(pricingBasisDraft(pricingBasis))
    setEditingPricingBasis(true)
  }

  function updatePricingFactor(index, patch) {
    setPricingDraft((current) => ({
      ...current,
      factors: current.factors.map((factor, factorIndex) => factorIndex === index ? { ...factor, ...patch } : factor),
    }))
  }

  async function submitPricingBasis(event) {
    event.preventDefault()
    if (!pricingDraftReady) return
    const retained = await onRetainPricingBasis({
      entryKey: `pricing-basis:${job.id}:${Date.now()}`,
      commercialScopeRevisionId: currentScope?.id || null,
      riskRegisterRevisionId: currentRiskRegister?.id || null,
      selectedModel: pricingDraft.selectedModel,
      rationale: pricingDraft.rationale.trim(),
      overrideReason: pricingOverride ? pricingDraft.overrideReason.trim() : null,
      factors: pricingDraft.factors.map((factor) => ({
        key: factor.key,
        status: factor.status,
        evidence: factor.evidence.trim(),
      })),
    })
    if (retained) setEditingPricingBasis(false)
  }

  function updateProjectRisk(index, patch) {
    setRiskDraft((current) => ({
      ...current,
      risks: current.risks.map((risk, riskIndex) => riskIndex === index ? { ...risk, ...patch } : risk),
    }))
  }

  async function submitRiskRegister(event) {
    event.preventDefault()
    if (!riskDraftReady) return
    const result = await onRequestRiskRegister({
      entryKey: `risk-register:${job.id}:${Date.now()}`,
      commercialScopeRevisionId: currentScope?.id || null,
      title: riskDraft.title.trim(),
      currency: 'EUR',
      risks: riskDraft.risks.map((risk) => ({
        riskKey: risk.riskKey.trim().toUpperCase(),
        category: risk.category,
        title: risk.title.trim(),
        cause: risk.cause.trim(),
        event: risk.event.trim(),
        consequence: risk.consequence.trim(),
        owner: risk.owner.trim(),
        probability: Number(risk.probability),
        impact: Number(risk.impact),
        responseStrategy: risk.responseStrategy,
        mitigationAction: risk.mitigationAction.trim(),
        contingencyAction: risk.contingencyAction.trim(),
        trigger: risk.trigger.trim(),
        dueAt: risk.dueAt || null,
        residualProbability: Number(risk.residualProbability),
        residualImpact: Number(risk.residualImpact),
        costExposureAmount: Number(risk.costExposureAmount) || 0,
        scheduleExposureDays: Number(risk.scheduleExposureDays) || 0,
        status: risk.status,
        acceptanceReason: risk.acceptanceReason.trim() || null,
        evidenceReference: risk.evidenceReference.trim() || null,
      })),
      premortem: {
        workshopDate: riskDraft.workshopDate,
        failureStatement: riskDraft.failureStatement.trim(),
        facilitator: riskDraft.facilitator.trim(),
        participants: scopeLines(riskDraft.participants),
        failureModes: riskDraft.risks.map((risk) => ({
          riskKey: risk.riskKey.trim().toUpperCase(),
          failureMode: risk.failureMode.trim(),
          earlyWarning: risk.earlyWarning.trim(),
          prevention: risk.prevention.trim(),
        })),
      },
      reason: riskDraft.reason.trim(),
    })
    if (result) setEditingRiskRegister(false)
  }

  return (
    <section className="job-workspace-section commercial-control" data-testid="commercial-control">
      <div className="section-heading commercial-heading">
        <ReceiptEuro size={18} />
        <div>
          <h3>{t('Commercial control')}</h3>
          <p>{t('Separate internal approval from retained client acceptance before contract value changes.')}</p>
        </div>
      </div>
      <div className={`scope-definition-strip ${commercialScopeReady ? 'scope-definition-active' : 'scope-definition-missing'}`} data-testid="commercial-scope-control">
        <ClipboardList size={18} />
        <div className="scope-definition-copy">
          <div>
            <strong>{commercialScopeReady ? currentScope.title : pendingScope ? t('Commercial scope awaiting approval') : commercialScope.stale ? t('Commercial scope requires revision') : t('Commercial scope not retained')}</strong>
            {currentScope ? <span className="tag">v{currentScope.versionNumber}</span> : null}
            {pendingScope ? <span className="tag tag-amber">v{pendingScope.versionNumber} {t('pending')}</span> : null}
          </div>
          <span>
            {commercialScopeReady
              ? t('{inclusions} inclusions / {assumptions} assumptions / {exclusions} exclusions / {allowances} allowances totaling {total}', {
                  inclusions: currentScope.snapshot?.inclusions?.length || 0,
                  assumptions: currentScope.snapshot?.assumptions?.length || 0,
                  exclusions: currentScope.snapshot?.exclusions?.length || 0,
                  allowances: currentScope.snapshot?.allowances?.length || 0,
                  total: rateMoney(currentScope.allowanceTotal, currentScope.currency),
                })
              : pendingScope
                ? t('Pricing and quote approval remain blocked until an approver accepts this exact source-bound revision.')
                : t('Write the promised work, assumptions, exclusions, responsibilities, and allowance reconciliation before selecting a pricing model.')}
          </span>
        </div>
        {commercialScope.stale ? <span className="tag tag-amber">{t('Source changed')}</span> : commercialScopeReady ? <span className="tag tag-green">{t('Approved + current')}</span> : null}
        {pendingScopeApproval && canApprove ? (
          <button type="button" className="secondary-button" disabled={submitting} onClick={() => onOpenApprovals({ approvalId: pendingScopeApproval.id })}>
            <ShieldCheck size={14} />{t('Review scope')}
          </button>
        ) : canCoordinate ? (
          <button type="button" className="secondary-button" disabled={submitting || Boolean(pendingScope)} title={pendingScope ? t('Resolve the pending scope revision first') : currentScope ? t('Prepare a new source-bound revision') : t('Prepare the initial commercial scope')} onClick={openCommercialScopeEditor}>
            <ClipboardPenLine size={14} />{currentScope ? t('Revise scope') : t('Write scope')}
          </button>
        ) : null}
      </div>
      <div className={`project-risk-strip ${riskRegisterReady ? 'project-risk-active' : 'project-risk-missing'}`} data-testid="project-risk-register-control">
        <TriangleAlert size={18} />
        <div className="project-risk-copy">
          <div>
            <strong>{riskRegisterReady ? currentRiskRegister.title : pendingRiskRegister ? t('Project risk review awaiting approval') : riskRegister.stale ? t('Project risk review requires revision') : t('Project risk register not retained')}</strong>
            {currentRiskRegister ? <span className="tag">v{currentRiskRegister.versionNumber}</span> : null}
            {pendingRiskRegister ? <span className="tag tag-amber">v{pendingRiskRegister.versionNumber} {t('pending')}</span> : null}
          </div>
          <span>
            {riskRegisterReady
              ? t('{risks} risks / {high} high residual / {exposure} expected exposure / {modes} premortem modes', {
                  risks: currentRiskRegister.riskCount,
                  high: currentRiskRegister.highRiskCount,
                  exposure: rateMoney(currentRiskRegister.totalExpectedValue, currentRiskRegister.currency),
                  modes: currentRiskRegister.snapshot?.summary?.premortemFailureModeCount || 0,
                })
              : pendingRiskRegister
                ? t('Pricing and quote approval remain blocked until an approver verifies ownership, treatments, exposure, and premortem links.')
                : t('Run the premortem, identify causes, events, consequences, owners, triggers, treatments, and residual exposure before pricing.')}
          </span>
        </div>
        {riskRegister.stale ? <span className="tag tag-amber">{t('Source changed')}</span> : riskRegisterReady ? <span className="tag tag-green">{t('Approved + current')}</span> : null}
        {pendingRiskApproval && canApprove ? (
          <button type="button" className="secondary-button" disabled={submitting} onClick={() => onOpenApprovals({ approvalId: pendingRiskApproval.id })}>
            <ShieldCheck size={14} />{t('Review risks')}
          </button>
        ) : canCoordinate ? (
          <button type="button" className="secondary-button" disabled={submitting || !commercialScopeReady || Boolean(pendingRiskRegister)} title={!commercialScopeReady ? t('Approve the commercial scope first') : pendingRiskRegister ? t('Resolve the pending risk revision first') : t('Prepare a source-bound project risk review')} onClick={() => { setRiskDraft(projectRiskDraft(job, riskRegister)); setEditingRiskRegister(true) }}>
            <ClipboardPenLine size={14} />{currentRiskRegister ? t('Revise risks') : t('Run premortem')}
          </button>
        ) : null}
      </div>
      <div className={`pricing-basis-strip ${pricingBasisReady ? 'pricing-basis-active' : 'pricing-basis-missing'}`} data-testid="pricing-basis-control">
        <GitBranch size={18} />
        <div className="pricing-basis-copy">
          <div>
            <strong>{pricingBasisReady ? t(pricingModelLabel(currentPricingBasis.selectedModel)) : pricingBasis.stale ? t('Commercial basis requires reassessment') : t('Commercial pricing basis not retained')}</strong>
            {currentPricingBasis ? <span className="tag">v{currentPricingBasis.versionNumber}</span> : null}
            {currentPricingBasis?.snapshot?.override ? <span className="tag tag-amber">{t('Override')}</span> : null}
          </div>
          <span>
            {currentPricingBasis
              ? t('{score}% fixed-price readiness / recommendation {recommendation} / {rationale}', { score: currentPricingBasis.score, recommendation: t(pricingModelLabel(currentPricingBasis.recommendation)).toLowerCase(), rationale: currentPricingBasis.snapshot?.rationale || t('No rationale retained') })
              : t('No quote can enter approval until the current scope, quantities, site conditions, selections, productivity, schedule, price exposure, and change risk have been assessed.')}
          </span>
        </div>
        {pricingBasis.stale ? <span className="tag tag-amber">{t('Source changed')}</span> : pricingBasisReady ? <span className="tag tag-green">{t('Source current')}</span> : null}
        {canCoordinate ? (
          <button type="button" className="secondary-button" disabled={submitting || !commercialScopeReady || !riskRegisterReady} title={commercialScopeReady && riskRegisterReady ? t('Assess the current approved scope and project risk register') : t('Approve a current commercial scope and project risk register first')} onClick={openPricingBasisEditor}>
            <ClipboardPenLine size={14} />
            {currentPricingBasis ? t('Reassess') : t('Assess basis')}
          </button>
        ) : null}
      </div>
      <div className="commercial-summary" aria-label={t('Accepted commercial value')}>
        <div>
          <span>{acceptedPricingModel === 'time_and_materials' ? t('Recorded contract value') : t('Accepted contract net')}</span>
          <strong>{currency.format(job.contractValue || 0)}</strong>
        </div>
        <div>
          <span>{acceptedPricingModel === 'time_and_materials' ? t('Accepted T&M budget') : t('Accepted quote')}</span>
          <strong>{acceptedQuote ? currency.format(acceptedQuote.subtotal || 0) : t('Not retained')}</strong>
        </div>
        <div>
          <span>{t('Accepted changes')}</span>
          <strong>{currency.format(acceptedChangeNet)}</strong>
        </div>
        <div>
          <span>{t('Pending decisions')}</span>
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
          <button type="button" className="secondary-button" disabled={submitting || !commercialScopeReady || !riskRegisterReady || !pricingBasisReady} title={commercialScopeReady && riskRegisterReady && pricingBasisReady ? t('Create a {model} estimate', { model: t(pricingModelLabel(currentPricingBasis.selectedModel)).toLowerCase() }) : t('Approve current scope and risk revisions and retain a current pricing-basis decision first')} onClick={onNewQuote}>
            <Plus size={15} />
            {t('New estimate')}
          </button>
          <button type="button" className="secondary-button" disabled={submitting} onClick={onNewChangeOrder}>
            <Plus size={15} />
            {t('Scope change')}
          </button>
        </div>
      ) : null}
      {editingCommercialScope ? (
        <div className="modal-backdrop commercial-scope-backdrop" role="presentation">
          <form className="modal commercial-scope-modal" role="dialog" aria-modal="true" aria-labelledby="commercial-scope-title" data-testid="commercial-scope-form" onSubmit={submitCommercialScope}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{t('Approval-gated contract schedule')}</p>
                <h2 id="commercial-scope-title">{t('Scope, assumptions, exclusions, and allowances')}</h2>
                <p>{job.title} / {t('source-bound revision {version}', { version: Number(currentScope?.versionNumber || 0) + 1 })}</p>
              </div>
              <button type="button" className="icon-button" aria-label={t('Close commercial scope')} onClick={() => setEditingCommercialScope(false)}><X size={17} /></button>
            </div>
            <div className="commercial-scope-body">
              <div className="commercial-scope-overview">
                <label>{t('Schedule title')}<input required minLength="3" maxLength="160" value={scopeDraft.title} onChange={(event) => setScopeDraft({ ...scopeDraft, title: event.target.value })} /></label>
                <label>{t('Clarification deadline')}<input type="date" value={scopeDraft.clarificationDeadline} onChange={(event) => setScopeDraft({ ...scopeDraft, clarificationDeadline: event.target.value })} /></label>
                <label className="scope-wide">{t('Scope summary')}<textarea required minLength="12" maxLength="4000" rows={4} value={scopeDraft.scopeSummary} onChange={(event) => setScopeDraft({ ...scopeDraft, scopeSummary: event.target.value })} placeholder={t('Describe the complete work boundary and intended outcome.')} /></label>
              </div>
              <div className="commercial-scope-lists">
                <label>{t('Included work')}<textarea required rows={6} value={scopeDraft.inclusions} onChange={(event) => setScopeDraft({ ...scopeDraft, inclusions: event.target.value })} placeholder={t('One explicit inclusion per line')} /></label>
                <label>{t('Assumptions')}<textarea required rows={6} value={scopeDraft.assumptions} onChange={(event) => setScopeDraft({ ...scopeDraft, assumptions: event.target.value })} placeholder={t('One estimating or delivery assumption per line')} /></label>
                <label>{t('Exclusions')}<textarea required rows={6} value={scopeDraft.exclusions} onChange={(event) => setScopeDraft({ ...scopeDraft, exclusions: event.target.value })} placeholder={t('One explicit exclusion per line')} /></label>
                <label>{t('Client responsibilities')}<textarea rows={6} value={scopeDraft.clientResponsibilities} onChange={(event) => setScopeDraft({ ...scopeDraft, clientResponsibilities: event.target.value })} placeholder={t('Access, selections, utilities, approvals, or enabling work')} /></label>
                <label>{t('Contractor responsibilities')}<textarea rows={6} value={scopeDraft.contractorResponsibilities} onChange={(event) => setScopeDraft({ ...scopeDraft, contractorResponsibilities: event.target.value })} placeholder={t('Protection, coordination, cleanup, evidence, or handover')} /></label>
              </div>
              <fieldset className="pricing-model-fieldset scope-allowance-mode">
                <legend>{t('Allowance treatment')}</legend>
                <div className="pricing-model-options">
                  <label className={scopeDraft.allowanceMode === 'none' ? 'selected' : ''}><input type="radio" name="scope-allowance-mode" value="none" checked={scopeDraft.allowanceMode === 'none'} onChange={() => setScopeDraft({ ...scopeDraft, allowanceMode: 'none', allowances: [] })} /><span>{t('No allowances')}</span></label>
                  <label className={scopeDraft.allowanceMode === 'defined' ? 'selected' : ''}><input type="radio" name="scope-allowance-mode" value="defined" checked={scopeDraft.allowanceMode === 'defined'} onChange={() => setScopeDraft({ ...scopeDraft, allowanceMode: 'defined', allowances: scopeDraft.allowances.length ? scopeDraft.allowances : [emptyScopeAllowance()] })} /><span>{t('Defined allowances')}</span></label>
                </div>
              </fieldset>
              {scopeDraft.allowanceMode === 'none' ? (
                <label className="scope-no-allowance">{t('No-allowance statement')}<textarea required minLength="8" maxLength="500" rows={3} value={scopeDraft.noAllowanceReason} onChange={(event) => setScopeDraft({ ...scopeDraft, noAllowanceReason: event.target.value })} /></label>
              ) : (
                <section className="scope-allowance-section" aria-labelledby="scope-allowance-title">
                  <div className="commercial-line-heading">
                    <div><h3 id="scope-allowance-title">{t('Allowances and provisional sums')}</h3><p>{t('Each amount is server-recalculated from quantity and unit rate.')}</p></div>
                    <button type="button" className="secondary-button" onClick={() => setScopeDraft((current) => ({ ...current, allowances: [...current.allowances, emptyScopeAllowance(current.allowances.length)] }))}><Plus size={14} />{t('Add allowance')}</button>
                  </div>
                  <div className="scope-allowance-list">
                    {scopeDraft.allowances.map((allowance, index) => (
                      <fieldset className="scope-allowance-row" key={`${allowance.allowanceKey}-${index}`}>
                        <legend>{t('Allowance {number}', { number: index + 1 })}</legend>
                        <label>{t('Key')}<input required maxLength="40" value={allowance.allowanceKey} onChange={(event) => updateScopeAllowance(index, { allowanceKey: event.target.value.toUpperCase() })} /></label>
                        <label>{t('Type')}<select value={allowance.allowanceType} onChange={(event) => updateScopeAllowance(index, { allowanceType: event.target.value })}><option value="selection_allowance">{t('Selection allowance')}</option><option value="provisional_sum">{t('Provisional sum')}</option><option value="unit_rate">{t('Unit rate')}</option></select></label>
                        <label className="scope-allowance-title-field">{t('Title')}<input required minLength="3" maxLength="160" value={allowance.title} onChange={(event) => updateScopeAllowance(index, { title: event.target.value })} /></label>
                        <label className="scope-allowance-description">{t('Description')}<textarea required minLength="3" maxLength="500" rows={2} value={allowance.description} onChange={(event) => updateScopeAllowance(index, { description: event.target.value })} /></label>
                        <label>{t('Quantity')}<input required type="number" min="0.0001" max="1000000" step="0.0001" value={allowance.quantity} onChange={(event) => updateScopeAllowance(index, { quantity: event.target.value })} /></label>
                        <label>{t('Unit')}<input required maxLength="40" value={allowance.unit} onChange={(event) => updateScopeAllowance(index, { unit: event.target.value })} /></label>
                        <label>{t('Unit rate')}<input required type="number" min="0" max="1000000000" step="0.01" value={allowance.unitRate} onChange={(event) => updateScopeAllowance(index, { unitRate: event.target.value })} /></label>
                        <label>{t('Reconciliation')}<select value={allowance.reconciliationMethod} onChange={(event) => updateScopeAllowance(index, { reconciliationMethod: event.target.value })}><option value="actual_cost_variation">{t('Actual cost variation')}</option><option value="fixed_included">{t('Fixed included amount')}</option><option value="remeasured_unit_rate">{t('Remeasured unit rate')}</option></select></label>
                        <label>{t('Selection by')}<select value={allowance.selectionBy} onChange={(event) => updateScopeAllowance(index, { selectionBy: event.target.value })}><option value="client">{t('Client')}</option><option value="contractor">{t('Contractor')}</option><option value="joint">{t('Joint')}</option></select></label>
                        <label>{t('Selection due')}<input type="date" value={allowance.dueAt} onChange={(event) => updateScopeAllowance(index, { dueAt: event.target.value })} /></label>
                        <label className="scope-allowance-description">{t('Evidence reference')}<input maxLength="500" value={allowance.evidenceReference} onChange={(event) => updateScopeAllowance(index, { evidenceReference: event.target.value })} placeholder={t('Drawing, survey, supplier quotation, or selection reference')} /></label>
                        <div className="scope-allowance-calculated"><span>{t('Calculated amount')}</span><strong>{rateMoney((Number(allowance.quantity) || 0) * (Number(allowance.unitRate) || 0))}</strong></div>
                        <button type="button" className="icon-button scope-allowance-remove" aria-label={t('Remove allowance {number}', { number: index + 1 })} onClick={() => setScopeDraft((current) => ({ ...current, allowances: current.allowances.filter((_, allowanceIndex) => allowanceIndex !== index) }))}><X size={15} /></button>
                      </fieldset>
                    ))}
                  </div>
                  <div className="scope-allowance-total"><span>{t('Total retained allowance')}</span><strong>{rateMoney(scopeAllowanceTotal)}</strong></div>
                </section>
              )}
              <label className="pricing-basis-textarea">{t('Revision reason')}<textarea required minLength="8" maxLength="500" value={scopeDraft.reason} onChange={(event) => setScopeDraft({ ...scopeDraft, reason: event.target.value })} placeholder={t('Explain why this scope revision is being requested.')} /></label>
              <p className="workflow-note">{t('Approval activates this revision as the exact source for pricing and quotes. It does not send terms, accept client instructions, authorize changed work, commit spend or dates, invoice, or move funds.')}</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditingCommercialScope(false)}>{t('Cancel')}</button>
              <button className="primary-button" disabled={submitting || !scopeDraftReady}><ShieldCheck size={15} />{submitting ? t('Requesting...') : t('Request approval')}</button>
            </div>
          </form>
        </div>
      ) : null}
      {editingRiskRegister ? (
        <div className="modal-backdrop project-risk-backdrop" role="presentation">
          <form className="modal project-risk-modal" role="dialog" aria-modal="true" aria-labelledby="project-risk-title" data-testid="project-risk-register-form" onSubmit={submitRiskRegister}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{t('Approval-gated project review')}</p>
                <h2 id="project-risk-title">{t('Project risk register and premortem')}</h2>
                <p>{job.title} / {t('source-bound revision {version}', { version: Number(currentRiskRegister?.versionNumber || 0) + 1 })}</p>
              </div>
              <button type="button" className="icon-button" aria-label={t('Close project risk register')} onClick={() => setEditingRiskRegister(false)}><X size={17} /></button>
            </div>
            <div className="project-risk-modal-body">
              <div className="project-risk-summary" aria-label={t('Draft project risk summary')}>
                <div><span>{t('Risks')}</span><strong>{riskDraft.risks.length}</strong></div>
                <div><span>{t('High residual')}</span><strong>{riskDraft.risks.filter((risk) => projectRiskScore(risk, true) >= 15).length}</strong></div>
                <div><span>{t('Expected exposure')}</span><strong>{rateMoney(riskDraft.risks.reduce((sum, risk) => sum + ((Number(risk.costExposureAmount) || 0) * ({ 1: 0.1, 2: 0.3, 3: 0.5, 4: 0.7, 5: 0.9 }[Number(risk.residualProbability)] || 0)), 0))}</strong></div>
                <div><span>{t('Schedule exposure')}</span><strong>{t('{days} days', { days: Math.max(0, ...riskDraft.risks.map((risk) => Number(risk.scheduleExposureDays) || 0)) })}</strong></div>
              </div>
              <section className="premortem-workshop" aria-labelledby="premortem-workshop-title">
                <div className="commercial-line-heading">
                  <div><h3 id="premortem-workshop-title">{t('Premortem workshop')}</h3><p>{t('Assume the project failed, then link each failure mode to a controlled risk.')}</p></div>
                </div>
                <div className="premortem-fields">
                  <label>{t('Register title')}<input required minLength="3" maxLength="160" value={riskDraft.title} onChange={(event) => setRiskDraft({ ...riskDraft, title: event.target.value })} /></label>
                  <label>{t('Workshop date')}<input required type="date" value={riskDraft.workshopDate} onChange={(event) => setRiskDraft({ ...riskDraft, workshopDate: event.target.value })} /></label>
                  <label>{t('Facilitator')}<input required minLength="2" maxLength="160" value={riskDraft.facilitator} onChange={(event) => setRiskDraft({ ...riskDraft, facilitator: event.target.value })} /></label>
                  <label className="project-risk-wide">{t('Failure statement')}<textarea required minLength="12" maxLength="2000" rows={3} value={riskDraft.failureStatement} onChange={(event) => setRiskDraft({ ...riskDraft, failureStatement: event.target.value })} placeholder={t('The project failed because...')} /></label>
                  <label className="project-risk-wide">{t('Participants')}<textarea required rows={3} value={riskDraft.participants} onChange={(event) => setRiskDraft({ ...riskDraft, participants: event.target.value })} placeholder={t('One participant per line')} /></label>
                </div>
              </section>
              <section className="project-risk-editor" aria-labelledby="project-risk-editor-title">
                <div className="commercial-line-heading">
                  <div><h3 id="project-risk-editor-title">{t('Risk treatments and failure modes')}</h3><p>{t('Probability and impact use a 1 to 5 scale. Scores and monetary exposure are recalculated by the server.')}</p></div>
                  <button type="button" className="secondary-button" onClick={() => setRiskDraft((current) => ({ ...current, risks: [...current.risks, emptyProjectRisk(current.risks.length)] }))}><Plus size={14} />{t('Add risk')}</button>
                </div>
                <div className="project-risk-list">
                  {riskDraft.risks.map((risk, index) => {
                    const inherentScore = projectRiskScore(risk)
                    const residualScore = projectRiskScore(risk, true)
                    return (
                      <fieldset className="project-risk-row" key={`${risk.riskKey}-${index}`} data-testid={`project-risk-row-${index}`}>
                        <legend>{t('Risk {number}', { number: index + 1 })}</legend>
                        <div className="project-risk-score" aria-label={t('Risk {number} scores', { number: index + 1 })}>
                          <span className={`risk-band risk-band-${projectRiskBand(inherentScore)}`}>{t('Inherent {score}', { score: inherentScore })}</span>
                          <ChevronRight size={15} />
                          <span className={`risk-band risk-band-${projectRiskBand(residualScore)}`}>{t('Residual {score}', { score: residualScore })}</span>
                        </div>
                        <label>{t('Key')}<input required maxLength="40" value={risk.riskKey} onChange={(event) => updateProjectRisk(index, { riskKey: event.target.value.toUpperCase() })} /></label>
                        <label>{t('Category')}<select value={risk.category} onChange={(event) => updateProjectRisk(index, { category: event.target.value })}><option value="commercial">{t('Commercial')}</option><option value="contract">{t('Contract')}</option><option value="design">{t('Design')}</option><option value="site_condition">{t('Site condition')}</option><option value="schedule">{t('Schedule')}</option><option value="resource">{t('Resource')}</option><option value="supply_chain">{t('Supply chain')}</option><option value="financial">{t('Financial')}</option><option value="safety">{t('Safety')}</option><option value="quality">{t('Quality')}</option><option value="environment">{t('Environment')}</option><option value="regulatory">{t('Regulatory')}</option><option value="client">{t('Client')}</option><option value="third_party">{t('Third party')}</option><option value="other">{t('Other')}</option></select></label>
                        <label className="project-risk-title-field">{t('Title')}<input required minLength="3" maxLength="160" value={risk.title} onChange={(event) => updateProjectRisk(index, { title: event.target.value })} /></label>
                        <label>{t('Owner')}<input required minLength="2" maxLength="160" value={risk.owner} onChange={(event) => updateProjectRisk(index, { owner: event.target.value })} /></label>
                        <label>{t('Probability')}<select value={risk.probability} onChange={(event) => updateProjectRisk(index, { probability: event.target.value })}>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
                        <label>{t('Impact')}<select value={risk.impact} onChange={(event) => updateProjectRisk(index, { impact: event.target.value })}>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
                        <label className="project-risk-wide">{t('Cause')}<textarea required minLength="8" maxLength="1000" rows={2} value={risk.cause} onChange={(event) => updateProjectRisk(index, { cause: event.target.value })} /></label>
                        <label className="project-risk-wide">{t('Risk event')}<textarea required minLength="8" maxLength="1000" rows={2} value={risk.event} onChange={(event) => updateProjectRisk(index, { event: event.target.value })} /></label>
                        <label className="project-risk-wide">{t('Consequence')}<textarea required minLength="8" maxLength="1000" rows={2} value={risk.consequence} onChange={(event) => updateProjectRisk(index, { consequence: event.target.value })} /></label>
                        <label>{t('Response')}<select value={risk.responseStrategy} onChange={(event) => updateProjectRisk(index, { responseStrategy: event.target.value })}><option value="avoid">{t('Avoid')}</option><option value="mitigate">{t('Mitigate')}</option><option value="transfer">{t('Transfer')}</option><option value="accept">{t('Accept')}</option></select></label>
                        <label>{t('Status')}<select value={risk.status} onChange={(event) => updateProjectRisk(index, { status: event.target.value })}><option value="open">{t('Open')}</option><option value="monitoring">{t('Monitoring')}</option><option value="treatment_due">{t('Treatment due')}</option><option value="accepted">{t('Accepted')}</option><option value="closed">{t('Closed')}</option></select></label>
                        <label>{t('Treatment due')}<input type="date" value={risk.dueAt} onChange={(event) => updateProjectRisk(index, { dueAt: event.target.value })} /></label>
                        <label className="project-risk-wide">{t('Mitigation action')}<textarea required minLength="8" maxLength="2000" rows={2} value={risk.mitigationAction} onChange={(event) => updateProjectRisk(index, { mitigationAction: event.target.value })} /></label>
                        <label className="project-risk-wide">{t('Contingency action')}<textarea required minLength="8" maxLength="2000" rows={2} value={risk.contingencyAction} onChange={(event) => updateProjectRisk(index, { contingencyAction: event.target.value })} /></label>
                        <label className="project-risk-wide">{t('Trigger or early warning')}<textarea required minLength="8" maxLength="1000" rows={2} value={risk.trigger} onChange={(event) => updateProjectRisk(index, { trigger: event.target.value })} /></label>
                        <label>{t('Residual probability')}<select value={risk.residualProbability} onChange={(event) => updateProjectRisk(index, { residualProbability: event.target.value })}>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
                        <label>{t('Residual impact')}<select value={risk.residualImpact} onChange={(event) => updateProjectRisk(index, { residualImpact: event.target.value })}>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
                        <label>{t('Cost exposure')}<input type="number" min="0" max="1000000000" step="0.01" value={risk.costExposureAmount} onChange={(event) => updateProjectRisk(index, { costExposureAmount: event.target.value })} /></label>
                        <label>{t('Schedule days')}<input type="number" min="0" max="10000" step="0.25" value={risk.scheduleExposureDays} onChange={(event) => updateProjectRisk(index, { scheduleExposureDays: event.target.value })} /></label>
                        {residualScore >= 15 || risk.responseStrategy === 'accept' || risk.status === 'accepted' ? <label className="project-risk-wide risk-acceptance">{t('Acceptance or escalation reason')}<textarea required minLength="8" maxLength="1000" rows={2} value={risk.acceptanceReason} onChange={(event) => updateProjectRisk(index, { acceptanceReason: event.target.value })} /></label> : null}
                        <label className="project-risk-wide">{t('Evidence reference')}<input maxLength="500" value={risk.evidenceReference} onChange={(event) => updateProjectRisk(index, { evidenceReference: event.target.value })} /></label>
                        <div className="premortem-link-heading"><TriangleAlert size={15} /><strong>{t('Linked premortem failure mode')}</strong></div>
                        <label className="project-risk-wide">{t('Failure mode')}<textarea required minLength="8" maxLength="1000" rows={2} value={risk.failureMode} onChange={(event) => updateProjectRisk(index, { failureMode: event.target.value })} /></label>
                        <label className="project-risk-wide">{t('Early warning')}<textarea required minLength="8" maxLength="1000" rows={2} value={risk.earlyWarning} onChange={(event) => updateProjectRisk(index, { earlyWarning: event.target.value })} /></label>
                        <label className="project-risk-wide">{t('Prevention')}<textarea required minLength="8" maxLength="2000" rows={2} value={risk.prevention} onChange={(event) => updateProjectRisk(index, { prevention: event.target.value })} /></label>
                        <button type="button" className="icon-button project-risk-remove" aria-label={t('Remove risk {number}', { number: index + 1 })} disabled={riskDraft.risks.length === 1} onClick={() => setRiskDraft((current) => ({ ...current, risks: current.risks.filter((_, riskIndex) => riskIndex !== index) }))}><X size={15} /></button>
                      </fieldset>
                    )
                  })}
                </div>
              </section>
              {riskRegister.revisions?.length ? (
                <details className="project-risk-history"><summary>{t('Revision history ({count})', { count: riskRegister.revisions.length })}</summary><div>{riskRegister.revisions.map((revision) => <span key={revision.id}>v{revision.versionNumber} / {t(formatStatus(revision.status))} / {t('{count} risks', { count: revision.riskCount })} / {formatDateTime(revision.updatedAt)}</span>)}</div></details>
              ) : null}
              <label className="pricing-basis-textarea">{t('Revision reason')}<textarea required minLength="8" maxLength="500" value={riskDraft.reason} onChange={(event) => setRiskDraft({ ...riskDraft, reason: event.target.value })} placeholder={t('Explain why this project risk review is being requested.')} /></label>
              <p className="workflow-note">{t('Approval makes this the exact risk source for pricing and quotes. Automation may flag the missing review, but it cannot author risks, accept liability, promise dates, commit spend, issue a quote, send a message, invoice, or move funds.')}</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditingRiskRegister(false)}>{t('Cancel')}</button>
              <button className="primary-button" disabled={submitting || !riskDraftReady}><ShieldCheck size={15} />{submitting ? t('Requesting...') : t('Request approval')}</button>
            </div>
          </form>
        </div>
      ) : null}
      {editingPricingBasis ? (
        <div className="modal-backdrop pricing-basis-backdrop" role="presentation">
          <form className="modal pricing-basis-modal" role="dialog" aria-modal="true" aria-labelledby="pricing-basis-title" data-testid="pricing-basis-form" onSubmit={submitPricingBasis}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{t('Source-bound commercial decision')}</p>
                <h2 id="pricing-basis-title">{t('Fixed price or time and materials')}</h2>
                <p>{job.title} / {t('decision history remains retained')}</p>
              </div>
              <button type="button" className="icon-button" aria-label={t('Close pricing-basis assessment')} onClick={() => setEditingPricingBasis(false)}><X size={17} /></button>
            </div>
            <div className="pricing-basis-modal-body">
              <div className="pricing-basis-preview" aria-label={t('Pricing-basis recommendation')}>
                <div><span>{t('Recommendation')}</span><strong>{t(pricingModelLabel(pricingPreview.recommendation))}</strong></div>
                <div><span>{t('Fixed-price readiness')}</span><strong>{pricingPreview.score}%</strong></div>
                <div><span>{t('Critical blockers')}</span><strong>{pricingPreview.blockers.length}</strong></div>
                <div><span>{t('Evidence gaps')}</span><strong>{pricingPreview.evidenceGaps.length}</strong></div>
              </div>
              <div className="pricing-factor-list">
                {pricingDraft.factors.map((factor, index) => (
                  <div className="pricing-factor-row" key={factor.key} data-testid={`pricing-factor-${factor.key}`}>
                    <div><strong>{t(factor.label)}</strong><small>{t('{weight}% weight{critical}', { weight: factor.weight, critical: factor.critical ? ` / ${t('critical')}` : '' })}</small></div>
                    <label>
                      {t('Assessment')}
                      <select value={factor.status} onChange={(event) => updatePricingFactor(index, { status: event.target.value })}>
                        <option value="yes">{t('Yes')}</option>
                        <option value="no">{t('No')}</option>
                        <option value="unknown">{t('Unknown')}</option>
                      </select>
                    </label>
                    <label>
                      {t('Retained evidence')}
                      <input required minLength="8" maxLength="500" value={factor.evidence} onChange={(event) => updatePricingFactor(index, { evidence: event.target.value })} placeholder={t('Reference the scope, survey, drawing, takeoff, selection, schedule, or supplier evidence.')} />
                    </label>
                  </div>
                ))}
              </div>
              <fieldset className="pricing-model-fieldset">
                <legend>{t('Selected commercial model')}</legend>
                <div className="pricing-model-options">
                  <label className={pricingDraft.selectedModel === 'fixed_price' ? 'selected' : ''}><input type="radio" name="pricing-model" value="fixed_price" checked={pricingDraft.selectedModel === 'fixed_price'} onChange={(event) => setPricingDraft({ ...pricingDraft, selectedModel: event.target.value })} /><span>{t('Fixed price')}</span></label>
                  <label className={pricingDraft.selectedModel === 'time_and_materials' ? 'selected' : ''}><input type="radio" name="pricing-model" value="time_and_materials" checked={pricingDraft.selectedModel === 'time_and_materials'} onChange={(event) => setPricingDraft({ ...pricingDraft, selectedModel: event.target.value })} /><span>{t('Time and materials')}</span></label>
                </div>
              </fieldset>
              <label className="pricing-basis-textarea">{t('Decision rationale')}<textarea required minLength="8" maxLength="1000" value={pricingDraft.rationale} onChange={(event) => setPricingDraft({ ...pricingDraft, rationale: event.target.value })} placeholder={t('State why this model fits the retained risk and estimate basis.')} /></label>
              {pricingOverride ? (
                <label className="pricing-basis-textarea pricing-override-reason">{t('Override reason')}<textarea required minLength="12" maxLength="500" value={pricingDraft.overrideReason} onChange={(event) => setPricingDraft({ ...pricingDraft, overrideReason: event.target.value })} placeholder={t('Explain the commercial control that justifies departing from the recommendation or proceeding with evidence gaps.')} /></label>
              ) : null}
              <p className="workflow-note">{t('This retains an internal commercial decision. Quote issue, client acceptance, schedule commitments, supplier spend, invoices, and payments remain separately gated.')}</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditingPricingBasis(false)}>{t('Cancel')}</button>
              <button className="primary-button" disabled={submitting || !pricingDraftReady}><ShieldCheck size={15} />{submitting ? t('Retaining...') : t('Retain pricing basis')}</button>
            </div>
          </form>
        </div>
      ) : null}
      <div className="commercial-ledger">
        <section aria-labelledby="quote-ledger-title">
          <div className="commercial-list-heading">
            <h4 id="quote-ledger-title">{t('Estimates and quotes')}</h4>
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
                const canPrepare = ['approved', 'accepted'].includes(quote.status)
                  && canCoordinate
                  && !issuePackage
                  && quote.commercialScopeIntegrityValid === true
                  && quote.commercialScopeCurrent === true
                  && quote.riskRegisterIntegrityValid === true
                  && quote.riskRegisterCurrent === true
                  && quote.pricingBasisIntegrityValid !== false
                  && quote.pricingBasisCurrent !== false
                return (
                  <div className="activity-row commercial-row" key={quote.id} data-testid={`commercial-quote-${quote.id}`}>
                    <div className="commercial-record">
                      <div>
                        <strong>{currency.format(quote.subtotal || 0)} {quote.pricingModel === 'time_and_materials' ? t('budget net') : t('net')}</strong>
                        <span className={`status status-${quote.status}`}>{t(formatStatus(quote.status))}</span>
                        {quote.pricingModel ? <span className="tag">{t(pricingModelLabel(quote.pricingModel))}</span> : null}
                        {quote.commercialScope ? <span className="tag">{t('Scope v{version}', { version: quote.commercialScope.versionNumber })}</span> : null}
                        {quote.commercialScopeIntegrityValid === false ? <span className="tag tag-red">{t('Scope integrity failed')}</span> : null}
                        {issueApproval && quote.commercialScopeCurrent === false ? <span className="tag tag-amber">{t('Scope revision required')}</span> : null}
                        {quote.riskRegister ? <span className="tag">{t('Risk v{version}', { version: quote.riskRegister.versionNumber })}</span> : null}
                        {quote.riskRegisterIntegrityValid === false ? <span className="tag tag-red">{t('Risk integrity failed')}</span> : null}
                        {issueApproval && quote.riskRegisterCurrent === false ? <span className="tag tag-amber">{t('Risk review required')}</span> : null}
                        {quote.pricingBasisIntegrityValid === false ? <span className="tag tag-red">{t('Basis integrity failed')}</span> : null}
                        {issueApproval && quote.pricingBasisCurrent === false ? <span className="tag tag-amber">{t('Reassessment required')}</span> : null}
                      </div>
                      <small>
                        {t('{count} line item(s) / VAT {vat}% / gross {gross}', { count: quote.lineItems?.length || 0, vat: quote.taxRate || 0, gross: currency.format(quote.total || 0) })}
                      </small>
                      <small>
                        {t('Valid until {date}', { date: formatDate(quote.validUntil) })}
                        {issuePackage ? ` · ${t('package {reference}', { reference: issuePackage.data?.issueReference || t('retained') })}` : ''}
                        {quote.data?.acceptance?.evidenceReference ? ` · ${t('evidence {reference}', { reference: quote.data.acceptance.evidenceReference })}` : ''}
                      </small>
                    </div>
                    <div className="commercial-row-actions">
                      {issueApproval && canApprove ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={submitting || quote.commercialScopeIntegrityValid !== true || quote.commercialScopeCurrent !== true || quote.pricingBasisIntegrityValid === false || quote.pricingBasisCurrent === false}
                          title={quote.commercialScopeCurrent === false ? t('Approve a current commercial scope revision before approving this quote') : quote.pricingBasisCurrent === false ? t('Reassess the pricing basis before approving this quote') : t('Review quote approval')}
                          onClick={() => onOpenApprovals({ approvalId: issueApproval.id })}
                        >
                          <ShieldCheck size={15} />
                          {t('Review quote')}
                        </button>
                      ) : null}
                      {canPrepare ? (
                        <button
                          type="button"
                          className="secondary-button"
                          data-testid={`prepare-quote-package-${quote.id}`}
                          disabled={submitting}
                          title={t('Prepare an immutable quote package and approval-gated delivery draft')}
                          onClick={() => onRequestAcceptance('issue_package', quote)}
                        >
                          <FileDown size={15} />
                          {t('Prepare issue package')}
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
                          {t('Download package')}
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
                          {t('Review delivery')}
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
                          {t('Verify acceptance')}
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
                          {t('Record acceptance')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="workflow-note">{t('No retained estimate exists for this job.')}</p>
          )}
        </section>
        <section aria-labelledby="change-ledger-title">
          <div className="commercial-list-heading">
            <h4 id="change-ledger-title">{t('Scope changes')}</h4>
            <span>{changeOrders.length}</span>
          </div>
          {changeOrders.length ? (
            <div className="activity-list commercial-list">
              {changeOrders.map((changeOrder) => {
                const approval = pendingFor('change_order', changeOrder.id)
                const acceptanceApproval = pendingFor('change_order_acceptance', changeOrder.id)
                const clientResponseApproval = pendingApprovals.find(
                  (item) => item.targetType === 'change_order_client_response' && item.data?.changeOrderId === changeOrder.id,
                )
                const issuePackage = job.documents?.find(
                  (document) =>
                    document.type === 'change_order_issue_package' && document.data?.sourceRecordId === changeOrder.id,
                )
                const deliveryDraft = issuePackage
                  ? job.communications?.find(
                      (communication) =>
                        communication.data?.source === 'change_order_issue_package' &&
                        communication.data?.sourceRecordId === changeOrder.id,
                    )
                  : null
                const deliveryApproval = deliveryDraft ? pendingFor('communication', deliveryDraft.id) : null
                const canPrepare = changeOrder.status === 'approved' && canCoordinate && !issuePackage && changeOrder.integrityValid && changeOrder.sourceCurrent
                const canRecordDelivery =
                  changeOrder.status === 'approved' && deliveryDraft?.status === 'approved' && canCoordinate
                const canRevise = ['changes_requested', 'rejected_by_client', 'rejected', 'cancelled'].includes(changeOrder.status) && canCoordinate
                return (
                  <div className="activity-row commercial-row" key={changeOrder.id} data-testid={`commercial-change-${changeOrder.id}`}>
                    <div className="commercial-record">
                      <div>
                        <strong>{changeOrder.variationNumber ? `${changeOrder.variationNumber} / R${changeOrder.revisionNumber} - ` : ''}{changeOrder.title}</strong>
                        <span className={`status status-${changeOrder.status}`}>{t(formatStatus(changeOrder.status))}</span>
                      </div>
                      <small>
                        {t('{amount} net / {days} day schedule impact', { amount: currency.format(changeOrder.amount || 0), days: changeOrder.scheduleDeltaDays || 0 })} ·{' '}
                        {commercialCurrency}
                      </small>
                      <small>
                        {changeOrder.scopeDelta || t('Scope evidence not retained')}
                        {issuePackage ? ` · ${t('package {reference}', { reference: issuePackage.data?.issueReference || t('retained') })}` : ''}
                        {changeOrder.data?.issuePackage?.transportStatus
                          ? ` · ${t(formatStatus(changeOrder.data.issuePackage.transportStatus))}`
                          : ''}
                        {changeOrder.data?.acceptance?.evidenceReference
                          ? ` · ${t('evidence {reference}', { reference: changeOrder.data.acceptance.evidenceReference })}`
                          : ''}
                      </small>
                      <small>
                        {t(formatStatus(changeOrder.formalControl?.variationType || 'legacy record'))} · {t('initiated by {initiator}', { initiator: t(formatStatus(changeOrder.formalControl?.initiatedBy || 'not retained')) })} · {t('risk {risk}', { risk: t(formatStatus(changeOrder.formalControl?.riskImpact || 'not retained')) })} · {changeOrder.integrityValid ? t('snapshot verified') : t('snapshot invalid')} · {changeOrder.sourceCurrent ? t('contract source current') : t('contract source stale')} · {changeOrder.workAuthorized ? t('work authorized') : t('work not authorized')}
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
                          {t('Review change')}
                        </button>
                      ) : null}
                      {canPrepare ? (
                        <button
                          type="button"
                          className="secondary-button"
                          data-testid={`prepare-change-package-${changeOrder.id}`}
                          disabled={submitting}
                          title={t('Prepare an immutable change-order package and approval-gated delivery draft')}
                          onClick={() => onRequestAcceptance('change_issue_package', changeOrder)}
                        >
                          <FileDown size={15} />
                          {t('Prepare issue package')}
                        </button>
                      ) : null}
                      {issuePackage ? (
                        <a
                          className="secondary-button"
                          data-testid={`download-change-package-${changeOrder.id}`}
                          href={`/api/ledger/documents/${encodeURIComponent(issuePackage.id)}/issue-package`}
                          download
                        >
                          <FileDown size={15} />
                          {t('Download package')}
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
                          {t('Review delivery')}
                        </button>
                      ) : null}
                      {canRecordDelivery ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={submitting}
                          onClick={() => onRecordChangeDelivery(changeOrder, deliveryDraft)}
                        >
                          <MailCheck size={15} />
                          {t('Record delivery receipt')}
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
                          {t('Verify acceptance')}
                        </button>
                      ) : null}
                      {clientResponseApproval && canApprove ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={submitting}
                          onClick={() => onOpenApprovals({ approvalId: clientResponseApproval.id })}
                        >
                          <ShieldCheck size={15} />
                          {t('Review client response')}
                        </button>
                      ) : null}
                      {changeOrder.status === 'issued' && canCoordinate && !acceptanceApproval && !clientResponseApproval ? (
                        <button
                          type="button"
                          className="primary-button"
                          disabled={submitting}
                          onClick={() => onRequestAcceptance('change_order', changeOrder)}
                        >
                          <Check size={15} />
                          {t('Record acceptance')}
                        </button>
                      ) : null}
                      {canRevise ? (
                        <button
                          type="button"
                          className="primary-button"
                          disabled={submitting}
                          onClick={() => onNewChangeOrder(changeOrder)}
                        >
                          <FileDown size={15} />
                          {t('Prepare revision')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="workflow-note">{t('No retained scope change exists for this job.')}</p>
          )}
        </section>
      </div>
    </section>
  )
}

function ClientDirectoryWorkspace({ directory, locale, canCoordinate, submitting, onCreate, onEdit, onOpen }) {
  const t = (key, variables = {}) => operatorText(locale, key, variables)
  const [query, setQuery] = useState('')
  const clients = directory?.clients || EMPTY_LIST
  const summary = directory?.summary || {}
  const normalizedQuery = query.trim().toLowerCase()
  const rows = normalizedQuery
    ? clients.filter((client) => [
        client.name,
        client.company,
        client.email,
        client.phone,
        client.address,
        client.city,
        client.data?.billingEmail,
        client.data?.registrationNumber,
      ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery)))
    : clients

  return (
    <section className="panel page-panel client-directory" data-testid="client-directory">
      <div className="panel-heading client-directory-heading">
        <div>
          <h2>{t('Client directory')}</h2>
          <p>{t('Maintain one retained identity for project communication, commercial packages, invoicing, and aftercare.')}</p>
        </div>
        {canCoordinate ? (
          <button type="button" className="primary-button" disabled={submitting} onClick={onCreate}>
            <Plus size={16} />
            {t('New client')}
          </button>
        ) : <span className="count-badge">{clients.length}</span>}
      </div>
      <div className="client-directory-summary" aria-label={t('Client directory summary')}>
        <div><span>{t('Clients')}</span><strong>{summary.total || 0}</strong></div>
        <div><span>{t('Contact ready')}</span><strong>{summary.contactReady || 0}</strong></div>
        <div><span>{t('Invoice ready')}</span><strong>{summary.invoiceReady || 0}</strong></div>
        <div><span>{t('Peppol profile')}</span><strong>{summary.structuredInvoiceReady || 0}</strong></div>
        <div><span>{t('Active jobs')}</span><strong>{summary.activeJobs || 0}</strong></div>
        <div><span>{t('Receivable')}</span><strong>{currency.format(summary.outstandingReceivable || 0)}</strong></div>
      </div>
      <div className="client-directory-filter">
        <Search size={16} aria-hidden="true" />
        <label htmlFor="client-directory-search">{t('Search clients')}</label>
        <input
          id="client-directory-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('Name, company, email, city, or registration')}
        />
        <span>{t('{count} shown', { count: rows.length })}</span>
      </div>
      <div className="client-directory-list">
        {rows.map((client) => {
          const missing = client.readiness?.missing?.structuredInvoice || EMPTY_LIST
          const latestJob = client.latestJobs?.[0]
          return (
            <article className="client-directory-row" key={client.id} data-testid={`client-directory-${client.id}`}>
              <div className="client-directory-identity">
                <div className="client-directory-title">
                  <span className="client-directory-icon"><Building2 size={17} /></span>
                  <div>
                    <h3>{client.company || client.name}</h3>
                    <p>{client.company ? client.name : t(formatStatus(client.data?.clientType || 'consumer'))}</p>
                  </div>
                </div>
                <div className="client-directory-contact">
                  <span>{client.email || client.data?.billingEmail || t('No email retained')}</span>
                  <span>{client.phone || t('No phone retained')}</span>
                  <span>{[client.address, client.data?.postalCode, client.city, client.country].filter(Boolean).join(', ') || t('No address retained')}</span>
                </div>
                <div className="client-flags">
                  <span className={client.readiness?.contactReady ? 'tag tag-green' : 'tag tag-amber'}>{t(client.readiness?.contactReady ? 'Contact ready' : 'Contact incomplete')}</span>
                  <span className={client.readiness?.invoiceReady ? 'tag tag-green' : 'tag tag-amber'}>{t(client.readiness?.invoiceReady ? 'Invoice ready' : 'Invoice incomplete')}</span>
                  <span className={client.readiness?.structuredInvoiceReady ? 'tag tag-green' : 'tag tag-amber'}>{t(client.readiness?.structuredInvoiceReady ? 'Peppol ready' : 'Peppol incomplete')}</span>
                </div>
                {!client.readiness?.structuredInvoiceReady && missing.length ? (
                  <small className="client-directory-missing">{t('Missing: {items}{extra}', { items: missing.slice(0, 3).map((item) => t(item.label)).join(', '), extra: missing.length > 3 ? ` +${missing.length - 3}` : '' })}</small>
                ) : null}
              </div>
              <div className="client-directory-metrics" aria-label={t('Operating context for {name}', { name: client.company || client.name })}>
                <div><span>{t('Active jobs')}</span><strong>{client.metrics?.activeJobs || 0}</strong></div>
                <div><span>{t('Pipeline')}</span><strong>{client.metrics?.openOpportunities || 0}</strong></div>
                <div><span>{t('Contract value')}</span><strong>{currency.format(client.metrics?.acceptedContractValue || 0)}</strong></div>
                <div><span>{t('Receivable')}</span><strong>{currency.format(client.metrics?.outstandingReceivable || 0)}</strong></div>
              </div>
              <div className="client-directory-actions">
                {latestJob ? (
                  <button type="button" className="secondary-button" onClick={() => onOpen(latestJob)}>
                    <ArrowUpRight size={15} />
                    {t('Open latest job')}
                  </button>
                ) : null}
                {canCoordinate ? (
                  <button type="button" className="secondary-button" disabled={submitting} onClick={() => onEdit(client)}>
                    <Pencil size={15} />
                    {t('Edit client')}
                  </button>
                ) : null}
              </div>
            </article>
          )
        })}
        {!rows.length ? (
          <Empty
            title={t(clients.length ? 'No matching clients' : 'No retained clients')}
            detail={t(clients.length ? 'Change the directory search to review another retained client.' : 'Create a client identity before preparing commercial or invoicing records.')}
          />
        ) : null}
      </div>
    </section>
  )
}

function ClientsWorkspace({ directory, onCreateClient, onEditClient, locale, ...props }) {
  const t = (key, variables = {}) => operatorText(locale, key, variables)
  const [view, setView] = useState('work')
  const workCount = props.clients?.jobs?.length || 0
  const directoryCount = directory?.clients?.length || 0
  return (
    <>
      <div className="client-view-switch" role="tablist" aria-label={t('Client workspace view')}>
        <button type="button" role="tab" aria-selected={view === 'work'} className={view === 'work' ? 'active' : ''} onClick={() => setView('work')}>
          {t('Client work')} <span>{workCount}</span>
        </button>
        <button type="button" role="tab" aria-selected={view === 'directory'} className={view === 'directory' ? 'active' : ''} onClick={() => setView('directory')}>
          {t('Directory')} <span>{directoryCount}</span>
        </button>
      </div>
      {view === 'directory' ? (
        <ClientDirectoryWorkspace
          directory={directory}
          locale={locale}
          canCoordinate={props.canCoordinate}
          submitting={props.submitting}
          onCreate={onCreateClient}
          onEdit={onEditClient}
          onOpen={props.onOpen}
        />
      ) : <ClientSuccessWorkspace {...props} locale={locale} />}
    </>
  )
}

function ClientSuccessWorkspace({
  clients,
  jobs,
  locale,
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
  const t = (key, variables = {}) => operatorText(locale, key, variables)
  const rows = clients?.jobs || EMPTY_LIST
  const summary = clients?.summary || {}
  return (
    <section className="panel page-panel client-workspace" data-testid="client-workspace">
      <div className="panel-heading">
        <div>
          <h2>{t('Client success')}</h2>
          <p>{t('Coordinate decisions, handover, punch, warranty, aftercare, and recurring service through retained approval gates.')}</p>
        </div>
        <span className="count-badge">{rows.length}</span>
      </div>
      <div className="client-summary" aria-label={t('Client success summary')}>
        <div>
          <span>{t('Waiting client')}</span>
          <strong>{summary.waitingClient || 0}</strong>
        </div>
        <div>
          <span>{t('Handover ready')}</span>
          <strong>{summary.handoverReady || 0}</strong>
        </div>
        <div>
          <span>{t('Closeout ready')}</span>
          <strong>{summary.closeoutReady || 0}</strong>
        </div>
        <div>
          <span>{t('Punch / warranty')}</span>
          <strong>{summary.punchWarranty || 0}</strong>
        </div>
        <div>
          <span>{t('Aftercare due')}</span>
          <strong>{summary.aftercareDue || 0}</strong>
        </div>
      </div>
      <div className="client-list">
        {rows.map((item) => {
          const job = jobs.find((candidate) => candidate.id === item.jobId) || { id: item.jobId, title: item.jobTitle || t('Ledger job') }
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
                  <h3>{item.jobTitle || t('Ledger job')}</h3>
                  <span className={`status status-${item.clientStatus}`}>{t(formatStatus(item.clientStatus))}</span>
                </div>
                <p>{t(item.nextAction || 'Client records are stable.')}</p>
                <div className="client-values">
                  <span>
                    {t('Client value')} <strong>{currency.format(item.money?.clientValue || 0)}</strong>
                  </span>
                  <span>
                    {t('Selections')} <strong>{item.counts?.pendingSelections || 0}</strong>
                  </span>
                  <span>
                    {t('Waiting replies')} <strong>{item.counts?.waitingReplies || 0}</strong>
                  </span>
                  <span>
                    {t('Open service')}{' '}
                    <strong>
                      {(item.counts?.openPunchItems || 0) + (item.counts?.openWarrantyClaims || 0) + (item.counts?.openAftercare || 0)}
                    </strong>
                  </span>
                </div>
                <div className="client-flags">
                  {item.counts?.pendingApprovals ? (
                    <span className="tag tag-amber">
                      {item.counts.pendingApprovals === 1
                        ? t('{count} approval', { count: item.counts.pendingApprovals })
                        : t('{count} approvals', { count: item.counts.pendingApprovals })}
                    </span>
                  ) : null}
                  {item.counts?.overdueSelections ? (
                    <span className="tag tag-amber">{item.counts.overdueSelections === 1
                      ? t('{count} selection overdue', { count: item.counts.overdueSelections })
                      : t('{count} selections overdue', { count: item.counts.overdueSelections })}</span>
                  ) : null}
                  {item.counts?.overdueReplies ? <span className="tag tag-amber">{item.counts.overdueReplies === 1
                    ? t('{count} reply overdue', { count: item.counts.overdueReplies })
                    : t('{count} replies overdue', { count: item.counts.overdueReplies })}</span> : null}
                  {item.counts?.dueAftercare ? <span className="tag">{t('{count} aftercare due', { count: item.counts.dueAftercare })}</span> : null}
                  {item.counts?.handoverBlockers ? (
                    <span className="tag tag-amber">
                      {item.counts.handoverBlockers === 1
                        ? t('{count} handover blocker', { count: item.counts.handoverBlockers })
                        : t('{count} handover blockers', { count: item.counts.handoverBlockers })}
                    </span>
                  ) : null}
                  {item.counts?.handoverMissing ? (
                    <span className="tag">
                      {item.counts.handoverMissing === 1
                        ? t('{count} handover requirement', { count: item.counts.handoverMissing })
                        : t('{count} handover requirements', { count: item.counts.handoverMissing })}
                    </span>
                  ) : null}
                  {item.latest?.handoverPackage ? (
                    <span className={item.handoverReadiness?.currentPackageId ? 'tag tag-green' : 'tag tag-amber'}>
                      {item.handoverReadiness?.currentPackageId ? t('Dossier current') : t('Dossier refresh due')}
                    </span>
                  ) : null}
                  {item.counts?.handoverDelivered ? <span className="tag tag-green">{t('Handover delivered')}</span> : null}
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
                    {t('Review approval')}
                  </button>
                ) : null}
                {canPrepareCloseout ? (
                  <button
                    className="secondary-button"
                    aria-label={t('Prepare closeout for {job}', { job: job.title })}
                    disabled={submitting}
                    onClick={() => onPrepareCloseout(item)}
                  >
                    <Archive size={16} />
                    {t('Prepare closeout')}
                  </button>
                ) : null}
                {canPrepareHandover ? (
                  <button
                    className="primary-button"
                    aria-label={t('Prepare handover dossier for {job}', { job: job.title })}
                    disabled={submitting}
                    onClick={() => onPrepareHandover(item)}
                  >
                    <PackageCheck size={16} />
                    {t('Prepare dossier')}
                  </button>
                ) : null}
                {item.latest?.handoverPackage ? (
                  <a
                    className="secondary-button"
                    aria-label={t('Download handover dossier for {job}', { job: job.title })}
                    href={`/api/ledger/documents/${encodeURIComponent(item.latest.handoverPackage.id)}/issue-package`}
                    download
                  >
                    <FileDown size={16} />
                    {t('Download dossier')}
                  </a>
                ) : null}
                {canDraftFollowup ? (
                  <button
                    className="secondary-button"
                    aria-label={t('Draft client follow-up for {job}', { job: job.title })}
                    disabled={submitting}
                    onClick={() => onDraftFollowup(item)}
                  >
                    <MessageSquareText size={16} />
                    {t('Draft follow-up')}
                  </button>
                ) : null}
                {selectionAction ? (
                  <button
                    className="secondary-button"
                    aria-label={t('Record client selection for {job}', { job: job.title })}
                    disabled={submitting}
                    onClick={() => onLifecycle(item, 'selection', selectionAction.selectionId)}
                  >
                    <ClipboardCheck size={16} />
                    {t('Record selection')}
                  </button>
                ) : null}
                {punchAction ? (
                  <button
                    className="secondary-button"
                    aria-label={t('Request punch resolution for {job}', { job: job.title })}
                    disabled={submitting}
                    onClick={() => onLifecycle(item, 'punch_item', punchAction.punchItemId)}
                  >
                    <ShieldCheck size={16} />
                    {t('Punch review')}
                  </button>
                ) : null}
                {warrantyAction ? (
                  <button
                    className="secondary-button"
                    aria-label={t('Request warranty resolution for {job}', { job: job.title })}
                    disabled={submitting}
                    onClick={() => onLifecycle(item, 'warranty_claim', warrantyAction.warrantyClaimId)}
                  >
                    <ShieldCheck size={16} />
                    {t('Warranty review')}
                  </button>
                ) : null}
                {aftercareAction ? (
                  <button
                    className="secondary-button"
                    aria-label={t('Complete aftercare for {job}', { job: job.title })}
                    disabled={submitting}
                    onClick={() => onLifecycle(item, 'aftercare', aftercareAction.aftercareId)}
                  >
                    <BadgeCheck size={16} />
                    {t('Complete aftercare')}
                  </button>
                ) : null}
                {canDraftRecurring ? (
                  <button
                    className="secondary-button"
                    aria-label={t('Draft recurring plan for {job}', { job: job.title })}
                    disabled={submitting}
                    onClick={() => onDraftRecurring(item)}
                  >
                    <RefreshCw size={16} />
                    {t('Service plan')}
                  </button>
                ) : null}
                <button className="icon-button table-action" aria-label={t('Open {job}', { job: job.title })} onClick={() => onOpen(job)}>
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </article>
          )
        })}
        {!rows.length ? (
          <Empty
            title={t('No client work')}
            detail={t('Client decisions, closeout, warranty, and aftercare records will appear here when action is needed.')}
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
  const drawings = job.drawings || EMPTY_LIST
  const currentDocumentOptions = [
    ...documents.filter((record) => record.status === 'approved' && record.data?.isCurrent === true),
    ...drawings.filter((record) => record.current === true),
  ]
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
            <legend>Current documents and drawings</legend>
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
            )) : <p className="workflow-note">Approve a controlled document or drawing revision before preparing a transmittal.</p>}
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

function PhotoEvidenceControl({
  job,
  locale,
  canCoordinate,
  canApprove,
  submitting,
  onSchedule,
  onRequestReview,
  onOpenApprovals,
}) {
  const t = (key, variables = {}) => operatorText(locale, key, variables)
  const [scheduling, setScheduling] = useState(false)
  const [draft, setDraft] = useState(() => emptyPhotoEvidenceSetDraft())
  const sets = job.photoEvidenceSets || EMPTY_LIST
  const activeTasks = (job.tasks || EMPTY_LIST).filter(task =>
    !['completed', 'cancelled', 'canceled'].includes(task.status)
  )
  const activeAssignments = (job.assignments || EMPTY_LIST).filter(assignment =>
    !['released', 'cancelled', 'completed', 'closed', 'rejected', 'pending_approval'].includes(assignment.status)
  )
  const pending = sets.filter(set => set.status === 'pending_review').length
  const readyForReview = sets.filter(set => set.status === 'captures_complete' && set.complete).length
  const released = sets.filter(set => set.readyForTaskCompletion).length
  const blocked = sets.filter(set => !set.readyForTaskCompletion).length

  function selectTask(taskId) {
    const task = activeTasks.find(item => item.id === taskId)
    const assignment = activeAssignments.find(item => item.workerId === task?.assigneeId)
    setDraft({
      ...draft,
      taskId,
      assignmentId: assignment?.id || '',
      assignedWorkerId: assignment?.workerId || '',
      title: task ? t('{task} photographic evidence', { task: task.title }) : '',
    })
  }

  async function submitSchedule(event) {
    event.preventDefault()
    const result = await onSchedule({
      ...draft,
      requiredPhases: ['before', 'during', 'after'],
    })
    if (!result) return
    setDraft(emptyPhotoEvidenceSetDraft())
    setScheduling(false)
  }

  return (
    <section className="job-workspace-section field-risk-control photo-evidence-control" data-testid="photo-evidence-control">
      <div className="section-heading field-risk-heading">
        <Camera size={18} />
        <div>
          <h3>{t('Before, during, and after evidence')}</h3>
          <p>{t('Task-bound, checksum-protected field photos with independent release.')}</p>
        </div>
        {canCoordinate ? (
          <button type="button" className="secondary-button" disabled={submitting} onClick={() => setScheduling(current => !current)}>
            {scheduling ? <X size={15} /> : <Plus size={15} />}
            {scheduling ? t('Cancel') : t('Schedule set')}
          </button>
        ) : null}
      </div>

      <div className="field-risk-summary" aria-label={t('Photo evidence summary')}>
        <div><span>{t('Task holds')}</span><strong>{blocked}</strong></div>
        <div><span>{t('Ready for review')}</span><strong>{readyForReview}</strong></div>
        <div><span>{t('Pending review')}</span><strong>{pending}</strong></div>
        <div><span>{t('Released')}</span><strong>{released}</strong></div>
      </div>

      {scheduling ? (
        <form className="field-risk-form form-grid compact-form" data-testid="photo-evidence-schedule-form" onSubmit={submitSchedule}>
          <label>
            {t('Task')}
            <select required value={draft.taskId} onChange={(event) => selectTask(event.target.value)}>
              <option value="">{t('Select a task with an assigned worker')}</option>
              {activeTasks.map(task => (
                <option key={task.id} value={task.id}>{task.title}</option>
              ))}
            </select>
          </label>
          <label>
            {t('Assigned worker')}
            <select
              required
              value={draft.assignmentId}
              onChange={(event) => {
                const assignment = activeAssignments.find(item => item.id === event.target.value)
                setDraft({
                  ...draft,
                  assignmentId: event.target.value,
                  assignedWorkerId: assignment?.workerId || '',
                })
              }}
            >
              <option value="">{t('Select retained assignment')}</option>
              {activeAssignments.map(assignment => (
                <option key={assignment.id} value={assignment.id}>
                  {assignment.workerName || assignment.workerId} / {assignment.role}
                </option>
              ))}
            </select>
          </label>
          <label className="form-span">
            {t('Evidence title')}
            <input required minLength="3" maxLength="240" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label className="form-span">
            {t('Exact work location')}
            <input required minLength="2" maxLength="240" value={draft.workLocation} onChange={(event) => setDraft({ ...draft, workLocation: event.target.value })} placeholder={t('Building, level, room, grid, elevation, or asset')} />
          </label>
          <label className="form-span">
            {t('Field instructions')}
            <textarea maxLength="600" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder={t('Required viewpoints, visible references, or access constraints.')} />
          </label>
          <p className="workflow-note form-span">{t('Scheduling activates a task-completion hold. Only the assigned worker can capture the governed sequence; an independent approver must release it.')}</p>
          <div className="form-actions">
            <button className="primary-button" disabled={submitting || !draft.taskId || !draft.assignmentId || !draft.assignedWorkerId}>
              <Camera size={15} />{t('Schedule evidence set')}
            </button>
          </div>
        </form>
      ) : null}

      <div className="photo-evidence-register">
        {sets.length ? sets.map(set => (
          <article className={`photo-evidence-row photo-evidence-${set.effectiveStatus}`} key={set.id}>
            <div className="photo-evidence-row-heading">
              <div>
                <strong>{set.taskTitle || set.title}</strong>
                <small>{set.workLocation} / {set.assignedWorkerName || set.assignedWorkerId}</small>
              </div>
              <span className={`tag ${set.readyForTaskCompletion ? 'tag-green' : set.effectiveStatus === 'stale' || set.effectiveStatus === 'integrity_invalid' ? 'tag-red' : 'tag-amber'}`}>
                {t(formatStatus(set.effectiveStatus))}
              </span>
            </div>
            <div className="photo-evidence-phases" aria-label={t('{title} phase evidence', { title: set.title })}>
              {['before', 'during', 'after'].map(phase => {
                const capture = set.captures?.find(item => item.phase === phase)
                return (
                  <div className={capture ? 'complete' : 'missing'} key={phase}>
                    <span>{t(formatStatus(phase))}</span>
                    <strong>{capture ? formatDateTime(capture.capturedAt) : t('Missing')}</strong>
                    {capture ? (
                      <a href={`/api/ledger/documents/${encodeURIComponent(capture.documentId)}/content`} target="_blank" rel="noreferrer">
                        {capture.document?.filename || t('Open photo')}
                      </a>
                    ) : null}
                  </div>
                )
              })}
            </div>
            {!set.sourceCurrent ? <p className="installation-qc-blocked"><TriangleAlert size={15} />{t('Task, assignment, worker, or location source changed. Release remains blocked.')}</p> : null}
            {!set.integrityValid || !set.captureIntegrityValid ? <p className="installation-qc-blocked"><TriangleAlert size={15} />{t('Retained evidence failed integrity verification.')}</p> : null}
            <div className="form-actions">
              {canCoordinate && set.status === 'captures_complete' && set.complete && set.sourceCurrent && set.integrityValid && set.captureIntegrityValid ? (
                <button type="button" className="primary-button" disabled={submitting} onClick={() => onRequestReview(set.id, { entryKey: createFieldEvidenceDraftId() })}>
                  <ShieldCheck size={15} />{t('Request independent review')}
                </button>
              ) : null}
              {canApprove && set.status === 'pending_review' && set.latestApprovalId ? (
                <button type="button" className="secondary-button" onClick={() => onOpenApprovals({ jobId: job.id, approvalId: set.latestApprovalId })}>
                  <LockKeyhole size={15} />{t('Open approval')}
                </button>
              ) : null}
            </div>
          </article>
        )) : <Empty title={t('No governed photo evidence')} detail={t('Schedule a before, during, and after set against a task with an active assigned worker.')} />}
      </div>
    </section>
  )
}

function InspectionChecklistControl({
  job,
  templates,
  locale,
  canCoordinate,
  canApprove,
  fieldScoped,
  operator,
  submitting,
  onCreateTemplate,
  onSchedule,
  onSubmit,
  onOpenApprovals,
}) {
  const t = (key, variables = {}) => operatorText(locale, key, variables)
  const checklistInspections = (job.inspections || EMPTY_LIST).filter((inspection) => inspection.checklist?.configured)
  const activeAssignments = (job.assignments || EMPTY_LIST).filter((assignment) =>
    !['released', 'cancelled', 'completed', 'closed', 'rejected', 'pending_approval'].includes(assignment.status)
  )
  const eligibleTasks = (job.tasks || EMPTY_LIST).filter((task) =>
    !['completed', 'cancelled', 'canceled', 'closed'].includes(task.status)
  )
  const installationStages = [
    ['pre_installation', t('Pre-installation')],
    ['first_work', t('First work')],
    ['in_process', t('In process')],
    ['pre_concealment', t('Pre-concealment')],
    ['testing', t('Testing')],
    ['final_acceptance', t('Final acceptance')],
  ]
  const controlPoints = [['check', t('Check')], ['witness', t('Witness')], ['hold', t('Hold')]]
  const [scheduleDraft, setScheduleDraft] = useState(null)
  const [templateDraft, setTemplateDraft] = useState(null)
  const [activeInspection, setActiveInspection] = useState(null)
  const [responses, setResponses] = useState({})
  const [submissionNotes, setSubmissionNotes] = useState('')

  const resetTemplateDraft = () => ({
    name: '',
    templateKey: '',
    inspectionType: 'site_inspection',
    discipline: 'quality',
    notes: '',
    installationQc: false,
    defaultInstallationStage: 'in_process',
    defaultControlPoint: 'check',
    items: [
      { key: 'item_1', prompt: '', acceptanceCriteria: '', controlPoint: 'check', required: true, allowNotApplicable: false, evidenceRequired: false, measurementRequired: false, measurementUnit: '', failureSeverity: 'medium' },
      { key: 'item_2', prompt: '', acceptanceCriteria: '', controlPoint: 'check', required: true, allowNotApplicable: false, evidenceRequired: false, measurementRequired: false, measurementUnit: '', failureSeverity: 'medium' },
    ],
  })

  const createScheduleDraft = (template) => {
    const firstTask = eligibleTasks.find((task) =>
      !task.assigneeId || activeAssignments.some((assignment) => assignment.workerId === task.assigneeId)
    ) || eligibleTasks[0]
    const firstAssignment = activeAssignments.find((assignment) => assignment.workerId === firstTask?.assigneeId)
      || activeAssignments[0]
    return {
      templateId: template?.id || '',
      title: template?.name || '',
      scheduledAt: toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
      inspector: template?.data?.installationQc ? firstAssignment?.workerName || '' : operator?.name || '',
      notes: '',
      taskId: firstTask?.id || '',
      assignmentId: firstAssignment?.id || '',
      assignedWorkerId: firstAssignment?.workerId || '',
      workLocation: job.siteAddress || job.location || '',
      installationStage: template?.data?.defaultInstallationStage || 'in_process',
      controlPoint: template?.data?.defaultControlPoint || 'check',
      referenceBasis: '',
      referenceDocumentIds: [],
    }
  }

  const beginSchedule = () => {
    const first = templates.find((template) => template.status === 'active')
    setScheduleDraft(createScheduleDraft(first))
    setTemplateDraft(null)
  }

  const beginChecklist = (inspection) => {
    const latest = inspection.checklist?.submissions?.[0]?.snapshot?.responses || EMPTY_LIST
    setResponses(
      Object.fromEntries(
        (inspection.checklist?.snapshot?.items || EMPTY_LIST).map((item) => {
          const prior = latest.find((response) => response.itemKey === item.key)
          return [item.key, {
            result: prior?.result || '',
            notes: prior?.notes || '',
            evidenceDocumentId: prior?.evidenceDocumentIds?.[0] || '',
            observedValue: prior?.observedValue || '',
            witnessName: prior?.witnessName || '',
            witnessRole: prior?.witnessRole || '',
          }]
        }),
      ),
    )
    setSubmissionNotes(inspection.checklist?.submissions?.[0]?.snapshot?.notes || '')
    setActiveInspection(inspection)
    setScheduleDraft(null)
    setTemplateDraft(null)
  }

  const updateResponse = (itemKey, patch) => {
    setResponses((current) => ({ ...current, [itemKey]: { ...current[itemKey], ...patch } }))
  }

  const scheduleTemplate = templates.find((template) => template.id === scheduleDraft?.templateId)
  const installationScheduleReady = scheduleTemplate?.data?.installationQc !== true || Boolean(
    scheduleDraft?.taskId
    && scheduleDraft?.assignmentId
    && scheduleDraft?.assignedWorkerId
    && scheduleDraft?.workLocation?.trim().length >= 2
    && scheduleDraft?.referenceBasis?.trim().length >= 3
  )
  const checklistItems = activeInspection?.checklist?.snapshot?.items || EMPTY_LIST
  const activeInstallationQc = activeInspection?.installationQc || null
  const checklistReady = checklistItems.length > 0 && checklistItems.every((item) => {
    const response = responses[item.key]
    if (!response?.result) return !item.required
    if (response.result === 'fail' && !response.notes.trim() && !response.evidenceDocumentId) return false
    if (response.result === 'pass' && item.evidenceRequired && !response.evidenceDocumentId) return false
    if (response.result === 'pass' && item.measurementRequired && !response.observedValue.trim()) return false
    if (response.result === 'pass' && item.controlPoint === 'witness' && (
      response.witnessName.trim().length < 2 || response.witnessRole.trim().length < 2
    )) return false
    return response.result !== 'not_applicable' || item.allowNotApplicable
  })

  async function submitSchedule(event) {
    event.preventDefault()
    if (!scheduleDraft?.templateId || !toIsoDateTime(scheduleDraft.scheduledAt)) return
    if (scheduleTemplate?.data?.installationQc && (
      !scheduleDraft.taskId
      || !scheduleDraft.assignmentId
      || !scheduleDraft.assignedWorkerId
      || scheduleDraft.workLocation.trim().length < 2
      || scheduleDraft.referenceBasis.trim().length < 3
    )) return
    const result = await onSchedule({
      ...scheduleDraft,
      scheduledAt: toIsoDateTime(scheduleDraft.scheduledAt),
      entryKey: createFieldEvidenceDraftId(),
    })
    if (result) setScheduleDraft(null)
  }

  async function submitTemplate(event) {
    event.preventDefault()
    if (!templateDraft) return
    const result = await onCreateTemplate({ ...templateDraft })
    if (result) {
      setTemplateDraft(null)
      setScheduleDraft(createScheduleDraft(result))
    }
  }

  async function submitChecklist(event) {
    event.preventDefault()
    if (!activeInspection || !checklistReady) return
    const result = await onSubmit(activeInspection, {
      entryKey: createFieldEvidenceDraftId(),
      notes: submissionNotes.trim(),
      capturedAt: new Date().toISOString(),
      responses: checklistItems
        .filter((item) => responses[item.key]?.result)
        .map((item) => ({
          itemKey: item.key,
          result: responses[item.key].result,
          notes: responses[item.key].notes.trim(),
          observedValue: responses[item.key].observedValue.trim(),
          witnessName: responses[item.key].witnessName.trim(),
          witnessRole: responses[item.key].witnessRole.trim(),
          evidenceDocumentIds: responses[item.key].evidenceDocumentId ? [responses[item.key].evidenceDocumentId] : [],
        })),
    })
    if (result) setActiveInspection(null)
  }

  return (
    <section className="job-workspace-section inspection-checklist-control" data-testid="inspection-checklist-control">
      <div className="section-heading inspection-checklist-heading">
        <ClipboardCheck size={18} />
        <div>
          <h3>{t('Inspection checklists')}</h3>
          <p>{t('Versioned questions, field responses, corrective observations, and approval-backed sign-off.')}</p>
        </div>
        {canCoordinate ? (
          <div className="inspection-checklist-heading-actions">
            <button type="button" className="icon-button" aria-label={t('Create inspection template')} title={t('Create inspection template')} onClick={() => { setTemplateDraft(resetTemplateDraft()); setScheduleDraft(null); setActiveInspection(null) }}>
              <Plus size={17} />
            </button>
            <button type="button" className="secondary-button" disabled={!templates.length || submitting} onClick={beginSchedule}>
              <CalendarDays size={15} />{t('Schedule')}
            </button>
          </div>
        ) : null}
      </div>

      {templateDraft ? (
        <form className="inspection-template-editor" data-testid="inspection-template-form" onSubmit={submitTemplate}>
          <div className="form-grid compact-form">
            <label>{t('Template name')}<input autoFocus required minLength="3" maxLength="160" value={templateDraft.name} onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })} /></label>
            <label>{t('Template key')}<input required pattern="[A-Za-z0-9_ -]+" value={templateDraft.templateKey} onChange={(event) => setTemplateDraft({ ...templateDraft, templateKey: event.target.value })} placeholder="facade_quality" /></label>
            <label>{t('Type')}<input required value={templateDraft.inspectionType} onChange={(event) => setTemplateDraft({ ...templateDraft, inspectionType: event.target.value })} /></label>
            <label>{t('Discipline')}<select value={templateDraft.discipline} onChange={(event) => setTemplateDraft({ ...templateDraft, discipline: event.target.value })}><option value="quality">{t('Quality')}</option><option value="safety">{t('Safety')}</option><option value="closeout">{t('Closeout')}</option><option value="general">{t('General')}</option></select></label>
            <label className="checkbox-label form-span"><input type="checkbox" checked={templateDraft.installationQc} onChange={(event) => setTemplateDraft({
              ...templateDraft,
              installationQc: event.target.checked,
              inspectionType: event.target.checked ? 'installation_qc' : templateDraft.inspectionType,
              discipline: event.target.checked ? 'quality' : templateDraft.discipline,
            })} />{t('Govern task completion as installation QC')}</label>
            {templateDraft.installationQc ? (
              <>
                <label>{t('Default installation stage')}<select value={templateDraft.defaultInstallationStage} onChange={(event) => setTemplateDraft({ ...templateDraft, defaultInstallationStage: event.target.value })}>{installationStages.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <label>{t('Default control point')}<select value={templateDraft.defaultControlPoint} onChange={(event) => setTemplateDraft({ ...templateDraft, defaultControlPoint: event.target.value })}>{controlPoints.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              </>
            ) : null}
          </div>
          <fieldset className="inspection-template-items">
            <legend>{t('Checklist items')}</legend>
            {templateDraft.items.map((item, index) => (
              <div className="inspection-template-item" key={`${item.key}-${index}`}>
                <label className="inspection-template-prompt">{t('Prompt')}<input required minLength="3" maxLength="300" value={item.prompt} onChange={(event) => setTemplateDraft({ ...templateDraft, items: templateDraft.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, prompt: event.target.value } : candidate) })} /></label>
                {templateDraft.installationQc ? <label className="inspection-template-criteria">{t('Acceptance criteria')}<textarea required minLength="3" maxLength="600" value={item.acceptanceCriteria} onChange={(event) => setTemplateDraft({ ...templateDraft, items: templateDraft.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, acceptanceCriteria: event.target.value } : candidate) })} /></label> : null}
                <label>{t('Failure severity')}<select value={item.failureSeverity} onChange={(event) => setTemplateDraft({ ...templateDraft, items: templateDraft.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, failureSeverity: event.target.value } : candidate) })}><option value="low">{t('Low')}</option><option value="medium">{t('Medium')}</option><option value="high">{t('High')}</option><option value="critical">{t('Critical')}</option></select></label>
                {templateDraft.installationQc ? <label>{t('Control point')}<select value={item.controlPoint} onChange={(event) => setTemplateDraft({ ...templateDraft, items: templateDraft.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, controlPoint: event.target.value } : candidate) })}>{controlPoints.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label> : null}
                <label className="checkbox-label"><input type="checkbox" checked={item.allowNotApplicable} onChange={(event) => setTemplateDraft({ ...templateDraft, items: templateDraft.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, allowNotApplicable: event.target.checked } : candidate) })} />{t('Allow N/A')}</label>
                {templateDraft.installationQc ? (
                  <>
                    <label className="checkbox-label"><input type="checkbox" checked={item.evidenceRequired} onChange={(event) => setTemplateDraft({ ...templateDraft, items: templateDraft.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, evidenceRequired: event.target.checked } : candidate) })} />{t('Evidence required to pass')}</label>
                    <label className="checkbox-label"><input type="checkbox" checked={item.measurementRequired} onChange={(event) => setTemplateDraft({ ...templateDraft, items: templateDraft.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, measurementRequired: event.target.checked } : candidate) })} />{t('Measured value required')}</label>
                    {item.measurementRequired ? <label>{t('Measurement unit')}<input maxLength="40" value={item.measurementUnit} onChange={(event) => setTemplateDraft({ ...templateDraft, items: templateDraft.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, measurementUnit: event.target.value } : candidate) })} placeholder="mm, bar, Nm" /></label> : null}
                  </>
                ) : null}
                <button type="button" className="icon-button" aria-label={t('Remove checklist item {number}', { number: index + 1 })} disabled={templateDraft.items.length <= 2} onClick={() => setTemplateDraft({ ...templateDraft, items: templateDraft.items.filter((_, itemIndex) => itemIndex !== index).map((candidate, itemIndex) => ({ ...candidate, key: `item_${itemIndex + 1}` })) })}><X size={15} /></button>
              </div>
            ))}
            <button type="button" className="secondary-button" disabled={templateDraft.items.length >= 50} onClick={() => setTemplateDraft({ ...templateDraft, items: [...templateDraft.items, { key: `item_${templateDraft.items.length + 1}`, prompt: '', acceptanceCriteria: '', controlPoint: 'check', required: true, allowNotApplicable: false, evidenceRequired: false, measurementRequired: false, measurementUnit: '', failureSeverity: 'medium' }] })}><Plus size={15} />{t('Add item')}</button>
          </fieldset>
          <div className="form-actions"><button className="primary-button" disabled={submitting || templateDraft.items.some((item) => item.prompt.trim().length < 3 || (templateDraft.installationQc && item.acceptanceCriteria.trim().length < 3))}><ClipboardCheck size={15} />{t('Retain template')}</button><button type="button" className="secondary-button" onClick={() => setTemplateDraft(null)}>{t('Cancel')}</button></div>
        </form>
      ) : null}

      {scheduleDraft ? (
        <form className="inspection-schedule-form form-grid compact-form" data-testid="inspection-schedule-form" onSubmit={submitSchedule}>
          <label>{t('Template')}<select required value={scheduleDraft.templateId} onChange={(event) => {
            const template = templates.find((candidate) => candidate.id === event.target.value)
            setScheduleDraft({
              ...createScheduleDraft(template),
              scheduledAt: scheduleDraft.scheduledAt,
              notes: scheduleDraft.notes,
            })
          }}>{templates.filter((template) => template.status === 'active').map((template) => <option key={template.id} value={template.id}>{template.name} / v{template.versionNumber}{template.data?.installationQc ? ` / ${t('installation QC')}` : ''}</option>)}</select></label>
          <label>{t('Scheduled date and time')}<input required type="datetime-local" value={scheduleDraft.scheduledAt} onChange={(event) => setScheduleDraft({ ...scheduleDraft, scheduledAt: event.target.value })} /></label>
          <label className="form-span">{t('Inspection title')}<input required minLength="3" maxLength="240" value={scheduleDraft.title} onChange={(event) => setScheduleDraft({ ...scheduleDraft, title: event.target.value })} /></label>
          {scheduleTemplate?.data?.installationQc ? (
            <>
              <label>{t('Installation task')}<select required value={scheduleDraft.taskId} onChange={(event) => {
                const task = eligibleTasks.find((candidate) => candidate.id === event.target.value)
                const assignment = activeAssignments.find((candidate) => candidate.workerId === task?.assigneeId)
                  || activeAssignments.find((candidate) => candidate.id === scheduleDraft.assignmentId)
                  || activeAssignments[0]
                setScheduleDraft({
                  ...scheduleDraft,
                  taskId: event.target.value,
                  assignmentId: assignment?.id || '',
                  assignedWorkerId: assignment?.workerId || '',
                  inspector: assignment?.workerName || '',
                })
              }}><option value="">{t('Select active task')}</option>{eligibleTasks.map((task) => <option value={task.id} key={task.id}>{task.title}{task.assigneeId ? ` / ${t('assigned')}` : ''}</option>)}</select></label>
              <label>{t('Assigned inspector')}<select required value={scheduleDraft.assignmentId} onChange={(event) => {
                const assignment = activeAssignments.find((candidate) => candidate.id === event.target.value)
                setScheduleDraft({
                  ...scheduleDraft,
                  assignmentId: event.target.value,
                  assignedWorkerId: assignment?.workerId || '',
                  inspector: assignment?.workerName || '',
                })
              }}><option value="">{t('Select active assignment')}</option>{activeAssignments.map((assignment) => <option value={assignment.id} key={assignment.id}>{assignment.workerName || assignment.workerId} / {t(formatStatus(assignment.status))}</option>)}</select></label>
              <label>{t('Work location')}<input required minLength="2" maxLength="240" value={scheduleDraft.workLocation} onChange={(event) => setScheduleDraft({ ...scheduleDraft, workLocation: event.target.value })} placeholder={t('Building, level, room, grid, or asset')} /></label>
              <label>{t('Installation stage')}<select value={scheduleDraft.installationStage} onChange={(event) => setScheduleDraft({ ...scheduleDraft, installationStage: event.target.value })}>{installationStages.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label>{t('Control point')}<select value={scheduleDraft.controlPoint} onChange={(event) => setScheduleDraft({ ...scheduleDraft, controlPoint: event.target.value })}>{controlPoints.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label className="form-span">{t('Reference basis')}<textarea required minLength="3" maxLength="600" value={scheduleDraft.referenceBasis} onChange={(event) => setScheduleDraft({ ...scheduleDraft, referenceBasis: event.target.value })} placeholder={t('Approved drawing, specification clause, method statement, manufacturer requirement, or accepted sample.')} /></label>
              <fieldset className="installation-qc-reference-documents form-span">
                <legend>{t('Current retained references')}</legend>
                {(job.documents || EMPTY_LIST).length ? (job.documents || EMPTY_LIST).map((document) => (
                  <label className="checkbox-label" key={document.id}><input type="checkbox" checked={scheduleDraft.referenceDocumentIds.includes(document.id)} onChange={(event) => setScheduleDraft({
                    ...scheduleDraft,
                    referenceDocumentIds: event.target.checked
                      ? [...scheduleDraft.referenceDocumentIds, document.id]
                      : scheduleDraft.referenceDocumentIds.filter((id) => id !== document.id),
                  })} />{document.title || document.filename || document.id}{document.revision ? ` / ${t('rev')} ${document.revision}` : ''}</label>
                )) : <span>{t('No retained job documents. The written reference basis remains mandatory.')}</span>}
              </fieldset>
            </>
          ) : <label>{t('Inspector')}<input value={scheduleDraft.inspector} onChange={(event) => setScheduleDraft({ ...scheduleDraft, inspector: event.target.value })} /></label>}
          <div className="inspection-template-summary"><strong>{t('{count} checks', { count: scheduleTemplate?.items?.length || 0 })}</strong><span>{t(formatStatus(scheduleTemplate?.discipline || 'general'))} / {t('immutable')} v{scheduleTemplate?.versionNumber || '-'}</span></div>
          {scheduleTemplate?.data?.installationQc && (!eligibleTasks.length || !activeAssignments.length) ? <p className="workflow-note form-span">{t('Create an active task and approved worker assignment before scheduling installation QC.')}</p> : null}
          <div className="form-actions form-span"><button className="primary-button" disabled={submitting || !scheduleDraft.templateId || !toIsoDateTime(scheduleDraft.scheduledAt) || !installationScheduleReady}><CalendarDays size={15} />{scheduleTemplate?.data?.installationQc ? t('Schedule control point') : t('Schedule checklist')}</button><button type="button" className="secondary-button" onClick={() => setScheduleDraft(null)}>{t('Cancel')}</button></div>
        </form>
      ) : null}

      {activeInspection ? (
        <form className="inspection-checklist-form" data-testid="inspection-checklist-form" onSubmit={submitChecklist}>
          <div className="inspection-checklist-run-heading"><div><strong>{activeInspection.title}</strong><small>{activeInspection.checklist.snapshot.templateName} / v{activeInspection.checklist.snapshot.templateVersion}</small></div><span className={`status status-${activeInspection.status}`}>{t(formatStatus(activeInspection.status))}</span></div>
          {activeInstallationQc ? (
            <div className="installation-qc-context" data-testid="installation-qc-context">
              <div><span>{t('Location')}</span><strong>{activeInstallationQc.workLocation}</strong></div>
              <div><span>{t('Stage')}</span><strong>{t(formatStatus(activeInstallationQc.installationStage))}</strong></div>
              <div><span>{t('Control')}</span><strong>{t(formatStatus(activeInstallationQc.controlPoint))}</strong></div>
              <div><span>{t('Assigned worker')}</span><strong>{activeInstallationQc.assignedWorkerName || activeInstallationQc.assignedWorkerId}</strong></div>
              <p><strong>{t('Reference basis')}:</strong> {activeInstallationQc.referenceBasis}</p>
              {!activeInstallationQc.sourceCurrent ? <p className="installation-qc-blocked"><TriangleAlert size={15} />{t('Source changed. Office review and a newly scheduled control are required before submission.')}</p> : null}
            </div>
          ) : null}
          <div className="inspection-checklist-items">
            {checklistItems.map((item, index) => {
              const response = responses[item.key] || { result: '', notes: '', evidenceDocumentId: '', observedValue: '', witnessName: '', witnessRole: '' }
              return (
                <fieldset className={`inspection-checklist-item inspection-result-${response.result || 'pending'}`} key={item.key}>
                  <legend>{index + 1}. {item.prompt}</legend>
                  {activeInstallationQc ? <p className="inspection-acceptance-criteria"><strong>{t('Accept when')}:</strong> {item.acceptanceCriteria || item.prompt}</p> : null}
                  <div className="inspection-result-options" role="radiogroup" aria-label={t('Result for {prompt}', { prompt: item.prompt })}>
                    {[['pass', t('Pass'), Check], ['fail', t('Fail'), TriangleAlert], ...(item.allowNotApplicable ? [['not_applicable', t('N/A'), Ban]] : [])].map(([value, label, Icon]) => (
                      <label key={value} className={response.result === value ? 'selected' : ''}><input required={item.required} type="radio" name={`inspection-${item.key}`} value={value} checked={response.result === value} onChange={() => updateResponse(item.key, { result: value })} />{createElement(Icon, { size: 15 })}{label}</label>
                    ))}
                  </div>
                  <label>{t('Item notes')}<textarea required={response.result === 'fail' && !response.evidenceDocumentId} value={response.notes} onChange={(event) => updateResponse(item.key, { notes: event.target.value })} placeholder={response.result === 'fail' ? t('Describe the defect, immediate control, or required correction.') : t('Optional retained context.')} /></label>
                  <label>{t('Evidence link')}<select required={response.result === 'pass' && item.evidenceRequired} value={response.evidenceDocumentId} onChange={(event) => updateResponse(item.key, { evidenceDocumentId: event.target.value })}><option value="">{t('No linked document')}</option>{(job.documents || EMPTY_LIST).map((document) => <option value={document.id} key={document.id}>{document.title || document.filename || document.id}</option>)}</select></label>
                  {item.measurementRequired ? <label>{t('Observed value')}{item.measurementUnit ? ` (${item.measurementUnit})` : ''}<input required={response.result === 'pass'} maxLength="500" value={response.observedValue} onChange={(event) => updateResponse(item.key, { observedValue: event.target.value })} placeholder={t('Retained measured result')} /></label> : null}
                  {item.controlPoint === 'witness' ? (
                    <>
                      <label>{t('Witness name')}<input required={response.result === 'pass'} minLength="2" maxLength="160" value={response.witnessName} onChange={(event) => updateResponse(item.key, { witnessName: event.target.value })} /></label>
                      <label>{t('Witness role')}<input required={response.result === 'pass'} minLength="2" maxLength="160" value={response.witnessRole} onChange={(event) => updateResponse(item.key, { witnessRole: event.target.value })} /></label>
                    </>
                  ) : null}
                  <small>{t('{point} point / {severity} failure severity{evidence}{na}', {
                    point: t(formatStatus(item.controlPoint || 'check')),
                    severity: t(formatStatus(item.failureSeverity)),
                    evidence: item.evidenceRequired ? ` / ${t('pass evidence required')}` : '',
                    na: item.allowNotApplicable ? ` / ${t('N/A allowed')}` : '',
                  })}</small>
                </fieldset>
              )
            })}
          </div>
          <label className="inspection-run-notes">{t('Inspection summary')}<textarea maxLength="4000" value={submissionNotes} onChange={(event) => setSubmissionNotes(event.target.value)} placeholder={t('Record overall context, limitations, and follow-up.')} /></label>
          <p className="workflow-note">{t('Submission freezes these responses, creates corrective observations for failed items, and requests an independent approval. Offline capture may queue evidence, but never releases a hold point or completes the task.')}</p>
          <div className="form-actions"><button className="primary-button" disabled={submitting || !checklistReady || activeInstallationQc?.sourceCurrent === false}><ShieldCheck size={15} />{navigator.onLine === false ? t('Save checklist offline') : t('Submit for review')}</button><button type="button" className="secondary-button" onClick={() => setActiveInspection(null)}>{t('Cancel')}</button></div>
        </form>
      ) : null}

      <div className="inspection-checklist-register">
        {checklistInspections.length ? checklistInspections.map((inspection) => {
          const summary = inspection.checklist.summary
          const pending = (job.approvals || EMPTY_LIST).find((approval) => approval.id === inspection.approvalId && approval.status === 'pending')
          const installationQc = inspection.installationQc
          const workerCanFill = !installationQc
            || operator?.authenticated !== true
            || (fieldScoped && operator?.worker?.id === installationQc.assignedWorkerId)
          const canFill = ['scheduled', 'in_progress', 'pending_review', 'failed', 'rejected'].includes(inspection.status)
            && !pending
            && workerCanFill
            && installationQc?.sourceCurrent !== false
          return (
            <article className="inspection-checklist-row" key={inspection.id} data-testid={`inspection-checklist-${inspection.id}`}>
              <div>
                <strong>{inspection.title}</strong>
                <small>{inspection.checklist.snapshot.templateName} / v{inspection.checklist.snapshot.templateVersion} / {formatDateTime(inspection.scheduledAt)}</small>
                {installationQc ? <span>{installationQc.workLocation} / {t(formatStatus(installationQc.installationStage))} / {t(formatStatus(installationQc.controlPoint))} / {installationQc.assignedWorkerName || installationQc.assignedWorkerId}</span> : null}
                <span>{summary
                  ? t('{responses} responses / {failed} failed', { responses: summary.responseCount, failed: summary.failedCount })
                  : t('{count} checks waiting', { count: inspection.checklist.snapshot.items.length })}</span>
                {installationQc && installationQc.sourceCurrent === false ? <span className="installation-qc-stale">{t('Retained source is stale; release and task completion are blocked.')}</span> : null}
              </div>
              <div className="inspection-checklist-row-actions"><span className={`status status-${installationQc?.effectiveStatus || inspection.status}`}>{t(formatStatus(installationQc?.effectiveStatus || inspection.status))}</span>{pending && canApprove ? <button type="button" className="secondary-button" onClick={() => onOpenApprovals({ approvalId: pending.id })}><ShieldCheck size={14} />{t('Review')}</button> : null}{canFill ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => beginChecklist(inspection)}><ClipboardList size={14} />{inspection.checklist.submissions.length ? t('Correct and resubmit') : t('Complete')}</button> : null}</div>
            </article>
          )
        }) : <p className="workflow-note">{t('No versioned inspection checklist has been scheduled for this job.')}</p>}
      </div>
      {fieldScoped ? <p className="workflow-note">{t('Assigned field workers can complete scheduled checklists. Template and schedule control remain with the office.')}</p> : null}
    </section>
  )
}

function NonconformanceControl({
  job,
  canReport,
  canCoordinate,
  canApprove,
  fieldScoped,
  operator,
  submitting,
  onCreate,
  onRequestCorrection,
  onRequestClosure,
  onOpenApprovals,
}) {
  const records = job.nonconformances || EMPTY_LIST
  const [editor, setEditor] = useState(null)
  const [draft, setDraft] = useState(() => emptyNonconformanceDraft(operator?.name || ''))
  const [online, setOnline] = useState(() => navigator.onLine !== false)

  useEffect(() => {
    setEditor(null)
    setDraft(emptyNonconformanceDraft(operator?.name || ''))
  }, [job.id, operator?.name])

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const pendingCorrection = records.filter((record) => record.status === 'pending_correction_approval').length
  const pendingClosure = records.filter((record) => record.status === 'pending_closure_approval').length
  const overdue = records.filter((record) => {
    const dueAt = record.correctiveAction?.dueAt || record.dueAt
    return record.status !== 'closed' && dueAt && dueAt < futureDateInput(0)
  }).length
  const open = records.filter((record) => record.status !== 'closed').length

  const beginCreate = () => {
    setDraft(emptyNonconformanceDraft(operator?.name || ''))
    setEditor({ type: 'create', record: null })
  }

  const beginCorrection = (record) => {
    setDraft(emptyNonconformanceCorrection(record))
    setEditor({ type: 'correction', record })
  }

  const beginClosure = (record) => {
    setDraft(emptyNonconformanceClosure(operator?.name || ''))
    setEditor({ type: 'closure', record })
  }

  async function submit(event) {
    event.preventDefault()
    if (!editor) return
    let result = null
    if (editor.type === 'create') {
      result = await onCreate({ ...draft, detectedAt: toIsoDateTime(draft.detectedAt) })
    } else if (editor.type === 'correction') {
      result = await onRequestCorrection(editor.record.id, draft)
    } else {
      result = await onRequestClosure(editor.record.id, { ...draft, verifiedAt: toIsoDateTime(draft.verifiedAt) })
    }
    if (result) setEditor(null)
  }

  const createInvalid = editor?.type === 'create' && (
    draft.title.trim().length < 3
    || draft.description.trim().length < 4
    || draft.raisedBy.trim().length < 2
    || draft.requirementReference.trim().length < 3
    || draft.immediateContainment.trim().length < 4
    || draft.responsibleParty.trim().length < 2
    || !toIsoDateTime(draft.detectedAt)
  )
  const correctionInvalid = editor?.type === 'correction' && (
    draft.rootCause.trim().length < 4
    || draft.correctiveAction.trim().length < 4
    || draft.responsibleParty.trim().length < 2
    || draft.evidenceReference.trim().length < 3
  )
  const closureInvalid = editor?.type === 'closure' && (
    draft.verificationResult !== 'passed'
    || draft.verificationEvidence.trim().length < 3
    || draft.verifiedBy.trim().length < 2
    || !toIsoDateTime(draft.verifiedAt)
  )

  return (
    <section className="job-workspace-section field-risk-control nonconformance-control" data-testid="nonconformance-control">
      <div className="section-heading field-risk-heading">
        <ClipboardPenLine size={18} />
        <div>
          <h3>Nonconformance register</h3>
          <p>Quality deviations, containment, corrective action, and independent verification.</p>
        </div>
        {canReport ? <button type="button" className="secondary-button" disabled={submitting} onClick={beginCreate}><Plus size={15} />New NCR</button> : null}
      </div>

      <div className="field-risk-summary" aria-label="Nonconformance summary">
        <div><span>Open NCRs</span><strong>{open}</strong></div>
        <div><span>Correction review</span><strong>{pendingCorrection}</strong></div>
        <div><span>Closure review</span><strong>{pendingClosure}</strong></div>
        <div><span>Overdue</span><strong>{overdue}</strong></div>
      </div>

      {editor ? (
        <form className="field-risk-form form-grid compact-form" data-testid={`nonconformance-${editor.type}-form`} onSubmit={submit}>
          {editor.type === 'create' ? (
            <>
              <label>Severity<select value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
              <label>Discipline<input required minLength="2" maxLength="80" value={draft.discipline} onChange={(event) => setDraft({ ...draft, discipline: event.target.value })} placeholder="Quality, structural, MEP" /></label>
              <label className="form-span">NCR title<input autoFocus required minLength="3" maxLength="240" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Observed deviation from retained requirement" /></label>
              <label>Detected at<input required type="datetime-local" value={draft.detectedAt} onChange={(event) => setDraft({ ...draft, detectedAt: event.target.value })} /></label>
              <label>Raised by<input required minLength="2" maxLength="160" value={draft.raisedBy} onChange={(event) => setDraft({ ...draft, raisedBy: event.target.value })} /></label>
              <label className="form-span">Observed condition<textarea required minLength="4" maxLength="4000" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
              <label>Location<input maxLength="500" value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} /></label>
              <label>Corrective due date<input required type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label>
              <label className="form-span">Requirement reference<textarea required minLength="3" maxLength="500" value={draft.requirementReference} onChange={(event) => setDraft({ ...draft, requirementReference: event.target.value })} placeholder="Drawing, specification, approved sample, method, or acceptance criterion" /></label>
              <label className="form-span">Immediate containment<textarea required minLength="4" maxLength="4000" value={draft.immediateContainment} onChange={(event) => setDraft({ ...draft, immediateContainment: event.target.value })} /></label>
              <label>Responsible party<input required minLength="2" maxLength="160" value={draft.responsibleParty} onChange={(event) => setDraft({ ...draft, responsibleParty: event.target.value })} /></label>
              <label>Source inspection<select value={draft.sourceInspectionId} onChange={(event) => setDraft({ ...draft, sourceInspectionId: event.target.value })}><option value="">No source inspection</option>{(job.inspections || EMPTY_LIST).map((inspection) => <option key={inspection.id} value={inspection.id}>{inspection.title}</option>)}</select></label>
              <label>Source observation<select value={draft.sourceObservationId} onChange={(event) => setDraft({ ...draft, sourceObservationId: event.target.value })}><option value="">No source observation</option>{(job.observations || EMPTY_LIST).map((observation) => <option key={observation.id} value={observation.id}>{observation.title}</option>)}</select></label>
              <label>Evidence document<select value={draft.evidenceDocumentId} onChange={(event) => setDraft({ ...draft, evidenceDocumentId: event.target.value })}><option value="">No linked document</option>{(job.documents || EMPTY_LIST).map((document) => <option key={document.id} value={document.id}>{document.title || document.filename || document.id}</option>)}</select></label>
              <label className="form-span">Notes<textarea maxLength="2000" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
            </>
          ) : editor.type === 'correction' ? (
            <>
              <div className="form-span workflow-note"><strong>{editor.record.ncrNumber}</strong> / {editor.record.title}</div>
              <label className="form-span">Root cause<textarea autoFocus required minLength="4" maxLength="4000" value={draft.rootCause} onChange={(event) => setDraft({ ...draft, rootCause: event.target.value })} /></label>
              <label className="form-span">Corrective action<textarea required minLength="4" maxLength="4000" value={draft.correctiveAction} onChange={(event) => setDraft({ ...draft, correctiveAction: event.target.value })} /></label>
              <label>Responsible party<input required minLength="2" maxLength="160" value={draft.responsibleParty} onChange={(event) => setDraft({ ...draft, responsibleParty: event.target.value })} /></label>
              <label>Corrective due date<input required type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label>
              <label className="form-span">Evidence reference<input required minLength="3" maxLength="500" value={draft.evidenceReference} onChange={(event) => setDraft({ ...draft, evidenceReference: event.target.value })} placeholder="Method review, test plan, drawing, or retained internal reference" /></label>
              <label>Evidence document<select value={draft.evidenceDocumentId} onChange={(event) => setDraft({ ...draft, evidenceDocumentId: event.target.value })}><option value="">No linked document</option>{(job.documents || EMPTY_LIST).map((document) => <option key={document.id} value={document.id}>{document.title || document.filename || document.id}</option>)}</select></label>
              <label>Review notes<textarea maxLength="2000" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
            </>
          ) : (
            <>
              <div className="form-span workflow-note"><strong>{editor.record.ncrNumber}</strong> / approved correction: {editor.record.correctiveAction?.correctiveAction}</div>
              <label>Verification result<select value={draft.verificationResult} onChange={(event) => setDraft({ ...draft, verificationResult: event.target.value })}><option value="passed">Passed</option></select></label>
              <label>Verified at<input required type="datetime-local" value={draft.verifiedAt} onChange={(event) => setDraft({ ...draft, verifiedAt: event.target.value })} /></label>
              <label>Verified by<input required minLength="2" maxLength="160" value={draft.verifiedBy} onChange={(event) => setDraft({ ...draft, verifiedBy: event.target.value })} /></label>
              <label>Evidence document<select value={draft.evidenceDocumentId} onChange={(event) => setDraft({ ...draft, evidenceDocumentId: event.target.value })}><option value="">No linked document</option>{(job.documents || EMPTY_LIST).map((document) => <option key={document.id} value={document.id}>{document.title || document.filename || document.id}</option>)}</select></label>
              <label className="form-span">Verification evidence<input autoFocus required minLength="3" maxLength="500" value={draft.verificationEvidence} onChange={(event) => setDraft({ ...draft, verificationEvidence: event.target.value })} placeholder="Inspection, test, survey, or retained evidence reference" /></label>
              <label className="form-span">Verification notes<textarea maxLength="2000" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
            </>
          )}
          <p className="workflow-note form-span">NCR closure remains separate from inspection sign-off, client acceptance, contract completion, and external communication.</p>
          <div className="form-actions form-span">
            <button className="primary-button" disabled={submitting || createInvalid || correctionInvalid || closureInvalid || (editor.type !== 'create' && !online)}><ShieldCheck size={15} />{editor.type === 'create' ? (online ? 'Retain NCR' : 'Save NCR offline') : editor.type === 'correction' ? 'Request correction approval' : 'Request closure approval'}</button>
            <button type="button" className="secondary-button" onClick={() => setEditor(null)}>Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="field-risk-register">
        {records.length ? records.map((record) => {
          const approvalId = record.status === 'pending_closure_approval' ? record.closureApprovalId : record.correctionApprovalId
          const pending = (job.approvals || EMPTY_LIST).find((approval) => approval.id === approvalId && approval.status === 'pending')
          const correctionReady = ['open', 'correction_rejected'].includes(record.status)
          const closureReady = record.status === 'correction_approved'
          return (
            <article className={`field-risk-row field-risk-${record.severity}`} key={record.id} data-testid={`nonconformance-${record.id}`}>
              <div className="field-risk-row-copy">
                <div><strong>{record.ncrNumber} / {record.title}</strong><span className={`status status-${record.status}`}>{formatStatus(record.status)}</span></div>
                <small>{formatStatus(record.discipline)} / {formatStatus(record.severity)} / detected {formatDateTime(record.detectedAt)} / due {formatDate(record.correctiveAction?.dueAt || record.dueAt)}</small>
                <p>{record.description}</p>
                {record.correctiveAction ? <p><strong>Correction:</strong> {record.correctiveAction.correctiveAction}</p> : null}
                {record.closure ? <p><strong>Verified:</strong> {record.closure.verificationEvidence}</p> : null}
              </div>
              <div className="field-risk-row-actions">
                {pending ? <span className="tag tag-amber">Approval pending</span> : null}
                {pending && canApprove ? <button type="button" className="secondary-button" onClick={() => onOpenApprovals({ approvalId: pending.id })}><ShieldCheck size={14} />Review</button> : null}
                {!pending && canCoordinate && correctionReady ? <button type="button" className="secondary-button" disabled={submitting || !online} onClick={() => beginCorrection(record)}><ClipboardPenLine size={14} />Corrective action</button> : null}
                {!pending && canCoordinate && closureReady ? <button type="button" className="secondary-button" disabled={submitting || !online} onClick={() => beginClosure(record)}><BadgeCheck size={14} />Verify closure</button> : null}
              </div>
            </article>
          )
        }) : <p className="workflow-note">No nonconformance records are retained for this job.</p>}
      </div>
      {fieldScoped ? <p className="workflow-note">Assigned field workers can capture retained facts and containment. Corrective action and closure remain office and approver controlled.</p> : null}
    </section>
  )
}

function FieldRiskControl({
  job,
  canReport,
  canCoordinate,
  canApprove,
  fieldScoped,
  operator,
  submitting,
  onCreate,
  onReview,
  onOpenApprovals,
}) {
  const [view, setView] = useState('observation')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState(() => emptyFieldRiskDraft('observation'))
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  const observations = job.observations || EMPTY_LIST
  const incidents = job.incidents || EMPTY_LIST
  const records = view === 'incident' ? incidents : observations
  const activeStatuses = view === 'incident'
    ? new Set(['reported', 'under_review', 'escalated', 'pending_approval'])
    : new Set(['open', 'in_progress', 'pending_approval'])
  const openObservations = observations.filter((record) => ['open', 'in_progress', 'pending_approval'].includes(record.status)).length
  const openIncidents = incidents.filter((record) => ['reported', 'under_review', 'escalated', 'pending_approval'].includes(record.status)).length
  const highRiskOpen = [...observations, ...incidents].filter((record) =>
    ['high', 'critical'].includes(record.severity) && !['resolved', 'closed'].includes(record.status),
  ).length
  const pendingApprovals = (job.approvals || EMPTY_LIST).filter((approval) =>
    approval.status === 'pending' && ['observation_record', 'incident_record'].includes(approval.targetType),
  ).length

  useEffect(() => {
    setView('observation')
    setCreating(false)
    setDraft(emptyFieldRiskDraft('observation'))
  }, [job.id])

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const selectView = (nextView) => {
    setView(nextView)
    setCreating(false)
    setDraft(emptyFieldRiskDraft(nextView))
  }

  const beginCreate = () => {
    setDraft({
      ...emptyFieldRiskDraft(view),
      ...(view === 'incident' ? { reportedBy: operator?.name || '' } : { responsible: operator?.name || '' }),
    })
    setCreating(true)
  }

  async function submitRisk(event) {
    event.preventDefault()
    const result = await onCreate(view, draft)
    if (result) {
      setCreating(false)
      setDraft(emptyFieldRiskDraft(view))
    }
  }

  const openLifecycleReview = (record) => {
    const status = view === 'incident' && record.status === 'reported' ? 'under_review' : 'resolved'
    onReview(
      { jobId: job.id, jobTitle: job.title },
      {
        type: view,
        recordId: record.id,
        record,
        label: status === 'under_review' ? 'Start incident review' : `Resolve ${view}`,
        status,
      },
    )
  }

  return (
    <section className="job-workspace-section field-risk-control" data-testid="field-risk-control">
      <div className="section-heading field-risk-heading">
        <TriangleAlert size={18} />
        <div>
          <h3>Field risk register</h3>
          <p>Observed quality, safety, environmental, and access conditions with retained evidence and accountable review.</p>
        </div>
        {canReport ? <button type="button" className="secondary-button" disabled={submitting} onClick={beginCreate}><Plus size={15} />{view === 'incident' ? 'Report incident' : 'New observation'}</button> : null}
      </div>

      <div className="field-risk-summary" aria-label="Field risk summary">
        <div><span>Open observations</span><strong>{openObservations}</strong></div>
        <div><span>Open incidents</span><strong>{openIncidents}</strong></div>
        <div><span>High risk</span><strong>{highRiskOpen}</strong></div>
        <div><span>Pending review</span><strong>{pendingApprovals}</strong></div>
      </div>

      <div className="field-risk-tabs" role="tablist" aria-label="Field risk record type">
        <button type="button" role="tab" aria-selected={view === 'observation'} className={view === 'observation' ? 'active' : ''} onClick={() => selectView('observation')}>Observations <span>{observations.length}</span></button>
        <button type="button" role="tab" aria-selected={view === 'incident'} className={view === 'incident' ? 'active' : ''} onClick={() => selectView('incident')}>Incidents <span>{incidents.length}</span></button>
      </div>

      {creating ? (
        <form className="field-risk-form form-grid compact-form" data-testid={`field-${view}-form`} onSubmit={submitRisk}>
          {view === 'observation' ? (
            <>
              <label>Category<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}><option value="quality">Quality</option><option value="safety">Safety</option><option value="environmental">Environmental</option><option value="access">Access</option><option value="coordination">Coordination</option></select></label>
              <label>Severity<select value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
              <label className="form-span">Observation title<input autoFocus required minLength="3" maxLength="240" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Observed condition or deviation" /></label>
              <label>Responsible person<input required minLength="2" maxLength="160" value={draft.responsible} onChange={(event) => setDraft({ ...draft, responsible: event.target.value })} /></label>
              <label>Corrective due date<input required type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label>
              <label className="form-span">Observed facts<textarea required minLength="4" maxLength="4000" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Location, condition, and direct observations" /></label>
              <label className="form-span">Immediate control or corrective action<textarea maxLength="4000" value={draft.correctiveAction} onChange={(event) => setDraft({ ...draft, correctiveAction: event.target.value })} /></label>
            </>
          ) : (
            <>
              <label>Incident type<select value={draft.incidentType} onChange={(event) => setDraft({ ...draft, incidentType: event.target.value })}><option value="near_miss">Near miss</option><option value="injury">Injury</option><option value="property_damage">Property damage</option><option value="environmental">Environmental</option><option value="security">Security</option><option value="unsafe_condition">Unsafe condition</option></select></label>
              <label>Severity<select value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
              <label className="form-span">Incident title<input autoFocus required minLength="3" maxLength="240" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Concise factual incident title" /></label>
              <label>Occurred at<input required type="datetime-local" value={draft.occurredAt} onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })} /></label>
              <label>Reported by<input required minLength="2" maxLength="160" value={draft.reportedBy} onChange={(event) => setDraft({ ...draft, reportedBy: event.target.value })} /></label>
              <label className="form-span">Incident facts<textarea required minLength="4" maxLength="4000" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="What happened, where, and what was directly observed" /></label>
              <label className="form-span">Immediate action<textarea required minLength="4" maxLength="4000" value={draft.immediateAction} onChange={(event) => setDraft({ ...draft, immediateAction: event.target.value })} placeholder="Isolation, stop-work, first aid, or other action already taken" /></label>
              <label>Corrective action<textarea maxLength="4000" value={draft.correctiveAction} onChange={(event) => setDraft({ ...draft, correctiveAction: event.target.value })} /></label>
              <label>Witnesses<textarea maxLength="2000" value={draft.witnesses} onChange={(event) => setDraft({ ...draft, witnesses: event.target.value })} placeholder="One name per line" /></label>
              <label className="checkbox-label form-span"><input type="checkbox" checked={draft.reportable} onChange={(event) => setDraft({ ...draft, reportable: event.target.checked })} />Potentially reportable; requires specialist review</label>
            </>
          )}
          <label className="form-span">Linked evidence<select value={draft.evidenceDocumentId} onChange={(event) => setDraft({ ...draft, evidenceDocumentId: event.target.value })}><option value="">No linked document</option>{(job.documents || EMPTY_LIST).map((document) => <option value={document.id} key={document.id}>{document.title || document.filename || document.id}</option>)}</select></label>
          <p className="workflow-note form-span">This retains an internal report and review gate only. It does not notify external parties, clear a hazard, authorize work, or make a statutory filing.</p>
          <div className="form-actions form-span"><button className="primary-button" disabled={submitting || draft.title.trim().length < 3 || (view === 'observation' ? draft.notes.trim().length < 4 || draft.responsible.trim().length < 2 : draft.description.trim().length < 4 || draft.immediateAction.trim().length < 4 || draft.reportedBy.trim().length < 2 || !toIsoDateTime(draft.occurredAt))}><ShieldCheck size={15} />{online ? (view === 'incident' ? 'Retain incident' : 'Retain observation') : view === 'incident' ? 'Save incident offline' : 'Save observation offline'}</button><button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      ) : null}

      <div className="field-risk-register">
        {records.length ? records.map((record) => {
          const pending = (job.approvals || EMPTY_LIST).find((approval) => approval.id === record.approvalId && approval.status === 'pending')
          const detail = view === 'incident' ? record.data?.description : record.data?.notes
          return (
            <article className={`field-risk-row field-risk-${record.severity}`} key={record.id} data-testid={`field-risk-${record.id}`}>
              <div className="field-risk-row-copy"><div><strong>{record.title}</strong><span className={`status status-${record.status}`}>{formatStatus(record.status)}</span></div><small>{formatStatus(view === 'incident' ? record.incidentType : record.category)} / {formatStatus(record.severity)} / {view === 'incident' ? formatDateTime(record.occurredAt) : `due ${formatDate(record.dueAt)}`}</small>{detail ? <p>{detail}</p> : null}</div>
              <div className="field-risk-row-actions">
                {pending ? <span className="tag tag-amber">Approval pending</span> : null}
                {pending && canApprove ? <button type="button" className="secondary-button" onClick={() => onOpenApprovals({ approvalId: pending.id })}><ShieldCheck size={14} />Review</button> : null}
                {!pending && canCoordinate && activeStatuses.has(record.status) ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => openLifecycleReview(record)}><ClipboardCheck size={14} />{view === 'incident' && record.status === 'reported' ? 'Start review' : 'Resolve'}</button> : null}
              </div>
            </article>
          )
        }) : <p className="workflow-note">No {view === 'incident' ? 'incident' : 'observation'} records are retained for this job.</p>}
      </div>
      {fieldScoped ? <p className="workflow-note">Assigned field workers can report observed facts. Resolution and approval remain office-controlled.</p> : null}
    </section>
  )
}

function CloseoutRegister({
  job,
  locale,
  canReportPunch,
  canCoordinate,
  canApprove,
  fieldScoped,
  operator,
  submitting,
  onCreate,
  onLifecycle,
  onOpenApprovals,
}) {
  const t = (key, variables = {}) => operatorText(locale, key, variables)
  const [view, setView] = useState('punch_item')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState(() => emptyCloseoutDraft('punch_item'))
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  const punchItems = job.punchItems || EMPTY_LIST
  const warrantyClaims = job.warrantyClaims || EMPTY_LIST
  const aftercare = job.aftercare || EMPTY_LIST
  const clientFeedback = job.clientFeedback || EMPTY_LIST
  const visibleViews = fieldScoped
    ? [{ key: 'punch_item', label: t('Punch'), count: punchItems.length }]
    : [
        { key: 'punch_item', label: t('Punch'), count: punchItems.length },
        { key: 'warranty_claim', label: t('Warranty'), count: warrantyClaims.length },
        { key: 'aftercare', label: t('Aftercare'), count: aftercare.length },
        { key: 'client_feedback', label: t('Feedback'), count: clientFeedback.length },
      ]
  const records = view === 'warranty_claim'
    ? warrantyClaims
    : view === 'aftercare'
      ? aftercare
      : view === 'client_feedback'
        ? clientFeedback
        : punchItems
  const canCreate = view === 'punch_item' ? canReportPunch : canCoordinate
  const activeStatuses = view === 'punch_item'
    ? new Set(['open', 'in_progress', 'pending_approval'])
    : view === 'warranty_claim'
      ? new Set(['open', 'under_review', 'pending_approval'])
      : view === 'aftercare'
        ? new Set(['open', 'planned', 'due'])
        : new Set()
  const openPunch = punchItems.filter((record) => !['closed', 'resolved', 'accepted', 'verified'].includes(record.status)).length
  const openWarranty = warrantyClaims.filter((record) => !['closed', 'resolved', 'accepted', 'rejected'].includes(record.status)).length
  const openAftercare = aftercare.filter((record) => !['completed', 'closed', 'cancelled'].includes(record.status)).length
  const feedbackRecoveryFor = (record) => aftercare.find((item) =>
    item.data?.feedbackRecovery === true && item.data?.feedbackId === record.id,
  ) || null
  const recoveryRequired = clientFeedback.filter((record) => {
    if (!record.followUpRequired) return false
    const recovery = feedbackRecoveryFor(record)
    return !recovery || !['completed', 'closed', 'cancelled'].includes(recovery.status)
  }).length
  const pendingReview = (job.approvals || EMPTY_LIST).filter((approval) =>
    approval.status === 'pending' && ['punch_item', 'warranty_claim'].includes(approval.targetType),
  ).length

  useEffect(() => {
    setView('punch_item')
    setCreating(false)
    setDraft(emptyCloseoutDraft('punch_item'))
  }, [job.id])

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const selectView = (nextView) => {
    setView(nextView)
    setCreating(false)
    setDraft(emptyCloseoutDraft(nextView))
  }

  const beginCreate = () => {
    setDraft({
      ...emptyCloseoutDraft(view),
      ...(view === 'punch_item'
        ? { assignee: operator?.name || '' }
        : view === 'aftercare'
          ? { owner: operator?.name || '' }
          : {}),
    })
    setCreating(true)
  }

  async function submitRecord(event) {
    event.preventDefault()
    const result = await onCreate(view, draft)
    if (result) {
      setCreating(false)
      setDraft(emptyCloseoutDraft(view))
    }
  }

  const invalidDraft = view === 'client_feedback'
    ? draft.evidenceReference.trim().length < 4
      || !Number.isInteger(draft.npsScore)
      || draft.npsScore < 0
      || draft.npsScore > 10
      || !Number.isInteger(draft.csatScore)
      || draft.csatScore < 1
      || draft.csatScore > 5
      || !Number.isInteger(draft.effortScore)
      || draft.effortScore < 1
      || draft.effortScore > 5
    : draft.title.trim().length < 3
      || (view === 'punch_item' && (draft.description.trim().length < 4 || draft.assignee.trim().length < 2))
      || (view === 'warranty_claim' && draft.issue.trim().length < 4)
      || (view === 'aftercare' && (draft.notes.trim().length < 4 || draft.owner.trim().length < 2))

  return (
    <section className="job-workspace-section closeout-register" data-testid="closeout-register">
      <div className="section-heading closeout-register-heading">
        <PackageCheck size={18} />
        <div>
          <h3>{t('Closeout and aftercare')}</h3>
          <p>{t('Retain defects, warranty issues, and follow-up work without asserting acceptance or contacting the client.')}</p>
        </div>
        {canCreate ? <button type="button" className="secondary-button" disabled={submitting} onClick={beginCreate}><Plus size={15} />{view === 'punch_item' ? t('New punch item') : view === 'warranty_claim' ? t('New warranty claim') : view === 'aftercare' ? t('New follow-up') : t('Record feedback')}</button> : null}
      </div>

      <div className="closeout-summary" aria-label={t('Closeout summary')}>
        <div><span>{t('Open punch')}</span><strong>{openPunch}</strong></div>
        <div><span>{t('Warranty')}</span><strong>{openWarranty}</strong></div>
        <div><span>{t('Aftercare')}</span><strong>{openAftercare}</strong></div>
        <div><span>{t('Feedback recovery')}</span><strong>{recoveryRequired}</strong></div>
        <div><span>{t('Pending review')}</span><strong>{pendingReview}</strong></div>
      </div>

      <div className={`closeout-tabs ${visibleViews.length === 1 ? 'single-tab' : ''}`} role="tablist" aria-label={t('Closeout record type')}>
        {visibleViews.map((option) => (
          <button type="button" role="tab" aria-selected={view === option.key} className={view === option.key ? 'active' : ''} key={option.key} onClick={() => selectView(option.key)}>{option.label} <span>{option.count}</span></button>
        ))}
      </div>

      {creating ? (
        <form className="closeout-form form-grid compact-form" data-testid={`closeout-${view}-form`} onSubmit={submitRecord}>
          {view === 'punch_item' ? (
            <>
              <label>{t('Severity')}<select value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value })}><option value="low">{t('Low')}</option><option value="medium">{t('Medium')}</option><option value="high">{t('High')}</option><option value="critical">{t('Critical')}</option></select></label>
              <label>{t('Corrective due date')}<input required type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label>
              <label className="form-span">{t('Punch title')}<input autoFocus required minLength="3" maxLength="240" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={t('Incomplete, defective, or unverified work')} /></label>
              <label>{t('Assigned to')}<input required minLength="2" maxLength="160" value={draft.assignee} onChange={(event) => setDraft({ ...draft, assignee: event.target.value })} /></label>
              <label>{t('Location')}<input maxLength="240" value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} placeholder={t('Room, elevation, grid, or asset')} /></label>
              <label className="form-span">{t('Observed condition')}<textarea required minLength="4" maxLength="4000" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder={t('Record the condition and completion criteria without assuming correction.')} /></label>
              <label className="form-span">{t('Linked evidence')}<select value={draft.evidenceDocumentId} onChange={(event) => setDraft({ ...draft, evidenceDocumentId: event.target.value })}><option value="">{t('No linked document')}</option>{(job.documents || EMPTY_LIST).map((document) => <option value={document.id} key={document.id}>{document.title || document.filename || document.id}</option>)}</select></label>
              {canCoordinate ? <label className="checkbox-label form-span"><input type="checkbox" checked={draft.clientVisible} onChange={(event) => setDraft({ ...draft, clientVisible: event.target.checked })} />{t('Prepare for client-visible review; approval remains required')}</label> : null}
            </>
          ) : view === 'warranty_claim' ? (
            <>
              <label>{t('Warranty type')}<select value={draft.warrantyType} onChange={(event) => setDraft({ ...draft, warrantyType: event.target.value })}><option value="workmanship">{t('Workmanship')}</option><option value="material">{t('Material')}</option><option value="manufacturer">{t('Manufacturer')}</option><option value="service">{t('Service')}</option><option value="other">{t('Other')}</option></select></label>
              <label>{t('Severity')}<select value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value })}><option value="low">{t('Low')}</option><option value="medium">{t('Medium')}</option><option value="high">{t('High')}</option><option value="critical">{t('Critical')}</option></select></label>
              <label className="form-span">{t('Claim title')}<input autoFocus required minLength="3" maxLength="240" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={t('Reported post-completion issue')} /></label>
              <label>{t('Review due date')}<input required type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label>
              <label className="form-span">{t('Reported issue')}<textarea required minLength="4" maxLength="4000" value={draft.issue} onChange={(event) => setDraft({ ...draft, issue: event.target.value })} placeholder={t('Retain the reported facts without admitting liability or promising a remedy.')} /></label>
            </>
          ) : view === 'aftercare' ? (
            <>
              <label>{t('Follow-up type')}<select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}><option value="client_follow_up">{t('Client follow-up')}</option><option value="warranty_review">{t('Warranty review')}</option><option value="maintenance_review">{t('Maintenance review')}</option><option value="quality_check">{t('Quality check')}</option></select></label>
              <label>{t('Channel')}<select value={draft.channel} onChange={(event) => setDraft({ ...draft, channel: event.target.value })}><option value="portal">{t('Portal')}</option><option value="phone">{t('Phone')}</option><option value="email">{t('Email')}</option><option value="site_visit">{t('Site visit')}</option></select></label>
              <label className="form-span">{t('Follow-up title')}<input autoFocus required minLength="3" maxLength="240" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={t('Internal follow-up action')} /></label>
              <label>{t('Owner')}<input required minLength="2" maxLength="160" value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} /></label>
              <label>{t('Due date')}<input required type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label>
              <label className="form-span">{t('Follow-up purpose')}<textarea required minLength="4" maxLength="4000" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder={t('What should be checked and what evidence should be retained?')} /></label>
            </>
          ) : (
            <>
              <label>{t('Survey point')}<select value={draft.surveyType} onChange={(event) => setDraft({ ...draft, surveyType: event.target.value })}><option value="project_experience">{t('Project experience')}</option><option value="handover">{t('Handover')}</option><option value="aftercare">{t('Aftercare')}</option><option value="warranty">{t('Warranty')}</option></select></label>
              <label>{t('Respondent')}<input maxLength="160" value={draft.respondentName} onChange={(event) => setDraft({ ...draft, respondentName: event.target.value })} placeholder={t('Optional name')} /></label>
              <label>{t('NPS (0-10)')}<input required type="number" min="0" max="10" step="1" value={draft.npsScore} onChange={(event) => setDraft({ ...draft, npsScore: event.target.value === '' ? '' : Number(event.target.value) })} /></label>
              <label>{t('Satisfaction (1-5)')}<input required type="number" min="1" max="5" step="1" value={draft.csatScore} onChange={(event) => setDraft({ ...draft, csatScore: event.target.value === '' ? '' : Number(event.target.value) })} /></label>
              <label>{t('Ease (1-5)')}<input required type="number" min="1" max="5" step="1" value={draft.effortScore} onChange={(event) => setDraft({ ...draft, effortScore: event.target.value === '' ? '' : Number(event.target.value) })} /></label>
              <label className="form-span">{t('Evidence reference')}<input autoFocus required minLength="4" maxLength="500" value={draft.evidenceReference} onChange={(event) => setDraft({ ...draft, evidenceReference: event.target.value })} placeholder={t('Call note, signed survey, message, or import reference')} /></label>
              <label className="form-span">{t('Client comment')}<textarea maxLength="4000" value={draft.comment} onChange={(event) => setDraft({ ...draft, comment: event.target.value })} placeholder={t("Retain the client's words without adding inferred sentiment.")} /></label>
              <label className="checkbox-label form-span"><input type="checkbox" checked={draft.followUpConsent} onChange={(event) => setDraft({ ...draft, followUpConsent: event.target.checked })} />{t('Client consented to feedback follow-up')}</label>
              <label className="checkbox-label form-span"><input type="checkbox" checked={draft.testimonialConsent} onChange={(event) => setDraft({ ...draft, testimonialConsent: event.target.checked })} />{t('Client consented to internal testimonial review; publication still requires separate coordination')}</label>
            </>
          )}
          <p className="workflow-note form-span">{t('This retains an internal record only. It does not certify completion, accept liability, authorize cost, book work, or contact the client.')}</p>
          <div className="form-actions form-span">
            <button className="primary-button" disabled={submitting || invalidDraft || (view !== 'punch_item' && !online)}><ClipboardCheck size={15} />{view === 'punch_item' && !online ? t('Save punch item offline') : view !== 'punch_item' && !online ? t('Reconnect to retain') : view === 'punch_item' ? t('Retain punch item') : view === 'warranty_claim' ? t('Retain warranty claim') : view === 'aftercare' ? t('Retain follow-up') : t('Retain feedback')}</button>
            <button type="button" className="secondary-button" onClick={() => setCreating(false)}>{t('Cancel')}</button>
          </div>
        </form>
      ) : null}

      <div className="closeout-records">
        {records.length ? records.map((record) => {
          const pending = (job.approvals || EMPTY_LIST).find((approval) => approval.id === record.approvalId && approval.status === 'pending')
          const feedbackRecovery = view === 'client_feedback' ? feedbackRecoveryFor(record) : null
          const feedbackRecoveryLabel = !record.followUpRequired
            ? null
            : !feedbackRecovery
              ? t('Internal recovery required')
              : ['completed', 'closed'].includes(feedbackRecovery.status)
                ? t('Recovery completed')
                : feedbackRecovery.status === 'cancelled'
                  ? t('Recovery closed')
                  : t('Recovery in progress')
          const feedbackRecoveryClass = !feedbackRecovery
            ? 'tag-amber'
            : ['completed', 'closed'].includes(feedbackRecovery.status)
              ? 'tag-green'
              : feedbackRecovery.status === 'cancelled'
                ? 'tag-amber'
                : 'tag-blue'
          const detail = view === 'punch_item'
            ? record.data?.description
            : view === 'warranty_claim'
              ? record.data?.issue
              : view === 'aftercare'
                ? record.notes
                : record.comment
          const meta = view === 'punch_item'
            ? t('{severity} / {assignee} / due {date}', { severity: t(formatStatus(record.severity)), assignee: record.assignee || t('Unassigned'), date: formatDate(record.dueAt) })
            : view === 'warranty_claim'
              ? t('{type} / {severity} / due {date}', { type: t(formatStatus(record.data?.warrantyType || 'workmanship')), severity: t(formatStatus(record.severity)), date: formatDate(record.dueAt) })
              : view === 'aftercare'
                ? t('{type} / {owner} / due {date}', { type: t(formatStatus(record.type)), owner: record.owner || t('Unassigned'), date: formatDate(record.dueAt) })
                : t('NPS {nps}/10 / satisfaction {csat}/5 / ease {effort}/5 / {date}', { nps: record.npsScore, csat: record.csatScore, effort: record.effortScore, date: formatDate(record.submittedAt) })
          const title = view === 'client_feedback'
            ? record.respondentName
              ? t('{type} feedback from {respondent}', { type: t(formatStatus(record.surveyType)), respondent: record.respondentName })
              : t('{type} feedback', { type: t(formatStatus(record.surveyType)) })
            : record.title
          return (
            <article className={`closeout-row ${!['aftercare', 'client_feedback'].includes(view) ? `closeout-${record.severity}` : ''}`} key={record.id} data-testid={`closeout-${record.id}`}>
              <div className="closeout-row-copy"><div><strong>{title}</strong><span className={`status status-${record.status}`}>{t(formatStatus(record.status))}</span></div><small>{meta}</small>{detail ? <p>{detail}</p> : null}{view === 'client_feedback' && feedbackRecoveryLabel ? <span className={`tag ${feedbackRecoveryClass}`}>{feedbackRecoveryLabel}</span> : null}</div>
              <div className="closeout-row-actions">
                {pending ? <span className="tag tag-amber">{t('Approval pending')}</span> : null}
                {pending && canApprove ? <button type="button" className="secondary-button" onClick={() => onOpenApprovals({ approvalId: pending.id })}><ShieldCheck size={14} />{t('Review')}</button> : null}
                {!pending && canCoordinate && activeStatuses.has(record.status) ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => onLifecycle(view, record)}><ClipboardCheck size={14} />{view === 'punch_item' ? t('Resolve punch') : view === 'warranty_claim' ? t('Resolve claim') : t('Complete follow-up')}</button> : null}
              </div>
            </article>
          )
        }) : <p className="workflow-note">{view === 'punch_item'
          ? t('No punch items are retained for this job.')
          : view === 'warranty_claim'
            ? t('No warranty claims are retained for this job.')
            : view === 'aftercare'
              ? t('No aftercare follow-ups are retained for this job.')
              : t('No client feedback is retained for this job.')}</p>}
      </div>
      {fieldScoped ? <p className="workflow-note">{t('Assigned field workers can capture punch evidence. Resolution, acceptance, and client visibility remain office-controlled.')}</p> : null}
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
        <div>
          <span>Production risk</span>
          <strong>{summary.productionAtRisk || 0}</strong>
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
                        (item.counts?.openNonconformances || 0) +
                        (item.counts?.openObservations || 0) +
                        (item.counts?.qualityOpen || 0) +
                        (item.counts?.punchOpen || 0)}
                    </strong>
                  </span>
                  <span>
                    Evidence <strong>{item.counts?.evidenceRecords || 0}</strong>
                  </span>
                  <span>
                    Production{' '}
                    <strong>
                      {item.production?.summary?.performanceFactor == null
                        ? item.production?.activeBaseline ? 'ready' : 'no baseline'
                        : `${roundDisplay(item.production.summary.performanceFactor)} factor`}
                    </strong>
                  </span>
                </div>
                <div className="assurance-flags">
                  {item.counts?.pendingApprovals ? (
                    <span className="tag tag-amber">
                      {item.counts.pendingApprovals} approval{item.counts.pendingApprovals === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  {item.flags?.safetyGap ? <span className="tag tag-amber">Safety pack missing</span> : null}
                  {item.flags?.productionAtRisk ? <span className="tag tag-amber">Production variance</span> : null}
                  {item.flags?.productionBaselineMissing ? <span className="tag">Production baseline missing</span> : null}
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
  loading,
  error,
  view,
  selectedIds,
  submitting,
  onViewChange,
  onToggle,
  onSelectVisible,
  onApply,
  onRun,
  onRetry,
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
            disabled={submitting || loading || !visibleSafeIds.length}
            onClick={() => onSelectVisible(allVisibleSafeSelected ? [] : visibleSafeIds)}
          >
            {allVisibleSafeSelected ? <X size={15} /> : <Check size={15} />}
            {allVisibleSafeSelected ? 'Clear visible' : 'Select safe'}
          </button>
          <button className="primary-button" disabled={submitting || loading || !selectedIds.length} onClick={onApply}>
            <ClipboardCheck size={16} />
            {selectedIds.length ? `Apply ${selectedIds.length} draft${selectedIds.length === 1 ? '' : 's'}` : 'Apply selected'}
          </button>
          <button className="secondary-button" disabled={submitting || loading || schedulerJob?.status === 'running'} onClick={onRun}>
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
        {loading && !commandPlan ? (
          <div className="loading" role="status">
            <LoaderCircle className="spin" size={22} />
            Preparing the bounded command plan
          </div>
        ) : null}
        {error && !commandPlan ? (
          <div className="audit-history-error" role="alert">
            <TriangleAlert size={16} />
            <span>{error}</span>
            <button className="secondary-button" onClick={onRetry}>Retry</button>
          </div>
        ) : null}
        {actions.map((action) => {
          const job =
            jobs.find((candidate) => candidate.id === action.jobId) ||
            (action.jobId ? { id: action.jobId, title: action.jobTitle || 'Ledger job' } : null)
          const selectable = action.safeDraftable && !action.blocked
          return (
            <article className="automation-item" key={action.id} data-action-id={action.id} data-job-id={action.jobId || ''}>
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
        {!loading && !error && !actions.length ? (
          <Empty title="No matching automation work" detail="The selected command-plan view has no retained action waiting." />
        ) : null}
      </div>
    </section>
  )
}

function CapabilitySetupControl({ job, canCoordinate, submitting, onApply }) {
  const missingRequirements = useMemo(() => {
    const byKey = new Map()
    for (const capability of job.capabilities || EMPTY_LIST) {
      for (const requirement of capability.requirements || EMPTY_LIST) {
        if (requirement.covered || requirement.automationPolicy === 'informational') continue
        const current = byKey.get(requirement.key)
        if (current) {
          current.capabilityLabels.push(capability.label)
          continue
        }
        byKey.set(requirement.key, {
          ...requirement,
          capabilityLabels: [capability.label],
        })
      }
    }
    return [...byKey.values()]
  }, [job.capabilities])
  const safeGaps = missingRequirements.filter((requirement) => requirement.safeDraftable)
  const manualGaps = missingRequirements.filter((requirement) => !requirement.safeDraftable)
  const safeKeySignature = safeGaps.map((requirement) => requirement.key).join('|')
  const [selectedKeys, setSelectedKeys] = useState([])

  useEffect(() => {
    const available = new Set(safeKeySignature.split('|').filter(Boolean))
    setSelectedKeys((current) => current.filter((key) => available.has(key)))
  }, [job.id, safeKeySignature])

  function toggleRequirement(requirementKey) {
    setSelectedKeys((current) =>
      current.includes(requirementKey)
        ? current.filter((key) => key !== requirementKey)
        : [...current, requirementKey],
    )
  }

  async function applySelected() {
    if (!selectedKeys.length) return
    const result = await onApply(selectedKeys)
    if (result) setSelectedKeys([])
  }

  return (
    <section className="job-workspace-section capability-setup-control" data-testid="capability-setup-control">
      <div className="section-heading capability-setup-heading">
        <Gauge size={18} />
        <div>
          <h3>Job setup coverage</h3>
          <p>Prepare internal setup records while observed facts and commitments stay operator-controlled.</p>
        </div>
        {canCoordinate && safeGaps.length ? (
          <button
            type="button"
            className="secondary-button"
            disabled={submitting}
            onClick={() => setSelectedKeys(selectedKeys.length === safeGaps.length ? [] : safeGaps.map((requirement) => requirement.key))}
          >
            <Check size={15} />
            {selectedKeys.length === safeGaps.length ? 'Clear selection' : 'Select safe drafts'}
          </button>
        ) : null}
      </div>

      <div className="capability-setup-metrics" aria-label="Job setup coverage summary">
        <div>
          <span>Coverage</span>
          <strong>{job.capabilitySummary?.averageCoverage || 0}%</strong>
        </div>
        <div>
          <span>Ready groups</span>
          <strong>{job.capabilitySummary?.ready || 0} / {job.capabilities?.length || 0}</strong>
        </div>
        <div>
          <span>Safe drafts</span>
          <strong>{safeGaps.length}</strong>
        </div>
        <div>
          <span>Manual gaps</span>
          <strong>{manualGaps.length}</strong>
        </div>
      </div>

      {safeGaps.length ? (
        <fieldset className="capability-safe-drafts">
          <legend>Internal setup drafts</legend>
          {safeGaps.map((requirement) => (
            <label className="capability-gap-option" key={requirement.key}>
              <input
                type="checkbox"
                checked={selectedKeys.includes(requirement.key)}
                disabled={!canCoordinate || submitting}
                onChange={() => toggleRequirement(requirement.key)}
              />
              <span>
                <strong>{requirement.label}</strong>
                <small>{requirement.capabilityLabels.join(' / ')}</small>
              </span>
              <span className="tag tag-green">Draft only</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="workflow-note" data-testid="capability-safe-complete">
          All eligible internal setup scaffolds are retained for this job.
        </p>
      )}

      {canCoordinate && safeGaps.length ? (
        <div className="capability-setup-actions">
          <span>{selectedKeys.length} selected</span>
          <button
            type="button"
            className="primary-button"
            data-testid="apply-capability-setup"
            disabled={submitting || !selectedKeys.length}
            onClick={applySelected}
          >
            <ClipboardList size={15} />
            {submitting ? 'Retaining...' : 'Retain selected drafts'}
          </button>
        </div>
      ) : null}

      {manualGaps.length ? (
        <details className="capability-manual-gaps">
          <summary>
            <LockKeyhole size={15} />
            Manual evidence and commitments ({manualGaps.length})
          </summary>
          <div>
            {manualGaps.map((requirement) => (
              <article key={requirement.key} data-testid={`manual-capability-${requirement.key}`}>
                <span>
                  <strong>{requirement.label}</strong>
                  <small>{requirement.automationReason}</small>
                </span>
                <span className="tag">{requirement.automationPolicy === 'manual_commitment' ? 'Verify commitment' : 'Source evidence'}</span>
              </article>
            ))}
          </div>
        </details>
      ) : null}
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

export { AutomationControl, CapabilitySetupControl, ClientsWorkspace, ClientSuccessWorkspace, CloseoutRegister, CommercialControl, DayworkControl, FieldAssuranceWorkspace, FieldRiskControl, InspectionChecklistControl, NonconformanceControl, PhotoEvidenceControl, ProductionControl, ProjectControls, TakeoffControl, WorkPlanControl }
