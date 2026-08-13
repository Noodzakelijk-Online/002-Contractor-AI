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
import Empty from './EmptyState'

const ROLE_LABELS = {
  owner: 'Owner',
  approver: 'Approver',
  office_operator: 'Office operator',
  field_worker: 'Field worker',
}

function emptyDraft() {
  return { id: '', name: '', role: 'office_operator', workerId: '', jobIds: [] }
}

function readableDate(value) {
  if (!value) return 'Not used yet'
  return formatReadableDate(value, true) || 'Unknown'
}

function accessScope(account, workersById, jobsById) {
  if (account.role !== 'field_worker') return 'All role-permitted records'
  const worker = account.scope?.workerId ? workersById.get(account.scope.workerId) : null
  const workerLabel = worker ? worker.name : account.scope?.workerId
  const jobs = (account.scope?.jobIds || []).map((jobId) => jobsById.get(jobId)?.title || jobId)
  return [workerLabel ? `Worker: ${workerLabel}` : '', jobs.length ? `Jobs: ${jobs.join(', ')}` : ''].filter(Boolean).join(' / ')
}

export default function TeamAccessControl({
  request,
  register,
  workers = [],
  jobs = [],
  onRegisterChange,
  onError,
  onNotice,
}) {
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
      onNotice(`${result.account.name} can now sign in as ${ROLE_LABELS[result.account.role].toLowerCase()}.`)
    } catch (error) {
      onError(error.message)
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
        onNotice(`${result.account.name} received a new access key. Existing sessions were revoked.`)
      } else {
        onNotice(`${result.account.name} can no longer sign in. Existing sessions were revoked.`)
      }
    } catch (error) {
      onError(error.message)
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
            <h2>Team access</h2>
            <p>Named operator roles with immediate key rotation, revocation, and field scope.</p>
          </div>
          <button className="primary-button" onClick={() => setEditorOpen(true)}>
            <UserPlus size={16} />
            Add operator
          </button>
        </div>
        <div className="team-access-summary" aria-label="Team access summary">
          <div><span>Total</span><strong>{summary.total || 0}</strong></div>
          <div><span>Active</span><strong>{summary.active || 0}</strong></div>
          <div><span>Managed</span><strong>{summary.managed || 0}</strong></div>
          <div><span>Deployment</span><strong>{summary.environment || 0}</strong></div>
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
                      {account.status}
                    </span>
                  </div>
                  <p>{account.id} / {ROLE_LABELS[account.role] || account.role}</p>
                  <small>{accessScope(account, workersById, jobsById)}</small>
                </div>
                <div className="team-access-meta">
                  <span>{account.source === 'environment' ? 'Deployment controlled' : `Key version ${account.keyVersion}`}</span>
                  <small>{account.source === 'environment' ? 'Restart required to change' : readableDate(account.lastUsedAt)}</small>
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
                        {account.status === 'active' ? 'Rotate key' : 'Issue new key'}
                      </button>
                      {account.status === 'active' ? (
                        <button
                          className="danger-button"
                          disabled={busy}
                          onClick={() => setPendingAction({ mode: 'deactivate', account })}
                        >
                          <LockKeyhole size={15} />
                          Deactivate
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <span className="team-access-locked"><ShieldCheck size={15} /> Protected</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="No named operators" detail="Add the first managed operator for accountable access." />
        )}
      </section>

      {editorOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal team-access-modal" role="dialog" aria-modal="true" aria-labelledby="team-access-editor-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Owner controlled</p>
                <h2 id="team-access-editor-title">Add operator</h2>
                <p>Create one named role and its initial sign-in key.</p>
              </div>
              <button className="icon-button" aria-label="Close operator editor" onClick={closeEditor}><X size={18} /></button>
            </div>
            <form onSubmit={createAccount}>
              <fieldset className="form-fieldset" disabled={busy}>
                <div className="form-grid team-access-form">
                  <label>
                    Operator ID
                    <input
                      required
                      minLength="2"
                      maxLength="80"
                      pattern="[A-Za-z0-9][A-Za-z0-9._:-]{1,79}"
                      value={draft.id}
                      onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))}
                      placeholder="office-utrecht"
                    />
                  </label>
                  <label>
                    Display name
                    <input
                      required
                      minLength="2"
                      maxLength="120"
                      value={draft.name}
                      onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    />
                  </label>
                  <div className="form-span team-access-input">
                    <label htmlFor="managed-operator-role">Role</label>
                    <select
                      id="managed-operator-role"
                      value={draft.role}
                      onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value, workerId: '', jobIds: [] }))}
                    >
                      <option value="office_operator">Office operator</option>
                      <option value="approver">Approver</option>
                      <option value="field_worker">Field worker</option>
                      <option value="owner">Owner</option>
                    </select>
                  </div>
                  {draft.role === 'field_worker' ? (
                    <>
                      <div className="form-span team-access-input">
                        <label htmlFor="managed-operator-worker">Worker identity</label>
                        <select
                          id="managed-operator-worker"
                          required={draft.jobIds.length === 0}
                          value={draft.workerId}
                          onChange={(event) => setDraft((current) => ({ ...current, workerId: event.target.value }))}
                        >
                          <option value="">Select a worker or explicit jobs</option>
                          {activeWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
                        </select>
                      </div>
                      <fieldset className="team-access-job-scope form-span">
                        <legend>Explicit job access</legend>
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
                        )) : <p>No active jobs available.</p>}
                      </fieldset>
                    </>
                  ) : null}
                </div>
                <div className="modal-actions">
                  <button type="button" className="secondary-button" onClick={closeEditor}>Cancel</button>
                  <button className="primary-button" disabled={busy || (draft.role === 'field_worker' && !draft.workerId && draft.jobIds.length === 0)}>
                    <UserPlus size={16} />
                    {busy ? 'Creating...' : 'Create access'}
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
                <p className="eyebrow">Access change</p>
                <h2 id="team-access-confirm-title">
                  {pendingAction.mode === 'rotate' ? (pendingAction.account.status === 'active' ? 'Rotate access key' : 'Issue new access key') : 'Deactivate operator'}
                </h2>
                <p>{pendingAction.account.name || pendingAction.account.id}</p>
              </div>
              <button className="icon-button" aria-label="Close access change" disabled={busy} onClick={() => setPendingAction(null)}><X size={18} /></button>
            </div>
            <p className="team-access-confirm-copy">
              {pendingAction.mode === 'rotate'
                ? 'The current key and every active browser session will stop working immediately.'
                : 'The operator key and every active browser session will stop working immediately. The audit record remains.'}
            </p>
            <div className="modal-actions">
              <button className="secondary-button" disabled={busy} onClick={() => setPendingAction(null)}>Cancel</button>
              <button className={pendingAction.mode === 'rotate' ? 'primary-button' : 'danger-button'} disabled={busy} onClick={applyAccountAction}>
                {pendingAction.mode === 'rotate' ? <KeyRound size={16} /> : <LockKeyhole size={16} />}
                {busy ? 'Applying...' : pendingAction.mode === 'rotate' ? 'Issue key' : 'Deactivate access'}
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
                <p className="eyebrow">Shown once</p>
                <h2 id="team-access-key-title">Access key for {issuedAccess.account.name}</h2>
                <p>This key will disappear when this window closes.</p>
              </div>
            </div>
            <div className="team-access-key-body">
              <label>
                Sign-in key
                <span className="team-access-key-field">
                  <input data-testid="issued-operator-access-key" readOnly value={issuedAccess.accessKey} onFocus={(event) => event.target.select()} />
                  <button className="icon-button" aria-label="Copy operator access key" title="Copy access key" onClick={copyAccessKey}>
                    {copied ? <Check size={17} /> : <Copy size={17} />}
                  </button>
                </span>
              </label>
              <p>Give it directly to the named operator through an approved secure channel.</p>
            </div>
            <div className="modal-actions">
              <button className="primary-button" onClick={closeIssuedAccess}>
                <ShieldCheck size={16} />
                I have stored the key
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
