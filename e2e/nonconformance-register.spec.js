const { test, expect } = require('@playwright/test');

async function postJson(request, route, data) {
  const response = await request.post(route, { data });
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function openJob(page, title) {
  await page.goto('/');
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  const workspace = page.getByTestId('job-workspace');
  await expect(workspace).toBeVisible();
  const control = workspace.getByTestId('nonconformance-control');
  await expect(control.getByRole('heading', { name: 'Nonconformance register' })).toBeVisible();
  return control;
}

function localDateTime(offsetMs = 0) {
  const date = new Date(Date.now() + offsetMs);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function dateInput(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 10);
}

test('nonconformance moves from offline capture through corrective action and independent closure without overflow', async ({ page, request, context }) => {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const suffix = Date.now();
  const title = `Browser NCR ${suffix}`;
  const worker = (await postJson(request, '/api/ledger/workers', {
    name: `Browser NCR worker ${suffix}`,
    role: 'Site operative',
    status: 'available'
  })).worker;
  const job = (await postJson(request, '/api/ledger/intake', {
    title,
    client: { name: `Browser NCR client ${suffix}` },
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
      resolvedBy: 'Browser NCR approver',
      reason: 'Worker identity and project assignment verified.'
    });
  }

  let control = await openJob(page, title);
  await control.getByRole('button', { name: 'New NCR' }).click();
  const form = control.getByTestId('nonconformance-create-form');
  await form.getByLabel('Severity').selectOption('high');
  await form.getByLabel('Discipline').fill('Structural');
  await form.getByLabel('NCR title').fill('Anchor spacing differs from approved detail');
  await form.getByLabel('Detected at').fill(localDateTime());
  await form.getByLabel('Raised by').fill(worker.name);
  await form.getByLabel('Observed condition').fill('Retained survey measurements show two anchors outside the approved maximum spacing.');
  await form.getByLabel('Location').fill('Level 2 east facade bay E4');
  await form.getByLabel('Corrective due date').fill(dateInput(2 * 24 * 60 * 60 * 1000));
  await form.getByLabel('Requirement reference').fill('Approved detail STR-421 revision C, note 7');
  await form.getByLabel('Immediate containment').fill('Stopped covering work and marked the affected bay pending technical review.');
  await form.getByLabel('Responsible party').fill('Facade subcontract supervisor');
  await form.getByLabel('Notes').fill('Internal quality record only.');

  await context.setOffline(true);
  await form.getByRole('button', { name: 'Save NCR offline' }).click();
  await expect(page.getByText('NCR saved locally for this operator and scheduled for exact retry after reconnection.')).toBeVisible();
  await context.setOffline(false);

  let record;
  await expect.poll(async () => {
    const response = await request.get(`/api/ledger/jobs/${job.id}/nonconformances`);
    if (!response.ok()) return 0;
    const body = await response.json();
    record = body.nonconformances.find(item => item.title === 'Anchor spacing differs from approved detail');
    return record ? 1 : 0;
  }, { timeout: 15_000 }).toBe(1);
  expect(record.status).toBe('open');
  expect(record.integrityValid).toBe(true);

  control = await openJob(page, title);
  let card = control.getByTestId(`nonconformance-${record.id}`);
  await card.getByRole('button', { name: 'Corrective action' }).click();
  const correctionForm = control.getByTestId('nonconformance-correction-form');
  await correctionForm.getByLabel('Root cause').fill('Setting-out points were transferred from a superseded workshop sketch.');
  await correctionForm.getByLabel('Corrective action').fill('Install approved supplementary anchors, repeat pull tests, and retain revised survey evidence.');
  await correctionForm.getByLabel('Responsible party').fill('Facade subcontract supervisor');
  await correctionForm.getByLabel('Corrective due date').fill(dateInput(3 * 24 * 60 * 60 * 1000));
  await correctionForm.getByLabel('Evidence reference').fill(`browser-ncr-correction:${suffix}`);
  await correctionForm.getByRole('button', { name: 'Request correction approval' }).click();
  await expect(page.getByText('Corrective action retained for source-current approval. The NCR remains open.')).toBeVisible();

  let detail = (await (await request.get(`/api/ledger/jobs/${job.id}`)).json()).job;
  const correctionApproval = detail.approvals.find(approval => approval.targetType === 'nonconformance_correction' && approval.targetId === record.id && approval.status === 'pending');
  expect(correctionApproval).toBeTruthy();
  await postJson(request, `/api/ledger/approvals/${correctionApproval.id}/resolve`, {
    status: 'approved',
    resolvedBy: 'Browser NCR approver',
    reason: 'Root cause, correction method, responsibility, and evidence basis verified.'
  });

  control = await openJob(page, title);
  card = control.getByTestId(`nonconformance-${record.id}`);
  await expect(card.locator('.status')).toHaveText('correction approved');
  await card.getByRole('button', { name: 'Verify closure' }).click();
  const closureForm = control.getByTestId('nonconformance-closure-form');
  await closureForm.getByLabel('Verification result').selectOption('passed');
  await closureForm.getByLabel('Verified at').fill(localDateTime());
  await closureForm.getByLabel('Verified by').fill('Independent quality lead');
  await closureForm.getByLabel('Verification evidence').fill(`browser-ncr-pull-test:${suffix}`);
  await closureForm.getByLabel('Verification notes').fill('Correction matches the approved detail and retained test criteria.');
  await closureForm.getByRole('button', { name: 'Request closure approval' }).click();
  await expect(page.getByText('Independent closure evidence retained for approval. Related inspection and closeout records remain unchanged.')).toBeVisible();

  detail = (await (await request.get(`/api/ledger/jobs/${job.id}`)).json()).job;
  const closureApproval = detail.approvals.find(approval => approval.targetType === 'nonconformance_closure' && approval.targetId === record.id && approval.status === 'pending');
  expect(closureApproval).toBeTruthy();
  await postJson(request, `/api/ledger/approvals/${closureApproval.id}/resolve`, {
    status: 'approved',
    resolvedBy: 'Browser NCR approver',
    reason: 'Independent verification matches the retained source and approved correction.'
  });

  await page.setViewportSize({ width: 390, height: 844 });
  control = await openJob(page, title);
  card = control.getByTestId(`nonconformance-${record.id}`);
  await expect(card.locator('.status')).toHaveText('closed');
  const geometry = await control.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);

  const retained = (await (await request.get(`/api/ledger/jobs/${job.id}`)).json()).job.nonconformances.find(item => item.id === record.id);
  expect(retained.status).toBe('closed');
  expect(retained.integrityValid).toBe(true);
  expect(retained.correctionIntegrityValid).toBe(true);
  expect(retained.closureIntegrityValid).toBe(true);
  expect(consoleErrors).toEqual([]);
});
