const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { ContractorOperatingLedger } = require('../operating-ledger');
const {
  PostgresSyncDatabase,
  normalizeAdvisoryLockKey,
  resolvePostgresConnectionOptions,
  translateSql
} = require('../postgres-sync-database');

const connectionString = process.env.CONTRACTOR_AI_POSTGRES_TEST_URL;

function startSynchronizedSchedulerClaimant({ root, schedulerKey, now }) {
  const script = `
    const { ContractorOperatingLedger } = require('./operating-ledger');
    const ledger = new ContractorOperatingLedger({ databaseUrl: process.env.CONTRACTOR_AI_POSTGRES_TEST_URL });
    process.stdout.write('READY\\n');
    process.stdin.once('data', () => {
      try {
        const claim = ledger.claimScheduledJob(process.env.CONTRACTOR_AI_TEST_SCHEDULER_KEY, {
          intervalSeconds: 30,
          leaseSeconds: 30,
          now: process.env.CONTRACTOR_AI_TEST_SCHEDULER_NOW
        });
        process.stdout.write('RESULT:' + JSON.stringify({
          claimed: claim.claimed,
          leaseId: claim.leaseId || null,
          reason: claim.reason || null
        }) + '\\n');
      } catch (error) {
        process.stderr.write((error && error.stack) || String(error));
        process.exitCode = 1;
      } finally {
        ledger.close();
        process.stdin.pause();
      }
    });
  `;
  const child = spawn(process.execPath, ['-e', script], {
    cwd: root,
    env: {
      ...process.env,
      CONTRACTOR_AI_POSTGRES_TEST_URL: connectionString,
      CONTRACTOR_AI_TEST_SCHEDULER_KEY: schedulerKey,
      CONTRACTOR_AI_TEST_SCHEDULER_NOW: now
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  let ready = false;
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const resultPromise = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!ready && stdout.includes('READY\n')) {
        ready = true;
        resolveReady();
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      rejectReady(error);
      reject(error);
    });
    child.on('exit', code => {
      if (!ready) rejectReady(new Error(`PostgreSQL scheduler claimant exited before ready: ${stderr}`));
      if (code !== 0) {
        reject(new Error(`PostgreSQL scheduler claimant exited ${code}: ${stderr}`));
        return;
      }
      const resultLine = stdout.split(/\r?\n/).find(line => line.startsWith('RESULT:'));
      if (!resultLine) {
        reject(new Error(`PostgreSQL scheduler claimant returned no result: ${stdout}`));
        return;
      }
      resolve(JSON.parse(resultLine.slice('RESULT:'.length)));
    });
  });
  return { child, ready: readyPromise, result: resultPromise };
}

function startSynchronizedIdempotencyClaimant({ root, keyHash, scope, requestHash, now }) {
  const script = `
    const { ContractorOperatingLedger } = require('./operating-ledger');
    const ledger = new ContractorOperatingLedger({ databaseUrl: process.env.CONTRACTOR_AI_POSTGRES_TEST_URL });
    process.stdout.write('READY\\n');
    process.stdin.once('data', () => {
      try {
        const claim = ledger.claimIdempotentRequest({
          keyHash: process.env.CONTRACTOR_AI_TEST_IDEMPOTENCY_KEY,
          scope: process.env.CONTRACTOR_AI_TEST_IDEMPOTENCY_SCOPE,
          requestHash: process.env.CONTRACTOR_AI_TEST_IDEMPOTENCY_REQUEST,
          leaseMs: 30_000,
          now: process.env.CONTRACTOR_AI_TEST_IDEMPOTENCY_NOW
        });
        process.stdout.write('RESULT:' + JSON.stringify({
          claimed: claim.claimed,
          leaseId: claim.leaseId || null,
          reason: claim.reason || null
        }) + '\\n');
      } catch (error) {
        process.stderr.write((error && error.stack) || String(error));
        process.exitCode = 1;
      } finally {
        ledger.close();
        process.stdin.pause();
      }
    });
  `;
  const child = spawn(process.execPath, ['-e', script], {
    cwd: root,
    env: {
      ...process.env,
      CONTRACTOR_AI_POSTGRES_TEST_URL: connectionString,
      CONTRACTOR_AI_TEST_IDEMPOTENCY_KEY: keyHash,
      CONTRACTOR_AI_TEST_IDEMPOTENCY_SCOPE: scope,
      CONTRACTOR_AI_TEST_IDEMPOTENCY_REQUEST: requestHash,
      CONTRACTOR_AI_TEST_IDEMPOTENCY_NOW: now
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  let ready = false;
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const resultPromise = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!ready && stdout.includes('READY\n')) {
        ready = true;
        resolveReady();
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      rejectReady(error);
      reject(error);
    });
    child.on('exit', code => {
      if (!ready) rejectReady(new Error(`PostgreSQL idempotency claimant exited before ready: ${stderr}`));
      if (code !== 0) {
        reject(new Error(`PostgreSQL idempotency claimant exited ${code}: ${stderr}`));
        return;
      }
      const resultLine = stdout.split(/\r?\n/).find(line => line.startsWith('RESULT:'));
      if (!resultLine) {
        reject(new Error(`PostgreSQL idempotency claimant returned no result: ${stdout}`));
        return;
      }
      resolve(JSON.parse(resultLine.slice('RESULT:'.length)));
    });
  });
  return { child, ready: readyPromise, result: resultPromise };
}

function startSynchronizedAuthenticationFailure({ root, keyHash, now }) {
  const script = `
    const { ContractorOperatingLedger } = require('./operating-ledger');
    const ledger = new ContractorOperatingLedger({ databaseUrl: process.env.CONTRACTOR_AI_POSTGRES_TEST_URL });
    process.stdout.write('READY\\n');
    process.stdin.once('data', () => {
      try {
        const state = ledger.recordAuthenticationFailure(process.env.CONTRACTOR_AI_TEST_AUTH_RATE_KEY, {
          limit: 10,
          windowMs: 900_000,
          now: process.env.CONTRACTOR_AI_TEST_AUTH_RATE_NOW
        });
        process.stdout.write('RESULT:' + JSON.stringify({ attemptCount: state.attemptCount }) + '\\n');
      } catch (error) {
        process.stderr.write((error && error.stack) || String(error));
        process.exitCode = 1;
      } finally {
        ledger.close();
        process.stdin.pause();
      }
    });
  `;
  const child = spawn(process.execPath, ['-e', script], {
    cwd: root,
    env: {
      ...process.env,
      CONTRACTOR_AI_POSTGRES_TEST_URL: connectionString,
      CONTRACTOR_AI_TEST_AUTH_RATE_KEY: keyHash,
      CONTRACTOR_AI_TEST_AUTH_RATE_NOW: now
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  let ready = false;
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const resultPromise = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!ready && stdout.includes('READY\n')) {
        ready = true;
        resolveReady();
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      rejectReady(error);
      reject(error);
    });
    child.on('exit', code => {
      if (!ready) rejectReady(new Error(`PostgreSQL authentication limiter replica exited before ready: ${stderr}`));
      if (code !== 0) {
        reject(new Error(`PostgreSQL authentication limiter replica exited ${code}: ${stderr}`));
        return;
      }
      const resultLine = stdout.split(/\r?\n/).find(line => line.startsWith('RESULT:'));
      if (!resultLine) {
        reject(new Error(`PostgreSQL authentication limiter replica returned no result: ${stdout}`));
        return;
      }
      resolve(JSON.parse(resultLine.slice('RESULT:'.length)));
    });
  });
  return { child, ready: readyPromise, result: resultPromise };
}

function startSynchronizedApiRateRequest({ root, keyHash, now }) {
  const script = `
    const { ContractorOperatingLedger } = require('./operating-ledger');
    const ledger = new ContractorOperatingLedger({ databaseUrl: process.env.CONTRACTOR_AI_POSTGRES_TEST_URL });
    process.stdout.write('READY\\n');
    process.stdin.once('data', () => {
      try {
        const state = ledger.recordApiRateLimitRequest(process.env.CONTRACTOR_AI_TEST_API_RATE_KEY, {
          limit: 10,
          windowMs: 900_000,
          now: process.env.CONTRACTOR_AI_TEST_API_RATE_NOW
        });
        process.stdout.write('RESULT:' + JSON.stringify({ requestCount: state.requestCount }) + '\\n');
      } catch (error) {
        process.stderr.write((error && error.stack) || String(error));
        process.exitCode = 1;
      } finally {
        ledger.close();
        process.stdin.pause();
      }
    });
  `;
  const child = spawn(process.execPath, ['-e', script], {
    cwd: root,
    env: {
      ...process.env,
      CONTRACTOR_AI_POSTGRES_TEST_URL: connectionString,
      CONTRACTOR_AI_TEST_API_RATE_KEY: keyHash,
      CONTRACTOR_AI_TEST_API_RATE_NOW: now
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  let ready = false;
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const resultPromise = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!ready && stdout.includes('READY\n')) {
        ready = true;
        resolveReady();
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      rejectReady(error);
      reject(error);
    });
    child.on('exit', code => {
      if (!ready) rejectReady(new Error(`PostgreSQL API limiter replica exited before ready: ${stderr}`));
      if (code !== 0) {
        reject(new Error(`PostgreSQL API limiter replica exited ${code}: ${stderr}`));
        return;
      }
      const resultLine = stdout.split(/\r?\n/).find(line => line.startsWith('RESULT:'));
      if (!resultLine) {
        reject(new Error(`PostgreSQL API limiter replica returned no result: ${stdout}`));
        return;
      }
      resolve(JSON.parse(resultLine.slice('RESULT:'.length)));
    });
  });
  return { child, ready: readyPromise, result: resultPromise };
}

function startSynchronizedAuditAppend({ root, entityId }) {
  const script = `
    const { ContractorOperatingLedger } = require('./operating-ledger');
    const ledger = new ContractorOperatingLedger({ databaseUrl: process.env.CONTRACTOR_AI_POSTGRES_TEST_URL });
    process.stdout.write('READY\\n');
    process.stdin.once('data', () => {
      try {
        const id = ledger.audit({
          entityType: 'postgres_concurrent_audit',
          entityId: process.env.CONTRACTOR_AI_TEST_AUDIT_ENTITY,
          action: 'retain_concurrent_event',
          actor: 'postgres_audit_replica',
          after: { retained: true }
        });
        const event = ledger.listAudit({ entityId: process.env.CONTRACTOR_AI_TEST_AUDIT_ENTITY, limit: 1 })[0];
        process.stdout.write('RESULT:' + JSON.stringify({ id, sequenceNumber: event.sequenceNumber, eventHash: event.eventHash }) + '\\n');
      } catch (error) {
        process.stderr.write((error && error.stack) || String(error));
        process.exitCode = 1;
      } finally {
        ledger.close();
        process.stdin.pause();
      }
    });
  `;
  const child = spawn(process.execPath, ['-e', script], {
    cwd: root,
    env: {
      ...process.env,
      CONTRACTOR_AI_POSTGRES_TEST_URL: connectionString,
      CONTRACTOR_AI_TEST_AUDIT_ENTITY: entityId
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  let ready = false;
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const resultPromise = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!ready && stdout.includes('READY\n')) {
        ready = true;
        resolveReady();
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      rejectReady(error);
      reject(error);
    });
    child.on('exit', code => {
      if (!ready) rejectReady(new Error(`PostgreSQL audit replica exited before ready: ${stderr}`));
      if (code !== 0) {
        reject(new Error(`PostgreSQL audit replica exited ${code}: ${stderr}`));
        return;
      }
      const resultLine = stdout.split(/\r?\n/).find(line => line.startsWith('RESULT:'));
      if (!resultLine) {
        reject(new Error(`PostgreSQL audit replica returned no result: ${stdout}`));
        return;
      }
      resolve(JSON.parse(resultLine.slice('RESULT:'.length)));
    });
  });
  return { child, ready: readyPromise, result: resultPromise };
}

test('PostgreSQL connection options honor explicit TLS modes', () => {
  const local = resolvePostgresConnectionOptions('postgresql://user:secret@127.0.0.1:5432/ledger?sslmode=disable');
  assert.equal(local.ssl, false);
  assert.equal(local.rejectUnauthorized, false);
  assert.equal(local.sslMode, 'disable');
  assert.ok(!local.connectionString.includes('sslmode='));

  const hosted = resolvePostgresConnectionOptions('postgresql://user:secret@db.example.eu:5432/ledger?sslmode=verify-full');
  assert.equal(hosted.ssl, true);
  assert.equal(hosted.rejectUnauthorized, true);
  assert.equal(hosted.sslMode, 'verify-full');

  const encryptedFixture = resolvePostgresConnectionOptions('postgresql://user:secret@127.0.0.1:5432/ledger?sslmode=require');
  assert.equal(encryptedFixture.ssl, true);
  assert.equal(encryptedFixture.rejectUnauthorized, false);

  const schemaSql = translateSql('CREATE TABLE precision_test (amount REAL NOT NULL, label TEXT)');
  assert.match(schemaSql, /amount DOUBLE PRECISION NOT NULL/);
  assert.doesNotMatch(schemaSql, /\bREAL\b/);
  assert.equal(normalizeAdvisoryLockKey(2026071302), 2026071302);
  assert.throws(() => normalizeAdvisoryLockKey(Number.MAX_VALUE), /safe integer/);
});

