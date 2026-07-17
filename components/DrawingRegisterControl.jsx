import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileDown, FileStack, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { createFieldEvidenceDraftId } from '../field-outbox'
import { formatDate, formatStatus, futureDateInput, shortHash } from '../dashboard-format'

const CLOSED_DOCUMENT_STATUSES = new Set(['cancelled', 'rejected', 'superseded', 'void'])

function emptyDraft() {
  return {
    entryKey: createFieldEvidenceDraftId(),
    supersedesDrawingId: '',
    sheetNumber: '',
    revision: '',
    title: '',
    discipline: 'architecture',
    purpose: 'for_construction',
    issueDate: futureDateInput(0),
    scale: '',
    zone: '',
    sourceDocumentId: '',
    revisionReason: '',
    reviewNotes: '',
  }
}

function revisionDraft(drawing) {
  return {
    ...emptyDraft(),
    supersedesDrawingId: drawing.id,
    sheetNumber: drawing.sheetNumber || drawing.documentNumber || '',
    title: drawing.title || '',
    discipline: drawing.discipline || 'architecture',
    purpose: drawing.purpose || 'for_construction',
    scale: drawing.scale || '',
    zone: drawing.zone || '',
  }
}

export default function DrawingRegisterControl({
  jobs,
  fieldScoped,
  canCoordinate,
  apiRequest,
  notify,
  refresh,
  onOpenApprovals,
}) {
  const activeJobs = useMemo(
    () => (jobs || []).filter(job => !['archived', 'completed', 'cancelled', 'rejected'].includes(job.status)),
    [jobs],
  )
  const [jobId, setJobId] = useState('')
  const [drawingId, setDrawingId] = useState('')
  const [drawings, setDrawings] = useState([])
  const [jobDetail, setJobDetail] = useState(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const selectedDrawing = drawings.find(drawing => drawing.id === drawingId) || null
  const currentDrawings = drawings.filter(drawing => drawing.current === true)
  const pendingDrawings = drawings.filter(drawing => drawing.status === 'pending_approval')
  const integrityFailures = drawings.filter(drawing => drawing.integrityValid === false)
  const sourceDocuments = (jobDetail?.documents || []).filter(document => (
    document.type !== 'drawing_revision'
    && document.mimeType === 'application/pdf'
    && !CLOSED_DOCUMENT_STATUSES.has(document.status)
    && document.data?.analysis?.upload?.sha256
  ))
  const revisionSource = currentDrawings.find(drawing => drawing.id === draft.supersedesDrawingId) || null

  const loadRegister = useCallback(async (nextJobId, preferredDrawingId = '') => {
    if (!nextJobId) {
      setDrawings([])
      setJobDetail(null)
      setDrawingId('')
      return
    }
    setLoading(true)
    setError('')
    try {
      const [detailResult, registerResult] = await Promise.all([
        apiRequest(`/api/ledger/jobs/${encodeURIComponent(nextJobId)}`),
        apiRequest(`/api/ledger/jobs/${encodeURIComponent(nextJobId)}/drawings?limit=250`),
      ])
      const retainedDrawings = registerResult.drawings || []
      setJobDetail(detailResult.job || detailResult)
      setDrawings(retainedDrawings)
      setDrawingId(current => (
        retainedDrawings.some(drawing => drawing.id === preferredDrawingId) ? preferredDrawingId
          : retainedDrawings.some(drawing => drawing.id === current) ? current
            : retainedDrawings.find(drawing => drawing.current)?.id || retainedDrawings[0]?.id || ''
      ))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [apiRequest])

  useEffect(() => {
    if (jobId && activeJobs.some(job => job.id === jobId)) return
    setJobId(activeJobs[0]?.id || '')
    setDraft(emptyDraft())
  }, [activeJobs, jobId])

  useEffect(() => {
    void loadRegister(jobId)
  }, [jobId, loadRegister])

  function selectJob(nextJobId) {
    setJobId(nextJobId)
    setDrawingId('')
    setDraft(emptyDraft())
  }

  function selectRevisionSource(nextDrawingId) {
    const source = currentDrawings.find(drawing => drawing.id === nextDrawingId)
    setDraft(source ? revisionDraft(source) : emptyDraft())
  }

  async function createRevision(event) {
    event.preventDefault()
    if (!canCoordinate || !jobId || !draft.sourceDocumentId) {
      setError('Select a checksum-bound drawing PDF before requesting publication review.')
      return
    }
    if (navigator.onLine === false) {
      setError('Reconnect before freezing a drawing revision so its source PDF and supersession can be verified.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await apiRequest(`/api/ledger/jobs/${encodeURIComponent(jobId)}/drawing-revisions`, {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          supersedesDrawingId: draft.supersedesDrawingId || null,
        }),
      })
      notify(result.replayed
        ? 'This exact drawing revision was already retained; no duplicate approval was created.'
        : draft.supersedesDrawingId
          ? 'The replacement drawing was frozen for approval. The prior revision remains current until approval.'
          : 'The drawing was frozen for approval. It is not field-current until an approver verifies the retained source.')
      setDraft(emptyDraft())
      await Promise.all([loadRegister(jobId, result.drawing.id), refresh()])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="sds-register-control drawing-register-control" data-testid="drawing-register-control" aria-busy={loading || undefined}>
      <div className="panel-heading">
        <div>
          <h2>Drawing register</h2>
          <p>Current field revisions, immutable PDFs, and controlled issue status</p>
        </div>
        <div className="sds-register-summary" aria-label="Drawing register summary">
          <span className="tag tag-green">{currentDrawings.length} current</span>
          {pendingDrawings.length ? <span className="tag tag-amber">{pendingDrawings.length} review</span> : null}
          {integrityFailures.length ? <span className="tag tag-red">{integrityFailures.length} integrity</span> : null}
          <button className="icon-button" type="button" aria-label="Refresh drawing register" disabled={loading || !jobId} onClick={() => void loadRegister(jobId, drawingId)}>
            <RefreshCw size={17} />
          </button>
        </div>
      </div>
      <div className="sds-register-selector">
        <label>
          Job
          <select required aria-label="Drawing job" value={jobId} onChange={(event) => selectJob(event.target.value)}>
            <option value="">Select a job</option>
            {activeJobs.map(job => <option key={job.id} value={job.id}>{job.title}</option>)}
          </select>
        </label>
        <label>
          Drawing revision
          <select aria-label="Drawing revision" value={drawingId} disabled={!jobId || !drawings.length} onChange={(event) => setDrawingId(event.target.value)}>
            <option value="">{drawings.length ? 'Select a revision' : 'No retained drawings'}</option>
            {drawings.map(drawing => (
              <option key={drawing.id} value={drawing.id}>
                {drawing.sheetNumber || drawing.documentNumber} / {drawing.revision} / {formatStatus(drawing.status)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {selectedDrawing ? (
        <div className="sds-register-detail" aria-live="polite">
          <div className="sds-register-context">
            <div>
              <strong>{selectedDrawing.sheetNumber || selectedDrawing.documentNumber} / {selectedDrawing.title}</strong>
              <small>{formatStatus(selectedDrawing.discipline)} / {formatStatus(selectedDrawing.purpose)}</small>
            </div>
            <span className={`status status-${selectedDrawing.current ? 'ready' : selectedDrawing.status}`}>{selectedDrawing.current ? 'Current' : formatStatus(selectedDrawing.status)}</span>
          </div>
          <dl className="sds-register-facts">
            <div><dt>Revision</dt><dd>{selectedDrawing.revision}</dd></div>
            <div><dt>Issued</dt><dd>{formatDate(selectedDrawing.issueDate)}</dd></div>
            <div><dt>Scale</dt><dd>{selectedDrawing.scale || 'Not stated'}</dd></div>
            <div><dt>Zone</dt><dd>{selectedDrawing.zone || 'Whole project'}</dd></div>
            <div><dt>Integrity</dt><dd>{selectedDrawing.integrityValid ? `Verified ${shortHash(selectedDrawing.sourceHash)}` : 'Review required'}</dd></div>
          </dl>
          <div className="sds-control-grid">
            <div><span>Source PDF</span><p>{selectedDrawing.sourceDocumentReference || selectedDrawing.filename || 'Retained document'}</p></div>
            <div><span>Revision reason</span><p>{selectedDrawing.revisionReason || 'Not retained'}</p></div>
            <div><span>Review notes</span><p>{selectedDrawing.reviewNotes || 'No internal notes'}</p></div>
            <div><span>Publication</span><p>{selectedDrawing.current ? 'Approved for current internal field use' : 'Not current for field use'}</p></div>
          </div>
          <div className="sds-register-actions">
            <a className="secondary-button" href={`/api/ledger/documents/${encodeURIComponent(selectedDrawing.id)}/content`} target="_blank" rel="noreferrer">
              <FileDown size={16} /> Open retained PDF
            </a>
            {canCoordinate && selectedDrawing.current ? (
              <button className="secondary-button" type="button" onClick={() => selectRevisionSource(selectedDrawing.id)}>
                <Plus size={16} /> New revision
              </button>
            ) : null}
            {!fieldScoped && selectedDrawing.approvalId && selectedDrawing.status === 'pending_approval' ? (
              <button className="secondary-button" type="button" onClick={() => onOpenApprovals?.({ jobId, approvalId: selectedDrawing.approvalId })}>
                <ShieldCheck size={16} /> Open approval
              </button>
            ) : null}
          </div>
        </div>
      ) : jobId ? (
        <div className="sds-register-empty"><FileStack size={20} /><span>No governed drawing revision is retained for this job.</span></div>
      ) : null}
      {canCoordinate ? (
        <form className="sds-revision-form" onSubmit={createRevision}>
          <div className="sds-revision-heading">
            <strong>{revisionSource ? `Replace ${revisionSource.sheetNumber} ${revisionSource.revision}` : 'Retain drawing revision'}</strong>
            {revisionSource ? <span>The prior revision remains current until this approval resolves.</span> : null}
          </div>
          <div className="form-grid">
            <label className="form-span">
              Revision source
              <select aria-label="Drawing revision source" value={draft.supersedesDrawingId} onChange={(event) => selectRevisionSource(event.target.value)}>
                <option value="">New drawing sheet</option>
                {currentDrawings.map(drawing => <option key={drawing.id} value={drawing.id}>{drawing.sheetNumber} / {drawing.revision} / {drawing.title}</option>)}
              </select>
            </label>
            <label>
              Sheet number
              <input required minLength="2" maxLength="80" disabled={Boolean(revisionSource)} value={draft.sheetNumber} onChange={(event) => setDraft({ ...draft, sheetNumber: event.target.value.toUpperCase() })} placeholder="A-101" />
            </label>
            <label>
              Revision
              <input required minLength="1" maxLength="40" value={draft.revision} onChange={(event) => setDraft({ ...draft, revision: event.target.value.toUpperCase() })} placeholder="C01" />
            </label>
            <label className="form-span">
              Drawing title
              <input required minLength="2" maxLength="180" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            </label>
            <label>
              Discipline
              <select aria-label="Drawing discipline" value={draft.discipline} onChange={(event) => setDraft({ ...draft, discipline: event.target.value })}>
                <option value="architecture">Architecture</option><option value="structural">Structural</option><option value="mechanical">Mechanical</option><option value="electrical">Electrical</option><option value="civil">Civil</option><option value="general">General</option>
              </select>
            </label>
            <label>
              Purpose
              <select aria-label="Drawing purpose" value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value })}>
                <option value="for_construction">For construction</option><option value="for_coordination">For coordination</option><option value="for_information">For information</option><option value="for_review">For review</option><option value="as_built">As built</option>
              </select>
            </label>
            <label>
              Issue date
              <input required type="date" max={futureDateInput(0)} value={draft.issueDate} onChange={(event) => setDraft({ ...draft, issueDate: event.target.value })} />
            </label>
            <label>
              Scale
              <input maxLength="80" value={draft.scale} onChange={(event) => setDraft({ ...draft, scale: event.target.value })} placeholder="1:50" />
            </label>
            <label className="form-span">
              Zone or area
              <input maxLength="120" value={draft.zone} onChange={(event) => setDraft({ ...draft, zone: event.target.value })} placeholder="Ground floor, block A" />
            </label>
            <label className="form-span">
              Retained drawing PDF
              <select required aria-label="Retained drawing PDF" value={draft.sourceDocumentId} onChange={(event) => setDraft({ ...draft, sourceDocumentId: event.target.value })}>
                <option value="">Select checksum-bound job evidence</option>
                {sourceDocuments.map(document => <option key={document.id} value={document.id}>{document.filename || document.title}</option>)}
              </select>
            </label>
            <label className="form-span">
              Revision reason
              <textarea required minLength="3" maxLength="1000" value={draft.revisionReason} onChange={(event) => setDraft({ ...draft, revisionReason: event.target.value })} />
            </label>
            <label className="form-span">
              Internal review notes
              <textarea maxLength="2000" value={draft.reviewNotes} onChange={(event) => setDraft({ ...draft, reviewNotes: event.target.value })} />
            </label>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {!sourceDocuments.length ? <p className="sds-document-warning">No checksum-bound PDF is retained on this job.</p> : null}
          <button className="primary-button" disabled={submitting || !jobId || !draft.sourceDocumentId}>
            <ShieldCheck size={16} /> {submitting ? 'Freezing revision...' : 'Request publication approval'}
          </button>
        </form>
      ) : error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  )
}
