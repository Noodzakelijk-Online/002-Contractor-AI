const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

const SCORECARD_PERIOD_END = '2026-06-30';
const SCORECARD_PERIOD_END_CLOCK = () => new Date('2026-06-30T23:59:59.000Z');

function temporaryLedger(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-performance-scorecard-'));
  const ledger = new ContractorOperatingLedger({
    dbFile: path.join(directory, 'ledger.sqlite'),
    clock: options.clock || SCORECARD_PERIOD_END_CLOCK
  });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function insert(database, table, row) {
  const columns = Object.keys(row);
  database.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...columns.map(column => row[column]));
}

function createJob(ledger, title, status = 'in_progress') {
  const job = ledger.createIntake({
    title,
    client: { name: `${title} Client` },
    status,
    contractValue: 10_000,
    targetCompletion: '2026-08-31',
    assignAutomatically: false
  }, { actor: 'scorecard-test' });
  ledger.db.prepare("UPDATE jobs SET created_at = '2026-01-01T09:00:00.000Z', updated_at = '2026-01-01T09:00:00.000Z' WHERE id = ?")
    .run(job.id);
  return job;
}

function seedPerformanceEvidence(ledger) {
  const active = createJob(ledger, 'Active performance job');
  const completed = createJob(ledger, 'Completed performance job');
  const clientId = ledger.db.prepare('SELECT client_id FROM jobs WHERE id = ?').get(active.id).client_id;
  insert(ledger.db, 'workers', {
    id: 'worker-scorecard', name: 'Scorecard Worker', role: 'installer', email: 'scorecard-worker@example.test', phone: null,
    status: 'active', home_region: 'NL', hourly_rate: 40, skills_json: '[]', data_json: '{}',
    created_at: '2026-01-01T09:00:00.000Z', updated_at: '2026-01-01T09:00:00.000Z'
  });
  ledger.db.prepare(`
    UPDATE jobs
    SET status = 'completed', target_completion = '2026-06-20', data_json = ?, updated_at = '2026-06-19T16:00:00.000Z'
    WHERE id = ?
  `).run(JSON.stringify({ completedAt: '2026-06-19T15:00:00.000Z' }), completed.id);
  const budget = ledger.createBudgetLine(active.id, {
    status: 'baseline',
    costCode: 'BASE',
    description: 'Approved portfolio budget',
    budgetAmount: 8000,
    forecastAmount: 8000
  }, { actor: 'scorecard-test' });
  ledger.resolveApproval(budget.approval.id, { status: 'approved', resolvedBy: 'budget-approver', reason: 'Portfolio margin basis verified.' });

  insert(ledger.db, 'incident_records', {
    id: 'incident-current', job_id: active.id, incident_type: 'injury', title: 'Current incident', status: 'open', severity: 'medium',
    reported_by: 'site', occurred_at: '2026-06-15T09:00:00.000Z', resolved_at: null, approval_id: null, data_json: '{}',
    created_at: '2026-06-15T09:00:00.000Z', updated_at: '2026-06-15T09:00:00.000Z'
  });
  for (const [id, status, dueAt, completedAt] of [
    ['safety-current-closed', 'completed', '2026-06-10T12:00:00.000Z', '2026-06-10T11:00:00.000Z'],
    ['safety-current-open', 'open', '2026-06-11T12:00:00.000Z', null],
    ['safety-prior-closed', 'completed', '2026-03-10T12:00:00.000Z', '2026-03-10T11:00:00.000Z']
  ]) {
    insert(ledger.db, 'safety_checks', {
      id, job_id: active.id, check_type: 'action', title: id, status, risk_level: 'medium', assignee: 'site', due_at: dueAt,
      completed_at: completedAt, approval_id: null, data_json: '{}', created_at: dueAt, updated_at: completedAt || dueAt
    });
  }
  for (const [id, result] of [['inspection-pass', 'passed'], ['inspection-fail', 'failed']]) {
    insert(ledger.db, 'inspection_records', {
      id: `${id}-record`, job_id: active.id, inspection_type: 'quality', title: id, status: 'completed', result,
      inspector: 'inspector', scheduled_at: '2026-06-12T08:00:00.000Z', completed_at: '2026-06-12T09:00:00.000Z',
      defects_json: '[]', approval_id: null, data_json: '{}', created_at: '2026-06-12T08:00:00.000Z', updated_at: '2026-06-12T09:00:00.000Z'
    });
    insert(ledger.db, 'inspection_checklist_submissions', {
      id, inspection_id: `${id}-record`, job_id: active.id, template_id: 'inspection_template_handover_v1', template_version: 1, status: 'submitted', result,
      response_count: 1, failed_count: result === 'passed' ? 0 : 1, snapshot_json: '{}', snapshot_hash: 'hash', approval_id: null,
      submitted_by: 'inspector', submitted_at: '2026-06-12T09:00:00.000Z', data_json: '{}',
      created_at: '2026-06-12T09:00:00.000Z', updated_at: '2026-06-12T09:00:00.000Z'
    });
  }
  insert(ledger.db, 'nonconformance_records', {
    id: 'ncr-open', job_id: active.id, ncr_number: 'NCR-TEST-1', status: 'open', severity: 'medium', discipline: 'general', title: 'Open NCR',
    description: 'Retained defect', location: 'Site', detected_at: '2026-06-12T09:00:00.000Z', raised_by: 'site', worker_id: null,
    requirement_reference: 'SPEC-1', immediate_containment: 'Area isolated', responsible_party: 'crew', due_at: '2026-06-30',
    source_inspection_id: null, source_observation_id: null, evidence_document_id: null, source_hash: 'source', snapshot_hash: 'snapshot', snapshot_json: '{}',
    entry_key: 'scorecard-ncr-open', entry_fingerprint: 'fingerprint', corrective_action_json: null, corrective_action_hash: null,
    correction_approval_id: null, closure_json: null, closure_hash: null, closure_approval_id: null, closed_at: null, closed_by: null,
    data_json: '{}', created_at: '2026-06-12T09:00:00.000Z', updated_at: '2026-06-12T09:00:00.000Z'
  });
  for (const [id, status] of [['warranty-resolved', 'resolved'], ['warranty-open', 'open']]) {
    insert(ledger.db, 'warranty_claims', {
      id, job_id: active.id, title: id, status, client_name: 'Client', severity: 'medium', due_at: '2026-06-30',
      resolved_at: status === 'resolved' ? '2026-06-18T09:00:00.000Z' : null, approval_id: null, data_json: '{}',
      created_at: '2026-06-14T09:00:00.000Z', updated_at: '2026-06-18T09:00:00.000Z'
    });
  }
  insert(ledger.db, 'communication_records', {
    id: 'handover-delivered', job_id: completed.id, client_id: null, channel: 'email', direction: 'outbound', subject: 'Handover', body: 'Retained',
    status: 'delivered', approval_id: null, sent_at: '2026-06-19T16:00:00.000Z', data_json: JSON.stringify({ source: 'handover_issue_package' }),
    created_at: '2026-06-19T16:00:00.000Z', updated_at: '2026-06-19T16:00:00.000Z'
  });
  insert(ledger.db, 'weekly_timesheets', {
    id: 'timesheet-approved', worker_id: 'worker-scorecard', period_start: '2026-06-08', period_end: '2026-06-14', version_number: 1, status: 'approved',
    total_hours: 40, billable_hours: 30, labor_cost: 1000, currency: 'EUR', source_hash: 'timesheet-source', snapshot_hash: 'timesheet-snapshot',
    snapshot_json: '{}', approval_id: null, supersedes_timesheet_id: null, data_json: '{}', created_at: '2026-06-15T09:00:00.000Z', updated_at: '2026-06-15T09:00:00.000Z'
  });
  insert(ledger.db, 'assignments', {
    id: 'assignment-active', job_id: active.id, worker_id: 'worker-scorecard', role: 'installer', status: 'assigned', scheduled_start: '2026-05-01', scheduled_end: '2026-08-31',
    allocation_hours: 40, data_json: '{}', created_at: '2026-05-01T09:00:00.000Z', updated_at: '2026-05-01T09:00:00.000Z'
  });
  for (const [id, dueAt] of [['invoice-overdue', '2026-06-01'], ['invoice-current', '2026-08-01']]) {
    insert(ledger.db, 'invoices', {
      id, job_id: active.id, quote_id: null, status: 'issued', currency: 'EUR', amount: 100, tax_amount: 0, total: 100,
      due_at: dueAt, approval_id: null, data_json: '{}', created_at: '2026-05-15T09:00:00.000Z', updated_at: '2026-05-15T09:00:00.000Z'
    });
  }
  for (const [id, stage, followUp] of [
    ['opportunity-won', 'won', null], ['opportunity-lost', 'lost', null],
    ['opportunity-open-current', 'qualified', '2026-08-01'], ['opportunity-open-overdue', 'qualified', '2026-06-01']
  ]) {
    insert(ledger.db, 'opportunities', {
      id, client_id: clientId, title: id, stage, source_channel: 'referral', service: 'construction', description: null, address: null, city: null,
      postal_code: null, country: 'NL', estimated_value: 1000, probability_percent: 50, target_decision_at: null, next_follow_up_at: followUp,
      owner_name: 'owner', lost_reason: stage === 'lost' ? 'price' : null, converted_job_id: stage === 'won' ? completed.id : null, data_json: '{}',
      created_at: '2026-06-01T09:00:00.000Z', updated_at: '2026-06-18T09:00:00.000Z'
    });
  }
  for (const id of ['tool-used', 'tool-idle']) {
    insert(ledger.db, 'tools', { id, name: id, category: 'power', status: 'available', home_location: 'Yard', current_location: 'Yard', data_json: '{}', created_at: '2026-01-01T09:00:00.000Z', updated_at: '2026-06-01T09:00:00.000Z' });
  }
  for (const row of [
    { id: 'custody-active', tool_id: 'tool-used', status: 'checked_out', due_back_at: '2026-08-01T17:00:00.000Z', returned_at: null },
    { id: 'custody-on-time', tool_id: 'tool-used', status: 'returned', due_back_at: '2026-06-12T17:00:00.000Z', returned_at: '2026-06-12T16:00:00.000Z' },
    { id: 'custody-late', tool_id: 'tool-idle', status: 'returned', due_back_at: '2026-06-12T17:00:00.000Z', returned_at: '2026-06-13T16:00:00.000Z' }
  ]) {
    insert(ledger.db, 'tool_reservations', {
      id: `${row.id}-reservation`, job_id: active.id, tool_id: row.tool_id, tool_name: row.tool_id,
      status: row.status === 'checked_out' ? 'active' : 'completed', needed_from: '2026-06-10T09:00:00.000Z', needed_until: row.due_back_at,
      data_json: '{}', created_at: '2026-06-10T09:00:00.000Z', updated_at: row.returned_at || '2026-06-10T09:00:00.000Z'
    });
    insert(ledger.db, 'equipment_custody_sessions', {
      id: row.id, tool_id: row.tool_id, job_id: active.id, reservation_id: `${row.id}-reservation`, worker_id: 'worker-scorecard', status: row.status,
      checked_out_at: '2026-06-10T09:00:00.000Z', due_back_at: row.due_back_at, checked_out_by: 'office', checkout_location: 'Yard',
      checkout_condition: 'serviceable', checkout_meter: null, checkout_evidence_reference: 'OUT', checkout_entry_key: `${row.id}-out`, checkout_fingerprint: 'out',
      returned_at: row.returned_at, returned_by: row.returned_at ? 'office' : null, return_location: row.returned_at ? 'Yard' : null,
      return_condition: row.returned_at ? 'serviceable' : null, return_meter: null, return_evidence_reference: row.returned_at ? 'IN' : null,
      return_entry_key: row.returned_at ? `${row.id}-in` : null, return_fingerprint: row.returned_at ? 'in' : null, data_json: '{}',
      created_at: '2026-06-10T09:00:00.000Z', updated_at: row.returned_at || '2026-06-10T09:00:00.000Z'
    });
  }
  for (const [id, status, expiry] of [['permit-valid', 'active', '2026-12-31'], ['permit-pending', 'pending_approval', '2026-12-31']]) {
    insert(ledger.db, 'permit_records', {
      id, job_id: active.id, permit_type: 'work', title: id, status, holder: 'crew', location: 'site', issued_at: '2026-01-01', expires_at: expiry,
      approval_id: null, data_json: '{}', created_at: '2026-01-01T09:00:00.000Z', updated_at: '2026-06-01T09:00:00.000Z', valid_from: '2026-01-01',
      evidence_reference: 'PERMIT', source_hash: 'source', snapshot_hash: 'snapshot', snapshot_json: '{}', entry_key: `${id}-entry`, entry_fingerprint: 'fingerprint',
      suspended_at: null, closed_at: null, closure_evidence_reference: null
    });
  }
  for (const [id, insuranceExpiry] of [['partner-valid', '2026-12-31'], ['partner-expired', '2026-01-01']]) {
    insert(ledger.db, 'trade_partners', {
      id, name: id, partner_type: 'subcontractor', contact_name: null, email: `${id}@example.test`, phone: null, address: null, city: null, country: 'NL',
      registration_number: id, vat_number: null, status: 'active', insurance_expires_at: insuranceExpiry, vca_expires_at: '2026-12-31',
      specialties_json: '[]', data_json: '{}', created_at: '2026-01-01T09:00:00.000Z', updated_at: '2026-06-01T09:00:00.000Z'
    });
  }
  for (const [id, status, evidence] of [['environment-approved', 'approved', true], ['environment-pending', 'pending_approval', false]]) {
    insert(ledger.db, 'environmental_activities', {
      id, job_id: active.id, worker_id: null, activity_date: '2026-06-15', category: 'fuel', ghg_scope: 'scope_1', description: id,
      quantity: 10, unit: 'litre', emission_factor: 2.5, emissions_kg_co2e: 25, factor_source: 'DEFRA',
      factor_reference: '2026 factor', evidence_reference: evidence ? 'FUEL-1' : '', evidence_document_id: null, status,
      approval_id: null, reversal_approval_id: null, entry_key: `${id}-entry`, entry_fingerprint: `${id}-fingerprint`, source_fingerprint: `${id}-source`, notes: null,
      data_json: '{}', created_at: '2026-06-15T09:00:00.000Z', updated_at: '2026-06-15T09:00:00.000Z'
    });
  }
  return { active, completed };
}

