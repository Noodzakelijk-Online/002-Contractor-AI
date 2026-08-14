import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, ClipboardCheck, Pencil, Scale, ShieldAlert, X } from 'lucide-react'
import { operatorText } from '../operator-locale'
import Empty from './EmptyState'
import './BidDecisionControl.css'

const EMPTY_LIST = Object.freeze([])

function statusLabel(value, t) {
  return t(String(value || 'review').replaceAll('_', ' '))
}

function policyDraft(activePolicy, fallbackCriteria, locale) {
  const snapshot = activePolicy?.snapshot
  return {
    policyName: snapshot?.policyName || operatorText(locale, 'Standard bid/no-bid scorecard'),
    bidThreshold: String(snapshot?.policy?.bidThreshold ?? 70),
    noBidThreshold: String(snapshot?.policy?.noBidThreshold ?? 45),
    criteria: (snapshot?.criteria || fallbackCriteria || EMPTY_LIST).map(criterion => ({
      key: criterion.key,
      label: criterion.label,
      source: criterion.source,
      weight: String(criterion.weight),
      minimumRating: String(criterion.minimumRating),
    })),
    reason: '',
  }
}

function decisionDraft(item, locale) {
  const snapshot = item?.pendingDecision?.snapshot || item?.currentDecision?.snapshot || null
  const retainedInput = snapshot?.input || {}
  const retainedCriteria = retainedInput.criteria || EMPTY_LIST
  const retainedGates = retainedInput.gates || EMPTY_LIST
  const criteria = (item?.evaluation?.criteria || EMPTY_LIST)
    .filter((criterion) => criterion.source === 'operator')
    .map((criterion) => {
      const retained = retainedCriteria.find((entry) => entry.key === criterion.key)
      return {
        key: criterion.key,
        label: criterion.label,
        weight: criterion.weight,
        minimumRating: criterion.minimumRating,
        rating: String(retained?.rating ?? 3),
        evidence: retained?.evidence || '',
      }
    })
  const gates = (item?.evaluation?.gates || EMPTY_LIST).map((gate) => ({
    key: gate.key,
    label: gate.label,
    status: retainedGates.find((entry) => entry.key === gate.key)?.status || 'unknown',
  }))
  const retainedDecision = snapshot?.proposedDecision
  const recommendation = item?.evaluation?.recommendation
  return {
    opportunityId: item?.opportunity?.id || '',
    title: item?.opportunity?.title || operatorText(locale, 'Opportunity'),
    criteria,
    gates,
    proposedDecision: retainedDecision || (recommendation === 'no_bid' ? 'no_bid' : 'bid'),
    rationale: snapshot?.rationale || '',
    overrideReason: snapshot?.overrideReason || '',
  }
}

function recommendationTag(value, score, t) {
  return (
    <span className={`bid-decision-recommendation recommendation-${value || 'review'}`}>
      {statusLabel(value, t)} {score !== null && score !== undefined && Number.isFinite(Number(score)) ? `${Number(score).toFixed(1)}%` : ''}
    </span>
  )
}

