const { test, expect } = require('@playwright/test');

test('operator retains and updates one commercially ready client identity', async ({ page, request }) => {
  const sequence = Date.now();
  const company = `Browser Client ${sequence} BV`;
  const email = `client-${sequence}@example.test`;
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: 'Clients', exact: true }).click();
  await page.getByRole('tab', { name: /Directory/ }).click();

  const directory = page.getByTestId('client-directory');
  await expect(directory.getByRole('heading', { name: 'Client directory' })).toBeVisible();
  await directory.getByRole('button', { name: 'New client' }).click();

  const editor = page.getByTestId('client-editor-modal');
  await expect(editor.getByRole('heading', { name: 'New client' })).toBeVisible();
  await editor.getByLabel('Contact name').fill('Eva Janssen');
  await editor.getByLabel('Client type').selectOption('business');
  await editor.getByLabel('Legal or company name').fill(company);
  await editor.getByLabel('Contact email').fill(email);
  await editor.getByLabel('Billing email').fill(`billing-${sequence}@example.test`);
  await editor.getByLabel('Phone').fill('+31 20 555 0135');
  await editor.getByLabel('Street address').fill('Weteringschans 125');
  await editor.getByLabel('Postal code').fill('1017 SC');
  await editor.getByLabel('City').fill('Amsterdam');
  await editor.getByLabel('KVK / registration number').fill('87654321');
  await editor.getByLabel('VAT number').fill('NL123456789B01');
  await editor.getByLabel('Internal notes').fill('Primary retained client identity for browser verification.');
  await editor.getByRole('button', { name: 'Retain client' }).click();
  await expect(page.getByText('Client identity retained. No message, project, quote, or invoice was created.')).toBeVisible();

  const row = directory.locator('.client-directory-row').filter({ hasText: company });
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Contact ready', { exact: true })).toBeVisible();
  await expect(row.getByText('Invoice ready', { exact: true })).toBeVisible();
  await expect(row.getByText('Peppol ready', { exact: true })).toBeVisible();
  await expect(row.getByText('No phone retained')).toHaveCount(0);

  await row.getByRole('button', { name: 'Edit client' }).click();
  await expect(editor.getByRole('heading', { name: 'Edit client' })).toBeVisible();
  await editor.getByLabel('Preferred language').selectOption('en');
  await editor.getByLabel('Phone').fill('+31 20 555 0199');
  await editor.getByLabel('Internal notes').fill('Commercial identity reviewed and updated through the client directory.');
  await editor.getByRole('button', { name: 'Update client' }).click();
  await expect(page.getByText('Client identity updated in the ledger. Existing commercial snapshots remain immutable.')).toBeVisible();
  await expect(row.getByText('+31 20 555 0199', { exact: true })).toBeVisible();

  const response = await request.get(`/api/ledger/clients?search=${encodeURIComponent(company)}&limit=10`);
  expect(response.ok()).toBeTruthy();
  const retained = await response.json();
  expect(retained.clients).toHaveLength(1);
  expect(retained.clients[0]).toMatchObject({
    name: 'Eva Janssen',
    company,
    email,
    phone: '+31 20 555 0199',
    preferredLanguage: 'en',
    readiness: {
      contactReady: true,
      invoiceReady: true,
      structuredInvoiceReady: true
    },
    metrics: {
      activeJobs: 0,
      openOpportunities: 0,
      outstandingReceivable: 0
    }
  });
  expect(retained.clients[0].data.notes).toBe('Commercial identity reviewed and updated through the client directory.');
  expect(retained.clients[0].readiness.endpoint).toEqual({ scheme: '0106', id: '87654321', derived: true });

  await directory.getByLabel('Search clients').fill(company);
  await expect(directory.locator('.client-directory-row')).toHaveCount(1);
  await directory.getByLabel('Search clients').fill('definitely-no-client-match');
  await expect(directory.getByText('No matching clients')).toBeVisible();
  await directory.getByLabel('Search clients').fill(company);

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await directory.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(consoleErrors).toEqual([]);
});
