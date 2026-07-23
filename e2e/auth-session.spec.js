const { test, expect } = require('@playwright/test');

const OFFICE_ACCESS_KEY = 'browser-office-token-at-least-32-characters';
const OWNER_ACCESS_KEY = 'browser-owner-token-at-least-32-characters';
const FIELD_ACCESS_KEY = 'browser-field-token-at-least-32-characters';
const FIELD_WORKER_ID = 'browser-field-task-worker';

test('office operator signs in through an HTTP-only role session and signs out cleanly', async ({ page, context }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Operator sign in' })).toBeVisible();
  const accessKey = page.locator('#operator-access-key');
  await expect(accessKey).toHaveAttribute('type', 'password');

  await accessKey.fill('invalid-access-key-that-is-long-enough');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('not valid');

  await accessKey.fill(OFFICE_ACCESS_KEY);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.locator('.operator-session')).toContainText('office operator');
  await expect(page.getByRole('button', { name: 'New opportunity' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approvals' })).toHaveCount(0);

  const cookies = await context.cookies();
  const sessionCookie = cookies.find(cookie => cookie.name === 'contractor_ai_session');
  expect(sessionCookie).toBeTruthy();
  expect(sessionCookie.httpOnly).toBe(true);
  expect(sessionCookie.sameSite).toBe('Strict');
  expect(sessionCookie.secure).toBe(false);
  expect(await page.content()).not.toContain(OFFICE_ACCESS_KEY);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.locator('.operator-session')).toContainText('office operator');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Operator sign in' })).toBeVisible();
  expect((await context.cookies()).some(cookie => cookie.name === 'contractor_ai_session')).toBe(false);

  const denied = await page.request.get('/api/ledger/jobs');
  expect(denied.status()).toBe(401);
  expect((await denied.json()).error.code).toBe('authentication_required');
});

test('field worker opens an assigned job and completes only the scoped task', async ({ page, request }) => {
  const ownerHeaders = { 'X-Contractor-AI-Token': OWNER_ACCESS_KEY };
  const workerResponse = await request.post('/api/ledger/workers', {
    headers: ownerHeaders,
    data: { id: FIELD_WORKER_ID, name: 'Browser Field Task Worker', role: 'carpenter', status: 'available' }
  });
  expect(workerResponse.ok()).toBeTruthy();

  const intakeResponse = await request.post('/api/ledger/intake', {
    headers: ownerHeaders,
    data: {
      title: 'Authenticated field task job',
      service: 'interior fit-out',
      contractValue: 9250,
      client: { name: 'Private field client', email: 'private-field@example.test' }
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const intake = await intakeResponse.json();
  const assignmentResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/assignments`, {
    headers: ownerHeaders,
    data: { workerId: FIELD_WORKER_ID, status: 'planned' }
  });
  expect(assignmentResponse.ok()).toBeTruthy();
  const taskResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/tasks`, {
    headers: ownerHeaders,
    data: { title: 'Install scoped field blocking', assigneeId: FIELD_WORKER_ID, priority: 'high' }
  });
  expect(taskResponse.ok()).toBeTruthy();

  await page.goto('/');
  await page.locator('#operator-access-key').fill(FIELD_ACCESS_KEY);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.operator-session')).toContainText('Browser Field Task Worker');
  await expect(page.locator('.operator-session')).toHaveAttribute('title', 'field worker');
  await page.getByRole('button', { name: `Open ${intake.job.title}` }).first().click();

  const workspace = page.getByTestId('job-workspace');
  await expect(workspace.getByRole('heading', { name: intake.job.title })).toBeVisible();
  await expect(workspace.getByText('Field-scoped job workspace')).toBeVisible();
  await expect(page.locator('.error-banner')).toHaveCount(0);
  const taskRow = workspace.locator('.work-plan-task').filter({ hasText: 'Install scoped field blocking' });
  await expect(taskRow).toHaveCount(1);
  await taskRow.getByRole('button', { name: 'Complete Install scoped field blocking' }).click();
  const taskModal = page.getByTestId('task-action-modal');
  await taskModal.getByLabel('Evidence and outcome').fill('Scoped field completion checked against the assigned work package.');
  await taskModal.getByRole('button', { name: 'Mark completed' }).click();
  await expect(taskRow.getByText('completed', { exact: true })).toBeVisible();

  const closeout = workspace.getByTestId('closeout-register');
  await expect(closeout.getByRole('heading', { name: 'Closeout and aftercare' })).toBeVisible();
  await expect(closeout.getByRole('tab', { name: /Warranty/ })).toHaveCount(0);
  await expect(closeout.getByRole('tab', { name: /Aftercare/ })).toHaveCount(0);
  await closeout.getByRole('button', { name: 'New punch item' }).click();
  const punchForm = closeout.getByTestId('closeout-punch_item-form');
  await punchForm.getByLabel('Punch title').fill('Field-scoped trim correction');
  await punchForm.getByLabel('Assigned to').fill('Browser Field Task Worker');
  await punchForm.getByLabel('Location').fill('Assigned work area');
  await punchForm.getByLabel('Observed condition').fill('Trim edge remains incomplete in the assigned field work area.');
  await punchForm.getByRole('button', { name: 'Retain punch item' }).click();
  await expect(closeout.getByText('Field-scoped trim correction')).toBeVisible();
  await expect(closeout.getByRole('button', { name: 'Resolve punch' })).toHaveCount(0);

  const fieldDetail = await page.request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(fieldDetail.ok()).toBeTruthy();
  const projected = await fieldDetail.json();
  expect(projected.job.contractValue).toBeUndefined();
  expect(projected.job.communications).toEqual([]);
  expect(projected.job.tasks).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: 'Install scoped field blocking', status: 'completed' })
  ]));
  expect(projected.job.punchItems).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: 'Field-scoped trim correction', status: 'open' })
  ]));
  expect(projected.job.punchItems[0].data).toBeUndefined();
});

