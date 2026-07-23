import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Clock3, RefreshCw, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react'
import {
  createFieldEvidenceDraftId,
  enqueueFieldOperationDraft,
  shouldQueueFieldMutation,
} from '../field-outbox'
import { formatDateTime, formatStatus } from '../dashboard-format'

const CHECKS = [
  ['task_understood', 'I understand the work, sequence, and stop-work triggers.'],
  ['work_area_safe', 'The work area, access, and surrounding conditions are safe.'],
  ['controls_in_place', 'The approved controls are present and effective.'],
  ['ppe_ready', 'Required PPE is available, inspected, and in use.'],
  ['equipment_ready', 'Tools and equipment are suitable and safe to use.'],
  ['emergency_ready', 'Emergency arrangements and escape routes are understood.'],
  ['no_changed_conditions', 'No condition has changed since the plan was released.'],
]

function emptyDraft(job = null) {
  return {
    entryKey: createFieldEvidenceDraftId(),
    preTaskPlanId: '',
    taskId: '',
    workArea: job?.address || job?.city || '',
    activity: '',
    evidenceReference: '',
    observedHazards: '',
    stopWorkReason: '',
    resolutionNote: '',
    validForMinutes: '120',
    safeToStart: false,
    checks: Object.fromEntries(CHECKS.map(([key]) => [key, false])),
  }
}

function splitLines(value) {
  return String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean)
}

