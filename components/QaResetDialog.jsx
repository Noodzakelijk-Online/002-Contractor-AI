import { useEffect, useRef, useState } from 'react'
import { Archive, FolderArchive, RefreshCw, TriangleAlert, X } from 'lucide-react'
import './QaResetDialog.css'

const CONFIRMATION_PHRASE = 'ARCHIVE QA'

export default function QaResetDialog({ plan, loading, busy, error, onClose, onReload, onSubmit }) {
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [validationError, setValidationError] = useState('')
  const dialogRef = useRef(null)
  const headingRef = useRef(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  function handleDialogKeyDown(event) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...dialogRef.current.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )]
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!focusable.includes(document.activeElement)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const trimmedReason = reason.trim()
    if (trimmedReason.length < 8) {
      setValidationError('Record at least 8 characters explaining why these test records should be archived.')
      return
    }
    if (confirmation.trim() !== CONFIRMATION_PHRASE) {
      setValidationError(`Type ${CONFIRMATION_PHRASE} exactly to confirm this maintenance action.`)
      return
    }
    if (!plan?.planHash || !plan.totalRecords) {
      setValidationError('Load a current preview containing eligible QA or demo records before continuing.')
      return
    }
    setValidationError('')
    await onSubmit({ reason: trimmedReason, planHash: plan.planHash })
  }

  const counts = plan?.counts || {}
  const decisionError = validationError || error
  const submitDisabled = loading
    || busy
    || !plan?.planHash
    || !plan?.totalRecords
    || reason.trim().length < 8
    || confirmation.trim() !== CONFIRMATION_PHRASE

  return (
    <div className="modal-backdrop qa-reset-backdrop" role="presentation">
      <form
        ref={dialogRef}
        className="modal qa-reset-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qa-reset-title"
        aria-describedby="qa-reset-description"
        onKeyDown={handleDialogKeyDown}
        onSubmit={handleSubmit}
      >
        <div className="modal-heading qa-reset-heading">
          <div>
            <p className="eyebrow">Owner data maintenance</p>
            <h2 id="qa-reset-title" ref={headingRef} tabIndex="-1">Archive QA and demo records</h2>
            <p id="qa-reset-description">
              Review the current ledger set. Contractor.AI creates a verified local backup before applying one atomic archive operation.
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close QA archive dialog" disabled={busy} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="qa-reset-body">
          {loading ? (
            <div className="qa-reset-loading" role="status">
              <RefreshCw size={18} className="spin" aria-hidden="true" />
              <span>Checking the current QA and demo record set...</span>
            </div>
          ) : plan ? (
            <>
              <div className="qa-reset-counts" aria-label="Records included in this archive preview">
                <div><span>Jobs</span><strong>{counts.jobs || 0}</strong></div>
                <div><span>Opportunities</span><strong>{counts.opportunities || 0}</strong></div>
                <div><span>Workers</span><strong>{counts.workers || 0}</strong></div>
                <div><span>Equipment</span><strong>{counts.tools || 0}</strong></div>
                <div><span>Pending approvals</span><strong>{counts.approvals || 0}</strong></div>
              </div>

              {plan.samples?.length ? (
                <div className="qa-reset-samples">
                  <h3>Included records</h3>
                  <ul>
                    {plan.samples.map((record) => (
                      <li key={`${record.type}:${record.id}`}>
                        <span>{record.type}</span>
                        <strong>{record.label}</strong>
                      </li>
                    ))}
                  </ul>
                  {plan.totalRecords > plan.sampleLimit ? <small>Showing the first {plan.sampleLimit} of {plan.totalRecords} records.</small> : null}
                </div>
              ) : (
                <p className="qa-reset-empty" role="status">No eligible QA or demo records are currently active.</p>
              )}

              <div className="qa-reset-backup-note">
                <FolderArchive size={18} aria-hidden="true" />
                <p>
                  <strong>Recovery package required</strong>
                  <span>The archive starts only after a verified SQLite and evidence backup has been created.</span>
                </p>
              </div>

              <label className="qa-reset-reason">
                Maintenance reason
                <textarea
                  required
                  minLength="8"
                  maxLength="500"
                  rows="3"
                  disabled={!plan.totalRecords || busy}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value)
                    setValidationError('')
                  }}
                  placeholder="State why these QA or demo records should leave active operating queues."
                />
                <small>{reason.trim().length}/500 characters; at least 8 required.</small>
              </label>

              <label className="qa-reset-confirmation">
                Type {CONFIRMATION_PHRASE} to confirm
                <input
                  required
                  autoComplete="off"
                  disabled={!plan.totalRecords || busy}
                  value={confirmation}
                  onChange={(event) => {
                    setConfirmation(event.target.value)
                    setValidationError('')
                  }}
                />
              </label>
            </>
          ) : null}

          <p className="workflow-note qa-reset-boundary">
            Verified wins are excluded. This action does not delete retained evidence, send a message, spend money, or make an external commitment.
          </p>

          {decisionError ? (
            <div className="qa-reset-error" role="alert">
              <TriangleAlert size={17} aria-hidden="true" />
              <span>{decisionError}</span>
            </div>
          ) : null}
        </div>

        <div className="modal-actions qa-reset-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
          {!loading && (!plan || decisionError) ? (
            <button type="button" className="secondary-button" disabled={busy} onClick={onReload}>
              <RefreshCw size={16} />
              Refresh preview
            </button>
          ) : null}
          <button className="danger-button" disabled={submitDisabled}>
            <Archive size={16} />
            {busy ? 'Creating backup and archiving...' : `Archive ${plan?.totalRecords || 0} record(s)`}
          </button>
        </div>
      </form>
    </div>
  )
}
