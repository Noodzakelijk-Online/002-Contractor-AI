import { useEffect, useRef, useState } from 'react'
import { Archive, FolderArchive, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { operatorText } from '../operator-locale'
import './QaResetDialog.css'

const CONFIRMATION_PHRASE = 'ARCHIVE QA'

export default function QaResetDialog({ plan, loading, busy, error, onClose, onReload, onSubmit, locale = 'en-GB' }) {
  const t = (key, variables) => operatorText(locale, key, variables)
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
      setValidationError(t('Record at least 8 characters explaining why these test records should be archived.'))
      return
    }
    if (confirmation.trim() !== CONFIRMATION_PHRASE) {
      setValidationError(t('Type {phrase} exactly to confirm this maintenance action.', { phrase: CONFIRMATION_PHRASE }))
      return
    }
    if (!plan?.planHash || !plan.totalRecords) {
      setValidationError(t('Load a current preview containing eligible QA or demo records before continuing.'))
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
            <p className="eyebrow">{t('Owner data maintenance')}</p>
            <h2 id="qa-reset-title" ref={headingRef} tabIndex="-1">{t('Archive QA and demo records')}</h2>
            <p id="qa-reset-description">
              {t('Review the current ledger set. Contractor.AI creates a verified local backup before applying one atomic archive operation.')}
            </p>
          </div>
          <button type="button" className="icon-button" aria-label={t('Close QA archive dialog')} disabled={busy} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="qa-reset-body">
          {loading ? (
            <div className="qa-reset-loading" role="status">
              <RefreshCw size={18} className="spin" aria-hidden="true" />
              <span>{t('Checking the current QA and demo record set...')}</span>
            </div>
          ) : plan ? (
            <>
              <div className="qa-reset-counts" aria-label={t('Records included in this archive preview')}>
                <div><span>{t('Jobs')}</span><strong>{counts.jobs || 0}</strong></div>
                <div><span>{t('Opportunities')}</span><strong>{counts.opportunities || 0}</strong></div>
                <div><span>{t('Workers')}</span><strong>{counts.workers || 0}</strong></div>
                <div><span>{t('Equipment')}</span><strong>{counts.tools || 0}</strong></div>
                <div><span>{t('Pending approvals')}</span><strong>{counts.approvals || 0}</strong></div>
              </div>

              {plan.samples?.length ? (
                <div className="qa-reset-samples">
                  <h3>{t('Included records')}</h3>
                  <ul>
                    {plan.samples.map((record) => (
                      <li key={`${record.type}:${record.id}`}>
                        <span>{t(record.type)}</span>
                        <strong>{record.label}</strong>
                      </li>
                    ))}
                  </ul>
                  {plan.totalRecords > plan.sampleLimit ? <small>{t('Showing the first {limit} of {total} records.', { limit: plan.sampleLimit, total: plan.totalRecords })}</small> : null}
                </div>
              ) : (
                <p className="qa-reset-empty" role="status">{t('No eligible QA or demo records are currently active.')}</p>
              )}

              <div className="qa-reset-backup-note">
                <FolderArchive size={18} aria-hidden="true" />
                <p>
                  <strong>{t('Recovery package required')}</strong>
                  <span>{t('The archive starts only after a verified SQLite and evidence backup has been created.')}</span>
                </p>
              </div>

              <label className="qa-reset-reason">
                {t('Maintenance reason')}
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
                  placeholder={t('State why these QA or demo records should leave active operating queues.')}
                />
                <small>{t('{count}/500 characters; at least 8 required.', { count: reason.trim().length })}</small>
              </label>

              <label className="qa-reset-confirmation">
                {t('Type {phrase} to confirm', { phrase: CONFIRMATION_PHRASE })}
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
            {t('Verified wins are excluded. This action does not delete retained evidence, send a message, spend money, or make an external commitment.')}
          </p>

          {decisionError ? (
            <div className="qa-reset-error" role="alert">
              <TriangleAlert size={17} aria-hidden="true" />
              <span>{decisionError}</span>
            </div>
          ) : null}
        </div>

        <div className="modal-actions qa-reset-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
          {!loading && (!plan || decisionError) ? (
            <button type="button" className="secondary-button" disabled={busy} onClick={onReload}>
              <RefreshCw size={16} />
              {t('Refresh preview')}
            </button>
          ) : null}
          <button className="danger-button" disabled={submitDisabled}>
            <Archive size={16} />
            {busy ? t('Creating backup and archiving...') : t('Archive {count} record(s)', { count: plan?.totalRecords || 0 })}
          </button>
        </div>
      </form>
    </div>
  )
}
