const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');
const { buildHaiFeed } = require('../hai-connector');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-framework-workspace-'));
  const ledger = new ContractorOperatingLedger({
    dbFile: path.join(directory, 'ledger.sqlite'),
    clock: () => new Date('2026-08-09T12:00:00.000Z')
  });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function draftPayload(overrides = {}) {
  return {
    frameworkId: 'swot',
    scopeType: 'organization',
    status: 'draft',
    objective: 'Choose the next operating improvement from retained evidence.',
    ownerName: 'Operations owner',
    reviewDueAt: '2026-08-09',
    currentState: '',
    targetState: '',
    decision: '',
    evidenceRefs: [],
    successMeasures: [],
    reason: 'Create the governed operating review.',
    entryKey: 'framework-create-swot-0001',
    ...overrides
  };
}

test('framework workspace governs replay, revision history, transitions, dates, and summaries', t => {
  const ledger = temporaryLedger(t);
  assert.equal(ledger.migrationStatus().currentVersion, '072_operator_locale_preferences');
  assert.deepEqual(ledger.frameworkCatalog().counts, { families: 23, frameworks: 671, familyMemberships: 700 });

  const created = ledger.createFrameworkImplementation(draftPayload(), { actor: 'framework-test' });
  assert.equal(created.replayed, false);
  assert.equal(created.implementation.revision, 1);
  assert.equal(created.revision.snapshotHash.length, 64);

  const replayed = ledger.createFrameworkImplementation(draftPayload(), { actor: 'framework-test' });
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.implementation.id, created.implementation.id);
  assert.throws(
    () => ledger.updateFrameworkImplementation(created.implementation.id, {
      ...draftPayload({ frameworkId: 'kanban', entryKey: 'framework-identity-change-0001' }),
      expectedRevision: 1
    }),
    error => error.code === 'framework_identity_immutable' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.createFrameworkImplementation(draftPayload({ objective: 'A different objective cannot reuse the exact entry key.' })),
    error => error.code === 'framework_replay_conflict' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.createFrameworkImplementation(draftPayload({ entryKey: 'framework-create-swot-0002' })),
    error => error.code === 'framework_scope_conflict' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.createFrameworkImplementation(draftPayload({ frameworkId: 'tows', status: 'paused', entryKey: 'framework-create-tows-paused-0001' })),
    error => error.code === 'framework_transition_invalid' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.createFrameworkImplementation(draftPayload({ frameworkId: 'tows', reviewDueAt: '2026-02-30', entryKey: 'framework-create-tows-0001' })),
    error => error.code === 'framework_review_date_invalid'
  );

  assert.throws(
    () => ledger.updateFrameworkImplementation(created.implementation.id, {
      ...draftPayload({ status: 'active', entryKey: 'framework-update-swot-0001' }),
      expectedRevision: 1,
      reason: 'Attempt activation without measurable evidence.'
    }),
    error => error.code === 'framework_field_invalid'
  );

  const activated = ledger.updateFrameworkImplementation(created.implementation.id, {
    ...draftPayload({
      status: 'active',
      currentState: 'The service mix has not been assessed against current operating evidence.',
      targetState: 'The selected service mix has an owner, evidence basis, and review trigger.',
      decision: 'Prioritize recurring maintenance density before adding another service line.',
      evidenceRefs: ['scorecard:snapshot:2026-Q3', 'pipeline:forecast:current'],
      successMeasures: ['Recurring revenue share reaches 25 percent.'],
      entryKey: 'framework-update-swot-0002',
      reason: 'Activate the evidence-backed management decision.'
    }),
    expectedRevision: 1
  }, { actor: 'framework-approver' });
  assert.equal(activated.implementation.status, 'active');
  assert.equal(activated.implementation.revision, 2);
  assert.equal(ledger.listFrameworkImplementationRevisions(created.implementation.id).length, 2);
  assert.equal(ledger.listAllFrameworkImplementationRevisions().length, 2);

  assert.throws(
    () => ledger.updateFrameworkImplementation(created.implementation.id, {
      ...draftPayload({ entryKey: 'framework-stale-swot-0001' }),
      expectedRevision: 1
    }),
    error => error.code === 'framework_revision_conflict' && error.statusCode === 409
  );

  const workspace = ledger.getFrameworkWorkspace();
  assert.equal(workspace.summary.retained, 1);
  assert.equal(workspace.summary.statuses.active, 1);
  assert.equal(workspace.summary.dueReviews, 1);
  assert.equal(workspace.summary.coveredFamilies, 1);
  assert.equal(workspace.dueReviews[0].id, created.implementation.id);
  const dueAction = ledger.nextActions().find(action => (
    action.type === 'review_framework_implementation'
    && action.frameworkImplementationId === created.implementation.id
  ));
  assert.equal(dueAction.requiresApproval, false);
  assert.equal(dueAction.severity, 'medium');
  const command = ledger.buildTodayCommandPlan({ search: created.implementation.id, limit: 10 }).actions[0];
  assert.equal(command.actionType, 'review_framework_implementation');
  assert.equal(command.safeDraftable, false);
  assert.equal(command.externalCommitments, 0);
  const haiItem = buildHaiFeed([dueAction])[0];
  assert.equal(haiItem.metadata.actionType, 'review_framework_implementation');
  assert.equal(haiItem.metadata.canExecute, false);
  assert.equal(haiItem.metadata.externalCommitments, 0);
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.counts.frameworkImplementations, 1);
  assert.equal(diagnostics.counts.frameworkImplementationRevisions, 2);
  ledger.db.prepare('UPDATE framework_implementation_revisions SET snapshot_hash = ? WHERE id = ?')
    .run('0'.repeat(64), activated.revision.id);
  const tamperedDiagnostics = ledger.diagnose();
  assert.equal(tamperedDiagnostics.valid, false);
  assert.ok(tamperedDiagnostics.issues.some(issue => issue.message.includes(`Framework revision ${activated.revision.id}`)));
  ledger.db.prepare('UPDATE framework_implementations SET objective = ? WHERE id = ?')
    .run('Tampered current objective.', created.implementation.id);
  const headDriftDiagnostics = ledger.diagnose();
  assert.ok(headDriftDiagnostics.issues.some(issue => issue.message.includes(`Framework implementation ${created.implementation.id} differs`)));
});

