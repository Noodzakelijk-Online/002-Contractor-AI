const { test, expect } = require('@playwright/test');

test('operator retains safe job setup drafts while evidence and commitments remain manual', async ({ page, request }) => {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const title = `Browser governed setup ${Date.now()}`;
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Commercial fit-out',
      description: 'Prepare the internal fit-out package without inventing site observations or financial transactions.',
      address: 'Maliebaan 12, Utrecht',
      city: 'Utrecht',
      client: { name: 'Governed setup client' },
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const intake = await intakeResponse.json();
  const coverageBefore = intake.job.capabilitySummary.averageCoverage;

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: `Open ${title}` }).first().click();

  const workspace = page.getByTestId('job-workspace');
  const setup = workspace.getByTestId('capability-setup-control');
  await expect(setup.getByRole('heading', { name: 'Job setup coverage' })).toBeVisible();
  await expect(setup.getByText('Manual evidence and commitments', { exact: false })).toBeVisible();
  await setup.getByText('Manual evidence and commitments', { exact: false }).click();

  const incidentGap = setup.getByTestId('manual-capability-incident');
  await expect(incidentGap).toContainText('Incidents');
  await expect(incidentGap).toContainText('Source evidence');
  await expect(incidentGap.getByRole('checkbox')).toHaveCount(0);

  const documentDraft = setup.getByRole('checkbox', { name: /Documents\/photos/i });
  await expect(documentDraft).toBeEnabled();
  await documentDraft.check();
  await setup.getByTestId('apply-capability-setup').click();
  await expect(page.getByText('1 internal setup draft retained.')).toBeVisible();
  await expect(documentDraft).toHaveCount(0);

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = (await detailResponse.json()).job;
  expect(detail.documents.length).toBeGreaterThanOrEqual(1);
  expect(detail.capabilitySummary.averageCoverage).toBeGreaterThan(coverageBefore);
  expect(detail.siteVisits).toHaveLength(0);
  expect(detail.incidents).toHaveLength(0);
  expect(detail.expenses).toHaveLength(0);
  expect(detail.payments).toHaveLength(0);
  expect(detail.audit.some(event => event.action === 'apply_capability_gap_plan')).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await setup.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(consoleErrors).toEqual([]);
});
