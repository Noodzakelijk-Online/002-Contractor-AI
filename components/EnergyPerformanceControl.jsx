import { useMemo, useState } from 'react'
import { BadgeCheck, Building2, Plus, ShieldCheck, TriangleAlert } from 'lucide-react'
import { createFieldEvidenceDraftId } from '../field-outbox'
import { EMPTY_LIST, formatDate, formatStatus, shortHash } from '../dashboard-format'
import Empty from './EmptyState'

const CURRENT_STATUSES = new Set(['verified_compliant', 'verified_gap'])

function emptyDraft() {
  return {
    entryKey: createFieldEvidenceDraftId(),
    phase: 'permit_application',
    buildingUse: 'residential',
    buildingScope: 'building',
    objectReference: '',
    assessmentDate: new Date().toISOString().slice(0, 10),
    assessorName: '',
    assessorCredential: '',
    certifiedCompany: '',
    ntaVersion: '',
    softwareName: '',
    softwareVersion: '',
    epOnlineRegistration: '',
    labelClass: '',
    beng1Value: '',
    beng1Limit: '',
    beng2Value: '',
    beng2Limit: '',
    beng3Value: '',
    beng3Minimum: '',
    tojuliApplicable: false,
    tojuliValue: '',
    tojuliLimit: '',
    tojuliNotApplicableReason: '',
    evidenceReference: '',
    evidenceDocumentId: '',
    permitSourceRecordId: '',
    notes: '',
  }
}

function metricLabel(check) {
  if (check.comparison === 'not_applicable') return check.reason || 'Not applicable'
  const comparator = check.comparison === 'minimum' ? '>=' : '<='
  return `${check.value} ${comparator} ${check.threshold}`
}

