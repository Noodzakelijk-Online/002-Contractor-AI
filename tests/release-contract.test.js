const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { verifyReleaseContract, walkFiles } = require('../scripts/verify-release-contract');

test('release contract retains only the canonical runtime and mandatory delivery gates', () => {
  const result = verifyReleaseContract();
  assert.equal(result.valid, true, result.failures.join('\n'));
  assert.deepEqual(result.failures, []);
  assert.ok(result.checks.canonicalPaths >= 10);
  assert.ok(result.checks.hostedEnvironmentKeys >= 11);
});

test('release source inventory excludes generated runtime and browser-report directories', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-release-inventory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ['src', 'storage', 'uploads', 'test-results', 'playwright-report', 'coverage', '.vite']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    fs.writeFileSync(path.join(root, directory, 'marker.js'), directory);
  }
  assert.deepEqual(walkFiles(root), ['src/marker.js']);
});
