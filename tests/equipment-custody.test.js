const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-equipment-custody-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function custodyFixture(ledger, suffix = '1') {
  const job = ledger.createIntake({
    title: `Equipment custody ${suffix}`,
    client: { name: `Custody client ${suffix}` },
    status: 'scheduled',
    assignAutomatically: false
  }, { actor: 'custody_test' });
  const worker = ledger.upsertWorker({
    name: `Custody worker ${suffix}`,
    role: 'Equipment operator',
    status: 'available'
  }, { actor: 'custody_test' });
  ledger.addAssignment(job.id, {
    workerId: worker.id,
    workerName: worker.name,
    role: 'Equipment operator',
    status: 'assigned'
  }, { actor: 'custody_test' });
  const tool = ledger.upsertTool({
    name: `Custody lift ${suffix}`,
    category: 'access',
    status: 'available',
    homeLocation: 'Depot',
    currentLocation: 'Depot'
  }, { actor: 'custody_test' });
  const reservation = ledger.reserveTool(job.id, {
    toolId: tool.id,
    toolName: tool.name,
    status: 'reserved',
    neededFrom: new Date(Date.now() - 60_000).toISOString(),
    neededUntil: new Date(Date.now() + 86_400_000).toISOString()
  }, { actor: 'custody_test' });
  return { job, worker, tool, reservation };
}

test('equipment checkout is replay-safe, exclusive, assignment-linked, and returns without deleting evidence', t => {
  const ledger = temporaryLedger(t);
  assert.throws(
    () => ledger.upsertTool({ name: 'Uncontrolled in-use equipment', status: 'in_use' }),
    error => error.code === 'equipment_custody_route_required' && error.statusCode === 409
  );
  const fixture = custodyFixture(ledger, '1');
  const payload = {
    reservationId: fixture.reservation.id,
    workerId: fixture.worker.id,
    checkedOutAt: new Date(Date.now() - 60_000).toISOString(),
    dueBackAt: new Date(Date.now() + 86_400_000).toISOString(),
    checkedOutBy: fixture.worker.name,
    condition: 'good',
    location: 'Project gate',
    meter: 125.5,
    evidenceReference: 'handoff:EQ-001',
    entryKey: 'equipment-checkout-001',
    notes: 'Keys and charger transferred to the assigned operator.'
  };

  const plan = ledger.equipmentCustodyPlanForJob(fixture.job.id);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].checkoutReady, true);
  const preCheckoutReadiness = ledger.toolReservationReadiness(ledger.getJobDetail(fixture.job.id).tools);
  assert.equal(preCheckoutReadiness.status, 'due_soon');
  assert.equal(preCheckoutReadiness.items[0].status, 'reserved_not_collected');
  assert.match(preCheckoutReadiness.warningMessages[0], /collection window has started/i);

  const created = ledger.checkoutEquipment(fixture.job.id, payload, { actor: 'field_operator' });
  assert.equal(created.replayed, false);
  assert.equal(created.custody.status, 'checked_out');
  assert.equal(created.custody.checkoutMeter, 125.5);
  assert.equal(ledger.listTools({ limit: 100 }).find(tool => tool.id === fixture.tool.id).status, 'in_use');
  assert.equal(ledger.getJobDetail(fixture.job.id).tools[0].status, 'in_use');
  assert.equal(ledger.getJobDetail(fixture.job.id).equipmentCustody.length, 1);
  assert.throws(
    () => ledger.upsertTool({ id: fixture.tool.id, name: fixture.tool.name, status: 'available' }),
    error => error.code === 'equipment_custody_return_required' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.upsertTool({ id: fixture.tool.id, name: fixture.tool.name, status: 'in_use', currentLocation: 'Unknown yard' }),
    error => error.code === 'equipment_custody_location_controlled' && error.statusCode === 409
  );

  const replay = ledger.checkoutEquipment(fixture.job.id, payload, { actor: 'offline_retry' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.custody.id, created.custody.id);
  assert.equal(ledger.count('equipment_custody_sessions'), 1);
  assert.throws(
    () => ledger.checkoutEquipment(fixture.job.id, { ...payload, meter: 126 }),
    error => error.code === 'equipment_custody_replay_conflict' && error.statusCode === 409
  );
  assert.throws(
    () => ledger.releaseToolReservation(fixture.job.id, fixture.reservation.id, { reason: 'Attempted release before return.' }),
    error => error.code === 'equipment_custody_return_required' && error.statusCode === 409
  );

  const returnedPayload = {
    returnedAt: new Date().toISOString(),
    returnedBy: fixture.worker.name,
    condition: 'serviceable',
    location: 'Depot return bay',
    meter: 129.25,
    evidenceReference: 'return:EQ-001',
    entryKey: 'equipment-return-001',
    notes: 'Returned with charger and keys after visual condition check.'
  };
  const returned = ledger.returnEquipment(fixture.job.id, created.custody.id, returnedPayload, { actor: 'field_operator' });
  assert.equal(returned.replayed, false);
  assert.equal(returned.custody.status, 'returned');
  assert.equal(returned.custody.returnMeter, 129.25);
  assert.equal(ledger.listTools({ limit: 100 }).find(tool => tool.id === fixture.tool.id).status, 'available');
  assert.equal(ledger.getJobDetail(fixture.job.id).tools[0].status, 'returned');

  const returnReplay = ledger.returnEquipment(fixture.job.id, created.custody.id, returnedPayload, { actor: 'offline_retry' });
  assert.equal(returnReplay.replayed, true);
  assert.equal(returnReplay.custody.id, created.custody.id);
  assert.throws(
    () => ledger.returnEquipment(fixture.job.id, created.custody.id, { ...returnedPayload, condition: 'damaged' }),
    error => error.code === 'equipment_return_replay_conflict' && error.statusCode === 409
  );
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
  assert.equal(ledger.diagnose().valid, true);
});

