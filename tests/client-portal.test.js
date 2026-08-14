const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-client-portal-'));
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

test('client portal access is approval-gated, scoped, auditable, and revocable', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Client portal paving job',
      client: { name: 'Portal Client', email: 'portal@example.test', phone: '+31600000000' },
      address: 'Utrecht',
      service: 'paving',
      description: 'Replace the front path with grey pavers.'
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const selection = await request(baseUrl, `/api/ledger/jobs/${jobId}/client-selections`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Choose paving colour',
      status: 'pending_client',
      options: ['Grey', 'Anthracite'],
      requiresApproval: false,
      clientVisible: true
    })
  });
  assert.equal(selection.response.status, 201);
  assert.equal(selection.body.clientSelection.status, 'pending_client');

  const created = await request(baseUrl, `/api/ledger/jobs/${jobId}/client-portal-access`, {
    method: 'POST',
    body: JSON.stringify({ label: 'Portal Client project', expiresAt: '2027-01-01', locale: 'en-GB' })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.access.status, 'pending_approval');
  assert.ok(created.body.access.portalToken);
  assert.ok(created.body.access.approval.id);
  assert.equal(created.body.access.data.locale, 'en-GB');
  assert.equal(JSON.stringify(created.body.access).includes('tokenHash'), false);

  const beforeApproval = await request(baseUrl, `/api/client-portal/${created.body.access.portalToken}`);
  assert.equal(beforeApproval.response.status, 404);

  const approval = await request(baseUrl, `/api/ledger/approvals/${created.body.access.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Portal test' })
  });
  assert.equal(approval.response.status, 200);
  assert.equal(approval.body.approval.status, 'approved');

  const portalLogs = [];
  const originalLog = console.log;
  console.log = (...args) => portalLogs.push(args.join(' '));
  let portal;
  try {
    portal = await request(baseUrl, `/api/client-portal/${created.body.access.portalToken}`);
  } finally {
    console.log = originalLog;
  }
  assert.equal(portal.response.status, 200);
  assert.equal(portal.body.job.id, jobId);
  assert.equal(portal.body.job.title, 'Client portal paving job');
  assert.equal(portal.body.job.address, 'Utrecht');
  assert.equal(portal.body.portal.locale, 'en-GB');
  assert.equal(Object.hasOwn(portal.body.job, 'client'), false);
  assert.equal(Object.hasOwn(portal.body.job, 'invoices'), false);
  assert.equal(Object.hasOwn(portal.body.job, 'expenses'), false);
  assert.equal(Object.hasOwn(portal.body.job, 'audit'), false);
  assert.deepEqual(portal.body.job.selections[0], {
    id: selection.body.clientSelection.id,
    title: 'Choose paving colour',
    status: 'pending_client',
    dueAt: portal.body.job.selections[0].dueAt,
    decidedAt: null,
    options: ['Grey', 'Anthracite'],
    selectedOption: null,
    responseAllowed: true,
    response: null
  });
  assert.ok(portalLogs.some(line => line.includes('/api/client-portal/[redacted]')));
  assert.equal(portalLogs.some(line => line.includes(created.body.access.portalToken)), false);

  const rejectedBodyLogs = [];
  const originalWarn = console.warn;
  console.log = (...args) => rejectedBodyLogs.push(args.join(' '));
  console.warn = (...args) => rejectedBodyLogs.push(args.join(' '));
  let rejectedBody;
  try {
    rejectedBody = await request(baseUrl, `/api/client-portal/${created.body.access.portalToken}/messages`, {
      method: 'POST',
      body: '{'
    });
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
  assert.equal(rejectedBody.response.status, 400);
  assert.equal(rejectedBody.body.error.code, 'invalid_json');
  assert.ok(rejectedBodyLogs.some(line => line.includes('/api/client-portal/[redacted]/messages')));
  assert.equal(rejectedBodyLogs.some(line => line.includes(created.body.access.portalToken)), false);

  const portalPreference = await request(baseUrl, `/api/client-portal/${created.body.access.portalToken}/preferences`, {
    method: 'PATCH',
    body: JSON.stringify({ locale: 'nl-NL' })
  });
  assert.equal(portalPreference.response.status, 200);
  assert.equal(portalPreference.body.preferences.locale, 'nl-NL');
  const localizedPortal = await request(baseUrl, `/api/client-portal/${created.body.access.portalToken}`);
  assert.equal(localizedPortal.body.portal.locale, 'nl-NL');

  const unsupportedLocale = await request(baseUrl, `/api/client-portal/${created.body.access.portalToken}/preferences`, {
    method: 'PATCH',
    body: JSON.stringify({ locale: 'de-DE' })
  });
  assert.equal(unsupportedLocale.response.status, 400);
  assert.equal(unsupportedLocale.body.error.code, 'portal_locale_unsupported');

  const message = await request(baseUrl, `/api/client-portal/${created.body.access.portalToken}/messages`, {
    method: 'POST',
    body: JSON.stringify({ subject: 'Paver colour', body: 'Can we confirm the grey paver sample first?' })
  });
  assert.equal(message.response.status, 201);
  assert.equal(message.body.deliveryMode, 'record_only');
  assert.equal(message.body.approvalRequired, false);
  assert.equal(message.body.communication.direction, 'inbound');
  assert.equal(message.body.communication.status, 'received');
  assert.equal(message.body.communication.approvalId || null, null);

  const selectionResponsePayload = {
    responseId: 'portal-response-0001',
    decision: 'accepted',
    selectedOption: 'Grey',
    note: 'Grey matches the sample reviewed on site.'
  };
  const selectionResponse = await request(
    baseUrl,
    `/api/client-portal/${created.body.access.portalToken}/selections/${selection.body.clientSelection.id}/responses`,
    { method: 'POST', body: JSON.stringify(selectionResponsePayload) }
  );
  assert.equal(selectionResponse.response.status, 201);
  assert.equal(selectionResponse.body.approvalRequired, true);
  assert.equal(selectionResponse.body.externalCommitments, 0);
  assert.equal(selectionResponse.body.response.status, 'pending_review');
  assert.equal(selectionResponse.body.response.selectedOption, 'Grey');
  assert.equal(selectionResponse.body.approval.targetType, 'client_selection_response');
  assert.equal(selectionResponse.body.approval.status, 'pending');
  assert.match(selectionResponse.body.approval.decision.primaryEffect, /Grey|selected option/i);
  assert.ok(selectionResponse.body.approval.decision.safeguards.some(item => item.includes('does not change price')));

  const replayedResponse = await request(
    baseUrl,
    `/api/client-portal/${created.body.access.portalToken}/selections/${selection.body.clientSelection.id}/responses`,
    { method: 'POST', body: JSON.stringify(selectionResponsePayload) }
  );
  assert.equal(replayedResponse.response.status, 201);
  assert.equal(replayedResponse.body.replayed, true);
  assert.equal(replayedResponse.body.approval.id, selectionResponse.body.approval.id);

  const conflictingResponse = await request(
    baseUrl,
    `/api/client-portal/${created.body.access.portalToken}/selections/${selection.body.clientSelection.id}/responses`,
    {
      method: 'POST',
      body: JSON.stringify({ responseId: 'portal-response-0002', decision: 'changes_requested', note: 'Please provide a lighter sample.' })
    }
  );
  assert.equal(conflictingResponse.response.status, 409);
  assert.equal(conflictingResponse.body.error.code, 'selection_response_pending_review');

  const pendingPortal = await request(baseUrl, `/api/client-portal/${created.body.access.portalToken}`);
  assert.equal(pendingPortal.body.job.selections[0].responseAllowed, false);
  assert.equal(pendingPortal.body.job.selections[0].response.status, 'pending_review');

  const responseApproval = await request(baseUrl, `/api/ledger/approvals/${selectionResponse.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Portal response reviewer', reason: 'Sample and scope verified.' })
  });
  assert.equal(responseApproval.response.status, 200);

  const acceptedJob = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  const acceptedSelection = acceptedJob.body.job.clientSelections.find(item => item.id === selection.body.clientSelection.id);
  assert.equal(acceptedSelection.status, 'client_confirmed');
  assert.equal(acceptedSelection.data.selectedOption, 'Grey');
  assert.equal(acceptedSelection.data.clientResponse.decision, 'accepted');
  assert.equal(acceptedSelection.data.clientResponse.status, 'approved');

  const acceptedPortal = await request(baseUrl, `/api/client-portal/${created.body.access.portalToken}`);
  assert.equal(acceptedPortal.body.job.selections[0].status, 'client_confirmed');
  assert.equal(acceptedPortal.body.job.selections[0].selectedOption, 'Grey');
  assert.equal(acceptedPortal.body.job.selections[0].responseAllowed, false);
  assert.equal(acceptedPortal.body.job.selections[0].response.status, 'recorded');

  const adjustmentSelection = await request(baseUrl, `/api/ledger/jobs/${jobId}/client-selections`, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Confirm drainage detail',
      status: 'pending_client',
      options: ['Standard channel', 'Slot drain'],
      requiresApproval: false,
      clientVisible: true
    })
  });
  assert.equal(adjustmentSelection.response.status, 201);

  const missingChangeNote = await request(
    baseUrl,
    `/api/client-portal/${created.body.access.portalToken}/selections/${adjustmentSelection.body.clientSelection.id}/responses`,
    {
      method: 'POST',
      body: JSON.stringify({ responseId: 'portal-adjustment-0001', decision: 'changes_requested' })
    }
  );
  assert.equal(missingChangeNote.response.status, 400);
  assert.equal(missingChangeNote.body.error.code, 'selection_change_note_required');

  const firstAdjustment = await request(
    baseUrl,
    `/api/client-portal/${created.body.access.portalToken}/selections/${adjustmentSelection.body.clientSelection.id}/responses`,
    {
      method: 'POST',
      body: JSON.stringify({
        responseId: 'portal-adjustment-0002',
        decision: 'changes_requested',
        note: 'Please show how the slot drain meets the threshold.'
      })
    }
  );
  assert.equal(firstAdjustment.response.status, 201);
  assert.equal(firstAdjustment.body.response.status, 'pending_review');

  const rejectedAdjustment = await request(baseUrl, `/api/ledger/approvals/${firstAdjustment.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'rejected',
      resolvedBy: 'Portal response reviewer',
      reason: 'The requested detail needs clarification before recording.'
    })
  });
  assert.equal(rejectedAdjustment.response.status, 200);

  const rejectedPortal = await request(baseUrl, `/api/client-portal/${created.body.access.portalToken}`);
  const rejectedSelection = rejectedPortal.body.job.selections.find(
    item => item.id === adjustmentSelection.body.clientSelection.id
  );
  assert.equal(rejectedSelection.status, 'pending_client');
  assert.equal(rejectedSelection.responseAllowed, true);
  assert.equal(rejectedSelection.response.status, 'review_rejected');

  const resubmittedAdjustment = await request(
    baseUrl,
    `/api/client-portal/${created.body.access.portalToken}/selections/${adjustmentSelection.body.clientSelection.id}/responses`,
    {
      method: 'POST',
      body: JSON.stringify({
        responseId: 'portal-adjustment-0003',
        decision: 'changes_requested',
        note: 'Please provide the slot-drain threshold detail before installation.'
      })
    }
  );
  assert.equal(resubmittedAdjustment.response.status, 201);

  const approvedAdjustment = await request(baseUrl, `/api/ledger/approvals/${resubmittedAdjustment.body.approval.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      resolvedBy: 'Portal response reviewer',
      reason: 'The request is specific and ready for the project team.'
    })
  });
  assert.equal(approvedAdjustment.response.status, 200);

  const adjustedJob = await request(baseUrl, `/api/ledger/jobs/${jobId}`);
  const adjustedSelection = adjustedJob.body.job.clientSelections.find(
    item => item.id === adjustmentSelection.body.clientSelection.id
  );
  assert.equal(adjustedSelection.status, 'changes_requested');
  assert.equal(adjustedSelection.data.clientResponse.decision, 'changes_requested');
  assert.equal(adjustedSelection.data.clientResponse.status, 'approved');
  assert.equal(adjustedSelection.data.selectedOption || null, null);

  const accessList = await request(baseUrl, `/api/ledger/jobs/${jobId}/client-portal-access`);
  assert.equal(accessList.response.status, 200);
  assert.equal(accessList.body.access.length, 1);
  assert.equal(Object.hasOwn(accessList.body.access[0], 'tokenHash'), false);
  assert.equal(accessList.body.access[0].status, 'active');

  const revoked = await request(baseUrl, `/api/ledger/client-portal-access/${created.body.access.id}/revoke`, {
    method: 'POST',
    body: JSON.stringify({ actor: 'Portal test' })
  });
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.body.access.status, 'revoked');

  const afterRevocation = await request(baseUrl, `/api/client-portal/${created.body.access.portalToken}`);
  assert.equal(afterRevocation.response.status, 404);

  const audit = await request(baseUrl, `/api/ledger/audit?jobId=${jobId}&limit=100`);
  assert.equal(audit.response.status, 200);
  assert.ok(audit.body.events.some(event => event.action === 'create_client_portal_access'));
  assert.ok(audit.body.events.some(event => event.action === 'activate_client_portal_access'));
  assert.ok(audit.body.events.some(event => event.action === 'submit_client_selection_response'));
  assert.ok(audit.body.events.some(event => event.action === 'apply_client_selection_response'));
  assert.ok(audit.body.events.some(event => event.action === 'revoke_client_portal_access'));
});
