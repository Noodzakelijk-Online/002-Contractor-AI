const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function fixture(t, suffix = 'governed') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-daywork-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  const job = ledger.createIntake({
    title: `Daywork ${suffix}`,
    client: { name: `Daywork client ${suffix}` },
    status: 'in_progress',
    assignAutomatically: false
  }, { actor: 'daywork_test' });
  const worker = ledger.upsertWorker({
    name: `Field worker ${suffix}`,
    role: 'Site operative',
    status: 'available'
  }, { actor: 'daywork_test' });
  ledger.addAssignment(job.id, {
    workerId: worker.id,
    workerName: worker.name,
    role: worker.role,
    status: 'assigned'
  }, { actor: 'daywork_test' });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ledger, job, worker };
}

function ticketPayload(worker, suffix = '001') {
  return {
    entryKey: `daywork-entry-${suffix}`,
    workerId: worker.id,
    workerName: worker.name,
    workDate: new Date().toISOString().slice(0, 10),
    title: 'Additional cable tray supports',
    description: 'Installed extra supports after the retained routing conflicted with existing services.',
    reason: 'Existing services were not shown at the approved routing elevation.',
    evidenceReference: `field-photo-set:${suffix}`,
    lines: [
      {
        lineKey: 'labor-installation',
        lineType: 'labor',
        description: 'Installation labor',
        quantity: 6.5,
        unit: 'hour',
        costCode: 'LAB-ELEC',
        sourceReference: `timesheet:${suffix}`
      },
      {
        lineKey: 'support-material',
        lineType: 'material',
        description: 'Galvanized support brackets',
        quantity: 8,
        unit: 'piece',
        costCode: 'MAT-ELEC',
        sourceReference: `delivery-note:${suffix}`
      }
    ]
  };
}

