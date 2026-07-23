const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-photo-evidence-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  const job = ledger.createIntake({
    title: 'Governed photographic evidence project',
    status: 'in_progress',
    client: { name: 'Evidence client' },
    assignAutomatically: false
  }, { actor: 'photo_evidence_test' });
  const worker = ledger.upsertWorker({
    id: 'photo-evidence-worker',
    name: 'Field Installer',
    role: 'Installer',
    status: 'available'
  }, { actor: 'photo_evidence_test' });
  const assignment = ledger.addAssignment(job.id, {
    workerId: worker.id,
    role: worker.role,
    status: 'planned'
  }, { actor: 'photo_evidence_test' });
  const task = ledger.addTask(job.id, {
    title: 'Install terrace waterproofing',
    status: 'in_progress',
    priority: 'high',
    assigneeId: worker.id
  }, { actor: 'photo_evidence_test' });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, job, worker, assignment, task };
}

function photo(ledger, jobId, suffix) {
  const contentHash = crypto.createHash('sha256').update(`photo-evidence-${suffix}`).digest('hex');
  return ledger.addDocument(jobId, {
    type: 'photo',
    title: `${suffix} waterproofing evidence`,
    filename: `${suffix}-waterproofing.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 128,
    storageRef: `2026-07/${suffix}-waterproofing.jpg`,
    status: 'stored',
    analysis: {
      category: 'governed_field_photo',
      upload: {
        storageRef: `2026-07/${suffix}-waterproofing.jpg`,
        mimeType: 'image/jpeg',
        size: 128,
        sha256: contentHash
      }
    }
  }, { actor: 'photo_evidence_test' });
}

function schedule(retained, entryKey = 'photo-evidence-schedule-0001') {
  return retained.ledger.createPhotoEvidenceSet(retained.job.id, {
    entryKey,
    taskId: retained.task.id,
    assignmentId: retained.assignment.id,
    assignedWorkerId: retained.worker.id,
    title: 'Terrace waterproofing photographic evidence',
    workLocation: 'Building A / terrace / drain outlet 03',
    requiredPhases: ['before', 'during', 'after'],
    notes: 'Show the substrate, membrane overlap, and finished outlet.'
  }, { actor: 'role:office_operator:planner' });
}

function capture(retained, set, phase, document, minutesAgo, entryKey) {
  return retained.ledger.recordPhotoEvidenceCapture(
    retained.job.id,
    set.id,
    document.id,
    {
      entryKey,
      phase,
      capturedAt: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
      caption: `${phase} condition at terrace drain outlet 03`,
      capturedByWorkerId: retained.worker.id
    },
    {
      actor: 'role:field_worker:photo-evidence-worker',
      workerId: retained.worker.id,
      enforceWorkerScope: true
    }
  );
}

test('photo evidence enforces task binding, phase sequence, immutable review, independent release, and task completion', t => {
  const retained = fixture(t);
  const set = schedule(retained);
  assert.equal(set.integrityValid, true);
  assert.equal(set.sourceCurrent, true);
  assert.deepEqual(set.missingPhases, ['before', 'during', 'after']);
  assert.equal(set.readyForTaskCompletion, false);
  assert.equal(schedule(retained).replayed, true);
  assert.throws(
    () => retained.ledger.createPhotoEvidenceSet(retained.job.id, {
      entryKey: 'photo-evidence-schedule-0001',
      taskId: retained.task.id,
      assignmentId: retained.assignment.id,
      assignedWorkerId: retained.worker.id,
      title: 'Changed evidence title',
      workLocation: 'Building A / terrace / drain outlet 03'
    }),
    error => error.code === 'photo_evidence_entry_key_conflict'
  );
  assert.throws(
    () => retained.ledger.transitionLifecycleRecord(retained.job.id, 'task', retained.task.id, {
      status: 'completed',
      notes: 'Attempted completion without evidence.'
    }),
    error => error.code === 'task_photo_evidence_hold'
  );

  const beforeDocument = photo(retained.ledger, retained.job.id, 'before');
  const duringDocument = photo(retained.ledger, retained.job.id, 'during');
  const afterDocument = photo(retained.ledger, retained.job.id, 'after');
  assert.throws(
    () => capture(retained, set, 'during', duringDocument, 2, 'photo-capture-during-early'),
    error => error.code === 'photo_evidence_sequence_invalid'
  );
  assert.throws(
    () => retained.ledger.recordPhotoEvidenceCapture(
      retained.job.id,
      set.id,
      beforeDocument.id,
      {
        entryKey: 'photo-capture-wrong-worker',
        phase: 'before',
        capturedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
        caption: 'Before condition at terrace drain outlet 03',
        capturedByWorkerId: 'another-worker'
      },
      {
        actor: 'role:field_worker:another-worker',
        workerId: 'another-worker',
        enforceWorkerScope: true
      }
    ),
    error => error.code === 'photo_evidence_worker_scope_forbidden'
  );

  const before = capture(retained, set, 'before', beforeDocument, 3, 'photo-capture-before-0001');
  assert.equal(before.capture.integrityValid, true);
  assert.equal(before.photoEvidenceSet.status, 'capturing');
  assert.equal(retained.ledger.recordPhotoEvidenceCapture(
    retained.job.id,
    set.id,
    beforeDocument.id,
    {
      entryKey: 'photo-capture-before-0001',
      phase: 'before',
      capturedAt: before.capture.capturedAt,
      caption: 'before condition at terrace drain outlet 03',
      capturedByWorkerId: retained.worker.id
    },
    {
      actor: 'role:field_worker:photo-evidence-worker',
      workerId: retained.worker.id,
      enforceWorkerScope: true
    }
  ).replayed, true);
  capture(retained, set, 'during', duringDocument, 2, 'photo-capture-during-0001');
  assert.throws(
    () => capture(retained, set, 'before', beforeDocument, 1, 'photo-capture-before-duplicate'),
    error => error.code === 'photo_evidence_phase_already_captured'
  );
  const completedSequence = capture(retained, set, 'after', afterDocument, 1, 'photo-capture-after-0001');
  assert.equal(completedSequence.photoEvidenceSet.status, 'captures_complete');
  assert.equal(completedSequence.photoEvidenceSet.complete, true);
  assert.deepEqual(completedSequence.photoEvidenceSet.captures.map(item => item.phase), ['before', 'during', 'after']);

  const review = retained.ledger.requestPhotoEvidenceReview(retained.job.id, set.id, {
    entryKey: 'photo-evidence-review-0001'
  }, { actor: 'role:office_operator:planner' });
  assert.equal(review.photoEvidenceSet.status, 'pending_review');
  assert.equal(review.photoEvidenceSet.reviewIntegrityValid, true);
  assert.equal(
    retained.ledger.requestPhotoEvidenceReview(retained.job.id, set.id, {
      entryKey: 'photo-evidence-review-0001'
    }, { actor: 'role:office_operator:planner' }).replayed,
    true
  );
  assert.throws(
    () => retained.ledger.resolveApproval(review.approval.id, {
      status: 'approved',
      resolvedBy: 'role:office_operator:planner',
      reason: 'Attempted self approval.'
    }, {
      actor: 'role:office_operator:planner',
      enforceSeparation: true
    }),
    error => error.code === 'photo_evidence_independent_approval_required'
  );

  const approval = retained.ledger.resolveApproval(review.approval.id, {
    status: 'approved',
    resolvedBy: 'role:approver:quality',
    reason: 'All three chronological, checksum-protected views independently verified.'
  }, {
    actor: 'role:approver:quality',
    enforceSeparation: true
  });
  const released = retained.ledger.getPhotoEvidenceSet(set.id, { jobId: retained.job.id });
  assert.equal(released.status, 'released');
  assert.equal(released.readyForTaskCompletion, true);
  assert.equal(retained.ledger.resolveApproval(review.approval.id, {
    status: 'approved'
  }).id, approval.id);
  const replayAfterRelease = retained.ledger.recordPhotoEvidenceCapture(
    retained.job.id,
    set.id,
    beforeDocument.id,
    {
      entryKey: 'photo-capture-before-0001',
      phase: 'before',
      capturedAt: before.capture.capturedAt,
      caption: 'before condition at terrace drain outlet 03',
      capturedByWorkerId: retained.worker.id
    },
    {
      actor: 'role:field_worker:photo-evidence-worker',
      workerId: retained.worker.id,
      enforceWorkerScope: true
    }
  );
  assert.equal(replayAfterRelease.replayed, true);
  assert.equal(replayAfterRelease.photoEvidenceSet.status, 'released');
  const completed = retained.ledger.transitionLifecycleRecord(retained.job.id, 'task', retained.task.id, {
    status: 'completed',
    notes: 'Work and governed photographic evidence independently released.'
  });
  assert.equal(completed.record.status, 'completed');
  assert.equal(retained.ledger.diagnose().valid, true);
});

test('rejected photo evidence restarts a new cycle and autonomy creates only an internal review task', t => {
  const retained = fixture(t);
  const set = schedule(retained, 'photo-evidence-schedule-rejection');
  capture(retained, set, 'before', photo(retained.ledger, retained.job.id, 'cycle-1-before'), 6, 'photo-cycle-1-before');
  capture(retained, set, 'during', photo(retained.ledger, retained.job.id, 'cycle-1-during'), 5, 'photo-cycle-1-during');
  capture(retained, set, 'after', photo(retained.ledger, retained.job.id, 'cycle-1-after'), 4, 'photo-cycle-1-after');
  const review = retained.ledger.requestPhotoEvidenceReview(retained.job.id, set.id, {
    entryKey: 'photo-evidence-review-rejection'
  }, { actor: 'role:office_operator:planner' });
  assert.throws(
    () => retained.ledger.resolveApproval(review.approval.id, {
      status: 'rejected',
      resolvedBy: 'role:approver:quality'
    }, {
      actor: 'role:approver:quality',
      enforceSeparation: true
    }),
    error => error.code === 'photo_evidence_approval_reason_required'
  );
  retained.ledger.resolveApproval(review.approval.id, {
    status: 'rejected',
    resolvedBy: 'role:approver:quality',
    reason: 'The membrane overlap is not visible in the during photograph.'
  }, {
    actor: 'role:approver:quality',
    enforceSeparation: true
  });
  assert.equal(retained.ledger.getPhotoEvidenceSet(set.id).status, 'rejected');
  assert.throws(
    () => capture(retained, set, 'during', photo(retained.ledger, retained.job.id, 'cycle-2-during-early'), 2, 'photo-cycle-2-during-early'),
    error => error.code === 'photo_evidence_new_cycle_before_required'
  );
  const restarted = capture(
    retained,
    set,
    'before',
    photo(retained.ledger, retained.job.id, 'cycle-2-before'),
    3,
    'photo-cycle-2-before'
  );
  assert.equal(restarted.photoEvidenceSet.currentCycle, 2);
  assert.deepEqual(restarted.photoEvidenceSet.missingPhases, ['during', 'after']);

  const preview = retained.ledger.runAutonomousCycle({
    dryRun: true,
    actionTypes: ['review_photo_evidence'],
    jobId: retained.job.id
  });
  assert.equal(preview.preview.filter(action => action.type === 'review_photo_evidence').length, 1);
  const first = retained.ledger.runAutonomousCycle({
    actionTypes: ['review_photo_evidence'],
    jobId: retained.job.id
  });
  const applied = first.applied.find(action => action.type === 'review_photo_evidence');
  assert.ok(applied);
  assert.equal(applied.externalCommitments, 0);
  assert.equal(retained.ledger.runAutonomousCycle({
    dryRun: true,
    actionTypes: ['review_photo_evidence'],
    jobId: retained.job.id
  }).preview.length, 0);
});

test('photo document checksum drift invalidates release and diagnostics', t => {
  const retained = fixture(t);
  const set = schedule(retained, 'photo-evidence-schedule-tamper');
  const beforeDocument = photo(retained.ledger, retained.job.id, 'tamper-before');
  capture(retained, set, 'before', beforeDocument, 3, 'photo-tamper-before');
  capture(retained, set, 'during', photo(retained.ledger, retained.job.id, 'tamper-during'), 2, 'photo-tamper-during');
  capture(retained, set, 'after', photo(retained.ledger, retained.job.id, 'tamper-after'), 1, 'photo-tamper-after');
  const review = retained.ledger.requestPhotoEvidenceReview(retained.job.id, set.id, {
    entryKey: 'photo-evidence-review-tamper'
  }, { actor: 'role:office_operator:planner' });
  retained.ledger.resolveApproval(review.approval.id, {
    status: 'approved',
    resolvedBy: 'role:approver:quality',
    reason: 'Source-current sequence independently verified before tamper test.'
  }, {
    actor: 'role:approver:quality',
    enforceSeparation: true
  });

  const row = retained.ledger.db.prepare('SELECT data_json FROM documents WHERE id = ?').get(beforeDocument.id);
  const data = JSON.parse(row.data_json);
  data.analysis.upload.sha256 = '0'.repeat(64);
  retained.ledger.db.prepare('UPDATE documents SET data_json = ? WHERE id = ?').run(JSON.stringify(data), beforeDocument.id);
  const invalid = retained.ledger.getPhotoEvidenceSet(set.id);
  assert.equal(invalid.captureIntegrityValid, false);
  assert.equal(invalid.readyForTaskCompletion, false);
  assert.equal(retained.ledger.diagnose().valid, false);
  assert.match(
    retained.ledger.diagnose().issues.map(issue => issue.message).join('\n'),
    /Photo-evidence set .* failed retained set or capture integrity/
  );
});

test('active photo evidence fails closed when its retained assignment is released', t => {
  const retained = fixture(t);
  const set = schedule(retained, 'photo-evidence-schedule-released-assignment');
  retained.ledger.releaseAssignment(retained.job.id, retained.assignment.id, {
    reason: 'Worker moved off the task before field capture.'
  }, { actor: 'photo_evidence_test' });

  assert.equal(retained.ledger.getPhotoEvidenceSet(set.id).sourceCurrent, false);
  assert.throws(
    () => capture(
      retained,
      set,
      'before',
      photo(retained.ledger, retained.job.id, 'released-assignment-before'),
      1,
      'photo-released-assignment-before'
    ),
    error => error.code === 'photo_evidence_source_stale'
  );
});
