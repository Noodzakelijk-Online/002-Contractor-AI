const { test, expect } = require('@playwright/test');

test('Resources and Audit round-trip locale without changing retained worker evidence', async ({ page, request }) => {
  const marker = Date.now();
  const workerName = `Technician Van Rijn ${marker}`;
  const workerRole = 'Electrical specialist';
  const response = await request.post('/api/ledger/workers', {
    data: {
      name: workerName,
      role: workerRole,
      status: 'available',
      homeRegion: 'Arnhem-Randstad',
      hourlyRate: 52.5
    }
  });
  expect(response.ok()).toBeTruthy();

  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/');
  await page.getByLabel(/^(Language|Taal)$/).selectOption('en-GB');
  await page.locator('header').getByLabel('Language', { exact: true }).selectOption('nl-NL');

  await page.getByRole('button', { name: 'Middelen', exact: true }).click();
  const resources = page.getByTestId('resources-workspace');
  await expect(resources.getByRole('heading', { name: 'Gereedheid middelen', exact: true })).toBeVisible();
  await expect(resources.getByRole('tab', { name: 'Personeel', exact: true })).toBeVisible();
  await expect(resources.getByRole('tab', { name: 'Voorraad', exact: true })).toBeVisible();
  await resources.getByRole('tab', { name: 'Ploegenregister', exact: true }).click();

  const workerRow = resources.locator('.worker-row').filter({ hasText: workerName });
  await expect(workerRow).toBeVisible();
  await expect(workerRow).toContainText(workerRole);
  await expect(workerRow).toContainText('Arnhem-Randstad');
  await expect(workerRow.getByText('beschikbaar', { exact: true })).toBeVisible();
  await expect(resources.getByText('Actieve ploegleden', { exact: true })).toBeVisible();
  await expect(resources.getByPlaceholder('Ploeg zoeken')).toBeVisible();

  await page.locator('header').getByLabel('Taal', { exact: true }).selectOption('en-GB');
  await expect(resources.getByRole('heading', { name: 'Resource readiness', exact: true })).toBeVisible();
  await expect(workerRow).toContainText(workerName);
  await expect(workerRow).toContainText(workerRole);
  await expect(workerRow.getByText('available', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await resources.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.locator('header').getByLabel('Language', { exact: true }).selectOption('nl-NL');
  await page.getByRole('button', { name: 'Beheer', exact: true }).click();
  const audit = page.getByTestId('audit-history-panel');
  await expect(audit.getByRole('heading', { name: 'Auditgeschiedenis', exact: true })).toBeVisible();
  await expect(audit.getByPlaceholder('Zoek actie, registratie, opdracht of actor')).toBeVisible();
  await expect(audit.getByText('Laatste ketenactiviteit', { exact: true })).toBeVisible();
  await expect(audit.getByRole('button', { name: 'Filters wissen', exact: true })).toBeVisible();
  const firstAuditRow = audit.locator('.audit-history-row').first();
  await expect(firstAuditRow).toBeVisible();
  await expect(firstAuditRow).toContainText('operator-taal bijgewerkt');
  await firstAuditRow.locator('button').click();
  const detail = page.getByTestId('audit-event-detail');
  await expect(detail.getByText('Registratietype', { exact: true })).toBeVisible();
  await expect(detail.getByText('Gebeurtenis-ID', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Details van auditgebeurtenis sluiten' }).click();

  await page.locator('header').getByLabel('Taal', { exact: true }).selectOption('en-GB');
  await expect(audit.getByRole('heading', { name: 'Audit history', exact: true })).toBeVisible();
  await expect(audit.getByPlaceholder('Search action, record, job, or actor')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
