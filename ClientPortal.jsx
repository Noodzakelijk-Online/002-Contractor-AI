import { useEffect, useState } from 'react'
import { CalendarDays, CircleAlert, CircleCheckBig, FileText, HardHat, ListChecks, LoaderCircle, MessageSquareText, Send, ShieldCheck } from 'lucide-react'
import './ClientPortal.css'

function formatPortalDate(value) {
  if (!value) return 'Nog niet gepland'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Nog niet gepland'
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: String(value).includes('T') ? 'short' : undefined
  }).format(date)
}

function formatPortalStatus(value, fallback = 'in behandeling') {
  return String(value || fallback).replace(/_/g, ' ')
}

function createResponseId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  return `response-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function emptySelectionDraft(selection) {
  return {
    decision: '',
    selectedOption: selection.options?.[0] || '',
    note: '',
    responseId: createResponseId()
  }
}

function PortalList({ items, empty, render }) {
  if (!items?.length) return <p className="client-portal-empty">{empty}</p>
  return <ul className="client-portal-list">{items.map((item, index) => <li key={item.id || `${index}-${render(item)}`}>{render(item)}</li>)}</ul>
}

function SelectionResponseState({ response }) {
  if (!response) return null
  const recorded = response.status === 'recorded'
  const pending = response.status === 'pending_review'
  return <div className={`client-selection-response client-selection-response-${response.status}`} role="status">
    {recorded ? <CircleCheckBig size={18} /> : <CircleAlert size={18} />}
    <div>
      <strong>{recorded ? 'Reactie verwerkt' : pending ? 'Wacht op interne controle' : 'Reactie kan opnieuw worden ingediend'}</strong>
      <span>{response.decision === 'accepted'
        ? `Keuze: ${response.selectedOption || 'bevestigd'}`
        : response.note || 'Uw verzoek om aanpassing is vastgelegd.'}</span>
    </div>
  </div>
}

function ClientSelection({ selection, draft, result, submitting, onDraftChange, onSubmit }) {
  return <article className="client-portal-selection">
    <div className="client-selection-heading">
      <div><h3>{selection.title || 'Projectkeuze'}</h3><p>{selection.dueAt ? `Reageer uiterlijk ${formatPortalDate(selection.dueAt)}` : 'Geen reactiedatum ingesteld'}</p></div>
      <span className={`client-selection-status client-selection-status-${selection.status}`}>{formatPortalStatus(selection.status, 'open')}</span>
    </div>
    {selection.options?.length ? <div className="client-selection-options" aria-label="Beschikbare opties">{selection.options.map(option => <span key={option}>{option}</span>)}</div> : null}
    {selection.selectedOption && !selection.responseAllowed ? <p className="client-selection-confirmed"><strong>Vastgelegde keuze:</strong> {selection.selectedOption}</p> : null}
    <SelectionResponseState response={selection.response} />
    {selection.responseAllowed && draft ? <form className="client-selection-form" onSubmit={event => onSubmit(event, selection)}>
      <fieldset>
        <legend>Uw reactie</legend>
        <label><input type="radio" name={`decision-${selection.id}`} value="accepted" checked={draft.decision === 'accepted'} onChange={event => onDraftChange(selection.id, { decision: event.target.value })} />Ik bevestig deze keuze</label>
        <label><input type="radio" name={`decision-${selection.id}`} value="changes_requested" checked={draft.decision === 'changes_requested'} onChange={event => onDraftChange(selection.id, { decision: event.target.value })} />Ik wil een aanpassing</label>
      </fieldset>
      {draft.decision === 'accepted' && selection.options?.length ? <label>Gekozen optie<select required aria-label={`Gekozen optie voor ${selection.title}`} value={draft.selectedOption} onChange={event => onDraftChange(selection.id, { selectedOption: event.target.value })}>{selection.options.map(option => <option key={option} value={option}>{option}</option>)}</select></label> : null}
      <label>{draft.decision === 'changes_requested' ? 'Welke aanpassing wilt u?' : 'Toelichting (optioneel)'}<textarea required={draft.decision === 'changes_requested'} maxLength="2000" value={draft.note} onChange={event => onDraftChange(selection.id, { note: event.target.value })} /></label>
      <p className="client-portal-note">Uw reactie wordt eerst intern gecontroleerd. Hiermee wijzigt u geen prijs, planning, opdracht of bestelling.</p>
      <div className="client-portal-submit"><button type="submit" disabled={submitting || !draft.decision || (draft.decision === 'changes_requested' && !draft.note.trim())}><ShieldCheck size={16} />{submitting ? 'Indienen...' : 'Ter beoordeling indienen'}</button><span aria-live="polite">{result}</span></div>
    </form> : null}
  </article>
}

export default function ClientPortal() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '')
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
    document.title = 'Contractor.AI - Uw project'
    robots.content = 'noindex, nofollow'
    return () => {
      document.title = previousTitle
      if (createdRobots) robots.remove()
      else robots.content = previousRobots
    }
  }, [])

  useEffect(() => {
    if (token.length < 32) {
      setError('Deze projectlink is ongeldig of verlopen. Vraag om een nieuwe link.')
      setLoading(false)
      return undefined
    }

    const controller = new AbortController()
    const loadPortal = async () => {
      try {
        const response = await fetch(`/api/client-portal/${encodeURIComponent(token)}`, { signal: controller.signal })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.error?.message || 'Deze projectlink is niet beschikbaar.')
        setJob(payload.job)
        setSelectionDrafts(Object.fromEntries((payload.job?.selections || [])
          .filter(selection => selection.responseAllowed)
          .map(selection => [selection.id, emptySelectionDraft(selection)])))
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setError(requestError.message || 'Deze projectlink is niet beschikbaar.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    loadPortal()
    return () => controller.abort()
  }, [token])

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
    setSelectionResults(current => ({ ...current, [selection.id]: 'Uw reactie wordt opgeslagen...' }))
    try {
      const response = await fetch(`/api/client-portal/${encodeURIComponent(token)}/selections/${encodeURIComponent(selection.id)}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || 'Uw reactie kon niet worden opgeslagen.')
      setJob(current => ({
        ...current,
        selections: current.selections.map(item => item.id === selection.id
          ? { ...item, responseAllowed: false, response: { ...payload.response, status: 'pending_review' } }
          : item)
      }))
      setSelectionResults(current => ({ ...current, [selection.id]: 'Uw reactie wacht op interne controle.' }))
    } catch (requestError) {
      setSelectionResults(current => ({ ...current, [selection.id]: requestError.message || 'Uw reactie kon niet worden opgeslagen.' }))
    } finally {
      setSelectionSubmitting('')
    }
  }

  async function submitMessage(event) {
    event.preventDefault()
    if (!body.trim() || submitting) return
    setSubmitting(true)
    setMessageResult('Bericht wordt opgeslagen...')
    try {
      const response = await fetch(`/api/client-portal/${encodeURIComponent(token)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim() })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error?.message || 'Bericht kon niet worden opgeslagen.')
      setBody('')
      setMessageResult('Uw bericht is toegevoegd aan het projectdossier.')
    } catch (requestError) {
      setMessageResult(requestError.message || 'Bericht kon niet worden opgeslagen.')
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="client-portal-shell">
    <header className="client-portal-header">
      <div><span className="client-portal-mark"><HardHat size={19} /></span><strong>Contractor.AI</strong></div>
      <p><ShieldCheck size={15} />Veilige projectinzage</p>
    </header>
    <main className="client-portal-main">
      {loading ? <div className="client-portal-state" role="status"><LoaderCircle className="spin" size={24} />Uw project wordt geladen...</div> : null}
      {!loading && error ? <div className="client-portal-state client-portal-error" role="alert"><ShieldCheck size={22} /><div><strong>Projectlink niet beschikbaar</strong><p>{error}</p></div></div> : null}
      {!loading && !error && job ? <>
        <section className="client-portal-intro" aria-labelledby="client-project-title">
          <div>
            <span className="client-portal-kicker">Uw project</span>
            <h1 id="client-project-title">{job.title || 'Uw project'}</h1>
            <p>{job.description || 'Projectinformatie wordt bijgewerkt.'}</p>
          </div>
          <span className="client-portal-status">{formatPortalStatus(job.status)}</span>
        </section>

        <section className="client-portal-facts" aria-label="Projectoverzicht">
          <div><span>Werkadres</span><strong>{job.address || 'Wordt bevestigd'}</strong></div>
          <div><span>Voortgang</span><strong>{Math.round(Number(job.progressPercent || 0))}%</strong></div>
          <div><span>Gepland</span><strong>{job.scheduledStart ? `${formatPortalDate(job.scheduledStart)}${job.scheduledEnd ? ` tot ${formatPortalDate(job.scheduledEnd)}` : ''}` : 'Nog niet gepland'}</strong></div>
          <div><span>Verwachte afronding</span><strong>{formatPortalDate(job.targetCompletion)}</strong></div>
        </section>

        <div className="client-portal-grid">
          <section className="client-portal-panel">
            <div className="client-portal-panel-title"><CalendarDays size={18} /><h2>Afspraken</h2></div>
            <PortalList items={job.siteVisits} empty="Nog geen afspraak gepland." render={item => `${item.visitType || 'Afspraak'}: ${formatPortalStatus(item.status, 'gepland')} - ${formatPortalDate(item.scheduledAt)}`} />
          </section>
          <section className="client-portal-panel">
            <div className="client-portal-panel-title"><ListChecks size={18} /><h2>Besluitvorming</h2></div>
            <p className="client-portal-note">Open keuzes kunnen hieronder worden bevestigd of teruggestuurd voor aanpassing.</p>
          </section>
          <section className="client-portal-panel client-portal-wide client-portal-selections">
            <div className="client-portal-panel-title"><ShieldCheck size={18} /><h2>Projectkeuzes</h2></div>
            {job.selections?.length ? job.selections.map(selection => <ClientSelection
              key={selection.id}
              selection={selection}
              draft={selectionDrafts[selection.id]}
              result={selectionResults[selection.id] || ''}
              submitting={selectionSubmitting === selection.id}
              onDraftChange={updateSelectionDraft}
              onSubmit={submitSelectionResponse}
            />) : <p className="client-portal-empty">Er staan geen keuzes open.</p>}
          </section>
          <section className="client-portal-panel client-portal-wide">
            <div className="client-portal-panel-title"><MessageSquareText size={18} /><h2>Projectupdates</h2></div>
            <PortalList items={job.updates} empty="Er zijn nog geen gepubliceerde projectupdates." render={item => `${item.subject || 'Projectupdate'}: ${item.body || ''}`} />
          </section>
          <section className="client-portal-panel client-portal-wide">
            <div className="client-portal-panel-title"><FileText size={18} /><h2>Beschikbare documenten</h2></div>
            <PortalList items={job.documents} empty="Er zijn nog geen documenten beschikbaar." render={item => `${item.title || 'Document'} (${item.type || 'document'})`} />
          </section>
          <section className="client-portal-panel client-portal-wide">
            <div className="client-portal-panel-title"><MessageSquareText size={18} /><h2>Stuur een bericht</h2></div>
            <p className="client-portal-note">Uw bericht komt als verzoek in het projectdossier. Het bevestigt geen prijs, planning, extra werk of veiligheid.</p>
            <form className="client-portal-form" onSubmit={submitMessage}>
              <label>Onderwerp<input maxLength="240" required value={subject} onChange={event => setSubject(event.target.value)} /></label>
              <label>Bericht<textarea maxLength="5000" required value={body} onChange={event => setBody(event.target.value)} /></label>
              <div className="client-portal-submit"><button type="submit" disabled={submitting || !body.trim()}><Send size={16} />{submitting ? 'Opslaan...' : 'Verstuur bericht'}</button><span role="status" aria-live="polite">{messageResult}</span></div>
            </form>
          </section>
        </div>
      </> : null}
    </main>
  </div>
}