test('PostgreSQL adapter applies the ledger contract and durable scheduler migrations', { skip: !connectionString }, () => {
  const ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  try {
    assert.equal(ledger.databaseMode, 'postgres');
    const job = ledger.createIntake({
      title: 'PostgreSQL ledger contract',
      client: { name: 'PostgreSQL integration client' },
      description: 'Verify the shared operating-ledger workflow on PostgreSQL.'
    }, { actor: 'postgres_contract_test' });

    const progress = ledger.addProgressUpdate(job.id, {
      progressPercent: 25,
      note: 'PostgreSQL progress proof.'
    }, { actor: 'postgres_contract_test' });
    assert.equal(progress.progressPercent, 25);

    const hostedClient = ledger.updateClient(job.clientId, {
      company: 'PostgreSQL Integration Client BV',
      email: 'postgres-client@example.test',
      address: 'Hosted Contract Street 1',
      postalCode: '1011 AA',
      city: 'Amsterdam',
      country: 'NL',
      registrationNumber: '87654321'
    }, { actor: 'postgres_contract_test' });
    assert.equal(hostedClient.readiness.structuredInvoiceReady, true);
    const hostedClientDirectory = ledger.listClients({ search: 'PostgreSQL Integration Client', limit: 10 });
    assert.ok(hostedClientDirectory.some(client => (
      client.id === hostedClient.id
      && client.metrics.activeJobs >= 1
      && client.readiness.endpoint.scheme === '0106'
    )));

    const hostedTask = ledger.addTask(job.id, {
      title: 'Verify hosted task lifecycle',
      priority: 'high',
      dueAt: '2027-01-10T15:00:00.000Z'
    }, { actor: 'postgres_contract_test' });
    const startedTask = ledger.transitionLifecycleRecord(job.id, 'task', hostedTask.id, {
      status: 'in_progress'
    }, { actor: 'postgres_contract_test' });
    assert.equal(startedTask.record.status, 'in_progress');
    assert.throws(() => ledger.transitionLifecycleRecord(job.id, 'task', hostedTask.id, {
      status: 'completed'
    }, { actor: 'postgres_contract_test' }), error => error.code === 'task_transition_evidence_required');
    const completedTask = ledger.transitionLifecycleRecord(job.id, 'task', hostedTask.id, {
      status: 'completed',
      notes: 'Hosted PostgreSQL task evidence retained.'
    }, { actor: 'postgres_contract_test' });
    assert.equal(completedTask.record.status, 'completed');
    assert.ok(Date.parse(completedTask.record.completedAt));

    const initialDetail = ledger.getJobDetail(job.id, { includeAudit: false });
    for (const approval of initialDetail.approvals.filter(item => item.status === 'pending')) {
      ledger.resolveApproval(approval.id, {
        status: 'approved',
        resolvedBy: 'postgres_contract_approver',
        reason: 'Resolve the intake decision before testing the hosted lifecycle contract.'
      });
    }

    const dispatchWorker = ledger.upsertWorker({
      name: `PostgreSQL dispatch crew ${Date.now()}`,
      role: 'Site carpenter',
      status: 'available',
      homeRegion: 'EU hosted region',
      skills: ['carpentry']
    }, { actor: 'postgres_contract_test' });
    const dispatchAssignment = ledger.addAssignment(job.id, {
      workerId: dispatchWorker.id,
      status: 'planned'
    }, { actor: 'postgres_contract_test' });
    const readyWorkforceDispatch = ledger.recommendSchedule(job.id, {}, { actor: 'postgres_contract_test', audit: false });
    assert.equal(readyWorkforceDispatch.readiness.workforce.status, 'ready');
    ledger.upsertWorker({ id: dispatchWorker.id, status: 'on_leave' }, { actor: 'postgres_contract_test' });
    const blockedWorkforceDispatch = ledger.recommendSchedule(job.id, {}, { actor: 'postgres_contract_test', audit: false });
    assert.equal(blockedWorkforceDispatch.readiness.workforce.status, 'blocked');
    assert.equal(blockedWorkforceDispatch.blockers.find(blocker => blocker.type === 'worker_unavailable').workerId, dispatchWorker.id);
    ledger.upsertWorker({ id: dispatchWorker.id, status: 'available' }, { actor: 'postgres_contract_test' });
    assert.equal(ledger.recommendSchedule(job.id, {}, { actor: 'postgres_contract_test', audit: false }).blockers
      .some(blocker => blocker.type === 'worker_unavailable' && blocker.workerId === dispatchWorker.id), false);

    const preparedDispatchCrew = ledger.prepareScheduleDispatch(job.id, {}, { actor: 'postgres_contract_test' });
    const dispatchInstruction = preparedDispatchCrew.job.workerInstructions.find(record => record.assignmentId === dispatchAssignment.id);
    const dispatchOrientation = preparedDispatchCrew.job.orientations.find(record => record.assignmentId === dispatchAssignment.id);
    const dispatchAccess = preparedDispatchCrew.job.siteAccessLogs.find(record => record.assignmentId === dispatchAssignment.id);
    assert.equal(dispatchInstruction.workerId, dispatchWorker.id);
    assert.equal(dispatchOrientation.workerId, dispatchWorker.id);
    assert.equal(dispatchAccess.workerId, dispatchWorker.id);
    assert.equal(dispatchAccess.orientationId, dispatchOrientation.id);

    const releasedDispatchCrew = ledger.releaseAssignment(job.id, dispatchAssignment.id, {
      reason: 'Replace the hosted dispatch crew before field reliance.'
    }, { actor: 'postgres_contract_test' });
    assert.deepEqual(releasedDispatchCrew.invalidatedCrewEvidence, {
      instructions: 1,
      orientations: 1,
      siteAccess: 1,
      approvalTargets: 3
    });
    const replacementWorker = ledger.upsertWorker({
      name: `PostgreSQL replacement crew ${Date.now()}`,
      role: 'Site carpenter',
      status: 'available',
      homeRegion: 'EU hosted region',
      skills: ['carpentry']
    }, { actor: 'postgres_contract_test' });
    const replacementAssignment = ledger.addAssignment(job.id, {
      workerId: replacementWorker.id,
      status: 'planned'
    }, { actor: 'postgres_contract_test' });
    const replacementRecommendation = ledger.recommendSchedule(job.id, {}, { actor: 'postgres_contract_test', audit: false });
    assert.ok(replacementRecommendation.missing.includes('worker_instruction'));
    assert.ok(replacementRecommendation.missing.includes('site_access'));
    assert.equal(replacementRecommendation.readiness.instructions.staleRecords, 1);
    assert.equal(replacementRecommendation.readiness.crewEvidence.staleRecords.orientations, 1);
    const preparedReplacement = ledger.prepareScheduleDispatch(job.id, {}, { actor: 'postgres_contract_test' });
    assert.equal(preparedReplacement.job.workerInstructions.find(record => record.assignmentId === replacementAssignment.id).workerId, replacementWorker.id);
    assert.equal(preparedReplacement.job.orientations.find(record => record.assignmentId === replacementAssignment.id).workerId, replacementWorker.id);
    assert.equal(preparedReplacement.job.siteAccessLogs.find(record => record.assignmentId === replacementAssignment.id).workerId, replacementWorker.id);

    const attendanceWorker = ledger.upsertWorker({
      name: `PostgreSQL attendance crew ${Date.now()}`,
      role: 'Site installer',
      status: 'available'
    }, { actor: 'postgres_contract_test' });
    let attendanceAssignment = ledger.addAssignment(job.id, {
      workerId: attendanceWorker.id,
      status: 'active'
    }, { actor: 'postgres_contract_test' });
    if (attendanceAssignment.approval?.id) {
      ledger.resolveApproval(attendanceAssignment.approval.id, {
        status: 'approved', resolvedBy: 'postgres_contract_approver', reason: 'Hosted attendance assignment verified.'
      });
      attendanceAssignment = ledger.getJobDetail(job.id).assignments.find(record => record.id === attendanceAssignment.id);
    }
    const hostedExpenseKey = `postgres-expense-${Date.now()}`;
    const hostedExpensePayload = {
      entryKey: hostedExpenseKey,
      workerId: attendanceWorker.id,
      expenseDate: new Date().toISOString().slice(0, 10),
      category: 'materials',
      vendor: 'PostgreSQL hosted merchant',
      receiptReference: `PG-EXPENSE-${Date.now()}`,
      totalAmount: 121,
      taxAmount: 21,
      taxTreatment: 'recoverable',
      paymentMethod: 'personal_card',
      costCode: 'PG-EXP-100',
      notes: 'Hosted expense receipt contract evidence.'
    };
    const hostedExpenseRequest = ledger.createExpenseReceipt(job.id, hostedExpensePayload, { actor: 'postgres_contract_test' });
    assert.equal(hostedExpenseRequest.expense.status, 'pending_approval');
    assert.equal(hostedExpenseRequest.expense.integrityValid, true);
    assert.equal(ledger.createExpenseReceipt(job.id, hostedExpensePayload, { actor: 'postgres_contract_replay' }).replayed, true);
    ledger.resolveApproval(hostedExpenseRequest.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_approver',
      reason: 'Hosted receipt identity, worker, VAT, and project allocation verified.'
    });
    const hostedExpense = ledger.getExpense(hostedExpenseRequest.expense.id);
    assert.equal(hostedExpense.status, 'approved');
    assert.equal(hostedExpense.costAmount, 100);
    assert.equal(hostedExpense.integrityValid, true);
    const hostedEnvironmentalPayload = {
      entryKey: `postgres-environmental-${Date.now()}`,
      workerId: attendanceWorker.id,
      activityDate: new Date().toISOString().slice(0, 10),
      category: 'electricity',
      ghgScope: 'scope_2',
      description: 'PostgreSQL temporary site power',
      quantity: 250,
      unit: 'kWh',
      emissionFactor: 0.35,
      factorSource: 'PostgreSQL retained factor library',
      factorReference: `postgres-factor:electricity:${Date.now()}`,
      evidenceReference: `postgres-meter:${Date.now()}`,
      notes: 'Hosted environmental reporting contract evidence.'
    };
    const hostedEnvironmentalRequest = ledger.createEnvironmentalActivity(job.id, hostedEnvironmentalPayload, { actor: 'postgres_contract_test' });
    assert.equal(hostedEnvironmentalRequest.activity.status, 'pending_approval');
    assert.equal(hostedEnvironmentalRequest.activity.integrityValid, true);
    assert.equal(ledger.createEnvironmentalActivity(job.id, hostedEnvironmentalPayload, { actor: 'postgres_contract_replay' }).replayed, true);
    ledger.resolveApproval(hostedEnvironmentalRequest.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_approver',
      reason: 'Hosted power statement, scope, quantity, and factor provenance verified.'
    });
    const hostedEnvironmentalActivity = ledger.getEnvironmentalActivity(hostedEnvironmentalRequest.activity.id);
    assert.equal(hostedEnvironmentalActivity.status, 'approved');
    assert.equal(hostedEnvironmentalActivity.emissionsKgCo2e, 87.5);
    assert.equal(hostedEnvironmentalActivity.integrityValid, true);
    const hostedEnvironmentalReportRequest = ledger.requestEnvironmentalReport(job.id, {}, { actor: 'postgres_contract_test' });
    ledger.resolveApproval(hostedEnvironmentalReportRequest.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_approver',
      reason: 'Hosted environmental report source and checksums verified.'
    });
    const hostedEnvironmentalReport = ledger.getEnvironmentalReportContent(hostedEnvironmentalReportRequest.report.id);
    assert.equal(hostedEnvironmentalReport.report.integrityValid, true);
    assert.equal(hostedEnvironmentalReport.report.sourceCurrent, true);
    assert.match(hostedEnvironmentalReport.content, /PostgreSQL temporary site power/);
    const hostedQualificationRequirement = ledger.createQualificationRequirement(job.id, {
      credentialType: 'vca',
      title: 'Hosted VCA site qualification',
      role: 'Site installer'
    }, { actor: 'postgres_contract_test' }).requirement;
    const hostedCredentialRequest = ledger.requestWorkerCredential(attendanceWorker.id, {
      credentialType: 'vca_basic',
      issuer: 'Hosted SSVV source',
      credentialNumber: `POSTGRES-VCA-${Date.now()}`,
      issuedOn: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
      expiresOn: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10),
      evidenceReference: 'Hosted PostgreSQL retained VCA evidence'
    }, { actor: 'postgres_contract_test' });
    ledger.resolveApproval(hostedCredentialRequest.approval.id, {
      status: 'approved', resolvedBy: 'postgres_contract_approver', reason: 'Hosted worker credential source verified.'
    });
    const hostedCredential = ledger.getWorkerCredential(hostedCredentialRequest.credential.id);
    assert.equal(hostedCredential.status, 'approved');
    assert.equal(ledger.assessWorkerQualifications(attendanceWorker.id, { jobId: job.id, role: 'Site installer' }).status, 'ready');
    assert.ok(ledger.getJobDetail(job.id).qualificationRequirements.some(item => item.id === hostedQualificationRequirement.id));
    const hostedAvailabilityStart = new Date(Date.now() + 120 * 86_400_000).toISOString();
    const hostedAvailabilityEnd = new Date(Date.parse(hostedAvailabilityStart) + 8 * 3_600_000).toISOString();
    const hostedAvailability = ledger.createWorkerAvailabilityPeriod(attendanceWorker.id, {
      periodType: 'training',
      title: 'Hosted equipment training',
      startsAt: hostedAvailabilityStart,
      endsAt: hostedAvailabilityEnd,
      notes: 'Operational availability contract fixture.'
    }, { actor: 'postgres_contract_test' });
    assert.equal(hostedAvailability.period.status, 'active');
    assert.equal(ledger.findWorkerAvailabilityConflicts({
      workerId: attendanceWorker.id,
      scheduledStart: hostedAvailabilityStart,
      scheduledEnd: hostedAvailabilityEnd
    }).length, 1);
    const hostedAvailabilityCancellation = ledger.requestWorkerAvailabilityCancellation(
      attendanceWorker.id,
      hostedAvailability.period.id,
      { reason: 'Hosted availability cancellation contract verification.' },
      { actor: 'postgres_contract_test' }
    );
    ledger.resolveApproval(hostedAvailabilityCancellation.approval.id, {
      status: 'approved', resolvedBy: 'postgres_contract_approver', reason: 'Hosted availability change verified.'
    });
    assert.equal(ledger.getWorkerAvailabilityPeriod(hostedAvailability.period.id).status, 'cancelled');
    const attendanceOrientation = ledger.createWorkerOrientation(job.id, {
      assignmentId: attendanceAssignment.id,
      workerId: attendanceWorker.id,
      workerName: attendanceWorker.name,
      status: 'completed'
    }, { actor: 'postgres_contract_test' });
    ledger.resolveApproval(attendanceOrientation.approvalId, {
      status: 'approved', resolvedBy: 'postgres_contract_approver', reason: 'Hosted orientation evidence verified.'
    });
    const attendanceAccess = ledger.createSiteAccessLog(job.id, {
      assignmentId: attendanceAssignment.id,
      workerId: attendanceWorker.id,
      workerName: attendanceWorker.name,
      orientationId: attendanceOrientation.id,
      orientationValid: true,
      status: 'cleared'
    }, { actor: 'postgres_contract_test' });
    ledger.resolveApproval(attendanceAccess.approvalId, {
      status: 'approved', resolvedBy: 'postgres_contract_approver', reason: 'Hosted site access evidence verified.'
    });
    const attendanceCheckInAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const attendanceCheckOutAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const attendanceSession = ledger.recordAttendanceCheckIn(job.id, {
      assignmentId: attendanceAssignment.id,
      workerId: attendanceWorker.id,
      occurredAt: attendanceCheckInAt,
      entryKey: `postgres-attendance-in-${Date.now()}`
    }, { actor: 'postgres_contract_test' }).session;
    const attendanceReplay = ledger.recordAttendanceCheckIn(job.id, {
      assignmentId: attendanceAssignment.id,
      workerId: attendanceWorker.id,
      occurredAt: attendanceCheckInAt,
      entryKey: attendanceSession.checkInEntryKey
    }, { actor: 'postgres_contract_test' });
    assert.equal(attendanceReplay.replayed, true);
    ledger.recordAttendanceCheckOut(job.id, attendanceSession.id, {
      workerId: attendanceWorker.id,
      occurredAt: attendanceCheckOutAt,
      entryKey: `postgres-attendance-out-${Date.now()}`
    }, { actor: 'postgres_contract_test' });
    const attendanceAdjustment = ledger.requestAttendanceAdjustment(job.id, attendanceSession.id, {
      checkInAt: new Date(Date.parse(attendanceCheckInAt) + 5 * 60 * 1000).toISOString(),
      checkOutAt: attendanceCheckOutAt,
      reason: 'Hosted gate clock offset verified for parity testing.'
    }, { actor: 'postgres_contract_test' });
    ledger.resolveApproval(attendanceAdjustment.approval.id, {
      status: 'approved', resolvedBy: 'postgres_contract_approver', reason: 'Hosted attendance adjustment evidence verified.'
    });
    const hostedAttendance = ledger.getAttendanceSession(attendanceSession.id);
    assert.equal(hostedAttendance.adjustment.status, 'approved');
    assert.equal(hostedAttendance.checkInAt, attendanceCheckInAt);
    assert.notEqual(hostedAttendance.effectiveCheckInAt, hostedAttendance.checkInAt);

    const timesheetWeek = new Date();
    timesheetWeek.setUTCHours(0, 0, 0, 0);
    timesheetWeek.setUTCDate(timesheetWeek.getUTCDate() - (timesheetWeek.getUTCDay() || 7) - 6);
    const timesheetPeriodStart = timesheetWeek.toISOString().slice(0, 10);
    ledger.addTimeLog(job.id, {
      workerId: attendanceWorker.id,
      workDate: timesheetPeriodStart,
      hours: 8,
      rate: 45,
      source: 'postgres_verified_timecard',
      verificationReference: 'POSTGRES-TIME-001'
    }, { actor: 'postgres_contract_test' });
    const timesheetRequest = ledger.requestWeeklyTimesheet(attendanceWorker.id, { periodStart: timesheetPeriodStart }, { actor: 'postgres_contract_test' });
    assert.equal(timesheetRequest.timesheet.integrityValid, true);
    assert.equal(timesheetRequest.approval.targetType, 'weekly_timesheet');
    ledger.resolveApproval(timesheetRequest.approval.id, {
      status: 'approved', resolvedBy: 'postgres_contract_approver', reason: 'Hosted worker time sources were reviewed.'
    });
    const hostedTimesheet = ledger.getWeeklyTimesheet(timesheetRequest.timesheet.id);
    assert.equal(hostedTimesheet.status, 'approved');
    assert.equal(hostedTimesheet.totalHours, 8);
    const hostedTimesheetExport = ledger.prepareTimesheetExport({ periodStart: timesheetPeriodStart }, { actor: 'postgres_contract_test' }).export;
    assert.equal(hostedTimesheetExport.integrityValid, true);
    assert.match(ledger.getTimesheetExportContent(hostedTimesheetExport.id).content, /PostgreSQL attendance crew/);

    const tradePartner = ledger.upsertTradePartner({
      name: `PostgreSQL supplier ${Date.now()}`,
      partnerType: 'supplier'
    }, { actor: 'postgres_contract_test' });
    assert.equal(tradePartner.compliance.status, 'needs_review');
    const procurement = ledger.createProcurementOrder(job.id, {
      supplier: tradePartner.name,
      tradePartnerId: tradePartner.id,
      status: 'ready_to_order',
      amount: 320,
      requiredBy: '2027-01-15T08:00:00.000Z',
      items: [{ name: 'PostgreSQL retained material', quantity: 2, unitCost: 160 }]
    }, { actor: 'postgres_contract_test' });
    assert.equal(procurement.status, 'pending_approval');
    assert.throws(() => ledger.resolveApproval(procurement.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_approver',
      reason: 'Attempt before retained partner evidence is complete.'
    }), error => error.code === 'trade_partner_compliance_required');
    assert.ok(ledger.listApprovals({ status: 'pending', limit: 100 }).some(approval => approval.id === procurement.approval.id));
    assert.deepEqual(
      ledger.listApprovals({ status: 'pending', id: procurement.approval.id }).map(approval => approval.id),
      [procurement.approval.id]
    );
    assert.ok(ledger.listApprovals({ status: 'pending', jobId: job.id, limit: 100 }).some(approval => approval.id === procurement.approval.id));

    const verifiedTradePartner = ledger.upsertTradePartner({
      id: tradePartner.id,
      registrationNumber: '44332211',
      vatNumber: 'NL123456789B01',
      verificationReference: 'PostgreSQL contract registry check',
      verifiedAt: new Date(Date.now() - 86_400_000).toISOString()
    }, { actor: 'postgres_contract_test' });
    assert.equal(verifiedTradePartner.compliance.status, 'verified');
    ledger.resolveApproval(procurement.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_approver',
      reason: 'Current partner evidence was verified in PostgreSQL.'
    });
    const approvedProcurement = ledger.getJobDetail(job.id, { includeAudit: false }).procurementOrders
      .find(order => order.id === procurement.id);
    assert.equal(approvedProcurement.status, 'ready_to_order');
    assert.equal(approvedProcurement.tradePartnerId, tradePartner.id);
    assert.equal(approvedProcurement.partnerComplianceSnapshot.complianceStatus, 'verified');

    const purchaseOrder = ledger.createPurchaseOrder(job.id, {
      supplier: verifiedTradePartner.name,
      tradePartnerId: verifiedTradePartner.id,
      status: 'ready_to_order',
      amount: 320,
      currency: 'EUR',
      orderReference: `POSTGRES-PO-${Date.now()}`,
      items: [{ name: 'PostgreSQL payable material', quantity: 2, unitCost: 160 }]
    }, { actor: 'postgres_contract_test' });
    ledger.resolveApproval(purchaseOrder.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_approver',
      reason: 'Hosted purchase commitment and supplier evidence verified.'
    });
    const payableEvidence = ledger.addDocument(job.id, {
      type: 'service_completion',
      title: 'PostgreSQL retained service completion GR-320',
      filename: 'postgres-service-completion-gr-320.pdf'
    }, { actor: 'postgres_contract_test' });
    const supplierInvoice = ledger.createSupplierInvoice(job.id, {
      purchaseOrderId: purchaseOrder.id,
      tradePartnerId: verifiedTradePartner.id,
      supplier: verifiedTradePartner.name,
      invoiceNumber: `POSTGRES-SUP-${Date.now()}`,
      invoiceDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      netAmount: 320,
      taxAmount: 67.2,
      total: 387.2,
      deliveryDocumentId: payableEvidence.id,
      notes: 'Hosted three-way supplier invoice match.'
    }, { actor: 'postgres_contract_test' });
    assert.equal(supplierInvoice.match.status, 'matched');
    assert.equal(supplierInvoice.match.type, 'three_way_service_completion');
    ledger.resolveApproval(supplierInvoice.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_approver',
      reason: 'Hosted purchase order, receipt, invoice, and supplier evidence verified.'
    });
    const supplierPayment = ledger.recordSupplierInvoicePayment(job.id, supplierInvoice.id, {
      amount: 387.2,
      paidAt: new Date().toISOString(),
      method: 'bank_transfer',
      reference: `POSTGRES-BANK-${Date.now()}`,
      notes: 'Hosted bank statement payment evidence.'
    }, { actor: 'postgres_contract_test' });
    assert.equal(supplierPayment.status, 'pending_confirmation');
    ledger.resolveApproval(supplierPayment.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_approver',
      reason: 'Hosted bank reference and amount verified.'
    });
    const hostedPayable = ledger.getJobDetail(job.id, { includeAudit: false }).supplierInvoices
      .find(invoice => invoice.id === supplierInvoice.id);
    assert.equal(hostedPayable.status, 'paid');
    assert.equal(hostedPayable.data.reconciliation.outstandingAmount, 0);

    const inspectedAt = new Date().toISOString().slice(0, 10);
    const nextInspectionDue = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    const inspectionEquipment = ledger.upsertTool({
      name: `PostgreSQL inspection lift ${Date.now()}`,
      category: 'access',
      status: 'available',
      currentLocation: 'EU hosted depot',
      data: { inspectionRequired: true, inspectionDueAt: '2020-01-01' }
    }, { actor: 'postgres_contract_test' });
    assert.equal(ledger.listTools({ limit: 500 }).find(tool => tool.id === inspectionEquipment.id).inspection.status, 'overdue');
    assert.throws(() => ledger.reserveTool(job.id, {
      toolId: inspectionEquipment.id,
      status: 'reserved'
    }, { actor: 'postgres_contract_test' }), error => error.code === 'tool_inspection_overdue');
    const passedInspection = ledger.recordToolInspection(inspectionEquipment.id, {
      result: 'passed',
      inspector: 'PostgreSQL contract inspector',
      inspectedAt,
      nextDueAt: nextInspectionDue,
      reference: 'PG-CHECK-001'
    }, { actor: 'postgres_contract_test' });
    assert.equal(passedInspection.tool.inspection.status, 'current');
    assert.equal(passedInspection.inspection.certificationClaimed, false);
    assert.equal(passedInspection.externalCommitments, 0);
    const inspectedReservation = ledger.reserveTool(job.id, {
      toolId: inspectionEquipment.id,
      status: 'reserved'
    }, { actor: 'postgres_contract_test' });
    assert.equal(inspectedReservation.status, 'reserved');
    ledger.releaseToolReservation(job.id, inspectedReservation.id, {
      reason: 'Hosted inspection contract reservation completed.'
    }, { actor: 'postgres_contract_test' });
    const dispatchInspectionReservation = ledger.reserveTool(job.id, {
      toolId: inspectionEquipment.id,
      status: 'reserved'
    }, { actor: 'postgres_contract_test' });
    const failedInspection = ledger.recordToolInspection(inspectionEquipment.id, {
      result: 'failed',
      inspector: 'PostgreSQL contract inspector',
      inspectedAt,
      reference: 'PG-CHECK-002',
      notes: 'Retained defect requires maintenance before reservation.'
    }, { actor: 'postgres_contract_test' });
    assert.equal(failedInspection.tool.status, 'maintenance');
    assert.equal(failedInspection.tool.inspection.status, 'failed');
    assert.throws(() => ledger.reserveTool(job.id, {
      toolId: inspectionEquipment.id,
      status: 'reserved'
    }, { actor: 'postgres_contract_test' }), error => error.code === 'tool_inspection_failed');
    assert.throws(() => ledger.recordToolInspection(inspectionEquipment.id, {
      result: 'passed',
      inspector: 'PostgreSQL contract inspector',
      inspectedAt,
      nextDueAt: nextInspectionDue,
      reference: 'PG-CHECK-BYPASS'
    }, { actor: 'postgres_contract_test' }), error => error.code === 'tool_maintenance_required_before_reinspection');
    const failedDispatch = ledger.recommendSchedule(job.id, {}, { actor: 'postgres_contract_test', audit: false });
    assert.equal(failedDispatch.blockers.find(blocker => blocker.type === 'tool_inspection_readiness').inspectionStatus, 'failed');

    const maintainedEquipment = ledger.recordToolMaintenance(inspectionEquipment.id, {
      outcome: 'completed',
      maintenanceType: 'corrective',
      performedBy: 'PostgreSQL contract technician',
      performedAt: inspectedAt,
      reference: 'PG-WORK-001',
      notes: 'Retained defect was repaired and an internal function check completed.'
    }, { actor: 'postgres_contract_test' });
    assert.equal(maintainedEquipment.reinspectionRequired, true);
    assert.equal(maintainedEquipment.reservationReady, false);
    assert.equal(maintainedEquipment.tool.inspection.status, 'reinspection_required');
    assert.equal(maintainedEquipment.maintenance.supplierSpend, 0);
    assert.equal(maintainedEquipment.externalCommitments, 0);
    const maintainedDispatch = ledger.recommendSchedule(job.id, {}, { actor: 'postgres_contract_test', audit: false });
    assert.equal(maintainedDispatch.blockers.find(blocker => blocker.type === 'tool_inspection_readiness').inspectionStatus, 'reinspection_required');

    const passedReinspection = ledger.recordToolInspection(inspectionEquipment.id, {
      result: 'passed',
      inspector: 'PostgreSQL contract inspector',
      inspectedAt,
      nextDueAt: nextInspectionDue,
      reference: 'PG-CHECK-003',
      notes: 'Post-maintenance internal operational reinspection passed.'
    }, { actor: 'postgres_contract_test' });
    assert.equal(passedReinspection.tool.status, 'available');
    assert.equal(passedReinspection.tool.inspection.status, 'current');
    assert.equal(ledger.recommendSchedule(job.id, {}, { actor: 'postgres_contract_test', audit: false }).blockers
      .some(blocker => blocker.type === 'tool_inspection_readiness' && blocker.toolId === inspectionEquipment.id), false);
    const retainedInspectionEquipment = ledger.listTools({ limit: 500 }).find(tool => tool.id === inspectionEquipment.id);
    assert.equal(retainedInspectionEquipment.data.inspectionHistory.length, 3);
    assert.equal(retainedInspectionEquipment.data.maintenanceHistory.length, 1);
    ledger.releaseToolReservation(job.id, dispatchInspectionReservation.id, {
      reason: 'Hosted dispatch reinspection contract completed.'
    }, { actor: 'postgres_contract_test' });

    const equipment = ledger.upsertTool({
      name: `PostgreSQL site laser ${Date.now()}`,
      category: 'measurement',
      status: 'available',
      homeLocation: 'EU hosted depot',
      currentLocation: 'EU hosted depot'
    }, { actor: 'postgres_contract_test' });
    const reservation = ledger.reserveTool(job.id, {
      toolId: equipment.id,
      status: 'reserved',
      notes: 'Hosted equipment contract reservation.'
    }, { actor: 'postgres_contract_test' });
    assert.equal(reservation.status, 'reserved');
    const equipmentRetirement = ledger.requestToolRetirement(equipment.id, {
      reason: 'Verify active reservation protection on the hosted PostgreSQL ledger.'
    }, { actor: 'postgres_contract_test' });
    assert.equal(equipmentRetirement.approval.data.activeReservationCount, 1);
    assert.throws(() => ledger.resolveApproval(equipmentRetirement.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_approver',
      reason: 'Attempt before operational reservation release.'
    }), error => error.code === 'tool_retirement_active_reservations');
    assert.ok(ledger.listApprovals({ status: 'pending', limit: 100 })
      .some(approval => approval.id === equipmentRetirement.approval.id));
    const releasedEquipment = ledger.releaseToolReservation(job.id, reservation.id, {
      reason: 'Hosted reservation released before retirement.',
      actor: 'spoofed_actor'
    }, { actor: 'postgres_contract_test' });
    assert.equal(releasedEquipment.status, 'released');
    assert.equal(releasedEquipment.data.releasedBy, 'postgres_contract_test');
    ledger.resolveApproval(equipmentRetirement.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_approver',
      reason: 'Hosted equipment reservations are clear.'
    });
    const hostedEquipment = ledger.listTools({ status: 'retired', limit: 100 })
      .find(tool => tool.id === equipment.id);
    assert.equal(hostedEquipment.status, 'retired');
    assert.equal(hostedEquipment.activeReservationCount, 0);
    assert.equal(ledger.summarizeTools(ledger.listTools({ limit: 500 })).retired, 1);

    const retainedJob = ledger.getJobDetail(job.id, { includeAudit: false });
    const retainedStatus = retainedJob.status;
    const retainedPhase = retainedJob.phase;

    const archive = ledger.requestJobArchive(job.id, {
      reason: 'Verify reversible archive behavior against the hosted PostgreSQL ledger.'
    }, { actor: 'postgres_contract_test' });
    assert.equal(archive.approval.targetType, 'job_archive');
    assert.equal(archive.externalCommitments, 0);
    ledger.resolveApproval(archive.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_approver',
      reason: 'Hosted archive effects and retention safeguards were verified.'
    });
    const archivedJob = ledger.getJobDetail(job.id, { includeAudit: false });
    assert.equal(archivedJob.status, 'archived');
    assert.equal(archivedJob.data.archive.previousStatus, retainedStatus);
    assert.equal(archivedJob.data.archive.previousPhase, retainedPhase);

    const restore = ledger.requestJobRestore(job.id, {
      reason: 'Verify the hosted ledger restores the exact retained operating state.'
    }, { actor: 'postgres_contract_test' });
    assert.equal(restore.approval.targetType, 'job_restore');
    assert.equal(restore.externalCommitments, 0);
    ledger.resolveApproval(restore.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_approver',
      reason: 'Hosted restore state and archive history were verified.'
    });
    const restoredJob = ledger.getJobDetail(job.id, { includeAudit: false });
    assert.equal(restoredJob.status, retainedStatus);
    assert.equal(restoredJob.phase, retainedPhase);
    assert.deepEqual(restoredJob.data.archiveHistory.map(event => event.operation), ['archive', 'restore']);

    const schedulerKey = `postgres_contract_scheduler_${Date.now()}`;
    const firstClaim = ledger.claimScheduledJob(schedulerKey, {
      intervalSeconds: 60,
      leaseSeconds: 60,
      now: '2026-07-10T12:00:00.000Z'
    });
    assert.equal(firstClaim.claimed, true);
    const secondClaim = ledger.claimScheduledJob(schedulerKey, {
      intervalSeconds: 60,
      leaseSeconds: 60,
      now: '2026-07-10T12:00:01.000Z'
    });
    assert.equal(secondClaim.claimed, false);
    assert.equal(secondClaim.reason, 'lease_active');

    const completion = ledger.completeScheduledJob(schedulerKey, firstClaim.leaseId, {
      success: true,
      actionCount: 0
    }, { actor: 'postgres_contract_test', now: '2026-07-10T12:00:05.000Z' });
    assert.equal(completion.completed, true);

    const idempotencyKey = `postgres-idempotency-${Date.now()}`;
    const requestHash = `request-${Date.now()}`;
    const firstRequest = ledger.claimIdempotentRequest({
      keyHash: idempotencyKey,
      scope: 'POST /api/ledger/upload:postgres-contract',
      requestHash
    });
    assert.equal(firstRequest.claimed, true);
    assert.equal(ledger.completeIdempotentRequest(
      idempotencyKey,
      requestHash,
      200,
      { documentId: 'doc_postgres_proof' },
      firstRequest.leaseId
    ), true);
    const replayedRequest = ledger.claimIdempotentRequest({
      keyHash: idempotencyKey,
      scope: 'POST /api/ledger/upload:postgres-contract',
      requestHash
    });
    assert.equal(replayedRequest.replayed, true);
    assert.equal(replayedRequest.responseBody.documentId, 'doc_postgres_proof');
    const conflictingRequest = ledger.claimIdempotentRequest({
      keyHash: idempotencyKey,
      scope: 'POST /api/ledger/upload:postgres-contract',
      requestHash: 'different-request'
    });
    assert.equal(conflictingRequest.reason, 'request_conflict');

    const scheduleFirst = ledger.addTask(job.id, { title: 'PostgreSQL schedule first', durationHours: 4 });
    const scheduleSecond = ledger.addTask(job.id, { title: 'PostgreSQL schedule second', durationHours: 6 });
    const scheduleDependency = ledger.addTaskDependency(job.id, {
      predecessorTaskId: scheduleFirst.id,
      successorTaskId: scheduleSecond.id
    });
    const schedulePlan = ledger.calculateJobSchedule(job.id, { plannedStart: '2026-10-05T08:00:00.000Z' });
    assert.equal(schedulePlan.ready, true);
    assert.ok(schedulePlan.criticalPathTaskIds.includes(scheduleFirst.id));
    assert.ok(schedulePlan.criticalPathTaskIds.includes(scheduleSecond.id));
    const scheduleBaseline = ledger.requestScheduleBaseline(job.id, { plannedStart: '2026-10-05T08:00:00.000Z' });
    ledger.resolveApproval(scheduleBaseline.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_test',
      reason: 'PostgreSQL schedule contract verified.'
    });

    const detail = ledger.getJobDetail(job.id, { includeAudit: true });
    assert.equal(detail.id, job.id);
    assert.ok(detail.progress.some(entry => entry.note === 'PostgreSQL progress proof.'));
    assert.ok(detail.tasks.some(entry => entry.id === hostedTask.id && entry.status === 'completed'));
    assert.ok(detail.taskDependencies.some(entry => entry.id === scheduleDependency.id && entry.status === 'active'));
    assert.equal(detail.scheduleControl.activeBaseline.id, scheduleBaseline.baseline.id);
    assert.equal(detail.scheduleControl.baselineCurrent, true);
    const portfolioSchedule = ledger.listPortfolioSchedule({
      search: job.title,
      referenceAt: '2026-10-05T07:00:00.000Z',
      horizonDays: 14,
      limit: 10
    });
    assert.equal(portfolioSchedule.jobs.length, 1);
    assert.equal(portfolioSchedule.jobs[0].jobId, job.id);
    assert.equal(portfolioSchedule.jobs[0].baseline.id, scheduleBaseline.baseline.id);
    assert.equal(portfolioSchedule.jobs[0].flags.inWindow, true);
    assert.ok(portfolioSchedule.jobs[0].counts.criticalTasks >= 2);
    assert.ok(detail.audit.length > 0);
    const fullAudit = ledger.listAudit({ jobId: job.id, limit: 500 });
    assert.ok(fullAudit.some(entry => entry.action === 'transition_task'));
    assert.ok(fullAudit.some(entry => entry.actor === 'postgres_contract_test'));
    assert.ok(fullAudit.some(entry => entry.action === 'apply_job_archive'));
    assert.ok(fullAudit.some(entry => entry.action === 'apply_job_restore'));
    assert.ok(fullAudit.some(entry => entry.action === 'release_tool_reservation' && entry.actor === 'postgres_contract_test'));

    const opportunity = ledger.createOpportunity({
      title: 'PostgreSQL preconstruction contract',
      client: { name: 'PostgreSQL opportunity client' },
      stage: 'estimating',
      estimatedValue: 48000,
      probabilityPercent: 55,
      nextFollowUpAt: '2027-01-15T09:00:00.000Z'
    }, { actor: 'postgres_contract_test' });
    const opportunityActivity = ledger.createOpportunityActivity(opportunity.id, {
      type: 'follow_up',
      status: 'draft',
      summary: 'Retain hosted pipeline follow-up',
      idempotencyKey: 'postgres-opportunity-follow-up'
    }, { actor: 'postgres_contract_test' });
    assert.equal(opportunityActivity.replayed, false);
    assert.equal(opportunityActivity.activity.opportunityId, opportunity.id);
    const opportunityConversion = ledger.convertOpportunityToJob(opportunity.id, {}, { actor: 'postgres_contract_test' });
    assert.equal(opportunityConversion.replayed, false);
    assert.equal(opportunityConversion.opportunity.convertedJobId, opportunityConversion.job.id);
    const replayedOpportunityConversion = ledger.convertOpportunityToJob(opportunity.id, {}, { actor: 'postgres_contract_test' });
    assert.equal(replayedOpportunityConversion.replayed, true);
    assert.equal(replayedOpportunityConversion.job.id, opportunityConversion.job.id);
    assert.equal(ledger.listOpportunities({ includeClosed: true }).filter(record => record.id === opportunity.id).length, 1);
    assert.equal(ledger.listOpportunityActivities({ opportunityId: opportunity.id }).length, 1);
    assert.ok(ledger.opportunityForecast().summary.weightedValue >= 26400);

    const controlledP01 = ledger.createControlledDocumentRevision(job.id, {
      documentNumber: 'PG-A-101',
      revision: 'P01',
      title: 'PostgreSQL construction plan',
      discipline: 'architectural',
      sourceReference: 's3://postgres-contract/PG-A-101-P01.pdf'
    }, { actor: 'postgres_contract_test' });
    const controlledP01Review = ledger.transitionLifecycleRecord(job.id, 'document', controlledP01.document.id, {
      status: 'approved',
      verificationReference: 'postgres-check-P01',
      notes: 'Hosted source and drawing checks retained.'
    }, { actor: 'postgres_contract_test' });
    ledger.resolveApproval(controlledP01Review.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_test',
      reason: 'P01 hosted source and checker record verified.'
    });
    const controlledP02 = ledger.createControlledDocumentRevision(job.id, {
      documentNumber: 'PG-A-101',
      revision: 'P02',
      title: 'PostgreSQL construction plan',
      discipline: 'architectural',
      sourceReference: 's3://postgres-contract/PG-A-101-P02.pdf',
      revisionReason: 'Hosted coordination revision.'
    }, { actor: 'postgres_contract_test' });
    assert.equal(controlledP02.document.supersedesDocumentId, controlledP01.document.id);
    assert.throws(() => ledger.createControlledDocumentRevision(job.id, {
      documentNumber: 'PG-A-101',
      revision: 'P02',
      title: 'Duplicate hosted revision',
      sourceReference: 's3://postgres-contract/duplicate.pdf',
      revisionReason: 'Duplicate check.'
    }), /already exists/i);
    const controlledP02Review = ledger.transitionLifecycleRecord(job.id, 'document', controlledP02.document.id, {
      status: 'approved',
      verificationReference: 'postgres-check-P02',
      notes: 'Hosted revision and supersession checked.'
    }, { actor: 'postgres_contract_test' });
    ledger.resolveApproval(controlledP02Review.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_test',
      reason: 'P02 hosted source and supersession verified.'
    });
    const controlledDocuments = ledger.getJobDetail(job.id).documents.filter(document => document.documentNumber === 'PG-A-101');
    assert.equal(controlledDocuments.find(document => document.revision === 'P01').status, 'superseded');
    assert.equal(controlledDocuments.find(document => document.revision === 'P02').data.isCurrent, true);

    const currentControlledDocument = controlledDocuments.find(document => document.revision === 'P02');
    const drawingBytes = Buffer.from('%PDF-1.7\nPostgreSQL governed drawing\n%%EOF');
    const drawingSource = ledger.addDocument(job.id, {
      type: 'drawing_pdf',
      title: 'PostgreSQL drawing source',
      filename: 'PG-A-201-C01.pdf',
      mimeType: 'application/pdf',
      size: drawingBytes.length,
      storageRef: 's3://postgres-contract/PG-A-201-C01.pdf',
      status: 'stored',
      analysis: { upload: { sha256: crypto.createHash('sha256').update(drawingBytes).digest('hex'), signatureVerified: true } }
    }, { actor: 'postgres_contract_test' });
    const drawingRequest = ledger.createDrawingRevision(job.id, {
      entryKey: 'postgres-drawing-a201-c01',
      sheetNumber: 'PG-A-201',
      revision: 'C01',
      title: 'PostgreSQL first-floor construction plan',
      discipline: 'architecture',
      purpose: 'for_construction',
      issueDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      scale: '1:50',
      zone: 'First floor',
      sourceDocumentId: drawingSource.id,
      revisionReason: 'Initial PostgreSQL governed construction issue.',
      reviewNotes: 'Hosted title block and issue purpose checked.'
    }, { actor: 'postgres_contract_test' });
    ledger.resolveApproval(drawingRequest.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_test',
      reason: 'Hosted drawing PDF, title block, revision, and purpose verified.'
    });
    const currentDrawing = ledger.getDrawingRevision(drawingRequest.id);
    assert.equal(currentDrawing.status, 'current');
    assert.equal(currentDrawing.integrityValid, true);
    const hostedTransmittal = ledger.createDocumentTransmittal(job.id, {
      subject: 'PostgreSQL construction issue',
      purpose: 'for_construction',
      documentIds: [currentControlledDocument.id, currentDrawing.id],
      recipients: [{ name: 'Hosted site supervisor', email: 'site@example.test' }]
    }, { actor: 'postgres_contract_test' });
    ledger.resolveApproval(hostedTransmittal.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_test',
      reason: 'Hosted document snapshot and recipient register verified.'
    });
    const hostedIssuedTransmittal = ledger.recordDocumentTransmittalIssue(job.id, hostedTransmittal.transmittal.id, {
      deliveryReference: 'hosted-provider:message-001'
    }, { actor: 'postgres_contract_test' });
    assert.equal(hostedIssuedTransmittal.status, 'issued');
    assert.equal(hostedIssuedTransmittal.documents.some(document => document.id === currentDrawing.id && document.type === 'drawing_revision'), true);
    const hostedAcknowledgment = ledger.acknowledgeDocumentTransmittal(
      job.id,
      hostedIssuedTransmittal.id,
      hostedIssuedTransmittal.receipts[0].id,
      { evidenceReference: 'hosted-mail-receipt:001', acknowledgedBy: 'Hosted site supervisor' },
      { actor: 'postgres_contract_test' }
    );
    assert.equal(hostedAcknowledgment.transmittal.status, 'acknowledged');

    const hostedMeeting = ledger.createProjectMeeting(job.id, {
      title: 'PostgreSQL project coordination',
      meetingType: 'coordination',
      scheduledAt: '2026-07-15T09:00:00.000Z',
      attendees: [{ name: 'Hosted project manager' }, { name: 'Hosted site supervisor' }],
      agenda: ['Programme and retained design information'],
      minutesSummary: 'The hosted team reviewed programme constraints and retained one assigned action.',
      decisions: ['Continue with the approved controlled revision.'],
      actions: [{ title: 'Confirm hosted delivery slot', ownerName: 'Hosted site supervisor', dueAt: '2020-01-01' }]
    }, { actor: 'postgres_contract_test' });
    const hostedMeetingSubmission = ledger.submitProjectMeetingMinutes(job.id, hostedMeeting.id);
    ledger.resolveApproval(hostedMeetingSubmission.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_test',
      reason: 'Hosted meeting snapshot, attendance, decision, and action verified.'
    });
    const hostedMeetingApproved = ledger.getProjectMeeting(hostedMeeting.id);
    assert.equal(hostedMeetingApproved.status, 'approved');
    assert.ok(hostedMeetingApproved.actions[0].linkedTaskId);
    const hostedMeetingIssued = ledger.recordProjectMeetingIssue(job.id, hostedMeeting.id, {
      deliveryReference: 'hosted-provider:meeting-minutes-001'
    }, { actor: 'postgres_contract_test' });
    assert.equal(hostedMeetingIssued.status, 'issued');
    const hostedMeetingAction = ledger.completeProjectMeetingAction(job.id, hostedMeeting.id, hostedMeetingApproved.actions[0].id, {
      evidenceReference: 'hosted-evidence:delivery-slot',
      completedBy: 'Hosted site supervisor'
    }, { actor: 'postgres_contract_test' });
    assert.equal(hostedMeetingAction.action.status, 'completed');

    const hostedInspectionTemplate = ledger.createInspectionTemplate({
      name: 'PostgreSQL facade hold point',
      templateKey: 'postgres_facade_hold_point',
      inspectionType: 'quality_hold_point',
      discipline: 'quality',
      items: [
        { key: 'substrate', prompt: 'Hosted substrate tolerance is verified', failureSeverity: 'high' },
        { key: 'fixings', prompt: 'Hosted fixing pattern matches the drawing', failureSeverity: 'medium' }
      ]
    }, { actor: 'postgres_contract_test' });
    const hostedInspection = ledger.createInspectionFromTemplate(job.id, {
      templateId: hostedInspectionTemplate.id,
      title: 'PostgreSQL elevation inspection',
      entryKey: 'postgres-inspection-schedule-0001'
    }, { actor: 'postgres_contract_test' });
    const hostedInspectionSubmission = ledger.submitInspectionChecklist(job.id, hostedInspection.id, {
      entryKey: 'postgres-inspection-submit-0001',
      responses: hostedInspection.checklist.snapshot.items.map(item => ({ itemKey: item.key, result: 'pass' }))
    }, { actor: 'postgres_contract_test' });
    assert.equal(hostedInspectionSubmission.submission.integrityValid, true);
    assert.equal(hostedInspectionSubmission.submission.result, 'passed');
    ledger.resolveApproval(hostedInspectionSubmission.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_test',
      reason: 'Hosted inspection checklist snapshot and complete responses verified.'
    });
    const hostedInspectionApproved = ledger.getJobDetail(job.id).inspections.find(record => record.id === hostedInspection.id);
    assert.equal(hostedInspectionApproved.status, 'passed');
    assert.equal(hostedInspectionApproved.checklist.submissions[0].status, 'passed');

    const hostedForecastJob = ledger.createIntake({
      title: 'PostgreSQL cost forecast',
      client: { name: 'PostgreSQL Forecast Client' },
      status: 'in_progress',
      progressPercent: 50,
      contractValue: 3000,
      assignAutomatically: false
    }, { actor: 'postgres_contract_test' });
    const hostedForecastBudget = ledger.createBudgetLine(hostedForecastJob.id, {
      status: 'baseline',
      costCode: 'PG-COST-100',
      description: 'Hosted cost forecast baseline',
      budgetAmount: 1500,
      forecastAmount: 1400
    }, { actor: 'postgres_contract_test' });
    ledger.resolveApproval(hostedForecastBudget.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_test',
      reason: 'Hosted cost baseline verified.'
    });
    ledger.addTimeLog(hostedForecastJob.id, {
      workDate: '2026-07-16',
      hours: 5,
      rate: 50,
      costCode: 'PG-COST-100',
      notes: 'Hosted labor evidence.'
    }, { actor: 'postgres_contract_test' });
    const hostedForecast = ledger.calculateCostForecast(hostedForecastJob.id);
    assert.equal(hostedForecast.ready, true);
    assert.equal(hostedForecast.summary.actual, 250);
    assert.equal(hostedForecast.summary.forecast, 1400);
    const hostedForecastRequest = ledger.requestCostForecastSnapshot(hostedForecastJob.id, {}, { actor: 'postgres_contract_test' });
    assert.equal(hostedForecastRequest.snapshot.integrityValid, true);
    ledger.resolveApproval(hostedForecastRequest.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_contract_test',
      reason: 'Hosted source-linked cost forecast verified.'
    });
    assert.equal(ledger.calculateCostForecast(hostedForecastJob.id).snapshotCurrent, true);
    const hostedMaterial = ledger.addMaterialRequirement(hostedForecastJob.id, {
      name: 'Hosted acoustic panels', quantity: 12, unit: 'panels', status: 'needed'
    }, { actor: 'postgres_contract_test' });
    const hostedReceipt = ledger.createMaterialReceipt(hostedForecastJob.id, {
      receiptReference: `PG-RECEIPT-${Date.now()}`,
      evidenceReference: 'postgres:signed-delivery-ticket',
      deliveredAt: new Date(Date.now() - 60_000).toISOString(),
      receivedBy: 'PostgreSQL site receiver',
      entryKey: `pg-receipt-${Date.now()}`,
      lines: [{
        materialRequirementId: hostedMaterial.id,
        itemName: 'Hosted acoustic panels', unit: 'panels', receivedQuantity: 12, acceptedQuantity: 12, damagedQuantity: 0
      }]
    }, { actor: 'postgres_contract_test' });
    assert.equal(hostedReceipt.receipt.status, 'discrepancy');
    assert.equal(ledger.getJobDetail(hostedForecastJob.id).materials.find(item => item.id === hostedMaterial.id).status, 'available');
    assert.equal(ledger.listMaterialReceivingRegister().receipts.some(item => item.id === hostedReceipt.receipt.id), true);
    const custodyWorker = ledger.upsertWorker({
      name: `PostgreSQL equipment custodian ${Date.now()}`,
      role: 'Equipment operator',
      status: 'available'
    }, { actor: 'postgres_contract_test' });
    let custodyAssignment = ledger.addAssignment(hostedForecastJob.id, {
      workerId: custodyWorker.id,
      workerName: custodyWorker.name,
      role: custodyWorker.role,
      status: 'assigned'
    }, { actor: 'postgres_contract_test' });
    if (custodyAssignment.approval?.id) {
      ledger.resolveApproval(custodyAssignment.approval.id, {
        status: 'approved', resolvedBy: 'postgres_contract_test', reason: 'Hosted equipment custodian assignment verified.'
      });
      custodyAssignment = ledger.getJobDetail(hostedForecastJob.id).assignments.find(item => item.id === custodyAssignment.id);
    }
    const custodyTool = ledger.upsertTool({
      name: `PostgreSQL custody lift ${Date.now()}`,
      category: 'access',
      status: 'available',
      currentLocation: 'EU hosted depot'
    }, { actor: 'postgres_contract_test' });
    const custodyReservation = ledger.reserveTool(hostedForecastJob.id, {
      toolId: custodyTool.id,
      toolName: custodyTool.name,
      status: 'reserved',
      neededUntil: new Date(Date.now() + 86_400_000).toISOString()
    }, { actor: 'postgres_contract_test' });
    const custodyCheckout = ledger.checkoutEquipment(hostedForecastJob.id, {
      reservationId: custodyReservation.id,
      workerId: custodyWorker.id,
      checkedOutAt: new Date(Date.now() - 60_000).toISOString(),
      checkedOutBy: custodyWorker.name,
      condition: 'good',
      location: 'Hosted project gate',
      evidenceReference: 'postgres:equipment-handoff',
      entryKey: `postgres-equipment-checkout-${Date.now()}`
    }, { actor: 'postgres_contract_test' });
    const custodyReturn = ledger.returnEquipment(hostedForecastJob.id, custodyCheckout.custody.id, {
      returnedAt: new Date().toISOString(),
      returnedBy: custodyWorker.name,
      condition: 'unsafe',
      location: 'Hosted quarantine bay',
      evidenceReference: 'postgres:equipment-return-photo',
      entryKey: `postgres-equipment-return-${Date.now()}`,
      notes: 'Guard damage retained and equipment isolated for hosted review.'
    }, { actor: 'postgres_contract_test' });
    assert.equal(custodyReturn.custody.status, 'exception');
    assert.equal(ledger.listEquipmentCustodyRegister().exceptions.some(item => item.id === custodyReturn.custody.id), true);
    assert.equal(ledger.listTools({ limit: 500 }).find(item => item.id === custodyTool.id).status, 'maintenance');

    const dashboard = ledger.dashboardSummary();
    assert.ok(dashboard.metrics.jobs >= 1);
    assert.ok(dashboard.metrics.documentTransmittals >= 1);
    assert.ok(dashboard.metrics.projectMeetings >= 1);
    assert.ok(dashboard.metrics.approvedCostForecasts >= 1);
    assert.ok(dashboard.metrics.approvedEnvironmentalActivities >= 1);
    assert.ok(dashboard.metrics.approvedEnvironmentalReports >= 1);
    assert.ok(dashboard.metrics.environmentalKgCo2e >= 87.5);
    assert.ok(Array.isArray(dashboard.nextActions));
    assert.ok(Array.isArray(ledger.nextActions()));

    const migrations = ledger.migrationStatus();
    assert.equal(migrations.currentVersion, '049_contractor_balanced_scorecard');
    assert.equal(migrations.pending.length, 0);
    const operatorSession = {
      sessionIdHash: `postgres-session-${Date.now()}`,
      operatorId: 'postgres-office',
      role: 'office_operator',
      tokenFingerprint: 'postgres-token-fingerprint',
      issuedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    };
    assert.equal(ledger.createOperatorSession(operatorSession).operatorId, operatorSession.operatorId);
    assert.equal(ledger.getOperatorSession(operatorSession.sessionIdHash).role, 'office_operator');
    assert.equal(ledger.revokeOperatorSession(operatorSession.sessionIdHash, { reason: 'contract_test' }), true);
    assert.equal(ledger.getOperatorSession(operatorSession.sessionIdHash), null);
    const remainingRealColumns = ledger.db.prepare(`
      SELECT COUNT(*) AS count
      FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'real'
    `).get();
    assert.equal(Number(remainingRealColumns.count), 0);
    const progressType = ledger.db.prepare(`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'progress_updates' AND column_name = 'progress_percent'
    `).get();
    assert.equal(progressType.data_type, 'double precision');
  } finally {
    ledger.close();
  }
});

