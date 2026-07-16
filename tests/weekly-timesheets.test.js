const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function previousMonday(offsetWeeks = 1) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1 - offsetWeeks * 7);
  return date.toISOString().slice(0, 10);
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function fixture(t, suffix = '') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-timesheet-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  const worker = ledger.upsertWorker({ name: `=Weekly Worker${suffix}`, role: 'Installer', status: 'available', hourlyRate: 42 }, { actor: 'timesheet-test' });
  const job = ledger.createIntake({ title: `Timesheet job${suffix}`, client: { name: `Timesheet Client${suffix}` }, status: 'in_progress', assignAutomatically: false }, { actor: 'timesheet-test' });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, worker, job };
}

test('weekly timesheets freeze current worker sources, supersede by revision, and export a safe CSV handoff', t => {
  const { ledger, worker, job } = fixture(t, ' A');
  const periodStart = previousMonday();
  ledger.addTimeLog(job.id, {
    workerId: worker.id,
    workDate: periodStart,
    hours: 8,
    billable: true,
    rate: 42,
    source: 'verified_manual_timecard',
    verificationReference: 'TIME-001',
    notes: 'Retained installation shift.'
  });
  ledger.addTimeLog(job.id, {
    workerId: worker.id,
    workDate: addDays(periodStart, 1),
    hours: 6.5,
    billable: false,
    rate: 42,
    source: 'daily_site_log',
    entryKey: 'timesheet-domain-0001',
    entryFingerprint: 'a'.repeat(64),
    notes: 'Training and setup shift.'
  });

  const preview = ledger.calculateWorkerTimesheet(worker.id, { periodStart });
  assert.equal(preview.ready, true);
  assert.equal(preview.summary.totalHours, 14.5);
  assert.equal(preview.summary.billableHours, 8);
  assert.equal(preview.summary.laborCost, 609);
  assert.equal(preview.policy.attendanceUse, 'advisory_exception_signal_only');
  assert.equal(preview.policy.payrollExecuted, false);

  const requested = ledger.requestWeeklyTimesheet(worker.id, { periodStart }, { actor: 'office' });
  const replay = ledger.requestWeeklyTimesheet(worker.id, { periodStart }, { actor: 'office' });
  assert.equal(requested.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.timesheet.id, requested.timesheet.id);
  assert.equal(requested.timesheet.status, 'pending_approval');
  assert.equal(requested.timesheet.integrityValid, true);
  assert.equal(requested.approval.targetType, 'weekly_timesheet');
  assert.match(requested.approval.decision.primaryEffect, /timesheet v1/i);
  assert.ok(requested.approval.decision.safeguards.some(item => /attendance never creates payable hours/i.test(item)));

  ledger.resolveApproval(requested.approval.id, {
    status: 'approved',
    resolvedBy: 'Timesheet approver',
    reason: 'Worker submissions, job allocation, exceptions, and source references were reviewed.'
  });
  const approved = ledger.getWeeklyTimesheet(requested.timesheet.id);
  assert.equal(approved.status, 'approved');

  const firstExport = ledger.prepareTimesheetExport({ periodStart }, { actor: 'payroll-operator' });
  const firstContent = ledger.getTimesheetExportContent(firstExport.export.id);
  assert.equal(firstExport.export.integrityValid, true);
  assert.equal(firstExport.export.timesheetCount, 1);
  assert.match(firstContent.content, /"'=Weekly Worker A"/);
  assert.match(firstContent.content, /"14.50"/);
  assert.equal(firstExport.export.snapshot.policy.payrollExecuted, false);

  ledger.addTimeLog(job.id, {
    workerId: worker.id,
    workDate: addDays(periodStart, 2),
    hours: 2,
    rate: 42,
    source: 'verified_manual_timecard',
    verificationReference: 'TIME-002'
  });
  assert.throws(
    () => ledger.prepareTimesheetExport({ periodStart }),
    error => error.code === 'timesheet_export_stale_source' && error.statusCode === 409
  );
  const stalePreview = ledger.runAutonomousCycle({
    dryRun: true,
    actionTypes: ['review_stale_timesheet'],
    jobIds: [job.id]
  });
  assert.equal(stalePreview.preview.length, 1);
  assert.equal(stalePreview.preview[0].timesheetId, approved.id);
  assert.equal(stalePreview.preview[0].retainedSourceHash, approved.sourceHash);
  assert.notEqual(stalePreview.preview[0].sourceHash, approved.sourceHash);
  const staleApplied = ledger.runAutonomousCycle({
    actionTypes: ['review_stale_timesheet'],
    jobIds: [job.id]
  });
  assert.equal(staleApplied.applied.length, 1);
  assert.equal(staleApplied.applied[0].status, 'task_created');
  const staleTask = ledger.getJobDetail(job.id).tasks.find(item => item.id === staleApplied.applied[0].taskId);
  assert.equal(staleTask.data.timesheetId, approved.id);
  assert.equal(staleTask.data.sourceHash, stalePreview.preview[0].sourceHash);
  assert.equal(staleTask.data.payrollExecuted, false);
  assert.equal(ledger.runAutonomousCycle({
    dryRun: true,
    actionTypes: ['review_stale_timesheet'],
    jobIds: [job.id]
  }).preview.length, 0);
  const revision = ledger.requestWeeklyTimesheet(worker.id, { periodStart }, { actor: 'office' });
  assert.equal(revision.timesheet.versionNumber, 2);
  assert.equal(revision.timesheet.supersedesTimesheetId, approved.id);
  ledger.resolveApproval(revision.approval.id, {
    status: 'approved',
    resolvedBy: 'Timesheet approver',
    reason: 'Late verified source was reviewed against the prior approved version.'
  });
  assert.equal(ledger.getWeeklyTimesheet(approved.id).status, 'superseded');
  assert.equal(ledger.getWeeklyTimesheet(revision.timesheet.id).status, 'approved');
  const revisedExport = ledger.prepareTimesheetExport({ periodStart }, { actor: 'payroll-operator' });
  assert.notEqual(revisedExport.export.id, firstExport.export.id);
  assert.equal(ledger.prepareTimesheetExport({ periodStart }).replayed, true);
  assert.equal(ledger.diagnose().valid, true);
});

