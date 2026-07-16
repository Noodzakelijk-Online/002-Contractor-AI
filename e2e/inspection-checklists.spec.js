const { test, expect } = require('@playwright/test');

async function createJob(request, title) {
  const response = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'General contracting',
      status: 'planned',
      client: { name: 'Browser inspection client' },
      assignAutomatically: false
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function openJob(page, title) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  const workspace = page.getByTestId('job-workspace');
  await expect(workspace.getByRole('heading', { name: title })).toBeVisible();
  return workspace;
}

test('operator schedules, completes, approves, and reopens an inspection checklist', async ({ page, request }) => {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const title = `Browser inspection checklist ${Date.now()}`;
  const intake = await createJob(request, title);
  let workspace = await openJob(page, title);
  let control = workspace.getByTestId('inspection-checklist-control');
  await expect(control.getByRole('heading', { name: 'Inspection checklists' })).toBeVisible();

  await control.getByRole('button', { name: 'Schedule', exact: true }).click();
  const schedule = control.getByTestId('inspection-schedule-form');
  await schedule.getByLabel('Inspection title').fill('Pre-close quality inspection');
  await schedule.getByLabel('Inspector').fill('Browser site inspector');
  await schedule.getByRole('button', { name: 'Schedule checklist' }).click();
  await expect(page.getByText(/scheduled with an immutable template snapshot/i)).toBeVisible();

  const row = control.locator('.inspection-checklist-row').filter({ hasText: 'Pre-close quality inspection' });
  await expect(row.getByText('scheduled', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Complete' }).click();

  const checklist = control.getByTestId('inspection-checklist-form');
  const resultGroups = checklist.getByRole('radiogroup');
  const itemCount = await resultGroups.count();
  expect(itemCount).toBeGreaterThanOrEqual(2);
  for (let index = 0; index < itemCount; index += 1) {
    await resultGroups.nth(index).getByRole('radio', { name: 'Pass' }).check();
  }
  await checklist.getByLabel('Inspection summary').fill('Every retained item was checked against the current work and available evidence.');
  await checklist.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText(/0 failed item\(s\) retained.*waiting for approval/i)).toBeVisible();

  let detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  let detail = (await detailResponse.json()).job;
  let inspection = detail.inspections.find(record => record.title === 'Pre-close quality inspection');
  expect(inspection.status).toBe('pending_approval');
  expect(inspection.checklist.submissions).toHaveLength(1);
  expect(inspection.checklist.submissions[0].integrityValid).toBe(true);
  const approval = detail.approvals.find(item => item.id === inspection.approvalId && item.status === 'pending');
  expect(approval).toBeTruthy();
  const approvalResponse = await request.post(`/api/ledger/approvals/${approval.id}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Browser inspection owner',
      reason: 'Complete responses and retained immutable checklist snapshot verified.'
    }
  });
  expect(approvalResponse.ok()).toBeTruthy();

  workspace = await openJob(page, title);
  control = workspace.getByTestId('inspection-checklist-control');
  const approvedRow = control.locator('.inspection-checklist-row').filter({ hasText: 'Pre-close quality inspection' });
  await expect(approvedRow.getByText('passed', { exact: true })).toBeVisible();
  await expect(approvedRow.getByText(/\d+ responses \/ 0 failed/)).toBeVisible();

  detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  detail = (await detailResponse.json()).job;
  inspection = detail.inspections.find(record => record.title === 'Pre-close quality inspection');
  expect(inspection.status).toBe('passed');
  expect(inspection.checklist.status).toBe('passed');

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await control.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(consoleErrors).toEqual([]);
});