test('daywork quantities flow through source-bound approval, receipt acknowledgement, and change control', t => {
  const { ledger, job, worker } = fixture(t, 'lifecycle');
  const payload = ticketPayload(worker, 'lifecycle-001');
  const created = ledger.createDayworkTicket(job.id, payload, { actor: 'field_worker' });

  assert.equal(created.replayed, false);
  assert.match(created.ticket.ticketNumber, /^DW-\d{4}-\d{6}$/);
  assert.equal(created.ticket.status, 'pending_approval');
  assert.equal(created.ticket.integrityValid, true);
  assert.equal(created.ticket.lineCount, 2);
  assert.equal(created.approval.targetType, 'daywork_ticket');
  assert.equal(created.externalCommitments, 0);

  const replay = ledger.createDayworkTicket(job.id, payload, { actor: 'offline_retry' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.ticket.id, created.ticket.id);
  assert.equal(replay.approval.id, created.approval.id);
  assert.throws(
    () => ledger.createDayworkTicket(job.id, {
      ...payload,
      title: 'Changed retry content'
    }),
    error => error.code === 'daywork_entry_key_reused' && error.statusCode === 409
  );

  const decision = ledger.resolveApproval(created.approval.id, {
    status: 'approved',
    resolvedBy: 'daywork_approver',
    reason: 'Observed quantities and evidence verified.'
  });
  assert.equal(decision.status, 'approved');
  assert.equal(ledger.getDayworkTicket(created.ticket.id).status, 'approved');

  const acknowledgementPayload = {
    evidenceReference: 'signed-site-record:DW-001',
    acknowledgedBy: 'Client site representative',
    acknowledgedAt: new Date().toISOString(),
    notes: 'Receipt of the site record only; commercial review remains separate.'
  };
  const acknowledgement = ledger.requestDayworkAcknowledgement(
    job.id,
    created.ticket.id,
    acknowledgementPayload,
    { actor: 'office_operator' }
  );
  assert.equal(acknowledgement.replayed, false);
  assert.equal(acknowledgement.approval.targetType, 'daywork_acknowledgement');
  assert.equal(acknowledgement.externalCommitments, 0);
  const acknowledgementReplay = ledger.requestDayworkAcknowledgement(job.id, created.ticket.id, acknowledgementPayload);
  assert.equal(acknowledgementReplay.replayed, true);
  assert.throws(
    () => ledger.requestDayworkAcknowledgement(job.id, created.ticket.id, {
      ...acknowledgementPayload,
      evidenceReference: 'different-evidence-reference'
    }),
    error => error.code === 'daywork_acknowledgement_pending_conflict' && error.statusCode === 409
  );

  ledger.resolveApproval(acknowledgement.approval.id, {
    status: 'approved',
    resolvedBy: 'daywork_approver',
    reason: 'Receipt evidence verified against the retained daywork source.'
  });
  const acknowledged = ledger.getDayworkTicket(created.ticket.id);
  assert.equal(acknowledged.status, 'acknowledged');
  assert.equal(acknowledged.acknowledgementReference, acknowledgementPayload.evidenceReference);

  const conversionPayload = {
    prices: [
      { lineKey: 'labor-installation', unitPrice: 72.5 },
      { lineKey: 'support-material', unitPrice: 18.75 }
    ],
    taxRate: 21,
    scheduleDeltaDays: 1
  };
  const converted = ledger.convertDayworkTicketToChangeOrder(job.id, created.ticket.id, conversionPayload, { actor: 'office_operator' });
  assert.equal(converted.replayed, false);
  assert.equal(converted.ticket.status, 'converted');
  assert.equal(converted.changeOrder.status, 'pending_approval');
  assert.equal(converted.changeOrder.amount, 621.25);
  assert.ok(converted.changeOrder.approvalId);
  assert.equal(converted.changeOrder.data.source.type, 'daywork_ticket');
  assert.equal(converted.changeOrder.data.source.id, created.ticket.id);
  assert.equal(converted.changeOrder.data.source.sourceHash, created.ticket.sourceHash);
  assert.equal(converted.changeOrder.data.source.acknowledged, true);
  assert.equal(converted.externalCommitments, 0);

  const conversionReplay = ledger.convertDayworkTicketToChangeOrder(job.id, created.ticket.id, conversionPayload);
  assert.equal(conversionReplay.replayed, true);
  assert.equal(conversionReplay.changeOrder.id, converted.changeOrder.id);
  assert.throws(
    () => ledger.convertDayworkTicketToChangeOrder(job.id, created.ticket.id, {
      ...conversionPayload,
      prices: conversionPayload.prices.map((price, index) => index === 0 ? { ...price, unitPrice: 73 } : price)
    }),
    error => error.code === 'daywork_conversion_conflict' && error.statusCode === 409
  );
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
  const diagnostics = ledger.diagnose();
  assert.equal(diagnostics.valid, true, JSON.stringify(diagnostics.issues));
  assert.equal(diagnostics.migrations.currentVersion, '049_contractor_balanced_scorecard');
  assert.equal(diagnostics.counts.dayworkTickets, 1);
  assert.equal(ledger.dashboardSummary().metrics.dayworkTickets, 1);
});

test('daywork approval fails atomically after retained quantity tampering', t => {
  const { ledger, job, worker } = fixture(t, 'tamper');
  const created = ledger.createDayworkTicket(job.id, ticketPayload(worker, 'tamper-001'));
  const row = ledger.db.prepare('SELECT lines_json FROM daywork_tickets WHERE id = ?').get(created.ticket.id);
  const lines = JSON.parse(row.lines_json);
  lines[0].quantity = 65;
  ledger.db.prepare('UPDATE daywork_tickets SET lines_json = ? WHERE id = ?').run(JSON.stringify(lines), created.ticket.id);

  assert.throws(
    () => ledger.resolveApproval(created.approval.id, {
      status: 'approved',
      resolvedBy: 'daywork_approver',
      reason: 'This must roll back.'
    }),
    error => error.code === 'daywork_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.db.prepare('SELECT status FROM approvals WHERE id = ?').get(created.approval.id).status, 'pending');
  assert.equal(ledger.db.prepare('SELECT status FROM daywork_tickets WHERE id = ?').get(created.ticket.id).status, 'pending_approval');
  assert.equal(ledger.getDayworkTicket(created.ticket.id).integrityValid, false);
  assert.equal(ledger.diagnose().valid, false);
});

test('converted daywork fails closed when retained ticket or commercial data is changed', t => {
  const { ledger, job, worker } = fixture(t, 'converted-tamper');
  const created = ledger.createDayworkTicket(job.id, ticketPayload(worker, 'converted-tamper-001'));
  ledger.resolveApproval(created.approval.id, {
    status: 'approved',
    resolvedBy: 'daywork_approver',
    reason: 'Observed quantities verified before conversion.'
  });
  const conversionPayload = {
    prices: [
      { lineKey: 'labor-installation', unitPrice: 72.5 },
      { lineKey: 'support-material', unitPrice: 18.75 }
    ],
    taxRate: 21,
    scheduleDeltaDays: 0
  };
  const converted = ledger.convertDayworkTicketToChangeOrder(job.id, created.ticket.id, conversionPayload);

  ledger.db.prepare('UPDATE change_orders SET schedule_delta_days = 2 WHERE id = ?').run(converted.changeOrder.id);
  const changedCommercial = ledger.diagnose();
  assert.equal(changedCommercial.valid, false);
  assert.ok(changedCommercial.issues.some(issue => issue.message.includes('commercial request integrity')));
  ledger.db.prepare('UPDATE change_orders SET schedule_delta_days = 0 WHERE id = ?').run(converted.changeOrder.id);

  const row = ledger.db.prepare('SELECT snapshot_json FROM daywork_tickets WHERE id = ?').get(created.ticket.id);
  const snapshot = JSON.parse(row.snapshot_json);
  ledger.db.prepare('UPDATE daywork_tickets SET snapshot_json = ? WHERE id = ?')
    .run(JSON.stringify({ ...snapshot, tampered: true }), created.ticket.id);
  assert.throws(
    () => ledger.convertDayworkTicketToChangeOrder(job.id, created.ticket.id, conversionPayload),
    error => error.code === 'daywork_conversion_not_ready' && error.statusCode === 409
  );
});

test('daywork validation rejects unassigned workers and incomplete evidence without retaining partial records', t => {
  const { ledger, job, worker } = fixture(t, 'validation');
  const payload = ticketPayload(worker, 'validation-001');
  assert.throws(
    () => ledger.createDayworkTicket(job.id, { ...payload, entryKey: 'daywork-no-lines-001', lines: [] }),
    error => error.code === 'daywork_lines_required'
  );
  assert.throws(
    () => ledger.createDayworkTicket(job.id, { ...payload, entryKey: 'daywork-no-evidence-001', evidenceReference: '' }),
    error => error.code === 'daywork_evidence_required'
  );
  ledger.db.prepare("UPDATE assignments SET status = 'cancelled' WHERE job_id = ?").run(job.id);
  assert.throws(
    () => ledger.createDayworkTicket(job.id, { ...payload, entryKey: 'daywork-unassigned-001' }),
    error => error.code === 'daywork_worker_job_scope_required' && error.statusCode === 409
  );
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM daywork_tickets').get().count, 0);
});
