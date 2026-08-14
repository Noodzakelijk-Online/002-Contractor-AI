import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Clock3, RefreshCw, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react'
import {
  createFieldEvidenceDraftId,
  enqueueFieldOperationDraft,
  shouldQueueFieldMutation,
} from '../field-outbox'
import { formatDateTime, formatStatus } from '../dashboard-format'
import { operatorText } from '../operator-locale'

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
  locale = 'en-GB',
  jobs,
  fieldScoped,
  apiRequest,
  recordFieldOperation,
  notify,
  refresh,
  outboxScope,
  refreshOutboxState,
}) {
  const t = (key, variables) => operatorText(locale, key, variables)
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

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
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
      setError(t('An authenticated field worker and retained pre-task plan are required.'))
      return
    }
    if (draft.activity.trim().length < 3 || draft.workArea.trim().length < 2 || draft.evidenceReference.trim().length < 3) {
      setError(t('Retain the activity, work area, and evidence reference.'))
      return
    }
    if (!readyRequested && draft.stopWorkReason.trim().length < 8) {
      setError(t('A failed or uncertain check requires a stop-work reason of at least eight characters.'))
      return
    }
    if (needsReassessmentEvidence && draft.resolutionNote.trim().length < 8) {
      setError(t('Retain how the prior stop-work condition was resolved before reassessing.'))
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
        setQueuedNotice(t('Saved on this device. Work is not authorized until the live ledger validates current sources; complete a new LMRA if this retry is older than 15 minutes.'))
        notify(t('LMRA saved for exact retry. Work must remain stopped until live validation succeeds.'))
        resetDraft(selectedPlan.id)
        return
      }
      const assessment = outcome.result.lmraAssessment
      notify(outcome.result.replayed
        ? t('This exact LMRA was already retained.')
        : assessment.readyForHazardousWork
          ? t('LMRA ready until {time}. Reassess when conditions change.', { time: formatDateTime(assessment.validUntil) })
          : t('Stop-work LMRA retained. Resolve the condition and complete a linked reassessment.'))
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
          <h2>{t('Last-minute risk assessment')}</h2>
          <p>{t('Worker-owned checks against the exact current plan immediately before hazardous work.')}</p>
        </div>
        <div className="lmra-summary" aria-label={t('LMRA summary')}>
          <span className="tag">{t('{count} current', { count: assessments.filter(item => item.readyForHazardousWork).length })}</span>
          {assessments.some(item => item.outcome === 'stop_work' && item.isLatestForWorkerPlan) ? <span className="tag tag-red">{t('Stop work')}</span> : null}
          <button type="button" className="icon-button" aria-label={t('Refresh LMRA records')} title={t('Refresh')} disabled={loading} onClick={() => loadLmraData(jobId, draft.preTaskPlanId)}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="lmra-selector">
        <label>
          {t('Job')}
          <select required value={jobId} onChange={event => selectJob(event.target.value)}>
            <option value="">{t('Select an assigned job')}</option>
            {activeJobs.map(job => <option key={job.id} value={job.id}>{job.title}</option>)}
          </select>
        </label>
        <label>
          {t('Pre-task plan')}
          <select value={draft.preTaskPlanId} disabled={!jobId || !plans.length} onChange={event => updateDraft('preTaskPlanId', event.target.value)}>
            <option value="">{plans.length ? t('Select the exact plan') : t('No retained plan')}</option>
            {plans.map(plan => (
              <option key={plan.id} value={plan.id}>{plan.planNumber} / {t(formatStatus(plan.effectiveStatus || plan.status))}</option>
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
            <strong>{t('{plan} / revision {revision}', { plan: selectedPlan.planNumber, revision: selectedPlan.revisionNumber })}</strong>
            <span>{selectedPlan.readyForWork ? t('Plan and worker acknowledgement are current.') : t('Source blockers remain; any submitted assessment will retain a stop-work outcome.')}</span>
          </div>
        </div>
      ) : jobId ? (
        <div className="lmra-message lmra-message-warning" role="status"><TriangleAlert size={17} /><span>{t('No pre-task plan is available for this job.')}</span></div>
      ) : null}

      {fieldScoped && selectedPlan ? (
        <form className="lmra-form" aria-busy={loading || submitting} inert={loading || submitting ? true : undefined} onSubmit={submitAssessment}>
          <div className="lmra-form-grid">
            <label>
              {t('Activity')}
              <input required disabled={loading || submitting} minLength="3" maxLength="500" value={draft.activity} onChange={event => updateDraft('activity', event.target.value)} placeholder={t('Hazardous task about to start')} />
            </label>
            <label>
              {t('Work area')}
              <input required disabled={loading || submitting} minLength="2" maxLength="240" value={draft.workArea} onChange={event => updateDraft('workArea', event.target.value)} />
            </label>
            <label>
              {t('Linked task')}
              <select disabled={loading || submitting} value={draft.taskId} onChange={event => updateDraft('taskId', event.target.value)}>
                <option value="">{t('No task selected')}</option>
                {tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
              </select>
            </label>
            <label>
              {t('Validity')}
              <select disabled={loading || submitting} value={draft.validForMinutes} onChange={event => updateDraft('validForMinutes', event.target.value)}>
                <option value="60">{t('1 hour')}</option>
                <option value="120">{t('2 hours')}</option>
                <option value="240">{t('4 hours maximum')}</option>
              </select>
            </label>
          </div>

          <fieldset className="lmra-checks">
            <legend>{t('Check immediately before starting')}</legend>
            {CHECKS.map(([key, label]) => (
              <label className="lmra-check" key={key}>
                <input
                  type="checkbox"
                  disabled={loading || submitting}
                  checked={draft.checks[key]}
                  onChange={event => {
                    const checked = event.target.checked
                    setDraft(current => ({ ...current, checks: { ...current.checks, [key]: checked } }))
                  }}
                />
                <span>{t(label)}</span>
              </label>
            ))}
          </fieldset>

          <div className="lmra-form-grid">
            <label>
              {t('Evidence reference')}
              <input required disabled={loading || submitting} minLength="3" maxLength="240" value={draft.evidenceReference} onChange={event => updateDraft('evidenceReference', event.target.value)} placeholder={t('Photo, field note, or device record')} />
            </label>
            <label>
              {t('Observed hazards')}
              <textarea disabled={loading || submitting} maxLength="4000" value={draft.observedHazards} onChange={event => updateDraft('observedHazards', event.target.value)} placeholder={t('One observation per line')} />
            </label>
            {!readyRequested ? (
              <label className="lmra-form-span">
                {t('Stop-work reason')}
                <textarea required disabled={loading || submitting} minLength="8" maxLength="1000" value={draft.stopWorkReason} onChange={event => updateDraft('stopWorkReason', event.target.value)} placeholder={t('Describe the failed, unknown, or changed condition')} />
              </label>
            ) : null}
            {needsReassessmentEvidence ? (
              <label className="lmra-form-span">
                {t('Prior condition resolution')}
                <textarea required disabled={loading || submitting} minLength="8" maxLength="1000" value={draft.resolutionNote} onChange={event => updateDraft('resolutionNote', event.target.value)} placeholder={t('What changed and what evidence confirms the control is now effective?')} />
              </label>
            ) : null}
          </div>

          <label className="checkbox-label lmra-attestation">
            <input type="checkbox" disabled={loading || submitting} checked={draft.safeToStart} onChange={event => updateDraft('safeToStart', event.target.checked)} />
            {t('Based on these checks, I confirm the work is safe to start now. I will stop and reassess if anything changes.')}
          </label>
          <button className={readyRequested ? 'primary-button' : 'danger-button'} disabled={loading || submitting}>
            {readyRequested ? <Check size={16} /> : <TriangleAlert size={16} />}
            {submitting ? t('Validating...') : navigator.onLine === false ? t('Save evidence offline / keep work stopped') : readyRequested ? t('Validate and retain LMRA') : t('Retain stop-work LMRA')}
          </button>
        </form>
      ) : !fieldScoped ? (
        <p className="attendance-policy">{t('LMRA answers are worker-owned actual evidence. Office roles can review records but cannot complete or clear an assessment for a worker.')}</p>
      ) : null}

      <div className="lmra-register" aria-live="polite">
        <div className="lmra-register-heading">
          <strong>{t('Recent assessments')}</strong>
          <span>{t('{count} retained', { count: assessments.length })}</span>
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
                {assessment.readyForHazardousWork ? t('ready') : t(formatStatus(assessment.outcome))}
              </span>
              <small>{assessment.readyForHazardousWork ? t('until {time}', { time: formatDateTime(assessment.validUntil) }) : assessment.expired ? t('expired') : t('review required')}</small>
            </div>
          </div>
        ))}
        {!assessments.length ? <div className="attendance-empty"><ShieldAlert size={20} /><span>{t('No LMRA evidence is retained for this job.')}</span></div> : null}
      </div>

      <p className="attendance-policy">{t('A current LMRA is a time-bounded operational check, not a certification of legal compliance or competence. Changed conditions always require stop-work and reassessment.')}</p>
    </section>
  )
}
