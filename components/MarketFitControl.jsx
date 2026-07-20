import { useMemo, useState } from 'react'
import { Check, ChevronRight, Plus, Save, ShieldCheck, Target, TriangleAlert, X } from 'lucide-react'
import { formatStatus } from '../dashboard-format'
import Empty from './EmptyState'

const emptyArea = () => ({ label: '', country: 'NL', postalPrefixes: '', cities: '', priority: 'primary', maxTravelMinutes: '' })

function initialDraft(profile = null) {
  const policy = profile?.snapshot?.policy || {}
  return {
    profileName: profile?.profileName ? `${profile.profileName} revision` : '',
    services: (policy.services || []).join('\n'),
    clientSegments: (policy.clientSegments || []).join('\n'),
    sourceChannels: (policy.sourceChannels || []).join('\n'),
    minJobValue: String(policy.minJobValue ?? ''),
    maxJobValue: String(policy.maxJobValue ?? ''),
    fitThreshold: String(policy.fitThreshold ?? 70),
    allowUnlistedServices: policy.allowUnlistedServices === true,
    allowOutOfArea: policy.allowOutOfArea === true,
    serviceAreas: policy.serviceAreas?.length
      ? policy.serviceAreas.map((area) => ({
          label: area.label || '',
          country: (area.countries || ['NL']).join(', '),
          postalPrefixes: (area.postalPrefixes || []).join(', '),
          cities: (area.cities || []).join(', '),
          priority: area.priority || 'primary',
          maxTravelMinutes: area.maxTravelMinutes == null ? '' : String(area.maxTravelMinutes),
        }))
      : [emptyArea()],
    reason: '',
  }
}

const splitValues = (value) => String(value || '').split(/[\n,;]/).map((item) => item.trim()).filter(Boolean)

function Recommendation({ value, score }) {
  const Icon = value === 'pursue' ? Check : value === 'decline' ? TriangleAlert : Target
  return (
    <span className={`market-fit-recommendation market-fit-${value || 'review'}`}>
      <Icon size={13} /> {formatStatus(value || 'review')} {score !== null && score !== undefined && Number.isFinite(Number(score)) ? `${score}%` : ''}
    </span>
  )
}

