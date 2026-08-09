import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ClipboardCheck, Plus, RefreshCw, ShieldAlert, Trash2, X } from 'lucide-react'
import {
  createFieldEvidenceDraftId,
  enqueueFieldOperationDraft,
  shouldQueueFieldMutation,
} from '../field-outbox'
import { formatDate, formatDateTime, formatStatus, futureDateInput } from '../dashboard-format'

const RELEASED_STATUSES = new Set(['approved_waiting_acknowledgement', 'active'])
const APPROVED_JHA_STATUSES = new Set(['approved', 'issued', 'accepted', 'completed', 'signed_off', 'client_visible'])
const CURRENT_SDS_STATUSES = new Set(['current', 'approved', 'accepted', 'active'])

function emptyStep(sequence = 1) {
  return {
    stepKey: `step_${sequence}`,
    description: '',
    hazards: '',
    controls: '',
  }
}

function emptyPlanDraft(operatorName = '') {
  return {
    entryKey: createFieldEvidenceDraftId(),
    supersedesPlanId: '',
    workDate: futureDateInput(0),
    shiftLabel: 'Day shift',
    title: '',
    location: '',
    preparedBy: operatorName,
    responsibleWorkerId: '',
    jhaId: '',
    workPermitId: '',
    sdsSheetIds: [],
    evidenceReference: '',
    emergencyArrangements: '',
    stopWorkTriggers: '',
    steps: [emptyStep()],
  }
}

function splitLines(value) {
  return String(value || '').split(/\r?\n|,/).map(item => item.trim()).filter(Boolean)
}

