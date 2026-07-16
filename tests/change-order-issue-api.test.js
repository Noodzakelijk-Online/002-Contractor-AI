const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-change-order-api-'));
const tokens = {
  owner: 'change-order-owner-token-at-least-32-characters',
  approver: 'change-order-approver-token-at-least-32-characters',
  office_operator: 'change-order-office-token-at-least-32-characters',
  field_worker: { token: 'change-order-field-token-at-least-32-characters', jobIds: ['none'] }
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify(tokens),
  CONTRACTOR_AI_VERIFIED_INTEGRATIONS: 'change_order_api_provider',
  STATE_FILE: path.join(directory, 'state.json'),
  LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(directory, 'uploads')
});
delete process.env.CONTRACTOR_AI_AUTH_TOKEN;
delete process.env.DASHBOARD_AUTH_TOKEN;

const app = require('../server');

async function request(baseUrl, route, token, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

function organizationPayload() {
  return {
    legalName: 'API Change Contractor B.V.',
    tradingName: 'API Change Contractor',
    registrationNumber: '12345678',
    vatNumber: 'NL123456789B01',
    email: 'changes@api-contractor.example',
    phone: '+31 30 123 45 67',
    address: 'Ledgerstraat 10',
    postalCode: '3511 AA',
    city: 'Utrecht',
    country: 'NL',
    iban: 'NL91 ABNA 0417 1643 00',
    bic: 'ABNANL2A',
    defaultPaymentTermsDays: 30,
    defaultQuoteValidityDays: 30
  };
}

test('change-order issue API enforces a verified package, delivery, and acceptance chain', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'change_order_issue_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const organization = await request(baseUrl, '/api/ledger/organization', tokens.owner, {
    method: 'PUT', body: JSON.stringify(organizationPayload())
  });
  assert.equal(organization.response.status, 200, JSON.stringify(organization.body));

  const intake = await request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      title: 'API change-order issue',
      client: { name: 'API Change Client', email: 'client@api-change.example' },
      address: 'Projectstraat 5',
      city: 'Amsterdam',
      country: 'NL',
      contractValue: 2000,
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;

  const created = await request(baseUrl, `/api/ledger/jobs/${jobId}/change-orders`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      status: 'submitted',
      title: 'API additional framing',
      scopeDelta: 'Add the retained additional framing package.',
      scheduleDeltaDays: 1,
      taxRate: 21,
      lineItems: [{ description: 'Additional framing', quantity: 2, unitPrice: 150, costCode: 'CO-API' }]
    })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const changeOrder = created.body.changeOrder;
  assert.equal(changeOrder.status, 'pending_approval');

  const beforeApproval = await request(
    baseUrl,
    `/api/ledger/jobs/${jobId}/change-orders/${changeOrder.id}/issue-package`,
    tokens.office_operator,
    { method: 'POST', body: '{}' }
  );
  assert.equal(beforeApproval.response.status, 409);
  assert.equal(beforeApproval.body.error.code, 'change_order_not_approved_for_issue');

  const fieldPrepare = await request(
    baseUrl,
    `/api/ledger/jobs/${jobId}/change-orders/${changeOrder.id}/issue-package`,
    tokens.field_worker.token,
    { method: 'POST', body: '{}' }
  );
  assert.equal(fieldPrepare.response.status, 403);
  const approverPrepare = await request(
    baseUrl,
    `/api/ledger/jobs/${jobId}/change-orders/${changeOrder.id}/issue-package`,
    tokens.approver,
    { method: 'POST', body: '{}' }
  );
  assert.equal(approverPrepare.response.status, 403);

  const internalApproval = await request(baseUrl, `/api/ledger/approvals/${changeOrder.approvalId}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'API change approver', reason: 'Scope, rates, VAT, and schedule checked.' })
  });
  assert.equal(internalApproval.response.status, 200, JSON.stringify(internalApproval.body));

  const prepared = await request(
    baseUrl,
    `/api/ledger/jobs/${jobId}/change-orders/${changeOrder.id}/issue-package`,
    tokens.office_operator,
    { method: 'POST', body: '{}' }
  );
  assert.equal(prepared.response.status, 201, JSON.stringify(prepared.body));
  assert.match(prepared.body.issueReference, /^CO-\d{4}-000001$/);
  assert.equal(prepared.body.changeOrder.status, 'approved');
  assert.equal(prepared.body.externalCommitments, 0);
  assert.equal(prepared.body.approval.targetType, 'communication');

  const fieldDownload = await request(
    baseUrl,
    `/api/ledger/documents/${prepared.body.document.id}/issue-package`,
    tokens.field_worker.token
  );
  assert.equal(fieldDownload.response.status, 403);
  const packageResponse = await fetch(`${baseUrl}/api/ledger/documents/${prepared.body.document.id}/issue-package`, {
    headers: { Authorization: `Bearer ${tokens.approver}` }
  });
  const html = await packageResponse.text();
  assert.equal(packageResponse.status, 200);
  assert.match(packageResponse.headers.get('content-type'), /^text\/html/);
  assert.match(packageResponse.headers.get('content-disposition'), /^attachment;/);
  assert.match(packageResponse.headers.get('cache-control'), /no-store/);
  assert.match(html, /API additional framing/);

  const earlyAcceptance = await request(
    baseUrl,
    `/api/ledger/jobs/${jobId}/change-orders/${changeOrder.id}/acceptance`,
    tokens.office_operator,
    { method: 'POST', body: JSON.stringify({ acceptedAt: '2026-07-16', evidenceReference: 'signed-too-early' }) }
  );
  assert.equal(earlyAcceptance.response.status, 409);
  assert.equal(earlyAcceptance.body.error.code, 'change_order_not_issued');

  const earlyDelivery = await request(
    baseUrl,
    `/api/ledger/communications/${prepared.body.communication.id}/delivery-receipt`,
    tokens.office_operator,
    { method: 'POST', body: JSON.stringify({ integration: 'change_order_api_provider', providerMessageId: 'too-early' }) }
  );
  assert.equal(earlyDelivery.response.status, 409);
  assert.equal(earlyDelivery.body.error.code, 'communication_approval_required');

  const deliveryApproval = await request(baseUrl, `/api/ledger/approvals/${prepared.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'API delivery approver', reason: 'Recipient and exact package checked.' })
  });
  assert.equal(deliveryApproval.response.status, 200, JSON.stringify(deliveryApproval.body));

  const unknownProvider = await request(
    baseUrl,
    `/api/ledger/communications/${prepared.body.communication.id}/delivery-receipt`,
    tokens.office_operator,
    { method: 'POST', body: JSON.stringify({ integration: 'unknown-provider', providerMessageId: 'unknown' }) }
  );
  assert.equal(unknownProvider.response.status, 409);
  assert.equal(unknownProvider.body.error.code, 'verified_integration_required');

  const missingReceipt = await request(
    baseUrl,
    `/api/ledger/communications/${prepared.body.communication.id}/delivery-receipt`,
    tokens.office_operator,
    { method: 'POST', body: JSON.stringify({ integration: 'change_order_api_provider' }) }
  );
  assert.equal(missingReceipt.response.status, 400);
  assert.equal(missingReceipt.body.error.code, 'change_order_delivery_evidence_required');

  const delivered = await request(
    baseUrl,
    `/api/ledger/communications/${prepared.body.communication.id}/delivery-receipt`,
    tokens.office_operator,
    {
      method: 'POST',
      body: JSON.stringify({
        integration: 'change_order_api_provider',
        providerMessageId: 'api-change-message-0001',
        receipt: { status: 'accepted-by-provider' }
      })
    }
  );
  assert.equal(delivered.response.status, 200, JSON.stringify(delivered.body));
  assert.equal(delivered.body.communication.status, 'sent');
  assert.equal(delivered.body.changeOrder.status, 'issued');
  assert.equal(delivered.body.changeOrder.data.issuePackage.providerMessageId, 'api-change-message-0001');
  assert.equal(delivered.body.job.contractValue, 2000);

  const acceptance = await request(
    baseUrl,
    `/api/ledger/jobs/${jobId}/change-orders/${changeOrder.id}/acceptance`,
    tokens.office_operator,
    {
      method: 'POST',
      body: JSON.stringify({
        acceptedAt: '2026-07-16',
        evidenceReference: 'api-signed-change-0001',
        notes: 'Signed package retained in the contract record.'
      })
    }
  );
  assert.equal(acceptance.response.status, 201, JSON.stringify(acceptance.body));
  assert.equal(acceptance.body.approval.decision.preview.issueReference, prepared.body.issueReference);
  assert.equal(acceptance.body.approval.decision.preview.packageHash, prepared.body.packageHash);
  assert.equal(acceptance.body.job.contractValue, 2000);

  const accepted = await request(baseUrl, `/api/ledger/approvals/${acceptance.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'API acceptance approver', reason: 'Signature and issued package hash checked.' })
  });
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.job.contractValue, 2300);
  const acceptedChange = accepted.body.job.changeOrders.find(item => item.id === changeOrder.id);
  assert.equal(acceptedChange.status, 'accepted');
  assert.equal(acceptedChange.data.acceptance.packageHash, prepared.body.packageHash);
});
