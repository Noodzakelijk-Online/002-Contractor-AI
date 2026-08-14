const { test, expect } = require('@playwright/test');

async function completeFactorEvidence(dialog) {
  const rows = dialog.locator('.pricing-factor-row');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    await row.getByLabel('Assessment').selectOption('yes');
    await row.getByLabel('Retained evidence').fill(`Scope workflow evidence ${index + 1} is verified.`);
  }
}

async function approveQueueItem(page, title, reason) {
  const item = page.locator('.approval-item').filter({ hasText: title });
  await expect(item).toHaveCount(1);
  await item.getByRole('button', { name: 'Review and approve' }).click();
  const modal = page.getByTestId('approval-review-modal');
  await expect(modal).toBeVisible();
  await modal.getByLabel('Reviewer reason').fill(reason);
  await modal.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();
}

test('operator governs written scope, allowances, pricing, responsive review, and stale-source blocking', async ({ page, request }) => {
  test.setTimeout(90_000);
  const key = Date.now();
  const title = `Browser commercial scope ${key}`;
  const intakeResponse = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Interior renovation',
      description: 'Renovate the retained kitchen and utility-room footprint.',
      address: 'Keizersgracht 100, Amsterdam',
      city: 'Amsterdam',
      estimatedHours: 180,
      assignAutomatically: false,
      client: { name: `Scope Browser Client ${key}`, email: 'scope-browser@example.test', country: 'NL' }
    }
  });
  expect(intakeResponse.ok()).toBeTruthy();
  const intake = await intakeResponse.json();

  const openJob = async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /^(Today|Vandaag)$/ })).toBeVisible();
    const openButton = page.getByRole('button', { name: `Open ${title}` }).first();
    await expect(openButton).toBeEnabled();
    await page.getByLabel(/^(Language|Taal)$/).selectOption('en-GB');
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    await openButton.click();
    await expect(page.getByTestId('job-workspace').getByRole('heading', { name: title })).toBeVisible();
  };

  await openJob();
  let workspace = page.getByTestId('job-workspace');
  let commercial = workspace.getByTestId('commercial-control');
  let scopeControl = commercial.getByTestId('commercial-scope-control');
  let riskControl = commercial.getByTestId('project-risk-register-control');
  let basisControl = commercial.getByTestId('pricing-basis-control');
  let assessBasis = commercial.getByRole('button', { name: 'Assess basis' });
  let newEstimate = commercial.getByRole('button', { name: 'New estimate' });

  await expect(scopeControl).toContainText('Commercial scope not retained');
  await expect(assessBasis).toBeDisabled();
  await expect(newEstimate).toBeDisabled();
  await scopeControl.getByRole('button', { name: 'Write scope' }).click();

  let scopeDialog = page.getByTestId('commercial-scope-form');
  await expect(scopeDialog.getByRole('heading', { name: 'Scope, assumptions, exclusions, and allowances' })).toBeVisible();
  await scopeDialog.getByLabel('Schedule title').fill('Kitchen renovation commercial scope');
  await scopeDialog.getByLabel('Clarification deadline').fill('2026-12-15');
  await scopeDialog.getByLabel('Scope summary').fill('Complete the measured kitchen renovation within the retained room boundary.');
  await scopeDialog.getByLabel('Included work').fill('Protect retained access routes.\nInstall cabinetry, worktop, and finish package.');
  await scopeDialog.getByLabel('Assumptions').fill('Existing structural openings remain unchanged.\nClient selections are confirmed by the clarification deadline.');
  await scopeDialog.getByLabel('Exclusions').fill('Hazardous-material removal is excluded.\nUtility upgrades outside the retained room are excluded.');
  await scopeDialog.getByLabel('Client responsibilities').fill('Provide clear access.\nApprove selections by the retained deadline.');
  await scopeDialog.getByLabel('Contractor responsibilities').fill('Protect occupied areas.\nRetain installation and completion evidence.');
  await scopeDialog.getByLabel('Defined allowances').check();

  const allowance = scopeDialog.locator('.scope-allowance-row').first();
  await allowance.getByLabel('Title').fill('Wall tile supply');
  await allowance.getByLabel('Description').fill('Client-selected wall tile supply excluding installation.');
  await allowance.getByLabel('Quantity', { exact: true }).fill('20');
  await allowance.getByLabel('Unit', { exact: true }).fill('m2');
  await allowance.getByLabel('Unit rate', { exact: true }).fill('45');
  await allowance.getByLabel('Selection due').fill('2026-11-30');
  await allowance.getByLabel('Evidence reference').fill('Survey schedule S-01');
  await expect(allowance.getByText('Calculated amount').locator('..')).toContainText(/900/);
  await scopeDialog.getByLabel('Revision reason').fill('Establish the written commercial basis before pricing and quote approval.');
  await scopeDialog.getByRole('button', { name: 'Request approval' }).click();
  await expect(scopeDialog).toBeHidden();
  await expect(page.getByText(/Commercial scope v1 retained for approval/i)).toBeVisible();
  await expect(scopeControl).toContainText('Commercial scope awaiting approval');
  await expect(assessBasis).toBeDisabled();
  await expect(newEstimate).toBeDisabled();

  await scopeControl.getByRole('button', { name: 'Review scope' }).click();
  await expect(page.getByRole('heading', { name: 'Approval queue' })).toBeVisible();
  await approveQueueItem(
    page,
    'Approve commercial scope Kitchen renovation commercial scope',
    'Written scope, source evidence, assumptions, exclusions, responsibilities, and allowance reconciliation verified.'
  );

  await openJob();
  workspace = page.getByTestId('job-workspace');
  commercial = workspace.getByTestId('commercial-control');
  scopeControl = commercial.getByTestId('commercial-scope-control');
  riskControl = commercial.getByTestId('project-risk-register-control');
  basisControl = commercial.getByTestId('pricing-basis-control');
  assessBasis = commercial.getByRole('button', { name: 'Assess basis' });
  newEstimate = commercial.getByRole('button', { name: 'New estimate' });
  await expect(scopeControl).toContainText('Approved + current');
  await expect(scopeControl).toContainText(/1 allowances totaling.*900/);
  await expect(riskControl).toContainText('Project risk register not retained');
  await expect(riskControl.getByRole('button', { name: 'Run premortem' })).toBeEnabled();
  await expect(assessBasis).toBeDisabled();
  await expect(newEstimate).toBeDisabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await scopeControl.getByRole('button', { name: 'Revise scope' }).click();
  scopeDialog = page.getByTestId('commercial-scope-form');
  const geometry = await scopeDialog.evaluate(element => ({
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    viewportWidth: window.innerWidth,
    pageWidth: document.documentElement.scrollWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  await scopeDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(scopeDialog).toBeHidden();

  await page.setViewportSize({ width: 1440, height: 900 });
  await riskControl.getByRole('button', { name: 'Run premortem' }).click();
  const riskDialog = page.getByTestId('project-risk-register-form');
  await expect(riskDialog.getByRole('heading', { name: 'Project risk register and premortem' })).toBeVisible();
  await riskDialog.getByLabel('Register title').fill('Kitchen renovation project risks');
  await riskDialog.getByLabel('Facilitator').fill('Browser project manager');
  await riskDialog.getByLabel('Failure statement').fill('The kitchen renovation missed its target because access and client selections were not controlled.');
  await riskDialog.getByLabel('Participants').fill('Browser estimator\nBrowser project manager');
  const riskRow = riskDialog.getByTestId('project-risk-row-0');
  await riskRow.getByLabel('Title').fill('Client selection arrives late');
  await riskRow.getByLabel('Owner').fill('Browser project manager');
  await riskRow.getByLabel('Cause').fill('The client selection deadline is not actively tracked.');
  await riskRow.getByLabel('Risk event').fill('The retained wall tile is not selected before procurement release.');
  await riskRow.getByLabel('Consequence').fill('Procurement and installation dates move beyond the target sequence.');
  await riskRow.getByLabel('Mitigation action').fill('Review selections weekly and escalate before the retained deadline.');
  await riskRow.getByLabel('Contingency action').fill('Resequence unaffected work while the selection remains unresolved.');
  await riskRow.getByLabel('Trigger or early warning').fill('No approved selection exists five working days before procurement.');
  await riskRow.getByLabel('Cost exposure').fill('1000');
  await riskRow.getByLabel('Schedule days').fill('3');
  await riskRow.getByLabel('Evidence reference').fill('Scope allowance schedule S-01');
  await riskRow.getByLabel('Failure mode').fill('The missing tile selection stopped the planned installation sequence.');
  await riskRow.getByLabel('Early warning', { exact: true }).fill('The client had not approved the tile by the escalation date.');
  await riskRow.getByLabel('Prevention').fill('Confirm the tile decision and evidence before procurement release.');
  await expect(riskDialog.getByLabel('Draft project risk summary')).toContainText(/Expected exposure.*300/s);

  await page.setViewportSize({ width: 390, height: 844 });
  const riskGeometry = await riskDialog.evaluate(element => ({
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    viewportWidth: window.innerWidth,
    pageWidth: document.documentElement.scrollWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(riskGeometry.left).toBeGreaterThanOrEqual(0);
  expect(riskGeometry.right).toBeLessThanOrEqual(riskGeometry.viewportWidth);
  expect(riskGeometry.pageWidth).toBeLessThanOrEqual(riskGeometry.viewportWidth);
  expect(riskGeometry.scrollWidth).toBeLessThanOrEqual(riskGeometry.clientWidth);
  await page.setViewportSize({ width: 1440, height: 900 });
  await riskDialog.getByRole('button', { name: 'Request approval' }).click();
  await expect(riskDialog).toBeHidden();
  await expect(page.getByText(/Project risk register v1 retained for approval/i)).toBeVisible();
  await expect(riskControl).toContainText('Project risk review awaiting approval');
  await expect(assessBasis).toBeDisabled();

  await riskControl.getByRole('button', { name: 'Review risks' }).click();
  await approveQueueItem(
    page,
    'Approve project risk register Kitchen renovation project risks v1',
    'Risk ownership, treatments, expected exposure, and linked premortem failure mode verified.'
  );

  await openJob();
  workspace = page.getByTestId('job-workspace');
  commercial = workspace.getByTestId('commercial-control');
  scopeControl = commercial.getByTestId('commercial-scope-control');
  riskControl = commercial.getByTestId('project-risk-register-control');
  basisControl = commercial.getByTestId('pricing-basis-control');
  assessBasis = commercial.getByRole('button', { name: 'Assess basis' });
  newEstimate = commercial.getByRole('button', { name: 'New estimate' });
  await expect(riskControl).toContainText('Kitchen renovation project risks');
  await expect(riskControl).toContainText('Approved + current');
  await expect(riskControl).toContainText(/1 risks.*0 high residual.*300.*1 premortem modes/);
  await expect(assessBasis).toBeEnabled();

  await assessBasis.click();
  const pricingDialog = page.getByTestId('pricing-basis-form');
  await completeFactorEvidence(pricingDialog);
  await pricingDialog.getByLabel('Decision rationale').fill('The approved scope and retained evidence support a fixed-price estimate.');
  await pricingDialog.getByRole('button', { name: 'Retain pricing basis' }).click();
  await expect(pricingDialog).toBeHidden();
  await expect(basisControl).toContainText('Fixed price');
  await expect(basisControl).toContainText('Source current');
  await expect(newEstimate).toBeEnabled();

  await newEstimate.click();
  const estimateDialog = page.getByTestId('commercial-draft-modal');
  await expect(estimateDialog.getByRole('heading', { name: 'New fixed-price estimate' })).toBeVisible();
  await expect(estimateDialog.getByTestId('commercial-draft-scope')).toContainText('Kitchen renovation commercial scope');
  await expect(estimateDialog.getByTestId('commercial-draft-scope')).toContainText('1 allowances');
  await estimateDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(estimateDialog).toBeHidden();

  await page.getByLabel('Language', { exact: true }).selectOption('nl-NL');
  await expect(commercial.getByRole('heading', { name: 'Commerciele beheersing' })).toBeVisible();
  await expect(scopeControl.getByText('Kitchen renovation commercial scope', { exact: true })).toBeVisible();
  await expect(scopeControl.getByRole('button', { name: 'Scope herzien' })).toBeVisible();
  await expect(riskControl.getByText('Kitchen renovation project risks', { exact: true })).toBeVisible();
  await expect(riskControl.getByRole('button', { name: "Risico's herzien" })).toBeVisible();
  await expect(basisControl).toContainText('Vaste prijs');
  await expect(commercial.getByRole('button', { name: 'Nieuwe calculatie' })).toBeEnabled();

  await scopeControl.getByRole('button', { name: 'Scope herzien' }).click();
  scopeDialog = page.getByTestId('commercial-scope-form');
  await expect(scopeDialog.getByRole('heading', { name: 'Scope, aannames, uitsluitingen en stelposten' })).toBeVisible();
  await expect(scopeDialog.getByLabel('Titel contractbijlage')).toHaveValue('Kitchen renovation commercial scope');
  await scopeDialog.getByRole('button', { name: 'Annuleren' }).click();

  await riskControl.getByRole('button', { name: "Risico's herzien" }).click();
  const dutchRiskDialog = page.getByTestId('project-risk-register-form');
  await expect(dutchRiskDialog.getByRole('heading', { name: 'Projectrisicoregister en premortem' })).toBeVisible();
  await expect(dutchRiskDialog.getByLabel('Titel register')).toHaveValue('Kitchen renovation project risks');
  await dutchRiskDialog.getByRole('button', { name: 'Annuleren' }).click();

  await commercial.getByRole('button', { name: 'Opnieuw beoordelen' }).click();
  const dutchPricingDialog = page.getByTestId('pricing-basis-form');
  await expect(dutchPricingDialog.getByRole('heading', { name: 'Vaste prijs of regie' })).toBeVisible();
  await expect(dutchPricingDialog.getByLabel('Onderbouwing beslissing')).toHaveValue('The approved scope and retained evidence support a fixed-price estimate.');
  await dutchPricingDialog.getByRole('button', { name: 'Annuleren' }).click();

  await commercial.getByRole('button', { name: 'Nieuwe calculatie' }).click();
  const dutchEstimateDialog = page.getByTestId('commercial-draft-modal');
  await expect(dutchEstimateDialog.getByRole('heading', { name: 'Nieuwe vasteprijscalculatie' })).toBeVisible();
  await expect(dutchEstimateDialog.getByTestId('commercial-draft-scope')).toContainText('Kitchen renovation commercial scope');
  await expect(dutchEstimateDialog.getByTestId('commercial-draft-pricing-basis')).toContainText('vaste prijs');
  await dutchEstimateDialog.getByRole('button', { name: 'Annuleren' }).click();

  await page.getByLabel('Taal', { exact: true }).selectOption('en-GB');
  await expect(commercial.getByRole('heading', { name: 'Commercial control' })).toBeVisible();

  const takeoffResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/takeoffs`, {
    data: {
      title: 'Post-approval measured source change',
      currency: 'EUR',
      items: [{ description: 'Additional measured wall area', quantity: 5, unit: 'm2', unitCost: 20, unitPrice: 35 }]
    }
  });
  expect(takeoffResponse.ok()).toBeTruthy();

  await openJob();
  workspace = page.getByTestId('job-workspace');
  commercial = workspace.getByTestId('commercial-control');
  scopeControl = commercial.getByTestId('commercial-scope-control');
  riskControl = commercial.getByTestId('project-risk-register-control');
  basisControl = commercial.getByTestId('pricing-basis-control');
  await expect(scopeControl).toContainText('Commercial scope requires revision');
  await expect(scopeControl).toContainText('Source changed');
  await expect(riskControl).toContainText('Project risk review requires revision');
  await expect(riskControl).toContainText('Source changed');
  await expect(basisControl).toContainText('Commercial basis requires reassessment');
  await expect(commercial.getByRole('button', { name: 'Reassess' })).toBeDisabled();
  await expect(commercial.getByRole('button', { name: 'New estimate' })).toBeDisabled();

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  expect(detail.job.commercialScope.currentRevision.snapshot.allowances[0]).toMatchObject({
    title: 'Wall tile supply',
    quantity: 20,
    unit: 'm2',
    unitRate: 45,
    amount: 900,
    reconciliationMethod: 'actual_cost_variation'
  });
  expect(detail.job.commercialScope.stale).toBe(true);
  expect(detail.job.riskRegister.stale).toBe(true);
  expect(detail.job.pricingBasis.stale).toBe(true);
  expect(detail.job.commercialScopeRevisions).toHaveLength(1);
  expect(detail.job.riskRegisterRevisions).toHaveLength(1);
});
