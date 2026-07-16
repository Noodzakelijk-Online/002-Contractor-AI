const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-purchase-order-api-'));
const tokens = {
  owner: 'purchase-order-owner-token-at-least-32-characters',
  approver: 'purchase-order-approver-token-at-least-32-characters',
  office_operator: 'purchase-order-office-token-at-least-32-characters',
  field_worker: { token: 'purchase-order-field-token-at-least-32-characters', jobIds: ['none'] }
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify(tokens),
  CONTRACTOR_AI_VERIFIED_INTEGRATIONS: 'purchase_order_api_provider',
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
    legalName: 'API Order Contractor B.V.',
    tradingName: 'API Order Contractor',
    registrationNumber: '12345678',
    vatNumber: 'NL123456789B01',
    email: 'orders@api-contractor.example',
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

test('purchase-order issue API enforces roles and requires approval plus verified delivery evidence', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'purchase_order_issue_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const organization = await request(baseUrl, '/api/ledger/organization', tokens.owner, {
    method: 'PUT', body: JSON.stringify(organizationPayload())
  });
  assert.equal(organization.response.status, 200, JSON.stringify(organization.body));
  assert.equal(organization.body.organization.readiness.ready, true);

  const partner = await request(baseUrl, '/api/ledger/trade-partners', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      name: 'API Order Supplier B.V.',
      partnerType: 'supplier',
      contactName: 'Order Desk',
      email: 'orders@api-supplier.example',
      phone: '+31 10 555 12 34',
      address: 'Leverancierstraat 20',
      city: 'Rotterdam',
      country: 'NL',
      registrationNumber: '88776655',
      vatNumber: 'NL987654321B01',
      verificationReference: 'API-KVK-VAT-ORDER-2026-07',
      verifiedAt: new Date(Date.now() - 86_400_000).toISOString(),
      data: { postalCode: '3011 AA' }
    })
  });
  assert.equal(partner.response.status, 201, JSON.stringify(partner.body));
  assert.equal(partner.body.partner.compliance.compliant, true);

  const intake = await request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      title: 'API purchase-order issue',
      client: { name: 'API Order Client' },
      address: 'Projectstraat 5',
      city: 'Amsterdam',
      country: 'NL',
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  const jobId = intake.body.job.id;

  const created = await request(baseUrl, `/api/ledger/jobs/${jobId}/purchase-orders`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      status: 'ready_to_order',
      requiresApproval: true,
      tradePartnerId: partner.body.partner.id,
      supplier: partner.body.partner.name,
      amount: 1500,
      currency: 'EUR',
      requiredBy: '2026-09-30T23:59:59.000Z',
      items: [{ description: 'API order package', quantity: 1, unit: 'package', unitCost: 1500, costCode: 'API-PO' }]
    })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const purchaseOrder = created.body.purchaseOrder;
  assert.equal(purchaseOrder.status, 'pending_approval');

  const beforeApproval = await request(
    baseUrl,
    `/api/ledger/jobs/${jobId}/purchase-orders/${purchaseOrder.id}/issue-package`,
    tokens.office_operator,
    { method: 'POST', body: '{}' }
  );
  assert.equal(beforeApproval.response.status, 409);
  assert.equal(beforeApproval.body.error.code, 'purchase_order_not_ready_for_issue');

  const fieldPrepare = await request(
    baseUrl,
    `/api/ledger/jobs/${jobId}/purchase-orders/${purchaseOrder.id}/issue-package`,
    tokens.field_worker.token,
    { method: 'POST', body: '{}' }
  );
  assert.equal(fieldPrepare.response.status, 403);
  assert.equal(fieldPrepare.body.error.code, 'insufficient_role');
  const approverPrepare = await request(
    baseUrl,
    `/api/ledger/jobs/${jobId}/purchase-orders/${purchaseOrder.id}/issue-package`,
    tokens.approver,
    { method: 'POST', body: '{}' }
  );
  assert.equal(approverPrepare.response.status, 403);

  const purchaseApproval = await request(baseUrl, `/api/ledger/approvals/${purchaseOrder.approval.id}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      resolvedBy: 'API purchasing approver',
      reason: 'Supplier, exact net amount, lines, date, and compliance checked.'
    })
  });
  assert.equal(purchaseApproval.response.status, 200, JSON.stringify(purchaseApproval.body));

  const prepared = await request(
    baseUrl,
    `/api/ledger/jobs/${jobId}/purchase-orders/${purchaseOrder.id}/issue-package`,
    tokens.office_operator,
    { method: 'POST', body: '{}' }
  );
  assert.equal(prepared.response.status, 201, JSON.stringify(prepared.body));
  assert.match(prepared.body.issueReference, /^PO-\d{4}-000001$/);
  assert.equal(prepared.body.purchaseOrder.status, 'ready_to_order');
  assert.equal(prepared.body.purchaseOrder.externalCommitments, 0);
  assert.equal(prepared.body.bidPackage, null);
  assert.equal(prepared.body.documents.length, 2);
  assert.equal(prepared.body.approval.targetType, 'communication');

  const fieldDownload = await request(
    baseUrl,
    `/api/ledger/documents/${prepared.body.ublDocument.id}/issue-package`,
    tokens.field_worker.token
  );
  assert.equal(fieldDownload.response.status, 403);
  const ublResponse = await fetch(`${baseUrl}/api/ledger/documents/${prepared.body.ublDocument.id}/issue-package`, {
    headers: { Authorization: `Bearer ${tokens.approver}` }
  });
  const ubl = await ublResponse.text();
  assert.equal(ublResponse.status, 200);
  assert.match(ublResponse.headers.get('content-type'), /^application\/xml/);
  assert.match(ublResponse.headers.get('content-disposition'), /^attachment;/);
  assert.match(ublResponse.headers.get('cache-control'), /no-store/);
  assert.match(ubl, /<cbc:ID>PO-\d{4}-000001<\/cbc:ID>/);
  assert.match(ubl, /<cbc:PayableAmount currencyID="EUR">1500\.00<\/cbc:PayableAmount>/);

  const beforeTransmissionApproval = await request(
    baseUrl,
    `/api/ledger/communications/${prepared.body.communication.id}/delivery-receipt`,
    tokens.office_operator,
    { method: 'POST', body: JSON.stringify({ integration: 'purchase_order_api_provider', providerMessageId: 'too-early' }) }
  );
  assert.equal(beforeTransmissionApproval.response.status, 409);
  assert.equal(beforeTransmissionApproval.body.error.code, 'communication_approval_required');

  const transmissionApproval = await request(baseUrl, `/api/ledger/approvals/${prepared.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      resolvedBy: 'API transmission approver',
      reason: 'Recipient and both frozen purchase-order attachments checked.'
    })
  });
  assert.equal(transmissionApproval.response.status, 200, JSON.stringify(transmissionApproval.body));
  assert.equal(transmissionApproval.body.bidPackage, null);

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
    { method: 'POST', body: JSON.stringify({ integration: 'purchase_order_api_provider' }) }
  );
  assert.equal(missingReceipt.response.status, 400);
  assert.equal(missingReceipt.body.error.code, 'purchase_order_delivery_evidence_required');

  const delivered = await request(
    baseUrl,
    `/api/ledger/communications/${prepared.body.communication.id}/delivery-receipt`,
    tokens.office_operator,
    {
      method: 'POST',
      body: JSON.stringify({
        integration: 'purchase_order_api_provider',
        providerMessageId: 'api-order-message-0001',
        receipt: { status: 'accepted' }
      })
    }
  );
  assert.equal(delivered.response.status, 200, JSON.stringify(delivered.body));
  assert.equal(delivered.body.communication.status, 'sent');
  assert.equal(delivered.body.purchaseOrder.status, 'ordered');
  assert.equal(delivered.body.purchaseOrder.orderIssued, true);
  assert.equal(delivered.body.purchaseOrder.externalCommitments, 1);
  assert.equal(delivered.body.purchaseOrder.issuePackage.providerMessageId, 'api-order-message-0001');
  assert.equal(delivered.body.bidPackage, null);
  assert.ok(delivered.body.finance);

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200);
  assert.deepEqual(capabilities.body.capabilities.purchasing, {
    durableNumbering: true,
    immutableHtmlPackage: true,
    ubl21OrderExport: true,
    peppolCertified: false,
    networkSubmission: false,
    deliveryApprovalRequired: true,
    verifiedProviderReceiptRequired: true,
    externalCommitmentClaim: 'verified_delivery_only'
  });
});
