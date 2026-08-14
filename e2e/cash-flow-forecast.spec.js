const { test, expect } = require('@playwright/test');
const { expectNoAxeViolations } = require('./accessibility-helpers');

function dateInput(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

test('operator retains, approves, and archives a 13-week cash-flow assumption', async ({ page }) => {
  const key = Date.now();
  const title = `Browser payroll reserve ${key}`;

  await page.goto('/');
  await page.getByRole('button', { name: 'Finance', exact: true }).click();

  const finance = page.getByTestId('finance-workspace');
  const cashFlow = finance.getByTestId('cash-flow-control');
  await expect(cashFlow.getByRole('heading', { name: '13-week cash-flow forecast' })).toBeVisible();
  await expect(cashFlow.getByTestId('cash-flow-week-row')).toHaveCount(13);
  await page.getByRole('combobox', { name: 'Language' }).selectOption('nl-NL');
  await expect(cashFlow.getByRole('heading', { name: 'Liquiditeitsprognose voor 13 weken' })).toBeVisible();
  await expect(cashFlow.getByLabel('Beginsaldo kas')).toBeVisible();
  await expectNoAxeViolations(page, 'Dutch cash-flow forecast');
  await page.reload();
  await page.getByRole('button', { name: 'Financien', exact: true }).click();
  await expect(cashFlow.getByRole('heading', { name: 'Liquiditeitsprognose voor 13 weken' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Taal' }).selectOption('en-GB');
  await expect(cashFlow.getByRole('heading', { name: '13-week cash-flow forecast' })).toBeVisible();

  await cashFlow.getByLabel('Opening cash').fill('2500');
  await cashFlow.getByRole('button', { name: 'Recalculate' }).click();
  await expect(cashFlow.getByLabel('Opening cash')).toHaveValue('2500');

  await cashFlow.getByRole('button', { name: 'Add assumption' }).click();
  const form = cashFlow.getByTestId('cash-flow-assumption-form');
  await form.getByLabel('Assumption').fill(title);
  await form.getByLabel('Category').selectOption('payroll');
  await form.getByLabel('Amount').fill('275');
  await form.getByLabel('Expected date').fill(dateInput(2));
  await form.locator('input[type="range"]').fill('85');
  await form.getByLabel('Source reference').fill(`BROWSER-CASH-${key}`);
  await form.getByRole('button', { name: 'Retain assumption' }).click();

  await expect(cashFlow.getByText('Cash-flow assumption retained. No payment or external commitment was created.')).toBeVisible();
  const assumption = cashFlow.locator('.cash-flow-assumption').filter({ hasText: title });
  await expect(assumption).toHaveCount(1);
  await expect(cashFlow.getByTestId('cash-flow-week-row')).toHaveCount(13);

  await cashFlow.getByRole('button', { name: 'Request approval' }).click();
  await expect(cashFlow.getByText(/CF-\d{4}-\d{6} retained for approval\. No funds were moved\./)).toBeVisible();
  await cashFlow.getByRole('button', { name: 'Review approval' }).click();

  const approval = page.locator('.approval-item').filter({ hasText: 'Approve 13-week cash-flow forecast' });
  await expect(approval).toHaveCount(1);
  await approval.getByRole('button', { name: 'Review and approve' }).click();
  const modal = page.getByTestId('approval-review-modal');
  await expect(modal.getByText(/Approval is refused if a retained assumption.*opening balance.*changed after the snapshot request/i)).toBeVisible();
  await modal.getByLabel('Reviewer reason').fill('Browser QA verified opening cash, source timing, recurrence, and confidence evidence.');
  await modal.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  await expect(cashFlow.locator('.tag').filter({ hasText: /CF-\d{4}-\d{6} current/ })).toHaveCount(1);

  await assumption.getByRole('button', { name: `Archive ${title}` }).click();
  const archive = cashFlow.locator('.cash-flow-archive');
  await archive.getByLabel('Archive reason').fill('Browser QA assumption lifecycle completed and the reserve is no longer active.');
  await archive.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(cashFlow.getByText('Assumption archived with its history retained.')).toBeVisible();
  await expect(assumption).toHaveCount(0);
  await expect(cashFlow.locator('.tag').filter({ hasText: /CF-\d{4}-\d{6} stale/ })).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cashFlow.getByRole('heading', { name: '13-week cash-flow forecast' })).toBeVisible();
  const containment = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    tableClientWidth: document.querySelector('.cash-flow-table-wrap')?.clientWidth || 0,
    tableScrollWidth: document.querySelector('.cash-flow-table-wrap')?.scrollWidth || 0,
  }));
  expect(containment.documentWidth).toBeLessThanOrEqual(containment.viewportWidth + 1);
  expect(containment.tableScrollWidth).toBeGreaterThan(containment.tableClientWidth);
});
