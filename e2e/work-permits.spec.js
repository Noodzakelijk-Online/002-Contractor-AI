const { test, expect } = require('@playwright/test');

async function postJson(request, route, data) {
  const response = await request.post(route, { data });
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function openPermit(page, jobId, permitId) {
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  const panel = page.getByTestId('work-permit-control');
  await expect(panel.getByRole('heading', { name: 'Work permits' })).toBeVisible();
  const selectors = panel.locator('.work-permit-selector select');
  await selectors.nth(0).selectOption(jobId);
  if (permitId) {
    await expect(selectors.nth(1).locator(`option[value="${permitId}"]`)).toHaveCount(1);
    await selectors.nth(1).selectOption(permitId);
  } else {
    await expect(selectors.nth(1)).toContainText('No retained permit');
  }
  return panel;
}

test('permit approval, crew acceptance, stop work, closeout, and mobile layout stay connected', async ({ page, request }) => {
  const suffix = Date.now();
  const worker = (await postJson(request, '/api/ledger/workers', {
    name: `Browser permit electrician ${suffix}`,
    role: 'Electrician',
    status: 'available'
  })).worker;
  const job = (await postJson(request, '/api/ledger/intake', {
    title: `Browser permit project ${suffix}`,
    client: { name: 'Browser permit client' },
    status: 'in_progress',
    assignAutomatically: false
  })).job;
  const assignment = await postJson(request, `/api/ledger/jobs/${job.id}/assignments`, {
    workerId: worker.id,
    workerName: worker.name,
    role: worker.role,
    status: 'assigned'
  });
  if (assignment.approval?.id) {
    await postJson(request, `/api/ledger/approvals/${assignment.approval.id}/resolve`, {
      status: 'approved',
      resolvedBy: 'Browser permit approver',
      reason: 'Worker identity, role, availability, and project assignment verified.'
    });
  }

  await page.goto('/');
  let panel = await openPermit(page, job.id);
  const permitTitle = `Distribution isolation permit ${suffix}`;
  await panel.getByLabel('Permit type').selectOption('electrical_isolation');
  await panel.getByLabel('Title').fill(permitTitle);
  await panel.getByLabel('Location').fill('Main plant room');
  await panel.getByLabel('Valid from').fill(new Date(Date.now() - 5 * 60 * 1000).toISOString().slice(0, 16));
  await panel.getByLabel('Expires').fill(new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 16));
  await panel.getByLabel('Source evidence').fill(`browser-risk-assessment:${suffix}`);
  await panel.getByLabel('Hazards').fill('Stored electrical energy\nUnexpected re-energization');
  await panel.getByLabel('Controls').fill('Lock and tag isolation\nProve dead before work');
  await panel.getByLabel('Conditions').fill('Suspend if the isolation boundary changes');
  await panel.getByRole('button', { name: 'Request approval' }).click();
  await expect(page.getByText('Permit definition and assigned crew were frozen for approval.')).toBeVisible();

  const permitResponse = await request.get(`/api/ledger/jobs/${job.id}/work-permits`);
  expect(permitResponse.ok()).toBeTruthy();
  const permit = (await permitResponse.json()).workPermits.find(record => record.title === permitTitle);
  expect(permit).toBeTruthy();
  expect(permit.status).toBe('pending_approval');
  expect(permit.attendees).toHaveLength(1);
  await postJson(request, `/api/ledger/approvals/${permit.approvalId}/resolve`, {
    status: 'approved',
    resolvedBy: 'Browser permit approver',
    reason: 'Hazards, controls, validity, source evidence, and frozen assigned crew verified.'
  });

  await page.reload();
  panel = await openPermit(page, job.id, permit.id);
  await expect(panel.locator('.work-permit-state .status')).toHaveText('active');
  await expect(panel.getByText('Stored electrical energy')).toBeVisible();
  await expect(panel.getByText(worker.name)).toBeVisible();
  await expect(panel.getByText('1 assigned worker acknowledgement(s) are outstanding.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Suspend' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Close permit' })).toBeVisible();

  await postJson(request, `/api/ledger/jobs/${job.id}/work-permits/${permit.id}/acknowledgments`, {
    entryKey: `browser-permit-acknowledgement-${suffix}`,
    workerId: worker.id,
    workerName: worker.name,
    acknowledged: true,
    acknowledgedAt: new Date().toISOString(),
    evidenceReference: `browser-device-attestation:${suffix}`,
    attestation: 'I reviewed the retained hazards and controls and will stop work if conditions change.'
  });

  await page.reload();
  panel = await openPermit(page, job.id, permit.id);
  await expect(panel.getByText('Ready', { exact: true })).toBeVisible();
  await expect(panel.getByText('acknowledged', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await panel.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    panelWidth: element.scrollWidth,
    panelClientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.panelWidth).toBeLessThanOrEqual(geometry.panelClientWidth + 1);

  const suspendForm = panel.locator('.work-permit-actions form').filter({ hasText: 'Suspend permit' });
  await suspendForm.getByLabel('Stop-work reason').fill('Isolation boundary changed during the planned work.');
  await suspendForm.getByLabel('Evidence reference').fill(`browser-stop-work:${suffix}`);
  await suspendForm.getByRole('button', { name: 'Suspend' }).click();
  await expect(page.getByText('Permit suspended. Work must remain stopped until a new approved permit is issued.')).toBeVisible();
  await expect(panel.locator('.work-permit-state .status')).toHaveText('suspended');

  const closeForm = panel.locator('.work-permit-actions form').filter({ hasText: 'Close permit' });
  await closeForm.getByLabel('Completion note').fill('Isolation work ended and the plant room was handed back.');
  await closeForm.getByLabel('Closeout evidence').fill(`browser-handback:${suffix}`);
  await closeForm.getByRole('button', { name: 'Close permit' }).click();
  await expect(page.getByText('Permit closed with retained closeout evidence.')).toBeVisible();
  await expect(panel.locator('.work-permit-state .status')).toHaveText('closed');

  const retainedResponse = await request.get(`/api/ledger/jobs/${job.id}/work-permits`);
  expect(retainedResponse.ok()).toBeTruthy();
  const retained = (await retainedResponse.json()).workPermits.find(record => record.id === permit.id);
  expect(retained.status).toBe('closed');
  expect(retained.definitionIntegrityValid).toBe(true);
  expect(retained.closureEvidenceReference).toBe(`browser-handback:${suffix}`);
});
