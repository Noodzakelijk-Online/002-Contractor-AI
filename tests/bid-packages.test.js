const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-bids-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function verifiedPartner(ledger, name, suffix) {
  return ledger.upsertTradePartner({
    name,
    partnerType: 'supplier',
    registrationNumber: `778899${suffix}`,
    vatNumber: `NL12345678${suffix}B01`,
    verificationReference: `KVK-VAT-BID-${suffix}`,
    verifiedAt: new Date(Date.now() - 86_400_000).toISOString(),
    specialties: ['electrical']
  }, { actor: 'bid-test' });
}

test('bid packages retain internal invitations, comparable returns, and approval-gated preferred selection', t => {
  const ledger = temporaryLedger(t);
  const firstPartner = verifiedPartner(ledger, 'Delta Installaties BV', '1');
  const secondPartner = verifiedPartner(ledger, 'Kanaal Techniek BV', '2');
  const opportunity = ledger.createOpportunity({
    clientName: 'Tender Client',
    title: 'Office electrical renewal',
    service: 'Electrical',
    stage: 'estimating',
    estimatedValue: 125000
  }, { actor: 'bid-test' });

  const bidPackage = ledger.createBidPackage(opportunity.id, {
    title: 'Electrical installation package',
    trade: 'Electrical',
    scope: 'Supply, installation, testing, and commissioning of the electrical works.',
    dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    tradePartnerIds: [firstPartner.id, secondPartner.id]
  }, { actor: 'bid-test' });

  assert.match(bidPackage.packageNumber, /^BID-\d{4}-0001$/);
  assert.equal(bidPackage.status, 'open_for_returns');
  assert.equal(bidPackage.participants.length, 2);
  assert.ok(bidPackage.participants.every(participant => (
    participant.status === 'internal_invite'
    && participant.data.deliveryStatus === 'not_sent'
    && participant.data.externalCommitments === 0
  )));

  const firstParticipant = bidPackage.participants.find(participant => participant.tradePartnerId === firstPartner.id);
  const secondParticipant = bidPackage.participants.find(participant => participant.tradePartnerId === secondPartner.id);
  ledger.recordBidReturn(bidPackage.id, firstParticipant.id, {
    amount: 80000,
    taxRate: 21,
    receivedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    durationDays: 45,
    evidenceReference: 'bid-return-delta-2026-07',
    exclusions: ['Utility connection fees'],
    qualifications: ['Night work priced separately']
  }, { actor: 'bid-test' });
  const compared = ledger.recordBidReturn(bidPackage.id, secondParticipant.id, {
    amount: 75000,
    taxRate: 21,
    receivedAt: new Date(Date.now() - 86_400_000).toISOString(),
    validUntil: new Date(Date.now() + 25 * 86_400_000).toISOString(),
    durationDays: 50,
    evidenceReference: 'bid-return-kanaal-2026-07'
  }, { actor: 'bid-test' }).bidPackage;

  assert.equal(compared.status, 'under_review');
  assert.equal(compared.comparison.returned, 2);
  assert.equal(compared.comparison.lowestTotal, 90750);
  assert.equal(compared.comparison.highestTotal, 96800);
  assert.equal(compared.comparison.spread, 6050);

  const selection = ledger.requestBidPackageSelection(compared.id, secondParticipant.id, {
    rationale: 'Lowest compliant return with an acceptable delivery period.'
  }, { actor: 'bid-test' });
  assert.equal(selection.bidPackage.status, 'pending_selection_approval');
  assert.equal(selection.approval.targetType, 'bid_package_selection');
  assert.equal(selection.approval.data.spendAuthorized, false);
  assert.match(selection.approval.decision.primaryEffect, /preferred bidder/i);
  assert.ok(selection.approval.decision.safeguards.some(item => /does not send an award/i.test(item)));
  assert.throws(
    () => ledger.recordBidReturn(compared.id, firstParticipant.id, {
      amount: 79000,
      evidenceReference: 'return-must-remain-locked'
    }),
    error => error.code === 'bid_package_returns_locked' && error.statusCode === 409
  );

  ledger.resolveApproval(selection.approval.id, {
    status: 'approved',
    resolvedBy: 'Tender approver',
    reason: 'Comparison, exclusions, compliance, and programme reviewed.'
  });
  const selected = ledger.getBidPackage(compared.id);
  assert.equal(selected.status, 'selected');
  assert.equal(selected.selectedParticipant.tradePartnerId, secondPartner.id);
  assert.equal(selected.selectedParticipant.status, 'selected');
  assert.equal(selected.participants.find(item => item.id === firstParticipant.id).status, 'not_selected');
  assert.equal(selected.data.spendAuthorized, false);
  assert.equal(ledger.count('purchase_orders'), 0);
  assert.equal(ledger.count('procurement_orders'), 0);
  assert.equal(ledger.diagnose().valid, true);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('bid selection is rejected cleanly and comparison changes fail closed', t => {
  const ledger = temporaryLedger(t);
  const partner = verifiedPartner(ledger, 'Fail Closed Techniek BV', '3');
  const opportunity = ledger.createOpportunity({ clientName: 'Comparison Client', title: 'Heating replacement' });
  const bidPackage = ledger.createBidPackage(opportunity.id, {
    title: 'Heating package',
    trade: 'Mechanical',
    scope: 'Replace heating plant and commission the complete installation.',
    dueAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    tradePartnerIds: [partner.id]
  });
  const participant = bidPackage.participants[0];
  ledger.recordBidReturn(bidPackage.id, participant.id, {
    amount: 42000,
    evidenceReference: 'heating-bid-return-42'
  });
  const selection = ledger.requestBidPackageSelection(bidPackage.id, participant.id, {
    rationale: 'Single-source specialist with verified compliance evidence.'
  });

  ledger.db.prepare('UPDATE bid_package_participants SET total = total + 1 WHERE id = ?').run(participant.id);
  assert.throws(
    () => ledger.resolveApproval(selection.approval.id, { status: 'approved', resolvedBy: 'Approver' }),
    error => error.code === 'bid_selection_comparison_changed' && error.statusCode === 409
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).some(item => item.id === selection.approval.id), true);

  ledger.resolveApproval(selection.approval.id, {
    status: 'rejected',
    resolvedBy: 'Approver',
    reason: 'Return changed after review started; rebuild comparison.'
  });
  const restored = ledger.getBidPackage(bidPackage.id);
  assert.equal(restored.status, 'under_review');
  assert.equal(restored.approvalId, null);
  assert.equal(restored.selectedBidParticipantId, null);
  assert.equal(restored.data.selectionDecision.status, 'rejected');
});

test('opportunity conversion links retained bid packages without creating commitments', t => {
  const ledger = temporaryLedger(t);
  const partner = verifiedPartner(ledger, 'Conversion Bidder BV', '4');
  const opportunity = ledger.createOpportunity({ clientName: 'Conversion Client', title: 'Facade renewal' });
  const bidPackage = ledger.createBidPackage(opportunity.id, {
    title: 'Facade works',
    trade: 'Facade',
    scope: 'Remove, renew, test, and document the complete facade system.',
    dueAt: new Date(Date.now() + 12 * 86_400_000).toISOString(),
    tradePartnerIds: [partner.id]
  });
  const conversion = ledger.convertOpportunityToJob(opportunity.id, {}, { actor: 'bid-test' });
  assert.equal(ledger.getBidPackage(bidPackage.id).jobId, conversion.job.id);
  assert.ok(ledger.getJobDetail(conversion.job.id).bidPackages.some(item => item.id === bidPackage.id));
  assert.equal(ledger.getOpportunity(opportunity.id).bidPackages[0].id, bidPackage.id);
});

test('selected bid becomes one approval-gated project commitment without issuing an award', t => {
  const ledger = temporaryLedger(t);
  const partner = verifiedPartner(ledger, 'Commitment Bridge BV', '5');
  const opportunity = ledger.createOpportunity({ clientName: 'Commitment Client', title: 'Interior fit-out tender' });
  const bidPackage = ledger.createBidPackage(opportunity.id, {
    title: 'Joinery package',
    trade: 'Joinery',
    scope: 'Detail, supply, install, test, and hand over the complete joinery package.',
    dueAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    tradePartnerIds: [partner.id]
  });
  const participant = bidPackage.participants[0];
  ledger.recordBidReturn(bidPackage.id, participant.id, {
    amount: 48000,
    taxRate: 21,
    validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    durationDays: 40,
    evidenceReference: 'joinery-return-48000',
    exclusions: ['Builder works outside joinery openings'],
    qualifications: ['Final dimensions after site survey']
  });
  const selection = ledger.requestBidPackageSelection(bidPackage.id, participant.id, {
    rationale: 'Compliant return with verified scope coverage and acceptable programme.'
  });
  ledger.resolveApproval(selection.approval.id, { status: 'approved', resolvedBy: 'Tender approver' });
  assert.throws(
    () => ledger.createBidPackageCommitment(bidPackage.id, { requiredBy: new Date(Date.now() + 20 * 86_400_000).toISOString() }),
    error => error.code === 'bid_commitment_job_required' && error.statusCode === 409
  );
  const job = ledger.convertOpportunityToJob(opportunity.id, {}, { actor: 'bid-test' }).job;
  const terms = {
    requiredBy: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    costCode: 'SUB-410',
    notes: 'Retain selected scope, exclusions, and qualifications for purchasing review.'
  };
  const commitment = ledger.createBidPackageCommitment(bidPackage.id, terms, { actor: 'commercial-manager' });
  assert.equal(commitment.replayed, false);
  assert.equal(commitment.bidPackage.jobId, job.id);
  assert.equal(commitment.bidPackage.commitment.integrityValid, true);
  assert.equal(commitment.bidPackage.commitment.status, 'pending_approval');
  assert.equal(commitment.purchaseOrder.amount, 48000);
  assert.equal(commitment.purchaseOrder.status, 'pending_approval');
  assert.equal(commitment.purchaseOrder.tradePartnerId, partner.id);
  assert.equal(commitment.purchaseOrder.data.source.type, 'bid_package_commitment');
  assert.equal(commitment.purchaseOrder.data.source.commitmentHash, commitment.bidPackage.commitmentHash);
  assert.equal(commitment.purchaseOrder.data.spendAuthorized, false);
  assert.equal(commitment.awardIssued, false);
  assert.equal(commitment.externalCommitments, 0);
  assert.match(commitment.approval.decision.primaryEffect, /exact retained purchasing envelope/i);
  assert.ok(commitment.approval.decision.safeguards.some(item => /does not contact the supplier/i.test(item)));

  const replay = ledger.createBidPackageCommitment(bidPackage.id, terms, { actor: 'second-operator' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.purchaseOrder.id, commitment.purchaseOrder.id);
  assert.equal(ledger.count('purchase_orders'), 1);
  assert.throws(
    () => ledger.createBidPackageCommitment(bidPackage.id, { ...terms, costCode: 'SUB-999' }),
    error => error.code === 'bid_commitment_terms_changed' && error.statusCode === 409
  );

  ledger.resolveApproval(commitment.approval.id, {
    status: 'approved',
    resolvedBy: 'Purchasing approver',
    reason: 'Selected return, scope, exclusions, qualifications, compliance, amount, and required date verified.'
  });
  const approved = ledger.getBidPackage(bidPackage.id);
  assert.equal(approved.commitment.status, 'ready_to_order');
  assert.equal(approved.commitment.integrityValid, true);
  assert.equal(approved.commitment.spendAuthorized, true);
  assert.equal(approved.commitment.awardIssued, false);
  assert.equal(approved.commitment.externalCommitments, 0);
  assert.equal(approved.data.spendAuthorized, true);
  assert.equal(ledger.getJobDetail(job.id).purchaseOrders[0].id, commitment.purchaseOrder.id);
  assert.equal(ledger.diagnose().valid, true);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('bid commitment approval fails closed on source changes and a rejected draft can be revised', t => {
  const ledger = temporaryLedger(t);
  const partner = verifiedPartner(ledger, 'Revision Bridge BV', '6');
  const opportunity = ledger.createOpportunity({ clientName: 'Revision Client', title: 'Roof tender' });
  const bidPackage = ledger.createBidPackage(opportunity.id, {
    title: 'Roof package',
    trade: 'Roofing',
    scope: 'Supply and install the complete roof package with tested handover evidence.',
    dueAt: new Date(Date.now() + 8 * 86_400_000).toISOString(),
    tradePartnerIds: [partner.id]
  });
  const participant = bidPackage.participants[0];
  ledger.recordBidReturn(bidPackage.id, participant.id, { amount: 36000, evidenceReference: 'roof-return-36000' });
  const selection = ledger.requestBidPackageSelection(bidPackage.id, participant.id, { rationale: 'Verified compliant specialist return.' });
  ledger.resolveApproval(selection.approval.id, { status: 'approved', resolvedBy: 'Tender approver' });
  ledger.convertOpportunityToJob(opportunity.id);
  const first = ledger.createBidPackageCommitment(bidPackage.id, {
    requiredBy: new Date(Date.now() + 18 * 86_400_000).toISOString(),
    costCode: 'SUB-ROOF'
  });
  ledger.db.prepare('UPDATE purchase_orders SET amount = amount + 1 WHERE id = ?').run(first.purchaseOrder.id);
  assert.throws(
    () => ledger.resolveApproval(first.approval.id, { status: 'approved', resolvedBy: 'Purchasing approver' }),
    error => error.code === 'bid_commitment_integrity_failed' && error.statusCode === 409
  );
  assert.equal(ledger.listApprovals({ status: 'pending' }).some(item => item.id === first.approval.id), true);
  ledger.db.prepare('UPDATE purchase_orders SET amount = amount - 1 WHERE id = ?').run(first.purchaseOrder.id);
  ledger.resolveApproval(first.approval.id, { status: 'rejected', resolvedBy: 'Purchasing approver', reason: 'Revise required date and purchasing notes.' });
  assert.equal(ledger.getBidPackage(bidPackage.id).commitment.status, 'rejected');

  const revised = ledger.createBidPackageCommitment(bidPackage.id, {
    requiredBy: new Date(Date.now() + 25 * 86_400_000).toISOString(),
    costCode: 'SUB-ROOF-REV',
    notes: 'Revised after purchasing review.'
  });
  assert.equal(revised.replayed, false);
  assert.notEqual(revised.purchaseOrder.id, first.purchaseOrder.id);
  assert.deepEqual(revised.bidPackage.data.commitment.priorPurchaseOrderIds, [first.purchaseOrder.id]);
  assert.equal(ledger.count('purchase_orders'), 2);
  assert.equal(ledger.diagnose().valid, true);
});
