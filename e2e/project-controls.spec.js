const { test, expect } = require('@playwright/test');

async function createJob(request, title) {
  const response = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Interior renovation',
      status: 'planned',
      client: { name: 'Browser project controls client', email: 'project-controls@example.test' },
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

async function approve(request, approvalId, reason) {
  const response = await request.post(`/api/ledger/approvals/${approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Browser project controls owner', reason }
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

test('operator manages RFIs, submittals, and approval-backed controlled revisions', async ({ page, request }) => {
  const title = `Browser project controls ${Date.now()}`;
  const intake = await createJob(request, title);
  let workspace = await openJob(page, title);
  let controls = workspace.getByTestId('project-controls');
  await expect(controls.getByRole('heading', { name: 'Project controls' })).toBeVisible();
  await expect(controls.getByText('Open RFIs')).toBeVisible();

  await controls.getByRole('button', { name: 'New RFI' }).click();
  const rfiForm = controls.getByTestId('create-rfi-form');
  await rfiForm.getByLabel('RFI subject').fill('Confirm wall opening support');
  await rfiForm.getByLabel('Question').fill('Confirm the required lintel before the opening is enlarged.');
  await rfiForm.getByLabel('Responsible').fill('Structural engineer');
  await rfiForm.getByLabel('Discipline').selectOption('structural');
  await rfiForm.getByRole('button', { name: 'Retain RFI' }).click();
  await expect(page.getByText('RFI retained in the project decision trail.')).toBeVisible();
  const rfiRow = controls.locator('.project-control-row').filter({ hasText: 'Confirm wall opening support' });
  await expect(rfiRow).toBeVisible();
  await rfiRow.getByRole('button', { name: 'Answer' }).click();
  const rfiReview = controls.getByTestId('project-control-review-form');
  await rfiReview.getByLabel('Response and evidence').fill('Use the retained L120 lintel detail after engineer verification.');
  await rfiReview.getByRole('button', { name: 'Request answer approval' }).click();
  await expect(page.getByText(/retained for explicit approval/i)).toBeVisible();

  let detail = await jobDetail(request, intake.job.id);
  const rfi = detail.rfis.find(record => record.title === 'Confirm wall opening support');
  const rfiApproval = detail.approvals.find(item => item.targetType === 'rfi_record' && item.targetId === rfi.id && item.status === 'pending');
  expect(rfiApproval).toBeTruthy();
  await approve(request, rfiApproval.id, 'Engineer response and retained lintel detail verified.');

  workspace = await openJob(page, title);
  controls = workspace.getByTestId('project-controls');
  await expect(controls.locator('.project-control-row').filter({ hasText: 'Confirm wall opening support' }).getByText('answered', { exact: true })).toBeVisible();
  await controls.getByRole('tab', { name: /Submittals/ }).click();
  await controls.getByRole('button', { name: 'New submittal' }).click();
  const submittalForm = controls.getByTestId('create-submittal-form');
  await submittalForm.getByLabel('Submittal title').fill('Lintel product data');
  await submittalForm.getByLabel('Package / spec section').fill('05 50 00');
  await submittalForm.getByLabel('Material').fill('Galvanized steel lintel');
  await submittalForm.getByLabel('Attachment references').fill('private:lintel-data-sheet');
  await submittalForm.getByRole('button', { name: 'Retain submittal' }).click();
  await expect(page.getByText('Submittal draft retained for technical review.')).toBeVisible();
  const submittalRow = controls.locator('.project-control-row').filter({ hasText: 'Lintel product data' });
  await submittalRow.getByRole('button', { name: 'Submit' }).click();
  const submitReview = controls.getByTestId('project-control-review-form');
  await submitReview.getByRole('button', { name: 'Mark submitted' }).click();
  await expect(submittalRow.getByText('submitted', { exact: true })).toBeVisible();
  await submittalRow.getByRole('button', { name: 'Request approval' }).click();
  const submittalApprovalForm = controls.getByTestId('project-control-review-form');
  await submittalApprovalForm.getByLabel('Review evidence').fill('Product data matches the specified load and corrosion class.');
  await submittalApprovalForm.getByRole('button', { name: 'Request submittal approval' }).click();

  await controls.getByRole('tab', { name: /Documents/ }).click();
  await controls.getByRole('button', { name: 'New revision' }).click();
  let documentForm = controls.getByTestId('create-controlled-document-form');
  await documentForm.getByLabel('Document title').fill('Ground-floor construction plan');
  await documentForm.getByLabel('Document number').fill('A-101');
  await documentForm.getByLabel('Revision', { exact: true }).fill('P01');
  await documentForm.getByLabel('Discipline').selectOption('architectural');
  await documentForm.getByLabel('Retained file or source reference').fill('private:A-101-P01');
  await documentForm.getByRole('button', { name: 'Retain revision' }).click();
  await expect(page.getByText(/prior approved revision remains current until approval/i)).toBeVisible();
  let firstDocumentRow = controls.locator('.project-control-row').filter({ hasText: 'A-101 / rev P01' });
  await firstDocumentRow.getByRole('button', { name: 'Review revision' }).click();
  let documentReview = controls.getByTestId('project-control-review-form');
  await documentReview.getByLabel('Review reference').fill('check:A-101-P01');
  await documentReview.getByLabel('Review evidence').fill('Initial construction issue checked against scope and dimensions.');
  await documentReview.getByRole('button', { name: 'Request revision approval' }).click();

  detail = await jobDetail(request, intake.job.id);
  const firstDocument = detail.documents.find(record => record.documentNumber === 'A-101' && record.revision === 'P01');
  const firstApproval = detail.approvals.find(item => item.targetType === 'document' && item.targetId === firstDocument.id && item.status === 'pending');
  await approve(request, firstApproval.id, 'Initial plan source and checker evidence verified.');

  workspace = await openJob(page, title);
  controls = workspace.getByTestId('project-controls');
  await controls.getByRole('tab', { name: /Documents/ }).click();
  firstDocumentRow = controls.locator('.project-control-row').filter({ hasText: 'A-101 / rev P01' });
  await expect(firstDocumentRow.getByText('Current', { exact: true })).toBeVisible();
  await controls.getByRole('button', { name: 'New revision' }).click();
  documentForm = controls.getByTestId('create-controlled-document-form');
  await documentForm.getByLabel('Document title').fill('Ground-floor construction plan');
  await documentForm.getByLabel('Document number').fill('A-101');
  await documentForm.getByLabel('Revision', { exact: true }).fill('P02');
  await documentForm.getByLabel('Discipline').selectOption('architectural');
  await documentForm.getByLabel('Retained file or source reference').fill('private:A-101-P02');
  await documentForm.getByLabel('Revision reason').fill('Wall opening detail coordinated with the approved lintel.');
  await documentForm.getByRole('button', { name: 'Retain revision' }).click();
  const secondDocumentRow = controls.locator('.project-control-row').filter({ hasText: 'A-101 / rev P02' });
  await expect(secondDocumentRow.getByText('draft', { exact: true })).toBeVisible();
  await expect(firstDocumentRow.getByText('Current', { exact: true })).toBeVisible();

  await controls.getByRole('tab', { name: /Transmittals/ }).click();
  await controls.getByRole('button', { name: 'New transmittal' }).click();
  const transmittalForm = controls.getByTestId('create-transmittal-form');
  await transmittalForm.getByLabel('Transmittal subject').fill('Construction issue package');
  await transmittalForm.getByLabel('Purpose').selectOption('for_construction');
  await transmittalForm.getByLabel('Recipients').fill('Site supervisor <site@example.test>');
  await transmittalForm.getByLabel(/A-101 \/ rev P01/).check();
  await transmittalForm.getByLabel('Message').fill('Use the approved P01 revision until a later revision is approved.');
  await transmittalForm.getByRole('button', { name: 'Prepare transmittal' }).click();
  await expect(page.getByText('Transmittal package retained for approval. No files or messages were sent.')).toBeVisible();

  detail = await jobDetail(request, intake.job.id);
  const transmittal = detail.transmittals.find(record => record.subject === 'Construction issue package');
  expect(transmittal).toBeTruthy();
  const transmittalApproval = detail.approvals.find(item => item.targetType === 'document_transmittal' && item.targetId === transmittal.id && item.status === 'pending');
  expect(transmittalApproval).toBeTruthy();
  await approve(request, transmittalApproval.id, 'Current revision, recipient register, purpose, and package digest verified.');

  workspace = await openJob(page, title);
  controls = workspace.getByTestId('project-controls');
  await controls.getByRole('tab', { name: /Transmittals/ }).click();
  let transmittalRow = controls.locator('.project-control-row').filter({ hasText: 'Construction issue package' });
  await transmittalRow.getByRole('button', { name: 'Record issue' }).click();
  let transmittalReview = controls.getByTestId('project-control-review-form');
  await transmittalReview.getByLabel('Delivery evidence reference').fill('provider-message:browser-project-controls');
  await transmittalReview.getByRole('button', { name: 'Record transmittal issue' }).click();
  await expect(page.getByText(/issue evidence retained/i)).toBeVisible();

  transmittalRow = controls.locator('.project-control-row').filter({ hasText: 'Construction issue package' });
  await transmittalRow.getByRole('button', { name: 'Record receipt' }).click();
  transmittalReview = controls.getByTestId('project-control-review-form');
  await transmittalReview.getByLabel('Acknowledgment evidence reference').fill('mail-receipt:browser-site-supervisor');
  await transmittalReview.getByRole('button', { name: 'Record acknowledgment' }).click();
  await expect(page.getByText(/is fully acknowledged/i)).toBeVisible();
  await expect(transmittalRow.getByText('acknowledged', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await controls.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);

  const resourceBox = await page.getByRole('button', { name: 'Open resource planner' }).boundingBox();
  const archiveBox = await page.getByTestId('request-job-archive').boundingBox();
  expect(resourceBox).toBeTruthy();
  expect(archiveBox).toBeTruthy();
  const controlsOverlap = !(
    resourceBox.x + resourceBox.width <= archiveBox.x
    || archiveBox.x + archiveBox.width <= resourceBox.x
    || resourceBox.y + resourceBox.height <= archiveBox.y
    || archiveBox.y + archiveBox.height <= resourceBox.y
  );
  expect(controlsOverlap).toBe(false);
});
