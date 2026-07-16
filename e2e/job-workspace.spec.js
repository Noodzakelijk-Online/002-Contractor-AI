const { test, expect } = require('@playwright/test');

async function createBrowserJob(request, title, overrides = {}) {
  const response = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Garden maintenance',
      address: 'Keizersgracht 10, Amsterdam',
      city: 'Amsterdam',
      priority: 'high',
      estimatedHours: 6,
      client: { name: 'Browser QA Client', email: 'browser@example.test' },
      ...overrides
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function ensureBrowserOrganization(request) {
  const response = await request.put('/api/ledger/organization', {
    data: {
      legalName: 'Browser Contractor B.V.',
      tradingName: 'Browser Contractor',
      registrationNumber: '12345678',
      vatNumber: 'NL123456789B01',
      email: 'browser-office@example.test',
      phone: '+31 30 123 45 67',
      address: 'Browserstraat 10',
      postalCode: '3511 AA',
      city: 'Utrecht',
      country: 'NL',
      iban: 'NL91ABNA0417164300',
      bic: 'ABNANL2A',
      defaultPaymentTermsDays: 30,
      defaultQuoteValidityDays: 30
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function ensureVerifiedTradePartner(request, name = 'Bouwmaat') {
  const listResponse = await request.get(`/api/ledger/trade-partners?includeRetired=true&search=${encodeURIComponent(name)}&limit=100`);
  expect(listResponse.ok()).toBeTruthy();
  const list = await listResponse.json();
  const existing = list.partners.find(partner => partner.name === name && partner.status === 'active');
  if (existing?.compliance?.compliant) return existing;
  if (existing) {
    const updateResponse = await request.put(`/api/ledger/trade-partners/${existing.id}`, {
      data: {
        registrationNumber: '12345678',
        vatNumber: 'NL123456789B01',
        verificationReference: 'Browser QA registry check',
        verifiedAt: new Date(Date.now() - 86_400_000).toISOString()
      }
    });
    expect(updateResponse.ok()).toBeTruthy();
    return (await updateResponse.json()).partner;
  }
  const createResponse = await request.post('/api/ledger/trade-partners', {
    data: {
      name,
      partnerType: 'supplier',
      registrationNumber: '12345678',
      vatNumber: 'NL123456789B01',
      verificationReference: 'Browser QA registry check',
      verifiedAt: new Date(Date.now() - 86_400_000).toISOString()
    }
  });
  expect(createResponse.ok()).toBeTruthy();
  return (await createResponse.json()).partner;
}

async function resolvePendingClientApprovals(request, jobId) {
  const clientTargets = new Set(['communication', 'client_selection', 'quality_check', 'punch_item', 'warranty_claim', 'job_update']);
  const detailResponse = await request.get(`/api/ledger/jobs/${jobId}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  const pending = detail.job.approvals.filter(approval => approval.status === 'pending' && clientTargets.has(approval.targetType));
  for (const approval of pending) {
    const response = await request.post(`/api/ledger/approvals/${approval.id}/resolve`, {
      data: { status: 'approved', resolvedBy: 'Browser client QA', reason: 'Fixture approval resolved without recording any external delivery.' }
    });
    expect(response.ok()).toBeTruthy();
  }
}

async function resolveAllPendingApprovals(request, jobId) {
  const detailResponse = await request.get(`/api/ledger/jobs/${jobId}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  for (const approval of detail.job.approvals.filter(item => item.status === 'pending')) {
    const response = await request.post(`/api/ledger/approvals/${approval.id}/resolve`, {
      data: { status: 'approved', resolvedBy: 'Browser lifecycle QA', reason: 'Existing job decision reviewed before lifecycle control.' }
    });
    expect(response.ok()).toBeTruthy();
  }
}

async function approveQueueItem(page, approvalItem, reason = 'Browser QA verified the decision details and safeguards.') {
  await approvalItem.getByRole('button', { name: 'Review and approve' }).click();
  const modal = page.getByTestId('approval-review-modal');
  await expect(modal).toBeVisible();
  await modal.getByLabel('Reviewer reason').fill(reason);
  await modal.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();
}

test('office operator can review job planning and create a client draft without delivery', async ({ page, request }) => {
  const intake = await createBrowserJob(request, 'Browser job workspace garden renovation');
  const workerResponse = await request.post('/api/ledger/workers', {
    data: { name: 'Browser workspace crew lead', role: 'Garden maintenance', status: 'available', homeRegion: 'Amsterdam' }
  });
  expect(workerResponse.ok()).toBeTruthy();
  const worker = await workerResponse.json();
  const toolResponse = await request.post('/api/ledger/tools', {
    data: { name: 'Browser workspace hedge trimmer', category: 'equipment', status: 'available', currentLocation: 'Amsterdam' }
  });
  expect(toolResponse.ok()).toBeTruthy();
  const tool = await toolResponse.json();
  const blockedToolResponse = await request.post('/api/ledger/tools', {
    data: {
      name: 'Browser overdue inspection lift',
      category: 'access',
      status: 'available',
      currentLocation: 'Amsterdam',
      data: { inspectionRequired: true, inspectionDueAt: '2020-01-01' }
    }
  });
  expect(blockedToolResponse.ok()).toBeTruthy();
  const blockedTool = await blockedToolResponse.json();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: `Open ${intake.job.title}` }).first().click();

  const workspace = page.getByTestId('job-workspace');
  await expect(workspace.getByRole('heading', { name: intake.job.title })).toBeVisible();
  await workspace.getByLabel('Proposed start').fill('2026-07-15T08:00');
  await workspace.getByLabel('Proposed end').fill('2026-07-15T14:00');
  await workspace.getByRole('button', { name: 'Review schedule' }).click();
  await expect(page.getByText('Schedule review completed. No date has been committed.')).toBeVisible();

  await page.getByRole('button', { name: 'Open resource planner' }).click();
  const planner = page.getByTestId('resource-planner');
  await expect(planner.getByRole('heading', { name: 'Crew and equipment' })).toBeVisible();
  await planner.getByLabel('Crew member').selectOption(worker.worker.id);
  await planner.getByRole('button', { name: 'Add crew assignment' }).click();
  await expect(page.getByText('Crew assignment was added to the internal work plan.')).toBeVisible();
  await expect(planner.getByLabel('Equipment').locator(`option[value="${blockedTool.tool.id}"]`)).toHaveCount(0);
  await planner.getByLabel('Equipment').selectOption(tool.tool.id);
  await planner.getByRole('button', { name: 'Reserve equipment' }).click();
  await expect(page.getByText('Equipment reservation was added to the internal work plan.')).toBeVisible();

  const plannedJobResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(plannedJobResponse.ok()).toBeTruthy();
  const plannedJob = await plannedJobResponse.json();
  expect(plannedJob.job.assignments).toEqual(expect.arrayContaining([expect.objectContaining({ workerId: worker.worker.id, status: 'planned' })]));
  expect(plannedJob.job.tools).toEqual(expect.arrayContaining([expect.objectContaining({ toolId: tool.tool.id, status: 'reserved' })]));

  await planner.getByRole('button', { name: `Release assignment for ${worker.worker.name}` }).click();
  await expect(page.getByText('Crew assignment released from the internal work plan.')).toBeVisible();
  await planner.getByRole('button', { name: `Release ${tool.tool.name}` }).click();
  await expect(page.getByText('Equipment reservation released from the internal work plan.')).toBeVisible();
  const releasedJobResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(releasedJobResponse.ok()).toBeTruthy();
  const releasedJob = await releasedJobResponse.json();
  expect(releasedJob.job.assignments).toEqual(expect.arrayContaining([expect.objectContaining({ workerId: worker.worker.id, status: 'released' })]));
  expect(releasedJob.job.tools).toEqual(expect.arrayContaining([expect.objectContaining({ toolId: tool.tool.id, status: 'released' })]));
  await planner.getByRole('button', { name: 'Close resource planner' }).click();

  await workspace.getByRole('button', { name: 'Record assessment' }).click();
  await expect(workspace.getByText(/Latest: workable/i)).toBeVisible();

  await workspace.getByLabel('Subject').fill('Confirm garden access');
  await workspace.getByLabel('Draft message').fill('Please confirm access for the proposed work window.');
  await workspace.getByRole('button', { name: 'Create approval-gated draft' }).click();
  await expect(page.getByText('Client email draft created. Approval is required before delivery.')).toBeVisible();
  await expect(workspace.getByText('Confirm garden access')).toBeVisible();
  await expect(workspace.getByText('draft', { exact: true }).first()).toBeVisible();

  await workspace.getByRole('button', { name: 'Request portal access' }).click();
  await expect(page.getByText(/Client portal access is pending approval/i)).toBeVisible();
  const oneTimePortalLink = await workspace.getByLabel('One-time client portal link').inputValue();
  const portalToken = new URL(oneTimePortalLink).hash.slice('#token='.length);
  const inactivePortalResponse = await request.get(`/api/client-portal/${portalToken}`);
  expect(inactivePortalResponse.status()).toBe(404);

  const communicationsResponse = await request.get('/api/ledger/communications?status=all&limit=100');
  expect(communicationsResponse.ok()).toBeTruthy();
  const communications = await communicationsResponse.json();
  const draft = communications.communications.find(item => item.jobId === intake.job.id && item.subject === 'Confirm garden access');
  expect(draft).toMatchObject({ direction: 'outbound', status: 'draft' });
  expect(draft.approvalId).toBeTruthy();
});

test('commercial control retains server totals and changes contract value only after verified client acceptance', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: 'Operations' }).click();
  const organizationPanel = page.getByTestId('organization-profile-panel');
  await expect(organizationPanel.getByRole('heading', { name: 'Business identity' })).toBeVisible();
  await organizationPanel.getByLabel('Legal name').fill('Browser Contractor B.V.');
  await organizationPanel.getByLabel('Trading name').fill('Browser Contractor');
  await organizationPanel.getByLabel('Registration number').fill('12345678');
  await organizationPanel.getByLabel('VAT number').fill('NL123456789B01');
  await organizationPanel.getByLabel('Email').fill('browser-office@example.test');
  await organizationPanel.getByLabel('Registered address').fill('Browserstraat 10');
  await organizationPanel.getByLabel('Postal code').fill('3511 AA');
  await organizationPanel.getByLabel('City').fill('Utrecht');
  await organizationPanel.getByLabel('IBAN').fill('NL91ABNA0417164300');
  await organizationPanel.getByLabel('BIC').fill('ABNANL2A');
  await organizationPanel.getByLabel('Quote terms').fill('Additional work requires a separately accepted scope change.');
  await organizationPanel.getByRole('button', { name: 'Save business identity' }).click();
  await expect(page.getByText('Business identity retained and ready for controlled commercial packages.')).toBeVisible();
  await expect(organizationPanel.getByText('issue ready', { exact: true })).toBeVisible();

  const intake = await createBrowserJob(request, 'Browser commercial acceptance workflow', {
    service: 'Interior renovation',
    estimatedCost: 0
  });
  const openJob = async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    await page.getByRole('button', { name: `Open ${intake.job.title}` }).first().click();
    await expect(page.getByTestId('job-workspace').getByRole('heading', { name: intake.job.title })).toBeVisible();
  };

  await openJob();
  let workspace = page.getByTestId('job-workspace');
  let commercial = workspace.getByTestId('commercial-control');
  await expect(commercial.getByRole('heading', { name: 'Commercial control' })).toBeVisible();
  await expect(commercial.getByText('Not retained')).toBeVisible();

  const estimateButton = commercial.getByRole('button', { name: 'New estimate' });
  await estimateButton.click();
  const quoteModal = page.getByTestId('commercial-draft-modal');
  await expect(quoteModal.getByRole('heading', { name: 'New estimate' })).toBeVisible();
  const firstQuoteLine = quoteModal.locator('.commercial-line-item').first();
  await firstQuoteLine.getByLabel('Description').fill('Carpentry installation');
  await firstQuoteLine.getByLabel('Quantity').fill('2');
  await firstQuoteLine.getByLabel('Unit price').fill('600');
  await quoteModal.getByRole('button', { name: 'Add line' }).click();
  const secondQuoteLine = quoteModal.locator('.commercial-line-item').nth(1);
  await secondQuoteLine.getByLabel('Description').fill('Finish materials');
  await secondQuoteLine.getByLabel('Quantity').fill('3');
  await secondQuoteLine.getByLabel('Unit price').fill('100');
  await expect(quoteModal.getByLabel('Commercial totals')).toContainText(/1[.,]500/);
  await quoteModal.getByRole('button', { name: 'Retain estimate' }).click();
  await expect(quoteModal).toBeHidden();
  await expect(estimateButton).toBeFocused();

  let detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  let detail = await detailResponse.json();
  const quote = detail.job.quotes.find(item => item.subtotal === 1500);
  expect(quote).toMatchObject({ subtotal: 1500, taxAmount: 315, total: 1815, status: 'draft' });
  expect(detail.job.contractValue).toBe(0);

  let quoteRow = commercial.getByTestId(`commercial-quote-${quote.id}`);
  await quoteRow.getByRole('button', { name: 'Review quote' }).click();
  await expect(workspace).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Approval queue' })).toBeVisible();
  await approveQueueItem(page, page.locator('.approval-item'), 'Estimate scope, rates, VAT, and retained safeguards verified.');

  await openJob();
  workspace = page.getByTestId('job-workspace');
  commercial = workspace.getByTestId('commercial-control');
  quoteRow = commercial.getByTestId(`commercial-quote-${quote.id}`);
  await expect(quoteRow.getByText('approved', { exact: true })).toBeVisible();
  await expect(commercial.getByLabel('Accepted commercial value')).toContainText(/Accepted contract net€\s*0/);
  await quoteRow.getByRole('button', { name: 'Prepare issue package' }).click();
  await expect(page.getByText(/Quote package Q-.* retained\. Delivery remains blocked/i)).toBeVisible();
  await expect(quoteRow.getByRole('link', { name: 'Download package' })).toBeVisible();
  detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  detail = await detailResponse.json();
  const quotePackage = detail.job.documents.find(item => item.type === 'quote_issue_package' && item.data?.sourceRecordId === quote.id);
  const deliveryDraft = detail.job.communications.find(item => item.data?.source === 'quote_issue_package' && item.data?.sourceRecordId === quote.id);
  expect(quotePackage).toBeTruthy();
  expect(deliveryDraft).toMatchObject({ status: 'draft', sentAt: null });
  expect(detail.job.contractValue).toBe(0);
  await quoteRow.getByRole('button', { name: 'Review delivery' }).click();
  await approveQueueItem(page, page.locator('.approval-item'), 'Quote attachment, recipient, and delivery wording verified.');

  await openJob();
  workspace = page.getByTestId('job-workspace');
  commercial = workspace.getByTestId('commercial-control');
  quoteRow = commercial.getByTestId(`commercial-quote-${quote.id}`);
  await expect(quoteRow.getByRole('link', { name: 'Download package' })).toHaveAttribute('href', `/api/ledger/documents/${quotePackage.id}/issue-package`);
  detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  detail = await detailResponse.json();
  expect(detail.job.communications.find(item => item.id === deliveryDraft.id)).toMatchObject({ status: 'approved', sentAt: null });
  expect(detail.job.contractValue).toBe(0);
  await quoteRow.getByRole('button', { name: 'Record acceptance' }).click();
  const quoteAcceptanceModal = page.getByTestId('commercial-acceptance-modal');
  await quoteAcceptanceModal.getByLabel('Evidence reference').fill('signed-quote-browser-001');
  await quoteAcceptanceModal.getByLabel('Verification notes').fill('Signed PDF retained in the client contract file.');
  await quoteAcceptanceModal.getByRole('button', { name: 'Request verification' }).click();
  await expect(quoteAcceptanceModal).toBeHidden();

  detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  detail = await detailResponse.json();
  expect(detail.job.contractValue).toBe(0);
  const quoteAcceptance = detail.job.approvals.find(item => item.targetType === 'quote_acceptance' && item.status === 'pending');
  expect(quoteAcceptance).toBeTruthy();
  quoteRow = commercial.getByTestId(`commercial-quote-${quote.id}`);
  await quoteRow.getByRole('button', { name: 'Verify acceptance' }).click();
  await approveQueueItem(page, page.locator('.approval-item'), 'Signed quote reference and retained evidence location verified.');

  await openJob();
  workspace = page.getByTestId('job-workspace');
  commercial = workspace.getByTestId('commercial-control');
  quoteRow = commercial.getByTestId(`commercial-quote-${quote.id}`);
  await expect(quoteRow.getByText('accepted', { exact: true })).toBeVisible();
  await expect(quoteRow).toContainText('signed-quote-browser-001');

  const changeButton = commercial.getByRole('button', { name: 'Scope change' });
  await changeButton.click();
  const changeModal = page.getByTestId('commercial-draft-modal');
  await changeModal.getByLabel('Change title').fill('Additional acoustic lining');
  await changeModal.getByLabel('Scope change').fill('Add acoustic lining to the retained partition scope.');
  const changeLine = changeModal.locator('.commercial-line-item').first();
  await changeLine.getByLabel('Description').fill('Acoustic lining');
  await changeLine.getByLabel('Quantity').fill('2');
  await changeLine.getByLabel('Unit price').fill('125');
  await changeModal.getByRole('button', { name: 'Request change approval' }).click();
  await expect(changeModal).toBeHidden();
  await expect(changeButton).toBeFocused();

  detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  detail = await detailResponse.json();
  const changeOrder = detail.job.changeOrders.find(item => item.title === 'Additional acoustic lining');
  expect(changeOrder).toMatchObject({ amount: 250, taxAmount: 52.5, total: 302.5, status: 'pending_approval' });
  expect(detail.job.contractValue).toBe(1500);

  let changeRow = commercial.getByTestId(`commercial-change-${changeOrder.id}`);
  await changeRow.getByRole('button', { name: 'Review change' }).click();
  await approveQueueItem(page, page.locator('.approval-item'), 'Scope delta, schedule impact, and retained rates verified.');

  await openJob();
  workspace = page.getByTestId('job-workspace');
  commercial = workspace.getByTestId('commercial-control');
  changeRow = commercial.getByTestId(`commercial-change-${changeOrder.id}`);
  await expect(changeRow.getByText('approved', { exact: true })).toBeVisible();
  await expect(commercial.getByLabel('Accepted commercial value')).toContainText(/1[.,]500/);
  await changeRow.getByRole('button', { name: 'Prepare issue package' }).click();
  await expect(page.getByText(/Change-order package CO-.* retained\. Delivery remains blocked/i)).toBeVisible();
  await expect(changeRow.getByRole('link', { name: 'Download package' })).toBeVisible();

  detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  detail = await detailResponse.json();
  const changePackage = detail.job.documents.find(
    item => item.type === 'change_order_issue_package' && item.data?.sourceRecordId === changeOrder.id
  );
  const changeDelivery = detail.job.communications.find(
    item => item.data?.source === 'change_order_issue_package' && item.data?.sourceRecordId === changeOrder.id
  );
  expect(changePackage).toBeTruthy();
  expect(changeDelivery).toMatchObject({ status: 'draft', sentAt: null });
  expect(detail.job.contractValue).toBe(1500);
  await changeRow.getByRole('button', { name: 'Review delivery' }).click();
  await approveQueueItem(page, page.locator('.approval-item'), 'Change-order attachment, client recipient, and delivery wording verified.');

  await openJob();
  workspace = page.getByTestId('job-workspace');
  commercial = workspace.getByTestId('commercial-control');
  changeRow = commercial.getByTestId(`commercial-change-${changeOrder.id}`);
  await expect(changeRow.getByRole('link', { name: 'Download package' })).toHaveAttribute(
    'href',
    `/api/ledger/documents/${changePackage.id}/issue-package`,
  );
  await changeRow.getByRole('button', { name: 'Record delivery receipt' }).click();
  const changeDeliveryModal = page.getByTestId('commercial-delivery-modal');
  await changeDeliveryModal.getByLabel('Configured integration ID').fill('playwright_test_provider');
  await changeDeliveryModal.getByLabel('Provider message ID').fill('browser-change-message-001');
  await changeDeliveryModal.getByRole('button', { name: 'Record verified receipt' }).click();
  await expect(changeDeliveryModal).toBeHidden();
  await expect(page.getByText(/Verified provider receipt retained for CO-/i)).toBeVisible();

  detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  detail = await detailResponse.json();
  expect(detail.job.changeOrders.find(item => item.id === changeOrder.id)).toMatchObject({
    status: 'issued',
    data: { issuePackage: { providerMessageId: 'browser-change-message-001', packageHash: changePackage.data.packageHash } },
  });
  expect(detail.job.contractValue).toBe(1500);
  changeRow = commercial.getByTestId(`commercial-change-${changeOrder.id}`);
  await changeRow.getByRole('button', { name: 'Record acceptance' }).click();
  const changeAcceptanceModal = page.getByTestId('commercial-acceptance-modal');
  await changeAcceptanceModal.getByLabel('Evidence reference').fill('signed-change-browser-001');
  await changeAcceptanceModal.getByLabel('Verification notes').fill('Signed change record retained with the contract.');
  await changeAcceptanceModal.getByRole('button', { name: 'Request verification' }).click();
  await expect(changeAcceptanceModal).toBeHidden();

  detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  detail = await detailResponse.json();
  expect(detail.job.contractValue).toBe(1500);
  const changeAcceptance = detail.job.approvals.find(item => item.targetType === 'change_order_acceptance' && item.status === 'pending');
  expect(changeAcceptance).toBeTruthy();
  const acceptedChangeResponse = await request.post(`/api/ledger/approvals/${changeAcceptance.id}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser commercial QA', reason: 'Signed change reference and retained evidence location verified.' }
  });
  expect(acceptedChangeResponse.ok()).toBeTruthy();

  await openJob();
  workspace = page.getByTestId('job-workspace');
  commercial = workspace.getByTestId('commercial-control');
  changeRow = commercial.getByTestId(`commercial-change-${changeOrder.id}`);
  await expect(changeRow.getByText('accepted', { exact: true })).toBeVisible();
  await expect(changeRow).toContainText('signed-change-browser-001');
  await expect(commercial.getByLabel('Accepted commercial value')).toContainText(/1[.,]750/);

  detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  detail = await detailResponse.json();
  expect(detail.job.contractValue).toBe(1750);
  expect(detail.job.audit).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'accept_quote_contract', entityId: quote.id }),
    expect.objectContaining({ action: 'prepare_change_order_issue_package', entityId: changePackage.id }),
    expect.objectContaining({ action: 'issue_change_order', entityId: changeOrder.id }),
    expect.objectContaining({ action: 'accept_change_order_contract', entityId: changeOrder.id })
  ]));

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(commercial).toBeVisible();
  const geometry = await commercial.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    controlWidth: element.scrollWidth,
    visibleWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.controlWidth).toBeLessThanOrEqual(geometry.visibleWidth + 1);
});

test('job workspace creates, starts, and completes retained tasks with evidence', async ({ page, request }) => {
  const intake = await createBrowserJob(request, 'Browser retained task workflow');
  const taskTitle = 'Protect completed floor before second fix';

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${intake.job.title}` }).first().click();
  const workspace = page.getByTestId('job-workspace');
  const taskControl = workspace.getByTestId('job-task-control');
  await expect(taskControl.getByRole('heading', { name: 'Work plan' })).toBeVisible();

  await taskControl.getByLabel('Task title').fill(taskTitle);
  await taskControl.getByLabel('Priority').selectOption('high');
  await taskControl.getByLabel('Due date').fill('2026-07-24');
  await taskControl.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText(`Task retained: ${taskTitle}.`)).toBeVisible();

  const taskRow = taskControl.locator('.work-plan-task').filter({ hasText: taskTitle });
  await expect(taskRow).toHaveCount(1);
  await expect(taskRow.getByText('open', { exact: true })).toBeVisible();
  await taskRow.getByRole('button', { name: `Start ${taskTitle}` }).click();
  await expect(page.getByText(`${taskTitle} is now in progress.`)).toBeVisible();
  await expect(taskRow.getByText('in progress', { exact: true })).toBeVisible();

  await taskRow.getByRole('button', { name: `Complete ${taskTitle}` }).click();
  const taskModal = page.getByTestId('task-action-modal');
  await expect(taskModal.getByRole('heading', { name: 'completed task' })).toBeVisible();
  await taskModal.getByLabel('Evidence and outcome').fill('Floor protection inspected and retained in field record task-proof-001.');
  await taskModal.getByRole('button', { name: 'Mark completed' }).click();
  await expect(page.getByText(`${taskTitle} is now completed.`)).toBeVisible();
  await expect(taskRow.getByText('completed', { exact: true })).toBeVisible();

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  const retainedTask = detail.job.tasks.find(task => task.title === taskTitle);
  expect(retainedTask).toMatchObject({ status: 'completed', priority: 'high' });
  expect(Date.parse(retainedTask.completedAt)).not.toBeNaN();
  expect(retainedTask.data.lifecycleTransition.note).toContain('task-proof-001');
  expect(detail.job.audit).toEqual(expect.arrayContaining([
    expect.objectContaining({ entityType: 'task', entityId: retainedTask.id, action: 'transition_task' })
  ]));

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(taskControl).toBeVisible();
  const horizontalOverflow = await workspace.evaluate(element => element.scrollWidth > element.clientWidth + 1);
  expect(horizontalOverflow).toBeFalsy();
});

