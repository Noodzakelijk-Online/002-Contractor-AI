const { test, expect } = require('@playwright/test');

async function postJson(request, route, data) {
  const response = await request.post(route, { data });
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function waitForResources(page) {
  await expect(page.getByText('Loading resources', { exact: true })).toBeHidden({ timeout: 15_000 });
}

test('operator enforces a job qualification, submits worker evidence, and verifies responsive readiness', async ({ page, request }) => {
  const suffix = Date.now();
  const worker = (await postJson(request, '/api/ledger/workers', {
    name: `Browser qualification worker ${suffix}`,
    role: 'Installer',
    status: 'available'
  })).worker;
  const job = (await postJson(request, '/api/ledger/intake', {
    title: `Browser qualification job ${suffix}`,
    client: { name: 'Browser qualification client' },
    status: 'scheduled',
    scheduledStart: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    scheduledEnd: new Date(Date.now() + 8 * 86_400_000).toISOString(),
    assignAutomatically: false
  })).job;
  await postJson(request, `/api/ledger/jobs/${job.id}/assignments`, {
    workerId: worker.id,
    role: 'Installer',
    status: 'planned'
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await waitForResources(page);
  await page.getByRole('tab', { name: 'Qualifications', exact: true }).click();
  const workspace = page.getByTestId('qualification-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace.getByText(worker.name)).toBeVisible();

  await workspace.getByRole('button', { name: 'Add job requirement' }).click();
  const requirementDialog = page.getByTestId('qualification-requirement-editor');
  await expect(requirementDialog).toBeVisible();
  await requirementDialog.getByLabel('Job').selectOption(job.id);
  await requirementDialog.getByLabel('Requirement type').selectOption('vca');
  await requirementDialog.getByLabel('Applies to role').fill('Installer');
  await requirementDialog.getByLabel('Requirement title').fill('Current VCA for installation access');
  await requirementDialog.getByRole('button', { name: 'Enforce requirement' }).click();
  await expect(page.getByText(/is now enforced in assignment, dispatch, site-access, and attendance readiness/)).toBeVisible();
  await expect(workspace.getByText('Current VCA for installation access')).toBeVisible();

  const workerRow = workspace.locator('.qualification-worker-row').filter({ hasText: worker.name });
  await expect(workerRow.getByText('missing', { exact: true })).toBeVisible();
  await workerRow.getByRole('button', { name: 'Add evidence' }).click();
  const credentialDialog = page.getByTestId('credential-editor');
  await expect(credentialDialog).toBeVisible();
  await credentialDialog.getByLabel('Credential type').selectOption('vca_basic');
  await credentialDialog.getByLabel('Issuer').fill('SSVV browser source');
  await credentialDialog.getByLabel('Credential number').fill(`BROWSER-VCA-${suffix}`);
  await credentialDialog.getByLabel('Expires on').fill(new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10));
  await credentialDialog.getByLabel('Evidence reference').fill(`Retained browser VCA scan ${suffix}`);
  await credentialDialog.getByRole('button', { name: 'Request evidence verification' }).click();
  await expect(page.getByText(/evidence was retained for approval/)).toBeVisible();
  await expect(workerRow.locator('.status-pending_approval')).toBeVisible();
  await expect(workerRow.getByRole('button', { name: 'Review' })).toBeVisible();

  const approvals = await (await request.get('/api/ledger/approvals?status=pending&limit=100')).json();
  const credentialApproval = approvals.approvals.find(item => item.targetType === 'worker_credential' && item.data?.workerId === worker.id);
  expect(credentialApproval).toBeTruthy();
  await postJson(request, `/api/ledger/approvals/${credentialApproval.id}/resolve`, {
    status: 'approved',
    resolvedBy: 'Browser qualification approver',
    reason: 'Credential identity, issuer, dates, and source evidence verified.'
  });

  await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
  await page.getByRole('tab', { name: 'Workforce', exact: true }).click();
  await waitForResources(page);
  await page.getByRole('tab', { name: 'Qualifications', exact: true }).click();
  await expect(workerRow.getByText('current', { exact: true })).toBeVisible();
  await expect(workerRow.getByText('VCA Basic')).toBeVisible();
  await expect(workspace.locator('.qualification-summary > div').filter({ hasText: 'Blocked assignments' }).getByText('0', { exact: true })).toBeVisible();

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