test('PostgreSQL startup lock serializes fresh concurrent replicas and releases after failure', { skip: !connectionString }, async () => {
  const failureLockKey = 2026071399;
  const database = new PostgresSyncDatabase({ connectionString });
  assert.throws(
    () => database.withAdvisoryLock(failureLockKey, () => {
      throw new Error('forced startup callback failure');
    }),
    /forced startup callback failure/
  );
  database.close();

  const lockProbe = new PostgresSyncDatabase({ connectionString });
  try {
    const claimedAfterFailure = lockProbe.query('SELECT pg_try_advisory_lock(?) AS locked', [failureLockKey]).rows[0]?.locked;
    assert.equal(claimedAfterFailure, true);
    assert.equal(lockProbe.query('SELECT pg_advisory_unlock(?) AS unlocked', [failureLockKey]).rows[0]?.unlocked, true);
    lockProbe.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    lockProbe.close();
  }

  const root = path.join(__dirname, '..');
  const startupScript = `
    const { ContractorOperatingLedger } = require('./operating-ledger');
    const ledger = new ContractorOperatingLedger({ databaseUrl: process.env.CONTRACTOR_AI_POSTGRES_TEST_URL });
    const status = ledger.migrationStatus();
    ledger.close();
    process.stdout.write(String(status.currentVersion || ''));
  `;
  const startReplica = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', startupScript], {
      cwd: root,
      env: { ...process.env, CONTRACTOR_AI_POSTGRES_TEST_URL: connectionString },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => {
      if (code !== 0) {
        reject(new Error(`Concurrent PostgreSQL startup exited ${code}: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });

  const versions = await Promise.all(Array.from({ length: 4 }, () => startReplica()));
  assert.deepEqual(versions, Array(4).fill('049_contractor_balanced_scorecard'));

  const verification = new PostgresSyncDatabase({ connectionString });
  try {
    const migrationCount = verification.query('SELECT COUNT(*) AS count FROM ledger_schema_migrations').rows[0];
    assert.equal(Number(migrationCount.count), 49);
    const availabilityTableCount = verification.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'worker_availability_periods'
    `).rows[0];
    assert.equal(Number(availabilityTableCount.count), 1);
    const materialReceivingTableCount = verification.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('material_receipts', 'material_receipt_lines')
    `).rows[0];
    assert.equal(Number(materialReceivingTableCount.count), 2);
    const equipmentCustodyTableCount = verification.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'equipment_custody_sessions'
    `).rows[0];
    assert.equal(Number(equipmentCustodyTableCount.count), 1);
    const equipmentCustodyIndexCount = verification.query(`
      SELECT COUNT(*) AS count
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_equipment_custody_active_tool',
          'idx_equipment_custody_job_status',
          'idx_equipment_custody_worker_status',
          'idx_equipment_custody_due',
          'idx_equipment_custody_reservation'
        )
    `).rows[0];
    assert.equal(Number(equipmentCustodyIndexCount.count), 5);
    const opportunityTableCount = verification.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('opportunities', 'opportunity_activities')
    `).rows[0];
    assert.equal(Number(opportunityTableCount.count), 2);
    const inspectionChecklistTableCount = verification.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('inspection_templates', 'inspection_checklist_submissions')
    `).rows[0];
    assert.equal(Number(inspectionChecklistTableCount.count), 2);
    const inspectionChecklistIndexCount = verification.query(`
      SELECT COUNT(*) AS count
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_inspection_templates_current',
          'idx_inspection_checklist_inspection',
          'idx_inspection_checklist_job',
          'idx_inspection_checklist_approval'
        )
    `).rows[0];
    assert.equal(Number(inspectionChecklistIndexCount.count), 4);
    const takeoffTableCount = verification.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('takeoff_sheets', 'takeoff_items')
    `).rows[0];
    assert.equal(Number(takeoffTableCount.count), 2);
    const tableCount = verification.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `).rows[0];
    assert.ok(Number(tableCount.count) > 50);
    const startupLockAvailable = verification.query('SELECT pg_try_advisory_lock(?) AS locked', [2026071302]).rows[0]?.locked;
    assert.equal(startupLockAvailable, true);
    assert.equal(verification.query('SELECT pg_advisory_unlock(?) AS unlocked', [2026071302]).rows[0]?.unlocked, true);
  } finally {
    verification.close();
  }
});

