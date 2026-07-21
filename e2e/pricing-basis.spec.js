const { test, expect } = require('@playwright/test');

async function createJob(request, title) {
  const response = await request.post('/api/ledger/intake', {
    data: {
      title,
      service: 'Interior renovation',
      address: 'Prinsengracht 100, Amsterdam',
      city: 'Amsterdam',
      priority: 'normal',
      estimatedHours: 80,
      estimatedCost: 12000,
      assignAutomatically: false,
      client: { name: 'Pricing Basis Browser Client', email: 'pricing-basis@example.test', country: 'NL' }
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function completeFactorEvidence(dialog, status = 'yes') {
  const rows = dialog.locator('.pricing-factor-row');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    await row.getByLabel('Assessment').selectOption(status);
    await row.getByLabel('Retained evidence').fill(`Browser evidence ${index + 1} verifies this commercial factor.`);
  }
}

async function approveCommercialScope(request, jobId, entryKey) {
  const requested = await request.post(`/api/ledger/jobs/${jobId}/commercial-scope/revisions`, {
    data: {
      entryKey,
      title: 'Browser pricing written scope',
      scopeSummary: 'Deliver the retained interior renovation work within the recorded project boundary.',
      inclusions: ['Complete the retained interior renovation work.'],
      assumptions: ['The recorded access and source evidence remain current.'],
      exclusions: ['Latent hazardous materials and concealed structural repairs are excluded.'],
      clientResponsibilities: ['Provide clear access before mobilisation.'],
      contractorResponsibilities: ['Retain installation and completion evidence.'],
      allowanceMode: 'none',
      noAllowanceReason: 'The retained browser pricing scope contains no allowances.',
      reason: 'Establish the current written commercial basis before pricing.'
    }
  });
  expect(requested.ok()).toBeTruthy();
  const body = await requested.json();
  const approved = await request.post(`/api/ledger/approvals/${body.approval.id}/resolve`, {
    data: {
      status: 'approved',
      resolvedBy: 'Browser commercial approver',
      reason: 'Written scope, assumptions, exclusions, source evidence, and allowance position verified.'
    }
  });
  expect(approved.ok()).toBeTruthy();
  return body.revision;
}

test('operator retains source-bound fixed-price and T&M decisions with governed override evidence', async ({ page, request }) => {
  const key = Date.now();
  const title = `Browser pricing basis ${key}`;
  const intake = await createJob(request, title);
  await approveCommercialScope(request, intake.job.id, `browser-pricing-scope-${key}-01`);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  const workspace = page.getByTestId('job-workspace');
  const commercial = workspace.getByTestId('commercial-control');
  const scopeControl = commercial.getByTestId('commercial-scope-control');
  const basisControl = commercial.getByTestId('pricing-basis-control');
  const newEstimate = commercial.getByRole('button', { name: 'New estimate' });

  await expect(basisControl).toContainText('Commercial pricing basis not retained');
  await expect(newEstimate).toBeDisabled();
  await commercial.getByRole('button', { name: 'Assess basis' }).click();
  let dialog = page.getByTestId('pricing-basis-form');
  await expect(dialog.getByRole('heading', { name: 'Fixed price or time and materials' })).toBeVisible();
  await completeFactorEvidence(dialog);
  const preview = dialog.getByLabel('Pricing-basis recommendation');
  await expect(preview).toContainText('Fixed price');
  await expect(preview).toContainText('100%');
  await expect(preview).toContainText('Critical blockers0');
  await dialog.getByLabel('Decision rationale').fill('All retained evidence supports a scope-bound fixed-price estimate.');
  await dialog.getByRole('button', { name: 'Retain pricing basis' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Fixed price pricing basis v1 retained/i)).toBeVisible();
  await expect(basisControl).toContainText('Fixed price');
  await expect(basisControl).toContainText('Source current');
  await expect(newEstimate).toBeEnabled();

  await newEstimate.click();
  let estimateDialog = page.getByTestId('commercial-draft-modal');
  await expect(estimateDialog.getByRole('heading', { name: 'New fixed-price estimate' })).toBeVisible();
  await expect(estimateDialog.getByTestId('commercial-draft-pricing-basis')).toContainText('approved changes remain separate');
  await estimateDialog.getByRole('button', { name: 'Cancel' }).click();

  await commercial.getByRole('button', { name: 'Reassess' }).click();
  dialog = page.getByTestId('pricing-basis-form');
  const criticalScope = dialog.getByTestId('pricing-factor-scope_defined');
  await criticalScope.getByLabel('Assessment').selectOption('no');
  await criticalScope.getByLabel('Retained evidence').fill('Scope interfaces remain unresolved after the retained site review.');
  await expect(dialog.getByLabel('Pricing-basis recommendation')).toContainText('Time and materials');
  await expect(dialog.getByLabel('Pricing-basis recommendation')).toContainText('85%');
  await dialog.getByLabel('Decision rationale').fill('Commercial leadership elects fixed price with a separately retained risk control.');
  await expect(dialog.getByText('Override reason')).toBeVisible();
  const retainOverride = dialog.getByRole('button', { name: 'Retain pricing basis' });
  await expect(retainOverride).toBeDisabled();
  await dialog.getByLabel('Override reason').fill('A ring-fenced allowance and explicit exclusion control the unresolved interface.');
  await expect(retainOverride).toBeEnabled();
  await retainOverride.click();
  await expect(dialog).toBeHidden();
  await expect(basisControl).toContainText('Override');
  await expect(basisControl).toContainText('v2');

  await commercial.getByRole('button', { name: 'Reassess' }).click();
  dialog = page.getByTestId('pricing-basis-form');
  await dialog.getByLabel('Time and materials').check();
  await dialog.getByLabel('Decision rationale').fill('Unresolved scope interfaces require measured time and material evidence.');
  await expect(dialog.getByText('Override reason')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Retain pricing basis' }).click();
  await expect(dialog).toBeHidden();
  await expect(basisControl).toContainText('Time and materials');
  await expect(basisControl).toContainText('v3');

  await newEstimate.click();
  estimateDialog = page.getByTestId('commercial-draft-modal');
  await expect(estimateDialog.getByRole('heading', { name: 'New T&M budget estimate' })).toBeVisible();
  await expect(estimateDialog.getByTestId('commercial-draft-pricing-basis')).toContainText('actual billing requires retained time, material, rate, and work evidence');
  await estimateDialog.getByRole('button', { name: 'Cancel' }).click();

  const takeoffResponse = await request.post(`/api/ledger/jobs/${intake.job.id}/takeoffs`, {
    data: { title: 'Newly retained scope source', currency: 'EUR', taxRate: 21 }
  });
  expect(takeoffResponse.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  await expect(workspace.getByRole('heading', { name: title })).toBeVisible();
  await expect(scopeControl).toContainText('Commercial scope requires revision');
  await expect(scopeControl).toContainText('Source changed');
  await expect(basisControl).toContainText('Commercial basis requires reassessment');
  await expect(basisControl).toContainText('Source changed');
  await expect(newEstimate).toBeDisabled();
  await expect(commercial.getByRole('button', { name: 'Reassess' })).toBeDisabled();

  await approveCommercialScope(request, intake.job.id, `browser-pricing-scope-${key}-02`);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: `Open ${title}` }).first().click();
  await expect(workspace.getByRole('heading', { name: title })).toBeVisible();
  await expect(scopeControl).toContainText('Approved + current');
  await expect(commercial.getByRole('button', { name: 'Reassess' })).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await commercial.getByRole('button', { name: 'Reassess' }).click();
  dialog = page.getByTestId('pricing-basis-form');
  const geometry = await dialog.evaluate(element => ({
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    viewportWidth: window.innerWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth
  }));
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);

  const detailResponse = await request.get(`/api/ledger/jobs/${intake.job.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  expect(detail.job.pricingDecisions).toHaveLength(3);
  expect(detail.job.pricingDecisions.map(decision => decision.status)).toEqual(['current', 'superseded', 'superseded']);
  expect(detail.job.pricingBasis.stale).toBe(true);
  expect(detail.job.pricingBasis.currentDecision.selectedModel).toBe('time_and_materials');
  expect(detail.job.pricingBasis.currentDecision.snapshot.override).toBe(false);
});