test('dispatch workspace renders ledger jobs and prepares an idempotent internal pack', async ({ page, request }) => {
  const suffix = Date.now();
  const tradePartner = await ensureVerifiedTradePartner(request);
  const intake = await createBrowserJob(request, `Browser dispatch preparation job ${suffix}`, {
    status: 'scheduled',
    scheduledStart: '2026-07-16T08:00:00.000Z',
    scheduledEnd: '2026-07-16T14:00:00.000Z',
    assignAutomatically: false,
    tools: ['hedge trimmer'],
    materials: [{ name: 'Green waste bags', quantity: 8, unit: 'bags', supplier: 'Bouwmaat', cost: 3.5 }]
  });
  const workerResponse = await request.post('/api/ledger/workers', {
    data: { name: `Browser dispatch crew ${suffix}`, role: 'Garden maintenance', status: 'available', homeRegion: 'Amsterdam' }
  });
  expect(workerResponse.ok()).toBeTruthy();
  const worker = await workerResponse.json();
  const assignmentResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/assignments`, {
    data: {
      workerId: worker.worker.id,
      workerName: worker.worker.name,
      status: 'planned',
      scheduledStart: '2026-07-16T08:00:00.000Z',
      scheduledEnd: '2026-07-16T14:00:00.000Z'
    }
  });
  expect(assignmentResponse.ok()).toBeTruthy();
  const rfiResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/rfis`, {
    data: {
      title: 'Confirm retained boundary protection',
      status: 'open',
      question: 'Which boundary-protection detail applies before dispatch?'
    }
  });
  expect(rfiResponse.ok()).toBeTruthy();
  const rfi = await rfiResponse.json();

  await page.goto('/');
  await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
  const dispatch = page.getByTestId('dispatch-workspace');
  await expect(dispatch.getByRole('heading', { name: 'Dispatch readiness' })).toBeVisible();
  await expect(dispatch.getByRole('heading', { name: intake.job.title })).toBeVisible();

  const prepareButton = dispatch.getByRole('button', { name: `Prepare internal pack for ${intake.job.title}` });
  await prepareButton.click();
  await expect(page.getByText(/internal dispatch record\(s\) prepared/i)).toBeVisible();

  const preparedResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(preparedResponse.ok()).toBeTruthy();
  const prepared = await preparedResponse.json();
  expect(prepared.job.routePlans).toHaveLength(1);
  expect(prepared.job.loadingPlans).toHaveLength(1);
  expect(prepared.job.procurementOrders).toHaveLength(1);
  expect(prepared.job.workerInstructions).toHaveLength(1);

  await prepareButton.click();
  await expect(page.getByText(/Dispatch pack already retained/i)).toBeVisible();
  const repeatedResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(repeatedResponse.ok()).toBeTruthy();
  const repeated = await repeatedResponse.json();
  expect(repeated.job.routePlans).toHaveLength(1);
  expect(repeated.job.loadingPlans).toHaveLength(1);
  expect(repeated.job.procurementOrders).toHaveLength(1);
  expect(repeated.job.workerInstructions).toHaveLength(1);

  const procurementControl = dispatch.getByRole('button', { name: `Request procurement approval for ${intake.job.title}` });
  await expect(procurementControl).toBeVisible();
  await expect(dispatch.getByRole('button', { name: `Complete site orientation for ${intake.job.title}` })).toBeVisible();
  await expect(dispatch.getByRole('button', { name: `Approve JHA for ${intake.job.title}` })).toBeVisible();
  await procurementControl.click();
  const procurementModal = page.getByTestId('resource-control-modal');
  await expect(procurementModal.getByRole('heading', { name: 'Request procurement approval' })).toBeVisible();
  await expect(procurementModal.getByLabel('Trade partner')).toHaveValue(tradePartner.id);
  await expect(procurementModal.getByLabel('Trade partner').locator('option:checked')).toContainText(/Bouwmaat \/ verified/i);
  await expect(procurementModal.getByLabel('Order value (EUR)')).toHaveValue('28');
  await procurementModal.getByLabel('Internal evidence and notes').fill('Eight waste bags, supplier, retained unit price, and required date were verified for approval.');
  await procurementModal.getByRole('button', { name: 'Request procurement approval' }).click();
  await expect(page.getByText(/Procurement approval requested for.*No supplier order or spend commitment was made/i)).toBeVisible();

  const pendingProcurementResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  const pendingProcurementDetail = await pendingProcurementResponse.json();
  expect(pendingProcurementDetail.job.procurementOrders[0].status).toBe('pending_approval');

  await dispatch.getByRole('button', { name: `Complete site orientation for ${intake.job.title}` }).click();
  const orientationModal = page.getByTestId('field-assurance-modal');
  await expect(orientationModal.getByRole('heading', { name: 'Complete site orientation' })).toBeVisible();
  await orientationModal.getByRole('button', { name: 'Cancel' }).click();

  await dispatch.getByRole('button', { name: `Approve JHA for ${intake.job.title}` }).click();
  const jhaModal = page.getByTestId('field-assurance-modal');
  await expect(jhaModal.getByRole('heading', { name: 'Approve JHA' })).toBeVisible();
  await jhaModal.getByRole('button', { name: 'Cancel' }).click();

  const designControl = dispatch.getByRole('button', { name: `Answer RFI for ${intake.job.title}` });
  await designControl.click();
  const designModal = page.getByTestId('field-assurance-modal');
  await expect(designModal.getByRole('heading', { name: 'Answer RFI' })).toBeVisible();
  await designModal.getByLabel('Response and evidence').fill('Use retained boundary protection detail BP-02; engineer response and drawing reference were checked.');
  await designModal.getByRole('button', { name: 'Request approver review' }).click();
  await expect(page.getByText('Answer RFI retained for approver review. No field reliance or external commitment was made.')).toBeVisible();
  await expect(designControl).toHaveCount(0);

  const pendingRfiResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  const pendingRfiDetail = await pendingRfiResponse.json();
  expect(pendingRfiDetail.job.rfis.find(item => item.id === rfi.rfi.id).status).toBe('pending_approval');

  await dispatch.getByRole('button', { name: `Review approvals for ${intake.job.title}` }).click();
  const rfiApproval = page.locator('.approval-item').filter({ hasText: 'Approve RFI transition to answered' });
  await expect(rfiApproval).toHaveCount(1);
  await approveQueueItem(page, rfiApproval);

  const approvedRfiResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  const approvedRfiDetail = await approvedRfiResponse.json();
  expect(approvedRfiDetail.job.rfis.find(item => item.id === rfi.rfi.id).status).toBe('answered');

  await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
  await expect(page.getByTestId('dispatch-workspace').getByRole('button', { name: `Answer RFI for ${intake.job.title}` })).toHaveCount(0);
});

test('dispatch routes a live reserved-equipment blocker to the equipment directory', async ({ page, request }) => {
  const suffix = Date.now();
  const inspectedAt = new Date().toISOString().slice(0, 10);
  const nextDueAt = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const intake = await createBrowserJob(request, `Browser live equipment dispatch ${suffix}`, {
    status: 'scheduled',
    scheduledStart: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    assignAutomatically: false
  });
  const toolResponse = await request.post('/api/ledger/tools', {
    data: {
      name: `Browser reserved inspection lift ${suffix}`,
      category: 'access',
      status: 'available',
      currentLocation: 'Amsterdam depot',
      data: { inspectionRequired: true, inspectionDueAt: nextDueAt }
    }
  });
  expect(toolResponse.ok()).toBeTruthy();
  const tool = await toolResponse.json();
  const reservationResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/tools`, {
    data: { toolId: tool.tool.id, status: 'reserved' }
  });
  expect(reservationResponse.ok()).toBeTruthy();
  const failedResponse = await request.post(`/api/ledger/tools/${tool.tool.id}/inspections`, {
    data: {
      result: 'failed',
      inspector: 'Browser dispatch inspector',
      inspectedAt,
      reference: `BROWSER-DISPATCH-DEFECT-${suffix}`,
      notes: 'Guard defect requires maintenance and reinspection before dispatch.'
    }
  });
  expect(failedResponse.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
  const dispatch = page.getByTestId('dispatch-workspace');
  const dispatchRow = dispatch.locator('.dispatch-item').filter({ hasText: intake.job.title });
  await expect(dispatchRow).toContainText(/blocked/i);
  await expect(dispatchRow).toContainText(/blocker/i);
  const reviewEquipment = dispatchRow.getByRole('button', { name: `Review equipment for ${intake.job.title}` });
  await expect(reviewEquipment).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflows = await dispatch.evaluate(element => element.scrollWidth > element.clientWidth + 1);
  expect(overflows).toBeFalsy();
  await reviewEquipment.click();

  const resources = page.getByTestId('resources-workspace');
  await expect(resources.getByRole('tab', { name: 'Equipment' })).toHaveAttribute('aria-selected', 'true');
  const equipmentRow = page.getByTestId('equipment-directory').locator('.equipment-row').filter({ hasText: tool.tool.name });
  await expect(equipmentRow).toContainText(/inspection failed/i);
  await expect(equipmentRow.getByRole('button', { name: `Record maintenance for ${tool.tool.name}` })).toBeVisible();
});

test('dispatch routes a live unavailable-crew blocker to workforce readiness', async ({ page, request }) => {
  const suffix = Date.now();
  const scheduledStart = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const scheduledEnd = new Date(Date.now() + 7 * 86_400_000 + 6 * 3_600_000).toISOString();
  const intake = await createBrowserJob(request, `Browser live workforce dispatch ${suffix}`, {
    status: 'scheduled',
    scheduledStart,
    scheduledEnd,
    assignAutomatically: false
  });
  const workerResponse = await request.post('/api/ledger/workers', {
    data: {
      name: `Browser assigned leave crew ${suffix}`,
      role: 'Site carpenter',
      status: 'available',
      homeRegion: 'Amsterdam',
      skills: ['carpentry']
    }
  });
  expect(workerResponse.ok()).toBeTruthy();
  const worker = await workerResponse.json();
  const assignmentResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/assignments`, {
    data: { workerId: worker.worker.id, status: 'planned', scheduledStart, scheduledEnd }
  });
  expect(assignmentResponse.ok()).toBeTruthy();
  const leaveResponse = await request.put(`/api/ledger/workers/${worker.worker.id}`, {
    data: { status: 'on_leave' }
  });
  expect(leaveResponse.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
  const dispatch = page.getByTestId('dispatch-workspace');
  const dispatchRow = dispatch.locator('.dispatch-item').filter({ hasText: intake.job.title });
  await expect(dispatchRow).toContainText(/blocked/i);
  const reviewCrew = dispatchRow.getByRole('button', { name: `Review crew for ${intake.job.title}` });
  await expect(reviewCrew).toBeVisible();
  await reviewCrew.click();

  const resources = page.getByTestId('resources-workspace');
  await expect(resources.getByRole('tab', { name: 'Workforce' })).toHaveAttribute('aria-selected', 'true');
  const workforceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await expect(workforceRow).toContainText(/worker conflict/i);
  await expect(workforceRow).toContainText(/replace unavailable worker assignment/i);
  await expect(workforceRow.getByRole('button', { name: 'Plan resources' })).toBeVisible();
});

test('crew directory manages retained availability and approval-gated retirement', async ({ page, request }) => {
  const suffix = Date.now();
  const workerName = `Browser lifecycle crew ${suffix}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  const resources = page.getByTestId('resources-workspace');
  await resources.getByRole('tab', { name: 'Workforce' }).click();
  await resources.getByRole('tab', { name: 'Crew directory' }).click();

  const directory = page.getByTestId('worker-directory');
  await expect(directory).toBeVisible();
  await directory.getByRole('button', { name: 'Add crew member' }).click();

  let editor = page.getByTestId('worker-editor');
  await expect(editor.getByRole('heading', { name: 'Add crew member' })).toBeVisible();
  await expect(editor.getByLabel('Full name')).toBeFocused();
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(directory.getByRole('button', { name: 'Add crew member' })).toBeFocused();
  await directory.getByRole('button', { name: 'Add crew member' }).click();
  editor = page.getByTestId('worker-editor');
  await editor.getByLabel('Full name').fill(workerName);
  await editor.getByLabel('Role or trade').fill('Renovation carpenter');
  await editor.getByLabel('Email').fill(`browser-crew-${suffix}@example.test`);
  await editor.getByLabel('Home region').fill('Utrecht');
  await editor.getByLabel('Hourly cost rate (EUR)').fill('58.50');
  await editor.getByLabel('Skills').fill('carpentry, renovation, VCA');
  await editor.getByRole('button', { name: 'Save retained crew member' }).click();
  await expect(page.getByText(new RegExp(`${workerName} retained as available`, 'i'))).toBeVisible();

  let workerRow = directory.locator('.worker-row').filter({ hasText: workerName });
  await expect(workerRow).toContainText('Renovation carpenter');
  await expect(workerRow).toContainText('Utrecht');

  const workerListResponse = await request.get(`/api/ledger/workers?search=${encodeURIComponent(workerName)}&limit=100`);
  expect(workerListResponse.ok()).toBeTruthy();
  const workerList = await workerListResponse.json();
  const retainedWorker = workerList.workers.find(worker => worker.name === workerName);
  expect(retainedWorker).toBeTruthy();

  const dormantJob = await createBrowserJob(request, `Browser archived crew job ${suffix}`, {
    status: 'planned',
    assignAutomatically: false
  });
  const dormantAssignmentResponse = await request.post(`/api/ledger/jobs/${dormantJob.job.id}/assignments`, {
    data: { workerId: retainedWorker.id, status: 'planned' }
  });
  expect(dormantAssignmentResponse.ok()).toBeTruthy();
  const dormantAssignment = (await dormantAssignmentResponse.json()).assignment;
  await resolveAllPendingApprovals(request, dormantJob.job.id);
  const archiveRequest = await request.post(`/api/ledger/jobs/${dormantJob.job.id}/archive`, {
    data: { reason: 'Retain this browser fixture outside active operating queues.' }
  });
  expect(archiveRequest.ok()).toBeTruthy();
  const archiveApproval = (await archiveRequest.json()).approval;
  const archiveResolution = await request.post(`/api/ledger/approvals/${archiveApproval.id}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser archive approver', reason: 'Archived state and retained crew assignment verified.' }
  });
  expect(archiveResolution.ok()).toBeTruthy();

  await page.getByRole('button', { name: 'Refresh data' }).click();
  workerRow = directory.locator('.worker-row').filter({ hasText: workerName });
  await expect(workerRow).toContainText('Dormant assignments');
  await expect(workerRow).toContainText('1');
  await workerRow.getByRole('button', { name: `Edit ${workerName}` }).click();

  editor = page.getByTestId('worker-editor');
  await expect(editor.getByRole('heading', { name: `Edit ${workerName}` })).toBeVisible();
  await editor.getByLabel('Availability status').selectOption('on_leave');
  await editor.getByRole('button', { name: 'Save retained crew member' }).click();
  await expect(page.getByText(new RegExp(`${workerName} retained as on leave`, 'i'))).toBeVisible();

  await directory.getByRole('tab', { name: 'Unavailable' }).click();
  workerRow = directory.locator('.worker-row').filter({ hasText: workerName });
  await expect(workerRow).toContainText(/on leave/i);
  await workerRow.getByRole('button', { name: `Request retirement for ${workerName}` }).click();

  const retirementModal = page.getByTestId('worker-retirement-modal');
  await expect(retirementModal.getByRole('heading', { name: 'Request crew retirement' })).toBeVisible();
  await expect(retirementModal.getByLabel('Operational reason')).toBeFocused();
  await expect(retirementModal).toContainText('No operational assignments currently block this retirement.');
  await expect(retirementModal).toContainText('Approval will release 1 dormant assignment retained on inactive jobs');
  await retirementModal.getByLabel('Operational reason').fill('Crew member left the retained delivery pool after final handover.');
  await retirementModal.getByRole('button', { name: 'Request retirement approval' }).click();
  await expect(page.getByText(new RegExp(`Retirement approval requested for ${workerName}`, 'i'))).toBeVisible();

  workerRow = directory.locator('.worker-row').filter({ hasText: workerName });
  await expect(workerRow).toContainText(/retirement pending/i);
  await workerRow.getByRole('button', { name: 'Review retirement' }).click();
  const retirementApproval = page.locator('.approval-item').filter({ hasText: workerName });
  await expect(retirementApproval).toHaveCount(1);
  await approveQueueItem(page, retirementApproval, 'Browser QA verified the crew retirement record and assignment safeguards.');

  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await resources.getByRole('tab', { name: 'Workforce' }).click();
  await resources.getByRole('tab', { name: 'Crew directory' }).click();
  const refreshedDirectory = page.getByTestId('worker-directory');
  await refreshedDirectory.getByRole('tab', { name: 'Retired' }).click();
  const retiredRow = refreshedDirectory.locator('.worker-row').filter({ hasText: workerName });
  await expect(retiredRow).toContainText(/retired/i);
  await expect(retiredRow.getByRole('button', { name: `Edit ${workerName}` })).toHaveCount(0);

  const archivedJobResponse = await request.get(`/api/ledger/jobs/${dormantJob.job.id}`);
  expect(archivedJobResponse.ok()).toBeTruthy();
  const archivedJob = await archivedJobResponse.json();
  expect(archivedJob.job.assignments.find(item => item.id === dormantAssignment.id).status).toBe('released');
  const retiredWorkerResponse = await request.get(`/api/ledger/workers/${retainedWorker.id}`);
  const retiredWorker = await retiredWorkerResponse.json();
  expect(retiredWorker.worker.dormantAssignmentCount).toBe(0);
  expect(retiredWorker.worker.data.releasedDormantAssignmentIds).toContain(dormantAssignment.id);

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="resources-workspace"]');
    return {
      pageWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      workspaceWidth: workspace?.scrollWidth || 0,
      workspaceClientWidth: workspace?.clientWidth || 0
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.workspaceWidth).toBeLessThanOrEqual(geometry.workspaceClientWidth);
});

