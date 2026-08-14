const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

function visualQaPath(fileName) {
  const directory = process.env.CONTRACTOR_AI_VISUAL_QA_DIR;
  if (!directory) return null;
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, fileName);
}

function dateOffset(date, days) {
  const start = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(start + days * 86_400_000).toISOString().slice(0, 10);
}

function firstWeekday(date) {
  for (let offset = 0; offset < 14; offset += 1) {
    const candidate = dateOffset(date, offset);
    const weekday = new Date(`${candidate}T00:00:00.000Z`).getUTCDay();
    if (weekday >= 1 && weekday <= 5) return candidate;
  }
  throw new Error('The governed two-week window did not contain a weekday.');
}

test('crew planner retains capacity and allocations before approving a source-current two-week plan', async ({ page, request }) => {
  const suffix = Date.now();
  const windowStart = new Date().toISOString().slice(0, 10);
  const workDate = firstWeekday(windowStart);
  const windowEnd = dateOffset(windowStart, 13);
  const title = `Crew capacity browser plan ${suffix}`;
  const taskTitle = `Install governed scope ${suffix}`;
  const workerName = `Crew capacity browser worker ${suffix}`;
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));

  const workerResponse = await request.post('/api/ledger/workers', {
    data: {
      name: workerName,
      role: 'Installer',
      status: 'available',
      skills: ['installation']
    }
  });
  expect(workerResponse.ok()).toBeTruthy();
  const worker = (await workerResponse.json()).worker;

  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title,
      status: 'planned',
      scheduledStart: `${workDate}T08:00:00.000Z`,
      scheduledEnd: `${windowEnd}T17:00:00.000Z`,
      client: { name: 'Crew browser client', email: 'crew-browser@example.test', country: 'NL' },
      tasks: [{ title: taskTitle, durationHours: 8 }],
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const job = (await intakeResponse.json()).job;

  const baselineResponse = await request.post(`/api/ledger/jobs/${job.id}/schedule-baselines`, {
    data: { plannedStart: `${workDate}T08:00:00.000Z`, reason: 'Browser QA retained schedule basis.' }
  });
  expect(baselineResponse.ok()).toBeTruthy();
  const baseline = await baselineResponse.json();
  const baselineApproval = await request.post(`/api/ledger/approvals/${baseline.approval.id}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Browser schedule approver',
      reason: 'Browser QA verified the task duration and planned start.'
    }
  });
  expect(baselineApproval.ok()).toBeTruthy();

  const assignmentResponse = await request.post(`/api/ledger/jobs/${job.id}/assignments`, {
    data: {
      workerId: worker.id,
      role: 'Installer',
      status: 'planned',
      scheduledStart: `${windowStart}T08:00:00.000Z`,
      scheduledEnd: `${windowEnd}T17:00:00.000Z`,
      allocationHours: 8
    }
  });
  expect(assignmentResponse.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  const board = page.getByTestId('crew-capacity-board');
  await expect(board.getByRole('heading', { name: 'Crew capacity and two-week plan' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('nl-NL');
  await expect(board.getByRole('heading', { name: 'Ploegcapaciteit en tweewekenplan' })).toBeVisible();
  await expect(board.getByLabel('Schuifbaar bord met ploegcapaciteit voor twee weken')).toBeVisible();
  await page.getByRole('combobox', { name: 'Taal' }).selectOption('en-GB');
  await expect(board.getByRole('heading', { name: 'Crew capacity and two-week plan' })).toBeVisible();
  await expect(board.locator('.crew-profile-list').getByRole('button', { name: new RegExp(workerName) })).toBeVisible();
  await expect(board).toContainText('Planning blockers');

  await board.locator('.crew-profile-list').getByRole('button', { name: new RegExp(workerName) }).click();
  const profile = board.locator('.crew-profile-editor');
  await expect(profile.getByRole('heading', { name: workerName })).toBeVisible();
  await profile.getByRole('button', { name: 'Save profile' }).click();
  await expect(board.getByText('40h').first()).toBeVisible();

  const allocation = board.locator('.crew-control-band');
  await allocation.getByLabel('Assignment').selectOption({ label: `${workerName} / ${title}` });
  await allocation.getByLabel('Scheduled task').selectOption({ label: taskTitle });
  await allocation.getByLabel('Work date').fill(workDate);
  await allocation.getByLabel('Hours').fill('8');
  await allocation.getByLabel('Note').fill('Browser QA retained one internal installation shift.');
  await allocation.getByRole('button', { name: 'Add hours' }).click();

  await expect(board.getByText('Ready for approval')).toBeVisible();
  await expect(board.locator('.crew-allocation-row').filter({ hasText: workerName })).toContainText('8h');
  await expect(board.locator('.crew-coverage-row').filter({ hasText: taskTitle })).toContainText('8 / 8h');
  const desktopScreenshot = visualQaPath('crew-capacity-desktop.png');
  if (desktopScreenshot) await page.screenshot({ path: desktopScreenshot, fullPage: true });

  await board.getByRole('button', { name: 'Request approval' }).click();
  await expect(board.getByText('Pending approval')).toBeVisible();
  await board.getByRole('button', { name: 'Review decision' }).click();
  await expect(page.getByRole('heading', { name: 'Approval queue' })).toBeVisible();
  const approval = page.locator('.approval-item').filter({ hasText: 'Approve crew look-ahead v1' });
  await expect(approval).toHaveCount(1);
  await approval.getByRole('button', { name: 'Review and approve' }).click();
  const review = page.getByTestId('approval-review-modal');
  await expect(review.getByText(/blocked if capacity, availability, assignments, tasks, or schedule baselines changed/i)).toBeVisible();
  await review.getByLabel('Reviewer reason').fill('Browser QA verified retained capacity, availability, assignment, baseline, task coverage, and day-level hours.');
  await review.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(board.getByText('Approved and current')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await board.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  await expect(board.getByLabel('Scrollable two-week crew capacity board')).toBeVisible();
  const mobileScreenshot = visualQaPath('crew-capacity-mobile.png');
  if (mobileScreenshot) await page.screenshot({ path: mobileScreenshot, fullPage: true });
  expect(consoleErrors).toEqual([]);
});
