const { test, expect } = require('@playwright/test');

async function createJob(request, title) {
  const response = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'General contracting',
      status: 'planned',
      client: { name: 'Browser closeout client' },
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

test('closeout register syncs an offline punch and connects warranty and aftercare lifecycle', async ({ page, request, context }) => {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const title = `Browser closeout ${Date.now()}`;
  const intake = await createJob(request, title);
  const workspace = await openJob(page, title);
  const register = workspace.getByTestId('closeout-register');
  await expect(register.getByRole('heading', { name: 'Closeout and aftercare' })).toBeVisible();

  await register.getByRole('button', { name: 'New punch item' }).click();
  const punchForm = register.getByTestId('closeout-punch_item-form');
  await punchForm.getByLabel('Severity').selectOption('high');
  await punchForm.getByLabel('Punch title').fill('Door frame finish requires correction');
  await punchForm.getByLabel('Assigned to').fill('Browser finishing supervisor');
  await punchForm.getByLabel('Location').fill('Level 2 room 2.14');
  await punchForm.getByLabel('Observed condition').fill('Paint edge is incomplete at the retained frame location.');

  await context.setOffline(true);
  await expect(punchForm.getByRole('button', { name: 'Save punch item offline' })).toBeVisible();
  await punchForm.getByRole('button', { name: 'Save punch item offline' }).click();
  await expect(page.getByText(/Punch item saved locally.*scheduled for exact retry/i)).toBeVisible();
  await context.setOffline(false);

  await expect.poll(async () => {
    const response = await request.get(`/api/ledger/jobs/${intake.job.id}`);
    if (!response.ok()) return null;
    const detail = (await response.json()).job;
    return detail.punchItems.filter(record => record.title === 'Door frame finish requires correction').length;
  }).toBe(1);
  await expect(register.getByText('Door frame finish requires correction')).toBeVisible();

  await register.getByRole('button', { name: 'Resolve punch' }).click();
  const lifecycle = page.getByTestId('client-lifecycle-modal');
  await lifecycle.getByLabel('Evidence and outcome').fill('Finish corrected, inspected in daylight, and retained against the room record.');
  await lifecycle.getByRole('button', { name: 'Request resolution approval' }).click();
  await expect(page.getByText(/Punch resolution review retained as a pending approval/i)).toBeVisible();
  await expect(register.getByText('Approval pending')).toBeVisible();

  const punchDetailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(punchDetailResponse.ok()).toBeTruthy();
  const punchDetail = (await punchDetailResponse.json()).job;
  const punch = punchDetail.punchItems.find(record => record.title === 'Door frame finish requires correction');
  const punchApproval = punchDetail.approvals.find(approval => approval.id === punch.approvalId && approval.status === 'pending');
  expect(punchApproval).toBeTruthy();
  expect(punchApproval.decision.preview.title).toBe('Door frame finish requires correction');
  expect(punchApproval.decision.preview.location).toBe('Level 2 room 2.14');
  expect(punchApproval.decision.preview.description).toContain('Paint edge');
  expect(punchApproval.decision.safeguards.join(' ')).toContain('Does not notify the client');

  await register.getByRole('tab', { name: /Warranty/ }).click();
  await register.getByRole('button', { name: 'New warranty claim' }).click();
  const warrantyForm = register.getByTestId('closeout-warranty_claim-form');
  await warrantyForm.getByLabel('Warranty type').selectOption('workmanship');
  await warrantyForm.getByLabel('Severity').selectOption('medium');
  await warrantyForm.getByLabel('Claim title').fill('Cabinet hinge alignment report');
  await warrantyForm.getByLabel('Reported issue').fill('Client reported that the retained cabinet door does not close evenly.');
  await warrantyForm.getByRole('button', { name: 'Retain warranty claim' }).click();
  await expect(page.getByText(/Warranty claim retained for internal review/i)).toBeVisible();
  await expect(register.getByText('Cabinet hinge alignment report')).toBeVisible();

  await register.getByRole('tab', { name: /Aftercare/ }).click();
  await register.getByRole('button', { name: 'New follow-up' }).click();
  const aftercareForm = register.getByTestId('closeout-aftercare-form');
  await aftercareForm.getByLabel('Follow-up type').selectOption('client_follow_up');
  await aftercareForm.getByLabel('Channel').selectOption('phone');
  await aftercareForm.getByLabel('Follow-up title').fill('Seven-day installation check');
  await aftercareForm.getByLabel('Owner').fill('Browser office operator');
  await aftercareForm.getByLabel('Follow-up purpose').fill('Confirm operation and retain any reported issue without promising work.');
  await aftercareForm.getByRole('button', { name: 'Retain follow-up' }).click();
  await expect(page.getByText(/Aftercare follow-up retained internally/i)).toBeVisible();
  await expect(register.getByText('Seven-day installation check')).toBeVisible();

  await register.getByRole('button', { name: 'Complete follow-up' }).click();
  await lifecycle.getByLabel('Evidence and outcome').fill('Client confirmed normal operation; no new issue or commitment was recorded.');
  await lifecycle.getByRole('button', { name: 'Complete internal follow-up' }).click();
  await expect(page.getByText(/Aftercare outcome completed in the internal ledger/i)).toBeVisible();
  await expect(register.getByText('completed')).toBeVisible();

  const finalDetailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  const finalDetail = (await finalDetailResponse.json()).job;
  expect(finalDetail.punchItems.filter(record => record.title === 'Door frame finish requires correction')).toHaveLength(1);
  expect(finalDetail.warrantyClaims.filter(record => record.title === 'Cabinet hinge alignment report')).toHaveLength(1);
  expect(finalDetail.aftercare.find(record => record.title === 'Seven-day installation check').status).toBe('completed');

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await register.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(consoleErrors).toEqual([]);
});