test('equipment directory manages retained condition and approval-gated retirement', async ({ page, request }) => {
  const suffix = Date.now();
  const equipmentName = `Browser lifecycle site laser ${suffix}`;
  const inspectedAt = new Date().toISOString().slice(0, 10);
  const nextInspectionDue = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  await page.goto('/');
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  let resources = page.getByTestId('resources-workspace');
  await resources.getByRole('tab', { name: 'Equipment' }).click();

  let directory = page.getByTestId('equipment-directory');
  await expect(directory).toBeVisible();
  await directory.getByRole('button', { name: 'Add equipment' }).click();

  let editor = page.getByTestId('equipment-editor');
  await expect(editor.getByRole('heading', { name: 'Add equipment' })).toBeVisible();
  await expect(editor.getByLabel('Equipment name')).toBeFocused();
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(directory.getByRole('button', { name: 'Add equipment' })).toBeFocused();
  await directory.getByRole('button', { name: 'Add equipment' }).click();

  editor = page.getByTestId('equipment-editor');
  await editor.getByLabel('Equipment name').fill(equipmentName);
  await editor.getByLabel('Category').fill('measurement');
  await editor.getByLabel('Home location').fill('Utrecht depot');
  await editor.getByLabel('Current location').fill('Utrecht depot');
  await editor.getByLabel('Serial or asset reference').fill(`LASER-${suffix}`);
  await editor.getByLabel('Inspection required before reservation').check();
  await editor.getByLabel('Inspection due', { exact: true }).fill(nextInspectionDue);
  await editor.getByRole('button', { name: 'Save retained equipment' }).click();
  await expect(page.getByText(new RegExp(`${equipmentName} retained as available`, 'i'))).toBeVisible();

  let equipmentRow = directory.locator('.equipment-row').filter({ hasText: equipmentName });
  await expect(equipmentRow).toContainText('measurement');
  await expect(equipmentRow).toContainText('Utrecht depot');
  await expect(equipmentRow).toContainText(/inspection current/i);

  const listResponse = await request.get(`/api/ledger/tools?search=${encodeURIComponent(equipmentName)}&limit=100`);
  expect(listResponse.ok()).toBeTruthy();
  const list = await listResponse.json();
  const retainedEquipment = list.tools.find(tool => tool.name === equipmentName);
  expect(retainedEquipment).toBeTruthy();
  expect(retainedEquipment.data.serialNumber).toBe(`LASER-${suffix}`);
  expect(retainedEquipment.inspection.status).toBe('current');

  await equipmentRow.getByRole('button', { name: `Record inspection for ${equipmentName}` }).click();
  let inspectionModal = page.getByTestId('equipment-inspection-modal');
  await expect(inspectionModal.getByRole('heading', { name: 'Record equipment inspection' })).toBeVisible();
  await expect(inspectionModal.getByLabel('Inspection result')).toBeFocused();
  await inspectionModal.getByRole('button', { name: 'Cancel' }).click();
  await expect(equipmentRow.getByRole('button', { name: `Record inspection for ${equipmentName}` })).toBeFocused();

  await equipmentRow.getByRole('button', { name: `Record inspection for ${equipmentName}` }).click();
  inspectionModal = page.getByTestId('equipment-inspection-modal');
  await inspectionModal.getByLabel('Inspector or internal reference').fill('Browser QA inspector');
  await inspectionModal.getByLabel('Inspection date').fill(inspectedAt);
  await inspectionModal.getByLabel('Next inspection due').fill(nextInspectionDue);
  await inspectionModal.getByLabel('Evidence reference').fill(`BROWSER-CHECK-${suffix}`);
  await inspectionModal.getByLabel('Findings').fill('Internal operational inspection completed without defects.');
  await inspectionModal.getByRole('button', { name: 'Record inspection' }).click();
  await expect(page.getByText(new RegExp(`${equipmentName} inspection retained as passed`, 'i'))).toBeVisible();
  equipmentRow = directory.locator('.equipment-row').filter({ hasText: equipmentName });
  await expect(equipmentRow).toContainText(/passed/i);

  await equipmentRow.getByRole('button', { name: `Record inspection for ${equipmentName}` }).click();
  inspectionModal = page.getByTestId('equipment-inspection-modal');
  await inspectionModal.getByLabel('Inspection result').selectOption('failed');
  await inspectionModal.getByLabel('Inspector or internal reference').fill('Browser QA inspector');
  await inspectionModal.getByLabel('Inspection date').fill(inspectedAt);
  await inspectionModal.getByLabel('Evidence reference').fill(`BROWSER-DEFECT-${suffix}`);
  await inspectionModal.getByLabel('Findings').fill('Housing damage requires maintenance before the next reservation.');
  await inspectionModal.getByRole('button', { name: 'Record inspection' }).click();
  await expect(page.getByText(new RegExp(`${equipmentName} inspection retained as failed`, 'i'))).toBeVisible();
  await directory.getByRole('tab', { name: 'Attention' }).click();
  equipmentRow = directory.locator('.equipment-row').filter({ hasText: equipmentName });
  await expect(equipmentRow).toContainText(/inspection failed/i);
  await expect(equipmentRow).toContainText(/maintenance/i);

  await equipmentRow.getByRole('button', { name: `Record maintenance for ${equipmentName}` }).click();
  let maintenanceModal = page.getByTestId('equipment-maintenance-modal');
  await expect(maintenanceModal.getByRole('heading', { name: 'Record equipment maintenance' })).toBeVisible();
  await expect(maintenanceModal.getByLabel('Maintenance outcome')).toBeFocused();
  await maintenanceModal.getByRole('button', { name: 'Cancel' }).click();
  await expect(equipmentRow.getByRole('button', { name: `Record maintenance for ${equipmentName}` })).toBeFocused();

  await equipmentRow.getByRole('button', { name: `Record maintenance for ${equipmentName}` }).click();
  maintenanceModal = page.getByTestId('equipment-maintenance-modal');
  await maintenanceModal.getByLabel('Maintenance type').selectOption('corrective');
  await maintenanceModal.getByLabel('Maintenance date').fill(inspectedAt);
  await maintenanceModal.getByLabel('Person or internal reference').fill('Browser QA technician');
  await maintenanceModal.getByLabel('Evidence reference').fill(`BROWSER-WORK-${suffix}`);
  await maintenanceModal.getByLabel('Work performed').fill('Damaged housing was replaced and an internal function check completed.');
  await maintenanceModal.getByRole('button', { name: 'Record maintenance' }).click();
  await expect(page.getByText(new RegExp(`${equipmentName} maintenance retained as completed`, 'i'))).toBeVisible();
  equipmentRow = directory.locator('.equipment-row').filter({ hasText: equipmentName });
  await expect(equipmentRow).toContainText(/inspection reinspection required/i);
  await expect(equipmentRow).toContainText(/last maintenance/i);
  await expect(equipmentRow).toContainText(/completed/i);

  await equipmentRow.getByRole('button', { name: `Record inspection for ${equipmentName}` }).click();
  inspectionModal = page.getByTestId('equipment-inspection-modal');
  await expect(inspectionModal).toContainText('Completed maintenance is retained; record a passing reinspection before reservation readiness can return.');
  await inspectionModal.getByLabel('Inspector or internal reference').fill('Browser QA inspector');
  await inspectionModal.getByLabel('Inspection date').fill(inspectedAt);
  await inspectionModal.getByLabel('Next inspection due').fill(nextInspectionDue);
  await inspectionModal.getByLabel('Evidence reference').fill(`BROWSER-RECHECK-${suffix}`);
  await inspectionModal.getByLabel('Findings').fill('Maintenance completed and internal operational recheck passed.');
  await inspectionModal.getByRole('button', { name: 'Record inspection' }).click();
  await expect(page.getByText(new RegExp(`${equipmentName} inspection retained as passed`, 'i'))).toBeVisible();

  await expect(equipmentRow).toHaveCount(0);
  await directory.getByRole('tab', { name: 'Active' }).click();
  equipmentRow = directory.locator('.equipment-row').filter({ hasText: equipmentName });
  await expect(equipmentRow).toContainText(/inspection current/i);
  await equipmentRow.getByRole('button', { name: `Edit ${equipmentName}` }).click();
  editor = page.getByTestId('equipment-editor');
  await editor.getByLabel('Operational status').selectOption('maintenance');
  await editor.getByLabel('Current location').fill('Service bench 2');
  await editor.getByRole('button', { name: 'Save retained equipment' }).click();
  await expect(page.getByText(new RegExp(`${equipmentName} retained as maintenance`, 'i'))).toBeVisible();

  equipmentRow = directory.locator('.equipment-row').filter({ hasText: equipmentName });
  await expect(equipmentRow).toContainText(/maintenance/i);
  await expect(equipmentRow).toContainText('Service bench 2');
  await equipmentRow.getByRole('button', { name: `Edit ${equipmentName}` }).click();
  editor = page.getByTestId('equipment-editor');
  await editor.getByLabel('Operational status').selectOption('available');
  await editor.getByRole('button', { name: 'Save retained equipment' }).click();
  await directory.getByRole('tab', { name: 'Active' }).click();

  equipmentRow = directory.locator('.equipment-row').filter({ hasText: equipmentName });
  await equipmentRow.getByRole('button', { name: `Request retirement for ${equipmentName}` }).click();
  const retirementModal = page.getByTestId('equipment-retirement-modal');
  await expect(retirementModal.getByRole('heading', { name: 'Request equipment retirement' })).toBeVisible();
  await expect(retirementModal.getByLabel('Operational reason')).toBeFocused();
  await expect(retirementModal).toContainText('No operational reservations currently block this retirement.');
  await retirementModal.getByLabel('Operational reason').fill('Equipment was removed from service after its retained inspection review.');
  await retirementModal.getByRole('button', { name: 'Request retirement approval' }).click();
  await expect(page.getByText(new RegExp(`Retirement approval requested for ${equipmentName}`, 'i'))).toBeVisible();

  equipmentRow = directory.locator('.equipment-row').filter({ hasText: equipmentName });
  await expect(equipmentRow).toContainText(/retirement pending/i);
  await equipmentRow.getByRole('button', { name: 'Review retirement' }).click();
  const retirementApproval = page.locator('.approval-item').filter({ hasText: equipmentName });
  await expect(retirementApproval).toHaveCount(1);
  await approveQueueItem(page, retirementApproval, 'Browser QA verified the equipment retirement record and reservation safeguards.');

  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  resources = page.getByTestId('resources-workspace');
  await resources.getByRole('tab', { name: 'Equipment' }).click();
  directory = page.getByTestId('equipment-directory');
  await directory.getByRole('tab', { name: 'Retired' }).click();
  const retiredRow = directory.locator('.equipment-row').filter({ hasText: equipmentName });
  await expect(retiredRow).toContainText(/retired/i);
  await expect(retiredRow.getByRole('button', { name: `Edit ${equipmentName}` })).toHaveCount(0);

  const retiredResponse = await request.get('/api/ledger/tools?status=retired&limit=500');
  expect(retiredResponse.ok()).toBeTruthy();
  const retiredDirectory = await retiredResponse.json();
  const retiredEquipment = retiredDirectory.tools.find(tool => tool.id === retainedEquipment.id);
  expect(retiredEquipment?.activeReservationCount).toBe(0);
  expect(retiredEquipment?.data.inspectionHistory).toHaveLength(3);
  expect(retiredEquipment?.data.maintenanceHistory).toHaveLength(1);
  expect(retiredEquipment?.inspection.lastResult).toBe('passed');
  const auditResponse = await request.get(`/api/ledger/audit?entityId=${encodeURIComponent(retainedEquipment.id)}&limit=100`);
  expect(auditResponse.ok()).toBeTruthy();
  const audit = await auditResponse.json();
  expect(audit.events.some(event => event.action === 'apply_tool_retirement' && event.metadata.externalCommitments === 0)).toBeTruthy();
  expect(audit.events.filter(event => event.action === 'record_tool_inspection')).toHaveLength(3);
  expect(audit.events.filter(event => event.action === 'record_tool_inspection').every(event => event.metadata.certificationClaimed === false && event.metadata.externalCommitments === 0)).toBeTruthy();
  expect(audit.events.filter(event => event.action === 'record_tool_maintenance')).toHaveLength(1);
  expect(audit.events.find(event => event.action === 'record_tool_maintenance')?.metadata).toMatchObject({ supplierSpend: 0, externalCommitments: 0 });

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="resources-workspace"]');
    return {
      pageWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      workspaceWidth: workspace?.scrollWidth || 0,
      workspaceClientWidth: workspace?.clientWidth || 0
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.workspaceWidth).toBeLessThanOrEqual(geometry.workspaceClientWidth);
});

