import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ArrowUpRight,
  Ban,
  Building2,
  CalendarOff,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FileDown,
  HardHat,
  LockKeyhole,
  PackageCheck,
  Pencil,
  Plus,
  ReceiptEuro,
  Search,
  ShieldCheck,
  Timer,
  Truck,
  TriangleAlert,
  Undo2,
  Users,
  Wrench,
} from 'lucide-react'
import {
  currency,
  EMPTY_LIST,
  formatDate,
  formatDateTime,
  formatStatus,
  mondayDateInput,
  RESOURCE_ACTION_LABELS,
  roundDisplay,
  shortHash,
} from '../dashboard-format'
import Empty from './EmptyState'
import FiveSWorkspace from './FiveSWorkspace'
import { operatorText } from '../operator-locale'

function identityText(key, variables = {}) {
  return Object.entries(variables).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    key,
  )
}

function WorkerDirectory({ t = identityText, workers, summary, canCoordinate, canApprove, submitting, onCreate, onEdit, onRetire, onOpenApprovals }) {
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
      <div className="resource-summary worker-summary" aria-label={t('Crew summary')}>
        <div>
          <span>{t('Active crew')}</span>
          <strong>{summary?.active || 0}</strong>
        </div>
        <div>
          <span>{t('Available')}</span>
          <strong>{summary?.available || 0}</strong>
        </div>
        <div>
          <span>{t('Unavailable')}</span>
          <strong>{summary?.unavailable || 0}</strong>
        </div>
        <div>
          <span>{t('Retirement review')}</span>
          <strong>{summary?.pendingRetirement || 0}</strong>
        </div>
      </div>
      <div className="trade-partner-toolbar worker-toolbar">
        <label className="search-control">
          <Search size={16} />
          <span className="visually-hidden">{t('Search crew directory')}</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search crew')} />
        </label>
        <div className="resource-tabs" role="tablist" aria-label={t('Crew status')}>
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
            {t('Add crew member')}
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
                  {worker.retirementApprovalId ? <span className="tag tag-amber">{t('Retirement pending')}</span> : null}
                </div>
                <p>
                  {worker.role || t('Role not retained')}
                  {worker.skills?.length ? ` / ${worker.skills.slice(0, 3).join(', ')}` : ''}
                </p>
                <small>{worker.email || worker.phone || t('Contact not retained')}</small>
              </div>
            </div>
            <div className="trade-partner-evidence worker-details">
              <span>
                {t('Home region')} <strong>{worker.homeRegion || t('Not retained')}</strong>
              </span>
              <span>
                {t('Hourly cost')} <strong>{currency.format(worker.hourlyRate || 0)}</strong>
              </span>
              <span>
                {t('Active assignments')} <strong>{worker.activeAssignmentCount || 0}</strong>
              </span>
              <span>
                {t('Last updated')} <strong>{formatDate(worker.updatedAt)}</strong>
              </span>
              {worker.dormantAssignmentCount ? (
                <span>
                  {t('Dormant assignments')} <strong>{worker.dormantAssignmentCount}</strong>
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
                  {t('Review retirement')}
                </button>
              ) : null}
              {canCoordinate && worker.status !== 'retired' ? (
                <button className="icon-button" aria-label={t('Edit {name}', { name: worker.name })} disabled={submitting} onClick={() => onEdit(worker)}>
                  <Pencil size={16} />
                </button>
              ) : null}
              {canCoordinate && worker.status !== 'retired' ? (
                <button
                  className="icon-button danger-icon"
                  aria-label={t('Request retirement for {name}', { name: worker.name })}
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
          <Empty title={t('No matching crew members')} detail={t('Retained people records matching this view will appear here.')} />
        ) : null}
      </div>
    </div>
  )
}

