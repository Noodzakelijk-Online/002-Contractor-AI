const { test, expect } = require('@playwright/test');

test('operator approves a production baseline, records output offline, and requests a retained reversal', async ({ page, request, context }) => {
  const suffix = Date.now();
  const title = `Browser production control ${suffix}`;
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Interior finishing',
      client: { name: `Browser Production Client ${suffix}` },
      status: 'in_progress',
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const job = (await intakeResponse.json()).job;

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  let workspace = page.getByTestId('job-workspace');
  let production = workspace.getByTestId('production-control');
  await expect(production.getByRole('heading', { name: 'Production control' })).toBeVisible();
  await expect(production.getByText('No approved production baseline')).toBeVisible();

  await production.getByRole('button', { name: 'Create baseline' }).click();
  const baselineForm = production.getByTestId('production-baseline-form');
  await baselineForm.getByLabel('Line key').fill('wall-finish-area');
  await baselineForm.getByLabel('Cost code').fill('LAB-WALL-100');
  await baselineForm.getByLabel('Description').fill('Installed wall finish area');
  await baselineForm.getByLabel('Unit').fill('m2');
  await baselineForm.getByLabel('Planned quantity').fill('100');
  await baselineForm.getByLabel('Labor hours').fill('80');
  await baselineForm.getByLabel('Reviewer context').fill('Measured from approved wall finish drawings and crew plan.');
  await baselineForm.getByRole('button', { name: 'Request baseline approval' }).click();
  await expect(page.getByText(/Production baseline v1 retained for approval/)).toBeVisible();
  await expect(production.getByText(/Baseline v1 is awaiting approval/)).toBeVisible();

  let detailResponse = await request.get(`/api/ledger/jobs/${job.id}`);
  let detail = (await detailResponse.json()).job;
  const baselineApproval = detail.approvals.find(approval => approval.targetType === 'production_baseline' && approval.status === 'pending');
  expect(baselineApproval).toBeTruthy();
  const approvalResponse = await request.post(`/api/ledger/approvals/${baselineApproval.id}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser production approver', reason: 'Measured quantities and labor hours checked.' }
  });
  expect(approvalResponse.ok()).toBeTruthy();

  await page.reload();
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  workspace = page.getByTestId('job-workspace');
  production = workspace.getByTestId('production-control');
  await expect(production.getByText('Installed wall finish area').first()).toBeVisible();
  const entryForm = production.getByTestId('production-entry-form');
  await entryForm.getByLabel('Production line').selectOption('wall-finish-area');
  await entryForm.getByLabel('Installed quantity').fill('25');
  await entryForm.getByLabel('Crew hours').fill('40');
  await entryForm.getByLabel('Field note').fill('First wall zone measured after installation.');
  await entryForm.getByRole('button', { name: 'Record output' }).click();
  await expect(page.getByText('Installed quantity and crew hours were recorded against the approved production baseline.')).toBeVisible();
  await expect(production.getByText('0,5', { exact: true }).first()).toBeVisible();

  await entryForm.getByLabel('Installed quantity').fill('10');
  await entryForm.getByLabel('Crew hours').fill('8');
  await entryForm.getByLabel('Field note').fill('Second wall zone measured while connectivity was unavailable.');
  await context.setOffline(true);
  await entryForm.getByRole('button', { name: 'Save output offline' }).click();
  await expect(page.getByText('Production output was saved locally and will be recorded for this operator after reconnection.')).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Outbox clear')).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => {
    const response = await request.get(`/api/ledger/jobs/${job.id}`);
    if (!response.ok()) return 0;
    return (await response.json()).job.productionEntries.filter(entry => entry.status === 'recorded').length;
  }, { timeout: 15_000 }).toBe(2);

  await page.reload();
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  production = page.getByTestId('job-workspace').getByTestId('production-control');
  const firstZoneEntry = production.locator('.production-entry-row').filter({ hasText: 'First wall zone measured after installation.' });
  await firstZoneEntry.getByRole('button', { name: 'Request reversal for Installed wall finish area' }).click();
  const reversalForm = production.getByTestId('production-reversal-form');
  await reversalForm.getByLabel('Reversal reason').fill('First entry was allocated to the wrong measured work area.');
  await reversalForm.getByRole('button', { name: 'Request reversal approval' }).click();
  await expect(page.getByText('Production reversal retained for approval. The entry remains included until the decision is approved.')).toBeVisible();

  detailResponse = await request.get(`/api/ledger/jobs/${job.id}`);
  detail = (await detailResponse.json()).job;
  const pendingEntry = detail.productionEntries.find(entry => entry.status === 'pending_reversal');
  expect(pendingEntry).toBeTruthy();
  expect(detail.productionControl.summary.crewHours).toBe(48);
  const reversalApproval = detail.approvals.find(approval => approval.id === pendingEntry.reversalApprovalId);
  const reversalApprovalResponse = await request.post(`/api/ledger/approvals/${reversalApproval.id}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser production approver', reason: 'Wrong measured work area verified.' }
  });
  expect(reversalApprovalResponse.ok()).toBeTruthy();
  detailResponse = await request.get(`/api/ledger/jobs/${job.id}`);
  detail = (await detailResponse.json()).job;
  expect(detail.productionEntries.filter(entry => entry.status === 'reversed')).toHaveLength(1);
  expect(detail.productionControl.summary.crewHours).toBe(8);
  expect(detail.audit.some(event => event.action === 'reverse_production_entry')).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  production = page.getByTestId('job-workspace').getByTestId('production-control');
  await expect(production).toBeVisible();
  const geometry = await production.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
});
