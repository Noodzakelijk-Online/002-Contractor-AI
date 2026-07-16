const { test, expect } = require('@playwright/test');

async function createJob(request, title) {
  const response = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'General contracting',
      status: 'planned',
      client: { name: 'Browser meeting client', email: 'browser-meeting@example.test' },
      assignAutomatically: false
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function jobDetail(request, jobId) {
  const response = await request.get(`/api/ledger/jobs/${jobId}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).job;
}

async function approve(request, approvalId) {
  const response = await request.post(`/api/ledger/approvals/${approvalId}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Browser meeting owner',
      reason: 'Attendance, decisions, action owners, due dates, and retained snapshot verified.'
    }
  });
  expect(response.ok()).toBeTruthy();
}

async function openJob(page, title) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  const workspace = page.getByTestId('job-workspace');
  await expect(workspace.getByRole('heading', { name: title })).toBeVisible();
  return workspace;
}

test('operator records approved meeting minutes, completes an action, and carries another into follow-up', async ({ page, request }) => {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const title = `Browser project meeting ${Date.now()}`;
  const intake = await createJob(request, title);
  let workspace = await openJob(page, title);
  let controls = workspace.getByTestId('project-controls');

  await controls.getByRole('tab', { name: /Meetings/ }).click();
  await controls.getByRole('button', { name: 'New meeting' }).click();
  const form = controls.getByTestId('create-project-meeting-form');
  await form.getByLabel('Meeting title').fill('Weekly project coordination');
  await form.getByLabel('Meeting type').selectOption('coordination');
  await form.getByLabel('Chair').fill('Project manager');
  await form.getByLabel('Location').fill('Site office');
  await form.getByLabel('Attendees').fill('Project manager <pm@example.test>\nSite lead <site@example.test>');
  await form.getByLabel('Agenda', { exact: true }).fill('Programme and access\nDesign decisions');
  await form.getByLabel('Minutes summary').fill('The team reviewed progress, retained access constraints, and the agreed construction sequence.');
  await form.getByLabel('Decisions', { exact: true }).fill('Keep the retained construction sequence.\nReview delivery evidence next week.');

  const firstAction = form.getByTestId('meeting-action-draft-1');
  await firstAction.getByLabel('Action', { exact: true }).fill('Confirm delivery window');
  await firstAction.getByLabel('Owner', { exact: true }).fill('Site lead');
  await firstAction.locator('select').selectOption('high');
  await firstAction.getByLabel('Details', { exact: true }).fill('Retain supplier confirmation before mobilization.');
  await form.getByRole('button', { name: 'Add action' }).click();
  const secondAction = form.getByTestId('meeting-action-draft-2');
  await secondAction.getByLabel('Action', { exact: true }).fill('Close design response');
  await secondAction.getByLabel('Owner', { exact: true }).fill('Project manager');
  await secondAction.locator('select').selectOption('medium');
  await secondAction.getByLabel('Details', { exact: true }).fill('Retain the approved response before the next coordination review.');
  await form.getByRole('button', { name: 'Retain draft minutes' }).click();
  await expect(page.getByText('Draft meeting minutes retained with decisions and proposed actions.')).toBeVisible();

  let row = controls.locator('.project-control-row').filter({ hasText: 'Weekly project coordination' });
  await expect(row.getByText('draft', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Submit minutes' }).click();
  let review = controls.getByTestId('project-control-review-form');
  await review.getByRole('button', { name: 'Request minutes approval' }).click();
  await expect(page.getByText(/meeting minutes added to the approval queue/i)).toBeVisible();

  let detail = await jobDetail(request, intake.job.id);
  let meeting = detail.projectMeetings.find(record => record.title === 'Weekly project coordination');
  expect(meeting.actions).toHaveLength(2);
  const approval = detail.approvals.find(item => item.targetType === 'project_meeting_minutes' && item.targetId === meeting.id && item.status === 'pending');
  expect(approval).toBeTruthy();
  await approve(request, approval.id);

  workspace = await openJob(page, title);
  controls = workspace.getByTestId('project-controls');
  await controls.getByRole('tab', { name: /Meetings/ }).click();
  row = controls.locator('.project-control-row').filter({ hasText: 'Weekly project coordination' });
  await expect(row.getByText('approved', { exact: true })).toBeVisible();
  await expect(row.getByText(/Confirm delivery window/)).toBeVisible();
  await row.getByRole('button', { name: 'Record issue' }).click();
  review = controls.getByTestId('project-control-review-form');
  await review.getByLabel('Delivery evidence reference').fill('email-receipt:browser-meeting-minutes');
  await review.getByRole('button', { name: 'Record minutes issue' }).click();
  await expect(page.getByText(/distribution evidence retained/i)).toBeVisible();

  row = controls.locator('.project-control-row').filter({ hasText: 'Weekly project coordination' });
  await row.getByRole('button', { name: 'Complete action' }).click();
  review = controls.getByTestId('project-control-review-form');
  await expect(review.getByLabel('Open action')).toHaveValue(/meeting_action_/);
  await review.getByLabel('Completion evidence reference').fill('supplier-confirmation:browser-delivery-window');
  await review.getByRole('button', { name: 'Complete action' }).click();
  await expect(page.getByText(/linked job task completed/i)).toBeVisible();

  detail = await jobDetail(request, intake.job.id);
  meeting = detail.projectMeetings.find(record => record.id === meeting.id);
  expect(meeting.status).toBe('issued');
  expect(meeting.actions.filter(action => action.status === 'completed')).toHaveLength(1);
  expect(meeting.actions.filter(action => action.status === 'open')).toHaveLength(1);
  expect(detail.tasks.filter(task => task.data?.projectMeetingId === meeting.id)).toHaveLength(2);

  row = controls.locator('.project-control-row').filter({ hasText: 'Weekly project coordination' });
  await row.getByRole('button', { name: 'Follow-up' }).click();
  review = controls.getByTestId('project-control-review-form');
  await review.getByLabel('Follow-up minutes summary').fill('The remaining design response action was reviewed and carried into the next coordination record.');
  await review.getByRole('button', { name: 'Create follow-up' }).click();
  await expect(page.getByText(/unresolved action.*new draft follow-up/i)).toBeVisible();

  detail = await jobDetail(request, intake.job.id);
  const followUp = detail.projectMeetings.find(record => record.followsMeetingId === meeting.id);
  expect(followUp).toBeTruthy();
  expect(followUp.status).toBe('draft');
  expect(followUp.actions).toHaveLength(1);
  expect(followUp.actions[0].carriedFromActionId).toBe(meeting.actions.find(action => action.status === 'open').id);
  expect(followUp.actions[0].linkedTaskId).toBe(meeting.actions.find(action => action.status === 'open').linkedTaskId);

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await controls.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(consoleErrors).toEqual([]);
});
