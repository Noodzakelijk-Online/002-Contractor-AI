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
  formatDate,
  formatDateTime,
  formatStatus,
  futureDateInput,
  roundDisplay,
  toIsoDateTime,
  toLocalDateTimeInput,
} from '../dashboard-format'
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

function takeoffMeasurementSummary(item = {}) {
  const dimensions = []
  if (item.measurementType !== 'manual') dimensions.push(`${item.count || 0}x`)
  if (['linear', 'area', 'volume'].includes(item.measurementType)) dimensions.push(`${item.length || 0} m`)
  if (['area', 'volume'].includes(item.measurementType)) dimensions.push(`x ${item.width || 0} m`)
  if (item.measurementType === 'volume') dimensions.push(`x ${item.height || 0} m`)
  if (item.wastePercent) dimensions.push(`+ ${item.wastePercent}% waste`)
  return dimensions.length ? dimensions.join(' ') : 'Manual retained quantity'
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
  try {
    return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: currencyCode }).format(Number(value || 0))
  } catch {
    return `${currencyCode} ${Number(value || 0).toFixed(2)}`
  }
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
          <h3>WBS & quantity takeoff</h3>
          <p>Structure work packages, measure retained scope, and convert one sealed basis into the approval-gated estimate workflow.</p>
        </div>
        {canCoordinate ? (
          <button type="button" className="secondary-button" disabled={submitting} onClick={onNewTakeoff}>
            <Plus size={15} />
            New takeoff
          </button>
        ) : null}
      </div>
      <div className={`estimate-rate-policy-strip ${activeRatePolicy ? 'rate-policy-active' : 'rate-policy-missing'}`} data-testid="estimate-rate-policy-control">
        <Calculator size={17} />
        <div>
          <strong>{activeRatePolicy ? `${activeRatePolicy.policyName} / v${activeRatePolicy.versionNumber}` : 'Estimating rate policy required'}</strong>
          <span>
            {activeRatePolicy
              ? `${activeRatePolicy.derived?.labourClasses?.length || 0} labour class(es) / ${activeRatePolicy.derived?.overheadMethod === 'labor_hour' ? `${rateMoney(activeRatePolicy.derived?.overheadPerLabourHour, activeRatePolicy.currency)} overhead per labour hour` : `${activeRatePolicy.derived?.directCostPercent || 0}% direct-cost overhead`} / ${activeRatePolicy.snapshot?.targetMarginPercent || 0}% target margin`
              : 'No governed labour-burden and overhead basis is active.'}
          </span>
        </div>
        {pendingRatePolicies.length ? <span className="tag tag-amber">{pendingRatePolicies.length} pending approval</span> : null}
        {canManagePolicy ? (
          <button type="button" className="secondary-button" disabled={submitting || pendingRatePolicies.length > 0} onClick={openRatePolicyEditor}>
            <Pencil size={14} />
            {activeRatePolicy ? 'Revise rates' : 'Configure rates'}
          </button>
        ) : null}
      </div>
      <div className={`takeoff-pricing-basis-strip ${pricingBasisReady ? 'pricing-basis-active' : 'pricing-basis-missing'}`} data-testid="takeoff-pricing-basis">
        <GitBranch size={17} />
        <div>
          <strong>{pricingBasisReady ? pricingModelLabel(currentPricingBasis.selectedModel) : job.pricingBasis?.stale ? 'Pricing basis is stale' : 'Pricing basis required'}</strong>
          <span>
            {pricingBasisReady
              ? `Decision v${currentPricingBasis.versionNumber} / ${currentPricingBasis.score}% fixed-price readiness / ${currentPricingBasis.snapshot?.override ? 'operator override retained' : 'recommendation followed'}`
              : 'Estimate approval remains blocked until current scope and estimate evidence have been assessed.'}
          </span>
        </div>
        {pricingBasisReady ? <span className="tag tag-green">Source current</span> : <span className="tag tag-amber">Action required</span>}
      </div>
      <div className="takeoff-summary" aria-label="Quantity takeoff summary">
        <div><span>Sheets</span><strong>{takeoffs.length}</strong></div>
        <div><span>Work packages</span><strong>{packageCount}</strong></div>
        <div><span>Drafts</span><strong>{draftCount}</strong></div>
        <div><span>Converted</span><strong>{convertedCount}</strong></div>
        <div><span>Draft sell value</span><strong>{currency.format(draftValue)}</strong></div>
      </div>
      {takeoffs.length ? (
        <div className="takeoff-register">
          {takeoffs.map((takeoff) => (
            <article className="takeoff-sheet" key={takeoff.id} data-testid={`takeoff-sheet-${takeoff.id}`}>
              <div className="takeoff-sheet-heading">
                <div>
                  <div className="takeoff-sheet-title">
                    <strong>{takeoff.title}</strong>
                    <span className={`status status-${takeoff.status}`}>{formatStatus(takeoff.status)}</span>
                    {takeoff.status === 'converted' ? (
                      <span className={`tag ${takeoff.integrityValid ? 'tag-green' : 'tag-red'}`}>
                        {takeoff.integrityValid ? 'Snapshot verified' : 'Integrity failed'}
                      </span>
                    ) : null}
                  </div>
                  <small>
                    {takeoff.workBreakdown?.packageCount || 0} work package{takeoff.workBreakdown?.packageCount === 1 ? '' : 's'} / {takeoff.itemCount || 0} measurement{takeoff.itemCount === 1 ? '' : 's'} / VAT {takeoff.taxRate || 0}%
                    {takeoff.quoteId ? ` / estimate ${takeoff.quoteId}` : ''}
                  </small>
                </div>
                {canCoordinate && takeoff.status === 'draft' ? (
                  <div className="takeoff-sheet-actions">
                    <button type="button" className="secondary-button" disabled={submitting || takeoff.itemCount >= 50} onClick={() => onAddItem(takeoff)}>
                      <Plus size={14} />
                      Measurement
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={submitting || !takeoff.itemCount || takeoff.subtotal <= 0 || !pricingBasisReady}
                      title={pricingBasisReady ? `Prepare a ${pricingModelLabel(currentPricingBasis.selectedModel).toLowerCase()} estimate` : 'A current pricing-basis decision is required'}
                      onClick={() => onConvert(takeoff)}
                    >
                      <ArrowUpRight size={14} />
                      Prepare estimate
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="takeoff-values" aria-label={`${takeoff.title} totals`}>
                <div><span>Cost</span><strong>{currency.format(takeoff.totalCost || 0)}</strong></div>
                <div><span>Sell net</span><strong>{currency.format(takeoff.subtotal || 0)}</strong></div>
                <div><span>Margin</span><strong>{currency.format(takeoff.marginAmount || 0)} / {takeoff.marginPercent || 0}%</strong></div>
                <div><span>Gross</span><strong>{currency.format(takeoff.total || 0)}</strong></div>
              </div>
              {takeoff.workBreakdown?.nodes?.length ? (
                <div className="takeoff-wbs" role="table" aria-label={`${takeoff.title} work breakdown`}>
                  <div className="takeoff-wbs-heading" role="row">
                    <strong role="columnheader">WBS work package</strong>
                    <span role="columnheader">Measurements</span>
                    <span role="columnheader">Cost</span>
                    <span role="columnheader">Sell</span>
                    <span role="columnheader">Margin</span>
                  </div>
                  {takeoff.workBreakdown.nodes.map((node) => (
                    <div className="takeoff-wbs-row" role="row" key={node.code} data-testid={`takeoff-wbs-${takeoff.id}-${node.code}`}>
                      <div role="cell"><strong>{node.code}</strong><span>{node.name}</span></div>
                      <span role="cell"><small>Measurements</small><strong>{node.itemCount}</strong></span>
                      <span role="cell"><small>Cost</small><strong>{currency.format(node.totalCost || 0)}</strong></span>
                      <span role="cell"><small>Sell</small><strong>{currency.format(node.totalPrice || 0)}</strong></span>
                      <span role="cell"><small>Margin</small><strong>{currency.format(node.marginAmount || 0)} / {node.marginPercent || 0}%</strong></span>
                    </div>
                  ))}
                </div>
              ) : null}
              {takeoff.items?.length ? (
                <div className="takeoff-items" role="table" aria-label={`${takeoff.title} measurements`}>
                  {takeoff.items.map((item) => (
                    <div className="takeoff-item" role="row" key={item.id}>
                      <div className="takeoff-item-copy" role="cell">
                        <div>
                          <strong>{item.description}</strong>
                          <span className="tag tag-wbs">{item.wbsCode} / {item.workPackage}</span>
                          <span className="tag">{formatStatus(item.category)}</span>
                          {item.rateBuildUpHash ? (
                            <span className={`tag ${item.rateIntegrityValid ? 'tag-green' : 'tag-red'}`}>
                              {item.rateIntegrityValid ? `Rate v${item.rateBuildUp?.policy?.versionNumber}` : 'Rate integrity failed'}
                            </span>
                          ) : null}
                        </div>
                        <small>{takeoffMeasurementSummary(item)} / {item.sourceReference || 'No drawing reference'}</small>
                        {item.rateBuildUp?.calculation ? (
                          <small className="takeoff-rate-summary">
                            Labour {rateMoney(item.rateBuildUp.calculation.labourCostPerUnit, takeoff.currency)} / overhead {rateMoney(item.rateBuildUp.calculation.overheadRecoveryPerUnit, takeoff.currency)} / cost {rateMoney(item.rateBuildUp.calculation.unitCost, takeoff.currency)} / margin {item.rateBuildUp.calculation.targetMarginPercent}%
                          </small>
                        ) : null}
                      </div>
                      <div className="takeoff-item-quantity" role="cell">
                        <span>Quantity</span>
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
                            aria-label={`Build rate ${item.description}`}
                            title={activeRatePolicy ? 'Unit-rate build-up' : 'Approve an estimating rate policy first'}
                            disabled={submitting || !activeRatePolicy}
                            onClick={() => openRateBuildUp(takeoff, item)}
                          >
                            <Calculator size={15} />
                          </button>
                          <button type="button" className="icon-button" aria-label={`Edit ${item.description}`} disabled={submitting} onClick={() => onEditItem(takeoff, item)}>
                            <Pencil size={15} />
                          </button>
                          <button type="button" className="icon-button" aria-label={`Remove ${item.description}`} disabled={submitting} onClick={() => onRemoveItem(takeoff, item)}>
                            <X size={15} />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="workflow-note">No measurements retained yet. Add a count, length, area, volume, or manual quantity.</p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty title="No WBS or quantity takeoffs" detail="Create a structured measured scope before preparing an estimate from drawings, surveys, or site dimensions." />
      )}
      {editingRatePolicy ? (
        <div className="estimate-rate-editor-wrap" role="presentation">
          <form className="estimate-rate-editor" role="dialog" aria-modal="true" aria-labelledby="estimate-rate-policy-title" onSubmit={submitRatePolicy}>
            <div className="panel-heading">
              <div>
                <h3 id="estimate-rate-policy-title">Estimating rate policy revision</h3>
                <p>Labour burden, productive utilization, overhead recovery, and target margin.</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close estimating rate policy editor" onClick={() => setEditingRatePolicy(false)}><X size={16} /></button>
            </div>
            <div className="form-grid estimate-rate-policy-grid">
              <label className="form-span">Policy name<input autoFocus required minLength="2" maxLength="120" value={ratePolicyDraft.policyName} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, policyName: event.target.value })} /></label>
              <label>Currency<input required maxLength="3" value={ratePolicyDraft.currency} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, currency: event.target.value.toUpperCase() })} /></label>
              <label>Target margin (%)<input required type="number" min="0" max="90" step="0.01" value={ratePolicyDraft.targetMarginPercent} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, targetMarginPercent: event.target.value })} /></label>
            </div>
            <fieldset className="estimate-rate-fieldset">
              <legend>Labour classes</legend>
              <div className="estimate-rate-labour-list">
                {ratePolicyDraft.labourClasses.map((row, index) => (
                  <div className="estimate-rate-labour-row" key={`${row.code}-${index}`}>
                    <label>Class code<input required maxLength="24" value={row.code} onChange={(event) => updateLabourClass(index, { code: event.target.value.toUpperCase() })} /></label>
                    <label>Class name<input required minLength="2" maxLength="80" value={row.name} onChange={(event) => updateLabourClass(index, { name: event.target.value })} /></label>
                    <label>Base hourly rate<input required type="number" min="0.01" max="10000" step="0.01" value={row.baseHourlyRate} onChange={(event) => updateLabourClass(index, { baseHourlyRate: event.target.value })} /></label>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove labour class ${row.name || index + 1}`}
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
              ><Plus size={14} /> Labour class</button>
            </fieldset>
            <fieldset className="estimate-rate-fieldset">
              <legend>Labour burden assumptions</legend>
              <div className="form-grid estimate-rate-assumption-grid">
                <label>Paid leave (%)<input required type="number" min="0" max="100" step="0.01" value={ratePolicyDraft.paidLeavePercent} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, paidLeavePercent: event.target.value })} /></label>
                <label>Employer costs (%)<input required type="number" min="0" max="100" step="0.01" value={ratePolicyDraft.statutoryEmployerCostsPercent} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, statutoryEmployerCostsPercent: event.target.value })} /></label>
                <label>Pension and benefits (%)<input required type="number" min="0" max="100" step="0.01" value={ratePolicyDraft.pensionBenefitsPercent} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, pensionBenefitsPercent: event.target.value })} /></label>
                <label>Insurance and other (%)<input required type="number" min="0" max="100" step="0.01" value={ratePolicyDraft.insuranceOtherPercent} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, insuranceOtherPercent: event.target.value })} /></label>
                <label>Productive utilization (%)<input required type="number" min="1" max="100" step="0.01" value={ratePolicyDraft.productiveUtilizationPercent} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, productiveUtilizationPercent: event.target.value })} /></label>
              </div>
            </fieldset>
            <fieldset className="estimate-rate-fieldset">
              <legend>Overhead recovery</legend>
              <div className="form-grid estimate-rate-assumption-grid">
                <label>Method<select value={ratePolicyDraft.overheadMethod} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, overheadMethod: event.target.value })}><option value="labor_hour">Per labour hour</option><option value="direct_cost_percent">Direct-cost percentage</option></select></label>
                <label>Annual overhead<input required type="number" min="0" max="1000000000" step="0.01" value={ratePolicyDraft.annualOverhead} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, annualOverhead: event.target.value })} /></label>
                <label>Annual productive labour hours<input required={ratePolicyDraft.overheadMethod === 'labor_hour'} type="number" min={ratePolicyDraft.overheadMethod === 'labor_hour' ? '1' : '0'} max="10000000" step="0.01" value={ratePolicyDraft.annualProductiveLabourHours} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, annualProductiveLabourHours: event.target.value })} /></label>
                <label>Direct-cost overhead (%)<input required type="number" min="0" max="500" step="0.01" value={ratePolicyDraft.directCostPercent} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, directCostPercent: event.target.value })} /></label>
              </div>
            </fieldset>
            <label className="estimate-rate-reason">Revision reason<textarea required minLength="8" maxLength="500" value={ratePolicyDraft.reason} onChange={(event) => setRatePolicyDraft({ ...ratePolicyDraft, reason: event.target.value })} /></label>
            <p className="workflow-note">Policy approval changes only future internal draft calculations. Worker directory rates and existing measurements remain unchanged.</p>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditingRatePolicy(false)}>Cancel</button>
              <button className="primary-button" disabled={submitting || !ratePolicyReady}><ChevronRight size={15} /> Request approval</button>
            </div>
          </form>
        </div>
      ) : null}
      {rateBuildUpTarget && rateBuildUpDraft && activeRatePolicy ? (
        <div className="estimate-rate-editor-wrap" role="presentation">
          <form className="estimate-rate-editor unit-rate-editor" role="dialog" aria-modal="true" aria-labelledby="unit-rate-title" onSubmit={submitRateBuildUp}>
            <div className="panel-heading">
              <div>
                <h3 id="unit-rate-title">Unit-rate build-up</h3>
                <p>{rateBuildUpTarget.item.description} / {rateBuildUpTarget.item.unit}</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close unit-rate build-up" onClick={() => { setRateBuildUpTarget(null); setRateBuildUpDraft(null) }}><X size={16} /></button>
            </div>
            <div className="form-grid unit-rate-input-grid">
              <label>Labour class<select value={rateBuildUpDraft.labourClassCode} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, labourClassCode: event.target.value })}>{(activeRatePolicy.derived?.labourClasses || EMPTY_LIST).map((row) => <option key={row.code} value={row.code}>{row.name} / {rateMoney(row.fullyBurdenedHourlyRate, activeRatePolicy.currency)}/h</option>)}</select></label>
              <label>Labour hours / unit<input required type="number" min="0" max="1000000" step="0.0001" value={rateBuildUpDraft.labourHoursPerUnit} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, labourHoursPerUnit: event.target.value })} /></label>
              <label>Material / unit<input required type="number" min="0" max="1000000000" step="0.01" value={rateBuildUpDraft.materialCostPerUnit} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, materialCostPerUnit: event.target.value })} /></label>
              <label>Equipment / unit<input required type="number" min="0" max="1000000000" step="0.01" value={rateBuildUpDraft.equipmentCostPerUnit} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, equipmentCostPerUnit: event.target.value })} /></label>
              <label>Subcontract / unit<input required type="number" min="0" max="1000000000" step="0.01" value={rateBuildUpDraft.subcontractCostPerUnit} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, subcontractCostPerUnit: event.target.value })} /></label>
              <label>Other direct / unit<input required type="number" min="0" max="1000000000" step="0.01" value={rateBuildUpDraft.otherDirectCostPerUnit} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, otherDirectCostPerUnit: event.target.value })} /></label>
              <label>Target margin (%)<input required type="number" min="0" max="90" step="0.01" value={rateBuildUpDraft.targetMarginPercent} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, targetMarginPercent: event.target.value })} /></label>
            </div>
            {ratePreview?.marginOverride ? <label className="estimate-rate-reason">Margin override reason<textarea required minLength="8" maxLength="500" value={rateBuildUpDraft.marginOverrideReason} onChange={(event) => setRateBuildUpDraft({ ...rateBuildUpDraft, marginOverrideReason: event.target.value })} /></label> : null}
            {ratePreview ? (
              <div className="unit-rate-preview" aria-label="Unit-rate calculation preview">
                <div><span>Burdened labour</span><strong>{rateMoney(ratePreview.labourCost, activeRatePolicy.currency)}</strong></div>
                <div><span>Direct cost</span><strong>{rateMoney(ratePreview.directCost, activeRatePolicy.currency)}</strong></div>
                <div><span>Overhead recovery</span><strong>{rateMoney(ratePreview.overhead, activeRatePolicy.currency)}</strong></div>
                <div><span>Unit cost</span><strong>{rateMoney(ratePreview.unitCost, activeRatePolicy.currency)}</strong></div>
                <div><span>Unit sell rate</span><strong>{rateMoney(ratePreview.unitSellRate, activeRatePolicy.currency)}</strong></div>
                <div><span>Equivalent markup</span><strong>{ratePreview.markupPercent}%</strong></div>
              </div>
            ) : null}
            <p className="workflow-note">This updates only the selected draft measurement. Estimate conversion remains approval-gated.</p>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => { setRateBuildUpTarget(null); setRateBuildUpDraft(null) }}>Cancel</button>
              <button className="primary-button" disabled={submitting || !rateBuildUpReady}><Calculator size={15} /> Apply build-up</button>
            </div>
          </form>
        </div>
      ) : null}
      <p className="workflow-note">
        Takeoff conversion seals the WBS, measured basis, and package rollups into one internal quote approval. It does not issue a proposal, contact the client, or alter contract value.
      </p>
    </section>
  )
}

function ProductionControl({
  job,
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
    ? 'Not rated'
    : roundDisplay(summary.performanceFactor)

  return (
    <section className="job-workspace-section production-control" data-testid="production-control">
      <div className="section-heading production-heading">
        <Activity size={18} />
        <div>
          <h3>Production control</h3>
          <p>Compare measured installed output and crew hours with one approved production baseline.</p>
        </div>
        {canCoordinate && !pendingBaseline && !editingBaseline ? (
          <button type="button" className="secondary-button" disabled={submitting} onClick={beginBaselineRevision}>
            <Ruler size={15} />
            {activeBaseline ? 'Revise baseline' : 'Create baseline'}
          </button>
        ) : null}
      </div>

      <div className="production-summary" aria-label="Production performance summary">
        <div><span>Quantity progress</span><strong>{roundDisplay(summary.quantityProgressPercent || 0)}%</strong></div>
        <div><span>Earned / crew hours</span><strong>{roundDisplay(summary.earnedHours || 0)} / {roundDisplay(summary.crewHours || 0)}</strong></div>
        <div><span>Performance factor</span><strong>{performanceStatus}</strong></div>
        <div><span>At-risk lines</span><strong>{summary.atRiskLines || 0}</strong></div>
      </div>

      {pendingBaseline ? (
        <div className="production-pending" role="status">
          <ShieldCheck size={16} />
          <span>Baseline v{pendingBaseline.versionNumber} is awaiting approval. Output remains bound to the current approved baseline.</span>
          {canApprove ? (
            <button type="button" className="secondary-button" onClick={() => onOpenApprovals({ approvalId: pendingBaseline.approvalId, jobId: job.id, jobTitle: job.title })}>
              Review approval
            </button>
          ) : null}
        </div>
      ) : null}

      {editingBaseline ? (
        <form className="production-baseline-editor" data-testid="production-baseline-form" onSubmit={submitBaseline}>
          <div className="production-editor-heading">
            <div>
              <strong>{activeBaseline ? 'Revised production baseline' : 'Initial production baseline'}</strong>
              <small>Keep existing line keys and units when revising lines with retained output.</small>
            </div>
            <button type="button" className="icon-button" aria-label="Cancel production baseline" onClick={() => setEditingBaseline(false)}><X size={16} /></button>
          </div>
          <div className="production-baseline-lines">
            {baselineLines.map((line, index) => (
              <div className="production-baseline-line" key={index}>
                <label>Line key<input required minLength="2" maxLength="100" value={line.lineKey} onChange={(event) => updateBaselineLine(index, { lineKey: event.target.value })} /></label>
                <label>Cost code<input required minLength="2" maxLength="80" value={line.costCode} onChange={(event) => updateBaselineLine(index, { costCode: event.target.value })} /></label>
                <label className="production-description">Description<input required minLength="2" maxLength="300" value={line.description} onChange={(event) => updateBaselineLine(index, { description: event.target.value })} /></label>
                <label>Unit<input required maxLength="30" value={line.unit} onChange={(event) => updateBaselineLine(index, { unit: event.target.value })} /></label>
                <label>Planned quantity<input required type="number" min="0.0001" step="0.0001" value={line.plannedQuantity} onChange={(event) => updateBaselineLine(index, { plannedQuantity: event.target.value })} /></label>
                <label>Labor hours<input required type="number" min="0.01" step="0.01" value={line.plannedLaborHours} onChange={(event) => updateBaselineLine(index, { plannedLaborHours: event.target.value })} /></label>
                {baselineLines.length > 1 ? (
                  <button type="button" className="icon-button production-remove-line" aria-label={`Remove production line ${index + 1}`} onClick={() => setBaselineLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><X size={15} /></button>
                ) : null}
              </div>
            ))}
          </div>
          <label className="production-notes">Reviewer context<textarea maxLength="4000" value={baselineNotes} onChange={(event) => setBaselineNotes(event.target.value)} placeholder="Record measurement basis, crew assumptions, and retained references." /></label>
          <div className="modal-actions">
            <button type="button" className="secondary-button" disabled={submitting || baselineLines.length >= 200} onClick={() => setBaselineLines((current) => [...current, emptyProductionBaselineLine(current.length)])}><Plus size={15} />Line</button>
            <button className="primary-button" disabled={submitting}><ShieldCheck size={15} />{submitting ? 'Retaining...' : 'Request baseline approval'}</button>
          </div>
        </form>
      ) : null}

      {activeBaseline ? (
        <div className="production-line-register" role="table" aria-label="Production baseline lines">
          {lines.map((line) => (
            <div className={`production-line-row ${line.atRisk ? 'production-line-risk' : ''}`} role="row" key={line.lineKey}>
              <div className="production-line-copy" role="cell"><strong>{line.description}</strong><small>{line.costCode} / {line.lineKey}</small></div>
              <div role="cell"><span>Installed</span><strong>{roundDisplay(line.installedQuantity)} / {roundDisplay(line.plannedQuantity)} {line.unit}</strong></div>
              <div role="cell"><span>Earned / crew</span><strong>{roundDisplay(line.earnedHours)} / {roundDisplay(line.crewHours)} h</strong></div>
              <div role="cell"><span>Factor</span><strong>{line.performanceFactor === null ? 'Not rated' : roundDisplay(line.performanceFactor)}</strong></div>
            </div>
          ))}
        </div>
      ) : !editingBaseline ? (
        <Empty title="No approved production baseline" detail="An office operator must retain measured plan quantities and labor hours before field output can be recorded." />
      ) : null}

      {activeBaseline && canReport ? (
        <form className="production-entry-form" data-testid="production-entry-form" onSubmit={submitEntry}>
          <div className="production-entry-heading">
            <div className="production-entry-copy"><strong>Record installed output</strong><small>Operational crew hours support productivity review and do not replace payroll time cards.</small></div>
            <div className="production-outbox-status" aria-live="polite">
              {outboxPending ? (
                <button type="button" className="secondary-button" disabled={outboxSyncing || navigator.onLine === false} onClick={onSyncOutbox}>
                  <RefreshCw size={14} className={outboxSyncing ? 'spin' : ''} />
                  {outboxSyncing ? 'Syncing...' : `${outboxPending} queued`}
                </button>
              ) : (
                <span className="tag tag-green">Outbox clear</span>
              )}
            </div>
          </div>
          <div className="form-grid">
            <label>Production line<select required value={entryDraft.lineKey} onChange={(event) => setEntryDraft({ ...entryDraft, lineKey: event.target.value })}>{lines.map((line) => <option key={line.lineKey} value={line.lineKey}>{line.description} ({line.unit})</option>)}</select></label>
            <label>Work date<input required type="date" value={entryDraft.workDate} onChange={(event) => setEntryDraft({ ...entryDraft, workDate: event.target.value })} /></label>
            <label>Installed quantity<input required type="number" min="0.0001" step="0.0001" value={entryDraft.quantity} onChange={(event) => setEntryDraft({ ...entryDraft, quantity: event.target.value })} /></label>
            <label>Crew hours<input required type="number" min="0" max="12000" step="0.01" value={entryDraft.crewHours} onChange={(event) => setEntryDraft({ ...entryDraft, crewHours: event.target.value })} /></label>
            <label className="form-span">Field note<textarea required minLength="3" maxLength="4000" value={entryDraft.note} onChange={(event) => setEntryDraft({ ...entryDraft, note: event.target.value })} placeholder="Record measured area, work location, crew conditions, and evidence reference." /></label>
          </div>
          <div className="modal-actions"><button className="primary-button" disabled={submitting}><Activity size={15} />{submitting ? 'Recording...' : navigator.onLine === false ? 'Save output offline' : 'Record output'}</button></div>
        </form>
      ) : null}

      {entries.length ? (
        <div className="production-entry-register" aria-label="Recent production entries">
          {entries.slice(0, 10).map((entry) => {
            const line = (activeBaseline?.snapshot?.lines || EMPTY_LIST).find((item) => item.lineKey === entry.lineKey)
            return (
              <div className="production-entry-row" key={entry.id}>
                <div><strong>{line?.description || entry.lineKey}</strong><small>{formatDate(entry.workDate)} / {entry.note || 'No note'}</small></div>
                <div><span>{roundDisplay(entry.quantity)} {line?.unit || 'unit'}</span><span>{roundDisplay(entry.crewHours)} h</span><span className={`status status-${entry.status}`}>{formatStatus(entry.status)}</span></div>
                {canCoordinate && entry.status === 'recorded' ? <button type="button" className="icon-button" aria-label={`Request reversal for ${line?.description || entry.lineKey}`} onClick={() => { setReversalEntryId(entry.id); setReversalReason('') }}><RefreshCw size={15} /></button> : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {reversalEntryId ? (
        <form className="production-reversal-form" data-testid="production-reversal-form" onSubmit={submitReversal}>
          <label>Reversal reason<textarea autoFocus required minLength="5" maxLength="2000" value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} /></label>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setReversalEntryId(null)}>Cancel</button><button className="primary-button" disabled={submitting || reversalReason.trim().length < 5}><ShieldCheck size={15} />Request reversal approval</button></div>
        </form>
      ) : null}

      <p className="workflow-note">Baseline approval, field capture, and reversals stay internal. Contractor.AI does not alter payroll, budget, schedule, scope, or external commitments from these records.</p>
    </section>
  )
}

function DayworkControl({
  job,
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
          <h3>Daywork and extra work</h3>
          <p>Retain observed site quantities first, then route acknowledgement and pricing through separate approval gates.</p>
        </div>
        <div className="daywork-outbox-status" aria-live="polite">
          {outboxPending ? (
            <button type="button" className="secondary-button" disabled={outboxSyncing || !online} onClick={onSyncOutbox}>
              <RefreshCw size={14} className={outboxSyncing ? 'spin' : ''} />
              {outboxSyncing ? 'Syncing...' : `${outboxPending} queued`}
            </button>
          ) : <span className="tag tag-green">Outbox clear</span>}
        </div>
      </div>

      <div className="daywork-summary" aria-label="Daywork ticket summary">
        <div><span>Tickets</span><strong>{tickets.length}</strong></div>
        <div><span>Open control</span><strong>{pendingCount}</strong></div>
        <div><span>Acknowledged</span><strong>{acknowledgedCount}</strong></div>
        <div><span>Converted</span><strong>{convertedCount}</strong></div>
      </div>

      {canReport ? (
        <form className="daywork-entry-form" data-testid="daywork-entry-form" onSubmit={submitTicket}>
          <div className="daywork-form-heading">
            <div><strong>Record observed extra work</strong><small>Quantities and evidence are retained without price, scope acceptance, or external commitment.</small></div>
          </div>
          <div className="form-grid">
            <label>Work date<input required type="date" value={draft.workDate} onChange={(event) => setDraft({ ...draft, workDate: event.target.value })} /></label>
            {canCoordinate ? (
              <label>Responsible worker<select value={draft.workerId} onChange={(event) => setDraft({ ...draft, workerId: event.target.value })}><option value="">Office record / unassigned</option>{assignments.map((assignment) => <option key={assignment.id} value={assignment.workerId}>{assignment.workerName || assignment.workerId}</option>)}</select></label>
            ) : null}
            <label className="form-span">Title<input required minLength="2" maxLength="240" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Additional work observed" /></label>
            <label className="form-span">Work completed<textarea required minLength="3" maxLength="4000" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Record location, completed work, and site conditions." /></label>
            <label className="form-span">Reason<textarea required minLength="3" maxLength="2000" value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} placeholder="Record why this work was outside or changed from the retained basis." /></label>
            <label>Evidence reference<input required minLength="3" maxLength="500" value={draft.evidenceReference} onChange={(event) => setDraft({ ...draft, evidenceReference: event.target.value })} placeholder="Photo set, drawing, instruction" /></label>
            <label>Internal note<input maxLength="2000" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
          </div>
          <div className="daywork-lines" aria-label="Observed daywork quantities">
            {draft.lines.map((line, index) => (
              <div className="daywork-line-editor" key={line.lineKey}>
                <label>Type<select value={line.lineType} onChange={(event) => changeLineType(index, event.target.value)}><option value="labor">Labor</option><option value="material">Material</option><option value="equipment">Equipment</option><option value="subcontract">Subcontract</option><option value="other">Other</option></select></label>
                <label className="daywork-line-description">Description<input required minLength="2" maxLength="240" value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} /></label>
                <label>Quantity<input required type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label>
                <label>Unit<input required maxLength="24" value={line.unit} onChange={(event) => updateLine(index, { unit: event.target.value })} /></label>
                <label>Cost code<input required minLength="2" maxLength="80" value={line.costCode} onChange={(event) => updateLine(index, { costCode: event.target.value })} /></label>
                <label>Line evidence<input maxLength="240" value={line.sourceReference} onChange={(event) => updateLine(index, { sourceReference: event.target.value })} /></label>
                {draft.lines.length > 1 ? <button type="button" className="icon-button" aria-label={`Remove daywork line ${index + 1}`} onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }))}><X size={15} /></button> : <span className="daywork-line-spacer" />}
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary-button" disabled={submitting || draft.lines.length >= 50} onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, emptyDayworkLine('material')] }))}><Plus size={15} />Quantity line</button>
            <button className="primary-button" disabled={submitting}><ClipboardPenLine size={15} />{submitting ? 'Retaining...' : !online ? 'Save daywork offline' : 'Submit for review'}</button>
          </div>
        </form>
      ) : null}

      {tickets.length ? (
        <div className="daywork-register" aria-label="Retained daywork tickets">
          {tickets.map((ticket) => {
            const pendingTicketApproval = pendingApprovals.find((approval) => approval.targetType === 'daywork_ticket' && approval.targetId === ticket.id)
            const pendingAcknowledgementApproval = pendingApprovals.find((approval) => approval.targetType === 'daywork_acknowledgement' && approval.targetId === ticket.id)
            const isPricing = pricingTicketId === ticket.id
            const pricingTotal = (ticket.lines || EMPTY_LIST).reduce((sum, line) => sum + Number(line.quantity || 0) * Number(prices[line.lineKey] || 0), 0)
            return (
              <article className="daywork-ticket" key={ticket.id} data-testid={`daywork-ticket-${ticket.id}`}>
                <div className="daywork-ticket-heading">
                  <div><strong>{ticket.ticketNumber || ticket.title}</strong><span className={`status status-${ticket.status}`}>{formatStatus(ticket.status)}</span></div>
                  <small>{formatDate(ticket.workDate)} / {ticket.workerName || 'Office record'} / {ticket.lineCount || ticket.lines?.length || 0} line(s)</small>
                </div>
                <div className="daywork-ticket-copy"><strong>{ticket.title}</strong><p>{ticket.description}</p><small>Reason: {ticket.reason}</small><small>Evidence: {ticket.evidenceReference}</small></div>
                <div className="daywork-ticket-lines">
                  {(ticket.lines || EMPTY_LIST).map((line) => <div key={line.lineKey}><span>{formatStatus(line.lineType)}</span><strong>{roundDisplay(line.quantity)} {line.unit}</strong><small>{line.description} / {line.costCode}</small></div>)}
                </div>
                <div className="daywork-ticket-actions">
                  {pendingTicketApproval && canApprove ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => onOpenApprovals({ approvalId: pendingTicketApproval.id, jobId: job.id, jobTitle: job.title })}><ShieldCheck size={15} />Review quantities</button> : null}
                  {pendingAcknowledgementApproval && canApprove ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => onOpenApprovals({ approvalId: pendingAcknowledgementApproval.id, jobId: job.id, jobTitle: job.title })}><ShieldCheck size={15} />Review acknowledgement</button> : null}
                  {canCoordinate && ticket.status === 'approved' && !pendingAcknowledgementApproval ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => beginAcknowledgement(ticket)}><BadgeCheck size={15} />Record acknowledgement</button> : null}
                  {canCoordinate && ['approved', 'acknowledged'].includes(ticket.status) ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => beginPricing(ticket)}><ReceiptEuro size={15} />Price change</button> : null}
                </div>
                {acknowledgementTicketId === ticket.id ? (
                  <form className="daywork-inline-form" data-testid="daywork-acknowledgement-form" onSubmit={submitAcknowledgement}>
                    <div className="form-grid"><label>Evidence reference<input required minLength="3" maxLength="500" value={acknowledgement.evidenceReference} onChange={(event) => setAcknowledgement({ ...acknowledgement, evidenceReference: event.target.value })} /></label><label>Acknowledged by<input required minLength="2" maxLength="160" value={acknowledgement.acknowledgedBy} onChange={(event) => setAcknowledgement({ ...acknowledgement, acknowledgedBy: event.target.value })} /></label><label>Date and time<input required type="datetime-local" value={acknowledgement.acknowledgedAt} onChange={(event) => setAcknowledgement({ ...acknowledgement, acknowledgedAt: event.target.value })} /></label><label>Internal note<input maxLength="2000" value={acknowledgement.notes} onChange={(event) => setAcknowledgement({ ...acknowledgement, notes: event.target.value })} /></label></div>
                    <p className="workflow-note">This records receipt of the site record only. It does not accept price or scope.</p>
                    <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setAcknowledgementTicketId('')}>Cancel</button><button className="primary-button" disabled={submitting}><ShieldCheck size={15} />Request evidence review</button></div>
                  </form>
                ) : null}
                {isPricing ? (
                  <form className="daywork-inline-form" data-testid="daywork-pricing-form" onSubmit={submitPricing}>
                    <div className="daywork-price-lines">{(ticket.lines || EMPTY_LIST).map((line) => <label key={line.lineKey}><span>{line.description}<small>{roundDisplay(line.quantity)} {line.unit}</small></span><input required type="number" min="0" max="1000000000" step="0.01" value={prices[line.lineKey] || ''} onChange={(event) => setPrices((current) => ({ ...current, [line.lineKey]: event.target.value }))} placeholder="Unit price" /></label>)}</div>
                    <div className="daywork-price-summary"><label>Schedule impact (days)<input type="number" min="-3650" max="3650" step="0.5" value={scheduleDeltaDays} onChange={(event) => setScheduleDeltaDays(event.target.value)} /></label><div><span>Net change preview</span><strong>{currency.format(pricingTotal)}</strong></div></div>
                    <p className="workflow-note">Conversion creates a separate approval-gated change order. It does not contact the client or change contract value.</p>
                    <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPricingTicketId('')}>Cancel</button><button className="primary-button" disabled={submitting || !(pricingTotal > 0)}><ArrowUpRight size={15} />Prepare change order</button></div>
                  </form>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : <Empty title="No daywork tickets" detail="Observed extra work will appear here after field or office capture." />}

      <p className="workflow-note">Autonomy may surface missing reviews, but it cannot invent quantities, acknowledgement, pricing, client acceptance, supplier spend, schedule commitments, invoices, payments, or funds movement.</p>
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
  onRecordChangeDelivery,
  onOpenApprovals,
  onRequestCommercialScope,
  onRequestRiskRegister,
  onRetainPricingBasis,
}) {
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
          <h3>Commercial control</h3>
          <p>Separate internal approval from retained client acceptance before contract value changes.</p>
        </div>
      </div>
      <div className={`scope-definition-strip ${commercialScopeReady ? 'scope-definition-active' : 'scope-definition-missing'}`} data-testid="commercial-scope-control">
        <ClipboardList size={18} />
        <div className="scope-definition-copy">
          <div>
            <strong>{commercialScopeReady ? currentScope.title : pendingScope ? 'Commercial scope awaiting approval' : commercialScope.stale ? 'Commercial scope requires revision' : 'Commercial scope not retained'}</strong>
            {currentScope ? <span className="tag">v{currentScope.versionNumber}</span> : null}
            {pendingScope ? <span className="tag tag-amber">v{pendingScope.versionNumber} pending</span> : null}
          </div>
          <span>
            {commercialScopeReady
              ? `${currentScope.snapshot?.inclusions?.length || 0} inclusions / ${currentScope.snapshot?.assumptions?.length || 0} assumptions / ${currentScope.snapshot?.exclusions?.length || 0} exclusions / ${currentScope.snapshot?.allowances?.length || 0} allowances totaling ${rateMoney(currentScope.allowanceTotal, currentScope.currency)}`
              : pendingScope
                ? 'Pricing and quote approval remain blocked until an approver accepts this exact source-bound revision.'
                : 'Write the promised work, assumptions, exclusions, responsibilities, and allowance reconciliation before selecting a pricing model.'}
          </span>
        </div>
        {commercialScope.stale ? <span className="tag tag-amber">Source changed</span> : commercialScopeReady ? <span className="tag tag-green">Approved + current</span> : null}
        {pendingScopeApproval && canApprove ? (
          <button type="button" className="secondary-button" disabled={submitting} onClick={() => onOpenApprovals({ approvalId: pendingScopeApproval.id })}>
            <ShieldCheck size={14} />Review scope
          </button>
        ) : canCoordinate ? (
          <button type="button" className="secondary-button" disabled={submitting || Boolean(pendingScope)} title={pendingScope ? 'Resolve the pending scope revision first' : currentScope ? 'Prepare a new source-bound revision' : 'Prepare the initial commercial scope'} onClick={openCommercialScopeEditor}>
            <ClipboardPenLine size={14} />{currentScope ? 'Revise scope' : 'Write scope'}
          </button>
        ) : null}
      </div>
      <div className={`project-risk-strip ${riskRegisterReady ? 'project-risk-active' : 'project-risk-missing'}`} data-testid="project-risk-register-control">
        <TriangleAlert size={18} />
        <div className="project-risk-copy">
          <div>
            <strong>{riskRegisterReady ? currentRiskRegister.title : pendingRiskRegister ? 'Project risk review awaiting approval' : riskRegister.stale ? 'Project risk review requires revision' : 'Project risk register not retained'}</strong>
            {currentRiskRegister ? <span className="tag">v{currentRiskRegister.versionNumber}</span> : null}
            {pendingRiskRegister ? <span className="tag tag-amber">v{pendingRiskRegister.versionNumber} pending</span> : null}
          </div>
          <span>
            {riskRegisterReady
              ? `${currentRiskRegister.riskCount} risks / ${currentRiskRegister.highRiskCount} high residual / ${rateMoney(currentRiskRegister.totalExpectedValue, currentRiskRegister.currency)} expected exposure / ${currentRiskRegister.snapshot?.summary?.premortemFailureModeCount || 0} premortem modes`
              : pendingRiskRegister
                ? 'Pricing and quote approval remain blocked until an approver verifies ownership, treatments, exposure, and premortem links.'
                : 'Run the premortem, identify causes, events, consequences, owners, triggers, treatments, and residual exposure before pricing.'}
          </span>
        </div>
        {riskRegister.stale ? <span className="tag tag-amber">Source changed</span> : riskRegisterReady ? <span className="tag tag-green">Approved + current</span> : null}
        {pendingRiskApproval && canApprove ? (
          <button type="button" className="secondary-button" disabled={submitting} onClick={() => onOpenApprovals({ approvalId: pendingRiskApproval.id })}>
            <ShieldCheck size={14} />Review risks
          </button>
        ) : canCoordinate ? (
          <button type="button" className="secondary-button" disabled={submitting || !commercialScopeReady || Boolean(pendingRiskRegister)} title={!commercialScopeReady ? 'Approve the commercial scope first' : pendingRiskRegister ? 'Resolve the pending risk revision first' : 'Prepare a source-bound project risk review'} onClick={() => { setRiskDraft(projectRiskDraft(job, riskRegister)); setEditingRiskRegister(true) }}>
            <ClipboardPenLine size={14} />{currentRiskRegister ? 'Revise risks' : 'Run premortem'}
          </button>
        ) : null}
      </div>
      <div className={`pricing-basis-strip ${pricingBasisReady ? 'pricing-basis-active' : 'pricing-basis-missing'}`} data-testid="pricing-basis-control">
        <GitBranch size={18} />
        <div className="pricing-basis-copy">
          <div>
            <strong>{pricingBasisReady ? pricingModelLabel(currentPricingBasis.selectedModel) : pricingBasis.stale ? 'Commercial basis requires reassessment' : 'Commercial pricing basis not retained'}</strong>
            {currentPricingBasis ? <span className="tag">v{currentPricingBasis.versionNumber}</span> : null}
            {currentPricingBasis?.snapshot?.override ? <span className="tag tag-amber">Override</span> : null}
          </div>
          <span>
            {currentPricingBasis
              ? `${currentPricingBasis.score}% fixed-price readiness / recommendation ${pricingModelLabel(currentPricingBasis.recommendation).toLowerCase()} / ${currentPricingBasis.snapshot?.rationale || 'No rationale retained'}`
              : 'No quote can enter approval until the current scope, quantities, site conditions, selections, productivity, schedule, price exposure, and change risk have been assessed.'}
          </span>
        </div>
        {pricingBasis.stale ? <span className="tag tag-amber">Source changed</span> : pricingBasisReady ? <span className="tag tag-green">Source current</span> : null}
        {canCoordinate ? (
          <button type="button" className="secondary-button" disabled={submitting || !commercialScopeReady || !riskRegisterReady} title={commercialScopeReady && riskRegisterReady ? 'Assess the current approved scope and project risk register' : 'Approve a current commercial scope and project risk register first'} onClick={openPricingBasisEditor}>
            <ClipboardPenLine size={14} />
            {currentPricingBasis ? 'Reassess' : 'Assess basis'}
          </button>
        ) : null}
      </div>
      <div className="commercial-summary" aria-label="Accepted commercial value">
        <div>
          <span>{acceptedPricingModel === 'time_and_materials' ? 'Recorded contract value' : 'Accepted contract net'}</span>
          <strong>{currency.format(job.contractValue || 0)}</strong>
        </div>
        <div>
          <span>{acceptedPricingModel === 'time_and_materials' ? 'Accepted T&M budget' : 'Accepted quote'}</span>
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
          <button type="button" className="secondary-button" disabled={submitting || !commercialScopeReady || !riskRegisterReady || !pricingBasisReady} title={commercialScopeReady && riskRegisterReady && pricingBasisReady ? `Create a ${pricingModelLabel(currentPricingBasis.selectedModel).toLowerCase()} estimate` : 'Approve current scope and risk revisions and retain a current pricing-basis decision first'} onClick={onNewQuote}>
            <Plus size={15} />
            New estimate
          </button>
          <button type="button" className="secondary-button" disabled={submitting} onClick={onNewChangeOrder}>
            <Plus size={15} />
            Scope change
          </button>
        </div>
      ) : null}
      {editingCommercialScope ? (
        <div className="modal-backdrop commercial-scope-backdrop" role="presentation">
          <form className="modal commercial-scope-modal" role="dialog" aria-modal="true" aria-labelledby="commercial-scope-title" data-testid="commercial-scope-form" onSubmit={submitCommercialScope}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Approval-gated contract schedule</p>
                <h2 id="commercial-scope-title">Scope, assumptions, exclusions, and allowances</h2>
                <p>{job.title} / source-bound revision {Number(currentScope?.versionNumber || 0) + 1}</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close commercial scope" onClick={() => setEditingCommercialScope(false)}><X size={17} /></button>
            </div>
            <div className="commercial-scope-body">
              <div className="commercial-scope-overview">
                <label>Schedule title<input required minLength="3" maxLength="160" value={scopeDraft.title} onChange={(event) => setScopeDraft({ ...scopeDraft, title: event.target.value })} /></label>
                <label>Clarification deadline<input type="date" value={scopeDraft.clarificationDeadline} onChange={(event) => setScopeDraft({ ...scopeDraft, clarificationDeadline: event.target.value })} /></label>
                <label className="scope-wide">Scope summary<textarea required minLength="12" maxLength="4000" rows={4} value={scopeDraft.scopeSummary} onChange={(event) => setScopeDraft({ ...scopeDraft, scopeSummary: event.target.value })} placeholder="Describe the complete work boundary and intended outcome." /></label>
              </div>
              <div className="commercial-scope-lists">
                <label>Included work<textarea required rows={6} value={scopeDraft.inclusions} onChange={(event) => setScopeDraft({ ...scopeDraft, inclusions: event.target.value })} placeholder="One explicit inclusion per line" /></label>
                <label>Assumptions<textarea required rows={6} value={scopeDraft.assumptions} onChange={(event) => setScopeDraft({ ...scopeDraft, assumptions: event.target.value })} placeholder="One estimating or delivery assumption per line" /></label>
                <label>Exclusions<textarea required rows={6} value={scopeDraft.exclusions} onChange={(event) => setScopeDraft({ ...scopeDraft, exclusions: event.target.value })} placeholder="One explicit exclusion per line" /></label>
                <label>Client responsibilities<textarea rows={6} value={scopeDraft.clientResponsibilities} onChange={(event) => setScopeDraft({ ...scopeDraft, clientResponsibilities: event.target.value })} placeholder="Access, selections, utilities, approvals, or enabling work" /></label>
                <label>Contractor responsibilities<textarea rows={6} value={scopeDraft.contractorResponsibilities} onChange={(event) => setScopeDraft({ ...scopeDraft, contractorResponsibilities: event.target.value })} placeholder="Protection, coordination, cleanup, evidence, or handover" /></label>
              </div>
              <fieldset className="pricing-model-fieldset scope-allowance-mode">
                <legend>Allowance treatment</legend>
                <div className="pricing-model-options">
                  <label className={scopeDraft.allowanceMode === 'none' ? 'selected' : ''}><input type="radio" name="scope-allowance-mode" value="none" checked={scopeDraft.allowanceMode === 'none'} onChange={() => setScopeDraft({ ...scopeDraft, allowanceMode: 'none', allowances: [] })} /><span>No allowances</span></label>
                  <label className={scopeDraft.allowanceMode === 'defined' ? 'selected' : ''}><input type="radio" name="scope-allowance-mode" value="defined" checked={scopeDraft.allowanceMode === 'defined'} onChange={() => setScopeDraft({ ...scopeDraft, allowanceMode: 'defined', allowances: scopeDraft.allowances.length ? scopeDraft.allowances : [emptyScopeAllowance()] })} /><span>Defined allowances</span></label>
                </div>
              </fieldset>
              {scopeDraft.allowanceMode === 'none' ? (
                <label className="scope-no-allowance">No-allowance statement<textarea required minLength="8" maxLength="500" rows={3} value={scopeDraft.noAllowanceReason} onChange={(event) => setScopeDraft({ ...scopeDraft, noAllowanceReason: event.target.value })} /></label>
              ) : (
                <section className="scope-allowance-section" aria-labelledby="scope-allowance-title">
                  <div className="commercial-line-heading">
                    <div><h3 id="scope-allowance-title">Allowances and provisional sums</h3><p>Each amount is server-recalculated from quantity and unit rate.</p></div>
                    <button type="button" className="secondary-button" onClick={() => setScopeDraft((current) => ({ ...current, allowances: [...current.allowances, emptyScopeAllowance(current.allowances.length)] }))}><Plus size={14} />Add allowance</button>
                  </div>
                  <div className="scope-allowance-list">
                    {scopeDraft.allowances.map((allowance, index) => (
                      <fieldset className="scope-allowance-row" key={`${allowance.allowanceKey}-${index}`}>
                        <legend>Allowance {index + 1}</legend>
                        <label>Key<input required maxLength="40" value={allowance.allowanceKey} onChange={(event) => updateScopeAllowance(index, { allowanceKey: event.target.value.toUpperCase() })} /></label>
                        <label>Type<select value={allowance.allowanceType} onChange={(event) => updateScopeAllowance(index, { allowanceType: event.target.value })}><option value="selection_allowance">Selection allowance</option><option value="provisional_sum">Provisional sum</option><option value="unit_rate">Unit rate</option></select></label>
                        <label className="scope-allowance-title-field">Title<input required minLength="3" maxLength="160" value={allowance.title} onChange={(event) => updateScopeAllowance(index, { title: event.target.value })} /></label>
                        <label className="scope-allowance-description">Description<textarea required minLength="3" maxLength="500" rows={2} value={allowance.description} onChange={(event) => updateScopeAllowance(index, { description: event.target.value })} /></label>
                        <label>Quantity<input required type="number" min="0.0001" max="1000000" step="0.0001" value={allowance.quantity} onChange={(event) => updateScopeAllowance(index, { quantity: event.target.value })} /></label>
                        <label>Unit<input required maxLength="40" value={allowance.unit} onChange={(event) => updateScopeAllowance(index, { unit: event.target.value })} /></label>
                        <label>Unit rate<input required type="number" min="0" max="1000000000" step="0.01" value={allowance.unitRate} onChange={(event) => updateScopeAllowance(index, { unitRate: event.target.value })} /></label>
                        <label>Reconciliation<select value={allowance.reconciliationMethod} onChange={(event) => updateScopeAllowance(index, { reconciliationMethod: event.target.value })}><option value="actual_cost_variation">Actual cost variation</option><option value="fixed_included">Fixed included amount</option><option value="remeasured_unit_rate">Remeasured unit rate</option></select></label>
                        <label>Selection by<select value={allowance.selectionBy} onChange={(event) => updateScopeAllowance(index, { selectionBy: event.target.value })}><option value="client">Client</option><option value="contractor">Contractor</option><option value="joint">Joint</option></select></label>
                        <label>Selection due<input type="date" value={allowance.dueAt} onChange={(event) => updateScopeAllowance(index, { dueAt: event.target.value })} /></label>
                        <label className="scope-allowance-description">Evidence reference<input maxLength="500" value={allowance.evidenceReference} onChange={(event) => updateScopeAllowance(index, { evidenceReference: event.target.value })} placeholder="Drawing, survey, supplier quotation, or selection reference" /></label>
                        <div className="scope-allowance-calculated"><span>Calculated amount</span><strong>{rateMoney((Number(allowance.quantity) || 0) * (Number(allowance.unitRate) || 0))}</strong></div>
                        <button type="button" className="icon-button scope-allowance-remove" aria-label={`Remove allowance ${index + 1}`} onClick={() => setScopeDraft((current) => ({ ...current, allowances: current.allowances.filter((_, allowanceIndex) => allowanceIndex !== index) }))}><X size={15} /></button>
                      </fieldset>
                    ))}
                  </div>
                  <div className="scope-allowance-total"><span>Total retained allowance</span><strong>{rateMoney(scopeAllowanceTotal)}</strong></div>
                </section>
              )}
              <label className="pricing-basis-textarea">Revision reason<textarea required minLength="8" maxLength="500" value={scopeDraft.reason} onChange={(event) => setScopeDraft({ ...scopeDraft, reason: event.target.value })} placeholder="Explain why this scope revision is being requested." /></label>
              <p className="workflow-note">Approval activates this revision as the exact source for pricing and quotes. It does not send terms, accept client instructions, authorize changed work, commit spend or dates, invoice, or move funds.</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditingCommercialScope(false)}>Cancel</button>
              <button className="primary-button" disabled={submitting || !scopeDraftReady}><ShieldCheck size={15} />{submitting ? 'Requesting...' : 'Request approval'}</button>
            </div>
          </form>
        </div>
      ) : null}
      {editingRiskRegister ? (
        <div className="modal-backdrop project-risk-backdrop" role="presentation">
          <form className="modal project-risk-modal" role="dialog" aria-modal="true" aria-labelledby="project-risk-title" data-testid="project-risk-register-form" onSubmit={submitRiskRegister}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Approval-gated project review</p>
                <h2 id="project-risk-title">Project risk register and premortem</h2>
                <p>{job.title} / source-bound revision {Number(currentRiskRegister?.versionNumber || 0) + 1}</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close project risk register" onClick={() => setEditingRiskRegister(false)}><X size={17} /></button>
            </div>
            <div className="project-risk-modal-body">
              <div className="project-risk-summary" aria-label="Draft project risk summary">
                <div><span>Risks</span><strong>{riskDraft.risks.length}</strong></div>
                <div><span>High residual</span><strong>{riskDraft.risks.filter((risk) => projectRiskScore(risk, true) >= 15).length}</strong></div>
                <div><span>Expected exposure</span><strong>{rateMoney(riskDraft.risks.reduce((sum, risk) => sum + ((Number(risk.costExposureAmount) || 0) * ({ 1: 0.1, 2: 0.3, 3: 0.5, 4: 0.7, 5: 0.9 }[Number(risk.residualProbability)] || 0)), 0))}</strong></div>
                <div><span>Schedule exposure</span><strong>{Math.max(0, ...riskDraft.risks.map((risk) => Number(risk.scheduleExposureDays) || 0))} days</strong></div>
              </div>
              <section className="premortem-workshop" aria-labelledby="premortem-workshop-title">
                <div className="commercial-line-heading">
                  <div><h3 id="premortem-workshop-title">Premortem workshop</h3><p>Assume the project failed, then link each failure mode to a controlled risk.</p></div>
                </div>
                <div className="premortem-fields">
                  <label>Register title<input required minLength="3" maxLength="160" value={riskDraft.title} onChange={(event) => setRiskDraft({ ...riskDraft, title: event.target.value })} /></label>
                  <label>Workshop date<input required type="date" value={riskDraft.workshopDate} onChange={(event) => setRiskDraft({ ...riskDraft, workshopDate: event.target.value })} /></label>
                  <label>Facilitator<input required minLength="2" maxLength="160" value={riskDraft.facilitator} onChange={(event) => setRiskDraft({ ...riskDraft, facilitator: event.target.value })} /></label>
                  <label className="project-risk-wide">Failure statement<textarea required minLength="12" maxLength="2000" rows={3} value={riskDraft.failureStatement} onChange={(event) => setRiskDraft({ ...riskDraft, failureStatement: event.target.value })} placeholder="The project failed because..." /></label>
                  <label className="project-risk-wide">Participants<textarea required rows={3} value={riskDraft.participants} onChange={(event) => setRiskDraft({ ...riskDraft, participants: event.target.value })} placeholder="One participant per line" /></label>
                </div>
              </section>
              <section className="project-risk-editor" aria-labelledby="project-risk-editor-title">
                <div className="commercial-line-heading">
                  <div><h3 id="project-risk-editor-title">Risk treatments and failure modes</h3><p>Probability and impact use a 1 to 5 scale. Scores and monetary exposure are recalculated by the server.</p></div>
                  <button type="button" className="secondary-button" onClick={() => setRiskDraft((current) => ({ ...current, risks: [...current.risks, emptyProjectRisk(current.risks.length)] }))}><Plus size={14} />Add risk</button>
                </div>
                <div className="project-risk-list">
                  {riskDraft.risks.map((risk, index) => {
                    const inherentScore = projectRiskScore(risk)
                    const residualScore = projectRiskScore(risk, true)
                    return (
                      <fieldset className="project-risk-row" key={`${risk.riskKey}-${index}`} data-testid={`project-risk-row-${index}`}>
                        <legend>Risk {index + 1}</legend>
                        <div className="project-risk-score" aria-label={`Risk ${index + 1} scores`}>
                          <span className={`risk-band risk-band-${projectRiskBand(inherentScore)}`}>Inherent {inherentScore}</span>
                          <ChevronRight size={15} />
                          <span className={`risk-band risk-band-${projectRiskBand(residualScore)}`}>Residual {residualScore}</span>
                        </div>
                        <label>Key<input required maxLength="40" value={risk.riskKey} onChange={(event) => updateProjectRisk(index, { riskKey: event.target.value.toUpperCase() })} /></label>
                        <label>Category<select value={risk.category} onChange={(event) => updateProjectRisk(index, { category: event.target.value })}><option value="commercial">Commercial</option><option value="contract">Contract</option><option value="design">Design</option><option value="site_condition">Site condition</option><option value="schedule">Schedule</option><option value="resource">Resource</option><option value="supply_chain">Supply chain</option><option value="financial">Financial</option><option value="safety">Safety</option><option value="quality">Quality</option><option value="environment">Environment</option><option value="regulatory">Regulatory</option><option value="client">Client</option><option value="third_party">Third party</option><option value="other">Other</option></select></label>
                        <label className="project-risk-title-field">Title<input required minLength="3" maxLength="160" value={risk.title} onChange={(event) => updateProjectRisk(index, { title: event.target.value })} /></label>
                        <label>Owner<input required minLength="2" maxLength="160" value={risk.owner} onChange={(event) => updateProjectRisk(index, { owner: event.target.value })} /></label>
                        <label>Probability<select value={risk.probability} onChange={(event) => updateProjectRisk(index, { probability: event.target.value })}>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
                        <label>Impact<select value={risk.impact} onChange={(event) => updateProjectRisk(index, { impact: event.target.value })}>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
                        <label className="project-risk-wide">Cause<textarea required minLength="8" maxLength="1000" rows={2} value={risk.cause} onChange={(event) => updateProjectRisk(index, { cause: event.target.value })} /></label>
                        <label className="project-risk-wide">Risk event<textarea required minLength="8" maxLength="1000" rows={2} value={risk.event} onChange={(event) => updateProjectRisk(index, { event: event.target.value })} /></label>
                        <label className="project-risk-wide">Consequence<textarea required minLength="8" maxLength="1000" rows={2} value={risk.consequence} onChange={(event) => updateProjectRisk(index, { consequence: event.target.value })} /></label>
                        <label>Response<select value={risk.responseStrategy} onChange={(event) => updateProjectRisk(index, { responseStrategy: event.target.value })}><option value="avoid">Avoid</option><option value="mitigate">Mitigate</option><option value="transfer">Transfer</option><option value="accept">Accept</option></select></label>
                        <label>Status<select value={risk.status} onChange={(event) => updateProjectRisk(index, { status: event.target.value })}><option value="open">Open</option><option value="monitoring">Monitoring</option><option value="treatment_due">Treatment due</option><option value="accepted">Accepted</option><option value="closed">Closed</option></select></label>
                        <label>Treatment due<input type="date" value={risk.dueAt} onChange={(event) => updateProjectRisk(index, { dueAt: event.target.value })} /></label>
                        <label className="project-risk-wide">Mitigation action<textarea required minLength="8" maxLength="2000" rows={2} value={risk.mitigationAction} onChange={(event) => updateProjectRisk(index, { mitigationAction: event.target.value })} /></label>
                        <label className="project-risk-wide">Contingency action<textarea required minLength="8" maxLength="2000" rows={2} value={risk.contingencyAction} onChange={(event) => updateProjectRisk(index, { contingencyAction: event.target.value })} /></label>
                        <label className="project-risk-wide">Trigger or early warning<textarea required minLength="8" maxLength="1000" rows={2} value={risk.trigger} onChange={(event) => updateProjectRisk(index, { trigger: event.target.value })} /></label>
                        <label>Residual probability<select value={risk.residualProbability} onChange={(event) => updateProjectRisk(index, { residualProbability: event.target.value })}>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
                        <label>Residual impact<select value={risk.residualImpact} onChange={(event) => updateProjectRisk(index, { residualImpact: event.target.value })}>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
                        <label>Cost exposure<input type="number" min="0" max="1000000000" step="0.01" value={risk.costExposureAmount} onChange={(event) => updateProjectRisk(index, { costExposureAmount: event.target.value })} /></label>
                        <label>Schedule days<input type="number" min="0" max="10000" step="0.25" value={risk.scheduleExposureDays} onChange={(event) => updateProjectRisk(index, { scheduleExposureDays: event.target.value })} /></label>
                        {residualScore >= 15 || risk.responseStrategy === 'accept' || risk.status === 'accepted' ? <label className="project-risk-wide risk-acceptance">Acceptance or escalation reason<textarea required minLength="8" maxLength="1000" rows={2} value={risk.acceptanceReason} onChange={(event) => updateProjectRisk(index, { acceptanceReason: event.target.value })} /></label> : null}
                        <label className="project-risk-wide">Evidence reference<input maxLength="500" value={risk.evidenceReference} onChange={(event) => updateProjectRisk(index, { evidenceReference: event.target.value })} /></label>
                        <div className="premortem-link-heading"><TriangleAlert size={15} /><strong>Linked premortem failure mode</strong></div>
                        <label className="project-risk-wide">Failure mode<textarea required minLength="8" maxLength="1000" rows={2} value={risk.failureMode} onChange={(event) => updateProjectRisk(index, { failureMode: event.target.value })} /></label>
                        <label className="project-risk-wide">Early warning<textarea required minLength="8" maxLength="1000" rows={2} value={risk.earlyWarning} onChange={(event) => updateProjectRisk(index, { earlyWarning: event.target.value })} /></label>
                        <label className="project-risk-wide">Prevention<textarea required minLength="8" maxLength="2000" rows={2} value={risk.prevention} onChange={(event) => updateProjectRisk(index, { prevention: event.target.value })} /></label>
                        <button type="button" className="icon-button project-risk-remove" aria-label={`Remove risk ${index + 1}`} disabled={riskDraft.risks.length === 1} onClick={() => setRiskDraft((current) => ({ ...current, risks: current.risks.filter((_, riskIndex) => riskIndex !== index) }))}><X size={15} /></button>
                      </fieldset>
                    )
                  })}
                </div>
              </section>
              {riskRegister.revisions?.length ? (
                <details className="project-risk-history"><summary>Revision history ({riskRegister.revisions.length})</summary><div>{riskRegister.revisions.map((revision) => <span key={revision.id}>v{revision.versionNumber} / {formatStatus(revision.status)} / {revision.riskCount} risks / {formatDateTime(revision.updatedAt)}</span>)}</div></details>
              ) : null}
              <label className="pricing-basis-textarea">Revision reason<textarea required minLength="8" maxLength="500" value={riskDraft.reason} onChange={(event) => setRiskDraft({ ...riskDraft, reason: event.target.value })} placeholder="Explain why this project risk review is being requested." /></label>
              <p className="workflow-note">Approval makes this the exact risk source for pricing and quotes. Automation may flag the missing review, but it cannot author risks, accept liability, promise dates, commit spend, issue a quote, send a message, invoice, or move funds.</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditingRiskRegister(false)}>Cancel</button>
              <button className="primary-button" disabled={submitting || !riskDraftReady}><ShieldCheck size={15} />{submitting ? 'Requesting...' : 'Request approval'}</button>
            </div>
          </form>
        </div>
      ) : null}
      {editingPricingBasis ? (
        <div className="modal-backdrop pricing-basis-backdrop" role="presentation">
          <form className="modal pricing-basis-modal" role="dialog" aria-modal="true" aria-labelledby="pricing-basis-title" data-testid="pricing-basis-form" onSubmit={submitPricingBasis}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Source-bound commercial decision</p>
                <h2 id="pricing-basis-title">Fixed price or time and materials</h2>
                <p>{job.title} / decision history remains retained</p>
              </div>
              <button type="button" className="icon-button" aria-label="Close pricing-basis assessment" onClick={() => setEditingPricingBasis(false)}><X size={17} /></button>
            </div>
            <div className="pricing-basis-modal-body">
              <div className="pricing-basis-preview" aria-label="Pricing-basis recommendation">
                <div><span>Recommendation</span><strong>{pricingModelLabel(pricingPreview.recommendation)}</strong></div>
                <div><span>Fixed-price readiness</span><strong>{pricingPreview.score}%</strong></div>
                <div><span>Critical blockers</span><strong>{pricingPreview.blockers.length}</strong></div>
                <div><span>Evidence gaps</span><strong>{pricingPreview.evidenceGaps.length}</strong></div>
              </div>
              <div className="pricing-factor-list">
                {pricingDraft.factors.map((factor, index) => (
                  <div className="pricing-factor-row" key={factor.key} data-testid={`pricing-factor-${factor.key}`}>
                    <div><strong>{factor.label}</strong><small>{factor.weight}% weight{factor.critical ? ' / critical' : ''}</small></div>
                    <label>
                      Assessment
                      <select value={factor.status} onChange={(event) => updatePricingFactor(index, { status: event.target.value })}>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </label>
                    <label>
                      Retained evidence
                      <input required minLength="8" maxLength="500" value={factor.evidence} onChange={(event) => updatePricingFactor(index, { evidence: event.target.value })} placeholder="Reference the scope, survey, drawing, takeoff, selection, schedule, or supplier evidence." />
                    </label>
                  </div>
                ))}
              </div>
              <fieldset className="pricing-model-fieldset">
                <legend>Selected commercial model</legend>
                <div className="pricing-model-options">
                  <label className={pricingDraft.selectedModel === 'fixed_price' ? 'selected' : ''}><input type="radio" name="pricing-model" value="fixed_price" checked={pricingDraft.selectedModel === 'fixed_price'} onChange={(event) => setPricingDraft({ ...pricingDraft, selectedModel: event.target.value })} /><span>Fixed price</span></label>
                  <label className={pricingDraft.selectedModel === 'time_and_materials' ? 'selected' : ''}><input type="radio" name="pricing-model" value="time_and_materials" checked={pricingDraft.selectedModel === 'time_and_materials'} onChange={(event) => setPricingDraft({ ...pricingDraft, selectedModel: event.target.value })} /><span>Time and materials</span></label>
                </div>
              </fieldset>
              <label className="pricing-basis-textarea">Decision rationale<textarea required minLength="8" maxLength="1000" value={pricingDraft.rationale} onChange={(event) => setPricingDraft({ ...pricingDraft, rationale: event.target.value })} placeholder="State why this model fits the retained risk and estimate basis." /></label>
              {pricingOverride ? (
                <label className="pricing-basis-textarea pricing-override-reason">Override reason<textarea required minLength="12" maxLength="500" value={pricingDraft.overrideReason} onChange={(event) => setPricingDraft({ ...pricingDraft, overrideReason: event.target.value })} placeholder="Explain the commercial control that justifies departing from the recommendation or proceeding with evidence gaps." /></label>
              ) : null}
              <p className="workflow-note">This retains an internal commercial decision. Quote issue, client acceptance, schedule commitments, supplier spend, invoices, and payments remain separately gated.</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setEditingPricingBasis(false)}>Cancel</button>
              <button className="primary-button" disabled={submitting || !pricingDraftReady}><ShieldCheck size={15} />{submitting ? 'Retaining...' : 'Retain pricing basis'}</button>
            </div>
          </form>
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
                        <strong>{currency.format(quote.subtotal || 0)} {quote.pricingModel === 'time_and_materials' ? 'budget net' : 'net'}</strong>
                        <span className={`status status-${quote.status}`}>{formatStatus(quote.status)}</span>
                        {quote.pricingModel ? <span className="tag">{pricingModelLabel(quote.pricingModel)}</span> : null}
                        {quote.commercialScope ? <span className="tag">Scope v{quote.commercialScope.versionNumber}</span> : null}
                        {quote.commercialScopeIntegrityValid === false ? <span className="tag tag-red">Scope integrity failed</span> : null}
                        {issueApproval && quote.commercialScopeCurrent === false ? <span className="tag tag-amber">Scope revision required</span> : null}
                        {quote.riskRegister ? <span className="tag">Risk v{quote.riskRegister.versionNumber}</span> : null}
                        {quote.riskRegisterIntegrityValid === false ? <span className="tag tag-red">Risk integrity failed</span> : null}
                        {issueApproval && quote.riskRegisterCurrent === false ? <span className="tag tag-amber">Risk review required</span> : null}
                        {quote.pricingBasisIntegrityValid === false ? <span className="tag tag-red">Basis integrity failed</span> : null}
                        {issueApproval && quote.pricingBasisCurrent === false ? <span className="tag tag-amber">Reassessment required</span> : null}
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
                          disabled={submitting || quote.commercialScopeIntegrityValid !== true || quote.commercialScopeCurrent !== true || quote.pricingBasisIntegrityValid === false || quote.pricingBasisCurrent === false}
                          title={quote.commercialScopeCurrent === false ? 'Approve a current commercial scope revision before approving this quote' : quote.pricingBasisCurrent === false ? 'Reassess the pricing basis before approving this quote' : 'Review quote approval'}
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
                        <span className={`status status-${changeOrder.status}`}>{formatStatus(changeOrder.status)}</span>
                      </div>
                      <small>
                        {currency.format(changeOrder.amount || 0)} net · {changeOrder.scheduleDeltaDays || 0} day schedule impact ·{' '}
                        {commercialCurrency}
                      </small>
                      <small>
                        {changeOrder.scopeDelta || 'Scope evidence not retained'}
                        {issuePackage ? ` · package ${issuePackage.data?.issueReference || 'retained'}` : ''}
                        {changeOrder.data?.issuePackage?.transportStatus
                          ? ` · ${formatStatus(changeOrder.data.issuePackage.transportStatus)}`
                          : ''}
                        {changeOrder.data?.acceptance?.evidenceReference
                          ? ` · evidence ${changeOrder.data.acceptance.evidenceReference}`
                          : ''}
                      </small>
                      <small>
                        {formatStatus(changeOrder.formalControl?.variationType || 'legacy record')} · initiated by {formatStatus(changeOrder.formalControl?.initiatedBy || 'not retained')} · risk {formatStatus(changeOrder.formalControl?.riskImpact || 'not retained')} · {changeOrder.integrityValid ? 'snapshot verified' : 'snapshot invalid'} · {changeOrder.sourceCurrent ? 'contract source current' : 'contract source stale'} · {changeOrder.workAuthorized ? 'work authorized' : 'work not authorized'}
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
                      {canPrepare ? (
                        <button
                          type="button"
                          className="secondary-button"
                          data-testid={`prepare-change-package-${changeOrder.id}`}
                          disabled={submitting}
                          title="Prepare an immutable change-order package and approval-gated delivery draft"
                          onClick={() => onRequestAcceptance('change_issue_package', changeOrder)}
                        >
                          <FileDown size={15} />
                          Prepare issue package
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
                      {canRecordDelivery ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={submitting}
                          onClick={() => onRecordChangeDelivery(changeOrder, deliveryDraft)}
                        >
                          <MailCheck size={15} />
                          Record delivery receipt
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
                      {clientResponseApproval && canApprove ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={submitting}
                          onClick={() => onOpenApprovals({ approvalId: clientResponseApproval.id })}
                        >
                          <ShieldCheck size={15} />
                          Review client response
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
                          Record acceptance
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
                          Prepare revision
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

function ClientDirectoryWorkspace({ directory, canCoordinate, submitting, onCreate, onEdit, onOpen }) {
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
          <h2>Client directory</h2>
          <p>Maintain one retained identity for project communication, commercial packages, invoicing, and aftercare.</p>
        </div>
        {canCoordinate ? (
          <button type="button" className="primary-button" disabled={submitting} onClick={onCreate}>
            <Plus size={16} />
            New client
          </button>
        ) : <span className="count-badge">{clients.length}</span>}
      </div>
      <div className="client-directory-summary" aria-label="Client directory summary">
        <div><span>Clients</span><strong>{summary.total || 0}</strong></div>
        <div><span>Contact ready</span><strong>{summary.contactReady || 0}</strong></div>
        <div><span>Invoice ready</span><strong>{summary.invoiceReady || 0}</strong></div>
        <div><span>Peppol profile</span><strong>{summary.structuredInvoiceReady || 0}</strong></div>
        <div><span>Active jobs</span><strong>{summary.activeJobs || 0}</strong></div>
        <div><span>Receivable</span><strong>{currency.format(summary.outstandingReceivable || 0)}</strong></div>
      </div>
      <div className="client-directory-filter">
        <Search size={16} aria-hidden="true" />
        <label htmlFor="client-directory-search">Search clients</label>
        <input
          id="client-directory-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, company, email, city, or registration"
        />
        <span>{rows.length} shown</span>
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
                    <p>{client.company ? client.name : formatStatus(client.data?.clientType || 'consumer')}</p>
                  </div>
                </div>
                <div className="client-directory-contact">
                  <span>{client.email || client.data?.billingEmail || 'No email retained'}</span>
                  <span>{client.phone || 'No phone retained'}</span>
                  <span>{[client.address, client.data?.postalCode, client.city, client.country].filter(Boolean).join(', ') || 'No address retained'}</span>
                </div>
                <div className="client-flags">
                  <span className={client.readiness?.contactReady ? 'tag tag-green' : 'tag tag-amber'}>Contact {client.readiness?.contactReady ? 'ready' : 'incomplete'}</span>
                  <span className={client.readiness?.invoiceReady ? 'tag tag-green' : 'tag tag-amber'}>Invoice {client.readiness?.invoiceReady ? 'ready' : 'incomplete'}</span>
                  <span className={client.readiness?.structuredInvoiceReady ? 'tag tag-green' : 'tag tag-amber'}>Peppol {client.readiness?.structuredInvoiceReady ? 'ready' : 'incomplete'}</span>
                </div>
                {!client.readiness?.structuredInvoiceReady && missing.length ? (
                  <small className="client-directory-missing">Missing: {missing.slice(0, 3).map((item) => item.label).join(', ')}{missing.length > 3 ? ` +${missing.length - 3}` : ''}</small>
                ) : null}
              </div>
              <div className="client-directory-metrics" aria-label={`Operating context for ${client.company || client.name}`}>
                <div><span>Active jobs</span><strong>{client.metrics?.activeJobs || 0}</strong></div>
                <div><span>Pipeline</span><strong>{client.metrics?.openOpportunities || 0}</strong></div>
                <div><span>Contract value</span><strong>{currency.format(client.metrics?.acceptedContractValue || 0)}</strong></div>
                <div><span>Receivable</span><strong>{currency.format(client.metrics?.outstandingReceivable || 0)}</strong></div>
              </div>
              <div className="client-directory-actions">
                {latestJob ? (
                  <button type="button" className="secondary-button" onClick={() => onOpen(latestJob)}>
                    <ArrowUpRight size={15} />
                    Open latest job
                  </button>
                ) : null}
                {canCoordinate ? (
                  <button type="button" className="secondary-button" disabled={submitting} onClick={() => onEdit(client)}>
                    <Pencil size={15} />
                    Edit client
                  </button>
                ) : null}
              </div>
            </article>
          )
        })}
        {!rows.length ? (
          <Empty
            title={clients.length ? 'No matching clients' : 'No retained clients'}
            detail={clients.length ? 'Change the directory search to review another retained client.' : 'Create a client identity before preparing commercial or invoicing records.'}
          />
        ) : null}
      </div>
    </section>
  )
}

function ClientsWorkspace({ directory, onCreateClient, onEditClient, ...props }) {
  const [view, setView] = useState('work')
  const workCount = props.clients?.jobs?.length || 0
  const directoryCount = directory?.clients?.length || 0
  return (
    <>
      <div className="client-view-switch" role="tablist" aria-label="Client workspace view">
        <button type="button" role="tab" aria-selected={view === 'work'} className={view === 'work' ? 'active' : ''} onClick={() => setView('work')}>
          Client work <span>{workCount}</span>
        </button>
        <button type="button" role="tab" aria-selected={view === 'directory'} className={view === 'directory' ? 'active' : ''} onClick={() => setView('directory')}>
          Directory <span>{directoryCount}</span>
        </button>
      </div>
      {view === 'directory' ? (
        <ClientDirectoryWorkspace
          directory={directory}
          canCoordinate={props.canCoordinate}
          submitting={props.submitting}
          onCreate={onCreateClient}
          onEdit={onEditClient}
          onOpen={props.onOpen}
        />
      ) : <ClientSuccessWorkspace {...props} />}
    </>
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

function InspectionChecklistControl({
  job,
  templates,
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
  const checklistInspections = (job.inspections || EMPTY_LIST).filter((inspection) => inspection.checklist?.configured)
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
    items: [
      { key: 'item_1', prompt: '', required: true, allowNotApplicable: false, failureSeverity: 'medium' },
      { key: 'item_2', prompt: '', required: true, allowNotApplicable: false, failureSeverity: 'medium' },
    ],
  })

  const beginSchedule = () => {
    const first = templates.find((template) => template.status === 'active')
    setScheduleDraft({
      templateId: first?.id || '',
      title: first?.name || '',
      scheduledAt: toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
      inspector: operator?.name || '',
      notes: '',
    })
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
  const checklistItems = activeInspection?.checklist?.snapshot?.items || EMPTY_LIST
  const checklistReady = checklistItems.length > 0 && checklistItems.every((item) => {
    const response = responses[item.key]
    if (!response?.result) return !item.required
    if (response.result === 'fail' && !response.notes.trim() && !response.evidenceDocumentId) return false
    return response.result !== 'not_applicable' || item.allowNotApplicable
  })

  async function submitSchedule(event) {
    event.preventDefault()
    if (!scheduleDraft?.templateId || !toIsoDateTime(scheduleDraft.scheduledAt)) return
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
      setScheduleDraft({
        templateId: result.id,
        title: result.name,
        scheduledAt: toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
        inspector: operator?.name || '',
        notes: '',
      })
    }
  }

  async function submitChecklist(event) {
    event.preventDefault()
    if (!activeInspection || !checklistReady) return
    const result = await onSubmit(activeInspection, {
      entryKey: createFieldEvidenceDraftId(),
      notes: submissionNotes.trim(),
      responses: checklistItems
        .filter((item) => responses[item.key]?.result)
        .map((item) => ({
          itemKey: item.key,
          result: responses[item.key].result,
          notes: responses[item.key].notes.trim(),
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
          <h3>Inspection checklists</h3>
          <p>Versioned questions, field responses, corrective observations, and approval-backed sign-off.</p>
        </div>
        {canCoordinate ? (
          <div className="inspection-checklist-heading-actions">
            <button type="button" className="icon-button" aria-label="Create inspection template" title="Create inspection template" onClick={() => { setTemplateDraft(resetTemplateDraft()); setScheduleDraft(null); setActiveInspection(null) }}>
              <Plus size={17} />
            </button>
            <button type="button" className="secondary-button" disabled={!templates.length || submitting} onClick={beginSchedule}>
              <CalendarDays size={15} />Schedule
            </button>
          </div>
        ) : null}
      </div>

      {templateDraft ? (
        <form className="inspection-template-editor" data-testid="inspection-template-form" onSubmit={submitTemplate}>
          <div className="form-grid compact-form">
            <label>Template name<input autoFocus required minLength="3" maxLength="160" value={templateDraft.name} onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })} /></label>
            <label>Template key<input required pattern="[A-Za-z0-9_ -]+" value={templateDraft.templateKey} onChange={(event) => setTemplateDraft({ ...templateDraft, templateKey: event.target.value })} placeholder="facade_quality" /></label>
            <label>Type<input required value={templateDraft.inspectionType} onChange={(event) => setTemplateDraft({ ...templateDraft, inspectionType: event.target.value })} /></label>
            <label>Discipline<select value={templateDraft.discipline} onChange={(event) => setTemplateDraft({ ...templateDraft, discipline: event.target.value })}><option value="quality">Quality</option><option value="safety">Safety</option><option value="closeout">Closeout</option><option value="general">General</option></select></label>
          </div>
          <fieldset className="inspection-template-items">
            <legend>Checklist items</legend>
            {templateDraft.items.map((item, index) => (
              <div className="inspection-template-item" key={`${item.key}-${index}`}>
                <label className="inspection-template-prompt">Prompt<input required minLength="3" maxLength="300" value={item.prompt} onChange={(event) => setTemplateDraft({ ...templateDraft, items: templateDraft.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, prompt: event.target.value } : candidate) })} /></label>
                <label>Failure severity<select value={item.failureSeverity} onChange={(event) => setTemplateDraft({ ...templateDraft, items: templateDraft.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, failureSeverity: event.target.value } : candidate) })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
                <label className="checkbox-label"><input type="checkbox" checked={item.allowNotApplicable} onChange={(event) => setTemplateDraft({ ...templateDraft, items: templateDraft.items.map((candidate, itemIndex) => itemIndex === index ? { ...candidate, allowNotApplicable: event.target.checked } : candidate) })} />Allow N/A</label>
                <button type="button" className="icon-button" aria-label={`Remove checklist item ${index + 1}`} disabled={templateDraft.items.length <= 2} onClick={() => setTemplateDraft({ ...templateDraft, items: templateDraft.items.filter((_, itemIndex) => itemIndex !== index).map((candidate, itemIndex) => ({ ...candidate, key: `item_${itemIndex + 1}` })) })}><X size={15} /></button>
              </div>
            ))}
            <button type="button" className="secondary-button" disabled={templateDraft.items.length >= 50} onClick={() => setTemplateDraft({ ...templateDraft, items: [...templateDraft.items, { key: `item_${templateDraft.items.length + 1}`, prompt: '', required: true, allowNotApplicable: false, failureSeverity: 'medium' }] })}><Plus size={15} />Add item</button>
          </fieldset>
          <div className="form-actions"><button className="primary-button" disabled={submitting || templateDraft.items.some((item) => item.prompt.trim().length < 3)}><ClipboardCheck size={15} />Retain template</button><button type="button" className="secondary-button" onClick={() => setTemplateDraft(null)}>Cancel</button></div>
        </form>
      ) : null}

      {scheduleDraft ? (
        <form className="inspection-schedule-form form-grid compact-form" data-testid="inspection-schedule-form" onSubmit={submitSchedule}>
          <label>Template<select required value={scheduleDraft.templateId} onChange={(event) => { const template = templates.find((candidate) => candidate.id === event.target.value); setScheduleDraft({ ...scheduleDraft, templateId: event.target.value, title: template?.name || scheduleDraft.title }) }}>{templates.filter((template) => template.status === 'active').map((template) => <option key={template.id} value={template.id}>{template.name} / v{template.versionNumber}</option>)}</select></label>
          <label>Scheduled date and time<input required type="datetime-local" value={scheduleDraft.scheduledAt} onChange={(event) => setScheduleDraft({ ...scheduleDraft, scheduledAt: event.target.value })} /></label>
          <label className="form-span">Inspection title<input required minLength="3" maxLength="240" value={scheduleDraft.title} onChange={(event) => setScheduleDraft({ ...scheduleDraft, title: event.target.value })} /></label>
          <label>Inspector<input value={scheduleDraft.inspector} onChange={(event) => setScheduleDraft({ ...scheduleDraft, inspector: event.target.value })} /></label>
          <div className="inspection-template-summary"><strong>{scheduleTemplate?.items?.length || 0} checks</strong><span>{formatStatus(scheduleTemplate?.discipline || 'general')} / immutable v{scheduleTemplate?.versionNumber || '-'}</span></div>
          <div className="form-actions form-span"><button className="primary-button" disabled={submitting || !scheduleDraft.templateId || !toIsoDateTime(scheduleDraft.scheduledAt)}><CalendarDays size={15} />Schedule checklist</button><button type="button" className="secondary-button" onClick={() => setScheduleDraft(null)}>Cancel</button></div>
        </form>
      ) : null}

      {activeInspection ? (
        <form className="inspection-checklist-form" data-testid="inspection-checklist-form" onSubmit={submitChecklist}>
          <div className="inspection-checklist-run-heading"><div><strong>{activeInspection.title}</strong><small>{activeInspection.checklist.snapshot.templateName} / v{activeInspection.checklist.snapshot.templateVersion}</small></div><span className={`status status-${activeInspection.status}`}>{formatStatus(activeInspection.status)}</span></div>
          <div className="inspection-checklist-items">
            {checklistItems.map((item, index) => {
              const response = responses[item.key] || { result: '', notes: '', evidenceDocumentId: '' }
              return (
                <fieldset className={`inspection-checklist-item inspection-result-${response.result || 'pending'}`} key={item.key}>
                  <legend>{index + 1}. {item.prompt}</legend>
                  <div className="inspection-result-options" role="radiogroup" aria-label={`Result for ${item.prompt}`}>
                    {[['pass', 'Pass', Check], ['fail', 'Fail', TriangleAlert], ...(item.allowNotApplicable ? [['not_applicable', 'N/A', Ban]] : [])].map(([value, label, Icon]) => (
                      <label key={value} className={response.result === value ? 'selected' : ''}><input required={item.required} type="radio" name={`inspection-${item.key}`} value={value} checked={response.result === value} onChange={() => updateResponse(item.key, { result: value })} />{createElement(Icon, { size: 15 })}{label}</label>
                    ))}
                  </div>
                  <label>Item notes<textarea required={response.result === 'fail' && !response.evidenceDocumentId} value={response.notes} onChange={(event) => updateResponse(item.key, { notes: event.target.value })} placeholder={response.result === 'fail' ? 'Describe the defect, immediate control, or required correction.' : 'Optional retained context.'} /></label>
                  <label>Evidence link<select value={response.evidenceDocumentId} onChange={(event) => updateResponse(item.key, { evidenceDocumentId: event.target.value })}><option value="">No linked document</option>{(job.documents || EMPTY_LIST).map((document) => <option value={document.id} key={document.id}>{document.title || document.filename || document.id}</option>)}</select></label>
                  <small>{formatStatus(item.failureSeverity)} failure severity{item.allowNotApplicable ? ' / N/A allowed' : ''}</small>
                </fieldset>
              )
            })}
          </div>
          <label className="inspection-run-notes">Inspection summary<textarea maxLength="4000" value={submissionNotes} onChange={(event) => setSubmissionNotes(event.target.value)} placeholder="Record overall context, limitations, and follow-up." /></label>
          <p className="workflow-note">Submission freezes these responses, creates corrective observations for failed items, and requests approval. It does not certify statutory compliance or notify an external party.</p>
          <div className="form-actions"><button className="primary-button" disabled={submitting || !checklistReady}><ShieldCheck size={15} />{navigator.onLine === false ? 'Save checklist offline' : 'Submit for review'}</button><button type="button" className="secondary-button" onClick={() => setActiveInspection(null)}>Cancel</button></div>
        </form>
      ) : null}

      <div className="inspection-checklist-register">
        {checklistInspections.length ? checklistInspections.map((inspection) => {
          const summary = inspection.checklist.summary
          const pending = (job.approvals || EMPTY_LIST).find((approval) => approval.id === inspection.approvalId && approval.status === 'pending')
          const canFill = ['scheduled', 'in_progress', 'pending_review'].includes(inspection.status) && !pending
          return (
            <article className="inspection-checklist-row" key={inspection.id} data-testid={`inspection-checklist-${inspection.id}`}>
              <div><strong>{inspection.title}</strong><small>{inspection.checklist.snapshot.templateName} / v{inspection.checklist.snapshot.templateVersion} / {formatDateTime(inspection.scheduledAt)}</small><span>{summary ? `${summary.responseCount} responses / ${summary.failedCount} failed` : `${inspection.checklist.snapshot.items.length} checks waiting`}</span></div>
              <div className="inspection-checklist-row-actions"><span className={`status status-${inspection.status}`}>{formatStatus(inspection.status)}</span>{pending && canApprove ? <button type="button" className="secondary-button" onClick={() => onOpenApprovals({ approvalId: pending.id })}><ShieldCheck size={14} />Review</button> : null}{canFill ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => beginChecklist(inspection)}><ClipboardList size={14} />{inspection.checklist.submissions.length ? 'Correct and resubmit' : 'Complete'}</button> : null}</div>
            </article>
          )
        }) : <p className="workflow-note">No versioned inspection checklist has been scheduled for this job.</p>}
      </div>
      {fieldScoped ? <p className="workflow-note">Assigned field workers can complete scheduled checklists. Template and schedule control remain with the office.</p> : null}
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
  const [view, setView] = useState('punch_item')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState(() => emptyCloseoutDraft('punch_item'))
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  const punchItems = job.punchItems || EMPTY_LIST
  const warrantyClaims = job.warrantyClaims || EMPTY_LIST
  const aftercare = job.aftercare || EMPTY_LIST
  const visibleViews = fieldScoped
    ? [{ key: 'punch_item', label: 'Punch', count: punchItems.length }]
    : [
        { key: 'punch_item', label: 'Punch', count: punchItems.length },
        { key: 'warranty_claim', label: 'Warranty', count: warrantyClaims.length },
        { key: 'aftercare', label: 'Aftercare', count: aftercare.length },
      ]
  const records = view === 'warranty_claim' ? warrantyClaims : view === 'aftercare' ? aftercare : punchItems
  const canCreate = view === 'punch_item' ? canReportPunch : canCoordinate
  const activeStatuses = view === 'punch_item'
    ? new Set(['open', 'in_progress', 'pending_approval'])
    : view === 'warranty_claim'
      ? new Set(['open', 'under_review', 'pending_approval'])
      : new Set(['open', 'planned', 'due'])
  const openPunch = punchItems.filter((record) => !['closed', 'resolved', 'accepted', 'verified'].includes(record.status)).length
  const openWarranty = warrantyClaims.filter((record) => !['closed', 'resolved', 'accepted', 'rejected'].includes(record.status)).length
  const openAftercare = aftercare.filter((record) => !['completed', 'closed', 'cancelled'].includes(record.status)).length
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

  const invalidDraft = draft.title.trim().length < 3
    || (view === 'punch_item' && (draft.description.trim().length < 4 || draft.assignee.trim().length < 2))
    || (view === 'warranty_claim' && draft.issue.trim().length < 4)
    || (view === 'aftercare' && (draft.notes.trim().length < 4 || draft.owner.trim().length < 2))

  return (
    <section className="job-workspace-section closeout-register" data-testid="closeout-register">
      <div className="section-heading closeout-register-heading">
        <PackageCheck size={18} />
        <div>
          <h3>Closeout and aftercare</h3>
          <p>Retain defects, warranty issues, and follow-up work without asserting acceptance or contacting the client.</p>
        </div>
        {canCreate ? <button type="button" className="secondary-button" disabled={submitting} onClick={beginCreate}><Plus size={15} />{view === 'punch_item' ? 'New punch item' : view === 'warranty_claim' ? 'New warranty claim' : 'New follow-up'}</button> : null}
      </div>

      <div className="closeout-summary" aria-label="Closeout summary">
        <div><span>Open punch</span><strong>{openPunch}</strong></div>
        <div><span>Warranty</span><strong>{openWarranty}</strong></div>
        <div><span>Aftercare</span><strong>{openAftercare}</strong></div>
        <div><span>Pending review</span><strong>{pendingReview}</strong></div>
      </div>

      <div className={`closeout-tabs ${visibleViews.length === 1 ? 'single-tab' : ''}`} role="tablist" aria-label="Closeout record type">
        {visibleViews.map((option) => (
          <button type="button" role="tab" aria-selected={view === option.key} className={view === option.key ? 'active' : ''} key={option.key} onClick={() => selectView(option.key)}>{option.label} <span>{option.count}</span></button>
        ))}
      </div>

      {creating ? (
        <form className="closeout-form form-grid compact-form" data-testid={`closeout-${view}-form`} onSubmit={submitRecord}>
          {view === 'punch_item' ? (
            <>
              <label>Severity<select value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
              <label>Corrective due date<input required type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label>
              <label className="form-span">Punch title<input autoFocus required minLength="3" maxLength="240" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Incomplete, defective, or unverified work" /></label>
              <label>Assigned to<input required minLength="2" maxLength="160" value={draft.assignee} onChange={(event) => setDraft({ ...draft, assignee: event.target.value })} /></label>
              <label>Location<input maxLength="240" value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} placeholder="Room, elevation, grid, or asset" /></label>
              <label className="form-span">Observed condition<textarea required minLength="4" maxLength="4000" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Record the condition and completion criteria without assuming correction." /></label>
              <label className="form-span">Linked evidence<select value={draft.evidenceDocumentId} onChange={(event) => setDraft({ ...draft, evidenceDocumentId: event.target.value })}><option value="">No linked document</option>{(job.documents || EMPTY_LIST).map((document) => <option value={document.id} key={document.id}>{document.title || document.filename || document.id}</option>)}</select></label>
              {canCoordinate ? <label className="checkbox-label form-span"><input type="checkbox" checked={draft.clientVisible} onChange={(event) => setDraft({ ...draft, clientVisible: event.target.checked })} />Prepare for client-visible review; approval remains required</label> : null}
            </>
          ) : view === 'warranty_claim' ? (
            <>
              <label>Warranty type<select value={draft.warrantyType} onChange={(event) => setDraft({ ...draft, warrantyType: event.target.value })}><option value="workmanship">Workmanship</option><option value="material">Material</option><option value="manufacturer">Manufacturer</option><option value="service">Service</option><option value="other">Other</option></select></label>
              <label>Severity<select value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
              <label className="form-span">Claim title<input autoFocus required minLength="3" maxLength="240" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Reported post-completion issue" /></label>
              <label>Review due date<input required type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label>
              <label className="form-span">Reported issue<textarea required minLength="4" maxLength="4000" value={draft.issue} onChange={(event) => setDraft({ ...draft, issue: event.target.value })} placeholder="Retain the reported facts without admitting liability or promising a remedy." /></label>
            </>
          ) : (
            <>
              <label>Follow-up type<select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}><option value="client_follow_up">Client follow-up</option><option value="warranty_review">Warranty review</option><option value="maintenance_review">Maintenance review</option><option value="quality_check">Quality check</option></select></label>
              <label>Channel<select value={draft.channel} onChange={(event) => setDraft({ ...draft, channel: event.target.value })}><option value="portal">Portal</option><option value="phone">Phone</option><option value="email">Email</option><option value="site_visit">Site visit</option></select></label>
              <label className="form-span">Follow-up title<input autoFocus required minLength="3" maxLength="240" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Internal follow-up action" /></label>
              <label>Owner<input required minLength="2" maxLength="160" value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} /></label>
              <label>Due date<input required type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label>
              <label className="form-span">Follow-up purpose<textarea required minLength="4" maxLength="4000" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="What should be checked and what evidence should be retained?" /></label>
            </>
          )}
          <p className="workflow-note form-span">This retains an internal record only. It does not certify completion, accept liability, authorize cost, book work, or contact the client.</p>
          <div className="form-actions form-span">
            <button className="primary-button" disabled={submitting || invalidDraft || (view !== 'punch_item' && !online)}><ClipboardCheck size={15} />{view === 'punch_item' && !online ? 'Save punch item offline' : view !== 'punch_item' && !online ? 'Reconnect to retain' : view === 'punch_item' ? 'Retain punch item' : view === 'warranty_claim' ? 'Retain warranty claim' : 'Retain follow-up'}</button>
            <button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="closeout-records">
        {records.length ? records.map((record) => {
          const pending = (job.approvals || EMPTY_LIST).find((approval) => approval.id === record.approvalId && approval.status === 'pending')
          const detail = view === 'punch_item' ? record.data?.description : view === 'warranty_claim' ? record.data?.issue : record.notes
          const meta = view === 'punch_item'
            ? `${formatStatus(record.severity)} / ${record.assignee || 'Unassigned'} / due ${formatDate(record.dueAt)}`
            : view === 'warranty_claim'
              ? `${formatStatus(record.data?.warrantyType || 'workmanship')} / ${formatStatus(record.severity)} / due ${formatDate(record.dueAt)}`
              : `${formatStatus(record.type)} / ${record.owner || 'Unassigned'} / due ${formatDate(record.dueAt)}`
          return (
            <article className={`closeout-row ${view !== 'aftercare' ? `closeout-${record.severity}` : ''}`} key={record.id} data-testid={`closeout-${record.id}`}>
              <div className="closeout-row-copy"><div><strong>{record.title}</strong><span className={`status status-${record.status}`}>{formatStatus(record.status)}</span></div><small>{meta}</small>{detail ? <p>{detail}</p> : null}</div>
              <div className="closeout-row-actions">
                {pending ? <span className="tag tag-amber">Approval pending</span> : null}
                {pending && canApprove ? <button type="button" className="secondary-button" onClick={() => onOpenApprovals({ approvalId: pending.id })}><ShieldCheck size={14} />Review</button> : null}
                {!pending && canCoordinate && activeStatuses.has(record.status) ? <button type="button" className="secondary-button" disabled={submitting} onClick={() => onLifecycle(view, record)}><ClipboardCheck size={14} />{view === 'punch_item' ? 'Resolve punch' : view === 'warranty_claim' ? 'Resolve claim' : 'Complete follow-up'}</button> : null}
              </div>
            </article>
          )
        }) : <p className="workflow-note">No {view === 'punch_item' ? 'punch items' : view === 'warranty_claim' ? 'warranty claims' : 'aftercare follow-ups'} are retained for this job.</p>}
      </div>
      {fieldScoped ? <p className="workflow-note">Assigned field workers can capture punch evidence. Resolution, acceptance, and client visibility remain office-controlled.</p> : null}
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

export { AutomationControl, CapabilitySetupControl, ClientsWorkspace, ClientSuccessWorkspace, CloseoutRegister, CommercialControl, DayworkControl, FieldAssuranceWorkspace, FieldRiskControl, InspectionChecklistControl, NonconformanceControl, ProductionControl, ProjectControls, TakeoffControl, WorkPlanControl }
