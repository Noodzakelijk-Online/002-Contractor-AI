import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  Clock3,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UserRoundCog,
  X,
} from 'lucide-react'
import Empty from './EmptyState'
import { formatDate, formatStatus, formatWeekday } from '../dashboard-format'
import { operatorText } from '../operator-locale'

const EMPTY_LIST = Object.freeze([])
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DEFAULT_DAILY_HOURS = {
  sunday: 0,
  monday: 8,
  tuesday: 8,
  wednesday: 8,
  thursday: 8,
  friday: 8,
  saturday: 0,
}

function dateOffset(value, days) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) return value
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10)
}

function hours(value) {
  const numeric = Number(value || 0)
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function utilizationClass(percent) {
  if (percent > 100) return 'capacity-critical'
  if (percent >= 85) return 'capacity-warning'
  if (percent > 0) return 'capacity-active'
  return 'capacity-idle'
}

function summaryStatus(board, t) {
  if (board?.plans?.current) return { key: 'approved', label: t('Approved and current') }
  if (board?.plans?.pending) return { key: 'pending', label: t('Pending approval') }
  if (board?.plans?.stale) return { key: 'stale', label: t('Approved plan is stale') }
  if (board?.ready) return { key: 'ready', label: t('Ready for approval') }
  return { key: 'blocked', label: t('Planning blockers') }
}

function blockerMessage(blocker, t) {
  switch (blocker?.type) {
    case 'capacity_profile_missing':
      return t('{worker} has planned hours but no explicit capacity profile.', { worker: blocker.workerName })
    case 'worker_unavailable':
      return t('{worker} is offline but still has planned hours.', { worker: blocker.workerName })
    case 'crew_overload':
      return t('{worker} is overloaded on {date}.', { worker: blocker.workerName, date: formatDate(blocker.date) })
    case 'crew_unavailable_allocation':
      return t('{worker} has planned work during retained unavailability on {date}.', { worker: blocker.workerName, date: formatDate(blocker.date) })
    case 'task_capacity_gap':
      return t('{job}: {task} still needs {hours} planned crew hour(s).', { job: blocker.jobTitle, task: blocker.taskTitle, hours: hours(blocker.remainingHours) })
    case 'assignment_pending_approval':
      return t('{worker} is still pending approval.', { worker: blocker.workerName })
    case 'job_plan_incomplete':
      return t('{job} has no complete source-current schedule for the look-ahead.', { job: blocker.jobTitle })
    case 'job_baseline_pending':
      return t('{job} has a pending schedule baseline.', { job: blocker.jobTitle })
    case 'job_baseline_stale':
      return t('{job} changed after its approved schedule baseline.', { job: blocker.jobTitle })
    default:
      return blocker?.message || ''
  }
}

export default function CrewCapacityBoard({
  locale = 'en-GB',
  board,
  canApprove,
  submitting,
  onLoadWindow,
  onSaveProfile,
  onCreateAllocation,
  onCancelAllocation,
  onRequestPlan,
  onReviewApproval,
  onOpenJob,
}) {
  const t = (key, variables) => operatorText(locale, key, variables)
  const workers = board?.workers || EMPTY_LIST
  const assignments = board?.assignments || EMPTY_LIST
  const allocations = board?.allocations || EMPTY_LIST
  const taskCoverage = board?.taskCoverage || EMPTY_LIST
  const blockers = board?.blockers || EMPTY_LIST
  const [windowStart, setWindowStart] = useState(board?.window?.windowStart || new Date().toISOString().slice(0, 10))
  const [profileWorkerId, setProfileWorkerId] = useState('')
  const [profileDraft, setProfileDraft] = useState(null)
  const [allocationDraft, setAllocationDraft] = useState({ assignmentId: '', taskId: '', workDate: '', plannedHours: 8, notes: '' })
  const [cancelDraft, setCancelDraft] = useState(null)

  useEffect(() => {
    if (board?.window?.windowStart) setWindowStart(board.window.windowStart)
  }, [board?.window?.windowStart])

  const assignmentById = useMemo(
    () => new Map(assignments.map((assignment) => [assignment.id, assignment])),
    [assignments],
  )
  const selectedAssignment = assignmentById.get(allocationDraft.assignmentId) || null
  const assignmentTasks = useMemo(
    () => taskCoverage.filter((task) => task.jobId === selectedAssignment?.jobId),
    [selectedAssignment?.jobId, taskCoverage],
  )
  const planState = summaryStatus(board, t)

  function openProfile(workerId) {
    const worker = workers.find((item) => item.id === workerId)
    if (!worker) return
    setProfileWorkerId(workerId)
    setProfileDraft({
      effectiveFrom: worker.profile?.effectiveFrom || board?.window?.windowStart || new Date().toISOString().slice(0, 10),
      timezone: worker.profile?.timezone || 'Europe/Amsterdam',
      dailyHours: { ...DEFAULT_DAILY_HOURS, ...(worker.profile?.dailyHours || {}) },
    })
  }

  async function submitProfile(event) {
    event.preventDefault()
    if (!profileWorkerId || !profileDraft) return
    const saved = await onSaveProfile(profileWorkerId, { ...profileDraft, referenceDate: board?.window?.windowStart })
    if (saved) {
      setProfileWorkerId('')
      setProfileDraft(null)
    }
  }

  async function submitAllocation(event) {
    event.preventDefault()
    const created = await onCreateAllocation({
      ...allocationDraft,
      taskId: allocationDraft.taskId || null,
      referenceDate: board?.window?.windowStart,
    })
    if (created) {
      setAllocationDraft({ assignmentId: '', taskId: '', workDate: '', plannedHours: 8, notes: '' })
    }
  }

  async function submitCancellation(event) {
    event.preventDefault()
    if (!cancelDraft?.allocationId) return
    const cancelled = await onCancelAllocation(cancelDraft.allocationId, {
      reason: cancelDraft.reason,
      referenceDate: board?.window?.windowStart,
    })
    if (cancelled) setCancelDraft(null)
  }

  return (
    <section className="panel page-panel crew-capacity" data-testid="crew-capacity-board">
      <div className="panel-heading crew-capacity-heading">
        <div>
          <h2>{t('Crew capacity and two-week plan')}</h2>
          <p>{t('Day-level hours against retained capacity, availability, assignments, task schedules, and approved baselines.')}</p>
        </div>
        <span className={`crew-plan-state crew-plan-${planState.key}`}>{planState.label}</span>
      </div>

      <div className="crew-capacity-summary" aria-label={t('Crew capacity summary')}>
        <div><span>{t('Available')}</span><strong>{hours(board?.summary?.totalAvailableHours)}h</strong></div>
        <div><span>{t('Planned')}</span><strong>{hours(board?.summary?.totalPlannedHours)}h</strong></div>
        <div><span>{t('Utilization')}</span><strong>{hours(board?.summary?.utilizationPercent)}%</strong></div>
        <div><span>{t('Profiled crew')}</span><strong>{board?.summary?.profiledWorkers || 0}/{board?.summary?.workers || 0}</strong></div>
        <div><span>{t('Task gaps')}</span><strong>{board?.summary?.taskCapacityGaps || 0}</strong></div>
        <div><span>{t('Blockers')}</span><strong>{board?.summary?.planningBlockers || 0}</strong></div>
      </div>

      <div className="crew-capacity-toolbar">
        <button
          type="button"
          className="icon-button"
          aria-label={t('Previous two-week window')}
          title={t('Previous two-week window')}
          disabled={submitting}
          onClick={() => onLoadWindow(dateOffset(board?.window?.windowStart || windowStart, -14))}
        >
          <ArrowLeft size={17} />
        </button>
        <label>
          <span>{t('Window starts')}</span>
          <input type="date" value={windowStart} onChange={(event) => setWindowStart(event.target.value)} />
        </label>
        <button type="button" className="secondary-button" disabled={submitting || !windowStart} onClick={() => onLoadWindow(windowStart)}>
          <RefreshCw size={16} />
          {t('Load window')}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Next two-week window')}
          title={t('Next two-week window')}
          disabled={submitting}
          onClick={() => onLoadWindow(dateOffset(board?.window?.windowStart || windowStart, 14))}
        >
          <ArrowRight size={17} />
        </button>
        <div className="crew-capacity-toolbar-actions">
          {board?.plans?.pending ? (
            <button type="button" className="primary-button" disabled={!canApprove} onClick={() => onReviewApproval(board.plans.pending)}>
              <ShieldCheck size={16} />
              {t('Review decision')}
            </button>
          ) : (
            <button type="button" className="primary-button" disabled={submitting || !board?.ready} onClick={() => onRequestPlan(board?.window?.windowStart)}>
              <CalendarCheck size={16} />
              {t('Request approval')}
            </button>
          )}
        </div>
      </div>

      <div className="crew-capacity-actions">
        <form className="crew-control-band" onSubmit={submitAllocation}>
          <div className="crew-control-title">
            <Clock3 size={17} />
            <div><h3>{t('Allocate crew hours')}</h3><p>{t('Assignment and task-bound internal plan entry')}</p></div>
          </div>
          <label>
            <span>{t('Assignment')}</span>
            <select
              required
              value={allocationDraft.assignmentId}
              onChange={(event) => setAllocationDraft((current) => ({ ...current, assignmentId: event.target.value, taskId: '' }))}
            >
              <option value="">{t('Select assignment')}</option>
              {assignments.map((assignment) => (
                <option key={assignment.id} value={assignment.id}>
                  {assignment.workerName || assignment.workerId} / {assignment.jobTitle || assignment.jobId}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('Scheduled task')}</span>
            <select value={allocationDraft.taskId} disabled={!selectedAssignment} onChange={(event) => setAllocationDraft((current) => ({ ...current, taskId: event.target.value }))}>
              <option value="">{t('Job-level allocation')}</option>
              {assignmentTasks.map((task) => <option key={task.taskId} value={task.taskId}>{task.title}</option>)}
            </select>
          </label>
          <label>
            <span>{t('Work date')}</span>
            <input
              required
              type="date"
              min={board?.window?.windowStart}
              max={board?.window?.windowEnd}
              value={allocationDraft.workDate}
              onChange={(event) => setAllocationDraft((current) => ({ ...current, workDate: event.target.value }))}
            />
          </label>
          <label>
            <span>{t('Hours')}</span>
            <input
              required
              type="number"
              min="0.25"
              max="24"
              step="0.25"
              value={allocationDraft.plannedHours}
              onChange={(event) => setAllocationDraft((current) => ({ ...current, plannedHours: event.target.value }))}
            />
          </label>
          <label className="crew-control-notes">
            <span>{t('Note')}</span>
            <input value={allocationDraft.notes} maxLength="1000" placeholder={t('Internal planning note')} onChange={(event) => setAllocationDraft((current) => ({ ...current, notes: event.target.value }))} />
          </label>
          <button type="submit" className="secondary-button" disabled={submitting || !allocationDraft.assignmentId || !allocationDraft.workDate}>
            <Plus size={16} />
            {t('Add hours')}
          </button>
        </form>

        <div className="crew-profile-register">
          <div className="crew-profile-register-heading">
            <div><h3>{t('Capacity profiles')}</h3><p>{t('Explicit operational hours only')}</p></div>
            <span>{workers.filter((worker) => !worker.profileMissing).length}/{workers.length}</span>
          </div>
          <div className="crew-profile-list">
            {workers.map((worker) => (
              <button key={worker.id} type="button" onClick={() => openProfile(worker.id)}>
                <span><strong>{worker.name}</strong><small>{worker.role || t('Crew member')}</small></span>
                <span><strong>{worker.profile ? `${hours(worker.profile.weeklyHours)}h` : t('Missing')}</strong><UserRoundCog size={16} /></span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {profileDraft ? (
        <form className="crew-profile-editor" onSubmit={submitProfile}>
          <div className="crew-profile-editor-heading">
            <div>
              <h3>{workers.find((worker) => worker.id === profileWorkerId)?.name || t('Crew capacity profile')}</h3>
              <p>{t('Versioned weekday capacity')}</p>
            </div>
            <button type="button" className="icon-button" aria-label={t('Close capacity editor')} onClick={() => { setProfileWorkerId(''); setProfileDraft(null) }}>
              <X size={17} />
            </button>
          </div>
          <div className="crew-profile-basis">
            <label><span>{t('Effective from')}</span><input required type="date" value={profileDraft.effectiveFrom} onChange={(event) => setProfileDraft((current) => ({ ...current, effectiveFrom: event.target.value }))} /></label>
            <label><span>{t('Timezone')}</span><input required value={profileDraft.timezone} onChange={(event) => setProfileDraft((current) => ({ ...current, timezone: event.target.value }))} /></label>
          </div>
          <div className="crew-weekday-grid">
            {DAY_KEYS.map((day) => (
              <label key={day}>
                <span>{t(day.slice(0, 3))}</span>
                <input
                  required
                  type="number"
                  min="0"
                  max="24"
                  step="0.25"
                  value={profileDraft.dailyHours[day]}
                  onChange={(event) => setProfileDraft((current) => ({ ...current, dailyHours: { ...current.dailyHours, [day]: event.target.value } }))}
                />
              </label>
            ))}
          </div>
          <button type="submit" className="primary-button" disabled={submitting}>
            <Save size={16} />
            {t('Save profile')}
          </button>
        </form>
      ) : null}

      <div className="crew-board-wrap" tabIndex="0" aria-label={t('Scrollable two-week crew capacity board')}>
        <div className="crew-board" style={{ '--crew-day-count': board?.window?.dates?.length || 14 }}>
          <div className="crew-board-corner"><span>{t('Crew member')}</span><small>{t('Available / planned')}</small></div>
          {(board?.window?.dates || EMPTY_LIST).map((date) => (
            <div className="crew-board-date" key={date}><strong>{formatWeekday(`${date}T00:00:00Z`)}</strong><span>{formatDate(date)}</span></div>
          ))}
          {workers.map((worker) => (
            <div className="crew-board-row" key={worker.id}>
              <button type="button" className="crew-board-worker" onClick={() => openProfile(worker.id)}>
                <span><strong>{worker.name}</strong><small>{worker.role || t('Crew member')}</small></span>
                <span className={worker.profileMissing ? 'crew-profile-missing' : ''}>{worker.profileMissing ? t('Profile missing') : `${hours(worker.totals.plannedHours)} / ${hours(worker.totals.availableHours)}h`}</span>
              </button>
              {worker.days.map((day) => (
                <div
                  key={day.date}
                  className={`crew-board-day ${utilizationClass(day.utilizationPercent)}${day.unavailableConflict ? ' capacity-unavailable' : ''}`}
                  aria-label={t('{worker}, {date}: {available} available, {planned} planned', { worker: worker.name, date: formatDate(day.date), available: hours(day.availableHours), planned: hours(day.plannedHours) })}
                >
                  <strong>{hours(day.plannedHours)}<small> / {hours(day.availableHours)}h</small></strong>
                  <span>{day.absences.length ? t(formatStatus(day.absences[0].periodType)) : t('{hours}h free', { hours: hours(day.remainingHours) })}</span>
                  {day.allocations.slice(0, 2).map((allocation) => (
                    <small className="crew-day-allocation" key={allocation.id} title={allocation.jobTitle || allocation.taskTitle || ''}>{allocation.jobTitle || allocation.taskTitle || t('Planned work')}</small>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      {!workers.length ? <Empty title={t('No crew available')} detail={t('Active ledger workers appear here after they are retained in Resources.')} /> : null}

      <div className="crew-registers">
        <section className="crew-blocker-register" aria-labelledby="crew-blocker-heading">
          <div className="crew-register-heading">
            <div><h3 id="crew-blocker-heading">{t('Planning blockers')}</h3><p>{t('Approval must remain blocked while these records are current')}</p></div>
            <span>{blockers.length}</span>
          </div>
          <div className="crew-register-list">
            {blockers.map((blocker, index) => (
              <div key={`${blocker.type}-${blocker.workerId || blocker.jobId || blocker.taskId || index}`} className={`crew-register-row blocker-${blocker.severity || 'medium'}`}>
                <span><strong>{t(formatStatus(blocker.type))}</strong><small>{blockerMessage(blocker, t)}</small></span>
                {blocker.jobId ? <button type="button" className="icon-button table-action" aria-label={t('Open blocker job')} onClick={() => onOpenJob(blocker.jobId)}><ArrowRight size={15} /></button> : null}
              </div>
            ))}
            {!blockers.length ? <Empty title={t('No planning blockers')} detail={t('The current two-week source is ready for internal approval.')} /> : null}
          </div>
        </section>

        <section className="crew-coverage-register" aria-labelledby="crew-coverage-heading">
          <div className="crew-register-heading">
            <div><h3 id="crew-coverage-heading">{t('Task coverage')}</h3><p>{t('Scheduled task duration compared with allocated crew hours')}</p></div>
            <span>{taskCoverage.length}</span>
          </div>
          <div className="crew-register-list">
            {taskCoverage.map((task) => (
              <button type="button" className="crew-register-row crew-coverage-row" key={task.taskId} onClick={() => onOpenJob(task.jobId)}>
                <span><strong>{task.title}</strong><small>{task.jobTitle} / {t('{start} to {end}', { start: formatDate(task.plannedStart), end: formatDate(task.plannedEnd) })}</small></span>
                <span className={task.ready ? 'coverage-ready' : 'coverage-gap'}>{hours(task.allocatedHours)} / {hours(task.requiredHours)}h</span>
              </button>
            ))}
            {!taskCoverage.length ? <Empty title={t('No scheduled tasks in this window')} detail={t('Approved task schedules appear here when they overlap the selected two weeks.')} /> : null}
          </div>
        </section>
      </div>

      <div className="crew-allocation-register">
        <div className="crew-register-heading">
          <div><h3>{t('Retained allocations')}</h3><p>{t('Active day-level internal planning entries')}</p></div>
          <span>{allocations.length}</span>
        </div>
        <div className="crew-allocation-list">
          {allocations.map((allocation) => (
            <div className="crew-allocation-row" key={allocation.id}>
              <span><strong>{allocation.workerName}</strong><small>{allocation.jobTitle} / {allocation.taskTitle || t('Job-level allocation')}</small></span>
              <span><strong>{formatDate(allocation.workDate)}</strong><small>{hours(allocation.plannedHours)}h</small></span>
              {cancelDraft?.allocationId === allocation.id ? (
                <form onSubmit={submitCancellation}>
                  <label><span>{t('Cancellation reason')}</span><input autoFocus required minLength="5" maxLength="1000" value={cancelDraft.reason} onChange={(event) => setCancelDraft({ ...cancelDraft, reason: event.target.value })} /></label>
                  <button type="submit" className="secondary-button" disabled={submitting}><Trash2 size={15} />{t('Confirm')}</button>
                  <button type="button" className="icon-button" aria-label={t('Keep allocation')} onClick={() => setCancelDraft(null)}><X size={15} /></button>
                </form>
              ) : (
                <button type="button" className="icon-button table-action" aria-label={t('Cancel {hours} hour allocation for {worker}', { hours: hours(allocation.plannedHours), worker: allocation.workerName })} onClick={() => setCancelDraft({ allocationId: allocation.id, reason: '' })}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
          {!allocations.length ? <Empty title={t('No crew hours retained')} detail={t('Day-level allocations for the selected two weeks appear here.')} /> : null}
        </div>
      </div>
    </section>
  )
}
