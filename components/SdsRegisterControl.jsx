import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileDown, FlaskConical, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { createFieldEvidenceDraftId } from '../field-outbox'
import { formatDate, formatStatus, futureDateInput, shortHash } from '../dashboard-format'

const CURRENT_STATUSES = new Set(['current', 'approved', 'accepted', 'active'])
const CLOSED_DOCUMENT_STATUSES = new Set(['cancelled', 'rejected', 'superseded', 'void'])

function splitLines(value) {
  return String(value || '').split(/\r?\n|,/).map(item => item.trim()).filter(Boolean)
}

function emptyDraft() {
  return {
    entryKey: createFieldEvidenceDraftId(),
    supersedesSdsId: '',
    material: '',
    manufacturer: '',
    productCode: '',
    language: 'nl',
    issuedOn: futureDateInput(0),
    expiresAt: futureDateInput(365 * 3),
    documentId: '',
    hazardClasses: '',
    requiredPpe: '',
    firstAidMeasures: '',
    fireMeasures: '',
    handlingStorage: '',
    spillResponse: '',
    disposal: '',
    emergencyContact: '',
    revisionReason: '',
    notes: '',
  }
}

function sheetDraft(sheet) {
  return {
    ...emptyDraft(),
    supersedesSdsId: sheet.id,
    material: sheet.material || '',
    manufacturer: sheet.manufacturer || '',
    productCode: sheet.productCode || '',
    language: sheet.language || 'nl',
    issuedOn: futureDateInput(0),
    hazardClasses: (sheet.hazardClasses || []).join('\n'),
    requiredPpe: (sheet.requiredPpe || []).join('\n'),
    firstAidMeasures: sheet.firstAidMeasures || '',
    fireMeasures: sheet.fireMeasures || '',
    handlingStorage: sheet.handlingStorage || '',
    spillResponse: sheet.spillResponse || '',
    disposal: sheet.disposal || '',
    emergencyContact: sheet.emergencyContact || '',
    revisionReason: '',
    notes: '',
  }
}

