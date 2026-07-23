const { test, expect } = require('@playwright/test');

async function dailyCycleFixture(request, label) {
  const suffix = `${label}-${Date.now()}`;
  const workerResponse = await request.post('/api/ledger/workers', {
    data: { name: `Browser daily crew ${suffix}`, role: 'Carpenter', status: 'available', hourlyRate: 58 }
  });
  expect(workerResponse.ok()).toBeTruthy();
  const worker = (await workerResponse.json()).worker;
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title: `Browser daily operating cycle ${suffix}`,
      service: 'Interior renovation',
      address: 'Weteringschans 100, Amsterdam',
      client: { name: 'Browser daily cycle client' },
      status: 'scheduled',
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const job = (await intakeResponse.json()).job;
  const assignmentResponse = await request.post(`/api/ledger/jobs/${job.id}/assignments`, {
    data: { workerId: worker.id, role: 'Carpenter', status: 'assigned' }
  });
  expect(assignmentResponse.ok()).toBeTruthy();
  return { worker, job, suffix };
}

async function retainStartHuddle(page, job, worker) {
  const form = page.getByTestId('daily-start-huddle-form');
  await expect(form.getByRole('heading', { name: 'Daily start huddle' })).toBeVisible();
  await form.getByLabel('Job').selectOption(job.id);
  await form.getByLabel('Facilitator').fill('Browser site lead');
  await form.getByLabel(new RegExp(worker.name)).check();
  await form.getByLabel('Daily lead').selectOption(worker.id);
  await form.getByLabel('Planned work').fill('Frame and inspect the retained first-floor partition wall.');
  await form.getByLabel('Production target').fill('Complete 18 linear metres before 15:00.');
  await form.getByLabel('Site conditions').fill('Occupied ground floor; east stair remains the material route.');
  await form.getByLabel('Safety focus').fill('Keep the stair route clear and use the retained manual-handling controls.');
  await form.getByLabel('Quality hold points').fill('Check line and level before closing the frame.');
  await form.getByLabel('Constraints').fill('Electrical opening detail due before the final bay.');
  await form.getByLabel('Huddle evidence reference').fill(`huddle-browser-${Date.now()}`);
  await form.getByRole('button', { name: 'Retain start huddle' }).click();
  await expect(page.getByText('Start huddle retained with frozen crew, plan, safety focus, and hold points. This record does not replace a permit or safety clearance.')).toBeVisible();
  await expect(form.getByRole('button', { name: 'Retain start huddle' })).toBeEnabled();
  return form;
}

