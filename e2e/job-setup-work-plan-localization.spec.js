const { test, expect } = require('@playwright/test');

test('job setup and work plan round-trip locale without rewriting retained tasks', async ({ page, request }) => {
  const marker = Date.now();
  const title = `Setup and plan locale ${marker}`;
  const retainedEnglishTask = `Retained English task ${marker}`;
  const retainedDutchTask = `Keukenmontage bewijs ${marker}`;
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Interior renovation',
      status: 'planned',
      scheduledStart: '2026-09-07T08:00:00.000Z',
      client: { name: `Locale client ${marker}` },
      tasks: [{ title: retainedEnglishTask, durationHours: 8, priority: 'high' }],
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const intake = await intakeResponse.json();

  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/');
  await page.getByLabel(/^(Language|Taal)$/).selectOption('en-GB');
  await page.locator('header').getByLabel('Language', { exact: true }).selectOption('nl-NL');
  await page.getByRole('button', { name: 'Projecten', exact: true }).click();
  const jobRow = page.locator('tbody tr').filter({ hasText: title });
  await jobRow.getByRole('button', { name: `${title} openen`, exact: true }).click();

  const workspace = page.getByTestId('job-workspace');
  const setup = workspace.getByTestId('capability-setup-control');
  await expect(setup.getByRole('heading', { name: 'Dekking opdrachtinrichting', exact: true })).toBeVisible();
  await expect(setup.getByText('Veilige concepten', { exact: true })).toBeVisible();
  await expect(setup.getByRole('checkbox', { name: /Documenten\/foto's/i })).toBeVisible();
  await setup.getByText(/Handmatige onderbouwing en verplichtingen/).click();
  const incidentGap = setup.getByTestId('manual-capability-incident');
  await expect(incidentGap).toContainText('Incidenten');
  await expect(incidentGap).toContainText('Brononderbouwing');

  const workPlan = workspace.getByTestId('job-task-control');
  await expect(workPlan.getByRole('heading', { name: 'Werkplan', exact: true })).toBeVisible();
  await expect(workPlan.getByText('Geen goedgekeurde baseline', { exact: true })).toBeVisible();
  await expect(workPlan).toContainText(retainedEnglishTask);
  await workPlan.getByLabel('Taaktitel', { exact: true }).fill(retainedDutchTask);
  await workPlan.getByLabel('Duur (uren)', { exact: true }).fill('12');
  await workPlan.getByRole('button', { name: 'Taak toevoegen', exact: true }).click();
  await expect(workPlan).toContainText(retainedDutchTask);
  const dependencyForm = workPlan.locator('.dependency-form');
  await expect(dependencyForm.locator('select').nth(0)).toBeVisible();
  await expect(dependencyForm.locator('select').nth(1)).toBeVisible();
  await expect(dependencyForm).toContainText('Voorganger');
  await expect(dependencyForm).toContainText('Opvolger');
  await expect(workPlan.getByText(/Niet toegewezen \/ hoog \/ uiterlijk/)).toBeVisible();
  await expect(workPlan.getByRole('button', { name: 'Berekenen', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await workspace.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.locator('header').getByLabel('Taal', { exact: true }).selectOption('en-GB');
  await expect(setup.getByRole('heading', { name: 'Job setup coverage', exact: true })).toBeVisible();
  await expect(workPlan.getByRole('heading', { name: 'Work plan', exact: true })).toBeVisible();
  await expect(workPlan).toContainText(retainedEnglishTask);
  await expect(workPlan).toContainText(retainedDutchTask);

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = (await detailResponse.json()).job;
  expect(detail.tasks.map(task => task.title)).toEqual(expect.arrayContaining([retainedEnglishTask, retainedDutchTask]));
  expect(consoleErrors).toEqual([]);
});
