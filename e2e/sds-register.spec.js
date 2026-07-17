const { test, expect } = require('@playwright/test');

test('office operator retains and approves a governed SDS revision in the field workspace', async ({ page, request }) => {
  const marker = Date.now();
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title: `Browser governed SDS ${marker}`,
      client: { name: `Browser SDS client ${marker}` },
      service: 'Industrial floor coating',
      status: 'in_progress',
      riskLevel: 'high',
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const intake = await intakeResponse.json();

  const uploadResponse = await request.post('/api/ledger/upload', {
    headers: { 'Idempotency-Key': `browser-sds-upload-${marker}` },
    multipart: {
      evidenceFile: {
        name: `browser-manufacturer-sds-${marker}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nBrowser SDS ${marker}\n%%EOF`)
      },
      jobId: intake.job.id,
      category: 'sds_pdf',
      riskLevel: 'high',
      notes: 'Manufacturer SDS retained for governed browser workflow verification.'
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

  const register = page.getByTestId('sds-register-control');
  const field = name => register.getByLabel(name, { exact: true });
  await expect(register).toBeVisible();
  await field('Job').selectOption(intake.job.id);
  await expect(register.getByText('No SDS revision is retained for this job.')).toBeVisible();
  await expect(register.getByText('0 current')).toBeVisible();

  await field('Product name').fill('Browser two-component epoxy');
  await field('Manufacturer').fill('Browser Coatings Europe BV');
  await field('Product code').fill(`BROWSER-2K-${marker}`);
  await field('Retained PDF').selectOption(upload.ledgerDocument.id);
  await field('Hazard classes').fill('H315 - Causes skin irritation\nH319 - Causes serious eye irritation');
  await field('Required PPE').fill('Chemical-resistant gloves\nSafety goggles');
  await field('First-aid measures').fill('Rinse exposed skin or eyes and obtain medical advice when symptoms persist.');
  await field('Fire measures').fill('Use foam, dry powder, or carbon dioxide and control contaminated run-off.');
  await field('Handling and storage').fill('Keep sealed in a ventilated area away from heat and incompatible materials.');
  await field('Spill response').fill('Ventilate, contain with inert absorbent, and prevent entry into drains.');
  await field('Disposal controls').fill('Use an authorized waste contractor for product and contaminated absorbent.');
  await field('Emergency contact').fill('Browser Coatings emergency line +31 20 555 0199.');
  await field('Revision reason').fill('Manufacturer PDF and operational controls reviewed for field reliance.');
  await register.getByRole('button', { name: 'Request current-status approval' }).click();

  await expect(page.getByText('The SDS revision was frozen for approval. It is not current until an approver verifies the retained source.')).toBeVisible();
  await expect(register.getByText('1 review')).toBeVisible();
  await expect(register.getByText('pending approval', { exact: true })).toBeVisible();
  await expect(register.getByRole('button', { name: 'Open approval' })).toBeVisible();

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  const pending = detail.job.sdsSheets.find(sheet => sheet.status === 'pending_approval');
  expect(pending).toBeTruthy();
  const approvalResponse = await request.post(`/api/ledger/approvals/${pending.approvalId}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Browser SDS approver',
      reason: 'Manufacturer PDF, identity, dates, hazards, PPE, and emergency controls verified.'
    }
  });
  expect(approvalResponse.ok()).toBeTruthy();

  await register.getByRole('button', { name: 'Refresh SDS register' }).click();
  await expect(register.getByText('1 current')).toBeVisible();
  await expect(register.getByText('Current', { exact: true })).toBeVisible();
  await expect(register.getByText('Verified')).toBeVisible();
  await expect(register.getByRole('link', { name: 'Open retained PDF' })).toHaveAttribute(
    'href',
    `/api/ledger/documents/${upload.ledgerDocument.id}/content`
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
