const { test, expect } = require('@playwright/test');

function dateInput(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function createVerifiedPartner(request, name, suffix) {
  const response = await request.post('/api/ledger/trade-partners', {
    data: {
      name,
      partnerType: 'supplier',
      contactName: 'Browser order desk',
      email: `browser-orders-${suffix}@supplier.example`,
      phone: '+31 10 555 12 34',
      address: 'Browser supplier street 8',
      city: 'Rotterdam',
      country: 'NL',
      registrationNumber: `665544${suffix}`,
      vatNumber: `NL45678901${suffix}B01`,
      verificationReference: `BROWSER-BID-VERIFY-${suffix}`,
      verifiedAt: new Date(Date.now() - 86_400_000).toISOString(),
      data: { postalCode: '3011 AA' }
    }
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).partner;
}

test('operator carries a selected bid through approved purchase-order delivery', async ({ page, request }) => {
  const key = Date.now();
  const title = `Browser tender ${key}`;
  const organizationResponse = await request.put('/api/ledger/organization', {
    data: {
      legalName: 'Browser Order Contractor B.V.',
      tradingName: 'Browser Order Contractor',
      registrationNumber: '12345678',
      vatNumber: 'NL123456789B01',
      email: 'browser-orders@contractor.example',
      phone: '+31 20 555 12 34',
      address: 'Browser contractor street 14',
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
  const firstPartner = await createVerifiedPartner(request, `Browser Delta ${key} BV`, '1');
  const secondPartner = await createVerifiedPartner(request, `Browser Kanaal ${key} BV`, '2');
  const opportunityResponse = await request.post('/api/ledger/opportunities', {
    data: { clientName: `Browser Tender Client ${key}`, title, stage: 'estimating', estimatedValue: 150000 }
  });
  expect(opportunityResponse.ok()).toBeTruthy();
  const opportunity = (await opportunityResponse.json()).opportunity;

  await page.goto('/');
  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  const pipeline = page.getByTestId('pipeline-workspace');
  await pipeline.getByRole('tab', { name: 'Bid packages' }).click();
  const bids = page.getByTestId('bid-package-workspace');
  await expect(bids.getByRole('heading', { name: 'Bid package register' })).toBeVisible();
  await bids.getByRole('button', { name: 'New bid package' }).click();

  const packageModal = page.getByTestId('bid-package-modal');
  await packageModal.getByLabel('Opportunity').selectOption(opportunity.id);
  await packageModal.getByLabel('Package title').fill('Mechanical services package');
  await packageModal.getByLabel('Trade').fill('Mechanical');
  await packageModal.getByLabel('Return due').fill(dateInput(10));
  await packageModal.getByLabel('Owner').fill('Browser preconstruction team');
  await packageModal.getByLabel('Scope').fill('Supply, install, test, commission, and document the complete mechanical services scope.');
  await packageModal.getByLabel(new RegExp(firstPartner.name)).check();
  await packageModal.getByLabel(new RegExp(secondPartner.name)).check();
  await packageModal.getByRole('button', { name: 'Retain bid package' }).click();
  await expect(page.getByText('Internal bid package retained. No invitation or message was sent.')).toBeVisible();

  const packageRow = bids.locator('.bid-package-row').filter({ hasText: 'Mechanical services package' });
  await expect(packageRow).toHaveCount(1);
  await packageRow.getByRole('button', { name: /Open bid package BID-/ }).first().click();
  const detail = pipeline.locator('.bid-package-detail');
  await expect(detail.getByText('Internal only; no invitations sent')).toBeVisible();

  const firstRow = detail.locator('.bid-participant-row').filter({ hasText: firstPartner.name });
  await firstRow.getByRole('button', { name: 'Record return' }).click();
  let returnModal = page.getByTestId('bid-return-modal');
  await returnModal.getByLabel('Net amount').fill('82000');
  await returnModal.getByLabel('VAT rate').fill('21');
  await returnModal.getByLabel('Received date').fill(dateInput(0));
  await returnModal.getByLabel('Valid until').fill(dateInput(30));
  await returnModal.getByLabel('Duration days').fill('48');
  await returnModal.getByLabel('Evidence reference').fill(`BROWSER-BID-RETURN-A-${key}`);
  await returnModal.getByLabel('Exclusions').fill('Utility connection fees');
  await returnModal.getByRole('button', { name: 'Retain return evidence' }).click();
  await expect(page.getByText('Bid return evidence retained for internal comparison. No bidder was contacted.')).toBeVisible();

  const secondRow = detail.locator('.bid-participant-row').filter({ hasText: secondPartner.name });
  await secondRow.getByRole('button', { name: 'Record return' }).click();
  returnModal = page.getByTestId('bid-return-modal');
  await returnModal.getByLabel('Net amount').fill('78000');
  await returnModal.getByLabel('VAT rate').fill('21');
  await returnModal.getByLabel('Received date').fill(dateInput(0));
  await returnModal.getByLabel('Valid until').fill(dateInput(25));
  await returnModal.getByLabel('Duration days').fill('42');
  await returnModal.getByLabel('Evidence reference').fill(`BROWSER-BID-RETURN-B-${key}`);
  await returnModal.getByRole('button', { name: 'Retain return evidence' }).click();
  await expect(detail.getByText('2 retained return(s)')).toBeVisible();

  await secondRow.getByRole('button', { name: 'Request selection approval' }).click();
  const selectionModal = page.getByTestId('bid-selection-modal');
  await expect(selectionModal.getByText(/cannot award, order, spend, or send/i)).toBeVisible();
  await selectionModal.getByLabel('Selection rationale').fill('Lowest compliant return with acceptable scope, programme, evidence, and commercial qualifications.');
  await selectionModal.getByRole('button', { name: 'Request selection approval' }).click();
  await expect(page.getByText('Preferred-bidder selection added to approvals. No award, order, or message was issued.')).toBeVisible();

  await detail.getByRole('button', { name: 'Review approval' }).click();
  const approvalRow = page.locator('.approval-item').filter({ hasText: 'Mechanical services package' });
  await expect(approvalRow).toHaveCount(1);
  await approvalRow.getByRole('button', { name: 'Review and approve' }).click();
  const approvalModal = page.getByTestId('approval-review-modal');
  await expect(approvalModal.getByText(/Does not send an award, issue a purchase order, authorize spend/i)).toBeVisible();
  await approvalModal.getByLabel('Reviewer reason').fill('Browser QA verified the comparison, scope, programme, and current trade-partner compliance.');
  await approvalModal.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  await pipeline.getByRole('tab', { name: 'Bid packages' }).click();
  const selectedRow = bids.locator('.bid-package-row').filter({ hasText: 'Mechanical services package' });
  await expect(selectedRow).toContainText('selected');
  await selectedRow.getByRole('button', { name: /Open bid package BID-/ }).first().click();
  await expect(detail.getByText('Preferred / no award sent')).toBeVisible();

  const conversionResponse = await request.post(`/api/ledger/opportunities/${opportunity.id}/convert`, { data: {} });
  expect(conversionResponse.ok()).toBeTruthy();
  const convertedJob = (await conversionResponse.json()).job;
  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  await pipeline.getByRole('tab', { name: 'Bid packages' }).click();
  const convertedRow = bids.locator('.bid-package-row').filter({ hasText: 'Mechanical services package' });
  await convertedRow.getByRole('button', { name: /Open bid package BID-/ }).first().click();
  await detail.getByRole('button', { name: 'Prepare commitment' }).click();
  const commitmentModal = page.getByTestId('bid-commitment-modal');
  await expect(commitmentModal.getByText(/cannot contact the supplier, issue an award or order/i)).toBeVisible();
  await commitmentModal.getByLabel('Required by').fill(dateInput(20));
  await commitmentModal.getByLabel('Cost code').fill('SUB-MECH-410');
  await commitmentModal.getByLabel('Purchasing notes').fill('Retain scope interfaces, exclusions, programme, and handover evidence for purchasing review.');
  await commitmentModal.getByRole('button', { name: 'Freeze and request approval' }).click();
  await expect(page.getByText('Selected bid frozen into purchasing approval. No supplier contact, award, order, or payment occurred.')).toBeVisible();

  let commitmentPanel = detail.getByTestId('bid-commitment');
  await expect(commitmentPanel).toContainText(/pending approval/i);
  await expect(commitmentPanel).toContainText('Source verified');
  await expect(commitmentPanel).toContainText('SUB-MECH-410');
  await expect(commitmentPanel).toContainText('No supplier contact, award, order transmission, subcontract signature, or payment occurred.');
  await detail.getByRole('button', { name: 'Review commitment' }).click();
  const commitmentApproval = page.locator('.approval-item').filter({ hasText: 'Approve purchase order' });
  await expect(commitmentApproval).toHaveCount(1);
  await commitmentApproval.getByRole('button', { name: 'Review and approve' }).click();
  const commitmentApprovalModal = page.getByTestId('approval-review-modal');
  await expect(commitmentApprovalModal.getByText(/exact retained purchasing envelope/i)).toBeVisible();
  await expect(commitmentApprovalModal.getByText(/does not contact the supplier, transmit an award or order/i)).toBeVisible();
  await commitmentApprovalModal.getByLabel('Reviewer reason').fill('Browser QA verified the frozen selected return, purchasing terms, source hash, and current partner compliance.');
  await commitmentApprovalModal.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  await pipeline.getByRole('tab', { name: 'Bid packages' }).click();
  await convertedRow.getByRole('button', { name: /Open bid package BID-/ }).first().click();
  commitmentPanel = detail.getByTestId('bid-commitment');
  await expect(commitmentPanel).toContainText(/ready to order/i);
  await expect(commitmentPanel).toContainText('Source verified');
  await expect(commitmentPanel).toContainText('approved and ready for a separate ordering action');

  await detail.getByRole('button', { name: 'Prepare order package' }).click();
  const orderPackageModal = page.getByTestId('bid-order-package-modal');
  await expect(orderPackageModal.getByText(/generic OASIS UBL 2.1 Order attachments/i)).toBeVisible();
  await expect(orderPackageModal.getByLabel('Supplier recipient')).toHaveValue(secondPartner.email);
  await orderPackageModal.getByRole('button', { name: 'Freeze package and request approval' }).click();
  await expect(page.getByText(/Purchase-order package PO-\d{4}-\d{6} retained.*Transmission still requires approval and a verified provider receipt/i)).toBeVisible();
  let orderPackagePanel = commitmentPanel.getByTestId('bid-order-package');
  await expect(orderPackagePanel).toContainText(/PO-\d{4}-\d{6}/);
  await expect(orderPackagePanel).toContainText(secondPartner.email);
  await expect(orderPackagePanel).toContainText(/draft/i);
  await expect(orderPackagePanel.getByRole('link', { name: /Download purchase order PO-/ })).toBeVisible();
  await expect(orderPackagePanel.getByRole('link', { name: /Download purchase order UBL PO-/ })).toBeVisible();

  await detail.getByRole('button', { name: 'Review transmission' }).click();
  const transmissionApproval = page.locator('.approval-item').filter({ hasText: 'Approve email update before sending' });
  await expect(transmissionApproval).toHaveCount(1);
  await transmissionApproval.getByRole('button', { name: 'Review and approve' }).click();
  const transmissionApprovalModal = page.getByTestId('approval-review-modal');
  await expect(transmissionApprovalModal.getByText(/Approve purchase-order transmission/i)).toBeVisible();
  await expect(transmissionApprovalModal.getByText(/does not transmit the order or create an external supplier commitment/i)).toBeVisible();
  await transmissionApprovalModal.getByLabel('Reviewer reason').fill('Browser QA verified the frozen recipient, order reference, exact lines, and both package formats.');
  await transmissionApprovalModal.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  await pipeline.getByRole('tab', { name: 'Bid packages' }).click();
  await convertedRow.getByRole('button', { name: /Open bid package BID-/ }).first().click();
  commitmentPanel = detail.getByTestId('bid-commitment');
  await expect(detail).toContainText('Transmission approved; provider receipt required');
  await detail.getByRole('button', { name: 'Record delivery receipt' }).click();
  const receiptModal = page.getByTestId('bid-order-delivery-modal');
  await expect(receiptModal.getByText(/does not perform the delivery itself or initiate payment/i)).toBeVisible();
  await receiptModal.getByLabel('Configured integration ID').fill('playwright_test_provider');
  await receiptModal.getByLabel('Provider message ID').fill(`browser-order-message-${key}`);
  await receiptModal.getByRole('button', { name: 'Record verified receipt' }).click();
  await expect(page.getByText(/Verified provider receipt retained for PO-\d{4}-\d{6}.*order is now an external commitment.*no payment was initiated/i)).toBeVisible();
  commitmentPanel = detail.getByTestId('bid-commitment');
  orderPackagePanel = commitmentPanel.getByTestId('bid-order-package');
  await expect(detail).toContainText('Order issued with verified provider receipt');
  await expect(commitmentPanel).toContainText('The retained order was issued only after transmission approval');
  await expect(orderPackagePanel).toContainText('Provider receipt retained');

  const portfolio = await request.get('/api/ledger/bid-packages?includeClosed=true&limit=500');
  expect(portfolio.ok()).toBeTruthy();
  const retained = (await portfolio.json()).bidPackages.find((item) => item.title === 'Mechanical services package');
  expect(retained).toMatchObject({
    status: 'selected',
    jobId: convertedJob.id,
    data: { spendAuthorized: true, externalCommitments: 1 },
    commitment: {
      status: 'ordered',
      integrityValid: true,
      spendAuthorized: true,
      orderIssued: true,
      awardIssued: true,
      externalCommitments: 1,
      issuePackage: expect.objectContaining({
        transportStatus: 'delivered_by_verified_integration',
        providerMessageId: `browser-order-message-${key}`
      })
    }
  });
  const jobResponse = await request.get(`/api/ledger/jobs/${convertedJob.id}`);
  expect(jobResponse.ok()).toBeTruthy();
  const retainedJob = (await jobResponse.json()).job;
  expect(retainedJob.purchaseOrders).toContainEqual(expect.objectContaining({
    id: retained.commitment.purchaseOrderId,
    status: 'ordered',
    orderIssued: true,
    externalCommitments: 1,
    data: expect.objectContaining({ awardIssued: true, externalCommitments: 1 })
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => {
    const navigation = await page.locator('.side-nav').boundingBox();
    return navigation ? navigation.x + navigation.width : 0;
  }).toBeLessThanOrEqual(0.5);
  const commitmentBounds = await commitmentPanel.boundingBox();
  expect(commitmentBounds.x).toBeGreaterThanOrEqual(0);
  const geometry = await pipeline.evaluate((element) => ({
    pageWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
});