function QualificationWorkspace({ t = identityText, register, workers, canCoordinate, canApprove, submitting, onAddCredential, onCreateRequirement, onRetireRequirement, onOpenApprovals, onOpenJob }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const workerRows = register?.workers?.length
    ? register.workers
    : (workers || EMPTY_LIST).map((worker) => ({ worker, qualification: worker.qualification || { credentials: [], status: 'missing' } }))
  const visibleWorkers = useMemo(() => {
    const search = query.trim().toLowerCase()
    return workerRows.filter((row) => {
      if (filter !== 'all' && row.qualification?.status !== filter) return false
      if (!search) return true
      return JSON.stringify({
        name: row.worker?.name,
        role: row.worker?.role,
        credentials: row.qualification?.credentials?.map((item) => [item.title, item.issuer, item.credentialNumber]),
      }).toLowerCase().includes(search)
    })
  }, [filter, query, workerRows])
  const summary = register?.summary || {}
  const requirements = register?.requirements || EMPTY_LIST
  const jobsById = new Map((register?.jobs || EMPTY_LIST).map((job) => [job.jobId, job]))

  return (
    <div className="qualification-workspace" role="tabpanel" data-testid="qualification-workspace">
      <div className="resource-summary qualification-summary" aria-label={t('Qualification summary')}>
        <div><span>{t('Credentialed workers')}</span><strong>{summary.workersWithApprovedCredentials || 0}</strong></div>
        <div><span>{t('Pending review')}</span><strong>{summary.pendingCredentials || 0}</strong></div>
        <div><span>{t('Expiring / expired')}</span><strong>{(summary.expiringCredentials || 0) + (summary.expiredCredentials || 0)}</strong></div>
        <div><span>{t('Blocked assignments')}</span><strong>{summary.blockedAssignments || 0}</strong></div>
      </div>
      <div className="qualification-toolbar">
        <label className="search-control">
          <Search size={16} />
          <span className="visually-hidden">{t('Search workforce qualifications')}</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search worker or credential')} />
        </label>
        <div className="resource-tabs" role="tablist" aria-label={t('Credential state')}>
          {[
            ['all', 'All'],
            ['current', 'Current'],
            ['pending_approval', 'Pending'],
            ['expiring', 'Expiring'],
            ['missing', 'Missing'],
          ].map(([key, label]) => (
            <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? 'resource-tab-active' : ''} onClick={() => setFilter(key)}>
              {t(label)}
            </button>
          ))}
        </div>
        {canCoordinate ? (
          <button type="button" className="primary-button" disabled={submitting} onClick={onCreateRequirement}>
            <Plus size={16} />
            {t('Add job requirement')}
          </button>
        ) : null}
      </div>

      <section className="qualification-band" aria-labelledby="worker-credential-heading">
        <div className="qualification-band-heading">
          <div>
            <h3 id="worker-credential-heading">{t('Worker credentials')}</h3>
            <p>{t('Only approved, integrity-valid evidence satisfies job readiness. Pending revisions do not replace the current approved source.')}</p>
          </div>
          <span>{t(visibleWorkers.length === 1 ? '{count} worker' : '{count} workers', { count: visibleWorkers.length })}</span>
        </div>
        <div className="qualification-worker-list">
          {visibleWorkers.map((row) => {
            const worker = row.worker
            const qualification = row.qualification || {}
            const credentials = qualification.credentials || EMPTY_LIST
            const pending = credentials.find((item) => item.status === 'pending_approval')
            return (
              <article className="qualification-worker-row" key={worker.id}>
                <div className="qualification-worker-identity">
                  <span className="qualification-icon"><ShieldCheck size={17} /></span>
                  <div>
                    <div className="qualification-title-line">
                      <h4>{worker.name}</h4>
                      <span className={`status status-${qualification.status || 'missing'}`}>{formatStatus(qualification.status || 'missing')}</span>
                    </div>
                    <p>{worker.role || t('Role not retained')} / {t(worker.activeAssignmentCount === 1 ? '{count} active assignment' : '{count} active assignments', { count: worker.activeAssignmentCount || 0 })}</p>
                  </div>
                </div>
                <div className="credential-list">
                  {credentials.map((credential) => (
                    <div className="credential-line" key={credential.id}>
                      <span className={`credential-state credential-state-${credential.status}`}>{formatStatus(credential.status)}</span>
                      <strong>{credential.title}</strong>
                      <span>{credential.issuer || t('Issuer not retained')}</span>
                      <span>{credential.expiresOn ? t('Expires {date}', { date: formatDate(credential.expiresOn) }) : t('No expiry retained')}</span>
                    </div>
                  ))}
                  {!credentials.length ? <span className="qualification-empty">{t('No current or pending credential evidence.')}</span> : null}
                </div>
                <div className="qualification-row-actions">
                  {pending && canApprove ? (
                    <button type="button" className="secondary-button" disabled={submitting} onClick={() => onOpenApprovals({ approvalId: pending.approvalId })}>
                      <ClipboardCheck size={15} />
                      {t('Review')}
                    </button>
                  ) : null}
                  {canCoordinate && worker.status !== 'retired' ? (
                    <button type="button" className="secondary-button" disabled={submitting} onClick={() => onAddCredential(worker)}>
                      <Plus size={15} />
                      {t(qualification.approved ? 'Add revision' : 'Add evidence')}
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })}
          {!visibleWorkers.length ? <Empty title={t('No matching qualification records')} detail={t('Workers matching this credential state will appear here.')} /> : null}
        </div>
      </section>

      <section className="qualification-band qualification-requirement-band" aria-labelledby="job-requirement-heading">
        <div className="qualification-band-heading">
          <div>
            <h3 id="job-requirement-heading">{t('Job requirements')}</h3>
            <p>{t('Requirements apply to assigned roles and remain enforced while a retirement decision is pending.')}</p>
          </div>
          <span>{t(requirements.length === 1 ? '{count} active requirement' : '{count} active requirements', { count: requirements.length })}</span>
        </div>
        <div className="qualification-requirement-list">
          {requirements.map((requirement) => {
            const job = jobsById.get(requirement.jobId)
            return (
              <article className="qualification-requirement-row" key={requirement.id}>
                <div>
                  <div className="qualification-title-line">
                    <h4>{requirement.title}</h4>
                    <span className={`status status-${requirement.status}`}>{formatStatus(requirement.status)}</span>
                  </div>
                  <p>{requirement.jobTitle || job?.jobTitle || requirement.jobId}</p>
                </div>
                <div className="qualification-requirement-values">
                  <span>{t('Type')} <strong>{requirement.credentialLabel}</strong></span>
                  <span>{t('Role')} <strong>{requirement.roleKey === '*' ? t('All assigned roles') : formatStatus(requirement.roleKey)}</strong></span>
                  <span>{t('Readiness')} <strong>{job ? t('{ready} ready / {blocked} blocked', { ready: job.readyAssignments, blocked: job.blockedAssignments }) : t('No active job row')}</strong></span>
                </div>
                <div className="qualification-row-actions">
                  {requirement.retirementApprovalId && canApprove ? (
                    <button type="button" className="secondary-button" disabled={submitting} onClick={() => onOpenApprovals({ approvalId: requirement.retirementApprovalId, jobId: requirement.jobId, jobTitle: requirement.jobTitle })}>
                      <ClipboardCheck size={15} />
                      {t('Review removal')}
                    </button>
                  ) : null}
                  {onOpenJob ? (
                    <button type="button" className="icon-button" aria-label={t('Open {name}', { name: requirement.jobTitle || t('job') })} onClick={() => onOpenJob({ id: requirement.jobId })}>
                      <ArrowUpRight size={16} />
                    </button>
                  ) : null}
                  {canCoordinate && requirement.status === 'active' ? (
                    <button type="button" className="icon-button danger-icon" aria-label={t('Request removal of {name}', { name: requirement.title })} disabled={submitting} onClick={() => onRetireRequirement(requirement)}>
                      <Archive size={16} />
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })}
          {!requirements.length ? <Empty title={t('No qualification requirements')} detail={t('Add a job requirement before dispatch when a role needs VCA, GPI, equipment, electrical, or other retained proof.')} /> : null}
        </div>
      </section>
    </div>
  )
}

function AvailabilityWorkspace({ t = identityText, register, workers, canCoordinate, canApprove, submitting, onCreate, onCancel, onOpenApprovals }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const periods = register?.periods || EMPTY_LIST
  const conflictsByPeriod = useMemo(() => {
    const grouped = new Map()
    for (const conflict of register?.conflicts || EMPTY_LIST) {
      const periodId = conflict.period?.id
      if (!periodId) continue
      const rows = grouped.get(periodId) || []
      rows.push(conflict)
      grouped.set(periodId, rows)
    }
    return grouped
  }, [register?.conflicts])
  const visiblePeriods = useMemo(() => {
    const search = query.trim().toLowerCase()
    return periods.filter((period) => {
      if (filter === 'current' && period.phase !== 'current') return false
      if (filter === 'upcoming' && period.phase !== 'upcoming') return false
      if (filter === 'pending' && period.status !== 'pending_cancellation') return false
      if (filter === 'conflict' && !conflictsByPeriod.has(period.id)) return false
      if (!search) return true
      return JSON.stringify({
        workerName: period.workerName,
        workerRole: period.workerRole,
        title: period.title,
        periodType: period.periodLabel,
        notes: period.data?.operationalNotes,
      }).toLowerCase().includes(search)
    })
  }, [conflictsByPeriod, filter, periods, query])
  const summary = register?.summary || {}

  return (
    <div className="availability-workspace" role="tabpanel" data-testid="availability-workspace">
      <div className="resource-summary availability-summary" aria-label={t('Worker availability summary')}>
        <div><span>{t('Active periods')}</span><strong>{summary.activePeriods || 0}</strong></div>
        <div><span>{t('Unavailable now')}</span><strong>{summary.currentUnavailable || 0}</strong></div>
        <div><span>{t('Upcoming')}</span><strong>{summary.upcoming || 0}</strong></div>
        <div><span>{t('Cancellation review')}</span><strong>{summary.pendingCancellation || 0}</strong></div>
        <div><span>{t('Assignment conflicts')}</span><strong>{summary.assignmentConflicts || 0}</strong></div>
      </div>
      <div className="availability-toolbar">
        <label className="search-control">
          <Search size={16} />
          <span className="visually-hidden">{t('Search worker availability')}</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search worker or period')} />
        </label>
        <div className="resource-tabs" role="tablist" aria-label={t('Availability state')}>
          {[
            ['all', 'All'],
            ['current', 'Current'],
            ['upcoming', 'Upcoming'],
            ['pending', 'Pending'],
            ['conflict', 'Conflicts'],
          ].map(([key, label]) => (
            <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? 'resource-tab-active' : ''} onClick={() => setFilter(key)}>
              {t(label)}
            </button>
          ))}
        </div>
        {canCoordinate ? (
          <button type="button" className="primary-button" disabled={submitting || !workers?.length} onClick={() => onCreate()}>
            <Plus size={16} />
            {t('Add unavailability')}
          </button>
        ) : null}
      </div>
      <div className="availability-policy">
        <LockKeyhole size={16} />
        <p>{t('Operational capacity only. Do not retain diagnosis, illness, HR case, payroll entitlement, or location tracking data.')}</p>
      </div>
      <div className="availability-list">
        {visiblePeriods.map((period) => {
          const conflicts = conflictsByPeriod.get(period.id) || EMPTY_LIST
          const displayState = period.status === 'pending_cancellation' ? period.status : period.phase
          return (
            <article className="availability-row" key={period.id}>
              <div className="availability-identity">
                <span className="availability-icon"><CalendarOff size={17} /></span>
                <div>
                  <div className="availability-title-line">
                    <h3>{period.workerName}</h3>
                    <span className={`status status-${displayState}`}>{formatStatus(displayState)}</span>
                    {conflicts.length ? <span className="tag tag-red">{t(conflicts.length === 1 ? '{count} conflict' : '{count} conflicts', { count: conflicts.length })}</span> : null}
                  </div>
                  <p>{period.workerRole || t('Role not retained')} / {period.periodLabel}</p>
                </div>
              </div>
              <div className="availability-window">
                <strong>{period.title}</strong>
                <span>{t('{start} to {end}', { start: formatDateTime(period.startsAt), end: formatDateTime(period.endsAt) })}</span>
                {period.data?.operationalNotes ? <small>{period.data.operationalNotes}</small> : null}
              </div>
              <div className="availability-actions">
                {period.status === 'pending_cancellation' && canApprove && period.cancellationApprovalId ? (
                  <button type="button" className="secondary-button" disabled={submitting} onClick={() => onOpenApprovals({ approvalId: period.cancellationApprovalId })}>
                    <ClipboardCheck size={15} />
                    {t('Review cancellation')}
                  </button>
                ) : null}
                {period.status === 'active' && canCoordinate ? (
                  <button type="button" className="secondary-button" disabled={submitting} onClick={() => onCancel(period)}>
                    <Ban size={15} />
                    {t('Request cancellation')}
                  </button>
                ) : null}
              </div>
            </article>
          )
        })}
        {!visiblePeriods.length ? (
          <Empty
            title={t('No matching availability periods')}
            detail={t('Time-bounded operational unavailability will appear here and participate in scheduling immediately.')}
          />
        ) : null}
      </div>
    </div>
  )
}

function EquipmentDirectory({
  t = identityText,
  tools,
  summary,
  custody,
  canCoordinate,
  canApprove,
  submitting,
  onCreate,
  onEdit,
  onInspect,
  onMaintain,
  onRetire,
  onCheckout,
  onReturn,
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
      <div className="resource-summary equipment-summary" aria-label={t('Equipment summary')}>
        <div>
          <span>{t('Active equipment')}</span>
          <strong>{summary?.active || 0}</strong>
        </div>
        <div>
          <span>{t('Available')}</span>
          <strong>{summary?.available || 0}</strong>
        </div>
        <div>
          <span>{t('Attention')}</span>
          <strong>{summary?.attention || 0}</strong>
        </div>
        <div>
          <span>{t('Checked out')}</span>
          <strong>{custody?.summary?.checkedOut || 0}</strong>
        </div>
      </div>
      <section className="equipment-custody-register" data-testid="equipment-custody-register">
        <div className="qualification-band-heading">
          <div>
            <h3>{t('Physical custody')}</h3>
            <p>{t('Every yard-to-crew handoff has one custodian, return deadline, condition record, and retained evidence reference.')}</p>
          </div>
          <div className="equipment-custody-heading-actions">
            {custody?.summary?.overdue ? <span className="tag tag-amber">{t('{count} overdue', { count: custody.summary.overdue })}</span> : null}
            {custody?.summary?.exceptions ? <span className="tag tag-red">{t('{count} quarantined', { count: custody.summary.exceptions })}</span> : null}
            {canCoordinate ? (
              <button className="primary-button" disabled={submitting} onClick={onCheckout}>
                <ArrowUpRight size={15} /> {t('Check out')}
              </button>
            ) : null}
          </div>
        </div>
        <div className="equipment-custody-list">
          {(custody?.sessions || []).slice(0, 12).map((session) => (
            <article className="equipment-custody-row" key={session.id}>
              <span className={`equipment-custody-marker ${session.status === 'exception' || session.overdue ? 'equipment-custody-marker-alert' : ''}`} aria-hidden="true" />
              <div>
                <div className="equipment-title">
                  <h4>{session.toolName}</h4>
                  <span className={`status status-${session.overdue ? 'attention' : session.status}`}>
                    {t((session.overdue ? 'overdue' : session.status).replaceAll('_', ' '))}
                  </span>
                </div>
                <p>{session.jobTitle} / {session.workerName || session.checkedOutBy}</p>
              </div>
              <div className="equipment-custody-values">
                <span>{t('Out')} <strong>{formatDateTime(session.checkedOutAt)}</strong></span>
                <span>{t('Due')} <strong>{session.dueBackAt ? formatDateTime(session.dueBackAt) : t('Open')}</strong></span>
                <span>{t('Condition')} <strong>{t((session.returnCondition || session.checkoutCondition).replaceAll('_', ' '))}</strong></span>
                <span>{t('Location')} <strong>{session.returnLocation || session.checkoutLocation || t('Not retained')}</strong></span>
              </div>
              {canCoordinate && session.status === 'checked_out' ? (
                <button className="secondary-button" disabled={submitting} onClick={() => onReturn(session)}>
                  <PackageCheck size={15} /> {t('Return')}
                </button>
              ) : null}
            </article>
          ))}
          {!custody?.sessions?.length ? <Empty title={t('No custody history')} detail={t('Check out reserved equipment to retain its physical handoff and return.')} /> : null}
        </div>
      </section>
      <div className="trade-partner-toolbar equipment-toolbar">
        <label className="search-control">
          <Search size={16} />
          <span className="visually-hidden">{t('Search equipment directory')}</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search equipment')} />
        </label>
        <div className="resource-tabs" role="tablist" aria-label={t('Equipment status')}>
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
              {t(label)}
            </button>
          ))}
        </div>
        {canCoordinate ? (
          <button className="secondary-button" disabled={submitting} onClick={onCreate}>
            <Plus size={16} />
            {t('Add equipment')}
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
                  <span className={`status status-${tool.status}`}>{t(tool.status.replaceAll('_', ' '))}</span>
                  {tool.inspection?.required ? (
                    <span className={`tag ${tool.inspection.requiresAttention ? 'tag-amber' : 'tag-green'}`}>
                      {t('Inspection')} {t(tool.inspection.status.replaceAll('_', ' '))}
                    </span>
                  ) : null}
                  {tool.retirementApprovalId ? <span className="tag tag-amber">{t('Retirement pending')}</span> : null}
                </div>
                <p>{t(tool.category || 'general equipment')}</p>
                <small>{tool.data?.serialNumber || tool.currentLocation || tool.homeLocation || t('Reference not retained')}</small>
              </div>
            </div>
            <div className="trade-partner-evidence equipment-details">
              <span>
                {t('Current location')} <strong>{tool.currentLocation || t('Not retained')}</strong>
              </span>
              <span>
                {t('Inspection due')} <strong>{tool.inspection?.required ? formatDate(tool.inspection.dueAt) : t('Not required')}</strong>
              </span>
              <span>
                {t('Last inspection')}{' '}
                <strong>
                  {tool.inspection?.lastInspectedAt
                    ? `${formatDate(tool.inspection.lastInspectedAt)} / ${t(tool.inspection.lastResult.replaceAll('_', ' '))}`
                    : t('Not retained')}
                </strong>
              </span>
              <span>
                {t('Last maintenance')}{' '}
                <strong>
                  {tool.maintenance?.lastMaintainedAt
                    ? `${formatDate(tool.maintenance.lastMaintainedAt)} / ${tool.maintenance.latestMaintenance?.outcome ? t(tool.maintenance.latestMaintenance.outcome.replaceAll('_', ' ')) : t('Not retained')}`
                    : t('Not retained')}
                </strong>
              </span>
              <span>
                {t('Active reservations')} <strong>{tool.activeReservationCount || 0}</strong>
              </span>
              <span>
                {t('Last updated')} <strong>{formatDate(tool.updatedAt)}</strong>
              </span>
              {tool.dormantReservationCount ? (
                <span>
                  {t('Dormant reservations')} <strong>{tool.dormantReservationCount}</strong>
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
                  {t('Review retirement')}
                </button>
              ) : null}
              {canCoordinate && tool.status !== 'retired' && !tool.retirementApprovalId ? (
                <button
                  className="secondary-button"
                  aria-label={t('Record maintenance for {name}', { name: tool.name })}
                  disabled={submitting}
                  onClick={() => onMaintain(tool)}
                >
                  <Wrench size={15} />
                  {t('Maintain')}
                </button>
              ) : null}
              {canCoordinate && tool.status !== 'retired' && !tool.retirementApprovalId ? (
                <button
                  className="secondary-button"
                  aria-label={t('Record inspection for {name}', { name: tool.name })}
                  disabled={submitting}
                  onClick={() => onInspect(tool)}
                >
                  <ClipboardCheck size={15} />
                  {t('Inspect')}
                </button>
              ) : null}
              {canCoordinate && tool.status !== 'retired' ? (
                <button className="icon-button" aria-label={t('Edit {name}', { name: tool.name })} disabled={submitting} onClick={() => onEdit(tool)}>
                  <Pencil size={16} />
                </button>
              ) : null}
              {canCoordinate && tool.status !== 'retired' ? (
                <button
                  className="icon-button danger-icon"
                  aria-label={t('Request retirement for {name}', { name: tool.name })}
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
          <Empty title={t('No matching equipment')} detail={t('Retained equipment records matching this view will appear here.')} />
        ) : null}
      </div>
    </div>
  )
}

function TradePartnerDirectory({ t = identityText, partners, summary, canCoordinate, canApprove, submitting, onCreate, onEdit, onRetire, onOpenApprovals }) {
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
      <div className="resource-summary trade-partner-summary" aria-label={t('Trade partner summary')}>
        <div>
          <span>{t('Active')}</span>
          <strong>{summary?.active || 0}</strong>
        </div>
        <div>
          <span>{t('Verified')}</span>
          <strong>{summary?.verified || 0}</strong>
        </div>
        <div>
          <span>{t('Expiring')}</span>
          <strong>{summary?.expiring || 0}</strong>
        </div>
        <div>
          <span>{t('Action required')}</span>
          <strong>{summary?.actionRequired || 0}</strong>
        </div>
      </div>
      <div className="trade-partner-toolbar">
        <label className="search-control">
          <Search size={16} />
          <span className="visually-hidden">{t('Search trade partners')}</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search partners')} />
        </label>
        <div className="resource-tabs" role="tablist" aria-label={t('Trade partner status')}>
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
              {t(label)}
            </button>
          ))}
        </div>
        {canCoordinate ? (
          <button className="primary-button" disabled={submitting} onClick={onCreate}>
            <Plus size={16} />
            {t('Add trade partner')}
          </button>
        ) : null}
      </div>
      <div className="trade-partner-list">
        {visiblePartners.map((partner) => {
          const compliance = partner.compliance || { status: 'needs_review', blockers: [], warnings: [] }
          const evidenceMessage =
            compliance.blockers?.[0]?.message || compliance.warnings?.[0]?.message || t('Required partner evidence is current.')
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
                    {partner.specialties?.length ? ` / ${partner.specialties.slice(0, 3).join(', ')}` : ''}
                  </p>
                  <small>{partner.contactName || partner.email || partner.city || t('Contact not retained')}</small>
                </div>
              </div>
              <div className="trade-partner-evidence">
                <span>
                  {t('Registration')} <strong>{partner.registrationNumber || t('Missing')}</strong>
                </span>
                <span>
                  {t('VAT')} <strong>{partner.data?.vatExempt ? t('Exempt') : partner.vatNumber || t('Missing')}</strong>
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
                    {t('Review retirement')}
                  </button>
                ) : null}
                {canCoordinate && partner.status !== 'retired' ? (
                  <button className="icon-button" aria-label={t('Edit {name}', { name: partner.name })} disabled={submitting} onClick={() => onEdit(partner)}>
                    <Pencil size={16} />
                  </button>
                ) : null}
                {canCoordinate && partner.status !== 'retired' ? (
                  <button
                    className="icon-button danger-icon"
                    aria-label={t('Request retirement for {name}', { name: partner.name })}
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
          <Empty title={t('No matching trade partners')} detail={t('Supplier and subcontractor records matching this view will appear here.')} />
        ) : null}
      </div>
    </div>
  )
}