test('damaged returns quarantine equipment and autonomy creates one internal custody review', t => {
  const ledger = temporaryLedger(t);
  const fixture = custodyFixture(ledger, '2');
  const checkedOut = ledger.checkoutEquipment(fixture.job.id, {
    reservationId: fixture.reservation.id,
    workerId: fixture.worker.id,
    checkedOutAt: new Date(Date.now() - 120_000).toISOString(),
    dueBackAt: new Date(Date.now() - 60_000).toISOString(),
    checkedOutBy: fixture.worker.name,
    condition: 'serviceable',
    location: 'Work zone',
    evidenceReference: 'handoff:EQ-002',
    entryKey: 'equipment-checkout-002'
  }, { actor: 'field_operator' }).custody;
  assert.equal(ledger.listEquipmentCustodyRegister().summary.overdue, 1);

  const returned = ledger.returnEquipment(fixture.job.id, checkedOut.id, {
    returnedAt: new Date().toISOString(),
    returnedBy: fixture.worker.name,
    condition: 'damaged',
    location: 'Quarantine bay',
    evidenceReference: 'photo:EQ-002-DAMAGE',
    entryKey: 'equipment-return-002',
    notes: 'Hydraulic guard bent during use; equipment isolated from service.'
  }, { actor: 'field_operator' }).custody;
  assert.equal(returned.status, 'exception');
  assert.equal(returned.data.quarantineRequired, true);
  assert.equal(ledger.listTools({ limit: 100 }).find(tool => tool.id === fixture.tool.id).status, 'maintenance');
  assert.equal(ledger.listEquipmentCustodyRegister().summary.exceptions, 1);

  const preview = ledger.nextActions().filter(action => action.type === 'review_equipment_custody' && action.custodySessionId === checkedOut.id);
  assert.equal(preview.length, 1);
  const communicationCount = ledger.count('communication_records');
  const first = ledger.runAutonomousCycle({ actionTypes: ['review_equipment_custody'], jobIds: [fixture.job.id] });
  assert.equal(first.applied.length, 1);
  const task = ledger.getJobDetail(fixture.job.id).tasks.find(item => item.id === first.applied[0].taskId);
  assert.equal(task.data.internalOnly, true);
  assert.equal(task.data.externalCommitments, 0);
  assert.equal(ledger.count('communication_records'), communicationCount);
  assert.equal(ledger.listTools({ limit: 100 }).find(tool => tool.id === fixture.tool.id).status, 'maintenance');
  const second = ledger.runAutonomousCycle({ actionTypes: ['review_equipment_custody'], jobIds: [fixture.job.id] });
  assert.equal(second.applied.length, 0);
  assert.equal(ledger.diagnose().valid, true);
});
