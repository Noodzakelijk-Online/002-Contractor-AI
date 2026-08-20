const { test, expect } = require('@playwright/test');

async function createJob(request, title) {
  const response = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Residential renovation',
      status: 'in_progress',
      client: { name: 'Browser feedback client' },
      assignAutomatically: false
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test('client feedback stays scoped, creates internal recovery, and appears in the operator workspace', async ({ page, request }) => {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const suffix = Date.now();
  const title = `Browser client feedback ${suffix}`;
  const intake = await createJob(request, title);
  const accessResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/client-portal-access`, {
    data: {
      label: `Feedback portal ${suffix}`
    }
  });
  expect(accessResponse.ok()).toBeTruthy();
  const access = await accessResponse.json();
  const approvalResponse = await request.post(`/api/ledger/approvals/${access.access.approval.id}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Browser feedback approver',
      reason: 'The client identity, project scope, and portal expiry were verified.'
    }
  });
  expect(approvalResponse.ok()).toBeTruthy();
  const beforeFeedbackResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(beforeFeedbackResponse.ok()).toBeTruthy();
  const communicationIdsBeforeFeedback = (await beforeFeedbackResponse.json()).job.communications.map(item => item.id).sort();

  const portalResponse = await page.goto(`/client-portal.html#token=${access.access.portalToken}`);
  expect(portalResponse.ok()).toBeTruthy();
  const feedbackPanel = page.getByTestId('client-feedback-panel');
  await expect(feedbackPanel.getByRole('heading', { name: 'Uw ervaring' })).toBeVisible();
  await expect(feedbackPanel.getByLabel('Hoe waarschijnlijk is het dat u ons aanbeveelt?')).toHaveValue('');
  await expect(feedbackPanel.getByLabel('Hoe tevreden bent u?')).toHaveValue('');
  await expect(feedbackPanel.getByLabel('Hoe gemakkelijk was samenwerken?')).toHaveValue('');
  await feedbackPanel.getByLabel('Hoe waarschijnlijk is het dat u ons aanbeveelt?').selectOption('3');
  await feedbackPanel.getByLabel('Hoe tevreden bent u?').selectOption('2');
  await feedbackPanel.getByLabel('Hoe gemakkelijk was samenwerken?').selectOption('2');
  await feedbackPanel.getByLabel('Toelichting (optioneel)').fill('De opleverpunten waren niet tijdig afgestemd.');
  await feedbackPanel.getByLabel('U mag contact met mij opnemen over deze feedback.').check();
  await feedbackPanel.getByRole('button', { name: 'Feedback opslaan' }).click();
  await expect(feedbackPanel.getByText('Feedback ontvangen')).toBeVisible();
  await expect(feedbackPanel.getByText('Bedankt. Uw feedback is toegevoegd aan het projectdossier.')).toBeVisible();
  await expect(feedbackPanel.getByRole('button', { name: 'Feedback opslaan' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('client-feedback-panel').getByText('Feedback ontvangen')).toBeVisible();
  const publicSnapshotResponse = await request.get('/api/client-portal', {
    headers: { Authorization: `Bearer ${access.access.portalToken}` }
  });
  expect(publicSnapshotResponse.ok()).toBeTruthy();
  const publicSnapshot = await publicSnapshotResponse.json();
  expect(publicSnapshot.portal.feedback).toEqual(expect.objectContaining({
    submitted: true,
    surveyType: 'project_experience'
  }));
  expect(publicSnapshot.portal.feedback.npsScore).toBeUndefined();

  await page.setViewportSize({ width: 390, height: 844 });
  const portalGeometry = await page.locator('.client-portal-shell').evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    shellWidth: element.scrollWidth
  }));
  expect(portalGeometry.pageWidth).toBeLessThanOrEqual(portalGeometry.viewportWidth);
  expect(portalGeometry.shellWidth).toBeLessThanOrEqual(portalGeometry.viewportWidth);

  const feedbackDetailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(feedbackDetailResponse.ok()).toBeTruthy();
  const feedbackDetail = (await feedbackDetailResponse.json()).job;
  expect(feedbackDetail.clientFeedback).toHaveLength(1);
  expect(feedbackDetail.clientFeedback[0]).toEqual(expect.objectContaining({
    source: 'client_portal',
    npsScore: 3,
    csatScore: 2,
    effortScore: 2,
    followUpConsent: true,
    followUpRequired: true,
    integrityValid: true
  }));
  expect(feedbackDetail.communications.map(item => item.id).sort()).toEqual(communicationIdsBeforeFeedback);
  expect(feedbackDetail.communications.filter(item => item.status === 'sent')).toHaveLength(0);
  expect(feedbackDetail.aftercare).toHaveLength(0);

  const cycleResponse = await request.post('/api/ledger/autonomous-cycle', {
    data: {
      actionTypes: ['prepare_client_feedback_recovery'],
      jobIds: [intake.job.id]
    }
  });
  expect(cycleResponse.ok()).toBeTruthy();
  const cycle = await cycleResponse.json();
  expect(cycle.summary.externalCommitments).toBe(0);

  const recoveredResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  const recovered = (await recoveredResponse.json()).job;
  expect(recovered.aftercare).toHaveLength(1);
  expect(recovered.aftercare[0].data).toEqual(expect.objectContaining({
    feedbackId: recovered.clientFeedback[0].id,
    feedbackRecovery: true,
    internalOnly: true
  }));
  expect(recovered.communications.map(item => item.id).sort()).toEqual(communicationIdsBeforeFeedback);
  expect(recovered.communications.filter(item => item.status === 'sent')).toHaveLength(0);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  const workspace = page.getByTestId('job-workspace');
  const closeout = workspace.getByTestId('closeout-register');
  await closeout.getByRole('tab', { name: /Feedback/ }).click();
  await expect(closeout.getByText('project experience feedback')).toBeVisible();
  await expect(closeout.getByText(/NPS 3\/10.*satisfaction 2\/5.*ease 2\/5/)).toBeVisible();
  await expect(closeout.getByText('Recovery in progress')).toBeVisible();

  await closeout.getByRole('tab', { name: /Aftercare/ }).click();
  await expect(closeout.getByText('Review low client feedback and prepare service recovery')).toBeVisible();
  await expect(consoleErrors).toEqual([]);
});
