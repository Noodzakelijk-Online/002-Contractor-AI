import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  Camera,
  Check,
  ChevronRight,
  ClipboardCheck,
  Plus,
  RefreshCw,
  ShieldCheck,
  Truck,
  Wrench,
  X,
} from 'lucide-react'
import { createFieldEvidenceDraftId } from '../field-outbox'
import { formatDate, formatStatus } from '../dashboard-format'
import Empty from './EmptyState'

const STAGES = [
  ['sort', 'Sort'],
  ['set_in_order', 'Set in order'],
  ['shine', 'Shine'],
  ['standardize', 'Standardize'],
  ['sustain', 'Sustain'],
]

const DEFAULT_STANDARD_ITEMS = [
  {
    id: 'sort-unneeded',
    stage: 'sort',
    title: 'Remove unneeded items',
    requirement: 'Only equipment and consumables needed for retained work remain in this location.',
  },
  {
    id: 'set-marked-home',
    stage: 'set_in_order',
    title: 'Return equipment to its marked home',
    requirement: 'Retained equipment is available, inspection-ready, and stored in its marked position.',
  },
  {
    id: 'shine-clean',
    stage: 'shine',
    title: 'Clean storage and equipment',
    requirement: 'Storage and equipment are clean enough to expose damage, leaks, and missing parts.',
  },
  {
    id: 'standardize-labels',
    stage: 'standardize',
    title: 'Keep labels and outlines current',
    requirement: 'Labels, outlines, and retained positions match the current standard.',
  },
  {
    id: 'sustain-routine',
    stage: 'sustain',
    title: 'Retain the audit routine',
    requirement: 'The current standard, owner, and next audit cadence are visible to the crew.',
  },
]

const LOCATION_TYPES = [
  ['vehicle', 'Vehicle'],
  ['trailer', 'Trailer'],
  ['depot', 'Depot'],
  ['tool_store', 'Tool store'],
  ['site_storage', 'Site storage'],
  ['work_area', 'Work area'],
  ['other', 'Other'],
]

function todayInput() {
  return new Date().toISOString().slice(0, 10)
}

