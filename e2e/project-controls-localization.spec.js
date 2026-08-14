const { test, expect } = require('@playwright/test');

test('Project controls round-trip locale without changing retained RFI evidence', async ({ page, request }) => {
  const marker = Date.now();
  const title = `Project Control Delta ${marker}`;
  const rfiTitle = `Wall support RFI ${marker}`;
  const rfiQuestion = 'Confirm the retained lintel detail before enlarging the opening.';
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Interior renovation',
      status: 'planned',
      client: { name: `Client De Boer ${marker}`, email: `project-control-${marker}@example.test` },
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
  const controls = workspace.getByTestId('project-controls');
  await expect(controls.getByRole('heading', { name: 'Projectbeheer', exact: true })).toBeVisible();
  await expect(controls.getByText("Open RFI's", { exact: true })).toBeVisible();
  await expect(controls.getByText('Wachtrij indieningen', { exact: true })).toBeVisible();
  await expect(controls.getByRole('tab', { name: /Indieningen/ })).toBeVisible();
  await expect(controls.getByRole('tab', { name: /Verzendstaten/ })).toBeVisible();
  await expect(controls.getByRole('tab', { name: /Vergaderingen/ })).toBeVisible();

  await controls.getByRole('button', { name: 'Nieuwe RFI', exact: true }).click();
  const rfiForm = controls.getByTestId('create-rfi-form');
  await rfiForm.getByLabel('RFI-onderwerp').fill(rfiTitle);
  await rfiForm.getByLabel('Vraag').fill(rfiQuestion);
  await rfiForm.getByLabel('Verantwoordelijke').fill('Ingenieur Janssen');
  await rfiForm.getByLabel('Vakgebied').selectOption('structural');
  await rfiForm.getByRole('button', { name: 'RFI vastleggen', exact: true }).click();

  const rfiRow = controls.locator('.project-control-row').filter({ hasText: rfiTitle });
  await expect(rfiRow).toBeVisible();
  await expect(rfiRow).toContainText(rfiQuestion);
  await expect(rfiRow).toContainText('Constructief');
  await rfiRow.getByRole('button', { name: 'Beantwoorden', exact: true }).click();
  const review = controls.getByTestId('project-control-review-form');
  await expect(review.getByLabel('Antwoord en onderbouwing')).toBeVisible();
  await expect(review.getByRole('button', { name: 'Goedkeuring antwoord aanvragen', exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Annuleren', exact: true }).click();

  await controls.getByRole('tab', { name: /Vergaderingen/ }).click();
  await controls.getByRole('button', { name: 'Nieuwe vergadering', exact: true }).click();
  const meetingForm = controls.getByTestId('create-project-meeting-form');
  await expect(meetingForm.getByLabel('Vergadertitel')).toBeVisible();
  await expect(meetingForm.getByLabel('Vergadertype')).toBeVisible();
  await expect(meetingForm.getByLabel('Voorzitter')).toBeVisible();
  await expect(meetingForm.getByRole('button', { name: 'Conceptnotulen vastleggen', exact: true })).toBeVisible();
  await meetingForm.getByRole('button', { name: 'Annuleren', exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await controls.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.locator('header').getByLabel('Taal', { exact: true }).selectOption('en-GB');
  await expect(controls.getByRole('heading', { name: 'Project controls', exact: true })).toBeVisible();
  await controls.getByRole('tab', { name: /RFIs/ }).click();
  await expect(rfiRow).toContainText(rfiTitle);
  await expect(rfiRow).toContainText(rfiQuestion);
  await expect(rfiRow.getByRole('button', { name: 'Answer', exact: true })).toBeVisible();

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = (await detailResponse.json()).job;
  const retainedRfi = detail.rfis.find(record => record.title === rfiTitle);
  expect(retainedRfi.question).toBe(rfiQuestion);
  expect(retainedRfi.data.discipline).toBe('structural');
  expect(consoleErrors).toEqual([]);
});
