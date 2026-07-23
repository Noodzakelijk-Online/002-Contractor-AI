const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ContractorOperatingLedger } = require('../operating-ledger');

function standardItems(tool) {
  return [
    {
      id: 'sort-unneeded',
      stage: 'sort',
      title: 'Remove unneeded items',
      requirement: 'Only the retained task equipment and consumables remain in the location.'
    },
    {
      id: 'set-tool-home',
      stage: 'set_in_order',
      itemType: 'tool',
      toolId: tool.id,
      title: 'Return core drill to its marked home',
      requirement: 'The core drill is available, inspection-ready, and stored at the retained location.'
    },
    {
      id: 'shine-clean',
      stage: 'shine',
      title: 'Clean storage and equipment',
      requirement: 'Storage surfaces and retained equipment are clean and damage is visible.'
    },
    {
      id: 'standardize-labels',
      stage: 'standardize',
      title: 'Keep labels and outlines current',
      requirement: 'Every retained position has a readable label or visual outline.'
    },
    {
      id: 'sustain-audit',
      stage: 'sustain',
      title: 'Retain the audit routine',
      requirement: 'The owner can show the current standard and the next audit cadence.'
    }
  ];
}

function fixture(t, suffix = 'primary') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-five-s-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const job = ledger.createIntake({
    client: { name: `5S client ${suffix}` },
    title: `5S job ${suffix}`,
    status: 'scheduled',
    assignAutomatically: false
  }, { actor: 'five-s-test' });
  const locationName = `Service van ${suffix}`;
  const tool = ledger.upsertTool({
    name: `Core drill ${suffix}`,
    category: 'drilling',
    status: 'available',
    currentLocation: locationName
  });
  const location = ledger.createFiveSLocation({
    jobId: job.id,
    name: locationName,
    locationType: 'vehicle',
    identifier: `VAN-${suffix}`,
    owner: 'Site lead',
    auditFrequencyDays: 7,
    entryKey: `five-s-location-${suffix}`
  }).location;
  return { ledger, job, tool, location };
}

test('approved 5S standards drive replay-safe audits and evidence-backed corrective actions', t => {
  const { ledger, job, tool, location } = fixture(t, 'governed');
  const standardPayload = {
    items: standardItems(tool),
    reason: 'Retain the vehicle organization standard before field use.',
    entryKey: 'five-s-standard-governed'
  };
  const requested = ledger.requestFiveSStandard(location.id, standardPayload, { actor: 'office-planner' });
  assert.equal(requested.standard.status, 'pending_approval');
  assert.equal(requested.standard.integrityValid, true);
  assert.equal(requested.approval.targetType, 'five_s_standard');
  assert.equal(ledger.requestFiveSStandard(location.id, standardPayload).replayed, true);
  const pending = ledger.listApprovals({ status: 'pending' }).find(item => item.id === requested.approval.id);
  assert.match(pending.decision.primaryEffect, /Approve 5S standard version 1/);
  assert.equal(pending.decision.preview.itemCount, 5);
  assert.equal(pending.decision.preview.linkedToolCount, 1);

  ledger.resolveApproval(requested.approval.id, {
    status: 'approved',
    resolvedBy: 'owner',
    reason: 'All five stages and the linked equipment identity were checked.'
  });
  const approved = ledger.listFiveSStandards({ locationId: location.id, status: 'approved' })[0];
  assert.equal(approved.id, requested.standard.id);

  const auditPayload = {
    standardId: approved.id,
    auditDate: new Date().toISOString().slice(0, 10),
    auditedBy: 'Field lead',
    evidenceReferences: ['photo-set:five-s-governed'],
    entryKey: 'five-s-audit-governed',
    results: approved.items.map(item => item.id === 'shine-clean'
      ? {
          itemId: item.id,
          result: 'fail',
          finding: 'Dust and drilling slurry remain on the lower storage shelf.',
          actionOwner: 'Field lead',
          actionDueDate: new Date().toISOString().slice(0, 10),
          severity: 'medium'
        }
      : { itemId: item.id, result: 'pass', note: 'Checked against the retained standard.' })
  };
  const failed = ledger.recordFiveSAudit(location.id, auditPayload, { actor: 'field-lead' });
  assert.equal(failed.audit.status, 'action_required');
  assert.equal(failed.audit.scorePercent, 80);
  assert.equal(failed.actions.length, 1);
  assert.equal(ledger.recordFiveSAudit(location.id, auditPayload).replayed, true);
  let board = ledger.getFiveSBoard({ jobId: job.id, includeGlobal: false });
  assert.equal(board.summary.openActions, 1);
  assert.equal(board.rows[0].status, 'action_required');

  const resolutionPayload = {
    evidenceReference: 'photo:clean-lower-shelf',
    resolutionNote: 'Shelf and core-drill storage area cleaned and rechecked.',
    entryKey: 'five-s-action-resolution-governed'
  };
  const resolved = ledger.resolveFiveSAction(failed.actions[0].id, resolutionPayload, { actor: 'field-lead' });
  assert.equal(resolved.action.status, 'resolved');
  assert.equal(resolved.action.integrityValid, true);
  assert.equal(ledger.resolveFiveSAction(failed.actions[0].id, resolutionPayload).replayed, true);

  const compliantPayload = {
    standardId: approved.id,
    auditDate: new Date().toISOString().slice(0, 10),
    auditedBy: 'Field lead',
    evidenceReferences: ['photo-set:five-s-recheck'],
    entryKey: 'five-s-audit-recheck-governed',
    results: approved.items.map(item => ({ itemId: item.id, result: 'pass', note: 'Rechecked after corrective action.' }))
  };
  const compliant = ledger.recordFiveSAudit(location.id, compliantPayload);
  assert.equal(compliant.audit.status, 'compliant');
  board = ledger.getFiveSBoard({ jobId: job.id, includeGlobal: false });
  assert.equal(board.ready, true);
  assert.equal(board.summary.ready, 1);
  assert.equal(board.safeguards.toolStatusChanged, false);
  assert.equal(board.safeguards.vehicleDispatched, false);
  assert.equal(ledger.dailyPlanningSource(job.id, new Date().toISOString().slice(0, 10)).fiveS.ready, true);
  assert.equal(ledger.getJobDetail(job.id).fiveSAudits.length, 2);
  assert.equal(ledger.diagnose().valid, true, JSON.stringify(ledger.diagnose().issues));
  assert.equal(ledger.migrationStatus().currentVersion, '066_governed_client_feedback');
});

