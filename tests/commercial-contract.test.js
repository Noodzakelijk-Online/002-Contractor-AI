const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');
const { approveLowRiskRegister } = require('./risk-register-fixture');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-commercial-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function createCommercialJob(ledger) {
  return ledger.createIntake({
    clientName: 'Commercial Contract Client',
    client: { name: 'Commercial Contract Client', email: 'commercial-contract@example.test' },
    title: 'Commercial contract controls',
    service: 'renovation',
    estimatedCost: 500,
    contractValue: 500,
    lineItems: [{ description: 'Initial allowance', quantity: 1, unitPrice: 500 }],
    assignAutomatically: false
  }, { actor: 'office-commercial' });
}

function approveCommercialScope(ledger, jobId, entryKey) {
  const requested = ledger.requestCommercialScopeRevision(jobId, {
    entryKey,
    title: 'Commercial contract written scope',
    scopeSummary: 'Deliver the retained renovation work within the agreed project boundary.',
    inclusions: ['Complete the priced renovation work.'],
    assumptions: ['Access is available during the agreed working hours.'],
    exclusions: ['Latent hazardous materials are excluded.'],
    clientResponsibilities: ['Provide access before mobilisation.'],
    contractorResponsibilities: ['Retain completion evidence.'],
    allowanceMode: 'none',
    noAllowanceReason: 'No provisional or selection allowances apply to this test scope.',
    reason: 'Establish the written commercial basis before quote approval.'
  }, { actor: 'office-commercial' });
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved',
    resolvedBy: 'commercial-scope-approver',
    reason: 'Written scope, assumptions, exclusions, and allowance position verified.'
  });
  const scope = ledger.getCommercialScopeRevision(requested.revision.id);
  approveLowRiskRegister(ledger, jobId, scope, `${entryKey}-risk`);
  return scope;
}

test('intake without a commercial basis does not invent a zero-value quote', t => {
  const ledger = temporaryLedger(t);
  const job = ledger.createIntake({
    clientName: 'Pre-estimate Client',
    title: 'Site survey before estimating',
    service: 'survey',
    assignAutomatically: false
  }, { actor: 'office-commercial' });

  assert.equal(job.estimatedCost, 0);
  assert.deepEqual(job.quotes, []);
  assert.equal(job.approvals.some(item => item.targetType === 'quote'), false);
  assert.match(job.communications[0].body, /commercial estimate has not yet been retained/i);
  assert.ok(job.tasks.some(item => /Prepare quote/i.test(item.title)));
});

test('commercial totals are server-derived and rejected approvals close the draft', t => {
  const ledger = temporaryLedger(t);
  const job = createCommercialJob(ledger);
  approveCommercialScope(ledger, job.id, 'commercial-contract-totals-scope-0001');
  const quote = ledger.createQuote(job.id, {
    currency: 'EUR',
    taxRate: 21,
    subtotal: 999999,
    taxAmount: 999999,
    total: 999999,
    lineItems: [
      { description: 'Preparation', quantity: 2, unitPrice: 100.005, costCode: '10-100' },
      { description: 'Installation', quantity: 3, unitPrice: 50, costCode: '20-100' }
    ]
  }, { actor: 'office-commercial' });

  assert.equal(quote.status, 'draft');
  assert.equal(quote.subtotal, 350.02);
  assert.equal(quote.taxAmount, 73.5);
  assert.equal(quote.total, 423.52);
  assert.equal(quote.data.calculation, 'server_derived');
  assert.throws(
    () => ledger.createQuote(job.id, { lineItems: [{ description: 'Bad price', quantity: 1, unitPrice: -1 }] }),
    error => error.code === 'commercial_line_item_invalid' && error.statusCode === 400
  );
  const gatedChangeOrder = ledger.createChangeOrder(job.id, {
    title: 'Caller cannot bypass scope approval',
    scopeDelta: 'Retain an additional work package.',
    status: 'accepted',
    requiresApproval: false,
    lineItems: [{ description: 'Additional work', quantity: 1, unitPrice: 25 }]
  }, { actor: 'office-commercial' });
  assert.equal(gatedChangeOrder.status, 'pending_approval');
  assert.ok(gatedChangeOrder.approvalId);

  const rejected = ledger.resolveApproval(quote.approvalId, { status: 'rejected', reason: 'Scope needs revision.' });
  assert.equal(rejected.status, 'rejected');
  assert.equal(ledger.getJobDetail(job.id).quotes.find(item => item.id === quote.id).status, 'rejected');
  assert.equal(ledger.resolveApproval(quote.approvalId, { status: 'rejected' }).status, 'rejected');
  assert.throws(
    () => ledger.resolveApproval(quote.approvalId, { status: 'approved' }),
    error => error.code === 'approval_already_resolved' && error.statusCode === 409
  );
});

