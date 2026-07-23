const { test, expect } = require('@playwright/test');

async function postJson(request, route, data) {
  const response = await request.post(route, { data });
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function expenseFixture(request, suffix, prefix = 'Browser expense') {
  const job = (await postJson(request, '/api/ledger/intake', {
    title: `${prefix} ${suffix}`,
    client: { name: `${prefix} client` },
    status: 'in_progress',
    assignAutomatically: false
  })).job;
  const worker = (await postJson(request, '/api/ledger/workers', {
    name: `${prefix} worker ${suffix}`,
    role: 'Site carpenter',
    status: 'available'
  })).worker;
  const assignment = await postJson(request, `/api/ledger/jobs/${job.id}/assignments`, {
    workerId: worker.id,
    workerName: worker.name,
    role: worker.role,
    status: 'assigned'
  });
  if (assignment.approval?.id) {
    await postJson(request, `/api/ledger/approvals/${assignment.approval.id}/resolve`, {
      status: 'approved',
      resolvedBy: 'Browser expense approver',
      reason: 'Expense worker assignment and project scope verified.'
    });
  }
  return { job, worker };
}

async function approveQueueItem(page, row, reason) {
  await row.getByRole('button', { name: 'Review and approve' }).click();
  const modal = page.getByTestId('approval-review-modal');
  await expect(modal).toBeVisible();
  await modal.getByLabel('Reviewer reason').fill(reason);
  await modal.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();
}

test('field receipt approval recognizes VAT-aware cost and compensating reversal preserves evidence', async ({ page, request }) => {
  const suffix = Date.now();
  const fixture = await expenseFixture(request, suffix);
  const receiptReference = `BROWSER-EXP-${suffix}`;

  await page.goto('/');
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  const form = page.getByTestId('field-expense-receipt-form');
  await form.getByLabel('Job').selectOption(fixture.job.id);
  await form.getByLabel('Category').selectOption('materials');
  await form.getByLabel('Vendor').fill('Browser Bouwmaat');
  await form.getByLabel('Receipt reference').fill(receiptReference);
  await form.getByLabel('Gross total (EUR)').fill('121.00');
  await form.getByLabel('VAT amount (EUR)').fill('21.00');
  await form.getByLabel('VAT treatment').selectOption('recoverable');
  await form.getByLabel('Payment method').selectOption('personal_card');
  await form.getByLabel('Cost code').fill('BROWSER-MAT-100');
  await form.getByLabel('Receipt note').fill('Fixings purchased for the assigned browser project.');
  await form.getByRole('button', { name: 'Request expense approval' }).click();
  await expect(page.getByText(`Receipt ${receiptReference} was retained for approver review. No reimbursement or payment was initiated.`)).toBeVisible();

  let receiptRow = form.locator('.field-expense-receipt-row').filter({ hasText: receiptReference });
  await expect(receiptRow).toContainText('pending approval');
  await expect(receiptRow).toContainText(/121,00/);

  await page.locator('.side-nav').getByRole('button', { name: /^Approvals/ }).click();
  const receiptApproval = page.locator('.approval-item').filter({ hasText: receiptReference });
  await expect(receiptApproval).toHaveCount(1);
  await approveQueueItem(page, receiptApproval, 'Original receipt, worker scope, VAT, payment method, cost code, and project allocation verified.');

  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  const finance = page.getByTestId('finance-workspace');
  let financeRow = finance.locator('.finance-item').filter({ hasText: fixture.job.title });
  await expect(financeRow).toContainText(/Approved actual.*100,00/);
  await expect(financeRow).toContainText(`${receiptReference} / approved`);
  await financeRow.getByRole('button', { name: `Reverse expense for ${fixture.job.title}` }).click();

  const reversal = page.getByTestId('finance-control-modal');
  await expect(reversal.getByRole('heading', { name: 'Reverse expense' })).toBeVisible();
  await expect(reversal.getByText(receiptReference, { exact: true })).toBeVisible();
  await reversal.getByLabel('Internal evidence and notes').fill('Corrected bookkeeping evidence confirms allocation to another retained project.');
  await reversal.getByRole('button', { name: 'Request expense reversal' }).click();
  await expect(page.getByText(`Expense ${receiptReference} is pending reversal approval. The original evidence remains retained and no funds moved.`)).toBeVisible();

  await page.locator('.side-nav').getByRole('button', { name: /^Approvals/ }).click();
  const reversalApproval = page.locator('.approval-item').filter({ hasText: receiptReference });
  await expect(reversalApproval).toHaveCount(1);
  await approveQueueItem(page, reversalApproval, 'Corrected project allocation evidence and compensating reversal basis verified.');

  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  financeRow = finance.locator('.finance-item').filter({ hasText: fixture.job.title });
  await expect(financeRow).toContainText(/Approved actual.*0,00/);
  await expect(financeRow).toContainText(`${receiptReference} / reversed`);

  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  await form.getByLabel('Job').selectOption('');
  await form.getByLabel('Job').selectOption(fixture.job.id);
  receiptRow = form.locator('.field-expense-receipt-row').filter({ hasText: receiptReference });
  await expect(receiptRow).toContainText('reversed');

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await form.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    formWidth: element.scrollWidth,
    formClientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.formWidth).toBeLessThanOrEqual(geometry.formClientWidth + 1);
});

test('interrupted expense receipt syncs exactly once through the field outbox', async ({ page, request, context }) => {
  const suffix = Date.now();
  const fixture = await expenseFixture(request, suffix, 'Offline expense');
  const receiptReference = `OFFLINE-EXP-${suffix}`;

  await page.goto('/');
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  const form = page.getByTestId('field-expense-receipt-form');
  await form.getByLabel('Job').selectOption(fixture.job.id);
  await form.getByLabel('Vendor').fill('Offline merchant');
  await form.getByLabel('Receipt reference').fill(receiptReference);
  await form.getByLabel('Gross total (EUR)').fill('60.50');
  await form.getByLabel('VAT amount (EUR)').fill('10.50');
  await form.getByLabel('Payment method').selectOption('company_card');
  await form.getByLabel('Cost code').fill('OFFLINE-MAT-100');

  await context.setOffline(true);
  await form.getByRole('button', { name: /Request expense approval|Save receipt offline/ }).click();
  await expect(page.getByText('Expense receipt was saved locally with its VAT basis and will sync after reconnection.')).toBeVisible();
  await expect(page.getByText('1 queued').first()).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Outbox clear')).toBeVisible({ timeout: 15_000 });

  await expect.poll(async () => {
    const response = await request.get(`/api/ledger/jobs/${fixture.job.id}/expense-receipts`);
    if (!response.ok()) return 0;
    const result = await response.json();
    return result.expenses.filter(expense => expense.receiptReference === receiptReference).length;
  }, { timeout: 15_000 }).toBe(1);
});
