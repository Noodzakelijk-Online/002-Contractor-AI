import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Eye, LoaderCircle, RefreshCw, Search, TriangleAlert, X } from 'lucide-react'
import { formatDateTime, formatStatus, shortHash } from '../dashboard-format'
import { operatorText } from '../operator-locale'
import Empty from './EmptyState'

const EMPTY_AUDIT_HISTORY_FILTERS = Object.freeze({ query: '', entityType: '', action: '', actor: '', from: '', until: '' })

function auditHistoryRequestPath(filters, { beforeSequence = null, includeFacets = false } = {}) {
  const parameters = new URLSearchParams({ limit: '25' })
  for (const [key, value] of Object.entries(filters || {})) {
    if (String(value || '').trim()) parameters.set(key, String(value).trim())
  }
  if (beforeSequence) parameters.set('beforeSequence', String(beforeSequence))
  if (includeFacets) parameters.set('includeFacets', 'true')
  return `/api/ledger/audit?${parameters.toString()}`
}

export default function AuditHistory({ locale = 'en-GB', request, totalEvents = 0 }) {
  const t = (key, variables = {}) => operatorText(locale, key, variables)
  const [filters, setFilters] = useState({ ...EMPTY_AUDIT_HISTORY_FILTERS })
  const [appliedFilters, setAppliedFilters] = useState({ ...EMPTY_AUDIT_HISTORY_FILTERS })
  const [events, setEvents] = useState([])
  const [page, setPage] = useState(null)
  const [facets, setFacets] = useState({ entityTypes: [], actions: [], actors: [] })
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [auditLoading, setAuditLoading] = useState(true)
  const [auditError, setAuditError] = useState('')
  const detailCloseRef = useRef(null)
  const detailOpenerRef = useRef(null)

  async function loadHistory(nextFilters, options = {}) {
    setAuditLoading(true)
    setAuditError('')
    try {
      const result = await request(auditHistoryRequestPath(nextFilters, options))
      setEvents((current) => {
        if (!options.append) return result.events || []
        const retained = new Set(current.map((event) => event.id))
        return [...current, ...(result.events || []).filter((event) => !retained.has(event.id))]
      })
      setPage((current) => {
        const nextPage = result.page || null
        if (!options.append || !nextPage) return nextPage
        return { ...nextPage, newestSequence: current?.newestSequence || nextPage.newestSequence }
      })
      if (result.facets) setFacets(result.facets)
      if (!options.append) setAppliedFilters({ ...nextFilters })
      return true
    } catch (requestError) {
      setAuditError(requestError.message)
      return false
    } finally {
      setAuditLoading(false)
    }
  }

  useEffect(() => {
    let retained = true
    async function initializeAuditHistory() {
      try {
        const result = await request(auditHistoryRequestPath(EMPTY_AUDIT_HISTORY_FILTERS, { includeFacets: true }))
        if (!retained) return
        setEvents(result.events || [])
        setPage(result.page || null)
        setFacets(result.facets || { entityTypes: [], actions: [], actors: [] })
      } catch (requestError) {
        if (retained) setAuditError(requestError.message)
      } finally {
        if (retained) setAuditLoading(false)
      }
    }
    initializeAuditHistory()
    return () => {
      retained = false
    }
  }, [request])

  useEffect(() => {
    if (!selectedEvent) return undefined
    detailCloseRef.current?.focus()
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setSelectedEvent(null)
      window.requestAnimationFrame(() => detailOpenerRef.current?.focus())
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEvent])

  function closeAuditDetail() {
    setSelectedEvent(null)
    window.requestAnimationFrame(() => detailOpenerRef.current?.focus())
  }

  async function applyFilters(event) {
    event.preventDefault()
    await loadHistory(filters)
  }

  async function clearFilters() {
    const empty = { ...EMPTY_AUDIT_HISTORY_FILTERS }
    setFilters(empty)
    await loadHistory(empty)
  }

  const activeFilterCount = Object.values(appliedFilters).filter((value) => String(value || '').trim()).length
  const facetOptions = (items, label) => (
    <>
      <option value="">{t('All {label}', { label: t(label) })}</option>
      {(items || []).map((item) => (
        <option key={item.value} value={item.value}>
          {formatStatus(item.value)} ({item.count})
        </option>
      ))}
    </>
  )

  return (
    <section className="panel page-panel audit-history-panel" data-testid="audit-history-panel" aria-busy={auditLoading || undefined}>
      <div className="panel-heading audit-history-heading">
        <div>
          <h2>{t('Audit history')}</h2>
          <p>{t('Inspect retained operator, automation, approval, and lifecycle evidence in chain order.')}</p>
        </div>
        <div className="audit-history-heading-actions">
          <span className="count-badge">{t('{count} loaded', { count: events.length })}</span>
          <button
            className="icon-button"
            aria-label={t('Refresh audit history')}
            disabled={auditLoading}
            onClick={() => loadHistory(appliedFilters, { includeFacets: true })}
          >
            <RefreshCw size={16} className={auditLoading ? 'spin' : ''} />
          </button>
        </div>
      </div>
      <form className="audit-filter-toolbar" data-testid="audit-history-filters" onSubmit={applyFilters}>
        <label className="search-control audit-search">
          <Search size={16} />
          <span className="visually-hidden">{t('Search audit history')}</span>
          <input
            type="search"
            maxLength="120"
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            placeholder={t('Search action, record, job, or actor')}
          />
        </label>
        <label>
          <span>{t('Record type')}</span>
          <select data-testid="audit-record-type-filter" value={filters.entityType} onChange={(event) => setFilters({ ...filters, entityType: event.target.value })}>
            {facetOptions(facets.entityTypes, 'record types')}
          </select>
        </label>
        <label>
          <span>{t('Action')}</span>
          <select data-testid="audit-action-filter" value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })}>
            {facetOptions(facets.actions, 'actions')}
          </select>
        </label>
        <label>
          <span>{t('Actor')}</span>
          <select value={filters.actor} onChange={(event) => setFilters({ ...filters, actor: event.target.value })}>
            {facetOptions(facets.actors, 'actors')}
          </select>
        </label>
        <label>
          <span>{t('From')}</span>
          <input
            type="date"
            value={filters.from}
            max={filters.until || undefined}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
        </label>
        <label>
          <span>{t('Until')}</span>
          <input
            type="date"
            value={filters.until}
            min={filters.from || undefined}
            onChange={(event) => setFilters({ ...filters, until: event.target.value })}
          />
        </label>
        <div className="audit-filter-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={auditLoading || (!activeFilterCount && !Object.values(filters).some(Boolean))}
            onClick={clearFilters}
          >
            <X size={15} />
            {t('Clear filters')}
          </button>
          <button className="primary-button" disabled={auditLoading}>
            <Search size={15} />
            {t('Apply')}
          </button>
        </div>
      </form>
      <div className="audit-history-summary" aria-live="polite">
        <span>
          {t(totalEvents === 1 ? '{count} chained event retained' : '{count} chained events retained', { count: totalEvents })}
        </span>
        <strong>
          {activeFilterCount
            ? t(activeFilterCount === 1 ? '{count} active filter' : '{count} active filters', { count: activeFilterCount })
            : t('Latest chain activity')}
        </strong>
        {page?.newestSequence ? (
          <code>
            {t('#{newest} to #{oldest}', { newest: page.newestSequence, oldest: page.oldestSequence })}
          </code>
        ) : null}
      </div>
      {auditError ? (
        <div className="audit-history-error" role="alert">
          <TriangleAlert size={16} />
          <span>{auditError}</span>
          <button className="secondary-button" onClick={() => loadHistory(appliedFilters, { includeFacets: true })}>
            {t('Retry')}
          </button>
        </div>
      ) : null}
      <div className="audit-history-list" role={events.length ? 'list' : undefined}>
        {events.map((event) => (
          <article className="audit-history-row" role="listitem" key={event.id}>
            <div className="audit-sequence">
              <span>{t('Sequence')}</span>
              <strong>#{event.sequenceNumber}</strong>
              <code title={event.eventHash}>{shortHash(event.eventHash)}</code>
            </div>
            <div className="audit-event-copy">
              <div>
                <strong>{formatStatus(event.action)}</strong>
                <span className="tag tag-green">{t('Chained')}</span>
              </div>
              <p>
                {formatStatus(event.entityType)} / {event.entityId}
              </p>
              {event.jobId ? <small>{t('Job {id}', { id: event.jobId })}</small> : <small>{t('Portfolio record')}</small>}
            </div>
            <div className="audit-event-context">
              <strong>{event.actor}</strong>
              <span>{formatDateTime(event.createdAt)}</span>
            </div>
            <button
              className="icon-button table-action"
              aria-label={t('Inspect audit event {sequence}', { sequence: event.sequenceNumber })}
              onClick={(clickEvent) => {
                detailOpenerRef.current = clickEvent.currentTarget
                setSelectedEvent(event)
              }}
            >
              <Eye size={16} />
            </button>
          </article>
        ))}
        {!events.length && !auditLoading && !auditError ? (
          <Empty title={t('No audit events match')} detail={t('Adjust the filters or refresh to inspect the latest retained chain activity.')} />
        ) : null}
        {auditLoading && !events.length ? (
          <div className="audit-history-loading">
            <LoaderCircle className="spin" size={22} />
            <span>{t('Loading retained audit history')}</span>
          </div>
        ) : null}
      </div>
      {page?.hasMore ? (
        <div className="audit-history-more">
          <button
            className="secondary-button"
            disabled={auditLoading}
            onClick={() => loadHistory(appliedFilters, { append: true, beforeSequence: page.nextBeforeSequence })}
          >
            {auditLoading ? <LoaderCircle className="spin" size={15} /> : <ChevronRight size={15} />}{t('Load older events')}
          </button>
        </div>
      ) : null}

      {selectedEvent ? (
        <div className="modal-backdrop audit-detail-backdrop" role="presentation">
          <section
            className="modal audit-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-detail-title"
            data-testid="audit-event-detail"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{t('Chained event #{sequence}', { sequence: selectedEvent.sequenceNumber })}</p>
                <h2 id="audit-detail-title">{formatStatus(selectedEvent.action)}</h2>
                <p>
                  {formatDateTime(selectedEvent.createdAt)} / {selectedEvent.actor}
                </p>
              </div>
              <button ref={detailCloseRef} className="icon-button" aria-label={t('Close audit event detail')} onClick={closeAuditDetail}>
                <X size={18} />
              </button>
            </div>
            <div className="audit-detail-body">
              <dl className="audit-detail-facts">
                <div>
                  <dt>{t('Record type')}</dt>
                  <dd>{formatStatus(selectedEvent.entityType)}</dd>
                </div>
                <div>
                  <dt>{t('Record id')}</dt>
                  <dd>{selectedEvent.entityId}</dd>
                </div>
                <div>
                  <dt>{t('Job')}</dt>
                  <dd>{selectedEvent.jobId || t('Portfolio record')}</dd>
                </div>
                <div>
                  <dt>{t('Event id')}</dt>
                  <dd>{selectedEvent.id}</dd>
                </div>
              </dl>
              <div className="audit-chain-proof">
                <div>
                  <span>{t('Previous hash')}</span>
                  <code>{selectedEvent.previousHash}</code>
                </div>
                <ChevronRight size={18} />
                <div>
                  <span>{t('Event hash')}</span>
                  <code>{selectedEvent.eventHash}</code>
                </div>
              </div>
              <div className="audit-payload-grid">
                <section>
                  <h3>{t('Before')}</h3>
                  <pre>{JSON.stringify(selectedEvent.before ?? null, null, 2)}</pre>
                </section>
                <section>
                  <h3>{t('After')}</h3>
                  <pre>{JSON.stringify(selectedEvent.after ?? null, null, 2)}</pre>
                </section>
                <section>
                  <h3>{t('Metadata')}</h3>
                  <pre>{JSON.stringify(selectedEvent.metadata ?? null, null, 2)}</pre>
                </section>
              </div>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={closeAuditDetail}>
                {t('Close')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}
