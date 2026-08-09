const { expect, test } = require('@playwright/test');

test('owner provisions, rotates, and deactivates redacted team access', async ({ page, request }) => {
  const marker = Date.now();
  const operatorId = `browser-operator-${marker}`;
  const operatorName = `Browser operator ${marker}`;

  await page.goto('/');
  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  const panel = page.getByTestId('team-access-control');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Add operator', exact: true }).click();

  const editor = page.getByRole('dialog', { name: 'Add operator' });
  await editor.getByLabel('Operator ID', { exact: true }).fill(operatorId);
  await editor.getByLabel('Display name', { exact: true }).fill(operatorName);
  await editor.getByLabel('Role', { exact: true }).selectOption('office_operator');
  await editor.getByRole('button', { name: 'Create access', exact: true }).click();

  const issuedKey = page.getByTestId('issued-operator-access-key');
  await expect(issuedKey).toBeVisible();
  const firstAccessKey = await issuedKey.inputValue();
  expect(firstAccessKey).toMatch(/^cai_[A-Za-z0-9_-]{43}$/);
  expect(await page.evaluate((accessKey) => (
    JSON.stringify({ ...localStorage }).includes(accessKey)
    || JSON.stringify({ ...sessionStorage }).includes(accessKey)
  ), firstAccessKey)).toBeFalsy();
  await page.getByRole('button', { name: 'I have stored the key', exact: true }).click();

  const accountRow = panel.locator('.team-access-row').filter({ hasText: operatorId });
  await expect(accountRow).toContainText('Key version 1');
  await expect(accountRow.locator('.status')).toHaveText('active');

  const registerResponse = await request.get('/api/operations/operators');
  expect(registerResponse.ok()).toBeTruthy();
  const registerBody = await registerResponse.json();
  const retainedAccount = registerBody.accounts.find((account) => account.id === operatorId);
  expect(retainedAccount).toMatchObject({ source: 'managed', mutable: true, status: 'active', keyVersion: 1 });
  expect(retainedAccount).not.toHaveProperty('tokenHash');
  expect(retainedAccount).not.toHaveProperty('tokenFingerprint');
  expect(JSON.stringify(registerBody)).not.toContain(firstAccessKey);

  await accountRow.getByRole('button', { name: 'Rotate key', exact: true }).click();
  await page.getByRole('dialog', { name: 'Rotate access key' }).getByRole('button', { name: 'Issue key', exact: true }).click();
  await expect(issuedKey).toBeVisible();
  const secondAccessKey = await issuedKey.inputValue();
  expect(secondAccessKey).toMatch(/^cai_[A-Za-z0-9_-]{43}$/);
  expect(secondAccessKey).not.toBe(firstAccessKey);
  await page.getByRole('button', { name: 'I have stored the key', exact: true }).click();
  await expect(accountRow).toContainText('Key version 2');

  await page.setViewportSize({ width: 375, height: 844 });
  const mobileGeometry = await panel.evaluate((element) => {
    const row = element.querySelector('.team-access-row');
    const addButton = element.querySelector('.team-access-heading .primary-button');
    const actions = element.querySelector('.team-access-actions');
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      panelWidth: element.scrollWidth,
      panelClientWidth: element.clientWidth,
      rowWidth: row?.scrollWidth || 0,
      rowClientWidth: row?.clientWidth || 0,
      addButtonWidth: addButton?.getBoundingClientRect().width || 0,
      addButtonParentWidth: addButton?.parentElement?.clientWidth || 0,
      actionDirection: actions ? getComputedStyle(actions).flexDirection : null,
    };
  });
  expect(mobileGeometry.pageWidth).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
  expect(mobileGeometry.panelWidth).toBeLessThanOrEqual(mobileGeometry.panelClientWidth);
  expect(mobileGeometry.rowWidth).toBeLessThanOrEqual(mobileGeometry.rowClientWidth);
  expect(mobileGeometry.addButtonWidth).toBeLessThanOrEqual(mobileGeometry.addButtonParentWidth);
  expect(mobileGeometry.actionDirection).toBe('column');

  await accountRow.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await page.getByRole('dialog', { name: 'Deactivate operator' })
    .getByRole('button', { name: 'Deactivate access', exact: true })
    .click();
  await expect(accountRow.locator('.status')).toHaveText('deactivated');
  await expect(accountRow.getByRole('button', { name: 'Issue new key', exact: true })).toBeVisible();
  await expect(accountRow.getByRole('button', { name: 'Deactivate', exact: true })).toHaveCount(0);
});
