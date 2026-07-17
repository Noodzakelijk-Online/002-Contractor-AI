const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t, suffix = 'governed') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-safety-briefing-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  const job = ledger.createIntake({
    title: `Safety briefing ${suffix}`,
    client: { name: `Safety client ${suffix}` },
    status: 'in_progress',
    riskLevel: 'high',
    assignAutomatically: false
  }, { actor: 'safety_test' });
  const workers = ['Lead installer', 'Site operative'].map((role) => {
    const worker = ledger.upsertWorker({
      name: `${role} ${suffix}`,
      role,
      status: 'available'
    }, { actor: 'safety_test' });
    ledger.addAssignment(job.id, {
      workerId: worker.id,
      workerName: worker.name,
      role,
      status: 'assigned'
    }, { actor: 'safety_test' });
    return worker;
  });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, job, workers };
}

function acknowledgement(worker, suffix) {
  return {
    entryKey: `safety-acknowledgement-${suffix}`,
    workerId: worker.id,
    workerName: worker.name,
    acknowledged: true,
    evidenceReference: `worker-device-attestation:${suffix}`
  };
}

test('safety briefings retain worker acknowledgements and require approval-backed complete attendance', t => {
  const { ledger, job, workers } = fixture(t, 'attendance');
  const scheduledAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const created = ledger.createSafetyMeeting(job.id, {
    entryKey: 'safety-briefing-attendance-001',
    title: 'Working at height toolbox talk',
    scheduledAt,
    topics: ['Fall prevention plan', 'Rescue arrangements', 'Stop-work authority']
  }, { actor: 'office_operator' });

  assert.equal(created.replayed, false);
  assert.equal(created.status, 'scheduled');
  assert.equal(created.attendanceSummary.total, 2);
  assert.equal(created.attendanceSummary.expected, 2);
  assert.equal(created.attendanceSummary.readyForSignoff, false);
  assert.equal(created.attendeeRecords.every(attendee => attendee.workerId), true);

  const replayedCreation = ledger.createSafetyMeeting(job.id, {
    entryKey: 'safety-briefing-attendance-001',
    title: 'Working at height toolbox talk',
    scheduledAt,
    topics: ['Fall prevention plan', 'Rescue arrangements', 'Stop-work authority']
  }, { actor: 'offline_retry' });
  assert.equal(replayedCreation.replayed, true);
  assert.equal(replayedCreation.id, created.id);

  const first = ledger.acknowledgeSafetyMeeting(job.id, created.id, acknowledgement(workers[0], '001'), { actor: 'field_worker' });
  assert.equal(first.replayed, false);
  assert.equal(first.attendee.status, 'acknowledged');
  assert.equal(first.attendee.integrityValid, true);
  assert.equal(first.meeting.attendanceSummary.outstanding, 1);
  const replay = ledger.acknowledgeSafetyMeeting(job.id, created.id, acknowledgement(workers[0], '001'), { actor: 'offline_retry' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.attendee.id, first.attendee.id);

  assert.throws(
    () => ledger.signOffSafetyMeeting(job.id, created.id, { evidenceReference: 'toolbox-register:001' }),
    error => error.code === 'safety_briefing_attendance_incomplete' && error.statusCode === 409
  );
  const secondAttendee = ledger.getSafetyMeeting(created.id).attendeeRecords.find(attendee => attendee.workerId === workers[1].id);
  const excused = ledger.excuseSafetyMeetingAttendee(job.id, created.id, secondAttendee.id, {
    reason: 'Worker reassigned before the briefing began.'
  }, { actor: 'office_operator' });
  assert.equal(excused.attendee.status, 'excused');
  assert.equal(excused.attendee.integrityValid, true);

  const signoff = ledger.signOffSafetyMeeting(job.id, created.id, {
    evidenceReference: 'toolbox-register:001',
    completedAt: new Date().toISOString(),
    status: 'completed'
  }, { actor: 'facilitator' });
  assert.equal(signoff.record.status, 'pending_approval');
  assert.equal(signoff.record.integrityValid, true);
  assert.equal(signoff.record.attendanceSummary.acknowledged, 1);
  assert.equal(signoff.record.attendanceSummary.excused, 1);
  assert.equal(signoff.approval.targetType, 'safety_meeting');

  ledger.resolveApproval(signoff.approval.id, {
    status: 'approved',
    resolvedBy: 'safety_approver',
    reason: 'Topics, attendance evidence, excusal, facilitator, and completion reference verified.'
  });
  const approved = ledger.getSafetyMeeting(created.id);
  assert.equal(approved.status, 'completed');
  assert.equal(approved.integrityValid, true);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
  assert.equal(ledger.diagnose().valid, true);
});

test('safety briefing approval rolls back after retained attendance evidence is changed', t => {
  const { ledger, job, workers } = fixture(t, 'tamper');
  const meeting = ledger.createSafetyMeeting(job.id, {
    title: 'Electrical isolation briefing',
    scheduledAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    topics: ['Lockout sequence', 'Verification of dead', 'Escalation route'],
    workerIds: [workers[0].id],
    includeAssignedCrew: false
  });
  ledger.acknowledgeSafetyMeeting(job.id, meeting.id, acknowledgement(workers[0], 'tamper-001'));
  const signoff = ledger.signOffSafetyMeeting(job.id, meeting.id, { evidenceReference: 'briefing-sheet:tamper-001' });
  const attendee = ledger.getSafetyMeeting(meeting.id).attendeeRecords[0];
  ledger.db.prepare('UPDATE safety_meeting_attendees SET attendee_name = ? WHERE id = ?').run('Changed identity', attendee.id);

  assert.throws(
    () => ledger.resolveApproval(signoff.approval.id, { status: 'approved', resolvedBy: 'approver' }),
    error => error.code === 'safety_briefing_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.db.prepare('SELECT status FROM approvals WHERE id = ?').get(signoff.approval.id).status, 'pending');
  assert.equal(ledger.getSafetyMeeting(meeting.id).integrityValid, false);
  assert.equal(ledger.diagnose().valid, false);
});

test('safety briefing autonomy creates one internal attendance review and never acknowledges for workers', t => {
  const { ledger, job } = fixture(t, 'autonomy');
  const meeting = ledger.createSafetyMeeting(job.id, {
    title: 'Daily pre-start briefing',
    scheduledAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    topics: ['Changed access route', 'Lifting zone controls']
  });
  const action = ledger.nextActions().find(candidate => (
    candidate.type === 'review_safety_briefing_attendance' && candidate.meetingId === meeting.id
  ));
  assert.ok(action);
  assert.equal(action.outstandingCount, 2);

  const first = ledger.runAutonomousCycle({
    actionTypes: ['review_safety_briefing_attendance'],
    jobIds: [job.id]
  });
  assert.equal(first.applied.length, 1);
  assert.equal(first.applied[0].externalCommitments, 0);
  assert.equal(first.applied[0].attendanceInferred, false);
  assert.equal(ledger.getSafetyMeeting(meeting.id).attendanceSummary.acknowledged, 0);
  const repeat = ledger.runAutonomousCycle({
    actionTypes: ['review_safety_briefing_attendance'],
    jobIds: [job.id]
  });
  assert.equal(repeat.applied.length, 1);
  assert.equal(repeat.applied[0].status, 'replayed');
  assert.equal(ledger.db.prepare("SELECT COUNT(*) AS count FROM job_tasks WHERE data_json LIKE '%safetyMeetingId%'").get().count, 1);
});