test('PostgreSQL authentication limiter atomically coordinates concurrent replicas', { skip: !connectionString }, async () => {
  const keyHash = 'a'.repeat(64);
  const now = '2026-07-13T10:00:00.000Z';
  const ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  ledger.clearAuthenticationRateLimit(keyHash);
  ledger.close();

  const replicas = Array.from({ length: 4 }, () => startSynchronizedAuthenticationFailure({
    root: path.join(__dirname, '..'),
    keyHash,
    now
  }));
  await Promise.all(replicas.map(replica => replica.ready));
  for (const replica of replicas) replica.child.stdin.end('record\n');
  const results = await Promise.all(replicas.map(replica => replica.result));
  assert.deepEqual(results.map(result => result.attemptCount).sort((left, right) => left - right), [1, 2, 3, 4]);

  const verification = new ContractorOperatingLedger({ databaseUrl: connectionString });
  try {
    const state = verification.getAuthenticationRateLimit(keyHash, { limit: 10, windowMs: 900_000, now });
    assert.equal(state.attemptCount, 4);
    assert.equal(state.remaining, 6);
  } finally {
    verification.clearAuthenticationRateLimit(keyHash);
    verification.close();
  }
});

test('PostgreSQL API limiter atomically coordinates concurrent replicas', { skip: !connectionString }, async () => {
  const keyHash = 'b'.repeat(64);
  const now = '2026-07-13T10:15:00.000Z';
  const ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  ledger.clearApiRateLimits();
  ledger.close();

  const replicas = Array.from({ length: 4 }, () => startSynchronizedApiRateRequest({
    root: path.join(__dirname, '..'),
    keyHash,
    now
  }));
  await Promise.all(replicas.map(replica => replica.ready));
  for (const replica of replicas) replica.child.stdin.end('record\n');
  const results = await Promise.all(replicas.map(replica => replica.result));
  assert.deepEqual(results.map(result => result.requestCount).sort((left, right) => left - right), [1, 2, 3, 4]);

  const verification = new ContractorOperatingLedger({ databaseUrl: connectionString });
  try {
    const row = verification.db.prepare('SELECT request_count FROM api_rate_limits WHERE key_hash = ?').get(keyHash);
    assert.equal(Number(row.request_count), 4);
  } finally {
    verification.clearApiRateLimits();
    verification.close();
  }
});

