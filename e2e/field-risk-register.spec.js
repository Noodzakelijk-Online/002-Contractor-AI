const { test, expect } = require('@playwright/test');

async function createJob(request, title) {
  const response = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'General contracting',
      status: 'planned',
      client: { name: 'Browser field risk client' },
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

test('field risk register retains observations and syncs one approval-backed offline incident', async ({ page, request, context }) => {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const title = `Browser field risk ${Date.now()}`;
  const intake = await createJob(request, title);
  const workspace = await openJob(page, title);
  const control = workspace.getByTestId('field-risk-control');
  await expect(control.getByRole('heading', { name: 'Field risk register' })).toBeVisible();

  await control.getByRole('button', { name: 'New observation' }).click();
  const observationForm = control.getByTestId('field-observation-form');
  await observationForm.getByLabel('Category').selectOption('quality');
  await observationForm.getByLabel('Severity').selectOption('medium');
  await observationForm.getByLabel('Observation title').fill('Facade fixing spacing requires review');
  await observationForm.getByLabel('Responsible person').fill('Browser site supervisor');
  await observationForm.getByLabel('Observed facts').fill('West elevation row three differs from the retained setting-out record.');
  await observationForm.getByLabel('Immediate control or corrective action').fill('Held the work area for a technical check.');
  await observationForm.getByRole('button', { name: 'Retain observation' }).click();
  await expect(page.getByText('Observation retained in the field risk register.')).toBeVisible();
  await expect(control.getByText('Facade fixing spacing requires review')).toBeVisible();

  await control.getByRole('tab', { name: /Incidents/ }).click();
  await control.getByRole('button', { name: 'Report incident' }).click();
  const incidentForm = control.getByTestId('field-incident-form');
  await incidentForm.getByLabel('Incident type').selectOption('near_miss');
  await incidentForm.getByLabel('Severity').selectOption('high');
  await incidentForm.getByLabel('Incident title').fill('Loose panel moved beside access route');
  await incidentForm.getByLabel('Reported by').fill('Browser field operator');
  await incidentForm.getByLabel('Incident facts').fill('A loose panel shifted beside the occupied access route during handling.');
  await incidentForm.getByLabel('Immediate action').fill('Stopped work and isolated the access route.');
  await incidentForm.getByLabel('Witnesses').fill('Browser site supervisor');

  await context.setOffline(true);
  await expect(incidentForm.getByRole('button', { name: 'Save incident offline' })).toBeVisible();
  await incidentForm.getByRole('button', { name: 'Save incident offline' }).click();
  await expect(page.getByText(/Incident saved locally.*scheduled for exact retry/i)).toBeVisible();
  await context.setOffline(false);

  await expect.poll(async () => {
    const response = await request.get(`/api/ledger/jobs/${intake.job.id}`);
    if (!response.ok()) return null;
    const detail = (await response.json()).job;
    return detail.incidents.filter(record => record.title === 'Loose panel moved beside access route').length;
  }).toBe(1);

  await expect(control.getByText('Loose panel moved beside access route')).toBeVisible();
  await expect(control.getByText('Approval pending')).toBeVisible();

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = (await detailResponse.json()).job;
  expect(detail.observations.filter(record => record.title === 'Facade fixing spacing requires review')).toHaveLength(1);
  const incidents = detail.incidents.filter(record => record.title === 'Loose panel moved beside access route');
  expect(incidents).toHaveLength(1);
  expect(incidents[0].data.description).toContain('occupied access route');
  expect(incidents[0].data.immediateAction).toContain('isolated');
  const approval = detail.approvals.find(item => item.id === incidents[0].approvalId && item.status === 'pending');
  expect(approval).toBeTruthy();
  expect(approval.decision.riskLevel).toBe('high');
  expect(approval.decision.preview.description).toContain('occupied access route');
  expect(approval.decision.safeguards.join(' ')).toContain('Does not notify a regulator');

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await control.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(consoleErrors).toEqual([]);
});
