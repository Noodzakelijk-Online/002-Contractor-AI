const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-installation-qc-api-'));
const jobId = 'installation-qc-api-job';
const workerId = 'installation-qc-api-worker';
const otherWorkerId = 'installation-qc-api-other-worker';
const tokens = {
  owner: 'installation-qc-api-owner-token-at-least-32-characters',
  approver: 'installation-qc-api-approver-token-at-least-32-characters',
  office_operator: 'installation-qc-api-office-token-at-least-32-characters',
  field_worker: [
    {
      id: workerId,
      workerId,
      token: 'installation-qc-api-field-token-at-least-32-characters',
      jobIds: [jobId]
    },
    {
      id: otherWorkerId,
      workerId: otherWorkerId,
      token: 'installation-qc-api-other-field-token-at-least-32-characters',
      jobIds: [jobId]
    }
  ]
};

Object.assign(process.env, {
  NODE_ENV: 'test',
  CONTRACTOR_AI_RUNTIME_MODE: 'local',
  CONTRACTOR_AI_STORAGE_MODE: 'local',
  CONTRACTOR_AI_REQUIRE_AUTH: 'true',
  CONTRACTOR_AI_ROLE_TOKENS: JSON.stringify(tokens),
  STATE_FILE: path.join(directory, 'state.json'),
  LEDGER_DB_FILE: path.join(directory, 'ledger.sqlite'),
  UPLOAD_DIR: path.join(directory, 'uploads')
});
delete process.env.CONTRACTOR_AI_AUTH_TOKEN;
delete process.env.DASHBOARD_AUTH_TOKEN;

const app = require('../server');

