const { test, expect } = require('@playwright/test');

async function postJson(request, route, data) {
  const response = await request.post(route, { data });
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function environmentalFixture(request, suffix, prefix = 'Browser environmental') {
  const job = (await postJson(request, '/api/ledger/intake', {
    title: `${prefix} ${suffix}`,
    client: { name: `${prefix} client` },
    status: 'in_progress',
    assignAutomatically: false
  })).job;
  const worker = (await postJson(request, '/api/ledger/workers', {
    name: `${prefix} worker ${suffix}`,
    role: 'Site operative',
    status: 'available'
  })).worker;
  const assignment = await postJson(request, `/api/ledger/jobs/${job.id}/assignments`, {
    workerId: worker.id,
    workerName: worker.name,
    role: worker.role,
    status: 'assigned'
  });
  if (assignment.approval?.id) {
    await postJson(request, `/api/ledger/approvals/${assignment.approval.id}/resolve`, {
      status: 'approved',
      resolvedBy: 'Browser environmental approver',
      reason: 'Environmental field assignment and project scope verified.'
    });
  }
  return { job, worker };
}

async function approveQueueItem(page, row, reason) {
  await row.getByRole('button', { name: 'Review and approve' }).click();
  const modal = page.getByTestId('approval-review-modal');
  await expect(modal).toBeVisible();
  await modal.getByLabel('Reviewer reason').fill(reason);
  await modal.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();
}

test('environmental source review, report package, and compensating reversal stay connected', async ({ page, request }) => {
  const suffix = Date.now();
  const fixture = await environmentalFixture(request, suffix);
  const description = `Generator diesel ${suffix}`;

  await page.goto('/');
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  const panel = page.getByTestId('field-environmental-panel');
  const form = page.getByTestId('field-environmental-activity-form');
  await form.getByLabel('Job').selectOption(fixture.job.id);
  await form.getByLabel('Category').selectOption('fuel');
  await form.getByLabel('GHG scope').selectOption('scope_1');
  await form.getByLabel('Activity description').fill(description);
  await form.getByLabel('Quantity').fill('5');
  await form.getByLabel('Unit', { exact: true }).fill('litre');
  await form.getByLabel('Factor (kg CO2e / unit)').fill('2.68');
  await form.getByLabel('Factor source').fill('Browser retained factor library');
  await form.getByLabel('Factor reference').fill(`factor-library:diesel:${suffix}`);
  await form.getByLabel('Activity evidence reference').fill(`fuel-ticket:${suffix}`);
  await form.getByLabel('Review note').fill('Quantity retained from the project fuel ticket.');
  await expect(panel.getByText(/13[,.]4 kg CO2e/)).toBeVisible();
  await form.getByRole('button', { name: 'Request source review' }).click();
  await expect(page.getByText(`${description} was retained for source review. No certification or external submission was made.`)).toBeVisible();

  let activityRow = panel.locator('.field-environmental-row').filter({ hasText: description });
  await expect(activityRow).toContainText('pending approval');
  await expect(activityRow).toContainText(/13[,.]4 kg CO2e/);

  await page.locator('.side-nav').getByRole('button', { name: /^Approvals/ }).click();
  const activityApproval = page.locator('.approval-item').filter({ hasText: description });
  await expect(activityApproval).toHaveCount(1);
  await approveQueueItem(page, activityApproval, 'Fuel ticket, project allocation, scope, quantity, unit, factor value, and factor provenance verified.');

  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  await form.getByLabel('Job').selectOption(fixture.job.id);
  activityRow = panel.locator('.field-environmental-row').filter({ hasText: description });
  await expect(activityRow).toContainText('approved');
  await expect(panel.getByLabel('Environmental register summary')).toContainText(/13[,.]4 kg CO2e/);

  const reportForm = page.getByTestId('environmental-report-form');
  await expect(reportForm.getByRole('button', { name: 'Prepare report' })).toBeEnabled();
  await reportForm.getByRole('button', { name: 'Prepare report' }).click();
  await expect(page.getByText('Environmental report package retained for approver review. Nothing was submitted or certified externally.')).toBeVisible();
  const reportApproval = page.locator('.approval-item').filter({ hasText: fixture.job.title }).filter({ hasText: 'environmental report' });
  await expect(reportApproval).toHaveCount(1);
  await approveQueueItem(page, reportApproval, 'Approved activity set, factor provenance, source hash, snapshot hash, and CSV checksum verified.');

  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  await form.getByLabel('Job').selectOption(fixture.job.id);
  const reportList = panel.getByLabel('Environmental reports');
  await expect(reportList).toContainText('approved');
  await expect(reportList.getByRole('link', { name: /Download environmental report/ })).toBeVisible();
  const reportsResponse = await request.get(`/api/ledger/jobs/${fixture.job.id}/environmental-reports`);
  expect(reportsResponse.ok()).toBeTruthy();
  const reports = await reportsResponse.json();
  const approvedReport = reports.reports.find(report => report.status === 'approved');
  expect(approvedReport).toBeTruthy();
  const download = await request.get(approvedReport.downloadPath);
  expect(download.ok()).toBeTruthy();
  expect(await download.text()).toContain(description);

  await activityRow.getByRole('button', { name: `Request reversal for ${description}` }).click();
  const reversalModal = page.getByTestId('environmental-reversal-modal');
  await reversalModal.getByLabel('Correction reason').fill('Corrected retained source confirms this fuel ticket belongs to another project.');
  await reversalModal.getByRole('button', { name: 'Request reversal approval' }).click();
  await expect(page.getByText('Environmental correction retained for approver review. The original source and historical reports remain available.')).toBeVisible();
  const reversalApproval = page.locator('.approval-item').filter({ hasText: description });
  await expect(reversalApproval).toHaveCount(1);
  await approveQueueItem(page, reversalApproval, 'Corrected source and compensating removal basis verified.');

  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  await form.getByLabel('Job').selectOption(fixture.job.id);
  activityRow = panel.locator('.field-environmental-row').filter({ hasText: description });
  await expect(activityRow).toContainText('reversed');
  await expect(panel.getByLabel('Environmental register summary')).toContainText('0 kg CO2e');
  await expect(panel.getByLabel('Environmental reports')).toContainText('Source changed');

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await panel.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    panelWidth: element.scrollWidth,
    panelClientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.panelWidth).toBeLessThanOrEqual(geometry.panelClientWidth + 1);
});

