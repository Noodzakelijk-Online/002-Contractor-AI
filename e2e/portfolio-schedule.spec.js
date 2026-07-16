const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

function visualQaPath(fileName) {
  const directory = process.env.CONTRACTOR_AI_VISUAL_QA_DIR;
  if (!directory) return null;
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, fileName);
}

function isoAt(offsetHours) {
  return new Date(Date.now() + offsetHours * 60 * 60 * 1000).toISOString();
}

async function createScheduledJob(request, title, startOffsetHours, durationHours = 8) {
  const response = await request.post('/api/ledger/intake', {
    data: {
      title,
      status: 'scheduled',
      scheduledStart: isoAt(startOffsetHours),
      scheduledEnd: isoAt(startOffsetHours + durationHours),
      priority: 'high',
      client: { name: 'Portfolio Browser Client', email: 'portfolio-browser@example.test', country: 'NL' },
      assignAutomatically: false
    }
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).job;
}

test('portfolio schedule connects look-ahead risk, baseline approval, job planning, and dispatch on desktop and mobile', async ({ page, request }) => {
  const suffix = Date.now();
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));

  const workerResponse = await request.post('/api/ledger/workers', {
    data: {
      name: `Portfolio browser crew ${suffix}`,
      role: 'Lead contractor',
      status: 'available',
      skills: ['general contracting']
    }
  });
  expect(workerResponse.ok()).toBeTruthy();
  const worker = (await workerResponse.json()).worker;

  const conflictATitle = `Portfolio conflict A ${suffix}`;
  const conflictBTitle = `Portfolio conflict B ${suffix}`;
  const conflictA = await createScheduledJob(request, conflictATitle, 48, 10);
  const conflictB = await createScheduledJob(request, conflictBTitle, 52, 10);
  for (const [job, startOffset] of [[conflictA, 48], [conflictB, 52]]) {
    const assignmentResponse = await request.post(`/api/ledger/jobs/${job.id}/assignments`, {
      data: {
        workerId: worker.id,
        status: 'scheduled',
        scheduledStart: isoAt(startOffset),
        scheduledEnd: isoAt(startOffset + 10)
      }
    });
    expect(assignmentResponse.ok()).toBeTruthy();
  }

  const baselineTitle = `Portfolio baseline review ${suffix}`;
  const baselineJob = await createScheduledJob(request, baselineTitle, 96, 8);
  const taskResponse = await request.post(`/api/ledger/jobs/${baselineJob.id}/tasks`, {
    data: { title: `Retained baseline task ${suffix}`, durationHours: 8, priority: 'high' }
  });
  expect(taskResponse.ok()).toBeTruthy();
  const baselineResponse = await request.post(`/api/ledger/jobs/${baselineJob.id}/schedule-baselines`, {
    data: { plannedStart: isoAt(96) }
  });
  expect(baselineResponse.ok()).toBeTruthy();

  const unscheduledTitle = `Portfolio unscheduled ${suffix}`;
  const unscheduledResponse = await request.post('/api/ledger/intake', {
    data: {
      title: unscheduledTitle,
      status: 'intake',
      client: { name: 'Portfolio Unscheduled Client', country: 'NL' },
      assignAutomatically: false
    }
  });
  expect(unscheduledResponse.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  const schedule = page.getByTestId('portfolio-schedule');
  await expect(schedule.getByRole('heading', { name: 'Portfolio schedule' })).toBeVisible();
  await expect(schedule.getByText(conflictBTitle)).toBeVisible();
  await expect(schedule.locator('.portfolio-timeline-span').first()).toBeVisible();
  const desktopScreenshot = visualQaPath('portfolio-schedule-desktop.png');
  if (desktopScreenshot) await page.screenshot({ path: desktopScreenshot, fullPage: true });

  const search = schedule.getByPlaceholder('Job, client, location, or task');
  await search.fill(conflictBTitle);
  await expect(schedule.locator('.portfolio-schedule-row')).toHaveCount(1);
  await expect(schedule.getByText(conflictBTitle)).toBeVisible();
  await search.fill('');

  await schedule.getByRole('tab', { name: 'Conflicts' }).click();
  await expect(schedule.getByText(conflictBTitle)).toBeVisible();
  await expect(schedule.locator('.portfolio-schedule-row .status-conflict').first()).toBeVisible();

  await schedule.getByRole('tab', { name: 'Baselines' }).click();
  const baselineRow = schedule.locator('.portfolio-schedule-row').filter({ hasText: baselineTitle });
  await expect(baselineRow).toBeVisible();
  await expect(baselineRow.getByText(/Baseline v1 pending approval/i)).toBeVisible();
  await baselineRow.getByRole('button', { name: 'Review baseline' }).click();
  await expect(page.getByRole('heading', { name: 'Approval queue' })).toBeVisible();

  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  const reopenedSchedule = page.getByTestId('portfolio-schedule');
  await reopenedSchedule.getByRole('tab', { name: 'Unscheduled' }).click();
  const unscheduledRow = reopenedSchedule.locator('.portfolio-schedule-row').filter({ hasText: unscheduledTitle });
  await expect(unscheduledRow).toBeVisible();
  await unscheduledRow.getByRole('button', { name: 'Open job' }).click();
  await expect(page.getByTestId('job-workspace').getByRole('heading', { name: unscheduledTitle })).toBeVisible();
  await page.getByRole('button', { name: 'Close job workspace' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await reopenedSchedule.getByRole('tab', { name: 'Look-ahead' }).click();
  await expect.poll(async () => {
    const navigationBox = await page.locator('.side-nav').boundingBox();
    return navigationBox ? navigationBox.x + navigationBox.width : 0;
  }).toBeLessThanOrEqual(0);
  const geometry = await reopenedSchedule.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  const mobileScreenshot = visualQaPath('portfolio-schedule-mobile.png');
  if (mobileScreenshot) await page.screenshot({ path: mobileScreenshot, fullPage: true });

  await reopenedSchedule.getByRole('button', { name: 'Review dispatch' }).click();
  await expect(page.getByRole('heading', { name: 'Dispatch readiness' })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