test('client acceptance alone changes net contract value and preserves revisions', t => {
  const ledger = temporaryLedger(t);
  const job = createCommercialJob(ledger);
  const scope = approveCommercialScope(ledger, job.id, 'commercial-contract-scope-0001');
  const quote = ledger.createQuote(job.id, {
    commercialScopeRevisionId: scope.id,
    taxRate: 21,
    lineItems: [{ description: 'Accepted renovation scope', quantity: 1, unitPrice: 1200 }]
  }, { actor: 'office-commercial' });

  ledger.resolveApproval(quote.approvalId, { status: 'approved', resolvedBy: 'internal-approver' });
  assert.equal(ledger.getJobDetail(job.id).contractValue, 500);
  assert.throws(
    () => ledger.requestQuoteAcceptance(job.id, quote.id, { evidenceReference: 'x' }),
    error => error.code === 'commercial_acceptance_evidence_required'
  );
  assert.throws(
    () => ledger.requestQuoteAcceptance(job.id, quote.id, { evidenceReference: 'signed-quote-without-date' }),
    error => error.code === 'commercial_acceptance_date_required'
  );
  assert.throws(
    () => ledger.requestQuoteAcceptance(job.id, quote.id, {
      acceptedAt: '2026-02-31',
      evidenceReference: 'signed-quote-invalid-date'
    }),
    error => error.code === 'commercial_acceptance_date_invalid'
  );

  const acceptancePayload = {
    acceptedAt: '2026-07-14',
    evidenceReference: 'signed-quote-2026-014',
    notes: 'Signed PDF retained in the project record.'
  };
  const acceptance = ledger.requestQuoteAcceptance(job.id, quote.id, acceptancePayload, { actor: 'office-commercial' });
  assert.equal(acceptance.approval.targetType, 'quote_acceptance');
  assert.equal(acceptance.approval.decision.preview.evidenceReference, acceptancePayload.evidenceReference);
  assert.equal(acceptance.approval.decision.preview.acceptedAt, '2026-07-14T00:00:00.000Z');
  assert.equal(ledger.getJobDetail(job.id).contractValue, 500);
  const replay = ledger.requestQuoteAcceptance(job.id, quote.id, acceptancePayload, { actor: 'office-commercial' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.approval.id, acceptance.approval.id);
  assert.throws(
    () => ledger.requestQuoteAcceptance(job.id, quote.id, { ...acceptancePayload, evidenceReference: 'different-proof' }),
    error => error.code === 'quote_acceptance_pending_conflict' && error.statusCode === 409
  );

  ledger.resolveApproval(acceptance.approval.id, { status: 'approved', resolvedBy: 'contract-approver' });
  let detail = ledger.getJobDetail(job.id);
  assert.equal(detail.contractValue, 1200);
  assert.equal(detail.approvalState, 'contract_accepted');
  assert.equal(detail.quotes.find(item => item.id === quote.id).status, 'accepted');
  assert.equal(detail.quotes.find(item => item.id === quote.id).data.acceptance.evidenceReference, acceptancePayload.evidenceReference);
  ledger.resolveApproval(acceptance.approval.id, { status: 'approved', resolvedBy: 'contract-approver' });
  assert.equal(ledger.getJobDetail(job.id).contractValue, 1200);

  const changeOrder = ledger.createChangeOrder(job.id, {
    quoteId: quote.id,
    title: 'Additional joinery',
    scopeDelta: 'Add two fitted timber shelves.',
    status: 'submitted',
    requiresApproval: true,
    taxRate: 21,
    total: 99999,
    lineItems: [{ description: 'Fitted shelves', quantity: 2, unitPrice: 100 }]
  }, { actor: 'office-commercial' });
  assert.equal(changeOrder.status, 'pending_approval');
  assert.equal(changeOrder.amount, 200);
  assert.equal(changeOrder.total, 242);
  ledger.resolveApproval(changeOrder.approvalId, { status: 'approved', resolvedBy: 'internal-approver' });
  assert.equal(ledger.getJobDetail(job.id).contractValue, 1200);

  ledger.updateOrganizationProfile({
    legalName: 'Commercial Contract Contractor B.V.',
    registrationNumber: '12345678',
    vatNumber: 'NL123456789B01',
    email: 'commercial@contractor.example',
    address: 'Ledgerstraat 10',
    postalCode: '3511 AA',
    city: 'Utrecht',
    country: 'NL',
    iban: 'NL91 ABNA 0417 1643 00',
    defaultPaymentTermsDays: 30,
    defaultQuoteValidityDays: 30
  }, { actor: 'owner-profile' });
  const changePackage = ledger.prepareChangeOrderIssuePackage(job.id, changeOrder.id, {}, { actor: 'office-commercial' });
  ledger.resolveApproval(changePackage.approval.id, {
    status: 'approved',
    resolvedBy: 'delivery-approver',
    reason: 'Client recipient and exact change-order package verified.'
  });
  ledger.recordCommunicationDelivery(changePackage.communication.id, {
    integration: 'commercial-contract-provider',
    providerMessageId: 'commercial-change-message-001'
  }, { actor: 'verified-integration' });

  const changeAcceptance = ledger.requestChangeOrderAcceptance(job.id, changeOrder.id, {
    acceptedAt: '2026-07-14T13:00:00.000Z',
    evidenceReference: 'signed-change-001'
  }, { actor: 'office-commercial' });
  assert.equal(ledger.getJobDetail(job.id).contractValue, 1200);
  ledger.resolveApproval(changeAcceptance.approval.id, { status: 'approved', resolvedBy: 'contract-approver' });
  detail = ledger.getJobDetail(job.id, { includeAudit: true });
  assert.equal(detail.contractValue, 1400);
  assert.equal(detail.changeOrders.find(item => item.id === changeOrder.id).status, 'accepted');

  const revisedScope = approveCommercialScope(ledger, job.id, 'commercial-contract-scope-0002');
  const revision = ledger.createQuote(job.id, {
    commercialScopeRevisionId: revisedScope.id,
    taxRate: 21,
    lineItems: [{ description: 'Revised accepted scope', quantity: 1, unitPrice: 1500 }]
  }, { actor: 'office-commercial' });
  ledger.resolveApproval(revision.approvalId, { status: 'approved', resolvedBy: 'internal-approver' });
  const revisionAcceptance = ledger.requestQuoteAcceptance(job.id, revision.id, {
    acceptedAt: '2026-07-14T14:00:00.000Z',
    evidenceReference: 'signed-quote-2026-015'
  }, { actor: 'office-commercial' });
  ledger.resolveApproval(revisionAcceptance.approval.id, { status: 'approved', resolvedBy: 'contract-approver' });

  detail = ledger.getJobDetail(job.id, { includeAudit: true });
  assert.equal(detail.contractValue, 1700);
  assert.equal(detail.quotes.find(item => item.id === quote.id).status, 'superseded');
  assert.equal(detail.quotes.find(item => item.id === revision.id).status, 'accepted');
  assert.ok(detail.audit.some(event => event.action === 'accept_quote_contract'));
  assert.ok(detail.audit.some(event => event.action === 'accept_change_order_contract'));
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});
