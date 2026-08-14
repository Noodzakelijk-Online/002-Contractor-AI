const { test, expect } = require('@playwright/test');

async function openJob(page, title) {
  await page.goto('/');
  await page.getByLabel(/^(Language|Taal)$/).selectOption('en-GB');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  const workspace = page.getByTestId('job-workspace');
  await expect(workspace.getByRole('heading', { name: title })).toBeVisible();
  return workspace;
}

test('operator governs before, during, and after photographs through task completion', async ({ page, request }) => {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const suffix = `${Date.now()}`;
  const title = `Browser photographic evidence ${suffix}`;
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Roof waterproofing',
      status: 'in_progress',
      client: { name: 'Browser photographic evidence client', country: 'NL' },
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const job = (await intakeResponse.json()).job;
  const workerResponse = await request.post('/api/ledger/workers', {
    data: {
      id: `browser-photo-worker-${suffix}`,
      name: 'Browser Photo Installer',
      role: 'Installer',
      status: 'available'
    }
  });
  expect(workerResponse.ok()).toBeTruthy();
  const worker = (await workerResponse.json()).worker;
  const assignmentResponse = await request.post(`/api/ledger/jobs/${job.id}/assignments`, {
    data: { workerId: worker.id, role: worker.role, status: 'planned' }
  });
  expect(assignmentResponse.ok()).toBeTruthy();
  const taskResponse = await request.post(`/api/ledger/jobs/${job.id}/tasks`, {
    data: {
      title: 'Install browser-tested roof outlet',
      status: 'in_progress',
      assigneeId: worker.id,
      priority: 'high'
    }
  });
  expect(taskResponse.ok()).toBeTruthy();
  const task = (await taskResponse.json()).task;

  let workspace = await openJob(page, title);
  let control = workspace.getByTestId('photo-evidence-control');
  await expect(control.getByRole('heading', { name: 'Before, during, and after evidence' })).toBeVisible();
  await control.getByRole('button', { name: 'Schedule set' }).click();
  const schedule = control.getByTestId('photo-evidence-schedule-form');
  await schedule.getByLabel('Task').selectOption(task.id);
  await expect(schedule.getByRole('combobox', { name: 'Assigned worker', exact: true })).toHaveValue((await assignmentResponse.json()).assignment.id);
  await schedule.getByLabel('Exact work location').fill('Building B / Roof / Outlet 07');
  await schedule.getByLabel('Field instructions').fill('Show substrate, membrane overlap, and finished outlet from the same marked viewpoint.');
  await schedule.getByRole('button', { name: 'Schedule evidence set' }).click();
  await expect(page.getByText(/Task completion now requires released before, during, and after evidence/i)).toBeVisible();

  let detailResponse = await request.get(`/api/ledger/jobs/${job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  let detail = (await detailResponse.json()).job;
  const evidenceSet = detail.photoEvidenceSets.find(set => set.taskId === task.id);
  expect(evidenceSet).toBeTruthy();
  const captureTimes = [
    new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    new Date(Date.now() - 1 * 60 * 1000).toISOString()
  ];
  for (const [index, phase] of ['before', 'during', 'after'].entries()) {
    const upload = await request.post('/api/ledger/upload', {
      headers: { 'Idempotency-Key': `browser-photo-upload-${phase}-${suffix}` },
      multipart: {
        evidenceFile: {
          name: `${phase}-roof-outlet.jpg`,
          mimeType: 'image/jpeg',
          buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${phase} browser roof outlet evidence`)])
        },
        jobId: job.id,
        photoEvidenceSetId: evidenceSet.id,
        photoEvidencePhase: phase,
        photoEvidenceEntryKey: `browser-photo-capture-${phase}-${suffix}`,
        capturedAt: captureTimes[index],
        notes: `${phase} condition at browser roof outlet 07`,
        category: 'governed_field_photo'
      }
    });
    expect(upload.ok()).toBeTruthy();
  }

  workspace = await openJob(page, title);
  control = workspace.getByTestId('photo-evidence-control');
  let row = control.locator('.photo-evidence-row').filter({ hasText: 'Install browser-tested roof outlet' });
  await expect(row.getByText('captures complete', { exact: true })).toBeVisible();
  await expect(row.locator('.photo-evidence-phases .complete')).toHaveCount(3);
  await row.getByRole('button', { name: 'Request independent review' }).click();
  await expect(page.getByText(/waiting for independent approval/i)).toBeVisible();

  detailResponse = await request.get(`/api/ledger/jobs/${job.id}`);
  detail = (await detailResponse.json()).job;
  const pendingSet = detail.photoEvidenceSets.find(set => set.id === evidenceSet.id);
  const approval = detail.approvals.find(item => item.id === pendingSet.latestApprovalId && item.status === 'pending');
  expect(approval).toBeTruthy();
  const approvalResponse = await request.post(`/api/ledger/approvals/${approval.id}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Browser quality approver',
      reason: 'Task source, exact location, checksums, and before/during/after chronology independently verified.'
    }
  });
  expect(approvalResponse.ok()).toBeTruthy();
  const completionResponse = await request.patch(`/api/ledger/jobs/${job.id}/lifecycle/task/${task.id}`, {
    data: {
      status: 'completed',
      notes: 'Task completed after governed photographic release.'
    }
  });
  expect(completionResponse.ok()).toBeTruthy();

  workspace = await openJob(page, title);
  control = workspace.getByTestId('photo-evidence-control');
  row = control.locator('.photo-evidence-row').filter({ hasText: 'Install browser-tested roof outlet' });
  await expect(row.getByText('released', { exact: true })).toBeVisible();
  await expect(row.getByRole('link', { name: /roof-outlet\.jpg/ })).toHaveCount(3);

  await page.locator('header').getByLabel('Language', { exact: true }).selectOption('nl-NL');
  await expect(control.getByRole('heading', { name: 'Onderbouwing voor, tijdens en na het werk' })).toBeVisible();
  await expect(row.getByText('vrijgegeven', { exact: true })).toBeVisible();
  await expect(row).toContainText('Install browser-tested roof outlet');
  await expect(row).toContainText('Building B / Roof / Outlet 07');
  await expect(row.getByRole('link', { name: /roof-outlet\.jpg/ })).toHaveCount(3);
  await page.locator('header').getByLabel('Taal', { exact: true }).selectOption('en-GB');

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
