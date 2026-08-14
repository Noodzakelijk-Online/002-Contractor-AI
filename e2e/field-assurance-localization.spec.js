const { test, expect } = require('@playwright/test');

test('field assurance, NCR, and risk controls switch locale without rewriting retained evidence', async ({ page, request }) => {
  const marker = Date.now();
  const title = `Retained field assurance ${marker}`;
  const observationTitle = `Retained gevelobservatie ${marker}`;
  const observedFacts = `Retained westgevel evidence ${marker}`;
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Facade quality assurance',
      status: 'in_progress',
      client: { name: `Field assurance client ${marker}` },
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
  const ncr = workspace.getByTestId('nonconformance-control');
  await expect(ncr.getByRole('heading', { name: 'Afwijkingenregister', exact: true })).toBeVisible();
  await ncr.getByRole('button', { name: 'Nieuwe afwijking', exact: true }).click();
  const ncrForm = ncr.getByTestId('nonconformance-create-form');
  await expect(ncrForm.getByLabel('Titel afwijking', { exact: true })).toBeVisible();
  await expect(ncrForm.getByLabel('Directe beheersmaatregel', { exact: true })).toBeVisible();
  await ncrForm.getByRole('button', { name: 'Annuleren', exact: true }).click();

  const risk = workspace.getByTestId('field-risk-control');
  await expect(risk.getByRole('heading', { name: 'Risicoregister bouwplaats', exact: true })).toBeVisible();
  await risk.getByRole('button', { name: 'Nieuwe observatie', exact: true }).click();
  const observationForm = risk.getByTestId('field-observation-form');
  await observationForm.getByLabel('Titel observatie', { exact: true }).fill(observationTitle);
  await observationForm.getByLabel('Verantwoordelijke persoon', { exact: true }).fill('Retained uitvoerder');
  await observationForm.getByLabel('Waargenomen feiten', { exact: true }).fill(observedFacts);
  await observationForm.getByLabel('Directe beheersing of corrigerende maatregel', { exact: true }).fill('Retained hold point pending review');
  await observationForm.getByRole('button', { name: 'Observatie vastleggen', exact: true }).click();
  const observationCard = risk.locator('.field-risk-row').filter({ hasText: observationTitle });
  await expect(observationCard.getByText(observationTitle, { exact: true })).toBeVisible();
  await expect(observationCard.getByText(observedFacts, { exact: true })).toBeVisible();
  await risk.getByRole('tab', { name: /Incidenten/ }).click();
  await expect(risk.getByRole('button', { name: 'Incident melden', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const jobGeometry = await workspace.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(jobGeometry.pageWidth).toBeLessThanOrEqual(jobGeometry.viewportWidth + 1);
  expect(jobGeometry.scrollWidth).toBeLessThanOrEqual(jobGeometry.clientWidth + 1);

  await page.setViewportSize({ width: 1440, height: 900 });
  await workspace.getByRole('button', { name: 'Opdrachtwerkruimte sluiten', exact: true }).click();
  await page.getByRole('button', { name: 'Buitendienst', exact: true }).click();
  const fieldWorkspace = page.getByTestId('field-workspace');
  const assurance = page.getByTestId('field-assurance-workspace');
  await expect(fieldWorkspace.getByRole('heading', { name: 'Bouwplaatsupdates', exact: true })).toBeVisible();
  await expect(assurance.getByRole('heading', { name: 'Borgingswachtrij', exact: true })).toBeVisible();
  const assuranceRow = assurance.locator('.assurance-item').filter({ hasText: title });
  await expect(assuranceRow).toContainText('JHA-, VIB-, veiligheidsinstructie- en toegangsonderbouwing voorbereiden');
  await expect(assuranceRow.locator('.status')).toHaveText('veiligheidshiaat');
  await assuranceRow.getByRole('button', { name: `Observatie oplossen voor ${title}`, exact: true }).click();
  const reviewDialog = page.getByTestId('field-assurance-modal');
  await expect(reviewDialog.getByRole('heading', { name: 'Observatie oplossen', exact: true })).toBeVisible();
  await expect(reviewDialog.getByLabel('Onderbouwing en besluit', { exact: true })).toBeVisible();
  await expect(reviewDialog.getByRole('button', { name: 'Beoordeling aanvragen', exact: true })).toBeVisible();
  await reviewDialog.getByRole('button', { name: 'Annuleren', exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  const fieldGeometry = await fieldWorkspace.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(fieldGeometry.pageWidth).toBeLessThanOrEqual(fieldGeometry.viewportWidth + 1);
  expect(fieldGeometry.scrollWidth).toBeLessThanOrEqual(fieldGeometry.clientWidth + 1);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('header').getByLabel('Taal', { exact: true }).selectOption('en-GB');
  await expect(assurance.getByRole('heading', { name: 'Assurance queue', exact: true })).toBeVisible();
  await expect(assuranceRow).toContainText(title);
  await expect(assuranceRow).toContainText('Prepare JHA, SDS, safety talk, and access evidence');

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = (await detailResponse.json()).job;
  const observation = detail.observations.find(record => record.title === observationTitle);
  expect(observation).toBeTruthy();
  expect(observation.data.notes).toBe(observedFacts);
  expect(consoleErrors).toEqual([]);
});
