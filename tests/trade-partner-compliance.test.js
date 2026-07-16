const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-trade-partner-'));
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

test('trade partner evidence gates spend, remains replay-safe, and retires through approval', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const partnerName = 'Compliance QA Supply BV';
  const partner = await request(baseUrl, '/api/ledger/trade-partners', {
    method: 'POST',
    body: JSON.stringify({
      name: partnerName,
      partnerType: 'supplier',
      email: 'compliance@example.test',
      specialties: ['insulation', 'fixings']
    })
  });
  assert.equal(partner.response.status, 201);
  assert.equal(partner.body.partner.compliance.status, 'needs_review');
  assert.equal(partner.body.partner.compliance.compliant, false);
  assert.ok(partner.body.partner.compliance.blockers.some(item => item.code === 'registration_number_missing'));

  const duplicate = await request(baseUrl, '/api/ledger/trade-partners', {
    method: 'POST',
    body: JSON.stringify({ name: partnerName, partnerType: 'supplier' })
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, 'trade_partner_duplicate');

  const intake = await request(baseUrl, '/api/ledger/intake', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Trade partner compliance job',
      client: { name: 'Compliance QA Client' },
      status: 'scheduled',
      materials: [{ name: 'Insulation boards', quantity: 12, unit: 'boards', supplier: partnerName, cost: 25 }]
    })
  });
  assert.equal(intake.response.status, 201);
  const jobId = intake.body.job.id;

  const procurement = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/procurement-orders`, {
    method: 'POST',
    body: JSON.stringify({
      supplier: partnerName,
      tradePartnerId: partner.body.partner.id,
      status: 'ready_to_order',
      amount: 300,
      requiredBy: '2027-01-15T08:00:00.000Z',
      items: [{ name: 'Insulation boards', quantity: 12, unitCost: 25 }],
      notes: 'Retained draft for compliance gate verification.'
    })
  });
  assert.equal(procurement.response.status, 201);
  assert.equal(procurement.body.procurementOrder.status, 'pending_approval');
  assert.equal(procurement.body.procurementOrder.tradePartnerId, partner.body.partner.id);
  assert.equal(procurement.body.procurementOrder.partnerComplianceSnapshot.complianceStatus, 'needs_review');

  const complianceQueue = await request(baseUrl, '/api/ledger/inventory?mode=supplier_compliance&limit=100');
  assert.equal(complianceQueue.response.status, 200);
  const blockedJob = complianceQueue.body.jobs.find(job => job.jobId === jobId);
  assert.ok(blockedJob);
  assert.equal(blockedJob.flags.supplierComplianceBlocked, true);
  assert.ok(blockedJob.counts.partnerComplianceBlocks >= 1);
  assert.equal(blockedJob.nextActions[0].type, 'review_trade_partner');

  const blockedApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(procurement.body.procurementOrder.approvalId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Compliance QA approver', reason: 'Attempt before evidence correction.' })
  });
  assert.equal(blockedApproval.response.status, 409);
  assert.equal(blockedApproval.body.error.code, 'trade_partner_compliance_required');

  const pendingAfterBlock = await request(baseUrl, '/api/ledger/approvals?status=pending&limit=100');
  assert.ok(pendingAfterBlock.body.approvals.some(approval => approval.id === procurement.body.procurementOrder.approvalId));

  const verifiedAt = new Date(Date.now() - 86_400_000).toISOString();
  const verifiedPartner = await request(baseUrl, `/api/ledger/trade-partners/${encodeURIComponent(partner.body.partner.id)}`, {
    method: 'PUT',
    body: JSON.stringify({
      registrationNumber: '55667788',
      vatNumber: 'NL123456789B01',
      verificationReference: 'KVK and VAT evidence QA-2026-0713',
      verifiedAt
    })
  });
  assert.equal(verifiedPartner.response.status, 200);
  assert.equal(verifiedPartner.body.partner.compliance.status, 'verified');
  assert.equal(verifiedPartner.body.partner.compliance.compliant, true);

  const approved = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(procurement.body.procurementOrder.approvalId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Compliance QA approver', reason: 'Current partner evidence verified.' })
  });
  assert.equal(approved.response.status, 200);
  const detail = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}`);
  const approvedOrder = detail.body.job.procurementOrders.find(order => order.id === procurement.body.procurementOrder.id);
  assert.equal(approvedOrder.status, 'ready_to_order');
  assert.equal(approvedOrder.tradePartnerId, partner.body.partner.id);
  assert.equal(approvedOrder.partnerComplianceSnapshot.complianceStatus, 'verified');

  const retirement = await request(baseUrl, `/api/ledger/trade-partners/${encodeURIComponent(partner.body.partner.id)}/retirement`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Supplier is no longer approved for new purchasing work.' })
  });
  assert.equal(retirement.response.status, 200);
  assert.equal(retirement.body.requiresApproval, true);
  assert.equal(retirement.body.approval.targetType, 'trade_partner_retirement');
  const replayedRetirement = await request(baseUrl, `/api/ledger/trade-partners/${encodeURIComponent(partner.body.partner.id)}/retirement`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Supplier is no longer approved for new purchasing work.' })
  });
  assert.equal(replayedRetirement.response.status, 200);
  assert.equal(replayedRetirement.body.approval.id, retirement.body.approval.id);

  const retired = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(retirement.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Compliance QA approver', reason: 'Retirement safeguards reviewed.' })
  });
  assert.equal(retired.response.status, 200);
  const retiredPartner = await request(baseUrl, `/api/ledger/trade-partners/${encodeURIComponent(partner.body.partner.id)}`);
  assert.equal(retiredPartner.body.partner.status, 'retired');
  assert.equal(retiredPartner.body.partner.compliance.status, 'blocked');

  const postRetirementOrder = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/procurement-orders`, {
    method: 'POST',
    body: JSON.stringify({
      supplier: partnerName,
      tradePartnerId: partner.body.partner.id,
      status: 'draft',
      amount: 50,
      requiredBy: '2027-02-01T08:00:00.000Z',
      items: [{ name: 'Retired supplier test item', quantity: 1, unitCost: 50 }]
    })
  });
  assert.equal(postRetirementOrder.response.status, 201);
  const postRetirementApproval = await request(baseUrl, `/api/ledger/jobs/${encodeURIComponent(jobId)}/procurement-orders/${encodeURIComponent(postRetirementOrder.body.procurementOrder.id)}/request-approval`, {
    method: 'POST',
    body: JSON.stringify({
      supplier: partnerName,
      tradePartnerId: partner.body.partner.id,
      amount: 50,
      requiredBy: '2027-02-01T08:00:00.000Z',
      notes: 'Retained request used to verify retirement remains fail-closed.'
    })
  });
  assert.equal(postRetirementApproval.response.status, 200);
  const blockedRetiredApproval = await request(baseUrl, `/api/ledger/approvals/${encodeURIComponent(postRetirementApproval.body.approval.id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status: 'approved', resolvedBy: 'Compliance QA approver', reason: 'This must remain blocked.' })
  });
  assert.equal(blockedRetiredApproval.response.status, 409);
  assert.equal(blockedRetiredApproval.body.error.code, 'trade_partner_compliance_required');

  const directory = await request(baseUrl, `/api/ledger/trade-partners?includeRetired=true&search=${encodeURIComponent('Compliance QA')}`);
  assert.equal(directory.response.status, 200);
  assert.equal(directory.body.partners.length, 1);
  assert.equal(directory.body.summary.retired, 1);
  const audit = await request(baseUrl, `/api/ledger/audit?entityId=${encodeURIComponent(partner.body.partner.id)}&limit=100`);
  assert.ok(audit.body.events.some(event => event.action === 'create_trade_partner'));
  assert.ok(audit.body.events.some(event => event.action === 'update_trade_partner'));
  assert.ok(audit.body.events.some(event => event.action === 'apply_trade_partner_retirement'));

  const exported = await request(baseUrl, '/api/operations/export');
  assert.ok(exported.body.tradePartners.some(item => item.id === partner.body.partner.id && item.status === 'retired'));
});
