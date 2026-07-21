const { test, expect } = require('@playwright/test');

async function retainFixedPriceBasis(request, jobId, entryKey) {
  const basisResponse = await request.get(`/api/ledger/jobs/${jobId}/pricing-basis`);
  expect(basisResponse.ok()).toBeTruthy();
  const basis = (await basisResponse.json()).pricingBasis;
  const response = await request.post(`/api/ledger/jobs/${jobId}/pricing-decisions`, {
    data: {
      entryKey,
      selectedModel: 'fixed_price',
      rationale: 'The measured scope and governed rate evidence support a fixed-price estimate.',
      factors: basis.factors.map(factor => ({
        key: factor.key,
        status: 'yes',
        evidence: `${factor.label} is verified in the measured-scope browser fixture.`
      }))
    }
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).decision;
}

test('operator measures scope and seals it into one approval-gated estimate', async ({ page, request }) => {
  const key = Date.now();
  const title = `Browser measured scope ${key}`;
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Interior renovation',
      client: { name: `Browser Measurement Client ${key}`, email: 'measurement@example.test', country: 'NL' },
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const intake = await intakeResponse.json();

  await page.goto('/');
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  const workspace = page.getByTestId('job-workspace');
  const takeoffControl = workspace.getByTestId('takeoff-control');
  await expect(takeoffControl.getByRole('heading', { name: 'WBS & quantity takeoff' })).toBeVisible();
  await expect(takeoffControl.getByText('No WBS or quantity takeoffs')).toBeVisible();

  const ratePolicyControl = takeoffControl.getByTestId('estimate-rate-policy-control');
  await expect(ratePolicyControl).toContainText('Estimating rate policy required');
  await ratePolicyControl.getByRole('button', { name: 'Configure rates' }).click();
  let ratePolicyDialog = page.getByRole('dialog', { name: 'Estimating rate policy revision' });
  await ratePolicyDialog.getByLabel('Policy name').fill('Browser governed rates');
  await ratePolicyDialog.getByLabel('Target margin (%)').fill('20');
  await ratePolicyDialog.getByLabel('Class code').fill('CRAFT');
  await ratePolicyDialog.getByLabel('Class name').fill('Qualified craft labour');
  await ratePolicyDialog.getByLabel('Base hourly rate').fill('40');
  await ratePolicyDialog.getByLabel('Paid leave (%)').fill('10');
  await ratePolicyDialog.getByLabel('Employer costs (%)').fill('20');
  await ratePolicyDialog.getByLabel('Pension and benefits (%)').fill('5');
  await ratePolicyDialog.getByLabel('Insurance and other (%)').fill('5');
  await ratePolicyDialog.getByLabel('Productive utilization (%)').fill('70');
  await ratePolicyDialog.getByLabel('Annual overhead').fill('60000');
  await ratePolicyDialog.getByLabel('Annual productive labour hours').fill('2000');
  await ratePolicyDialog.getByLabel('Revision reason').fill('Establish verified labour burden, overhead, and margin assumptions.');
  await ratePolicyDialog.getByRole('button', { name: 'Request approval' }).click();
  await expect(page.getByText('Estimating rate policy revision retained for approval.')).toBeVisible();

  const pendingResponse = await request.get('/api/ledger/estimate-rates');
  expect(pendingResponse.ok()).toBeTruthy();
  const pendingRegister = (await pendingResponse.json()).estimateRates;
  const pendingPolicy = pendingRegister.pendingPolicies.find(policy => policy.policyName === 'Browser governed rates');
  expect(pendingPolicy?.approvalId).toBeTruthy();
  const approvalResponse = await request.post(`/api/ledger/approvals/${pendingPolicy.approvalId}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Browser commercial approver',
      reason: 'Labour burden, overhead recovery, and target margin assumptions verified.'
    }
  });
  expect(approvalResponse.ok()).toBeTruthy();

  await workspace.getByRole('button', { name: 'Close job workspace' }).click();
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  await expect(ratePolicyControl).toContainText('Browser governed rates / v1');
  await expect(ratePolicyControl.getByRole('button', { name: 'Revise rates' })).toBeVisible();

  await takeoffControl.getByRole('button', { name: 'New takeoff' }).click();
  const createModal = page.getByTestId('takeoff-create-modal');
  await createModal.getByLabel('Takeoff title').fill('Ground floor measured scope');
  await createModal.getByLabel('VAT rate (%)').fill('21');
  await createModal.getByLabel('Internal notes').fill('Measured from drawing A-101 revision P02.');
  await createModal.getByRole('button', { name: 'Retain takeoff' }).click();
  await expect(page.getByText('Quantity takeoff retained as an internal draft. No estimate or external commitment was created.')).toBeVisible();

  const sheet = takeoffControl.locator('.takeoff-sheet').filter({ hasText: 'Ground floor measured scope' });
  await expect(sheet).toHaveCount(1);
  await sheet.getByRole('button', { name: 'Measurement' }).click();
  let itemModal = page.getByTestId('takeoff-item-modal');
  await itemModal.getByLabel('Description').fill('Ceramic floor tiles');
  await itemModal.getByLabel('Category').selectOption('material');
  await itemModal.getByLabel('Measurement type').selectOption('area');
  await itemModal.getByRole('spinbutton', { name: 'Count', exact: true }).fill('1');
  await itemModal.getByLabel('Length (m)').fill('5');
  await itemModal.getByLabel('Width (m)').fill('4');
  await itemModal.getByLabel('Waste (%)').fill('10');
  await itemModal.getByLabel('Unit cost').fill('20');
  await itemModal.getByLabel('Unit sell price').fill('35');
  await itemModal.getByLabel('Cost code').fill('FIN-220');
  await itemModal.getByLabel('WBS code').fill('03.20');
  await itemModal.getByLabel('Work package').fill('Floor finishes');
  await itemModal.getByLabel('Drawing / source reference').fill('A-101 P02');
  await expect(itemModal.getByLabel('Calculated measurement preview')).toContainText('22 m2');
  await expect(itemModal.getByLabel('Calculated measurement preview')).toContainText('€ 770,00');
  await itemModal.getByRole('button', { name: 'Retain measurement' }).click();
  await expect(page.getByText('Takeoff measurement calculated and retained.')).toBeVisible();
  await expect(sheet.getByText('22 m2')).toBeVisible();
  await expect(sheet.getByText('A-101 P02', { exact: false })).toBeVisible();
  const workBreakdown = sheet.getByRole('table', { name: 'Ground floor measured scope work breakdown' });
  await expect(workBreakdown).toContainText('03.20');
  await expect(workBreakdown).toContainText('Floor finishes');
  await expect(workBreakdown).toContainText('770,00');
  await expect(sheet.getByText('03.20 / Floor finishes')).toBeVisible();

  await sheet.getByRole('button', { name: 'Edit Ceramic floor tiles' }).click();
  itemModal = page.getByTestId('takeoff-item-modal');
  await itemModal.getByLabel('Width (m)').fill('5');
  await expect(itemModal.getByLabel('Calculated measurement preview')).toContainText('27.5 m2');
  await itemModal.getByRole('button', { name: 'Recalculate measurement' }).click();
  await expect(page.getByText('Takeoff measurement recalculated and retained.')).toBeVisible();
  await expect(sheet.getByText('27.5 m2')).toBeVisible();

  await sheet.getByRole('button', { name: 'Build rate Ceramic floor tiles' }).click();
  const unitRateDialog = page.getByRole('dialog', { name: 'Unit-rate build-up' });
  await unitRateDialog.getByLabel('Labour hours / unit').fill('0.5');
  await unitRateDialog.getByLabel('Material / unit').fill('20');
  await unitRateDialog.getByLabel('Equipment / unit').fill('5');
  await unitRateDialog.getByLabel('Subcontract / unit').fill('0');
  await unitRateDialog.getByLabel('Other direct / unit').fill('2');
  const ratePreview = unitRateDialog.getByLabel('Unit-rate calculation preview');
  await expect(ratePreview).toContainText('82,00');
  await expect(ratePreview).toContainText('102,50');
  await expect(ratePreview).toContainText('25%');
  await unitRateDialog.getByRole('button', { name: 'Apply build-up' }).click();
  await expect(page.getByText('Unit-rate build-up calculated and retained on the draft measurement.')).toBeVisible();
  await expect(sheet.getByText('Rate v1')).toBeVisible();
  await expect(sheet.getByText(/Labour.*40,00.*overhead.*15,00.*cost.*82,00.*margin 20%/)).toBeVisible();
  await expect(workBreakdown).toContainText('2.818,75');

  await retainFixedPriceBasis(request, intake.job.id, `browser-takeoff-basis-${key}`);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  await expect(workspace.getByRole('heading', { name: title })).toBeVisible();
  await expect(takeoffControl.getByTestId('takeoff-pricing-basis')).toContainText('Fixed price');

  await sheet.getByRole('button', { name: 'Prepare estimate' }).click();
  const convertModal = page.getByTestId('takeoff-convert-modal');
  await expect(convertModal.getByText(/SHA-256 snapshot/i)).toBeVisible();
  await convertModal.getByLabel('Estimate notes').fill('Estimator verified drawing revision, quantity, waste, and rates.');
  await convertModal.getByRole('button', { name: 'Seal and prepare estimate' }).click();
  await expect(page.getByText(/Measured scope sealed and estimate retained/i)).toBeVisible();
  await expect(sheet.getByText('converted', { exact: true })).toBeVisible();
  await expect(sheet.getByText('Snapshot verified')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Measurement' })).toHaveCount(0);
  await expect(workspace.getByTestId('commercial-control')).toContainText('2.818,75');

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  const retained = detail.job.takeoffs.find(item => item.title === 'Ground floor measured scope');
  expect(retained).toMatchObject({
    status: 'converted',
    subtotal: 2818.75,
    totalCost: 2255,
    integrityValid: true,
    data: { externalCommitments: 0 }
  });
  expect(retained.workBreakdown).toMatchObject({ format: 'contractor-ai-wbs/v1', packageCount: 1, valid: true, totalPrice: 2818.75 });
  expect(retained.items[0]).toMatchObject({
    quantity: 27.5,
    unit: 'm2',
    unitCost: 82,
    unitPrice: 102.5,
    totalPrice: 2818.75,
    wbsCode: '03.20',
    workPackage: 'Floor finishes',
    ratePolicyId: pendingPolicy.id,
    rateIntegrityValid: true
  });
  expect(retained.items[0].rateBuildUp.calculation).toMatchObject({
    fullyBurdenedHourlyRate: 80,
    labourCostPerUnit: 40,
    directCostPerUnit: 67,
    overheadRecoveryPerUnit: 15,
    unitCost: 82,
    unitSellRate: 102.5,
    markupPercent: 25
  });
  const quote = detail.job.quotes.find(item => item.id === retained.quoteId);
  expect(quote.status).toBe('draft');
  expect(quote.approvalId).toBeTruthy();
  expect(quote.data.source).toMatchObject({
    type: 'quantity_takeoff',
    id: retained.id,
    snapshotHash: retained.snapshotHash,
    workBreakdownFormat: 'contractor-ai-wbs/v1',
    workBreakdownHash: retained.workBreakdown.hash
  });
  expect(quote.lineItems[0]).toMatchObject({ wbsCode: '03.20', workPackage: 'Floor finishes' });
  expect(detail.job.contractValue).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await ratePolicyControl.getByRole('button', { name: 'Revise rates' }).click();
  ratePolicyDialog = page.getByRole('dialog', { name: 'Estimating rate policy revision' });
  const rateDialogGeometry = await ratePolicyDialog.evaluate(element => ({
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(rateDialogGeometry.left).toBeGreaterThanOrEqual(0);
  expect(rateDialogGeometry.right).toBeLessThanOrEqual(rateDialogGeometry.viewportWidth);
  expect(rateDialogGeometry.scrollWidth).toBeLessThanOrEqual(rateDialogGeometry.clientWidth);
  await ratePolicyDialog.getByRole('button', { name: 'Close estimating rate policy editor' }).click();
  const geometry = await takeoffControl.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
});