test('PostgreSQL audit chain atomically initializes and serializes concurrent replica appends', { skip: !connectionString }, async () => {
  const reset = new ContractorOperatingLedger({ databaseUrl: connectionString });
  reset.transaction(() => {
    reset.db.prepare('DELETE FROM audit_chain_state').run();
    reset.db.prepare('DELETE FROM audit_events').run();
  });
  reset.close();

  const baseline = new ContractorOperatingLedger({ databaseUrl: connectionString });
  const before = baseline.verifyAuditIntegrity();
  assert.equal(before.valid, true);
  assert.equal(before.eventCount, 0);
  baseline.close();

  const runId = `postgres-audit-${Date.now()}`;
  const replicas = Array.from({ length: 8 }, (_, index) => startSynchronizedAuditAppend({
    root: path.join(__dirname, '..'),
    entityId: `${runId}-${index}`
  }));
  await Promise.all(replicas.map(replica => replica.ready));
  for (const replica of replicas) replica.child.stdin.end('append\n');
  const results = await Promise.all(replicas.map(replica => replica.result));
  assert.deepEqual(
    results.map(result => result.sequenceNumber).sort((left, right) => left - right),
    Array.from({ length: 8 }, (_, index) => before.eventCount + index + 1)
  );
  assert.equal(new Set(results.map(result => result.eventHash)).size, 8);

  const verification = new ContractorOperatingLedger({ databaseUrl: connectionString });
  try {
    const after = verification.verifyAuditIntegrity();
    assert.equal(after.valid, true);
    assert.equal(after.eventCount, before.eventCount + 8);
  } finally {
    verification.close();
  }
});

test('PostgreSQL commercial acceptance preserves net contract accounting parity', { skip: !connectionString }, () => {
  const ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  try {
    const marker = Date.now();
    const job = ledger.createIntake({
      clientName: `Postgres Commercial ${marker}`,
      client: { name: `Postgres Commercial ${marker}`, email: `postgres-client-${marker}@example.test` },
      title: `Postgres commercial contract ${marker}`,
      service: 'commercial_contract',
      estimatedCost: 400,
      contractValue: 400,
      lineItems: [{ description: 'Initial allowance', quantity: 1, unitPrice: 400 }],
      assignAutomatically: false
    }, { actor: 'postgres_commercial_test' });
    const quote = ledger.createQuote(job.id, {
      taxRate: 21,
      subtotal: 9999,
      lineItems: [{ description: 'Accepted scope', quantity: 2, unitPrice: 500 }]
    }, { actor: 'postgres_commercial_test' });
    assert.equal(quote.subtotal, 1000);
    assert.equal(quote.total, 1210);
    ledger.resolveApproval(quote.approvalId, { status: 'approved', resolvedBy: 'postgres_approver' });
    assert.equal(ledger.getJobDetail(job.id).contractValue, 400);
    const organization = ledger.updateOrganizationProfile({
      legalName: `Postgres Contractor ${marker} B.V.`,
      registrationNumber: String(marker).slice(-8),
      vatNumber: `NL${String(marker).slice(-9)}B01`,
      email: `postgres-${marker}@example.test`,
      address: 'Hosted ledger street 14',
      postalCode: '1012 AB',
      city: 'Amsterdam',
      country: 'NL',
      iban: 'NL91ABNA0417164300',
      bic: 'ABNANL2A',
      defaultPaymentTermsDays: 30,
      defaultQuoteValidityDays: 30
    }, { actor: 'postgres_commercial_test' });
    assert.equal(organization.readiness.ready, true);
    const issuePackage = ledger.prepareQuoteIssuePackage(job.id, quote.id, { actor: 'postgres_commercial_test' });
    assert.equal(issuePackage.document.type, 'quote_issue_package');
    assert.equal(issuePackage.communication.status, 'draft');
    assert.equal(issuePackage.externalCommitments, 0);
    assert.equal(ledger.prepareQuoteIssuePackage(job.id, quote.id).replayed, true);
    assert.match(ledger.getQuoteIssuePackage(issuePackage.document.id, { audit: false }).html, new RegExp(issuePackage.packageHash));
    assert.equal(ledger.getJobDetail(job.id).contractValue, 400);
    const quoteAcceptance = ledger.requestQuoteAcceptance(job.id, quote.id, {
      acceptedAt: '2026-07-14T12:00:00.000Z',
      evidenceReference: `postgres-quote-proof-${marker}`
    }, { actor: 'postgres_commercial_test' });
    ledger.resolveApproval(quoteAcceptance.approval.id, { status: 'approved', resolvedBy: 'postgres_approver' });
    assert.equal(ledger.getJobDetail(job.id).contractValue, 1000);

    const changeOrder = ledger.createChangeOrder(job.id, {
      quoteId: quote.id,
      title: 'Postgres added scope',
      scopeDelta: 'Retain one additional approved work package.',
      status: 'submitted',
      requiresApproval: true,
      taxRate: 21,
      lineItems: [{ description: 'Additional package', quantity: 1, unitPrice: 125 }]
    }, { actor: 'postgres_commercial_test' });
    ledger.resolveApproval(changeOrder.approvalId, { status: 'approved', resolvedBy: 'postgres_approver' });
    assert.equal(ledger.getJobDetail(job.id).contractValue, 1000);
    const changePackage = ledger.prepareChangeOrderIssuePackage(job.id, changeOrder.id, {}, { actor: 'postgres_commercial_test' });
    ledger.resolveApproval(changePackage.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_approver',
      reason: 'Client recipient and exact change-order package verified.'
    });
    ledger.recordCommunicationDelivery(changePackage.communication.id, {
      integration: 'postgres_test_provider',
      providerMessageId: `postgres-change-message-${marker}`
    }, { actor: 'postgres_verified_integration' });
    const changeAcceptance = ledger.requestChangeOrderAcceptance(job.id, changeOrder.id, {
      acceptedAt: '2026-07-14T13:00:00.000Z',
      evidenceReference: `postgres-change-proof-${marker}`
    }, { actor: 'postgres_commercial_test' });
    ledger.resolveApproval(changeAcceptance.approval.id, { status: 'approved', resolvedBy: 'postgres_approver' });
    const detail = ledger.getJobDetail(job.id, { includeAudit: true });
    assert.equal(detail.contractValue, 1125);
    assert.equal(detail.quotes.find(item => item.id === quote.id).status, 'accepted');
    assert.equal(detail.changeOrders.find(item => item.id === changeOrder.id).status, 'accepted');
    assert.ok(detail.audit.some(event => event.action === 'accept_change_order_contract'));

    const invoice = ledger.createInvoice(job.id, {
      amount: 1125,
      taxRate: 21,
      dueAt: '2026-08-14T12:00:00.000Z',
      structuredExportRequested: true,
      buyerReference: `PG-${marker}`,
      buyerLegalName: `Postgres Buyer ${marker} B.V.`,
      buyerRegistrationNumber: String(marker).slice(-8),
      buyerEndpointScheme: '0106',
      buyerEndpointId: String(marker).slice(-8),
      buyerAddress: 'Buyer contract street 21',
      buyerPostalCode: '3011 AA',
      buyerCity: 'Rotterdam',
      buyerCountry: 'NL'
    }, { actor: 'postgres_commercial_test' });
    assert.equal(invoice.total, 1361.25);
    assert.equal(invoice.data.structuredReadiness.ready, true);
    ledger.resolveApproval(invoice.approvalId, { status: 'approved', resolvedBy: 'postgres_approver' });
    const invoicePackage = ledger.prepareInvoiceIssuePackage(job.id, invoice.id, { actor: 'postgres_commercial_test' });
    assert.match(invoicePackage.issueReference, /^INV-\d{4}-\d{6}$/);
    assert.equal(invoicePackage.documents.length, 2);
    assert.equal(invoicePackage.communication.status, 'draft');
    assert.equal(invoicePackage.externalCommitments, 0);
    assert.equal(ledger.prepareInvoiceIssuePackage(job.id, invoice.id).replayed, true);
    const retainedFormats = invoicePackage.documents.map(document => (
      ledger.getInvoiceIssueDocument(document.id, { audit: false }).document.data.format
    ));
    assert.deepEqual(retainedFormats.sort(), ['html', 'ubl_2_1']);
    const partialReceipt = ledger.recordPayment(job.id, {
      invoiceId: invoice.id,
      status: 'received',
      amount: 500,
      method: 'bank_transfer',
      reference: `PG-BANK-500-${marker}`,
      notes: 'PostgreSQL partial receipt contract proof.'
    }, { actor: 'postgres_commercial_test' });
    assert.equal(partialReceipt.status, 'pending_confirmation');
    assert.throws(
      () => ledger.recordPayment(job.id, {
        invoiceId: invoice.id,
        status: 'received',
        amount: 100,
        reference: ` pg-bank-500-${marker} `
      }),
      error => error.code === 'duplicate_payment_reference' && error.statusCode === 409
    );
    assert.throws(
      () => ledger.recordPayment(job.id, {
        invoiceId: invoice.id,
        status: 'received',
        amount: 862,
        reference: `PG-BANK-OVER-${marker}`
      }),
      error => error.code === 'payment_exceeds_invoice_balance' && error.details.availableAmount === 861.25
    );
    ledger.resolveApproval(partialReceipt.approvalId, { status: 'approved', resolvedBy: 'postgres_approver' });
    let reconciledInvoice = ledger.getJobDetail(job.id, { includeAudit: false }).invoices.find(item => item.id === invoice.id);
    assert.equal(reconciledInvoice.status, 'partially_paid');
    assert.equal(reconciledInvoice.data.reconciliation.outstandingAmount, 861.25);
    const finalWriteOff = ledger.recordPayment(job.id, {
      invoiceId: invoice.id,
      status: 'written_off',
      amount: 861.25,
      reference: `PG-WRITE-OFF-${marker}`,
      notes: 'PostgreSQL retained write-off authority proof.'
    }, { actor: 'postgres_commercial_test' });
    ledger.resolveApproval(finalWriteOff.approvalId, { status: 'approved', resolvedBy: 'postgres_approver' });
    reconciledInvoice = ledger.getJobDetail(job.id, { includeAudit: false }).invoices.find(item => item.id === invoice.id);
    assert.equal(reconciledInvoice.status, 'settled');
    assert.equal(reconciledInvoice.data.reconciliation.receivedAmount, 500);
    assert.equal(reconciledInvoice.data.reconciliation.writtenOffAmount, 861.25);
    assert.equal(reconciledInvoice.data.reconciliation.outstandingAmount, 0);

    const creditJob = ledger.createIntake({
      client: {
        name: `Postgres Credit Buyer ${marker}`,
        company: `Postgres Credit Buyer ${marker} B.V.`,
        email: `postgres-credit-${marker}@example.test`,
        address: 'Credit buyer street 18',
        city: 'Rotterdam',
        country: 'NL'
      },
      title: `Postgres credit-note parity ${marker}`,
      status: 'completed',
      progressPercent: 100,
      contractValue: 1000,
      assignAutomatically: false
    }, { actor: 'postgres_commercial_test' });
    const creditInvoice = ledger.createInvoice(creditJob.id, {
      amount: 1000,
      taxRate: 21,
      dueAt: '2026-08-14T12:00:00.000Z',
      structuredExportRequested: true,
      buyerReference: `PG-CREDIT-${marker}`,
      buyerLegalName: `Postgres Credit Buyer ${marker} B.V.`,
      buyerRegistrationNumber: String(marker).slice(-8),
      buyerEndpointScheme: '0106',
      buyerEndpointId: String(marker).slice(-8),
      buyerAddress: 'Credit buyer street 18',
      buyerPostalCode: '3011 AA',
      buyerCity: 'Rotterdam',
      buyerCountry: 'NL'
    }, { actor: 'postgres_commercial_test' });
    ledger.resolveApproval(creditInvoice.approvalId, { status: 'approved', resolvedBy: 'postgres_approver' });
    const creditInvoicePackage = ledger.prepareInvoiceIssuePackage(creditJob.id, creditInvoice.id, { actor: 'postgres_commercial_test' });
    const creditNote = ledger.createCreditNote(creditJob.id, creditInvoice.id, {
      amount: 200,
      taxRate: 21,
      reason: 'PostgreSQL credit-note contract parity correction.',
      structuredExportRequested: true
    }, { actor: 'postgres_commercial_test' });
    assert.equal(creditNote.total, 242);
    assert.equal(ledger.getInvoiceReconciliation(creditInvoice.id).pendingCreditAmount, 242);
    ledger.resolveApproval(creditNote.approvalId, { status: 'approved', resolvedBy: 'postgres_approver' });
    const creditPackage = ledger.prepareCreditNoteIssuePackage(creditJob.id, creditNote.id, { actor: 'postgres_commercial_test' });
    assert.match(creditPackage.issueReference, /^CRN-\d{4}-\d{6}$/);
    assert.deepEqual(creditPackage.documents.map(document => document.type), ['credit_note_issue_package', 'credit_note_ubl_package']);
    assert.equal(creditPackage.reconciliation.creditedAmount, 242);
    assert.equal(creditPackage.reconciliation.outstandingAmount, 968);
    assert.equal(creditPackage.reconciliation.status, 'partially_settled');
    assert.equal(ledger.prepareCreditNoteIssuePackage(creditJob.id, creditNote.id).replayed, true);
    const creditUbl = ledger.getCreditNoteIssueDocument(creditPackage.ublDocument.id, { audit: false }).content;
    assert.match(creditUbl, /<cbc:CreditNoteTypeCode>381<\/cbc:CreditNoteTypeCode>/);
    assert.match(creditUbl, new RegExp(`<cac:InvoiceDocumentReference><cbc:ID>${creditInvoicePackage.issueReference}<\\/cbc:ID>`));
    const creditDetail = ledger.getJobDetail(creditJob.id, { includeAudit: false });
    assert.equal(creditDetail.creditNotes[0].status, 'prepared');
    assert.equal(creditDetail.invoices[0].status, 'partially_settled');
    const handoverJob = ledger.createIntake({
      title: `PostgreSQL handover ${marker}`,
      client: { name: 'PostgreSQL handover client', email: 'handover@example.test' },
      address: 'Hosted handover street 8',
      city: 'Utrecht',
      status: 'completed',
      progressPercent: 100,
      assignAutomatically: false
    }, { actor: 'postgres_commercial_test' });
    ledger.createFieldReport(handoverJob.id, {
      status: 'draft',
      reportDate: '2026-07-15',
      workCompleted: 'PostgreSQL handover evidence retained.'
    }, { actor: 'postgres_commercial_test' });
    const handoverQuality = ledger.addQualityCheck(handoverJob.id, {
      title: 'PostgreSQL final handover quality',
      status: 'approved',
      result: 'passed',
      defects: [],
      defectsOpen: 0,
      notes: 'No open defects remain.'
    }, { actor: 'postgres_commercial_test' });
    ledger.resolveApproval(handoverQuality.approval.id, { status: 'approved', resolvedBy: 'postgres_approver' });
    const handoverPackage = ledger.prepareHandoverIssuePackage(handoverJob.id, {}, { actor: 'postgres_commercial_test' });
    assert.equal(handoverPackage.document.type, 'handover_issue_package');
    assert.equal(handoverPackage.externalCommitments, 0);
    assert.equal(ledger.prepareHandoverIssuePackage(handoverJob.id).replayed, true);
    assert.equal(ledger.assessHandoverReadiness(handoverJob.id).currentPackageId, handoverPackage.document.id);
    assert.match(ledger.getHandoverIssuePackage(handoverPackage.document.id, { audit: false }).content, /PostgreSQL handover/);
    assert.equal(ledger.verifyAuditIntegrity().valid, true);
  } finally {
    ledger.close();
  }
});

