const { test, expect } = require('@playwright/test');

test('operator governs KPI targets and freezes the Contractor Balanced Scorecard', async ({ page }) => {
  const marker = Date.now();

  await page.goto('/');
  await page.getByRole('button', { name: 'Performance', exact: true }).click();

  const scorecard = page.getByTestId('performance-scorecard');
  await expect(scorecard.getByRole('heading', { name: 'Contractor Balanced Scorecard' })).toBeVisible();
  await expect(scorecard.getByRole('tab')).toHaveCount(10);
  await expect(scorecard.getByTestId('performance-metric-table').locator('tbody tr')).toHaveCount(2);
  await expect(scorecard.getByText('23 governed KPIs')).toBeVisible();
  await expect(scorecard.getByText('No data', { exact: true }).first()).toBeVisible();

  const today = new Date().toISOString().slice(0, 10);
  const historicalPeriodEnd = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await scorecard.getByLabel('Period end').fill(historicalPeriodEnd);
  await scorecard.getByRole('button', { name: 'Recalculate' }).click();
  await expect(scorecard.getByText(/9 point-in-time KPI\(s\) are unavailable for a past period/)).toBeVisible();
  await scorecard.getByRole('tab', { name: /^Quality/ }).click();
  await expect(scorecard.getByText('Historical position unavailable').first()).toBeVisible();
  await scorecard.getByLabel('Period end').fill(today);
  await scorecard.getByRole('button', { name: 'Recalculate' }).click();
  await expect(scorecard.getByText(/point-in-time KPI\(s\) are unavailable for a past period/)).toHaveCount(0);

  const expectedMetricCounts = {
    Safety: 2,
    Quality: 2,
    Delivery: 2,
    Customer: 5,
    People: 2,
    Financial: 2,
    Commercial: 2,
    Assets: 2,
    Compliance: 2,
    Sustainability: 2,
  };
  for (const [name, metricCount] of Object.entries(expectedMetricCounts)) {
    await scorecard.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
    await expect(scorecard.getByTestId('performance-metric-table').locator('tbody tr')).toHaveCount(metricCount);
  }

  await scorecard.getByRole('tab', { name: /^Quality/ }).click();
  await scorecard.getByRole('button', { name: 'Revise Inspection pass rate target' }).click();
  const targetModal = page.getByRole('dialog', { name: 'Inspection pass rate' });
  await targetModal.getByLabel('Target (%)').fill('92');
  await targetModal.getByLabel('Revision reason').fill(`Browser QA quality threshold retained under review ${marker}.`);
  await targetModal.getByRole('button', { name: 'Request approval' }).click();
  await expect(scorecard.getByText('Inspection pass rate target revision retained for approval.')).toBeVisible();
  await expect(scorecard.getByText('Pending targets').locator('..').getByText('1', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /^Approvals/ }).click();
  const targetApproval = page.locator('.approval-item').filter({ hasText: 'Approve Inspection pass rate target revision' });
  await expect(targetApproval).toHaveCount(1);
  await targetApproval.getByRole('button', { name: 'Review and approve' }).click();
  let reviewModal = page.getByTestId('approval-review-modal');
  await expect(reviewModal.getByText(/retains its complete history/i)).toBeVisible();
  await reviewModal.getByLabel('Reviewer reason').fill('Browser QA verified the KPI definition, comparison direction, and management threshold.');
  await reviewModal.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Performance', exact: true }).click();
  await scorecard.getByRole('tab', { name: /^Quality/ }).click();
  await expect(scorecard.getByText('Approved revision')).toBeVisible();
  await scorecard.getByRole('button', { name: 'Freeze scorecard' }).click();
  await expect(scorecard.getByText(/BSC-\d{4}-\d{6} retained for approval\. No external action was created\./)).toBeVisible();
  await scorecard.getByRole('button', { name: 'Review snapshot' }).click();

  const scorecardApproval = page.locator('.approval-item').filter({ hasText: /Approve Contractor Balanced Scorecard BSC-/ });
  await expect(scorecardApproval).toHaveCount(1);
  await scorecardApproval.getByRole('button', { name: 'Review and approve' }).click();
  reviewModal = page.getByTestId('approval-review-modal');
  await expect(reviewModal.getByText(/Missing evidence never counts as passing/i)).toBeVisible();
  await reviewModal.getByLabel('Reviewer reason').fill('Browser QA verified the period, retained sources, approved target register, and missing-evidence treatment.');
  await reviewModal.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Performance', exact: true }).click();
  await expect(scorecard.getByText('Current snapshot')).toBeVisible();
  await expect(scorecard.getByText(/BSC-\d{4}-\d{6}/)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(scorecard.getByRole('heading', { name: 'Contractor Balanced Scorecard' })).toBeVisible();
  const containment = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    tableClientWidth: document.querySelector('.performance-table-scroll')?.clientWidth || 0,
    tableScrollWidth: document.querySelector('.performance-table-scroll')?.scrollWidth || 0,
  }));
  expect(containment.documentWidth).toBeLessThanOrEqual(containment.viewportWidth + 1);
  expect(containment.tableScrollWidth).toBeGreaterThan(containment.tableClientWidth);
});
