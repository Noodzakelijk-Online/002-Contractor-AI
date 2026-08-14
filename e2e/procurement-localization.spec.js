const { test, expect } = require('@playwright/test');
const { expectNoAxeViolations } = require('./accessibility-helpers');

function dateInput(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function openDutchBidPackage(page, title) {
  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  const pipeline = page.getByTestId('pipeline-workspace');
  await pipeline.getByRole('tab', { name: 'Offerteaanvragen', exact: true }).click();
  const bids = page.getByTestId('bid-package-workspace');
  await bids.getByRole('button', { name: 'alle', exact: true }).click();
  const row = bids.locator('.bid-package-row').filter({ hasText: title });
  await row.getByRole('button', { name: /Offerteaanvraag BID-[\d-]+ openen/ }).first().click();
  return { pipeline, bids, row, detail: pipeline.locator('.bid-package-detail') };
}

test('tender comparison and approved purchasing stay bilingual without rewriting evidence', async ({ page, request }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const key = Date.now();
  const title = `Retained procurement package ${key}`;
  const trade = `Retained mechanical trade ${key}`;
  const scope = `Retained English purchasing scope ${key}`;
  const evidenceReference = `RETAINED-BID-EVIDENCE-${key}`;
  const partnerName = `Retained procurement partner ${key} BV`;
  const providerMessageId = `retained-provider-order-${key}`;

  const organizationResponse = await request.put('/api/ledger/organization', {
    data: {
      legalName: 'Retained Procurement Contractor B.V.',
      tradingName: 'Retained Procurement Contractor',
      registrationNumber: '12345678',
      vatNumber: 'NL123456789B01',
      email: 'procurement@contractor.example',
      phone: '+31 20 555 12 34',
      address: 'Procurement street 14',
      postalCode: '1012 AB',
      city: 'Amsterdam',
      country: 'NL',
      iban: 'NL91ABNA0417164300',
      bic: 'ABNANL2A',
      defaultPaymentTermsDays: 30,
      defaultQuoteValidityDays: 30,
    },
  });
  expect(organizationResponse.ok()).toBeTruthy();

  const partnerResponse = await request.post('/api/ledger/trade-partners', {
    data: {
      name: partnerName,
      partnerType: 'supplier',
      contactName: 'Retained order desk',
      email: `retained-orders-${key}@supplier.example`,
      phone: '+31 10 555 12 34',
      address: 'Supplier street 8',
      city: 'Rotterdam',
      country: 'NL',
      registrationNumber: String(key).slice(-8),
      vatNumber: `NL${String(key).slice(-9)}B01`,
      verificationReference: `RETAINED-PARTNER-${key}`,
      verifiedAt: new Date(Date.now() - 86_400_000).toISOString(),
      data: { postalCode: '3011 AA' },
    },
  });
  expect(partnerResponse.ok()).toBeTruthy();
  const partner = (await partnerResponse.json()).partner;

  const opportunityResponse = await request.post('/api/ledger/opportunities', {
    data: {
      clientName: `Retained procurement client ${key}`,
      title: `Retained procurement opportunity ${key}`,
      stage: 'estimating',
      estimatedValue: 125000,
    },
  });
  expect(opportunityResponse.ok()).toBeTruthy();
  const opportunity = (await opportunityResponse.json()).opportunity;

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  const response = await page.goto('/');
  expect(response.ok()).toBeTruthy();
  await page.waitForLoadState('networkidle');
  await page.locator('header').getByLabel(/^(Language|Taal)$/, { exact: true }).selectOption('nl-NL');
  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  const pipeline = page.getByTestId('pipeline-workspace');
  await pipeline.getByRole('tab', { name: 'Offerteaanvragen', exact: true }).click();
  const bids = page.getByTestId('bid-package-workspace');
  await expect(bids.getByRole('heading', { name: 'Register offerteaanvragen', exact: true })).toBeVisible();
  await bids.getByRole('button', { name: 'Nieuwe offerteaanvraag', exact: true }).click();

  const packageModal = page.getByTestId('bid-package-modal');
  await packageModal.getByRole('combobox', { name: 'Kans', exact: true }).selectOption(opportunity.id);
  await packageModal.getByLabel('Pakkettitel', { exact: true }).fill(title);
  await packageModal.getByLabel('Discipline', { exact: true }).fill(trade);
  await packageModal.getByLabel('Offerte uiterlijk', { exact: true }).fill(dateInput(10));
  await packageModal.getByLabel('Eigenaar', { exact: true }).fill('Retained procurement owner');
  await packageModal.getByLabel('Scope', { exact: true }).fill(scope);
  await packageModal.getByLabel(new RegExp(partner.name)).check();
  await packageModal.getByRole('button', { name: 'Offerteaanvraag vastleggen', exact: true }).click();
  await expect(page.getByText('Interne offerteaanvraag vastgelegd. Er is geen uitnodiging of bericht verzonden.')).toBeVisible();

  let view = await openDutchBidPackage(page, title);
  await expect(view.detail).toContainText('Alleen intern; geen uitnodigingen verzonden');
  const participant = view.detail.locator('.bid-participant-row').filter({ hasText: partner.name });
  await participant.getByRole('button', { name: 'Offerte vastleggen', exact: true }).click();
  const returnModal = page.getByTestId('bid-return-modal');
  await returnModal.getByLabel('Nettobedrag', { exact: true }).fill('64000');
  await returnModal.getByLabel('Btw-tarief', { exact: true }).fill('21');
  await returnModal.getByLabel('Ontvangstdatum', { exact: true }).fill(dateInput(0));
  await returnModal.getByLabel('Geldig tot', { exact: true }).fill(dateInput(30));
  await returnModal.getByLabel('Doorlooptijd in dagen', { exact: true }).fill('35');
  await returnModal.getByLabel('Onderbouwingsreferentie', { exact: true }).fill(evidenceReference);
  await returnModal.getByLabel('Uitsluitingen', { exact: true }).fill('Retained English utility exclusion');
  await returnModal.getByLabel('Kwalificaties', { exact: true }).fill('Retained English programme qualification');
  await returnModal.getByRole('button', { name: 'Offerteonderbouwing vastleggen', exact: true }).click();
  await expect(page.getByText('Offerteonderbouwing vastgelegd voor interne vergelijking. Er is geen inschrijver benaderd.')).toBeVisible();
  await expect(view.detail).toContainText('1 vastgelegde offerte');

  await participant.getByRole('button', { name: 'Goedkeuring keuze aanvragen', exact: true }).click();
  const selectionModal = page.getByTestId('bid-selection-modal');
  await expect(selectionModal.getByText(/hiermee kan niet worden gegund, besteld, uitgegeven of verzonden/i)).toBeVisible();
  await selectionModal.getByLabel('Motivering van selectie', { exact: true }).fill('Retained English selection rationale with price, scope, evidence, programme, and compliance.');
  await selectionModal.getByRole('button', { name: 'Goedkeuring keuze aanvragen', exact: true }).click();
  await expect(page.getByText('Selectie van de voorkeursleverancier toegevoegd aan goedkeuringen. Er is geen gunning, order of bericht uitgegeven.')).toBeVisible();

  const listResponse = await request.get('/api/ledger/bid-packages?includeClosed=true&limit=500');
  expect(listResponse.ok()).toBeTruthy();
  let bidPackage = (await listResponse.json()).bidPackages.find(item => item.title === title);
  expect(bidPackage?.approvalId).toBeTruthy();
  const selectionApproval = await request.post(`/api/ledger/approvals/${bidPackage.approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Retained selection approver', reason: 'Retained source-current selection review.' },
  });
  expect(selectionApproval.ok()).toBeTruthy();
  const conversionResponse = await request.post(`/api/ledger/opportunities/${opportunity.id}/convert`, { data: {} });
  expect(conversionResponse.ok()).toBeTruthy();

  await page.reload();
  view = await openDutchBidPackage(page, title);
  await expect(view.detail).toContainText('Voorkeursleverancier vastgelegd; geen verplichting voorbereid');
  await view.detail.getByRole('button', { name: 'Verplichting voorbereiden', exact: true }).click();
  const commitmentModal = page.getByTestId('bid-commitment-modal');
  await expect(commitmentModal.getByText(/kan de leverancier niet benaderen/i)).toBeVisible();
  await commitmentModal.getByLabel('Benodigd op', { exact: true }).fill(dateInput(20));
  await commitmentModal.getByLabel('Kostencode', { exact: true }).fill('SUB-NL-410');
  await commitmentModal.getByRole('textbox', { name: 'Inkoopnotities', exact: true }).fill('Retained English purchasing interfaces and reviewer context.');
  await commitmentModal.getByRole('button', { name: 'Vastzetten en goedkeuring aanvragen', exact: true }).click();
  await expect(page.getByText('Geselecteerde offerte vastgezet voor inkoopgoedkeuring. Er heeft geen leverancierscontact, gunning, order of betaling plaatsgevonden.')).toBeVisible();

  let detailResponse = await request.get(`/api/ledger/bid-packages/${bidPackage.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  bidPackage = (await detailResponse.json()).bidPackage;
  const commitmentApproval = await request.post(`/api/ledger/approvals/${bidPackage.commitment.approvalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Retained purchasing approver', reason: 'Retained source-current purchasing review.' },
  });
  expect(commitmentApproval.ok()).toBeTruthy();

  await page.reload();
  view = await openDutchBidPackage(page, title);
  await expect(view.detail).toContainText('Inkoopkader goedgekeurd; geen gunning verzonden');
  await view.detail.getByRole('button', { name: 'Bestelpakket voorbereiden', exact: true }).click();
  const orderModal = page.getByTestId('bid-order-package-modal');
  await expect(orderModal.getByText(/generieke OASIS UBL 2\.1 Order-bijlagen/i)).toBeVisible();
  await expect(orderModal.getByLabel('Ontvanger bij leverancier', { exact: true })).toHaveValue(partner.email);
  await orderModal.getByRole('button', { name: 'Pakket vastzetten en goedkeuring aanvragen', exact: true }).click();
  await expect(page.getByText(/Inkooporderpakket PO-\d{4}-\d{6} is vastgelegd.*geverifieerd providerbewijs/i)).toBeVisible();

  detailResponse = await request.get(`/api/ledger/bid-packages/${bidPackage.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  bidPackage = (await detailResponse.json()).bidPackage;
  const deliveryApproval = await request.post(`/api/ledger/approvals/${bidPackage.commitment.issuePackage.deliveryApprovalId}/resolve`, {
    data: { status: 'approved', resolvedBy: 'Retained transmission approver', reason: 'Retained recipient and immutable attachments checked.' },
  });
  expect(deliveryApproval.ok()).toBeTruthy();

  await page.reload();
  view = await openDutchBidPackage(page, title);
  await expect(view.detail).toContainText('Verzending goedgekeurd; providerbewijs vereist');
  await view.detail.getByRole('button', { name: 'Ontvangstbewijs levering vastleggen', exact: true }).click();
  const receiptModal = page.getByTestId('bid-order-delivery-modal');
  await expect(receiptModal.getByText(/de levering zelf wordt niet uitgevoerd en er wordt geen betaling gestart/i)).toBeVisible();
  await receiptModal.getByLabel('Ingestelde integratie-ID', { exact: true }).fill('playwright_test_provider');
  await receiptModal.getByLabel('Bericht-ID van provider', { exact: true }).fill(providerMessageId);
  await receiptModal.getByRole('button', { name: 'Geverifieerd ontvangstbewijs vastleggen', exact: true }).click();
  await expect(page.getByText(/Geverifieerd providerbewijs vastgelegd voor PO-\d{4}-\d{6}.*geen betaling gestart/i)).toBeVisible();
  await expect(view.detail).toContainText('Order uitgegeven met geverifieerd providerbewijs');
  await expect(view.detail).toContainText('Er is geen betaling of ondertekening van een onderaanneming uitgevoerd');
  await expect(view.detail).toContainText('Providerbewijs vastgelegd');
  await expect(view.detail).toContainText(scope);
  await expect(view.detail).toContainText(evidenceReference);
  await expectNoAxeViolations(page, 'Dutch tender and purchasing workflow');

  detailResponse = await request.get(`/api/ledger/bid-packages/${bidPackage.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const retained = (await detailResponse.json()).bidPackage;
  expect(retained).toMatchObject({
    title,
    trade,
    scope,
    status: 'selected',
    commitment: {
      status: 'ordered',
      orderIssued: true,
      externalCommitments: 1,
      issuePackage: { providerMessageId },
    },
  });
  expect(retained.selectedParticipant.evidenceReference).toBe(evidenceReference);

  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await view.pipeline.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('header').getByLabel('Taal', { exact: true }).selectOption('en-GB');
  await expect(view.bids.getByRole('heading', { name: 'Bid package register', exact: true })).toBeVisible();
  await expect(view.detail).toContainText(title);
  await expect(view.detail).toContainText(scope);
  await expect(view.detail).toContainText(evidenceReference);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
