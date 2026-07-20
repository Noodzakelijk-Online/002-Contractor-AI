import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, ClipboardCheck, Pencil, Scale, ShieldAlert, X } from 'lucide-react'
import Empty from './EmptyState'
import './BidDecisionControl.css'

const EMPTY_LIST = Object.freeze([])

function statusLabel(value) {
  return String(value || 'review').replaceAll('_', ' ')
}

function policyDraft(activePolicy, fallbackCriteria) {
  const snapshot = activePolicy?.snapshot
  return {
    policyName: snapshot?.policyName || 'Standard bid/no-bid scorecard',
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

function decisionDraft(item) {
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
    title: item?.opportunity?.title || 'Opportunity',
    criteria,
    gates,
    proposedDecision: retainedDecision || (recommendation === 'no_bid' ? 'no_bid' : 'bid'),
    rationale: snapshot?.rationale || '',
    overrideReason: snapshot?.overrideReason || '',
  }
}

function recommendationTag(value, score) {
  return (
    <span className={`bid-decision-recommendation recommendation-${value || 'review'}`}>
      {statusLabel(value)} {score !== null && score !== undefined && Number.isFinite(Number(score)) ? `${Number(score).toFixed(1)}%` : ''}
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
}) {
  const activePolicy = bidDecisions?.policy?.activePolicy || null
  const pendingPolicies = bidDecisions?.policy?.pendingPolicies || EMPTY_LIST
  const summary = bidDecisions?.summary || {}
  const openItems = useMemo(
    () => (bidDecisions?.opportunities || EMPTY_LIST).filter((item) => !['won', 'lost', 'archived'].includes(item.opportunity?.stage)),
    [bidDecisions],
  )
  const [editingPolicy, setEditingPolicy] = useState(false)
  const [policy, setPolicy] = useState(() => policyDraft(activePolicy, bidDecisions?.criteria))
  const [editingDecision, setEditingDecision] = useState(null)
  const [decision, setDecision] = useState(null)

  useEffect(() => {
    if (!editingPolicy) setPolicy(policyDraft(activePolicy, bidDecisions?.criteria))
  }, [activePolicy, bidDecisions?.criteria, editingPolicy])

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
    setPolicy(policyDraft(activePolicy, bidDecisions?.criteria))
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
    const next = decisionDraft(item)
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
          <p className="control-eyebrow">Governed pursuit control</p>
          <h2>Bid / no-bid scorecard</h2>
          <p>
            {activePolicy
              ? `${activePolicy.policyName} / policy v${activePolicy.versionNumber}`
              : 'No approved pursuit policy'}
          </p>
        </div>
        <div className="bid-decision-heading-actions">
          {pendingPolicies.length ? <span className="tag tag-amber">{pendingPolicies.length} pending approval</span> : null}
          {canManagePolicy ? (
            <button className="secondary-button" type="button" disabled={submitting || pendingPolicies.length > 0} onClick={openPolicyEditor}>
              <Pencil size={14} /> {activePolicy ? 'Revise policy' : 'Configure scorecard'}
            </button>
          ) : null}
        </div>
      </div>

      {activePolicy ? (
        <>
          <div className="bid-decision-summary" aria-label="Pursuit decision summary">
            <div><strong>{summary.bid || 0}</strong><span>Approved bid</span></div>
            <div><strong>{summary.noBid || 0}</strong><span>Approved no-bid</span></div>
            <div><strong>{summary.pendingApproval || 0}</strong><span>Awaiting approval</span></div>
            <div><strong>{summary.missingOrStale || 0}</strong><span>Missing or stale</span></div>
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
                      <span>{item.opportunity.client?.name || 'Client pending'} / {item.opportunity.service || 'Service pending'}</span>
                    </div>
                    <div className="bid-decision-result">
                      {recommendationTag(item.evaluation?.recommendation, item.evaluation?.score)}
                      <small>
                        {item.evaluation?.evidenceGaps?.length || 0} gap(s) / {item.evaluation?.blockers?.length || 0} blocker(s)
                      </small>
                    </div>
                    <div className="bid-decision-state">
                      {pending ? <span className="tag tag-amber">{statusLabel(pending.proposedDecision)} pending</span> : null}
                      {approved && !item.stale ? <span className="tag tag-green">Approved {statusLabel(approved.proposedDecision)}</span> : null}
                      {item.stale ? <span className="tag tag-amber">Stale</span> : null}
                      {!basis ? <span className="tag">No decision</span> : null}
                    </div>
                    {canCoordinate && !pending ? (
                      <button className="secondary-button" type="button" disabled={submitting} onClick={() => openDecisionEditor(item)}>
                        <Scale size={14} /> {approved ? 'Revise' : 'Score pursuit'}
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <Empty title="No open pursuits" detail="Open opportunities appear here after market-fit qualification." />
          )}
        </>
      ) : (
        <Empty title="Bid/no-bid policy required" detail="An owner must request the weighted scorecard and an approver must activate it." />
      )}

      {editingPolicy ? (
        <div className="bid-decision-editor-wrap" role="dialog" aria-modal="true" aria-labelledby="bid-policy-title">
          <form className="bid-decision-editor" onSubmit={submitPolicy}>
            <div className="panel-heading">
              <div><h3 id="bid-policy-title">Scorecard policy revision</h3><p>Weights must total exactly 100.</p></div>
              <button className="icon-button" type="button" aria-label="Close bid/no-bid policy editor" onClick={() => setEditingPolicy(false)}><X size={16} /></button>
            </div>
            <div className="form-grid bid-policy-grid">
              <label className="form-span">Policy name<input autoFocus required minLength="2" maxLength="120" value={policy.policyName} onChange={(event) => setPolicy({ ...policy, policyName: event.target.value })} /></label>
              <label>Bid threshold<input required type="number" min="1" max="100" step="1" value={policy.bidThreshold} onChange={(event) => setPolicy({ ...policy, bidThreshold: event.target.value })} /></label>
              <label>No-bid threshold<input required type="number" min="0" max="99" step="1" value={policy.noBidThreshold} onChange={(event) => setPolicy({ ...policy, noBidThreshold: event.target.value })} /></label>
            </div>
            <div className="bid-policy-table-wrap">
              <table className="bid-policy-table">
                <thead><tr><th>Criterion</th><th>Source</th><th>Weight</th><th>Minimum rating</th></tr></thead>
                <tbody>
                  {policy.criteria.map((criterion) => (
                    <tr key={criterion.key}>
                      <td>{criterion.label}</td>
                      <td>{criterion.source === 'market_fit' ? 'Retained fit' : 'Operator evidence'}</td>
                      <td><label><span className="visually-hidden">{criterion.label} weight</span><input aria-label={`${criterion.label} weight`} required type="number" min="1" max="100" step="1" value={criterion.weight} onChange={(event) => updatePolicyCriterion(criterion.key, { weight: event.target.value })} /></label></td>
                      <td><label><span className="visually-hidden">{criterion.label} minimum rating</span><input aria-label={`${criterion.label} minimum rating`} required type="number" min="0" max="5" step="0.5" value={criterion.minimumRating} onChange={(event) => updatePolicyCriterion(criterion.key, { minimumRating: event.target.value })} /></label></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={`bid-policy-total ${Math.abs(policyWeightTotal - 100) < 0.001 ? 'total-valid' : 'total-invalid'}`}>
              <span>Total weight</span><strong>{policyWeightTotal}%</strong>
            </div>
            <label className="bid-decision-reason">Revision reason<textarea required minLength="8" maxLength="500" value={policy.reason} onChange={(event) => setPolicy({ ...policy, reason: event.target.value })} placeholder="Record why these pursuit thresholds and gates are appropriate." /></label>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setEditingPolicy(false)}>Cancel</button>
              <button className="primary-button" disabled={submitting || Math.abs(policyWeightTotal - 100) > 0.001 || policy.reason.trim().length < 8}><ChevronRight size={15} /> Request approval</button>
            </div>
          </form>
        </div>
      ) : null}

      {editingDecision && decision && selectedItem ? (
        <div className="bid-decision-editor-wrap" role="dialog" aria-modal="true" aria-labelledby="bid-decision-title">
          <form className="bid-decision-editor" onSubmit={submitDecision}>
            <div className="panel-heading">
              <div><h3 id="bid-decision-title">Score {decision.title}</h3><p>Ratings use 0 (unacceptable) to 5 (strong evidence).</p></div>
              <button className="icon-button" type="button" aria-label="Close bid/no-bid decision editor" onClick={() => { setEditingDecision(null); setDecision(null) }}><X size={16} /></button>
            </div>
            <div className="bid-derived-fit">
              <TargetIcon />
              <div><strong>Market fit is derived</strong><span>{selectedItem.evaluation?.marketFit?.current ? `${selectedItem.evaluation.marketFit.score}% retained fit` : 'Retain current market-fit evidence first'}</span></div>
            </div>
            <div className="bid-rating-list">
              {decision.criteria.map((criterion) => (
                <fieldset className="bid-rating-row" key={criterion.key}>
                  <legend>{criterion.label}</legend>
                  <label>Rating<input required type="number" min="0" max="5" step="0.5" aria-label={`${criterion.label} rating`} value={criterion.rating} onChange={(event) => updateDecisionCriterion(criterion.key, { rating: event.target.value })} /></label>
                  <label>Evidence<textarea required minLength="8" maxLength="1000" aria-label={`${criterion.label} evidence`} value={criterion.evidence} onChange={(event) => updateDecisionCriterion(criterion.key, { evidence: event.target.value })} /></label>
                </fieldset>
              ))}
            </div>
            <fieldset className="bid-gates">
              <legend>Go / no-go gates</legend>
              {decision.gates.map((gate) => (
                <label key={gate.key}>{gate.label}<select aria-label={gate.label} value={gate.status} onChange={(event) => updateDecisionGate(gate.key, event.target.value)}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
              ))}
            </fieldset>
            {localEvaluation ? (
              <div className={`bid-live-result result-${localEvaluation.recommendation}`} aria-live="polite">
                <div><span>Calculated recommendation</span><strong>{statusLabel(localEvaluation.recommendation)} / {localEvaluation.score}%</strong></div>
                <small>{localEvaluation.gaps.length} evidence gap(s) / {localEvaluation.blockers.length} blocker(s)</small>
              </div>
            ) : null}
            <div className="form-grid bid-decision-final-grid">
              <label>Proposed decision<select value={decision.proposedDecision} onChange={(event) => setDecision({ ...decision, proposedDecision: event.target.value })}><option value="bid">Bid</option><option value="no_bid">No bid</option></select></label>
              <label className="form-span">Decision rationale<textarea required minLength="8" maxLength="1000" value={decision.rationale} onChange={(event) => setDecision({ ...decision, rationale: event.target.value })} /></label>
              {override ? <label className="form-span bid-override"><ShieldAlert size={15} /> Override reason<textarea required minLength="12" maxLength="500" value={decision.overrideReason} onChange={(event) => setDecision({ ...decision, overrideReason: event.target.value })} /></label> : null}
            </div>
            <p className="bid-decision-safeguard"><ClipboardCheck size={15} /> Approval retains the internal pursuit decision only. It does not close the lead, send a message, create work, or commit spend.</p>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => { setEditingDecision(null); setDecision(null) }}>Cancel</button>
              <button className="primary-button" disabled={submitting || decision.rationale.trim().length < 8 || (override && decision.overrideReason.trim().length < 12)}><Check size={15} /> Request decision approval</button>
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
