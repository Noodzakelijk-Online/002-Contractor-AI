const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const {
  AUDIT_CHAIN_ALGORITHM,
  AUDIT_CHAIN_FORMAT,
  AUDIT_CHAIN_GENESIS_HASH,
  AUDIT_CHAIN_ID,
  ContractorOperatingLedger,
  auditEventHash
} = require('../operating-ledger');

const BENCHMARK_FORMAT = 'contractor-ai/ledger-benchmark-v1';
const PROFILE_DEFINITIONS = Object.freeze({
  smoke: Object.freeze({
    clients: 100,
    jobs: 620,
    tasksPerJob: 2,
    opportunities: 620,
    approvals: 500,
    auditEvents: 2_000,
    iterations: 2,
    thresholds: Object.freeze({
      initialStartupMs: 10_000,
      seedMs: 15_000,
      reopenMs: 10_000,
      databaseMb: 96,
      rssDeltaMb: 512,
      operationP95Ms: 4_000,
      dashboardP95Ms: 8_000,
      integrityP95Ms: 8_000,
      writeP95Ms: 8_000
    })
  }),
  production: Object.freeze({
    clients: 1_000,
    jobs: 5_000,
    tasksPerJob: 4,
    opportunities: 2_500,
    approvals: 5_000,
    auditEvents: 25_000,
    iterations: 5,
    thresholds: Object.freeze({
      initialStartupMs: 5_000,
      seedMs: 15_000,
      reopenMs: 5_000,
      databaseMb: 128,
      rssDeltaMb: 512,
      operationP95Ms: 1_000,
      dashboardP95Ms: 4_000,
      integrityP95Ms: 5_000,
      writeP95Ms: 3_000
    })
  })
});

const REQUIRED_INDEXES = Object.freeze([
  'idx_jobs_updated',
  'idx_jobs_status_updated',
  'idx_clients_updated',
  'idx_opportunities_stage_follow_up',
  'idx_approvals_status_created',
  'idx_audit_sequence_number',
  'idx_audit_job_sequence'
]);

function parseArguments(argv = []) {
  const options = { profile: 'production', keep: false, json: false, output: null, iterations: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--keep') {
      options.keep = true;
      continue;
    }
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--profile' || argument === '--output' || argument === '--iterations') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === '--profile') options.profile = value;
      if (argument === '--output') options.output = value;
      if (argument === '--iterations') options.iterations = Number(value);
      continue;
    }
    throw new Error(`Unsupported benchmark option: ${argument}`);
  }
  if (!PROFILE_DEFINITIONS[options.profile]) {
    throw new Error(`Benchmark profile must be one of: ${Object.keys(PROFILE_DEFINITIONS).join(', ')}.`);
  }
  if (options.iterations !== null && (!Number.isInteger(options.iterations) || options.iterations < 1 || options.iterations > 25)) {
    throw new Error('Benchmark iterations must be an integer from 1 through 25.');
  }
  return options;
}

function padded(value) {
  return String(value).padStart(6, '0');
}

function fixtureTimestamp(index) {
  return new Date(Date.UTC(2024, 0, 1, 8, 0, 0) + index * 60_000).toISOString();
}

