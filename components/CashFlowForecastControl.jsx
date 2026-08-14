import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  Check,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  WalletCards,
  X,
} from 'lucide-react'
import { formatCurrency, formatDate, formatStatus } from '../dashboard-format'
import { operatorText } from '../operator-locale'

const EMPTY_LIST = Object.freeze([])

function initialDraft(cashFlow) {
  return {
    title: '',
    direction: 'outflow',
    category: 'overhead',
    amount: '',
    currency: cashFlow?.currency || 'EUR',
    expectedAt: cashFlow?.asOfDate || new Date().toISOString().slice(0, 10),
    recurrence: 'once',
    recurrenceEndAt: '',
    confidencePercent: '100',
    jobId: '',
    sourceReference: '',
  }
}

function replayKey() {
  if (globalThis.crypto?.randomUUID) return `cash-flow-${globalThis.crypto.randomUUID()}`
  return `cash-flow-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function queryPath(asOfDate, openingBalance) {
  const query = new URLSearchParams({ asOfDate, openingBalance: String(openingBalance || 0) })
  return `/api/ledger/cash-flow?${query.toString()}`
}

function money(value, currencyCode = 'EUR') {
  return formatCurrency(value, currencyCode)
}

function statusMessage(record, cashFlow, t) {
  const summary = cashFlow?.summary || {}
  switch (record?.code) {
    case 'cash_flow_currency_mismatch':
      return t('Cash-flow sources contain multiple currencies: {currencies}. Convert them before freezing a forecast.', {
        currencies: (record.currencies || EMPTY_LIST).join(', '),
      })
    case 'cash_flow_no_movements':
      return t('No retained cash movements fall inside the 13-week horizon.')
    case 'cash_flow_overdue_sources':
      return t('{count} overdue cash movement(s) are included in week 1.', { count: summary.overdueSourceCount || 0 })
    case 'cash_flow_beyond_horizon':
      return t('{count} retained cash movement(s) fall beyond the 13-week horizon.', { count: summary.excludedSourceCount || 0 })
    case 'cash_flow_undated_commitments':
      return t('{count} issued purchase commitment(s) totalling {amount} have no approved supplier payable date and are not assigned to a forecast week.', {
        count: summary.undatedCommitmentCount || 0,
        amount: money(summary.undatedCommitmentValue, cashFlow?.currency),
      })
    case 'cash_flow_negative_balance':
      return t('Projected cash is negative in {count} week(s).', {
        count: Math.max(summary.negativeWeeks || 0, summary.weightedNegativeWeeks || 0),
      })
    default:
      return record?.message || ''
  }
}

export default function CashFlowForecastControl({
  locale = 'en-GB',
  cashFlow,
  jobs = EMPTY_LIST,
  request,
  canCoordinate,
  canApprove,
  onChange,
  onOpenApprovals,
}) {
  const t = (key, variables) => operatorText(locale, key, variables)
  const [asOfDate, setAsOfDate] = useState(cashFlow?.asOfDate || new Date().toISOString().slice(0, 10))
  const [openingBalance, setOpeningBalance] = useState(String(cashFlow?.openingBalance ?? 0))
  const [draftOpen, setDraftOpen] = useState(false)
  const [draft, setDraft] = useState(() => initialDraft(cashFlow))
  const [archiveItem, setArchiveItem] = useState(null)
  const [archiveReason, setArchiveReason] = useState('')
  const [selectedWeek, setSelectedWeek] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!cashFlow) return
    setAsOfDate(cashFlow.asOfDate)
    setOpeningBalance(String(cashFlow.openingBalance ?? 0))
    setSelectedWeek((current) => Math.min(Math.max(current, 1), cashFlow.weeks?.length || 13))
  }, [cashFlow])

  const activeItems = cashFlow?.items || EMPTY_LIST
  const weeks = cashFlow?.weeks || EMPTY_LIST
  const summary = cashFlow?.summary || {}
  const selected = weeks.find((week) => week.index === selectedWeek) || weeks[0] || null
  const sortedJobs = useMemo(
    () => [...jobs].sort((left, right) => String(left.title || '').localeCompare(String(right.title || ''))),
    [jobs],
  )

  async function loadForecast(nextAsOf = asOfDate, nextOpening = openingBalance) {
    const result = await request(queryPath(nextAsOf, nextOpening))
    onChange(result.cashFlow)
    return result.cashFlow
  }

  async function perform(action) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (nextError) {
      setError(nextError.message || t('The cash-flow control could not complete this action.'))
    } finally {
      setBusy(false)
    }
  }

  function changeRecurrence(recurrence) {
    setDraft((current) => ({
      ...current,
      recurrence,
      recurrenceEndAt: recurrence === 'once'
        ? ''
        : current.recurrenceEndAt || cashFlow?.horizonEnd || '',
    }))
  }

  function submitDraft(event) {
    event.preventDefault()
    perform(async () => {
      await request('/api/ledger/cash-flow/items', {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          entryKey: replayKey(),
          amount: Number(draft.amount),
          confidencePercent: Number(draft.confidencePercent),
          jobId: draft.jobId || null,
          recurrenceEndAt: draft.recurrence === 'once' ? null : draft.recurrenceEndAt,
        }),
      })
      await loadForecast()
      setDraft(initialDraft({ ...cashFlow, asOfDate, currency: cashFlow?.currency || 'EUR' }))
      setDraftOpen(false)
      setNotice(t('Cash-flow assumption retained. No payment or external commitment was created.'))
    })
  }

  function archiveAssumption(event) {
    event.preventDefault()
    if (!archiveItem) return
    perform(async () => {
      await request(`/api/ledger/cash-flow/items/${encodeURIComponent(archiveItem.id)}/archive`, {
        method: 'POST',
        body: JSON.stringify({ reason: archiveReason }),
      })
      await loadForecast()
      setArchiveItem(null)
      setArchiveReason('')
      setNotice(t('Assumption archived with its history retained.'))
    })
  }

  function requestSnapshot() {
    perform(async () => {
      const result = await request('/api/ledger/cash-flow/snapshots', {
        method: 'POST',
        body: JSON.stringify({ asOfDate, openingBalance: Number(openingBalance) }),
      })
      await loadForecast()
      setNotice(result.replayed
        ? t('{number} is already awaiting review.', { number: result.snapshot.forecastNumber })
        : t('{number} retained for approval. No funds were moved.', { number: result.snapshot.forecastNumber }))
    })
  }

  const currentSnapshot = cashFlow?.activeSnapshot
  const pendingSnapshot = cashFlow?.pendingSnapshot

  return (
    <section className="cash-flow-control" data-testid="cash-flow-control" aria-busy={busy || undefined}>
      <div className="cash-flow-heading">
        <div>
          <p className="eyebrow">{t('Liquidity control')}</p>
          <h3>{t('13-week cash-flow forecast')}</h3>
          <p>{t('Time-phase retained receivables, supplier payables, billing milestones, and operating assumptions.')}</p>
        </div>
        <div className="cash-flow-heading-actions">
          {currentSnapshot ? (
            <span className={`tag ${cashFlow.snapshotCurrent ? 'tag-green' : 'tag-amber'}`}>
              {currentSnapshot.forecastNumber} {t(cashFlow.snapshotCurrent ? 'current' : 'stale')}
            </span>
          ) : null}
          {pendingSnapshot ? <span className="tag tag-amber">{t('{number} awaiting approval', { number: pendingSnapshot.forecastNumber })}</span> : null}
        </div>
      </div>

      <div className="cash-flow-toolbar">
        <label>
          {t('As of')}
          <input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} />
        </label>
        <label>
          {t('Opening cash')}
          <input
            type="number"
            step="0.01"
            value={openingBalance}
            onChange={(event) => setOpeningBalance(event.target.value)}
          />
        </label>
        <button className="secondary-button" disabled={busy || !asOfDate} onClick={() => perform(() => loadForecast())}>
          <RefreshCw size={15} className={busy ? 'spin' : ''} />
          {t('Recalculate')}
        </button>
        {canCoordinate ? (
          <button className="secondary-button" disabled={busy} onClick={() => setDraftOpen((open) => !open)}>
            {draftOpen ? <X size={15} /> : <Plus size={15} />}
            {draftOpen ? t('Close assumption') : t('Add assumption')}
          </button>
        ) : null}
        {canCoordinate && !pendingSnapshot ? (
          <button className="primary-button" disabled={busy || cashFlow?.ready === false} onClick={requestSnapshot}>
            <ShieldCheck size={15} />
            {currentSnapshot ? t('Freeze revision') : t('Request approval')}
          </button>
        ) : null}
        {canApprove && pendingSnapshot?.approvalId ? (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => onOpenApprovals({ approvalId: pendingSnapshot.approvalId, label: pendingSnapshot.forecastNumber })}
          >
            <ShieldCheck size={15} />
            {t('Review approval')}
          </button>
        ) : null}
      </div>

      {error ? <div className="cash-flow-message cash-flow-error" role="alert"><TriangleAlert size={16} />{error}</div> : null}
      {notice ? <div className="cash-flow-message cash-flow-notice" role="status"><Check size={16} />{notice}</div> : null}
      {(cashFlow?.blockers || EMPTY_LIST).map((blocker) => (
        <div className="cash-flow-message cash-flow-error" role="alert" key={blocker.code}>
          <TriangleAlert size={16} />{statusMessage(blocker, cashFlow, t)}
        </div>
      ))}
      {(cashFlow?.warnings || EMPTY_LIST).map((warning) => (
        <div className="cash-flow-message cash-flow-warning" key={warning.code}>
          <TriangleAlert size={16} />{statusMessage(warning, cashFlow, t)}
        </div>
      ))}

      {draftOpen ? (
        <form className="cash-flow-form" onSubmit={submitDraft} data-testid="cash-flow-assumption-form">
          <div className="cash-flow-direction" aria-label={t('Cash direction')}>
            <button
              type="button"
              className={draft.direction === 'inflow' ? 'cash-direction-active' : ''}
              aria-pressed={draft.direction === 'inflow'}
              onClick={() => setDraft({ ...draft, direction: 'inflow' })}
            >
              <ArrowDownRight size={15} /> {t('Inflow')}
            </button>
            <button
              type="button"
              className={draft.direction === 'outflow' ? 'cash-direction-active' : ''}
              aria-pressed={draft.direction === 'outflow'}
              onClick={() => setDraft({ ...draft, direction: 'outflow' })}
            >
              <ArrowUpRight size={15} /> {t('Outflow')}
            </button>
          </div>
          <label className="cash-flow-form-wide">
            {t('Assumption')}
            <input required minLength="2" maxLength="160" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label>
            {t('Category')}
            <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
              <option value="overhead">{t('Overhead')}</option>
              <option value="payroll">{t('Payroll')}</option>
              <option value="tax">{t('Tax')}</option>
              <option value="equipment">{t('Equipment')}</option>
              <option value="financing">{t('Financing')}</option>
              <option value="client_receipt">{t('Client receipt')}</option>
              <option value="supplier_payment">{t('Supplier payment')}</option>
              <option value="other">{t('Other')}</option>
            </select>
          </label>
          <label>
            {t('Amount')}
            <input required type="number" min="0.01" step="0.01" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} />
          </label>
          <label>
            {t('Expected date')}
            <input required type="date" value={draft.expectedAt} onChange={(event) => setDraft({ ...draft, expectedAt: event.target.value })} />
          </label>
          <label>
            {t('Repeat')}
            <select value={draft.recurrence} onChange={(event) => changeRecurrence(event.target.value)}>
              <option value="once">{t('Once')}</option>
              <option value="weekly">{t('Weekly')}</option>
              <option value="monthly">{t('Monthly')}</option>
            </select>
          </label>
          {draft.recurrence !== 'once' ? (
            <label>
              {t('Repeat until')}
              <input required type="date" min={draft.expectedAt} value={draft.recurrenceEndAt} onChange={(event) => setDraft({ ...draft, recurrenceEndAt: event.target.value })} />
            </label>
          ) : null}
          <label>
            {t('Confidence')}
            <span className="cash-flow-range">
              <input type="range" min="0" max="100" step="5" value={draft.confidencePercent} onChange={(event) => setDraft({ ...draft, confidencePercent: event.target.value })} />
              <strong>{draft.confidencePercent}%</strong>
            </span>
          </label>
          <label>
            {t('Job')}
            <select value={draft.jobId} onChange={(event) => setDraft({ ...draft, jobId: event.target.value })}>
              <option value="">{t('Company-wide')}</option>
              {sortedJobs.map((job) => <option value={job.id} key={job.id}>{job.title}</option>)}
            </select>
          </label>
          <label className="cash-flow-form-wide">
            {t('Source reference')}
            <input maxLength="500" value={draft.sourceReference} onChange={(event) => setDraft({ ...draft, sourceReference: event.target.value })} />
          </label>
          <div className="cash-flow-form-actions">
            <button className="primary-button" disabled={busy} type="submit">
              <Plus size={15} /> {t('Retain assumption')}
            </button>
          </div>
        </form>
      ) : null}

      <div className="cash-flow-summary" aria-label={t('Cash-flow summary')}>
        <div><span>{t('Opening cash')}</span><strong>{money(summary.openingBalance, cashFlow?.currency)}</strong></div>
        <div><span>{t('13-week inflow')}</span><strong>{money(summary.totalInflows, cashFlow?.currency)}</strong></div>
        <div><span>{t('13-week outflow')}</span><strong>{money(summary.totalOutflows, cashFlow?.currency)}</strong></div>
        <div className={summary.closingBalance < 0 ? 'cash-summary-risk' : ''}><span>{t('Closing cash')}</span><strong>{money(summary.closingBalance, cashFlow?.currency)}</strong></div>
        <div className={summary.minimumBalance < 0 ? 'cash-summary-risk' : ''}><span>{t('Minimum cash')}</span><strong>{money(summary.minimumBalance, cashFlow?.currency)}</strong></div>
        <div><span>{t('Weighted close')}</span><strong>{money(summary.weightedClosingBalance, cashFlow?.currency)}</strong></div>
      </div>

      <div className="cash-flow-table-wrap">
        <table className="cash-flow-table">
          <thead>
            <tr>
              <th>{t('Week')}</th>
              <th>{t('Inflow')}</th>
              <th>{t('Outflow')}</th>
              <th>{t('Net')}</th>
              <th>{t('Closing cash')}</th>
              <th>{t('Weighted cash')}</th>
              <th>{t('Movements')}</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr className={week.closingBalance < 0 ? 'cash-flow-week-risk' : ''} key={week.index} data-testid="cash-flow-week-row">
                <td><strong>W{week.index}</strong><small>{formatDate(week.startsAt)}</small></td>
                <td className="cash-inflow">{money(week.inflow, cashFlow?.currency)}</td>
                <td className="cash-outflow">{money(week.outflow, cashFlow?.currency)}</td>
                <td>{money(week.net, cashFlow?.currency)}</td>
                <td><strong>{money(week.closingBalance, cashFlow?.currency)}</strong></td>
                <td>{money(week.weightedClosingBalance, cashFlow?.currency)}</td>
                <td>
                  <button className="text-button" onClick={() => setSelectedWeek(week.index)} aria-pressed={selectedWeek === week.index}>
                    {t(week.sourceCount === 1 ? '{count} source' : '{count} sources', { count: week.sourceCount })}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div className="cash-flow-week-detail" data-testid="cash-flow-week-detail">
          <div className="cash-flow-subheading">
            <div>
              <CalendarRange size={17} />
              <span><strong>{t('Week {number}', { number: selected.index })}</strong><small>{t('{start} to {end}', { start: formatDate(selected.startsAt), end: formatDate(selected.endsAt) })}</small></span>
            </div>
            <span className="tag">{t(selected.sourceCount === 1 ? '{count} movement' : '{count} movements', { count: selected.sourceCount })}</span>
          </div>
          {selected.sources?.length ? (
            <div className="cash-flow-source-list">
              {selected.sources.map((source, index) => (
                <div className="cash-flow-source" key={`${source.sourceType}-${source.sourceId}-${source.expectedAt}-${index}`}>
                  <span className={source.direction === 'inflow' ? 'cash-source-in' : 'cash-source-out'}>
                    {source.direction === 'inflow' ? <ArrowDownRight size={15} /> : <ArrowUpRight size={15} />}
                  </span>
                  <div>
                    <strong>{source.title}</strong>
                    <small>{t(formatStatus(source.sourceType))} | {formatDate(source.expectedAt)} | {t('{percent}% confidence', { percent: source.confidencePercent })}{source.overdue ? ` | ${t('overdue')}` : ''}</small>
                  </div>
                  <strong>{source.direction === 'outflow' ? '-' : '+'}{money(source.amount, source.currency)}</strong>
                </div>
              ))}
            </div>
          ) : <p className="cash-flow-empty">{t('No retained movement is expected in this week.')}</p>}
        </div>
      ) : null}

      <div className="cash-flow-assumptions">
        <div className="cash-flow-subheading">
          <div><WalletCards size={17} /><span><strong>{t('Operating assumptions')}</strong><small>{t('Retained manual movements included in source freshness checks')}</small></span></div>
          <span className="tag">{activeItems.length}</span>
        </div>
        {activeItems.length ? activeItems.map((item) => (
          <div className="cash-flow-assumption" key={item.id}>
            <span className={item.direction === 'inflow' ? 'cash-source-in' : 'cash-source-out'}>
              {item.direction === 'inflow' ? <ArrowDownRight size={15} /> : <ArrowUpRight size={15} />}
            </span>
            <div>
              <strong>{item.title}</strong>
              <small>{t(formatStatus(item.category))} | {formatDate(item.expectedAt)} | {t(formatStatus(item.recurrence))} | {item.confidencePercent}%</small>
            </div>
            <strong>{item.direction === 'outflow' ? '-' : '+'}{money(item.amount, item.currency)}</strong>
            {canCoordinate ? (
              <button className="icon-button table-action" aria-label={t('Archive {title}', { title: item.title })} title={t('Archive assumption')} onClick={() => { setArchiveItem(item); setArchiveReason('') }}>
                <Trash2 size={14} />
              </button>
            ) : null}
          </div>
        )) : <p className="cash-flow-empty">{t('No company assumptions are retained. Ledger receivables, payables, and billing still appear automatically.')}</p>}
      </div>

      {archiveItem ? (
        <form className="cash-flow-archive" onSubmit={archiveAssumption}>
          <div>
            <strong>{t('Archive {title}', { title: archiveItem.title })}</strong>
            <span>{t('The original assumption and audit history remain retained.')}</span>
          </div>
          <label>
            {t('Archive reason')}
            <textarea required minLength="8" maxLength="1000" autoFocus value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} />
          </label>
          <div>
            <button type="button" className="secondary-button" onClick={() => { setArchiveItem(null); setArchiveReason('') }}>{t('Cancel')}</button>
            <button type="submit" className="danger-button" disabled={busy}><Trash2 size={14} /> {t('Archive')}</button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