test('trade partner directory retains compliance evidence and approval-gated retirement', async ({ page }) => {
  const partnerName = `Browser lifecycle supplier ${Date.now()}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  const resources = page.getByTestId('resources-workspace');
  await resources.getByRole('tab', { name: 'Trade partners' }).click();
  const directory = page.getByTestId('trade-partner-directory');
  await expect(directory).toBeVisible();
  await directory.getByRole('button', { name: 'Add trade partner' }).click();

  let editor = page.getByTestId('trade-partner-editor');
  await expect(editor.getByRole('heading', { name: 'Add trade partner' })).toBeVisible();
  await editor.getByLabel('Legal or trading name').fill(partnerName);
  await editor.getByLabel('Contact name').fill('Browser QA Buyer');
  await editor.getByLabel('Email').fill('browser-partner@example.test');
  await editor.getByLabel('Specialties').fill('insulation, fixings');
  await editor.getByRole('button', { name: 'Save retained partner' }).click();
  await expect(page.getByText(new RegExp(`${partnerName} retained with needs review`, 'i'))).toBeVisible();

  let partnerRow = directory.locator('.trade-partner-row').filter({ hasText: partnerName });
  await expect(partnerRow).toContainText(/needs review/i);
  await expect(partnerRow).toContainText('Missing');
  await partnerRow.getByRole('button', { name: `Edit ${partnerName}` }).click();

  editor = page.getByTestId('trade-partner-editor');
  await expect(editor.getByRole('heading', { name: `Edit ${partnerName}` })).toBeVisible();
  await editor.getByLabel('Registration / KVK').fill('44556677');
  await editor.getByLabel('VAT number').fill('NL123456789B01');
  await editor.getByLabel('Verification reference').fill('BROWSER-PARTNER-EVIDENCE-001');
  await editor.getByRole('button', { name: 'Save retained partner' }).click();
  await expect(page.getByText(new RegExp(`${partnerName} retained with verified`, 'i'))).toBeVisible();
  partnerRow = directory.locator('.trade-partner-row').filter({ hasText: partnerName });
  await expect(partnerRow).toContainText(/verified/i);
  await expect(partnerRow).toContainText('44556677');

  await partnerRow.getByRole('button', { name: `Request retirement for ${partnerName}` }).click();
  const retirementModal = page.getByTestId('trade-partner-retirement-modal');
  await expect(retirementModal.getByRole('heading', { name: 'Request partner retirement' })).toBeVisible();
  await retirementModal.getByLabel('Operational reason').fill('Supplier was removed from the approved purchasing list.');
  await retirementModal.getByRole('button', { name: 'Request retirement approval' }).click();
  await expect(page.getByText(new RegExp(`Retirement approval requested for ${partnerName}`, 'i'))).toBeVisible();

  partnerRow = directory.locator('.trade-partner-row').filter({ hasText: partnerName });
  await partnerRow.getByRole('button', { name: 'Review retirement' }).click();
  const retirementApproval = page.locator('.approval-item').filter({ hasText: partnerName });
  await expect(retirementApproval).toHaveCount(1);
  await approveQueueItem(page, retirementApproval, 'Browser QA reviewed retirement retention and purchasing safeguards.');

  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await resources.getByRole('tab', { name: 'Trade partners' }).click();
  const refreshedDirectory = page.getByTestId('trade-partner-directory');
  await refreshedDirectory.getByRole('tab', { name: 'Retired' }).click();
  const retiredRow = refreshedDirectory.locator('.trade-partner-row').filter({ hasText: partnerName });
  await expect(retiredRow).toContainText(/blocked/i);
  await expect(retiredRow.getByRole('button', { name: `Edit ${partnerName}` })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="resources-workspace"]');
    return {
      pageWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      workspaceWidth: workspace?.scrollWidth || 0,
      workspaceClientWidth: workspace?.clientWidth || 0
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.workspaceWidth).toBeLessThanOrEqual(geometry.workspaceClientWidth);
});

test('resources workspace coordinates crew and inventory through retained approval-safe records', async ({ page, request }) => {
  const tradePartner = await ensureVerifiedTradePartner(request);
  const workerResponse = await request.post('/api/ledger/workers', {
    data: { name: 'Browser resource crew lead', role: 'Renovation lead', status: 'available', homeRegion: 'Amsterdam' }
  });
  expect(workerResponse.ok()).toBeTruthy();
  const worker = await workerResponse.json();
  const intake = await createBrowserJob(request, 'Browser resource readiness job', {
    service: 'Renovation',
    status: 'in_progress',
    progressPercent: 60,
    scheduledStart: '2026-07-18T08:00:00.000Z',
    scheduledEnd: '2026-07-18T14:00:00.000Z',
    assignAutomatically: false,
    materials: [{
      name: 'Browser resource adhesive',
      quantity: 6,
      unit: 'tubes',
      status: 'needed',
      supplier: 'Bouwmaat',
      cost: 14,
      neededBy: '2026-07-17'
    }]
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  const resources = page.getByTestId('resources-workspace');
  await expect(resources.getByRole('heading', { name: 'Resource readiness', exact: true })).toBeVisible();
  await expect(resources.getByRole('tab', { name: 'Workforce' })).toHaveAttribute('aria-selected', 'true');
  let resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await expect(resourceRow.getByRole('heading', { name: intake.job.title })).toBeVisible();
  await resourceRow.getByRole('button', { name: 'Plan resources' }).click();

  const planner = page.getByTestId('resource-planner');
  await expect(planner).toBeVisible();
  await planner.getByLabel('Crew member').selectOption(worker.worker.id);
  await planner.getByRole('button', { name: 'Add crew assignment' }).click();
  await expect(page.getByText('Crew assignment was added to the internal work plan.')).toBeVisible();
  await planner.getByRole('button', { name: 'Close resource planner' }).click();
  await page.getByTestId('job-workspace').getByRole('button', { name: 'Close job workspace' }).click();

  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: `Draft crew instructions for ${intake.job.title}` }).click();
  await expect(page.getByText('Internal crew instructions were drafted. Nothing was published or delivered.')).toBeVisible();

  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: `Orientation evidence for ${intake.job.title}` }).click();
  let resourceModal = page.getByTestId('resource-control-modal');
  await expect(resourceModal.getByRole('heading', { name: 'Orientation evidence' })).toBeVisible();
  await resourceModal.getByLabel('Orientation verification reference').fill('BROWSER-ORIENTATION-001');
  await resourceModal.getByLabel('Internal evidence and notes').fill('Crew lead reviewed PPE, site rules, emergency response, and stop-work authority.');
  await resourceModal.getByRole('button', { name: 'Request orientation approval' }).click();
  await expect(page.getByText('Orientation completion evidence retained for approval. Site access remains blocked until review.')).toBeVisible();

  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await expect(resourceRow.getByRole('button', { name: 'Review approval' })).toBeVisible();
  await expect(resourceRow.getByRole('button', { name: `Record time for ${intake.job.title}` })).toHaveCount(0);
  await resourceRow.getByRole('button', { name: 'Review approval' }).click();

  const orientationApproval = page.locator('.approval-item').filter({ hasText: /orientation/i });
  await expect(orientationApproval).toHaveCount(1);
  await approveQueueItem(page, orientationApproval);

  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await expect(resourceRow.getByRole('button', { name: `Record time for ${intake.job.title}` })).toHaveCount(0);
  await resourceRow.getByRole('button', { name: `Site-access gate for ${intake.job.title}` }).click();
  resourceModal = page.getByTestId('resource-control-modal');
  await expect(resourceModal.getByRole('heading', { name: 'Site-access gate' })).toBeVisible();
  await resourceModal.getByLabel('Internal evidence and notes').fill('The approved orientation was matched to this assignment; physical access remains blocked for approval.');
  await resourceModal.getByRole('button', { name: 'Create access gate' }).click();
  await expect(page.getByText('The assignment-scoped site-access gate was retained. Clearance still requires explicit approval.')).toBeVisible();

  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: `Request site-access clearance for ${intake.job.title}` }).click();
  const accessModal = page.getByTestId('field-assurance-modal');
  await expect(accessModal.getByRole('heading', { name: 'Request site-access clearance' })).toBeVisible();
  await accessModal.getByLabel('Evidence and decision').fill('Crew identity, approved assignment orientation, access point, and current job window were verified.');
  await accessModal.getByRole('button', { name: 'Request approver review' }).click();

  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: 'Review approval' }).click();
  const accessApproval = page.locator('.approval-item').filter({ hasText: /site access/i });
  await expect(accessApproval).toHaveCount(1);
  await approveQueueItem(page, accessApproval);

  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: `Review and request instruction approval for ${intake.job.title}` }).click();
  const instructionModal = page.getByTestId('field-assurance-modal');
  await instructionModal.getByLabel('Evidence and decision').fill('Crew scope, route, tools, PPE, access controls, and stop-work instructions were reviewed for publication.');
  await instructionModal.getByRole('button', { name: 'Request approver review' }).click();
  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: 'Review approval' }).click();
  const instructionApproval = page.locator('.approval-item').filter({ hasText: /worker instruction/i });
  await expect(instructionApproval).toHaveCount(1);
  await approveQueueItem(page, instructionApproval);

  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: `Record time for ${intake.job.title}` }).click();
  resourceModal = page.getByTestId('resource-control-modal');
  await expect(resourceModal.getByRole('heading', { name: 'Record time' })).toBeVisible();
  await resourceModal.getByLabel('Hours').fill('6');
  await resourceModal.getByLabel('Time evidence reference').fill('BROWSER-TIME-001');
  await resourceModal.getByLabel('Internal evidence and notes').fill('Crew lead confirmed six productive hours against the retained field progress.');
  await resourceModal.getByRole('button', { name: 'Record internal evidence' }).click();
  await expect(page.getByText('Worker time was recorded in the retained job ledger.')).toBeVisible();

  await resources.getByRole('tab', { name: 'Inventory' }).click();
  await expect(resources.getByRole('tab', { name: 'Inventory' })).toHaveAttribute('aria-selected', 'true');
  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: `Prepare loading checklist for ${intake.job.title}` }).click();
  await expect(page.getByText(/Loading checklist retained with 1 item.*No vehicle or dispatch commitment was made/i)).toBeVisible();

  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: `Draft procurement for ${intake.job.title}` }).click();
  await expect(page.getByText(/Procurement draft retained.*Approval is required before supplier commitment/i)).toBeVisible();

  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await expect(resourceRow.getByRole('button', { name: `Confirm material for ${intake.job.title}` })).toHaveCount(0);
  await resourceRow.getByRole('button', { name: 'Review approval' }).click();
  const procurementApproval = page.locator('.approval-item').filter({ hasText: /procurement/i });
  await expect(procurementApproval).toHaveCount(1);
  await approveQueueItem(page, procurementApproval);

  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await resources.getByRole('tab', { name: 'Inventory' }).click();
  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: `Confirm material for ${intake.job.title}` }).click();
  resourceModal = page.getByTestId('resource-control-modal');
  await expect(resourceModal.getByRole('heading', { name: 'Confirm material' })).toBeVisible();
  await resourceModal.getByLabel('Storage or job location').fill('Warehouse browser bay A-3');
  await resourceModal.getByLabel('Verification reference').fill('BROWSER-MATERIAL-001');
  await resourceModal.getByLabel('Internal evidence and notes').fill('Six sealed adhesive tubes were counted and reserved for this job.');

  await page.setViewportSize({ width: 390, height: 844 });
  const modalGeometry = await page.evaluate(() => {
    const modal = document.querySelector('[data-testid="resource-control-modal"]');
    return {
      viewportWidth: window.innerWidth,
      left: modal?.getBoundingClientRect().left || 0,
      right: modal?.getBoundingClientRect().right || 0,
      scrollWidth: modal?.scrollWidth || 0,
      clientWidth: modal?.clientWidth || 0
    };
  });
  expect(modalGeometry.left).toBeGreaterThanOrEqual(0);
  expect(modalGeometry.right).toBeLessThanOrEqual(modalGeometry.viewportWidth);
  expect(modalGeometry.scrollWidth).toBeLessThanOrEqual(modalGeometry.clientWidth);

  await resourceModal.getByRole('button', { name: 'Record internal evidence' }).click();
  await expect(page.getByText(/available material evidence retained.*No supplier order or spend commitment was made/i)).toBeVisible();

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  expect(detail.job.assignments).toEqual(expect.arrayContaining([
    expect.objectContaining({ workerId: worker.worker.id, status: 'planned' })
  ]));
  expect(detail.job.workerInstructions).toHaveLength(1);
  expect(detail.job.workerInstructions[0]).toMatchObject({ audience: 'crew', channel: 'app', status: 'approved' });
  expect(detail.job.orientations).toHaveLength(1);
  expect(detail.job.orientations[0]).toMatchObject({ status: 'completed', workerName: 'Browser resource crew lead' });
  expect(detail.job.orientations[0].data.verificationReference).toBe('BROWSER-ORIENTATION-001');
  expect(detail.job.siteAccessLogs).toHaveLength(1);
  expect(detail.job.siteAccessLogs[0]).toMatchObject({ status: 'cleared', workerId: worker.worker.id, assignmentId: detail.job.assignments[0].id });
  expect(detail.job.siteAccessLogs[0].orientationId).toBe(detail.job.orientations[0].id);
  expect(detail.job.timeLogs).toHaveLength(1);
  expect(detail.job.timeLogs[0]).toMatchObject({ workerId: worker.worker.id, hours: 6, status: 'submitted' });
  expect(detail.job.timeLogs[0].data.verificationReference).toBe('BROWSER-TIME-001');
  expect(detail.job.materials).toHaveLength(1);
  expect(detail.job.materials[0]).toMatchObject({ status: 'available' });
  expect(detail.job.materials[0].data).toMatchObject({ availableQuantity: 6, location: 'Warehouse browser bay A-3', verificationReference: 'BROWSER-MATERIAL-001' });
  expect(detail.job.materials[0].data.lastStatusTransition.externalCommitments).toBe(0);
  expect(detail.job.procurementOrders).toHaveLength(1);
  expect(detail.job.procurementOrders[0]).toMatchObject({ status: 'approved', amount: 84 });
  expect(detail.job.procurementOrders[0]).toMatchObject({ tradePartnerId: tradePartner.id });
  expect(detail.job.procurementOrders[0].partnerComplianceSnapshot).toMatchObject({ complianceStatus: 'verified', compliant: true });
  expect(detail.job.procurementOrders[0].approvalId).toBeTruthy();
  expect(detail.job.loadingPlans).toHaveLength(1);
  expect(detail.job.loadingPlans[0].data.readiness).toMatchObject({ externalCommitments: 0, approvalSafe: true });

  const approvalsResponse = await request.get('/api/ledger/approvals?status=all&limit=100');
  expect(approvalsResponse.ok()).toBeTruthy();
  const approvals = await approvalsResponse.json();
  expect(approvals.approvals).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: detail.job.procurementOrders[0].approvalId, targetType: 'procurement_order', approvalType: 'procurement_spend', status: 'approved' }),
    expect.objectContaining({ id: detail.job.orientations[0].approvalId, targetType: 'worker_orientation', status: 'approved' })
  ]));
  await expect(resourceRow.getByRole('button', { name: `Draft procurement for ${intake.job.title}` })).toHaveCount(0);
  await expect(resourceRow.getByRole('button', { name: `Prepare loading checklist for ${intake.job.title}` })).toHaveCount(0);
  await expect(resourceRow.getByRole('button', { name: `Confirm material for ${intake.job.title}` })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileGeometry = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="resources-workspace"]');
    return {
      pageWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      workspaceWidth: workspace?.scrollWidth || 0,
      workspaceClientWidth: workspace?.clientWidth || 0
    };
  });
  expect(mobileGeometry.pageWidth).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
  expect(mobileGeometry.workspaceWidth).toBeLessThanOrEqual(mobileGeometry.workspaceClientWidth);
});

test('field assurance prepares internal safety records and gates an RFI answer', async ({ page, request }) => {
  const safetyJob = await createBrowserJob(request, 'Browser field safety pack job', {
    service: 'Bathroom renovation',
    status: 'in_progress',
    progressPercent: 20,
    assignAutomatically: false
  });
  const rfiJob = await createBrowserJob(request, 'Browser field RFI review job', {
    service: 'Structural repair',
    status: 'in_progress',
    progressPercent: 35,
    assignAutomatically: false
  });
  const accessJob = await createBrowserJob(request, 'Browser field access gate job', {
    service: 'Commercial fit-out',
    status: 'in_progress',
    progressPercent: 10,
    assignAutomatically: false
  });
  const orientationResponse = await request.post(`/api/ledger/jobs/${accessJob.job.id}/orientations`, {
    data: {
      workerName: 'Browser access worker',
      company: 'Browser QA Crew',
      status: 'scheduled',
      topics: ['Site rules', 'Emergency controls']
    }
  });
  expect(orientationResponse.ok()).toBeTruthy();
  const orientation = await orientationResponse.json();
  const accessResponse = await request.post(`/api/ledger/jobs/${accessJob.job.id}/site-access`, {
    data: {
      orientationId: orientation.orientation.id,
      workerName: 'Browser access worker',
      company: 'Browser QA Crew',
      status: 'blocked',
      orientationValid: false
    }
  });
  expect(accessResponse.ok()).toBeTruthy();
  const rfiSafetyResponse = await request.post(`/api/ledger/jobs/${rfiJob.job.id}/field-assurance-pack`, { data: {} });
  expect(rfiSafetyResponse.ok()).toBeTruthy();
  const rfiResponse = await request.post(`/api/ledger/jobs/${rfiJob.job.id}/rfis`, {
    data: {
      title: 'Confirm substrate fixing method',
      status: 'open',
      question: 'Which fixing method is approved for the retained substrate?'
    }
  });
  expect(rfiResponse.ok()).toBeTruthy();
  const rfi = await rfiResponse.json();

  const documentJob = await createBrowserJob(request, 'Browser controlled document review job', {
    service: 'Design review',
    status: 'intake',
    progressPercent: 0,
    assignAutomatically: false
  });
  const documentResponse = await request.post(`/api/ledger/jobs/${documentJob.job.id}/documents`, {
    data: {
      type: 'drawing',
      title: 'Browser fixing detail revision 3',
      filename: 'browser-fixing-r3.pdf',
      storageRef: 'browser-controlled/browser-fixing-r3.pdf',
      status: 'needs_review'
    }
  });
  expect(documentResponse.ok()).toBeTruthy();
  const controlledDocument = await documentResponse.json();

  const punchJob = await createBrowserJob(request, 'Browser field punch review job', {
    service: 'Quality review',
    status: 'intake',
    progressPercent: 0,
    assignAutomatically: false
  });
  const punchResponse = await request.post(`/api/ledger/jobs/${punchJob.job.id}/punch-items`, {
    data: {
      title: 'Re-seat browser cabinet hinge',
      status: 'open',
      severity: 'medium',
      dueAt: '2026-07-10T12:00:00.000Z'
    }
  });
  expect(punchResponse.ok()).toBeTruthy();
  const punch = await punchResponse.json();

  await page.goto('/');
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  const fieldWorkspace = page.getByTestId('field-workspace');
  const assurance = page.getByTestId('field-assurance-workspace');
  await expect(fieldWorkspace).toBeVisible();
  await expect(assurance.getByRole('heading', { name: 'Assurance queue' })).toBeVisible();

  let documentRow = assurance.locator('.assurance-item').filter({ hasText: documentJob.job.title });
  await documentRow.getByRole('button', { name: `Approve document review for ${documentJob.job.title}` }).click();
  const documentModal = page.getByTestId('field-assurance-modal');
  await expect(documentModal.getByRole('heading', { name: 'Approve document review' })).toBeVisible();
  await documentModal.getByLabel('Document review reference').fill('BROWSER-DOC-REVIEW-003');
  await documentModal.getByLabel('Evidence and decision').fill('Revision number, fixing dimensions, retained storage reference, and issue status were checked against the job scope.');
  await documentModal.getByRole('button', { name: 'Request approver review' }).click();
  await expect(page.getByText('Approve document review retained for approver review. No field reliance or external commitment was made.')).toBeVisible();

  const punchRow = assurance.locator('.assurance-item').filter({ hasText: punchJob.job.title });
  await punchRow.getByRole('button', { name: `Resolve punch item for ${punchJob.job.title}` }).click();
  const punchModal = page.getByTestId('field-assurance-modal');
  await expect(punchModal.getByRole('heading', { name: 'Resolve punch item' })).toBeVisible();
  await punchModal.getByLabel('Evidence and decision').fill('Hinge was re-seated, aligned, cycle-tested, and photographed for closeout review.');
  await punchModal.getByRole('button', { name: 'Request approver review' }).click();
  await expect(page.getByText('Resolve punch item retained for approver review. No field reliance or external commitment was made.')).toBeVisible();

  let accessRow = assurance.locator('.assurance-item').filter({ hasText: accessJob.job.title });
  await expect(accessRow.getByRole('button', { name: `Complete orientation for ${accessJob.job.title}` })).toBeVisible();
  await expect(accessRow.getByRole('button', { name: `Clear site access for ${accessJob.job.title}` })).toHaveCount(0);
  await accessRow.getByRole('button', { name: `Complete orientation for ${accessJob.job.title}` }).click();
  const orientationModal = page.getByTestId('field-assurance-modal');
  await expect(orientationModal.getByRole('heading', { name: 'Complete orientation' })).toBeVisible();
  await orientationModal.getByLabel('Verification reference').fill('INDUCTION-BROWSER-001');
  await orientationModal.getByLabel('Evidence and decision').fill('Site rules, emergency arrangements, PPE boundaries, and access restrictions were reviewed with the named worker.');
  await orientationModal.getByRole('button', { name: 'Request approver review' }).click();
  await expect(page.getByText('Complete orientation retained for approver review. No field reliance or external commitment was made.')).toBeVisible();

  const orientationDetailResponse = await request.get(`/api/ledger/jobs/${accessJob.job.id}`);
  expect(orientationDetailResponse.ok()).toBeTruthy();
  const orientationDetail = await orientationDetailResponse.json();
  const orientationApproval = orientationDetail.job.approvals.find(approval => (
    approval.targetType === 'worker_orientation' && approval.status === 'pending'
  ));
  expect(orientationApproval).toBeTruthy();
  const orientationApprovalResponse = await request.post(`/api/ledger/approvals/${orientationApproval.id}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Browser field approver',
      reason: 'Orientation evidence verified before access clearance.'
    }
  });
  expect(orientationApprovalResponse.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh data' }).click();
  accessRow = assurance.locator('.assurance-item').filter({ hasText: accessJob.job.title });
  await expect(accessRow.getByRole('button', { name: `Clear site access for ${accessJob.job.title}` })).toBeVisible();
  await accessRow.getByRole('button', { name: `Clear site access for ${accessJob.job.title}` }).click();
  const accessModal = page.getByTestId('field-assurance-modal');
  await expect(accessModal.getByRole('heading', { name: 'Clear site access' })).toBeVisible();
  await accessModal.getByLabel('Evidence and decision').fill('Approved orientation is linked to this worker; identity, company, access point, and site restrictions were checked.');
  await accessModal.getByRole('button', { name: 'Request approver review' }).click();
  await expect(page.getByText('Clear site access retained for approver review. No field reliance or external commitment was made.')).toBeVisible();

  let safetyRow = assurance.locator('.assurance-item').filter({ hasText: safetyJob.job.title });
  await safetyRow.getByRole('button', { name: `Prepare safety pack for ${safetyJob.job.title}` }).click();
  await expect(page.getByText('Internal safety pack retained. It does not grant access, publish evidence, or authorize field work.')).toBeVisible();
  safetyRow = assurance.locator('.assurance-item').filter({ hasText: safetyJob.job.title });
  await expect(safetyRow.getByRole('button', { name: `Prepare safety pack for ${safetyJob.job.title}` })).toHaveCount(0);
  await safetyRow.getByRole('button', { name: `Capture field evidence for ${safetyJob.job.title}` }).click();
  await expect(page.getByTestId('field-evidence-form').getByLabel('Job')).toHaveValue(safetyJob.job.id);

  await safetyRow.getByRole('button', { name: `Approve JHA for ${safetyJob.job.title}` }).click();
  const jhaModal = page.getByTestId('field-assurance-modal');
  await expect(jhaModal.getByRole('heading', { name: 'Approve JHA' })).toBeVisible();
  await expect(jhaModal.getByText('3 hazards retained with controls for review.')).toBeVisible();
  await jhaModal.getByLabel('Evidence and decision').fill('Reviewed the retained hazards and work method with the supervisor; PPE, isolation, and stop-work controls are confirmed for approver review.');
  await jhaModal.getByRole('button', { name: 'Request approver review' }).click();
  await expect(page.getByText('Approve JHA retained for approver review. No field reliance or external commitment was made.')).toBeVisible();

  const rfiRow = assurance.locator('.assurance-item').filter({ hasText: rfiJob.job.title });
  await rfiRow.getByRole('button', { name: `Answer RFI for ${rfiJob.job.title}` }).click();
  const modal = page.getByTestId('field-assurance-modal');
  await expect(modal.getByRole('heading', { name: 'Answer RFI' })).toBeVisible();
  await expect(modal.getByText('Which fixing method is approved for the retained substrate?')).toBeVisible();
  await modal.getByLabel('Response and evidence').fill('Use the retained chemical anchor specification after pull-test verification; engineering response attached to the approval record.');
  await modal.getByRole('button', { name: 'Request approver review' }).click();
  await expect(page.getByText('Answer RFI retained for approver review. No field reliance or external commitment was made.')).toBeVisible();

  const safetyDetailResponse = await request.get(`/api/ledger/jobs/${safetyJob.job.id}`);
  expect(safetyDetailResponse.ok()).toBeTruthy();
  const safetyDetail = await safetyDetailResponse.json();
  expect(safetyDetail.job.safetyMeetings).toHaveLength(1);
  expect(safetyDetail.job.jhas).toHaveLength(1);
  expect(safetyDetail.job.sdsSheets).toHaveLength(1);
  expect(safetyDetail.job.orientations).toHaveLength(1);
  expect(safetyDetail.job.siteAccessLogs).toHaveLength(0);
  expect(safetyDetail.job.jhas[0].status).toBe('pending_approval');
  expect(safetyDetail.job.jhas[0].approvalId).toBeTruthy();

  const rfiDetailResponse = await request.get(`/api/ledger/jobs/${rfiJob.job.id}`);
  expect(rfiDetailResponse.ok()).toBeTruthy();
  const rfiDetail = await rfiDetailResponse.json();
  const retainedRfi = rfiDetail.job.rfis.find(item => item.id === rfi.rfi.id);
  expect(retainedRfi).toMatchObject({
    status: 'pending_approval',
    response: 'Use the retained chemical anchor specification after pull-test verification; engineering response attached to the approval record.'
  });
  expect(retainedRfi.approvalId).toBeTruthy();
  expect(rfiDetail.job.communications.some(message => ['sent', 'delivered'].includes(message.status))).toBe(false);

  const accessDetailResponse = await request.get(`/api/ledger/jobs/${accessJob.job.id}`);
  expect(accessDetailResponse.ok()).toBeTruthy();
  const accessDetail = await accessDetailResponse.json();
  expect(accessDetail.job.orientations[0]).toMatchObject({
    id: orientation.orientation.id,
    status: 'completed',
    data: {
      grantsAccess: false,
      verificationReference: 'INDUCTION-BROWSER-001'
    }
  });
  expect(accessDetail.job.siteAccessLogs[0]).toMatchObject({
    status: 'pending_approval',
    orientationId: orientation.orientation.id,
    orientationValid: true
  });
  expect(accessDetail.job.siteAccessLogs[0].approvalId).toBeTruthy();

  const documentDetailResponse = await request.get(`/api/ledger/jobs/${documentJob.job.id}`);
  expect(documentDetailResponse.ok()).toBeTruthy();
  const documentDetail = await documentDetailResponse.json();
  const reviewedDocument = documentDetail.job.documents.find(item => item.id === controlledDocument.document.id);
  expect(reviewedDocument).toMatchObject({
    status: 'pending_approval',
    approvalId: expect.any(String),
    data: { verificationReference: 'BROWSER-DOC-REVIEW-003' }
  });

  const punchDetailResponse = await request.get(`/api/ledger/jobs/${punchJob.job.id}`);
  expect(punchDetailResponse.ok()).toBeTruthy();
  const punchDetail = await punchDetailResponse.json();
  const reviewedPunch = punchDetail.job.punchItems.find(item => item.id === punch.punchItem.id);
  expect(reviewedPunch).toMatchObject({ status: 'pending_approval', approvalId: expect.any(String) });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileGeometry = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="field-workspace"]');
    return {
      pageWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      workspaceWidth: workspace?.scrollWidth || 0,
      workspaceClientWidth: workspace?.clientWidth || 0
    };
  });
  expect(mobileGeometry.pageWidth).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
  expect(mobileGeometry.workspaceWidth).toBeLessThanOrEqual(mobileGeometry.workspaceClientWidth);
});

