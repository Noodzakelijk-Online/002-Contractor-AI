const { test, expect } = require('@playwright/test');

function dateOffset(date, days) {
  const start = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(start + days * 86_400_000).toISOString().slice(0, 10);
}

function nextMonday() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const day = today.getUTCDay() || 7;
  today.setUTCDate(today.getUTCDate() - day + 8);
  return today.toISOString().slice(0, 10);
}

test('Last Planner workspace governs make-ready, weekly promises, daily evidence, PPC, and mobile layout', async ({ page, request }) => {
  const suffix = Date.now();
  const weekStart = nextMonday();
  const windowEnd = dateOffset(weekStart, 13);
  const title = `Last Planner browser job ${suffix}`;
  const taskTitle = `Last Planner browser task ${suffix}`;
  const workerName = `Last Planner browser lead ${suffix}`;
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));

  const worker = (await (await request.post('/api/ledger/workers', {
    data: { name: workerName, role: 'Site lead', status: 'available', hourlyRate: 66 }
  })).json()).worker;
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title,
      status: 'planned',
      scheduledStart: `${weekStart}T08:00:00.000Z`,
      scheduledEnd: `${windowEnd}T17:00:00.000Z`,
      client: { name: 'Last Planner browser client', country: 'NL' },
      tasks: [{ title: taskTitle, durationHours: 8 }],
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const job = (await intakeResponse.json()).job;
  const taskId = job.tasks[0].id;
  const baseline = await (await request.post(`/api/ledger/jobs/${job.id}/schedule-baselines`, {
    data: { plannedStart: `${weekStart}T08:00:00.000Z` }
  })).json();
  expect((await request.post(`/api/ledger/approvals/${baseline.approval.id}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser owner', reason: 'Task schedule checked.' }
  })).ok()).toBeTruthy();
  const assignment = await (await request.post(`/api/ledger/jobs/${job.id}/assignments`, {
    data: {
      workerId: worker.id,
      role: 'Site lead',
      status: 'planned',
      scheduledStart: `${weekStart}T08:00:00.000Z`,
      scheduledEnd: `${windowEnd}T17:00:00.000Z`,
      allocationHours: 8
    }
  })).json();
  expect((await request.put(`/api/ledger/workers/${worker.id}/capacity-profile`, {
    data: {
      effectiveFrom: weekStart,
      referenceDate: weekStart,
      timezone: 'Europe/Amsterdam',
      dailyHours: { sunday: 0, monday: 8, tuesday: 8, wednesday: 8, thursday: 8, friday: 8, saturday: 0 }
    }
  })).ok()).toBeTruthy();
  expect((await request.post('/api/ledger/crew-capacity/allocations', {
    data: { assignmentId: assignment.assignment.id, taskId, workDate: weekStart, plannedHours: 8, referenceDate: weekStart }
  })).ok()).toBeTruthy();
  const lookahead = await (await request.post('/api/ledger/crew-lookahead/plans', { data: { referenceDate: weekStart } })).json();
  expect((await request.post(`/api/ledger/approvals/${lookahead.approval.id}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser owner', reason: 'Crew look-ahead source checked.' }
  })).ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  let board = page.getByTestId('last-planner-board');
  await expect(board.getByRole('heading', { name: 'Last Planner weekly control' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('nl-NL');
  await expect(board.getByRole('heading', { name: 'Wekelijkse Last Planner-sturing' })).toBeVisible();
  await expect(board.getByLabel('Samenvatting Last Planner')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Planning', exact: true }).click();
  board = page.getByTestId('last-planner-board');
  await expect(board.getByRole('heading', { name: 'Wekelijkse Last Planner-sturing' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Taal' }).selectOption('en-GB');
  await expect(board.getByRole('heading', { name: 'Last Planner weekly control' })).toBeVisible();
  await board.getByLabel('Week starts').fill(weekStart);
  await board.getByRole('button', { name: 'Load week' }).click();
  await expect(board).toContainText('Look-ahead current');
  await board.locator('.last-planner-job-select select').selectOption({ label: title });
  await expect(board).toContainText('Look-ahead current');
  await expect(board).toContainText(taskTitle);

  await board.getByRole('button', { name: 'Add constraint' }).click();
  const constraintForm = board.locator('.last-planner-constraint-form');
  await constraintForm.getByLabel('Task').selectOption({ label: taskTitle });
  await constraintForm.getByLabel('Category').selectOption('information');
  await constraintForm.getByLabel('Owner').fill(workerName);
  await constraintForm.getByLabel('Due date').fill(weekStart);
  await constraintForm.getByLabel('Constraint').fill('Confirm browser weekly detail');
  await constraintForm.getByLabel('Required condition').fill('Retain the verified browser detail before making the weekly promise.');
  await constraintForm.getByLabel('Source evidence').fill('browser-detail-source-A103');
  await constraintForm.getByRole('button', { name: 'Retain constraint' }).click();
  const constraintRow = board.locator('.last-planner-row').filter({ hasText: 'Confirm browser weekly detail' });
  await expect(constraintRow).toContainText(/open/i);
  await constraintRow.getByRole('button', { name: 'Release', exact: true }).click();
  await constraintRow.getByLabel('Release evidence').fill('browser-detail-release-A103-rev2');
  await constraintRow.getByRole('button', { name: 'Release', exact: true }).click();
  await expect(constraintRow).toContainText('Released');

  const candidate = board.locator('.last-planner-candidate').filter({ hasText: taskTitle });
  await candidate.getByRole('checkbox').check();
  await candidate.getByLabel('Promise', { exact: true }).fill('Complete and inspect the browser weekly scope.');
  await expect(candidate.getByLabel('Promised by', { exact: true })).toHaveValue(workerName);
  await board.getByRole('button', { name: 'Request approval' }).click();
  await expect(board).toContainText('Pending approval');
  await board.getByRole('button', { name: 'Review decision' }).click();
  const approval = page.locator('.approval-item').filter({ hasText: title }).filter({ hasText: 'weekly promise' });
  await expect(approval).toHaveCount(1);
  await approval.getByRole('button', { name: 'Review and approve' }).click();
  const review = page.getByTestId('approval-review-modal');
  await expect(review).toContainText('Does not change the schedule');
  await review.getByLabel('Reviewer reason').fill('Browser QA verified task-level crew hours, released constraints, promise ownership, and retained source hashes.');
  await review.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  const huddle = await (await request.post(`/api/ledger/jobs/${job.id}/daily-cycles`, {
    data: {
      entryKey: `browser-last-planner-huddle-${suffix}`,
      workDate: weekStart,
      facilitator: workerName,
      leadWorkerId: worker.id,
      workerIds: [worker.id],
      plannedWork: 'Complete the approved browser weekly promise.',
      productionTarget: 'Complete and inspect the retained scope.',
      safetyFocus: 'Apply retained controls and keep the work route clear.',
      evidenceReference: 'browser-last-planner-huddle-evidence'
    }
  })).json();
  const ended = await (await request.post(`/api/ledger/jobs/${job.id}/daily-cycles/${huddle.cycle.id}/end-of-day`, {
    data: {
      entryKey: `browser-last-planner-eod-${suffix}`,
      workerId: worker.id,
      hours: 8,
      manpower: 1,
      weather: 'clear',
      workCompleted: 'Completed and inspected the approved browser weekly promise.',
      safetyConcern: false,
      planAchieved: true,
      tomorrowPlan: 'Continue with the next approved task.',
      evidenceReferences: ['browser-last-planner-progress-evidence']
    }
  })).json();
  expect((await request.post(`/api/ledger/approvals/${ended.dailyLog.fieldReport.approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser owner', reason: 'Daily plan-versus-actual evidence checked.' }
  })).ok()).toBeTruthy();

  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await board.getByLabel('Week starts').fill(weekStart);
  await board.getByRole('button', { name: 'Load week' }).click();
  await expect(board).toContainText('Look-ahead current');
  await board.locator('.last-planner-job-select select').selectOption({ label: title });
  const commitment = board.getByTestId('last-planner-commitment').filter({ hasText: 'Complete and inspect the browser weekly scope.' });
  await commitment.getByRole('button', { name: 'Record outcome' }).click();
  await commitment.getByLabel('Outcome evidence').fill('browser-weekly-completion-evidence');
  await commitment.getByRole('button', { name: 'Retain outcome' }).click();
  await expect(commitment).toContainText('Completed');
  await expect(board.locator('.last-planner-ppc')).toContainText('100%');

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await board.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  await expect(board.getByRole('heading', { name: 'PPC and variance learning' })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
