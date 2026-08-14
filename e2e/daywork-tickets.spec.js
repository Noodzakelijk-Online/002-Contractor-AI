const { test, expect } = require('@playwright/test');

async function postJson(request, route, data) {
  const response = await request.post(route, { data });
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function openJob(page, title) {
  await page.goto('/');
  await page.getByLabel(/^(Language|Taal)$/).selectOption('en-GB');
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  const workspace = page.getByTestId('job-workspace');
  await expect(workspace).toBeVisible();
  const control = workspace.getByTestId('daywork-control');
  await expect(control.getByRole('heading', { name: 'Daywork and extra work' })).toBeVisible();
  return control;
}

test('daywork moves from offline quantity capture through acknowledgement and source-bound pricing without overflow', async ({ page, request, context }) => {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const suffix = Date.now();
  const title = `Browser daywork ${suffix}`;
  const worker = (await postJson(request, '/api/ledger/workers', {
    name: `Browser daywork worker ${suffix}`,
    role: 'Site operative',
    status: 'available'
  })).worker;
  const job = (await postJson(request, '/api/ledger/intake', {
    title,
    client: { name: `Browser daywork client ${suffix}` },
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
      resolvedBy: 'Browser daywork approver',
      reason: 'Worker identity and project assignment verified.'
    });
  }

  let control = await openJob(page, title);
  const form = control.getByTestId('daywork-entry-form');
  await form.getByLabel('Responsible worker').selectOption(worker.id);
  await form.getByLabel('Title', { exact: true }).fill('Additional containment support');
  await form.getByLabel('Work completed').fill('Installed additional containment support around an existing service conflict.');
  await form.getByLabel('Reason', { exact: true }).fill('Existing services were not shown on the retained coordination basis.');
  await form.getByLabel('Evidence reference', { exact: true }).fill(`browser-daywork-photos:${suffix}`);
  await form.getByLabel('Internal note').fill('Site quantities recorded before commercial review.');
  const firstLine = form.locator('.daywork-line-editor').first();
  await firstLine.getByLabel('Type').selectOption('labor');
  await firstLine.getByLabel('Description').fill('Installation labor');
  await firstLine.getByLabel('Quantity').fill('4');
  await firstLine.getByLabel('Unit').fill('hour');
  await firstLine.getByLabel('Cost code').fill('DW-LAB');
  await firstLine.getByLabel('Line evidence').fill(`browser-timesheet:${suffix}`);
  await form.getByRole('button', { name: 'Quantity line' }).click();
  const secondLine = form.locator('.daywork-line-editor').nth(1);
  await secondLine.getByLabel('Type').selectOption('material');
  await secondLine.getByLabel('Description').fill('Galvanized support bracket');
  await secondLine.getByLabel('Quantity').fill('6');
  await secondLine.getByLabel('Unit').fill('piece');
  await secondLine.getByLabel('Cost code').fill('DW-MAT');
  await secondLine.getByLabel('Line evidence').fill(`browser-delivery-note:${suffix}`);

  await context.setOffline(true);
  await form.getByRole('button', { name: 'Save daywork offline' }).click();
  await expect(page.getByText('Daywork quantities were saved locally and will be submitted for review after reconnection.')).toBeVisible();
  await context.setOffline(false);
  await expect(control.getByText('Outbox clear')).toBeVisible({ timeout: 15_000 });
  let ticket;
  await expect.poll(async () => {
    const response = await request.get(`/api/ledger/jobs/${job.id}/daywork-tickets`);
    if (!response.ok()) return 0;
    const body = await response.json();
    ticket = body.dayworkTickets.find(item => item.title === 'Additional containment support');
    return ticket ? 1 : 0;
  }, { timeout: 15_000 }).toBe(1);
  expect(ticket.status).toBe('pending_approval');
  expect(ticket.integrityValid).toBe(true);

  await postJson(request, `/api/ledger/approvals/${ticket.approvalId}/resolve`, {
    status: 'approved',
    resolvedBy: 'Browser daywork approver',
    reason: 'Observed quantities and evidence verified.'
  });
  control = await openJob(page, title);
  let ticketCard = control.locator('.daywork-ticket').filter({ hasText: 'Additional containment support' });
  await expect(ticketCard.locator('.status')).toHaveText('approved');
  await ticketCard.getByRole('button', { name: 'Record acknowledgement' }).click();
  const acknowledgementForm = ticketCard.getByTestId('daywork-acknowledgement-form');
  await acknowledgementForm.getByLabel('Evidence reference').fill(`browser-signed-record:${suffix}`);
  await acknowledgementForm.getByLabel('Acknowledged by').fill('Browser client representative');
  await acknowledgementForm.getByLabel('Internal note').fill('Receipt of the retained site record only.');
  await acknowledgementForm.getByRole('button', { name: 'Request evidence review' }).click();
  await expect(page.getByText('Acknowledgement evidence was retained for review. It confirms receipt only and does not accept price or scope.')).toBeVisible();

  let detailResponse = await request.get(`/api/ledger/jobs/${job.id}`);
  let detail = (await detailResponse.json()).job;
  const acknowledgementApproval = detail.approvals.find(approval => approval.targetType === 'daywork_acknowledgement' && approval.targetId === ticket.id && approval.status === 'pending');
  expect(acknowledgementApproval).toBeTruthy();
  await postJson(request, `/api/ledger/approvals/${acknowledgementApproval.id}/resolve`, {
    status: 'approved',
    resolvedBy: 'Browser daywork approver',
    reason: 'Receipt evidence verified against the retained source.'
  });

  control = await openJob(page, title);
  ticketCard = control.locator('.daywork-ticket').filter({ hasText: 'Additional containment support' });
  await expect(ticketCard.locator('.status')).toHaveText('acknowledged');
  await ticketCard.getByRole('button', { name: 'Price change' }).click();
  const pricingForm = ticketCard.getByTestId('daywork-pricing-form');
  await pricingForm.locator('.daywork-price-lines input').nth(0).fill('80');
  await pricingForm.locator('.daywork-price-lines input').nth(1).fill('20');
  await expect(pricingForm.getByText('€440.00')).toBeVisible();
  await pricingForm.getByLabel('Schedule impact (days)').fill('1');
  await pricingForm.getByRole('button', { name: 'Prepare change order' }).click();
  await expect(page.getByText('A source-bound change order was prepared for approval. Contract value and external commitments remain unchanged.')).toBeVisible();

  detailResponse = await request.get(`/api/ledger/jobs/${job.id}`);
  detail = (await detailResponse.json()).job;
  const retainedTicket = detail.dayworkTickets.find(item => item.id === ticket.id);
  expect(retainedTicket.status).toBe('converted');
  expect(retainedTicket.acknowledgementReference).toBe(`browser-signed-record:${suffix}`);
  const changeOrder = detail.changeOrders.find(item => item.id === retainedTicket.changeOrderId);
  expect(changeOrder.status).toBe('pending_approval');
  expect(changeOrder.amount).toBe(440);
  expect(changeOrder.data.source.id).toBe(ticket.id);
  expect(changeOrder.data.source.sourceHash).toBe(ticket.sourceHash);

  await page.locator('header').getByLabel('Language', { exact: true }).selectOption('nl-NL');
  await expect(control.getByRole('heading', { name: 'Regiewerk en extra werk' })).toBeVisible();
  ticketCard = control.locator('.daywork-ticket').filter({ hasText: 'Additional containment support' });
  await expect(ticketCard).toContainText('Installed additional containment support around an existing service conflict.');
  await expect(ticketCard).toContainText('Existing services were not shown on the retained coordination basis.');
  await expect(ticketCard.locator('.status')).toHaveText('omgezet');
  await expect(control.getByText('Geen regiebonnen')).toHaveCount(0);
  await page.locator('header').getByLabel('Taal', { exact: true }).selectOption('en-GB');

  await page.setViewportSize({ width: 390, height: 844 });
  control = await openJob(page, title);
  const geometry = await control.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    overflowing: [...element.querySelectorAll('*')]
      .filter(child => child.scrollWidth > child.clientWidth + 1)
      .map(child => ({
        tag: child.tagName.toLowerCase(),
        className: child.className,
        scrollWidth: child.scrollWidth,
        clientWidth: child.clientWidth
      }))
      .slice(0, 10)
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth, JSON.stringify(geometry.overflowing)).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(consoleErrors).toEqual([]);
});
