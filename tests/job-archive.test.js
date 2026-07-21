const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ContractorOperatingLedger } = require('../operating-ledger');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-job-archive-'));
process.env.STATE_FILE = path.join(stateDirectory, 'state.json');
process.env.LEDGER_DB_FILE = path.join(stateDirectory, 'ledger.sqlite');
process.env.UPLOAD_DIR = path.join(stateDirectory, 'uploads');

const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  return { response, body };
}

async function resolvePendingApprovals(baseUrl, jobId) {
  const detail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(detail.response.status, 200);
  for (const approval of detail.body.job.approvals.filter(item => item.status === 'pending')) {
    const rejectUnscopedQuote = approval.targetType === 'quote';
    const resolved = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(approval.id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({
        status: rejectUnscopedQuote ? 'rejected' : 'approved',
        resolvedBy: 'Lifecycle test approver',
        reason: rejectUnscopedQuote
          ? 'Legacy draft has no approved written scope and is closed before archive.'
          : 'Existing retained decision reviewed before lifecycle archive.'
      })
    });
    assert.equal(resolved.response.status, 200);
  }
}

test('job archive and restore are reversible approval-gated ledger workflows', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Archive lifecycle regression job',
      clientName: 'Archive Lifecycle Client',
      description: 'Retained job used to verify reversible archive and restore behavior.',
      estimatedCost: 2400,
      contractValue: 3200
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const blocked = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/archive`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Archive after lifecycle test completion.' })
  });
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.body.error.code, 'job_archive_blocked_by_approvals');

  await resolvePendingApprovals(baseUrl, jobId);
  const portalAccess = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/client-portal-access`, {
    method: 'POST',
    body: JSON.stringify({
      label: 'Archive lifecycle client portal',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    })
  });
  assert.equal(portalAccess.response.status, 201);
  const portalApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(portalAccess.body.access.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Lifecycle portal approver' })
  });
  assert.equal(portalApproval.response.status, 200);
  const activePortal = await request(baseUrl, `/api/client-portal/${encodeURIComponent(portalAccess.body.access.portalToken)}`);
  assert.equal(activePortal.response.status, 200);

  const worker = await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Archive lifecycle worker', role: 'Carpenter', status: 'available' })
  });
  assert.equal(worker.response.status, 201);
  const assignment = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ workerId: worker.body.worker.id, status: 'planned' })
  });
  assert.equal(assignment.response.status, 201);

  const before = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  const retainedStatus = before.body.job.status;
  const retainedPhase = before.body.job.phase;
  const retainedQuoteCount = before.body.job.quotes.length;

  const bypassArchive = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'archived' })
  });
  assert.equal(bypassArchive.response.status, 400);
  assert.equal(bypassArchive.body.error.code, 'job_archive_route_required');

  const missingArchiveReason = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/archive`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'short' })
  });
  assert.equal(missingArchiveReason.response.status, 400);
  assert.equal(missingArchiveReason.body.error.code, 'job_archive_reason_required');

  const archive = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/archive`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Project operations are complete and records must be retained.' })
  });
  assert.equal(archive.response.status, 201);
  assert.equal(archive.body.status, 'pending_approval');
  assert.equal(archive.body.requiresApproval, true);
  assert.equal(archive.body.replayed, false);
  assert.equal(archive.body.externalCommitments, 0);
  assert.equal(archive.body.job.status, retainedStatus);
  assert.equal(archive.body.approval.targetType, 'job_archive');
  assert.equal(archive.body.approval.decision.riskLevel, 'high');
  assert.match(archive.body.approval.decision.primaryEffect, /Archive lifecycle regression job/);
  assert.equal(archive.body.approval.decision.preview.activePortalAccessCount, 1);
  assert.ok(archive.body.approval.decision.effects.some(item => /Revoke 1 active client portal link/.test(item)));
  assert.ok(archive.body.approval.decision.safeguards.some(item => /Does not delete/.test(item)));
  assert.ok(archive.body.approval.decision.safeguards.some(item => /not reactivated by restore/i.test(item)));

  const archiveReplay = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/archive`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Project operations are complete and records must be retained.' })
  });
  assert.equal(archiveReplay.response.status, 201);
  assert.equal(archiveReplay.body.replayed, true);
  assert.equal(archiveReplay.body.approval.id, archive.body.approval.id);

  const activeWhilePending = await request(baseUrl, '/api/ledger/jobs?limit=500');
  assert.ok(activeWhilePending.body.jobs.some(job => job.id === jobId));
  assert.equal(archive.body.dashboard.metrics.pendingArchiveJobs, 1);

  const archiveApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(archive.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      resolvedBy: 'Lifecycle test approver',
      reason: 'Retention and active queue removal were reviewed.'
    })
  });
  assert.equal(archiveApproval.response.status, 200);
  assert.equal(archiveApproval.body.approval.status, 'approved');
  assert.equal(archiveApproval.body.job.status, 'archived');

  const archived = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(archived.body.job.status, 'archived');
  assert.equal(archived.body.job.phase, 'archived');
  assert.equal(archived.body.job.data.archive.active, true);
  assert.equal(archived.body.job.data.archive.previousStatus, retainedStatus);
  assert.equal(archived.body.job.data.archive.previousPhase, retainedPhase);
  assert.deepEqual(archived.body.job.data.archive.revokedPortalAccessIds, [portalAccess.body.access.id]);
  const revokedPortalAccess = archived.body.job.portalAccess.find(item => item.id === portalAccess.body.access.id);
  assert.equal(revokedPortalAccess.status, 'revoked');
  assert.match(revokedPortalAccess.data.revocation.reason, /Job archived through approval/);
  assert.equal(archived.body.job.quotes.length, retainedQuoteCount);

  const closedPortal = await request(baseUrl, `/api/client-portal/${encodeURIComponent(portalAccess.body.access.portalToken)}`);
  assert.equal(closedPortal.response.status, 404);

  const blockedMutations = [
    {
      route: `/api/ledger/jobs/${encodeURIComponent(jobId)}/tasks`,
      body: { title: 'Must not enter an archived work queue', status: 'open' }
    },
    {
      route: `/api/ledger/jobs/${encodeURIComponent(jobId)}/progress`,
      body: { note: 'Must not change archived progress.', progressPercent: 75 }
    },
    {
      route: `/api/ledger/jobs/${encodeURIComponent(jobId)}/client-portal-access`,
      body: {
        label: 'Must not reopen archived client access',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      }
    },
    {
      route: `/api/ledger/jobs/${encodeURIComponent(jobId)}/finance-handoffs`,
      body: {
        targetSystem: 'FAB',
        packageType: 'job_finance',
        status: 'draft',
        notes: 'Must not package retained finance data after archive.'
      }
    }
  ];
  for (const mutation of blockedMutations) {
    const blockedMutation = await request(baseUrl, mutation.route, {
      method: 'POST',
      body: JSON.stringify(mutation.body)
    });
    assert.equal(blockedMutation.response.status, 409, mutation.route);
    assert.equal(blockedMutation.body.error.code, 'job_inactive_read_only', mutation.route);
    assert.equal(blockedMutation.body.error.details.jobStatus, 'archived', mutation.route);
    assert.equal(blockedMutation.body.error.details.restoreAvailable, true, mutation.route);
  }

  const releasedDormantAssignment = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments/${encodeURIComponent(assignment.body.assignment.id)}/release`,
    {
      method: 'POST',
      body: JSON.stringify({ reason: 'Release retained capacity while the job remains archived.' })
    }
  );
  assert.equal(releasedDormantAssignment.response.status, 200);
  assert.equal(releasedDormantAssignment.body.assignment.status, 'released');

  const archivedDashboard = await request(baseUrl, '/api/ledger/dashboard');
  assert.equal(archivedDashboard.response.status, 200);
  assert.equal(archivedDashboard.body.dashboard.workload.openTasks, 0);
  assert.equal(archivedDashboard.body.dashboard.metrics.approvedQuotes, 0);
  assert.equal(archivedDashboard.body.dashboard.money.quotedValue, 0);
  const archivedProjectCapability = archivedDashboard.body.dashboard.capabilities.find(item => item.key === 'project-execution');
  assert.equal(archivedProjectCapability.requirements.find(item => item.key === 'job').count, 0);
  assert.equal(archivedProjectCapability.requirements.find(item => item.key === 'tasks').count, 0);

  const activeAfterArchive = await request(baseUrl, '/api/ledger/jobs?limit=500');
  assert.ok(!activeAfterArchive.body.jobs.some(job => job.id === jobId));
  const archiveRegistry = await request(baseUrl, '/api/ledger/jobs?archiveOnly=true&limit=500');
  assert.ok(archiveRegistry.body.jobs.some(job => job.id === jobId));

  const bypassRestore = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: retainedStatus, phase: retainedPhase })
  });
  assert.equal(bypassRestore.response.status, 400);
  assert.equal(bypassRestore.body.error.code, 'job_restore_route_required');

  const missingRestoreReason = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/restore`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'short' })
  });
  assert.equal(missingRestoreReason.response.status, 400);
  assert.equal(missingRestoreReason.body.error.code, 'job_restore_reason_required');

  const restore = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/restore`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'The retained project must return to the operating workflow.' })
  });
  assert.equal(restore.response.status, 201);
  assert.equal(restore.body.job.status, 'archived');
  assert.equal(restore.body.approval.targetType, 'job_restore');
  assert.equal(restore.body.approval.decision.preview.restoreStatus, retainedStatus);
  assert.ok(restore.body.approval.decision.safeguards.some(item => /archive history remains retained/i.test(item)));

  const restoreApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(restore.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      resolvedBy: 'Lifecycle test approver',
      reason: 'The retained status and operational safeguards were reviewed.'
    })
  });
  assert.equal(restoreApproval.response.status, 200);

  const restored = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(restored.body.job.status, retainedStatus);
  assert.equal(restored.body.job.phase, retainedPhase);
  assert.equal(restored.body.job.data.archive.active, false);
  assert.deepEqual(restored.body.job.data.archiveHistory.map(event => event.operation), ['archive', 'restore']);
  assert.equal(restored.body.job.quotes.length, retainedQuoteCount);

  const restoredTask = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ title: 'Restored operational write', status: 'open' })
  });
  assert.equal(restoredTask.response.status, 201);

  const restoredDashboard = await request(baseUrl, '/api/ledger/dashboard');
  assert.equal(restoredDashboard.response.status, 200);
  assert.ok(restoredDashboard.body.dashboard.workload.openTasks > 0);
  assert.equal(restoredDashboard.body.dashboard.metrics.approvedQuotes, 0);
  assert.ok(restoredDashboard.body.dashboard.money.quotedValue > 0);
  const restoredProjectCapability = restoredDashboard.body.dashboard.capabilities.find(item => item.key === 'project-execution');
  assert.equal(restoredProjectCapability.requirements.find(item => item.key === 'job').count, 1);
  assert.ok(restoredProjectCapability.requirements.find(item => item.key === 'tasks').count > 0);

  const visibleAfterRestore = await request(baseUrl, '/api/ledger/jobs?limit=500');
  assert.ok(visibleAfterRestore.body.jobs.some(job => job.id === jobId));

  const secondArchive = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/archive`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Request is intentionally rejected to verify no state mutation.' })
  });
  assert.equal(secondArchive.response.status, 201);
  const rejected = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(secondArchive.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'rejected', resolvedBy: 'Lifecycle test approver', reason: 'The job must remain available.' })
  });
  assert.equal(rejected.response.status, 200);
  const afterRejection = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  assert.equal(afterRejection.body.job.status, retainedStatus);

  const audit = await request(baseUrl, `/api/ledger/audit?jobId=${encodeURIComponent(jobId)}&limit=100`);
  for (const action of ['request_job_archive', 'apply_job_archive', 'revoke_client_portal_access', 'release_assignment', 'request_job_restore', 'apply_job_restore']) {
    assert.ok(audit.body.events.some(event => event.action === action), `missing ${action} audit event`);
  }
  const archiveAudit = audit.body.events.find(event => event.action === 'apply_job_archive');
  assert.equal(archiveAudit.metadata.externalCommitments, 0);
  assert.deepEqual(archiveAudit.metadata.revokedPortalAccessIds, [portalAccess.body.access.id]);
});

test('archived jobs leave resource conflict scope until an approved restore', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-job-archive-resources-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  try {
    const firstJob = ledger.createIntake({
      title: 'Archived resource holder',
      client: { name: 'Archived Resource Client' },
      description: 'Retain crew and tool records while removing them from active conflict checks.',
      assignAutomatically: false
    }, { actor: 'archive_resource_test' });
    for (const approval of ledger.getJobDetail(firstJob.id).approvals.filter(item => item.status === 'pending')) {
      ledger.resolveApproval(approval.id, {
        status: 'approved',
        resolvedBy: 'archive_resource_approver',
        reason: 'Resolve intake approvals before resource lifecycle verification.'
      });
    }

    const worker = ledger.upsertWorker({ name: 'Archive Resource Crew', status: 'available' });
    const tool = ledger.upsertTool({ name: 'Archive Resource Lift', status: 'available' });
    const scheduledStart = '2026-08-03T08:00:00.000Z';
    const scheduledEnd = '2026-08-03T16:00:00.000Z';
    ledger.addAssignment(firstJob.id, {
      workerId: worker.id,
      scheduledStart,
      scheduledEnd,
      allocationHours: 8
    });
    ledger.reserveTool(firstJob.id, {
      toolId: tool.id,
      neededFrom: scheduledStart,
      neededUntil: scheduledEnd
    });

    const archive = ledger.requestJobArchive(firstJob.id, {
      reason: 'Remove retained resources from operating conflict scope.'
    });
    ledger.resolveApproval(archive.approval.id, {
      status: 'approved',
      resolvedBy: 'archive_resource_approver',
      reason: 'Resource retention and active conflict removal were verified.'
    });

    const secondJob = ledger.createIntake({
      title: 'Active replacement resource job',
      client: { name: 'Active Resource Client' },
      description: 'Use the released operating capacity while the original job remains archived.',
      assignAutomatically: false
    }, { actor: 'archive_resource_test' });
    const replacementAssignment = ledger.addAssignment(secondJob.id, {
      workerId: worker.id,
      scheduledStart,
      scheduledEnd,
      allocationHours: 8
    });
    const replacementReservation = ledger.reserveTool(secondJob.id, {
      toolId: tool.id,
      neededFrom: scheduledStart,
      neededUntil: scheduledEnd
    });
    assert.equal(replacementAssignment.status, 'planned');
    assert.equal(replacementAssignment.conflicts.length, 0);
    assert.equal(replacementReservation.status, 'reserved');
    assert.equal(replacementReservation.conflicts.length, 0);
    assert.equal(ledger.detectAssignmentConflicts(10).length, 0);
    assert.equal(ledger.detectToolReservationConflicts(10).length, 0);

    const restore = ledger.requestJobRestore(firstJob.id, {
      reason: 'Return the retained job and reapply current resource conflict checks.'
    });
    ledger.resolveApproval(restore.approval.id, {
      status: 'approved',
      resolvedBy: 'archive_resource_approver',
      reason: 'Restore approved with current resource conflicts visible for operator resolution.'
    });
    assert.ok(ledger.detectAssignmentConflicts(10).length > 0);
    assert.ok(ledger.detectToolReservationConflicts(10).length > 0);
  } finally {
    ledger.close();
  }
});

test('inactive jobs fail closed for legacy approvals and stale client portal links', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-job-archive-legacy-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  try {
    const job = ledger.createIntake({
      title: 'Legacy archived access guard',
      client: { name: 'Legacy Archive Client' },
      assignAutomatically: false
    }, { actor: 'archive_legacy_test' });
    for (const approval of ledger.getJobDetail(job.id).approvals.filter(item => item.status === 'pending')) {
      ledger.resolveApproval(approval.id, {
        status: 'approved',
        resolvedBy: 'archive_legacy_approver',
        reason: 'Resolve intake approvals before legacy lifecycle verification.'
      });
    }

    const access = ledger.createClientPortalAccess(job.id, {
      label: 'Legacy portal fixture',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
    ledger.resolveApproval(access.approval.id, {
      status: 'approved',
      resolvedBy: 'archive_legacy_approver'
    });
    const archive = ledger.requestJobArchive(job.id, {
      reason: 'Archive the legacy access fixture behind a read-only boundary.'
    });
    ledger.resolveApproval(archive.approval.id, {
      status: 'approved',
      resolvedBy: 'archive_legacy_approver',
      reason: 'Archive boundary and portal revocation verified.'
    });

    assert.throws(
      () => ledger.addTask(job.id, { title: 'Legacy mutation must fail' }),
      error => error.code === 'job_inactive_read_only' && error.details?.jobStatus === 'archived'
    );
    assert.throws(
      () => ledger.createApproval({
        id: 'approval_legacy_archived_update',
        targetType: 'job_update',
        targetId: 'approval_legacy_archived_update',
        jobId: job.id,
        summary: 'Legacy archived mutation approval',
        data: { patch: { title: 'Must not apply' } }
      }),
      error => error.code === 'job_inactive_read_only'
    );

    const staleApproval = ledger.createApproval({
      id: 'approval_migrated_archived_update',
      targetType: 'job_update',
      targetId: 'approval_migrated_archived_update',
      jobId: job.id,
      summary: 'Migrated pending approval fixture',
      data: { patch: { title: 'Must remain unchanged' } }
    }, { actor: 'archive_migration_test', allowInactive: true });
    assert.throws(
      () => ledger.resolveApproval(staleApproval.id, { status: 'approved', resolvedBy: 'archive_legacy_approver' }),
      error => error.code === 'job_inactive_read_only'
    );
    assert.equal(ledger.db.prepare('SELECT status FROM approvals WHERE id = ?').get(staleApproval.id).status, 'pending');
    assert.equal(ledger.getJobDetail(job.id).title, 'Legacy archived access guard');

    ledger.db.prepare("UPDATE client_portal_access SET status = 'active', revoked_at = NULL WHERE id = ?").run(access.id);
    assert.throws(
      () => ledger.getClientPortalSnapshot(access.portalToken),
      error => error.statusCode === 404
    );
    const guardedAccess = ledger.listClientPortalAccess(job.id).find(item => item.id === access.id);
    assert.equal(guardedAccess.status, 'revoked');
    assert.match(guardedAccess.data.revocation.reason, /retained job is archived/i);
    assert.ok(ledger.listAudit({ entityId: access.id, limit: 100 }).some(event => (
      event.action === 'revoke_client_portal_access'
      && event.actor === 'inactive_job_portal_guard'
    )));
  } finally {
    ledger.close();
  }
});

test('portal revocation migration normalizes legacy inactive job access on restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-job-archive-migration-'));
  const dbFile = path.join(directory, 'ledger.sqlite');
  let ledger = new ContractorOperatingLedger({ dbFile });
  try {
    const job = ledger.createIntake({
      title: 'Legacy portal migration fixture',
      client: { name: 'Portal Migration Client' },
      assignAutomatically: false
    }, { actor: 'archive_migration_test' });
    for (const approval of ledger.getJobDetail(job.id).approvals.filter(item => item.status === 'pending')) {
      ledger.resolveApproval(approval.id, {
        status: 'approved',
        resolvedBy: 'archive_migration_approver'
      });
    }
    const access = ledger.createClientPortalAccess(job.id, {
      label: 'Legacy migration portal',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
    ledger.resolveApproval(access.approval.id, {
      status: 'approved',
      resolvedBy: 'archive_migration_approver'
    });
    const archive = ledger.requestJobArchive(job.id, {
      reason: 'Create an archived legacy portal row for migration verification.'
    });
    ledger.resolveApproval(archive.approval.id, {
      status: 'approved',
      resolvedBy: 'archive_migration_approver'
    });

    ledger.db.prepare("UPDATE client_portal_access SET status = 'active', revoked_at = NULL WHERE id = ?").run(access.id);
    ledger.db.prepare("DELETE FROM ledger_schema_migrations WHERE version = '007_inactive_job_portal_revocation'").run();
    ledger.close();
    ledger = new ContractorOperatingLedger({ dbFile });

    const migratedAccess = ledger.listClientPortalAccess(job.id).find(item => item.id === access.id);
    assert.equal(migratedAccess.status, 'revoked');
    assert.equal(migratedAccess.data.revocation.actor, 'ledger_migration');
    assert.match(migratedAccess.data.revocation.reason, /retained job is inactive/i);
    assert.equal(ledger.migrationStatus().currentVersion, '056_commercial_scope_revisions');
    assert.ok(ledger.listAudit({ entityId: access.id, limit: 100 }).some(event => (
      event.action === 'revoke_client_portal_access'
      && event.actor === 'ledger_migration'
      && event.metadata.migration === '007_inactive_job_portal_revocation'
      && event.metadata.externalCommitments === 0
    )));
    assert.equal(ledger.verifyAuditIntegrity().valid, true);
  } finally {
    ledger?.close();
  }
});

test('terminal inactive job states do not advertise an unavailable restore path', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-job-terminal-state-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  try {
    const job = ledger.createIntake({
      title: 'Cancelled terminal job',
      client: { name: 'Terminal State Client' },
      assignAutomatically: false
    });
    ledger.updateJob(job.id, { status: 'cancelled' });
    assert.throws(
      () => ledger.addTask(job.id, { title: 'Terminal mutation must fail' }),
      error => (
        error.code === 'job_inactive_read_only'
        && error.details?.jobStatus === 'cancelled'
        && error.details?.restoreAvailable === false
        && /terminal job state/i.test(error.message)
      )
    );
  } finally {
    ledger.close();
  }
});
