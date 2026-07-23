import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarCheck,
  Check,
  ClipboardCheck,
  Link2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Target,
  TriangleAlert,
  X,
} from 'lucide-react'
import Empty from './EmptyState'
import { formatDate, formatStatus } from '../dashboard-format'

const EMPTY_LIST = Object.freeze([])
const CONSTRAINT_CATEGORIES = [
  'design',
  'information',
  'material',
  'equipment',
  'labor',
  'access',
  'predecessor',
  'permit',
  'safety',
  'quality',
  'client_decision',
  'weather',
  'other',
]
const VARIANCE_CATEGORIES = [
  'prerequisite',
  'labor',
  'material',
  'equipment',
  'information',
  'access',
  'safety',
  'quality',
  'weather',
  'client_change',
  'overcommitment',
  'productivity',
  'other',
]

function entryKey(kind) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `last-planner-${kind}-${value}`
}

function offsetDate(value, days) {
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(milliseconds)) return value
  return new Date(milliseconds + days * 86_400_000).toISOString().slice(0, 10)
}

function hours(value) {
  const numeric = Number(value || 0)
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function candidateKey(candidate) {
  return `${candidate.jobId}:${candidate.taskId}:${candidate.workDate}`
}

export default function LastPlannerBoard({
  board,
  jobs,
  canApprove,
  submitting,
  onLoadWeek,
  onCreateConstraint,
  onReleaseConstraint,
  onRequestPlan,
  onReviewApproval,
  onRecordOutcome,
  onOpenJob,
}) {
  const [weekStart, setWeekStart] = useState(board?.week?.weekStart || '')
  const [selectedJobId, setSelectedJobId] = useState('')
  const [showConstraintForm, setShowConstraintForm] = useState(false)
  const [constraintDraft, setConstraintDraft] = useState({
    taskId: '', category: 'information', title: '', description: '', owner: '', dueDate: '', evidenceReference: '',
  })
  const [releaseDraft, setReleaseDraft] = useState(null)
  const [selectedCandidates, setSelectedCandidates] = useState({})
  const [promiseDrafts, setPromiseDrafts] = useState({})
  const [outcomeDraft, setOutcomeDraft] = useState(null)

  const candidates = board?.candidates || EMPTY_LIST
  const constraints = board?.constraints || EMPTY_LIST
  const plans = board?.plans || EMPTY_LIST
  const commitments = board?.commitments || EMPTY_LIST
  const dailyCycles = board?.dailyCycles || EMPTY_LIST
  const jobOptions = useMemo(() => {
    const found = new Map()
    for (const job of jobs || EMPTY_LIST) found.set(job.id, { id: job.id, title: job.title })
    for (const candidate of candidates) found.set(candidate.jobId, { id: candidate.jobId, title: candidate.jobTitle || candidate.jobId })
    for (const plan of plans) found.set(plan.jobId, { id: plan.jobId, title: plan.jobTitle || plan.jobId })
    for (const constraint of constraints) found.set(constraint.jobId, { id: constraint.jobId, title: constraint.jobTitle || constraint.jobId })
    return [...found.values()].sort((left, right) => left.title.localeCompare(right.title))
  }, [candidates, constraints, jobs, plans])

  useEffect(() => {
    if (board?.week?.weekStart) setWeekStart(board.week.weekStart)
  }, [board?.week?.weekStart])

  useEffect(() => {
    if (selectedJobId && jobOptions.some((job) => job.id === selectedJobId)) return
    setSelectedJobId(jobOptions[0]?.id || '')
  }, [jobOptions, selectedJobId])

  useEffect(() => {
    setSelectedCandidates({})
    setPromiseDrafts({})
    setOutcomeDraft(null)
  }, [selectedJobId, board?.week?.weekStart])

  const jobCandidates = candidates.filter((candidate) => candidate.jobId === selectedJobId)
  const jobConstraints = constraints.filter((constraint) => constraint.jobId === selectedJobId)
  const jobPlans = plans.filter((plan) => plan.jobId === selectedJobId)
  const activePlan = jobPlans.find((plan) => plan.status === 'pending_approval') || jobPlans.find((plan) => plan.status === 'approved') || null
  const jobCommitments = commitments.filter((commitment) => commitment.jobId === selectedJobId && commitment.planId === activePlan?.id)
  const availableTasks = useMemo(() => {
    const found = new Map()
    for (const candidate of jobCandidates) found.set(candidate.taskId, { id: candidate.taskId, title: candidate.taskTitle })
    for (const constraint of jobConstraints) {
      if (constraint.taskId) found.set(constraint.taskId, { id: constraint.taskId, title: constraint.taskTitle || constraint.taskId })
    }
    return [...found.values()]
  }, [jobCandidates, jobConstraints])
  const selectedJob = jobOptions.find((job) => job.id === selectedJobId) || null
  const selectedRows = jobCandidates.filter((candidate) => selectedCandidates[candidateKey(candidate)])

  function toggleCandidate(candidate) {
    const key = candidateKey(candidate)
    setSelectedCandidates((current) => ({ ...current, [key]: !current[key] }))
    setPromiseDrafts((current) => current[key] ? current : {
      ...current,
      [key]: {
        promise: candidate.taskTitle || 'Complete retained task scope',
        promisedBy: candidate.workerNames.join(', '),
        plannedHours: candidate.allocatedHours,
      },
    })
  }

  async function submitConstraint(event) {
    event.preventDefault()
    if (!selectedJobId) return
    const saved = await onCreateConstraint(selectedJobId, {
      ...constraintDraft,
      taskId: constraintDraft.taskId || null,
      weekStart: board?.week?.weekStart,
      entryKey: entryKey('constraint'),
    })
    if (saved) {
      setConstraintDraft({ taskId: '', category: 'information', title: '', description: '', owner: '', dueDate: '', evidenceReference: '' })
      setShowConstraintForm(false)
    }
  }

  async function submitRelease(event) {
    event.preventDefault()
    if (!releaseDraft?.constraintId) return
    const saved = await onReleaseConstraint(selectedJobId, releaseDraft.constraintId, {
      weekStart: board?.week?.weekStart,
      evidenceReference: releaseDraft.evidenceReference,
      entryKey: entryKey('release'),
    })
    if (saved) setReleaseDraft(null)
  }

  async function submitPlan() {
    if (!selectedJobId || !selectedRows.length) return
    const commitmentsPayload = selectedRows.map((candidate) => {
      const draft = promiseDrafts[candidateKey(candidate)] || {}
      return {
        taskId: candidate.taskId,
        workDate: candidate.workDate,
        promise: draft.promise,
        promisedBy: draft.promisedBy,
        plannedHours: Number(draft.plannedHours),
      }
    })
    const saved = await onRequestPlan(selectedJobId, {
      weekStart: board?.week?.weekStart,
      entryKey: entryKey('plan'),
      reason: 'Make-ready constraints, task-level crew hours, promise ownership, and weekly capacity reviewed.',
      commitments: commitmentsPayload,
    })
    if (saved) {
      setSelectedCandidates({})
      setPromiseDrafts({})
    }
  }

  async function submitOutcome(event) {
    event.preventDefault()
    if (!outcomeDraft) return
    const saved = await onRecordOutcome(selectedJobId, outcomeDraft.planId, outcomeDraft.commitmentId, {
      weekStart: board?.week?.weekStart,
      result: outcomeDraft.result,
      evidenceReferences: [outcomeDraft.evidenceReference],
      dailyCycleIds: [outcomeDraft.dailyCycleId],
      varianceCategory: outcomeDraft.result === 'not_completed' ? outcomeDraft.varianceCategory : null,
      varianceReason: outcomeDraft.result === 'not_completed' ? outcomeDraft.varianceReason : null,
      entryKey: entryKey('outcome'),
    })
    if (saved) setOutcomeDraft(null)
  }

  return (
    <section className="panel page-panel last-planner" data-testid="last-planner-board">
      <div className="panel-heading last-planner-heading">
        <div>
          <h2>Last Planner weekly control</h2>
          <p>Make-ready, weekly promises, daily actuals, PPC, and variance learning.</p>
        </div>
        <span className={`last-planner-state ${board?.ready ? 'state-ready' : 'state-blocked'}`}>
          {board?.ready ? 'Look-ahead current' : 'Look-ahead required'}
        </span>
      </div>

      <div className="last-planner-summary" aria-label="Last Planner summary">
        <div><span>Make-ready</span><strong>{board?.summary?.makeReadyCandidates || 0}/{board?.summary?.candidatePromises || 0}</strong></div>
        <div><span>Open constraints</span><strong>{board?.summary?.openConstraints || 0}</strong></div>
        <div><span>Weekly promises</span><strong>{board?.summary?.weeklyPromises || 0}</strong></div>
        <div><span>Complete</span><strong>{board?.summary?.completedPromises || 0}</strong></div>
        <div><span>Missed</span><strong>{board?.summary?.missedPromises || 0}</strong></div>
        <div><span>PPC</span><strong>{board?.summary?.ppcPercent == null ? 'Pending' : `${board.summary.ppcPercent}%`}</strong></div>
      </div>

      <div className="last-planner-toolbar">
        <button type="button" className="icon-button" aria-label="Previous week" title="Previous week" disabled={submitting} onClick={() => onLoadWeek(offsetDate(board?.week?.weekStart || weekStart, -7))}>
          <ArrowLeft size={17} />
        </button>
        <label>
          <span>Week starts</span>
          <input type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} />
        </label>
        <button type="button" className="secondary-button" disabled={submitting || !weekStart} onClick={() => onLoadWeek(weekStart)}>
          <RefreshCw size={16} />
          Load week
        </button>
        <button type="button" className="icon-button" aria-label="Next week" title="Next week" disabled={submitting} onClick={() => onLoadWeek(offsetDate(board?.week?.weekStart || weekStart, 7))}>
          <ArrowRight size={17} />
        </button>
        <label className="last-planner-job-select">
          <span>Job</span>
          <select value={selectedJobId} onChange={(event) => setSelectedJobId(event.target.value)}>
            <option value="">Select job</option>
            {jobOptions.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
          </select>
        </label>
        {selectedJob ? (
          <button type="button" className="icon-button" aria-label={`Open ${selectedJob.title}`} title="Open job" onClick={() => onOpenJob(selectedJob.id)}>
            <Link2 size={16} />
          </button>
        ) : null}
      </div>

      <div className="last-planner-workspace">
        <section className="last-planner-register" aria-labelledby="make-ready-heading">
          <div className="last-planner-register-heading">
            <div><h3 id="make-ready-heading">Make-ready register</h3><p>{formatDate(board?.week?.weekStart)} to {formatDate(board?.week?.weekEnd)}</p></div>
            <button type="button" className="secondary-button" disabled={!selectedJobId || submitting} onClick={() => setShowConstraintForm((current) => !current)}>
              {showConstraintForm ? <X size={16} /> : <Plus size={16} />}
              {showConstraintForm ? 'Close' : 'Add constraint'}
            </button>
          </div>
          {showConstraintForm ? (
            <form className="last-planner-constraint-form" onSubmit={submitConstraint}>
              <label><span>Task</span><select value={constraintDraft.taskId} onChange={(event) => setConstraintDraft((current) => ({ ...current, taskId: event.target.value }))}><option value="">Job-wide</option>{availableTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
              <label><span>Category</span><select value={constraintDraft.category} onChange={(event) => setConstraintDraft((current) => ({ ...current, category: event.target.value }))}>{CONSTRAINT_CATEGORIES.map((category) => <option key={category} value={category}>{formatStatus(category)}</option>)}</select></label>
              <label><span>Owner</span><input required minLength="2" maxLength="160" value={constraintDraft.owner} onChange={(event) => setConstraintDraft((current) => ({ ...current, owner: event.target.value }))} /></label>
              <label><span>Due date</span><input required type="date" value={constraintDraft.dueDate} onChange={(event) => setConstraintDraft((current) => ({ ...current, dueDate: event.target.value }))} /></label>
              <label className="last-planner-wide"><span>Constraint</span><input required minLength="3" maxLength="160" value={constraintDraft.title} onChange={(event) => setConstraintDraft((current) => ({ ...current, title: event.target.value }))} /></label>
              <label className="last-planner-wide"><span>Required condition</span><textarea required minLength="5" maxLength="2000" rows="2" value={constraintDraft.description} onChange={(event) => setConstraintDraft((current) => ({ ...current, description: event.target.value }))} /></label>
              <label className="last-planner-wide"><span>Source evidence</span><input required minLength="3" maxLength="500" value={constraintDraft.evidenceReference} onChange={(event) => setConstraintDraft((current) => ({ ...current, evidenceReference: event.target.value }))} /></label>
              <button type="submit" className="primary-button" disabled={submitting}><Plus size={16} />Retain constraint</button>
            </form>
          ) : null}
          <div className="last-planner-list">
            {jobConstraints.map((constraint) => (
              <div className={`last-planner-row constraint-${constraint.status}`} key={constraint.id}>
                <span className="last-planner-row-icon">{constraint.status === 'released' ? <Check size={16} /> : <TriangleAlert size={16} />}</span>
                <span><strong>{constraint.title}</strong><small>{formatStatus(constraint.category)} / {constraint.taskTitle || 'Job-wide'} / {constraint.owner}</small></span>
                <span><strong>{formatDate(constraint.dueDate)}</strong><small>{formatStatus(constraint.status)}</small></span>
                {constraint.status === 'open' ? (
                  releaseDraft?.constraintId === constraint.id ? (
                    <form className="last-planner-release-form" onSubmit={submitRelease}>
                      <label><span>Release evidence</span><input autoFocus required minLength="3" maxLength="500" value={releaseDraft.evidenceReference} onChange={(event) => setReleaseDraft({ ...releaseDraft, evidenceReference: event.target.value })} /></label>
                      <button type="submit" className="secondary-button" disabled={submitting}><Check size={15} />Release</button>
                      <button type="button" className="icon-button" aria-label="Cancel release" onClick={() => setReleaseDraft(null)}><X size={15} /></button>
                    </form>
                  ) : (
                    <button type="button" className="secondary-button" disabled={submitting} onClick={() => setReleaseDraft({ constraintId: constraint.id, evidenceReference: '' })}><Check size={15} />Release</button>
                  )
                ) : <span className="status status-approved">Released</span>}
              </div>
            ))}
            {!jobConstraints.length ? <Empty title="No make-ready constraints" detail="Retained constraints for the selected job and week appear here." /> : null}
          </div>
        </section>

        <section className="last-planner-register" aria-labelledby="weekly-promise-heading">
          <div className="last-planner-register-heading">
            <div><h3 id="weekly-promise-heading">Weekly promises</h3><p>{activePlan ? `Version ${activePlan.versionNumber} / ${formatStatus(activePlan.status)}` : 'No retained plan'}</p></div>
            {activePlan?.status === 'pending_approval' ? (
              <button type="button" className="primary-button" disabled={!canApprove} onClick={() => onReviewApproval(activePlan)}><ShieldCheck size={16} />Review decision</button>
            ) : (
              <button type="button" className="primary-button" disabled={submitting || !selectedRows.length || Boolean(activePlan)} onClick={submitPlan}><CalendarCheck size={16} />Request approval</button>
            )}
          </div>
          {!activePlan ? (
            <div className="last-planner-list promise-candidate-list">
              {jobCandidates.map((candidate) => {
                const key = candidateKey(candidate)
                const selected = Boolean(selectedCandidates[key])
                const draft = promiseDrafts[key] || {}
                return (
                  <div className={`last-planner-candidate ${candidate.ready ? 'candidate-ready' : 'candidate-blocked'}${selected ? ' candidate-selected' : ''}`} key={key}>
                    <label className="last-planner-candidate-toggle">
                      <input type="checkbox" checked={selected} disabled={!candidate.ready || candidate.alreadyPlanned} onChange={() => toggleCandidate(candidate)} />
                      <span><strong>{candidate.taskTitle}</strong><small>{formatDate(candidate.workDate)} / {hours(candidate.allocatedHours)}h / {candidate.workerNames.join(', ')}</small></span>
                      <span className={`status ${candidate.ready ? 'status-approved' : 'status-blocked'}`}>{candidate.ready ? 'Ready' : `${candidate.openConstraintIds.length} blocked`}</span>
                    </label>
                    {selected ? (
                      <div className="last-planner-promise-editor">
                        <label><span>Promise</span><input required minLength="5" maxLength="1000" value={draft.promise || ''} onChange={(event) => setPromiseDrafts((current) => ({ ...current, [key]: { ...current[key], promise: event.target.value } }))} /></label>
                        <label><span>Promised by</span><input required minLength="2" maxLength="160" value={draft.promisedBy || ''} onChange={(event) => setPromiseDrafts((current) => ({ ...current, [key]: { ...current[key], promisedBy: event.target.value } }))} /></label>
                        <label><span>Hours</span><input required type="number" min="0.25" max={candidate.allocatedHours} step="0.25" value={draft.plannedHours || ''} onChange={(event) => setPromiseDrafts((current) => ({ ...current, [key]: { ...current[key], plannedHours: event.target.value } }))} /></label>
                      </div>
                    ) : null}
                  </div>
                )
              })}
              {!jobCandidates.length ? <Empty title="No crew-backed promise candidates" detail="Approved task-level allocations in the selected week appear here." /> : null}
            </div>
          ) : (
            <div className="last-planner-list">
              {jobCommitments.map((commitment) => {
                const cycles = dailyCycles.filter((cycle) => cycle.jobId === commitment.jobId && cycle.workDate === commitment.workDate)
                const editing = outcomeDraft?.commitmentId === commitment.id
                return (
                  <div className="last-planner-commitment" key={commitment.id} data-testid="last-planner-commitment">
                    <div className="last-planner-commitment-main">
                      <span className="last-planner-row-icon"><Target size={16} /></span>
                      <span>
                        <strong>{commitment.promise}</strong>
                        <small>{commitment.taskTitle} / {commitment.promisedBy} / {hours(commitment.plannedHours)}h{commitment.atRisk ? ' / Constraint reopened' : ''}</small>
                      </span>
                      <span><strong>{formatDate(commitment.workDate)}</strong><small>{commitment.workerNames.join(', ')}</small></span>
                      {commitment.outcome ? (
                        <span className={`status ${commitment.outcome.result === 'completed' ? 'status-approved' : 'status-blocked'}`}>{formatStatus(commitment.outcome.result)}</span>
                      ) : activePlan.status === 'approved' ? (
                        <button type="button" className="secondary-button" disabled={submitting || !cycles.length} onClick={() => setOutcomeDraft({
                          planId: commitment.planId,
                          commitmentId: commitment.id,
                          result: 'completed',
                          evidenceReference: '',
                          dailyCycleId: cycles[0]?.id || '',
                          varianceCategory: 'prerequisite',
                          varianceReason: '',
                        })}><ClipboardCheck size={15} />Record outcome</button>
                      ) : <span className="status status-pending">Pending approval</span>}
                    </div>
                    {editing ? (
                      <form className="last-planner-outcome-form" onSubmit={submitOutcome}>
                        <label><span>Result</span><select value={outcomeDraft.result} onChange={(event) => setOutcomeDraft({ ...outcomeDraft, result: event.target.value })}><option value="completed">Completed</option><option value="not_completed">Not completed</option></select></label>
                        <label><span>Daily cycle</span><select required value={outcomeDraft.dailyCycleId} onChange={(event) => setOutcomeDraft({ ...outcomeDraft, dailyCycleId: event.target.value })}><option value="">Select closed cycle</option>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{formatDate(cycle.workDate)} / {formatStatus(cycle.shiftLabel)}</option>)}</select></label>
                        <label className="last-planner-wide"><span>Outcome evidence</span><input required minLength="3" maxLength="500" value={outcomeDraft.evidenceReference} onChange={(event) => setOutcomeDraft({ ...outcomeDraft, evidenceReference: event.target.value })} /></label>
                        {outcomeDraft.result === 'not_completed' ? <>
                          <label><span>Reason category</span><select value={outcomeDraft.varianceCategory} onChange={(event) => setOutcomeDraft({ ...outcomeDraft, varianceCategory: event.target.value })}>{VARIANCE_CATEGORIES.map((category) => <option key={category} value={category}>{formatStatus(category)}</option>)}</select></label>
                          <label className="last-planner-wide"><span>Learning reason</span><textarea required minLength="5" maxLength="2000" rows="2" value={outcomeDraft.varianceReason} onChange={(event) => setOutcomeDraft({ ...outcomeDraft, varianceReason: event.target.value })} /></label>
                        </> : null}
                        <button type="submit" className="primary-button" disabled={submitting}><Check size={15} />Retain outcome</button>
                        <button type="button" className="icon-button" aria-label="Cancel outcome" onClick={() => setOutcomeDraft(null)}><X size={15} /></button>
                      </form>
                    ) : null}
                  </div>
                )
              })}
              {!jobCommitments.length ? <Empty title="No weekly promises retained" detail="Approved or pending promises for the selected job appear here." /> : null}
            </div>
          )}
        </section>
      </div>

      <section className="last-planner-learning" aria-labelledby="last-planner-learning-heading">
        <div className="last-planner-register-heading">
          <div><h3 id="last-planner-learning-heading">PPC and variance learning</h3><p>Decided promises only</p></div>
          <BarChart3 size={18} />
        </div>
        <div className="last-planner-learning-body">
          <div className="last-planner-ppc">
            <strong>{board?.summary?.ppcPercent == null ? 'Pending' : `${board.summary.ppcPercent}%`}</strong>
            <span>Percent Plan Complete</span>
          </div>
          <div className="last-planner-variance-list">
            {Object.entries(board?.varianceReasons || {}).map(([category, count]) => (
              <div key={category}><span>{formatStatus(category)}</span><strong>{count}</strong></div>
            ))}
            {!Object.keys(board?.varianceReasons || {}).length ? <Empty title="No variance reasons" detail="Reasons appear after a weekly promise is retained as not completed." /> : null}
          </div>
        </div>
      </section>
    </section>
  )
}