function seedBenchmarkFixture(ledger, definition) {
  const existingRows = ['clients', 'jobs', 'opportunities', 'approvals', 'audit_events']
    .reduce((sum, table) => sum + ledger.count(table), 0);
  if (existingRows) throw new Error('The benchmark fixture requires an empty ledger.');

  const startedAt = performance.now();
  ledger.transaction(() => {
    const insertClient = ledger.db.prepare(`
      INSERT INTO clients (
        id, name, company, email, phone, address, city, country, vat_number,
        preferred_language, data_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'NL', NULL, 'nl', ?, ?, ?)
    `);
    for (let index = 0; index < definition.clients; index += 1) {
      const suffix = padded(index);
      const timestamp = fixtureTimestamp(index);
      const name = index === 0 ? 'Needle client oldest' : `Benchmark client ${suffix}`;
      insertClient.run(
        `client_benchmark_${suffix}`,
        name,
        `Benchmark company ${suffix}`,
        `benchmark-${suffix}@example.test`,
        `+31020${suffix}`,
        `Teststraat ${index + 1}`,
        index % 2 ? 'Rotterdam' : 'Amsterdam',
        JSON.stringify({ fixture: BENCHMARK_FORMAT, segment: index % 4 }),
        timestamp,
        timestamp
      );
    }

    const insertRequest = ledger.db.prepare(`
      INSERT INTO job_requests (
        id, client_id, source_channel, service, description, urgency, budget,
        status, data_json, created_at, updated_at
      ) VALUES (?, ?, 'benchmark', 'renovation', ?, ?, ?, 'analyzed', ?, ?, ?)
    `);
    const insertJob = ledger.db.prepare(`
      INSERT INTO jobs (
        id, request_id, client_id, title, job_type, description, address, city,
        region, country, priority, status, phase, risk_level, estimated_hours,
        estimated_cost, contract_value, margin_target_percent, progress_percent,
        scheduled_start, scheduled_end, target_completion, approval_state,
        data_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'renovation', ?, ?, ?, 'Noord-Holland', 'NL', ?, ?, ?, ?, ?, ?, ?, 22, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `);
    const insertTask = ledger.db.prepare(`
      INSERT INTO job_tasks (
        id, job_id, title, description, status, priority, assignee_id, due_at,
        completed_at, data_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
    `);
    const activeStatuses = ['intake', 'planned', 'scheduled', 'in_progress', 'completed'];
    for (let index = 0; index < definition.jobs; index += 1) {
      const suffix = padded(index);
      const clientSuffix = padded(index % definition.clients);
      const timestamp = fixtureTimestamp(definition.clients + index);
      const status = index > 0 && index % 20 === 0 ? 'archived' : activeStatuses[index % activeStatuses.length];
      const title = index === 0 ? 'Needle job oldest' : `Benchmark project ${suffix}`;
      const requestId = `request_benchmark_${suffix}`;
      const jobId = `job_benchmark_${suffix}`;
      const completed = status === 'completed';
      insertRequest.run(
        requestId,
        `client_benchmark_${clientSuffix}`,
        `Representative request ${suffix}`,
        index % 9 === 0 ? 'high' : 'medium',
        `EUR ${10_000 + index}`,
        JSON.stringify({ fixture: BENCHMARK_FORMAT }),
        timestamp,
        timestamp
      );
      insertJob.run(
        jobId,
        requestId,
        `client_benchmark_${clientSuffix}`,
        title,
        `Representative retained project ${suffix}`,
        `Teststraat ${index + 1}`,
        index % 2 ? 'Rotterdam' : 'Amsterdam',
        index % 9 === 0 ? 'high' : 'medium',
        status,
        completed ? 'handover' : 'execution',
        index % 9 === 0 ? 'high' : 'normal',
        40 + (index % 160),
        5_000 + index * 3,
        7_500 + index * 4,
        completed ? 100 : index % 96,
        '2026-01-05',
        '2026-02-28',
        '2026-03-15',
        JSON.stringify({ fixture: BENCHMARK_FORMAT, costCode: `CC-${index % 40}` }),
        timestamp,
        timestamp
      );
      for (let taskIndex = 0; taskIndex < definition.tasksPerJob; taskIndex += 1) {
        const taskStatus = completed || taskIndex === 3 ? 'completed' : taskIndex === 2 ? 'in_progress' : 'open';
        insertTask.run(
          `task_benchmark_${suffix}_${taskIndex}`,
          jobId,
          `Benchmark task ${taskIndex + 1}`,
          `Representative work package ${taskIndex + 1}`,
          taskStatus,
          taskIndex === 0 ? 'high' : 'medium',
          '2026-02-15',
          taskStatus === 'completed' ? '2026-02-10T16:00:00.000Z' : null,
          JSON.stringify({ fixture: BENCHMARK_FORMAT }),
          timestamp,
          timestamp
        );
      }
    }

    const insertOpportunity = ledger.db.prepare(`
      INSERT INTO opportunities (
        id, client_id, title, stage, source_channel, service, description,
        address, city, postal_code, country, estimated_value, probability_percent,
        target_decision_at, next_follow_up_at, owner_name, lost_reason,
        converted_job_id, data_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'referral', 'renovation', ?, ?, ?, ?, 'NL', ?, ?, ?, ?, 'Benchmark owner', ?, NULL, ?, ?, ?)
    `);
    const opportunityStages = ['new', 'qualifying', 'site_visit', 'estimating', 'proposal', 'negotiating', 'won', 'lost', 'archived'];
    for (let index = 0; index < definition.opportunities; index += 1) {
      const suffix = padded(index);
      const clientSuffix = padded(index % definition.clients);
      const timestamp = fixtureTimestamp(definition.clients + definition.jobs + index);
      const stage = index === 0 ? 'qualifying' : opportunityStages[index % opportunityStages.length];
      insertOpportunity.run(
        `opportunity_benchmark_${suffix}`,
        `client_benchmark_${clientSuffix}`,
        index === 0 ? 'Needle opportunity oldest' : `Benchmark opportunity ${suffix}`,
        stage,
        `Representative opportunity ${suffix}`,
        `Prospectstraat ${index + 1}`,
        index % 2 ? 'Utrecht' : 'Eindhoven',
        `${1000 + index}AA`,
        10_000 + index * 25,
        10 + (index % 9) * 10,
        '2026-12-15',
        index % 3 === 0 ? '2026-07-01T09:00:00.000Z' : '2027-01-15T09:00:00.000Z',
        stage === 'lost' ? 'Benchmark price decision' : null,
        JSON.stringify({ fixture: BENCHMARK_FORMAT, territory: index % 8 }),
        timestamp,
        timestamp
      );
    }

    const insertApproval = ledger.db.prepare(`
      INSERT INTO approvals (
        id, target_type, target_id, job_id, approval_type, status, requested_by,
        resolved_by, resolved_at, summary, reason, data_json, created_at, updated_at
      ) VALUES (?, 'communication', ?, ?, 'communication_send', ?, 'Benchmark operator', ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let index = 0; index < definition.approvals; index += 1) {
      const suffix = padded(index);
      const jobSuffix = padded(index % definition.jobs);
      const timestamp = fixtureTimestamp(definition.clients + definition.jobs + definition.opportunities + index);
      const pending = index % 3 !== 0;
      insertApproval.run(
        `approval_benchmark_${suffix}`,
        `communication_benchmark_${suffix}`,
        `job_benchmark_${jobSuffix}`,
        pending ? 'pending' : 'approved',
        pending ? null : 'Benchmark owner',
        pending ? null : timestamp,
        `Review benchmark communication ${suffix}`,
        pending ? null : 'Representative fixture resolution',
        JSON.stringify({ fixture: BENCHMARK_FORMAT, externalCommitments: 0 }),
        timestamp,
        timestamp
      );
    }

    ledger.db.prepare('DELETE FROM audit_chain_state WHERE chain_id = ?').run(AUDIT_CHAIN_ID);
    const insertAudit = ledger.db.prepare(`
      INSERT INTO audit_events (
        id, entity_type, entity_id, job_id, action, actor, before_json,
        after_json, metadata_json, created_at, sequence_number, previous_hash,
        event_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let previousHash = AUDIT_CHAIN_GENESIS_HASH;
    let headEventId = null;
    for (let index = 0; index < definition.auditEvents; index += 1) {
      const suffix = padded(index);
      const jobSuffix = padded(index % definition.jobs);
      const sequenceNumber = index + 1;
      const event = {
        sequenceNumber,
        previousHash,
        id: `audit_benchmark_${suffix}`,
        entityType: index % 4 === 0 ? 'approval' : 'job',
        entityId: index % 4 === 0 ? `approval_benchmark_${padded(index % definition.approvals)}` : `job_benchmark_${jobSuffix}`,
        jobId: `job_benchmark_${jobSuffix}`,
        action: index % 4 === 0 ? 'request_approval' : 'update_job',
        actor: index % 5 === 0 ? 'field_worker:benchmark' : 'office_operator:benchmark',
        beforeJson: '{}',
        afterJson: JSON.stringify({ fixture: BENCHMARK_FORMAT, sequenceNumber }),
        metadataJson: JSON.stringify({ externalCommitments: 0 }),
        createdAt: fixtureTimestamp(definition.clients + definition.jobs + definition.opportunities + definition.approvals + index)
      };
      const eventHash = auditEventHash(event);
      insertAudit.run(
        event.id,
        event.entityType,
        event.entityId,
        event.jobId,
        event.action,
        event.actor,
        event.beforeJson,
        event.afterJson,
        event.metadataJson,
        event.createdAt,
        sequenceNumber,
        previousHash,
        eventHash
      );
      previousHash = eventHash;
      headEventId = event.id;
    }
    ledger.db.prepare(`
      INSERT INTO audit_chain_state (chain_id, head_event_id, head_hash, event_count, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(AUDIT_CHAIN_ID, headEventId, previousHash, definition.auditEvents, fixtureTimestamp(definition.auditEvents));
  });
  return performance.now() - startedAt;
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(ordered.length * fraction) - 1);
  return ordered[index];
}

function measure(name, callback, iterations, { warm = true } = {}) {
  if (warm) callback();
  const samples = [];
  let maxResultBytes = 0;
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    const value = callback(index);
    const serialized = JSON.stringify(value);
    samples.push(performance.now() - startedAt);
    maxResultBytes = Math.max(maxResultBytes, Buffer.byteLength(serialized));
  }
  return {
    name,
    iterations,
    p50Ms: Number(percentile(samples, 0.5).toFixed(2)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(2)),
    maxMs: Number(Math.max(...samples).toFixed(2)),
    maxResultBytes,
    samplesMs: samples.map(value => Number(value.toFixed(2)))
  };
}

function databaseBytes(dbFile) {
  return [dbFile, `${dbFile}-wal`, `${dbFile}-shm`].reduce((total, file) => {
    try {
      return total + fs.statSync(file).size;
    } catch {
      return total;
    }
  }, 0);
}

function retainedCounts(ledger) {
  return {
    clients: ledger.count('clients'),
    jobRequests: ledger.count('job_requests'),
    jobs: ledger.count('jobs'),
    tasks: ledger.count('job_tasks'),
    opportunities: ledger.count('opportunities'),
    approvals: ledger.count('approvals'),
    auditEvents: ledger.count('audit_events')
  };
}

function validateFixture(ledger, definition) {
  const checks = [];
  const check = (name, actual, expected) => checks.push({ name, actual, expected, passed: actual === expected });
  const counts = retainedCounts(ledger);
  check('clients retained', counts.clients, definition.clients);
  check('job requests retained', counts.jobRequests, definition.jobs);
  check('jobs retained', counts.jobs, definition.jobs);
  check('tasks retained', counts.tasks, definition.jobs * definition.tasksPerJob);
  check('opportunities retained', counts.opportunities, definition.opportunities);
  check('approvals retained', counts.approvals, definition.approvals);
  check('audit events retained', counts.auditEvents, definition.auditEvents);

  const historicalJob = ledger.listJobs({ search: 'needle job oldest', includeArchived: true, limit: 10 });
  check('historical job search is not limited to the newest 500 rows', historicalJob[0]?.id || null, 'job_benchmark_000000');
  const historicalOpportunity = ledger.listOpportunities({ search: 'needle opportunity oldest', includeClosed: true, limit: 10 });
  check('historical opportunity search is not limited to the newest 500 rows', historicalOpportunity[0]?.id || null, 'opportunity_benchmark_000000');
  const historicalClient = ledger.listClients({ search: 'needle client oldest', limit: 10 });
  check('historical client search remains available', historicalClient[0]?.id || null, 'client_benchmark_000000');
  const forecast = ledger.opportunityForecast();
  check('pipeline aggregation covers every retained opportunity', forecast.summary.total, definition.opportunities);
  const auditIntegrity = ledger.verifyAuditIntegrity();
  check('audit chain remains valid at scale', auditIntegrity.valid, true);
  const indexes = new Set(ledger.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map(row => row.name));
  for (const index of REQUIRED_INDEXES) check(`required index ${index}`, indexes.has(index), true);
  return { checks, counts, auditIntegrity, passed: checks.every(item => item.passed) };
}

function evaluateThresholds(report, thresholds) {
  const checks = [];
  const atMost = (name, actual, limit) => checks.push({ name, actual, limit, unit: 'ms', passed: actual <= limit });
  atMost('initial ledger startup', report.phases.initialStartupMs, thresholds.initialStartupMs);
  atMost('representative fixture seed', report.phases.seedMs, thresholds.seedMs);
  atMost('scaled ledger reopen', report.phases.reopenMs, thresholds.reopenMs);
  for (const operation of report.operations) {
    let limit = thresholds.operationP95Ms;
    if (operation.name === 'dashboard summary') limit = thresholds.dashboardP95Ms;
    if (operation.name === 'audit integrity verification') limit = thresholds.integrityP95Ms;
    if (operation.name === 'canonical intake write') limit = thresholds.writeP95Ms;
    atMost(`${operation.name} p95`, operation.p95Ms, limit);
  }
  checks.push({
    name: 'database footprint',
    actual: Number((report.resources.databaseBytes / 1024 / 1024).toFixed(2)),
    limit: thresholds.databaseMb,
    unit: 'MiB',
    passed: report.resources.databaseBytes <= thresholds.databaseMb * 1024 * 1024
  });
  checks.push({
    name: 'resident-memory growth',
    actual: report.resources.rssDeltaMb,
    limit: thresholds.rssDeltaMb,
    unit: 'MiB',
    passed: report.resources.rssDeltaMb <= thresholds.rssDeltaMb
  });
  return checks;
}

function runLedgerBenchmark(options = {}) {
  const profileName = options.profile || 'production';
  const definition = PROFILE_DEFINITIONS[profileName];
  if (!definition) throw new Error(`Unknown benchmark profile: ${profileName}`);
  const iterations = options.iterations || definition.iterations;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 25) {
    throw new Error('Benchmark iterations must be an integer from 1 through 25.');
  }
  const runtimeDirectory = options.runtimeDirectory
    ? path.resolve(options.runtimeDirectory)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-ledger-benchmark-'));
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  const dbFile = path.join(runtimeDirectory, 'benchmark-ledger.sqlite');
  const rssBefore = process.memoryUsage().rss;
  let ledger = null;
  try {
    const startupStartedAt = performance.now();
    ledger = new ContractorOperatingLedger({ dbFile });
    const initialStartupMs = performance.now() - startupStartedAt;
    const seedMs = seedBenchmarkFixture(ledger, definition);
    const fixture = validateFixture(ledger, definition);
    ledger.close();
    ledger = null;

    const reopenStartedAt = performance.now();
    ledger = new ContractorOperatingLedger({ dbFile });
    const reopenMs = performance.now() - reopenStartedAt;
    const operations = [
      measure('active job list', () => ledger.listJobs({ limit: 100 }), iterations),
      measure('historical job search', () => ledger.listJobs({ search: 'needle job oldest', includeArchived: true, limit: 10 }), iterations),
      measure('client portfolio search', () => ledger.listClients({ search: 'benchmark', limit: 100 }), iterations),
      measure('open opportunity list', () => ledger.listOpportunities({ limit: 100 }), iterations),
      measure('historical opportunity search', () => ledger.listOpportunities({ search: 'needle opportunity oldest', includeClosed: true, limit: 10 }), iterations),
      measure('pending approval queue', () => ledger.listApprovals({ status: 'pending', limit: 100 }), iterations),
      measure('audit history page', () => ledger.listAuditPage({ limit: 100, includeFacets: true }), iterations),
      measure('opportunity forecast', () => ledger.opportunityForecast(), iterations),
      measure('dashboard summary', () => ledger.dashboardSummary(), iterations),
      measure('audit integrity verification', () => ledger.verifyAuditIntegrity(), 1),
      measure('canonical intake write', index => ledger.createIntake({
        client: {
          name: `Benchmark write client ${index}`,
          email: `benchmark-write-${index}@example.test`
        },
        title: `Benchmark canonical intake ${index}`,
        service: 'maintenance',
        description: 'Measured canonical ledger write against the representative retained dataset.',
        estimatedHours: 8,
        estimatedCost: 1_250,
        assignAutomatically: false
      }, { actor: 'benchmark' }), Math.min(iterations, 3), { warm: false })
    ];
    const rssAfter = process.memoryUsage().rss;
    const report = {
      format: BENCHMARK_FORMAT,
      status: 'pending',
      generatedAt: new Date().toISOString(),
      profile: profileName,
      fixtureDefinition: {
        clients: definition.clients,
        jobs: definition.jobs,
        tasksPerJob: definition.tasksPerJob,
        tasks: definition.jobs * definition.tasksPerJob,
        opportunities: definition.opportunities,
        approvals: definition.approvals,
        auditEvents: definition.auditEvents
      },
      fixture: {
        counts: fixture.counts,
        checks: fixture.checks,
        passed: fixture.passed,
        audit: {
          valid: fixture.auditIntegrity.valid,
          eventCount: fixture.auditIntegrity.eventCount,
          format: AUDIT_CHAIN_FORMAT,
          algorithm: AUDIT_CHAIN_ALGORITHM
        }
      },
      phases: {
        initialStartupMs: Number(initialStartupMs.toFixed(2)),
        seedMs: Number(seedMs.toFixed(2)),
        reopenMs: Number(reopenMs.toFixed(2))
      },
      operations,
      resources: {
        databaseBytes: databaseBytes(dbFile),
        rssBeforeMb: Number((rssBefore / 1024 / 1024).toFixed(2)),
        rssAfterMb: Number((rssAfter / 1024 / 1024).toFixed(2)),
        rssDeltaMb: Number((Math.max(0, rssAfter - rssBefore) / 1024 / 1024).toFixed(2)),
        heapUsedMb: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2))
      },
      environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        cpuCount: os.cpus().length,
        totalMemoryMb: Number((os.totalmem() / 1024 / 1024).toFixed(0))
      },
      thresholds: definition.thresholds
    };
    report.thresholdChecks = evaluateThresholds(report, definition.thresholds);
    report.status = report.fixture.passed && report.thresholdChecks.every(check => check.passed) ? 'passed' : 'failed';
    if (options.keep) report.runtimeDirectory = runtimeDirectory;
    if (options.output) {
      const outputFile = path.resolve(options.output);
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });
      fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    return report;
  } finally {
    if (ledger) ledger.close();
    if (!options.keep && !options.runtimeDirectory) {
      fs.rmSync(runtimeDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
}

function printReport(report, json = false) {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  console.log(`Contractor.AI ledger benchmark: ${report.status.toUpperCase()} (${report.profile})`);
  console.log(`Fixture: ${report.fixture.counts.jobs} jobs, ${report.fixture.counts.tasks} tasks, ${report.fixture.counts.opportunities} opportunities, ${report.fixture.counts.auditEvents} chained audit events`);
  console.log(`Startup ${report.phases.initialStartupMs} ms; seed ${report.phases.seedMs} ms; reopen ${report.phases.reopenMs} ms`);
  for (const operation of report.operations) {
    console.log(`${operation.name}: p50 ${operation.p50Ms} ms, p95 ${operation.p95Ms} ms, max response ${operation.maxResultBytes} bytes`);
  }
  const failures = [...report.fixture.checks, ...report.thresholdChecks].filter(check => !check.passed);
  if (failures.length) {
    console.error('Failed checks:');
    for (const failure of failures) console.error(`- ${failure.name}: ${failure.actual} (expected ${failure.expected ?? `<= ${failure.limit}`})`);
  }
}

if (require.main === module) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const report = runLedgerBenchmark(options);
    printReport(report, options.json);
    if (report.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  BENCHMARK_FORMAT,
  PROFILE_DEFINITIONS,
  REQUIRED_INDEXES,
  evaluateThresholds,
  parseArguments,
  runLedgerBenchmark,
  seedBenchmarkFixture,
  validateFixture
};