test('5S approval and audit reject stale or contradictory canonical equipment state', t => {
  const { ledger, tool, location } = fixture(t, 'stale');
  const stale = ledger.requestFiveSStandard(location.id, {
    items: standardItems(tool),
    entryKey: 'five-s-standard-stale'
  });
  ledger.upsertTool({
    id: tool.id,
    name: `${tool.name} renamed`,
    category: tool.category,
    status: 'available',
    currentLocation: location.name
  });
  assert.throws(
    () => ledger.resolveApproval(stale.approval.id, {
      status: 'approved',
      resolvedBy: 'owner',
      reason: 'Attempt approval against changed equipment.'
    }),
    error => error.code === 'five_s_standard_stale'
  );
  ledger.resolveApproval(stale.approval.id, {
    status: 'rejected',
    resolvedBy: 'owner',
    reason: 'Equipment identity changed before approval.'
  });

  const currentTool = ledger.listTools({ limit: 500 }).find(item => item.id === tool.id);
  const current = ledger.requestFiveSStandard(location.id, {
    items: standardItems(currentTool),
    entryKey: 'five-s-standard-current'
  });
  ledger.resolveApproval(current.approval.id, {
    status: 'approved',
    resolvedBy: 'owner',
    reason: 'Current equipment identity checked.'
  });
  ledger.upsertTool({
    id: tool.id,
    name: currentTool.name,
    category: currentTool.category,
    status: 'maintenance',
    currentLocation: location.name
  });
  assert.throws(
    () => ledger.recordFiveSAudit(location.id, {
      standardId: current.standard.id,
      auditDate: new Date().toISOString().slice(0, 10),
      auditedBy: 'Field lead',
      evidenceReferences: ['photo:contradictory-pass'],
      entryKey: 'five-s-audit-contradictory',
      results: current.standard.items.map(item => ({ itemId: item.id, result: 'pass' }))
    }),
    error => error.code === 'five_s_audit_tool_state_conflict'
  );
  assert.equal(ledger.listFiveSAudits({ locationId: location.id }).length, 0);
});

test('5S autonomy creates only idempotent internal review work', t => {
  const { ledger, job, location } = fixture(t, 'autonomy');
  const actions = ledger.nextActions({ includeFiveS: true })
    .filter(action => action.type === 'review_five_s_standard');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].locationId, location.id);
  const applied = ledger.runAutonomousCycle({
    actionTypes: ['review_five_s_standard'],
    jobIds: [job.id],
    actor: 'five-s-autonomy'
  });
  assert.equal(applied.applied.length, 1);
  assert.equal(applied.applied[0].externalCommitments, 0);
  assert.equal(applied.applied[0].toolStatusChanged, false);
  assert.equal(applied.applied[0].vehicleDispatched, false);
  const reviewTask = ledger.getJobDetail(job.id).tasks.find(task => task.data?.locationId === location.id);
  assert.equal(reviewTask.data.internalOnly, true);
  assert.equal(reviewTask.data.excludeFromWorkPlan, true);
  assert.equal(ledger.runAutonomousCycle({
    actionTypes: ['review_five_s_standard'],
    jobIds: [job.id]
  }).applied.length, 0);
});
