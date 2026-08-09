const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BENCHMARK_FORMAT,
  PROFILE_DEFINITIONS,
  evaluateThresholds,
  parseArguments,
  runLedgerBenchmark
} = require('../scripts/benchmark-ledger');

test('ledger benchmark arguments are explicit and bounded', () => {
  assert.deepEqual(parseArguments([]), {
    profile: 'production',
    keep: false,
    json: false,
    output: null,
    iterations: null
  });
  assert.deepEqual(parseArguments(['--profile', 'smoke', '--iterations', '3', '--json', '--keep']), {
    profile: 'smoke',
    keep: true,
    json: true,
    output: null,
    iterations: 3
  });
  assert.throws(() => parseArguments(['--profile', 'unknown']), /must be one of/);
  assert.throws(() => parseArguments(['--iterations', '0']), /integer from 1 through 25/);
  assert.throws(() => parseArguments(['--unknown']), /Unsupported benchmark option/);
});

test('threshold evaluation fails closed when a measured contract is exceeded', () => {
  const thresholds = PROFILE_DEFINITIONS.smoke.thresholds;
  const checks = evaluateThresholds({
    phases: {
      initialStartupMs: thresholds.initialStartupMs + 1,
      seedMs: 1,
      reopenMs: 1
    },
    operations: [{ name: 'active job list', p95Ms: 1 }],
    resources: {
      databaseBytes: 1,
      rssDeltaMb: 1
    }
  }, thresholds);
  assert.equal(checks.find(check => check.name === 'initial ledger startup').passed, false);
  assert.equal(checks.filter(check => !check.passed).length, 1);
});

test('smoke benchmark retains more than one database page and verifies scaled contracts', { timeout: 30_000 }, () => {
  const report = runLedgerBenchmark({ profile: 'smoke', iterations: 1 });
  assert.equal(report.format, BENCHMARK_FORMAT);
  assert.equal(report.status, 'passed');
  assert.ok(report.fixtureDefinition.jobs > 500);
  assert.ok(report.fixtureDefinition.opportunities > 500);
  assert.equal(report.fixture.counts.tasks, report.fixtureDefinition.tasks);
  assert.equal(report.fixture.audit.valid, true);
  assert.equal(report.fixture.checks.every(check => check.passed), true);
  assert.equal(report.thresholdChecks.every(check => check.passed), true);
  assert.ok(report.operations.some(operation => operation.name === 'dashboard summary'));
  assert.ok(report.operations.some(operation => operation.name === 'canonical intake write'));
});
