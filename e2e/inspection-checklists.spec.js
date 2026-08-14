const { test, expect } = require('@playwright/test');

async function createJob(request, title) {
  const response = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'General contracting',
      status: 'planned',
      client: { name: 'Browser inspection client' },
      assignAutomatically: false
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function openJob(page, title) {
  await page.goto('/');
  await page.getByLabel(/^(Language|Taal)$/).selectOption('en-GB');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  const workspace = page.getByTestId('job-workspace');
  await expect(workspace.getByRole('heading', { name: title })).toBeVisible();
  return workspace;
}

test('operator schedules, completes, approves, and reopens an inspection checklist', async ({ page, request }) => {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const title = `Browser inspection checklist ${Date.now()}`;
  const intake = await createJob(request, title);
  let workspace = await openJob(page, title);
  let control = workspace.getByTestId('inspection-checklist-control');
  await expect(control.getByRole('heading', { name: 'Inspection checklists' })).toBeVisible();

  await control.getByRole('button', { name: 'Schedule', exact: true }).click();
  const schedule = control.getByTestId('inspection-schedule-form');
  await schedule.getByLabel('Inspection title').fill('Pre-close quality inspection');
  await schedule.getByLabel('Inspector').fill('Browser site inspector');
  await schedule.getByRole('button', { name: 'Schedule checklist' }).click();
  await expect(page.getByText(/scheduled with an immutable template snapshot/i)).toBeVisible();

  const row = control.locator('.inspection-checklist-row').filter({ hasText: 'Pre-close quality inspection' });
  await expect(row.getByText('scheduled', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Complete' }).click();

  const checklist = control.getByTestId('inspection-checklist-form');
  const resultGroups = checklist.getByRole('radiogroup');
  const itemCount = await resultGroups.count();
  expect(itemCount).toBeGreaterThanOrEqual(2);
  for (let index = 0; index < itemCount; index += 1) {
    await resultGroups.nth(index).getByRole('radio', { name: 'Pass' }).check();
  }
  await checklist.getByLabel('Inspection summary').fill('Every retained item was checked against the current work and available evidence.');
  await checklist.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText(/0 failed items retained.*waiting for approval/i)).toBeVisible();

  let detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  let detail = (await detailResponse.json()).job;
  let inspection = detail.inspections.find(record => record.title === 'Pre-close quality inspection');
  expect(inspection.status).toBe('pending_approval');
  expect(inspection.checklist.submissions).toHaveLength(1);
  expect(inspection.checklist.submissions[0].integrityValid).toBe(true);
  const approval = detail.approvals.find(item => item.id === inspection.approvalId && item.status === 'pending');
  expect(approval).toBeTruthy();
  const approvalResponse = await request.post(`/api/ledger/approvals/${approval.id}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Browser inspection owner',
      reason: 'Complete responses and retained immutable checklist snapshot verified.'
    }
  });
  expect(approvalResponse.ok()).toBeTruthy();

  workspace = await openJob(page, title);
  control = workspace.getByTestId('inspection-checklist-control');
  const approvedRow = control.locator('.inspection-checklist-row').filter({ hasText: 'Pre-close quality inspection' });
  await expect(approvedRow.getByText('passed', { exact: true })).toBeVisible();
  await expect(approvedRow.getByText(/\d+ responses \/ 0 failed/)).toBeVisible();

  detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  detail = (await detailResponse.json()).job;
  inspection = detail.inspections.find(record => record.title === 'Pre-close quality inspection');
  expect(inspection.status).toBe('passed');
  expect(inspection.checklist.status).toBe('passed');

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await control.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(consoleErrors).toEqual([]);
});

test('operator runs an installation hold point from task binding through released completion', async ({ page, request }) => {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const title = `Browser installation QC ${Date.now()}`;
  const intake = await createJob(request, title);
  const workerResponse = await request.post('/api/ledger/workers', {
    data: {
      id: `browser-installation-worker-${Date.now()}`,
      name: 'Browser Installation Worker',
      role: 'Installer',
      status: 'available'
    }
  });
  expect(workerResponse.ok()).toBeTruthy();
  const worker = (await workerResponse.json()).worker;
  const assignmentResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/assignments`, {
    data: { workerId: worker.id, role: worker.role, status: 'planned' }
  });
  expect(assignmentResponse.ok()).toBeTruthy();
  const taskResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/tasks`, {
    data: {
      title: 'Install browser-tested facade panel',
      status: 'in_progress',
      assigneeId: worker.id,
      priority: 'high'
    }
  });
  expect(taskResponse.ok()).toBeTruthy();
  const task = (await taskResponse.json()).task;
  const documentResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/documents`, {
    data: {
      title: 'Browser facade installation evidence',
      filename: 'browser-facade-evidence.jpg',
      documentType: 'quality_evidence',
      status: 'stored'
    }
  });
  expect(documentResponse.ok()).toBeTruthy();
  const document = (await documentResponse.json()).document;

  let workspace = await openJob(page, title);
  let control = workspace.getByTestId('inspection-checklist-control');
  await control.getByRole('button', { name: 'Schedule', exact: true }).click();
  const schedule = control.getByTestId('inspection-schedule-form');
  await schedule.getByLabel('Template').selectOption({ label: 'Installation quality control / v1 / installation QC' });
  await schedule.getByLabel('Installation task').selectOption(task.id);
  await schedule.getByLabel('Assigned inspector').selectOption({ label: 'Browser Installation Worker / planned' });
  await schedule.getByLabel('Work location').fill('Building C / Level 2 / Grid A3');
  await schedule.getByLabel('Reference basis').fill('Approved browser facade detail and manufacturer fixing instructions.');
  await schedule.getByLabel(/Browser facade installation evidence/).check();
  await schedule.getByRole('button', { name: 'Schedule control point' }).click();
  await expect(page.getByText(/scheduled with an immutable template snapshot/i)).toBeVisible();

  const row = control.locator('.inspection-checklist-row').filter({ hasText: 'Installation quality control' }).first();
  await expect(row).toContainText('hold');
  await row.getByRole('button', { name: 'Complete' }).click();
  const checklist = control.getByTestId('inspection-checklist-form');
  await expect(checklist.getByTestId('installation-qc-context')).toContainText('Building C / Level 2 / Grid A3');
  const items = checklist.locator('.inspection-checklist-item');
  const itemCount = await items.count();
  expect(itemCount).toBeGreaterThanOrEqual(7);
  for (let index = 0; index < itemCount; index += 1) {
    const item = items.nth(index);
    await item.getByRole('radio', { name: 'Pass' }).check();
    const evidenceLink = item.getByLabel('Evidence link');
    if (await evidenceLink.getAttribute('required') !== null) await evidenceLink.selectOption(document.id);
    const observedValue = item.locator('label').filter({ hasText: /^Observed value/ }).locator('input');
    if (await observedValue.count()) await observedValue.fill('2');
    const witnessName = item.getByLabel('Witness name');
    if (await witnessName.count()) await witnessName.fill('Browser Quality Witness');
    const witnessRole = item.getByLabel('Witness role');
    if (await witnessRole.count()) await witnessRole.fill('Quality lead');
  }
  await checklist.getByLabel('Inspection summary').fill('All hold-point acceptance criteria were checked against retained field evidence.');
  await checklist.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText(/0 failed items retained.*waiting for approval/i)).toBeVisible();

  let detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  let detail = (await detailResponse.json()).job;
  const inspection = detail.inspections.find(record => record.installationQc?.taskId === task.id);
  expect(inspection.installationQc.status).toBe('pending_review');
  const approval = detail.approvals.find(item => item.id === inspection.approvalId && item.status === 'pending');
  const approvalResponse = await request.post(`/api/ledger/approvals/${approval.id}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Browser quality approver',
      reason: 'Task, source basis, evidence, measurements, and witness records independently verified.'
    }
  });
  expect(approvalResponse.ok()).toBeTruthy();
  const completionResponse = await request.patch(`/api/ledger/jobs/${intake.job.id}/lifecycle/task/${task.id}`, {
    data: {
      status: 'completed',
      notes: 'Released installation hold point retained.',
      evidence: [document.id]
    }
  });
  expect(completionResponse.ok()).toBeTruthy();

  workspace = await openJob(page, title);
  control = workspace.getByTestId('inspection-checklist-control');
  const releasedRow = control.locator('.inspection-checklist-row').filter({ hasText: 'Installation quality control' }).first();
  await expect(releasedRow.getByText('released', { exact: true })).toBeVisible();
  await page.locator('header').getByLabel('Language', { exact: true }).selectOption('nl-NL');
  await expect(control.getByRole('heading', { name: 'Inspectiechecklists' })).toBeVisible();
  await expect(releasedRow.getByText('vrijgegeven', { exact: true })).toBeVisible();
  await expect(releasedRow).toContainText('Installation quality control');
  await expect(releasedRow).toContainText('Building C / Level 2 / Grid A3');
  await page.locator('header').getByLabel('Taal', { exact: true }).selectOption('en-GB');
  detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  detail = (await detailResponse.json()).job;
  expect(detail.tasks.find(candidate => candidate.id === task.id).status).toBe('completed');
  expect(detail.installationQcControls[0].readyForTaskCompletion).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await control.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(consoleErrors).toEqual([]);
});
