const { test, expect } = require('@playwright/test');

test('operator measures scope and seals it into one approval-gated estimate', async ({ page, request }) => {
  const key = Date.now();
  const title = `Browser measured scope ${key}`;
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Interior renovation',
      client: { name: `Browser Measurement Client ${key}`, email: 'measurement@example.test', country: 'NL' },
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const intake = await intakeResponse.json();

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  const workspace = page.getByTestId('job-workspace');
  const takeoffControl = workspace.getByTestId('takeoff-control');
  await expect(takeoffControl.getByRole('heading', { name: 'Quantity takeoff' })).toBeVisible();
  await expect(takeoffControl.getByText('No quantity takeoffs')).toBeVisible();

  await takeoffControl.getByRole('button', { name: 'New takeoff' }).click();
  const createModal = page.getByTestId('takeoff-create-modal');
  await createModal.getByLabel('Takeoff title').fill('Ground floor measured scope');
  await createModal.getByLabel('VAT rate (%)').fill('21');
  await createModal.getByLabel('Internal notes').fill('Measured from drawing A-101 revision P02.');
  await createModal.getByRole('button', { name: 'Retain takeoff' }).click();
  await expect(page.getByText('Quantity takeoff retained as an internal draft. No estimate or external commitment was created.')).toBeVisible();

  const sheet = takeoffControl.locator('.takeoff-sheet').filter({ hasText: 'Ground floor measured scope' });
  await expect(sheet).toHaveCount(1);
  await sheet.getByRole('button', { name: 'Measurement' }).click();
  let itemModal = page.getByTestId('takeoff-item-modal');
  await itemModal.getByLabel('Description').fill('Ceramic floor tiles');
  await itemModal.getByLabel('Category').selectOption('material');
  await itemModal.getByLabel('Measurement type').selectOption('area');
  await itemModal.getByRole('spinbutton', { name: 'Count', exact: true }).fill('1');
  await itemModal.getByLabel('Length (m)').fill('5');
  await itemModal.getByLabel('Width (m)').fill('4');
  await itemModal.getByLabel('Waste (%)').fill('10');
  await itemModal.getByLabel('Unit cost').fill('20');
  await itemModal.getByLabel('Unit sell price').fill('35');
  await itemModal.getByLabel('Cost code').fill('FIN-220');
  await itemModal.getByLabel('Drawing / source reference').fill('A-101 P02');
  await expect(itemModal.getByLabel('Calculated measurement preview')).toContainText('22 m2');
  await expect(itemModal.getByLabel('Calculated measurement preview')).toContainText('€ 770,00');
  await itemModal.getByRole('button', { name: 'Retain measurement' }).click();
  await expect(page.getByText('Takeoff measurement calculated and retained.')).toBeVisible();
  await expect(sheet.getByText('22 m2')).toBeVisible();
  await expect(sheet.getByText('A-101 P02', { exact: false })).toBeVisible();

  await sheet.getByRole('button', { name: 'Edit Ceramic floor tiles' }).click();
  itemModal = page.getByTestId('takeoff-item-modal');
  await itemModal.getByLabel('Width (m)').fill('5');
  await expect(itemModal.getByLabel('Calculated measurement preview')).toContainText('27.5 m2');
  await itemModal.getByRole('button', { name: 'Recalculate measurement' }).click();
  await expect(page.getByText('Takeoff measurement recalculated and retained.')).toBeVisible();
  await expect(sheet.getByText('27.5 m2')).toBeVisible();

  await sheet.getByRole('button', { name: 'Prepare estimate' }).click();
  const convertModal = page.getByTestId('takeoff-convert-modal');
  await expect(convertModal.getByText(/SHA-256 snapshot/i)).toBeVisible();
  await convertModal.getByLabel('Estimate notes').fill('Estimator verified drawing revision, quantity, waste, and rates.');
  await convertModal.getByRole('button', { name: 'Seal and prepare estimate' }).click();
  await expect(page.getByText(/Measured scope sealed and estimate retained/i)).toBeVisible();
  await expect(sheet.getByText('converted', { exact: true })).toBeVisible();
  await expect(sheet.getByText('Snapshot verified')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Measurement' })).toHaveCount(0);
  await expect(workspace.getByTestId('commercial-control')).toContainText('€ 962,50');

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  const retained = detail.job.takeoffs.find(item => item.title === 'Ground floor measured scope');
  expect(retained).toMatchObject({
    status: 'converted',
    subtotal: 962.5,
    totalCost: 550,
    integrityValid: true,
    data: { externalCommitments: 0 }
  });
  expect(retained.items[0]).toMatchObject({ quantity: 27.5, unit: 'm2', totalPrice: 962.5 });
  const quote = detail.job.quotes.find(item => item.id === retained.quoteId);
  expect(quote.status).toBe('draft');
  expect(quote.approvalId).toBeTruthy();
  expect(quote.data.source).toMatchObject({ type: 'quantity_takeoff', id: retained.id, snapshotHash: retained.snapshotHash });
  expect(detail.job.contractValue).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await takeoffControl.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
});
