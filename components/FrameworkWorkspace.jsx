import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenCheck,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  History,
  Pencil,
  Plus,
  Search,
  Target,
  TriangleAlert,
  X,
} from 'lucide-react'
import { formatDateTime, formatStatus } from '../dashboard-format'
import './FrameworkWorkspace.css'

const EMPTY_LIST = Object.freeze([])
const PAGE_SIZE = 25

function entryKey(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function lines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)
}

function draftFor(framework, implementation = null) {
  return {
    id: implementation?.id || null,
    frameworkId: implementation?.frameworkId || framework?.id || '',
    frameworkName: implementation?.framework?.name || framework?.name || '',
    scopeType: implementation?.scopeType || 'organization',
    scopeId: implementation?.scopeId === 'primary' ? '' : implementation?.scopeId || '',
    status: implementation?.status || 'draft',
    initialStatus: implementation?.status || null,
    objective: implementation?.objective || '',
    ownerName: implementation?.ownerName || '',
    reviewDueAt: implementation?.reviewDueAt || '',
    currentState: implementation?.currentState || '',
    targetState: implementation?.targetState || '',
    decision: implementation?.decision || '',
    evidenceRefs: (implementation?.evidenceRefs || EMPTY_LIST).join('\n'),
    successMeasures: (implementation?.successMeasures || EMPTY_LIST).join('\n'),
    reason: '',
    revision: implementation?.revision || 0,
  }
}

function statusTone(status) {
  if (status === 'active') return 'green'
  if (status === 'paused') return 'amber'
  if (status === 'retired') return 'neutral'
  return 'blue'
}

