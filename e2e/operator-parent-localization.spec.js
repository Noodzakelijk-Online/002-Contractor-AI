const { test, expect } = require('@playwright/test');

test('Today, Jobs, and the job shell round-trip locale without changing retained project data', async ({ page, request }) => {
  const marker = Date.now();
  const title = `Project Delta ${marker}`;
  const clientName = `Client Van Dijk ${marker}`;
  const response = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Garden maintenance',
      address: 'Keizersgracht 10',
      city: 'Amsterdam',
      status: 'in_progress',
      client: { name: clientName, email: `delta-${marker}@example.test` },
      assignAutomatically: false
    }
  });
  expect(response.ok()).toBeTruthy();

  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/');
  await page.getByLabel(/^(Language|Taal)$/).selectOption('en-GB');
  await expect(page.getByRole('heading', { level: 1, name: 'Today', exact: true })).toBeVisible();

  await page.locator('header').getByLabel('Language', { exact: true }).selectOption('nl-NL');
  await expect(page.getByRole('heading', { level: 1, name: 'Vandaag', exact: true })).toBeVisible();
  await expect(page.getByText('Opdrachten vandaag', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Actiewachtrij', exact: true })).toBeVisible();
  await expect(page.getByText(`${title} heeft een medewerkerstoewijzing nodig.`, { exact: true })).toBeVisible();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Projecten', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Projecten', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alle opdrachten', exact: true })).toBeVisible();
  const row = page.locator('tbody tr').filter({ hasText: title });
  await expect(row).toContainText(clientName);
  await expect(row).toContainText('Amsterdam');
  await expect(row).toContainText('in uitvoering');
  await row.getByRole('button', { name: `${title} openen`, exact: true }).click();

  const workspace = page.getByTestId('job-workspace');
  await expect(workspace.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(workspace.getByText('Registerwerkruimte voor opdracht', { exact: true })).toBeVisible();
  await expect(workspace.getByText(clientName, { exact: false })).toBeVisible();
  await expect(workspace.getByText('Toestand', { exact: true })).toBeVisible();
  await expect(workspace.getByText('Voortgang', { exact: true })).toBeVisible();
  await expect(workspace.getByText('Voorgesteld werk', { exact: true })).toBeVisible();
  await workspace.getByRole('button', { name: 'Opdrachtwerkruimte sluiten' }).click();

  await page.locator('header').getByLabel('Taal', { exact: true }).selectOption('en-GB');
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs', exact: true })).toBeVisible();
  await expect(row).toContainText(title);
  await expect(row).toContainText(clientName);
  await expect(row).toContainText('in progress');
  expect(consoleErrors).toEqual([]);
});