test('Contractor Balanced Scorecard derives all ten perspectives and freezes source-current results', t => {
  const ledger = temporaryLedger(t);
  const { active } = seedPerformanceEvidence(ledger);
  let scorecard = ledger.calculatePerformanceScorecard({ periodEnd: SCORECARD_PERIOD_END, weeks: 13 });
  assert.equal(scorecard.perspectives.length, 10);
  assert.equal(scorecard.metrics.length, 20);
  assert.equal(scorecard.targets.effective.length, 20);
  assert.equal(scorecard.ready, true);
  const value = key => scorecard.metrics.find(metric => metric.key === key);
  assert.equal(value('recordable_incidents').value, 1);
  assert.equal(value('safety_action_closure_pct').value, 50);
  assert.equal(value('safety_action_closure_pct').priorValue, 100);
  assert.equal(value('safety_action_closure_pct').trend, 'declining');
  assert.equal(value('inspection_pass_rate_pct').value, 50);
  assert.equal(value('open_nonconformances').value, 1);
  assert.equal(value('on_time_completion_pct').value, 100);
  assert.equal(value('overdue_active_jobs').value, 0);
  assert.equal(value('warranty_resolution_pct').value, 50);
  assert.equal(value('handover_delivery_pct').value, 100);
  assert.equal(value('billable_utilization_pct').value, 75);
  assert.equal(value('assignment_coverage_pct').value, 100);
  assert.equal(value('portfolio_margin_pct').value, 20);
  assert.equal(value('overdue_receivable_rate_pct').value, 50);
  assert.equal(value('opportunity_win_rate_pct').value, 50);
  assert.equal(value('follow_up_compliance_pct').value, 50);
  assert.equal(value('equipment_utilization_pct').value, 50);
  assert.equal(value('equipment_return_compliance_pct').value, 50);
  assert.equal(value('permit_validity_pct').value, 50);
  assert.equal(value('trade_partner_compliance_pct').value, 50);
  assert.equal(value('environmental_approval_rate_pct').value, 50);
  assert.equal(value('emissions_evidence_coverage_pct').value, 50);

  const target = ledger.requestPerformanceScorecardTarget({
    metricKey: 'recordable_incidents',
    targetValue: 1,
    entryKey: 'performance-target-incidents-0001',
    reason: 'Approved management tolerance for the current reporting period.'
  }, { actor: 'office' });
  assert.equal(target.target.status, 'pending_approval');
  assert.equal(target.approval.targetType, 'performance_scorecard_target');
  assert.match(target.approval.decision.primaryEffect, /target revision/i);
  assert.equal(ledger.requestPerformanceScorecardTarget({
    metricKey: 'recordable_incidents',
    targetValue: 1,
    entryKey: 'performance-target-incidents-0001',
    reason: 'Approved management tolerance for the current reporting period.'
  }).replayed, true);
  assert.throws(
    () => ledger.requestPerformanceScorecardTarget({
      metricKey: 'recordable_incidents', targetValue: 0, entryKey: 'performance-target-incidents-0001', reason: 'Conflicting retry payload.'
    }),
    error => error.code === 'performance_target_replay_conflict' && error.statusCode === 409
  );
  scorecard = ledger.calculatePerformanceScorecard({ periodEnd: SCORECARD_PERIOD_END, weeks: 13 });
  assert.equal(scorecard.ready, false);
  assert.ok(scorecard.blockers.some(blocker => blocker.code === 'performance_target_revisions_pending'));
  ledger.resolveApproval(target.approval.id, { status: 'approved', resolvedBy: 'owner', reason: 'Threshold and management basis verified.' });
  scorecard = ledger.calculatePerformanceScorecard({ periodEnd: SCORECARD_PERIOD_END, weeks: 13 });
  assert.equal(scorecard.metrics.find(metric => metric.key === 'recordable_incidents').targetValue, 1);
  assert.equal(scorecard.metrics.find(metric => metric.key === 'recordable_incidents').status, 'on_track');

  const requested = ledger.requestPerformanceScorecardSnapshot({ periodEnd: SCORECARD_PERIOD_END, weeks: 13 }, { actor: 'office' });
  assert.match(requested.snapshot.scorecardNumber, /^BSC-\d{4}-000001$/);
  assert.equal(requested.snapshot.status, 'pending_approval');
  assert.equal(requested.snapshot.integrityValid, true);
  assert.equal(requested.approval.targetType, 'performance_scorecard');
  assert.ok(requested.approval.decision.safeguards.some(item => /missing evidence never counts as passing/i.test(item)));
  assert.equal(ledger.requestPerformanceScorecardSnapshot({ periodEnd: SCORECARD_PERIOD_END, weeks: 13 }).replayed, true);
  ledger.resolveApproval(requested.approval.id, { status: 'approved', resolvedBy: 'owner', reason: 'Metric evidence, gaps, targets, and reporting period verified.' });
  assert.equal(ledger.calculatePerformanceScorecard({ periodEnd: SCORECARD_PERIOD_END, weeks: 13 }).snapshotCurrent, true);

  insert(ledger.db, 'incident_records', {
    id: 'incident-late', job_id: active.id, incident_type: 'injury', title: 'Late source change', status: 'open', severity: 'medium',
    reported_by: 'site', occurred_at: '2026-06-20T09:00:00.000Z', resolved_at: null, approval_id: null, data_json: '{}',
    created_at: '2026-06-20T09:00:00.000Z', updated_at: '2026-06-20T09:00:00.000Z'
  });
  assert.equal(ledger.calculatePerformanceScorecard({ periodEnd: SCORECARD_PERIOD_END, weeks: 13 }).snapshotCurrent, false);
  const revised = ledger.requestPerformanceScorecardSnapshot({ periodEnd: SCORECARD_PERIOD_END, weeks: 13 });
  ledger.db.prepare("UPDATE safety_checks SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = 'safety-current-open'")
    .run('2026-06-21T09:00:00.000Z', '2026-06-21T09:00:00.000Z');
  assert.throws(
    () => ledger.resolveApproval(revised.approval.id, { status: 'approved', resolvedBy: 'owner', reason: 'Stale source must be rejected.' }),
    error => error.code === 'performance_scorecard_stale' && error.statusCode === 409
  );
  assert.equal(ledger.migrationStatus().currentVersion, '060_daily_operating_cycles');
  const diagnostics = ledger.diagnose();
  assert.equal(
    diagnostics.issues.some(issue => /approved performance .*lack|Performance scorecard .*failed retained snapshot verification/i.test(issue.message)),
    false,
    JSON.stringify(diagnostics.issues, null, 2)
  );
});

