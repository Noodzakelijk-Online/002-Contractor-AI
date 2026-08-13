const { test, expect } = require('@playwright/test');

test('operator opportunity draft survives reload and clears on intentional close', async ({ page, request }) => {
  const title = `Recovered opportunity ${Date.now()}`;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

  await page.getByRole('button', { name: 'New opportunity' }).first().click();
  let editor = page.getByTestId('opportunity-modal');
  await editor.getByLabel('Client name').fill('Recovered Draft Client');
  await editor.getByLabel('Opportunity title').fill(title);
  await editor.getByLabel('Scope and qualification notes').fill('Retain this unfinished qualification without creating a ledger record.');
  await page.waitForTimeout(350);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  editor = page.getByTestId('opportunity-modal');
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Client name')).toHaveValue('Recovered Draft Client');
  await expect(editor.getByLabel('Opportunity title')).toHaveValue(title);
  await expect(editor.getByLabel('Scope and qualification notes')).toHaveValue('Retain this unfinished qualification without creating a ledger record.');

  const opportunities = await request.get(`/api/ledger/opportunities?search=${encodeURIComponent(title)}&limit=100`);
  expect(opportunities.ok()).toBeTruthy();
  expect((await opportunities.json()).opportunities).toHaveLength(0);

  await editor.getByRole('button', { name: 'Close opportunity' }).click();
  await expect(editor).toHaveCount(0);
  await page.waitForTimeout(350);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByTestId('opportunity-modal')).toHaveCount(0);
});
