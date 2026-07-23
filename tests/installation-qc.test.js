const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-installation-qc-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  const job = ledger.createIntake({
    title: 'Governed installation project',
    status: 'in_progress',
    client: { name: 'Installation client' },
    assignAutomatically: false
  }, { actor: 'installation_qc_test' });
  const worker = ledger.upsertWorker({
    id: 'installation-worker',
    name: 'Installation Worker',
    role: 'Installer',
    status: 'available'
  }, { actor: 'installation_qc_test' });
  const otherWorker = ledger.upsertWorker({
    id: 'installation-worker-other',
    name: 'Independent Inspector',
    role: 'Quality lead',
    status: 'available'
  }, { actor: 'installation_qc_test' });
  const assignment = ledger.addAssignment(job.id, {
    workerId: worker.id,
    role: worker.role,
    status: 'planned'
  }, { actor: 'installation_qc_test' });
  const task = ledger.addTask(job.id, {
    title: 'Install facade cassette',
    status: 'in_progress',
    priority: 'high',
    assigneeId: worker.id
  }, { actor: 'installation_qc_test' });
  const evidence = ledger.addDocument(job.id, {
    title: 'Facade installation evidence',
    filename: 'facade-installation-evidence.jpg',
    documentType: 'quality_evidence',
    status: 'stored'
  }, { actor: 'installation_qc_test' });
  const template = ledger.createInspectionTemplate({
    name: 'Facade installation control',
    templateKey: 'facade_installation_control',
    inspectionType: 'installation_qc',
    discipline: 'quality',
    installationQc: true,
    defaultInstallationStage: 'pre_concealment',
    defaultControlPoint: 'hold',
    items: [
      {
        key: 'fixing_evidence',
        prompt: 'Fixing installation is retained before concealment',
        acceptanceCriteria: 'Every fixing is visible, correctly located, and traceable to the retained detail.',
        controlPoint: 'hold',
        evidenceRequired: true,
        failureSeverity: 'high'
      },
      {
        key: 'alignment_witness',
        prompt: 'Alignment and tolerance are independently witnessed',
        acceptanceCriteria: 'Measured alignment is within the retained tolerance.',
        controlPoint: 'witness',
        measurementRequired: true,
        measurementUnit: 'mm',
        failureSeverity: 'high'
      }
    ]
  }, { actor: 'installation_qc_test' });
  const capturedAt = new Date(Date.now() - 60 * 1000).toISOString();
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, job, worker, otherWorker, assignment, task, evidence, template, capturedAt };
}

function schedulePayload(fixtureValue, entryKey = 'installation-qc-schedule-0001') {
  return {
    templateId: fixtureValue.template.id,
    title: 'Facade cassette pre-concealment hold point',
    scheduledAt: '2026-07-23T08:00:00.000Z',
    entryKey,
    taskId: fixtureValue.task.id,
    assignmentId: fixtureValue.assignment.id,
    assignedWorkerId: fixtureValue.worker.id,
    workLocation: 'Building A / Level 2 / Grid C4',
    installationStage: 'pre_concealment',
    controlPoint: 'hold',
    referenceBasis: 'Approved facade detail A-401 rev C and manufacturer fixing instructions.',
    referenceDocumentIds: []
  };
}

function passingResponses(fixtureValue) {
  return [
    {
      itemKey: 'fixing_evidence',
      result: 'pass',
      evidenceDocumentIds: [fixtureValue.evidence.id]
    },
    {
      itemKey: 'alignment_witness',
      result: 'pass',
      observedValue: '2',
      witnessName: 'Independent Inspector',
      witnessRole: 'Quality lead'
    }
  ];
}

