const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-meetings-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const job = ledger.createIntake({
    title: 'Meeting controls fixture',
    status: 'planned',
    client: { name: 'Meeting client', email: 'meeting-client@example.test' }
  });
  return { ledger, job };
}

function createMeeting(ledger, jobId, overrides = {}) {
  return ledger.createProjectMeeting(jobId, {
    title: 'Weekly project coordination',
    meetingType: 'coordination',
    scheduledAt: '2026-07-14T10:00:00.000Z',
    location: 'Site office',
    chair: 'Project manager',
    attendees: [
      { name: 'Project manager', email: 'pm@example.test' },
      { name: 'Site lead' }
    ],
    agenda: ['Programme and access', 'Design decisions'],
    minutesSummary: 'The team reviewed current progress, access constraints, and the retained design information.',
    decisions: ['Keep the retained construction sequence until the design response is approved.'],
    actions: [
      {
        title: 'Confirm delivery window',
        ownerName: 'Site lead',
        dueAt: '2020-01-02',
        priority: 'high',
        description: 'Retain supplier confirmation before mobilization.'
      }
    ],
    ...overrides
  }, { actor: 'office:test' });
}

test('project meeting minutes require approval before tasks and issue evidence are activated', t => {
  const { ledger, job } = fixture(t);
  const meeting = createMeeting(ledger, job.id);
  assert.match(meeting.meetingNumber, /^MTG-2026-\d{6}$/);
  assert.equal(meeting.status, 'draft');
  assert.equal(meeting.actions[0].status, 'proposed');
  assert.equal(meeting.actions[0].linkedTaskId, null);

  assert.throws(
    () => ledger.recordProjectMeetingIssue(job.id, meeting.id, { deliveryReference: 'email:before-approval' }),
    error => error.code === 'project_meeting_approval_required'
  );
  const submitted = ledger.submitProjectMeetingMinutes(job.id, meeting.id, {
    reason: 'Review attendance, decisions, and assigned actions.'
  }, { actor: 'office:test' });
  assert.equal(submitted.meeting.status, 'pending_approval');
  assert.equal(submitted.externalDeliveryInitiated, false);
  assert.match(submitted.meeting.snapshotHash, /^[a-f0-9]{64}$/);
  const decision = ledger.listApprovals({ status: 'pending', limit: 20 }).find(item => item.id === submitted.approval.id).decision;
  assert.equal(decision.riskLevel, 'high');
  assert.match(decision.primaryEffect, /project meeting minutes/i);
  assert.match(decision.safeguards.join(' '), /does not send/i);

  ledger.resolveApproval(submitted.approval.id, {
    status: 'approved',
    resolvedBy: 'owner:test',
    reason: 'Attendance, decision trail, action ownership, and immutable snapshot verified.'
  });
  const approved = ledger.getProjectMeeting(meeting.id);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.actions[0].status, 'open');
  assert.ok(approved.actions[0].linkedTaskId);
  const linkedTask = ledger.getJobDetail(job.id).tasks.find(task => task.id === approved.actions[0].linkedTaskId);
  assert.equal(linkedTask.title, 'Confirm delivery window');
  assert.equal(linkedTask.status, 'open');
  assert.equal(linkedTask.durationHours, 1);
  assert.equal(linkedTask.data.meetingActionId, approved.actions[0].id);

  const preview = ledger.runAutonomousCycle({
    dryRun: true,
    actionTypes: ['draft_meeting_action_follow_up'],
    jobIds: [job.id]
  });
  assert.equal(preview.preview.length, 1);
  const autonomous = ledger.runAutonomousCycle({
    actionTypes: ['draft_meeting_action_follow_up'],
    jobIds: [job.id],
    actor: 'autonomous:test'
  });
  assert.equal(autonomous.applied.length, 1);
  assert.equal(autonomous.applied[0].externalDeliveryInitiated, false);
  const followUpDraft = ledger.getJobDetail(job.id).communications.find(record => record.data?.meetingActionId === approved.actions[0].id);
  assert.equal(followUpDraft.status, 'draft');
  assert.ok(followUpDraft.approvalId);
  assert.equal(followUpDraft.data.actionStatusChanged, false);
  assert.equal(ledger.runAutonomousCycle({
    dryRun: true,
    actionTypes: ['draft_meeting_action_follow_up'],
    jobIds: [job.id]
  }).preview.length, 0);

  const completed = ledger.completeProjectMeetingAction(job.id, meeting.id, approved.actions[0].id, {
    evidenceReference: 'supplier-confirmation:delivery-2026-07-16',
    completedBy: 'Site lead',
    notes: 'Delivery slot verified against the retained supplier confirmation.'
  }, { actor: 'office:test' });
  assert.equal(completed.action.status, 'completed');
  assert.equal(completed.action.completionEvidence, 'supplier-confirmation:delivery-2026-07-16');
  assert.equal(ledger.getJobDetail(job.id).tasks.find(task => task.id === approved.actions[0].linkedTaskId).status, 'completed');

  const issued = ledger.recordProjectMeetingIssue(job.id, meeting.id, {
    deliveryReference: 'email-receipt:meeting-minutes-001'
  }, { actor: 'office:test' });
  assert.equal(issued.status, 'issued');
  assert.equal(issued.deliveryReference, 'email-receipt:meeting-minutes-001');
  assert.equal(ledger.diagnose().valid, true);
});