export default function MarketFitControl({ marketFit, canManagePolicy, canCoordinate, submitting, onRequestPolicy, onRetainAssessment }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => initialDraft(marketFit?.policy?.activeProfile))
  const activeProfile = marketFit?.policy?.activeProfile || null
  const pending = marketFit?.policy?.pendingProfiles || []
  const rows = useMemo(
    () => (marketFit?.opportunities || []).filter((item) => !['won', 'lost', 'archived'].includes(item.opportunity?.stage)),
    [marketFit],
  )
  const summary = marketFit?.summary || {}

  function openEditor() {
    setDraft(initialDraft(activeProfile))
    setEditing(true)
  }

  function updateArea(index, patch) {
    setDraft((current) => ({
      ...current,
      serviceAreas: current.serviceAreas.map((area, areaIndex) => (areaIndex === index ? { ...area, ...patch } : area)),
    }))
  }

  function submit(event) {
    event.preventDefault()
    onRequestPolicy({
      profileName: draft.profileName,
      services: splitValues(draft.services),
      clientSegments: splitValues(draft.clientSegments),
      sourceChannels: splitValues(draft.sourceChannels),
      minJobValue: Number(draft.minJobValue || 0),
      maxJobValue: Number(draft.maxJobValue || 0),
      fitThreshold: Number(draft.fitThreshold || 0),
      allowUnlistedServices: draft.allowUnlistedServices,
      allowOutOfArea: draft.allowOutOfArea,
      serviceAreas: draft.serviceAreas.map((area) => ({
        label: area.label,
        countries: splitValues(area.country),
        postalPrefixes: splitValues(area.postalPrefixes),
        cities: splitValues(area.cities),
        priority: area.priority,
        maxTravelMinutes: area.maxTravelMinutes === '' ? null : Number(area.maxTravelMinutes),
      })),
      reason: draft.reason,
      entryKey: `market-fit:${Date.now()}`,
    }).then((result) => { if (result) setEditing(false) })
  }

  return (
    <section className="panel market-fit-control" data-testid="market-fit-control">
      <div className="panel-heading market-fit-heading">
        <div>
          <p className="eyebrow">Governed qualification</p>
          <h2>Ideal customer and service area</h2>
          <p>{activeProfile ? `${activeProfile.profileName} / policy v${activeProfile.versionNumber}` : 'No approved qualification policy'}</p>
        </div>
        <div className="market-fit-heading-actions">
          {pending.length ? <span className="tag tag-amber">{pending.length} pending approval</span> : null}
          {canManagePolicy ? (
            <button className="secondary-button" type="button" onClick={openEditor} disabled={submitting || pending.length > 0}>
              <ShieldCheck size={15} /> {activeProfile ? 'Revise policy' : 'Configure policy'}
            </button>
          ) : null}
        </div>
      </div>

      {activeProfile ? (
        <>
          <div className="market-fit-summary" aria-label="Opportunity fit summary">
            <div><span>Open</span><strong>{summary.open || 0}</strong></div>
            <div><span>Pursue</span><strong>{summary.pursue || 0}</strong></div>
            <div><span>Review</span><strong>{summary.review || 0}</strong></div>
            <div><span>Outside policy</span><strong>{summary.decline || 0}</strong></div>
            <div><span>Missing or stale</span><strong>{summary.missingOrStale || 0}</strong></div>
          </div>
          {rows.length ? (
            <div className="market-fit-list">
              {rows.map(({ opportunity, evaluation, retained, stale }) => (
                <div className="market-fit-row" key={opportunity.id}>
                  <div className="market-fit-opportunity">
                    <strong>{opportunity.title}</strong>
                    <small>{opportunity.client?.name || 'Client pending'} / {opportunity.service || 'Service missing'} / {opportunity.city || opportunity.postalCode || 'Area missing'}</small>
                  </div>
                  <Recommendation value={evaluation.recommendation} score={evaluation.score} />
                  <div className="market-fit-evidence">
                    {(evaluation.criteria || []).map((criterion) => (
                      <span key={criterion.key} className={`market-fit-criterion criterion-${criterion.status}`} title={criterion.explanation}>
                        {criterion.status === 'match' ? <Check size={12} /> : <TriangleAlert size={12} />}
                        {criterion.label}
                      </span>
                    ))}
                  </div>
                  <div className="market-fit-row-action">
                    {retained && !stale ? <span className="tag tag-green">Retained</span> : stale ? <span className="tag tag-amber">Stale</span> : <span className="tag">Not retained</span>}
                    {canCoordinate && (!retained || stale) ? (
                      <button className="secondary-button" type="button" disabled={submitting} onClick={() => onRetainAssessment(opportunity.id, evaluation.sourceHash)}>
                        <Save size={14} /> Retain
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="No open opportunities" detail="New retained opportunities will be assessed against the approved policy." />
          )}
        </>
      ) : (
        <Empty title="Qualification policy required" detail="An owner must request an ICP and service-area matrix, then an approver must activate it." />
      )}

      {editing ? (
        <div className="market-fit-editor-wrap">
          <form className="market-fit-editor" onSubmit={submit}>
            <div className="panel-heading">
              <div><h3>Policy revision</h3><p>All criteria become active only after approval.</p></div>
              <button className="icon-button" type="button" aria-label="Close market-fit policy editor" onClick={() => setEditing(false)}><X size={16} /></button>
            </div>
            <div className="form-grid market-fit-form-grid">
              <label className="form-span">Profile name<input autoFocus required minLength="2" maxLength="120" value={draft.profileName} onChange={(event) => setDraft({ ...draft, profileName: event.target.value })} /></label>
              <label>Services<textarea required value={draft.services} onChange={(event) => setDraft({ ...draft, services: event.target.value })} placeholder="Renovation&#10;Maintenance" /></label>
              <label>Client segments<textarea required value={draft.clientSegments} onChange={(event) => setDraft({ ...draft, clientSegments: event.target.value })} placeholder="Homeowner&#10;Housing association" /></label>
              <label>Lead sources<textarea required value={draft.sourceChannels} onChange={(event) => setDraft({ ...draft, sourceChannels: event.target.value })} placeholder="Referral&#10;Existing client" /></label>
              <label>Minimum job value<input required type="number" min="0" step="0.01" value={draft.minJobValue} onChange={(event) => setDraft({ ...draft, minJobValue: event.target.value })} /></label>
              <label>Maximum job value<input required type="number" min="1" step="0.01" value={draft.maxJobValue} onChange={(event) => setDraft({ ...draft, maxJobValue: event.target.value })} /></label>
              <label>Fit threshold<input required type="number" min="0" max="100" step="1" value={draft.fitThreshold} onChange={(event) => setDraft({ ...draft, fitThreshold: event.target.value })} /></label>
            </div>
            <div className="market-fit-policy-flags">
              <label><input type="checkbox" checked={draft.allowUnlistedServices} onChange={(event) => setDraft({ ...draft, allowUnlistedServices: event.target.checked })} /> Permit unlisted services</label>
              <label><input type="checkbox" checked={draft.allowOutOfArea} onChange={(event) => setDraft({ ...draft, allowOutOfArea: event.target.checked })} /> Permit out-of-area work</label>
            </div>
            <div className="market-fit-area-heading">
              <div><h4>Service-area matrix</h4><p>Country plus postal prefixes and/or exact cities.</p></div>
              <button className="secondary-button" type="button" onClick={() => setDraft({ ...draft, serviceAreas: [...draft.serviceAreas, emptyArea()] })}><Plus size={14} /> Area</button>
            </div>
            <div className="market-fit-area-list">
              {draft.serviceAreas.map((area, index) => (
                <div className="market-fit-area-row" key={index}>
                  <label>Area<input required value={area.label} onChange={(event) => updateArea(index, { label: event.target.value })} placeholder="Arnhem core" /></label>
                  <label>Country<input required value={area.country} onChange={(event) => updateArea(index, { country: event.target.value })} placeholder="NL" /></label>
                  <label>Postal prefixes<input value={area.postalPrefixes} onChange={(event) => updateArea(index, { postalPrefixes: event.target.value })} placeholder="68, 69" /></label>
                  <label>Cities<input value={area.cities} onChange={(event) => updateArea(index, { cities: event.target.value })} placeholder="Arnhem, Elst" /></label>
                  <label>Priority<select value={area.priority} onChange={(event) => updateArea(index, { priority: event.target.value })}><option value="primary">Primary</option><option value="secondary">Secondary</option><option value="exception">Exception</option></select></label>
                  <label>Travel minutes<input type="number" min="0" max="480" value={area.maxTravelMinutes} onChange={(event) => updateArea(index, { maxTravelMinutes: event.target.value })} /></label>
                  {draft.serviceAreas.length > 1 ? <button className="icon-button" type="button" aria-label={`Remove service area ${index + 1}`} onClick={() => setDraft({ ...draft, serviceAreas: draft.serviceAreas.filter((_, areaIndex) => areaIndex !== index) })}><X size={15} /></button> : null}
                </div>
              ))}
            </div>
            <label className="market-fit-reason">Revision reason<textarea required minLength="8" maxLength="500" value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} placeholder="Record the commercial decision and supporting evidence." /></label>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setEditing(false)}>Cancel</button>
              <button className="primary-button" disabled={submitting || draft.reason.trim().length < 8}><ChevronRight size={15} /> Request approval</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  )
}
