const { test, expect } = require('@playwright/test');

async function openJob(page, title) {
  await page.getByRole('button', { name: 'Jobs', exact: true }).click();
  await page.getByRole('button', { name: `Open ${title}` }).click();
  const workspace = page.getByTestId('job-workspace');
  await expect(workspace.getByRole('heading', { name: title })).toBeVisible();
  return workspace;
}

test('office operator retains and independently approves BENG energy-performance evidence', async ({ page, request }) => {
  const marker = Date.now();
  const title = `Browser energy performance ${marker}`;
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title,
      client: { name: `Browser energy client ${marker}` },
      service: 'New build',
      status: 'in_progress',
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const intake = await intakeResponse.json();
  const uploadResponse = await request.post('/api/ledger/upload', {
    headers: { 'Idempotency-Key': `browser-energy-upload-${marker}` },
    multipart: {
      evidenceFile: {
        name: `browser-energy-assessment-${marker}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nBrowser energy assessment ${marker}\n%%EOF`)
      },
      jobId: intake.job.id,
      category: 'energy_performance_assessment',
      notes: 'Adviser-issued NTA 8800 assessment retained for browser verification.'
    }
  });
  expect(uploadResponse.ok()).toBeTruthy();
  const upload = await uploadResponse.json();

  await page.goto('/');
  let workspace = await openJob(page, title);
  let control = workspace.getByTestId('energy-performance-control');
  await expect(control.getByRole('heading', { name: 'BENG & energy performance' })).toBeVisible();
  await expect(control.getByText('No energy-performance evidence')).toBeVisible();
  await control.getByRole('button', { name: 'New record' }).click();

  const form = control.getByTestId('energy-performance-form');
  const comboboxes = new Set(['Record phase', 'Building use', 'Assessment scope', 'Retained assessment PDF']);
  const numberFields = new Set([
    'BENG 1 value',
    'BENG 1 maximum',
    'BENG 2 value',
    'BENG 2 maximum',
    'BENG 3 value (%)',
    'BENG 3 minimum (%)'
  ]);
  const field = name => form.getByRole(
    comboboxes.has(name) ? 'combobox' : numberFields.has(name) ? 'spinbutton' : 'textbox',
    { name, exact: true }
  );
  await field('Record phase').selectOption('permit_application');
  await field('Building use').selectOption('residential');
  await field('Assessment scope').selectOption('building');
  await field('Building / BAG / provisional / dwelling-unit reference').fill(`BAG-PAND-BROWSER-${marker}`);
  await field('EP adviser').fill('Browser qualified EP adviser');
  await field('Adviser credential').fill('EP-W/D-BROWSER-001');
  await field('Certified company').fill('Browser Certified Energy BV');
  await field('NTA 8800 version').fill('NTA 8800:2026');
  await field('Attested software').fill('Browser attested EP software');
  await field('Software version').fill('2026.1');
  await field('EP-Online registration').fill(`EP-ONLINE-BROWSER-${marker}`);
  await field('BENG 1 value').fill('42.123');
  await field('BENG 1 maximum').fill('55');
  await field('BENG 2 value').fill('26.234');
  await field('BENG 2 maximum').fill('30');
  await field('BENG 3 value (%)').fill('64.5');
  await field('BENG 3 minimum (%)').fill('50');
  await field('TOjuli not-applicable reason').fill('The retained adviser report states that TOjuli does not apply.');
  await field('Retained assessment PDF').selectOption(upload.ledgerDocument.id);
  await field('Evidence reference').fill(`browser-energy-report-${marker}`);
  await field('Review notes').fill('Declared values, limits, adviser, software, and registration retained from the source PDF.');
  await form.getByRole('button', { name: 'Retain for review' }).click();

  await expect(page.getByText(/did not calculate, certify, or register it/i)).toBeVisible();
  await expect(control.locator('.energy-performance-summary').getByText('1', { exact: true })).toBeVisible();
  await expect(control.getByText('pending approval', { exact: true })).toBeVisible();
  await expect(control.getByText('BENG 1 energy need: 42.123 <= 55')).toBeVisible();
  await control.getByRole('button', { name: 'Review evidence' }).click();

  const approval = page.locator('.approval-item').filter({ hasText: `BAG-PAND-BROWSER-${marker}` });
  await expect(approval).toHaveCount(1);
  await approval.getByRole('button', { name: 'Review and approve' }).click();
  const review = page.getByTestId('approval-review-modal');
  await expect(review.getByText(/does not perform the NTA 8800 calculation/i)).toBeVisible();
  await review.getByLabel('Reviewer reason').fill('Browser QA verified the adviser, software, registration, declared thresholds, and checksummed source PDF.');
  await review.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  workspace = await openJob(page, title);
  control = workspace.getByTestId('energy-performance-control');
  await expect(control.getByText('verified compliant', { exact: true })).toBeVisible();
  await expect(control.getByText('Intact', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await control.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    controlWidth: element.scrollWidth,
    controlClientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.controlWidth).toBeLessThanOrEqual(geometry.controlClientWidth);
});