test('rejected minutes cancel proposed actions without creating job tasks', t => {
  const { ledger, job } = fixture(t);
  const meeting = createMeeting(ledger, job.id, { title: 'Rejected coordination minutes' });
  const submitted = ledger.submitProjectMeetingMinutes(job.id, meeting.id);
  ledger.resolveApproval(submitted.approval.id, {
    status: 'rejected',
    resolvedBy: 'owner:test',
    reason: 'Attendance record and action ownership require correction.'
  });
  const rejected = ledger.getProjectMeeting(meeting.id);
  assert.equal(rejected.status, 'rejected');
  assert.ok(rejected.actions.every(action => action.status === 'cancelled'));
  assert.equal(ledger.getJobDetail(job.id).tasks.some(task => task.data?.projectMeetingId === meeting.id), false);
  assert.equal(ledger.diagnose().valid, true);
});

test('follow-up minutes carry unresolved actions onto the same linked task', t => {
  const { ledger, job } = fixture(t);
  const source = createMeeting(ledger, job.id);
  const submittedSource = ledger.submitProjectMeetingMinutes(job.id, source.id);
  ledger.resolveApproval(submittedSource.approval.id, {
    status: 'approved',
    resolvedBy: 'owner:test',
    reason: 'Source minutes and action ownership verified.'
  });
  const sourceAction = ledger.getProjectMeeting(source.id).actions[0];
  const initialTaskCount = ledger.getJobDetail(job.id).tasks.length;

  const created = ledger.createProjectMeetingFollowUp(job.id, source.id, {
    scheduledAt: '2026-07-21T10:00:00.000Z',
    minutesSummary: 'The delivery confirmation remained open and was carried into the next coordination review.'
  }, { actor: 'office:test' });
  assert.equal(created.carriedActionCount, 1);
  assert.equal(created.meeting.followsMeetingId, source.id);
  assert.equal(created.meeting.actions[0].carriedFromActionId, sourceAction.id);
  assert.equal(created.meeting.actions[0].linkedTaskId, sourceAction.linkedTaskId);
  assert.throws(
    () => ledger.createProjectMeetingFollowUp(job.id, source.id, {
      scheduledAt: '2026-07-22T10:00:00.000Z',
      minutesSummary: 'Duplicate carryover attempt.'
    }),
    error => error.code === 'project_meeting_action_already_carried'
  );

  const submittedFollowUp = ledger.submitProjectMeetingMinutes(job.id, created.meeting.id);
  ledger.resolveApproval(submittedFollowUp.approval.id, {
    status: 'approved',
    resolvedBy: 'owner:test',
    reason: 'Carry-forward action and reused task linkage verified.'
  });
  const sourceAfter = ledger.getProjectMeeting(source.id);
  const followUp = ledger.getProjectMeeting(created.meeting.id);
  assert.equal(sourceAfter.actions[0].status, 'carried_forward');
  assert.equal(followUp.actions[0].status, 'open');
  assert.equal(followUp.actions[0].linkedTaskId, sourceAction.linkedTaskId);
  assert.equal(ledger.getJobDetail(job.id).tasks.length, initialTaskCount);

  ledger.completeProjectMeetingAction(job.id, followUp.id, followUp.actions[0].id, {
    evidenceReference: 'delivery-window:confirmed-after-followup',
    completedBy: 'Site lead'
  });
  assert.equal(ledger.getJobDetail(job.id).tasks.find(task => task.id === sourceAction.linkedTaskId).status, 'completed');
  assert.equal(ledger.diagnose().valid, true);
});

test('migration 024 upgrades a 023 ledger and diagnostics detect meeting snapshot tampering', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-meeting-migration-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const initial = new ContractorOperatingLedger({ dbFile });
  const job = initial.createIntake({ title: 'Meeting migration fixture', client: { name: 'Migration client' } });
  const meeting = createMeeting(initial, job.id);
  const submitted = initial.submitProjectMeetingMinutes(job.id, meeting.id);
  initial.resolveApproval(submitted.approval.id, {
    status: 'approved',
    resolvedBy: 'owner:test',
    reason: 'Snapshot verified before tamper test.'
  });
  initial.db.prepare("UPDATE project_meetings SET title = 'Rewritten title' WHERE id = ?").run(meeting.id);
  assert.equal(initial.diagnose().valid, false);
  assert.ok(initial.diagnose().issues.some(issue => /project meeting.*snapshot integrity/i.test(issue.message)));
  initial.close();

  const oldSchema = new DatabaseSync(dbFile);
  oldSchema.exec(`
    DROP TABLE meeting_action_items;
    DROP TABLE project_meetings;
    DROP TABLE project_meeting_number_sequences;
    DELETE FROM ledger_schema_migrations WHERE version = '024_project_meeting_minutes';
  `);
  oldSchema.close();

  const upgraded = new ContractorOperatingLedger({ dbFile });
  try {
    assert.equal(upgraded.migrationStatus().currentVersion, '053_work_breakdown_takeoffs');
    assert.equal(upgraded.migrationStatus().pending.length, 0);
    for (const table of ['project_meeting_number_sequences', 'project_meetings', 'meeting_action_items']) {
      assert.ok(upgraded.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
    }
  } finally {
    upgraded.close();
  }
});
