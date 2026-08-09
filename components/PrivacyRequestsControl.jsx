import { useMemo, useState } from 'react'
import {
  CalendarClock,
  ClipboardCheck,
  FileDown,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react'
import Empty from './EmptyState'

const REQUEST_LABELS = {
  access: 'Access',
  rectification: 'Rectification',
  erasure: 'Erasure',
  restriction: 'Restriction',
  portability: 'Portability',
  objection: 'Objection',
}

const STATUS_LABELS = {
  open: 'Identity pending',
  in_review: 'Ready to assess',
  pending_approval: 'Approval pending',
  completed: 'Completed',
  partially_completed: 'Partially completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

const ACTIONS = {
  access: [['provide_access', 'Approve access package'], ['reject', 'Reject request']],
  portability: [['provide_portability', 'Approve portability package'], ['reject', 'Reject request']],
  rectification: [['apply_rectification', 'Apply rectification'], ['reject', 'Reject request']],
  restriction: [['apply_restriction', 'Apply restriction'], ['lift_restriction', 'Lift restriction'], ['reject', 'Reject request']],
  erasure: [['pseudonymize_current_records', 'Pseudonymize eligible records'], ['reject', 'Reject request']],
  objection: [['apply_objection', 'Apply marketing objection'], ['reject', 'Reject request']],
}

const CLIENT_CORRECTIONS = [
  ['name', 'Name'],
  ['company', 'Company'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['address', 'Address'],
  ['postalCode', 'Postal code'],
  ['city', 'City'],
  ['country', 'Country'],
  ['billingEmail', 'Billing email'],
  ['preferredLanguage', 'Preferred language'],
]

const WORKER_CORRECTIONS = [
  ['name', 'Name'],
  ['role', 'Role'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['homeRegion', 'Home region'],
]

function dateInput(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function readableDate(value) {
  if (!value) return 'No date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en-NL', { dateStyle: 'medium' }).format(date)
}

function emptyCreateDraft() {
  return {
    subjectType: 'client',
    subjectId: '',
    requestType: 'access',
    receivedAt: dateInput(),
    channel: 'email',
    requesterReference: '',
    details: '',
  }
}

function statusTone(request) {
  if (request.overdue) return 'status-danger'
  if (['completed', 'partially_completed'].includes(request.status)) return 'status-ready'
  if (['rejected', 'cancelled'].includes(request.status)) return 'status-muted'
  return 'status-attention'
}

function subjectValue(record, field) {
  if (record?.[field] !== undefined && record?.[field] !== null) return String(record[field])
  if (record?.data?.[field] !== undefined && record?.data?.[field] !== null) return String(record.data[field])
  return ''
}

export default function PrivacyRequestsControl({
  request,
  register,
  clients = [],
  workers = [],
  onRegisterChange,
  onOpenApprovals,
  onError,
  onNotice,
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState(() => emptyCreateDraft())
  const [workflow, setWorkflow] = useState(null)
  const [detail, setDetail] = useState(null)
  const [identityDraft, setIdentityDraft] = useState({ method: 'existing_contact', evidenceReference: '' })
  const [assessmentDraft, setAssessmentDraft] = useState({
    action: '', rationale: '', legalBasisReference: '', retentionPolicyReference: '', corrections: {},
  })
  const [extensionDraft, setExtensionDraft] = useState({ dueAt: '', reason: '', notificationReference: '' })
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [typeFilter, setTypeFilter] = useState('all')
  const [busy, setBusy] = useState(false)

  const requests = useMemo(() => register?.requests || [], [register?.requests])
  const summary = register?.summary || {}
  const subjects = createDraft.subjectType === 'client'
    ? clients
    : workers
  const clientsById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients])
  const workersById = useMemo(() => new Map(workers.map((worker) => [worker.id, worker])), [workers])
  const visibleRequests = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return requests.filter((item) => {
      if (statusFilter === 'active' && !['open', 'in_review', 'pending_approval'].includes(item.status)) return false
      if (statusFilter !== 'all' && statusFilter !== 'active' && item.status !== statusFilter) return false
      if (typeFilter !== 'all' && item.requestType !== typeFilter) return false
      return !needle || `${item.subjectLabel} ${item.subjectId} ${item.id}`.toLowerCase().includes(needle)
    })
  }, [requests, search, statusFilter, typeFilter])

  async function refreshRegister() {
    const result = await request('/api/operations/privacy/requests?status=all&limit=500')
    onRegisterChange({ requests: result.requests || [], summary: result.summary || {} })
    return result
  }

  async function submitCreate(event) {
    event.preventDefault()
    setBusy(true)
    onError('')
    try {
      await request('/api/operations/privacy/requests', {
        method: 'POST',
        body: JSON.stringify({
          ...createDraft,
          receivedAt: new Date(`${createDraft.receivedAt}T12:00:00.000Z`).toISOString(),
        }),
      })
      await refreshRegister()
      setCreateDraft(emptyCreateDraft())
      setCreateOpen(false)
      onNotice('Privacy request recorded with a one-calendar-month response target.')
    } catch (error) {
      onError(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function openWorkflow(mode, item) {
    onError('')
    setBusy(true)
    try {
      const result = await request(`/api/operations/privacy/requests/${encodeURIComponent(item.id)}`)
      setDetail(result)
      if (mode === 'identity') {
        setIdentityDraft({ method: 'existing_contact', evidenceReference: '' })
      }
      if (mode === 'assessment') {
        const subject = item.subjectType === 'client' ? clientsById.get(item.subjectId) : workersById.get(item.subjectId)
        const fields = item.subjectType === 'client' ? CLIENT_CORRECTIONS : WORKER_CORRECTIONS
        setAssessmentDraft({
          action: ACTIONS[item.requestType]?.[0]?.[0] || 'reject',
          rationale: '',
          legalBasisReference: '',
          retentionPolicyReference: '',
          corrections: Object.fromEntries(fields.map(([field]) => [field, { enabled: false, value: subjectValue(subject, field) }])),
        })
      }
      if (mode === 'extension') {
        const currentDue = new Date(item.dueAt)
        currentDue.setUTCDate(currentDue.getUTCDate() + 1)
        setExtensionDraft({ dueAt: dateInput(currentDue), reason: '', notificationReference: '' })
      }
      setWorkflow({ mode, item })
    } catch (error) {
      onError(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function submitIdentity(event) {
    event.preventDefault()
    setBusy(true)
    onError('')
    try {
      await request(`/api/operations/privacy/requests/${encodeURIComponent(workflow.item.id)}/identity`, {
        method: 'POST', body: JSON.stringify(identityDraft),
      })
      await refreshRegister()
      setWorkflow(null)
      setDetail(null)
      onNotice('Identity verification reference retained. No identity document was stored.')
    } catch (error) {
      onError(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function submitAssessment(event) {
    event.preventDefault()
    setBusy(true)
    onError('')
    try {
      const corrections = Object.fromEntries(
        Object.entries(assessmentDraft.corrections)
          .filter(([, correction]) => correction.enabled)
          .map(([field, correction]) => [field, correction.value]),
      )
      const result = await request(`/api/operations/privacy/requests/${encodeURIComponent(workflow.item.id)}/assessment`, {
        method: 'POST',
        body: JSON.stringify({
          action: assessmentDraft.action,
          rationale: assessmentDraft.rationale,
          legalBasisReference: assessmentDraft.legalBasisReference,
          retentionPolicyReference: assessmentDraft.retentionPolicyReference,
          corrections: assessmentDraft.action === 'apply_rectification' ? corrections : undefined,
        }),
      })
      await refreshRegister()
      setWorkflow(null)
      setDetail(null)
      onNotice('Source-current privacy decision sent for independent approval.')
      onOpenApprovals({ approvalId: result.approval.id, jobTitle: `${REQUEST_LABELS[workflow.item.requestType]} / ${workflow.item.subjectLabel}` })
    } catch (error) {
      onError(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function submitExtension(event) {
    event.preventDefault()
    setBusy(true)
    onError('')
    try {
      await request(`/api/operations/privacy/requests/${encodeURIComponent(workflow.item.id)}/extend`, {
        method: 'POST',
        body: JSON.stringify({
          dueAt: new Date(`${extensionDraft.dueAt}T23:59:59.999Z`).toISOString(),
          reason: extensionDraft.reason,
          notificationReference: extensionDraft.notificationReference,
        }),
      })
      await refreshRegister()
      setWorkflow(null)
      setDetail(null)
      onNotice('Extended response target, rationale, and notification evidence retained.')
    } catch (error) {
      onError(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function downloadExport(item) {
    setBusy(true)
    onError('')
    try {
      const payload = await request(`/api/operations/privacy/requests/${encodeURIComponent(item.id)}/export`)
      const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `contractor-ai-privacy-${item.id}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(link.href)
      onNotice('Approved package downloaded for human review before delivery.')
    } catch (error) {
      onError(error.message)
    } finally {
      setBusy(false)
    }
  }

  const workflowItem = workflow?.item
  const correctionFields = workflowItem?.subjectType === 'worker' ? WORKER_CORRECTIONS : CLIENT_CORRECTIONS
  const selectedCorrections = Object.values(assessmentDraft.corrections).filter((item) => item.enabled).length

  return (
    <>
      <section className="panel page-panel privacy-requests-panel" data-testid="privacy-requests-control">
        <div className="panel-heading privacy-requests-heading">
          <div>
            <h2>Privacy requests</h2>
            <p>AVG rights register for clients and workers, with retained decisions and response targets.</p>
          </div>
          <button className="primary-button" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            Record request
          </button>
        </div>

        <div className="privacy-requests-summary" aria-label="Privacy request summary">
          <div><span>Active</span><strong>{summary.active || 0}</strong></div>
          <div><span>Identity pending</span><strong>{summary.identityPending || 0}</strong></div>
          <div><span>Due in 7 days</span><strong>{summary.dueWithinSevenDays || 0}</strong></div>
          <div className={summary.overdue ? 'summary-danger' : ''}><span>Overdue</span><strong>{summary.overdue || 0}</strong></div>
        </div>

        <div className="privacy-request-filters">
          <label className="search-field">
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">Search privacy requests</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search person or request" />
          </label>
          <label>
            <span className="sr-only">Request status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="active">Active</option>
              <option value="all">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Request type</span>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">All request types</option>
              {Object.entries(REQUEST_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>

        {visibleRequests.length ? (
          <div className="privacy-request-list">
            {visibleRequests.map((item) => (
              <article className="privacy-request-row" key={item.id} data-testid={`privacy-request-${item.id}`}>
                <span className="privacy-request-icon" aria-hidden="true"><ShieldCheck size={16} /></span>
                <div className="privacy-request-identity">
                  <div className="privacy-request-title">
                    <h3>{item.subjectLabel}</h3>
                    <span className={`status ${statusTone(item)}`}>{item.overdue ? 'Overdue' : STATUS_LABELS[item.status] || item.status}</span>
                  </div>
                  <p>{REQUEST_LABELS[item.requestType] || item.requestType} / {item.subjectType}</p>
                  <small>{item.id}</small>
                </div>
                <div className="privacy-request-deadline">
                  <span>Received {readableDate(item.receivedAt)}</span>
                  <strong>Target {readableDate(item.dueAt)}</strong>
                  <small>{item.identity.status === 'verified' ? `Verified via ${(item.identity.method || '').replaceAll('_', ' ')}` : 'Identity not verified'}</small>
                </div>
                <div className="privacy-request-actions">
                  {item.status === 'open' ? (
                    <button className="secondary-button" disabled={busy} onClick={() => openWorkflow('identity', item)}><UserCheck size={15} /> Verify identity</button>
                  ) : null}
                  {item.status === 'in_review' ? (
                    <button className="primary-button" disabled={busy} onClick={() => openWorkflow('assessment', item)}><ClipboardCheck size={15} /> Assess</button>
                  ) : null}
                  {item.status === 'pending_approval' ? (
                    <button className="primary-button" onClick={() => onOpenApprovals({ approvalId: item.approvalId, jobTitle: `${REQUEST_LABELS[item.requestType]} / ${item.subjectLabel}` })}><ClipboardCheck size={15} /> Review approval</button>
                  ) : null}
                  {['open', 'in_review', 'pending_approval'].includes(item.status) ? (
                    <button className="icon-button" title="Extend response target" aria-label={`Extend response target for ${item.subjectLabel}`} disabled={busy} onClick={() => openWorkflow('extension', item)}><CalendarClock size={16} /></button>
                  ) : null}
                  {['completed', 'partially_completed'].includes(item.status) && ['provide_access', 'provide_portability'].includes(item.assessment?.action) ? (
                    <button className="secondary-button" disabled={busy} onClick={() => downloadExport(item)}><FileDown size={15} /> Download</button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="No matching privacy requests" detail={requests.length ? 'Adjust the current filters.' : 'New verified requests will appear here.'} />
        )}
      </section>

      {createOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal privacy-request-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-request-create-title">
            <div className="modal-heading">
              <div><p className="eyebrow">Owner controlled</p><h2 id="privacy-request-create-title">Record privacy request</h2></div>
              <button className="icon-button" aria-label="Close privacy request editor" disabled={busy} onClick={() => setCreateOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={submitCreate}>
              <fieldset className="form-fieldset" disabled={busy}>
                <div className="form-grid privacy-request-form">
                  <label>Person type<select aria-label="Person type" value={createDraft.subjectType} onChange={(event) => setCreateDraft((current) => ({ ...current, subjectType: event.target.value, subjectId: '' }))}><option value="client">Client</option><option value="worker">Worker</option></select></label>
                  <label>Person<select aria-label="Person" required value={createDraft.subjectId} onChange={(event) => setCreateDraft((current) => ({ ...current, subjectId: event.target.value }))}><option value="">Select a person</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
                  <label>Request type<select aria-label="Request type" value={createDraft.requestType} onChange={(event) => setCreateDraft((current) => ({ ...current, requestType: event.target.value }))}>{Object.entries(REQUEST_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label>Received on<input aria-label="Received on" required type="date" max={dateInput()} value={createDraft.receivedAt} onChange={(event) => setCreateDraft((current) => ({ ...current, receivedAt: event.target.value }))} /></label>
                  <label>Channel<select aria-label="Channel" value={createDraft.channel} onChange={(event) => setCreateDraft((current) => ({ ...current, channel: event.target.value }))}><option value="email">Email</option><option value="portal">Portal</option><option value="letter">Letter</option><option value="phone">Phone</option><option value="in_person">In person</option></select></label>
                  <label>Reference<input aria-label="Reference" maxLength="240" value={createDraft.requesterReference} onChange={(event) => setCreateDraft((current) => ({ ...current, requesterReference: event.target.value }))} /></label>
                  <label className="form-span">Request details<textarea aria-label="Request details" maxLength="4000" value={createDraft.details} onChange={(event) => setCreateDraft((current) => ({ ...current, details: event.target.value }))} /></label>
                </div>
                <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setCreateOpen(false)}>Cancel</button><button className="primary-button" disabled={!createDraft.subjectId || busy}><Plus size={16} />{busy ? 'Recording...' : 'Record request'}</button></div>
              </fieldset>
            </form>
          </section>
        </div>
      ) : null}

      {workflow?.mode === 'identity' ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal privacy-request-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-identity-title">
            <div className="modal-heading"><div><p className="eyebrow">Data minimization</p><h2 id="privacy-identity-title">Verify {workflowItem.subjectLabel}</h2></div><button className="icon-button" aria-label="Close identity verification" disabled={busy} onClick={() => setWorkflow(null)}><X size={18} /></button></div>
            <form onSubmit={submitIdentity}>
              <fieldset className="form-fieldset" disabled={busy}>
                <div className="privacy-identity-warning"><LockKeyhole size={17} /><p>Retain a verification reference only. Do not upload or copy a full identity document.</p></div>
                <div className="form-grid privacy-request-form">
                  <label>Verification method<select aria-label="Verification method" value={identityDraft.method} onChange={(event) => setIdentityDraft((current) => ({ ...current, method: event.target.value }))}><option value="existing_contact">Existing contact</option><option value="in_person">In person</option><option value="signed_correspondence">Signed correspondence</option><option value="delegated_authority">Delegated authority</option><option value="other">Other approved method</option></select></label>
                  <label className="form-span">Evidence reference<textarea aria-label="Evidence reference" required minLength="4" maxLength="500" value={identityDraft.evidenceReference} onChange={(event) => setIdentityDraft((current) => ({ ...current, evidenceReference: event.target.value }))} /></label>
                </div>
                <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setWorkflow(null)}>Cancel</button><button className="primary-button"><UserCheck size={16} />{busy ? 'Verifying...' : 'Retain verification'}</button></div>
              </fieldset>
            </form>
          </section>
        </div>
      ) : null}

      {workflow?.mode === 'assessment' ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal privacy-request-modal privacy-assessment-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-assessment-title">
            <div className="modal-heading"><div><p className="eyebrow">Source-current decision</p><h2 id="privacy-assessment-title">Assess {REQUEST_LABELS[workflowItem.requestType]}</h2><p>{workflowItem.subjectLabel}</p></div><button className="icon-button" aria-label="Close privacy assessment" disabled={busy} onClick={() => setWorkflow(null)}><X size={18} /></button></div>
            <form onSubmit={submitAssessment}>
              <fieldset className="form-fieldset" disabled={busy}>
                {detail?.inventory?.blockers?.length ? <div className="privacy-blockers"><strong>Current blockers</strong>{detail.inventory.blockers.map((blocker) => <p key={blocker.code}>{blocker.message}</p>)}</div> : null}
                <div className="form-grid privacy-request-form privacy-assessment-form">
                  <label className="form-span">Decision<select aria-label="Decision" value={assessmentDraft.action} onChange={(event) => setAssessmentDraft((current) => ({ ...current, action: event.target.value }))}>{(ACTIONS[workflowItem.requestType] || []).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  {assessmentDraft.action === 'apply_rectification' ? (
                    <fieldset className="privacy-correction-fields form-span"><legend>Corrected fields</legend>{correctionFields.map(([field, label]) => { const correction = assessmentDraft.corrections[field] || { enabled: false, value: '' }; return <div className="privacy-correction-row" key={field}><label className="checkbox-label"><input type="checkbox" checked={correction.enabled} onChange={(event) => setAssessmentDraft((current) => ({ ...current, corrections: { ...current.corrections, [field]: { ...correction, enabled: event.target.checked } } }))} />{label}</label><input aria-label={`Corrected ${label}`} disabled={!correction.enabled} value={correction.value} onChange={(event) => setAssessmentDraft((current) => ({ ...current, corrections: { ...current.corrections, [field]: { ...correction, value: event.target.value } } }))} /></div> })}</fieldset>
                  ) : null}
                  <label className="form-span">Assessment rationale<textarea aria-label="Assessment rationale" required minLength="8" maxLength="4000" value={assessmentDraft.rationale} onChange={(event) => setAssessmentDraft((current) => ({ ...current, rationale: event.target.value }))} /></label>
                  <label>Legal basis reference<input aria-label="Legal basis reference" required minLength="4" value={assessmentDraft.legalBasisReference} onChange={(event) => setAssessmentDraft((current) => ({ ...current, legalBasisReference: event.target.value }))} /></label>
                  <label>Retention policy reference<input aria-label="Retention policy reference" required minLength="4" value={assessmentDraft.retentionPolicyReference} onChange={(event) => setAssessmentDraft((current) => ({ ...current, retentionPolicyReference: event.target.value }))} /></label>
                </div>
                {assessmentDraft.action === 'pseudonymize_current_records' ? <p className="privacy-partial-warning">This decision pseudonymizes eligible current fields. Retained legal, commercial, finance, safety, and audit evidence remains; complete erasure is not claimed.</p> : null}
                <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setWorkflow(null)}>Cancel</button><button className="primary-button" disabled={assessmentDraft.action === 'apply_rectification' && selectedCorrections === 0}><ClipboardCheck size={16} />{busy ? 'Preparing...' : 'Request approval'}</button></div>
              </fieldset>
            </form>
          </section>
        </div>
      ) : null}

      {workflow?.mode === 'extension' ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal privacy-request-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-extension-title">
            <div className="modal-heading"><div><p className="eyebrow">Response target</p><h2 id="privacy-extension-title">Extend deadline</h2><p>Current target {readableDate(workflowItem.dueAt)}</p></div><button className="icon-button" aria-label="Close deadline extension" disabled={busy} onClick={() => setWorkflow(null)}><X size={18} /></button></div>
            <form onSubmit={submitExtension}>
              <fieldset className="form-fieldset" disabled={busy}>
                <div className="form-grid privacy-request-form"><label>New target<input aria-label="New target" required type="date" value={extensionDraft.dueAt} onChange={(event) => setExtensionDraft((current) => ({ ...current, dueAt: event.target.value }))} /></label><label>Requester notification reference<input aria-label="Requester notification reference" required minLength="4" maxLength="500" value={extensionDraft.notificationReference} onChange={(event) => setExtensionDraft((current) => ({ ...current, notificationReference: event.target.value }))} /></label><label className="form-span">Extension rationale<textarea aria-label="Extension rationale" required minLength="8" maxLength="1000" value={extensionDraft.reason} onChange={(event) => setExtensionDraft((current) => ({ ...current, reason: event.target.value }))} /></label></div>
                <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setWorkflow(null)}>Cancel</button><button className="primary-button"><CalendarClock size={16} />{busy ? 'Extending...' : 'Retain extension'}</button></div>
              </fieldset>
            </form>
          </section>
        </div>
      ) : null}
    </>
  )
}