test('timesheet handoff requires complete approval coverage and refuses retained integrity drift', t => {
  const { ledger, worker, job } = fixture(t, ' integrity');
  const secondWorker = ledger.upsertWorker({
    name: 'Second weekly worker',
    role: 'Electrician',
    status: 'available',
    hourlyRate: 48
  }, { actor: 'timesheet-test' });
  const periodStart = previousMonday();
  const firstLog = ledger.addTimeLog(job.id, {
    workerId: worker.id,
    workDate: periodStart,
    hours: 8,
    rate: 42,
    source: 'verified_manual_timecard',
    verificationReference: 'INTEGRITY-001',
    notes: 'Original retained note.'
  });
  ledger.addTimeLog(job.id, {
    workerId: secondWorker.id,
    workDate: periodStart,
    hours: 7.5,
    rate: 48,
    source: 'verified_manual_timecard',
    verificationReference: 'INTEGRITY-002'
  });

  const originalSourceHash = ledger.calculateWorkerTimesheet(worker.id, { periodStart }).sourceHash;
  ledger.db.prepare('UPDATE time_logs SET notes = ? WHERE id = ?').run('Corrected retained note.', firstLog.id);
  assert.notEqual(ledger.calculateWorkerTimesheet(worker.id, { periodStart }).sourceHash, originalSourceHash);

  const firstRequest = ledger.requestWeeklyTimesheet(worker.id, { periodStart }, { actor: 'office' });
  ledger.db.prepare('UPDATE weekly_timesheets SET total_hours = 99 WHERE id = ?').run(firstRequest.timesheet.id);
  assert.throws(
    () => ledger.getWeeklyTimesheet(firstRequest.timesheet.id),
    error => error.code === 'timesheet_integrity_failed' && error.statusCode === 409
  );
  ledger.db.prepare('UPDATE weekly_timesheets SET total_hours = 8 WHERE id = ?').run(firstRequest.timesheet.id);
  ledger.resolveApproval(firstRequest.approval.id, {
    status: 'approved',
    resolvedBy: 'Timesheet approver',
    reason: 'The retained worker source was reviewed.'
  });

  const incompleteBoard = ledger.listTimesheetBoard({ periodStart });
  assert.equal(incompleteBoard.summary.submittedWorkers, 2);
  assert.equal(incompleteBoard.summary.approved, 1);
  assert.equal(incompleteBoard.summary.reviewRequired, 1);
  assert.equal(incompleteBoard.summary.handoffReady, false);
  assert.throws(
    () => ledger.prepareTimesheetExport({ periodStart }),
    error => error.code === 'timesheet_export_incomplete'
      && error.statusCode === 409
      && error.details.workers.some(item => item.workerId === secondWorker.id)
  );

  const secondRequest = ledger.requestWeeklyTimesheet(secondWorker.id, { periodStart }, { actor: 'office' });
  ledger.resolveApproval(secondRequest.approval.id, {
    status: 'approved',
    resolvedBy: 'Timesheet approver',
    reason: 'The second retained worker source was reviewed.'
  });
  assert.equal(ledger.listTimesheetBoard({ periodStart }).summary.handoffReady, true);
  const prepared = ledger.prepareTimesheetExport({ periodStart });
  assert.equal(prepared.export.timesheetCount, 2);
  ledger.db.prepare("UPDATE timesheet_exports SET csv_content = csv_content || 'tampered' WHERE id = ?").run(prepared.export.id);
  assert.throws(
    () => ledger.prepareTimesheetExport({ periodStart }),
    error => error.code === 'timesheet_export_integrity_failed' && error.statusCode === 409
  );
});