test('clients workspace prepares closeout and aftercare without delivery or booking', async ({ page, request }) => {
  await ensureBrowserOrganization(request);
  const closeoutJob = await createBrowserJob(request, 'Browser client closeout job', {
    service: 'Bathroom renovation',
    status: 'completed',
    progressPercent: 100,
    estimatedCost: 4200,
    contractValue: 4200,
    assignAutomatically: false
  });
  await resolvePendingClientApprovals(request, closeoutJob.job.id);
  const handoverJob = await createBrowserJob(request, 'Browser immutable handover job', {
    service: 'Apartment renovation',
    status: 'completed',
    progressPercent: 100,
    estimatedCost: 5200,
    contractValue: 5200,
    assignAutomatically: false
  });
  const handoverReportResponse = await request.post(`/api/ledger/jobs/${handoverJob.job.id}/field-reports`, {
    data: { status: 'draft', reportDate: '2026-07-15', workCompleted: 'Final completion evidence retained for browser handover QA.' }
  });
  expect(handoverReportResponse.ok()).toBeTruthy();
  const handoverQualityResponse = await request.post(`/api/ledger/jobs/${handoverJob.job.id}/quality-checks`, {
    data: { title: 'Browser final handover quality', status: 'approved', result: 'passed', defects: [], defectsOpen: 0, notes: 'No open defects remain.' }
  });
  expect(handoverQualityResponse.ok()).toBeTruthy();
  const handoverQuality = await handoverQualityResponse.json();
  const handoverQualityApproval = await request.post(`/api/ledger/approvals/${handoverQuality.qualityCheck.approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser handover approver', reason: 'Final quality evidence checked.' }
  });
  expect(handoverQualityApproval.ok()).toBeTruthy();
  await resolvePendingClientApprovals(request, handoverJob.job.id);
  const handoverReadinessResponse = await request.get(`/api/ledger/client-success?mode=handover&limit=100`);
  expect(handoverReadinessResponse.ok()).toBeTruthy();
  const handoverReadiness = await handoverReadinessResponse.json();
  expect(handoverReadiness.jobs.find(job => job.jobId === handoverJob.job.id)?.nextActions).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'prepare_handover_package' })
  ]));
  const waitingJob = await createBrowserJob(request, 'Browser client selection job', {
    service: 'Kitchen installation',
    status: 'scheduled',
    progressPercent: 35,
    assignAutomatically: false
  });
  const selectionResponse = await request.post(`/api/ledger/jobs/${waitingJob.job.id}/client-selections`, {
    data: {
      title: 'Choose cabinet finish',
      category: 'finish',
      status: 'pending_client',
      dueAt: '2026-07-01T12:00:00.000Z',
      options: ['matte white', 'oak'],
      value: 600
    }
  });
  expect(selectionResponse.ok()).toBeTruthy();
  await resolvePendingClientApprovals(request, waitingJob.job.id);

  const selectionDecisionJob = await createBrowserJob(request, 'Browser retained selection decision job', {
    service: 'Kitchen installation',
    status: 'scheduled',
    progressPercent: 20,
    assignAutomatically: false
  });
  await resolvePendingClientApprovals(request, selectionDecisionJob.job.id);
  const selectionDecisionResponse = await request.post(`/api/ledger/jobs/${selectionDecisionJob.job.id}/client-selections`, {
    data: {
      title: 'Choose worktop finish',
      category: 'finish',
      status: 'pending_client',
      dueAt: '2026-07-20T12:00:00.000Z',
      options: ['light terrazzo', 'charcoal composite'],
      value: 850
    }
  });
  expect(selectionDecisionResponse.ok()).toBeTruthy();
  const selectionDecision = await selectionDecisionResponse.json();

  const recurringJob = await createBrowserJob(request, 'Browser maintenance proposal job', {
    service: 'Inspection',
    status: 'completed',
    progressPercent: 100,
    estimatedCost: 700,
    contractValue: 700,
    assignAutomatically: false
  });
  await resolvePendingClientApprovals(request, recurringJob.job.id);
  expect(recurringJob.job.recurringPlans).toHaveLength(0);
  const recurringReadinessResponse = await request.get('/api/ledger/client-success?limit=100');
  expect(recurringReadinessResponse.ok()).toBeTruthy();
  const recurringReadiness = await recurringReadinessResponse.json();
  const recurringReadinessRow = recurringReadiness.jobs.find(job => job.jobId === recurringJob.job.id);
  expect(recurringReadinessRow).toMatchObject({
    jobTitle: 'Browser maintenance proposal job',
    jobType: 'Inspection',
    jobStatus: 'completed',
    counts: { recurringPlans: 0 }
  });
  expect(recurringReadinessRow.nextActions).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'propose_recurring_plan' })
  ]));

  const aftercareJob = await createBrowserJob(request, 'Browser aftercare service job', {
    service: 'Aftercare service',
    status: 'completed',
    progressPercent: 100,
    estimatedCost: 900,
    contractValue: 900,
    assignAutomatically: false
  });
  const setupCloseoutResponse = await request.post(`/api/ledger/jobs/${aftercareJob.job.id}/closeout`, {
    data: { markCompleted: false, createRecurringPlan: false }
  });
  expect(setupCloseoutResponse.ok()).toBeTruthy();
  await resolvePendingClientApprovals(request, aftercareJob.job.id);
  const dueAftercareResponse = await request.post(`/api/ledger/jobs/${aftercareJob.job.id}/aftercare`, {
    data: {
      title: 'Browser one-week satisfaction check',
      status: 'open',
      dueAt: '2026-07-01T12:00:00.000Z',
      notes: 'Confirm the retained aftercare outcome.'
    }
  });
  expect(dueAftercareResponse.ok()).toBeTruthy();
  const dueAftercare = await dueAftercareResponse.json();

  await page.goto('/');
  await page.getByRole('button', { name: 'Clients', exact: true }).click();
  const clients = page.getByTestId('client-workspace');
  await expect(clients.getByRole('heading', { name: 'Client success', exact: true })).toBeVisible();

  let selectionRow = clients.locator('.client-item').filter({ hasText: selectionDecisionJob.job.title });
  await expect(selectionRow.getByRole('button', { name: `Draft client follow-up for ${selectionDecisionJob.job.title}` })).toHaveCount(0);
  await selectionRow.getByRole('button', { name: `Record client selection for ${selectionDecisionJob.job.title}` }).click();
  const selectionModal = page.getByTestId('client-lifecycle-modal');
  await expect(selectionModal.getByRole('heading', { name: 'Record client selection' })).toBeVisible();
  await selectionModal.getByLabel('Retained option').selectOption('light terrazzo');
  await selectionModal.getByLabel('Client confirmation reference').fill('BROWSER-CLIENT-SELECTION-001');
  await selectionModal.getByLabel('Evidence and outcome').fill('Client confirmed light terrazzo through the retained project portal reply.');
  await selectionModal.getByRole('button', { name: 'Request selection approval' }).click();
  await expect(page.getByText('Record client selection retained as a pending approval; the client-facing outcome has not been committed.')).toBeVisible();

  selectionRow = clients.locator('.client-item').filter({ hasText: selectionDecisionJob.job.title });
  await expect(selectionRow.getByRole('button', { name: 'Review approval' })).toBeVisible();
  await expect(selectionRow.getByRole('button', { name: `Record client selection for ${selectionDecisionJob.job.title}` })).toHaveCount(0);
  await selectionRow.getByRole('button', { name: 'Review approval' }).click();
  const selectionApproval = page.locator('.approval-item').filter({ hasText: /client selection/i });
  await expect(selectionApproval).toHaveCount(1);
  await approveQueueItem(page, selectionApproval);
  await page.getByRole('button', { name: 'Clients', exact: true }).click();

  let closeoutRow = clients.locator('.client-item').filter({ hasText: closeoutJob.job.title });
  await closeoutRow.getByRole('button', { name: `Prepare closeout for ${closeoutJob.job.title}` }).click();
  await expect(page.getByText(/(Closeout package retained|existing closeout package was retained)/i)).toBeVisible();
  await expect(closeoutRow.getByRole('button', { name: `Prepare closeout for ${closeoutJob.job.title}` })).toHaveCount(0);

  let handoverRow = clients.locator('.client-item').filter({ hasText: handoverJob.job.title });
  await expect(handoverRow.getByRole('button', { name: `Prepare handover dossier for ${handoverJob.job.title}` })).toBeVisible();
  await handoverRow.getByRole('button', { name: `Prepare handover dossier for ${handoverJob.job.title}` }).click();
  await expect(page.getByText('Immutable handover dossier retained. Client delivery is a separate approval-gated step.')).toBeVisible();
  handoverRow = clients.locator('.client-item').filter({ hasText: handoverJob.job.title });
  const handoverDownload = handoverRow.getByRole('link', { name: `Download handover dossier for ${handoverJob.job.title}` });
  await expect(handoverDownload).toBeVisible();
  await expect(handoverRow.getByRole('button', { name: 'Review approval' })).toBeVisible();
  const handoverHref = await handoverDownload.getAttribute('href');
  const handoverDownloadResponse = await request.get(handoverHref);
  expect(handoverDownloadResponse.ok()).toBeTruthy();
  expect(await handoverDownloadResponse.text()).toContain('Project handover dossier');

  const waitingRow = clients.locator('.client-item').filter({ hasText: waitingJob.job.title });
  await waitingRow.getByRole('button', { name: `Draft client follow-up for ${waitingJob.job.title}` }).click();
  await expect(page.getByText('Client follow-up drafted behind an approval gate. No message was delivered.')).toBeVisible();
  await expect(waitingRow.getByRole('button', { name: `Draft client follow-up for ${waitingJob.job.title}` })).toHaveCount(0);

  let aftercareRow = clients.locator('.client-item').filter({ hasText: aftercareJob.job.title });
  await aftercareRow.getByRole('button', { name: `Complete aftercare for ${aftercareJob.job.title}` }).click();
  const lifecycleModal = page.getByTestId('client-lifecycle-modal');
  await expect(lifecycleModal.getByRole('heading', { name: 'Complete aftercare follow-up' })).toBeVisible();
  await lifecycleModal.getByLabel('Evidence and outcome').fill('Client confirmed the completed work is functioning correctly; no new warranty concern was reported.');
  await lifecycleModal.getByRole('button', { name: 'Complete internal follow-up' }).click();
  await expect(page.getByText('Aftercare outcome completed in the internal ledger. No client message was sent.')).toBeVisible();

  const recurringRow = clients.locator('.client-item').filter({ hasText: recurringJob.job.title });
  await recurringRow.getByRole('button', { name: `Draft recurring plan for ${recurringJob.job.title}` }).click();
  await expect(page.getByText('Recurring-service proposal retained as an internal draft. Nothing was booked or offered to the client.')).toBeVisible();

  const closeoutDetailResponse = await request.get(`/api/ledger/jobs/${closeoutJob.job.id}`);
  expect(closeoutDetailResponse.ok()).toBeTruthy();
  const closeoutDetail = await closeoutDetailResponse.json();
  expect(closeoutDetail.job.status).toBe('completed');
  expect(closeoutDetail.job.qualityChecks).toHaveLength(1);
  expect(closeoutDetail.job.safetyChecks).toHaveLength(1);
  expect(closeoutDetail.job.aftercare).toHaveLength(1);
  expect(closeoutDetail.job.invoices).toHaveLength(1);
  expect(closeoutDetail.job.payments).toHaveLength(1);
  expect(closeoutDetail.job.communications).toHaveLength(1);
  expect(closeoutDetail.job.communications[0].approvalId).toBeTruthy();
  expect(['sent', 'delivered']).not.toContain(closeoutDetail.job.communications[0].status);

  const handoverDetailResponse = await request.get(`/api/ledger/jobs/${handoverJob.job.id}`);
  expect(handoverDetailResponse.ok()).toBeTruthy();
  const handoverDetail = await handoverDetailResponse.json();
  const retainedHandover = handoverDetail.job.documents.find(document => document.type === 'handover_issue_package');
  expect(retainedHandover).toMatchObject({ status: 'prepared', data: { deliveryMode: 'approval_gated_draft', externalCommitments: 0 } });
  const retainedHandoverCommunication = handoverDetail.job.communications.find(message => message.data?.source === 'handover_issue_package');
  expect(retainedHandoverCommunication).toMatchObject({ status: 'draft', approvalId: expect.any(String) });

  const waitingDetailResponse = await request.get(`/api/ledger/jobs/${waitingJob.job.id}`);
  expect(waitingDetailResponse.ok()).toBeTruthy();
  const waitingDetail = await waitingDetailResponse.json();
  const selectionReminder = waitingDetail.job.communications.find(message => message.subject === 'Selection reminder: Choose cabinet finish');
  expect(selectionReminder).toMatchObject({ direction: 'outbound', status: 'draft' });
  expect(selectionReminder.approvalId).toBeTruthy();
  expect(waitingDetail.job.communications.some(message => ['sent', 'delivered'].includes(message.status))).toBe(false);

  const selectionDetailResponse = await request.get(`/api/ledger/jobs/${selectionDecisionJob.job.id}`);
  expect(selectionDetailResponse.ok()).toBeTruthy();
  const selectionDetail = await selectionDetailResponse.json();
  const selectedOption = selectionDetail.job.clientSelections.find(item => item.id === selectionDecision.clientSelection.id);
  expect(selectedOption).toMatchObject({
    status: 'selected',
    approvalId: expect.any(String),
    data: {
      selectedOption: 'light terrazzo',
      verificationReference: 'BROWSER-CLIENT-SELECTION-001',
      clientConfirmed: true
    }
  });
  expect(selectedOption.decidedAt).toBeTruthy();

  const aftercareDetailResponse = await request.get(`/api/ledger/jobs/${aftercareJob.job.id}`);
  expect(aftercareDetailResponse.ok()).toBeTruthy();
  const aftercareDetail = await aftercareDetailResponse.json();
  expect(aftercareDetail.job.aftercare).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: dueAftercare.aftercare.id, status: 'completed' })
  ]));
  const recurringDetailResponse = await request.get(`/api/ledger/jobs/${recurringJob.job.id}`);
  expect(recurringDetailResponse.ok()).toBeTruthy();
  const recurringDetail = await recurringDetailResponse.json();
  expect(recurringDetail.job.recurringPlans).toHaveLength(1);
  expect(recurringDetail.job.recurringPlans[0]).toMatchObject({ status: 'draft', intervalRule: 'quarterly' });
  expect(recurringDetail.job.recurringPlans[0].data.approvalRequiredBeforeBooking).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileGeometry = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="client-workspace"]');
    return {
      pageWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      workspaceWidth: workspace?.scrollWidth || 0,
      workspaceClientWidth: workspace?.clientWidth || 0
    };
  });
  expect(mobileGeometry.pageWidth).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
  expect(mobileGeometry.workspaceWidth).toBeLessThanOrEqual(mobileGeometry.workspaceClientWidth);
});

test('finance workspace creates and prepares an approval-gated structured invoice without delivery', async ({ page, request }) => {
  await ensureBrowserOrganization(request);
  const intake = await createBrowserJob(request, 'Browser finance closeout job', {
    status: 'completed',
    progressPercent: 100,
    estimatedCost: 3000,
    contractValue: 3000,
    targetCompletion: '2026-07-10T16:00:00.000Z',
    assignAutomatically: false
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  const finance = page.getByTestId('finance-workspace');
  await expect(finance.getByRole('heading', { name: 'Finance readiness' })).toBeVisible();
  await expect(finance.getByRole('heading', { name: intake.job.title })).toBeVisible();

  await finance.getByRole('button', { name: `Draft invoice for ${intake.job.title}` }).click();
  const modal = page.getByTestId('invoice-draft-modal');
  await expect(modal.getByRole('heading', { name: 'Draft invoice' })).toBeVisible();
  await expect(modal.getByLabel('Net amount (EUR)')).toHaveValue('3000.00');
  await expect(modal.getByLabel('VAT rate (%)')).toHaveValue('21');
  await modal.getByLabel('Buyer reference').fill('BROWSER-BUYER-3000');
  await modal.getByLabel('Buyer KVK / OIN').fill('87654321');
  await modal.getByLabel('Buyer electronic address').fill('87654321');
  await modal.getByLabel('Buyer street address').fill('Keizersgracht 10');
  await modal.getByLabel('Buyer postal code').fill('1015 CC');
  await modal.getByLabel('Buyer city').fill('Amsterdam');
  await modal.getByRole('button', { name: 'Create approval-gated draft' }).click();
  await expect(page.getByText(/Invoice draft retained/i)).toBeVisible();

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  expect(detail.job.invoices).toHaveLength(1);
  expect(detail.job.invoices[0]).toMatchObject({ status: 'draft', amount: 3000, taxAmount: 630, total: 3630 });
  expect(detail.job.invoices[0].data.peppolReady).toBe(true);
  expect(detail.job.invoices[0].approvalId).toBeTruthy();

  const approvalsResponse = await request.get('/api/ledger/approvals?status=pending&limit=100');
  expect(approvalsResponse.ok()).toBeTruthy();
  const approvals = await approvalsResponse.json();
  expect(approvals.approvals).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: detail.job.invoices[0].approvalId, targetType: 'invoice', approvalType: 'invoice_issue' })
  ]));
  await expect(finance.getByRole('button', { name: `Draft invoice for ${intake.job.title}` })).toHaveCount(0);

  const invoiceApproval = await request.post(`/api/ledger/approvals/${detail.job.invoices[0].approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser finance approver', reason: 'Structured invoice identity and totals checked.' }
  });
  expect(invoiceApproval.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh data' }).click();
  const row = finance.locator('.finance-item').filter({ hasText: intake.job.title });
  await row.getByRole('button', { name: `Prepare invoice package for ${intake.job.title}` }).click();
  await expect(page.getByText(/retained with HTML and UBL attachments/i)).toBeVisible();
  await expect(row.getByRole('link', { name: `Download invoice for ${intake.job.title}` })).toBeVisible();
  await expect(row.getByRole('link', { name: `Download UBL for ${intake.job.title}` })).toBeVisible();

  const packagedDetailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(packagedDetailResponse.ok()).toBeTruthy();
  const packagedDetail = await packagedDetailResponse.json();
  expect(packagedDetail.job.invoices[0].status).toBe('prepared');
  expect(packagedDetail.job.invoices[0].data.issuePackage.issueReference).toMatch(/^INV-\d{4}-\d{6}$/);
  expect(packagedDetail.job.documents.map(document => document.type)).toEqual(expect.arrayContaining(['invoice_issue_package', 'invoice_ubl_package']));
  expect(packagedDetail.job.communications.find(communication => communication.data.source === 'invoice_issue_package')).toMatchObject({ status: 'draft' });
});

test('finance workspace plans a billing milestone and locks its values into the invoice draft', async ({ page, request }) => {
  const intake = await createBrowserJob(request, 'Browser staged billing workflow', {
    status: 'completed',
    progressPercent: 100,
    estimatedCost: 1200,
    contractValue: 1800,
    targetCompletion: '2026-07-10T16:00:00.000Z',
    assignAutomatically: false
  });
  const plannedIssueDate = new Date().toISOString().slice(0, 10);
  const dueDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  await page.goto('/');
  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  const finance = page.getByTestId('finance-workspace');
  let row = finance.locator('.finance-item').filter({ hasText: intake.job.title });
  await row.getByRole('button', { name: `Billing milestone for ${intake.job.title}` }).click();

  const control = page.getByTestId('finance-control-modal');
  await expect(control.getByRole('heading', { name: 'Billing milestone' })).toBeVisible();
  await expect(control.getByLabel('Net milestone (EUR)')).toHaveValue('1800.00');
  await expect(control.getByLabel('VAT rate (%)')).toHaveValue('21');
  await control.getByLabel('Planned invoice date').fill(plannedIssueDate);
  await control.getByLabel('Payment due date').fill(dueDate);
  await control.getByLabel('Milestone description').fill('Contract completion milestone');
  await control.getByLabel('Internal evidence and notes').fill('Signed contract and completion evidence checked for staged billing.');
  await expect(control.getByLabel('Billing milestone calculation')).toContainText(/Total\s*€\s*2\.178,00/);
  await control.getByRole('button', { name: 'Request milestone approval' }).click();
  await expect(page.getByText(/Billing milestone retained for €\s*2\.178,00/)).toBeVisible();

  let detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  let detail = await detailResponse.json();
  expect(detail.job.billingMilestones).toHaveLength(1);
  const milestone = detail.job.billingMilestones[0];
  expect(milestone).toMatchObject({
    title: 'Contract completion milestone',
    status: 'pending_approval',
    amount: 1800,
    taxAmount: 378,
    total: 2178,
    invoiceId: null
  });

  const approvalResponse = await request.post(`/api/ledger/approvals/${milestone.approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser finance approver', reason: 'Milestone matches the signed contract and completion evidence.' }
  });
  expect(approvalResponse.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh data' }).click();
  row = finance.locator('.finance-item').filter({ hasText: intake.job.title });
  await expect(row.getByText('1 billing milestone')).toBeVisible();
  await expect(row.getByText('1 milestone due')).toBeVisible();
  await row.getByRole('button', { name: `Draft invoice for ${intake.job.title}` }).click();

  const invoiceModal = page.getByTestId('invoice-draft-modal');
  await expect(invoiceModal.getByRole('heading', { name: 'Draft milestone invoice' })).toBeVisible();
  await expect(invoiceModal.getByTestId('invoice-milestone-source')).toContainText('Contract completion milestone');
  await expect(invoiceModal.getByLabel('Net amount (EUR)')).toHaveValue('1800.00');
  await expect(invoiceModal.getByLabel('VAT rate (%)')).toHaveValue('21');
  await expect(invoiceModal.getByLabel('Due date')).toHaveValue(dueDate);
  await expect(invoiceModal.getByLabel('Net amount (EUR)')).not.toBeEditable();
  await expect(invoiceModal.getByLabel('VAT rate (%)')).not.toBeEditable();
  await expect(invoiceModal.getByLabel('Due date')).not.toBeEditable();
  const structuredExport = invoiceModal.getByLabel('Prepare Peppol BIS / UBL 2.1 export');
  if (await structuredExport.isChecked()) await structuredExport.uncheck();

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await page.evaluate(() => {
    const modal = document.querySelector('[data-testid="invoice-draft-modal"]');
    return {
      pageWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      modalWidth: modal?.scrollWidth || 0,
      modalClientWidth: modal?.clientWidth || 0
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.modalWidth).toBeLessThanOrEqual(geometry.modalClientWidth);
  await invoiceModal.getByRole('button', { name: 'Create approval-gated draft' }).click();
  await expect(page.getByText(/Invoice draft retained/i)).toBeVisible();

  detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  detail = await detailResponse.json();
  expect(detail.job.invoices).toHaveLength(1);
  expect(detail.job.invoices[0]).toMatchObject({ amount: 1800, taxAmount: 378, total: 2178, dueAt: milestone.dueAt });
  expect(detail.job.invoices[0].data.billingMilestoneId).toBe(milestone.id);
  expect(detail.job.billingMilestones[0]).toMatchObject({ status: 'invoicing', invoiceId: detail.job.invoices[0].id });
});

test('finance workspace matches a supplier invoice and confirms payment evidence without moving funds', async ({ page, request }) => {
  await ensureBrowserOrganization(request);
  const supplier = await ensureVerifiedTradePartner(request, `Browser payable supplier ${Date.now()}`);
  const intake = await createBrowserJob(request, 'Browser supplier payable workflow', {
    status: 'scheduled',
    progressPercent: 0,
    estimatedCost: 1000,
    contractValue: 0,
    assignAutomatically: false
  });
  const purchaseOrderResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/purchase-orders`, {
    data: {
      supplier: supplier.name,
      tradePartnerId: supplier.id,
      status: 'ready_to_order',
      amount: 1000,
      currency: 'EUR',
      items: [{ name: 'Browser payable materials', quantity: 1, unitCost: 1000 }],
      notes: 'Browser supplier payable purchase commitment.'
    }
  });
  expect(purchaseOrderResponse.ok()).toBeTruthy();
  const purchaseOrder = await purchaseOrderResponse.json();
  const purchaseApproval = await request.post(`/api/ledger/approvals/${purchaseOrder.purchaseOrder.approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser payables approver', reason: 'Supplier compliance and purchase commitment checked.' }
  });
  expect(purchaseApproval.ok()).toBeTruthy();
  const orderPackageResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/purchase-orders/${purchaseOrder.purchaseOrder.id}/issue-package`, {
    data: { recipient: 'browser-payables@supplier.example', channel: 'email' }
  });
  expect(orderPackageResponse.ok()).toBeTruthy();
  const orderPackage = await orderPackageResponse.json();
  const orderTransmissionApproval = await request.post(`/api/ledger/approvals/${orderPackage.approval.id}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser payables approver', reason: 'Recipient and immutable purchase-order package checked.' }
  });
  expect(orderTransmissionApproval.ok()).toBeTruthy();
  const orderDelivery = await request.post(`/api/ledger/communications/${orderPackage.communication.id}/delivery-receipt`, {
    data: { integration: 'playwright_test_provider', providerMessageId: `browser-payables-order-${Date.now()}`, receipt: { status: 'accepted' } }
  });
  expect(orderDelivery.ok()).toBeTruthy();
  const material = await request.post(`/api/ledger/jobs/${intake.job.id}/materials`, {
    data: { name: 'Browser payable materials', quantity: 1, unit: 'package', status: 'needed' }
  });
  expect(material.ok()).toBeTruthy();
  const materialRequirement = (await material.json()).materialRequirement;
  const receiptResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/material-receipts`, {
    data: {
      purchaseOrderId: purchaseOrder.purchaseOrder.id,
      receiptReference: 'BROWSER-GR-1000',
      evidenceReference: 'browser:signed-ticket:GR-1000',
      deliveredAt: new Date(Date.now() - 60_000).toISOString(),
      receivedBy: 'Browser payable receiver',
      entryKey: `browser-payable-receipt-${Date.now()}`,
      lines: [{
        materialRequirementId: materialRequirement.id,
        itemName: 'Browser payable materials', unit: 'package', receivedQuantity: 1, acceptedQuantity: 1, damagedQuantity: 0
      }]
    }
  });
  expect(receiptResponse.ok()).toBeTruthy();
  const materialReceipt = (await receiptResponse.json()).receipt;

  await page.goto('/');
  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  const finance = page.getByTestId('finance-workspace');
  let row = finance.locator('.finance-item').filter({ hasText: intake.job.title });
  await expect(row).toContainText('Supplier payable');
  await row.getByRole('button', { name: `Supplier invoice for ${intake.job.title}` }).click();
  let control = page.getByTestId('finance-control-modal');
  await expect(control.getByRole('heading', { name: 'Supplier invoice' })).toBeVisible();
  await expect(control.getByLabel('Supplier', { exact: true })).toHaveValue(supplier.name);
  await expect(control.getByLabel('Net amount (EUR)')).toHaveValue('1000.00');
  await expect(control.getByLabel('VAT amount (EUR)')).toHaveValue('210.00');
  await expect(control.getByLabel('Retained goods receipt')).toHaveValue(materialReceipt.id);
  await control.getByLabel('Supplier invoice number').fill('BROWSER-SUP-1000');
  await expect(control.getByLabel('Delivery or service evidence reference')).toHaveValue('BROWSER-GR-1000');
  await control.getByLabel('Internal evidence and notes').fill('Supplier, purchase order, goods receipt, net amount, VAT, and due date were checked.');
  await control.getByRole('button', { name: 'Request payable approval' }).click();
  await expect(page.getByText(/Supplier invoice BROWSER-SUP-1000 retained for/)).toBeVisible();

  await page.locator('.side-nav').getByRole('button', { name: /^Approvals/ }).click();
  const supplierInvoiceApproval = page.locator('.approval-item').filter({ hasText: 'BROWSER-SUP-1000' });
  await expect(supplierInvoiceApproval).toHaveCount(1);
  await approveQueueItem(page, supplierInvoiceApproval, 'Purchase order, goods receipt, VAT, and supplier identity verified.');

  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  row = finance.locator('.finance-item').filter({ hasText: intake.job.title });
  await row.getByRole('button', { name: `Supplier payment for ${intake.job.title}` }).click();
  control = page.getByTestId('finance-control-modal');
  await expect(control.getByRole('heading', { name: 'Supplier payment' })).toBeVisible();
  await expect(control.getByText('BROWSER-SUP-1000', { exact: true })).toBeVisible();
  await expect(control.getByLabel('Payment amount (EUR)')).toHaveValue('1210.00');
  await control.getByLabel('Bank or bookkeeping reference').fill('BROWSER-BANK-SUP-1000');
  await control.getByLabel('Internal evidence and notes').fill('Bank statement reference and full supplier payment amount were checked.');
  await control.getByRole('button', { name: 'Request payment confirmation' }).click();
  await expect(page.getByText('Supplier payment evidence retained for approver review. The payable balance is unchanged and Contractor.AI did not move funds.')).toBeVisible();

  await page.locator('.side-nav').getByRole('button', { name: /^Approvals/ }).click();
  const paymentApproval = page.locator('.approval-item').filter({ hasText: 'BROWSER-BANK-SUP-1000' });
  await expect(paymentApproval).toHaveCount(1);
  await approveQueueItem(page, paymentApproval, 'Bank reference, date, supplier invoice, and amount verified.');

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  expect(detail.job.supplierInvoices[0]).toMatchObject({
    invoiceNumber: 'BROWSER-SUP-1000',
    status: 'paid',
    total: 1210,
    data: { match: { status: 'matched', type: 'three_way_material_receipt', materialReceiptId: materialReceipt.id }, reconciliation: { paidAmount: 1210, outstandingAmount: 0 } }
  });
  expect(detail.job.supplierInvoicePayments[0]).toMatchObject({
    status: 'paid',
    amount: 1210,
    reference: 'BROWSER-BANK-SUP-1000',
    data: { externalPaymentInitiated: false }
  });

  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileGeometry = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="finance-workspace"]');
    return {
      pageWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      workspaceWidth: workspace?.scrollWidth || 0,
      workspaceClientWidth: workspace?.clientWidth || 0
    };
  });
  expect(mobileGeometry.pageWidth).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
  expect(mobileGeometry.workspaceWidth).toBeLessThanOrEqual(mobileGeometry.workspaceClientWidth);
});

