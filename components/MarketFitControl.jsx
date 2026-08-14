import { useMemo, useState } from 'react'
import { Check, ChevronRight, Plus, Save, ShieldCheck, Target, TriangleAlert, X } from 'lucide-react'
import { operatorText } from '../operator-locale'
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

function Recommendation({ value, score, t }) {
  const Icon = value === 'pursue' ? Check : value === 'decline' ? TriangleAlert : Target
  return (
    <span className={`market-fit-recommendation market-fit-${value || 'review'}`}>
      <Icon size={13} /> {t(value || 'review')} {score !== null && score !== undefined && Number.isFinite(Number(score)) ? `${score}%` : ''}
    </span>
  )
}

export default function MarketFitControl({ marketFit, canManagePolicy, canCoordinate, submitting, onRequestPolicy, onRetainAssessment, locale = 'en-GB' }) {
  const t = (key, variables) => operatorText(locale, key, variables)
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
          <p className="eyebrow">{t('Governed qualification')}</p>
          <h2>{t('Ideal customer and service area')}</h2>
          <p>{activeProfile ? t('{name} / policy v{version}', { name: activeProfile.profileName, version: activeProfile.versionNumber }) : t('No approved qualification policy')}</p>
        </div>
        <div className="market-fit-heading-actions">
          {pending.length ? <span className="tag tag-amber">{t('{count} pending approval', { count: pending.length })}</span> : null}
          {canManagePolicy ? (
            <button className="secondary-button" type="button" onClick={openEditor} disabled={submitting || pending.length > 0}>
              <ShieldCheck size={15} /> {activeProfile ? t('Revise policy') : t('Configure policy')}
            </button>
          ) : null}
        </div>
      </div>

      {activeProfile ? (
        <>
          <div className="market-fit-summary" aria-label={t('Opportunity fit summary')}>
            <div><span>{t('Open')}</span><strong>{summary.open || 0}</strong></div>
            <div><span>{t('Pursue')}</span><strong>{summary.pursue || 0}</strong></div>
            <div><span>{t('Review')}</span><strong>{summary.review || 0}</strong></div>
            <div><span>{t('Outside policy')}</span><strong>{summary.decline || 0}</strong></div>
            <div><span>{t('Missing or stale')}</span><strong>{summary.missingOrStale || 0}</strong></div>
          </div>
          {rows.length ? (
            <div className="market-fit-list">
              {rows.map(({ opportunity, evaluation, retained, stale }) => (
                <div className="market-fit-row" key={opportunity.id}>
                  <div className="market-fit-opportunity">
                    <strong>{opportunity.title}</strong>
                    <small>{opportunity.client?.name || t('Client pending')} / {opportunity.service || t('Service missing')} / {opportunity.city || opportunity.postalCode || t('Area missing')}</small>
                  </div>
                  <Recommendation value={evaluation.recommendation} score={evaluation.score} t={t} />
                  <div className="market-fit-evidence">
                    {(evaluation.criteria || []).map((criterion) => (
                      <span key={criterion.key} className={`market-fit-criterion criterion-${criterion.status}`} title={criterion.explanation}>
                        {criterion.status === 'match' ? <Check size={12} /> : <TriangleAlert size={12} />}
                        {criterion.label}
                      </span>
                    ))}
                  </div>
                  <div className="market-fit-row-action">
                    {retained && !stale ? <span className="tag tag-green">{t('Retained')}</span> : stale ? <span className="tag tag-amber">{t('Stale')}</span> : <span className="tag">{t('Not retained')}</span>}
                    {canCoordinate && (!retained || stale) ? (
                      <button className="secondary-button" type="button" disabled={submitting} onClick={() => onRetainAssessment(opportunity.id, evaluation.sourceHash)}>
                        <Save size={14} /> {t('Retain')}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty title={t('No open opportunities')} detail={t('New retained opportunities will be assessed against the approved policy.')} />
          )}
        </>
      ) : (
        <Empty title={t('Qualification policy required')} detail={t('An owner must request an ICP and service-area matrix, then an approver must activate it.')} />
      )}

      {editing ? (
        <div className="market-fit-editor-wrap">
          <form className="market-fit-editor" onSubmit={submit}>
            <div className="panel-heading">
              <div><h3>{t('Policy revision')}</h3><p>{t('All criteria become active only after approval.')}</p></div>
              <button className="icon-button" type="button" aria-label={t('Close market-fit policy editor')} onClick={() => setEditing(false)}><X size={16} /></button>
            </div>
            <div className="form-grid market-fit-form-grid">
              <label className="form-span">{t('Profile name')}<input autoFocus required minLength="2" maxLength="120" value={draft.profileName} onChange={(event) => setDraft({ ...draft, profileName: event.target.value })} /></label>
              <label>{t('Services')}<textarea required value={draft.services} onChange={(event) => setDraft({ ...draft, services: event.target.value })} placeholder="Renovation&#10;Maintenance" /></label>
              <label>{t('Client segments')}<textarea required value={draft.clientSegments} onChange={(event) => setDraft({ ...draft, clientSegments: event.target.value })} placeholder="Homeowner&#10;Housing association" /></label>
              <label>{t('Lead sources')}<textarea required value={draft.sourceChannels} onChange={(event) => setDraft({ ...draft, sourceChannels: event.target.value })} placeholder="Referral&#10;Existing client" /></label>
              <label>{t('Minimum job value')}<input required type="number" min="0" step="0.01" value={draft.minJobValue} onChange={(event) => setDraft({ ...draft, minJobValue: event.target.value })} /></label>
              <label>{t('Maximum job value')}<input required type="number" min="1" step="0.01" value={draft.maxJobValue} onChange={(event) => setDraft({ ...draft, maxJobValue: event.target.value })} /></label>
              <label>{t('Fit threshold')}<input required type="number" min="0" max="100" step="1" value={draft.fitThreshold} onChange={(event) => setDraft({ ...draft, fitThreshold: event.target.value })} /></label>
            </div>
            <div className="market-fit-policy-flags">
              <label><input type="checkbox" checked={draft.allowUnlistedServices} onChange={(event) => setDraft({ ...draft, allowUnlistedServices: event.target.checked })} /> {t('Permit unlisted services')}</label>
              <label><input type="checkbox" checked={draft.allowOutOfArea} onChange={(event) => setDraft({ ...draft, allowOutOfArea: event.target.checked })} /> {t('Permit out-of-area work')}</label>
            </div>
            <div className="market-fit-area-heading">
              <div><h4>{t('Service-area matrix')}</h4><p>{t('Country plus postal prefixes and/or exact cities.')}</p></div>
              <button className="secondary-button" type="button" onClick={() => setDraft({ ...draft, serviceAreas: [...draft.serviceAreas, emptyArea()] })}><Plus size={14} /> {t('Area')}</button>
            </div>
            <div className="market-fit-area-list">
              {draft.serviceAreas.map((area, index) => (
                <div className="market-fit-area-row" key={index}>
                  <label>{t('Area')}<input required value={area.label} onChange={(event) => updateArea(index, { label: event.target.value })} placeholder="Arnhem core" /></label>
                  <label>{t('Country')}<input required value={area.country} onChange={(event) => updateArea(index, { country: event.target.value })} placeholder="NL" /></label>
                  <label>{t('Postal prefixes')}<input value={area.postalPrefixes} onChange={(event) => updateArea(index, { postalPrefixes: event.target.value })} placeholder="68, 69" /></label>
                  <label>{t('Cities')}<input value={area.cities} onChange={(event) => updateArea(index, { cities: event.target.value })} placeholder="Arnhem, Elst" /></label>
                  <label>{t('Priority')}<select value={area.priority} onChange={(event) => updateArea(index, { priority: event.target.value })}><option value="primary">{t('Primary')}</option><option value="secondary">{t('Secondary')}</option><option value="exception">{t('Exception')}</option></select></label>
                  <label>{t('Travel minutes')}<input type="number" min="0" max="480" value={area.maxTravelMinutes} onChange={(event) => updateArea(index, { maxTravelMinutes: event.target.value })} /></label>
                  {draft.serviceAreas.length > 1 ? <button className="icon-button" type="button" aria-label={t('Remove service area {number}', { number: index + 1 })} onClick={() => setDraft({ ...draft, serviceAreas: draft.serviceAreas.filter((_, areaIndex) => areaIndex !== index) })}><X size={15} /></button> : null}
                </div>
              ))}
            </div>
            <label className="market-fit-reason">{t('Revision reason')}<textarea required minLength="8" maxLength="500" value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} placeholder={t('Record the commercial decision and supporting evidence.')} /></label>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setEditing(false)}>{t('Cancel')}</button>
              <button className="primary-button" disabled={submitting || draft.reason.trim().length < 8}><ChevronRight size={15} /> {t('Request approval')}</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  )
}
