const { test, expect } = require('@playwright/test');

async function postJson(request, route, data) {
  const response = await request.post(route, { data });
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function approve(request, approvalId, reason) {
  return postJson(request, `/api/ledger/approvals/${approvalId}/resolve`, {
    status: 'approved',
    resolvedBy: 'Browser attendance approver',
    reason
  });
}

test('site attendance drives the live labor board, offline retry, and mobile field layout', async ({ page, request, context }) => {
  const suffix = Date.now();
  const worker = (await postJson(request, '/api/ledger/workers', {
    name: `Browser attendance crew ${suffix}`,
    role: 'Installer',
    status: 'available'
  })).worker;
  const job = (await postJson(request, '/api/ledger/intake', {
    title: `Browser attendance site ${suffix}`,
    service: 'Interior installation',
    address: 'Europalaan 100, Utrecht',
    client: { name: 'Browser attendance client' },
    status: 'in_progress',
    assignAutomatically: false
  })).job;
  let assignment = (await postJson(request, `/api/ledger/jobs/${job.id}/assignments`, {
    workerId: worker.id,
    role: 'Installer',
    status: 'active'
  })).assignment;
  if (assignment.approval?.id) {
    await approve(request, assignment.approval.id, 'Browser crew assignment and availability verified.');
    const detail = (await (await request.get(`/api/ledger/jobs/${job.id}`)).json()).job;
    assignment = detail.assignments.find(item => item.id === assignment.id);
  }
  const orientation = (await postJson(request, `/api/ledger/jobs/${job.id}/orientations`, {
    assignmentId: assignment.id,
    workerId: worker.id,
    workerName: worker.name,
    status: 'completed',
    topics: ['site access', 'emergency routes']
  })).orientation;
  await approve(request, orientation.approvalId, 'Browser orientation identity and site topics verified.');
  const access = (await postJson(request, `/api/ledger/jobs/${job.id}/site-access`, {
    assignmentId: assignment.id,
    workerId: worker.id,
    workerName: worker.name,
    orientationId: orientation.id,
    orientationValid: true,
    status: 'cleared',
    accessPoint: 'North gate'
  })).siteAccessLog;
  await approve(request, access.approvalId, 'Browser assignment-scoped access evidence verified.');

  await page.goto('/');
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  const control = page.getByTestId('attendance-control');
  await expect(control.getByRole('heading', { name: 'Site attendance' })).toBeVisible();
  await control.getByLabel('Job').selectOption(job.id);
  await control.getByLabel('Crew member').selectOption(worker.id);
  await control.getByLabel('Access point').fill('North gate');
  await control.getByLabel('Attendance note').fill('Started assigned installation work.');
  await control.getByRole('button', { name: 'Check in', exact: true }).click();

  await expect(page.getByText('Check-in retained on the live labor board.')).toBeVisible();
  await expect(control.locator('.attendance-row strong').filter({ hasText: worker.name })).toBeVisible();
  await expect(control.getByText('1 on site')).toBeVisible();
  await expect(control.getByRole('button', { name: 'Check out', exact: true })).toBeVisible();
  await control.getByRole('button', { name: 'Check out', exact: true }).click();
  await expect(page.getByText('Check-out retained on the live labor board.')).toBeVisible();
  await expect(control.getByText('0 on site')).toBeVisible();

  await context.setOffline(true);
  await control.getByRole('button', { name: 'Save check-in offline', exact: true }).click();
  await expect(page.getByText('Check-in was saved locally for an exact retry.')).toBeVisible();
  await expect(page.getByText('1 queued').first()).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Outbox clear')).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => {
    const response = await request.get(`/api/ledger/jobs/${job.id}/attendance`);
    if (!response.ok()) return null;
    return (await response.json()).attendance.summary.checkedIn;
  }, { timeout: 15_000 }).toBe(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(control).toBeVisible();
  const geometry = await page.evaluate(() => {
    const attendanceControl = document.querySelector('[data-testid="attendance-control"]');
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      controlWidth: attendanceControl?.scrollWidth || 0,
      controlClientWidth: attendanceControl?.clientWidth || 0
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.controlWidth).toBeLessThanOrEqual(geometry.controlClientWidth);
});
