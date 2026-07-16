const { test, expect } = require('@playwright/test');

test('operator records one daily site log with time and safety evidence on desktop and mobile', async ({ page, request }) => {
  const suffix = Date.now();
  const workerResponse = await request.post('/api/ledger/workers', {
    data: {
      name: `Browser daily crew ${suffix}`,
      role: 'Carpenter',
      status: 'available',
      hourlyRate: 58
    }
  });
  expect(workerResponse.ok()).toBeTruthy();
  const worker = (await workerResponse.json()).worker;

  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title: `Browser daily site log ${suffix}`,
      service: 'Interior renovation',
      address: 'Weteringschans 100, Amsterdam',
      client: { name: 'Browser daily log client' },
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const job = (await intakeResponse.json()).job;

  await page.goto('/');
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  const form = page.getByTestId('daily-site-log-form');
  await expect(form.getByRole('heading', { name: 'Daily site log' })).toBeVisible();
  await form.getByLabel('Job').selectOption(job.id);
  await form.getByLabel('Crew member').selectOption(worker.id);
  await form.getByLabel('Hours worked').fill('7.25');
  await form.getByLabel('People on site').fill('3');
  await form.getByLabel('Weather').selectOption('cloudy');
  await form.getByLabel('Work completed').fill('Framed and checked the first-floor partition walls.');
  await form.getByLabel('Blockers or follow-up').fill('Revised electrical detail required before closing the wall.');
  await form.getByRole('button', { name: 'Submit daily log' }).click();

  await expect(page.getByText('Daily site log recorded with its time card and safety state. 1 review added to the ledger.')).toBeVisible();
  const detailResponse = await request.get(`/api/ledger/jobs/${job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = (await detailResponse.json()).job;
  const fieldReport = detail.fieldReports.find(record => record.data?.source === 'daily_site_log');
  const timeLog = detail.timeLogs.find(record => record.data?.entryKey === fieldReport.data.entryKey);
  const safetyCheck = detail.safetyChecks.find(record => record.data?.entryKey === fieldReport.data.entryKey);
  expect(fieldReport.status).toBe('pending_approval');
  expect(timeLog.hours).toBe(7.25);
  expect(timeLog.workerId).toBe(worker.id);
  expect(safetyCheck.status).toBe('recorded');
  expect(detail.audit.some(event => event.action === 'record_field_daily_log')).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(form).toBeVisible();
  const geometry = await page.evaluate(() => {
    const dailyForm = document.querySelector('[data-testid="daily-site-log-form"]');
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      formWidth: dailyForm?.scrollWidth || 0,
      formClientWidth: dailyForm?.clientWidth || 0
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.formWidth).toBeLessThanOrEqual(geometry.formClientWidth);
});

test('offline daily log and progress sync once through the scoped field outbox', async ({ page, request, context }) => {
  const suffix = Date.now();
  const workerResponse = await request.post('/api/ledger/workers', {
    data: {
      name: `Offline field crew ${suffix}`,
      role: 'Site carpenter',
      status: 'available',
      hourlyRate: 61
    }
  });
  expect(workerResponse.ok()).toBeTruthy();
  const worker = (await workerResponse.json()).worker;
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title: `Offline field continuity ${suffix}`,
      service: 'Renovation',
      address: 'Oudegracht 200, Utrecht',
      client: { name: 'Offline field client' },
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const job = (await intakeResponse.json()).job;

  await page.goto('/');
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  const dailyForm = page.getByTestId('daily-site-log-form');
  await dailyForm.getByLabel('Job').selectOption(job.id);
  await dailyForm.getByLabel('Crew member').selectOption(worker.id);
  await dailyForm.getByLabel('Hours worked').fill('6.5');
  await dailyForm.getByLabel('People on site').fill('2');
  await dailyForm.getByLabel('Work completed').fill('Offline partition framing retained for later sync.');
  await dailyForm.getByLabel('Blockers or follow-up').fill('Confirm the fire-stop detail before closing the wall.');

  await context.setOffline(true);
  await dailyForm.getByRole('button', { name: 'Submit daily log' }).click();
  await expect(page.getByText('Daily site log was saved locally with its time and safety data. It will sync for this operator after reconnection.')).toBeVisible();

  const progressForm = page.getByTestId('field-progress-form');
  await progressForm.getByLabel('Job').selectOption(job.id);
  await progressForm.getByLabel('Work state').selectOption('blocked');
  await progressForm.getByLabel('Progress (%)').fill('48');
  await progressForm.getByLabel('Field note').fill('Offline progress note waiting for the same scoped ledger route.');
  await progressForm.getByRole('button', { name: 'Save progress offline' }).click();
  await expect(page.getByText('Field progress was saved locally and will be recorded when this operator reconnects.')).toBeVisible();
  await expect(page.getByText('2 queued').first()).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('Outbox clear')).toBeVisible({ timeout: 15_000 });

  await expect.poll(async () => {
    const response = await request.get(`/api/ledger/jobs/${job.id}`);
    if (!response.ok()) return null;
    const detail = (await response.json()).job;
    return {
      reports: detail.fieldReports.filter(record => record.workCompleted === 'Offline partition framing retained for later sync.').length,
      timeLogs: detail.timeLogs.filter(record => record.notes === 'Offline partition framing retained for later sync.').length,
      safety: detail.safetyChecks.filter(record => record.data?.source === 'daily_site_log').length,
      progress: detail.progress.filter(record => record.note === 'Offline progress note waiting for the same scoped ledger route.').length
    };
  }, { timeout: 15_000 }).toEqual({ reports: 1, timeLogs: 1, safety: 1, progress: 1 });

  await page.evaluate(({ jobId, suffix }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('contractor-ai-field-outbox', 2);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction('operation-drafts', 'readwrite');
      transaction.objectStore('operation-drafts').put({
        id: `foreign-progress-${suffix}`,
        kind: 'operation',
        type: 'progress',
        jobId,
        payload: {
          status: 'blocked',
          progressPercent: 99,
          note: 'A foreign operator scope must never replay this update.',
          source: 'field_outbox'
        },
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