export default function EnergyPerformanceControl({
  job,
  canCoordinate,
  canApprove,
  submitting,
  onSubmit,
  onOpenApprovals,
}) {
  const records = job.energyPerformanceRecords || EMPTY_LIST
  const evidenceDocuments = useMemo(
    () => (job.documents || EMPTY_LIST).filter((document) => (
      document.mimeType === 'application/pdf'
      && ['stored', 'needs_review', 'approved', 'current'].includes(document.status)
      && /^[a-f0-9]{64}$/i.test(document.data?.analysis?.upload?.sha256 || document.data?.contentHash || '')
    )),
    [job.documents],
  )
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)
  const currentRecord = records.find((record) => (
    CURRENT_STATUSES.has(record.status)
    && record.phase === draft.phase
    && record.buildingScope === draft.buildingScope
    && String(record.objectReference || '').toLowerCase() === draft.objectReference.trim().toLowerCase()
  )) || null
  const permitSources = records.filter((record) => (
    record.status === 'verified_compliant'
    && ['permit_application', 'wkb_notification'].includes(record.phase)
  ))
  const currentRecords = records.filter((record) => CURRENT_STATUSES.has(record.status))
  const pendingRecords = records.filter((record) => record.status === 'pending_approval')

  const ready = draft.objectReference.trim().length >= 2
    && draft.assessorName.trim().length >= 2
    && draft.assessorCredential.trim().length >= 3
    && draft.certifiedCompany.trim().length >= 2
    && draft.ntaVersion.trim().length >= 2
    && draft.softwareName.trim().length >= 2
    && draft.softwareVersion.trim().length >= 1
    && (!['permit_application', 'wkb_notification', 'final_label'].includes(draft.phase) || draft.epOnlineRegistration.trim().length >= 1)
    && (draft.phase !== 'final_label' || draft.labelClass.trim().length >= 1)
    && (draft.phase !== 'completion_verification' || Boolean(draft.permitSourceRecordId))
    && [draft.beng1Value, draft.beng1Limit, draft.beng2Value, draft.beng2Limit, draft.beng3Value, draft.beng3Minimum]
      .every((value) => value !== '' && Number.isFinite(Number(value)))
    && (!draft.tojuliApplicable || (
      draft.tojuliValue !== ''
      && draft.tojuliLimit !== ''
      && Number.isFinite(Number(draft.tojuliValue))
      && Number.isFinite(Number(draft.tojuliLimit))
    ))
    && (draft.tojuliApplicable || draft.tojuliNotApplicableReason.trim().length >= 8)
    && draft.evidenceReference.trim().length >= 4
    && Boolean(draft.evidenceDocumentId)

  function update(name, value) {
    setDraft((current) => ({ ...current, [name]: value }))
  }

  function openEditor() {
    setDraft(emptyDraft())
    setEditing(true)
  }

  async function submit(event) {
    event.preventDefault()
    const result = await onSubmit({
      ...draft,
      objectReference: draft.objectReference.trim(),
      assessorName: draft.assessorName.trim(),
      assessorCredential: draft.assessorCredential.trim(),
      certifiedCompany: draft.certifiedCompany.trim(),
      ntaVersion: draft.ntaVersion.trim(),
      softwareName: draft.softwareName.trim(),
      softwareVersion: draft.softwareVersion.trim(),
      epOnlineRegistration: draft.epOnlineRegistration.trim() || null,
      labelClass: draft.labelClass.trim() || null,
      beng1Value: Number(draft.beng1Value),
      beng1Limit: Number(draft.beng1Limit),
      beng2Value: Number(draft.beng2Value),
      beng2Limit: Number(draft.beng2Limit),
      beng3Value: Number(draft.beng3Value),
      beng3Minimum: Number(draft.beng3Minimum),
      tojuliValue: draft.tojuliApplicable ? Number(draft.tojuliValue) : null,
      tojuliLimit: draft.tojuliApplicable ? Number(draft.tojuliLimit) : null,
      tojuliNotApplicableReason: draft.tojuliApplicable ? null : draft.tojuliNotApplicableReason.trim(),
      evidenceReference: draft.evidenceReference.trim(),
      permitSourceRecordId: draft.phase === 'completion_verification' ? draft.permitSourceRecordId : null,
      supersedesRecordId: currentRecord?.id || null,
      notes: draft.notes.trim() || null,
    })
    if (result) {
      setDraft(emptyDraft())
      setEditing(false)
    }
  }

  return (
    <section className="job-workspace-section energy-performance-control" data-testid="energy-performance-control">
      <div className="section-heading">
        <Building2 size={18} />
        <div>
          <h3>BENG & energy performance</h3>
          <p>Retain adviser-issued NTA 8800 evidence and independently review declared BENG and TOjuli thresholds.</p>
        </div>
        {canCoordinate ? (
          <button type="button" className="secondary-button" onClick={openEditor} disabled={submitting}>
            <Plus size={15} />
            New record
          </button>
        ) : null}
      </div>

      <div className="energy-performance-summary">
        <div><span>Current</span><strong>{currentRecords.length}</strong></div>
        <div><span>Pending review</span><strong>{pendingRecords.length}</strong></div>
        <div><span>Threshold gaps</span><strong>{currentRecords.filter((record) => !record.outcome?.overallCompliant).length}</strong></div>
        <div><span>Source integrity</span><strong>{currentRecords.every((record) => record.integrityValid) ? 'Intact' : 'Attention'}</strong></div>
      </div>

      {editing ? (
        <form className="form-grid energy-performance-form" onSubmit={submit} data-testid="energy-performance-form">
          <label>
            Record phase
            <select value={draft.phase} onChange={(event) => update('phase', event.target.value)}>
              <option value="permit_application">Permit application</option>
              <option value="wkb_notification">Wkb notification</option>
              <option value="completion_verification">Completion verification</option>
              <option value="final_label">Final energy label</option>
            </select>
          </label>
          <label>
            Building use
            <select value={draft.buildingUse} onChange={(event) => update('buildingUse', event.target.value)}>
              <option value="residential">Residential</option>
              <option value="utility">Utility</option>
              <option value="mixed_use">Mixed use</option>
            </select>
          </label>
          <label>
            Assessment scope
            <select value={draft.buildingScope} onChange={(event) => update('buildingScope', event.target.value)}>
              <option value="building">Building</option>
              <option value="dwelling_unit">Dwelling unit</option>
            </select>
          </label>
          <label>
            Assessment date
            <input type="date" required value={draft.assessmentDate} onChange={(event) => update('assessmentDate', event.target.value)} />
          </label>
          <label className="form-span">
            Building / BAG / provisional / dwelling-unit reference
            <input required minLength="2" maxLength="160" value={draft.objectReference} onChange={(event) => update('objectReference', event.target.value)} placeholder="Pand-id, VBO-id, provisional id, or controlled project reference" />
          </label>

          <label>
            EP adviser
            <input required minLength="2" maxLength="160" value={draft.assessorName} onChange={(event) => update('assessorName', event.target.value)} />
          </label>
          <label>
            Adviser credential
            <input required minLength="3" maxLength="120" value={draft.assessorCredential} onChange={(event) => update('assessorCredential', event.target.value)} placeholder="Retained proof of competence number" />
          </label>
          <label>
            Certified company
            <input required minLength="2" maxLength="200" value={draft.certifiedCompany} onChange={(event) => update('certifiedCompany', event.target.value)} />
          </label>
          <label>
            NTA 8800 version
            <input required minLength="2" maxLength="80" value={draft.ntaVersion} onChange={(event) => update('ntaVersion', event.target.value)} placeholder="Version stated in the report" />
          </label>
          <label>
            Attested software
            <input required minLength="2" maxLength="120" value={draft.softwareName} onChange={(event) => update('softwareName', event.target.value)} />
          </label>
          <label>
            Software version
            <input required maxLength="80" value={draft.softwareVersion} onChange={(event) => update('softwareVersion', event.target.value)} />
          </label>
          {draft.phase === 'completion_verification' ? (
            <label className="form-span">
              Approved permit or Wkb source
              <select required value={draft.permitSourceRecordId} onChange={(event) => {
                const source = permitSources.find((record) => record.id === event.target.value)
                setDraft((current) => ({
                  ...current,
                  permitSourceRecordId: event.target.value,
                  buildingUse: source?.buildingUse || current.buildingUse,
                  buildingScope: source?.buildingScope || current.buildingScope,
                  objectReference: source?.objectReference || current.objectReference,
                  ntaVersion: source?.ntaVersion || current.ntaVersion,
                  softwareName: source?.softwareName || current.softwareName,
                  softwareVersion: source?.softwareVersion || current.softwareVersion,
                }))
              }}>
                <option value="">Select exact approved source</option>
                {permitSources.map((record) => (
                  <option key={record.id} value={record.id}>
                    {formatStatus(record.phase)} - {record.objectReference} - {record.softwareVersion}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {['permit_application', 'wkb_notification', 'final_label'].includes(draft.phase) ? (
            <label>
              EP-Online registration
              <input required maxLength="120" value={draft.epOnlineRegistration} onChange={(event) => update('epOnlineRegistration', event.target.value)} />
            </label>
          ) : null}
          {draft.phase === 'final_label' ? (
            <label>
              Energy-label class
              <input required maxLength="24" value={draft.labelClass} onChange={(event) => update('labelClass', event.target.value)} />
            </label>
          ) : null}

          <div className="energy-performance-indicators form-span">
            <label>BENG 1 value<input type="number" step="0.001" min="0" required value={draft.beng1Value} onChange={(event) => update('beng1Value', event.target.value)} /></label>
            <label>BENG 1 maximum<input type="number" step="0.001" min="0" required value={draft.beng1Limit} onChange={(event) => update('beng1Limit', event.target.value)} /></label>
            <label>BENG 2 value<input type="number" step="0.001" required value={draft.beng2Value} onChange={(event) => update('beng2Value', event.target.value)} /></label>
            <label>BENG 2 maximum<input type="number" step="0.001" required value={draft.beng2Limit} onChange={(event) => update('beng2Limit', event.target.value)} /></label>
            <label>BENG 3 value (%)<input type="number" step="0.001" required value={draft.beng3Value} onChange={(event) => update('beng3Value', event.target.value)} /></label>
            <label>BENG 3 minimum (%)<input type="number" step="0.001" required value={draft.beng3Minimum} onChange={(event) => update('beng3Minimum', event.target.value)} /></label>
          </div>
          <label className="checkbox-label form-span">
            <input type="checkbox" checked={draft.tojuliApplicable} onChange={(event) => update('tojuliApplicable', event.target.checked)} />
            TOjuli applies to this retained assessment
          </label>
          {draft.tojuliApplicable ? (
            <>
              <label>TOjuli value<input type="number" min="0" step="0.001" required value={draft.tojuliValue} onChange={(event) => update('tojuliValue', event.target.value)} /></label>
              <label>TOjuli maximum<input type="number" min="0" step="0.001" required value={draft.tojuliLimit} onChange={(event) => update('tojuliLimit', event.target.value)} /></label>
            </>
          ) : (
            <label className="form-span">
              TOjuli not-applicable reason
              <input required minLength="8" maxLength="500" value={draft.tojuliNotApplicableReason} onChange={(event) => update('tojuliNotApplicableReason', event.target.value)} />
            </label>
          )}
          <label className="form-span">
            Retained assessment PDF
            <select required value={draft.evidenceDocumentId} onChange={(event) => update('evidenceDocumentId', event.target.value)}>
              <option value="">Select checksummed PDF evidence</option>
              {evidenceDocuments.map((document) => <option key={document.id} value={document.id}>{document.title} ({document.filename || 'PDF'})</option>)}
            </select>
          </label>
          {!evidenceDocuments.length ? (
            <p className="workflow-note form-span">Upload the adviser-issued PDF to this job before retaining the energy-performance record.</p>
          ) : null}
          <label className="form-span">
            Evidence reference
            <input required minLength="4" maxLength="500" value={draft.evidenceReference} onChange={(event) => update('evidenceReference', event.target.value)} placeholder="Report number, issue, date, or controlled dossier reference" />
          </label>
          <label className="form-span">
            Review notes
            <textarea maxLength="2000" rows={3} value={draft.notes} onChange={(event) => update('notes', event.target.value)} />
          </label>
          {currentRecord ? (
            <p className="workflow-note form-span">Approval will supersede current record {shortHash(currentRecord.id)} for this exact phase and object.</p>
          ) : null}
          <p className="workflow-note form-span">
            Contractor.AI compares retained values with retained thresholds only. It does not calculate NTA 8800, certify legal compliance, register an energielabel, or submit to EP-Online.
          </p>
          <div className="form-actions form-span">
            <button type="button" className="secondary-button" onClick={() => setEditing(false)}>Cancel</button>
            <button className="primary-button" disabled={submitting || !ready}>
              <ShieldCheck size={15} />
              Retain for review
            </button>
          </div>
        </form>
      ) : null}

      {records.length ? (
        <div className="energy-performance-list">
          {records.map((record) => (
            <article className="energy-performance-record" key={record.id}>
              <div className="energy-performance-record-heading">
                <div>
                  {record.outcome?.overallCompliant ? <BadgeCheck size={17} /> : <TriangleAlert size={17} />}
                  <span>
                    <strong>{formatStatus(record.phase)} - {record.objectReference}</strong>
                  <small>{String(record.buildingScope || '').replaceAll('_', ' ')} - assessed {formatDate(record.assessmentDate)}</small>
                  </span>
                </div>
                <span className={`status status-${record.status}`}>{formatStatus(record.status)}</span>
              </div>
              <div className="energy-performance-checks">
                {(record.outcome?.checks || EMPTY_LIST).map((check) => (
                  <span className={`tag ${check.passes ? 'tag-green' : 'tag-red'}`} key={check.key}>
                    {check.label}: {metricLabel(check)}
                  </span>
                ))}
              </div>
              <dl className="energy-performance-meta">
                <div><dt>Adviser</dt><dd>{record.assessorName} / {record.assessorCredential}</dd></div>
                <div><dt>Method</dt><dd>{record.ntaVersion} - {record.softwareName} {record.softwareVersion}</dd></div>
                <div><dt>EP-Online</dt><dd>{record.epOnlineRegistration || 'Not applicable for this phase'}</dd></div>
                <div><dt>Evidence</dt><dd>{record.evidenceReference}</dd></div>
              </dl>
              {!record.integrityValid ? <p className="inline-alert">The retained source or immutable snapshot no longer verifies.</p> : null}
              {record.status === 'pending_approval' && canApprove ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onOpenApprovals({ jobId: job.id, jobTitle: job.title, approvalId: record.approvalId })}
                >
                  <ShieldCheck size={15} />
                  Review evidence
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <Empty icon={Building2} title="No energy-performance evidence" body="Retain the adviser-issued assessment when BENG, TOjuli, or final-label proof applies to this job." />
      )}
    </section>
  )
}