function splitReferences(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function initialLocationDraft(jobId = '') {
  return {
    jobId,
    name: '',
    locationType: 'vehicle',
    identifier: '',
    owner: '',
    auditFrequencyDays: '7',
  }
}

function initialAuditDraft(row, operatorName = '') {
  return {
    entryKey: createFieldEvidenceDraftId(),
    auditDate: todayInput(),
    auditedBy: operatorName || '',
    evidenceReferences: '',
    results: Object.fromEntries((row?.currentStandard?.items || []).map((item) => [
      item.id,
      {
        result: 'pass',
        note: '',
        finding: '',
        actionOwner: row?.location?.owner || operatorName || '',
        actionDueDate: todayInput(),
        severity: item.required ? 'high' : 'medium',
      },
    ])),
  }
}

function boardCacheKey(jobId) {
  return `contractor-ai-five-s-board/v1/${jobId}`
}

function readCachedBoard(jobId) {
  if (!jobId || typeof window === 'undefined') return null
  try {
    return JSON.parse(window.localStorage.getItem(boardCacheKey(jobId)) || 'null')
  } catch {
    return null
  }
}

function cacheBoard(jobId, board) {
  if (!jobId || !board || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(boardCacheKey(jobId), JSON.stringify(board))
  } catch {
    // The retained server ledger remains authoritative when browser cache is unavailable.
  }
}

function statusCopy(row) {
  if (!row?.currentStandard) return 'Standard required'
  if (row.auditDue) return row.latestAudit ? 'Audit overdue' : 'First audit due'
  if (row.openActions?.length) return `${row.openActions.length} action${row.openActions.length === 1 ? '' : 's'} open`
  return row.ready ? 'Ready' : 'Review required'
}

function FiveSSummary({ summary = {} }) {
  return (
    <div className="five-s-summary" aria-label="5S readiness summary">
      <div><span>Locations</span><strong>{summary.locations || 0}</strong></div>
      <div><span>Ready</span><strong>{summary.ready || 0}</strong></div>
      <div><span>Audits due</span><strong>{summary.auditsDue || 0}</strong></div>
      <div><span>Open actions</span><strong>{summary.openActions || 0}</strong></div>
      <div><span>Average score</span><strong>{summary.averageScorePercent == null ? '-' : `${summary.averageScorePercent}%`}</strong></div>
    </div>
  )
}

function AuditForm({ row, fieldMode, operatorName, submitting, onCancel, onSubmit }) {
  const [draft, setDraft] = useState(() => initialAuditDraft(row, operatorName))
  const items = row.currentStandard?.items || []

  function updateResult(itemId, patch) {
    setDraft((current) => ({
      ...current,
      results: {
        ...current.results,
        [itemId]: { ...current.results[itemId], ...patch },
      },
    }))
  }

  function submit(event) {
    event.preventDefault()
    onSubmit({
      entryKey: draft.entryKey,
      standardId: row.currentStandard.id,
      auditDate: draft.auditDate,
      auditedBy: draft.auditedBy,
      evidenceReferences: splitReferences(draft.evidenceReferences),
      results: items.map((item) => ({
        itemId: item.id,
        result: draft.results[item.id]?.result,
        note: draft.results[item.id]?.note.trim() || null,
        ...(draft.results[item.id]?.result === 'fail'
          ? {
              finding: draft.results[item.id].finding.trim(),
              actionOwner: draft.results[item.id].actionOwner.trim(),
              actionDueDate: draft.results[item.id].actionDueDate,
              severity: draft.results[item.id].severity,
            }
          : {}),
      })),
    })
  }

  return (
    <form className="five-s-audit-form" data-testid={fieldMode ? 'field-five-s-audit-form' : 'five-s-audit-form'} onSubmit={submit}>
      <div className="five-s-form-heading">
        <div>
          <strong>Audit {row.location.name}</strong>
          <span>Standard v{row.currentStandard.versionNumber} / every check is retained</span>
        </div>
        <button type="button" className="icon-button" aria-label="Close 5S audit" onClick={onCancel}><X size={16} /></button>
      </div>
      <div className="form-grid">
        <label>
          Audit date
          <input required type="date" max={todayInput()} value={draft.auditDate} onChange={(event) => setDraft({ ...draft, auditDate: event.target.value })} />
        </label>
        {!fieldMode || !operatorName ? (
          <label>
            Audited by
            <input required minLength="2" maxLength="160" value={draft.auditedBy} onChange={(event) => setDraft({ ...draft, auditedBy: event.target.value })} />
          </label>
        ) : null}
        <label className="form-span">
          Evidence references
          <textarea
            required
            minLength="3"
            maxLength="2000"
            value={draft.evidenceReferences}
            onChange={(event) => setDraft({ ...draft, evidenceReferences: event.target.value })}
            placeholder="Photo, checklist, or storage inspection reference; one per line"
          />
        </label>
      </div>
      <div className="five-s-check-list">
        {items.map((item) => {
          const result = draft.results[item.id] || {}
          return (
            <fieldset className={`five-s-check ${result.result === 'fail' ? 'five-s-check-failed' : ''}`} key={item.id}>
              <legend>
                <span>{formatStatus(item.stage)}</span>
                <strong>{item.title}</strong>
              </legend>
              <p>{item.requirement}</p>
              {item.tool ? <small><Wrench size={13} /> {item.tool.name} / expected at {item.expectedLocation || row.location.name}</small> : null}
              <div className="five-s-result-control" role="radiogroup" aria-label={`${item.title} result`}>
                {[
                  ['pass', 'Pass'],
                  ['fail', 'Fail'],
                  ...(item.allowNotApplicable ? [['not_applicable', 'N/A']] : []),
                ].map(([value, label]) => (
                  <label key={value} className={result.result === value ? 'five-s-result-selected' : ''}>
                    <input
                      type="radio"
                      name={`result-${item.id}`}
                      value={value}
                      checked={result.result === value}
                      onChange={() => updateResult(item.id, { result: value })}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <label>
                Check note
                <input maxLength="500" value={result.note || ''} onChange={(event) => updateResult(item.id, { note: event.target.value })} />
              </label>
              {result.result === 'fail' ? (
                <div className="five-s-finding-fields">
                  <label className="form-span">
                    Finding
                    <textarea required minLength="5" maxLength="2000" value={result.finding || ''} onChange={(event) => updateResult(item.id, { finding: event.target.value })} />
                  </label>
                  <label>
                    Action owner
                    <input required minLength="2" maxLength="160" value={result.actionOwner || ''} onChange={(event) => updateResult(item.id, { actionOwner: event.target.value })} />
                  </label>
                  <label>
                    Due date
                    <input required type="date" min={draft.auditDate} value={result.actionDueDate || ''} onChange={(event) => updateResult(item.id, { actionDueDate: event.target.value })} />
                  </label>
                  <label>
                    Severity
                    <select value={result.severity || 'medium'} onChange={(event) => updateResult(item.id, { severity: event.target.value })}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </label>
                </div>
              ) : null}
            </fieldset>
          )
        })}
      </div>
      <div className="five-s-form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button className="primary-button" disabled={submitting || !items.length}>
          <ClipboardCheck size={16} />
          {submitting ? 'Retaining...' : fieldMode && navigator.onLine === false ? 'Save audit offline' : 'Retain audit'}
        </button>
      </div>
    </form>
  )
}

function FiveSWorkspace({
  board: suppliedBoard = null,
  request,
  jobs = [],
  tools = [],
  canCoordinate = false,
  canApprove = false,
  fieldMode = false,
  operatorName = '',
  onOpenApprovals,
  onSubmitFieldAudit,
}) {
  const [board, setBoard] = useState(suppliedBoard)
  const [selectedJobId, setSelectedJobId] = useState(() => fieldMode ? jobs[0]?.id || '' : '')
  const [selectedLocationId, setSelectedLocationId] = useState('')
  const [locationDraft, setLocationDraft] = useState(() => initialLocationDraft())
  const [standardItems, setStandardItems] = useState(DEFAULT_STANDARD_ITEMS)
  const [linkedToolId, setLinkedToolId] = useState('')
  const [showLocationForm, setShowLocationForm] = useState(false)
  const [showStandardForm, setShowStandardForm] = useState(false)
  const [auditLocationId, setAuditLocationId] = useState('')
  const [resolution, setResolution] = useState({ actionId: '', evidenceReference: '', resolutionNote: '' })
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(!suppliedBoard)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cached, setCached] = useState(false)
  const hasLocalMutationRef = useRef(false)

  const loadBoard = useCallback(async (jobId = '') => {
    if (!request) return
    setLoading(true)
    setError('')
    setCached(false)
    try {
      const result = await request(fieldMode
        ? `/api/ledger/five-s?jobId=${encodeURIComponent(jobId)}`
        : '/api/ledger/five-s')
      setBoard(result.board || null)
      if (fieldMode) cacheBoard(jobId, result.board)
    } catch (requestError) {
      const retained = fieldMode ? readCachedBoard(jobId) : null
      if (retained) {
        setBoard(retained)
        setCached(true)
        setNotice('Showing the last locally cached 5S board. New audits will use the exact retained standard revision.')
      } else {
        setError(requestError.message)
        setBoard(null)
      }
    } finally {
      setLoading(false)
    }
  }, [fieldMode, request])

  useEffect(() => {
    if (!fieldMode && suppliedBoard) {
      if (!hasLocalMutationRef.current) setBoard(suppliedBoard)
      setLoading(false)
    }
  }, [fieldMode, suppliedBoard])

  useEffect(() => {
    if (fieldMode && selectedJobId) void loadBoard(selectedJobId)
    if (fieldMode && !selectedJobId) setBoard(null)
  }, [fieldMode, loadBoard, selectedJobId])

  useEffect(() => {
    const rows = board?.rows || []
    if (!rows.length) {
      setSelectedLocationId('')
      return
    }
    if (!rows.some((row) => row.location.id === selectedLocationId)) setSelectedLocationId(rows[0].location.id)
  }, [board, selectedLocationId])

  const rows = useMemo(() => board?.rows || [], [board])
  const selectedRow = useMemo(
    () => rows.find((row) => row.location.id === selectedLocationId) || rows[0] || null,
    [rows, selectedLocationId],
  )

  function retainMutationBoard(nextBoard) {
    if (!fieldMode) hasLocalMutationRef.current = true
    setBoard(nextBoard)
  }

  async function createLocation(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      const result = await request('/api/ledger/five-s/locations', {
        method: 'POST',
        body: JSON.stringify({
          ...locationDraft,
          jobId: locationDraft.jobId || null,
          identifier: locationDraft.identifier.trim() || null,
          auditFrequencyDays: Number(locationDraft.auditFrequencyDays),
          entryKey: createFieldEvidenceDraftId(),
        }),
      })
      retainMutationBoard(result.board)
      setSelectedLocationId(result.location.id)
      setLocationDraft(initialLocationDraft())
      setShowLocationForm(false)
      setNotice(`${result.location.name} was retained as a governed 5S location.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function updateStandardItem(index, patch) {
    setStandardItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  async function requestStandard(event) {
    event.preventDefault()
    if (!selectedRow) return
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      const items = standardItems.map((item) => item.stage === 'set_in_order' && linkedToolId
        ? {
            ...item,
            itemType: 'tool',
            toolId: linkedToolId,
            expectedLocation: selectedRow.location.name,
          }
        : { ...item, itemType: 'condition' })
      const result = await request(`/api/ledger/five-s/locations/${encodeURIComponent(selectedRow.location.id)}/standards`, {
        method: 'POST',
        body: JSON.stringify({
          items,
          reason: 'Operator-owned 5S standard retained for approval before field reliance.',
          entryKey: createFieldEvidenceDraftId(),
        }),
      })
      retainMutationBoard(result.board)
      setShowStandardForm(false)
      setNotice('The 5S standard is retained and waiting for an independent approval decision.')
      if (canApprove && onOpenApprovals) onOpenApprovals({ approvalId: result.approval.id })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function submitAudit(payload) {
    if (!selectedRow) return
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      let result
      if (fieldMode) {
        result = await onSubmitFieldAudit({
          id: payload.entryKey,
          jobId: selectedJobId,
          locationId: selectedRow.location.id,
          payload,
        })
      } else {
        result = await request(`/api/ledger/five-s/locations/${encodeURIComponent(selectedRow.location.id)}/audits`, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      }
      if (result?.board) {
        retainMutationBoard(result.board)
        if (fieldMode) cacheBoard(selectedJobId, result.board)
      }
      setAuditLocationId('')
      setNotice(result?.queued
        ? 'The complete 5S audit was saved locally and will sync as an exact retry after reconnection.'
        : result?.replayed
          ? 'This 5S audit was already retained; no duplicate was created.'
          : 'The 5S audit and any corrective actions were retained.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function resolveAction(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const result = await request(`/api/ledger/five-s/actions/${encodeURIComponent(resolution.actionId)}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          evidenceReference: resolution.evidenceReference.trim(),
          resolutionNote: resolution.resolutionNote.trim(),
          entryKey: createFieldEvidenceDraftId(),
        }),
      })
      retainMutationBoard(result.board)
      setResolution({ actionId: '', evidenceReference: '', resolutionNote: '' })
      setNotice(result.replayed ? 'This resolution was already retained.' : 'Corrective-action resolution evidence was retained.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={`five-s-workspace ${fieldMode ? 'five-s-field-workspace' : ''}`} data-testid={fieldMode ? 'field-five-s-workspace' : 'five-s-workspace'}>
      {fieldMode ? (
        <div className="five-s-field-heading">
          <div>
            <h2>5S vehicle and tool control</h2>
            <p>Check the approved location standard and retain actual field condition.</p>
          </div>
          <Truck size={21} />
        </div>
      ) : null}
      {fieldMode ? (
        <div className="five-s-field-selector">
          <label>
            Job
            <select value={selectedJobId} onChange={(event) => setSelectedJobId(event.target.value)}>
              <option value="">Select an active job</option>
              {jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
            </select>
          </label>
          <button type="button" className="icon-button" aria-label="Refresh 5S board" disabled={!selectedJobId || loading || navigator.onLine === false} onClick={() => void loadBoard(selectedJobId)}>
            <RefreshCw size={16} />
          </button>
        </div>
      ) : null}
      {error ? <div className="five-s-message five-s-error" role="alert"><AlertTriangle size={16} /> {error}</div> : null}
      {notice ? <div className="five-s-message" role="status"><Check size={16} /> {notice}</div> : null}
      {cached ? <div className="five-s-cache-state"><Boxes size={16} /> Offline cached board</div> : null}
      {loading ? <div className="five-s-loading"><RefreshCw size={18} /> Loading retained 5S controls...</div> : null}
      {!loading && board ? <FiveSSummary summary={board.summary} /> : null}
      {!fieldMode && canCoordinate ? (
        <div className="five-s-toolbar">
          <button type="button" className="primary-button" onClick={() => setShowLocationForm((value) => !value)}>
            <Plus size={16} /> Add location
          </button>
          <button type="button" className="secondary-button" disabled={!selectedRow || Boolean(selectedRow.pendingStandard)} onClick={() => setShowStandardForm((value) => !value)}>
            <ShieldCheck size={16} /> {selectedRow?.currentStandard ? 'Revise standard' : 'Create standard'}
          </button>
          {selectedRow?.pendingStandard && onOpenApprovals ? (
            <button type="button" className="secondary-button" onClick={() => onOpenApprovals({ approvalId: selectedRow.pendingStandard.approvalId })}>
              <ShieldCheck size={16} /> Review pending standard
            </button>
          ) : null}
        </div>
      ) : null}
      {showLocationForm ? (
        <form className="five-s-inline-form" data-testid="five-s-location-form" onSubmit={createLocation}>
          <div className="five-s-form-heading">
            <div><strong>Retain a 5S location</strong><span>Vehicle, trailer, depot, store, or job storage</span></div>
            <button type="button" className="icon-button" aria-label="Close location form" onClick={() => setShowLocationForm(false)}><X size={16} /></button>
          </div>
          <div className="form-grid">
            <label>
              Job scope
              <select value={locationDraft.jobId} onChange={(event) => setLocationDraft({ ...locationDraft, jobId: event.target.value })}>
                <option value="">Organization-wide</option>
                {jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
              </select>
            </label>
            <label>
              Location type
              <select value={locationDraft.locationType} onChange={(event) => setLocationDraft({ ...locationDraft, locationType: event.target.value })}>
                {LOCATION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Name
              <input required minLength="3" maxLength="160" value={locationDraft.name} onChange={(event) => setLocationDraft({ ...locationDraft, name: event.target.value })} placeholder="Service van 04" />
            </label>
            <label>
              Identifier
              <input maxLength="120" value={locationDraft.identifier} onChange={(event) => setLocationDraft({ ...locationDraft, identifier: event.target.value })} placeholder="Registration or retained reference" />
            </label>
            <label>
              Owner
              <input required minLength="2" maxLength="160" value={locationDraft.owner} onChange={(event) => setLocationDraft({ ...locationDraft, owner: event.target.value })} />
            </label>
            <label>
              Audit frequency
              <div className="five-s-number-control"><input required type="number" min="1" max="365" value={locationDraft.auditFrequencyDays} onChange={(event) => setLocationDraft({ ...locationDraft, auditFrequencyDays: event.target.value })} /><span>days</span></div>
            </label>
          </div>
          <div className="five-s-form-actions"><button className="primary-button" disabled={submitting}><Plus size={16} /> Retain location</button></div>
        </form>
      ) : null}
      {showStandardForm && selectedRow ? (
        <form className="five-s-inline-form" data-testid="five-s-standard-form" onSubmit={requestStandard}>
          <div className="five-s-form-heading">
            <div><strong>Standard for {selectedRow.location.name}</strong><span>All five stages are required before approval</span></div>
            <button type="button" className="icon-button" aria-label="Close standard form" onClick={() => setShowStandardForm(false)}><X size={16} /></button>
          </div>
          <div className="five-s-standard-editor">
            {standardItems.map((item, index) => (
              <fieldset key={item.stage}>
                <legend>{STAGES.find(([stage]) => stage === item.stage)?.[1]}</legend>
                <label>
                  Check title
                  <input required minLength="3" maxLength="160" value={item.title} onChange={(event) => updateStandardItem(index, { title: event.target.value })} />
                </label>
                <label>
                  Requirement
                  <textarea required minLength="5" maxLength="1000" value={item.requirement} onChange={(event) => updateStandardItem(index, { requirement: event.target.value })} />
                </label>
                {item.stage === 'set_in_order' ? (
                  <label>
                    Canonical equipment link
                    <select value={linkedToolId} onChange={(event) => setLinkedToolId(event.target.value)}>
                      <option value="">Condition check only</option>
                      {tools.filter((tool) => tool.status !== 'retired').map((tool) => (
                        <option key={tool.id} value={tool.id}>{tool.name} / {formatStatus(tool.status)} / {tool.currentLocation || 'location not retained'}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </fieldset>
            ))}
          </div>
          <div className="five-s-form-actions">
            <button className="primary-button" disabled={submitting}><ShieldCheck size={16} /> Request approval</button>
          </div>
        </form>
      ) : null}
      {!loading && !board && fieldMode && !selectedJobId ? <Empty title="Select a job" detail="Choose an assigned job to load its approved 5S locations." /> : null}
      {!loading && board && !rows.length ? (
        <Empty
          title={fieldMode ? 'No job-scoped 5S location' : 'No 5S locations retained'}
          detail={fieldMode
            ? 'The office must retain and approve a job-scoped location standard before field auditing.'
            : 'Add a vehicle, trailer, depot, store, or job storage location to begin controlled 5S work.'}
        />
      ) : null}
      {rows.length ? (
        <div className="five-s-layout">
          <div className="five-s-location-list" role="list" aria-label="5S locations">
            {rows.map((row) => (
              <button
                type="button"
                role="listitem"
                className={row.location.id === selectedRow?.location.id ? 'five-s-location-selected' : ''}
                key={row.location.id}
                onClick={() => {
                  setSelectedLocationId(row.location.id)
                  setAuditLocationId('')
                  setShowStandardForm(false)
                }}
              >
                <span className={`five-s-status-marker five-s-status-${row.status}`} aria-hidden="true" />
                <span>
                  <strong>{row.location.name}</strong>
                  <small>{formatStatus(row.location.locationType)} / {row.location.jobTitle || 'Organization-wide'}</small>
                </span>
                <span className="five-s-location-state">{statusCopy(row)}</span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
          {selectedRow ? (
            <div className="five-s-location-detail">
              <div className="five-s-detail-heading">
                <div>
                  <span>{formatStatus(selectedRow.location.locationType)}</span>
                  <h3>{selectedRow.location.name}</h3>
                  <p>{selectedRow.location.owner} / audit every {selectedRow.location.auditFrequencyDays} days</p>
                </div>
                <span className={`status status-${selectedRow.ready ? 'ready' : 'attention'}`}>{statusCopy(selectedRow)}</span>
              </div>
              <div className="five-s-detail-facts">
                <div><span>Current standard</span><strong>{selectedRow.currentStandard ? `v${selectedRow.currentStandard.versionNumber}` : 'Not approved'}</strong></div>
                <div><span>Latest audit</span><strong>{selectedRow.latestAudit ? formatDate(selectedRow.latestAudit.auditDate) : 'Not retained'}</strong></div>
                <div><span>Score</span><strong>{selectedRow.latestAudit ? `${selectedRow.latestAudit.scorePercent}%` : '-'}</strong></div>
                <div><span>Next audit</span><strong>{selectedRow.nextAuditDate ? formatDate(selectedRow.nextAuditDate) : 'Due now'}</strong></div>
              </div>
              {selectedRow.linkedTools?.length ? (
                <div className="five-s-tool-state">
                  {selectedRow.linkedTools.map((tool) => (
                    <div key={tool.id}>
                      <Wrench size={16} />
                      <span><strong>{tool.name}</strong><small>{formatStatus(tool.status)} / {tool.currentLocation || 'location not retained'} / inspection {formatStatus(tool.inspectionStatus)}</small></span>
                      {tool.reservationReady ? <Check size={16} /> : <AlertTriangle size={16} />}
                    </div>
                  ))}
                </div>
              ) : null}
              {selectedRow.currentStandard ? (
                <div className="five-s-standard-view">
                  {selectedRow.currentStandard.items.map((item) => (
                    <div key={item.id}>
                      <span>{formatStatus(item.stage)}</span>
                      <strong>{item.title}</strong>
                      <p>{item.requirement}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="five-s-readiness-warning"><AlertTriangle size={17} /> Field audits stay blocked until the five-stage standard is approved.</div>
              )}
              {selectedRow.openActions?.length ? (
                <div className="five-s-actions">
                  <div className="five-s-section-heading"><strong>Corrective actions</strong><span>{selectedRow.openActions.length} open</span></div>
                  {selectedRow.openActions.map((action) => (
                    <div className="five-s-action-row" key={action.id}>
                      <span className={`five-s-action-severity five-s-action-${action.severity}`} aria-hidden="true" />
                      <div>
                        <strong>{action.title}</strong>
                        <p>{action.finding}</p>
                        <small>{action.owner} / due {formatDate(action.dueDate)} / {formatStatus(action.severity)}</small>
                      </div>
                      {!fieldMode && canCoordinate ? (
                        <button type="button" className="secondary-button" onClick={() => setResolution({ actionId: action.id, evidenceReference: '', resolutionNote: '' })}>
                          <Check size={15} /> Resolve
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {resolution.actionId ? (
                <form className="five-s-resolution-form" onSubmit={resolveAction}>
                  <div className="five-s-form-heading">
                    <div><strong>Retain resolution evidence</strong><span>The finding remains historical evidence.</span></div>
                    <button type="button" className="icon-button" aria-label="Cancel action resolution" onClick={() => setResolution({ actionId: '', evidenceReference: '', resolutionNote: '' })}><X size={16} /></button>
                  </div>
                  <label>
                    Evidence reference
                    <input required minLength="3" maxLength="500" value={resolution.evidenceReference} onChange={(event) => setResolution({ ...resolution, evidenceReference: event.target.value })} />
                  </label>
                  <label>
                    Resolution note
                    <textarea required minLength="5" maxLength="2000" value={resolution.resolutionNote} onChange={(event) => setResolution({ ...resolution, resolutionNote: event.target.value })} />
                  </label>
                  <button className="primary-button" disabled={submitting}><Check size={16} /> Retain resolution</button>
                </form>
              ) : null}
              {selectedRow.currentStandard && auditLocationId !== selectedRow.location.id ? (
                <button type="button" className="primary-button five-s-audit-command" onClick={() => setAuditLocationId(selectedRow.location.id)}>
                  <Camera size={16} /> Start 5S audit
                </button>
              ) : null}
              {auditLocationId === selectedRow.location.id && selectedRow.currentStandard ? (
                <AuditForm
                  key={`${selectedRow.location.id}-${selectedRow.currentStandard.id}-${auditLocationId}`}
                  row={selectedRow}
                  fieldMode={fieldMode}
                  operatorName={operatorName}
                  submitting={submitting}
                  onCancel={() => setAuditLocationId('')}
                  onSubmit={submitAudit}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="five-s-policy">5S records are internal operating evidence. They do not change tool custody or status, dispatch a vehicle, authorize spend, or certify safety or compliance.</p>
    </div>
  )
}

export default FiveSWorkspace
