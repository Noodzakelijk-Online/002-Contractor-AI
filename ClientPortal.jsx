import { useEffect, useState } from 'react'
import { CalendarDays, CircleAlert, CircleCheckBig, Download, FileSignature, FileText, HardHat, ListChecks, LoaderCircle, MessageSquareText, Send, ShieldCheck, Star } from 'lucide-react'
import { draftScopeFingerprint, useSessionDraftRecovery } from './draft-recovery'
import { DEFAULT_PORTAL_LOCALE, normalizeLocale, portalText, SUPPORTED_LOCALES } from './locale'
import './ClientPortal.css'

function formatPortalDate(value, locale) {
  if (!value) return portalText(locale, 'Nog niet gepland')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return portalText(locale, 'Nog niet gepland')
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: String(value).includes('T') ? 'short' : undefined
  }).format(date)
}

const PORTAL_STATUS_LABELS = {
  'nl-NL': {
    active: 'actief', approved: 'goedgekeurd', changes_requested: 'aanpassing gevraagd', completed: 'afgerond',
    in_progress: 'in uitvoering', issued: 'uitgegeven', open: 'open', pending: 'in behandeling',
    pending_client: 'wacht op klant', pending_review: 'wacht op controle', planned: 'gepland', recorded: 'verwerkt',
    rejected: 'afgewezen', rejected_by_client: 'afgewezen door klant', scheduled: 'gepland'
  }
}

function formatPortalStatus(value, locale, fallback = 'in behandeling') {
  const status = String(value || fallback).toLowerCase().replace(/[ -]+/g, '_')
  return PORTAL_STATUS_LABELS[locale]?.[status] || status.replace(/_/g, ' ')
}