test('PostgreSQL bid packages preserve comparison and approval parity', { skip: !connectionString }, () => {
  const ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  try {
    const key = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const organization = ledger.updateOrganizationProfile({
      legalName: `PostgreSQL Order Contractor ${key} B.V.`,
      tradingName: 'PostgreSQL Order Contractor',
      registrationNumber: String(Date.now()).slice(-8),
      vatNumber: `NL${String(Date.now()).slice(-9)}B01`,
      email: `postgres-orders-${key}@example.test`,
      phone: '+31 20 555 12 34',
      address: 'Hosted order street 14',
      postalCode: '1012 AB',
      city: 'Amsterdam',
      country: 'NL',
      iban: 'NL91ABNA0417164300',
      bic: 'ABNANL2A',
      defaultPaymentTermsDays: 30,
      defaultQuoteValidityDays: 30
    }, { actor: 'postgres_bid_test' });
    assert.equal(organization.readiness.ready, true);
    const partner = ledger.upsertTradePartner({
      name: `PostgreSQL tender partner ${key}`,
      partnerType: 'supplier',
      contactName: 'Hosted order desk',
      email: `postgres-supplier-${key}@example.test`,
      phone: '+31 10 555 12 34',
      address: 'Hosted supplier street 8',
      city: 'Rotterdam',
      country: 'NL',
      registrationNumber: `PG-${key}`,
      vatNumber: 'NL123456789B01',
      verificationReference: `PG-BID-VERIFY-${key}`,
      verifiedAt: new Date(Date.now() - 86_400_000).toISOString(),
      data: { postalCode: '3011 AA' }
    }, { actor: 'postgres_bid_test' });
    const opportunity = ledger.createOpportunity({
      clientName: `PostgreSQL tender client ${key}`,
      title: `PostgreSQL tender ${key}`,
      stage: 'estimating'
    }, { actor: 'postgres_bid_test' });
    const bidPackage = ledger.createBidPackage(opportunity.id, {
      title: `Hosted bid package ${key}`,
      trade: 'Mechanical',
      scope: 'Retain and compare the complete hosted mechanical tender return.',
      dueAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      tradePartnerIds: [partner.id]
    }, { actor: 'postgres_bid_test' });
    const returned = ledger.recordBidReturn(bidPackage.id, bidPackage.participants[0].id, {
      amount: 125000.55,
      evidenceReference: `PG-BID-RETURN-${key}`,
      durationDays: 60
    }, { actor: 'postgres_bid_test' });
    assert.equal(returned.participant.total, 151250.67);
    const selection = ledger.requestBidPackageSelection(bidPackage.id, returned.participant.id, {
      rationale: 'Hosted comparison and current trade-partner evidence verified.'
    }, { actor: 'postgres_bid_test' });
    ledger.resolveApproval(selection.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_bid_approver',
      reason: 'Hosted bid comparison and compliance snapshot reviewed.'
    });
    const selected = ledger.getBidPackage(bidPackage.id);
    assert.equal(selected.status, 'selected');
    assert.equal(selected.selectedParticipant.id, returned.participant.id);
    assert.equal(selected.data.spendAuthorized, false);
    const converted = ledger.convertOpportunityToJob(opportunity.id, {}, { actor: 'postgres_bid_test' });
    const commitment = ledger.createBidPackageCommitment(bidPackage.id, {
      requiredBy: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      costCode: 'PG-SUB-410',
      notes: 'Hosted selected return retained as the exact internal purchasing envelope.'
    }, { actor: 'postgres_bid_test' });
    assert.equal(commitment.bidPackage.commitment.integrityValid, true);
    assert.equal(commitment.purchaseOrder.status, 'pending_approval');
    ledger.resolveApproval(commitment.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_bid_approver',
      reason: 'Hosted commitment source, amount, terms, and partner compliance verified.'
    });
    const committed = ledger.getBidPackage(bidPackage.id);
    assert.equal(committed.jobId, converted.job.id);
    assert.equal(committed.commitment.status, 'ready_to_order');
    assert.equal(committed.commitment.integrityValid, true);
    assert.equal(committed.commitment.spendAuthorized, true);
    assert.equal(committed.commitment.awardIssued, false);
    assert.equal(committed.commitment.externalCommitments, 0);
    assert.equal(committed.commitment.purchaseOrder.data.source.commitmentHash, committed.commitmentHash);
    const orderPackage = ledger.preparePurchaseOrderIssuePackage(
      converted.job.id,
      commitment.purchaseOrder.id,
      {},
      { actor: 'postgres_bid_test' }
    );
    assert.match(orderPackage.issueReference, /^PO-\d{4}-\d{6}$/);
    assert.equal(orderPackage.documents.length, 2);
    assert.equal(orderPackage.purchaseOrder.orderIssued, false);
    assert.equal(orderPackage.externalCommitments, 0);
    assert.equal(ledger.preparePurchaseOrderIssuePackage(converted.job.id, commitment.purchaseOrder.id).replayed, true);
    const orderUbl = ledger.getPurchaseOrderIssueDocument(orderPackage.ublDocument.id, { audit: false });
    assert.match(orderUbl.content, /urn:oasis:names:specification:ubl:schema:xsd:Order-2/);
    ledger.resolveApproval(orderPackage.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_bid_approver',
      reason: 'Hosted order recipient and both frozen package formats verified.'
    });
    ledger.recordCommunicationDelivery(orderPackage.communication.id, {
      integration: 'postgres_verified_order_provider',
      providerMessageId: `postgres-order-${key}`
    }, { actor: 'postgres_verified_integration' });
    const issued = ledger.getBidPackage(bidPackage.id);
    assert.equal(issued.commitment.status, 'ordered');
    assert.equal(issued.commitment.orderIssued, true);
    assert.equal(issued.commitment.awardIssued, true);
    assert.equal(issued.commitment.externalCommitments, 1);
    assert.equal(issued.commitment.issuePackage.transportStatus, 'delivered_by_verified_integration');
    assert.equal(ledger.getJobDetail(converted.job.id).purchaseOrders[0].id, commitment.purchaseOrder.id);
    assert.equal(ledger.migrationStatus().currentVersion, '049_contractor_balanced_scorecard');
    assert.equal(ledger.verifyAuditIntegrity().valid, true);
  } finally {
    ledger.close();
  }
});

test('PostgreSQL audit history preserves cursor, filter, facet, and chain parity', { skip: !connectionString }, () => {
  const ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  const runId = `postgres-history-${Date.now()}`;
  const actor = `owner:${runId}`;
  try {
    for (let index = 1; index <= 5; index += 1) {
      ledger.audit({
        entityType: index % 2 ? 'job' : 'approval',
        entityId: `${runId}-${index}`,
        jobId: `${runId}-job`,
        action: index % 2 ? 'inspect_history_job' : 'inspect_history_approval',
        actor,
        createdAt: `2026-07-${String(10 + index).padStart(2, '0')}T10:00:00.000Z`,
        after: { retained: index }
      });
    }

    const first = ledger.listAuditPage({ actor, limit: 2, includeFacets: true });
    assert.equal(first.events.length, 2);
    assert.equal(first.page.hasMore, true);
    assert.ok(first.events[0].sequenceNumber > first.events[1].sequenceNumber);
    assert.ok(first.facets.actors.some(facet => facet.value === actor && facet.count === 5));

    const second = ledger.listAuditPage({ actor, limit: 2, beforeSequence: first.page.nextBeforeSequence });
    const third = ledger.listAuditPage({ actor, limit: 2, beforeSequence: second.page.nextBeforeSequence });
    const retained = [...first.events, ...second.events, ...third.events];
    assert.equal(retained.length, 5);
    assert.equal(new Set(retained.map(event => event.id)).size, 5);
    assert.equal(third.page.hasMore, false);

    const filtered = ledger.listAuditPage({
      actor,
      entityType: 'approval',
      query: runId,
      from: '2026-07-12',
      until: '2026-07-14',
      limit: 10
    });
    assert.deepEqual(filtered.events.map(event => event.after.retained), [4, 2]);
    assert.ok(filtered.events.every(event => event.eventHash && event.previousHash));
    assert.equal(ledger.verifyAuditIntegrity().valid, true);
  } finally {
    ledger.close();
  }
});

test('PostgreSQL scheduler lease has one owner across concurrent replicas', { skip: !connectionString }, async () => {
  const schedulerKey = `postgres_concurrent_scheduler_${Date.now()}`;
  const expiredLeaseTime = '2026-07-10T14:00:00.000Z';
  const claimTime = '2026-07-10T14:00:11.000Z';
  const seedLedger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  try {
    const seed = seedLedger.claimScheduledJob(schedulerKey, {
      intervalSeconds: 30,
      leaseSeconds: 10,
      now: expiredLeaseTime
    });
    assert.equal(seed.claimed, true);
  } finally {
    seedLedger.close();
  }

  const root = path.join(__dirname, '..');
  const claimants = Array.from({ length: 8 }, () => startSynchronizedSchedulerClaimant({
    root,
    schedulerKey,
    now: claimTime
  }));
  try {
    await Promise.all(claimants.map(claimant => claimant.ready));
    for (const claimant of claimants) claimant.child.stdin.end('claim\n');
    const claims = await Promise.all(claimants.map(claimant => claimant.result));
    const winners = claims.filter(claim => claim.claimed);
    assert.equal(winners.length, 1);
    assert.ok(claims.filter(claim => !claim.claimed).every(claim => claim.reason === 'lease_active'));

    const verificationLedger = new ContractorOperatingLedger({ databaseUrl: connectionString });
    try {
      const retained = verificationLedger.getScheduledJob(schedulerKey);
      assert.equal(retained.status, 'running');
      assert.equal(retained.runCount, 2);
      assert.equal(retained.leaseId, winners[0].leaseId);
      const completion = verificationLedger.completeScheduledJob(schedulerKey, winners[0].leaseId, {
        success: true,
        actionCount: 0
      }, { actor: 'postgres_concurrency_test', now: '2026-07-10T14:00:12.000Z' });
      assert.equal(completion.completed, true);
    } finally {
      verificationLedger.close();
    }
  } finally {
    for (const claimant of claimants) {
      if (!claimant.child.killed && claimant.child.exitCode === null) claimant.child.kill();
    }
  }
});