export default function SdsRegisterControl({
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
  const [sheetId, setSheetId] = useState('')
  const [sheets, setSheets] = useState([])
  const [jobDetail, setJobDetail] = useState(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const selectedSheet = sheets.find(sheet => sheet.id === sheetId) || null
  const currentSheets = sheets.filter(sheet => CURRENT_STATUSES.has(sheet.status))
  const pendingSheets = sheets.filter(sheet => sheet.status === 'pending_approval')
  const expiringSheets = currentSheets.filter(sheet => {
    const expiresAt = Date.parse(sheet.expiresAt || '')
    return Number.isFinite(expiresAt) && expiresAt <= Date.now() + 30 * 24 * 60 * 60 * 1000
  })
  const pdfDocuments = (jobDetail?.documents || []).filter(document => (
    document.mimeType === 'application/pdf'
    && !CLOSED_DOCUMENT_STATUSES.has(document.status)
    && document.data?.analysis?.upload?.sha256
  ))
  const revisionSource = currentSheets.find(sheet => sheet.id === draft.supersedesSdsId) || null

  const loadRegister = useCallback(async (nextJobId, preferredSheetId = '') => {
    if (!nextJobId) {
      setSheets([])
      setJobDetail(null)
      setSheetId('')
      return
    }
    setLoading(true)
    setError('')
    try {
      const [detailResult, registerResult] = await Promise.all([
        apiRequest(`/api/ledger/jobs/${encodeURIComponent(nextJobId)}`),
        apiRequest(`/api/ledger/jobs/${encodeURIComponent(nextJobId)}/sds-sheets?limit=250`),
      ])
      const retainedSheets = registerResult.sdsSheets || []
      setJobDetail(detailResult.job || detailResult)
      setSheets(retainedSheets)
      setSheetId(current => (
        retainedSheets.some(sheet => sheet.id === preferredSheetId) ? preferredSheetId
          : retainedSheets.some(sheet => sheet.id === current) ? current
            : retainedSheets.find(sheet => sheet.current)?.id || retainedSheets[0]?.id || ''
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
    loadRegister(jobId)
  }, [jobId, loadRegister])

  function selectJob(nextJobId) {
    setJobId(nextJobId)
    setSheetId('')
    setDraft(emptyDraft())
  }

  function selectRevisionSource(nextSheetId) {
    const source = currentSheets.find(sheet => sheet.id === nextSheetId)
    setDraft(source ? sheetDraft(source) : emptyDraft())
  }

  async function createRevision(event) {
    event.preventDefault()
    const hazardClasses = splitLines(draft.hazardClasses)
    const requiredPpe = splitLines(draft.requiredPpe)
    if (!canCoordinate || !jobId || !draft.documentId || !hazardClasses.length || !requiredPpe.length) {
      setError('Retain the product, checksum-bound PDF, hazard classification, and PPE controls before requesting review.')
      return
    }
    if (navigator.onLine === false) {
      setError('Reconnect before freezing an SDS revision so the current document and product lineage can be verified.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const result = await apiRequest(`/api/ledger/jobs/${encodeURIComponent(jobId)}/sds-revisions`, {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          supersedesSdsId: draft.supersedesSdsId || null,
          hazardClasses,
          requiredPpe,
          expiresAt: new Date(`${draft.expiresAt}T23:59:59.999Z`).toISOString(),
        }),
      })
      notify(result.replayed
        ? 'This exact SDS revision was already retained; no duplicate approval was created.'
        : draft.supersedesSdsId
          ? 'The replacement SDS revision was frozen for approval. The current revision remains active until approval.'
          : 'The SDS revision was frozen for approval. It is not current until an approver verifies the retained source.')
      setDraft(emptyDraft())
      await Promise.all([loadRegister(jobId, result.sdsSheet.id), refresh()])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="sds-register-control" data-testid="sds-register-control" aria-busy={loading || undefined}>
      <div className="panel-heading">
        <div>
          <h2>SDS register</h2>
          <p>Current product revisions and retained emergency controls</p>
        </div>
        <div className="sds-register-summary" aria-label="SDS register summary">
          <span className="tag tag-green">{currentSheets.filter(sheet => sheet.current).length} current</span>
          {pendingSheets.length ? <span className="tag tag-amber">{pendingSheets.length} review</span> : null}
          {expiringSheets.length ? <span className="tag tag-red">{expiringSheets.length} due</span> : null}
          <button className="icon-button" type="button" aria-label="Refresh SDS register" disabled={loading || !jobId} onClick={() => void loadRegister(jobId, sheetId)}>
            <RefreshCw size={17} />
          </button>
        </div>
      </div>
      <div className="sds-register-selector">
        <label>
          Job
          <select required aria-label="Job" value={jobId} onChange={(event) => selectJob(event.target.value)}>
            <option value="">Select a job</option>
            {activeJobs.map(job => <option key={job.id} value={job.id}>{job.title}</option>)}
          </select>
        </label>
        <label>
          Product revision
          <select aria-label="Product revision" value={sheetId} disabled={!jobId || !sheets.length} onChange={(event) => setSheetId(event.target.value)}>
            <option value="">{sheets.length ? 'Select a revision' : 'No retained SDS'}</option>
            {sheets.map(sheet => (
              <option key={sheet.id} value={sheet.id}>
                {sheet.material} / r{sheet.revisionNumber} / {formatStatus(sheet.status)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {selectedSheet ? (
        <div className="sds-register-detail" aria-live="polite">
          <div className="sds-register-context">
            <div>
              <strong>{selectedSheet.material}</strong>
              <small>{selectedSheet.manufacturer}{selectedSheet.productCode ? ` / ${selectedSheet.productCode}` : ''}</small>
            </div>
            <span className={`status status-${selectedSheet.current ? 'ready' : selectedSheet.status}`}>{selectedSheet.current ? 'Current' : formatStatus(selectedSheet.status)}</span>
          </div>
          <dl className="sds-register-facts">
            <div><dt>Revision</dt><dd>{selectedSheet.revisionNumber}</dd></div>
            <div><dt>Language</dt><dd>{String(selectedSheet.language || 'nl').toUpperCase()}</dd></div>
            <div><dt>Issued</dt><dd>{formatDate(selectedSheet.issuedOn)}</dd></div>
            <div><dt>Expires</dt><dd>{formatDate(selectedSheet.expiresAt)}</dd></div>
            <div><dt>Integrity</dt><dd>{selectedSheet.integrityValid ? `Verified ${shortHash(selectedSheet.sourceHash)}` : 'Review required'}</dd></div>
          </dl>
          <div className="sds-control-grid">
            <div><span>Hazard classes</span><ul>{(selectedSheet.hazardClasses || []).map(item => <li key={item}>{item}</li>)}</ul></div>
            <div><span>Required PPE</span><ul>{(selectedSheet.requiredPpe || []).map(item => <li key={item}>{item}</li>)}</ul></div>
            <div><span>First aid</span><p>{selectedSheet.firstAidMeasures || 'Not retained'}</p></div>
            <div><span>Fire</span><p>{selectedSheet.fireMeasures || 'Not retained'}</p></div>
            <div><span>Handling and storage</span><p>{selectedSheet.handlingStorage || 'Not retained'}</p></div>
            <div><span>Spill response</span><p>{selectedSheet.spillResponse || 'Not retained'}</p></div>
            <div><span>Disposal</span><p>{selectedSheet.disposal || 'Not retained'}</p></div>
            <div><span>Emergency contact</span><p>{selectedSheet.emergencyContact || 'Not retained'}</p></div>
          </div>
          <div className="sds-register-actions">
            {selectedSheet.documentId ? (
              <a className="secondary-button" href={`/api/ledger/documents/${encodeURIComponent(selectedSheet.documentId)}/content`} target="_blank" rel="noreferrer">
                <FileDown size={16} /> Open retained PDF
              </a>
            ) : null}
            {canCoordinate && selectedSheet.current ? (
              <button className="secondary-button" type="button" onClick={() => selectRevisionSource(selectedSheet.id)}>
                <Plus size={16} /> New revision
              </button>
            ) : null}
            {!fieldScoped && selectedSheet.approvalId && selectedSheet.status === 'pending_approval' ? (
              <button className="secondary-button" type="button" onClick={() => onOpenApprovals?.({ jobId, approvalId: selectedSheet.approvalId })}>
                <ShieldCheck size={16} /> Open approval
              </button>
            ) : null}
          </div>
        </div>
      ) : jobId ? (
        <div className="sds-register-empty"><FlaskConical size={20} /><span>No SDS revision is retained for this job.</span></div>
      ) : null}
      {canCoordinate ? (
        <form className="sds-revision-form" onSubmit={createRevision}>
          <div className="sds-revision-heading">
            <strong>{revisionSource ? `Replace revision ${revisionSource.revisionNumber}` : 'Retain product revision'}</strong>
            {revisionSource ? <span>{revisionSource.material} remains current until approval.</span> : null}
          </div>
          <div className="form-grid">
            <label className="form-span">
              Revision source
              <select aria-label="Revision source" value={draft.supersedesSdsId} onChange={(event) => selectRevisionSource(event.target.value)}>
                <option value="">New product</option>
                {currentSheets.map(sheet => <option key={sheet.id} value={sheet.id}>{sheet.material} / r{sheet.revisionNumber}</option>)}
              </select>
            </label>
            <label>
              Product name
              <input required minLength="2" maxLength="240" disabled={Boolean(revisionSource)} value={draft.material} onChange={(event) => setDraft({ ...draft, material: event.target.value })} />
            </label>
            <label>
              Manufacturer
              <input required minLength="2" maxLength="160" disabled={Boolean(revisionSource)} value={draft.manufacturer} onChange={(event) => setDraft({ ...draft, manufacturer: event.target.value })} />
            </label>
            <label>
              Product code
              <input maxLength="80" disabled={Boolean(revisionSource)} value={draft.productCode} onChange={(event) => setDraft({ ...draft, productCode: event.target.value })} />
            </label>
            <label>
              Language
              <select aria-label="Language" value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value })}>
                <option value="nl">NL</option><option value="en">EN</option><option value="de">DE</option><option value="fr">FR</option>
              </select>
            </label>
            <label>
              Issue date
              <input required type="date" max={futureDateInput(0)} value={draft.issuedOn} onChange={(event) => setDraft({ ...draft, issuedOn: event.target.value })} />
            </label>
            <label>
              Expiry date
              <input required type="date" min={futureDateInput(1)} value={draft.expiresAt} onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })} />
            </label>
            <label className="form-span">
              Retained PDF
              <select required aria-label="Retained PDF" value={draft.documentId} onChange={(event) => setDraft({ ...draft, documentId: event.target.value })}>
                <option value="">Select checksum-bound job evidence</option>
                {pdfDocuments.map(document => <option key={document.id} value={document.id}>{document.filename || document.title}</option>)}
              </select>
            </label>
            <label>
              Hazard classes
              <textarea required minLength="2" maxLength="3200" value={draft.hazardClasses} onChange={(event) => setDraft({ ...draft, hazardClasses: event.target.value })} />
            </label>
            <label>
              Required PPE
              <textarea required minLength="2" maxLength="3200" value={draft.requiredPpe} onChange={(event) => setDraft({ ...draft, requiredPpe: event.target.value })} />
            </label>
            <label><span>First-aid measures</span><textarea required minLength="3" maxLength="2000" value={draft.firstAidMeasures} onChange={(event) => setDraft({ ...draft, firstAidMeasures: event.target.value })} /></label>
            <label><span>Fire measures</span><textarea required minLength="3" maxLength="2000" value={draft.fireMeasures} onChange={(event) => setDraft({ ...draft, fireMeasures: event.target.value })} /></label>
            <label><span>Handling and storage</span><textarea required minLength="3" maxLength="2000" value={draft.handlingStorage} onChange={(event) => setDraft({ ...draft, handlingStorage: event.target.value })} /></label>
            <label><span>Spill response</span><textarea required minLength="3" maxLength="2000" value={draft.spillResponse} onChange={(event) => setDraft({ ...draft, spillResponse: event.target.value })} /></label>
            <label><span>Disposal controls</span><textarea required minLength="3" maxLength="2000" value={draft.disposal} onChange={(event) => setDraft({ ...draft, disposal: event.target.value })} /></label>
            <label><span>Emergency contact</span><textarea required minLength="3" maxLength="2000" value={draft.emergencyContact} onChange={(event) => setDraft({ ...draft, emergencyContact: event.target.value })} /></label>
            <label className="form-span">
              Revision reason
              <textarea required minLength="3" maxLength="1000" value={draft.revisionReason} onChange={(event) => setDraft({ ...draft, revisionReason: event.target.value })} />
            </label>
            <label className="form-span">
              Internal notes
              <textarea maxLength="2000" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
            </label>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {!pdfDocuments.length ? <p className="sds-document-warning">No checksum-bound PDF is retained on this job.</p> : null}
          <button className="primary-button" disabled={submitting || !jobId || !draft.documentId}>
            <ShieldCheck size={16} /> {submitting ? 'Freezing revision...' : 'Request current-status approval'}
          </button>
        </form>
      ) : error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  )
}
