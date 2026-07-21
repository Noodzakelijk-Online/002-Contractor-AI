const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-daywork-api-'));
const tokens = {
  owner: 'daywork-owner-token-at-least-32-characters',
  approver: 'daywork-approver-token-at-least-32-characters',
  office: 'daywork-office-token-at-least-32-characters',
  field: { token: 'daywork-field-token-at-least-32-characters', workerId: 'worker-daywork-field' }
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify({
    owner: tokens.owner,
    approver: tokens.approver,
    office_operator: tokens.office,
    field_worker: tokens.field
  }),
  STATE_FILE: path.join(stateDirectory, 'state.json'),
  LEDGER_DB_FILE: path.join(stateDirectory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(stateDirectory, 'uploads')
});
const app = require('../server');

async function request(baseUrl, route, options = {}) {
  const { token = tokens.office, ...requestOptions } = options;
  const response = await fetch(`${baseUrl}${route}`, {
    ...requestOptions,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, body };
}

test('daywork API enforces field scope and separate acknowledgement and commercial approval gates', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'daywork_api_test' });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = Date.now();
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: `Daywork API ${suffix}`,
      clientName: `Daywork client ${suffix}`,
      status: 'in_progress',
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;
  assert.equal((await request(baseUrl, '/api/ledger/workers', {
    method: 'POST',
    body: JSON.stringify({
      id: tokens.field.workerId,
      name: 'Field daywork worker',
      role: 'Site operative',
      status: 'available'
    })
  })).response.status, 201);
  assert.equal((await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/assignments`, {
    method: 'POST',
    body: JSON.stringify({
      workerId: tokens.field.workerId,
      workerName: 'Field daywork worker',
      role: 'Site operative',
      status: 'assigned'
    })
  })).response.status, 201);

  const payload = {
    entryKey: `daywork-api-${suffix}`,
    workerId: 'spoofed-worker',
    workerName: 'Spoofed worker',
    workDate: new Date().toISOString().slice(0, 10),
    title: 'Additional wall penetrations',
    description: 'Core drilled two additional penetrations requested after the approved coordination drawing.',
    reason: 'Existing service route blocked the coordinated openings.',
    evidenceReference: `field-photo:${suffix}`,
    lines: [
      {
        lineKey: 'labor-core-drilling',
        lineType: 'labor',
        description: 'Core drilling labor',
        quantity: 3,
        unit: 'hour',
        costCode: 'LAB-MEP'
      },
      {
        lineKey: 'equipment-core-drill',
        lineType: 'equipment',
        description: 'Core drill usage',
        quantity: 2,
        unit: 'hour',
        costCode: 'EQ-MEP'
      }
    ]
  };
  const created = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/daywork-tickets`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.dayworkTicket.workerId, tokens.field.workerId);
  assert.equal(created.body.dayworkTicket.workerName, 'Field daywork worker');
  assert.equal(created.body.dayworkTicket.status, 'pending_approval');
  assert.equal(created.body.dayworkTicket.sourceHash, undefined);
  assert.equal(created.body.dayworkTicket.snapshotHash, undefined);
  assert.equal(created.body.dayworkTicket.entryKey, undefined);
  assert.equal(created.body.dayworkTicket.approvalId, undefined);
  assert.equal(created.body.approval, undefined);
  assert.equal(created.body.externalCommitments, 0);
  const ticketId = created.body.dayworkTicket.id;

  const replay = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/daywork-tickets`, {
    token: tokens.field.token,
    method: 'POST',
    body: JSON.stringify(payload)
  });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.dayworkTicket.id, ticketId);

  const fieldList = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/daywork-tickets`, {
    token: tokens.field.token
  });
  assert.equal(fieldList.response.status, 200);
  assert.equal(fieldList.body.dayworkTickets.length, 1);
  assert.equal(fieldList.body.dayworkTickets[0].workerId, tokens.field.workerId);
  assert.equal(fieldList.body.dayworkTickets[0].changeOrderId, undefined);

  const forbiddenAcknowledgement = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/daywork-tickets/${encodeURIComponent(ticketId)}/acknowledgement`,
    {
      token: tokens.field.token,
      method: 'POST',
      body: JSON.stringify({
        evidenceReference: `signed-record:${suffix}`,
        acknowledgedBy: 'Client representative',
        acknowledgedAt: new Date().toISOString()
      })
    }
  );
  assert.equal(forbiddenAcknowledgement.response.status, 403);
  const forbiddenConversion = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/daywork-tickets/${encodeURIComponent(ticketId)}/convert`,
    {
      token: tokens.field.token,
      method: 'POST',
      body: JSON.stringify({ prices: [] })
    }
  );
  assert.equal(forbiddenConversion.response.status, 403);

  const ownerList = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/daywork-tickets`, {
    token: tokens.owner
  });
  assert.equal(ownerList.response.status, 200);
  assert.equal(ownerList.body.dayworkTickets[0].integrityValid, true);
  const ticketApprovalId = ownerList.body.dayworkTickets[0].approvalId;
  const approved = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(ticketApprovalId)}/resolve`, {
    token: tokens.approver,
    method: 'POST',
    body: JSON.stringify({ status: 'approved', reason: 'Observed quantities and evidence verified.' })
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));

  const acknowledgementPayload = {
    evidenceReference: `signed-record:${suffix}`,
    acknowledgedBy: 'Client site representative',
    acknowledgedAt: new Date().toISOString(),
    notes: 'Receipt only.'
  };
  const acknowledgement = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/daywork-tickets/${encodeURIComponent(ticketId)}/acknowledgement`,
    { method: 'POST', body: JSON.stringify(acknowledgementPayload) }
  );
  assert.equal(acknowledgement.response.status, 201, JSON.stringify(acknowledgement.body));
  assert.equal(acknowledgement.body.dayworkTicket.status, 'approved');
  assert.equal(acknowledgement.body.approval.targetType, 'daywork_acknowledgement');
  assert.equal(acknowledgement.body.externalCommitments, 0);

  const acknowledgementDecision = await request(
    baseUrl,
    `/api/ledger/approvals/${encodeURIComponent(acknowledgement.body.approval.id)}/resolve`,
    {
      token: tokens.approver,
      method: 'POST',
      body: JSON.stringify({ status: 'approved', reason: 'Receipt evidence verified.' })
    }
  );
  assert.equal(acknowledgementDecision.response.status, 200, JSON.stringify(acknowledgementDecision.body));

  const conversionPayload = {
    prices: [
      { lineKey: 'labor-core-drilling', unitPrice: 85 },
      { lineKey: 'equipment-core-drill', unitPrice: 45 }
    ],
    taxRate: 21,
    scheduleDeltaDays: 0
  };
  const converted = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/daywork-tickets/${encodeURIComponent(ticketId)}/convert`,
    {
      method: 'POST',
      body: JSON.stringify(conversionPayload)
    }
  );
  assert.equal(converted.response.status, 201, JSON.stringify(converted.body));
  assert.equal(converted.body.ticket.status, 'converted');
  assert.equal(converted.body.changeOrder.status, 'pending_approval');
  assert.equal(converted.body.changeOrder.amount, 345);
  assert.equal(converted.body.changeOrder.data.source.id, ticketId);
  assert.equal(converted.body.externalCommitments, 0);

  const replayedConversion = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/daywork-tickets/${encodeURIComponent(ticketId)}/convert`,
    { method: 'POST', body: JSON.stringify(conversionPayload) }
  );
  assert.equal(replayedConversion.response.status, 201, JSON.stringify(replayedConversion.body));
  assert.equal(replayedConversion.body.replayed, true);
  assert.equal(replayedConversion.body.changeOrder.id, converted.body.changeOrder.id);

  const conflictingConversion = await request(
    baseUrl,
    `/api/ledger/jobs/${encodeURIComponent(jobId)}/daywork-tickets/${encodeURIComponent(ticketId)}/convert`,
    {
      method: 'POST',
      body: JSON.stringify({ ...conversionPayload, scheduleDeltaDays: 1 })
    }
  );
  assert.equal(conflictingConversion.response.status, 409);
  assert.equal(conflictingConversion.body.error.code, 'daywork_conversion_conflict');

  const retainedField = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/daywork-tickets`, {
    token: tokens.field.token
  });
  assert.equal(retainedField.response.status, 200);
  assert.equal(retainedField.body.dayworkTickets[0].status, 'converted');
  assert.equal(retainedField.body.dayworkTickets[0].changeOrderId, undefined);
  assert.equal(retainedField.body.dayworkTickets[0].sourceHash, undefined);

  const diagnostics = await request(baseUrl, '/api/ledger/debug', { token: tokens.owner });
  assert.equal(diagnostics.response.status, 200);
  assert.equal(diagnostics.body.diagnostics.valid, true, JSON.stringify(diagnostics.body.diagnostics.issues));
  assert.equal(diagnostics.body.diagnostics.counts.dayworkTickets, 1);
  assert.equal(diagnostics.body.diagnostics.migrations.currentVersion, '056_commercial_scope_revisions');

  const capabilities = await request(baseUrl, '/api/operations/capabilities', { token: tokens.owner });
  assert.equal(capabilities.response.status, 200);
  assert.equal(capabilities.body.capabilities.requestSafety.dayworkEntryKey, 'durable');
  assert.equal(capabilities.body.capabilities.requestSafety.dayworkApproval, 'source_current_approval_gated');
  assert.equal(capabilities.body.capabilities.changeControl.dayworkAcknowledgementChangesContractValue, false);
});