test('timesheet submission blocks impossible daily totals and future-dated source evidence', t => {
  const { ledger, worker, job } = fixture(t, ' B');
  const secondJob = ledger.createIntake({ title: 'Second timesheet job', client: { name: 'Second Client' }, status: 'in_progress', assignAutomatically: false });
  const periodStart = previousMonday();
  ledger.addTimeLog(job.id, { workerId: worker.id, workDate: periodStart, hours: 13, rate: 42, source: 'manual' });
  ledger.addTimeLog(secondJob.id, { workerId: worker.id, workDate: periodStart, hours: 12, rate: 42, source: 'manual' });
  const preview = ledger.calculateWorkerTimesheet(worker.id, { periodStart });
  assert.equal(preview.ready, false);
  assert.ok(preview.blockers.some(item => item.code === 'timesheet_daily_hours_impossible'));
  assert.throws(
    () => ledger.requestWeeklyTimesheet(worker.id, { periodStart }),
    error => error.code === 'timesheet_not_ready' && error.details.blockers.some(item => item.code === 'timesheet_daily_hours_impossible')
  );
});

test('autonomy creates one deterministic internal task for a completed week missing timesheet review', t => {
  const { ledger, worker, job } = fixture(t, ' C');
  const periodStart = previousMonday();
  ledger.addTimeLog(job.id, { workerId: worker.id, workDate: periodStart, hours: 8, rate: 42, source: 'daily_site_log' });
  const preview = ledger.runAutonomousCycle({ dryRun: true, actionTypes: ['review_missing_timesheet'], jobIds: [job.id] });
  assert.equal(preview.preview.length, 1);
  assert.equal(preview.preview[0].workerId, worker.id);
  assert.equal(preview.preview[0].periodStart, periodStart);
  const applied = ledger.runAutonomousCycle({ actionTypes: ['review_missing_timesheet'], jobIds: [job.id] });
  assert.equal(applied.applied.length, 1);
  assert.equal(applied.applied[0].status, 'task_created');
  const task = ledger.getJobDetail(job.id).tasks.find(item => item.id === applied.applied[0].taskId);
  assert.equal(task.data.workerId, worker.id);
  assert.equal(task.data.payrollExecuted, false);
  assert.equal(ledger.runAutonomousCycle({ dryRun: true, actionTypes: ['review_missing_timesheet'], jobIds: [job.id] }).preview.length, 0);
});
