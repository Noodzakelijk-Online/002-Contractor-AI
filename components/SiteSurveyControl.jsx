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
import { operatorText } from '../operator-locale'
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

function statusLabel(value, t) {
  const translated = t(String(value || 'required').replace(/_/g, ' '))
  return translated.charAt(0).toUpperCase() + translated.slice(1)
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
  locale = 'en-GB',
}) {
  const t = (key, variables) => operatorText(locale, key, variables)
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
            <h3 id="site-survey-heading">{t('Preconstruction site survey')}</h3>
            <p>{template.name || t('Standard preconstruction checklist')} / {t('version {version}', { version: template.version || 1 })}</p>
          </div>
        </div>
        <span className={`site-survey-state site-survey-state-${status}`}>
          {status === 'ready' ? <CheckCircle2 size={14} /> : status === 'stale' ? <TriangleAlert size={14} /> : <ShieldCheck size={14} />}
          {statusLabel(status, t)}
        </span>
      </header>

      {latestSurvey ? (
        <div className="site-survey-summary">
          <div><span>{t('Surveyor')}</span><strong>{latestSurvey.surveyor || t('Unassigned')}</strong></div>
          <div><span>{t('Planned')}</span><strong>{latestSurvey.scheduledAt ? formatReadableDate(latestSurvey.scheduledAt, true) : t('Not set')}</strong></div>
          <div><span>{t('Measurements')}</span><strong>{latestSurvey.snapshot?.submission?.measurements?.length || 0}</strong></div>
          <div><span>{t('Evidence')}</span><strong>{latestSurvey.snapshot?.submission?.evidenceIds?.length || evidence.length}</strong></div>
        </div>
      ) : null}

      {control.readiness?.blockers?.length ? (
        <div className="site-survey-alert site-survey-alert-error">
          <TriangleAlert size={16} />
          <div>
            <strong>{t('Estimating blocked')}</strong>
            {control.readiness.blockers.map((item) => <span key={item.code}>{t(item.message)}</span>)}
          </div>
        </div>
      ) : null}
      {control.stale ? (
        <div className="site-survey-alert site-survey-alert-warning">
          <TriangleAlert size={16} />
          <div><strong>{t('Evidence changed')}</strong><span>{t('Submit a current survey snapshot for approval.')}</span></div>
        </div>
      ) : null}

      {canPlan ? (
        <form className="site-survey-band site-survey-plan" onSubmit={submitPlan}>
          <div className="site-survey-band-heading">
            <CalendarDays size={16} />
            <div><h4>{t('Plan survey')}</h4><p>{t('Internal plan')}</p></div>
          </div>
          <label>
            <span>{t('Date and time')}</span>
            <input type="datetime-local" value={plan.scheduledAt} onChange={(event) => setPlan({ ...plan, scheduledAt: event.target.value })} required />
          </label>
          <label>
            <span>{t('Surveyor')}</span>
            <input value={plan.surveyor} onChange={(event) => setPlan({ ...plan, surveyor: event.target.value })} minLength={2} maxLength={160} required />
          </label>
          <label className="site-survey-wide">
            <span>{t('Planning notes')}</span>
            <input value={plan.notes} onChange={(event) => setPlan({ ...plan, notes: event.target.value })} maxLength={2000} />
          </label>
          <button className="primary-button" type="submit" disabled={submitting || !plan.scheduledAt || plan.surveyor.trim().length < 2}>
            {submitting ? <LoaderCircle className="spin" size={15} /> : <CalendarDays size={15} />} {t('Retain plan')}
          </button>
        </form>
      ) : null}

      {canComplete ? (
        <>
          <form className="site-survey-band site-survey-evidence-upload" onSubmit={uploadEvidence}>
            <div className="site-survey-band-heading">
              <FileUp size={16} />
              <div><h4>{t('Private evidence')}</h4><p>{t('Checksum verified')}</p></div>
            </div>
            <label className="site-survey-file">
              <span>{t('File')}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setSelectedFile(event.target.files?.[0] || null)} />
            </label>
            <button className="secondary-button" type="submit" disabled={submitting || !selectedFile}>
              {submitting ? <LoaderCircle className="spin" size={15} /> : <FileUp size={15} />} {t('Upload')}
            </button>
          </form>

          {evidence.length ? (
            <div className="site-survey-evidence-list" aria-label={t('Retained site survey evidence')}>
              {evidence.map((item) => (
                <label key={item.id}>
                  <input
                    type="checkbox"
                    checked={selectedEvidenceIds.includes(item.id)}
                    onChange={(event) => setSelectedEvidenceIds((current) => (
                      event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id)
                    ))}
                  />
                  <span><strong>{item.title}</strong><small>{item.filename || item.mimeType || t('Evidence')} / {Math.round((item.sizeBytes || 0) / 1024)} KB</small></span>
                   <a href={`/api/ledger/opportunity-evidence/${encodeURIComponent(item.id)}/content`} aria-label={t('Download {title}', { title: item.title })} title={t('Download retained evidence')}>
                    <FileDown size={15} />
                  </a>
                </label>
              ))}
            </div>
          ) : null}

          <form className="site-survey-completion" onSubmit={submitCompletion}>
            <div className="site-survey-completion-heading">
              <div>
                <h4>{t('Complete survey')}</h4>
                <p>{t('{answered}/{total} checklist items / {evidence} evidence selected', { answered, total: template.items.length, evidence: selectedEvidenceIds.length })}</p>
              </div>
              <span className="site-survey-progress" aria-label={t('{answered} of {total} checklist items complete', { answered, total: template.items.length })}>
                <i style={{ width: `${template.items.length ? (answered / template.items.length) * 100 : 0}%` }} />
              </span>
            </div>
            <div className="site-survey-form-grid">
              <label><span>{t('Surveyed at')}</span><input type="datetime-local" value={completion.surveyedAt} onChange={(event) => setCompletion({ ...completion, surveyedAt: event.target.value })} required /></label>
              <label><span>{t('Surveyor')}</span><input value={completion.surveyor} onChange={(event) => setCompletion({ ...completion, surveyor: event.target.value })} required /></label>
              <label className="site-survey-wide"><span>{t('Scope summary')}</span><textarea value={completion.scopeSummary} onChange={(event) => setCompletion({ ...completion, scopeSummary: event.target.value })} rows={3} minLength={8} maxLength={4000} required /></label>
            </div>

            <div className="site-survey-checklist">
              {template.items.map((item, index) => (
                <div className="site-survey-checklist-row" key={item.key}>
                  <span className="site-survey-checklist-number">{String(index + 1).padStart(2, '0')}</span>
                  <div className="site-survey-checklist-copy">
                    <strong>{item.prompt}</strong>
                    <small>{statusLabel(item.category, t)} / {statusLabel(item.failureSeverity, t)}</small>
                  </div>
                  <select
                    aria-label={t('{prompt} result', { prompt: item.prompt })}
                    value={responses[item.key]?.result || ''}
                    onChange={(event) => setResponses((current) => ({
                      ...current,
                      [item.key]: { ...current[item.key], result: event.target.value },
                    }))}
                    required
                  >
                    <option value="">{t('Result')}</option>
                    <option value="pass">{t('Pass')}</option>
                    <option value="fail">{t('Fail')}</option>
                    {item.allowNotApplicable ? <option value="not_applicable">{t('Not applicable')}</option> : null}
                  </select>
                  <input
                    aria-label={t('{prompt} notes', { prompt: item.prompt })}
                    value={responses[item.key]?.notes || ''}
                    onChange={(event) => setResponses((current) => ({
                      ...current,
                      [item.key]: { ...current[item.key], notes: event.target.value },
                    }))}
                    placeholder={t('Retained note')}
                    maxLength={2000}
                  />
                </div>
              ))}
            </div>

            <div className="site-survey-measurements">
              <div className="site-survey-section-heading">
                <div><Ruler size={16} /><h4>{t('Measurements')}</h4></div>
                <button className="secondary-button" type="button" onClick={() => setMeasurements((current) => [...current, { label: '', quantity: '', unit: 'm2', location: '', notes: '' }])}>
                  <Plus size={14} /> {t('Add')}
                </button>
              </div>
              {measurements.map((item, index) => (
                <div className="site-survey-measurement-row" key={`measurement-${index}`}>
                  <label><span>{t('Measurement')}</span><input value={item.label} onChange={(event) => updateMeasurement(index, 'label', event.target.value)} required /></label>
                  <label><span>{t('Quantity')}</span><input type="number" min="0.0001" step="0.0001" value={item.quantity} onChange={(event) => updateMeasurement(index, 'quantity', event.target.value)} required /></label>
                  <label><span>{t('Unit')}</span><input value={item.unit} onChange={(event) => updateMeasurement(index, 'unit', event.target.value)} required /></label>
                  <label><span>{t('Location')}</span><input value={item.location} onChange={(event) => updateMeasurement(index, 'location', event.target.value)} /></label>
                  <label><span>{t('Notes')}</span><input value={item.notes} onChange={(event) => updateMeasurement(index, 'notes', event.target.value)} /></label>
                  <button className="icon-button" type="button" aria-label={t('Remove measurement {number}', { number: index + 1 })} disabled={measurements.length === 1} onClick={() => setMeasurements((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
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
                <label key={key}><span>{t(label)}</span><textarea rows={3} value={completion[key]} onChange={(event) => setCompletion({ ...completion, [key]: event.target.value })} /></label>
              ))}
            </div>
            <div className="site-survey-submit-row">
              <span><ShieldCheck size={15} /> {t('Office approval required')}</span>
              <button className="primary-button" type="submit" disabled={submitting || !completionReady}>
                {submitting ? <LoaderCircle className="spin" size={15} /> : <ClipboardCheck size={15} />} {t('Submit survey')}
              </button>
            </div>
          </form>
        </>
      ) : null}

      {pendingSurvey ? (
        <div className="site-survey-band site-survey-pending">
          <div className="site-survey-band-heading">
            <ShieldCheck size={16} />
            <div><h4>{t('Office review pending')}</h4><p>{t('Source and snapshot checks retained')}</p></div>
          </div>
          <div className="site-survey-pending-copy">
            <strong>{pendingSurvey.snapshot?.readiness?.estimateReady ? t('Estimating ready after approval') : t('Critical blockers retained')}</strong>
            <span>{t('{measurements} measurements / {evidence} evidence', { measurements: pendingSurvey.snapshot?.submission?.measurements?.length || 0, evidence: pendingSurvey.snapshot?.submission?.evidenceIds?.length || 0 })}</span>
          </div>
          {canApprove ? (
            <button className="primary-button" type="button" onClick={() => onReviewApproval(pendingSurvey.approvalId)}>
              <ShieldCheck size={15} /> {t('Review approval')}
            </button>
          ) : null}
        </div>
      ) : null}

      {control.readiness?.estimateReady ? (
        <div className="site-survey-ready">
          <CheckCircle2 size={18} />
          <div><strong>{t('Approved estimating basis')}</strong><span>{t('Current retained scope, checklist, measurements, and evidence.')}</span></div>
        </div>
      ) : null}
    </section>
  )
}