test('finance workspace creates, approves, and packages a partial credit note against an issued invoice', async ({ page, request }) => {
  await ensureBrowserOrganization(request);
  const intake = await createBrowserJob(request, 'Browser finance credit-note job', {
    status: 'completed',
    progressPercent: 100,
    estimatedCost: 1000,
    contractValue: 1000,
    targetCompletion: '2026-07-10T16:00:00.000Z',
    assignAutomatically: false
  });
  const invoiceResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/invoices`, {
    data: {
      amount: 1000,
      taxRate: 21,
      dueAt: '2026-09-30T23:59:59.000Z',
      structuredExportRequested: true,
      buyerReference: 'BROWSER-CREDIT-1000',
      buyerLegalName: 'Browser Credit Buyer B.V.',
      buyerRegistrationNumber: '87654321',
      buyerEndpointScheme: '0106',
      buyerEndpointId: '87654321',
      buyerAddress: 'Keizersgracht 10',
      buyerPostalCode: '1015 CN',
      buyerCity: 'Amsterdam',
      buyerCountry: 'NL'
    }
  });
  expect(invoiceResponse.ok()).toBeTruthy();
  const invoice = await invoiceResponse.json();
  const invoiceApproval = await request.post(`/api/ledger/approvals/${invoice.invoice.approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser finance approver', reason: 'Invoice identity and totals checked.' }
  });
  expect(invoiceApproval.ok()).toBeTruthy();
  const invoicePackageResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/invoices/${invoice.invoice.id}/issue-package`, { data: {} });
  expect(invoicePackageResponse.ok()).toBeTruthy();
  const invoicePackage = await invoicePackageResponse.json();
  const deliveryApproval = await request.post(`/api/ledger/approvals/${invoicePackage.approval.id}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser finance approver', reason: 'Invoice recipient and attachments checked.' }
  });
  expect(deliveryApproval.ok()).toBeTruthy();
  const invoiceDelivery = await request.post(`/api/ledger/communications/${invoicePackage.communication.id}/delivery-receipt`, {
    data: { integration: 'playwright_test_provider', providerMessageId: 'browser-credit-source-invoice' }
  });
  expect(invoiceDelivery.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  const finance = page.getByTestId('finance-workspace');
  let row = finance.locator('.finance-item').filter({ hasText: intake.job.title });
  await row.getByRole('button', { name: `Credit invoice for ${intake.job.title}` }).click();
  let modal = page.getByTestId('finance-control-modal');
  await expect(modal.getByRole('heading', { name: 'Credit invoice' })).toBeVisible();
  await expect(modal.getByLabel('Net credit amount (EUR)')).toHaveValue('1000.00');
  await expect(modal.getByLabel('VAT rate (%)')).toHaveValue('21');
  await modal.getByLabel('Net credit amount (EUR)').fill('200');
  await modal.getByLabel('Credit-line description').fill('Duplicate material line correction');
  await modal.getByLabel('Internal evidence and notes').fill('Signed scope correction and original invoice line were checked against the retained project record.');
  await expect(modal.getByLabel('Credit note calculation')).toContainText(/Total credit\s*€\s*242,00/);

  await page.setViewportSize({ width: 390, height: 844 });
  const modalGeometry = await page.evaluate(() => {
    const creditModal = document.querySelector('[data-testid="finance-control-modal"]');
    return {
      pageWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      modalWidth: creditModal?.scrollWidth || 0,
      modalClientWidth: creditModal?.clientWidth || 0
    };
  });
  expect(modalGeometry.pageWidth).toBeLessThanOrEqual(modalGeometry.viewportWidth);
  expect(modalGeometry.modalWidth).toBeLessThanOrEqual(modalGeometry.modalClientWidth);
  await modal.getByRole('button', { name: 'Request credit-note approval' }).click();
  await expect(page.getByText(/Credit-note draft retained for €\s*242,00/)).toBeVisible();

  let detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  let detail = await detailResponse.json();
  expect(detail.job.creditNotes).toHaveLength(1);
  expect(detail.job.creditNotes[0]).toMatchObject({ status: 'draft', amount: 200, taxAmount: 42, total: 242 });
  expect(detail.job.invoices[0].status).toBe('sent');
  const creditApproval = await request.post(`/api/ledger/approvals/${detail.job.creditNotes[0].approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser finance approver', reason: 'Correction and VAT treatment checked.' }
  });
  expect(creditApproval.ok()).toBeTruthy();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Refresh data' }).click();
  row = finance.locator('.finance-item').filter({ hasText: intake.job.title });
  await row.getByRole('button', { name: `Prepare credit note package for ${intake.job.title}` }).click();
  await expect(page.getByText(/Credit note CRN-.* retained with HTML and UBL attachments\. The receivable was adjusted/i)).toBeVisible();
  await expect(row.getByText(/€\s*242,00 credited/)).toBeVisible();
  await expect(row.getByRole('link', { name: `Download credit note for ${intake.job.title}` })).toBeVisible();
  await expect(row.getByRole('link', { name: `Download credit note UBL for ${intake.job.title}` })).toBeVisible();

  detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  detail = await detailResponse.json();
  expect(detail.job.creditNotes[0].status).toBe('prepared');
  expect(detail.job.creditNotes[0].data.issuePackage.issueReference).toMatch(/^CRN-\d{4}-\d{6}$/);
  expect(detail.job.invoices[0]).toMatchObject({
    status: 'partially_settled',
    data: { reconciliation: { creditedAmount: 242, outstandingAmount: 968 } }
  });
  expect(detail.job.documents.map(document => document.type)).toEqual(expect.arrayContaining(['credit_note_issue_package', 'credit_note_ubl_package']));
});

test('finance workspace operates costs, budgets, handoffs, receivables, draws and waiver requests', async ({ page, request }) => {
  await ensureBrowserOrganization(request);
  const costJob = await createBrowserJob(request, 'Browser finance cost control job', {
    status: 'in_progress',
    progressPercent: 55,
    estimatedCost: 1800,
    contractValue: 1800,
    assignAutomatically: false
  });
  const receivableJob = await createBrowserJob(request, 'Browser finance receivable control job', {
    status: 'completed',
    progressPercent: 100,
    estimatedCost: 3200,
    contractValue: 3200,
    assignAutomatically: false
  });
  const futureDueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const receivableTime = await request.post(`/api/ledger/jobs/${receivableJob.job.id}/time-logs`, {
    data: { hours: 8, rate: 55, notes: 'Verified browser finance labor.' }
  });
  expect(receivableTime.ok()).toBeTruthy();
  const receivableExpense = await request.post(`/api/ledger/jobs/${receivableJob.job.id}/expenses`, {
    data: { category: 'materials', amount: 250, vendor: 'Bouwmaat', receiptRef: 'BROWSER-EXP-250', notes: 'Verified browser receipt.' }
  });
  expect(receivableExpense.ok()).toBeTruthy();
  const receivableBudget = await request.post(`/api/ledger/jobs/${receivableJob.job.id}/budget-lines`, {
    data: { status: 'draft', costCode: 'BROWSER-100', description: 'Browser finance baseline', budgetAmount: 3200, forecastAmount: 3200 }
  });
  expect(receivableBudget.ok()).toBeTruthy();
  const receivableInvoiceResponse = await request.post(`/api/ledger/jobs/${receivableJob.job.id}/invoices`, {
    data: {
      amount: 3200,
      taxRate: 21,
      taxAmount: 672,
      total: 3872,
      dueAt: futureDueAt,
      structuredExportRequested: false,
      buyerLegalName: 'Browser QA Client',
      buyerAddress: 'Keizersgracht 10',
      buyerCity: 'Amsterdam',
      buyerCountry: 'NL'
    }
  });
  expect(receivableInvoiceResponse.ok()).toBeTruthy();
  const receivableInvoice = await receivableInvoiceResponse.json();
  const invoiceApproval = await request.post(`/api/ledger/approvals/${receivableInvoice.invoice.approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser finance approver', reason: 'Invoice evidence checked for browser finance controls.' }
  });
  expect(invoiceApproval.ok()).toBeTruthy();
  const receivablePackageResponse = await request.post(`/api/ledger/jobs/${receivableJob.job.id}/invoices/${receivableInvoice.invoice.id}/issue-package`, { data: {} });
  expect(receivablePackageResponse.ok()).toBeTruthy();
  const receivablePackage = await receivablePackageResponse.json();
  const receivableDeliveryApproval = await request.post(`/api/ledger/approvals/${receivablePackage.approval.id}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser finance approver', reason: 'Invoice recipient and retained attachment checked.' }
  });
  expect(receivableDeliveryApproval.ok()).toBeTruthy();
  const receivableDelivery = await request.post(`/api/ledger/communications/${receivablePackage.communication.id}/delivery-receipt`, {
    data: { integration: 'playwright_test_provider', providerMessageId: 'browser-receivable-message' }
  });
  expect(receivableDelivery.ok()).toBeTruthy();
  const receivableHandoffResponse = await request.post(`/api/ledger/jobs/${receivableJob.job.id}/finance-handoffs`, {
    data: { status: 'approved', targetSystem: 'FAB', notes: 'Browser pre-approved bookkeeping package.' }
  });
  expect(receivableHandoffResponse.ok()).toBeTruthy();
  const receivableHandoff = await receivableHandoffResponse.json();
  const handoffApproval = await request.post(`/api/ledger/approvals/${receivableHandoff.financeHandoff.approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser finance approver', reason: 'Bookkeeping package checked.' }
  });
  expect(handoffApproval.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  const finance = page.getByTestId('finance-workspace');

  let costRow = finance.locator('.finance-item').filter({ hasText: costJob.job.title });
  await costRow.getByRole('button', { name: `Record costs for ${costJob.job.title}` }).click();
  let control = page.getByTestId('finance-control-modal');
  await expect(control.getByRole('heading', { name: 'Record costs' })).toBeVisible();
  await control.getByLabel('Hours').fill('4');
  await control.getByLabel('Expense amount (EUR)').fill('120');
  await control.getByLabel('Vendor').fill('Bouwmaat');
  await control.getByLabel('Receipt reference').fill('BROWSER-COST-120');
  await control.getByLabel('VAT amount (EUR)').fill('20.83');
  await control.getByLabel('Internal evidence and notes').fill('Four verified labor hours and retained materials receipt were reviewed together.');
  await control.getByRole('button', { name: 'Record ledger costs' }).click();
  await expect(page.getByText('Time was retained and the expense receipt is pending source review. No reimbursement, payment, or export was initiated.')).toBeVisible();

  costRow = finance.locator('.finance-item').filter({ hasText: costJob.job.title });
  await expect(costRow.getByRole('button', { name: `Budget baseline for ${costJob.job.title}` })).toBeDisabled();
  let costDetailResponse = await request.get(`/api/ledger/jobs/${costJob.job.id}`);
  expect(costDetailResponse.ok()).toBeTruthy();
  let costDetail = await costDetailResponse.json();
  expect(costDetail.job.timeLogs).toHaveLength(1);
  expect(costDetail.job.expenses).toHaveLength(1);
  expect(costDetail.job.expenses[0].status).toBe('pending_approval');
  expect(costDetail.job.expenses[0].approvalId).toBeTruthy();
  const expenseApproval = await request.post(`/api/ledger/approvals/${costDetail.job.expenses[0].approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser finance approver', reason: 'Receipt identity, VAT treatment, and job allocation checked.' }
  });
  expect(expenseApproval.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh data' }).click();

  costRow = finance.locator('.finance-item').filter({ hasText: costJob.job.title });
  await costRow.getByRole('button', { name: `Budget baseline for ${costJob.job.title}` }).click();
  control = page.getByTestId('finance-control-modal');
  await expect(control.getByRole('heading', { name: 'Budget baseline' })).toBeVisible();
  await expect(control.getByLabel('Budget amount (EUR)')).toHaveValue('1800.00');
  await control.getByLabel('Internal evidence and notes').fill('Contract value and retained cost evidence support this initial cost baseline.');
  await control.getByRole('button', { name: 'Request approver review' }).click();
  await expect(page.getByText('Budget baseline retained for approver review. No export, funding request, or external commitment was made.')).toBeVisible();

  costDetailResponse = await request.get(`/api/ledger/jobs/${costJob.job.id}`);
  expect(costDetailResponse.ok()).toBeTruthy();
  costDetail = await costDetailResponse.json();
  expect(costDetail.job.budgetLines).toHaveLength(1);
  expect(costDetail.job.budgetLines[0].status).toBe('pending_approval');
  const budgetApproval = await request.post(`/api/ledger/approvals/${costDetail.job.budgetLines[0].approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser finance approver', reason: 'Budget baseline checked.' }
  });
  expect(budgetApproval.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh data' }).click();

  costRow = finance.locator('.finance-item').filter({ hasText: costJob.job.title });
  await costRow.getByRole('button', { name: `Finance handoff for ${costJob.job.title}` }).click();
  control = page.getByTestId('finance-control-modal');
  await expect(control.getByRole('heading', { name: 'Finance handoff' })).toBeVisible();
  await control.getByLabel('Internal evidence and notes').fill('Cost, expense, and approved budget records are ready for bookkeeping package review.');
  await control.getByRole('button', { name: 'Request approver review' }).click();
  await expect(page.getByText('Finance handoff retained for approver review. No export, funding request, or external commitment was made.')).toBeVisible();

  let receivableRow = finance.locator('.finance-item').filter({ hasText: receivableJob.job.title });
  await receivableRow.getByRole('button', { name: `Payment follow-up for ${receivableJob.job.title}` }).click();
  control = page.getByTestId('finance-control-modal');
  await expect(control.getByRole('heading', { name: 'Payment follow-up' })).toBeVisible();
  await expect(control.getByLabel('Receivable amount (EUR)')).toHaveValue('3872.00');
  await control.getByLabel('Internal evidence and notes').fill('Internal collection review scheduled; no reminder or client contact was made.');
  await control.getByRole('button', { name: 'Record internal follow-up' }).click();
  await expect(page.getByText('Internal payment follow-up retained. No reminder or external message was sent.')).toBeVisible();

  receivableRow = finance.locator('.finance-item').filter({ hasText: receivableJob.job.title });
  await receivableRow.getByRole('button', { name: `Progress draw for ${receivableJob.job.title}` }).click();
  control = page.getByTestId('finance-control-modal');
  await expect(control.getByRole('heading', { name: 'Progress draw' })).toBeVisible();
  await control.getByLabel('Internal evidence and notes').fill('Completed scope, invoice, and cost evidence support the proposed draw amount.');
  await control.getByRole('button', { name: 'Request approver review' }).click();
  await expect(page.getByText('Progress draw retained for approver review. No export, funding request, or external commitment was made.')).toBeVisible();

  let receivableDetailResponse = await request.get(`/api/ledger/jobs/${receivableJob.job.id}`);
  expect(receivableDetailResponse.ok()).toBeTruthy();
  let receivableDetail = await receivableDetailResponse.json();
  expect(receivableDetail.job.payments).toHaveLength(1);
  expect(receivableDetail.job.payments[0].data.externalDelivery).toBe(false);
  expect(receivableDetail.job.drawRequests).toHaveLength(1);
  expect(receivableDetail.job.drawRequests[0].status).toBe('pending_approval');
  const drawApproval = await request.post(`/api/ledger/approvals/${receivableDetail.job.drawRequests[0].approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser finance approver', reason: 'Progress draw evidence checked.' }
  });
  expect(drawApproval.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh data' }).click();

  receivableRow = finance.locator('.finance-item').filter({ hasText: receivableJob.job.title });
  await receivableRow.getByRole('button', { name: `Record payment for ${receivableJob.job.title}` }).click();
  control = page.getByTestId('finance-control-modal');
  await expect(control.getByRole('heading', { name: 'Record payment' })).toBeVisible();
  await expect(control.getByLabel('Settlement amount (EUR)')).toHaveValue('3872.00');
  await control.getByLabel('Settlement amount (EUR)').fill('1000');
  await control.getByLabel('Payment or authority reference').fill('BROWSER-BANK-MATCH-1000');
  await control.getByLabel('Internal evidence and notes').fill('Partial receipt matched to the retained bank statement and invoice package.');
  await control.getByRole('button', { name: 'Request approver review' }).click();
  await expect(page.getByText('Payment reconciliation retained for approver review. The invoice balance is unchanged until approval and no funds moved.')).toBeVisible();

  receivableDetailResponse = await request.get(`/api/ledger/jobs/${receivableJob.job.id}`);
  expect(receivableDetailResponse.ok()).toBeTruthy();
  receivableDetail = await receivableDetailResponse.json();
  const pendingReceipt = receivableDetail.job.payments.find(payment => payment.reference === 'BROWSER-BANK-MATCH-1000');
  expect(pendingReceipt).toMatchObject({ status: 'pending_confirmation', amount: 1000, invoiceId: receivableInvoice.invoice.id });
  const receiptApproval = await request.post(`/api/ledger/approvals/${pendingReceipt.approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser finance approver', reason: 'Partial bank receipt matched.' }
  });
  expect(receiptApproval.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh data' }).click();
  receivableDetailResponse = await request.get(`/api/ledger/jobs/${receivableJob.job.id}`);
  receivableDetail = await receivableDetailResponse.json();
  expect(receivableDetail.job.invoices.find(invoice => invoice.id === receivableInvoice.invoice.id)).toMatchObject({
    status: 'partially_paid',
    data: { reconciliation: { receivedAmount: 1000, outstandingAmount: 2872 } }
  });

  receivableRow = finance.locator('.finance-item').filter({ hasText: receivableJob.job.title });
  await receivableRow.getByRole('button', { name: `Waiver request for ${receivableJob.job.title}` }).click();
  control = page.getByTestId('finance-control-modal');
  await expect(control.getByRole('heading', { name: 'Waiver request' })).toBeVisible();
  await control.getByLabel('Supplier or party').fill('Bouwmaat');
  await control.getByLabel('Internal evidence and notes').fill('Internal conditional waiver request scope retained before any supplier contact or payment release.');
  await page.setViewportSize({ width: 390, height: 844 });
  const financeModalGeometry = await page.evaluate(() => {
    const modal = document.querySelector('[data-testid="finance-control-modal"]');
    return {
      pageWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      modalWidth: modal?.scrollWidth || 0,
      modalClientWidth: modal?.clientWidth || 0
    };
  });
  expect(financeModalGeometry.pageWidth).toBeLessThanOrEqual(financeModalGeometry.viewportWidth);
  expect(financeModalGeometry.modalWidth).toBeLessThanOrEqual(financeModalGeometry.modalClientWidth);
  await control.getByRole('button', { name: 'Retain waiver request' }).click();
  await expect(page.getByText('Internal waiver request retained. No supplier request or release was sent.')).toBeVisible();

  costDetailResponse = await request.get(`/api/ledger/jobs/${costJob.job.id}`);
  costDetail = await costDetailResponse.json();
  expect(costDetail.job.financeHandoffs).toHaveLength(1);
  expect(costDetail.job.financeHandoffs[0].status).toBe('pending_approval');
  receivableDetailResponse = await request.get(`/api/ledger/jobs/${receivableJob.job.id}`);
  receivableDetail = await receivableDetailResponse.json();
  expect(receivableDetail.job.drawRequests[0].status).toBe('approved');
  expect(receivableDetail.job.lienWaivers).toHaveLength(1);
  expect(receivableDetail.job.lienWaivers[0]).toMatchObject({ status: 'requested', supplier: 'Bouwmaat', amount: 2872 });

  const mobileGeometry = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="finance-workspace"]');
    return {
      pageWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      workspaceWidth: workspace?.scrollWidth || 0,
      workspaceClientWidth: workspace?.clientWidth || 0
    };
  });
  expect(mobileGeometry.pageWidth).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
  expect(mobileGeometry.workspaceWidth).toBeLessThanOrEqual(mobileGeometry.workspaceClientWidth);
});

