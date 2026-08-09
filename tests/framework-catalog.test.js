const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  getFrameworkDefinition,
  listFrameworkCatalog,
  validateCatalog
} = require('../framework-catalog');
const { buildFrameworkCatalog, normalizeLabel } = require('../scripts/generate-framework-catalog');

test('framework catalog retains every source family and membership with stable identifiers', () => {
  const catalog = validateCatalog();
  assert.deepEqual(catalog.counts, { families: 23, frameworks: 671, familyMemberships: 700 });
  assert.equal(catalog.families.length, 23);
  assert.equal(catalog.frameworks.length, 671);
  assert.equal(new Set(catalog.frameworks.map(framework => framework.id)).size, 671);

  const jobsToBeDone = getFrameworkDefinition('jobs-to-be-done');
  assert.equal(jobsToBeDone.name, 'Jobs to Be Done');
  assert.deepEqual(jobsToBeDone.familyIds, [
    'family-01-business-model-frameworks',
    'family-03-market-and-customer-selection-frameworks'
  ]);
  assert.equal(jobsToBeDone.families.length, 2);
  assert.equal(jobsToBeDone.families.every(family => family.guidance.length === 3), true);

  const strategy = listFrameworkCatalog({ familyId: 'family-02-strategy-frameworks', query: 'SWOT' });
  assert.equal(strategy.page.total, 1);
  assert.equal(strategy.frameworks[0].id, 'swot');
  assert.equal(strategy.page.hasMore, false);
});

test('catalog generator repairs source encoding and deterministically merges duplicate labels', () => {
  const source = [
    '## 1. Business-model frameworks',
    '',
    '* Jobs to Be Done',
    '* Productâ€“Service Continuum',
    '',
    '## 2. Strategy frameworks',
    '',
    '* Jobs to Be Done',
    '* Porterâ€™s Five Forces',
    '',
    '## The practical core for a small contractor',
  ].join('\n');
  const catalog = buildFrameworkCatalog(source);
  assert.deepEqual(catalog.counts, { families: 2, frameworks: 3, familyMemberships: 4 });
  assert.deepEqual(catalog.frameworks.find(framework => framework.id === 'jobs-to-be-done').familyIds, [
    'family-01-business-model-frameworks',
    'family-02-strategy-frameworks'
  ]);
  assert.equal(normalizeLabel('Porterâ€™s Five Forces'), "Porter's Five Forces");
  assert.equal(normalizeLabel('Productâ€“Service Continuum'), 'Product-Service Continuum');

  const checkedIn = fs.readFileSync(path.join(__dirname, '..', 'contractor-framework-catalog.json'), 'utf8');
  assert.equal([...checkedIn].some(character => character.charCodeAt(0) > 127), false);
});
