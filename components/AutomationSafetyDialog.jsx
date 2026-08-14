import { useEffect, useRef, useState } from 'react'
import { Activity, Ban, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import { operatorText } from '../operator-locale'
import './AutomationSafetyDialog.css'

export default function AutomationSafetyDialog({ suspend, control, busy, error, onClose, onSubmit, locale = 'en-GB' }) {
  const t = (key, variables) => operatorText(locale, key, variables)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [validationError, setValidationError] = useState('')
  const dialogRef = useRef(null)
  const headingRef = useRef(null)
  const title = suspend ? t('Suspend autonomous drafting') : t('Resume autonomous drafting')

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
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      setValidationError(t('Record at least 8 characters explaining this operational control decision.'))
      return
    }
    if (!confirmed) {
      setValidationError(t('Confirm that you understand the effect of this decision.'))
      return
    }
    setValidationError('')
    await onSubmit(trimmedReason)
  }

  const submitDisabled = busy || reason.trim().length < 8 || !confirmed
  const decisionError = validationError || error

  return (
    <div className="modal-backdrop automation-control-backdrop" role="presentation">
      <form
        ref={dialogRef}
        className={`modal automation-control-dialog ${suspend ? 'automation-control-dialog-danger' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="automation-control-title"
        aria-describedby="automation-control-description"
        onKeyDown={handleDialogKeyDown}
        onSubmit={handleSubmit}
      >
        <div className="modal-heading automation-control-heading">
          <div>
            <p className="eyebrow">{t('Owner safety control')}</p>
            <h2 id="automation-control-title" ref={headingRef} tabIndex="-1">
              {title}
            </h2>
            <p id="automation-control-description">
              {suspend
                ? t('Stop manual command plans and scheduled autonomous drafting without interrupting direct operator work.')
                : t('Restore internal drafting only after reviewing the current operating-ledger state.')}
            </p>
          </div>
          <button type="button" className="icon-button" aria-label={t('Close {title} dialog', { title: title.toLocaleLowerCase(locale) })} disabled={busy} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="automation-control-body">
          <div className="automation-control-context" aria-label={t('Current automation control')}>
            <div>
              <span>{t('Current status')}</span>
              <strong>{control?.suspended ? t('Suspended') : t('Active')}</strong>
            </div>
            <div>
              <span>{t('Control revision')}</span>
              <strong>{control?.revision ?? 0}</strong>
            </div>
          </div>

          {control?.reason ? (
            <div className="automation-control-current-reason">
              <ShieldCheck size={17} aria-hidden="true" />
              <p>
                <strong>{t('Retained reason')}</strong>
                <span>{control.reason}</span>
              </p>
            </div>
          ) : null}

          <label className="automation-control-reason">
            {t('Decision reason')}
            <textarea
              required
              minLength="8"
              maxLength="500"
              rows="4"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                setValidationError('')
              }}
              placeholder={
                suspend
                  ? t('Describe the risk, incident, or operating condition requiring the safety stop.')
                  : t('Describe the checks completed and why internal drafting can safely resume.')
              }
            />
            <small>{t('{count}/500 characters; at least 8 required.', { count: reason.trim().length })}</small>
          </label>

          <label className="automation-control-confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => {
                setConfirmed(event.target.checked)
                setValidationError('')
              }}
            />
            <span>
              {suspend
                ? t('I understand this stops manual and scheduled autonomous drafting.')
                : t('I verified the retained reason and current ledger readiness before resuming.')}
            </span>
          </label>

          <p className="workflow-note automation-control-boundary">
            {t('External communication, supplier spend, schedule commitments, and finance actions remain approval-gated regardless of this setting.')}
          </p>

          {decisionError ? (
            <div className="automation-control-error" role="alert">
              <TriangleAlert size={17} />
              <span>{decisionError}</span>
            </div>
          ) : null}
        </div>

        <div className="modal-actions automation-control-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className={suspend ? 'danger-button' : 'primary-button'} disabled={submitDisabled}>
            {suspend ? <Ban size={16} /> : <Activity size={16} />}
            {busy ? t('Recording decision...') : title}
          </button>
        </div>
      </form>
    </div>
  )
}