function TimesheetWorkspace({
  t = identityText,
  timesheets,
  canCoordinate,
  canApprove,
  submitting,
  onPeriodChange,
  onRequest,
  onPrepareExport,
  onOpenApprovals,
}) {
  const board = timesheets || { rows: [], exports: [], summary: {} }
  const [periodStart, setPeriodStart] = useState(board.periodStart || mondayDateInput())
  useEffect(() => {
    if (board.periodStart) setPeriodStart(board.periodStart)
  }, [board.periodStart])
  const summary = board.summary || {}
  const latestExport = board.exports?.[0] || null

  const changePeriod = (value) => {
    const monday = mondayDateInput(value)
    setPeriodStart(monday)
    if (monday) onPeriodChange(monday)
  }

  return (
    <div className="timesheet-workspace" data-testid="timesheet-workspace">
      <div className="timesheet-toolbar">
        <label>
          {t('Week starting')}
          <input type="date" value={periodStart} onChange={(event) => changePeriod(event.target.value)} />
        </label>
        <div className="timesheet-toolbar-actions">
          {latestExport?.integrityValid ? (
            <a className="secondary-button" href={latestExport.downloadPath} download>
              <FileDown size={15} />
              {t('Download latest')}
            </a>
          ) : null}
          {canCoordinate ? (
            <button
              type="button"
              className="primary-button"
              data-testid="prepare-timesheet-export"
              disabled={submitting || !summary.handoffReady}
              title={t(summary.handoffReady ? 'Prepare a checksum-protected CSV handoff' : 'Approve every submitted worker week before preparing a handoff')}
              onClick={() => onPrepareExport(periodStart)}
            >
              <FileDown size={15} />
              {t('Prepare handoff')}
            </button>
          ) : null}
        </div>
      </div>
      <div className="timesheet-summary" aria-label={t('Weekly timesheet summary')}>
        <div><span>{t('Submitted hours')}</span><strong>{roundDisplay(summary.submittedHours || 0)}</strong></div>
        <div><span>{t('Review required')}</span><strong>{summary.reviewRequired || 0}</strong></div>
        <div><span>{t('Approved')}</span><strong>{summary.approved || 0}</strong></div>
        <div><span>{t('Exceptions')}</span><strong>{summary.exceptions || 0}</strong></div>
      </div>
      <div className="timesheet-list">
        {(board.rows || []).map((row) => {
          const preview = row.preview || { summary: {}, exceptions: [], blockers: [] }
          const current = row.current
          const pending = current?.status === 'pending_approval'
          const approved = current?.status === 'approved' && row.sourceCurrent
          const canSubmit = canCoordinate && preview.ready && !pending && !approved
          return (
            <article className="timesheet-row" key={row.worker.id} data-testid={`timesheet-row-${row.worker.id}`}>
              <div className="timesheet-row-heading">
                <span className="timesheet-worker-icon"><Users size={17} /></span>
                <div>
                  <strong>{row.worker.name}</strong>
                  <small>{row.worker.role || t('Crew member')} / {t('{start} to {end}', { start: formatDate(board.periodStart), end: formatDate(board.periodEnd) })}</small>
                </div>
                <span className={`status status-${row.sourceCurrent ? row.status : 'attention'}`}>
                  {row.sourceCurrent ? formatStatus(row.status) : t('revision needed')}
                </span>
              </div>
              <div className="timesheet-values">
                <span><strong>{roundDisplay(preview.summary.totalHours || 0)}</strong> {t('logged')}</span>
                <span><strong>{roundDisplay(preview.summary.billableHours || 0)}</strong> {t('billable')}</span>
                <span><strong>{roundDisplay(preview.summary.attendanceHours || 0)}</strong> {t('attendance')}</span>
                <span><strong>{preview.summary.jobCount || 0}</strong> {t('jobs')}</span>
              </div>
              {preview.exceptions?.length ? (
                <div className="timesheet-exceptions">
                  <TriangleAlert size={15} />
                  <span>{preview.exceptions.slice(0, 2).map((item) => item.message).join(' ')}</span>
                </div>
              ) : null}
              {!preview.ready ? (
                <div className="timesheet-exceptions timesheet-blocker">
                  <Ban size={15} />
                  <span>{preview.blockers?.map((item) => item.message).join(' ') || t('Source evidence is not ready for review.')}</span>
                </div>
              ) : null}
              <div className="timesheet-row-actions">
                {current ? <span className="timesheet-version">v{current.versionNumber} / {shortHash(current.sourceHash)}</span> : <span className="timesheet-version">{t('No retained review')}</span>}
                {pending && canApprove ? (
                  <button type="button" className="secondary-button" disabled={submitting} onClick={() => onOpenApprovals({ approvalId: current.approvalId })}>
                    <ShieldCheck size={15} />
                    {t('Review approval')}
                  </button>
                ) : null}
                {canSubmit ? (
                  <button type="button" className="secondary-button" disabled={submitting} onClick={() => onRequest(row.worker.id, periodStart)}>
                    <ClipboardCheck size={15} />
                    {t(current?.status === 'approved' ? 'Request revision' : 'Request review')}
                  </button>
                ) : null}
              </div>
            </article>
          )
        })}
        {!board.rows?.length ? <Empty title={t('No workers in this period')} detail={t('Workers and retained time evidence for the selected week will appear here.')} /> : null}
      </div>
      <p className="timesheet-policy">{t('Approved worker time logs remain the payable-hours source. Attendance is shown only for exception review; preparing a handoff does not execute payroll or contact a provider.')}</p>
    </div>
  )
}

