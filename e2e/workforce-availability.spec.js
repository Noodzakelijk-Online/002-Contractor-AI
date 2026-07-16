const { test, expect } = require('@playwright/test');

async function postJson(request, route, data) {
  const response = await request.post(route, { data });
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

function localDateTime(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

test('operator retains worker unavailability, sees assignment conflict, and requests governed cancellation', async ({ page, request }) => {
  const suffix = Date.now();
  const worker = (await postJson(request, '/api/ledger/workers', {
    name: `Browser availability worker ${suffix}`,
    role: 'Installer',
    status: 'available'
  })).worker;
  const startsAt = new Date(Date.now() + 12 * 86_400_000);
  startsAt.setUTCHours(8, 0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 8 * 3_600_000);

  await page.goto('/');
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await page.getByRole('tab', { name: 'Availability', exact: true }).click();
  const workspace = page.getByTestId('availability-workspace');
  await expect(workspace).toBeVisible();
  await workspace.getByRole('button', { name: 'Add unavailability' }).click();
  const editor = page.getByTestId('availability-editor');
  await expect(editor).toBeVisible();
  await editor.getByLabel('Worker').selectOption(worker.id);
  await editor.getByLabel('Operational type').selectOption('training');
  await editor.getByLabel('Display title').fill('Browser installation training');
  await editor.getByLabel('Starts').fill(localDateTime(startsAt));
  await editor.getByLabel('Ends').fill(localDateTime(endsAt));
  await editor.getByLabel('Operational note').fill('Capacity planning only.');
  await editor.getByRole('button', { name: 'Block availability window' }).click();
  await expect(page.getByText(/now blocks overlapping scheduling/)).toBeVisible();
  const availabilityRow = workspace.locator('.availability-row').filter({ hasText: worker.name });
  await expect(availabilityRow).toBeVisible();
  await expect(availabilityRow.getByText('Browser installation training')).toBeVisible();
  await expect(availabilityRow.getByText('upcoming', { exact: true })).toBeVisible();

  const job = (await postJson(request, '/api/ledger/intake', {
    title: `Browser availability job ${suffix}`,
    client: { name: 'Browser availability client' },
    status: 'scheduled',
    scheduledStart: startsAt.toISOString(),
    scheduledEnd: endsAt.toISOString(),
    assignAutomatically: false
  })).job;
  const assignment = await postJson(request, `/api/ledger/jobs/${job.id}/assignments`, {
    workerId: worker.id,
    role: 'Installer',
    status: 'planned',
    scheduledStart: startsAt.toISOString(),
    scheduledEnd: endsAt.toISOString()
  });
  expect(assignment.assignment.status).toBe('pending_approval');
  expect(assignment.assignment.availabilityConflicts).toHaveLength(1);

  await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
  await page.getByRole('tab', { name: 'Workforce', exact: true }).click();
  await page.getByRole('tab', { name: 'Availability', exact: true }).click();
  await expect(availabilityRow.getByText('1 conflict', { exact: true })).toBeVisible();
  await availabilityRow.getByRole('button', { name: 'Request cancellation' }).click();
  const cancellationDialog = page.getByTestId('availability-cancellation-modal');
  await cancellationDialog.getByLabel('Operational reason').fill('Training was moved outside this assignment window.');
  await cancellationDialog.getByRole('button', { name: 'Request cancellation approval' }).click();
  await expect(page.getByText(/scheduling block remains active until approval/)).toBeVisible();
  await expect(availabilityRow.getByText('pending cancellation', { exact: true })).toBeVisible();
  await expect(availabilityRow.getByRole('button', { name: 'Review cancellation' })).toBeVisible();

  const approvals = await (await request.get('/api/ledger/approvals?status=pending&limit=100')).json();
  const cancellationApproval = approvals.approvals.find(item => (
    item.targetType === 'worker_availability_cancellation'
    && item.data?.workerId === worker.id
  ));
  expect(cancellationApproval).toBeTruthy();
  await postJson(request, `/api/ledger/approvals/${cancellationApproval.id}/resolve`, {
    status: 'approved',
    resolvedBy: 'Browser availability approver',
    reason: 'Verified operational training move.'
  });

  await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
  await page.getByRole('tab', { name: 'Workforce', exact: true }).click();
  await page.getByRole('tab', { name: 'Availability', exact: true }).click();
  await expect(availabilityRow).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(workspace).toBeVisible();
  const geometry = await workspace.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
});
