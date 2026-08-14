import { useMemo, useState } from 'react'
import {
  Check,
  Copy,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { formatReadableDate } from '../dashboard-format'
import { operatorText } from '../operator-locale'
import Empty from './EmptyState'

const ROLE_LABELS = { owner: 'Owner', approver: 'Approver', office_operator: 'Office operator', field_worker: 'Field worker' }

function emptyDraft() {
  return { id: '', name: '', role: 'office_operator', workerId: '', jobIds: [] }
}

function readableDate(value, t) {
  if (!value) return t('Not used yet')
  return formatReadableDate(value, true) || t('Unknown')
}

function accessScope(account, workersById, jobsById, t) {
  if (account.role !== 'field_worker') return t('All role-permitted records')
  const worker = account.scope?.workerId ? workersById.get(account.scope.workerId) : null
  const workerLabel = worker ? worker.name : account.scope?.workerId
  const jobs = (account.scope?.jobIds || []).map((jobId) => jobsById.get(jobId)?.title || jobId)
  return [
    workerLabel ? t('Worker: {worker}', { worker: workerLabel }) : '',
    jobs.length ? t('Jobs: {jobs}', { jobs: jobs.join(', ') }) : '',
  ].filter(Boolean).join(' / ')
}

export default function TeamAccessControl({
  request,
  register,
  workers = [],
  jobs = [],
  onRegisterChange,
  onError,
  onNotice,
  locale = 'en-GB',
}) {
  const t = (key, variables) => operatorText(locale, key, variables)
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState(() => emptyDraft())
  const [pendingAction, setPendingAction] = useState(null)
  const [issuedAccess, setIssuedAccess] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const accounts = register?.accounts || []
  const summary = register?.summary || { total: accounts.length, active: 0, managed: 0, environment: 0 }
  const activeWorkers = useMemo(
    () => workers.filter((worker) => worker.status !== 'retired'),
    [workers],
  )
  const activeJobs = useMemo(
    () => jobs.filter((job) => !['archived', 'cancelled', 'canceled', 'closed', 'completed'].includes(job.status)),
    [jobs],
  )
  const workersById = useMemo(() => new Map(workers.map((worker) => [worker.id, worker])), [workers])
  const jobsById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs])

  function closeEditor() {
    if (busy) return
    setEditorOpen(false)
    setDraft(emptyDraft())
  }

  function closeIssuedAccess() {
    setIssuedAccess(null)
    setCopied(false)
  }

  async function createAccount(event) {
    event.preventDefault()
    setBusy(true)
    onError('')
    try {
      const result = await request('/api/operations/operators', {
        method: 'POST',
        body: JSON.stringify({
          id: draft.id.trim(),
          name: draft.name.trim(),
          role: draft.role,
          scope: draft.role === 'field_worker'
            ? { workerId: draft.workerId || null, jobIds: draft.jobIds }
            : null,
          confirmation: draft.role === 'owner' ? 'CREATE_OWNER_ACCESS' : undefined,
        }),
      })
      onRegisterChange(result.register)
      setIssuedAccess({ account: result.account, accessKey: result.accessKey, reason: 'created' })
      setEditorOpen(false)
      setDraft(emptyDraft())
      onNotice(t('{name} can now sign in as {role}.', {
        name: result.account.name,
        role: t(ROLE_LABELS[result.account.role] || result.account.role).toLocaleLowerCase(locale),
      }))
    } catch (error) {
      onError(t(error.message))
    } finally {
      setBusy(false)
    }
  }

  async function applyAccountAction() {
    if (!pendingAction) return
    const { mode, account } = pendingAction
    setBusy(true)
    onError('')
    try {
      const result = await request(`/api/operations/operators/${encodeURIComponent(account.id)}/${mode}`, {
        method: 'POST',
        body: JSON.stringify({
          confirmation: mode === 'rotate' ? 'ROTATE_OPERATOR_ACCESS' : 'DEACTIVATE_OPERATOR_ACCESS',
        }),
      })
      onRegisterChange(result.register)
      setPendingAction(null)
      if (mode === 'rotate') {
        setIssuedAccess({ account: result.account, accessKey: result.accessKey, reason: account.status === 'active' ? 'rotated' : 'reactivated' })
        onNotice(t('{name} received a new access key. Existing sessions were revoked.', { name: result.account.name }))
      } else {
        onNotice(t('{name} can no longer sign in. Existing sessions were revoked.', { name: result.account.name }))
      }
    } catch (error) {
      onError(t(error.message))
    } finally {
      setBusy(false)
    }
  }

  async function copyAccessKey() {
    if (!issuedAccess?.accessKey) return
    try {
      await navigator.clipboard.writeText(issuedAccess.accessKey)
      setCopied(true)
    } catch {
      const input = document.querySelector('[data-testid="issued-operator-access-key"]')
      input?.select()
      document.execCommand('copy')
      setCopied(true)
    }
  }

  return (
    <>
      <section className="panel page-panel team-access-panel" data-testid="team-access-control">
        <div className="panel-heading team-access-heading">
          <div>
            <h2>{t('Team access')}</h2>
            <p>{t('Named operator roles with immediate key rotation, revocation, and field scope.')}</p>
          </div>
          <button className="primary-button" onClick={() => setEditorOpen(true)}>
            <UserPlus size={16} />
            {t('Add operator')}
          </button>
        </div>
        <div className="team-access-summary" aria-label={t('Team access summary')}>
          <div><span>{t('Total')}</span><strong>{summary.total || 0}</strong></div>
          <div><span>{t('Active')}</span><strong>{summary.active || 0}</strong></div>
          <div><span>{t('Managed')}</span><strong>{summary.managed || 0}</strong></div>
          <div><span>{t('Deployment')}</span><strong>{summary.environment || 0}</strong></div>
        </div>
        {accounts.length ? (
          <div className="team-access-list">
            {accounts.map((account) => (
              <article className="team-access-row" key={`${account.source}-${account.id}`}>
                <span className="team-access-icon" aria-hidden="true">
                  {account.source === 'environment' ? <LockKeyhole size={16} /> : <Users size={16} />}
                </span>
                <div className="team-access-identity">
                  <div className="team-access-title">
                    <h3>{account.name || account.id}</h3>
                    <span className={`status ${account.status === 'active' ? 'status-ready' : 'status-attention'}`}>
                      {t(account.status)}
                    </span>
                  </div>
                  <p>{account.id} / {t(ROLE_LABELS[account.role] || account.role)}</p>
                  <small>{accessScope(account, workersById, jobsById, t)}</small>
                </div>
                <div className="team-access-meta">
                  <span>{account.source === 'environment' ? t('Deployment controlled') : t('Key version {version}', { version: account.keyVersion })}</span>
                  <small>{account.source === 'environment' ? t('Restart required to change') : readableDate(account.lastUsedAt, t)}</small>
                </div>
                <div className="team-access-actions">
                  {account.mutable ? (
                    <>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => setPendingAction({ mode: 'rotate', account })}
                      >
                        <RefreshCw size={15} />
                        {account.status === 'active' ? t('Rotate key') : t('Issue new key')}
                      </button>
                      {account.status === 'active' ? (
                        <button
                          className="danger-button"
                          disabled={busy}
                          onClick={() => setPendingAction({ mode: 'deactivate', account })}
                        >
                          <LockKeyhole size={15} />
                          {t('Deactivate')}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <span className="team-access-locked"><ShieldCheck size={15} /> {t('Protected')}</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty title={t('No named operators')} detail={t('Add the first managed operator for accountable access.')} />
        )}
      </section>

      {editorOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal team-access-modal" role="dialog" aria-modal="true" aria-labelledby="team-access-editor-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{t('Owner controlled')}</p>
                <h2 id="team-access-editor-title">{t('Add operator')}</h2>
                <p>{t('Create one named role and its initial sign-in key.')}</p>
              </div>
              <button className="icon-button" aria-label={t('Close operator editor')} onClick={closeEditor}><X size={18} /></button>
            </div>
            <form onSubmit={createAccount}>
              <fieldset className="form-fieldset" disabled={busy}>
                <div className="form-grid team-access-form">
                  <label>
                    {t('Operator ID')}
                    <input
                      required
                      minLength="2"
                      maxLength="80"
                      pattern="[A-Za-z0-9][A-Za-z0-9._:\-]{1,79}"
                      value={draft.id}
                      onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))}
                      placeholder="office-utrecht"
                    />
                  </label>
                  <label>
                    {t('Display name')}
                    <input
                      required
                      minLength="2"
                      maxLength="120"
                      value={draft.name}
                      onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    />
                  </label>
                  <div className="form-span team-access-input">
                    <label htmlFor="managed-operator-role">{t('Role')}</label>
                    <select
                      id="managed-operator-role"
                      value={draft.role}
                      onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value, workerId: '', jobIds: [] }))}
                    >
                      <option value="office_operator">{t('Office operator')}</option>
                      <option value="approver">{t('Approver')}</option>
                      <option value="field_worker">{t('Field worker')}</option>
                      <option value="owner">{t('Owner')}</option>
                    </select>
                  </div>
                  {draft.role === 'field_worker' ? (
                    <>
                      <div className="form-span team-access-input">
                        <label htmlFor="managed-operator-worker">{t('Worker identity')}</label>
                        <select
                          id="managed-operator-worker"
                          required={draft.jobIds.length === 0}
                          value={draft.workerId}
                          onChange={(event) => setDraft((current) => ({ ...current, workerId: event.target.value }))}
                        >
                          <option value="">{t('Select a worker or explicit jobs')}</option>
                          {activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
                        </select>
                      </div>
                      <fieldset className="team-access-job-scope form-span">
                        <legend>{t('Explicit job access')}</legend>
                        {activeJobs.length ? activeJobs.map((job) => (
                          <label className="checkbox-label" key={job.id}>
                            <input
                              type="checkbox"
                              checked={draft.jobIds.includes(job.id)}
                              onChange={(event) => setDraft((current) => ({
                                ...current,
                                jobIds: event.target.checked
                                  ? [...new Set([...current.jobIds, job.id])]
                                  : current.jobIds.filter((id) => id !== job.id),
                              }))}
                            />
                            {job.title}
                          </label>
                        )) : <p>{t('No active jobs available.')}</p>}
                      </fieldset>
                    </>
                  ) : null}
                </div>
                <div className="modal-actions">
                  <button type="button" className="secondary-button" onClick={closeEditor}>{t('Cancel')}</button>
                  <button className="primary-button" disabled={busy || (draft.role === 'field_worker' && !draft.workerId && draft.jobIds.length === 0)}>
                    <UserPlus size={16} />
                    {busy ? t('Creating...') : t('Create access')}
                  </button>
                </div>
              </fieldset>
            </form>
          </section>
        </div>
      ) : null}

      {pendingAction ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal team-access-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="team-access-confirm-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{t('Access change')}</p>
                <h2 id="team-access-confirm-title">
                  {pendingAction.mode === 'rotate' ? (pendingAction.account.status === 'active' ? t('Rotate access key') : t('Issue new access key')) : t('Deactivate operator')}
                </h2>
                <p>{pendingAction.account.name || pendingAction.account.id}</p>
              </div>
              <button className="icon-button" aria-label={t('Close access change')} disabled={busy} onClick={() => setPendingAction(null)}><X size={18} /></button>
            </div>
            <p className="team-access-confirm-copy">
              {pendingAction.mode === 'rotate'
                ? t('The current key and every active browser session will stop working immediately.')
                : t('The operator key and every active browser session will stop working immediately. The audit record remains.')}
            </p>
            <div className="modal-actions">
              <button className="secondary-button" disabled={busy} onClick={() => setPendingAction(null)}>{t('Cancel')}</button>
              <button className={pendingAction.mode === 'rotate' ? 'primary-button' : 'danger-button'} disabled={busy} onClick={applyAccountAction}>
                {pendingAction.mode === 'rotate' ? <KeyRound size={16} /> : <LockKeyhole size={16} />}
                {busy ? t('Applying...') : pendingAction.mode === 'rotate' ? t('Issue key') : t('Deactivate access')}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {issuedAccess ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal team-access-key-modal" role="dialog" aria-modal="true" aria-labelledby="team-access-key-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{t('Shown once')}</p>
                <h2 id="team-access-key-title">{t('Access key for {name}', { name: issuedAccess.account.name })}</h2>
                <p>{t('This key will disappear when this window closes.')}</p>
              </div>
            </div>
            <div className="team-access-key-body">
              <label>
                {t('Sign-in key')}
                <span className="team-access-key-field">
                  <input data-testid="issued-operator-access-key" readOnly value={issuedAccess.accessKey} onFocus={(event) => event.target.select()} />
                  <button className="icon-button" aria-label={t('Copy operator access key')} title={t('Copy access key')} onClick={copyAccessKey}>
                    {copied ? <Check size={17} /> : <Copy size={17} />}
                  </button>
                </span>
              </label>
              <p>{t('Give it directly to the named operator through an approved secure channel.')}</p>
            </div>
            <div className="modal-actions">
              <button className="primary-button" onClick={closeIssuedAccess}>
                <ShieldCheck size={16} />
                {t('I have stored the key')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