test('installation QC binds exact task, assignment, worker, references, and blocks task completion until independent release', t => {
  const retained = fixture(t);
  const scheduled = retained.ledger.createInspectionFromTemplate(
    retained.job.id,
    schedulePayload(retained),
    { actor: 'office:planner' }
  );
  assert.equal(scheduled.installationQc.integrityValid, true);
  assert.equal(scheduled.installationQc.sourceCurrent, true);
  assert.equal(scheduled.installationQc.controlPoint, 'hold');
  assert.equal(scheduled.installationQc.readyForTaskCompletion, false);
  assert.equal(retained.ledger.listInstallationQcControls({ jobId: retained.job.id }).length, 1);

  const replay = retained.ledger.createInspectionFromTemplate(
    retained.job.id,
    schedulePayload(retained),
    { actor: 'office:planner' }
  );
  assert.equal(replay.id, scheduled.id);
  assert.equal(replay.replayed, true);
  assert.throws(
    () => retained.ledger.createInspectionFromTemplate(retained.job.id, {
      ...schedulePayload(retained),
      workLocation: 'Building A / Level 3 / Grid C4'
    }),
    error => error.code === 'inspection_entry_key_conflict'
  );
  assert.throws(
    () => retained.ledger.transitionLifecycleRecord(retained.job.id, 'task', retained.task.id, {
      status: 'completed',
      notes: 'Installation complete.'
    }),
    error => error.code === 'task_installation_qc_hold'
  );
  assert.throws(
    () => retained.ledger.submitInspectionChecklist(retained.job.id, scheduled.id, {
      entryKey: 'installation-qc-submit-0001',
      responses: passingResponses(retained)
    }),
    error => error.code === 'installation_qc_capture_time_required'
  );
  assert.throws(
    () => retained.ledger.submitInspectionChecklist(retained.job.id, scheduled.id, {
      entryKey: 'installation-qc-submit-0002',
      capturedAt: retained.capturedAt,
      responses: passingResponses(retained)
    }, {
      actor: 'role:field_worker:installation-worker-other',
      workerId: retained.otherWorker.id,
      enforceWorkerScope: true
    }),
    error => error.code === 'installation_qc_worker_scope_forbidden'
  );
  assert.throws(
    () => retained.ledger.submitInspectionChecklist(retained.job.id, scheduled.id, {
      entryKey: 'installation-qc-submit-0003',
      capturedAt: retained.capturedAt,
      responses: passingResponses(retained).map(response =>
        response.itemKey === 'fixing_evidence' ? { ...response, evidenceDocumentIds: [] } : response
      )
    }, {
      actor: 'role:field_worker:installation-worker',
      workerId: retained.worker.id,
      enforceWorkerScope: true
    }),
    error => error.code === 'inspection_checklist_pass_evidence_required'
  );
  assert.throws(
    () => retained.ledger.submitInspectionChecklist(retained.job.id, scheduled.id, {
      entryKey: 'installation-qc-submit-0004',
      capturedAt: retained.capturedAt,
      responses: passingResponses(retained).map(response =>
        response.itemKey === 'alignment_witness' ? { ...response, observedValue: '', witnessName: '', witnessRole: '' } : response
      )
    }, {
      actor: 'role:field_worker:installation-worker',
      workerId: retained.worker.id,
      enforceWorkerScope: true
    }),
    error => error.code === 'inspection_checklist_measurement_required'
  );

  const submissionPayload = {
    entryKey: 'installation-qc-submit-0005',
    capturedAt: retained.capturedAt,
    notes: 'All retained installation acceptance criteria checked.',
    responses: passingResponses(retained)
  };
  const submitted = retained.ledger.submitInspectionChecklist(
    retained.job.id,
    scheduled.id,
    submissionPayload,
    {
      actor: 'role:field_worker:installation-worker',
      workerId: retained.worker.id,
      enforceWorkerScope: true
    }
  );
  assert.equal(submitted.submission.result, 'passed');
  assert.equal(submitted.inspection.installationQc.status, 'pending_review');
  assert.equal(
    retained.ledger.submitInspectionChecklist(retained.job.id, scheduled.id, submissionPayload, {
      actor: 'role:field_worker:installation-worker',
      workerId: retained.worker.id,
      enforceWorkerScope: true
    }).replayed,
    true
  );
  assert.throws(
    () => retained.ledger.resolveApproval(submitted.approval.id, {
      status: 'approved',
      resolvedBy: 'role:field_worker:installation-worker',
      reason: 'Attempted self approval.'
    }, {
      actor: 'role:field_worker:installation-worker',
      enforceSeparation: true
    }),
    error => error.code === 'installation_qc_independent_approval_required'
  );

  retained.ledger.resolveApproval(submitted.approval.id, {
    status: 'approved',
    resolvedBy: 'role:approver:quality',
    reason: 'Source, evidence, measurements, and witness identity independently verified.'
  }, {
    actor: 'role:approver:quality',
    enforceSeparation: true
  });
  const released = retained.ledger.getInstallationQcControl(scheduled.id);
  assert.equal(released.status, 'released');
  assert.equal(released.readyForTaskCompletion, true);
  const completed = retained.ledger.transitionLifecycleRecord(retained.job.id, 'task', retained.task.id, {
    status: 'completed',
    notes: 'Installation control released with retained evidence.'
  });
  assert.equal(completed.record.status, 'completed');
  assert.equal(retained.ledger.diagnose().valid, true);
});

