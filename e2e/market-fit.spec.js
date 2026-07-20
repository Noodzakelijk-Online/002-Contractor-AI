const { test, expect } = require('@playwright/test');

test('owner governs ICP and service area then retains a responsive opportunity fit assessment', async ({ page, request }) => {
  const marker = Date.now();
  await page.goto('/');
  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();

  const control = page.getByTestId('market-fit-control');
  await expect(control.getByRole('heading', { name: 'Ideal customer and service area' })).toBeVisible();
  await control.getByRole('button', { name: 'Configure policy' }).click();
  await control.getByLabel('Profile name', { exact: true }).fill(`Browser Arnhem focus ${marker}`);
  await control.getByLabel('Services', { exact: true }).fill('Renovation\nMaintenance');
  await control.getByLabel('Client segments', { exact: true }).fill('Homeowner\nHousing association');
  await control.getByLabel('Lead sources', { exact: true }).fill('Referral\nExisting client');
  await control.getByLabel('Minimum job value', { exact: true }).fill('5000');
  await control.getByLabel('Maximum job value', { exact: true }).fill('150000');
  await control.getByLabel('Fit threshold', { exact: true }).fill('70');
  await control.getByLabel('Area', { exact: true }).pressSequentially('Arnhem core');
  await expect(control.getByLabel('Area', { exact: true })).toHaveValue('Arnhem core');
  await control.getByLabel('Country', { exact: true }).fill('NL');
  await control.getByLabel('Postal prefixes', { exact: true }).fill('68, 69');
  await control.getByLabel('Cities', { exact: true }).fill('Arnhem, Elst');
  await control.getByLabel('Travel minutes', { exact: true }).fill('45');
  await control.getByLabel('Revision reason', { exact: true }).fill('Browser QA verified the commercial focus and current travel area.');
  await control.getByRole('button', { name: 'Request approval' }).click();
  await expect(page.getByText('Market-fit policy revision retained for approval.')).toBeVisible();
  await expect(control.getByText('1 pending approval')).toBeVisible();

  await page.getByRole('button', { name: /^Approvals/ }).click();
  const approval = page.locator('.approval-item').filter({ hasText: 'Approve market-fit policy' });
  await expect(approval).toHaveCount(1);
  await approval.getByRole('button', { name: 'Review and approve' }).click();
  const review = page.getByTestId('approval-review-modal');
  await expect(review.getByText(/Fit recommendations are advisory only/i)).toBeVisible();
  await review.getByLabel('Reviewer reason').fill('Browser QA verified the ICP, job-value limits, channels, and service-area matrix.');
  await review.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  await expect(control.getByText(/policy v1/)).toBeVisible();
  const title = `Browser market fit ${marker}`;
  await page.getByTestId('pipeline-workspace').getByRole('button', { name: 'New opportunity' }).click();
  const editor = page.getByTestId('opportunity-modal');
  await editor.getByLabel('Client name').fill('Browser Market Client');
  await editor.getByLabel('Opportunity title').fill(title);
  await editor.getByLabel('Service').fill('Renovation');
  await editor.getByLabel('Source').fill('Referral');
  await editor.getByLabel('Client segment').fill('Homeowner');
  await editor.getByLabel('Estimated value').fill('25000');
  await editor.getByLabel('City').fill('Arnhem');
  await editor.getByLabel('Postal code').fill('6811 AA');
  await editor.getByLabel('Country').fill('NL');
  await editor.getByRole('button', { name: 'Retain opportunity' }).click();
  await expect(page.getByText('Opportunity retained in the preconstruction pipeline.')).toBeVisible();

  const fitRow = control.locator('.market-fit-row').filter({ hasText: title });
  await expect(fitRow).toContainText(/pursue 100%/i);
  await expect(fitRow.locator('.criterion-match')).toHaveCount(5);
  await fitRow.getByRole('button', { name: 'Retain' }).click();
  await expect(page.getByText('Current opportunity fit retained in the ledger.')).toBeVisible();
  await expect(fitRow.getByText('Retained', { exact: true })).toBeVisible();

  const opportunityResponse = await request.get(`/api/ledger/opportunities?search=${encodeURIComponent(title)}&includeClosed=true`);
  expect(opportunityResponse.ok()).toBeTruthy();
  const opportunityId = (await opportunityResponse.json()).opportunities[0].id;
  const apiFit = await request.get(`/api/ledger/opportunities/${encodeURIComponent(opportunityId)}/market-fit`);
  expect(apiFit.ok()).toBeTruthy();
  const fitPayload = await apiFit.json();
  expect(fitPayload.evaluation.recommendation).toBe('pursue');
  expect(fitPayload.assessments).toHaveLength(1);

  const bidControl = page.getByTestId('bid-decision-control');
  await expect(bidControl.getByRole('heading', { name: 'Bid / no-bid scorecard' })).toBeVisible();
  await bidControl.getByRole('button', { name: 'Configure scorecard' }).click();
  const policyEditor = page.getByRole('dialog', { name: 'Scorecard policy revision' });
  await policyEditor.getByLabel('Policy name').fill(`Browser pursuit scorecard ${marker}`);
  await policyEditor.getByLabel('Revision reason').fill('Browser QA verified the weighted criteria, thresholds, and explicit pursuit gates.');
  await expect(policyEditor.getByText('100%', { exact: true })).toBeVisible();
  await policyEditor.getByRole('button', { name: 'Request approval' }).click();
  await expect(page.getByText('Bid/no-bid policy revision retained for approval.')).toBeVisible();

  await page.getByRole('button', { name: /^Approvals/ }).click();
  const policyApproval = page.locator('.approval-item').filter({ hasText: 'Approve bid/no-bid scorecard' });
  await expect(policyApproval).toHaveCount(1);
  await policyApproval.getByRole('button', { name: 'Review and approve' }).click();
  const policyReview = page.getByTestId('approval-review-modal');
  await expect(policyReview.getByText(/cannot close a lead, create a job or tender/i)).toBeVisible();
  await policyReview.getByLabel('Reviewer reason').fill('Browser QA verified score weights, minimum ratings, thresholds, and pursuit gates.');
  await policyReview.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  await expect(bidControl.getByText(/policy v1/)).toBeVisible();
  const decisionRow = bidControl.locator('.bid-decision-row').filter({ hasText: title });
  await expect(decisionRow).toContainText(/review 20.0%/i);
  await decisionRow.getByRole('button', { name: 'Score pursuit' }).click();
  const decisionEditor = page.getByRole('dialog', { name: `Score ${title}` });
  const criteria = [
    'Client and payment confidence',
    'Scope and contract clarity',
    'Capacity and schedule feasibility',
    'Technical capability and safety',
    'Commercial return and risk',
  ];
  for (const criterion of criteria) {
    await decisionEditor.getByLabel(`${criterion} rating`).fill('5');
    await decisionEditor.getByLabel(`${criterion} evidence`).fill(`${criterion} verified against current retained browser evidence.`);
  }
  for (const gate of [
    'Scope is sufficiently defined',
    'Required capacity is available',
    'Contract risk is acceptable',
    'Payment terms are acceptable',
    'Safety and compliance obligations are achievable',
  ]) {
    await decisionEditor.getByLabel(gate).selectOption('yes');
  }
  await expect(decisionEditor.getByText(/bid \/ 100%/i)).toBeVisible();
  await decisionEditor.getByLabel('Decision rationale').fill('The current retained evidence supports investing in this pursuit.');
  await decisionEditor.getByRole('button', { name: 'Request decision approval' }).click();
  await expect(page.getByText('Pursuit decision retained for explicit approval.')).toBeVisible();

  await page.getByRole('button', { name: /^Approvals/ }).click();
  const decisionApproval = page.locator('.approval-item').filter({ hasText: `Approve bid pursuit decision for ${title}` });
  await expect(decisionApproval).toHaveCount(1);
  await decisionApproval.getByRole('button', { name: 'Review and approve' }).click();
  const decisionReview = page.getByTestId('approval-review-modal');
  await expect(decisionReview.getByText(/Does not change the opportunity stage/i)).toBeVisible();
  await decisionReview.getByLabel('Reviewer reason').fill('Browser QA verified the current policy, fit evidence, ratings, gates, and rationale.');
  await decisionReview.getByRole('button', { name: 'Confirm approval' }).click();

  await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
  await expect(decisionRow.getByText('Approved bid', { exact: true })).toBeVisible();
  const bidDecisionResponse = await request.get(`/api/ledger/opportunities/${encodeURIComponent(opportunityId)}/bid-decision`);
  expect(bidDecisionResponse.ok()).toBeTruthy();
  const bidDecisionPayload = await bidDecisionResponse.json();
  expect(bidDecisionPayload.bidDecision.currentDecision.proposedDecision).toBe('bid');
  expect(bidDecisionPayload.bidDecision.stale).toBe(false);
  const retainedOpportunity = await request.get(`/api/ledger/opportunities/${encodeURIComponent(opportunityId)}`);
  expect((await retainedOpportunity.json()).opportunity.stage).toBe('new');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(control.getByRole('heading', { name: 'Ideal customer and service area' })).toBeVisible();
  await expect(bidControl.getByRole('heading', { name: 'Bid / no-bid scorecard' })).toBeVisible();
  const containment = await control.evaluate((element) => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(containment.documentWidth).toBeLessThanOrEqual(containment.viewportWidth + 1);
  expect(containment.scrollWidth).toBeLessThanOrEqual(containment.clientWidth + 1);
  const bidContainment = await bidControl.evaluate((element) => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(bidContainment.documentWidth).toBeLessThanOrEqual(bidContainment.viewportWidth + 1);
  expect(bidContainment.scrollWidth).toBeLessThanOrEqual(bidContainment.clientWidth + 1);
});
