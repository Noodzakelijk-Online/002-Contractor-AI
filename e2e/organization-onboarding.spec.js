const { test, expect } = require('@playwright/test');

function organizationSave(page) {
  return page.waitForResponse(response => (
    response.request().method() === 'PUT'
    && new URL(response.url()).pathname === '/api/ledger/organization'
  ));
}

test('owner completes persistent business setup in guided steps on a mobile viewport', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

  const setupPrompt = page.getByTestId('first-run-setup');
  await expect(setupPrompt.getByRole('heading', { name: 'Complete the business identity' })).toBeVisible();
  await setupPrompt.getByRole('button', { name: 'Finish setup' }).click();

  const dialog = page.getByTestId('organization-onboarding');
  const dialogHeading = dialog.getByRole('heading', { name: 'Business identity' });
  await expect(dialogHeading).toBeVisible();
  await expect(dialogHeading).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('checkbox', { name: 'This legal entity is VAT exempt' })).toBeFocused();
  await expect(dialog.getByText('Step 1 of 4')).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  await dialog.getByLabel('Legal name').fill('Guided Contractor B.V.');
  await dialog.getByLabel('Trading name').fill('Guided Contractor');
  await dialog.getByLabel('Registration number').fill('87654321');
  await dialog.getByLabel('VAT number').fill('NL987654321B01');
  let saveResponse = organizationSave(page);
  await dialog.getByRole('button', { name: 'Save and continue' }).click();
  let saved = await saveResponse;
  expect(saved.ok()).toBeTruthy();
  expect((await saved.json()).organization.readiness.ready).toBe(false);

  await expect(dialog.getByText('Step 2 of 4')).toBeVisible();
  await dialog.getByLabel('Registered address').fill('Gidsstraat 24');
  await dialog.getByLabel('Postal code').fill('3511 ZZ');
  await dialog.getByLabel('City').fill('Utrecht');
  await dialog.getByLabel('Email').fill('office@guided-contractor.example');
  await dialog.getByLabel('Phone').fill('+31 30 555 01 24');
  await dialog.getByLabel('Website').fill('https://guided-contractor.example');
  saveResponse = organizationSave(page);
  await dialog.getByRole('button', { name: 'Save and continue' }).click();
  saved = await saveResponse;
  expect(saved.ok()).toBeTruthy();
  expect((await saved.json()).organization.readiness.ready).toBe(true);

  await expect(dialog.getByText('Step 3 of 4')).toBeVisible();
  await dialog.getByLabel('Electronic address scheme').fill('0106');
  await dialog.getByLabel('Electronic address', { exact: true }).fill('87654321');
  await dialog.getByLabel('IBAN').fill('NL91ABNA0417164300');
  await dialog.getByLabel('BIC').fill('ABNANL2A');
  await dialog.getByLabel('Quote terms').fill('Additional work requires a retained and accepted scope change.');
  saveResponse = organizationSave(page);
  await dialog.getByRole('button', { name: 'Save and continue' }).click();
  saved = await saveResponse;
  expect(saved.ok()).toBeTruthy();

  await expect(dialog.getByText('Step 4 of 4')).toBeVisible();
  await expect(dialog.getByText('Business identity is issue ready')).toBeVisible();
  await expect(dialog.getByText('Guided Contractor B.V.')).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Finish setup' }).click();

  await expect(dialog).toBeHidden();
  await expect(setupPrompt).toHaveCount(0);

  const retainedResponse = await request.get('/api/ledger/organization');
  expect(retainedResponse.ok()).toBeTruthy();
  expect((await retainedResponse.json()).organization).toMatchObject({
    legalName: 'Guided Contractor B.V.',
    registrationNumber: '87654321',
    email: 'office@guided-contractor.example',
    readiness: { ready: true }
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Operations' }).click();
  const profile = page.getByTestId('organization-profile-panel');
  await expect(profile.getByText('issue ready', { exact: true })).toBeVisible();
  await expect(profile.getByLabel('Legal name')).toHaveValue('Guided Contractor B.V.');
  await expect(profile.getByLabel('Electronic address', { exact: true })).toHaveValue('87654321');
});
