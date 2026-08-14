import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ClipboardCheck,
  LockKeyhole,
  Minus,
  Pencil,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  X,
} from 'lucide-react'
import { formatDate, formatNumber, formatStatus } from '../dashboard-format'
import { operatorText } from '../locale'
import './PerformanceScorecard.css'

const EMPTY_LIST = Object.freeze([])
const PERSPECTIVE_LABELS = Object.freeze({
  safety: 'Safety',
  quality: 'Quality',
  delivery_reliability: 'Delivery',
  customer_satisfaction: 'Customer',
  employee_capacity: 'People',
  financial_performance: 'Financial',
  commercial_pipeline: 'Commercial',
  asset_productivity: 'Assets',
  compliance: 'Compliance',
  sustainability: 'Sustainability',
})

function targetEntryKey(metricKey) {
  if (globalThis.crypto?.randomUUID) return `scorecard-target-${metricKey}-${globalThis.crypto.randomUUID()}`
  return `scorecard-target-${metricKey}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function metricValue(value, unit, t) {
  if (value === null || value === undefined) return t('No data')
  if (unit === 'percent') return `${formatNumber(value, { maximumFractionDigits: 1 })}%`
  return formatNumber(value, { maximumFractionDigits: 2 })
}

function statusLabel(status, t) {
  if (status === 'no_data') return t('No data')
  if (status === 'on_track') return t('On track')
  if (status === 'off_track') return t('Off track')
  return t(formatStatus(status))
}

function trendIcon(metric) {
  if (metric.trend === 'improving') return <TrendingUp size={15} aria-hidden="true" />
  if (metric.trend === 'declining') return <TrendingDown size={15} aria-hidden="true" />
  return <Minus size={15} aria-hidden="true" />
}

function evidenceSummary(metric, t) {
  if (metric.availability === 'historical_state_not_retained') return t('Historical position unavailable')
  return t(metric.sampleSize === 1 ? '{count} source' : '{count} sources', { count: metric.sampleSize })
}

function performanceMessage(item, scorecard, t) {
  const metrics = (scorecard?.perspectives || EMPTY_LIST).flatMap(perspective => perspective.metrics || EMPTY_LIST)
  if (item.code === 'performance_target_revisions_pending') {
    return t('{count} performance target revision(s) await approval. Resolve them before freezing a scorecard.', {
      count: item.targetIds?.length || scorecard?.targets?.pending?.length || 0,
    })
  }
  if (item.code === 'performance_historical_point_in_time_unavailable') {
    return t('{count} point-in-time KPI(s) are unavailable for a past period because mutable operating state is not reconstructed. Use retained snapshots for historical positions.', {
      count: metrics.filter(metric => metric.availability === 'historical_state_not_retained').length,
    })
  }
  if (item.code === 'performance_metrics_missing_data') {
    return t('{missing} of {total} KPI(s) lack retained evidence for this period.', {
      missing: scorecard?.summary?.noData || 0,
      total: scorecard?.summary?.metricCount || metrics.length,
    })
  }
  if (item.code === 'performance_metrics_off_track') {
    return t('{count} KPI(s) are materially below target.', { count: scorecard?.summary?.offTrack || 0 })
  }
  return item.message
}

export default function PerformanceScorecard({
  scorecard,
  request,
  canCoordinate,
  canApprove,
  onChange,
  onOpenApprovals,
  locale = 'en-GB',
}) {
  const t = (key, variables) => operatorText(locale, key, variables)
  const [periodEnd, setPeriodEnd] = useState(scorecard?.periodEnd || new Date().toISOString().slice(0, 10))
  const [weeks, setWeeks] = useState(String(scorecard?.weeks || 13))
  const [perspective, setPerspective] = useState(scorecard?.perspectives?.[0]?.key || 'safety')
  const [targetMetric, setTargetMetric] = useState(null)
  const [targetValue, setTargetValue] = useState('')
  const [targetReason, setTargetReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!scorecard) return
    setPeriodEnd(scorecard.periodEnd)
    setWeeks(String(scorecard.weeks))
    if (!scorecard.perspectives?.some(item => item.key === perspective)) {
      setPerspective(scorecard.perspectives?.[0]?.key || 'safety')
    }
  }, [perspective, scorecard])

  const perspectives = scorecard?.perspectives || EMPTY_LIST
  const currentPerspective = useMemo(
    () => perspectives.find(item => item.key === perspective) || perspectives[0] || null,
    [perspective, perspectives],
  )
  const summary = scorecard?.summary || {}
  const pendingSnapshot = scorecard?.pendingSnapshot || null
  const currentSnapshot = scorecard?.activeSnapshot || null

  async function perform(action) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (nextError) {
      setError(nextError.message || t('The performance scorecard action could not be completed.'))
    } finally {
      setBusy(false)
    }
  }

  async function loadScorecard(nextPeriodEnd = periodEnd, nextWeeks = weeks) {
    const query = new URLSearchParams({ periodEnd: nextPeriodEnd, weeks: String(nextWeeks) })
    const result = await request(`/api/ledger/performance-scorecard?${query.toString()}`)
    onChange(result.scorecard)
    return result.scorecard
  }

  function recalculate(event) {
    event.preventDefault()
    perform(async () => {
      await loadScorecard()
      setNotice(t('Performance evidence recalculated for the selected period.'))
    })
  }

  function openTarget(metric) {
    setTargetMetric(metric)
    setTargetValue(String(metric.targetValue))
    setTargetReason('')
  }

  function submitTarget(event) {
    event.preventDefault()
    if (!targetMetric) return
    perform(async () => {
      const result = await request('/api/ledger/performance-scorecard/targets', {
        method: 'POST',
        body: JSON.stringify({
          metricKey: targetMetric.key,
          targetValue: Number(targetValue),
          reason: targetReason,
          entryKey: targetEntryKey(targetMetric.key),
          periodEnd,
          weeks: Number(weeks),
        }),
      })
      onChange(result.scorecard)
      setTargetMetric(null)
      setTargetReason('')
      setNotice(t('{label} target revision retained for approval.', { label: targetMetric.label }))
    })
  }

  function requestSnapshot() {
    perform(async () => {
      const result = await request('/api/ledger/performance-scorecard/snapshots', {
        method: 'POST',
        body: JSON.stringify({ periodEnd, weeks: Number(weeks) }),
      })
      await loadScorecard()
      setNotice(result.replayed
        ? t('{number} is already awaiting review.', { number: result.snapshot.scorecardNumber })
        : t('{number} retained for approval. No external action was created.', { number: result.snapshot.scorecardNumber }))
    })
  }

  if (!scorecard) {
    return <div className="performance-loading" role="status">{t('Preparing the Contractor Balanced Scorecard')}</div>
  }

  return (
    <section className="performance-scorecard" data-testid="performance-scorecard" aria-busy={busy || undefined}>
      <header className="performance-heading">
        <div>
          <span className="eyebrow">{t('Operating performance')}</span>
          <h2>{t('Contractor Balanced Scorecard')}</h2>
          <p>{t('{start} to {end}', { start: formatDate(scorecard.periodStart), end: formatDate(scorecard.periodEnd) })}</p>
        </div>
        <div className="performance-snapshot-state">
          {scorecard.snapshotCurrent ? <span className="tag tag-green"><Check size={14} /> {t('Current snapshot')}</span> : null}
          {currentSnapshot && !scorecard.snapshotCurrent ? <span className="tag tag-amber"><TriangleAlert size={14} /> {t('Snapshot stale')}</span> : null}
          {pendingSnapshot ? <span className="tag tag-blue"><LockKeyhole size={14} /> {t('Review pending')}</span> : null}
        </div>
      </header>

      <form className="performance-period" onSubmit={recalculate}>
        <label>
          {t('Period end')}
          <input type="date" value={periodEnd} onChange={event => setPeriodEnd(event.target.value)} required />
        </label>
        <label>
          {t('Weeks')}
          <input type="number" min="4" max="52" step="1" value={weeks} onChange={event => setWeeks(event.target.value)} required />
        </label>
        <button className="secondary-button" type="submit" disabled={busy}>
          <RefreshCw size={16} className={busy ? 'spin' : ''} />
          {t('Recalculate')}
        </button>
        {canCoordinate ? (
          <button className="primary-button" type="button" disabled={busy || !scorecard.ready || Boolean(pendingSnapshot)} onClick={requestSnapshot}>
            <LockKeyhole size={16} />
            {t('Freeze scorecard')}
          </button>
        ) : null}
        {canApprove && pendingSnapshot?.approvalId ? (
          <button className="secondary-button" type="button" onClick={() => onOpenApprovals({ approvalId: pendingSnapshot.approvalId })}>
            <ClipboardCheck size={16} />
            {t('Review snapshot')}
          </button>
        ) : null}
      </form>

      {error ? <div className="performance-banner performance-banner-error"><TriangleAlert size={16} /><span>{error}</span></div> : null}
      {notice ? <div className="performance-banner performance-banner-notice"><Check size={16} /><span>{notice}</span></div> : null}
      {(scorecard.blockers || EMPTY_LIST).map(blocker => (
        <div className="performance-banner performance-banner-error" key={blocker.code}>
          <TriangleAlert size={16} /><span>{performanceMessage(blocker, scorecard, t)}</span>
        </div>
      ))}
      {(scorecard.warnings || EMPTY_LIST).map(warning => (
        <div className="performance-banner performance-banner-warning" key={warning.code}>
          <TriangleAlert size={16} /><span>{performanceMessage(warning, scorecard, t)}</span>
        </div>
      ))}

      <div className="performance-summary" aria-label={t('Scorecard summary')}>
        <div><span>{t('Overall score')}</span><strong>{formatNumber(summary.overallScore || 0, { maximumFractionDigits: 1 })}</strong><progress max="100" value={summary.overallScore || 0} /></div>
        <div><span>{t('Evidence coverage')}</span><strong>{formatNumber(summary.dataCoveragePct || 0, { maximumFractionDigits: 1 })}%</strong><small>{t('{count} governed KPIs', { count: summary.metricCount || 23 })}</small></div>
        <div><span>{t('On track')}</span><strong>{summary.onTrack || 0}</strong><small>{summary.watch || 0} {t('watch')}</small></div>
        <div><span>{t('Attention')}</span><strong>{summary.offTrack || 0}</strong><small>{t('{count} without evidence', { count: summary.noData || 0 })}</small></div>
      </div>

      <div className="performance-tabs" role="tablist" aria-label={t('Scorecard perspectives')}>
        {perspectives.map(item => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={item.key === currentPerspective?.key}
            className={item.key === currentPerspective?.key ? 'performance-tab-active' : ''}
            onClick={() => setPerspective(item.key)}
          >
            <span>{t(PERSPECTIVE_LABELS[item.key] || formatStatus(item.key))}</span>
            <b>{formatNumber(item.score || 0, { maximumFractionDigits: 1 })}</b>
          </button>
        ))}
      </div>

      {currentPerspective ? (
        <div className="performance-perspective" role="tabpanel">
          <div className="performance-perspective-heading">
            <div>
              <h3>{t(PERSPECTIVE_LABELS[currentPerspective.key] || formatStatus(currentPerspective.key))}</h3>
              <p>{t('{onTrack} on track, {noData} without evidence', { onTrack: currentPerspective.onTrack, noData: currentPerspective.noData })}</p>
            </div>
            <span className={`performance-status performance-status-${currentPerspective.status}`}>{statusLabel(currentPerspective.status, t)}</span>
          </div>
          <div className="performance-table-scroll" data-testid="performance-metric-table">
            <table className="performance-table">
              <thead>
                <tr><th>KPI</th><th>{t('Current')}</th><th>{t('Target')}</th><th>{t('Prior period')}</th><th>{t('Evidence')}</th><th>{t('Status')}</th><th aria-label={t('Actions')} /></tr>
              </thead>
              <tbody>
                {currentPerspective.metrics.map(metric => (
                  <tr key={metric.key}>
                    <th scope="row">
                      <span>{metric.label}</span>
                      <small>{t('{basis} | {comparison} threshold', {
                        basis: t(metric.basis === 'point_in_time' ? 'Point-in-time position' : 'Reporting-period measure'),
                        comparison: t(metric.comparison === 'at_least' ? 'Minimum' : 'Maximum'),
                      })}</small>
                    </th>
                    <td><strong>{metricValue(metric.value, metric.unit, t)}</strong></td>
                    <td>{metricValue(metric.targetValue, metric.unit, t)}<small>{t(metric.targetSource === 'approved_revision' ? 'Approved revision' : 'Default policy')}</small></td>
                    <td>
                      <span className={`performance-trend performance-trend-${metric.trend}`}>{trendIcon(metric)} {metricValue(metric.priorValue, metric.unit, t)}</span>
                    </td>
                    <td>
                      <details>
                        <summary>{evidenceSummary(metric, t)}</summary>
                        <span>{metric.availability === 'historical_state_not_retained'
                          ? t('Use the retained scorecard snapshot for the period-end operating position.')
                          : metric.evidenceIds.length ? metric.evidenceIds.join(', ') : t('No retained source IDs')}</span>
                      </details>
                    </td>
                    <td><span className={`performance-status performance-status-${metric.status}`}>{statusLabel(metric.status, t)}</span></td>
                    <td>
                      {canCoordinate ? (
                        <button className="icon-button" type="button" title={t('Revise {label} target', { label: metric.label })} aria-label={t('Revise {label} target', { label: metric.label })} onClick={() => openTarget(metric)} disabled={busy}>
                          <Pencil size={15} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="performance-history">
        <div><span>{t('Active snapshot')}</span><strong>{currentSnapshot?.scorecardNumber || t('None approved')}</strong></div>
        <div><span>{t('Pending targets')}</span><strong>{scorecard.targets?.pending?.length || 0}</strong></div>
        <div><span>{t('Retained snapshots')}</span><strong>{scorecard.snapshots?.length || 0}</strong></div>
      </div>

      {targetMetric ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal performance-target-modal" role="dialog" aria-modal="true" aria-labelledby="performance-target-title">
            <div className="modal-heading">
              <div><span className="eyebrow">{t('Target revision')}</span><h2 id="performance-target-title">{targetMetric.label}</h2></div>
              <button className="icon-button" type="button" aria-label={t('Close target revision')} onClick={() => setTargetMetric(null)} disabled={busy}><X size={18} /></button>
            </div>
            <form onSubmit={submitTarget}>
              <label>
                {t('Target')} {targetMetric.unit === 'percent' ? '(%)' : ''}
                <input
                  type="number"
                  min={targetMetric.key === 'net_promoter_score' ? '-100' : '0'}
                  max={targetMetric.key === 'net_promoter_score' || targetMetric.unit === 'percent' ? '100' : '1000000000'}
                  step="0.1"
                  value={targetValue}
                  onChange={event => setTargetValue(event.target.value)}
                  required
                />
              </label>
              <label>
                {t('Revision reason')}
                <textarea minLength="8" maxLength="500" value={targetReason} onChange={event => setTargetReason(event.target.value)} required placeholder={t('Retained management basis for this threshold')} />
              </label>
              <div className="modal-actions">
                <button className="secondary-button" type="button" onClick={() => setTargetMetric(null)} disabled={busy}>{t('Cancel')}</button>
                <button className="primary-button" type="submit" disabled={busy || targetReason.trim().length < 8}><ClipboardCheck size={16} />{t('Request approval')}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  )
}
