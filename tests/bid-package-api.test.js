const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-bid-api-'));
const tokens = {
  owner: 'bid-package-owner-token-at-least-32-characters',
  approver: 'bid-package-approver-token-at-least-32-characters',
  office_operator: 'bid-package-office-token-at-least-32-characters',
  field_worker: { token: 'bid-package-field-token-at-least-32-characters', jobIds: ['none'] }
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify(tokens),
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

test('bid-package API enforces roles and carries a tender comparison through approval', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'bid_package_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const session = await request(baseUrl, '/api/session', tokens.office_operator);
  assert.equal(session.response.status, 200);
  assert.equal(session.body.operator.capabilities.tenders, true);

  const partner = await request(baseUrl, '/api/ledger/trade-partners', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      name: 'API Tender Partner BV',
      partnerType: 'supplier',
      registrationNumber: '88776655',
      vatNumber: 'NL987654321B01',
      verificationReference: 'API-KVK-VAT-2026-07',
      verifiedAt: new Date(Date.now() - 86_400_000).toISOString()
    })
  });
  assert.equal(partner.response.status, 201, JSON.stringify(partner.body));
  assert.equal(partner.body.partner.compliance.compliant, true);

  const opportunity = await request(baseUrl, '/api/ledger/opportunities', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ clientName: 'API Tender Client', title: 'API tender opportunity', stage: 'estimating' })
  });
  assert.equal(opportunity.response.status, 201, JSON.stringify(opportunity.body));

  const created = await request(baseUrl, '/api/ledger/bid-packages', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      opportunityId: opportunity.body.opportunity.id,
      title: 'API mechanical package',
      trade: 'Mechanical',
      scope: 'Supply, install, test, and commission the complete mechanical package.',
      dueAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      tradePartnerIds: [partner.body.partner.id]
    })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.bidPackage.participants[0].data.deliveryStatus, 'not_sent');
  const bidPackageId = created.body.bidPackage.id;
  const participantId = created.body.bidPackage.participants[0].id;

  const approverWrite = await request(baseUrl, `/api/ledger/bid-packages/${bidPackageId}/participants/${participantId}/return`, tokens.approver, {
    method: 'PUT',
    body: JSON.stringify({ amount: 52500, evidenceReference: 'approver-must-not-edit' })
  });
  assert.equal(approverWrite.response.status, 403);
  assert.equal(approverWrite.body.error.code, 'insufficient_role');
  const fieldRead = await request(baseUrl, '/api/ledger/bid-packages', tokens.field_worker.token);
  assert.equal(fieldRead.response.status, 403);

  const returned = await request(baseUrl, `/api/ledger/bid-packages/${bidPackageId}/participants/${participantId}/return`, tokens.office_operator, {
    method: 'PUT',
    body: JSON.stringify({
      amount: 52500,
      evidenceReference: 'api-tender-return-52500',
      durationDays: 35,
      validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString()
    })
  });
  assert.equal(returned.response.status, 200, JSON.stringify(returned.body));
  assert.equal(returned.body.participant.total, 63525);

  const selection = await request(baseUrl, `/api/ledger/bid-packages/${bidPackageId}/selection`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      participantId,
      rationale: 'Verified specialist return with acceptable commercial and programme terms.'
    })
  });
  assert.equal(selection.response.status, 201, JSON.stringify(selection.body));
  assert.equal(selection.body.approval.status, 'pending');

  const approval = await request(baseUrl, `/api/ledger/approvals/${selection.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      resolvedBy: 'API tender approver',
      reason: 'Commercial comparison and current compliance evidence reviewed.'
    })
  });
  assert.equal(approval.response.status, 200, JSON.stringify(approval.body));
  assert.equal(approval.body.bidPackage.status, 'selected');
  assert.equal(approval.body.bidPackage.selectedBidParticipantId, participantId);
  assert.equal(approval.body.bidPackage.data.spendAuthorized, false);

  const converted = await request(baseUrl, `/api/ledger/opportunities/${opportunity.body.opportunity.id}/convert`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(converted.response.status, 201, JSON.stringify(converted.body));

  const approverCommitment = await request(baseUrl, `/api/ledger/bid-packages/${bidPackageId}/commitment`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({ requiredBy: new Date(Date.now() + 20 * 86_400_000).toISOString(), costCode: 'SUB-API' })
  });
  assert.equal(approverCommitment.response.status, 403);
  assert.equal(approverCommitment.body.error.code, 'insufficient_role');

  const commitmentTerms = {
    requiredBy: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    costCode: 'SUB-API',
    notes: 'API selected-return commitment review.'
  };
  const commitment = await request(baseUrl, `/api/ledger/bid-packages/${bidPackageId}/commitment`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify(commitmentTerms)
  });
  assert.equal(commitment.response.status, 201, JSON.stringify(commitment.body));
  assert.equal(commitment.body.bidPackage.commitment.integrityValid, true);
  assert.equal(commitment.body.purchaseOrder.status, 'pending_approval');
  assert.equal(commitment.body.purchaseOrder.amount, 52500);
  assert.equal(commitment.body.purchaseOrder.data.source.type, 'bid_package_commitment');
  assert.equal(commitment.body.externalCommitments, 0);
  assert.equal(commitment.body.awardIssued, false);

  const replay = await request(baseUrl, `/api/ledger/bid-packages/${bidPackageId}/commitment`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify(commitmentTerms)
  });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.purchaseOrder.id, commitment.body.purchaseOrder.id);

  const commitmentApproval = await request(baseUrl, `/api/ledger/approvals/${commitment.body.approval.id}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      resolvedBy: 'API purchasing approver',
      reason: 'Exact selected return, scope, terms, amount, and compliance verified.'
    })
  });
  assert.equal(commitmentApproval.response.status, 200, JSON.stringify(commitmentApproval.body));
  assert.equal(commitmentApproval.body.bidPackage.commitment.status, 'ready_to_order');
  assert.equal(commitmentApproval.body.bidPackage.commitment.spendAuthorized, true);
  assert.equal(commitmentApproval.body.bidPackage.commitment.awardIssued, false);
  assert.equal(commitmentApproval.body.job.purchaseOrders[0].id, commitment.body.purchaseOrder.id);

  const detail = await request(baseUrl, `/api/ledger/bid-packages/${bidPackageId}`, tokens.approver);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.bidPackage.status, 'selected');
  assert.equal(detail.body.bidPackage.data.spendAuthorized, true);
  assert.equal(detail.body.bidPackage.commitment.integrityValid, true);

  const portfolio = await request(baseUrl, '/api/ledger/bid-packages?includeClosed=true&limit=100', tokens.owner);
  assert.equal(portfolio.response.status, 200);
  assert.equal(portfolio.body.summary.selected, 1);
  assert.equal(portfolio.body.summary.selectedValue, 63525);

  const exported = await request(baseUrl, '/api/operations/export', tokens.owner);
  assert.ok(exported.body.bidPackages.some(item => item.id === bidPackageId));
  assert.ok(exported.body.bidPackageParticipants.some(item => item.id === participantId));
  assert.ok(exported.body.purchaseOrders.some(item => item.id === commitment.body.purchaseOrder.id));
});
