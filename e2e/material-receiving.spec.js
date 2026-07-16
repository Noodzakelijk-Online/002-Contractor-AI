const { test, expect } = require('@playwright/test');

async function postJson(request, route, data) {
  const response = await request.post(route, { data });
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

test('operator receives an issued order and uses the retained ticket for supplier three-way match', async ({ page, request }) => {
  const suffix = Date.now();
  await request.put('/api/ledger/organization', {
    data: {
      legalName: 'Browser Receiving Contractor B.V.', registrationNumber: '12345678', vatNumber: 'NL123456789B01',
      email: 'receiving@contractor.example', address: 'Ledgerstraat 10', postalCode: '3511 AA', city: 'Utrecht', country: 'NL',
      iban: 'NL91ABNA0417164300', bic: 'ABNANL2A', defaultPaymentTermsDays: 30, defaultQuoteValidityDays: 30
    }
  });
  const partner = (await postJson(request, '/api/ledger/trade-partners', {
    name: `Browser Receiving Supplier ${suffix} B.V.`, partnerType: 'supplier', contactName: 'Order desk',
    email: `receiving-${suffix}@supplier.example`, phone: '+31 10 555 12 34', address: 'Supplierstraat 20', city: 'Rotterdam',
    country: 'NL', registrationNumber: '88776655', vatNumber: 'NL987654321B01',
    verificationReference: `BROWSER-RECEIVING-${suffix}`, verifiedAt: new Date(Date.now() - 86_400_000).toISOString()
  })).partner;
  const jobTitle = `Browser material receiving ${suffix}`;
  const job = (await postJson(request, '/api/ledger/intake', {
    title: jobTitle, client: { name: 'Browser receiving client' }, status: 'in_progress', assignAutomatically: false
  })).job;
  const itemName = `Acoustic panels ${suffix}`;
  await postJson(request, `/api/ledger/jobs/${job.id}/materials`, {
    name: itemName, quantity: 12, unit: 'panels', status: 'needed'
  });
  const order = (await postJson(request, `/api/ledger/jobs/${job.id}/purchase-orders`, {
    status: 'ready_to_order', requiresApproval: true, tradePartnerId: partner.id, supplier: partner.name,
    amount: 1200, currency: 'EUR', requiredBy: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    items: [{ name: itemName, description: itemName, quantity: 12, unit: 'panels', unitCost: 100, costCode: 'MAT-REC' }]
  })).purchaseOrder;
  await postJson(request, `/api/ledger/approvals/${order.approval.id}/resolve`, {
    status: 'approved', resolvedBy: 'Browser receiving approver', reason: 'Supplier, exact lines, quantity, price, and delivery date verified.'
  });
  const issuePackage = await postJson(request, `/api/ledger/jobs/${job.id}/purchase-orders/${order.id}/issue-package`, {});
  await postJson(request, `/api/ledger/approvals/${issuePackage.approval.id}/resolve`, {
    status: 'approved', resolvedBy: 'Browser receiving approver', reason: 'Recipient and immutable purchase-order package verified.'
  });
  await postJson(request, `/api/ledger/communications/${issuePackage.communication.id}/delivery-receipt`, {
    integration: 'playwright_test_provider', providerMessageId: `browser-receiving-order-${suffix}`, receipt: { status: 'accepted' }
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await page.getByRole('tab', { name: 'Receiving', exact: true }).click();
  const workspace = page.getByTestId('material-receiving-workspace');
  await expect(workspace).toBeVisible();
  const orderRow = workspace.locator('.material-receiving-orders .resource-readiness-item').filter({ hasText: partner.name });
  await expect(orderRow).toContainText(itemName);
  await orderRow.getByRole('button', { name: 'Receive', exact: true }).click();
  const receiptModal = page.getByTestId('material-receipt-modal');
  await receiptModal.getByLabel('Delivery-note reference').fill(`GR-${suffix}`);
  await receiptModal.getByLabel('Received by').fill('Browser site receiver');
  await receiptModal.getByLabel('Location').fill('Ground-floor secure store');
  await receiptModal.getByLabel('Evidence reference').fill(`signed-ticket:GR-${suffix}`);
  await expect(receiptModal.getByLabel('Received', { exact: true })).toHaveValue('12');
  await expect(receiptModal.getByLabel('Accepted', { exact: true })).toHaveValue('12');
  await receiptModal.getByRole('button', { name: 'Retain delivery' }).click();
  await expect(page.getByText(`Delivery GR-${suffix} retained as received.`)).toBeVisible();
  const receiptRow = workspace.locator('.resource-readiness-item').filter({ hasText: `GR-${suffix}` });
  await expect(receiptRow).toContainText('received');

  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  const finance = page.getByTestId('finance-workspace');
  const financeRow = finance.locator('.finance-item').filter({ hasText: jobTitle });
  await financeRow.getByRole('button', { name: `Supplier invoice for ${jobTitle}` }).click();
  const financeModal = page.getByTestId('finance-control-modal');
  const receiptSelect = financeModal.getByLabel('Retained goods receipt');
  await expect(receiptSelect).toHaveValue(/material_receipt_/);
  await expect(financeModal.getByLabel('Delivery or service evidence reference')).toHaveValue(`GR-${suffix}`);
  await financeModal.getByLabel('Supplier invoice number').fill(`SUP-${suffix}`);
  await financeModal.getByLabel('Internal evidence and notes').fill('Invoice, issued order, and retained receiving ticket checked together.');
  await financeModal.getByRole('button', { name: 'Request payable approval' }).click();
  await expect(page.getByText(new RegExp(`Supplier invoice SUP-${suffix} retained.*Match evidence and payable recognition remain approval-gated`))).toBeVisible();

  const detail = (await (await request.get(`/api/ledger/jobs/${job.id}`)).json()).job;
  const receipt = detail.materialReceipts.find(item => item.receiptReference === `GR-${suffix}`);
  const invoice = detail.supplierInvoices.find(item => item.invoiceNumber === `SUP-${suffix}`);
  expect(receipt.status).toBe('received');
  expect(receipt.summary.acceptedQuantity).toBe(12);
  expect(invoice.data.match.type).toBe('three_way_material_receipt');
  expect(invoice.data.match.materialReceiptId).toBe(receipt.id);
  expect(invoice.data.match.exceptions).toHaveLength(0);

  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await page.getByRole('tab', { name: 'Receiving', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await workspace.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
});

test('interrupted field receipt syncs exactly once through the scoped outbox', async ({ page, request, context }) => {
  const suffix = Date.now();
  const job = (await postJson(request, '/api/ledger/intake', {
    title: `Offline material receiving ${suffix}`, client: { name: 'Offline receiving client' }, status: 'in_progress', assignAutomatically: false
  })).job;
  const itemName = `Protection rolls ${suffix}`;
  await postJson(request, `/api/ledger/jobs/${job.id}/materials`, { name: itemName, quantity: 4, unit: 'rolls', status: 'needed' });

  await page.goto('/');
  await page.getByRole('button', { name: 'Field updates', exact: true }).click();
  const form = page.getByTestId('field-material-receipt-form');
  await form.getByLabel('Job').selectOption(job.id);
  await form.getByLabel('Delivery-note reference').fill(`OFFLINE-GR-${suffix}`);
  await form.getByLabel('Received by').fill('Offline browser receiver');
  await form.getByLabel('Delivery location').fill('Site gate');
  await form.getByLabel('Item').fill(itemName);
  await form.getByLabel('Unit').fill('rolls');
  await form.getByLabel('Received', { exact: true }).fill('4');
  await form.getByLabel('Accepted', { exact: true }).fill('4');
  await form.getByLabel('Damaged', { exact: true }).fill('0');
  await form.getByLabel('Evidence reference').fill(`offline-photo:GR-${suffix}`);

  const submitReceipt = form.getByRole('button', { name: /Retain delivery ticket|Save receipt offline/ });
  await context.setOffline(true);
  await submitReceipt.click();
  await expect(page.getByText('Material delivery was saved locally with its quantities and evidence reference. It will sync after reconnection.')).toBeVisible();
  await expect(page.getByText('1 queued').first()).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Outbox clear')).toBeVisible({ timeout: 15_000 });

  await expect.poll(async () => {
    const response = await request.get(`/api/ledger/jobs/${job.id}`);
    if (!response.ok()) return 0;
    const detail = (await response.json()).job;
    return detail.materialReceipts.filter(item => item.receiptReference === `OFFLINE-GR-${suffix}`).length;
  }, { timeout: 15_000 }).toBe(1);
});