test('historical scorecards omit mutable point-in-time state and ignore unrelated post-period records', t => {
  const ledger = temporaryLedger(t, { clock: () => new Date('2026-07-20T12:00:00.000Z') });
  const { active } = seedPerformanceEvidence(ledger);
  const before = ledger.calculatePerformanceScorecard({ periodEnd: SCORECARD_PERIOD_END, weeks: 13 });
  const pointInTime = before.metrics.filter(metric => metric.basis === 'point_in_time');

  assert.equal(pointInTime.length, 9);
  assert.equal(pointInTime.every(metric => metric.status === 'no_data'), true);
  assert.equal(pointInTime.every(metric => metric.availability === 'historical_state_not_retained'), true);
  assert.equal(before.metrics.find(metric => metric.key === 'inspection_pass_rate_pct').value, 50);
  assert.equal(before.sourceBasis.sourceScope, 'material_metric_inputs/v2');
  assert.equal(before.sourceBasis.pointInTime.available, false);
  assert.ok(before.warnings.some(warning => warning.code === 'performance_historical_point_in_time_unavailable'));

  insert(ledger.db, 'incident_records', {
    id: 'incident-after-period', job_id: active.id, incident_type: 'injury', title: 'Outside reporting period', status: 'open', severity: 'medium',
    reported_by: 'site', occurred_at: '2026-07-10T09:00:00.000Z', resolved_at: null, approval_id: null, data_json: '{}',
    created_at: '2026-07-10T09:00:00.000Z', updated_at: '2026-07-10T09:00:00.000Z'
  });
  ledger.db.prepare("UPDATE tools SET status = 'maintenance', updated_at = '2026-07-15T09:00:00.000Z' WHERE id = 'tool-idle'").run();
  const afterUnrelatedChanges = ledger.calculatePerformanceScorecard({ periodEnd: SCORECARD_PERIOD_END, weeks: 13 });
  assert.equal(afterUnrelatedChanges.sourceHash, before.sourceHash);

  insert(ledger.db, 'incident_records', {
    id: 'incident-late-period-evidence', job_id: active.id, incident_type: 'injury', title: 'Late retained period evidence', status: 'open', severity: 'medium',
    reported_by: 'site', occurred_at: '2026-06-20T09:00:00.000Z', resolved_at: null, approval_id: null, data_json: '{}',
    created_at: '2026-07-18T09:00:00.000Z', updated_at: '2026-07-18T09:00:00.000Z'
  });
  const afterMaterialChange = ledger.calculatePerformanceScorecard({ periodEnd: SCORECARD_PERIOD_END, weeks: 13 });
  assert.notEqual(afterMaterialChange.sourceHash, before.sourceHash);
  assert.equal(afterMaterialChange.metrics.find(metric => metric.key === 'recordable_incidents').value, 2);
});