test('interrupted environmental activity syncs exactly once through the field outbox', async ({ page, request, context }) => {
  const suffix = Date.now();
  const fixture = await environmentalFixture(request, suffix, 'Offline environmental');
  const description = `Offline delivery distance ${suffix}`;

  await page.goto('/');
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  const form = page.getByTestId('field-environmental-activity-form');
  await form.getByLabel('Job').selectOption(fixture.job.id);
  await form.getByLabel('Category').selectOption('transport');
  await form.getByLabel('Activity description').fill(description);
  await form.getByLabel('Quantity').fill('40');
  await form.getByLabel('Unit', { exact: true }).fill('km');
  await form.getByLabel('Factor (kg CO2e / unit)').fill('0.2');
  await form.getByLabel('Factor source').fill('Offline retained factor library');
  await form.getByLabel('Factor reference').fill(`offline-factor:van:${suffix}`);
  await form.getByLabel('Activity evidence reference').fill(`offline-route:${suffix}`);

  await context.setOffline(true);
  await form.getByRole('button', { name: /Request source review|Save activity offline/ }).click();
  await expect(page.getByText('Environmental activity was saved locally with its source and factor provenance. It will sync after reconnection.')).toBeVisible();
  await expect(page.getByText('1 queued').first()).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Outbox clear')).toBeVisible({ timeout: 15_000 });

  await expect.poll(async () => {
    const response = await request.get(`/api/ledger/jobs/${fixture.job.id}/environmental-activities`);
    if (!response.ok()) return 0;
    const result = await response.json();
    return result.activities.filter(activity => activity.description === description).length;
  }, { timeout: 15_000 }).toBe(1);
});