export default function LmraControl({
  jobs,
  fieldScoped,
  apiRequest,
  recordFieldOperation,
  notify,
  refresh,
  outboxScope,
  refreshOutboxState,
}) {
  const [jobId, setJobId] = useState('')
  const [jobDetail, setJobDetail] = useState(null)
  const [assessments, setAssessments] = useState([])
  const [draft, setDraft] = useState(() => emptyDraft())
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [queuedNotice, setQueuedNotice] = useState('')

  const activeJobs = useMemo(
    () => (jobs || []).filter(job => !['archived', 'completed', 'cancelled', 'rejected'].includes(job.status)),
    [jobs],
  )
  const plans = jobDetail?.preTaskPlans || []
  const tasks = (jobDetail?.tasks || []).filter(task => !['completed', 'closed', 'cancelled', 'rejected'].includes(task.status))
  const selectedPlan = plans.find(plan => plan.id === draft.preTaskPlanId) || null
  const planAssessments = assessments.filter(assessment => assessment.preTaskPlanId === draft.preTaskPlanId)
  const latestAssessment = planAssessments[0] || null
  const allChecksPassed = CHECKS.every(([key]) => draft.checks[key] === true)
  const readyRequested = allChecksPassed && draft.safeToStart
  const needsReassessmentEvidence = latestAssessment?.outcome === 'stop_work' && readyRequested

  const loadLmraData = useCallback(async (nextJobId, preferredPlanId = '') => {
    if (!nextJobId) {
      setJobDetail(null)
      setAssessments([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const [detailResult, assessmentResult] = await Promise.all([
        apiRequest(`/api/ledger/jobs/${encodeURIComponent(nextJobId)}`),
        apiRequest(`/api/ledger/jobs/${encodeURIComponent(nextJobId)}/lmra?limit=100`),
      ])
      const detail = detailResult.job || detailResult
      const retainedAssessments = assessmentResult.lmraAssessments || []
      const retainedPlans = detail.preTaskPlans || []
      const nextPlanId = retainedPlans.some(plan => plan.id === preferredPlanId)
        ? preferredPlanId
        : retainedPlans.find(plan => plan.readyForWork)?.id || retainedPlans[0]?.id || ''
      setJobDetail(detail)
      setAssessments(retainedAssessments)
      setDraft(current => ({
        ...current,
        preTaskPlanId: retainedPlans.some(plan => plan.id === current.preTaskPlanId) ? current.preTaskPlanId : nextPlanId,
        workArea: current.workArea || detail.address || detail.city || '',
      }))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [apiRequest])

  useEffect(() => {
    if (jobId && activeJobs.some(job => job.id === jobId)) return
    const nextJob = activeJobs[0] || null
    setJobId(nextJob?.id || '')
    setDraft(emptyDraft(nextJob))
  }, [activeJobs, jobId])

  useEffect(() => {
    loadLmraData(jobId)
  }, [jobId, loadLmraData])

  function selectJob(nextJobId) {
    const job = activeJobs.find(item => item.id === nextJobId) || null
    setJobId(nextJobId)
    setDraft(emptyDraft(job))
    setQueuedNotice('')
  }

  function resetDraft(planId = draft.preTaskPlanId) {
    const job = activeJobs.find(item => item.id === jobId) || null
    setDraft({ ...emptyDraft(job), preTaskPlanId: planId })
  }

  async function sendOrQueue(operation) {
    if (navigator.onLine === false) {
      await enqueueFieldOperationDraft(operation)
      await refreshOutboxState()
      return { queued: true }
    }
    try {
      return { result: await recordFieldOperation(operation) }
    } catch (requestError) {
      if (!shouldQueueFieldMutation(requestError)) throw requestError
      await enqueueFieldOperationDraft(operation)
      await refreshOutboxState()
      return { queued: true }
    }
  }

  async function submitAssessment(event) {
    event.preventDefault()
    if (!fieldScoped || !jobId || !selectedPlan) {
      setError('An authenticated field worker and retained pre-task plan are required.')
      return
    }
    if (draft.activity.trim().length < 3 || draft.workArea.trim().length < 2 || draft.evidenceReference.trim().length < 3) {
      setError('Retain the activity, work area, and evidence reference.')
      return
    }
    if (!readyRequested && draft.stopWorkReason.trim().length < 8) {
      setError('A failed or uncertain check requires a stop-work reason of at least eight characters.')
      return
    }
    if (needsReassessmentEvidence && draft.resolutionNote.trim().length < 8) {
      setError('Retain how the prior stop-work condition was resolved before reassessing.')
      return
    }
    const operation = {
      id: draft.entryKey,
      type: 'lmra_assessment',
      jobId,
      payload: {
        preTaskPlanId: selectedPlan.id,
        taskId: draft.taskId || null,
        workArea: draft.workArea.trim(),
        activity: draft.activity.trim(),
        clientCapturedAt: new Date().toISOString(),
        validForMinutes: Number(draft.validForMinutes),
        checks: draft.checks,
        safeToStart: draft.safeToStart,
        observedHazards: splitLines(draft.observedHazards),
        evidenceReference: draft.evidenceReference.trim(),
        stopWorkReason: readyRequested ? null : draft.stopWorkReason.trim(),
        reassessmentOfId: needsReassessmentEvidence ? latestAssessment.id : null,
        resolutionNote: needsReassessmentEvidence ? draft.resolutionNote.trim() : null,
      },
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    setQueuedNotice('')
    try {
      const outcome = await sendOrQueue(operation)
      if (outcome.queued) {
        setQueuedNotice('Saved on this device. Work is not authorized until the live ledger validates current sources; complete a new LMRA if this retry is older than 15 minutes.')
        notify('LMRA saved for exact retry. Work must remain stopped until live validation succeeds.')
        resetDraft(selectedPlan.id)
        return
      }
      const assessment = outcome.result.lmraAssessment
      notify(outcome.result.replayed
        ? 'This exact LMRA was already retained.'
        : assessment.readyForHazardousWork
          ? `LMRA ready until ${formatDateTime(assessment.validUntil)}. Reassess when conditions change.`
          : 'Stop-work LMRA retained. Resolve the condition and complete a linked reassessment.')
      resetDraft(selectedPlan.id)
      await Promise.all([loadLmraData(jobId, selectedPlan.id), refresh()])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="lmra-control" data-testid="lmra-control" aria-busy={loading || submitting || undefined}>
      <div className="panel-heading">
        <div>
          <h2>Last-minute risk assessment</h2>
          <p>Worker-owned checks against the exact current plan immediately before hazardous work.</p>
        </div>
        <div className="lmra-summary" aria-label="LMRA summary">
          <span className="tag">{assessments.filter(item => item.readyForHazardousWork).length} current</span>
          {assessments.some(item => item.outcome === 'stop_work' && item.isLatestForWorkerPlan) ? <span className="tag tag-red">Stop work</span> : null}
          <button type="button" className="icon-button" aria-label="Refresh LMRA records" title="Refresh" disabled={loading} onClick={() => loadLmraData(jobId, draft.preTaskPlanId)}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="lmra-selector">
        <label>
          Job
          <select required value={jobId} onChange={event => selectJob(event.target.value)}>
            <option value="">Select an assigned job</option>
            {activeJobs.map(job => <option key={job.id} value={job.id}>{job.title}</option>)}
          </select>
        </label>
        <label>
          Pre-task plan
          <select value={draft.preTaskPlanId} disabled={!jobId || !plans.length} onChange={event => setDraft({ ...draft, preTaskPlanId: event.target.value })}>
            <option value="">{plans.length ? 'Select the exact plan' : 'No retained plan'}</option>
            {plans.map(plan => (
              <option key={plan.id} value={plan.id}>{plan.planNumber} / {formatStatus(plan.effectiveStatus || plan.status)}</option>
            ))}
          </select>
        </label>
      </div>

      {error ? <div className="lmra-message lmra-message-error" role="alert"><ShieldAlert size={17} /><span>{error}</span></div> : null}
      {queuedNotice ? <div className="lmra-message lmra-message-warning" role="status"><Clock3 size={17} /><span>{queuedNotice}</span></div> : null}

      {selectedPlan ? (
        <div className={`lmra-source-state ${selectedPlan.readyForWork ? 'lmra-source-ready' : 'lmra-source-blocked'}`} aria-live="polite">
          {selectedPlan.readyForWork ? <ShieldCheck size={19} /> : <TriangleAlert size={19} />}
          <div>
            <strong>{selectedPlan.planNumber} / revision {selectedPlan.revisionNumber}</strong>
            <span>{selectedPlan.readyForWork ? 'Plan and worker acknowledgement are current.' : 'Source blockers remain; any submitted assessment will retain a stop-work outcome.'}</span>
          </div>
        </div>
      ) : jobId ? (
        <div className="lmra-message lmra-message-warning" role="status"><TriangleAlert size={17} /><span>No pre-task plan is available for this job.</span></div>
      ) : null}

      {fieldScoped && selectedPlan ? (
        <form className="lmra-form" onSubmit={submitAssessment}>
          <div className="lmra-form-grid">
            <label>
              Activity
              <input required minLength="3" maxLength="500" value={draft.activity} onChange={event => setDraft({ ...draft, activity: event.target.value })} placeholder="Hazardous task about to start" />
            </label>
            <label>
              Work area
              <input required minLength="2" maxLength="240" value={draft.workArea} onChange={event => setDraft({ ...draft, workArea: event.target.value })} />
            </label>
            <label>
              Linked task
              <select value={draft.taskId} onChange={event => setDraft({ ...draft, taskId: event.target.value })}>
                <option value="">No task selected</option>
                {tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
              </select>
            </label>
            <label>
              Validity
              <select value={draft.validForMinutes} onChange={event => setDraft({ ...draft, validForMinutes: event.target.value })}>
                <option value="60">1 hour</option>
                <option value="120">2 hours</option>
                <option value="240">4 hours maximum</option>
              </select>
            </label>
          </div>

          <fieldset className="lmra-checks">
            <legend>Check immediately before starting</legend>
            {CHECKS.map(([key, label]) => (
              <label className="lmra-check" key={key}>
                <input
                  type="checkbox"
                  checked={draft.checks[key]}
                  onChange={event => setDraft(current => ({ ...current, checks: { ...current.checks, [key]: event.target.checked } }))}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>

          <div className="lmra-form-grid">
            <label>
              Evidence reference
              <input required minLength="3" maxLength="240" value={draft.evidenceReference} onChange={event => setDraft({ ...draft, evidenceReference: event.target.value })} placeholder="Photo, field note, or device record" />
            </label>
            <label>
              Observed hazards
              <textarea maxLength="4000" value={draft.observedHazards} onChange={event => setDraft({ ...draft, observedHazards: event.target.value })} placeholder="One observation per line" />
            </label>
            {!readyRequested ? (
              <label className="lmra-form-span">
                Stop-work reason
                <textarea required minLength="8" maxLength="1000" value={draft.stopWorkReason} onChange={event => setDraft({ ...draft, stopWorkReason: event.target.value })} placeholder="Describe the failed, unknown, or changed condition" />
              </label>
            ) : null}
            {needsReassessmentEvidence ? (
              <label className="lmra-form-span">
                Prior condition resolution
                <textarea required minLength="8" maxLength="1000" value={draft.resolutionNote} onChange={event => setDraft({ ...draft, resolutionNote: event.target.value })} placeholder="What changed and what evidence confirms the control is now effective?" />
              </label>
            ) : null}
          </div>

          <label className="checkbox-label lmra-attestation">
            <input type="checkbox" checked={draft.safeToStart} onChange={event => setDraft({ ...draft, safeToStart: event.target.checked })} />
            Based on these checks, I confirm the work is safe to start now. I will stop and reassess if anything changes.
          </label>
          <button className={readyRequested ? 'primary-button' : 'danger-button'} disabled={submitting}>
            {readyRequested ? <Check size={16} /> : <TriangleAlert size={16} />}
            {submitting ? 'Validating...' : navigator.onLine === false ? 'Save evidence offline / keep work stopped' : readyRequested ? 'Validate and retain LMRA' : 'Retain stop-work LMRA'}
          </button>
        </form>
      ) : !fieldScoped ? (
        <p className="attendance-policy">LMRA answers are worker-owned actual evidence. Office roles can review records but cannot complete or clear an assessment for a worker.</p>
      ) : null}

      <div className="lmra-register" aria-live="polite">
        <div className="lmra-register-heading">
          <strong>Recent assessments</strong>
          <span>{assessments.length} retained</span>
        </div>
        {assessments.slice(0, 12).map(assessment => (
          <div className="lmra-row" key={assessment.id}>
            <span className={`lmra-row-icon ${assessment.readyForHazardousWork ? 'lmra-row-ready' : 'lmra-row-stop'}`} aria-hidden="true">
              {assessment.readyForHazardousWork ? <Check size={15} /> : <TriangleAlert size={15} />}
            </span>
            <div>
              <strong>{assessment.activity}</strong>
              <small>{assessment.workerName} / {assessment.workArea} / {formatDateTime(assessment.assessedAt)}</small>
              {assessment.stopWorkReason ? <span>{assessment.stopWorkReason}</span> : null}
            </div>
            <div className="lmra-row-status">
              <span className={`status status-${assessment.readyForHazardousWork ? 'active' : 'attention'}`}>
                {assessment.readyForHazardousWork ? 'ready' : formatStatus(assessment.outcome)}
              </span>
              <small>{assessment.readyForHazardousWork ? `until ${formatDateTime(assessment.validUntil)}` : assessment.expired ? 'expired' : 'review required'}</small>
            </div>
          </div>
        ))}
        {!assessments.length ? <div className="attendance-empty"><ShieldAlert size={20} /><span>No LMRA evidence is retained for this job.</span></div> : null}
      </div>

      <p className="attendance-policy">A current LMRA is a time-bounded operational check, not a certification of legal compliance or competence. Changed conditions always require stop-work and reassessment.</p>
    </section>
  )
}
