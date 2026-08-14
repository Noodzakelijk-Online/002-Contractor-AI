const { test, expect } = require('@playwright/test');
const { expectNoAxeViolations } = require('./accessibility-helpers');

test('job costing and cost-to-complete stay bilingual without rewriting retained evidence', async ({ page, request }) => {
  const marker = Date.now();
  const title = `Retained finance evidence ${marker}`;
  const budgetDescription = `Retained English cost baseline ${marker}`;
  const timeNotes = `Retained verified labor evidence ${marker}`;
  const receiptReference = `RETAINED-FIN-${marker}`;

  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Source-linked cost control',
      status: 'in_progress',
      progressPercent: 50,
      estimatedCost: 3000,
      contractValue: 5000,
      client: { name: `Finance client ${marker}` },
      assignAutomatically: false,
    },
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const intake = await intakeResponse.json();

  const budgetResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/budget-lines`, {
    data: {
      status: 'baseline',
      costCode: 'NL-FIN-100',
      description: budgetDescription,
      budgetAmount: 3000,
      forecastAmount: 2800,
    },
  });
  expect(budgetResponse.ok()).toBeTruthy();
  const budget = await budgetResponse.json();
  const approvalResponse = await request.post(`/api/ledger/approvals/${budget.budgetLine.approval.id}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Retained finance approver',
      reason: 'Retained cost-code baseline checked.',
    },
  });
  expect(approvalResponse.ok()).toBeTruthy();

  const costsResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/finance-costs`, {
    data: {
      timeLog: {
        workDate: '2026-08-14',
        hours: 8,
        rate: 50,
        costCode: 'NL-FIN-100',
        notes: timeNotes,
      },
      expense: {
        amount: 200,
        category: 'materials',
        costCode: 'NL-FIN-100',
        vendor: 'Retained Bouwmaat',
        receiptRef: receiptReference,
      },
    },
  });
  expect(costsResponse.ok()).toBeTruthy();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  const pageResponse = await page.goto('/');
  expect(pageResponse.ok()).toBeTruthy();
  await page.waitForLoadState('networkidle');
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  await page.locator('header').getByLabel(/^(Language|Taal)$/, { exact: true }).selectOption('en-GB');
  await page.locator('header').getByLabel('Language', { exact: true }).selectOption('nl-NL');
  await page.getByRole('button', { name: 'Financien', exact: true }).click();

  const finance = page.getByTestId('finance-workspace');
  await expect(finance.getByRole('heading', { name: 'Financiele gereedheid', exact: true })).toBeVisible();
  let row = finance.locator('.finance-item').filter({ hasText: title });
  await expect(row.locator('.status')).toHaveText('kostenbeoordeling vereist');
  await expect(row).toContainText('Kostenbudget');
  await expect(row).toContainText('Goedgekeurde werkelijke kosten');
  await expect(row).toContainText('Niet-beoordeelde kosten');
  await expect(row).toContainText('Resterende kosten');
  await row.getByText('Beoordeling kostencodes', { exact: true }).click();
  await expect(row.getByRole('columnheader', { name: 'Niet beoordeeld', exact: true })).toBeVisible();
  await expect(row.getByRole('columnheader', { name: 'Verplichtingen', exact: true })).toBeVisible();
  await expect(row).toContainText('1 urenregel blijft onbeoordeeld');
  await expect(row).toContainText('1 uitgavenregel is opgenomen in EAC');
  await expect(row).toContainText(budgetDescription);
  await expectNoAxeViolations(page, 'Dutch job costing and cost-to-complete');

  await page.reload();
  await page.getByRole('button', { name: 'Financien', exact: true }).click();
  await expect(finance.getByRole('heading', { name: 'Financiele gereedheid', exact: true })).toBeVisible();
  row = finance.locator('.finance-item').filter({ hasText: title });
  await row.getByRole('button', { name: `Kostenprognose vastzetten voor ${title}`, exact: true }).click();
  await expect(page.getByText(/Kostenprognose FC-\d{4}-\d{6} is vastgelegd op basis van de actuele kostencodeonderbouwing/)).toBeVisible();

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = (await detailResponse.json()).job;
  expect(detail.budgetLines.find(line => line.costCode === 'NL-FIN-100')?.description).toBe(budgetDescription);
  expect(detail.timeLogs.find(line => line.data?.costCode === 'NL-FIN-100')?.notes).toBe(timeNotes);
  expect(detail.expenses.find(item => item.receiptRef === receiptReference)?.vendor).toBe('Retained Bouwmaat');

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await finance.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('header').getByLabel('Taal', { exact: true }).selectOption('en-GB');
  await expect(finance.getByRole('heading', { name: 'Finance readiness', exact: true })).toBeVisible();
  await expect(row).toContainText(title);
  await expect(row).toContainText(budgetDescription);
  expect(consoleErrors).toEqual([]);
});