test('PostgreSQL idempotency receipt has one owner after concurrent lease reclaim', { skip: !connectionString }, async () => {
  const keyHash = `postgres_concurrent_idempotency_${Date.now()}`;
  const scope = 'POST /api/ledger/upload:postgres-concurrency';
  const requestHash = `postgres_concurrent_payload_${Date.now()}`;
  const seedLedger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  let seed;
  try {
    seed = seedLedger.claimIdempotentRequest({
      keyHash,
      scope,
      requestHash,
      leaseMs: 5_000,
      now: '2026-07-10T15:00:00.000Z'
    });
    assert.equal(seed.claimed, true);
  } finally {
    seedLedger.close();
  }

  const root = path.join(__dirname, '..');
  const claimants = Array.from({ length: 8 }, () => startSynchronizedIdempotencyClaimant({
    root,
    keyHash,
    scope,
    requestHash,
    now: '2026-07-10T15:00:06.000Z'
  }));
  try {
    await Promise.all(claimants.map(claimant => claimant.ready));
    for (const claimant of claimants) claimant.child.stdin.end('claim\n');
    const claims = await Promise.all(claimants.map(claimant => claimant.result));
    const winners = claims.filter(claim => claim.claimed);
    assert.equal(winners.length, 1);
    assert.ok(claims.filter(claim => !claim.claimed).every(claim => claim.reason === 'request_in_progress'));

    const verificationLedger = new ContractorOperatingLedger({ databaseUrl: connectionString });
    try {
      const retained = verificationLedger.db.prepare(`
        SELECT status, lease_id, lease_until
        FROM idempotency_records
        WHERE key_hash = ?
      `).get(keyHash);
      assert.equal(retained.status, 'processing');
      assert.equal(retained.lease_id, winners[0].leaseId);
      assert.equal(verificationLedger.completeIdempotentRequest(
        keyHash,
        requestHash,
        200,
        { documentId: 'stale-postgres-document' },
        seed.leaseId
      ), false);
      assert.equal(verificationLedger.releaseIdempotentRequest(keyHash, requestHash, seed.leaseId), false);
      assert.equal(verificationLedger.completeIdempotentRequest(
        keyHash,
        requestHash,
        201,
        { documentId: 'current-postgres-document' },
        winners[0].leaseId
      ), true);
      const replay = verificationLedger.claimIdempotentRequest({
        keyHash,
        scope,
        requestHash,
        now: '2026-07-10T15:00:07.000Z'
      });
      assert.equal(replay.replayed, true);
      assert.equal(replay.responseStatus, 201);
      assert.deepEqual(replay.responseBody, { documentId: 'current-postgres-document' });
    } finally {
      verificationLedger.close();
    }
  } finally {
    for (const claimant of claimants) {
      if (!claimant.child.killed && claimant.child.exitCode === null) claimant.child.kill();
    }
  }
});

test('PostgreSQL quantity takeoff parity preserves formulas and estimate traceability', { skip: !connectionString }, () => {
  const ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  try {
    const marker = Date.now();
    const job = ledger.createIntake({
      clientName: `Hosted takeoff client ${marker}`,
      title: `Hosted quantity takeoff ${marker}`,
      assignAutomatically: false
    }, { actor: 'postgres_takeoff_test' });
    const takeoff = ledger.createTakeoff(job.id, {
      title: 'Hosted measured scope',
      taxRate: 21,
      items: [
        {
          description: 'Hosted floor finish',
          measurementType: 'area',
          count: 2,
          length: 4.25,
          width: 3.5,
          wastePercent: 8,
          unitCost: 19.5,
          unitPrice: 34.75,
          costCode: 'PG-FIN-100'
        },
        {
          description: 'Hosted door sets',
          measurementType: 'count',
          count: 4,
          unitCost: 275,
          unitPrice: 440,
          costCode: 'PG-JOIN-100'
        }
      ]
    }, { actor: 'postgres_takeoff_test' });
    assert.deepEqual(takeoff.items.map(item => item.quantity), [32.13, 4]);
    const converted = ledger.convertTakeoffToQuote(job.id, takeoff.id, {
      validUntil: '2026-12-31'
    }, { actor: 'postgres_takeoff_test' });
    assert.equal(converted.takeoff.integrityValid, true);
    assert.equal(converted.quote.subtotal, converted.takeoff.subtotal);
    assert.equal(converted.quote.data.source.snapshotHash, converted.takeoff.snapshotHash);
    assert.equal(ledger.convertTakeoffToQuote(job.id, takeoff.id).replayed, true);
    assert.equal(ledger.diagnose().valid, true);
  } finally {
    ledger.close();
  }
});

test('PostgreSQL production control parity preserves approved baselines, replay, and earned hours', { skip: !connectionString }, () => {
  const ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  try {
    const marker = Date.now();
    const job = ledger.createIntake({
      clientName: `Hosted production client ${marker}`,
      title: `Hosted measured production ${marker}`,
      status: 'in_progress',
      assignAutomatically: false
    }, { actor: 'postgres_production_test' });
    const requested = ledger.requestProductionBaseline(job.id, {
      lines: [{
        lineKey: 'hosted-installed-area',
        costCode: 'PG-PROD-100',
        description: 'Hosted installed finish area',
        unit: 'm2',
        plannedQuantity: 100,
        plannedLaborHours: 80
      }]
    }, { actor: 'postgres_production_test' });
    ledger.resolveApproval(requested.approval.id, {
      status: 'approved', resolvedBy: 'postgres_production_approver', reason: 'Hosted baseline verified.'
    });
    const payload = {
      entryKey: `postgres-production-${marker}`,
      lineKey: 'hosted-installed-area',
      quantity: 20,
      crewHours: 24,
      note: 'Hosted production quantity and crew hours retained.'
    };
    const recorded = ledger.recordProductionEntry(job.id, payload, { actor: 'postgres_production_test' });
    const replay = ledger.recordProductionEntry(job.id, payload, { actor: 'postgres_production_test' });
    assert.equal(replay.replayed, true);
    assert.equal(replay.entry.id, recorded.entry.id);
    assert.equal(recorded.production.summary.earnedHours, 16);
    assert.equal(recorded.production.summary.crewHours, 24);
    assert.equal(recorded.production.summary.performanceFactor, 0.6667);
    assert.equal(ledger.getProductionBaseline(requested.baseline.id).integrityValid, true);
    assert.equal(ledger.diagnose().valid, true);
  } finally {
    ledger.close();
  }
});

test('PostgreSQL work permit parity preserves source-current approval, worker acknowledgement, and autonomous review', { skip: !connectionString }, () => {
  const ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  try {
    const marker = Date.now();
    const job = ledger.createIntake({
      clientName: `Hosted permit client ${marker}`,
      title: `Hosted work permit ${marker}`,
      status: 'in_progress',
      riskLevel: 'high',
      assignAutomatically: false
    }, { actor: 'postgres_permit_test' });
    const worker = ledger.upsertWorker({
      id: `postgres-permit-worker-${marker}`,
      name: `Hosted permit worker ${marker}`,
      role: 'Site operative',
      status: 'available'
    }, { actor: 'postgres_permit_test' });
    ledger.addAssignment(job.id, {
      workerId: worker.id,
      workerName: worker.name,
      role: worker.role,
      status: 'assigned'
    }, { actor: 'postgres_permit_test' });
    const payload = {
      entryKey: `postgres-work-permit-${marker}`,
      permitType: 'electrical_isolation',
      title: 'Hosted electrical isolation permit',
      location: 'Hosted switch room',
      validFrom: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      hazards: ['Stored electrical energy', 'Unexpected re-energization'],
      controls: ['Isolation locked and tagged', 'Prove dead before work'],
      conditions: ['Suspend if the isolation boundary changes'],
      evidenceReference: `hosted-isolation-plan:${marker}`
    };
    const created = ledger.createWorkPermit(job.id, payload, { actor: 'postgres_permit_test' });
    assert.equal(created.permit.status, 'pending_approval');
    assert.equal(ledger.createWorkPermit(job.id, payload).replayed, true);
    ledger.resolveApproval(created.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_permit_approver',
      reason: 'Hosted permit hazards, controls, source evidence, and assigned worker verified.'
    });
    const action = ledger.nextActions().find(candidate => (
      candidate.type === 'review_work_permit_readiness' && candidate.permitId === created.permit.id
    ));
    assert.ok(action);
    assert.equal(action.outstandingCount, 1);
    const autonomous = ledger.runAutonomousCycle({
      actionTypes: ['review_work_permit_readiness'],
      jobIds: [job.id]
    });
    assert.equal(autonomous.applied.length, 1);
    assert.equal(autonomous.applied[0].externalCommitments, 0);
    assert.equal(autonomous.applied[0].acknowledgementsInferred, false);

    const acknowledgement = {
      entryKey: `postgres-permit-ack-${marker}`,
      workerId: worker.id,
      acknowledged: true,
      evidenceReference: `hosted-worker-attestation:${marker}`
    };
    const acknowledged = ledger.acknowledgeWorkPermit(job.id, created.permit.id, acknowledgement, { actor: 'postgres_field_worker' });
    assert.equal(acknowledged.permit.readyForWork, true);
    assert.equal(ledger.acknowledgeWorkPermit(job.id, created.permit.id, acknowledgement).replayed, true);
    const suspended = ledger.suspendWorkPermit(job.id, created.permit.id, {
      entryKey: `postgres-permit-suspend-${marker}`,
      reason: 'Isolation boundary changed during hosted test.',
      evidenceReference: `hosted-stop-work:${marker}`
    }, { actor: 'postgres_site_supervisor' });
    assert.equal(suspended.stopWorkImmediate, true);
    assert.equal(suspended.permit.status, 'suspended');
    const closed = ledger.closeWorkPermit(job.id, created.permit.id, {
      entryKey: `postgres-permit-close-${marker}`,
      note: 'Hosted work ended and the isolation was formally handed back.',
      evidenceReference: `hosted-permit-closeout:${marker}`
    }, { actor: 'postgres_site_supervisor' });
    assert.equal(closed.permit.status, 'closed');
    assert.equal(closed.permit.definitionIntegrityValid, true);
    assert.equal(ledger.migrationStatus().currentVersion, '049_contractor_balanced_scorecard');
    assert.equal(ledger.diagnose().valid, true);
  } finally {
    ledger.close();
  }
});

test('PostgreSQL pre-task plan parity preserves source approval, exact crew acknowledgement, and restart integrity', { skip: !connectionString }, () => {
  let ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let jobId;
  let planId;
  try {
    const job = ledger.createIntake({
      clientName: `Hosted pre-task client ${marker}`,
      title: `Hosted pre-task plan ${marker}`,
      status: 'in_progress',
      riskLevel: 'high',
      assignAutomatically: false
    }, { actor: 'postgres_pre_task_test' });
    jobId = job.id;
    const workers = ['Lead installer', 'Site operative'].map(role => {
      const worker = ledger.upsertWorker({
        id: `postgres-pre-task-${role.toLowerCase().replaceAll(' ', '-')}-${marker}`,
        name: `Hosted ${role} ${marker}`,
        role,
        status: 'available'
      }, { actor: 'postgres_pre_task_test' });
      ledger.addAssignment(job.id, {
        workerId: worker.id,
        workerName: worker.name,
        role: worker.role,
        status: 'assigned'
      }, { actor: 'postgres_pre_task_test' });
      return worker;
    });
    const jha = ledger.createJhaRecord(job.id, {
      title: `Hosted approved JHA ${marker}`,
      status: 'approved',
      riskLevel: 'high',
      hazards: ['Stored energy', 'Restricted access'],
      controls: ['Isolation and lockout', 'Controlled access'],
      stopWorkTriggers: ['Isolation boundary changes']
    }, { actor: 'postgres_pre_task_test' });
    ledger.resolveApproval(jha.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_pre_task_approver',
      reason: 'Hosted JHA hazards and controls verified.'
    });
    const payload = {
      entryKey: `postgres-pre-task-plan-${marker}`,
      workDate: new Date().toISOString().slice(0, 10),
      shiftLabel: 'Day shift',
      title: 'Hosted distribution installation plan',
      location: 'Hosted plant room',
      preparedBy: 'Hosted site supervisor',
      responsibleWorkerId: workers[0].id,
      jhaId: jha.id,
      evidenceReference: `postgres-method-statement:${marker}`,
      emergencyArrangements: 'Use the east stair and report to the assembly point.',
      stopWorkTriggers: ['Isolation boundary changes', 'Unplanned simultaneous operations'],
      steps: [{
        stepKey: 'isolate-and-install',
        description: 'Isolate the supply and install the distribution equipment',
        hazards: ['Stored electrical energy', 'Manual handling'],
        controls: ['Lock, tag, test, and use the planned lifting aid']
      }]
    };
    const created = ledger.createPreTaskPlan(job.id, payload, { actor: 'postgres_pre_task_test' });
    planId = created.plan.id;
    assert.equal(created.plan.status, 'pending_approval');
    assert.equal(ledger.createPreTaskPlan(job.id, payload).replayed, true);
    ledger.resolveApproval(created.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_pre_task_approver',
      reason: 'Hosted plan sources, steps, controls, date, and frozen crew verified.'
    });
    const action = ledger.nextActions().find(candidate => (
      candidate.type === 'review_pre_task_plan_readiness' && candidate.planId === created.plan.id
    ));
    assert.ok(action);
    assert.equal(action.outstandingCount, 2);
    const autonomous = ledger.runAutonomousCycle({
      actionTypes: ['review_pre_task_plan_readiness'],
      jobIds: [job.id]
    });
    assert.equal(autonomous.applied.length, 1);
    assert.equal(autonomous.applied[0].externalCommitments, 0);
    assert.equal(autonomous.applied[0].activationInferred, false);
    workers.forEach((worker, index) => {
      const acknowledgement = {
        entryKey: `postgres-pre-task-ack-${index + 1}-${marker}`,
        workerId: worker.id,
        acknowledged: true,
        evidenceReference: `postgres-worker-attestation:${index + 1}:${marker}`,
        attestation: 'I reviewed the retained plan and stop-work triggers.'
      };
      const result = ledger.acknowledgePreTaskPlan(job.id, created.plan.id, acknowledgement, {
        actor: 'postgres_field_worker',
        workerId: worker.id
      });
      assert.equal(result.attendee.integrityValid, true);
      assert.equal(ledger.acknowledgePreTaskPlan(job.id, created.plan.id, acknowledgement).replayed, true);
    });
    const active = ledger.getPreTaskPlan(created.plan.id);
    assert.equal(active.status, 'active');
    assert.equal(active.readyForWork, true);
    assert.equal(active.attendanceSummary.acknowledged, 2);
    assert.equal(ledger.migrationStatus().currentVersion, '049_contractor_balanced_scorecard');
    assert.equal(ledger.diagnose().valid, true);
  } finally {
    ledger.close();
  }

  ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  try {
    const retained = ledger.getPreTaskPlan(planId, { jobId });
    assert.equal(retained.status, 'active');
    assert.equal(retained.definitionIntegrityValid, true);
    assert.equal(retained.prerequisitesCurrent, true);
    assert.equal(retained.attendees.every(attendee => attendee.integrityValid), true);
    const suspended = ledger.suspendPreTaskPlan(jobId, planId, {
      entryKey: `postgres-pre-task-stop-${marker}`,
      reason: 'Hosted isolation boundary changed during the planned work.',
      evidenceReference: `postgres-stop-work:${marker}`
    }, { actor: 'postgres_site_supervisor' });
    assert.equal(suspended.stopWorkImmediate, true);
    assert.equal(suspended.plan.status, 'suspended');
    const closed = ledger.closePreTaskPlan(jobId, planId, {
      entryKey: `postgres-pre-task-close-${marker}`,
      note: 'Hosted work stopped safely and the area was formally handed back.',
      evidenceReference: `postgres-plan-closeout:${marker}`
    }, { actor: 'postgres_site_supervisor' });
    assert.equal(closed.plan.status, 'closed');
    assert.equal(closed.plan.definitionIntegrityValid, true);
    assert.equal(ledger.diagnose().valid, true);
  } finally {
    ledger.close();
  }
});