export default function FrameworkWorkspace({ catalog, workspace, jobs, request, canCoordinate, onChange }) {
  const [query, setQuery] = useState('')
  const [familyId, setFamilyId] = useState('all')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(0)
  const [editor, setEditor] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [history, setHistory] = useState(null)
  const [historyBusy, setHistoryBusy] = useState(false)

  const families = catalog?.families || EMPTY_LIST
  const frameworks = catalog?.frameworks || EMPTY_LIST
  const implementations = workspace?.implementations || EMPTY_LIST
  const summary = workspace?.summary || {}
  const editorStatuses = editor?.id
    ? {
        draft: ['draft', 'active', 'retired'],
        active: ['active', 'paused', 'retired'],
        paused: ['paused', 'active', 'retired'],
        retired: ['retired', 'draft'],
      }[editor.initialStatus] || [editor.status]
    : ['draft', 'active']

  const implementationsByFramework = useMemo(() => {
    const grouped = new Map()
    for (const implementation of implementations) {
      const retained = grouped.get(implementation.frameworkId) || []
      retained.push(implementation)
      grouped.set(implementation.frameworkId, retained)
    }
    return grouped
  }, [implementations])

  const filteredFrameworks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return frameworks.filter(framework => {
      const retained = implementationsByFramework.get(framework.id) || EMPTY_LIST
      const statusMatches = status === 'all' || retained.some(item => item.status === status)
      const familyMatches = familyId === 'all' || framework.familyIds.includes(familyId)
      const queryMatches = !normalizedQuery
        || framework.name.toLowerCase().includes(normalizedQuery)
        || framework.families.some(family => family.name.toLowerCase().includes(normalizedQuery))
      return statusMatches && familyMatches && queryMatches
    })
  }, [familyId, frameworks, implementationsByFramework, query, status])

  const totalPages = Math.max(1, Math.ceil(filteredFrameworks.length / PAGE_SIZE))
  const visibleFrameworks = filteredFrameworks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  useEffect(() => {
    setPage(0)
  }, [familyId, query, status])

  useEffect(() => {
    if (page >= totalPages) setPage(totalPages - 1)
  }, [page, totalPages])

  useEffect(() => {
    if (!editor) return undefined
    const closeOnEscape = event => {
      if (event.key === 'Escape' && !busy) setEditor(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [busy, editor])

  function openCreate(framework) {
    setError('')
    setNotice('')
    setHistory(null)
    setEditor(draftFor(framework))
  }

  function openEdit(implementation) {
    setError('')
    setNotice('')
    setHistory(null)
    setEditor(draftFor(implementation.framework, implementation))
  }

  async function loadHistory() {
    if (!editor?.id) return
    setHistoryBusy(true)
    setError('')
    try {
      const result = await request(`/api/ledger/frameworks/${encodeURIComponent(editor.id)}/revisions?limit=100`)
      setHistory(result.revisions || [])
    } catch (nextError) {
      setError(nextError.message || 'Revision history could not be loaded.')
    } finally {
      setHistoryBusy(false)
    }
  }

  async function save(event) {
    event.preventDefault()
    if (!canCoordinate) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const payload = {
        frameworkId: editor.frameworkId,
        scopeType: editor.scopeType,
        scopeId: editor.scopeId,
        status: editor.status,
        objective: editor.objective,
        ownerName: editor.ownerName,
        reviewDueAt: editor.reviewDueAt || null,
        currentState: editor.currentState,
        targetState: editor.targetState,
        decision: editor.decision,
        evidenceRefs: lines(editor.evidenceRefs),
        successMeasures: lines(editor.successMeasures),
        reason: editor.reason,
        entryKey: entryKey(editor.id ? `framework-revision-${editor.id}` : `framework-create-${editor.frameworkId}`),
        ...(editor.id ? { expectedRevision: editor.revision } : {}),
      }
      const result = await request(
        editor.id ? `/api/ledger/frameworks/${encodeURIComponent(editor.id)}` : '/api/ledger/frameworks',
        { method: editor.id ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      )
      onChange(result.workspace)
      setEditor(null)
      setNotice(result.replayed ? 'The retained revision was already current.' : `${payload.frameworkId ? editor.frameworkName : 'Framework'} retained.`)
    } catch (nextError) {
      setError(nextError.message || 'The framework review could not be retained.')
    } finally {
      setBusy(false)
    }
  }

  if (!catalog || !workspace) {
    return <div className="framework-loading" role="status">Preparing the operating framework register</div>
  }

  return (
    <section className="framework-workspace" data-testid="framework-workspace" aria-busy={busy || undefined}>
      <header className="framework-heading">
        <div>
          <span className="eyebrow">Management system</span>
          <h2>Operating framework register</h2>
          <p>{catalog.counts.frameworks} frameworks across {catalog.counts.families} operating families</p>
        </div>
        {workspace.dueReviews?.length ? (
          <span className="framework-due"><Clock3 size={15} />{workspace.dueReviews.length} review{workspace.dueReviews.length === 1 ? '' : 's'} due</span>
        ) : null}
      </header>

      {error && !editor ? <div className="framework-banner framework-banner-error" role="alert"><TriangleAlert size={16} /><span>{error}</span></div> : null}
      {notice ? <div className="framework-banner framework-banner-notice" role="status"><Check size={16} /><span>{notice}</span></div> : null}

      <div className="framework-summary" aria-label="Framework register summary">
        <div><BookOpenCheck size={18} /><span>Catalog</span><strong>{summary.catalogFrameworks || catalog.counts.frameworks}</strong></div>
        <div><Target size={18} /><span>Active</span><strong>{summary.statuses?.active || 0}</strong></div>
        <div><CalendarClock size={18} /><span>Reviews due</span><strong>{summary.dueReviews || 0}</strong></div>
        <div><History size={18} /><span>Families covered</span><strong>{summary.coveredFamilies || 0}/{summary.catalogFamilies || catalog.counts.families}</strong></div>
      </div>

      <div className="framework-toolbar">
        <label className="framework-search">
          <span className="sr-only">Search frameworks</span>
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search frameworks or families" />
        </label>
        <label>
          <span className="sr-only">Framework family</span>
          <select value={familyId} onChange={event => setFamilyId(event.target.value)}>
            <option value="all">All families</option>
            {families.map(family => <option value={family.id} key={family.id}>{family.number}. {family.name}</option>)}
          </select>
        </label>
        <div className="framework-status-filter" role="group" aria-label="Implementation status">
          {['all', 'draft', 'active', 'paused', 'retired'].map(value => (
            <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}>{formatStatus(value)}</button>
          ))}
        </div>
      </div>

      <div className="framework-table-scroll">
        <table className="framework-table">
          <thead><tr><th>Framework</th><th>Family</th><th>Register</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {visibleFrameworks.map(framework => {
              const retained = implementationsByFramework.get(framework.id) || EMPTY_LIST
              return (
                <tr key={framework.id}>
                  <th scope="row"><span>{framework.name}</span><small>{framework.id}</small></th>
                  <td><div className="framework-family-list">{framework.families.map(family => <span key={family.id}>{family.number}. {family.name}</span>)}</div></td>
                  <td>
                    {retained.length ? retained.map(item => (
                      <button className="framework-record" type="button" onClick={() => openEdit(item)} key={item.id} title={`${canCoordinate ? 'Edit' : 'View'} ${framework.name}`}>
                        <span className={`framework-status framework-status-${statusTone(item.status)}`}>{formatStatus(item.status)}</span>
                        <span>{item.scopeType === 'organization' ? 'Organization' : jobs.find(job => job.id === item.scopeId)?.title || 'Project'}</span>
                      </button>
                    )) : <span className="framework-unset">Not retained</span>}
                  </td>
                  <td>
                    {canCoordinate ? (
                      <button className="icon-button" type="button" title={`Start ${framework.name}`} aria-label={`Start ${framework.name}`} onClick={() => openCreate(framework)}>
                        <Plus size={16} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!visibleFrameworks.length ? <div className="framework-empty">No frameworks match the current filters.</div> : null}

      <div className="framework-pagination">
        <span>{filteredFrameworks.length} result{filteredFrameworks.length === 1 ? '' : 's'}</span>
        <div>
          <button className="icon-button" type="button" aria-label="Previous framework page" disabled={page === 0} onClick={() => setPage(current => Math.max(0, current - 1))}><ChevronLeft size={17} /></button>
          <span>Page {page + 1} of {totalPages}</span>
          <button className="icon-button" type="button" aria-label="Next framework page" disabled={page + 1 >= totalPages} onClick={() => setPage(current => Math.min(totalPages - 1, current + 1))}><ChevronRight size={17} /></button>
        </div>
      </div>

      {editor ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal framework-modal" role="dialog" aria-modal="true" aria-labelledby="framework-editor-title">
            <div className="modal-heading">
              <div><span className="eyebrow">{editor.id ? `Revision ${editor.revision}${canCoordinate ? '' : ' - read only'}` : 'New review'}</span><h2 id="framework-editor-title">{editor.frameworkName}</h2></div>
              <button className="icon-button" type="button" aria-label="Close framework review" onClick={() => setEditor(null)} disabled={busy}><X size={18} /></button>
            </div>
            <form onSubmit={save}>
              <fieldset disabled={busy || !canCoordinate}>
                <div className="framework-form-grid">
                  <label>Scope
                    <select value={editor.scopeType} onChange={event => setEditor(current => ({ ...current, scopeType: event.target.value, scopeId: '' }))} disabled={Boolean(editor.id)}>
                      <option value="organization">Organization</option><option value="job">Project</option>
                    </select>
                  </label>
                  <label>Project
                    <select value={editor.scopeId} onChange={event => setEditor(current => ({ ...current, scopeId: event.target.value }))} disabled={Boolean(editor.id) || editor.scopeType !== 'job'} required={editor.scopeType === 'job'}>
                      <option value="">Select project</option>
                      {jobs.filter(job => !['archived', 'cancelled', 'canceled'].includes(job.status)).map(job => <option value={job.id} key={job.id}>{job.title}</option>)}
                    </select>
                  </label>
                  <label>Status
                    <select value={editor.status} onChange={event => setEditor(current => ({ ...current, status: event.target.value }))}>
                      {editorStatuses.map(value => <option value={value} key={value}>{formatStatus(value)}</option>)}
                    </select>
                  </label>
                  <label>Review due
                    <input type="date" value={editor.reviewDueAt} onChange={event => setEditor(current => ({ ...current, reviewDueAt: event.target.value }))} />
                  </label>
                </div>
                <label>Objective
                  <textarea minLength="8" maxLength="1000" required value={editor.objective} onChange={event => setEditor(current => ({ ...current, objective: event.target.value }))} />
                </label>
                <label>Owner
                  <input minLength="2" maxLength="120" required value={editor.ownerName} onChange={event => setEditor(current => ({ ...current, ownerName: event.target.value }))} />
                </label>
                <div className="framework-form-grid framework-form-grid-text">
                  <label>Current state
                    <textarea minLength={editor.status === 'active' ? 8 : 0} required={editor.status === 'active'} maxLength="4000" value={editor.currentState} onChange={event => setEditor(current => ({ ...current, currentState: event.target.value }))} />
                  </label>
                  <label>Target state
                    <textarea minLength={editor.status === 'active' ? 8 : 0} required={editor.status === 'active'} maxLength="4000" value={editor.targetState} onChange={event => setEditor(current => ({ ...current, targetState: event.target.value }))} />
                  </label>
                </div>
                <label>Decision
                  <textarea minLength={editor.status === 'active' ? 8 : 0} required={editor.status === 'active'} maxLength="4000" value={editor.decision} onChange={event => setEditor(current => ({ ...current, decision: event.target.value }))} />
                </label>
                <div className="framework-form-grid framework-form-grid-text">
                  <label>Evidence references <small>One per line</small>
                    <textarea value={editor.evidenceRefs} onChange={event => setEditor(current => ({ ...current, evidenceRefs: event.target.value }))} />
                  </label>
                  <label>Success measures <small>One per line</small>
                    <textarea required={editor.status === 'active'} value={editor.successMeasures} onChange={event => setEditor(current => ({ ...current, successMeasures: event.target.value }))} />
                  </label>
                </div>
                <label>Revision reason
                  <textarea minLength="8" maxLength="500" required value={editor.reason} onChange={event => setEditor(current => ({ ...current, reason: event.target.value }))} />
                </label>
              </fieldset>
              {error ? <div className="framework-banner framework-banner-error" role="alert"><TriangleAlert size={16} /><span>{error}</span></div> : null}
              {editor.id ? (
                <div className="framework-history">
                  <button className="secondary-button" type="button" disabled={historyBusy || busy} onClick={loadHistory}><History size={16} />{historyBusy ? 'Loading...' : 'Revision history'}</button>
                  {history ? <ol>{history.map(item => <li key={item.id}><strong>Revision {item.revisionNumber}</strong><span>{formatDateTime(item.createdAt)} by {item.actor}</span><small>{item.reason}</small></li>)}</ol> : null}
                </div>
              ) : null}
              <div className="modal-actions">
                <button className="secondary-button" type="button" onClick={() => setEditor(null)} disabled={busy}>{canCoordinate ? 'Cancel' : 'Close'}</button>
                {canCoordinate ? <button className="primary-button" type="submit" disabled={busy || editor.reason.trim().length < 8}><Pencil size={16} />{busy ? 'Retaining...' : 'Retain revision'}</button> : null}
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  )
}
