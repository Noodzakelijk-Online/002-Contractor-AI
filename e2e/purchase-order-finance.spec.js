const { test, expect } = require('@playwright/test');

test('finance issues a standalone purchase order only after approval and provider evidence', async ({ page, request }) => {
  const key = Date.now();
  const jobTitle = `Browser standalone order ${key}`;
  const supplierEmail = `finance-order-${key}@supplier.example`;

  const organizationResponse = await request.put('/api/ledger/organization', {
    data: {
      legalName: 'Browser Finance Contractor B.V.',
      registrationNumber: '12345678',
      vatNumber: 'NL123456789B01',
      email: 'finance-orders@contractor.example',
      address: 'Finance ledger street 14',
      postalCode: '1012 AB',
      city: 'Amsterdam',
      country: 'NL',
      iban: 'NL91ABNA0417164300',
      bic: 'ABNANL2A',
      defaultPaymentTermsDays: 30,
      defaultQuoteValidityDays: 30
    }
  });
  expect(organizationResponse.ok()).toBeTruthy();

  const partnerResponse = await request.post('/api/ledger/trade-partners', {
    data: {
      name: `Browser Finance Supplier ${key} B.V.`,
      partnerType: 'supplier',
      contactName: 'Order desk',
      email: supplierEmail,
      phone: '+31 10 555 12 34',
      address: 'Supplier finance street 8',
      city: 'Rotterdam',
      country: 'NL',
      registrationNumber: '66554433',
      vatNumber: 'NL456789012B01',
      verificationReference: `BROWSER-FINANCE-ORDER-${key}`,
      verifiedAt: new Date(Date.now() - 86_400_000).toISOString(),
      data: { postalCode: '3011 AA' }
    }
  });
  expect(partnerResponse.ok()).toBeTruthy();
  const partner = (await partnerResponse.json()).partner;

  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title: jobTitle,
      client: { name: `Browser Finance Client ${key}` },
      address: 'Project finance street 5',
      city: 'Amsterdam',
      country: 'NL',
      assignAutomatically: false
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const job = (await intakeResponse.json()).job;

  const orderResponse = await request.post(`/api/ledger/jobs/${job.id}/purchase-orders`, {
    data: {
      status: 'ready_to_order',
      requiresApproval: true,
      tradePartnerId: partner.id,
      supplier: partner.name,
      amount: 2400,
      currency: 'EUR',
      requiredBy: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      notes: 'Standalone order retained for Finance browser verification.',
      items: [
        { description: 'Electrical distribution package', quantity: 1, unit: 'package', unitCost: 2000, costCode: 'MAT-500' },
        { description: 'Commissioning support', quantity: 4, unit: 'hour', unitCost: 100, costCode: 'LAB-500' }
      ]
    }
  });
  expect(orderResponse.ok()).toBeTruthy();
  const purchaseOrder = (await orderResponse.json()).purchaseOrder;
  const orderApprovalResponse = await request.post(`/api/ledger/approvals/${purchaseOrder.approval.id}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Browser purchasing approver',
      reason: 'Supplier, compliance, exact lines, amount, and required date verified.'
    }
  });
  expect(orderApprovalResponse.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  const finance = page.getByTestId('finance-workspace');
  let row = finance.locator('.finance-item').filter({ hasText: jobTitle });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: `Prepare purchase order package for ${jobTitle}` }).click();
  await expect(page.getByText(/Purchase order PO-\d{4}-\d{6} retained with HTML and generic OASIS UBL 2\.1 attachments/)).toBeVisible();

  row = finance.locator('.finance-item').filter({ hasText: jobTitle });
  await expect(row).toContainText(/PO-\d{4}-\d{6} prepared/, { timeout: 15_000 });
  await expect(row.getByRole('link', { name: /Download purchase order PO-/ })).toBeVisible();
  await expect(row.getByRole('link', { name: /Download purchase order UBL PO-/ })).toBeVisible();
  await row.getByRole('button', { name: 'Review approval' }).click();

  const transmissionApproval = page.locator('.approval-item').filter({ hasText: 'Approve email update before sending' });
  await expect(transmissionApproval).toHaveCount(1);
  await transmissionApproval.getByRole('button', { name: 'Review and approve' }).click();
  const approvalModal = page.getByTestId('approval-review-modal');
  await expect(approvalModal.getByText(/Approve purchase-order transmission/)).toBeVisible();
  await expect(approvalModal.getByText(/does not transmit the order or create an external supplier commitment/i)).toBeVisible();
  await approvalModal.getByLabel('Reviewer reason').fill('Browser QA verified the immutable order, recipient, amount, and both attachments.');
  await approvalModal.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  row = finance.locator('.finance-item').filter({ hasText: jobTitle });
  await row.getByRole('button', { name: `Record order delivery for ${jobTitle}` }).click();
  const receiptModal = page.getByTestId('finance-order-delivery-modal');
  await expect(receiptModal.getByText(/does not contact the supplier or initiate payment/i)).toBeVisible();
  await receiptModal.getByLabel('Configured integration ID').fill('playwright_test_provider');
  await receiptModal.getByLabel('Provider message ID').fill(`browser-finance-order-${key}`);
  await receiptModal.getByRole('button', { name: 'Record verified receipt' }).click();
  await expect(page.getByText(/Verified provider receipt retained for PO-\d{4}-\d{6}.*now an external commitment.*no payment was initiated/i)).toBeVisible();

  row = finance.locator('.finance-item').filter({ hasText: jobTitle });
  await expect(row).toContainText(/PO-\d{4}-\d{6} issued/);
  await expect(row.getByRole('button', { name: `Record order delivery for ${jobTitle}` })).toHaveCount(0);

  const jobResponse = await request.get(`/api/ledger/jobs/${job.id}`);
  expect(jobResponse.ok()).toBeTruthy();
  const retainedOrder = (await jobResponse.json()).job.purchaseOrders.find(item => item.id === purchaseOrder.id);
  expect(retainedOrder).toMatchObject({
    status: 'ordered',
    orderIssued: true,
    awardIssued: true,
    externalCommitments: 1,
    issuePackage: expect.objectContaining({
      transportStatus: 'delivered_by_verified_integration',
      providerMessageId: `browser-finance-order-${key}`
    })
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await finance.evaluate(element => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
});