test('field worker completes a live LMRA, then records changed-condition stop-work on mobile', async ({ page, request }) => {
  const ownerHeaders = { 'X-Contractor-AI-Token': OWNER_ACCESS_KEY };
  const fieldHeaders = { 'X-Contractor-AI-Token': FIELD_ACCESS_KEY };
  const suffix = Date.now();
  expect((await request.post('/api/ledger/workers', {
    headers: ownerHeaders,
    data: { id: FIELD_WORKER_ID, name: 'Browser Field Task Worker', role: 'installer', status: 'available' }
  })).ok()).toBeTruthy();
  const intakeResponse = await request.post('/api/ledger/intake', {
    headers: ownerHeaders,
    data: {
      title: `Authenticated LMRA job ${suffix}`,
      client: { name: 'LMRA browser client' },
      status: 'in_progress',
      riskLevel: 'high',
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const job = (await intakeResponse.json()).job;
  expect((await request.post(`/api/ledger/jobs/${job.id}/assignments`, {
    headers: ownerHeaders,
    data: { workerId: FIELD_WORKER_ID, workerName: 'Browser Field Task Worker', role: 'installer', status: 'assigned' }
  })).ok()).toBeTruthy();
  const jhaResponse = await request.post(`/api/ledger/jobs/${job.id}/jhas`, {
    headers: ownerHeaders,
    data: {
      title: `Browser LMRA JHA ${suffix}`,
      status: 'approved',
      riskLevel: 'high',
      hazards: ['Stored electrical energy'],
      controls: ['Lock, tag, test, and prove dead']
    }
  });
  expect(jhaResponse.ok()).toBeTruthy();
  const jha = (await jhaResponse.json()).jha;
  expect((await request.post(`/api/ledger/approvals/${jha.approval.id}/resolve`, {
    headers: ownerHeaders,
    data: { status: 'approved', resolvedBy: 'Browser owner', reason: 'LMRA JHA verified for the field flow.' }
  })).ok()).toBeTruthy();
  const planResponse = await request.post(`/api/ledger/jobs/${job.id}/pre-task-plans`, {
    headers: ownerHeaders,
    data: {
      entryKey: `browser-lmra-plan-${suffix}`,
      workDate: new Date().toISOString().slice(0, 10),
      shiftLabel: 'Day shift',
      title: 'Install isolated distribution equipment',
      location: 'Main plant room',
      preparedBy: 'Browser supervisor',
      responsibleWorkerId: FIELD_WORKER_ID,
      jhaId: jha.id,
      evidenceReference: `browser-lmra-method:${suffix}`,
      steps: [{
        stepKey: 'install',
        description: 'Install isolated distribution equipment',
        hazards: ['Stored electrical energy'],
        controls: ['Verify isolation before work']
      }]
    }
  });
  expect(planResponse.ok()).toBeTruthy();
  const planResult = await planResponse.json();
  expect((await request.post(`/api/ledger/approvals/${planResult.approval.id}/resolve`, {
    headers: ownerHeaders,
    data: { status: 'approved', resolvedBy: 'Browser owner', reason: 'LMRA plan and frozen worker verified.' }
  })).ok()).toBeTruthy();
  expect((await request.post(`/api/ledger/jobs/${job.id}/pre-task-plans/${planResult.preTaskPlan.id}/acknowledgments`, {
    headers: fieldHeaders,
    data: {
      entryKey: `browser-lmra-plan-ack-${suffix}`,
      acknowledged: true,
      evidenceReference: `browser-lmra-worker-device:${suffix}`
    }
  })).ok()).toBeTruthy();

  await page.goto('/');
  await page.locator('#operator-access-key').fill(FIELD_ACCESS_KEY);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  const panel = page.getByTestId('lmra-control');
  await expect(panel.getByRole('heading', { name: 'Last-minute risk assessment' })).toBeVisible();
  const selectors = panel.locator('.lmra-selector select');
  await selectors.nth(0).selectOption(job.id);
  await expect(selectors.nth(1).locator(`option[value="${planResult.preTaskPlan.id}"]`)).toHaveCount(1);
  await selectors.nth(1).selectOption(planResult.preTaskPlan.id);
  await expect(panel.getByText('Plan and worker acknowledgement are current.')).toBeVisible();

  await panel.getByLabel('Activity', { exact: true }).fill('Install isolated distribution equipment');
  await panel.getByLabel('Work area', { exact: true }).fill('Main plant room');
  await panel.getByLabel('Evidence reference', { exact: true }).fill(`browser-live-lmra:${suffix}`);
  for (const checkbox of await panel.locator('.lmra-check input').all()) await checkbox.check();
  await panel.locator('.lmra-attestation input').check();
  await panel.getByRole('button', { name: 'Validate and retain LMRA' }).click();
  await expect(page.getByText(/LMRA ready until/)).toBeVisible();
  await expect(panel.locator('.lmra-row').first()).toContainText('ready');

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await panel.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    panelWidth: element.scrollWidth,
    panelClientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.panelWidth).toBeLessThanOrEqual(geometry.panelClientWidth + 1);

  await panel.getByLabel('Activity', { exact: true }).fill('Restart installation after nearby lift');
  await panel.getByLabel('Work area', { exact: true }).fill('Main plant room');
  await panel.getByLabel('Evidence reference', { exact: true }).fill(`browser-stop-lmra:${suffix}`);
  const checks = panel.locator('.lmra-check input');
  for (let index = 0; index < 6; index += 1) await checks.nth(index).check();
  await panel.getByLabel('Stop-work reason', { exact: true }).fill('An unplanned lifting operation entered the controlled work area.');
  await panel.getByRole('button', { name: 'Retain stop-work LMRA' }).click();
  await expect(page.getByText('Stop-work LMRA retained. Resolve the condition and complete a linked reassessment.')).toBeVisible();
  await expect(panel.locator('.lmra-row').first()).toContainText('stop work');
});