test('job-scoped frameworks reject unknown or inactive project activation', t => {
  const ledger = temporaryLedger(t);
  assert.throws(
    () => ledger.createFrameworkImplementation(draftPayload({
      frameworkId: 'kanban', scopeType: 'job', scopeId: 'missing-job', entryKey: 'framework-create-kanban-0001'
    })),
    error => error.code === 'framework_scope_job_not_found' && error.statusCode === 404
  );

  const job = ledger.createIntake({
    title: 'Framework project',
    client: { name: 'Framework Client' },
    status: 'in_progress',
    assignAutomatically: false
  }, { actor: 'framework-test' });
  const created = ledger.createFrameworkImplementation(draftPayload({
    frameworkId: 'kanban',
    scopeType: 'job',
    scopeId: job.id,
    entryKey: 'framework-create-kanban-0002'
  }));
  ledger.db.prepare("UPDATE jobs SET status = 'archived' WHERE id = ?").run(job.id);
  assert.throws(
    () => ledger.createFrameworkImplementation(draftPayload({
      frameworkId: 'swot',
      scopeType: 'job',
      scopeId: job.id,
      status: 'active',
      currentState: 'The archived project has no governed strategic decision record.',
      targetState: 'Only active projects can carry an active strategic decision record.',
      decision: 'Do not activate a framework against an archived project.',
      successMeasures: ['No active framework references an archived project.'],
      entryKey: 'framework-create-archived-swot-0001'
    })),
    error => error.code === 'framework_inactive_job' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.updateFrameworkImplementation(created.implementation.id, {
      ...draftPayload({
        frameworkId: 'kanban', scopeType: 'job', scopeId: job.id, status: 'active',
        currentState: 'Current project work is released without a controlled visual work queue.',
        targetState: 'Project work uses a bounded visual queue with explicit release and completion.',
        decision: 'Use a project Kanban board with work-in-progress limits for site coordination.',
        successMeasures: ['Blocked work older than two days remains below three items.'],
        entryKey: 'framework-update-kanban-0001'
      }),
      expectedRevision: 1
    }),
    error => error.code === 'framework_inactive_job' && error.statusCode === 409
  );
});
