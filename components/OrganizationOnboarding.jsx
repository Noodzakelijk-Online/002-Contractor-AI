import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Building2, Check, ChevronRight, MapPin, ReceiptEuro, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import { operatorText } from '../operator-locale'
import './OrganizationOnboarding.css'

const STEPS = [
  { key: 'identity', label: 'Identity', icon: Building2 },
  { key: 'contact', label: 'Contact', icon: MapPin },
  { key: 'billing', label: 'Billing', icon: ReceiptEuro },
  { key: 'review', label: 'Review', icon: ShieldCheck },
]

const MISSING_FIELD_STEPS = {
  legalName: 0,
  registrationNumber: 0,
  vatNumber: 0,
  address: 1,
  postalCode: 1,
  city: 1,
  country: 1,
  contact: 1,
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function validDays(value) {
  const days = Number(value)
  return Number.isInteger(days) && days >= 1 && days <= 365
}

export default function OrganizationOnboarding({ draft, organization, busy, onChange, onVatExemptChange, onSave, onClose, locale = 'en-GB' }) {
  const t = (key, variables) => operatorText(locale, key, variables)
  const [step, setStep] = useState(0)
  const [savedOrganization, setSavedOrganization] = useState(organization)
  const [statusMessage, setStatusMessage] = useState('')
  const dialogRef = useRef(null)
  const headingRef = useRef(null)

  const currentOrganization = savedOrganization || organization
  const readiness = currentOrganization?.readiness || { ready: false, missing: [] }
  const identityComplete = hasText(draft.legalName)
    && hasText(draft.registrationNumber)
    && (draft.vatExempt || hasText(draft.vatNumber))
  const contactComplete = hasText(draft.address)
    && hasText(draft.postalCode)
    && hasText(draft.city)
    && /^[A-Za-z]{2}$/.test(draft.country || '')
    && (hasText(draft.email) || hasText(draft.phone))
  const billingComplete = validDays(draft.defaultPaymentTermsDays)
    && validDays(draft.defaultQuoteValidityDays)
    && (hasText(draft.electronicAddressScheme) === hasText(draft.electronicAddress))
  const stepValid = [identityComplete, contactComplete, billingComplete, readiness.ready][step]
  const progressLabel = t('{current} of {total}', { current: step + 1, total: STEPS.length })

  const firstMissingStep = useMemo(() => {
    const mapped = readiness.missing
      ?.map((item) => MISSING_FIELD_STEPS[item.field])
      .find((value) => Number.isInteger(value))
    return Number.isInteger(mapped) ? mapped : 0
  }, [readiness.missing])

  useEffect(() => {
    setSavedOrganization(organization)
  }, [organization])

  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

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
      const target = event.shiftKey ? last : first
      target.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function saveAndContinue(event) {
    event.preventDefault()
    if (!stepValid || busy) return
    setStatusMessage('')
    const saved = await onSave()
    if (!saved) return
    setSavedOrganization(saved)
    setStatusMessage(t('{section} details saved to the operating ledger.', { section: t(STEPS[step].label) }))
    setStep((current) => Math.min(current + 1, STEPS.length - 1))
  }

  function renderStep() {
    if (step === 0) {
      return (
        <div className="onboarding-fields">
          <label>
            {t('Legal name')}
            <input required autoComplete="organization" value={draft.legalName} onChange={(event) => onChange('legalName', event.target.value)} />
          </label>
          <label>
            {t('Trading name')}
            <input value={draft.tradingName} onChange={(event) => onChange('tradingName', event.target.value)} />
          </label>
          <label>
            {t('Registration number')}
            <input
              required
              value={draft.registrationNumber}
              onChange={(event) => onChange('registrationNumber', event.target.value)}
              placeholder={t('KVK or national registry number')}
            />
          </label>
          <label>
            {t('VAT number')}
            <input
              required={!draft.vatExempt}
              disabled={draft.vatExempt}
              value={draft.vatNumber}
              onChange={(event) => onChange('vatNumber', event.target.value)}
            />
          </label>
          <label className="checkbox-label onboarding-wide">
            <input type="checkbox" checked={draft.vatExempt} onChange={(event) => onVatExemptChange(event.target.checked)} />
            {t('This legal entity is VAT exempt')}
          </label>
        </div>
      )
    }

    if (step === 1) {
      return (
        <div className="onboarding-fields">
          <label className="onboarding-wide">
            {t('Registered address')}
            <input required autoComplete="street-address" value={draft.address} onChange={(event) => onChange('address', event.target.value)} />
          </label>
          <label>
            {t('Postal code')}
            <input required autoComplete="postal-code" value={draft.postalCode} onChange={(event) => onChange('postalCode', event.target.value)} />
          </label>
          <label>
            {t('City')}
            <input required autoComplete="address-level2" value={draft.city} onChange={(event) => onChange('city', event.target.value)} />
          </label>
          <label>
            {t('Country code')}
            <input
              required
              maxLength="2"
              autoComplete="country"
              value={draft.country}
              onChange={(event) => onChange('country', event.target.value.toUpperCase())}
            />
          </label>
          <label>
            {t('Email')}
            <input type="email" autoComplete="email" value={draft.email} onChange={(event) => onChange('email', event.target.value)} />
          </label>
          <label>
            {t('Phone')}
            <input type="tel" autoComplete="tel" value={draft.phone} onChange={(event) => onChange('phone', event.target.value)} />
          </label>
          <label className="onboarding-wide">
            {t('Website')}
            <input type="url" autoComplete="url" value={draft.website} onChange={(event) => onChange('website', event.target.value)} placeholder="https://" />
          </label>
          {!hasText(draft.email) && !hasText(draft.phone) ? (
            <p className="onboarding-validation onboarding-wide" role="status">
              <TriangleAlert size={15} /> {t('Add an email address or phone number.')}
            </p>
          ) : null}
        </div>
      )
    }

    if (step === 2) {
      return (
        <div className="onboarding-fields">
          <label>
            {t('Electronic address scheme')}
            <input
              value={draft.electronicAddressScheme}
              onChange={(event) => onChange('electronicAddressScheme', event.target.value)}
              placeholder={t('0106 for KVK')}
            />
          </label>
          <label>
            {t('Electronic address')}
            <input
              value={draft.electronicAddress}
              onChange={(event) => onChange('electronicAddress', event.target.value)}
              placeholder={t('Peppol endpoint')}
            />
          </label>
          <label>
            IBAN
            <input autoComplete="off" value={draft.iban} onChange={(event) => onChange('iban', event.target.value)} />
          </label>
          <label>
            BIC
            <input autoComplete="off" value={draft.bic} onChange={(event) => onChange('bic', event.target.value)} />
          </label>
          <label>
            {t('Payment terms (days)')}
            <input
              required
              type="number"
              min="1"
              max="365"
              value={draft.defaultPaymentTermsDays}
              onChange={(event) => onChange('defaultPaymentTermsDays', event.target.value)}
            />
          </label>
          <label>
            {t('Quote validity (days)')}
            <input
              required
              type="number"
              min="1"
              max="365"
              value={draft.defaultQuoteValidityDays}
              onChange={(event) => onChange('defaultQuoteValidityDays', event.target.value)}
            />
          </label>
          <label className="onboarding-wide">
            {t('Quote terms')}
            <textarea
              value={draft.quoteTerms}
              onChange={(event) => onChange('quoteTerms', event.target.value)}
              placeholder={t('Commercial terms shown on new issue packages.')}
            />
          </label>
          {hasText(draft.electronicAddressScheme) !== hasText(draft.electronicAddress) ? (
            <p className="onboarding-validation onboarding-wide" role="status">
              <TriangleAlert size={15} /> {t('Enter both electronic address fields, or leave both empty.')}
            </p>
          ) : null}
        </div>
      )
    }

    return (
      <div className="onboarding-review">
        <div className={`onboarding-readiness ${readiness.ready ? 'onboarding-readiness-ready' : 'onboarding-readiness-attention'}`}>
          {readiness.ready ? <ShieldCheck size={20} /> : <TriangleAlert size={20} />}
          <div>
            <strong>{readiness.ready ? t('Business identity is issue ready') : t('Required details remain')}</strong>
            <p>
              {readiness.ready
                ? t('Controlled quote and invoice packages can now use this retained identity. Package approval and delivery remain separate decisions.')
                : t('{count} required item(s) still block commercial issue packages.', { count: readiness.missing.length })}
            </p>
          </div>
        </div>
        <dl className="onboarding-summary">
          <div><dt>{t('Legal entity')}</dt><dd>{currentOrganization?.legalName || t('Not retained')}</dd></div>
          <div><dt>{t('Registration')}</dt><dd>{currentOrganization?.registrationNumber || t('Not retained')}</dd></div>
          <div><dt>{t('Contact')}</dt><dd>{currentOrganization?.email || currentOrganization?.phone || t('Not retained')}</dd></div>
          <div><dt>{t('Registered office')}</dt><dd>{[currentOrganization?.address, currentOrganization?.postalCode, currentOrganization?.city].filter(Boolean).join(', ') || t('Not retained')}</dd></div>
          <div><dt>{t('Payment terms')}</dt><dd>{t('{count} days', { count: currentOrganization?.defaultPaymentTermsDays || 30 })}</dd></div>
          <div><dt>{t('Quote validity')}</dt><dd>{t('{count} days', { count: currentOrganization?.defaultQuoteValidityDays || 30 })}</dd></div>
        </dl>
        {!readiness.ready ? (
          <div className="onboarding-missing">
            <strong>{t('Still required')}</strong>
            <ul>{readiness.missing.map((item) => <li key={item.field}>{t(item.label)}</li>)}</ul>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="modal-backdrop onboarding-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="modal onboarding-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="organization-onboarding-title"
        aria-describedby="organization-onboarding-description"
        data-testid="organization-onboarding"
        onKeyDown={handleDialogKeyDown}
      >
        <div className="modal-heading onboarding-heading">
          <div>
            <p className="eyebrow">{t('Owner setup')}</p>
            <h2 id="organization-onboarding-title" ref={headingRef} tabIndex="-1">{t('Business identity')}</h2>
            <p id="organization-onboarding-description">{t('Save a reliable identity for controlled commercial documents.')}</p>
          </div>
          <button type="button" className="icon-button" aria-label={t('Close business setup')} disabled={busy} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <ol className="onboarding-steps" aria-label={t('Setup progress')}>
          {STEPS.map((item, index) => {
            const Icon = item.icon
            const complete = index < step
            return (
              <li key={item.key} className={index === step ? 'onboarding-step-active' : complete ? 'onboarding-step-complete' : ''} aria-current={index === step ? 'step' : undefined}>
                <span>{complete ? <Check size={14} /> : <Icon size={14} />}</span>
                <strong>{t(item.label)}</strong>
              </li>
            )
          })}
        </ol>
        <form className="onboarding-form" onSubmit={saveAndContinue} aria-busy={busy}>
          <fieldset disabled={busy}>
            <div className="onboarding-step-heading">
              <span>{t('Step {progress}', { progress: progressLabel })}</span>
              <h3>{step === 0 ? t('Legal identity') : step === 1 ? t('Office and contact') : step === 2 ? t('Billing defaults') : t('Confirm readiness')}</h3>
              <p>
                {step === 0
                  ? t('These details identify the contracting legal entity.')
                  : step === 1
                    ? t('Retain the registered office and at least one direct contact route.')
                    : step === 2
                      ? t('Set document and payment defaults. Electronic invoicing details are optional but must be entered as a pair.')
                      : t('Review the server-validated record before returning to operations.')}
              </p>
            </div>
            {statusMessage ? <p className="onboarding-save-status" role="status"><Check size={15} /> {statusMessage}</p> : null}
            {renderStep()}
            <div className="modal-actions onboarding-actions">
              {step > 0 ? (
                <button type="button" className="secondary-button" onClick={() => { setStatusMessage(''); setStep((current) => current - 1) }}>
                  <ArrowLeft size={16} /> {t('Back')}
                </button>
              ) : <span />}
              {step < STEPS.length - 1 ? (
                <button className="primary-button" disabled={!stepValid || busy}>
                  {busy ? t('Saving...') : t('Save and continue')} <ChevronRight size={16} />
                </button>
              ) : readiness.ready ? (
                <button type="button" className="primary-button" onClick={onClose}>
                  <Check size={16} /> {t('Finish setup')}
                </button>
              ) : (
                <button type="button" className="primary-button" onClick={() => setStep(firstMissingStep)}>
                  {t('Complete required details')} <ChevronRight size={16} />
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </section>
    </div>
  )
}
