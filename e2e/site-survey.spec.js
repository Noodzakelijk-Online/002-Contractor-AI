const { test, expect } = require('@playwright/test');

test('operator completes an approval-gated site survey and advances the opportunity to estimating', async ({ page, request }) => {
  const marker = Date.now();
  const title = `Browser site survey ${marker}`;
  const created = await request.post('/api/ledger/opportunities', {
    data: {
      clientName: 'Browser Survey Client',
      title,
      service: 'Renovation',
      address: 'Jansstraat 1',
      postalCode: '6811 AA',
      city: 'Arnhem',
      country: 'NL',
      estimatedValue: 42_500,
      ownerName: 'Browser Surveyor',
    },
  });
  expect(created.ok()).toBeTruthy();
  const opportunityId = (await created.json()).opportunity.id;

  await page.goto('/');
  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  await page.getByRole('button', { name: `Open ${title}` }).click();

  const control = page.getByTestId('site-survey-control');
  await expect(control.getByRole('heading', { name: 'Preconstruction site survey' })).toBeVisible();
  await expect(page.locator('.pipeline-detail')).not.toContainText('null%');
  await control.getByLabel('Surveyor').fill('Browser Surveyor');
  await control.getByLabel('Planning notes').fill('Internal browser QA plan; no appointment confirmation is sent.');
  await control.getByRole('button', { name: 'Retain plan' }).click();
  await expect(page.getByText('Internal site-survey plan retained. No appointment confirmation was sent.')).toBeVisible();
  await expect(control.getByRole('heading', { name: 'Complete survey' })).toBeVisible();

  await control.locator('input[type="file"]').setInputFiles({
    name: 'browser-site-survey.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`browser site survey ${marker}`)]),
  });
  await control.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText('Private site-survey evidence retained with checksum verification.')).toBeVisible();
  await expect(control.getByText('browser-site-survey.jpg', { exact: true })).toBeVisible();

  await control.getByLabel('Scope summary').fill('Renovate the measured kitchen footprint and retain the existing service routes.');
  const checklistResults = control.locator('.site-survey-checklist-row select');
  await expect(checklistResults).toHaveCount(10);
  for (let index = 0; index < 10; index += 1) {
    await checklistResults.nth(index).selectOption('pass');
  }
  const measurement = control.locator('.site-survey-measurement-row').first();
  await measurement.getByLabel('Measurement', { exact: true }).fill('Kitchen floor area');
  await measurement.getByLabel('Quantity', { exact: true }).fill('21.75');
  await measurement.getByLabel('Unit', { exact: true }).fill('m2');
  await measurement.getByLabel('Location', { exact: true }).fill('Ground floor');
  await measurement.getByLabel('Notes', { exact: true }).fill('Measured wall to wall.');
  await control.getByLabel('Assumptions', { exact: true }).fill('Existing electrical routes remain serviceable.');
  await control.getByLabel('Exclusions', { exact: true }).fill('Hazardous-material removal is excluded.');
  await control.getByLabel('Constraints', { exact: true }).fill('Occupied dwelling.');
  await control.getByLabel('Utilities', { exact: true }).fill('Power isolation at the retained consumer unit.');
  await control.getByLabel('Hazards', { exact: true }).fill('Protect the occupied access path.');
  await control.getByLabel('Client decisions', { exact: true }).fill('Final tile selection remains due.');
  const submit = control.getByRole('button', { name: 'Submit survey' });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText('Site survey retained for source-current office approval.')).toBeVisible();
  await expect(control.getByText('Office review pending')).toBeVisible();

  await control.getByRole('button', { name: 'Review approval' }).click();
  const approval = page.locator('.approval-item').filter({ hasText: `Approve preconstruction site survey for ${title}` });
  await expect(approval).toHaveCount(1);
  await approval.getByRole('button', { name: 'Review and approve' }).click();
  const review = page.getByTestId('approval-review-modal');
  await expect(review.getByText(/Advance an opportunity still at site visit to estimating/i)).toBeVisible();
  await review.getByLabel('Reviewer reason').fill('Checklist, measurements, private evidence, and estimating readiness verified.');
  await review.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  await expect(control.getByText('Approved estimating basis')).toBeVisible();
  await expect(control.getByText('Ready', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText(/Estimating.*50% probability/i)).toBeVisible();

  const retained = await request.get(`/api/ledger/opportunities/${encodeURIComponent(opportunityId)}`);
  expect(retained.ok()).toBeTruthy();
  const retainedOpportunity = (await retained.json()).opportunity;
  expect(retainedOpportunity.stage).toBe('estimating');
  expect(retainedOpportunity.siteSurvey.readiness.estimateReady).toBe(true);
  expect(retainedOpportunity.siteSurvey.currentSurvey.integrityValid).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(control.getByRole('heading', { name: 'Preconstruction site survey' })).toBeVisible();
  const containment = await control.evaluate((element) => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(containment.documentWidth).toBeLessThanOrEqual(containment.viewportWidth + 1);
  expect(containment.scrollWidth).toBeLessThanOrEqual(containment.clientWidth + 1);
});