test('operator retains one governed start huddle and EOD report on desktop and mobile', async ({ page, request }) => {
  const { worker, job } = await dailyCycleFixture(request, 'desktop');
  await page.goto('/');
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  const huddleForm = await retainStartHuddle(page, job, worker);

  const eodForm = page.getByTestId('daily-site-log-form');
  await expect(eodForm.getByRole('heading', { name: 'End-of-day report' })).toBeVisible();
  await expect(eodForm.getByLabel('Open daily cycle')).not.toHaveValue('');
  await eodForm.getByLabel('Crew member').selectOption(worker.id);
  await eodForm.getByLabel('Hours worked').fill('7.25');
  await eodForm.getByLabel('People on site').fill('3');
  await eodForm.getByLabel('Weather').selectOption('cloudy');
  await eodForm.getByLabel('Work completed').fill('Framed and checked 15 linear metres of first-floor partition wall.');
  await eodForm.getByLabel('Blockers or follow-up').fill('Revised electrical detail required before closing the final bay.');
  await eodForm.getByLabel('The retained production target was achieved').uncheck();
  await eodForm.getByLabel('Reasons for variance').fill('Electrical opening detail arrived after the planned handoff.');
  await eodForm.getByLabel('Unresolved actions').fill('Confirm the final opening before 08:00.');
  await eodForm.getByLabel("Tomorrow's plan").fill('Complete the final bay, retain the hold-point check, and start boarding.');
  await eodForm.getByLabel('EOD evidence references').fill('browser-progress-photo-set-001');
  await eodForm.getByRole('button', { name: 'Submit EOD report' }).click();

  await expect(page.getByText('End-of-day report retained with plan variance, time card, safety state, and tomorrow handoff. 1 review added to the ledger.')).toBeVisible();
  const detailResponse = await request.get(`/api/ledger/jobs/${job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = (await detailResponse.json()).job;
  const cycle = detail.dailyOperatingCycles[0];
  const fieldReport = detail.fieldReports.find(record => record.id === cycle.fieldReportId);
  const timeLog = detail.timeLogs.find(record => record.id === cycle.timeLogId);
  const safetyCheck = detail.safetyChecks.find(record => record.id === cycle.safetyCheckId);
  expect(cycle.status).toBe('pending_approval');
  expect(cycle.huddleIntegrityValid).toBe(true);
  expect(cycle.endOfDayIntegrityValid).toBe(true);
  expect(cycle.planAchieved).toBe(false);
  expect(cycle.varianceReasons).toEqual(['Electrical opening detail arrived after the planned handoff.']);
  expect(fieldReport.data.dailyCycleId).toBe(cycle.id);
  expect(timeLog.hours).toBe(7.25);
  expect(timeLog.workerId).toBe(worker.id);
  expect(safetyCheck.status).toBe('recorded');
  expect(detail.audit.some(event => event.action === 'retain_daily_start_huddle')).toBeTruthy();
  expect(detail.audit.some(event => event.action === 'retain_daily_end_of_day_report')).toBeTruthy();

  await page.setViewportSize({ width: 780, height: 1024 });
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  const tabletGeometry = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    overflowing: [...document.querySelectorAll('body *')]
      .map(element => {
        const bounds = element.getBoundingClientRect();
        return {
          element: element.getAttribute('data-testid') || element.getAttribute('aria-label') || element.className || element.tagName,
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
          width: Math.round(bounds.width),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth
        };
      })
      .filter(element => element.right > document.documentElement.clientWidth || element.scrollWidth > element.clientWidth + 1)
      .slice(0, 20)
  }));
  expect(tabletGeometry.pageWidth, JSON.stringify(tabletGeometry.overflowing)).toBeLessThanOrEqual(tabletGeometry.viewportWidth);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(huddleForm).toBeVisible();
  await expect(eodForm).toBeVisible();
  const geometry = await page.evaluate(() => {
    const forms = [...document.querySelectorAll('[data-testid="daily-start-huddle-form"], [data-testid="daily-site-log-form"]')];
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      overflowingForms: forms.filter(form => form.scrollWidth > form.clientWidth).length
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.overflowingForms).toBe(0);
});

test('offline EOD report and progress sync once through the scoped field outbox', async ({ page, request, context }) => {
  const { worker, job, suffix } = await dailyCycleFixture(request, 'offline');
  await page.goto('/');
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  await retainStartHuddle(page, job, worker);

  const eodForm = page.getByTestId('daily-site-log-form');
  await eodForm.getByLabel('Crew member').selectOption(worker.id);
  await eodForm.getByLabel('Hours worked').fill('6.5');
  await eodForm.getByLabel('People on site').fill('2');
  await eodForm.getByLabel('Work completed').fill('Offline partition framing retained for later sync.');
  await eodForm.getByLabel('Blockers or follow-up').fill('Confirm the fire-stop detail before closing the wall.');
  await eodForm.getByLabel("Tomorrow's plan").fill('Confirm fire stopping, close the wall, and retain the inspection result.');
  await eodForm.getByLabel('EOD evidence references').fill(`offline-photo-set-${suffix}`);

  await context.setOffline(true);
  const offlineSubmit = eodForm.getByRole('button', { name: 'Save EOD report offline' });
  await expect(offlineSubmit).toBeEnabled();
  await expect(page.getByText('Failed to fetch', { exact: true })).toHaveCount(0);
  await offlineSubmit.click();
  await expect(page.getByText('End-of-day report was saved locally with its time, safety, variance, and handoff evidence. It will sync after reconnection.')).toBeVisible();

  const progressForm = page.getByTestId('field-progress-form');
  await progressForm.getByLabel('Job').selectOption(job.id);
  await progressForm.getByLabel('Work state').selectOption('blocked');
  await progressForm.getByLabel('Progress (%)').fill('48');
  await progressForm.getByLabel('Field note').fill('Offline progress note waiting for the same scoped ledger route.');
  await progressForm.getByRole('button', { name: 'Save progress offline' }).click();
  await expect(page.getByText('2 queued').first()).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('Outbox clear')).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => {
    const response = await request.get(`/api/ledger/jobs/${job.id}`);
    if (!response.ok()) return null;
    const detail = (await response.json()).job;
    const cycle = detail.dailyOperatingCycles[0];
    return {
      cycles: detail.dailyOperatingCycles.length,
      status: cycle?.status,
      reports: detail.fieldReports.filter(record => record.workCompleted === 'Offline partition framing retained for later sync.').length,
      timeLogs: detail.timeLogs.filter(record => record.notes === 'Offline partition framing retained for later sync.').length,
      safety: detail.safetyChecks.filter(record => record.data?.source === 'daily_site_log').length,
      progress: detail.progress.filter(record => record.note === 'Offline progress note waiting for the same scoped ledger route.').length
    };
  }, { timeout: 15_000 }).toEqual({ cycles: 1, status: 'pending_approval', reports: 1, timeLogs: 1, safety: 1, progress: 1 });

  await page.evaluate(({ jobId, suffix: scopeSuffix }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('contractor-ai-field-outbox', 2);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction('operation-drafts', 'readwrite');
      transaction.objectStore('operation-drafts').put({
        id: `foreign-progress-${scopeSuffix}`,
        kind: 'operation',
        type: 'progress',
        jobId,
        payload: { status: 'blocked', progressPercent: 99, note: 'A foreign operator scope must never replay this update.', source: 'field_outbox' },
        operatorScope: 'field_worker:another-worker',
        createdAt: new Date().toISOString()
      });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }), { jobId: job.id, suffix });
  await page.reload();
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  await expect(page.getByText('1 other scope')).toBeVisible();
  const retainedResponse = await request.get(`/api/ledger/jobs/${job.id}`);
  const retained = (await retainedResponse.json()).job;
  expect(retained.progress.some(record => record.note === 'A foreign operator scope must never replay this update.')).toBeFalsy();
});