function createResponseId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  return `response-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function formatPortalMoney(value, currency = 'EUR', locale = DEFAULT_PORTAL_LOCALE) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(value || 0))
  } catch {
    return `${Number(value || 0).toFixed(2)} ${currency}`
  }
}

function emptySelectionDraft(selection) {
  return {
    decision: '',
    selectedOption: selection.options?.[0] || '',
    note: '',
    responseId: createResponseId()
  }
}

function emptyVariationDraft() {
  return {
    decision: '',
    signerName: '',
    authorityConfirmed: false,
    note: '',
    responseId: createResponseId()
  }
}

function emptyFeedbackDraft() {
  return {
    npsScore: '',
    csatScore: '',
    effortScore: '',
    comment: '',
    followUpConsent: false,
    testimonialConsent: false,
    responseId: createResponseId()
  }
}

function PortalList({ items, empty, render }) {
  if (!items?.length) return <p className="client-portal-empty">{empty}</p>
  return <ul className="client-portal-list">{items.map((item, index) => <li key={item.id || `${index}-${render(item)}`}>{render(item)}</li>)}</ul>
}

function SelectionResponseState({ response, t }) {
  if (!response) return null
  const recorded = response.status === 'recorded'
  const pending = response.status === 'pending_review'
  return <div className={`client-selection-response client-selection-response-${response.status}`} role="status">
    {recorded ? <CircleCheckBig size={18} /> : <CircleAlert size={18} />}
    <div>
      <strong>{recorded ? t('Reactie verwerkt') : pending ? t('Wacht op interne controle') : t('Reactie kan opnieuw worden ingediend')}</strong>
      <span>{response.decision === 'accepted'
        ? `${t('Keuze')}: ${response.selectedOption || t('bevestigd')}`
        : response.note || t('Uw verzoek om aanpassing is vastgelegd.')}</span>
    </div>
  </div>
}

function ClientSelection({ selection, draft, result, submitting, onDraftChange, onSubmit, locale, t }) {
  return <article className="client-portal-selection">
    <div className="client-selection-heading">
      <div><h3>{selection.title || t('Projectkeuze')}</h3><p>{selection.dueAt ? t('Reageer uiterlijk {date}', { date: formatPortalDate(selection.dueAt, locale) }) : t('Geen reactiedatum ingesteld')}</p></div>
      <span className={`client-selection-status client-selection-status-${selection.status}`}>{formatPortalStatus(selection.status, locale, 'open')}</span>
    </div>
    {selection.options?.length ? <div className="client-selection-options" aria-label={t('Beschikbare opties')}>{selection.options.map(option => <span key={option}>{option}</span>)}</div> : null}
    {selection.selectedOption && !selection.responseAllowed ? <p className="client-selection-confirmed"><strong>{t('Vastgelegde keuze:')}</strong> {selection.selectedOption}</p> : null}
    <SelectionResponseState response={selection.response} t={t} />
    {selection.responseAllowed && draft ? <form className="client-selection-form" onSubmit={event => onSubmit(event, selection)}>
      <fieldset>
        <legend>{t('Uw reactie')}</legend>
        <label><input type="radio" name={`decision-${selection.id}`} value="accepted" checked={draft.decision === 'accepted'} onChange={event => onDraftChange(selection.id, { decision: event.target.value })} />{t('Ik bevestig deze keuze')}</label>
        <label><input type="radio" name={`decision-${selection.id}`} value="changes_requested" checked={draft.decision === 'changes_requested'} onChange={event => onDraftChange(selection.id, { decision: event.target.value })} />{t('Ik wil een aanpassing')}</label>
      </fieldset>
      {draft.decision === 'accepted' && selection.options?.length ? <label>{t('Gekozen optie')}<select required aria-label={t('Gekozen optie voor {title}', { title: selection.title })} value={draft.selectedOption} onChange={event => onDraftChange(selection.id, { selectedOption: event.target.value })}>{selection.options.map(option => <option key={option} value={option}>{option}</option>)}</select></label> : null}
      <label>{draft.decision === 'changes_requested' ? t('Welke aanpassing wilt u?') : t('Toelichting (optioneel)')}<textarea required={draft.decision === 'changes_requested'} maxLength="2000" value={draft.note} onChange={event => onDraftChange(selection.id, { note: event.target.value })} /></label>
      <p className="client-portal-note">{t('Uw reactie wordt eerst intern gecontroleerd. Hiermee wijzigt u geen prijs, planning, opdracht of bestelling.')}</p>
      <div className="client-portal-submit"><button type="submit" disabled={submitting || !draft.decision || (draft.decision === 'changes_requested' && !draft.note.trim())}><ShieldCheck size={16} />{submitting ? t('Indienen...') : t('Ter beoordeling indienen')}</button><span aria-live="polite">{result}</span></div>
    </form> : null}
  </article>
}

function VariationResponseState({ response, t }) {
  if (!response) return null
  const recorded = response.status === 'recorded'
  const pending = response.status === 'pending_review'
  const label = response.decision === 'accepted'
    ? t('Akkoord geregistreerd')
    : response.decision === 'changes_requested'
      ? t('Aanpassing gevraagd')
      : t('Voorstel afgewezen')
  return <div className={`client-selection-response client-selection-response-${response.status}`} role="status">
    {recorded ? <CircleCheckBig size={18} /> : <CircleAlert size={18} />}
    <div>
      <strong>{pending ? t('Wacht op interne verificatie') : recorded ? label : t('Reactie kan opnieuw worden ingediend')}</strong>
      <span>{response.note || (response.signerName ? t('Ondertekend door {name}', { name: response.signerName }) : t('Uw reactie is vastgelegd.'))}</span>
    </div>
  </div>
}

function ClientVariation({ variation, token, draft, result, submitting, onDraftChange, onSubmit, locale, t }) {
  const identity = `${variation.variationNumber || t('Variatie')} / R${variation.revisionNumber || 1}`
  const responseDueAt = variation.formalControl?.responseDueAt
  return <article className="client-portal-selection client-portal-variation">
    <div className="client-selection-heading">
      <div><h3>{identity} - {variation.title}</h3><p>{responseDueAt ? t('Reageer uiterlijk {date}', { date: formatPortalDate(responseDueAt, locale) }) : t('Geen reactiedatum ingesteld')}</p></div>
      <span className={`client-selection-status client-selection-status-${variation.status}`}>{formatPortalStatus(variation.status, locale, 'uitgegeven')}</span>
    </div>
    <p className="client-variation-scope">{variation.scopeDelta}</p>
    <div className="client-variation-facts">
      <span><small>{t('Bedrag incl. btw')}</small><strong>{formatPortalMoney(variation.total, variation.currency, locale)}</strong></span>
      <span><small>{t('Planning')}</small><strong>{Number(variation.scheduleDeltaDays || 0) === 0 ? t('Geen wijziging') : t('{days} kalenderdag(en)', { days: variation.scheduleDeltaDays })}</strong></span>
      <span><small>{t('Type')}</small><strong>{formatPortalStatus(variation.formalControl?.variationType, locale, t('scopewijziging'))}</strong></span>
    </div>
    <a className="client-variation-download" href={`/api/client-portal/${encodeURIComponent(token)}/change-orders/${encodeURIComponent(variation.id)}/package`}><Download size={16} />{t('Download genummerd voorstel')}</a>
    <VariationResponseState response={variation.response} t={t} />
    {result ? <p className="client-variation-result" role="status" aria-live="polite">{result}</p> : null}
    {variation.responseAllowed && draft ? <form className="client-selection-form" onSubmit={event => onSubmit(event, variation)}>
      <fieldset>
        <legend>{t('Uw besluit')}</legend>
        <label><input type="radio" name={`variation-decision-${variation.id}`} value="accepted" checked={draft.decision === 'accepted'} onChange={event => onDraftChange(variation.id, { decision: event.target.value })} />{t('Ik ga akkoord')}</label>
        <label><input type="radio" name={`variation-decision-${variation.id}`} value="changes_requested" checked={draft.decision === 'changes_requested'} onChange={event => onDraftChange(variation.id, { decision: event.target.value })} />{t('Ik vraag een aanpassing')}</label>
        <label><input type="radio" name={`variation-decision-${variation.id}`} value="rejected" checked={draft.decision === 'rejected'} onChange={event => onDraftChange(variation.id, { decision: event.target.value })} />{t('Ik wijs dit voorstel af')}</label>
      </fieldset>
      <div className="client-variation-response-fields">
        {draft.decision === 'accepted' ? <>
          <label>{t('Naam bevoegde ondertekenaar')}<input required maxLength="160" value={draft.signerName} onChange={event => onDraftChange(variation.id, { signerName: event.target.value })} /></label>
          <label className="client-variation-authority"><input type="checkbox" checked={draft.authorityConfirmed} onChange={event => onDraftChange(variation.id, { authorityConfirmed: event.target.checked })} />{t('Ik ben bevoegd om dit voorstel namens de opdrachtgever te accepteren.')}</label>
        </> : null}
        <label>{draft.decision === 'accepted' ? t('Toelichting (optioneel)') : t('Reden en gewenste wijziging')}<textarea required={draft.decision !== 'accepted'} maxLength="2000" value={draft.note} onChange={event => onDraftChange(variation.id, { note: event.target.value })} /></label>
      </div>
      <p className="client-portal-note">{t('Uw besluit wordt eerst intern geverifieerd tegen het genummerde voorstel. Tot die verificatie wijzigt geen contractsom en is het extra werk niet geautoriseerd.')}</p>
      <div className="client-portal-submit"><button type="submit" disabled={submitting || !draft.decision || (draft.decision === 'accepted' && (!draft.signerName.trim() || !draft.authorityConfirmed)) || (draft.decision !== 'accepted' && draft.note.trim().length < 5)}><ShieldCheck size={16} />{submitting ? t('Indienen...') : t('Besluit indienen')}</button></div>
    </form> : null}
  </article>
}

export default function ClientPortal() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '')
  const [locale, setLocale] = useState(DEFAULT_PORTAL_LOCALE)
  const [localeSaving, setLocaleSaving] = useState(false)
  const [localeError, setLocaleError] = useState('')
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [subject, setSubject] = useState('Vraag over mijn project')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [messageResult, setMessageResult] = useState('')
  const [selectionDrafts, setSelectionDrafts] = useState({})
  const [selectionResults, setSelectionResults] = useState({})
  const [selectionSubmitting, setSelectionSubmitting] = useState('')
  const [variationDrafts, setVariationDrafts] = useState({})
  const [variationResults, setVariationResults] = useState({})
  const [variationSubmitting, setVariationSubmitting] = useState('')
  const [feedbackDraft, setFeedbackDraft] = useState(() => emptyFeedbackDraft())
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [feedbackResult, setFeedbackResult] = useState('')
  const portalDraftScope = `client-portal:${draftScopeFingerprint(token)}`
  const portalDraftRecoveryEnabled = token.length >= 32
  const t = (key, variables) => portalText(locale, key, variables)

  useSessionDraftRecovery({ enabled: portalDraftRecoveryEnabled, scope: portalDraftScope, name: 'message-subject', value: subject, setValue: setSubject })
  useSessionDraftRecovery({ enabled: portalDraftRecoveryEnabled, scope: portalDraftScope, name: 'message-body', value: body, setValue: setBody })
  useSessionDraftRecovery({ enabled: portalDraftRecoveryEnabled, scope: portalDraftScope, name: 'selections', value: selectionDrafts, setValue: setSelectionDrafts })
  useSessionDraftRecovery({ enabled: portalDraftRecoveryEnabled, scope: portalDraftScope, name: 'variations', value: variationDrafts, setValue: setVariationDrafts })
  useSessionDraftRecovery({ enabled: portalDraftRecoveryEnabled, scope: portalDraftScope, name: 'feedback', value: feedbackDraft, setValue: setFeedbackDraft })

  useEffect(() => {
    const previousTitle = document.title
    let robots = document.querySelector('meta[name="robots"]')
    const createdRobots = !robots
    if (!robots) {
      robots = document.createElement('meta')
      robots.name = 'robots'
      document.head.append(robots)
    }
    const previousRobots = robots.content
    document.title = `Contractor.AI - ${portalText(locale, 'Uw project')}`
    document.documentElement.lang = locale.slice(0, 2)
    robots.content = 'noindex, nofollow'
    return () => {
      document.title = previousTitle
      if (createdRobots) robots.remove()
      else robots.content = previousRobots
    }
  }, [locale])

  useEffect(() => {
    if (token.length < 32) {
      setError(portalText(DEFAULT_PORTAL_LOCALE, 'Deze projectlink is ongeldig of verlopen. Vraag om een nieuwe link.'))
      setLoading(false)
      return undefined
    }

    const controller = new AbortController()
    const loadPortal = async () => {
      try {
        const response = await fetch(`/api/client-portal/${encodeURIComponent(token)}`, { signal: controller.signal })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.error?.message || portalText(DEFAULT_PORTAL_LOCALE, 'Deze projectlink is niet beschikbaar.'))
        const retainedLocale = normalizeLocale(payload.portal?.locale, DEFAULT_PORTAL_LOCALE)
        setLocale(retainedLocale)
        setSubject(current => current === 'Vraag over mijn project' || current === 'Question about my project'
          ? portalText(retainedLocale, 'Vraag over mijn project')
          : current)
        setJob(payload.job)
        setFeedbackSubmitted(payload.portal?.feedback?.submitted === true)
        setSelectionDrafts(current => Object.fromEntries((payload.job?.selections || [])
          .filter(selection => selection.responseAllowed)
          .map(selection => [selection.id, { ...emptySelectionDraft(selection), ...(current[selection.id] || {}) }])))
        setVariationDrafts(current => Object.fromEntries((payload.job?.variations || [])
          .filter(variation => variation.responseAllowed)
          .map(variation => [variation.id, { ...emptyVariationDraft(), ...(current[variation.id] || {}) }])))
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setError(requestError.message || portalText(DEFAULT_PORTAL_LOCALE, 'Deze projectlink is niet beschikbaar.'))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    loadPortal()
    return () => controller.abort()
  }, [token])

  async function updatePortalLocale(nextLocale) {
    const normalized = normalizeLocale(nextLocale, DEFAULT_PORTAL_LOCALE)
    if (normalized === locale || localeSaving) return
    const previous = locale
    setLocaleError('')
    setLocale(normalized)
    setLocaleSaving(true)
    try {
      const response = await fetch(`/api/client-portal/${encodeURIComponent(token)}/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: normalized })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || portalText(normalized, 'Deze projectlink is niet beschikbaar.'))
    } catch (requestError) {
      setLocale(previous)
      setLocaleError(requestError.message)
    } finally {
      setLocaleSaving(false)
    }
  }

  function updateSelectionDraft(selectionId, patch) {
    setSelectionDrafts(current => ({
      ...current,
      [selectionId]: { ...current[selectionId], ...patch }
    }))
    setSelectionResults(current => ({ ...current, [selectionId]: '' }))
  }

  async function submitSelectionResponse(event, selection) {
    event.preventDefault()
    const draft = selectionDrafts[selection.id]
    if (!draft?.decision || selectionSubmitting) return
    setSelectionSubmitting(selection.id)
    setSelectionResults(current => ({ ...current, [selection.id]: t('Uw reactie wordt opgeslagen...') }))
    try {
      const response = await fetch(`/api/client-portal/${encodeURIComponent(token)}/selections/${encodeURIComponent(selection.id)}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || t('Uw reactie kon niet worden opgeslagen.'))
      setJob(current => ({
        ...current,
        selections: current.selections.map(item => item.id === selection.id
          ? { ...item, responseAllowed: false, response: { ...payload.response, status: 'pending_review' } }
          : item)
      }))
      setSelectionDrafts(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== selection.id)))
      setSelectionResults(current => ({ ...current, [selection.id]: t('Uw reactie wacht op interne controle.') }))
    } catch (requestError) {
      setSelectionResults(current => ({ ...current, [selection.id]: requestError.message || t('Uw reactie kon niet worden opgeslagen.') }))
    } finally {
      setSelectionSubmitting('')
    }
  }

  function updateVariationDraft(changeOrderId, patch) {
    setVariationDrafts(current => ({
      ...current,
      [changeOrderId]: { ...current[changeOrderId], ...patch }
    }))
    setVariationResults(current => ({ ...current, [changeOrderId]: '' }))
  }

  async function submitVariationResponse(event, variation) {
    event.preventDefault()
    const draft = variationDrafts[variation.id]
    if (!draft?.decision || variationSubmitting) return
    setVariationSubmitting(variation.id)
    setVariationResults(current => ({ ...current, [variation.id]: t('Uw besluit wordt veilig opgeslagen...') }))
    try {
      const response = await fetch(`/api/client-portal/${encodeURIComponent(token)}/change-orders/${encodeURIComponent(variation.id)}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || t('Uw besluit kon niet worden opgeslagen.'))
      setJob(current => ({
        ...current,
        variations: current.variations.map(item => item.id === variation.id
          ? { ...item, responseAllowed: false, response: { ...payload.response, status: 'pending_review' } }
          : item)
      }))
      setVariationDrafts(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== variation.id)))
      setVariationResults(current => ({ ...current, [variation.id]: t('Uw besluit wacht op interne verificatie.') }))
    } catch (requestError) {
      setVariationResults(current => ({ ...current, [variation.id]: requestError.message || t('Uw besluit kon niet worden opgeslagen.') }))
    } finally {
      setVariationSubmitting('')
    }
  }

  async function submitMessage(event) {
    event.preventDefault()
    if (!body.trim() || submitting) return
    setSubmitting(true)
    setMessageResult(t('Bericht wordt opgeslagen...'))
    try {
      const response = await fetch(`/api/client-portal/${encodeURIComponent(token)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim() })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || t('Bericht kon niet worden opgeslagen.'))
      setBody('')
      setMessageResult(t('Uw bericht is toegevoegd aan het projectdossier.'))
    } catch (requestError) {
      setMessageResult(requestError.message || t('Bericht kon niet worden opgeslagen.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function submitFeedback(event) {
    event.preventDefault()
    if (feedbackSubmitting || feedbackSubmitted) return
    setFeedbackSubmitting(true)
    setFeedbackResult(t('Uw feedback wordt veilig opgeslagen...'))
    try {
      const response = await fetch(`/api/client-portal/${encodeURIComponent(token)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feedbackDraft)
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || t('Uw feedback kon niet worden opgeslagen.'))
      setFeedbackSubmitted(true)
      setFeedbackDraft(emptyFeedbackDraft())
      setFeedbackResult(t('Bedankt. Uw feedback is toegevoegd aan het projectdossier.'))
    } catch (requestError) {
      setFeedbackResult(requestError.message || t('Uw feedback kon niet worden opgeslagen.'))
    } finally {
      setFeedbackSubmitting(false)
    }
  }

  return <div className="client-portal-shell">
    <header className="client-portal-header">
      <div><span className="client-portal-mark"><HardHat size={19} /></span><strong>Contractor.AI</strong></div>
      <div className="client-portal-header-actions">
        <p><ShieldCheck size={15} />{t('Veilige projectinzage')}</p>
        <label className="client-portal-locale">
          <span className="visually-hidden">{t('Taal')}</span>
          <select aria-label={t('Taal')} value={locale} disabled={localeSaving || loading || !job} onChange={event => updatePortalLocale(event.target.value)}>
            {SUPPORTED_LOCALES.map(option => <option key={option.value} value={option.value}>{option.shortLabel}</option>)}
          </select>
        </label>
        <span className="visually-hidden" role="status" aria-live="polite">{localeError}</span>
      </div>
    </header>
    <main className="client-portal-main">
      {loading ? <div className="client-portal-state" role="status"><LoaderCircle className="spin" size={24} />{t('Uw project wordt geladen...')}</div> : null}
      {!loading && error ? <div className="client-portal-state client-portal-error" role="alert"><ShieldCheck size={22} /><div><strong>{t('Projectlink niet beschikbaar')}</strong><p>{error}</p></div></div> : null}
      {!loading && !error && job ? <>
        <section className="client-portal-intro" aria-labelledby="client-project-title">
          <div>
            <span className="client-portal-kicker">{t('Uw project')}</span>
            <h1 id="client-project-title">{job.title || t('Uw project')}</h1>
            <p>{job.description || t('Projectinformatie wordt bijgewerkt.')}</p>
          </div>
          <span className="client-portal-status">{formatPortalStatus(job.status, locale)}</span>
        </section>

        <section className="client-portal-facts" aria-label={t('Projectoverzicht')}>
          <div><span>{t('Werkadres')}</span><strong>{job.address || t('Wordt bevestigd')}</strong></div>
          <div><span>{t('Voortgang')}</span><strong>{Math.round(Number(job.progressPercent || 0))}%</strong></div>
          <div><span>{t('Gepland')}</span><strong>{job.scheduledStart ? `${formatPortalDate(job.scheduledStart, locale)}${job.scheduledEnd ? ` ${t('tot')} ${formatPortalDate(job.scheduledEnd, locale)}` : ''}` : t('Nog niet gepland')}</strong></div>
          <div><span>{t('Verwachte afronding')}</span><strong>{formatPortalDate(job.targetCompletion, locale)}</strong></div>
        </section>

        <div className="client-portal-grid">
          <section className="client-portal-panel">
            <div className="client-portal-panel-title"><CalendarDays size={18} /><h2>{t('Afspraken')}</h2></div>
            <PortalList items={job.siteVisits} empty={t('Nog geen afspraak gepland.')} render={item => `${item.visitType || t('Afspraak')}: ${formatPortalStatus(item.status, locale, 'gepland')} - ${formatPortalDate(item.scheduledAt, locale)}`} />
          </section>
          <section className="client-portal-panel">
            <div className="client-portal-panel-title"><ListChecks size={18} /><h2>{t('Besluitvorming')}</h2></div>
            <p className="client-portal-note">{t('Open keuzes kunnen hieronder worden bevestigd of teruggestuurd voor aanpassing.')}</p>
          </section>
          <section className="client-portal-panel client-portal-wide client-portal-selections">
            <div className="client-portal-panel-title"><ShieldCheck size={18} /><h2>{t('Projectkeuzes')}</h2></div>
            {job.selections?.length ? job.selections.map(selection => <ClientSelection
              key={selection.id}
              selection={selection}
              draft={selectionDrafts[selection.id]}
              result={selectionResults[selection.id] || ''}
              submitting={selectionSubmitting === selection.id}
              onDraftChange={updateSelectionDraft}
              onSubmit={submitSelectionResponse}
              locale={locale}
              t={t}
            />) : <p className="client-portal-empty">{t('Er staan geen keuzes open.')}</p>}
          </section>
          <section className="client-portal-panel client-portal-wide client-portal-selections">
            <div className="client-portal-panel-title"><FileSignature size={18} /><h2>{t('Meer- en minderwerk')}</h2></div>
            <p className="client-portal-note">{t('Bekijk steeds het genummerde voorstel voordat u akkoord geeft, een wijziging vraagt of het voorstel afwijst.')}</p>
            {job.variations?.length ? job.variations.map(variation => <ClientVariation
              key={variation.id}
              variation={variation}
              token={token}
              draft={variationDrafts[variation.id]}
              result={variationResults[variation.id] || ''}
              submitting={variationSubmitting === variation.id}
              onDraftChange={updateVariationDraft}
              onSubmit={submitVariationResponse}
              locale={locale}
              t={t}
            />) : <p className="client-portal-empty client-portal-section-empty">{t('Er zijn geen uitgegeven voorstellen voor meer- of minderwerk.')}</p>}
          </section>
          <section className="client-portal-panel client-portal-wide">
            <div className="client-portal-panel-title"><MessageSquareText size={18} /><h2>{t('Projectupdates')}</h2></div>
            <PortalList items={job.updates} empty={t('Er zijn nog geen gepubliceerde projectupdates.')} render={item => `${item.subject || t('Projectupdate')}: ${item.body || ''}`} />
          </section>
          <section className="client-portal-panel client-portal-wide">
            <div className="client-portal-panel-title"><FileText size={18} /><h2>{t('Beschikbare documenten')}</h2></div>
            <PortalList items={job.documents} empty={t('Er zijn nog geen documenten beschikbaar.')} render={item => `${item.title || 'Document'} (${item.type || 'document'})`} />
          </section>
          <section className="client-portal-panel client-portal-wide" data-testid="client-feedback-panel">
            <div className="client-portal-panel-title"><Star size={18} /><h2>{t('Uw ervaring')}</h2></div>
            {feedbackSubmitted ? <div className="client-feedback-thanks" role="status"><CircleCheckBig size={20} /><div><strong>{t('Feedback ontvangen')}</strong><p>{feedbackResult || t('Uw eerdere reactie is veilig vastgelegd in het projectdossier.')}</p></div></div> : <>
              <p className="client-portal-note">{t('Met drie korte scores helpt u ons de uitvoering en service te verbeteren. Een reactie wijzigt geen contract, planning of garantie.')}</p>
              <form className="client-portal-form client-feedback-form" onSubmit={submitFeedback}>
                <label>{t('Aanbeveling (0-10)')}<select required aria-label={t('Hoe waarschijnlijk is het dat u ons aanbeveelt?')} value={feedbackDraft.npsScore} onChange={event => setFeedbackDraft(current => ({ ...current, npsScore: Number(event.target.value) }))}><option value="" disabled>{t('Selecteer een score')}</option>{Array.from({ length: 11 }, (_, score) => <option key={score} value={score}>{score}{score === 0 ? ` - ${t('zeer onwaarschijnlijk')}` : score === 10 ? ` - ${t('zeer waarschijnlijk')}` : ''}</option>)}</select></label>
                <label>{t('Tevredenheid (1-5)')}<select required aria-label={t('Hoe tevreden bent u?')} value={feedbackDraft.csatScore} onChange={event => setFeedbackDraft(current => ({ ...current, csatScore: Number(event.target.value) }))}><option value="" disabled>{t('Selecteer een score')}</option>{[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{score}{score === 1 ? ` - ${t('zeer ontevreden')}` : score === 5 ? ` - ${t('zeer tevreden')}` : ''}</option>)}</select></label>
                <label>{t('Gemak (1-5)')}<select required aria-label={t('Hoe gemakkelijk was samenwerken?')} value={feedbackDraft.effortScore} onChange={event => setFeedbackDraft(current => ({ ...current, effortScore: Number(event.target.value) }))}><option value="" disabled>{t('Selecteer een score')}</option>{[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{score}{score === 1 ? ` - ${t('zeer moeilijk')}` : score === 5 ? ` - ${t('zeer gemakkelijk')}` : ''}</option>)}</select></label>
                <label className="client-feedback-comment">{t('Toelichting (optioneel)')}<textarea maxLength="4000" value={feedbackDraft.comment} onChange={event => setFeedbackDraft(current => ({ ...current, comment: event.target.value }))} placeholder={t('Wat ging goed en wat kan beter?')} /></label>
                <label className="client-feedback-consent"><input type="checkbox" checked={feedbackDraft.followUpConsent} onChange={event => setFeedbackDraft(current => ({ ...current, followUpConsent: event.target.checked }))} />{t('U mag contact met mij opnemen over deze feedback.')}</label>
                <label className="client-feedback-consent"><input type="checkbox" checked={feedbackDraft.testimonialConsent} onChange={event => setFeedbackDraft(current => ({ ...current, testimonialConsent: event.target.checked }))} />{t('Mijn reactie mag intern worden beoordeeld voor een mogelijke referentie. Publicatie vraagt altijd aparte afstemming.')}</label>
                <div className="client-portal-submit client-feedback-submit"><button type="submit" disabled={feedbackSubmitting}><ShieldCheck size={16} />{feedbackSubmitting ? t('Opslaan...') : t('Feedback opslaan')}</button><span role="status" aria-live="polite">{feedbackResult}</span></div>
              </form>
            </>}
          </section>
          <section className="client-portal-panel client-portal-wide">
            <div className="client-portal-panel-title"><MessageSquareText size={18} /><h2>{t('Stuur een bericht')}</h2></div>
            <p className="client-portal-note">{t('Uw bericht komt als verzoek in het projectdossier. Het bevestigt geen prijs, planning, extra werk of veiligheid.')}</p>
            <form className="client-portal-form" onSubmit={submitMessage}>
              <label>{t('Onderwerp')}<input maxLength="240" required value={subject} onChange={event => setSubject(event.target.value)} /></label>
              <label>{t('Bericht')}<textarea maxLength="5000" required value={body} onChange={event => setBody(event.target.value)} /></label>
              <div className="client-portal-submit"><button type="submit" disabled={submitting || !body.trim()}><Send size={16} />{submitting ? t('Opslaan...') : t('Verstuur bericht')}</button><span role="status" aria-live="polite">{messageResult}</span></div>
            </form>
          </section>
        </div>
      </> : null}
    </main>
  </div>
}
