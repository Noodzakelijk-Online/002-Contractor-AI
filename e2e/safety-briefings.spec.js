const { test, expect } = require('@playwright/test');

async function postJson(request, route, data) {
  const response = await request.post(route, { data });
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function approve(request, approvalId, reason) {
  return postJson(request, `/api/ledger/approvals/${approvalId}/resolve`, {
    status: 'approved',
    resolvedBy: 'Browser safety approver',
    reason
  });
}

test('safety briefing schedule, attendance exception, signoff, and mobile layout stay connected', async ({ page, request }) => {
  const suffix = Date.now();
  const workers = [];
  for (const role of ['Lead installer', 'Site operative']) {
    workers.push((await postJson(request, '/api/ledger/workers', {
      name: `Browser safety ${role.toLowerCase()} ${suffix}`,
      role,
      status: 'available'
    })).worker);
  }
  const job = (await postJson(request, '/api/ledger/intake', {
    title: `Browser safety project ${suffix}`,
    client: { name: 'Browser safety client' },
    status: 'in_progress',
    assignAutomatically: false
  })).job;
  for (const worker of workers) {
    const assignmentResult = await postJson(request, `/api/ledger/jobs/${job.id}/assignments`, {
      workerId: worker.id,
      workerName: worker.name,
      role: worker.role,
      status: 'assigned'
    });
    if (assignmentResult.approval?.id) {
      await approve(request, assignmentResult.approval.id, 'Worker identity, availability, role, and project assignment verified.');
    }
  }

  await page.goto('/');
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  const panel = page.getByTestId('safety-briefing-control');
  await expect(panel.getByRole('heading', { name: 'Safety briefings' })).toBeVisible();
  await panel.getByLabel('Job').selectOption(job.id);
  await panel.getByLabel('Title').fill(`Mobile scaffold toolbox talk ${suffix}`);
  await panel.getByLabel('Scheduled time').fill(new Date(Date.now() - 15 * 60 * 1000).toISOString().slice(0, 16));
  await panel.getByLabel('Discussion topics').fill('Inspection before use\nWheel locks\nExclusion zone');
  await panel.getByRole('button', { name: 'Schedule briefing' }).click();

  await expect(page.getByText('Safety briefing scheduled with the current assigned crew as expected attendees.')).toBeVisible();
  await expect(panel.getByText(workers[0].name)).toBeVisible();
  await expect(panel.getByText(workers[1].name)).toBeVisible();
  await expect(panel.getByText('Inspection before use')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Request signoff approval' })).toBeDisabled();

  const briefingResponse = await request.get(`/api/ledger/jobs/${job.id}/safety-meetings`);
  expect(briefingResponse.ok()).toBeTruthy();
  const briefing = (await briefingResponse.json()).safetyMeetings[0];
  await postJson(request, `/api/ledger/jobs/${job.id}/safety-meetings/${briefing.id}/acknowledgments`, {
    entryKey: `browser-safety-acknowledgement-${suffix}`,
    workerId: workers[0].id,
    workerName: workers[0].name,
    acknowledged: true,
    evidenceReference: `browser-device-attestation:${suffix}`
  });
  await page.reload();
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  await panel.getByLabel('Job').selectOption(job.id);
  await expect(panel.getByText('acknowledged', { exact: true })).toBeVisible();

  await panel.getByLabel('Attendance exception reason').fill('Worker was reassigned before the briefing started.');
  await panel.getByRole('button', { name: 'Excuse' }).click();
  await expect(page.getByText(`${workers[1].name} was explicitly excused with the retained reason.`)).toBeVisible();
  await expect(panel.getByText('excused', { exact: true })).toBeVisible();

  await panel.getByLabel('Completion evidence').fill(`signed-toolbox-register:${suffix}`);
  await expect(panel.getByRole('button', { name: 'Request signoff approval' })).toBeEnabled();
  await panel.getByRole('button', { name: 'Request signoff approval' }).click();
  await expect(page.getByText('Briefing evidence was frozen and sent to the approval queue.')).toBeVisible();

  const approvalRow = page.locator('.approval-item').filter({ hasText: `Mobile scaffold toolbox talk ${suffix}` });
  await expect(approvalRow).toHaveCount(1);
  await approvalRow.getByRole('button', { name: 'Review and approve' }).click();
  const modal = page.getByTestId('approval-review-modal');
  await modal.getByLabel('Reviewer reason').fill('Topics, frozen attendee exception, facilitator evidence, and source integrity verified.');
  await modal.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  await panel.getByLabel('Job').selectOption(job.id);
  await expect(panel.getByText('completed', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await panel.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    panelWidth: element.scrollWidth,
    panelClientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.panelWidth).toBeLessThanOrEqual(geometry.panelClientWidth + 1);
});