test('finance workspace freezes, approves, and invalidates a source-linked cost forecast', async ({ page, request }) => {
  const intake = await createBrowserJob(request, `Browser cost forecast ${Date.now()}`, {
    status: 'in_progress',
    progressPercent: 50,
    estimatedCost: 3000,
    contractValue: 5000,
    assignAutomatically: false
  });
  const budgetResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/budget-lines`, {
    data: {
      status: 'baseline',
      costCode: 'BROWSER-FC-100',
      description: 'Browser cost forecast baseline',
      budgetAmount: 3000,
      forecastAmount: 2800
    }
  });
  expect(budgetResponse.ok()).toBeTruthy();
  const budget = await budgetResponse.json();
  const budgetApproval = await request.post(`/api/ledger/approvals/${budget.budgetLine.approval.id}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser forecast approver', reason: 'Cost-code baseline checked.' }
  });
  expect(budgetApproval.ok()).toBeTruthy();
  const costsResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/finance-costs`, {
    data: {
      timeLog: { workDate: '2026-07-16', hours: 8, rate: 50, costCode: 'BROWSER-FC-100', notes: 'Verified browser labor.' },
      expense: { amount: 200, category: 'materials', costCode: 'BROWSER-FC-100', vendor: 'Bouwmaat', receiptRef: 'BROWSER-FC-200' }
    }
  });
  expect(costsResponse.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  const finance = page.getByTestId('finance-workspace');
  let row = finance.locator('.finance-item').filter({ hasText: intake.job.title });
  await expect(row).toContainText('Cost budget');
  await expect(row).toContainText('Actual cost');
  await expect(row.getByRole('button', { name: `Freeze cost forecast for ${intake.job.title}` })).toBeVisible();
  await row.getByRole('button', { name: `Freeze cost forecast for ${intake.job.title}` }).click();
  await expect(page.getByText(/Cost forecast FC-\d{4}-\d{6} retained from the current cost-code evidence/)).toBeVisible();

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  const forecastApproval = detail.job.approvals.find(item => item.targetType === 'cost_forecast' && item.status === 'pending');
  expect(forecastApproval).toBeTruthy();
  const approvalResponse = await request.post(`/api/ledger/approvals/${forecastApproval.id}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser forecast approver', reason: 'Current source evidence and margin checked.' }
  });
  expect(approvalResponse.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh data' }).click();
  row = finance.locator('.finance-item').filter({ hasText: intake.job.title });
  await expect(row).toContainText(/FC-\d{4}-\d{6} current/);
  await expect(row.getByRole('button', { name: `Freeze cost forecast for ${intake.job.title}` })).toHaveCount(0);

  const changedCost = await request.post(`/api/ledger/jobs/${intake.job.id}/expenses`, {
    data: { status: 'submitted', amount: 75, category: 'materials', costCode: 'BROWSER-FC-100', vendor: 'Bouwmaat', receiptRef: 'BROWSER-FC-REVISION' }
  });
  expect(changedCost.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh data' }).click();
  row = finance.locator('.finance-item').filter({ hasText: intake.job.title });
  await expect(row).toContainText(/FC-\d{4}-\d{6} stale/);
  await expect(row.getByRole('button', { name: `Freeze revised cost forecast for ${intake.job.title}` })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="finance-workspace"]');
    return {
      pageWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      workspaceWidth: workspace?.scrollWidth || 0,
      workspaceClientWidth: workspace?.clientWidth || 0
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.workspaceWidth).toBeLessThanOrEqual(geometry.workspaceClientWidth);
});

test('job workspace remains horizontally contained on a mobile field viewport', async ({ page, request }) => {
  const intake = await createBrowserJob(request, 'Mobile browser job workspace');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: `Open ${intake.job.title}` }).first().click();

  const workspace = page.getByTestId('job-workspace');
  await expect(workspace).toBeVisible();
  const geometry = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="job-workspace"]');
    return {
      pageWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      workspaceWidth: workspace?.scrollWidth || 0,
      workspaceClientWidth: workspace?.clientWidth || 0
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.workspaceWidth).toBeLessThanOrEqual(geometry.workspaceClientWidth);

  await page.getByRole('button', { name: 'Open resource planner' }).click();
  const planner = page.getByTestId('resource-planner');
  await expect(planner).toBeVisible();
  const plannerGeometry = await planner.evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  expect(plannerGeometry.scrollWidth).toBeLessThanOrEqual(plannerGeometry.clientWidth);
});

test('owner investigates cursor-paged audit history with retained chain proof', async ({ page, request }) => {
  const suffix = Date.now();
  for (let index = 1; index <= 14; index += 1) {
    await createBrowserJob(request, `Browser audit history ${suffix}-${index}`, {
      assignAutomatically: false,
      client: { name: `Browser audit client ${suffix}-${index}`, email: `audit-${suffix}-${index}@example.test` }
    });
  }

  const apiHistoryResponse = await request.get('/api/ledger/audit?limit=2&includeFacets=true');
  expect(apiHistoryResponse.ok()).toBeTruthy();
  const apiHistory = await apiHistoryResponse.json();
  expect(apiHistory.page).toMatchObject({ limit: 2, returned: 2, hasMore: true });
  expect(apiHistory.facets.actions.some(facet => facet.value === 'create_intake_job')).toBeTruthy();
  expect(apiHistory.events.every(event => /^\w+$/.test(event.id)
    && /^[a-f0-9]{64}$/.test(event.previousHash)
    && /^[a-f0-9]{64}$/.test(event.eventHash))).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  const panel = page.getByTestId('audit-history-panel');
  await expect(panel).toBeVisible();
  const rows = panel.locator('.audit-history-row');
  await expect(rows).toHaveCount(25);
  const initialRowCount = await rows.count();
  const newestSequence = (await rows.first().locator('.audit-sequence strong').innerText()).replace('#', '');
  await panel.getByRole('button', { name: 'Load older events' }).click();
  await expect.poll(() => rows.count()).toBeGreaterThan(initialRowCount);
  const oldestSequence = (await rows.last().locator('.audit-sequence strong').innerText()).replace('#', '');
  await expect(panel.locator('.audit-history-summary code')).toHaveText(`#${newestSequence} to #${oldestSequence}`);

  await panel.getByLabel('Action').selectOption('create_intake_job');
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  const visibleActions = panel.locator('.audit-event-copy > div > strong');
  await expect.poll(async () => {
    const actions = await visibleActions.allTextContents();
    return actions.length > 0 && actions.every(action => action === 'create intake job');
  }).toBe(true);

  let inspectButton = rows.first().getByRole('button', { name: /Inspect audit event/ });
  await inspectButton.click();
  let modal = page.getByTestId('audit-event-detail');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.audit-chain-proof code')).toHaveCount(2);
  const hashes = await modal.locator('.audit-chain-proof code').allTextContents();
  expect(hashes.every(hash => /^[a-f0-9]{64}$/.test(hash))).toBeTruthy();
  const modalClose = modal.getByRole('button', { name: 'Close audit event detail' });
  await expect(modalClose).toBeFocused();
  await modalClose.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(inspectButton).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileGeometry = await panel.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    panelWidth: element.scrollWidth,
    panelClientWidth: element.clientWidth,
    filterColumns: getComputedStyle(element.querySelector('[data-testid="audit-history-filters"]')).gridTemplateColumns
  }));
  expect(mobileGeometry.pageWidth).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
  expect(mobileGeometry.panelWidth).toBeLessThanOrEqual(mobileGeometry.panelClientWidth);
  expect(mobileGeometry.filterColumns.trim().split(/\s+/)).toHaveLength(1);

  inspectButton = rows.first().getByRole('button', { name: /Inspect audit event/ });
  await inspectButton.click();
  modal = page.getByTestId('audit-event-detail');
  await expect(modal).toBeVisible();
  const modalGeometry = await modal.evaluate(element => ({
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(modalGeometry.left).toBeGreaterThanOrEqual(0);
  expect(modalGeometry.right).toBeLessThanOrEqual(modalGeometry.viewportWidth);
  expect(modalGeometry.scrollWidth).toBeLessThanOrEqual(modalGeometry.clientWidth);
});

test('operations distinguishes checksummed exports from restorable local backups', async ({ page, request }) => {
  const retained = await createBrowserJob(request, 'Browser backup evidence job', { service: 'Evidence retention' });
  const upload = await request.post('/api/ledger/upload', {
    headers: { 'Idempotency-Key': `browser-backup-${Date.now()}` },
    multipart: {
      evidenceFile: {
        name: 'browser-backup-proof.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('browser backup proof')])
      },
      jobId: retained.job.id,
      category: 'field_photo',
      riskLevel: 'low',
      notes: 'Evidence retained for the browser backup workflow.'
    }
  });
  expect(upload.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Operations' }).click();
  await expect(page.getByText('The JSON export is a checksummed, human-readable reconciliation record. It cannot restore the database or evidence files.')).toBeVisible();
  const [exportDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Export ledger' }).click()
  ]);
  expect(exportDownload.suggestedFilename()).toBe('contractor-ai-operational-export.json');
  const exportPath = await exportDownload.path();
  expect(exportPath).toBeTruthy();
  await page.locator('input[type="file"][accept="application/json"]').setInputFiles(exportPath);
  await expect(page.getByText(/Export checksum verified: \d+ jobs and \d+ approvals\. This artifact is for reconciliation, not restore\./)).toBeVisible();

  await page.getByRole('button', { name: 'Create backup' }).click();
  await expect(page.getByText(/Local backup created with \d+ checksummed file\(s\), including \d+ evidence file\(s\)\./)).toBeVisible();

  const backupsResponse = await request.get('/api/operations/backups');
  expect(backupsResponse.ok()).toBeTruthy();
  const backups = await backupsResponse.json();
  expect(backups.backups[0].format).toBe('contractor-ai-backup-manifest/v2');
  expect(backups.backups[0].evidenceFiles).toBeGreaterThan(0);
  expect(backups.backups[0].downloadAvailable).toBeTruthy();
  await page.getByRole('button', { name: 'Check restore' }).first().click();
  await expect(page.getByText(/passed \d+ file checks and the SQLite restore check\./)).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download' }).first().click()
  ]);
  expect(download.suggestedFilename()).toBe(`contractor-ai-backup-${backups.backups[0].backupId}.tar.gz`);
  expect(await download.failure()).toBeNull();
  const verification = await request.get(`/api/operations/backups/${encodeURIComponent(backups.backups[0].backupId)}/verify`);
  expect(verification.ok()).toBeTruthy();
  expect((await verification.json()).verification.valid).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileGeometry = await page.getByRole('heading', { name: 'Data safety' }).evaluate(heading => {
    const panel = heading.closest('section');
    const actions = panel?.querySelector('.operations-actions');
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      panelWidth: panel?.scrollWidth || 0,
      panelClientWidth: panel?.clientWidth || 0,
      actionsWidth: actions?.scrollWidth || 0,
      actionsClientWidth: actions?.clientWidth || 0
    };
  });
  expect(mobileGeometry.pageWidth).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
  expect(mobileGeometry.panelWidth).toBeLessThanOrEqual(mobileGeometry.panelClientWidth);
  expect(mobileGeometry.actionsWidth).toBeLessThanOrEqual(mobileGeometry.actionsClientWidth);
});