export default function BidDecisionControl({
  bidDecisions,
  canManagePolicy,
  canCoordinate,
  submitting,
  onRequestPolicy,
  onRequestDecision,
  locale = 'en-GB',
}) {
  const t = (key, variables) => operatorText(locale, key, variables)
  const activePolicy = bidDecisions?.policy?.activePolicy || null
  const pendingPolicies = bidDecisions?.policy?.pendingPolicies || EMPTY_LIST
  const summary = bidDecisions?.summary || {}
  const openItems = useMemo(
    () => (bidDecisions?.opportunities || EMPTY_LIST).filter((item) => !['won', 'lost', 'archived'].includes(item.opportunity?.stage)),
    [bidDecisions],
  )
  const [editingPolicy, setEditingPolicy] = useState(false)
  const [policy, setPolicy] = useState(() => policyDraft(activePolicy, bidDecisions?.criteria, locale))
  const [editingDecision, setEditingDecision] = useState(null)
  const [decision, setDecision] = useState(null)

  useEffect(() => {
    if (!editingPolicy) setPolicy(policyDraft(activePolicy, bidDecisions?.criteria, locale))
  }, [activePolicy, bidDecisions?.criteria, editingPolicy, locale])

  const selectedItem = useMemo(
    () => openItems.find((item) => item.opportunity.id === decision?.opportunityId) || null,
    [decision?.opportunityId, openItems],
  )

  const localEvaluation = useMemo(() => {
    if (!decision || !selectedItem || !activePolicy) return null
    const marketCriterion = selectedItem.evaluation?.criteria?.find((criterion) => criterion.key === 'market_fit')
    const manualCriteria = decision.criteria.map((criterion) => {
      const rating = Number(criterion.rating)
      const complete = Number.isFinite(rating) && rating >= 0 && rating <= 5 && criterion.evidence.trim().length >= 8
      return {
        ...criterion,
        rating,
        complete,
        blocker: complete && rating < Number(criterion.minimumRating),
        awardedWeight: Number.isFinite(rating) ? (rating / 5) * Number(criterion.weight) : 0,
      }
    })
    const score = Number(((marketCriterion?.awardedWeight || 0) + manualCriteria.reduce((sum, criterion) => sum + criterion.awardedWeight, 0)).toFixed(1))
    const blockers = [
      ...(marketCriterion?.status === 'below_minimum' ? ['market_fit'] : []),
      ...manualCriteria.filter((criterion) => criterion.blocker).map((criterion) => criterion.key),
      ...decision.gates.filter((gate) => gate.status === 'no').map((gate) => gate.key),
    ]
    const gaps = [
      ...(!marketCriterion || marketCriterion.status === 'missing_evidence' ? ['market_fit'] : []),
      ...manualCriteria.filter((criterion) => !criterion.complete).map((criterion) => criterion.key),
      ...decision.gates.filter((gate) => gate.status === 'unknown').map((gate) => gate.key),
    ]
    const bidThreshold = Number(activePolicy.snapshot?.policy?.bidThreshold ?? 70)
    const noBidThreshold = Number(activePolicy.snapshot?.policy?.noBidThreshold ?? 45)
    const recommendation = blockers.length
      ? 'no_bid'
      : gaps.length
        ? 'review'
        : score >= bidThreshold
          ? 'bid'
          : score <= noBidThreshold
            ? 'no_bid'
            : 'review'
    return { score, recommendation, blockers, gaps }
  }, [activePolicy, decision, selectedItem])

  function openPolicyEditor() {
    setPolicy(policyDraft(activePolicy, bidDecisions?.criteria, locale))
    setEditingPolicy(true)
  }

  function updatePolicyCriterion(key, patch) {
    setPolicy((current) => ({
      ...current,
      criteria: current.criteria.map((criterion) => (criterion.key === key ? { ...criterion, ...patch } : criterion)),
    }))
  }

  async function submitPolicy(event) {
    event.preventDefault()
    const result = await onRequestPolicy({
      entryKey: `bid-policy:${Date.now()}`,
      policyName: policy.policyName,
      bidThreshold: Number(policy.bidThreshold),
      noBidThreshold: Number(policy.noBidThreshold),
      criteria: policy.criteria.map((criterion) => ({
        key: criterion.key,
        weight: Number(criterion.weight),
        minimumRating: Number(criterion.minimumRating),
      })),
      reason: policy.reason,
    })
    if (result) setEditingPolicy(false)
  }

  function openDecisionEditor(item) {
    const next = decisionDraft(item, locale)
    setDecision(next)
    setEditingDecision(item.opportunity.id)
  }

  function updateDecisionCriterion(key, patch) {
    setDecision((current) => ({
      ...current,
      criteria: current.criteria.map((criterion) => (criterion.key === key ? { ...criterion, ...patch } : criterion)),
    }))
  }

  function updateDecisionGate(key, status) {
    setDecision((current) => ({
      ...current,
      gates: current.gates.map((gate) => (gate.key === key ? { ...gate, status } : gate)),
    }))
  }

  async function submitDecision(event) {
    event.preventDefault()
    if (!decision || !localEvaluation) return
    const result = await onRequestDecision(decision.opportunityId, {
      entryKey: `bid-decision:${decision.opportunityId}:${Date.now()}`,
      criteria: decision.criteria.map((criterion) => ({
        key: criterion.key,
        rating: Number(criterion.rating),
        evidence: criterion.evidence,
      })),
      gates: decision.gates.map((gate) => ({ key: gate.key, status: gate.status })),
      proposedDecision: decision.proposedDecision,
      rationale: decision.rationale,
      overrideReason: decision.proposedDecision !== localEvaluation.recommendation ? decision.overrideReason : '',
    })
    if (result) {
      setEditingDecision(null)
      setDecision(null)
    }
  }

  const policyWeightTotal = policy.criteria.reduce((sum, criterion) => sum + (Number(criterion.weight) || 0), 0)
  const override = Boolean(localEvaluation && decision?.proposedDecision !== localEvaluation.recommendation)

  return (
    <section className="panel bid-decision-control" data-testid="bid-decision-control">
      <div className="panel-heading bid-decision-heading">
        <div>
          <p className="control-eyebrow">{t('Governed pursuit control')}</p>
          <h2>{t('Bid / no-bid scorecard')}</h2>
          <p>
            {activePolicy
              ? t('{name} / policy v{version}', { name: activePolicy.policyName, version: activePolicy.versionNumber })
              : t('No approved pursuit policy')}
          </p>
        </div>
        <div className="bid-decision-heading-actions">
          {pendingPolicies.length ? <span className="tag tag-amber">{t('{count} pending approval', { count: pendingPolicies.length })}</span> : null}
          {canManagePolicy ? (
            <button className="secondary-button" type="button" disabled={submitting || pendingPolicies.length > 0} onClick={openPolicyEditor}>
              <Pencil size={14} /> {activePolicy ? t('Revise policy') : t('Configure scorecard')}
            </button>
          ) : null}
        </div>
      </div>

      {activePolicy ? (
        <>
          <div className="bid-decision-summary" aria-label={t('Pursuit decision summary')}>
            <div><strong>{summary.bid || 0}</strong><span>{t('Approved bid')}</span></div>
            <div><strong>{summary.noBid || 0}</strong><span>{t('Approved no-bid')}</span></div>
            <div><strong>{summary.pendingApproval || 0}</strong><span>{t('Awaiting approval')}</span></div>
            <div><strong>{summary.missingOrStale || 0}</strong><span>{t('Missing or stale')}</span></div>
          </div>
          {openItems.length ? (
            <div className="bid-decision-list">
              {openItems.map((item) => {
                const approved = item.currentDecision
                const pending = item.pendingDecision
                const basis = pending || approved
                return (
                  <div className="bid-decision-row" key={item.opportunity.id}>
                    <div className="bid-decision-opportunity">
                      <strong>{item.opportunity.title}</strong>
                      <span>{item.opportunity.client?.name || t('Client pending')} / {item.opportunity.service || t('Service pending')}</span>
                    </div>
                    <div className="bid-decision-result">
                      {recommendationTag(item.evaluation?.recommendation, item.evaluation?.score, t)}
                      <small>
                        {t('{gaps} gap(s) / {blockers} blocker(s)', { gaps: item.evaluation?.evidenceGaps?.length || 0, blockers: item.evaluation?.blockers?.length || 0 })}
                      </small>
                    </div>
                    <div className="bid-decision-state">
                      {pending ? <span className="tag tag-amber">{t('{decision} pending', { decision: statusLabel(pending.proposedDecision, t) })}</span> : null}
                      {approved && !item.stale ? <span className="tag tag-green">{t('Approved {decision}', { decision: statusLabel(approved.proposedDecision, t) })}</span> : null}
                      {item.stale ? <span className="tag tag-amber">{t('Stale')}</span> : null}
                      {!basis ? <span className="tag">{t('No decision')}</span> : null}
                    </div>
                    {canCoordinate && !pending ? (
                      <button className="secondary-button" type="button" disabled={submitting} onClick={() => openDecisionEditor(item)}>
                        <Scale size={14} /> {approved ? t('Revise') : t('Score pursuit')}
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <Empty title={t('No open pursuits')} detail={t('Open opportunities appear here after market-fit qualification.')} />
          )}
        </>
      ) : (
        <Empty title={t('Bid/no-bid policy required')} detail={t('An owner must request the weighted scorecard and an approver must activate it.')} />
      )}

      {editingPolicy ? (
        <div className="bid-decision-editor-wrap" role="dialog" aria-modal="true" aria-labelledby="bid-policy-title">
          <form className="bid-decision-editor" onSubmit={submitPolicy}>
            <div className="panel-heading">
              <div><h3 id="bid-policy-title">{t('Scorecard policy revision')}</h3><p>{t('Weights must total exactly 100.')}</p></div>
              <button className="icon-button" type="button" aria-label={t('Close bid/no-bid policy editor')} onClick={() => setEditingPolicy(false)}><X size={16} /></button>
            </div>
            <div className="form-grid bid-policy-grid">
              <label className="form-span">{t('Policy name')}<input autoFocus required minLength="2" maxLength="120" value={policy.policyName} onChange={(event) => setPolicy({ ...policy, policyName: event.target.value })} /></label>
              <label>{t('Bid threshold')}<input required type="number" min="1" max="100" step="1" value={policy.bidThreshold} onChange={(event) => setPolicy({ ...policy, bidThreshold: event.target.value })} /></label>
              <label>{t('No-bid threshold')}<input required type="number" min="0" max="99" step="1" value={policy.noBidThreshold} onChange={(event) => setPolicy({ ...policy, noBidThreshold: event.target.value })} /></label>
            </div>
            <div className="bid-policy-table-wrap">
              <table className="bid-policy-table">
                <thead><tr><th>{t('Criterion')}</th><th>{t('Source')}</th><th>{t('Weight')}</th><th>{t('Minimum rating')}</th></tr></thead>
                <tbody>
                  {policy.criteria.map((criterion) => (
                    <tr key={criterion.key}>
                      <td>{criterion.label}</td>
                      <td>{criterion.source === 'market_fit' ? t('Retained fit') : t('Operator evidence')}</td>
                      <td><label><span className="visually-hidden">{t('{label} weight', { label: criterion.label })}</span><input aria-label={t('{label} weight', { label: criterion.label })} required type="number" min="1" max="100" step="1" value={criterion.weight} onChange={(event) => updatePolicyCriterion(criterion.key, { weight: event.target.value })} /></label></td>
                      <td><label><span className="visually-hidden">{t('{label} minimum rating', { label: criterion.label })}</span><input aria-label={t('{label} minimum rating', { label: criterion.label })} required type="number" min="0" max="5" step="0.5" value={criterion.minimumRating} onChange={(event) => updatePolicyCriterion(criterion.key, { minimumRating: event.target.value })} /></label></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={`bid-policy-total ${Math.abs(policyWeightTotal - 100) < 0.001 ? 'total-valid' : 'total-invalid'}`}>
              <span>{t('Total weight')}</span><strong>{policyWeightTotal}%</strong>
            </div>
            <label className="bid-decision-reason">{t('Revision reason')}<textarea required minLength="8" maxLength="500" value={policy.reason} onChange={(event) => setPolicy({ ...policy, reason: event.target.value })} placeholder={t('Record why these pursuit thresholds and gates are appropriate.')} /></label>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setEditingPolicy(false)}>{t('Cancel')}</button>
              <button className="primary-button" disabled={submitting || Math.abs(policyWeightTotal - 100) > 0.001 || policy.reason.trim().length < 8}><ChevronRight size={15} /> {t('Request approval')}</button>
            </div>
          </form>
        </div>
      ) : null}

      {editingDecision && decision && selectedItem ? (
        <div className="bid-decision-editor-wrap" role="dialog" aria-modal="true" aria-labelledby="bid-decision-title">
          <form className="bid-decision-editor" onSubmit={submitDecision}>
            <div className="panel-heading">
               <div><h3 id="bid-decision-title">{t('Score {title}', { title: decision.title })}</h3><p>{t('Ratings use 0 (unacceptable) to 5 (strong evidence).')}</p></div>
               <button className="icon-button" type="button" aria-label={t('Close bid/no-bid decision editor')} onClick={() => { setEditingDecision(null); setDecision(null) }}><X size={16} /></button>
            </div>
            <div className="bid-derived-fit">
              <TargetIcon />
               <div><strong>{t('Market fit is derived')}</strong><span>{selectedItem.evaluation?.marketFit?.current ? t('{score}% retained fit', { score: selectedItem.evaluation.marketFit.score }) : t('Retain current market-fit evidence first')}</span></div>
            </div>
            <div className="bid-rating-list">
              {decision.criteria.map((criterion) => (
                <fieldset className="bid-rating-row" key={criterion.key}>
                  <legend>{criterion.label}</legend>
                   <label>{t('Rating')}<input required type="number" min="0" max="5" step="0.5" aria-label={t('{label} rating', { label: criterion.label })} value={criterion.rating} onChange={(event) => updateDecisionCriterion(criterion.key, { rating: event.target.value })} /></label>
                   <label>{t('Evidence')}<textarea required minLength="8" maxLength="1000" aria-label={t('{label} evidence', { label: criterion.label })} value={criterion.evidence} onChange={(event) => updateDecisionCriterion(criterion.key, { evidence: event.target.value })} /></label>
                </fieldset>
              ))}
            </div>
            <fieldset className="bid-gates">
               <legend>{t('Go / no-go gates')}</legend>
              {decision.gates.map((gate) => (
                 <label key={gate.key}>{gate.label}<select aria-label={gate.label} value={gate.status} onChange={(event) => updateDecisionGate(gate.key, event.target.value)}><option value="unknown">{t('Unknown')}</option><option value="yes">{t('Yes')}</option><option value="no">{t('No')}</option></select></label>
              ))}
            </fieldset>
            {localEvaluation ? (
              <div className={`bid-live-result result-${localEvaluation.recommendation}`} aria-live="polite">
                 <div><span>{t('Calculated recommendation')}</span><strong>{statusLabel(localEvaluation.recommendation, t)} / {localEvaluation.score}%</strong></div>
                 <small>{t('{gaps} evidence gap(s) / {blockers} blocker(s)', { gaps: localEvaluation.gaps.length, blockers: localEvaluation.blockers.length })}</small>
              </div>
            ) : null}
            <div className="form-grid bid-decision-final-grid">
               <label>{t('Proposed decision')}<select value={decision.proposedDecision} onChange={(event) => setDecision({ ...decision, proposedDecision: event.target.value })}><option value="bid">{t('Bid')}</option><option value="no_bid">{t('No bid')}</option></select></label>
               <label className="form-span">{t('Decision rationale')}<textarea required minLength="8" maxLength="1000" value={decision.rationale} onChange={(event) => setDecision({ ...decision, rationale: event.target.value })} /></label>
               {override ? <label className="form-span bid-override"><ShieldAlert size={15} /> {t('Override reason')}<textarea required minLength="12" maxLength="500" value={decision.overrideReason} onChange={(event) => setDecision({ ...decision, overrideReason: event.target.value })} /></label> : null}
            </div>
             <p className="bid-decision-safeguard"><ClipboardCheck size={15} /> {t('Approval retains the internal pursuit decision only. It does not close the lead, send a message, create work, or commit spend.')}</p>
            <div className="modal-actions">
               <button className="secondary-button" type="button" onClick={() => { setEditingDecision(null); setDecision(null) }}>{t('Cancel')}</button>
               <button className="primary-button" disabled={submitting || decision.rationale.trim().length < 8 || (override && decision.overrideReason.trim().length < 12)}><Check size={15} /> {t('Request decision approval')}</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  )
}

function TargetIcon() {
  return <Scale size={18} aria-hidden="true" />
}