export default function PreTaskPlanControl({
  jobs,
  operator,
  fieldScoped,
  canCoordinate,
  apiRequest,
  recordFieldOperation,
  notify,
  refresh,
  outboxScope,
  refreshOutboxState,
}) {
  const operatorName = operator?.name || operator?.worker?.name || ''
  const [jobId, setJobId] = useState('')
  const [planId, setPlanId] = useState('')
  const [plans, setPlans] = useState([])
  const [jobDetail, setJobDetail] = useState(null)
  const [draft, setDraft] = useState(() => emptyPlanDraft(operatorName))
  const [acknowledgement, setAcknowledgement] = useState({ entryKey: createFieldEvidenceDraftId(), evidenceReference: '', acknowledged: false })
  const [suspension, setSuspension] = useState({ entryKey: createFieldEvidenceDraftId(), reason: '', evidenceReference: '' })
  const [closure, setClosure] = useState({ entryKey: createFieldEvidenceDraftId(), note: '', evidenceReference: '' })
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const activeJobs = useMemo(
    () => (jobs || []).filter(job => !['archived', 'completed', 'cancelled', 'rejected'].includes(job.status)),
    [jobs],
  )
  const selectedPlan = plans.find(plan => plan.id === planId) || null
  const assignments = (jobDetail?.assignments || []).filter(assignment => !['released', 'cancelled', 'completed', 'closed', 'rejected'].includes(assignment.status))
  const approvedJhas = (jobDetail?.jhas || []).filter(jha => APPROVED_JHA_STATUSES.has(jha.status))
  const activePermits = (jobDetail?.permits || []).filter(permit => permit.sourceHash && permit.status === 'active')
  const currentSdsSheets = (jobDetail?.sdsSheets || []).filter(sheet => CURRENT_SDS_STATUSES.has(sheet.status) && (!sheet.expiresAt || Date.parse(sheet.expiresAt) > Date.now()))
  const ownAttendee = selectedPlan?.attendees?.[0] || null

  const loadPlanData = useCallback(async (nextJobId, preferredPlanId = '') => {
    if (!nextJobId) {
      setPlans([])
      setJobDetail(null)
      setPlanId('')
      return
    }
    setLoading(true)
    setError('')
    try {
      const [detailResult, plansResult] = await Promise.all([
        apiRequest(`/api/ledger/jobs/${encodeURIComponent(nextJobId)}`),
        apiRequest(`/api/ledger/jobs/${encodeURIComponent(nextJobId)}/pre-task-plans?limit=100`),
      ])
      const retainedPlans = plansResult.preTaskPlans || []
      setJobDetail(detailResult.job || detailResult)
      setPlans(retainedPlans)
      setPlanId(current => (
        retainedPlans.some(plan => plan.id === preferredPlanId) ? preferredPlanId
          : retainedPlans.some(plan => plan.id === current) ? current
            : retainedPlans[0]?.id || ''
      ))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [apiRequest])

  useEffect(() => {
    if (jobId && activeJobs.some(job => job.id === jobId)) return
    const nextJobId = activeJobs[0]?.id || ''
    setJobId(nextJobId)
    setDraft(current => ({ ...emptyPlanDraft(operatorName), preparedBy: current.preparedBy || operatorName }))
  }, [activeJobs, jobId, operatorName])

  useEffect(() => {
    loadPlanData(jobId)
  }, [jobId, loadPlanData])

  function selectJob(nextJobId) {
    setJobId(nextJobId)
    setPlanId('')
    setDraft({ ...emptyPlanDraft(operatorName), preparedBy: operatorName })
    setAcknowledgement({ entryKey: createFieldEvidenceDraftId(), evidenceReference: '', acknowledged: false })
    setSuspension({ entryKey: createFieldEvidenceDraftId(), reason: '', evidenceReference: '' })
    setClosure({ entryKey: createFieldEvidenceDraftId(), note: '', evidenceReference: '' })
  }

  function updateStep(index, field, value) {
    setDraft(current => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, [field]: value } : step),
    }))
  }

  function addStep() {
    setDraft(current => current.steps.length >= 25 ? current : ({ ...current, steps: [...current.steps, emptyStep(current.steps.length + 1)] }))
  }

  function removeStep(index) {
    setDraft(current => current.steps.length === 1 ? current : ({
      ...current,
      steps: current.steps.filter((_, stepIndex) => stepIndex !== index).map((step, stepIndex) => ({ ...step, stepKey: `step_${stepIndex + 1}` })),
    }))
  }

  function toggleSds(sheetId) {
    setDraft(current => ({
      ...current,
      sdsSheetIds: current.sdsSheetIds.includes(sheetId)
        ? current.sdsSheetIds.filter(id => id !== sheetId)
        : [...current.sdsSheetIds, sheetId],
    }))
  }

  async function createPlan(event) {
    event.preventDefault()
    const steps = draft.steps.map((step, index) => ({
      stepKey: `step_${index + 1}`,
      description: step.description.trim(),
      hazards: splitLines(step.hazards),
      controls: splitLines(step.controls),
    }))
    if (!canCoordinate || !jobId || !draft.jhaId || steps.some(step => step.description.length < 3 || !step.hazards.length || !step.controls.length)) {
      setError('Retain an approved JHA and at least one hazard and control for every work step.')
      return
    }
    if (navigator.onLine === false) {
      setError('Reconnect before requesting release so current safety sources and assigned crew can be frozen.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await apiRequest(`/api/ledger/jobs/${encodeURIComponent(jobId)}/pre-task-plans`, {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          steps,
          stopWorkTriggers: splitLines(draft.stopWorkTriggers),
          responsibleWorkerId: draft.responsibleWorkerId || null,
          workPermitId: draft.workPermitId || null,
          supersedesPlanId: draft.supersedesPlanId || null,
        }),
      })
      notify(result.replayed
        ? 'This pre-task plan was already retained; no duplicate approval was created.'
        : draft.supersedesPlanId
          ? 'The current revision was frozen for approval and the prior plan was superseded.'
          : 'Plan sources, steps, controls, and assigned crew were frozen for approval.')
      setDraft({ ...emptyPlanDraft(operatorName), preparedBy: operatorName })
      await Promise.all([loadPlanData(jobId, result.preTaskPlan.id), refresh()])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function sendOrQueue(operation, successMessage, queuedMessage) {
    if (navigator.onLine === false) {
      await enqueueFieldOperationDraft(operation)
      await refreshOutboxState()
      notify(queuedMessage)
      return { queued: true }
    }
    try {
      const result = await recordFieldOperation(operation)
      notify(result.replayed ? 'This field action was already retained; no duplicate evidence was created.' : successMessage)
      return { result }
    } catch (requestError) {
      if (!shouldQueueFieldMutation(requestError)) throw requestError
      await enqueueFieldOperationDraft(operation)
      await refreshOutboxState()
      notify(queuedMessage)
      return { queued: true }
    }
  }

  async function acknowledgePlan(event) {
    event.preventDefault()
    if (!fieldScoped || !selectedPlan || !acknowledgement.acknowledged || acknowledgement.evidenceReference.trim().length < 3) {
      setError('Confirm the plan attestation and retain an evidence reference.')
      return
    }
    const operation = {
      id: acknowledgement.entryKey,
      type: 'pre_task_plan_acknowledgement',
      jobId: selectedPlan.jobId,
      payload: {
        planId: selectedPlan.id,
        acknowledged: true,
        evidenceReference: acknowledgement.evidenceReference.trim(),
        attestation: 'I reviewed the retained steps, hazards, controls, linked sources, and stop-work triggers.',
      },
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    try {
      const outcome = await sendOrQueue(
        operation,
        'Your acknowledgement was retained against this exact plan revision.',
        'The acknowledgement was saved locally for an exact worker-scoped retry.',
      )
      setAcknowledgement({ entryKey: createFieldEvidenceDraftId(), evidenceReference: '', acknowledged: false })
      if (!outcome.queued) await Promise.all([loadPlanData(jobId, selectedPlan.id), refresh()])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function suspendPlan(event) {
    event.preventDefault()
    if (!selectedPlan || suspension.reason.trim().length < 8 || suspension.evidenceReference.trim().length < 3) {
      setError('Retain a stop-work reason and evidence reference.')
      return
    }
    const operation = {
      id: suspension.entryKey,
      type: 'pre_task_plan_suspension',
      jobId: selectedPlan.jobId,
      payload: {
        planId: selectedPlan.id,
        reason: suspension.reason.trim(),
        evidenceReference: suspension.evidenceReference.trim(),
      },
      operatorScope: outboxScope,
    }
    setSubmitting(true)
    setError('')
    try {
      const outcome = await sendOrQueue(
        operation,
        'Plan suspended. Work must remain stopped until an approved revision is issued.',
        'The stop-work action was saved locally for an exact retry.',
      )
      setSuspension({ entryKey: createFieldEvidenceDraftId(), reason: '', evidenceReference: '' })
      if (!outcome.queued) await Promise.all([loadPlanData(jobId, selectedPlan.id), refresh()])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function closePlan(event) {
    event.preventDefault()
    if (!canCoordinate || !selectedPlan || closure.note.trim().length < 8 || closure.evidenceReference.trim().length < 3) {
      setError('Retain a completion note and closeout evidence reference before closing this plan.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await apiRequest(`/api/ledger/jobs/${encodeURIComponent(selectedPlan.jobId)}/pre-task-plans/${encodeURIComponent(selectedPlan.id)}/close`, {
        method: 'POST',
        body: JSON.stringify(closure),
      })
      notify(result.replayed ? 'This plan closeout was already retained.' : 'Pre-task plan closed with retained handback evidence.')
      setClosure({ entryKey: createFieldEvidenceDraftId(), note: '', evidenceReference: '' })
      await Promise.all([loadPlanData(jobId, selectedPlan.id), refresh()])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function revisePlan() {
    if (!selectedPlan || !canCoordinate) return
    setDraft({
      ...emptyPlanDraft(operatorName),
      supersedesPlanId: selectedPlan.id,
      workDate: futureDateInput(0),
      shiftLabel: selectedPlan.shiftLabel,
      title: selectedPlan.title,
      location: selectedPlan.location,
      preparedBy: operatorName,
      responsibleWorkerId: selectedPlan.responsibleWorkerId || '',
      jhaId: selectedPlan.jhaId,
      workPermitId: selectedPlan.workPermitId || '',
      sdsSheetIds: selectedPlan.sdsSheetIds || [],
      evidenceReference: selectedPlan.evidenceReference,
      emergencyArrangements: selectedPlan.emergencyArrangements || '',
      stopWorkTriggers: (selectedPlan.stopWorkTriggers || []).join('\n'),
      steps: (selectedPlan.steps || []).map((step, index) => ({
        stepKey: `step_${index + 1}`,
        description: step.description,
        hazards: (step.hazards || []).join('\n'),
        controls: (step.controls || []).join('\n'),
      })),
    })
    document.getElementById('pre-task-plan-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className="pre-task-plan-control" data-testid="pre-task-plan-control" aria-busy={loading || submitting || undefined}>
      <div className="panel-heading">
        <div>
          <h2>Pre-task plans</h2>
          <p>Daily work steps, linked safety sources, frozen crew, and exact worker acceptance.</p>
        </div>
        <div className="pre-task-summary">
          <span className="tag">{plans.filter(plan => RELEASED_STATUSES.has(plan.status)).length} released</span>
          {plans.some(plan => plan.status === 'pending_approval') ? <span className="tag tag-amber">Approval pending</span> : null}
          <button type="button" className="icon-button" aria-label="Refresh pre-task plans" title="Refresh" disabled={loading} onClick={() => loadPlanData(jobId, planId)}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="pre-task-selector">
        <label>
          Job
          <select required value={jobId} onChange={event => selectJob(event.target.value)}>
            <option value="">Select an assigned job</option>
            {activeJobs.map(job => <option key={job.id} value={job.id}>{job.title}</option>)}
          </select>
        </label>
        <label>
          Plan
          <select value={planId} disabled={!jobId || !plans.length} onChange={event => setPlanId(event.target.value)}>
            <option value="">{plans.length ? 'Select a retained plan' : 'No retained plan'}</option>
            {plans.map(plan => (
              <option key={plan.id} value={plan.id}>{plan.planNumber} / {plan.title} / {formatStatus(plan.effectiveStatus || plan.status)}</option>
            ))}
          </select>
        </label>
      </div>

      {error ? <div className="pre-task-error" role="alert"><ShieldAlert size={16} /><span>{error}</span></div> : null}

      {selectedPlan ? (
        <div className="pre-task-detail">
          <div className="pre-task-context">
            <div>
              <strong>{selectedPlan.planNumber} / revision {selectedPlan.revisionNumber}</strong>
              <small>{selectedPlan.title} / {selectedPlan.location} / {formatDate(selectedPlan.workDate)} / {selectedPlan.shiftLabel}</small>
            </div>
            <div className="pre-task-state">
              <span className={`status status-${selectedPlan.readyForWork ? 'ready' : selectedPlan.status}`}>{formatStatus(selectedPlan.effectiveStatus || selectedPlan.status)}</span>
              <span className={`tag ${selectedPlan.definitionIntegrityValid ? '' : 'tag-red'}`}>Plan {selectedPlan.definitionIntegrityValid ? 'verified' : 'changed'}</span>
              <span className={`tag ${selectedPlan.prerequisitesCurrent ? '' : 'tag-red'}`}>Sources {selectedPlan.prerequisitesCurrent ? 'current' : 'review'}</span>
              {canCoordinate && !['closed', 'superseded'].includes(selectedPlan.status) ? (
                <button type="button" className="secondary-button" onClick={revisePlan}><RefreshCw size={15} /> Revise</button>
              ) : null}
            </div>
          </div>

          {selectedPlan.blockers?.length ? (
            <div className="pre-task-blockers"><ShieldAlert size={17} /><ul>{selectedPlan.blockers.map((blocker, index) => <li key={`${blocker.type}-${index}`}>{blocker.message}</li>)}</ul></div>
          ) : null}

          <div className="pre-task-source-strip">
            <span><strong>JHA</strong>{selectedPlan.jhaId}</span>
            <span><strong>Permit</strong>{selectedPlan.workPermitId || 'Not required'}</span>
            <span><strong>SDS</strong>{selectedPlan.sdsSheetIds?.length || 0} linked</span>
            <span><strong>Evidence</strong>{selectedPlan.evidenceReference}</span>
          </div>

          <div className="pre-task-steps">
            {(selectedPlan.steps || []).map(step => (
              <div className="pre-task-step" key={step.stepKey}>
                <span className="pre-task-step-number">{step.sequence}</span>
                <div><strong>{step.description}</strong><small>{(step.hazards || []).join(' / ')}</small></div>
                <div><strong>Controls</strong><small>{(step.controls || []).join(' / ')}</small></div>
              </div>
            ))}
          </div>

          <div className="pre-task-attendees">
            {(selectedPlan.attendees || []).map(attendee => (
              <div className="pre-task-attendee" key={attendee.id}>
                <span className={`pre-task-attendee-marker ${attendee.status === 'acknowledged' ? 'pre-task-attendee-ready' : ''}`} aria-hidden="true" />
                <div><strong>{attendee.attendeeName}</strong><small>{attendee.company || 'Assigned crew'}{attendee.acknowledgedAt ? ` / ${formatDateTime(attendee.acknowledgedAt)}` : ''}</small></div>
                <span className={`status status-${attendee.status}`}>{formatStatus(attendee.status)}</span>
              </div>
            ))}
          </div>

          {fieldScoped && RELEASED_STATUSES.has(selectedPlan.status) && ownAttendee?.status === 'expected' ? (
            <form className="pre-task-acknowledgement" onSubmit={acknowledgePlan}>
              <label>
                Evidence reference
                <input required minLength="3" maxLength="240" value={acknowledgement.evidenceReference} onChange={event => setAcknowledgement({ ...acknowledgement, evidenceReference: event.target.value })} placeholder="Device, badge, or signed record" />
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={acknowledgement.acknowledged} onChange={event => setAcknowledgement({ ...acknowledgement, acknowledged: event.target.checked })} />
                <span>I reviewed this exact revision and will stop work if conditions change.</span>
              </label>
              <button className="primary-button" disabled={submitting}><Check size={16} /> {navigator.onLine === false ? 'Save offline' : 'Acknowledge'}</button>
            </form>
          ) : null}

          {RELEASED_STATUSES.has(selectedPlan.status) && (fieldScoped || canCoordinate) ? (
            <form className="pre-task-suspension" onSubmit={suspendPlan}>
              <div className="pre-task-action-heading"><strong>Stop work</strong><span>Immediate safety action with retained evidence.</span></div>
              <label>Reason<input required disabled={submitting || loading} minLength="8" maxLength="1000" value={suspension.reason} onChange={event => { const value = event.target.value; setSuspension(current => ({ ...current, reason: value })) }} /></label>
              <label>Evidence reference<input required disabled={submitting || loading} minLength="3" maxLength="240" value={suspension.evidenceReference} onChange={event => { const value = event.target.value; setSuspension(current => ({ ...current, evidenceReference: value })) }} /></label>
              <button className="danger-button" disabled={submitting}><X size={16} /> {navigator.onLine === false ? 'Save stop offline' : 'Suspend'}</button>
            </form>
          ) : null}

          {canCoordinate && ['active', 'suspended'].includes(selectedPlan.status) ? (
            <form className="pre-task-closure" onSubmit={closePlan}>
              <div className="pre-task-action-heading"><strong>Close plan</strong><span>Retain handback and completion evidence.</span></div>
              <label>Completion note<input required disabled={submitting || loading} minLength="8" maxLength="1000" value={closure.note} onChange={event => { const value = event.target.value; setClosure(current => ({ ...current, note: value })) }} /></label>
              <label>Closeout evidence<input required disabled={submitting || loading} minLength="3" maxLength="240" value={closure.evidenceReference} onChange={event => { const value = event.target.value; setClosure(current => ({ ...current, evidenceReference: value })) }} /></label>
              <button className="secondary-button" disabled={submitting}><ClipboardCheck size={16} /> Close plan</button>
            </form>
          ) : null}
        </div>
      ) : null}

      {canCoordinate ? (
        <form id="pre-task-plan-editor" className="pre-task-create" onSubmit={createPlan}>
          <div className="pre-task-create-heading">
            <strong>{draft.supersedesPlanId ? 'Prepare revision' : 'Prepare plan'}</strong>
            {draft.supersedesPlanId ? <button type="button" className="icon-button" aria-label="Cancel revision" title="Cancel revision" onClick={() => setDraft({ ...emptyPlanDraft(operatorName), preparedBy: operatorName })}><X size={16} /></button> : null}
          </div>
          <label>Work date<input required type="date" min={futureDateInput(0)} max={futureDateInput(90)} value={draft.workDate} onChange={event => setDraft({ ...draft, workDate: event.target.value })} /></label>
          <label>Shift<input required minLength="2" maxLength="120" value={draft.shiftLabel} onChange={event => setDraft({ ...draft, shiftLabel: event.target.value })} /></label>
          <label>Title<input required minLength="3" maxLength="240" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>Location<input required minLength="2" maxLength="240" value={draft.location} onChange={event => setDraft({ ...draft, location: event.target.value })} /></label>
          <label>Prepared by<input required minLength="2" maxLength="160" value={draft.preparedBy} onChange={event => setDraft({ ...draft, preparedBy: event.target.value })} /></label>
          <label>
            Responsible worker
            <select value={draft.responsibleWorkerId} onChange={event => setDraft({ ...draft, responsibleWorkerId: event.target.value })}>
              <option value="">Shared crew responsibility</option>
              {assignments.map(assignment => <option key={assignment.id} value={assignment.workerId}>{assignment.workerName}</option>)}
            </select>
          </label>
          <label>
            Approved JHA
            <select required value={draft.jhaId} onChange={event => setDraft({ ...draft, jhaId: event.target.value })}>
              <option value="">Select an approved JHA</option>
              {approvedJhas.map(jha => <option key={jha.id} value={jha.id}>{jha.title} / {formatStatus(jha.status)}</option>)}
            </select>
          </label>
          <label>
            Work permit
            <select value={draft.workPermitId} onChange={event => setDraft({ ...draft, workPermitId: event.target.value })}>
              <option value="">Not required</option>
              {activePermits.map(permit => <option key={permit.id} value={permit.id}>{permit.title}</option>)}
            </select>
          </label>
          <label>Source evidence<input required minLength="3" maxLength="240" value={draft.evidenceReference} onChange={event => setDraft({ ...draft, evidenceReference: event.target.value })} /></label>
          <label className="form-span">Emergency arrangements<textarea maxLength="2000" value={draft.emergencyArrangements} onChange={event => setDraft({ ...draft, emergencyArrangements: event.target.value })} /></label>
          <label className="form-span">Stop-work triggers<textarea maxLength="3000" value={draft.stopWorkTriggers} onChange={event => setDraft({ ...draft, stopWorkTriggers: event.target.value })} placeholder="One trigger per line" /></label>

          {currentSdsSheets.length ? (
            <fieldset className="pre-task-sds form-span">
              <legend>Linked SDS sheets</legend>
              {currentSdsSheets.map(sheet => (
                <label key={sheet.id} className="checkbox-label">
                  <input type="checkbox" checked={draft.sdsSheetIds.includes(sheet.id)} onChange={() => toggleSds(sheet.id)} />
                  <span>{sheet.material}{sheet.supplier ? ` / ${sheet.supplier}` : ''}</span>
                </label>
              ))}
            </fieldset>
          ) : null}

          <div className="pre-task-step-editor form-span">
            <div className="pre-task-step-editor-heading"><strong>Work steps</strong><button type="button" className="secondary-button" disabled={draft.steps.length >= 25} onClick={addStep}><Plus size={15} /> Add step</button></div>
            {draft.steps.map((step, index) => (
              <div className="pre-task-step-form" key={step.stepKey}>
                <span>{index + 1}</span>
                <label>Description<input required minLength="3" maxLength="500" value={step.description} onChange={event => updateStep(index, 'description', event.target.value)} /></label>
                <label>Hazards<textarea required minLength="2" maxLength="4000" value={step.hazards} onChange={event => updateStep(index, 'hazards', event.target.value)} /></label>
                <label>Controls<textarea required minLength="2" maxLength="4000" value={step.controls} onChange={event => updateStep(index, 'controls', event.target.value)} /></label>
                <button type="button" className="icon-button" aria-label={`Remove work step ${index + 1}`} title="Remove step" disabled={draft.steps.length === 1} onClick={() => removeStep(index)}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>

          <div className="pre-task-create-actions form-span">
            <span>{assignments.length} assigned worker{assignments.length === 1 ? '' : 's'} will be frozen into this revision.</span>
            <button className="primary-button" disabled={submitting || loading || !approvedJhas.length || !assignments.length}><ClipboardCheck size={16} /> {submitting ? 'Freezing...' : 'Request release'}</button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