test('PostgreSQL governed daywork preserves replay, source approval, acknowledgement, and change-order parity', { skip: !connectionString }, () => {
  const ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const job = ledger.createIntake({
      title: `PostgreSQL daywork ${marker}`,
      client: { name: `Hosted daywork client ${marker}` },
      status: 'in_progress',
      assignAutomatically: false
    }, { actor: 'postgres_daywork_test' });
    const worker = ledger.upsertWorker({
      name: `Hosted daywork worker ${marker}`,
      role: 'Site operative',
      status: 'available'
    }, { actor: 'postgres_daywork_test' });
    ledger.addAssignment(job.id, {
      workerId: worker.id,
      workerName: worker.name,
      role: worker.role,
      status: 'assigned'
    }, { actor: 'postgres_daywork_test' });
    const payload = {
      entryKey: `postgres-daywork-${marker}`,
      workerId: worker.id,
      workDate: new Date().toISOString().slice(0, 10),
      title: 'Hosted additional containment support',
      description: 'Installed additional containment support around an existing hosted service conflict.',
      reason: 'The retained coordination basis did not show the existing service.',
      evidenceReference: `postgres-daywork-evidence:${marker}`,
      lines: [
        { lineKey: 'hosted-labor', lineType: 'labor', description: 'Installation labor', quantity: 4, unit: 'hour', costCode: 'PG-LAB' },
        { lineKey: 'hosted-material', lineType: 'material', description: 'Support bracket', quantity: 6, unit: 'piece', costCode: 'PG-MAT' }
      ]
    };
    const created = ledger.createDayworkTicket(job.id, payload, { actor: 'postgres_field_worker' });
    assert.equal(created.ticket.integrityValid, true);
    assert.equal(ledger.createDayworkTicket(job.id, payload).replayed, true);
    ledger.resolveApproval(created.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_daywork_approver',
      reason: 'Hosted quantity source and evidence verified.'
    });
    const acknowledgement = ledger.requestDayworkAcknowledgement(job.id, created.ticket.id, {
      evidenceReference: `postgres-signed-daywork:${marker}`,
      acknowledgedBy: 'Hosted client representative',
      acknowledgedAt: new Date().toISOString()
    }, { actor: 'postgres_office' });
    ledger.resolveApproval(acknowledgement.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_daywork_approver',
      reason: 'Hosted acknowledgement receipt evidence verified.'
    });
    const converted = ledger.convertDayworkTicketToChangeOrder(job.id, created.ticket.id, {
      prices: [
        { lineKey: 'hosted-labor', unitPrice: 80 },
        { lineKey: 'hosted-material', unitPrice: 20 }
      ],
      taxRate: 21
    }, { actor: 'postgres_office' });
    assert.equal(converted.ticket.status, 'converted');
    assert.equal(converted.changeOrder.status, 'pending_approval');
    assert.equal(converted.changeOrder.amount, 440);
    assert.equal(converted.changeOrder.data.source.id, created.ticket.id);
    assert.equal(converted.changeOrder.data.source.sourceHash, created.ticket.sourceHash);
    assert.equal(ledger.getJobDetail(job.id).dayworkTickets.length, 1);
    assert.equal(ledger.dashboardSummary().metrics.dayworkTickets >= 1, true);
    assert.equal(ledger.migrationStatus().currentVersion, '049_contractor_balanced_scorecard');
    assert.equal(ledger.diagnose().valid, true);
  } finally {
    ledger.close();
  }
});

test('PostgreSQL governed nonconformance preserves replay, dual approval, integrity, and restart parity', { skip: !connectionString }, () => {
  let ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let jobId;
  let recordId;
  try {
    const job = ledger.createIntake({
      title: `PostgreSQL NCR ${marker}`,
      client: { name: `Hosted NCR client ${marker}` },
      status: 'in_progress',
      assignAutomatically: false
    }, { actor: 'postgres_ncr_test' });
    jobId = job.id;
    const worker = ledger.upsertWorker({
      name: `Hosted NCR worker ${marker}`,
      role: 'Site operative',
      status: 'available'
    }, { actor: 'postgres_ncr_test' });
    ledger.addAssignment(job.id, {
      workerId: worker.id,
      workerName: worker.name,
      role: worker.role,
      status: 'assigned'
    }, { actor: 'postgres_ncr_test' });
    const payload = {
      entryKey: `postgres-ncr-${marker}`,
      workerId: worker.id,
      workerName: worker.name,
      severity: 'high',
      discipline: 'structural',
      title: 'Hosted anchor spacing deviation',
      description: 'Retained hosted survey measurements show two anchors outside the approved spacing.',
      location: 'Hosted facade bay P4',
      detectedAt: new Date().toISOString(),
      raisedBy: worker.name,
      requirementReference: 'Hosted detail STR-421 revision C',
      immediateContainment: 'Held covering work and marked the affected bay pending correction.',
      responsibleParty: 'Hosted facade supervisor',
      dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    };
    const created = ledger.createNonconformance(job.id, payload, { actor: 'postgres_field_worker' });
    recordId = created.nonconformance.id;
    assert.equal(created.nonconformance.integrityValid, true);
    assert.equal(ledger.createNonconformance(job.id, payload).replayed, true);
    const correction = ledger.requestNonconformanceCorrectiveAction(job.id, recordId, {
      rootCause: 'A superseded workshop sketch was used for setting out.',
      correctiveAction: 'Install approved supplementary anchors and repeat the retained pull tests.',
      responsibleParty: 'Hosted facade supervisor',
      dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      evidenceReference: `postgres-ncr-correction:${marker}`
    }, { actor: 'postgres_office' });
    ledger.resolveApproval(correction.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_ncr_approver',
      reason: 'Hosted corrective action and evidence basis verified.'
    });
    const closure = ledger.requestNonconformanceClosure(job.id, recordId, {
      verificationResult: 'passed',
      verificationEvidence: `postgres-ncr-verification:${marker}`,
      verifiedBy: 'Hosted independent quality lead',
      verifiedAt: new Date().toISOString()
    }, { actor: 'postgres_office' });
    ledger.resolveApproval(closure.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_ncr_approver',
      reason: 'Hosted independent verification matches the retained correction.'
    });
    const closed = ledger.getNonconformance(recordId);
    assert.equal(closed.status, 'closed');
    assert.equal(closed.correctionIntegrityValid, true);
    assert.equal(closed.closureIntegrityValid, true);
    assert.equal(ledger.dashboardSummary().metrics.nonconformances >= 1, true);
    assert.equal(ledger.diagnose().valid, true);
    ledger.close();
    ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
    const retained = ledger.getJobDetail(jobId).nonconformances.find(record => record.id === recordId);
    assert.equal(retained.status, 'closed');
    assert.equal(retained.integrityValid, true);
    assert.equal(retained.correctionIntegrityValid, true);
    assert.equal(retained.closureIntegrityValid, true);
    assert.equal(ledger.migrationStatus().currentVersion, '049_contractor_balanced_scorecard');
  } finally {
    ledger?.close();
  }
});

test('PostgreSQL governed SDS revisions preserve exact replay, atomic supersession, and restart integrity', { skip: !connectionString }, () => {
  let ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let jobId;
  let firstId;
  let secondId;
  const addPdf = suffix => {
    const bytes = Buffer.from(`%PDF-1.7\nHosted SDS ${marker} ${suffix}\n%%EOF`);
    return ledger.addDocument(jobId, {
      type: 'sds_pdf',
      title: `Hosted manufacturer SDS ${suffix}`,
      filename: `hosted-sds-${marker}-${suffix}.pdf`,
      mimeType: 'application/pdf',
      size: bytes.length,
      storageRef: `s3://postgres-contract/${marker}-${suffix}.pdf`,
      status: 'stored',
      analysis: { upload: { sha256: crypto.createHash('sha256').update(bytes).digest('hex') } }
    }, { actor: 'postgres_sds_test' });
  };
  const payload = (documentId, entryKey, overrides = {}) => ({
    entryKey,
    material: `Hosted chemical coating ${marker}`,
    manufacturer: `Hosted Coatings Europe ${marker}`,
    productCode: `PG-SDS-${marker}`,
    language: 'nl',
    issuedOn: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    documentId,
    hazardClasses: ['H315 - Causes skin irritation'],
    requiredPpe: ['Chemical-resistant gloves', 'Safety goggles'],
    firstAidMeasures: 'Rinse exposed skin or eyes and obtain medical advice when symptoms persist.',
    fireMeasures: 'Use foam, dry powder, or carbon dioxide and control contaminated run-off.',
    handlingStorage: 'Keep sealed in a ventilated area away from heat and incompatible materials.',
    spillResponse: 'Ventilate, contain with inert absorbent, and prevent entry into drains.',
    disposal: 'Use an authorized waste contractor for product and contaminated absorbent.',
    emergencyContact: 'Hosted Coatings emergency line +31 20 555 0199.',
    revisionReason: 'Hosted manufacturer source and operational controls verified.',
    ...overrides
  });
  const approve = approvalId => ledger.resolveApproval(approvalId, {
    status: 'approved',
    resolvedBy: 'postgres_sds_approver',
    reason: 'Hosted manufacturer PDF, product identity, dates, hazards, PPE, and emergency controls verified.'
  });

  try {
    const job = ledger.createIntake({
      title: `PostgreSQL governed SDS ${marker}`,
      client: { name: `Hosted SDS client ${marker}` },
      status: 'in_progress',
      riskLevel: 'high',
      assignAutomatically: false
    }, { actor: 'postgres_sds_test' });
    jobId = job.id;

    const firstPayload = payload(addPdf('r1').id, `postgres-sds-r1-${marker}`);
    const first = ledger.createSdsRevision(jobId, firstPayload, { actor: 'postgres_sds_test' });
    firstId = first.id;
    assert.equal(first.integrityValid, true);
    assert.equal(first.revisionNumber, 1);
    assert.equal(ledger.createSdsRevision(jobId, firstPayload).replayed, true);
    approve(first.approval.id);
    assert.equal(ledger.getSdsSheet(firstId).current, true);
    assert.equal(ledger.createSdsRevision(jobId, firstPayload).replayed, true);

    const secondPayload = payload(addPdf('r2').id, `postgres-sds-r2-${marker}`, {
      supersedesSdsId: firstId,
      revisionReason: 'Hosted manufacturer replacement adds updated spill-response controls.',
      spillResponse: 'Evacuate, ventilate, contain with inert absorbent, and protect all drains.'
    });
    const second = ledger.createSdsRevision(jobId, secondPayload, { actor: 'postgres_sds_test' });
    secondId = second.id;
    assert.equal(second.revisionNumber, 2);
    assert.equal(ledger.createSdsRevision(jobId, secondPayload).replayed, true);
    approve(second.approval.id);
    assert.equal(ledger.getSdsSheet(firstId).status, 'superseded');
    assert.equal(ledger.getSdsSheet(secondId).current, true);
    assert.equal(ledger.listSdsSheets({ jobId, currentOnly: true }).length, 1);
    assert.equal(ledger.createSdsRevision(jobId, secondPayload).replayed, true);

    assert.throws(() => ledger.db.prepare(`
      INSERT INTO sds_sheets (
        id, job_id, material, supplier, status, expires_at, data_json, created_at, updated_at,
        product_key, revision_number, manufacturer, language
      ) VALUES (?, ?, ?, ?, 'current', ?, '{}', ?, ?, ?, 99, ?, 'nl')
    `).run(
      `sds-duplicate-${marker}`, jobId, second.material, second.manufacturer,
      new Date(Date.now() + 365 * 86_400_000).toISOString(), new Date().toISOString(), new Date().toISOString(),
      second.productKey, second.manufacturer
    ), /idx_sds_one_current_product|duplicate key|unique constraint/i);

    const sdsIndexes = ledger.db.prepare(`
      SELECT COUNT(*) AS count FROM pg_indexes
      WHERE schemaname = 'public' AND indexname IN (
        'idx_sds_job_entry_key', 'idx_sds_job_product_revision', 'idx_sds_supersedes',
        'idx_sds_one_current_product', 'idx_sds_job_status_expiry', 'idx_sds_document'
      )
    `).get();
    assert.equal(Number(sdsIndexes.count), 6);
    assert.equal(ledger.migrationStatus().currentVersion, '049_contractor_balanced_scorecard');
    assert.equal(ledger.diagnose().valid, true, JSON.stringify(ledger.diagnose().issues));
  } finally {
    ledger.close();
  }

  ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  try {
    assert.equal(ledger.getSdsSheet(firstId, { jobId }).status, 'superseded');
    const retained = ledger.getSdsSheet(secondId, { jobId });
    assert.equal(retained.status, 'current');
    assert.equal(retained.integrityValid, true);
    assert.equal(retained.revisionNumber, 2);
    assert.equal(ledger.listSdsSheets({ jobId, currentOnly: true })[0].id, secondId);
    assert.equal(ledger.diagnose().valid, true, JSON.stringify(ledger.diagnose().issues));
  } finally {
    ledger.close();
  }
});

test('PostgreSQL cash-flow parity preserves recurrence, immutable approval, and restart integrity', { skip: !connectionString }, () => {
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const asOfDate = new Date().toISOString().slice(0, 10);
  let ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  let snapshotId;
  try {
    const retained = ledger.createCashFlowItem({
      entryKey: `postgres-cash-flow-${marker}`,
      direction: 'outflow',
      category: 'overhead',
      title: `Hosted recurring overhead ${marker}`,
      amount: 125,
      expectedAt: asOfDate,
      recurrence: 'weekly',
      recurrenceEndAt: ledger.cashFlowAddDays(asOfDate, 14),
      confidencePercent: 80,
      sourceReference: `POSTGRES-CASH-${marker}`
    }, { actor: 'postgres_finance_operator' });
    assert.equal(retained.replayed, false);
    assert.equal(ledger.createCashFlowItem({
      entryKey: `postgres-cash-flow-${marker}`,
      direction: 'outflow',
      category: 'overhead',
      title: `Hosted recurring overhead ${marker}`,
      amount: 125,
      expectedAt: asOfDate,
      recurrence: 'weekly',
      recurrenceEndAt: ledger.cashFlowAddDays(asOfDate, 14),
      confidencePercent: 80,
      sourceReference: `POSTGRES-CASH-${marker}`
    }).replayed, true);

    const forecast = ledger.calculateCashFlowForecast({ asOfDate, openingBalance: 1000 });
    const retainedSources = forecast.sources.filter(source => source.sourceId === retained.item.id);
    assert.equal(forecast.weeks.length, 13);
    assert.equal(retainedSources.length, 3);
    assert.equal(retainedSources.reduce((sum, source) => sum + source.amount, 0), 375);

    const requested = ledger.requestCashFlowForecastSnapshot({ asOfDate, openingBalance: 1000 }, { actor: 'postgres_finance_operator' });
    snapshotId = requested.snapshot.id;
    ledger.resolveApproval(requested.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_finance_approver',
      reason: 'Hosted opening balance, recurrence, timing, and retained source evidence verified.'
    });
    assert.equal(ledger.calculateCashFlowForecast({ asOfDate, openingBalance: 1000 }).snapshotCurrent, true);
    assert.equal(ledger.migrationStatus().currentVersion, '049_contractor_balanced_scorecard');
  } finally {
    ledger.close();
  }

  ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  try {
    const snapshot = ledger.getCashFlowForecastSnapshot(snapshotId);
    assert.equal(snapshot.status, 'approved');
    assert.equal(snapshot.integrityValid, true);
    assert.equal(ledger.calculateCashFlowForecast({ asOfDate, openingBalance: 1000 }).snapshotCurrent, true);
    assert.equal(ledger.diagnose().valid, true, JSON.stringify(ledger.diagnose().issues));
  } finally {
    ledger.close();
  }
});

test('PostgreSQL performance scorecard preserves target governance, immutable approval, and restart integrity', { skip: !connectionString }, () => {
  const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const periodEnd = new Date().toISOString().slice(0, 10);
  let ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  let snapshotId;
  try {
    const target = ledger.requestPerformanceScorecardTarget({
      metricKey: 'inspection_pass_rate_pct',
      targetValue: 92,
      reason: `Hosted quality threshold verified for ${marker}.`,
      entryKey: `postgres-scorecard-target-${marker}`
    }, { actor: 'postgres_performance_operator' });
    assert.equal(target.replayed, false);
    assert.equal(ledger.requestPerformanceScorecardTarget({
      metricKey: 'inspection_pass_rate_pct',
      targetValue: 92,
      reason: `Hosted quality threshold verified for ${marker}.`,
      entryKey: `postgres-scorecard-target-${marker}`
    }).replayed, true);
    ledger.resolveApproval(target.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_performance_approver',
      reason: 'Hosted KPI definition, comparison, and threshold verified.'
    });

    const calculated = ledger.calculatePerformanceScorecard({ periodEnd, weeks: 13 });
    assert.equal(calculated.summary.metricCount, 20);
    assert.equal(calculated.perspectives.length, 10);
    assert.equal(calculated.metrics.find(metric => metric.key === 'inspection_pass_rate_pct').targetValue, 92);

    const requested = ledger.requestPerformanceScorecardSnapshot({ periodEnd, weeks: 13 }, { actor: 'postgres_performance_operator' });
    snapshotId = requested.snapshot.id;
    ledger.resolveApproval(requested.approval.id, {
      status: 'approved',
      resolvedBy: 'postgres_performance_approver',
      reason: 'Hosted retained evidence, target register, and scorecard period verified.'
    });
    assert.equal(ledger.calculatePerformanceScorecard({ periodEnd, weeks: 13 }).snapshotCurrent, true);
    assert.equal(ledger.migrationStatus().currentVersion, '049_contractor_balanced_scorecard');
  } finally {
    ledger.close();
  }

  ledger = new ContractorOperatingLedger({ databaseUrl: connectionString });
  try {
    const snapshot = ledger.getPerformanceScorecardSnapshot(snapshotId);
    assert.equal(snapshot.status, 'approved');
    assert.equal(snapshot.integrityValid, true);
    assert.equal(ledger.calculatePerformanceScorecard({ periodEnd, weeks: 13 }).snapshotCurrent, true);
  } finally {
    ledger.close();
  }
});
