const { test, expect } = require('@playwright/test');

async function postJson(request, route, data) {
  const response = await request.post(route, { data });
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function equipmentFixture(request, suffix, prefix = 'Browser custody') {
  const job = (await postJson(request, '/api/ledger/intake', {
    title: `${prefix} ${suffix}`,
    client: { name: `${prefix} client` },
    status: 'in_progress',
    assignAutomatically: false
  })).job;
  const worker = (await postJson(request, '/api/ledger/workers', {
    name: `${prefix} operator ${suffix}`,
    role: 'Equipment operator',
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
      resolvedBy: 'Browser custody approver',
      reason: 'Equipment operator assignment and job scope verified.'
    });
  }
  const tool = (await postJson(request, '/api/ledger/tools', {
    name: `${prefix} lift ${suffix}`,
    category: 'access',
    status: 'available',
    homeLocation: 'Utrecht depot',
    currentLocation: 'Utrecht depot'
  })).tool;
  const reservation = (await postJson(request, `/api/ledger/jobs/${job.id}/tools`, {
    toolId: tool.id,
    toolName: tool.name,
    status: 'reserved',
    neededUntil: new Date(Date.now() + 86_400_000).toISOString()
  })).toolReservation;
  return { job, worker, tool, reservation };
}

test('office operator checks out reserved equipment and quarantines a damaged return', async ({ page, request }) => {
  const suffix = Date.now();
  const fixture = await equipmentFixture(request, suffix);

  await page.goto('/');
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await page.getByRole('tab', { name: 'Equipment', exact: true }).click();
  const register = page.getByTestId('equipment-custody-register');
  await expect(register).toBeVisible();
  await register.getByRole('button', { name: 'Check out', exact: true }).click();

  const checkout = page.getByTestId('equipment-checkout-modal');
  await checkout.getByLabel('Job').selectOption(fixture.job.id);
  await expect(checkout.getByLabel('Reservation')).toHaveValue(fixture.reservation.id);
  await checkout.getByLabel('Physical custodian').fill(fixture.worker.name);
  await checkout.getByLabel('Handoff location').fill('Browser project gate');
  await checkout.getByLabel('Meter').fill('125.5');
  await checkout.getByLabel('Handoff evidence reference').fill(`browser-handoff:${suffix}`);
  await checkout.getByLabel('Handoff note').fill('Keys, charger, and visible condition checked with the operator.');
  await checkout.getByRole('button', { name: 'Retain checkout' }).click();
  await expect(page.getByText(`${fixture.tool.name} checked out to ${fixture.worker.name}.`)).toBeVisible();

  const custodyRow = register.locator('.equipment-custody-row').filter({ hasText: fixture.tool.name });
  await expect(custodyRow).toContainText('checked out');
  await custodyRow.getByRole('button', { name: 'Return', exact: true }).click();
  const returned = page.getByTestId('equipment-return-modal');
  await returned.getByLabel('Returned by').fill(fixture.worker.name);
  await returned.getByLabel('Return condition').selectOption('damaged');
  await returned.getByLabel('Return location').fill('Browser quarantine bay');
  await returned.getByLabel('Meter').fill('129.25');
  await returned.getByLabel('Return evidence reference').fill(`browser-return-photo:${suffix}`);
  await returned.getByLabel('Return findings').fill('Hydraulic guard bent; lift isolated from service for internal review.');
  await returned.getByRole('button', { name: 'Retain return' }).click();
  await expect(page.getByText(`${fixture.tool.name} returned as damaged and moved to quarantine review.`)).toBeVisible();
  await expect(register.locator('.equipment-custody-row').filter({ hasText: fixture.tool.name })).toContainText('exception');

  const tools = await (await request.get('/api/ledger/tools?limit=500')).json();
  expect(tools.tools.find(tool => tool.id === fixture.tool.id).status).toBe('maintenance');
  const registerApi = await (await request.get('/api/ledger/equipment-custody?limit=500')).json();
  expect(registerApi.equipmentCustody.exceptions.filter(item => item.toolId === fixture.tool.id)).toHaveLength(1);

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await register.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
});

test('interrupted field equipment checkout syncs exactly once through the scoped outbox', async ({ page, request, context }) => {
  const suffix = Date.now();
  const fixture = await equipmentFixture(request, suffix, 'Offline custody');

  await page.goto('/');
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  const custody = page.getByTestId('field-equipment-custody');
  await custody.getByLabel('Job').selectOption(fixture.job.id);
  const form = custody.getByTestId('field-equipment-checkout-form');
  await expect(form.getByLabel('Reservation')).toHaveValue(fixture.reservation.id);
  await form.getByLabel('Physical custodian').fill(fixture.worker.name);
  await form.getByLabel('Handoff location').fill('Offline project gate');
  await form.getByLabel('Handoff evidence reference').fill(`offline-handoff:${suffix}`);

  await context.setOffline(true);
  await form.getByRole('button', { name: /Retain checkout|Save handoff offline/ }).click();
  await expect(page.getByText('Equipment handoff was saved locally with its custody evidence and will sync after reconnection.')).toBeVisible();
  await expect(page.getByText('1 queued').first()).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Outbox clear')).toBeVisible({ timeout: 15_000 });

  await expect.poll(async () => {
    const response = await request.get(`/api/ledger/jobs/${fixture.job.id}`);
    if (!response.ok()) return 0;
    const detail = (await response.json()).job;
    return detail.equipmentCustody.filter(item => item.toolId === fixture.tool.id && item.status === 'checked_out').length;
  }, { timeout: 15_000 }).toBe(1);
});
