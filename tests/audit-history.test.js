const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');

function temporaryLedger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-audit-history-'));
  const ledger = new ContractorOperatingLedger({ dbFile: path.join(directory, 'ledger.sqlite') });
  t.after(() => {
    ledger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return ledger;
}

function retainAuditFixtures(ledger) {
  const fixtures = [
    ['client', 'client_alpha', 'job_alpha', 'create_client', 'office_operator', '2026-01-01T08:00:00.000Z'],
    ['job', 'job_alpha', 'job_alpha', 'update_job', 'office_operator', '2026-01-01T09:00:00.000Z'],
    ['approval', 'approval_alpha', 'job_alpha', 'request_approval', 'Contractor.AI', '2026-01-02T10:00:00.000Z'],
    ['job', 'job_beta', 'job_beta', 'update_job', 'field_worker:north', '2026-01-03T11:00:00.000Z'],
    ['document', 'document_beta', 'job_beta', 'retain_100_percent_evidence', 'field_worker:north', '2026-01-04T12:00:00.000Z'],
    ['operational_backup', 'backup_one', null, 'create_backup', 'owner:local', '2026-01-05T13:00:00.000Z']
  ];
  fixtures.forEach(([entityType, entityId, jobId, action, actor, createdAt], index) => ledger.audit({
    entityType,
    entityId,
    jobId,
    action,
    actor,
    createdAt,
    after: { fixture: index + 1 }
  }));
}

test('audit history uses stable cursor pagination without duplicate events', t => {
  const ledger = temporaryLedger(t);
  retainAuditFixtures(ledger);

  const first = ledger.listAuditPage({ limit: 2, includeFacets: true });
  assert.deepEqual(first.events.map(event => event.sequenceNumber), [6, 5]);
  assert.equal(first.page.returned, 2);
  assert.equal(first.page.hasMore, true);
  assert.equal(first.page.nextBeforeSequence, 5);
  assert.equal(first.page.newestSequence, 6);
  assert.equal(first.page.oldestSequence, 5);
  assert.ok(first.facets.entityTypes.some(facet => facet.value === 'job' && facet.count === 2));
  assert.ok(first.facets.actions.some(facet => facet.value === 'update_job' && facet.count === 2));
  assert.ok(first.facets.actors.some(facet => facet.value === 'field_worker:north' && facet.count === 2));

  const second = ledger.listAuditPage({ limit: 2, beforeSequence: first.page.nextBeforeSequence });
  assert.deepEqual(second.events.map(event => event.sequenceNumber), [4, 3]);
  assert.equal(second.page.nextBeforeSequence, 3);
  const third = ledger.listAuditPage({ limit: 2, before_sequence: second.page.nextBeforeSequence });
  assert.deepEqual(third.events.map(event => event.sequenceNumber), [2, 1]);
  assert.equal(third.page.hasMore, false);
  assert.equal(third.page.nextBeforeSequence, null);
  assert.equal(new Set([...first.events, ...second.events, ...third.events].map(event => event.id)).size, 6);
});

test('audit history filters retained chain records without changing integrity evidence', t => {
  const ledger = temporaryLedger(t);
  retainAuditFixtures(ledger);

  const byJob = ledger.listAuditPage({ jobId: 'job_beta', limit: 20 });
  assert.deepEqual(byJob.events.map(event => event.entityId), ['document_beta', 'job_beta']);
  const byTypeAndActor = ledger.listAuditPage({ entity_type: 'job', actor: 'office_operator', limit: 20 });
  assert.deepEqual(byTypeAndActor.events.map(event => event.entityId), ['job_alpha']);
  const byAction = ledger.listAuditPage({ action: 'update_job', limit: 20 });
  assert.deepEqual(byAction.events.map(event => event.entityId), ['job_beta', 'job_alpha']);
  const byDate = ledger.listAuditPage({ from: '2026-01-02', until: '2026-01-04', limit: 20 });
  assert.deepEqual(byDate.events.map(event => event.sequenceNumber), [5, 4, 3]);
  const byEscapedSearch = ledger.listAuditPage({ query: 'retain_100%', limit: 20 });
  assert.deepEqual(byEscapedSearch.events.map(event => event.entityId), ['document_beta']);
  assert.equal(byEscapedSearch.page.filters.query, 'retain_100%');
  assert.match(byEscapedSearch.events[0].eventHash, /^[a-f0-9]{64}$/);
  assert.equal(byEscapedSearch.events[0].previousHash.length, 64);
  assert.equal(ledger.verifyAuditIntegrity().valid, true);
});

test('audit history rejects invalid cursors, ranges, and unbounded filters', t => {
  const ledger = temporaryLedger(t);
  retainAuditFixtures(ledger);

  assert.throws(
    () => ledger.listAuditPage({ beforeSequence: 'not-a-sequence' }),
    error => error.code === 'audit_cursor_invalid' && error.statusCode === 400
  );
  assert.throws(
    () => ledger.listAuditPage({ from: '2026-02-01', until: '2026-01-01' }),
    error => error.code === 'audit_date_range_invalid' && error.statusCode === 400
  );
  assert.throws(
    () => ledger.listAuditPage({ query: 'x'.repeat(121) }),
    error => error.code === 'audit_filter_too_long' && error.statusCode === 400
  );
  const fractionalLimit = ledger.listAuditPage({ limit: 2.9 });
  assert.equal(fractionalLimit.page.limit, 2);
  assert.equal(fractionalLimit.events.length, 2);
  assert.equal(ledger.migrationStatus().currentVersion, '029_purchase_order_issue_packages');
});
