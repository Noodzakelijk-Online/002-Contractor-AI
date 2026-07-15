const assert = require('node:assert/strict');
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
      deliveryReference: 'PostgreSQL retained receipt GR-320',
      notes: 'Hosted three-way supplier invoice match.'
    }, { actor: 'postgres_contract_test' });
    assert.equal(supplierInvoice.match.status, 'matched');
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
    assert.ok(detail.audit.some(entry => entry.action === 'transition_task'));
    assert.ok(detail.audit.some(entry => entry.actor === 'postgres_contract_test'));
    assert.ok(detail.audit.some(entry => entry.action === 'apply_job_archive'));
    assert.ok(detail.audit.some(entry => entry.action === 'apply_job_restore'));
    assert.ok(detail.audit.some(entry => entry.action === 'release_tool_reservation' && entry.actor === 'postgres_contract_test'));

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

    const dashboard = ledger.dashboardSummary();
    assert.ok(dashboard.metrics.jobs >= 1);
    assert.ok(Array.isArray(dashboard.nextActions));
    assert.ok(Array.isArray(ledger.nextActions()));

    const migrations = ledger.migrationStatus();
    assert.equal(migrations.currentVersion, '022_controlled_document_revisions');
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
  assert.deepEqual(versions, Array(4).fill('022_controlled_document_revisions'));

  const verification = new PostgresSyncDatabase({ connectionString });
  try {
    const migrationCount = verification.query('SELECT COUNT(*) AS count FROM ledger_schema_migrations').rows[0];
    assert.equal(Number(migrationCount.count), 22);
    const opportunityTableCount = verification.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('opportunities', 'opportunity_activities')
    `).rows[0];
    assert.equal(Number(opportunityTableCount.count), 2);
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
