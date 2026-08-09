const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-approval-principals-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

test('trusted boundary principals override submitted approval identities', t => {
  const ledger = temporaryLedger(t);
  const approval = ledger.createApproval({
    targetType: 'record',
    targetId: 'trusted-principal-record',
    requestedBy: 'submitted-requester',
    actor: 'submitted-actor',
    summary: 'Verify canonical approval principals'
  }, { actor: 'trusted:requester' });
  assert.equal(approval.requestedBy, 'trusted:requester');

  const resolved = ledger.resolveApproval(approval.id, {
    status: 'approved',
    resolvedBy: 'submitted-resolver',
    actor: 'submitted-actor'
  }, { actor: 'trusted:resolver' });
  assert.equal(resolved.resolvedBy, 'trusted:resolver');

  const audit = ledger.listAudit({ limit: 20 }).filter(event => event.entityId === approval.id);
  assert.deepEqual(audit.map(event => event.actor).sort(), ['trusted:requester', 'trusted:resolver']);
  assert.equal(audit.some(event => event.actor.startsWith('submitted-')), false);
});

test('direct internal approval calls retain explicit fallback principals', t => {
  const ledger = temporaryLedger(t);
  const approval = ledger.createApproval({
    targetType: 'record',
    targetId: 'direct-principal-record',
    requestedBy: 'internal:requester'
  });
  assert.equal(approval.requestedBy, 'internal:requester');

  const resolved = ledger.resolveApproval(approval.id, {
    status: 'rejected',
    resolvedBy: 'internal:resolver',
    reason: 'Direct internal approval fallback verified.'
  });
  assert.equal(resolved.resolvedBy, 'internal:resolver');
});
