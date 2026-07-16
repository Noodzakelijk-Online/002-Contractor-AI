const { test, expect } = require('@playwright/test');

test('operator calculates, approves, and revises a critical-path work plan', async ({ page, request }) => {
  const title = `Browser critical path ${Date.now()}`;
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Interior renovation',
      status: 'planned',
      scheduledStart: '2026-09-07T08:00:00.000Z',
      client: { name: 'Browser Schedule Client', email: 'browser-schedule@example.test', country: 'NL' },
      tasks: [
        { title: 'Prepare site', durationHours: 8, priority: 'high' },
        { title: 'Install work', durationHours: 16, priority: 'high' }
      ],
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const intake = await intakeResponse.json();
  const [prepareTask, installTask] = intake.job.tasks;

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  const workspace = page.getByTestId('job-workspace');
  const workPlan = workspace.getByTestId('job-task-control');
  await expect(workPlan.getByRole('heading', { name: 'Work plan' })).toBeVisible();
  await expect(workPlan.getByText('No approved baseline')).toBeVisible();
  await expect(workPlan.getByText('24h', { exact: true }).first()).toBeVisible();

  const dependencyForm = workPlan.locator('.dependency-form');
  await dependencyForm.getByLabel('Predecessor').selectOption(prepareTask.id);
  await dependencyForm.getByLabel('Successor').selectOption(installTask.id);
  await dependencyForm.getByRole('button', { name: 'Add link' }).click();
  await expect(workPlan.locator('.dependency-list')).toContainText('Prepare site');
  await expect(workPlan.locator('.dependency-list')).toContainText('Install work');

  await workPlan.getByLabel('Plan start').fill('2026-09-07T08:00');
  await workPlan.getByRole('button', { name: 'Calculate' }).click();
  await expect(workPlan.getByText('24h', { exact: true })).toHaveCount(2);
  await expect(workPlan.locator('.work-plan-task .tag-red')).toHaveCount(2);
  await expect(workPlan.getByText('2 tasks', { exact: true })).toBeVisible();

  await workPlan.getByRole('button', { name: 'Request baseline' }).click();
  await expect(workPlan.getByText('Baseline v1 pending')).toBeVisible();
  await workPlan.getByRole('button', { name: 'Review baseline v1' }).click();

  await expect(page.getByRole('heading', { name: 'Approval queue' })).toBeVisible();
  const approvalItem = page.locator('.approval-item').filter({ hasText: `Approve work-plan baseline v1 for ${title}` });
  await expect(approvalItem).toHaveCount(1);
  await approvalItem.getByRole('button', { name: 'Review and approve' }).click();
  const approvalModal = page.getByTestId('approval-review-modal');
  await approvalModal.getByLabel('Reviewer reason').fill('Task durations, sequence, float, and critical path verified.');
  await approvalModal.getByRole('button', { name: 'Confirm approval' }).click();

  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  const reopenedPlan = page.getByTestId('job-workspace').getByTestId('job-task-control');
  await expect(reopenedPlan.getByText('Baseline v1 current')).toBeVisible();
  await expect(reopenedPlan.getByText('7 sep 2026', { exact: false }).first()).toBeVisible();

  await reopenedPlan.getByLabel('Duration hours for Install work').fill('20');
  await reopenedPlan.getByRole('button', { name: 'Save duration for Install work' }).click();
  await expect(reopenedPlan.getByText('Baseline v1 stale')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await reopenedPlan.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
});