test('portfolio margin skips active jobs that cannot satisfy cost-forecast readiness', t => {
  const ledger = temporaryLedger(t);
  for (let index = 0; index < 40; index += 1) {
    createJob(ledger, `Unbudgeted performance job ${index + 1}`);
  }
  const eligible = createJob(ledger, 'Budgeted performance job');
  const budget = ledger.createBudgetLine(eligible.id, {
    status: 'baseline',
    costCode: 'BASE',
    description: 'Approved portfolio baseline',
    budgetAmount: 8000,
    forecastAmount: 8000
  }, { actor: 'scorecard-test' });
  ledger.resolveApproval(budget.approval.id, {
    status: 'approved',
    resolvedBy: 'budget-approver',
    reason: 'Portfolio baseline verified for scorecard calculation.'
  });

  const calculateCostForecast = ledger.calculateCostForecast.bind(ledger);
  let forecastCalls = 0;
  ledger.calculateCostForecast = (...args) => {
    forecastCalls += 1;
    return calculateCostForecast(...args);
  };
  const scorecard = ledger.calculatePerformanceScorecard({ periodEnd: SCORECARD_PERIOD_END, weeks: 13 });
  const margin = scorecard.metrics.find(metric => metric.key === 'portfolio_margin_pct');
  assert.equal(forecastCalls, 1);
  assert.equal(margin.value, 20);
  assert.equal(margin.sampleSize, 1);
});

