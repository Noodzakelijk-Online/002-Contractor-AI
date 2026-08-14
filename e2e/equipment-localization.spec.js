const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function postJson(request, route, data) {
  const response = await request.post(route, { data });
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

test('Dutch equipment lifecycle preserves evidence through custody and English round trip', async ({ page, request }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const suffix = Date.now();
  const equipmentName = `Retained site laser ${suffix}`;
  const inspector = 'Inspector Van Dijk';
  const technician = 'Technician De Boer';
  const inspectedAt = new Date().toISOString().slice(0, 10);
  const nextInspectionDue = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/');
  await page.getByLabel(/^(Language|Taal)$/).selectOption('en-GB');
  await page.locator('header').getByLabel('Language', { exact: true }).selectOption('nl-NL');
  await page.getByRole('button', { name: 'Middelen', exact: true }).click();
  const resources = page.getByTestId('resources-workspace');
  await resources.getByRole('tab', { name: 'Materieel', exact: true }).click();
  const directory = page.getByTestId('equipment-directory');

  await directory.getByRole('button', { name: 'Materieel toevoegen', exact: true }).click();
  const editor = page.getByTestId('equipment-editor');
  await expect(editor.getByRole('heading', { name: 'Materieel toevoegen', exact: true })).toBeVisible();
  await editor.getByLabel('Materieelnaam').fill(equipmentName);
  await editor.getByLabel('Categorie').fill('measurement');
  await editor.getByLabel('Vaste locatie').fill('Utrecht depot');
  await editor.getByLabel('Huidige locatie').fill('Utrecht depot');
  await editor.getByLabel('Serie- of materieelreferentie').fill(`LASER-${suffix}`);
  await editor.getByLabel('Inspectie vereist voor reservering').check();
  await editor.getByLabel('Inspectie vereist op', { exact: true }).fill(nextInspectionDue);
  await editor.getByLabel('Interne notities').fill('Calibration case and tripod retained with the equipment.');
  await editor.getByRole('button', { name: 'Materieelregistratie opslaan' }).click();
  await expect(page.getByText(new RegExp(`${equipmentName} is vastgelegd als beschikbaar`, 'i'))).toBeVisible();

  let equipmentRow = directory.locator('.equipment-row').filter({ hasText: equipmentName });
  await expect(equipmentRow).toContainText('meting');
  await expect(equipmentRow).toContainText('beschikbaar');
  const list = await (await request.get(`/api/ledger/tools?search=${encodeURIComponent(equipmentName)}&limit=100`)).json();
  const tool = list.tools.find(item => item.name === equipmentName);
  expect(tool).toBeTruthy();
  expect(tool.category).toBe('measurement');

  await equipmentRow.getByRole('button', { name: `Inspectie voor ${equipmentName} vastleggen` }).click();
  let inspection = page.getByTestId('equipment-inspection-modal');
  await expect(inspection.getByRole('heading', { name: 'Materieelinspectie vastleggen' })).toBeVisible();
  await inspection.getByLabel('Inspectieresultaat').selectOption('failed');
  await inspection.getByLabel('Inspecteur of interne referentie').fill(inspector);
  await inspection.getByLabel('Inspectiedatum').fill(inspectedAt);
  await inspection.getByLabel('Onderbouwingsreferentie').fill(`inspection-evidence:${suffix}`);
  await inspection.getByLabel('Bevindingen').fill('Housing damage requires corrective maintenance before reuse.');
  await inspection.getByRole('button', { name: 'Inspectie vastleggen' }).click();
  await expect(page.getByText(new RegExp(`De inspectie van ${equipmentName} is vastgelegd als afgekeurd`, 'i'))).toBeVisible();

  await directory.getByRole('tab', { name: 'Aandacht', exact: true }).click();
  equipmentRow = directory.locator('.equipment-row').filter({ hasText: equipmentName });
  await expect(equipmentRow).toContainText('Inspectie afgekeurd');
  await equipmentRow.getByRole('button', { name: `Onderhoud voor ${equipmentName} vastleggen` }).click();
  const maintenance = page.getByTestId('equipment-maintenance-modal');
  await expect(maintenance.getByRole('heading', { name: 'Materieelonderhoud vastleggen' })).toBeVisible();
  await maintenance.getByLabel('Onderhoudstype').selectOption('corrective');
  await maintenance.getByLabel('Onderhoudsdatum').fill(inspectedAt);
  await maintenance.getByLabel('Persoon of interne referentie').fill(technician);
  await maintenance.getByLabel('Onderbouwingsreferentie').fill(`work-order:${suffix}`);
  await maintenance.getByLabel('Uitgevoerd werk').fill('Housing replaced and internal function check completed.');
  await maintenance.getByRole('button', { name: 'Onderhoud vastleggen' }).click();
  await expect(page.getByText(new RegExp(`Het onderhoud van ${equipmentName} is als voltooid vastgelegd`, 'i'))).toBeVisible();

  equipmentRow = directory.locator('.equipment-row').filter({ hasText: equipmentName });
  await equipmentRow.getByRole('button', { name: `Inspectie voor ${equipmentName} vastleggen` }).click();
  inspection = page.getByTestId('equipment-inspection-modal');
  await expect(inspection).toContainText('Voltooid onderhoud is vastgelegd');
  await inspection.getByLabel('Inspecteur of interne referentie').fill(inspector);
  await inspection.getByLabel('Inspectiedatum').fill(inspectedAt);
  await inspection.getByLabel('Volgende inspectie uiterlijk').fill(nextInspectionDue);
  await inspection.getByLabel('Onderbouwingsreferentie').fill(`reinspection-evidence:${suffix}`);
  await inspection.getByLabel('Bevindingen').fill('Corrective maintenance verified and operational reinspection passed.');
  await inspection.getByRole('button', { name: 'Inspectie vastleggen' }).click();
  await expect(page.getByText(new RegExp(`De inspectie van ${equipmentName} is vastgelegd als goedgekeurd`, 'i'))).toBeVisible();

  const job = (await postJson(request, '/api/ledger/intake', {
    title: `Equipment locale job ${suffix}`,
    client: { name: 'Locale lifecycle client' },
    status: 'in_progress',
    assignAutomatically: false
  })).job;
  const worker = (await postJson(request, '/api/ledger/workers', {
    name: `Custodian Van Rijn ${suffix}`,
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
      resolvedBy: 'Equipment locale approver',
      reason: 'Assignment and retained equipment scope verified.'
    });
  }
  const reservation = (await postJson(request, `/api/ledger/jobs/${job.id}/tools`, {
    toolId: tool.id,
    toolName: tool.name,
    status: 'reserved',
    neededUntil: new Date(Date.now() + 86_400_000).toISOString()
  })).toolReservation;

  await page.reload();
  await page.getByRole('button', { name: 'Middelen', exact: true }).click();
  await resources.getByRole('tab', { name: 'Materieel', exact: true }).click();
  const custodyRegister = page.getByTestId('equipment-custody-register');
  await custodyRegister.getByRole('button', { name: 'Uitgeven', exact: true }).click();
  const checkout = page.getByTestId('equipment-checkout-modal');
  await checkout.getByLabel('Opdracht').selectOption(job.id);
  await expect(checkout.getByLabel('Reservering')).toHaveValue(reservation.id);
  await checkout.getByLabel('Fysieke beheerder').fill(worker.name);
  await checkout.getByLabel('Overdrachtslocatie').fill('Project gate West');
  await checkout.getByLabel('Meterstand').fill('12.5');
  await checkout.getByLabel('Bewijsreferentie overdracht').fill(`handoff-photo:${suffix}`);
  await checkout.getByLabel('Overdrachtsnotitie').fill('Tripod, case, charger, and visible condition checked.');
  await checkout.getByRole('button', { name: 'Uitgifte vastleggen' }).click();
  await expect(page.getByText(`${equipmentName} is uitgegeven aan ${worker.name}.`)).toBeVisible();

  const custodyRow = custodyRegister.locator('.equipment-custody-row').filter({ hasText: equipmentName });
  await expect(custodyRow).toContainText('uitgegeven');
  await custodyRow.getByRole('button', { name: 'Inleveren', exact: true }).click();
  const returned = page.getByTestId('equipment-return-modal');
  await returned.getByLabel('Ingeleverd door').fill(worker.name);
  await returned.getByLabel('Staat bij inlevering').selectOption('damaged');
  await returned.getByLabel('Inleverlocatie').fill('Quarantine bay 2');
  await returned.getByLabel('Meterstand').fill('14');
  await returned.getByLabel('Bewijsreferentie inlevering').fill(`return-photo:${suffix}`);
  await returned.getByLabel('Bevindingen bij inlevering').fill('Tripod clamp bent; equipment isolated from service.');
  await returned.getByRole('button', { name: 'Inlevering vastleggen' }).click();
  await expect(page.getByText(new RegExp(`${equipmentName} is ingeleverd als beschadigd`, 'i'))).toBeVisible();

  await directory.getByRole('tab', { name: 'Aandacht', exact: true }).click();
  equipmentRow = directory.locator('.equipment-row').filter({ hasText: equipmentName });
  await equipmentRow.getByRole('button', { name: `Beeindiging voor ${equipmentName} aanvragen` }).click();
  const retirement = page.getByTestId('equipment-retirement-modal');
  await expect(retirement.getByRole('heading', { name: 'Buitengebruikstelling materieel aanvragen' })).toBeVisible();
  await expect(retirement).toContainText('Er blokkeren momenteel geen operationele reserveringen');
  await retirement.getByLabel('Operationele reden').fill('Equipment removed from use after the retained damage review.');
  await retirement.getByRole('button', { name: 'Goedkeuring buitengebruikstelling aanvragen' }).click();
  await expect(page.getByText(new RegExp(`Goedkeuring voor buitengebruikstelling van ${equipmentName}`, 'i'))).toBeVisible();

  const retained = (await (await request.get(`/api/ledger/tools?search=${encodeURIComponent(equipmentName)}&limit=100`)).json()).tools
    .find(item => item.id === tool.id);
  expect(retained.data).toMatchObject({
    serialNumber: `LASER-${suffix}`,
    notes: 'Calibration case and tripod retained with the equipment.'
  });
  expect(retained.data.inspectionHistory).toHaveLength(2);
  expect(retained.data.inspectionHistory.map(item => item.reference)).toEqual([
    `inspection-evidence:${suffix}`,
    `reinspection-evidence:${suffix}`
  ]);
  expect(retained.data.maintenanceHistory).toHaveLength(1);
  expect(retained.data.maintenanceHistory[0]).toMatchObject({
    performedBy: technician,
    reference: `work-order:${suffix}`,
    notes: 'Housing replaced and internal function check completed.'
  });
  const custody = await (await request.get(`/api/ledger/jobs/${job.id}/equipment-custody`)).json();
  expect(custody.custody.find(item => item.toolId === tool.id)).toMatchObject({
    checkoutEvidenceReference: `handoff-photo:${suffix}`,
    returnEvidenceReference: `return-photo:${suffix}`,
    returnCondition: 'damaged'
  });

  await page.locator('header').getByLabel('Taal', { exact: true }).selectOption('en-GB');
  await expect(resources.getByRole('heading', { name: 'Resource readiness', exact: true })).toBeVisible();
  await expect(equipmentRow).toContainText(/retirement pending/i);
  await expect(equipmentRow).toContainText(equipmentName);

  const accessibility = await new AxeBuilder({ page }).include('[data-testid="resources-workspace"]').analyze();
  expect(accessibility.violations).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await resources.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(consoleErrors).toEqual([]);
});
