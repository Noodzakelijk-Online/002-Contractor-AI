const { expect, test } = require('@playwright/test');

test('owner completes a source-current privacy request and downloads the approved package', async ({ page, request }) => {
  const marker = Date.now();
  const clientName = `Privacy browser client ${marker}`;
  const clientResponse = await request.post('/api/ledger/clients', {
    data: {
      name: clientName,
      email: `privacy-browser-${marker}@example.test`,
      phone: '+31 20 555 0194',
      city: 'Amsterdam'
    }
  });
  expect(clientResponse.ok()).toBeTruthy();
  const client = (await clientResponse.json()).client;

  await page.goto('/');
  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  const panel = page.getByTestId('privacy-requests-control');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Record request', exact: true }).click();

  const createDialog = page.getByRole('dialog', { name: 'Record privacy request' });
  await createDialog.getByLabel('Person type', { exact: true }).selectOption('client');
  await createDialog.getByLabel('Person', { exact: true }).selectOption(client.id);
  await createDialog.getByLabel('Request type', { exact: true }).selectOption('portability');
  await createDialog.getByLabel('Channel', { exact: true }).selectOption('email');
  await createDialog.getByLabel('Reference', { exact: true }).fill(`privacy-browser-request-${marker}`);
  await createDialog.getByLabel('Request details', { exact: true }).fill('Please provide the retained structured personal-data package.');
  await createDialog.getByRole('button', { name: 'Record request', exact: true }).click();
  await expect(createDialog).toBeHidden();

  const row = panel.locator('.privacy-request-row').filter({ hasText: clientName });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Identity pending');
  await row.getByRole('button', { name: `Extend response target for ${clientName}` }).click();
  const extensionDialog = page.getByRole('dialog', { name: 'Extend deadline' });
  await extensionDialog.getByLabel('Requester notification reference').fill(`Requester informed in retained message PRIV-BROWSER-EXT-${marker}`);
  await extensionDialog.getByLabel('Extension rationale').fill('The request covers several linked records and needs a bounded extension.');
  await extensionDialog.getByRole('button', { name: 'Retain extension' }).click();
  await expect(extensionDialog).toBeHidden();
  await row.getByRole('button', { name: 'Verify identity', exact: true }).click();
  const identityDialog = page.getByRole('dialog', { name: `Verify ${clientName}` });
  await expect(identityDialog).toContainText('Do not upload or copy a full identity document');
  await identityDialog.getByLabel('Verification method').selectOption('existing_contact');
  await identityDialog.getByLabel('Evidence reference').fill(`Existing retained client correspondence PRIV-BROWSER-${marker}`);
  await identityDialog.getByRole('button', { name: 'Retain verification' }).click();
  await expect(identityDialog).toBeHidden();

  await expect(row).toContainText('Ready to assess');
  await row.getByRole('button', { name: 'Assess', exact: true }).click();
  const assessmentDialog = page.getByRole('dialog', { name: 'Assess Portability' });
  await assessmentDialog.getByLabel('Decision').selectOption('provide_portability');
  await assessmentDialog.getByLabel('Assessment rationale').fill('Prepare a structured owner-reviewed package for the verified requester.');
  await assessmentDialog.getByLabel('Legal basis reference').fill('GDPR Article 20 browser review');
  await assessmentDialog.getByLabel('Retention policy reference').fill('Contractor.AI retention policy 2026-01');
  await assessmentDialog.getByRole('button', { name: 'Request approval', exact: true }).click();
  await expect(assessmentDialog).toBeHidden();

  const approval = page.locator('.approval-item').filter({ hasText: clientName });
  await expect(approval).toHaveCount(1);
  await approval.getByRole('button', { name: 'Review and approve' }).click();
  const review = page.getByTestId('approval-review-modal');
  await expect(review).toContainText('nothing is sent automatically');
  await expect(review).toContainText('Approval fails closed if the subject or linked record inventory changed');
  await review.getByLabel('Reviewer reason').fill('Verified identity, scope, retained categories, and source-current inventory independently reviewed.');
  await review.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(review).toBeHidden();

  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  await expect(panel).toBeVisible();
  await panel.locator('select').nth(0).selectOption('all');
  await expect(row).toContainText('Completed');
  const downloadPromise = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^contractor-ai-privacy-privacy_.+\.json$/);

  const registerResponse = await request.get('/api/operations/privacy/requests?status=all&limit=500');
  expect(registerResponse.ok()).toBeTruthy();
  const retained = (await registerResponse.json()).requests.find(item => item.subjectId === client.id && item.requestType === 'portability');
  expect(retained).toMatchObject({ status: 'completed' });
  expect(retained.identity).toMatchObject({ status: 'verified', fullIdentityDocumentStored: false });
  expect(retained.result).toMatchObject({ action: 'provide_portability', externalCommitments: 0 });
  expect(retained.result.extensions[0].notificationReference).toContain('PRIV-BROWSER-EXT');

  await page.setViewportSize({ width: 375, height: 844 });
  const geometry = await panel.evaluate((element) => {
    const requestRow = element.querySelector('.privacy-request-row');
    const actions = element.querySelector('.privacy-request-actions');
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      panelWidth: element.scrollWidth,
      panelClientWidth: element.clientWidth,
      rowWidth: requestRow?.scrollWidth || 0,
      rowClientWidth: requestRow?.clientWidth || 0,
      actionDirection: actions ? getComputedStyle(actions).flexDirection : null,
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.panelWidth).toBeLessThanOrEqual(geometry.panelClientWidth);
  expect(geometry.rowWidth).toBeLessThanOrEqual(geometry.rowClientWidth);
  expect(geometry.actionDirection).toBe('column');
});