test('failed installation QC retains corrective truth and requires approved closure before corrected release', t => {
  const retained = fixture(t);
  const scheduled = retained.ledger.createInspectionFromTemplate(
    retained.job.id,
    schedulePayload(retained, 'installation-qc-schedule-failure'),
    { actor: 'office:planner' }
  );
  const failed = retained.ledger.submitInspectionChecklist(retained.job.id, scheduled.id, {
    entryKey: 'installation-qc-submit-failure',
    capturedAt: retained.capturedAt,
    responses: [
      {
        itemKey: 'fixing_evidence',
        result: 'fail',
        notes: 'Two retained fixings are outside the approved edge distance.',
        evidenceDocumentIds: [retained.evidence.id]
      },
      {
        itemKey: 'alignment_witness',
        result: 'pass',
        observedValue: '2',
        witnessName: 'Independent Inspector',
        witnessRole: 'Quality lead'
      }
    ]
  }, { actor: 'role:field_worker:installation-worker' });
  retained.ledger.resolveApproval(failed.approval.id, {
    status: 'approved',
    resolvedBy: 'role:approver:quality',
    reason: 'Failed condition and corrective observation independently verified.'
  });
  assert.equal(retained.ledger.getInstallationQcControl(scheduled.id).status, 'failed');

  const corrected = retained.ledger.submitInspectionChecklist(retained.job.id, scheduled.id, {
    entryKey: 'installation-qc-submit-corrected',
    capturedAt: retained.capturedAt,
    notes: 'Fixings replaced and installation rechecked.',
    responses: passingResponses(retained)
  }, { actor: 'role:field_worker:installation-worker' });
  assert.throws(
    () => retained.ledger.resolveApproval(corrected.approval.id, {
      status: 'approved',
      resolvedBy: 'role:approver:quality',
      reason: 'Corrected installation reviewed.'
    }),
    error => error.code === 'installation_qc_open_corrective_observations'
  );

  const observation = failed.observations[0];
  const closure = retained.ledger.transitionLifecycleRecord(retained.job.id, 'observation', observation.id, {
    status: 'closed',
    notes: 'Replacement fixings and edge distances verified.',
    evidence: [retained.evidence.id]
  }, { actor: 'role:office_operator:quality' });
  assert.equal(closure.approvalRequired, true);
  retained.ledger.resolveApproval(closure.approval.id, {
    status: 'approved',
    resolvedBy: 'role:approver:quality-manager',
    reason: 'Corrective evidence independently verified.'
  });
  retained.ledger.resolveApproval(corrected.approval.id, {
    status: 'approved',
    resolvedBy: 'role:approver:quality',
    reason: 'Corrected installation, retained evidence, and closed observation verified.'
  });
  const released = retained.ledger.getInstallationQcControl(scheduled.id);
  assert.equal(released.status, 'released');
  assert.equal(released.openCorrectiveObservationIds.length, 0);
  assert.equal(released.readyForTaskCompletion, true);
  assert.deepEqual(
    retained.ledger.listInspectionChecklistSubmissions({ inspectionId: scheduled.id }).map(item => item.status),
    ['passed', 'failed']
  );
});

test('installation QC source drift is fail-closed and autonomy creates only one internal review task', t => {
  const retained = fixture(t);
  const scheduled = retained.ledger.createInspectionFromTemplate(
    retained.job.id,
    schedulePayload(retained, 'installation-qc-schedule-stale'),
    { actor: 'office:planner' }
  );
  const submitted = retained.ledger.submitInspectionChecklist(retained.job.id, scheduled.id, {
    entryKey: 'installation-qc-submit-stale',
    capturedAt: retained.capturedAt,
    responses: passingResponses(retained)
  }, { actor: 'role:field_worker:installation-worker' });
  retained.ledger.upsertWorker({
    id: retained.worker.id,
    name: retained.worker.name,
    role: retained.worker.role,
    status: 'inactive'
  }, { actor: 'office:resource-control' });
  assert.equal(retained.ledger.getInstallationQcControl(scheduled.id).sourceCurrent, false);
  assert.throws(
    () => retained.ledger.resolveApproval(submitted.approval.id, {
      status: 'approved',
      resolvedBy: 'role:approver:quality',
      reason: 'Source is no longer current.'
    }),
    error => error.code === 'installation_qc_source_stale'
  );

  const preview = retained.ledger.runAutonomousCycle({
    dryRun: true,
    actionTypes: ['review_installation_qc'],
    jobIds: [retained.job.id]
  });
  assert.equal(preview.preview.filter(action => action.type === 'review_installation_qc').length, 1);
  const first = retained.ledger.runAutonomousCycle({
    actionTypes: ['review_installation_qc'],
    jobIds: [retained.job.id]
  });
  const applied = first.applied.find(action => action.type === 'review_installation_qc');
  assert.ok(applied);
  assert.equal(applied.holdReleased, false);
  assert.equal(applied.externalCommitments, 0);
  const task = retained.ledger.getJobDetail(retained.job.id).tasks.find(candidate => candidate.id === applied.taskId);
  assert.equal(task.data.internalOnly, true);
  assert.equal(task.data.holdReleased, false);
  assert.equal(retained.ledger.runAutonomousCycle({
    actionTypes: ['review_installation_qc'],
    jobIds: [retained.job.id]
  }).applied.length, 0);

  retained.ledger.db.prepare("UPDATE installation_qc_controls SET snapshot_hash = 'tampered' WHERE inspection_id = ?")
    .run(scheduled.id);
  const diagnostics = retained.ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => issue.message.includes(`Installation QC control ${scheduled.id}`)));
});
