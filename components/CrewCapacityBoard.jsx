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
import { formatDate, formatStatus } from '../dashboard-format'

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

function summaryStatus(board) {
  if (board?.plans?.current) return { key: 'approved', label: 'Approved and current' }
  if (board?.plans?.pending) return { key: 'pending', label: 'Pending approval' }
  if (board?.plans?.stale) return { key: 'stale', label: 'Approved plan is stale' }
  if (board?.ready) return { key: 'ready', label: 'Ready for approval' }
  return { key: 'blocked', label: 'Planning blockers' }
}

export default function CrewCapacityBoard({
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
  const planState = summaryStatus(board)

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
          <h2>Crew capacity and two-week plan</h2>
          <p>Day-level hours against retained capacity, availability, assignments, task schedules, and approved baselines.</p>
        </div>
        <span className={`crew-plan-state crew-plan-${planState.key}`}>{planState.label}</span>
      </div>

      <div className="crew-capacity-summary" aria-label="Crew capacity summary">
        <div><span>Available</span><strong>{hours(board?.summary?.totalAvailableHours)}h</strong></div>
        <div><span>Planned</span><strong>{hours(board?.summary?.totalPlannedHours)}h</strong></div>
        <div><span>Utilization</span><strong>{hours(board?.summary?.utilizationPercent)}%</strong></div>
        <div><span>Profiled crew</span><strong>{board?.summary?.profiledWorkers || 0}/{board?.summary?.workers || 0}</strong></div>
        <div><span>Task gaps</span><strong>{board?.summary?.taskCapacityGaps || 0}</strong></div>
        <div><span>Blockers</span><strong>{board?.summary?.planningBlockers || 0}</strong></div>
      </div>

      <div className="crew-capacity-toolbar">
        <button
          type="button"
          className="icon-button"
          aria-label="Previous two-week window"
          title="Previous two-week window"
          disabled={submitting}
          onClick={() => onLoadWindow(dateOffset(board?.window?.windowStart || windowStart, -14))}
        >
          <ArrowLeft size={17} />
        </button>
        <label>
          <span>Window starts</span>
          <input type="date" value={windowStart} onChange={(event) => setWindowStart(event.target.value)} />
        </label>
        <button type="button" className="secondary-button" disabled={submitting || !windowStart} onClick={() => onLoadWindow(windowStart)}>
          <RefreshCw size={16} />
          Load window
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Next two-week window"
          title="Next two-week window"
          disabled={submitting}
          onClick={() => onLoadWindow(dateOffset(board?.window?.windowStart || windowStart, 14))}
        >
          <ArrowRight size={17} />
        </button>
        <div className="crew-capacity-toolbar-actions">
          {board?.plans?.pending ? (
            <button type="button" className="primary-button" disabled={!canApprove} onClick={() => onReviewApproval(board.plans.pending)}>
              <ShieldCheck size={16} />
              Review decision
            </button>
          ) : (
            <button type="button" className="primary-button" disabled={submitting || !board?.ready} onClick={() => onRequestPlan(board?.window?.windowStart)}>
              <CalendarCheck size={16} />
              Request approval
            </button>
          )}
        </div>
      </div>

      <div className="crew-capacity-actions">
        <form className="crew-control-band" onSubmit={submitAllocation}>
          <div className="crew-control-title">
            <Clock3 size={17} />
            <div><h3>Allocate crew hours</h3><p>Assignment and task-bound internal plan entry</p></div>
          </div>
          <label>
            <span>Assignment</span>
            <select
              required
              value={allocationDraft.assignmentId}
              onChange={(event) => setAllocationDraft((current) => ({ ...current, assignmentId: event.target.value, taskId: '' }))}
            >
              <option value="">Select assignment</option>
              {assignments.map((assignment) => (
                <option key={assignment.id} value={assignment.id}>
                  {assignment.workerName || assignment.workerId} / {assignment.jobTitle || assignment.jobId}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Scheduled task</span>
            <select value={allocationDraft.taskId} disabled={!selectedAssignment} onChange={(event) => setAllocationDraft((current) => ({ ...current, taskId: event.target.value }))}>
              <option value="">Job-level allocation</option>
              {assignmentTasks.map((task) => <option key={task.taskId} value={task.taskId}>{task.title}</option>)}
            </select>
          </label>
          <label>
            <span>Work date</span>
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
            <span>Hours</span>
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
            <span>Note</span>
            <input value={allocationDraft.notes} maxLength="1000" placeholder="Internal planning note" onChange={(event) => setAllocationDraft((current) => ({ ...current, notes: event.target.value }))} />
          </label>
          <button type="submit" className="secondary-button" disabled={submitting || !allocationDraft.assignmentId || !allocationDraft.workDate}>
            <Plus size={16} />
            Add hours
          </button>
        </form>

        <div className="crew-profile-register">
          <div className="crew-profile-register-heading">
            <div><h3>Capacity profiles</h3><p>Explicit operational hours only</p></div>
            <span>{workers.filter((worker) => !worker.profileMissing).length}/{workers.length}</span>
          </div>
          <div className="crew-profile-list">
            {workers.map((worker) => (
              <button key={worker.id} type="button" onClick={() => openProfile(worker.id)}>
                <span><strong>{worker.name}</strong><small>{worker.role || 'Crew member'}</small></span>
                <span><strong>{worker.profile ? `${hours(worker.profile.weeklyHours)}h` : 'Missing'}</strong><UserRoundCog size={16} /></span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {profileDraft ? (
        <form className="crew-profile-editor" onSubmit={submitProfile}>
          <div className="crew-profile-editor-heading">
            <div>
              <h3>{workers.find((worker) => worker.id === profileWorkerId)?.name || 'Crew capacity profile'}</h3>
              <p>Versioned weekday capacity</p>
            </div>
            <button type="button" className="icon-button" aria-label="Close capacity editor" onClick={() => { setProfileWorkerId(''); setProfileDraft(null) }}>
              <X size={17} />
            </button>
          </div>
          <div className="crew-profile-basis">
            <label><span>Effective from</span><input required type="date" value={profileDraft.effectiveFrom} onChange={(event) => setProfileDraft((current) => ({ ...current, effectiveFrom: event.target.value }))} /></label>
            <label><span>Timezone</span><input required value={profileDraft.timezone} onChange={(event) => setProfileDraft((current) => ({ ...current, timezone: event.target.value }))} /></label>
          </div>
          <div className="crew-weekday-grid">
            {DAY_KEYS.map((day) => (
              <label key={day}>
                <span>{day.slice(0, 3)}</span>
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
            Save profile
          </button>
        </form>
      ) : null}

      <div className="crew-board-wrap" tabIndex="0" aria-label="Scrollable two-week crew capacity board">
        <div className="crew-board" style={{ '--crew-day-count': board?.window?.dates?.length || 14 }}>
          <div className="crew-board-corner"><span>Crew member</span><small>Available / planned</small></div>
          {(board?.window?.dates || EMPTY_LIST).map((date) => (
            <div className="crew-board-date" key={date}><strong>{new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short' })}</strong><span>{formatDate(date)}</span></div>
          ))}
          {workers.map((worker) => (
            <div className="crew-board-row" key={worker.id}>
              <button type="button" className="crew-board-worker" onClick={() => openProfile(worker.id)}>
                <span><strong>{worker.name}</strong><small>{worker.role || 'Crew member'}</small></span>
                <span className={worker.profileMissing ? 'crew-profile-missing' : ''}>{worker.profileMissing ? 'Profile missing' : `${hours(worker.totals.plannedHours)} / ${hours(worker.totals.availableHours)}h`}</span>
              </button>
              {worker.days.map((day) => (
                <div
                  key={day.date}
                  className={`crew-board-day ${utilizationClass(day.utilizationPercent)}${day.unavailableConflict ? ' capacity-unavailable' : ''}`}
                  aria-label={`${worker.name}, ${formatDate(day.date)}: ${hours(day.availableHours)} available, ${hours(day.plannedHours)} planned`}
                >
                  <strong>{hours(day.plannedHours)}<small> / {hours(day.availableHours)}h</small></strong>
                  <span>{day.absences.length ? formatStatus(day.absences[0].periodType) : `${hours(day.remainingHours)}h free`}</span>
                  {day.allocations.slice(0, 2).map((allocation) => (
                    <small className="crew-day-allocation" key={allocation.id} title={allocation.jobTitle || allocation.taskTitle || ''}>{allocation.jobTitle || allocation.taskTitle || 'Planned work'}</small>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      {!workers.length ? <Empty title="No crew available" detail="Active ledger workers appear here after they are retained in Resources." /> : null}

      <div className="crew-registers">
        <section className="crew-blocker-register" aria-labelledby="crew-blocker-heading">
          <div className="crew-register-heading">
            <div><h3 id="crew-blocker-heading">Planning blockers</h3><p>Approval must remain blocked while these records are current</p></div>
            <span>{blockers.length}</span>
          </div>
          <div className="crew-register-list">
            {blockers.map((blocker, index) => (
              <div key={`${blocker.type}-${blocker.workerId || blocker.jobId || blocker.taskId || index}`} className={`crew-register-row blocker-${blocker.severity || 'medium'}`}>
                <span><strong>{formatStatus(blocker.type)}</strong><small>{blocker.message}</small></span>
                {blocker.jobId ? <button type="button" className="icon-button table-action" aria-label="Open blocker job" onClick={() => onOpenJob(blocker.jobId)}><ArrowRight size={15} /></button> : null}
              </div>
            ))}
            {!blockers.length ? <Empty title="No planning blockers" detail="The current two-week source is ready for internal approval." /> : null}
          </div>
        </section>

        <section className="crew-coverage-register" aria-labelledby="crew-coverage-heading">
          <div className="crew-register-heading">
            <div><h3 id="crew-coverage-heading">Task coverage</h3><p>Scheduled task duration compared with allocated crew hours</p></div>
            <span>{taskCoverage.length}</span>
          </div>
          <div className="crew-register-list">
            {taskCoverage.map((task) => (
              <button type="button" className="crew-register-row crew-coverage-row" key={task.taskId} onClick={() => onOpenJob(task.jobId)}>
                <span><strong>{task.title}</strong><small>{task.jobTitle} / {formatDate(task.plannedStart)} to {formatDate(task.plannedEnd)}</small></span>
                <span className={task.ready ? 'coverage-ready' : 'coverage-gap'}>{hours(task.allocatedHours)} / {hours(task.requiredHours)}h</span>
              </button>
            ))}
            {!taskCoverage.length ? <Empty title="No scheduled tasks in this window" detail="Approved task schedules appear here when they overlap the selected two weeks." /> : null}
          </div>
        </section>
      </div>

      <div className="crew-allocation-register">
        <div className="crew-register-heading">
          <div><h3>Retained allocations</h3><p>Active day-level internal planning entries</p></div>
          <span>{allocations.length}</span>
        </div>
        <div className="crew-allocation-list">
          {allocations.map((allocation) => (
            <div className="crew-allocation-row" key={allocation.id}>
              <span><strong>{allocation.workerName}</strong><small>{allocation.jobTitle} / {allocation.taskTitle || 'Job-level allocation'}</small></span>
              <span><strong>{formatDate(allocation.workDate)}</strong><small>{hours(allocation.plannedHours)}h</small></span>
              {cancelDraft?.allocationId === allocation.id ? (
                <form onSubmit={submitCancellation}>
                  <label><span>Cancellation reason</span><input autoFocus required minLength="5" maxLength="1000" value={cancelDraft.reason} onChange={(event) => setCancelDraft({ ...cancelDraft, reason: event.target.value })} /></label>
                  <button type="submit" className="secondary-button" disabled={submitting}><Trash2 size={15} />Confirm</button>
                  <button type="button" className="icon-button" aria-label="Keep allocation" onClick={() => setCancelDraft(null)}><X size={15} /></button>
                </form>
              ) : (
                <button type="button" className="icon-button table-action" aria-label={`Cancel ${hours(allocation.plannedHours)} hour allocation for ${allocation.workerName}`} onClick={() => setCancelDraft({ allocationId: allocation.id, reason: '' })}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
          {!allocations.length ? <Empty title="No crew hours retained" detail="Day-level allocations for the selected two weeks appear here." /> : null}
        </div>
      </div>
    </section>
  )
}
