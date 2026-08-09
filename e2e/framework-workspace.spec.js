const { test, expect } = require('@playwright/test');

test('operator searches, activates, reviews, and inspects a governed framework', async ({ page }) => {
  const marker = Date.now();

  await page.goto('/');
  await page.getByRole('button', { name: 'Performance', exact: true }).click();

  const workspace = page.getByTestId('framework-workspace');
  await expect(workspace.getByRole('heading', { name: 'Operating framework register' })).toBeVisible();
  await expect(workspace.getByText('671 frameworks across 23 operating families')).toBeVisible();
  await expect(workspace.getByText('0/23')).toBeVisible();

  await workspace.getByPlaceholder('Search frameworks or families').fill('SWOT');
  await expect(workspace.locator('.framework-table tbody tr')).toHaveCount(1);
  await expect(workspace.getByRole('row', { name: /SWOT/ })).toContainText('Strategy frameworks');
  await workspace.getByRole('button', { name: 'Start SWOT' }).click();

  let dialog = page.getByRole('dialog', { name: 'SWOT' });
  await expect(dialog.getByLabel('Scope')).toHaveValue('organization');
  await expect(dialog.getByText('Strategy frameworks', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Evidence candidates', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Review every 90 days', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Evidence candidates are prompts only and are never retained as proof automatically.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Use cadence and measures' }).click();
  await expect(dialog.getByLabel('Review due')).not.toHaveValue('');
  await expect(dialog.getByLabel('Success measures')).toHaveValue(/Strategic objective completion rate/);
  await expect(dialog.getByLabel('Evidence references')).toHaveValue('');
  await dialog.getByLabel('Objective', { exact: true }).fill(`Select the next operating priority from retained evidence ${marker}.`);
  await dialog.getByLabel('Owner').fill('Browser operations owner');
  await dialog.getByLabel('Review due').fill('2026-12-31');
  await dialog.getByLabel('Revision reason').fill('Create the browser-verified governed strategy review.');
  await dialog.getByRole('button', { name: 'Retain revision' }).click();

  await expect(workspace.getByText('SWOT retained.')).toBeVisible();
  await expect(workspace.getByRole('button', { name: /draft Organization/i })).toBeVisible();
  await workspace.getByRole('button', { name: /draft Organization/i }).click();

  dialog = page.getByRole('dialog', { name: 'SWOT' });
  await dialog.getByLabel('Status').selectOption('active');
  await dialog.getByLabel('Current state').fill('The operating priorities are discussed but not retained against current evidence.');
  await dialog.getByLabel('Target state').fill('The selected priority has a retained basis, accountable owner, and review trigger.');
  await dialog.getByLabel('Decision').fill('Prioritize recurring maintenance density before expanding the service portfolio.');
  await dialog.getByLabel('Evidence references').fill('scorecard:current\npipeline:current-forecast');
  await dialog.getByLabel('Success measures').fill('Recurring service revenue reaches 25 percent.');
  await dialog.getByLabel('Revision reason').fill('Activate the strategy after checking the retained operating evidence.');
  await dialog.getByRole('button', { name: 'Retain revision' }).click();

  await expect(workspace.getByRole('button', { name: /active Organization/i })).toBeVisible();
  await expect(workspace.getByText('1/23')).toBeVisible();
  await workspace.getByRole('button', { name: /active Organization/i }).click();
  dialog = page.getByRole('dialog', { name: 'SWOT' });
  await dialog.getByRole('button', { name: 'Revision history' }).click();
  const revisionList = dialog.locator('.framework-history ol');
  await expect(revisionList.locator('li')).toHaveCount(2);
  await expect(revisionList.getByText('Revision 2')).toBeVisible();
  await expect(revisionList.getByText('Revision 1')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close framework review' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(workspace.getByRole('heading', { name: 'Operating framework register' })).toBeVisible();
  const containment = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    tableClientWidth: document.querySelector('.framework-table-scroll')?.clientWidth || 0,
    tableScrollWidth: document.querySelector('.framework-table-scroll')?.scrollWidth || 0,
  }));
  expect(containment.documentWidth).toBeLessThanOrEqual(containment.viewportWidth + 1);
  expect(containment.tableScrollWidth).toBeGreaterThan(containment.tableClientWidth);
});