function MaterialReceivingWorkspace({ t = identityText, register, canCoordinate, canApprove, submitting, onCreate, onReverse, onOpenApprovals, onOpen }) {
  const [view, setView] = useState('active')
  const receipts = register?.receipts || EMPTY_LIST
  const purchaseOrders = register?.purchaseOrders || EMPTY_LIST
  const summary = register?.summary || {}
  const visibleReceipts = receipts.filter((receipt) => {
    if (view === 'active') return receipt.status !== 'reversed'
    if (view === 'exceptions') return ['discrepancy', 'pending_reversal'].includes(receipt.status)
    return true
  })
  const openPlans = purchaseOrders.filter((plan) => !plan.summary?.complete)

  return (
    <div className="material-receiving-workspace" data-testid="material-receiving-workspace">
      <div className="resource-summary" aria-label={t('Material receiving summary')}>
        <div><span>{t('Receipts')}</span><strong>{summary.total || 0}</strong></div>
        <div><span>{t('Discrepancies')}</span><strong>{summary.discrepancies || 0}</strong></div>
        <div><span>{t('Awaiting receipt')}</span><strong>{summary.openOrders || 0}</strong></div>
        <div><span>{t('Accepted units')}</span><strong>{roundDisplay(summary.acceptedQuantity || 0)}</strong></div>
      </div>
      <div className="workforce-mode-toolbar">
        <div className="resource-tabs" role="tablist" aria-label={t('Material receipt status')}>
          {[
            ['active', 'Active'],
            ['exceptions', 'Exceptions'],
            ['history', 'History'],
          ].map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? 'resource-tab-active' : ''} onClick={() => setView(key)}>
              {t(label)}
            </button>
          ))}
        </div>
        {canCoordinate ? (
          <button type="button" className="primary-button" disabled={submitting} onClick={() => onCreate()}>
            <Plus size={15} /> {t('Record delivery')}
          </button>
        ) : null}
      </div>
      {view !== 'history' && openPlans.length ? (
        <div className="resource-readiness-list material-receiving-orders" aria-label={t('Purchase orders awaiting receipt')}>
          {openPlans.map((plan) => {
            const order = plan.purchaseOrder || {}
            return (
              <article className="resource-readiness-item" key={order.id}>
                <div className="resource-readiness-copy">
                  <div className="resource-readiness-title">
                    <h3>{order.supplier || t('Retained supplier')}</h3>
                    <span className="status status-attention">{t('{count} lines due', { count: plan.summary?.remainingLines || 0 })}</span>
                  </div>
                  <p>{order.jobTitle || order.jobId} / {order.issueReference || order.orderNumber || order.id}</p>
                  <small>{plan.lines.filter((line) => !line.complete).map((line) => `${line.itemName}: ${roundDisplay(line.remainingQuantity)} ${line.unit}`).join(' / ')}</small>
                </div>
                {canCoordinate ? (
                  <button type="button" className="secondary-button" disabled={submitting} onClick={() => onCreate(plan)}>
                    <PackageCheck size={15} /> {t('Receive')}
                  </button>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : null}
      <div className="resource-readiness-list" role="tabpanel">
        {visibleReceipts.map((receipt) => (
          <article className="resource-readiness-item" key={receipt.id} data-testid={`material-receipt-${receipt.id}`}>
            <div className="resource-readiness-copy">
              <div className="resource-readiness-title">
                <h3>{receipt.receiptReference}</h3>
                <span className={`status status-${receipt.status}`}>{formatStatus(receipt.status)}</span>
              </div>
              <p>{receipt.jobTitle || receipt.jobId} / {receipt.receivedBy} / {formatDateTime(receipt.deliveredAt)}</p>
              <small>{receipt.lines?.map((line) => t('{item}: {quantity} {unit} accepted', { item: line.itemName, quantity: roundDisplay(line.acceptedQuantity), unit: line.unit })).join(' / ')}</small>
              {receipt.exceptions?.length ? <p className="workflow-note">{receipt.exceptions.map((item) => item.message).join(' ')}</p> : null}
            </div>
            <div className="timesheet-row-actions">
              <button type="button" className="icon-button" title={t('Open job')} aria-label={t('Open {name}', { name: receipt.jobTitle || t('job') })} onClick={() => onOpen(receipt.jobId)}><ChevronRight size={16} /></button>
              {receipt.status === 'pending_reversal' && canApprove ? (
                <button type="button" className="secondary-button" onClick={() => onOpenApprovals({ approvalId: receipt.reversalApprovalId })}><ShieldCheck size={15} /> {t('Review')}</button>
              ) : canCoordinate && ['received', 'discrepancy'].includes(receipt.status) ? (
                <button type="button" className="secondary-button" disabled={submitting} onClick={() => onReverse(receipt)}><Undo2 size={15} /> {t('Reverse')}</button>
              ) : null}
            </div>
          </article>
        ))}
        {!visibleReceipts.length ? <Empty title={t('No material receipts')} detail={t('Retained delivery tickets and discrepancy evidence will appear here.')} /> : null}
      </div>
      <p className="timesheet-policy">{t('Receipts are immutable operational evidence. Corrections use an approval-gated reversal; supplier invoices can link only to current retained receipt evidence.')}</p>
    </div>
  )
}

function ResourcesWorkspace({
  locale = 'en-GB',
  workforce,
  inventory,
  workers,
  workerSummary,
  qualificationRegister,
  availabilityRegister,
  materialReceiving,
  tools,
  toolSummary,
  equipmentCustody,
  fiveS,
  tradePartners,
  tradePartnerSummary,
  timesheets,
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
  onAddCredential,
  onCreateQualificationRequirement,
  onRetireQualificationRequirement,
  onCreateAvailability,
  onCancelAvailability,
  onCreateMaterialReceipt,
  onReverseMaterialReceipt,
  onCreateEquipment,
  onEditEquipment,
  onInspectEquipment,
  onMaintainEquipment,
  onRetireEquipment,
  onCheckoutEquipment,
  onReturnEquipment,
  onCreatePartner,
  onEditPartner,
  onRetirePartner,
  onTimesheetPeriodChange,
  onRequestTimesheet,
  onPrepareTimesheetExport,
  onOpenApprovals,
  onOpen,
  request,
}) {
  const t = (key, variables = {}) => operatorText(locale, key, variables)
  const [workforceMode, setWorkforceMode] = useState('readiness')
  const isWorkforce = view === 'workforce'
  const isInventory = view === 'inventory'
  const isReceiving = view === 'receiving'
  const isEquipment = view === 'equipment'
  const isFiveS = view === 'five_s'
  const isPartners = view === 'partners'
  const isTimesheets = view === 'timesheets'
  const isCrewDirectory = isWorkforce && workforceMode === 'crew'
  const isQualifications = isWorkforce && workforceMode === 'qualifications'
  const isAvailability = isWorkforce && workforceMode === 'availability'
  const stream = isWorkforce ? workforce : inventory
  const rows = stream?.jobs || EMPTY_LIST
  const summary = stream?.summary || {}

  return (
    <section className="panel page-panel resources-workspace" data-testid="resources-workspace">
      <div className="panel-heading resources-heading">
        <div>
          <h2>{t(isTimesheets ? 'Weekly labor review' : isReceiving ? 'Material receiving' : isFiveS ? '5S organization control' : 'Resource readiness')}</h2>
          <p>
            {isTimesheets
              ? t('Review submitted worker time by week, resolve exceptions, approve immutable revisions, and prepare a controlled payroll handoff.')
              : isReceiving
                ? t('Retain delivery-note evidence, resolve quantity and damage exceptions, and connect accepted goods to purchasing and finance.')
              : isPartners
              ? t('Retain supplier and subcontractor identity, compliance, and expiry evidence before purchasing approval.')
              : isFiveS
                ? t('Control vehicle, trailer, depot, store, and job-storage standards with approved checks, field audits, and evidence-backed corrective actions.')
              : isEquipment
                ? t('Maintain retained equipment identity, condition, location, reservation, and retirement safeguards.')
                : isQualifications
                  ? t('Verify retained worker credentials, enforce role-specific job requirements, and resolve expiry or evidence gaps before site work.')
                : isAvailability
                  ? t('Retain time-bounded operational availability and resolve assignment conflicts before scheduling or dispatch.')
                : isCrewDirectory
                  ? t('Maintain retained crew identity, availability, skills, cost, and assignment safeguards.')
                  : t('Coordinate retained crew, equipment, material, procurement, and loading records before work is committed.')}
          </p>
        </div>
        <div className="resource-tabs" role="tablist" aria-label={t('Resource readiness view')}>
          <button
            role="tab"
            aria-selected={isWorkforce}
            className={isWorkforce ? 'resource-tab-active' : ''}
            onClick={() => onViewChange('workforce')}
          >
            <Users size={15} />
            {t('Workforce')}
          </button>
          <button
            role="tab"
            aria-selected={isInventory}
            className={isInventory ? 'resource-tab-active' : ''}
            onClick={() => onViewChange('inventory')}
          >
            <PackageCheck size={15} />
            {t('Inventory')}
          </button>
          <button
            role="tab"
            aria-selected={isReceiving}
            className={isReceiving ? 'resource-tab-active' : ''}
            onClick={() => onViewChange('receiving')}
          >
            <ClipboardList size={15} />
            {t('Receiving')}
          </button>
          <button
            role="tab"
            aria-selected={isEquipment}
            className={isEquipment ? 'resource-tab-active' : ''}
            onClick={() => onViewChange('equipment')}
          >
            <Wrench size={15} />
            {t('Equipment')}
          </button>
          <button
            role="tab"
            aria-selected={isFiveS}
            className={isFiveS ? 'resource-tab-active' : ''}
            onClick={() => onViewChange('five_s')}
          >
            <Truck size={15} />
            5S
          </button>
          <button
            role="tab"
            aria-selected={isPartners}
            className={isPartners ? 'resource-tab-active' : ''}
            onClick={() => onViewChange('partners')}
          >
            <Building2 size={15} />
            {t('Trade partners')}
          </button>
          <button
            role="tab"
            aria-selected={isTimesheets}
            className={isTimesheets ? 'resource-tab-active' : ''}
            onClick={() => onViewChange('timesheets')}
          >
            <Timer size={15} />
            {t('Timesheets')}
          </button>
        </div>
      </div>
      {isWorkforce ? (
        <div className="workforce-mode-toolbar">
          <div className="resource-tabs" role="tablist" aria-label={t('Workforce workspace mode')}>
            <button
              role="tab"
              aria-selected={workforceMode === 'readiness'}
              className={workforceMode === 'readiness' ? 'resource-tab-active' : ''}
              onClick={() => setWorkforceMode('readiness')}
            >
              <ClipboardCheck size={15} />
              {t('Readiness')}
            </button>
            <button
              role="tab"
              aria-selected={workforceMode === 'crew'}
              className={workforceMode === 'crew' ? 'resource-tab-active' : ''}
              onClick={() => setWorkforceMode('crew')}
            >
              <Users size={15} />
              {t('Crew directory')}
            </button>
            <button
              role="tab"
              aria-selected={workforceMode === 'qualifications'}
              className={workforceMode === 'qualifications' ? 'resource-tab-active' : ''}
              onClick={() => setWorkforceMode('qualifications')}
            >
              <ShieldCheck size={15} />
              {t('Qualifications')}
            </button>
            <button
              role="tab"
              aria-selected={workforceMode === 'availability'}
              className={workforceMode === 'availability' ? 'resource-tab-active' : ''}
              onClick={() => setWorkforceMode('availability')}
            >
              <CalendarOff size={15} />
              {t('Availability')}
            </button>
          </div>
        </div>
      ) : null}
      {isFiveS ? (
        <FiveSWorkspace
          locale={locale}
          board={fiveS}
          request={request}
          jobs={jobs}
          tools={tools}
          canCoordinate={canCoordinate}
          canApprove={canApprove}
          onOpenApprovals={onOpenApprovals}
        />
      ) : isReceiving ? (
        <MaterialReceivingWorkspace
          t={t}
          register={materialReceiving}
          canCoordinate={canCoordinate}
          canApprove={canApprove}
          submitting={submitting}
          onCreate={onCreateMaterialReceipt}
          onReverse={onReverseMaterialReceipt}
          onOpenApprovals={onOpenApprovals}
          onOpen={onOpen}
        />
      ) : isTimesheets ? (
        <TimesheetWorkspace
          t={t}
          timesheets={timesheets}
          canCoordinate={canCoordinate}
          canApprove={canApprove}
          submitting={submitting}
          onPeriodChange={onTimesheetPeriodChange}
          onRequest={onRequestTimesheet}
          onPrepareExport={onPrepareTimesheetExport}
          onOpenApprovals={onOpenApprovals}
        />
      ) : isPartners ? (
        <TradePartnerDirectory
          t={t}
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
          t={t}
          tools={tools}
          summary={toolSummary}
          custody={equipmentCustody}
          canCoordinate={canCoordinate}
          canApprove={canApprove}
          submitting={submitting}
          onCreate={onCreateEquipment}
          onEdit={onEditEquipment}
          onInspect={onInspectEquipment}
          onMaintain={onMaintainEquipment}
          onRetire={onRetireEquipment}
          onCheckout={onCheckoutEquipment}
          onReturn={onReturnEquipment}
          onOpenApprovals={onOpenApprovals}
        />
      ) : isAvailability ? (
        <AvailabilityWorkspace
          t={t}
          register={availabilityRegister}
          workers={workers}
          canCoordinate={canCoordinate}
          canApprove={canApprove}
          submitting={submitting}
          onCreate={onCreateAvailability}
          onCancel={onCancelAvailability}
          onOpenApprovals={onOpenApprovals}
        />
      ) : isQualifications ? (
        <QualificationWorkspace
          t={t}
          register={qualificationRegister}
          workers={workers}
          canCoordinate={canCoordinate}
          canApprove={canApprove}
          submitting={submitting}
          onAddCredential={onAddCredential}
          onCreateRequirement={onCreateQualificationRequirement}
          onRetireRequirement={onRetireQualificationRequirement}
          onOpenApprovals={onOpenApprovals}
          onOpenJob={onOpen}
        />
      ) : isCrewDirectory ? (
        <WorkerDirectory
          t={t}
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
          <div className="resource-summary" aria-label={t(isWorkforce ? 'Workforce summary' : 'Inventory summary')}>
            {isWorkforce ? (
              <>
                <div>
                  <span>{t('Needs crew')}</span>
                  <strong>{summary.needsAssignment || 0}</strong>
                </div>
                <div>
                  <span>{t('Conflicts')}</span>
                  <strong>{summary.workerConflicts || 0}</strong>
                </div>
                <div>
                  <span>{t('Instructions')}</span>
                  <strong>{summary.needsInstruction || 0}</strong>
                </div>
                <div>
                  <span>{t('Site access')}</span>
                  <strong>{summary.siteAccess || 0}</strong>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>{t('Procurement')}</span>
                  <strong>{summary.procurementNeeded || 0}</strong>
                </div>
                <div>
                  <span>{t('Partner holds')}</span>
                  <strong>{summary.partnerComplianceBlocks || 0}</strong>
                </div>
                <div>
                  <span>{t('Loading gaps')}</span>
                  <strong>{summary.loadingMissing || 0}</strong>
                </div>
                <div>
                  <span>{t('Approvals')}</span>
                  <strong>{summary.pendingApprovals || 0}</strong>
                </div>
              </>
            )}
          </div>
          <div className="resource-readiness-list" role="tabpanel">
            {rows.map((item) => {
              const job = jobs.find((candidate) => candidate.id === item.jobId) || { id: item.jobId, title: item.jobTitle || t('Ledger job') }
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
              const resourceActionLabel = resourceAction ? t(RESOURCE_ACTION_LABELS[resourceAction.type]) : null
              const crewReviewActions =
                canAct && isWorkforce
                  ? item.nextActions?.filter((action) => ['publish_worker_instruction', 'clear_site_access'].includes(action.type)) || []
                  : []
              return (
                <article className="resource-readiness-item" key={`${view}-${item.jobId}`}>
                  <div className="resource-readiness-copy">
                    <div className="resource-readiness-title">
                      <h3>{item.jobTitle || t('Ledger job')}</h3>
                      <span className={`status status-${status}`}>{formatStatus(status)}</span>
                    </div>
                    <p>{t(item.nextAction || 'Resource records are stable.')}</p>
                    {isWorkforce ? (
                      <div className="resource-readiness-values">
                        <span>
                          {t('Assigned')} <strong>{item.counts?.activeAssignments || 0}</strong>
                        </span>
                        <span>
                          {t('Conflicts')} <strong>{item.counts?.workerConflicts || 0}</strong>
                        </span>
                        <span>
                          {t('Unavailable')} <strong>{item.counts?.offlineAssignments || 0}</strong>
                        </span>
                        <span>
                          {t('Instructions')} <strong>{item.counts?.workerInstructions || 0}</strong>
                        </span>
                        <span>
                          {t('Hours logged')} <strong>{item.counts?.billableHours || 0}</strong>
                        </span>
                      </div>
                    ) : (
                      <div className="resource-readiness-values">
                        <span>
                          {t('Open materials')} <strong>{item.counts?.openMaterials || 0}</strong>
                        </span>
                        <span>
                          {t('Reserved tools')} <strong>{item.counts?.toolReservations || 0}</strong>
                        </span>
                        <span>
                          {t('Load items')} <strong>{item.counts?.loadingItems || 0}</strong>
                        </span>
                        <span>
                          {t('Material cost')} <strong>{currency.format(item.money?.materialCost || 0)}</strong>
                        </span>
                      </div>
                    )}
                    <div className="resource-readiness-flags">
                      {item.counts?.pendingApprovals ? (
                        <span className="tag tag-amber">
                          {t(item.counts.pendingApprovals === 1 ? '{count} approval' : '{count} approvals', { count: item.counts.pendingApprovals })}
                        </span>
                      ) : null}
                      {!isWorkforce && item.counts?.partnerComplianceBlocks ? (
                        <span className="tag tag-amber">
                          {t(item.counts.partnerComplianceBlocks === 1 ? '{count} partner hold' : '{count} partner holds', { count: item.counts.partnerComplianceBlocks })}
                        </span>
                      ) : null}
                      {isWorkforce && item.counts?.dueOrientations ? (
                        <span className="tag tag-amber">{t('{count} orientation due', { count: item.counts.dueOrientations })}</span>
                      ) : null}
                      {isWorkforce && item.counts?.staleCrewEvidence ? (
                        <span className="tag">
                          {t(item.counts.staleCrewEvidence === 1 ? '{count} historical crew record' : '{count} historical crew records', { count: item.counts.staleCrewEvidence })}
                        </span>
                      ) : null}
                      {!isWorkforce && item.counts?.dueMaterials ? (
                        <span className="tag tag-amber">
                          {t(item.counts.dueMaterials === 1 ? '{count} material item due' : '{count} material items due', { count: item.counts.dueMaterials })}
                        </span>
                      ) : null}
                      {!isWorkforce && item.loadingReadiness?.trailerRequired ? <span className="tag">{t('Trailer required')}</span> : null}
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
                        {t('Review approval')}
                      </button>
                    ) : null}
                    {!isWorkforce && item.flags?.supplierComplianceBlocked && canCoordinate ? (
                      <button className="secondary-button" disabled={submitting} onClick={() => onViewChange('partners')}>
                        <Building2 size={16} />
                        {t('Trade partners')}
                      </button>
                    ) : null}
                    {canPlan ? (
                      <button className="secondary-button" disabled={submitting} onClick={() => onPlan(item)}>
                        <Users size={16} />
                        {t('Plan resources')}
                      </button>
                    ) : null}
                    {canDraftInstruction ? (
                      <button
                        className="secondary-button"
                        aria-label={t('Draft crew instructions for {name}', { name: job.title })}
                        disabled={submitting}
                        onClick={() => onDraftInstruction(item)}
                      >
                        <ClipboardCheck size={16} />
                        {t('Draft instructions')}
                      </button>
                    ) : null}
                    {crewReviewActions.map((action) => (
                      <button
                        className="secondary-button"
                        key={`${action.type}-${action.recordId || action.assignmentId || action.workerId}`}
                        aria-label={t('{action} for {name}', { action: t(action.label), name: job.title })}
                        disabled={submitting}
                        onClick={() => onReviewCrewEvidence(item, action)}
                      >
                        <ShieldCheck size={16} />
                        {t(action.type === 'publish_worker_instruction' ? 'Review instructions' : 'Clear site access')}
                      </button>
                    ))}
                    {canDraftProcurement ? (
                      <button
                        className="secondary-button"
                        aria-label={t('Draft procurement for {name}', { name: job.title })}
                        disabled={submitting}
                        onClick={() => onDraftProcurement(item)}
                      >
                        <ReceiptEuro size={16} />
                        {t('Draft procurement')}
                      </button>
                    ) : null}
                    {canPrepareLoading ? (
                      <button
                        className="secondary-button"
                        aria-label={t('Prepare loading checklist for {name}', { name: job.title })}
                        disabled={submitting}
                        onClick={() => onPrepareLoading(item)}
                      >
                        <PackageCheck size={16} />
                        {t('Loading checklist')}
                      </button>
                    ) : null}
                    {resourceAction && resourceActionLabel ? (
                      <button
                        className="secondary-button"
                        aria-label={t('{action} for {name}', { action: resourceActionLabel, name: job.title })}
                        disabled={submitting}
                        onClick={() => onAction(item, resourceAction)}
                      >
                        <ClipboardCheck size={16} />
                        {resourceActionLabel}
                      </button>
                    ) : null}
                    <button className="icon-button table-action" aria-label={t('Open {name}', { name: job.title })} onClick={() => onOpen(job)}>
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                </article>
              )
            })}
            {!rows.length ? (
              <Empty
                title={t(isWorkforce ? 'No workforce work' : 'No inventory work')}
                detail={
                  isWorkforce
                    ? t('Scheduled ledger jobs will appear here with crew readiness and time controls.')
                    : t('Material and equipment requirements will appear here with procurement and loading controls.')
                }
              />
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}

export default ResourcesWorkspace