test('empty scorecards expose missing evidence and tampered snapshots fail diagnostics', t => {
  const ledger = temporaryLedger(t);
  const empty = ledger.calculatePerformanceScorecard({ periodEnd: SCORECARD_PERIOD_END, weeks: 13 });
  assert.equal(empty.summary.overallScore, 0);
  assert.equal(empty.summary.dataCoveragePct, 0);
  assert.equal(empty.summary.noData, 20);
  assert.equal(empty.metrics.every(metric => metric.status === 'no_data'), true);
  const requested = ledger.requestPerformanceScorecardSnapshot({ periodEnd: SCORECARD_PERIOD_END, weeks: 13 });
  const row = ledger.db.prepare('SELECT snapshot_json FROM performance_scorecard_snapshots WHERE id = ?').get(requested.snapshot.id);
  const tampered = JSON.parse(row.snapshot_json);
  tampered.summary.overallScore = 100;
  ledger.db.prepare('UPDATE performance_scorecard_snapshots SET snapshot_json = ? WHERE id = ?')
    .run(JSON.stringify(tampered), requested.snapshot.id);
  assert.throws(
    () => ledger.getPerformanceScorecardSnapshot(requested.snapshot.id),
    error => error.code === 'performance_scorecard_integrity_failed' && error.statusCode === 409
  );
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.issues.some(issue => /Performance scorecard .*failed retained snapshot verification/.test(issue.message)));
});

test('scorecard period validation and target bounds reject malformed requests', t => {
  const ledger = temporaryLedger(t);
  assert.throws(() => ledger.calculatePerformanceScorecard({ periodEnd: 'not-a-date', weeks: 13 }), error => error.code === 'performance_scorecard_period_invalid');
  assert.throws(() => ledger.calculatePerformanceScorecard({ periodEnd: '2099-12-31', weeks: 13 }), error => error.code === 'performance_scorecard_period_future');
  assert.throws(() => ledger.calculatePerformanceScorecard({ periodEnd: SCORECARD_PERIOD_END, weeks: 3 }), error => error.code === 'performance_scorecard_weeks_invalid');
  assert.throws(
    () => ledger.requestPerformanceScorecardTarget({ metricKey: 'unknown', targetValue: 1, entryKey: 'performance-invalid-target', reason: 'Invalid metric should fail.' }),
    error => error.code === 'performance_metric_invalid'
  );
  assert.throws(
    () => ledger.requestPerformanceScorecardTarget({ metricKey: 'inspection_pass_rate_pct', targetValue: 101, entryKey: 'performance-invalid-percent', reason: 'Invalid percentage should fail.' }),
    error => error.code === 'performance_target_value_invalid'
  );
});
