const { test, expect } = require('@playwright/test');

async function postJson(request, route, data) {
  const response = await request.post(route, { data });
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function approve(request, approvalId, reason) {
  return postJson(request, `/api/ledger/approvals/${approvalId}/resolve`, {
    status: 'approved',
    resolvedBy: 'Browser pre-task approver',
    reason
  });
}

async function openPlan(page, jobId, planId = '') {
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  const panel = page.getByTestId('pre-task-plan-control');
  await expect(panel.getByRole('heading', { name: 'Pre-task plans' })).toBeVisible();
  const selectors = panel.locator('.pre-task-selector select');
  await selectors.nth(0).selectOption(jobId);
  if (planId) {
    await expect(selectors.nth(1).locator(`option[value="${planId}"]`)).toHaveCount(1);
    await selectors.nth(1).selectOption(planId);
  } else {
    await expect(selectors.nth(1)).toContainText('No retained plan');
  }
  return panel;
}

test('pre-task release, crew activation, revision, stop work, closeout, and mobile layout stay connected', async ({ page, request }) => {
  const suffix = Date.now();
  const workers = [];
  for (const role of ['Lead installer', 'Site operative']) {
    workers.push((await postJson(request, '/api/ledger/workers', {
      name: `Browser pre-task ${role.toLowerCase()} ${suffix}`,
      role,
      status: 'available'
    })).worker);
  }
  const job = (await postJson(request, '/api/ledger/intake', {
    title: `Browser pre-task project ${suffix}`,
    client: { name: 'Browser pre-task client' },
    status: 'in_progress',
    riskLevel: 'high',
    assignAutomatically: false
  })).job;
  for (const worker of workers) {
    const assignment = await postJson(request, `/api/ledger/jobs/${job.id}/assignments`, {
      workerId: worker.id,
      workerName: worker.name,
      role: worker.role,
      status: 'assigned'
    });
    if (assignment.approval?.id) {
      await approve(request, assignment.approval.id, 'Worker identity, role, availability, and project assignment verified.');
    }
  }
  const jha = (await postJson(request, `/api/ledger/jobs/${job.id}/jhas`, {
    title: `Browser approved installation JHA ${suffix}`,
    status: 'approved',
    riskLevel: 'high',
    hazards: ['Stored energy', 'Restricted access'],
    controls: ['Isolation and lockout', 'Controlled access'],
    stopWorkTriggers: ['Isolation boundary changes']
  })).jha;
  await approve(request, jha.approval.id, 'Hazards, controls, and stop-work basis verified.');

  await page.goto('/');
  let panel = await openPlan(page, job.id);
  const editor = panel.locator('.pre-task-create');
  const title = `Distribution installation plan ${suffix}`;
  await editor.getByLabel('Title', { exact: true }).fill(title);
  await editor.getByLabel('Location', { exact: true }).fill('Main plant room');
  await editor.getByLabel('Prepared by', { exact: true }).fill('Browser site supervisor');
  const responsibleWorker = editor.locator('label').filter({ hasText: /^Responsible worker/ }).locator('select');
  const approvedJha = editor.locator('label').filter({ hasText: /^Approved JHA/ }).locator('select');
  await expect(responsibleWorker.locator(`option[value="${workers[0].id}"]`)).toHaveCount(1);
  await responsibleWorker.selectOption(workers[0].id);
  await expect(approvedJha.locator(`option[value="${jha.id}"]`)).toHaveCount(1);
  await approvedJha.selectOption(jha.id);
  await editor.getByLabel('Source evidence', { exact: true }).fill(`browser-method-statement:${suffix}`);
  await editor.getByLabel('Emergency arrangements', { exact: true }).fill('Use the east stair and report to the assembly point.');
  await editor.getByLabel('Stop-work triggers', { exact: true }).fill('Isolation boundary changes\nUnplanned simultaneous operations');
  await editor.getByLabel('Description', { exact: true }).fill('Isolate the supply and install the distribution equipment');
  await editor.getByLabel('Hazards', { exact: true }).fill('Stored electrical energy\nManual handling');
  await editor.getByLabel('Controls', { exact: true }).fill('Lock, tag, and test\nUse the planned lifting aid');
  await editor.getByRole('button', { name: 'Request release' }).click();
  await expect(page.getByText('Plan sources, steps, controls, and assigned crew were frozen for approval.')).toBeVisible();

  const plansResponse = await request.get(`/api/ledger/jobs/${job.id}/pre-task-plans`);
  expect(plansResponse.ok()).toBeTruthy();
  const plan = (await plansResponse.json()).preTaskPlans.find(record => record.title === title);
  expect(plan).toBeTruthy();
  expect(plan.status).toBe('pending_approval');
  expect(plan.attendees).toHaveLength(2);
  await approve(request, plan.approvalId, 'Linked JHA, work steps, controls, work date, and frozen crew verified.');

  await page.reload();
  panel = await openPlan(page, job.id, plan.id);
  await expect(panel.locator('.pre-task-state .status')).toHaveText('approved waiting acknowledgement');
  await expect(panel.getByText('2 assigned worker acknowledgements are outstanding.')).toBeVisible();
  await expect(panel.getByText('Stored electrical energy')).toBeVisible();
  await expect(panel.locator('.pre-task-attendees').getByText(workers[0].name, { exact: true })).toBeVisible();
  await expect(panel.locator('.pre-task-attendees').getByText(workers[1].name, { exact: true })).toBeVisible();

  for (const [index, worker] of workers.entries()) {
    await postJson(request, `/api/ledger/jobs/${job.id}/pre-task-plans/${plan.id}/acknowledgments`, {
      entryKey: `browser-pre-task-ack-${index + 1}-${suffix}`,
      workerId: worker.id,
      acknowledged: true,
      acknowledgedAt: new Date().toISOString(),
      evidenceReference: `browser-worker-attestation:${index + 1}:${suffix}`,
      attestation: 'I reviewed the retained plan and stop-work triggers.'
    });
  }

  await page.reload();
  panel = await openPlan(page, job.id, plan.id);
  await expect(panel.locator('.pre-task-state .status')).toHaveText('active');
  await expect(panel.getByText('Plan verified', { exact: true })).toBeVisible();
  await expect(panel.getByText('Sources current', { exact: true })).toBeVisible();
  await expect(panel.locator('.pre-task-attendees').getByText('acknowledged', { exact: true })).toHaveCount(2);
  await panel.getByRole('button', { name: 'Revise' }).click();
  await expect(panel.locator('.pre-task-create-heading')).toContainText('Prepare revision');
  await expect(panel.locator('.pre-task-create').getByLabel('Title', { exact: true })).toHaveValue(title);
  await expect(panel.locator('.pre-task-create label').filter({ hasText: /^Approved JHA/ }).locator('select')).toHaveValue(jha.id);

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await panel.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    panelWidth: element.scrollWidth,
    panelClientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.panelWidth).toBeLessThanOrEqual(geometry.panelClientWidth + 1);

  const suspension = panel.locator('.pre-task-suspension');
  await suspension.getByLabel('Reason', { exact: true }).fill('Isolation boundary changed during the planned installation.');
  await suspension.getByLabel('Evidence reference', { exact: true }).fill(`browser-stop-work:${suffix}`);
  await suspension.getByRole('button', { name: 'Suspend' }).click();
  await expect(page.getByText('Plan suspended. Work must remain stopped until an approved revision is issued.')).toBeVisible();
  await expect(panel.locator('.pre-task-state .status')).toHaveText('suspended');

  const closeout = panel.locator('.pre-task-closure');
  await closeout.getByLabel('Completion note', { exact: true }).fill('Work stopped safely and the plant room was formally handed back.');
  await closeout.getByLabel('Closeout evidence', { exact: true }).fill(`browser-plan-closeout:${suffix}`);
  await closeout.getByRole('button', { name: 'Close plan' }).click();
  await expect(page.getByText('Pre-task plan closed with retained handback evidence.')).toBeVisible();
  await expect(panel.locator('.pre-task-state .status')).toHaveText('closed');

  const retainedResponse = await request.get(`/api/ledger/jobs/${job.id}/pre-task-plans`);
  expect(retainedResponse.ok()).toBeTruthy();
  const retained = (await retainedResponse.json()).preTaskPlans.find(record => record.id === plan.id);
  expect(retained.status).toBe('closed');
  expect(retained.definitionIntegrityValid).toBe(true);
  expect(retained.closureEvidenceReference).toBe(`browser-plan-closeout:${suffix}`);
});