test('owner archives and restores a retained job through exact approval decisions', async ({ page, request }) => {
  const intake = await createBrowserJob(request, 'Browser archive lifecycle job', {
    service: 'Retained project lifecycle',
    assignAutomatically: false
  });
  await resolveAllPendingApprovals(request, intake.job.id);
  const portalAccessResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/client-portal-access`, {
    data: {
      label: 'Browser archive lifecycle portal',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }
  });
  expect(portalAccessResponse.ok()).toBeTruthy();
  const portalAccess = await portalAccessResponse.json();
  const portalApprovalResponse = await request.post(`/api/ledger/approvals/${portalAccess.access.approval.id}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Browser lifecycle approver',
      reason: 'Client portal scope and expiry were reviewed.'
    }
  });
  expect(portalApprovalResponse.ok()).toBeTruthy();
  const activePortalResponse = await request.get(`/api/client-portal/${portalAccess.access.portalToken}`);
  expect(activePortalResponse.ok()).toBeTruthy();
  const retainedResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  const retained = await retainedResponse.json();
  const retainedStatus = retained.job.status;
  const retainedPhase = retained.job.phase;

  await page.goto('/');
  await page.getByRole('button', { name: 'Jobs', exact: true }).click();
  await page.getByRole('button', { name: `Open ${intake.job.title}` }).click();
  const workspace = page.getByTestId('job-workspace');
  const archiveControl = workspace.getByTestId('job-archive-control');
  await expect(archiveControl).toBeVisible();
  await archiveControl.getByRole('button', { name: 'Request archive' }).click();

  let lifecycleModal = page.getByTestId('job-lifecycle-modal');
  await expect(lifecycleModal.getByRole('heading', { name: 'Request job archive' })).toBeVisible();
  await expect(lifecycleModal.getByText(/complete job ledger, evidence, finance, field, client, resource, and audit history/i)).toBeVisible();
  await expect(lifecycleModal.getByText(/makes the job read-only and revokes active client portal links/i)).toBeVisible();
  await lifecycleModal.getByLabel('Operational reason').fill('Browser QA completed the project and verified retained lifecycle controls.');
  await lifecycleModal.getByRole('button', { name: 'Request archive approval' }).click();
  await expect(page.getByText(/Archive decision retained/)).toBeVisible();

  const archiveApproval = page.locator('.approval-item').filter({ hasText: `Archive job: ${intake.job.title}` });
  await expect(archiveApproval).toHaveCount(1);
  await archiveApproval.getByRole('button', { name: 'Review and approve' }).click();
  let reviewModal = page.getByTestId('approval-review-modal');
  await expect(reviewModal.getByText(/Does not delete the job or any linked evidence/i)).toBeVisible();
  await expect(reviewModal.getByText(/Revoke 1 active client portal link/i)).toBeVisible();
  await expect(reviewModal.getByText(/not reactivated by restore/i)).toBeVisible();
  await reviewModal.getByLabel('Reviewer reason').fill('Browser QA verified record retention and removal from active internal workflows.');
  await reviewModal.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  const archivedResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  const archived = await archivedResponse.json();
  expect(archived.job).toMatchObject({ status: 'archived', phase: 'archived' });
  expect(archived.job.data.archive).toMatchObject({ active: true, previousStatus: retainedStatus, previousPhase: retainedPhase });
  expect(archived.job.data.archive.revokedPortalAccessIds).toEqual([portalAccess.access.id]);
  expect(archived.job.portalAccess.find(access => access.id === portalAccess.access.id)?.status).toBe('revoked');
  const closedPortalResponse = await request.get(`/api/client-portal/${portalAccess.access.portalToken}`);
  expect(closedPortalResponse.status()).toBe(404);

  await page.getByRole('button', { name: 'Operations', exact: true }).click();
  const registry = page.getByTestId('job-archive-registry');
  const archiveRow = registry.locator('.archive-registry-row').filter({ hasText: intake.job.title });
  await expect(archiveRow).toHaveCount(1);

  await page.setViewportSize({ width: 780, height: 900 });
  const tabletGeometry = await registry.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    registryWidth: element.scrollWidth,
    registryClientWidth: element.clientWidth
  }));
  expect(tabletGeometry.pageWidth).toBeLessThanOrEqual(tabletGeometry.viewportWidth);
  expect(tabletGeometry.registryWidth).toBeLessThanOrEqual(tabletGeometry.registryClientWidth);

  await page.setViewportSize({ width: 390, height: 844 });
  const registryGeometry = await registry.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    registryWidth: element.scrollWidth,
    registryClientWidth: element.clientWidth
  }));
  expect(registryGeometry.pageWidth).toBeLessThanOrEqual(registryGeometry.viewportWidth);
  expect(registryGeometry.registryWidth).toBeLessThanOrEqual(registryGeometry.registryClientWidth);

  await archiveRow.getByRole('button', { name: 'Request restore' }).click();
  lifecycleModal = page.getByTestId('job-lifecycle-modal');
  await expect(lifecycleModal.getByRole('heading', { name: 'Request job restore' })).toBeVisible();
  await lifecycleModal.getByLabel('Operational reason').fill('Browser QA verified this retained project must return to internal operations.');
  await lifecycleModal.getByRole('button', { name: 'Request restore approval' }).click();
  await expect(page.getByText(/Restore decision retained/)).toBeVisible();

  const restoreApproval = page.locator('.approval-item').filter({ hasText: `Restore job: ${intake.job.title}` });
  await expect(restoreApproval).toHaveCount(1);
  await restoreApproval.getByRole('button', { name: 'Review and approve' }).click();
  reviewModal = page.getByTestId('approval-review-modal');
  await expect(reviewModal.getByText(/archive history remains retained/i)).toBeVisible();
  await reviewModal.getByLabel('Reviewer reason').fill('Browser QA verified the retained pre-archive state and current safeguards.');
  await reviewModal.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Jobs', exact: true }).click();
  const restoredRow = page.locator('tbody tr').filter({ hasText: intake.job.title });
  await expect(restoredRow).toHaveCount(1);
  await expect(restoredRow.getByText(intake.job.title, { exact: true })).toBeVisible();

  const restoredResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  const restored = await restoredResponse.json();
  expect(restored.job).toMatchObject({ status: retainedStatus, phase: retainedPhase });
  expect(restored.job.data.archive.active).toBe(false);
  expect(restored.job.data.archiveHistory.map(event => event.operation)).toEqual(['archive', 'restore']);
  expect(restored.job.portalAccess.find(access => access.id === portalAccess.access.id)?.status).toBe('revoked');
  const auditResponse = await request.get(`/api/ledger/audit?jobId=${intake.job.id}&limit=100`);
  const audit = await auditResponse.json();
  expect(audit.events.map(event => event.action)).toEqual(expect.arrayContaining([
    'request_job_archive',
    'apply_job_archive',
    'revoke_client_portal_access',
    'request_job_restore',
    'apply_job_restore'
  ]));
  expect(audit.events.filter(event => ['apply_job_archive', 'apply_job_restore'].includes(event.action)).every(event => event.metadata.externalCommitments === 0)).toBe(true);
});

test('owner applies an exact safe automation draft and runs the durable cycle', async ({ page, request }) => {
  const commandJob = await createBrowserJob(request, 'Browser automation command job', { service: 'Deck repair' });
  const schedulerJob = await createBrowserJob(request, 'Browser durable scheduler job', { service: 'Roof repair' });
  const plannedSchedulerJob = await request.put(`/api/ledger/jobs/${schedulerJob.job.id}`, {
    data: { status: 'planned' }
  });
  expect(plannedSchedulerJob.ok()).toBeTruthy();
  const commandPlanResponse = await request.get(`/api/ledger/command-plan?mode=safe&limit=100&jobId=${commandJob.job.id}`);
  expect(commandPlanResponse.ok()).toBeTruthy();
  const commandPlan = await commandPlanResponse.json();
  const safeCommand = commandPlan.actions.find(action =>
    action.actionType === 'draft_capability_gap'
    && action.safeDraftable
    && !action.blocked
  );
  expect(safeCommand).toBeTruthy();

  await page.route('**/api/ledger/command-plan?limit=100&jobLimit=12', async route => {
    await new Promise(resolve => setTimeout(resolve, 6_000));
    await route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Operations' }).click();
  await expect(page.getByTestId('storage-readiness')).toContainText('local / verified');
  await expect(page.getByTestId('audit-integrity-readiness')).toContainText('verified /');
  await expect(page.getByText('Field retries').locator('..').locator('strong')).toHaveText('scoped + deduplicated');

  const automation = page.getByTestId('automation-control');
  await expect(automation.getByRole('heading', { name: 'Automation control' })).toBeVisible();
  await expect(automation.getByText('External commitments').locator('..').locator('strong')).toHaveText('0');
  await expect(automation.getByRole('button', { name: 'Apply selected' })).toBeDisabled();

  const safeCheckbox = automation.getByRole('checkbox', { name: `Select ${safeCommand.message}`, exact: true });
  await expect(safeCheckbox).toBeEnabled({ timeout: 15_000 });
  await safeCheckbox.check();
  await expect(automation.getByRole('button', { name: 'Apply 1 draft' })).toBeEnabled();
  await automation.getByRole('button', { name: 'Apply 1 draft' }).click();
  await expect(
    page.getByText('1 safe command-plan draft(s) retained; 0 action(s) skipped. External commitments remain zero.')
  ).toBeVisible({ timeout: 15_000 });
  await expect(safeCheckbox).toHaveCount(0);

  const commandDetailResponse = await request.get(`/api/ledger/jobs/${commandJob.job.id}`);
  expect(commandDetailResponse.ok()).toBeTruthy();
  const commandDetail = await commandDetailResponse.json();
  expect(commandDetail.job.audit.some(event => event.action === 'apply_today_command_plan')).toBeTruthy();
  expect(commandDetail.job.audit.some(event => event.action === 'apply_capability_gap_plan')).toBeTruthy();
  expect(commandDetail.job.communications.filter(item => item.status === 'sent')).toHaveLength(0);

  await automation.getByRole('button', { name: 'Run due cycle' }).click();
  await expect(page.getByText(/Durable cycle completed with \d+ internal draft action\(s\).*No external commitment was made\./)).toBeVisible();
  const schedulerResponse = await request.get('/api/ledger/scheduler');
  expect(schedulerResponse.ok()).toBeTruthy();
  const scheduler = await schedulerResponse.json();
  expect(scheduler.scheduler.job.lastCompletedAt).toBeTruthy();
  expect(scheduler.scheduler.job.lastResult.actionCount).toBeGreaterThan(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await automation.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
});

test('client portal records an inbound message and approval-gated selection response', async ({ page, request }) => {
  const title = 'Browser client portal courtyard renovation';
  const intake = await createBrowserJob(request, title, {
    description: 'Renew the courtyard paving and drainage channel.',
    address: 'Oudegracht 120, Utrecht',
    city: 'Utrecht'
  });
  const selectionResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/client-selections`, {
    data: {
      title: 'Bestratingskleur kiezen',
      status: 'pending_client',
      options: ['Lichtgrijs', 'Antraciet'],
      clientVisible: true,
      requiresApproval: false
    }
  });
  expect(selectionResponse.ok()).toBeTruthy();
  const selectionPayload = await selectionResponse.json();
  const accessResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/client-portal-access`, {
    data: { label: 'Courtyard project portal', expiresAt: '2027-01-01T23:59:59.000Z' }
  });
  expect(accessResponse.ok()).toBeTruthy();
  const access = await accessResponse.json();
  const approvalResponse = await request.post(`/api/ledger/approvals/${access.access.approval.id}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser portal approver', reason: 'Client-scoped project access verified.' }
  });
  expect(approvalResponse.ok()).toBeTruthy();

  const portalResponse = await page.goto(`/client-portal.html#token=${access.access.portalToken}`);
  expect(portalResponse.ok()).toBeTruthy();
  expect(portalResponse.headers()['x-robots-tag']).toBe('noindex, nofollow');
  expect(portalResponse.headers()['content-security-policy']).not.toContain('unsafe-inline');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Oudegracht 120, Utrecht')).toBeVisible();
  await expect(page.getByText('Veilige projectinzage')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bestratingskleur kiezen' })).toBeVisible();

  await page.getByLabel('Ik bevestig deze keuze').check();
  await page.getByLabel('Gekozen optie voor Bestratingskleur kiezen').selectOption('Lichtgrijs');
  await page.getByLabel('Toelichting (optioneel)').fill('De lichtgrijze steen komt overeen met het getoonde monster.');
  await page.getByRole('button', { name: 'Ter beoordeling indienen' }).click();
  await expect(page.getByText('Wacht op interne controle')).toBeVisible();
  await expect(page.getByText('Keuze: Lichtgrijs')).toBeVisible();

  await page.getByLabel('Onderwerp').fill('Afstemming bestratingskeuze');
  await page.getByLabel('Bericht').fill('Kunt u bevestigen wanneer de grijze steenkeuze wordt beoordeeld?');
  await page.getByRole('button', { name: 'Verstuur bericht' }).click();
  await expect(page.getByText('Uw bericht is toegevoegd aan het projectdossier.')).toBeVisible();

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  expect(detail.job.communications.some(item =>
    item.direction === 'inbound'
    && item.subject === 'Afstemming bestratingskeuze'
    && item.status === 'received'
  )).toBeTruthy();

  const pendingApprovalsResponse = await request.get('/api/ledger/approvals?status=pending&limit=100');
  expect(pendingApprovalsResponse.ok()).toBeTruthy();
  const pendingApprovals = await pendingApprovalsResponse.json();
  const selectionApproval = pendingApprovals.approvals.find(item =>
    item.targetType === 'client_selection_response'
    && item.data.selectionId === selectionPayload.clientSelection.id
  );
  expect(selectionApproval).toBeTruthy();
  expect(selectionApproval.decision.preview.selectedOption).toBe('Lichtgrijs');

  await page.goto('/');
  await page.locator('.side-nav').getByRole('button', { name: /^Approvals/ }).click();
  const clientResponseApproval = page.locator('.approval-item').filter({
    hasText: 'Record the client\'s selected option for Bestratingskleur kiezen.'
  });
  await expect(clientResponseApproval).toHaveCount(1);
  await clientResponseApproval.getByRole('button', { name: 'Review and approve' }).click();
  const reviewModal = page.getByTestId('approval-review-modal');
  await expect(reviewModal).toBeVisible();
  await expect(reviewModal.getByText('Lichtgrijs', { exact: true })).toBeVisible();
  await expect(reviewModal.getByText(/does not change price, scope, schedule/i)).toBeVisible();
  await reviewModal.getByLabel('Reviewer reason').fill('Client identity, sample choice, scope, and downstream impact verified.');
  await reviewModal.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  await page.goto(`/client-portal.html#token=${access.access.portalToken}`);
  await expect(page.getByText('Reactie verwerkt')).toBeVisible();
  await expect(page.getByText('Vastgelegde keuze:')).toBeVisible();
  await expect(page.getByText('Lichtgrijs', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await page.locator('.client-portal-shell').evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    shellWidth: element.scrollWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.shellWidth).toBeLessThanOrEqual(geometry.viewportWidth);
});

test('replacement crew completes assignment-scoped instruction and access approvals', async ({ page, request }) => {
  const scheduledStart = new Date(Date.now() + 12 * 86_400_000).toISOString();
  const scheduledEnd = new Date(Date.now() + 12 * 86_400_000 + 6 * 3_600_000).toISOString();
  const intake = await createBrowserJob(request, `Browser replacement crew integrity ${Date.now()}`, {
    service: 'Replacement crew dispatch verification',
    status: 'scheduled',
    scheduledStart,
    scheduledEnd,
    assignAutomatically: false
  });
  const createWorker = async name => {
    const response = await request.post('/api/ledger/workers', {
      data: { name, role: 'Site installer', status: 'available', skills: ['installation'] }
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).worker;
  };
  const originalWorker = await createWorker(`Browser original crew ${Date.now()}`);
  const replacementWorker = await createWorker(`Browser replacement crew ${Date.now()}`);
  const originalAssignmentResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/assignments`, {
    data: { workerId: originalWorker.id, status: 'planned', scheduledStart, scheduledEnd }
  });
  expect(originalAssignmentResponse.ok()).toBeTruthy();
  const originalAssignment = (await originalAssignmentResponse.json()).assignment;
  const originalPrepResponse = await request.post('/api/ledger/schedule/prepare-dispatch', {
    data: { jobId: intake.job.id, actor: 'browser-replacement-crew-setup' }
  });
  expect(originalPrepResponse.ok()).toBeTruthy();
  const originalPrep = await originalPrepResponse.json();
  const originalInstruction = originalPrep.job.workerInstructions.find(record => record.assignmentId === originalAssignment.id);
  const originalOrientation = originalPrep.job.orientations.find(record => record.assignmentId === originalAssignment.id);
  const originalAccess = originalPrep.job.siteAccessLogs.find(record => record.assignmentId === originalAssignment.id);
  expect(originalInstruction).toBeTruthy();
  expect(originalOrientation).toBeTruthy();
  expect(originalAccess).toBeTruthy();

  const approveLifecycle = async (recordType, recordId, data) => {
    const transitionResponse = await request.patch(`/api/ledger/jobs/${intake.job.id}/lifecycle/${recordType}/${recordId}`, { data });
    expect(transitionResponse.ok()).toBeTruthy();
    const transition = await transitionResponse.json();
    const approvalResponse = await request.post(`/api/ledger/approvals/${transition.approval.id}/resolve`, {
      data: { status: 'approved', resolvedBy: 'Browser fixture approver', reason: 'Original crew fixture evidence verified before replacement.' }
    });
    expect(approvalResponse.ok()).toBeTruthy();
  };
  await approveLifecycle('worker_instruction', originalInstruction.id, {
    status: 'published',
    notes: 'Original crew scope, route, tools, PPE, and stop-work controls were reviewed.'
  });
  await approveLifecycle('orientation', originalOrientation.id, {
    status: 'completed',
    verificationReference: 'BROWSER-ORIGINAL-ORIENTATION',
    notes: 'Original crew identity, site rules, emergency controls, and assignment were verified.'
  });
  await approveLifecycle('site_access', originalAccess.id, {
    status: 'cleared',
    notes: 'Original crew access was approved for the retained assignment only.'
  });

  const releaseResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/assignments/${originalAssignment.id}/release`, {
    data: { reason: 'Browser QA replaces the original worker before dispatch.' }
  });
  expect(releaseResponse.ok()).toBeTruthy();
  expect((await releaseResponse.json()).assignment.invalidatedCrewEvidence).toEqual({
    instructions: 1,
    orientations: 1,
    siteAccess: 1,
    approvalTargets: 3
  });
  const replacementAssignmentResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/assignments`, {
    data: { workerId: replacementWorker.id, status: 'planned', scheduledStart, scheduledEnd }
  });
  expect(replacementAssignmentResponse.ok()).toBeTruthy();
  const replacementAssignment = (await replacementAssignmentResponse.json()).assignment;
  await resolveAllPendingApprovals(request, intake.job.id);

  await page.goto('/');
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  const resources = page.getByTestId('resources-workspace');
  let resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await expect(resourceRow.getByText('3 historical crew records')).toBeVisible();
  await expect(resourceRow.getByRole('button', { name: `Draft crew instructions for ${intake.job.title}` })).toBeVisible();
  await expect(resourceRow.getByRole('button', { name: `Orientation evidence for ${intake.job.title}` })).toBeVisible();

  await resourceRow.getByRole('button', { name: `Draft crew instructions for ${intake.job.title}` }).click();
  await expect(page.getByText('Internal crew instructions were drafted. Nothing was published or delivered.')).toBeVisible();
  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: `Review and request instruction approval for ${intake.job.title}` }).click();
  let fieldModal = page.getByTestId('field-assurance-modal');
  await expect(fieldModal.getByRole('heading', { name: 'Review and request instruction approval' })).toBeVisible();
  await fieldModal.getByLabel('Evidence and decision').fill('Replacement worker identity, scope, route, equipment, PPE, and stop-work controls were verified.');
  await fieldModal.getByRole('button', { name: 'Request approver review' }).click();
  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: 'Review approval' }).click();
  const instructionApproval = page.locator('.approval-item').filter({ hasText: /worker instruction/i });
  await expect(instructionApproval).toHaveCount(1);
  await approveQueueItem(page, instructionApproval, 'Replacement worker instructions and assignment identity were verified.');

  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: `Orientation evidence for ${intake.job.title}` }).click();
  let resourceModal = page.getByTestId('resource-control-modal');
  await resourceModal.getByLabel('Orientation verification reference').fill('BROWSER-REPLACEMENT-ORIENTATION');
  await resourceModal.getByLabel('Internal evidence and notes').fill('Replacement crew identity, PPE, emergency rules, site boundaries, and stop-work control were verified.');
  await resourceModal.getByRole('button', { name: 'Request orientation approval' }).click();
  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: 'Review approval' }).click();
  const orientationApproval = page.locator('.approval-item').filter({ hasText: /worker orientation/i });
  await expect(orientationApproval).toHaveCount(1);
  await approveQueueItem(page, orientationApproval, 'Replacement worker orientation evidence and assignment identity were verified.');

  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: `Site-access gate for ${intake.job.title}` }).click();
  resourceModal = page.getByTestId('resource-control-modal');
  await resourceModal.getByLabel('Internal evidence and notes').fill('Replacement orientation was matched to the active assignment; access remains blocked for approval.');
  await resourceModal.getByRole('button', { name: 'Create access gate' }).click();
  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: `Request site-access clearance for ${intake.job.title}` }).click();
  fieldModal = page.getByTestId('field-assurance-modal');
  await fieldModal.getByLabel('Evidence and decision').fill('Replacement identity, current orientation, access point, and retained assignment were verified.');
  await fieldModal.getByRole('button', { name: 'Request approver review' }).click();
  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await resourceRow.getByRole('button', { name: 'Review approval' }).click();
  const accessApproval = page.locator('.approval-item').filter({ hasText: /site access/i });
  await expect(accessApproval).toHaveCount(1);
  await approveQueueItem(page, accessApproval, 'Replacement worker access and assignment linkage were verified.');

  await expect
    .poll(async () => {
      const response = await request.get('/api/ledger/workforce?mode=all&limit=500');
      if (!response.ok()) return `http-${response.status()}`;
      const workforce = await response.json();
      return workforce.jobs.find(job => job.jobId === intake.job.id)?.workforceStatus || 'missing';
    })
    .toBe('stable');
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh data' }).click();
  resourceRow = resources.locator('.resource-readiness-item').filter({ hasText: intake.job.title });
  await expect(resourceRow.getByText('stable', { exact: true })).toBeVisible();
  await expect(resourceRow.getByText('3 historical crew records')).toBeVisible();

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  const replacementInstruction = detail.job.workerInstructions.find(record => record.assignmentId === replacementAssignment.id);
  const replacementOrientation = detail.job.orientations.find(record => record.assignmentId === replacementAssignment.id);
  const replacementAccess = detail.job.siteAccessLogs.find(record => record.assignmentId === replacementAssignment.id);
  expect(replacementInstruction.workerId).toBe(replacementWorker.id);
  expect(['approved', 'published', 'sent', 'dispatched']).toContain(replacementInstruction.status);
  expect(replacementOrientation).toMatchObject({ workerId: replacementWorker.id, status: 'completed' });
  expect(replacementAccess).toMatchObject({ workerId: replacementWorker.id, status: 'cleared', orientationId: replacementOrientation.id });
});
