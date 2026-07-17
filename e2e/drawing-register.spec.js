const { test, expect } = require('@playwright/test');

test('office operator retains and approves a governed drawing revision in the field workspace', async ({ page, request }) => {
  const marker = Date.now();
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title: `Browser governed drawing ${marker}`,
      client: { name: `Browser drawing client ${marker}` },
      service: 'Commercial renovation',
      status: 'in_progress',
      riskLevel: 'high',
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const intake = await intakeResponse.json();

  const uploadResponse = await request.post('/api/ledger/upload', {
    headers: { 'Idempotency-Key': `browser-drawing-upload-${marker}` },
    multipart: {
      evidenceFile: {
        name: `browser-A-301-C01-${marker}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nBrowser drawing ${marker}\n%%EOF`)
      },
      jobId: intake.job.id,
      category: 'drawing_pdf',
      riskLevel: 'high',
      notes: 'Construction drawing retained for governed browser workflow verification.'
    }
  });
  expect(uploadResponse.ok()).toBeTruthy();
  const upload = await uploadResponse.json();
  expect(upload.ledgerDocument.data.analysis.upload.sha256).toMatch(/^[a-f0-9]{64}$/);

  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/');
  await expect(page).toHaveTitle(/Contractor\.AI/i);
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();

  const register = page.getByTestId('drawing-register-control');
  const field = name => register.getByLabel(name, { exact: true });
  await expect(register).toBeVisible();
  await field('Drawing job').selectOption(intake.job.id);
  await expect(register.getByText('No governed drawing revision is retained for this job.')).toBeVisible();
  await expect(register.getByText('0 current')).toBeVisible();

  await field('Sheet number').fill('A-301');
  await field('Revision').fill('C01');
  await field('Drawing title').fill('Ground-floor coordinated construction plan');
  await field('Drawing discipline').selectOption('architecture');
  await field('Drawing purpose').selectOption('for_construction');
  await field('Scale').fill('1:50');
  await field('Zone or area').fill('Ground floor');
  await field('Retained drawing PDF').selectOption(upload.ledgerDocument.id);
  await field('Revision reason').fill('Initial coordinated construction issue retained for controlled field use.');
  await field('Internal review notes').fill('Title block, revision, scale, and issue purpose checked.');
  await register.getByRole('button', { name: 'Request publication approval' }).click();

  await expect(page.getByText('The drawing was frozen for approval. It is not field-current until an approver verifies the retained source.')).toBeVisible();
  await expect(register.getByText('1 review')).toBeVisible();
  await expect(register.getByText('pending approval', { exact: true })).toBeVisible();
  await expect(register.getByRole('button', { name: 'Open approval' })).toBeVisible();

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  const pending = detail.job.drawings.find(drawing => drawing.status === 'pending_approval');
  expect(pending).toBeTruthy();
  const approvalResponse = await request.post(`/api/ledger/approvals/${pending.approvalId}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Browser drawing approver',
      reason: 'PDF checksum, title block, issue purpose, and revision lineage verified.'
    }
  });
  expect(approvalResponse.ok()).toBeTruthy();

  await register.getByRole('button', { name: 'Refresh drawing register' }).click();
  await expect(register.getByText('1 current')).toBeVisible();
  await expect(register.getByText('Current', { exact: true })).toBeVisible();
  await expect(register.getByText(/Verified [a-f0-9]{8}/)).toBeVisible();
  await expect(register.getByRole('link', { name: 'Open retained PDF' })).toHaveAttribute(
    'href',
    `/api/ledger/documents/${pending.id}/content`
  );
  await expect(register.getByRole('button', { name: 'New revision' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileGeometry = await register.evaluate(element => {
    const form = element.querySelector('.sds-revision-form');
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      registerWidth: element.scrollWidth,
      registerClientWidth: element.clientWidth,
      formWidth: form?.scrollWidth || 0,
      formClientWidth: form?.clientWidth || 0,
      formColumns: form ? getComputedStyle(form.querySelector('.form-grid')).gridTemplateColumns : ''
    };
  });
  expect(mobileGeometry.pageWidth).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
  expect(mobileGeometry.registerWidth).toBeLessThanOrEqual(mobileGeometry.registerClientWidth);
  expect(mobileGeometry.formWidth).toBeLessThanOrEqual(mobileGeometry.formClientWidth);
  expect(mobileGeometry.formColumns.trim().split(/\s+/)).toHaveLength(1);
  expect(consoleErrors).toEqual([]);
});
