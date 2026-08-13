const { test, expect } = require('@playwright/test');

test('operator qualifies an opportunity, retains internal activity, and converts one linked job', async ({ page, request }) => {
  const title = `Browser pipeline ${Date.now()}`;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

  await page.getByRole('button', { name: 'New opportunity' }).click();
  const editor = page.getByTestId('opportunity-modal');
  await expect(editor.getByRole('heading', { name: 'New opportunity' })).toBeVisible();
  await editor.getByLabel('Client name').fill('Browser Pipeline Client');
  await editor.getByLabel('Email').fill('pipeline-browser@example.test');
  await editor.getByLabel('Opportunity title').fill(title);
  await editor.getByLabel('Service').fill('Energy retrofit');
  await editor.getByLabel('Estimated value').fill('24000');
  await editor.getByLabel('Source').fill('referral');
  await editor.getByLabel('Owner').fill('Utrecht office');
  await editor.getByLabel('Next follow-up').fill('2026-07-20T09:00');
  await editor.getByLabel('Decision target').fill('2026-08-01T12:00');
  await editor.getByLabel('City').fill('Utrecht');
  await editor.getByLabel('Scope and qualification notes').fill('Confirm insulation scope, access, subsidy assumptions, and client decision process.');
  await editor.getByRole('button', { name: 'Retain opportunity' }).click();
  await expect(page.getByText('Opportunity retained in the preconstruction pipeline.')).toBeVisible();

  const jobsBefore = await request.get(`/api/ledger/jobs?search=${encodeURIComponent(title)}&limit=100`);
  expect(jobsBefore.ok()).toBeTruthy();
  expect((await jobsBefore.json()).jobs).toHaveLength(0);

  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  const pipeline = page.getByTestId('pipeline-workspace');
  await expect(pipeline.getByRole('heading', { name: 'Preconstruction pipeline' })).toBeVisible();
  const row = pipeline.locator('.pipeline-row').filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('€24,000.00');
  await expect(row).toContainText('€2,400.00');

  await row.getByRole('button', { name: 'Follow-up' }).click();
  const activityModal = page.getByTestId('opportunity-activity-modal');
  await activityModal.getByLabel('Activity type').selectOption('qualification');
  await activityModal.getByLabel('Due').fill('2026-07-20T09:00');
  await activityModal.getByLabel('Summary').fill('Confirm subsidy and access assumptions');
  await activityModal.getByLabel('Internal notes').fill('Office review only; do not send until contact details and scope are confirmed.');
  await activityModal.getByRole('button', { name: 'Retain activity' }).click();
  await expect(page.getByText('Internal opportunity activity retained. No external message was sent.')).toBeVisible();

  await row.getByRole('button', { name: `Open ${title}` }).click();
  const detail = pipeline.locator('.pipeline-detail');
  await expect(detail.getByRole('heading', { name: title })).toBeVisible();
  await expect(detail.getByText('Confirm subsidy and access assumptions')).toBeVisible();
  await detail.getByRole('button', { name: 'Complete' }).click();
  await expect(page.getByText('Opportunity activity completed in the internal ledger.')).toBeVisible();
  await expect(detail.getByText('completed', { exact: true })).toBeVisible();

  await row.getByRole('button', { name: 'Create job' }).click();
  await expect(page.getByText('Qualified opportunity converted to an internal job. No external commitment was made.')).toBeVisible();
  const jobsAfter = await request.get(`/api/ledger/jobs?search=${encodeURIComponent(title)}&limit=100`);
  expect(jobsAfter.ok()).toBeTruthy();
  expect((await jobsAfter.json()).jobs).toHaveLength(1);
  await expect(row.getByRole('button', { name: `Open linked job for ${title}` })).toBeVisible();
  await row.getByRole('button', { name: `Open linked job for ${title}` }).click();
  await expect(page.getByTestId('job-workspace').getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('button', { name: 'Close job workspace' }).click();
  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await pipeline.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
});
