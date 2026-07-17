const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-inspection-checklist-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  const ledger = new ContractorOperatingLedger({ dbFile });
  const job = ledger.createIntake({
    title: 'Inspection checklist fixture',
    status: 'planned',
    client: { name: 'Inspection client' }
  }, { actor: 'inspection_test' });
  t.after(() => {
    try {
      ledger.close();
    } catch (error) {
      if (error.code !== 'ERR_INVALID_STATE') throw error;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, dbFile, ledger, job };
}

function customTemplate(ledger, overrides = {}) {
  return ledger.createInspectionTemplate({
    name: 'Facade quality hold point',
    templateKey: 'facade_quality_hold_point',
    inspectionType: 'quality_hold_point',
    discipline: 'quality',
    items: [
      {
        key: 'substrate',
        prompt: 'Substrate is clean, dry, and within tolerance',
        required: true,
        allowNotApplicable: false,
        failureSeverity: 'high'
      },
      {
        key: 'fixings',
        prompt: 'Fixings match the approved setting-out record',
        required: true,
        allowNotApplicable: true,
        failureSeverity: 'medium'
      }
    ],
    ...overrides
  }, { actor: 'office:test' });
}

function answersFor(inspection, failedKey = null) {
  return inspection.checklist.snapshot.items.map(item => ({
    itemKey: item.key,
    result: item.key === failedKey ? 'fail' : 'pass',
    notes: item.key === failedKey ? 'Fixing spacing differs from the retained drawing.' : ''
  }));
}

test('inspection templates are versioned while scheduled checklists retain an immutable snapshot', t => {
  const { ledger, job } = fixture(t);
  const builtIns = ledger.listInspectionTemplates().filter(template => template.builtIn);
  assert.equal(builtIns.length, 3);
  assert.ok(builtIns.every(template => template.versionNumber === 1 && template.items.length >= 2));
  assert.throws(
    () => customTemplate(ledger, { sourceTemplateId: builtIns[0].id }),
    error => error.code === 'inspection_template_builtin_immutable'
  );

  const versionOne = customTemplate(ledger);
  const inspection = ledger.createInspectionFromTemplate(job.id, {
    templateId: versionOne.id,
    title: 'West elevation hold point',
    scheduledAt: '2026-07-16T08:00:00.000Z',
    entryKey: 'inspection-schedule-0001'
  }, { actor: 'office:test' });
  assert.equal(inspection.status, 'scheduled');
  assert.equal(inspection.checklist.integrityValid, true);
  assert.equal(inspection.checklist.snapshot.templateVersion, 1);
  assert.equal(inspection.checklist.snapshot.items[0].prompt, versionOne.items[0].prompt);

  const replay = ledger.createInspectionFromTemplate(job.id, {
    templateId: versionOne.id,
    title: 'West elevation hold point',
    entryKey: 'inspection-schedule-0001'
  }, { actor: 'office:test' });
  assert.equal(replay.id, inspection.id);
  assert.equal(replay.replayed, true);

  const versionTwo = customTemplate(ledger, {
    sourceTemplateId: versionOne.id,
    name: 'Facade quality hold point revised',
    items: [
      ...versionOne.items,
      { key: 'sealant', prompt: 'Sealant batch and primer records are retained', required: true, failureSeverity: 'medium' }
    ]
  });
  assert.equal(versionTwo.versionNumber, 2);
  assert.equal(ledger.listInspectionTemplates().some(template => template.id === versionOne.id), false);
  assert.equal(ledger.listInspectionTemplates({ includeSuperseded: true }).find(template => template.id === versionOne.id).status, 'superseded');
  const retained = ledger.getJobDetail(job.id).inspections.find(record => record.id === inspection.id);
  assert.equal(retained.checklist.snapshot.templateVersion, 1);
  assert.equal(retained.checklist.snapshot.items.length, 2);
  assert.equal(retained.checklist.integrityValid, true);
});

test('failed checklist submission is exact-replay safe and creates approval-backed corrective observations', t => {
  const { ledger, job } = fixture(t);
  const template = customTemplate(ledger);
  const inspection = ledger.createInspectionFromTemplate(job.id, {
    templateId: template.id,
    entryKey: 'inspection-schedule-0002'
  });
  const foreignJob = ledger.createIntake({ title: 'Foreign evidence job', client: { name: 'Other client' } });
  const foreignDocument = ledger.addDocument(foreignJob.id, { title: 'Other job photograph', filename: 'other.jpg' });

  assert.throws(
    () => ledger.submitInspectionChecklist(job.id, inspection.id, {
      entryKey: 'inspection-submit-missing-0001',
      responses: [{ itemKey: 'substrate', result: 'pass' }]
    }),
    error => error.code === 'inspection_checklist_required_items_missing'
  );
  assert.throws(
    () => ledger.submitInspectionChecklist(job.id, inspection.id, {
      entryKey: 'inspection-submit-failure-0001',
      responses: answersFor(inspection).map((response, index) => index === 0 ? { ...response, result: 'fail', notes: '' } : response)
    }),
    error => error.code === 'inspection_checklist_failure_evidence_required'
  );
  assert.throws(
    () => ledger.submitInspectionChecklist(job.id, inspection.id, {
      entryKey: 'inspection-submit-foreign-0001',
      responses: answersFor(inspection).map((response, index) => index === 0
        ? { ...response, result: 'fail', notes: '', evidenceDocumentIds: [foreignDocument.id] }
        : response)
    }),
    error => error.code === 'inspection_checklist_evidence_not_found'
  );

  const payload = {
    entryKey: 'inspection-submit-0001',
    notes: 'West elevation checked before closure.',
    responses: answersFor(inspection, 'substrate')
  };
  const submitted = ledger.submitInspectionChecklist(job.id, inspection.id, payload, { actor: 'role:field_worker:inspector-1' });
  assert.equal(submitted.replayed, false);
  assert.equal(submitted.inspection.status, 'pending_approval');
  assert.equal(submitted.submission.status, 'pending_approval');
  assert.equal(submitted.submission.result, 'failed');
  assert.equal(submitted.submission.integrityValid, true);
  assert.equal(submitted.submission.responseCount, template.items.length);
  assert.equal(submitted.submission.failedCount, 1);
  assert.equal(submitted.observations.length, 1);
  assert.equal(submitted.observations[0].severity, 'high');
  assert.equal(submitted.observations[0].data.sourceInspectionId, inspection.id);
  assert.equal(submitted.observations[0].data.sourceChecklistSubmissionId, submitted.submission.id);
  assert.equal(submitted.approval.targetType, 'inspection_record');
  assert.equal(submitted.approval.data.checklistSubmissionId, submitted.submission.id);

  const replay = ledger.submitInspectionChecklist(job.id, inspection.id, payload, { actor: 'role:field_worker:inspector-1' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.submission.id, submitted.submission.id);
  assert.equal(replay.observations.length, 1);
  assert.equal(ledger.listInspectionChecklistSubmissions({ inspectionId: inspection.id }).length, 1);
  assert.throws(
    () => ledger.submitInspectionChecklist(job.id, inspection.id, {
      ...payload,
      notes: 'Changed content cannot reuse the retained retry key.'
    }),
    error => error.code === 'inspection_checklist_entry_key_conflict'
  );

  ledger.resolveApproval(submitted.approval.id, {
    status: 'approved',
    resolvedBy: 'owner:test',
    reason: 'Failed item, evidence note, and corrective observation verified.'
  });
  const approved = ledger.getJobDetail(job.id).inspections.find(record => record.id === inspection.id);
  assert.equal(approved.status, 'failed');
  assert.equal(approved.checklist.status, 'failed');
  assert.equal(approved.checklist.submissions[0].status, 'failed');
  assert.equal(ledger.diagnose().valid, true);
});

test('rejected checklist restores the inspection and permits a corrected approval-backed resubmission', t => {
  const { ledger, job } = fixture(t);
  const template = customTemplate(ledger);
  const inspection = ledger.createInspectionFromTemplate(job.id, {
    templateId: template.id,
    entryKey: 'inspection-schedule-0003'
  });
  const failed = ledger.submitInspectionChecklist(job.id, inspection.id, {
    entryKey: 'inspection-submit-0002',
    responses: answersFor(inspection, 'fixings')
  });
  ledger.resolveApproval(failed.approval.id, {
    status: 'rejected',
    resolvedBy: 'owner:test',
    reason: 'Correction must be verified through a new retained checklist submission.'
  });

  let restored = ledger.getJobDetail(job.id).inspections.find(record => record.id === inspection.id);
  assert.equal(restored.status, 'scheduled');
  assert.equal(restored.approvalId, null);
  assert.equal(restored.checklist.status, 'rejected');
  assert.equal(restored.checklist.submissions[0].status, 'rejected');

  const corrected = ledger.submitInspectionChecklist(job.id, inspection.id, {
    entryKey: 'inspection-submit-0003',
    notes: 'Fixing spacing corrected and rechecked.',
    responses: answersFor(inspection)
  });
  assert.equal(corrected.submission.result, 'passed');
  assert.equal(corrected.observations.length, 0);
  ledger.resolveApproval(corrected.approval.id, {
    status: 'approved',
    resolvedBy: 'owner:test',
    reason: 'Corrected work and complete checklist verified.'
  });
  restored = ledger.getJobDetail(job.id).inspections.find(record => record.id === inspection.id);
  assert.equal(restored.status, 'passed');
  assert.deepEqual(restored.checklist.submissions.map(submission => submission.status), ['passed', 'rejected']);
  assert.equal(ledger.diagnose().valid, true);
});

test('migration 025 restores checklist schema and diagnostics detect retained snapshot tampering', t => {
  const { dbFile, ledger, job } = fixture(t);
  const template = customTemplate(ledger);
  const inspection = ledger.createInspectionFromTemplate(job.id, {
    templateId: template.id,
    entryKey: 'inspection-schedule-0004'
  });
  const submitted = ledger.submitInspectionChecklist(job.id, inspection.id, {
    entryKey: 'inspection-submit-0004',
    responses: answersFor(inspection)
  });
  ledger.db.prepare("UPDATE inspection_checklist_submissions SET snapshot_json = '{}' WHERE id = ?").run(submitted.submission.id);
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => /inspection checklist submission.*snapshot verification/i.test(issue.message)));
  ledger.close();

  const oldSchema = new DatabaseSync(dbFile);
  oldSchema.exec(`
    DROP TABLE inspection_checklist_submissions;
    DROP TABLE inspection_templates;
    DELETE FROM ledger_schema_migrations WHERE version = '025_inspection_checklists';
  `);
  oldSchema.close();

  const upgraded = new ContractorOperatingLedger({ dbFile });
  try {
    assert.equal(upgraded.migrationStatus().currentVersion, '045_governed_pre_task_plans');
    assert.equal(upgraded.migrationStatus().pending.length, 0);
    assert.equal(upgraded.listInspectionTemplates().filter(candidate => candidate.builtIn).length, 3);
    for (const table of ['inspection_templates', 'inspection_checklist_submissions']) {
      assert.ok(upgraded.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
    }
    for (const index of ['idx_inspection_templates_current', 'idx_inspection_checklist_inspection', 'idx_inspection_checklist_job', 'idx_inspection_checklist_approval']) {
      assert.ok(upgraded.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(index));
    }
  } finally {
    upgraded.close();
  }
});
