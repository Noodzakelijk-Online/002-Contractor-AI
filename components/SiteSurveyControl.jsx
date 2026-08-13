import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileDown,
  FileUp,
  LoaderCircle,
  Plus,
  Ruler,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react'
import { formatReadableDate } from '../dashboard-format'
import './SiteSurveyControl.css'

function localDateTime(value = Date.now() + 24 * 60 * 60 * 1000) {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function isoDateTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function lines(value) {
  return [...new Set(String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean))]
}

function statusLabel(value) {
  return String(value || 'required').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function surveyStatus(control) {
  if (control?.readiness?.estimateReady) return 'ready'
  return control?.readiness?.status || control?.latestSurvey?.status || 'required'
}

export default function SiteSurveyControl({
  opportunity,
  canCoordinate,
  canApprove,
  submitting,
  onPlan,
  onUploadEvidence,
  onSubmit,
  onReviewApproval,
}) {
  const control = opportunity?.siteSurvey || {}
  const template = control.template || { items: [] }
  const evidence = useMemo(() => opportunity?.evidence || [], [opportunity?.evidence])
  const activeSurvey = control.activeSurvey
  const latestSurvey = control.latestSurvey
  const pendingSurvey = control.pendingSurvey
  const status = surveyStatus(control)
  const canPlan = canCoordinate
    && !['won', 'lost', 'archived'].includes(opportunity?.stage)
    && !activeSurvey
    && !pendingSurvey
    && control.readiness?.estimateReady !== true
  const canComplete = canCoordinate && ['planned', 'in_progress'].includes(activeSurvey?.status)
  const [plan, setPlan] = useState({ scheduledAt: localDateTime(), surveyor: '', notes: '' })
  const [selectedFile, setSelectedFile] = useState(null)
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState([])
  const [completion, setCompletion] = useState({
    surveyedAt: localDateTime(Date.now()),
    surveyor: '',
    scopeSummary: '',
    assumptions: '',
    exclusions: '',
    constraints: '',
    utilities: '',
    hazards: '',
    clientDecisions: '',
  })
  const [responses, setResponses] = useState({})
  const [measurements, setMeasurements] = useState([{ label: '', quantity: '', unit: 'm2', location: '', notes: '' }])

  useEffect(() => {
    setSelectedEvidenceIds(evidence.map((item) => item.id))
  }, [evidence])

  useEffect(() => {
    setPlan((current) => ({
      ...current,
      surveyor: activeSurvey?.surveyor || opportunity?.ownerName || current.surveyor,
      scheduledAt: activeSurvey?.scheduledAt ? localDateTime(activeSurvey.scheduledAt) : current.scheduledAt,
    }))
    setCompletion((current) => ({
      ...current,
      surveyor: activeSurvey?.surveyor || opportunity?.ownerName || current.surveyor,
    }))
  }, [activeSurvey?.id, activeSurvey?.scheduledAt, activeSurvey?.surveyor, opportunity?.id, opportunity?.ownerName])

  const answered = useMemo(
    () => template.items.filter((item) => responses[item.key]?.result).length,
    [responses, template.items],
  )
  const completionReady = canComplete
    && completion.surveyor.trim().length >= 2
    && completion.scopeSummary.trim().length >= 8
    && answered === template.items.length
    && measurements.length > 0
    && measurements.every((item) => item.label.trim() && Number(item.quantity) > 0 && item.unit.trim())
    && selectedEvidenceIds.length > 0

  async function submitPlan(event) {
    event.preventDefault()
    await onPlan({
      entryKey: `site-survey-plan:${opportunity.id}:${globalThis.crypto.randomUUID()}`,
      scheduledAt: isoDateTime(plan.scheduledAt),
      surveyor: plan.surveyor.trim(),
      notes: plan.notes.trim(),
    })
  }

  async function uploadEvidence(event) {
    event.preventDefault()
    if (!selectedFile) return
    const result = await onUploadEvidence(selectedFile)
    if (result) setSelectedFile(null)
  }

  async function submitCompletion(event) {
    event.preventDefault()
    if (!completionReady) return
    await onSubmit(activeSurvey.id, {
      entryKey: `site-survey-submission:${activeSurvey.id}:${globalThis.crypto.randomUUID()}`,
      surveyedAt: isoDateTime(completion.surveyedAt),
      surveyor: completion.surveyor.trim(),
      scopeSummary: completion.scopeSummary.trim(),
      checklistResponses: template.items.map((item) => ({
        itemKey: item.key,
        result: responses[item.key].result,
        notes: responses[item.key].notes?.trim() || '',
        evidenceDocumentIds: selectedEvidenceIds,
      })),
      measurements: measurements.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        label: item.label.trim(),
        unit: item.unit.trim(),
        location: item.location.trim(),
        notes: item.notes.trim(),
        evidenceIds: selectedEvidenceIds,
      })),
      evidenceIds: selectedEvidenceIds,
      assumptions: lines(completion.assumptions),
      exclusions: lines(completion.exclusions),
      constraints: lines(completion.constraints),
      utilities: lines(completion.utilities),
      hazards: lines(completion.hazards),
      clientDecisions: lines(completion.clientDecisions),
    })
  }

  function updateMeasurement(index, field, value) {
    setMeasurements((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )))
  }

  return (
    <section className="site-survey-control" aria-labelledby="site-survey-heading" data-testid="site-survey-control">
      <header className="site-survey-heading">
        <div className="site-survey-title">
          <ClipboardCheck size={18} />
          <div>
            <h3 id="site-survey-heading">Preconstruction site survey</h3>
            <p>{template.name || 'Standard preconstruction checklist'} / version {template.version || 1}</p>
          </div>
        </div>
        <span className={`site-survey-state site-survey-state-${status}`}>
          {status === 'ready' ? <CheckCircle2 size={14} /> : status === 'stale' ? <TriangleAlert size={14} /> : <ShieldCheck size={14} />}
          {statusLabel(status)}
        </span>
      </header>

      {latestSurvey ? (
        <div className="site-survey-summary">
          <div><span>Surveyor</span><strong>{latestSurvey.surveyor || 'Unassigned'}</strong></div>
          <div><span>Planned</span><strong>{latestSurvey.scheduledAt ? formatReadableDate(latestSurvey.scheduledAt, true) : 'Not set'}</strong></div>
          <div><span>Measurements</span><strong>{latestSurvey.snapshot?.submission?.measurements?.length || 0}</strong></div>
          <div><span>Evidence</span><strong>{latestSurvey.snapshot?.submission?.evidenceIds?.length || evidence.length}</strong></div>
        </div>
      ) : null}

      {control.readiness?.blockers?.length ? (
        <div className="site-survey-alert site-survey-alert-error">
          <TriangleAlert size={16} />
          <div>
            <strong>Estimating blocked</strong>
            {control.readiness.blockers.map((item) => <span key={item.code}>{item.message}</span>)}
          </div>
        </div>
      ) : null}
      {control.stale ? (
        <div className="site-survey-alert site-survey-alert-warning">
          <TriangleAlert size={16} />
          <div><strong>Evidence changed</strong><span>Submit a current survey snapshot for approval.</span></div>
        </div>
      ) : null}

      {canPlan ? (
        <form className="site-survey-band site-survey-plan" onSubmit={submitPlan}>
          <div className="site-survey-band-heading">
            <CalendarDays size={16} />
            <div><h4>Plan survey</h4><p>Internal plan</p></div>
          </div>
          <label>
            <span>Date and time</span>
            <input type="datetime-local" value={plan.scheduledAt} onChange={(event) => setPlan({ ...plan, scheduledAt: event.target.value })} required />
          </label>
          <label>
            <span>Surveyor</span>
            <input value={plan.surveyor} onChange={(event) => setPlan({ ...plan, surveyor: event.target.value })} minLength={2} maxLength={160} required />
          </label>
          <label className="site-survey-wide">
            <span>Planning notes</span>
            <input value={plan.notes} onChange={(event) => setPlan({ ...plan, notes: event.target.value })} maxLength={2000} />
          </label>
          <button className="primary-button" type="submit" disabled={submitting || !plan.scheduledAt || plan.surveyor.trim().length < 2}>
            {submitting ? <LoaderCircle className="spin" size={15} /> : <CalendarDays size={15} />} Retain plan
          </button>
        </form>
      ) : null}

      {canComplete ? (
        <>
          <form className="site-survey-band site-survey-evidence-upload" onSubmit={uploadEvidence}>
            <div className="site-survey-band-heading">
              <FileUp size={16} />
              <div><h4>Private evidence</h4><p>Checksum verified</p></div>
            </div>
            <label className="site-survey-file">
              <span>File</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setSelectedFile(event.target.files?.[0] || null)} />
            </label>
            <button className="secondary-button" type="submit" disabled={submitting || !selectedFile}>
              {submitting ? <LoaderCircle className="spin" size={15} /> : <FileUp size={15} />} Upload
            </button>
          </form>

          {evidence.length ? (
            <div className="site-survey-evidence-list" aria-label="Retained site survey evidence">
              {evidence.map((item) => (
                <label key={item.id}>
                  <input
                    type="checkbox"
                    checked={selectedEvidenceIds.includes(item.id)}
                    onChange={(event) => setSelectedEvidenceIds((current) => (
                      event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id)
                    ))}
                  />
                  <span><strong>{item.title}</strong><small>{item.filename || item.mimeType || 'Evidence'} / {Math.round((item.sizeBytes || 0) / 1024)} KB</small></span>
                  <a href={`/api/ledger/opportunity-evidence/${encodeURIComponent(item.id)}/content`} aria-label={`Download ${item.title}`} title="Download retained evidence">
                    <FileDown size={15} />
                  </a>
                </label>
              ))}
            </div>
          ) : null}

          <form className="site-survey-completion" onSubmit={submitCompletion}>
            <div className="site-survey-completion-heading">
              <div>
                <h4>Complete survey</h4>
                <p>{answered}/{template.items.length} checklist items / {selectedEvidenceIds.length} evidence selected</p>
              </div>
              <span className="site-survey-progress" aria-label={`${answered} of ${template.items.length} checklist items complete`}>
                <i style={{ width: `${template.items.length ? (answered / template.items.length) * 100 : 0}%` }} />
              </span>
            </div>
            <div className="site-survey-form-grid">
              <label><span>Surveyed at</span><input type="datetime-local" value={completion.surveyedAt} onChange={(event) => setCompletion({ ...completion, surveyedAt: event.target.value })} required /></label>
              <label><span>Surveyor</span><input value={completion.surveyor} onChange={(event) => setCompletion({ ...completion, surveyor: event.target.value })} required /></label>
              <label className="site-survey-wide"><span>Scope summary</span><textarea value={completion.scopeSummary} onChange={(event) => setCompletion({ ...completion, scopeSummary: event.target.value })} rows={3} minLength={8} maxLength={4000} required /></label>
            </div>

            <div className="site-survey-checklist">
              {template.items.map((item, index) => (
                <div className="site-survey-checklist-row" key={item.key}>
                  <span className="site-survey-checklist-number">{String(index + 1).padStart(2, '0')}</span>
                  <div className="site-survey-checklist-copy">
                    <strong>{item.prompt}</strong>
                    <small>{statusLabel(item.category)} / {statusLabel(item.failureSeverity)}</small>
                  </div>
                  <select
                    aria-label={`${item.prompt} result`}
                    value={responses[item.key]?.result || ''}
                    onChange={(event) => setResponses((current) => ({
                      ...current,
                      [item.key]: { ...current[item.key], result: event.target.value },
                    }))}
                    required
                  >
                    <option value="">Result</option>
                    <option value="pass">Pass</option>
                    <option value="fail">Fail</option>
                    {item.allowNotApplicable ? <option value="not_applicable">Not applicable</option> : null}
                  </select>
                  <input
                    aria-label={`${item.prompt} notes`}
                    value={responses[item.key]?.notes || ''}
                    onChange={(event) => setResponses((current) => ({
                      ...current,
                      [item.key]: { ...current[item.key], notes: event.target.value },
                    }))}
                    placeholder="Retained note"
                    maxLength={2000}
                  />
                </div>
              ))}
            </div>

            <div className="site-survey-measurements">
              <div className="site-survey-section-heading">
                <div><Ruler size={16} /><h4>Measurements</h4></div>
                <button className="secondary-button" type="button" onClick={() => setMeasurements((current) => [...current, { label: '', quantity: '', unit: 'm2', location: '', notes: '' }])}>
                  <Plus size={14} /> Add
                </button>
              </div>
              {measurements.map((item, index) => (
                <div className="site-survey-measurement-row" key={`measurement-${index}`}>
                  <label><span>Measurement</span><input value={item.label} onChange={(event) => updateMeasurement(index, 'label', event.target.value)} required /></label>
                  <label><span>Quantity</span><input type="number" min="0.0001" step="0.0001" value={item.quantity} onChange={(event) => updateMeasurement(index, 'quantity', event.target.value)} required /></label>
                  <label><span>Unit</span><input value={item.unit} onChange={(event) => updateMeasurement(index, 'unit', event.target.value)} required /></label>
                  <label><span>Location</span><input value={item.location} onChange={(event) => updateMeasurement(index, 'location', event.target.value)} /></label>
                  <label><span>Notes</span><input value={item.notes} onChange={(event) => updateMeasurement(index, 'notes', event.target.value)} /></label>
                  <button className="icon-button" type="button" aria-label={`Remove measurement ${index + 1}`} disabled={measurements.length === 1} onClick={() => setMeasurements((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>

            <div className="site-survey-notes-grid">
              {[
                ['assumptions', 'Assumptions'],
                ['exclusions', 'Exclusions'],
                ['constraints', 'Constraints'],
                ['utilities', 'Utilities'],
                ['hazards', 'Hazards'],
                ['clientDecisions', 'Client decisions'],
              ].map(([key, label]) => (
                <label key={key}><span>{label}</span><textarea rows={3} value={completion[key]} onChange={(event) => setCompletion({ ...completion, [key]: event.target.value })} /></label>
              ))}
            </div>
            <div className="site-survey-submit-row">
              <span><ShieldCheck size={15} /> Office approval required</span>
              <button className="primary-button" type="submit" disabled={submitting || !completionReady}>
                {submitting ? <LoaderCircle className="spin" size={15} /> : <ClipboardCheck size={15} />} Submit survey
              </button>
            </div>
          </form>
        </>
      ) : null}

      {pendingSurvey ? (
        <div className="site-survey-band site-survey-pending">
          <div className="site-survey-band-heading">
            <ShieldCheck size={16} />
            <div><h4>Office review pending</h4><p>Source and snapshot checks retained</p></div>
          </div>
          <div className="site-survey-pending-copy">
            <strong>{pendingSurvey.snapshot?.readiness?.estimateReady ? 'Estimating ready after approval' : 'Critical blockers retained'}</strong>
            <span>{pendingSurvey.snapshot?.submission?.measurements?.length || 0} measurements / {pendingSurvey.snapshot?.submission?.evidenceIds?.length || 0} evidence</span>
          </div>
          {canApprove ? (
            <button className="primary-button" type="button" onClick={() => onReviewApproval(pendingSurvey.approvalId)}>
              <ShieldCheck size={15} /> Review approval
            </button>
          ) : null}
        </div>
      ) : null}

      {control.readiness?.estimateReady ? (
        <div className="site-survey-ready">
          <CheckCircle2 size={18} />
          <div><strong>Approved estimating basis</strong><span>Current retained scope, checklist, measurements, and evidence.</span></div>
        </div>
      ) : null}
    </section>
  )
}
