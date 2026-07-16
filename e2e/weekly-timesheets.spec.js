const { test, expect } = require('@playwright/test');

function weekStart(offsetWeeks = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1 - offsetWeeks * 7);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

async function postJson(request, route, data) {
  const response = await request.post(route, { data });
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

test('operator reviews a weekly timesheet, approves it, and downloads a controlled handoff on desktop and mobile', async ({ page, request }) => {
  const suffix = Date.now();
  const periodStart = weekStart(1);
  const worker = (await postJson(request, '/api/ledger/workers', {
    name: `Browser timesheet crew ${suffix}`,
    role: 'Installer',
    status: 'available',
    hourlyRate: 46
  })).worker;
  const job = (await postJson(request, '/api/ledger/intake', {
    title: `Browser timesheet job ${suffix}`,
    client: { name: 'Browser timesheet client' },
    status: 'in_progress',
    assignAutomatically: false
  })).job;
  await postJson(request, `/api/ledger/jobs/${job.id}/time-logs`, {
    workerId: worker.id,
    workDate: periodStart,
    hours: 8,
    rate: 46,
    source: 'browser_verified_timecard',
    verificationReference: `BROWSER-TIME-${suffix}`,
    notes: 'Verified browser timesheet shift.'
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await page.getByRole('tab', { name: 'Timesheets', exact: true }).click();
  const workspace = page.getByTestId('timesheet-workspace');
  await expect(workspace).toBeVisible();
  await workspace.getByLabel('Week starting').fill(periodStart);
  const row = workspace.getByTestId(`timesheet-row-${worker.id}`);
  await expect(row.getByText(worker.name)).toBeVisible();
  await expect(row.getByText('8 logged')).toBeVisible();
  await row.getByRole('button', { name: 'Request review' }).click();
  await expect(page.getByText('Weekly timesheet frozen and sent to the internal approval queue.')).toBeVisible();
  await expect(row.getByText('pending approval')).toBeVisible();

  const approvalsResponse = await request.get('/api/ledger/approvals?status=pending&limit=100');
  expect(approvalsResponse.ok()).toBeTruthy();
  const timesheetApproval = (await approvalsResponse.json()).approvals.find(item => item.targetType === 'weekly_timesheet' && item.data?.workerId === worker.id);
  expect(timesheetApproval).toBeTruthy();
  await postJson(request, `/api/ledger/approvals/${timesheetApproval.id}/resolve`, {
    status: 'approved',
    resolvedBy: 'Browser timesheet approver',
    reason: 'Worker time source and weekly allocation were verified.'
  });

  await workspace.getByLabel('Week starting').fill(weekStart(0));
  await workspace.getByLabel('Week starting').fill(periodStart);
  await expect(row.getByText('approved')).toBeVisible();
  await workspace.getByTestId('prepare-timesheet-export').click();
  await expect(page.getByText('Checksum-protected timesheet handoff prepared. No payroll or provider action was performed.')).toBeVisible();
  await expect(workspace.getByRole('link', { name: 'Download latest' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await workspace.getByRole('link', { name: 'Download latest' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`contractor-ai-timesheets-${periodStart}.csv`);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(workspace).toBeVisible();
  const navigation = page.getByLabel('Primary navigation');
  const openNavigation = page.getByRole('button', { name: 'Open navigation' });
  await expect(openNavigation).toBeVisible();
  await expect.poll(() => navigation.evaluate(element => element.getBoundingClientRect().right <= 0)).toBe(true);
  await openNavigation.click();
  await expect.poll(() => navigation.evaluate(element => element.getBoundingClientRect().left >= 0)).toBe(true);
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await expect.poll(() => navigation.evaluate(element => element.getBoundingClientRect().right <= 0)).toBe(true);
  const geometry = await workspace.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
});