async function request(baseUrl, route, token, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${typeof token === 'string' ? token : token.token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test('installation QC API enforces assigned-worker capture, authenticated approval identity, projections, and release capabilities', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await app.locals.runtimeControl.shutdown({ server, signal: 'installation_qc_api_test' });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const fieldToken = tokens.field_worker[0];
  const otherFieldToken = tokens.field_worker[1];

  const intake = await request(baseUrl, '/api/ledger/intake', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      ledgerJobId: jobId,
      title: 'Installation QC API project',
      status: 'in_progress',
      client: { name: 'Installation QC API client' },
      assignAutomatically: false
    })
  });
  assert.equal(intake.response.status, 201);

  for (const worker of [
    { id: workerId, name: 'Assigned Installation Worker', role: 'Installer' },
    { id: otherWorkerId, name: 'Other Field Worker', role: 'Installer' }
  ]) {
    const created = await request(baseUrl, '/api/ledger/workers', tokens.owner, {
      method: 'POST',
      body: JSON.stringify({ ...worker, status: 'available' })
    });
    assert.equal(created.response.status, 201);
  }
  const assignment = await request(baseUrl, `/api/ledger/jobs/${jobId}/assignments`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({ workerId, role: 'Installer', status: 'planned' })
  });
  assert.equal(assignment.response.status, 201);
  const task = await request(baseUrl, `/api/ledger/jobs/${jobId}/tasks`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Install governed facade panel',
      status: 'in_progress',
      assigneeId: workerId,
      priority: 'high'
    })
  });
  assert.equal(task.response.status, 201);
  const evidence = await request(baseUrl, `/api/ledger/jobs/${jobId}/documents`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      title: 'Facade panel evidence',
      filename: 'facade-panel.jpg',
      documentType: 'quality_evidence',
      status: 'stored'
    })
  });
  assert.equal(evidence.response.status, 201);

  const template = await request(baseUrl, '/api/ledger/inspection-templates', tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      name: 'API installation control',
      templateKey: 'api_installation_control',
      inspectionType: 'installation_qc',
      discipline: 'quality',
      installationQc: true,
      defaultInstallationStage: 'pre_concealment',
      defaultControlPoint: 'hold',
      items: [
        {
          key: 'evidence',
          prompt: 'Installation evidence is retained',
          acceptanceCriteria: 'The complete installation is visible before concealment.',
          controlPoint: 'hold',
          evidenceRequired: true,
          failureSeverity: 'high'
        },
        {
          key: 'witness',
          prompt: 'Tolerance is witnessed',
          acceptanceCriteria: 'Observed tolerance is within the retained requirement.',
          controlPoint: 'witness',
          measurementRequired: true,
          measurementUnit: 'mm',
          failureSeverity: 'high'
        }
      ]
    })
  });
  assert.equal(template.response.status, 201);

  const scheduled = await request(baseUrl, `/api/ledger/jobs/${jobId}/inspection-checklists`, tokens.office_operator, {
    method: 'POST',
    body: JSON.stringify({
      templateId: template.body.template.id,
      title: 'API facade panel hold point',
      entryKey: 'installation-qc-api-schedule-0001',
      taskId: task.body.task.id,
      assignmentId: assignment.body.assignment.id,
      assignedWorkerId: workerId,
      workLocation: 'Building B / Level 1 / Grid D2',
      installationStage: 'pre_concealment',
      controlPoint: 'hold',
      referenceBasis: 'Approved panel detail and manufacturer instructions.',
      actor: 'role:owner:spoofed'
    })
  });
  assert.equal(scheduled.response.status, 201);
  assert.equal(scheduled.body.inspection.installationQc.assignedWorkerId, workerId);

  const assignedList = await request(baseUrl, '/api/ledger/installation-qc', fieldToken);
  assert.equal(assignedList.response.status, 200);
  assert.deepEqual(assignedList.body.controls.map(control => control.inspectionId), [scheduled.body.inspection.id]);
  const otherList = await request(baseUrl, '/api/ledger/installation-qc', otherFieldToken);
  assert.equal(otherList.response.status, 200);
  assert.equal(otherList.body.controls.length, 0);

  const responses = [
    {
      itemKey: 'evidence',
      result: 'pass',
      evidenceDocumentIds: [evidence.body.document.id]
    },
    {
      itemKey: 'witness',
      result: 'pass',
      observedValue: '2',
      witnessName: 'API Quality Witness',
      witnessRole: 'Quality lead'
    }
  ];
  const wrongWorker = await request(
    baseUrl,
    `/api/ledger/jobs/${jobId}/inspections/${scheduled.body.inspection.id}/checklist-submissions`,
    otherFieldToken,
    {
      method: 'POST',
      body: JSON.stringify({
        entryKey: 'installation-qc-api-submit-other',
        capturedAt: new Date(Date.now() - 60 * 1000).toISOString(),
        responses
      })
    }
  );
  assert.equal(wrongWorker.response.status, 403);
  assert.equal(wrongWorker.body.error.code, 'installation_qc_worker_scope_forbidden');

  const officeCapture = await request(
    baseUrl,
    `/api/ledger/jobs/${jobId}/inspections/${scheduled.body.inspection.id}/checklist-submissions`,
    tokens.office_operator,
    {
      method: 'POST',
      body: JSON.stringify({
        entryKey: 'installation-qc-api-submit-office',
        capturedAt: new Date(Date.now() - 60 * 1000).toISOString(),
        workerId,
        responses
      })
    }
  );
  assert.equal(officeCapture.response.status, 403);
  assert.equal(officeCapture.body.error.code, 'installation_qc_worker_scope_forbidden');

  const submitted = await request(
    baseUrl,
    `/api/ledger/jobs/${jobId}/inspections/${scheduled.body.inspection.id}/checklist-submissions`,
    fieldToken,
    {
      method: 'POST',
      body: JSON.stringify({
        entryKey: 'installation-qc-api-submit-assigned',
        capturedAt: new Date(Date.now() - 60 * 1000).toISOString(),
        workerId: otherWorkerId,
        actor: 'role:approver:spoofed',
        responses
      })
    }
  );
  assert.equal(submitted.response.status, 201);
  assert.equal(submitted.body.submission.submittedBy, 'role:field_worker:installation-qc-api-worker');
  assert.equal(submitted.body.approval, null);

  const ownerDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`, tokens.owner);
  const approval = ownerDetail.body.job.approvals.find(candidate =>
    candidate.targetId === scheduled.body.inspection.id && candidate.status === 'pending'
  );
  assert.ok(approval);
  const resolved = await request(baseUrl, `/api/ledger/approvals/${approval.id}/resolve`, tokens.approver, {
    method: 'POST',
    body: JSON.stringify({
      status: 'approved',
      resolvedBy: 'role:field_worker:installation-qc-api-worker',
      actor: 'role:field_worker:installation-qc-api-worker',
      reason: 'Current source, evidence, measurement, and witness record independently verified.'
    })
  });
  assert.equal(resolved.response.status, 200);
  assert.equal(resolved.body.approval.resolvedBy, 'role:approver');

  const released = await request(baseUrl, `/api/ledger/jobs/${jobId}/installation-qc`, tokens.owner);
  assert.equal(released.response.status, 200);
  assert.equal(released.body.controls[0].status, 'released');
  assert.equal(released.body.controls[0].readyForTaskCompletion, true);
  const completed = await request(
    baseUrl,
    `/api/ledger/jobs/${jobId}/lifecycle/task/${task.body.task.id}`,
    fieldToken,
    {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'completed',
        notes: 'Released installation control retained.',
        evidence: [evidence.body.document.id]
      })
    }
  );
  assert.equal(completed.response.status, 200);
  assert.equal(completed.body.record.status, 'completed');

  const capabilities = await request(baseUrl, '/api/operations/capabilities', tokens.owner);
  assert.equal(capabilities.response.status, 200);
  assert.equal(
    capabilities.body.capabilities.installationQualityControl.taskCompletion,
    'all_controls_source_current_passed_and_independently_released'
  );
  assert.equal(
    capabilities.body.capabilities.installationQualityControl.offlineCapture,
    'queued_evidence_does_not_release_hold_or_complete_task'
  );
  assert.equal(capabilities.body.capabilities.installationQualityControl.releaseInferred, false);
  const finalDetail = await request(baseUrl, `/api/ledger/jobs/${jobId}`, tokens.owner);
  assert.equal(finalDetail.body.job.audit.some(event => event.actor === 'role:owner:spoofed'), false);
  assert.equal(finalDetail.body.job.audit.some(event => event.actor === 'role:approver:spoofed'), false);
});
