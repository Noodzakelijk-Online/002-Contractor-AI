const { test, expect } = require('@playwright/test');
const { expectNoAxeViolations } = require('./accessibility-helpers');

const OWNER_WORKSPACES = [
  'Today',
  'Pipeline',
  'Jobs',
  'Schedule',
  'Approvals',
  'Dispatch',
  'Resources',
  'Finance',
  'Performance',
  'Clients',
  'Field updates',
  'Operations'
];

async function createPortalFixture(request) {
  const marker = Date.now();
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title: `Accessibility portal job ${marker}`,
      service: 'Residential renovation',
      status: 'in_progress',
      client: { name: 'Accessibility portal client' },
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const job = (await intakeResponse.json()).job;
  const accessResponse = await request.post(`/api/ledger/jobs/${job.id}/client-portal-access`, {
    data: { label: `Accessibility portal ${marker}` }
  });
  expect(accessResponse.ok()).toBeTruthy();
  const access = (await accessResponse.json()).access;
  const approvalResponse = await request.post(`/api/ledger/approvals/${access.approval.id}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Accessibility approver',
      reason: 'The client identity, project scope, and portal expiry were verified.'
    }
  });
  expect(approvalResponse.ok()).toBeTruthy();
  return access.portalToken;
}

test('owner primary workspaces meet automated WCAG A and AA rules', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  for (const workspace of OWNER_WORKSPACES) {
    if (workspace !== 'Today') await page.getByRole('button', { name: workspace, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: workspace, exact: true })).toBeVisible();
    await expect(page.locator('.loading')).toHaveCount(0);
    await expect(page.locator('.error-banner')).toHaveCount(0);
    await expectNoAxeViolations(page, `${workspace} workspace`);
  }
});

test('representative owner dialogs meet automated WCAG A and AA rules', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();

  await page.getByRole('button', { name: 'New opportunity' }).first().click();
  const intakeDialog = page.getByRole('dialog', { name: 'New opportunity' });
  await expect(intakeDialog).toBeVisible();
  await expectNoAxeViolations(page, 'new opportunity dialog');
  await intakeDialog.getByRole('button', { name: 'Close opportunity' }).click();

  const setupPrompt = page.getByTestId('first-run-setup');
  await setupPrompt.getByRole('button', { name: 'Finish setup' }).click();
  const onboardingDialog = page.getByTestId('organization-onboarding');
  await expect(onboardingDialog).toBeVisible();
  await expectNoAxeViolations(page, 'business identity dialog');
  await onboardingDialog.getByRole('button', { name: 'Close business setup' }).click();

  await page.getByRole('button', { name: 'Performance', exact: true }).click();
  const frameworks = page.getByTestId('framework-workspace');
  await frameworks.getByPlaceholder('Search frameworks or families').fill('SWOT');
  await frameworks.getByRole('button', { name: 'Start SWOT' }).click();
  await expect(page.getByRole('dialog', { name: 'SWOT' })).toBeVisible();
  await expectNoAxeViolations(page, 'framework revision dialog');
});

test('mobile navigation and client portal meet automated WCAG A and AA rules', async ({ page, request }) => {
  const portalToken = await createPortalFixture(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expectNoAxeViolations(page, 'mobile owner dashboard');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeVisible();
  await expectNoAxeViolations(page, 'open mobile navigation');

  const portalResponse = await page.goto(`/client-portal.html#token=${portalToken}`);
  expect(portalResponse.ok()).toBeTruthy();
  await expect(page.getByRole('region', { name: 'Projectoverzicht' })).toBeVisible();
  await expectNoAxeViolations(page, 'mobile client portal');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expectNoAxeViolations(page, 'desktop client portal');
});
