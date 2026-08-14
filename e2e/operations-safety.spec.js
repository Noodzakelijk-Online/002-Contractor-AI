const { test, expect } = require('@playwright/test')
const { expectNoAxeViolations } = require('./accessibility-helpers')

async function expectNoHorizontalOverflow(page, locator) {
  const geometry = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1)
}

test('owner safety dialog suspends and resumes autonomous work accessibly', async ({ page, request }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await page.getByRole('button', { name: 'Operations', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Operations' })).toBeVisible()

  const controlPanel = page.getByTestId('automation-safety-control')
  const suspendOpener = controlPanel.getByRole('button', { name: 'Suspend autonomous drafting' })
  await suspendOpener.click()

  let dialog = page.getByRole('dialog', { name: 'Suspend autonomous drafting' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Suspend autonomous drafting' })).toBeFocused()
  const suspendSubmit = dialog.getByRole('button', { name: 'Suspend autonomous drafting', exact: true })
  await expect(suspendSubmit).toBeDisabled()
  await dialog.getByLabel('Decision reason').fill('A provider response requires an owner safety review.')
  await expect(suspendSubmit).toBeDisabled()
  await dialog.getByRole('checkbox').check()
  await expect(suspendSubmit).toBeEnabled()
  await expectNoAxeViolations(page, 'suspend automation decision dialog')
  await suspendSubmit.click()

  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('automation-safety-stop-banner')).toBeVisible()
  await expect(controlPanel.getByText('suspended', { exact: true })).toBeVisible()

  const suspendedControlResponse = await request.get('/api/operations/control')
  expect(suspendedControlResponse.ok()).toBeTruthy()
  const suspendedControl = await suspendedControlResponse.json()
  expect(suspendedControl.automation.suspended).toBe(true)
  expect(suspendedControl.automation.reason).toBe('A provider response requires an owner safety review.')
  expect(suspendedControl.automation.revision).toBe(1)

  const schedulerResponse = await request.post('/api/ledger/scheduler/run', { data: {} })
  expect(schedulerResponse.ok()).toBeTruthy()
  const scheduler = await schedulerResponse.json()
  expect(scheduler.ran).toBe(false)
  expect(scheduler.claim.reason).toBe('automation_suspended')

  const commandPlanResponse = await request.post('/api/ledger/command-plan', { data: {} })
  expect(commandPlanResponse.status()).toBe(423)
  expect((await commandPlanResponse.json()).error.code).toBe('automation_suspended')

  const resumeOpener = page.getByTestId('automation-safety-stop-banner').getByRole('button', { name: 'Resume' })
  await resumeOpener.click()
  dialog = page.getByRole('dialog', { name: 'Resume autonomous drafting' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(resumeOpener).toBeFocused()

  await resumeOpener.click()
  dialog = page.getByRole('dialog', { name: 'Resume autonomous drafting' })
  await expect(dialog.getByText('A provider response requires an owner safety review.')).toBeVisible()
  await dialog.getByLabel('Decision reason').fill('Owner verified provider behavior and ledger readiness.')
  await dialog.getByRole('checkbox').check()
  await expectNoAxeViolations(page, 'resume automation decision dialog')
  await dialog.getByRole('button', { name: 'Resume autonomous drafting', exact: true }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('automation-safety-stop-banner')).toHaveCount(0)
  await expect(controlPanel.getByText('active', { exact: true })).toBeVisible()
  const resumedControlResponse = await request.get('/api/operations/control')
  expect(resumedControlResponse.ok()).toBeTruthy()
  const resumedControl = await resumedControlResponse.json()
  expect(resumedControl.automation.suspended).toBe(false)
  expect(resumedControl.automation.revision).toBe(2)

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileOpener = controlPanel.getByRole('button', { name: 'Suspend autonomous drafting' })
  await mobileOpener.click()
  dialog = page.getByRole('dialog', { name: 'Suspend autonomous drafting' })
  await expect(dialog).toBeVisible()
  await expectNoHorizontalOverflow(page, page.locator('html'))
  await expectNoHorizontalOverflow(page, dialog)
  const cancelButton = await dialog.getByRole('button', { name: 'Cancel' }).boundingBox()
  expect(cancelButton.width).toBeGreaterThan(300)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(mobileOpener).toBeFocused()
})

test('owner previews and archives QA records through a verified maintenance decision', async ({ page, request }) => {
  test.setTimeout(120_000)
  const jobResponse = await request.post('/api/ledger/intake', {
    data: { title: 'Browser QA maintenance job', client: { name: 'QA Maintenance Client' } },
  })
  const opportunityResponse = await request.post('/api/ledger/opportunities', {
    data: { title: 'Browser QA maintenance opportunity', client: { name: 'Demo Maintenance Buyer' }, estimatedValue: 8400 },
  })
  const workerResponse = await request.post('/api/ledger/workers', {
    data: { name: 'Browser QA maintenance worker', status: 'available' },
  })
  const toolResponse = await request.post('/api/ledger/tools', {
    data: { name: 'Demo maintenance laser', category: 'measurement', status: 'available' },
  })
  expect(jobResponse.ok()).toBeTruthy()
  expect(opportunityResponse.ok()).toBeTruthy()
  expect(workerResponse.ok()).toBeTruthy()
  expect(toolResponse.ok()).toBeTruthy()
  const job = (await jobResponse.json()).job
  const opportunity = (await opportunityResponse.json()).opportunity
  const worker = (await workerResponse.json()).worker
  const tool = (await toolResponse.json()).tool

  await page.goto('/')
  await page.getByRole('button', { name: 'Operations', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Operations' })).toBeVisible()
  const opener = page.getByRole('button', { name: 'Archive QA records' })
  let releasePreview
  const delayedPreview = new Promise((resolve) => { releasePreview = resolve })
  let delayPreviewOnce = true
  await page.route('**/api/operations/reset-qa/preview', async (route) => {
    if (!delayPreviewOnce) return route.continue()
    delayPreviewOnce = false
    await delayedPreview
    return route.continue()
  })
  await opener.click()
  let dialog = page.getByRole('dialog', { name: 'Archive QA and demo records' })
  await expect(dialog.getByText('Checking the current QA and demo record set...')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  releasePreview()
  await page.waitForTimeout(250)
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
  await page.unroute('**/api/operations/reset-qa/preview')

  await opener.click()
  dialog = page.getByRole('dialog', { name: 'Archive QA and demo records' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Archive QA and demo records' })).toBeFocused()
  await expect(dialog.getByText('Browser QA maintenance job')).toBeVisible()
  await expect(dialog.getByText('Browser QA maintenance opportunity')).toBeVisible()
  await expect(dialog.getByText('Browser QA maintenance worker')).toBeVisible()
  await expect(dialog.getByText('Demo maintenance laser')).toBeVisible()
  const previewResponse = await request.get('/api/operations/reset-qa/preview')
  expect(previewResponse.ok()).toBeTruthy()
  const preview = await previewResponse.json()
  expect(preview.counts.jobs).toBeGreaterThanOrEqual(1)
  expect(preview.counts.opportunities).toBeGreaterThanOrEqual(1)
  expect(preview.counts.workers).toBeGreaterThanOrEqual(1)
  expect(preview.counts.tools).toBeGreaterThanOrEqual(1)
  const counts = dialog.getByLabel('Records included in this archive preview')
  const countItems = counts.locator(':scope > div')
  await expect(countItems.nth(0)).toContainText(String(preview.counts.jobs))
  await expect(countItems.nth(1)).toContainText(String(preview.counts.opportunities))
  await expect(countItems.nth(2)).toContainText(String(preview.counts.workers))
  await expect(countItems.nth(3)).toContainText(String(preview.counts.tools))

  let submit = dialog.getByRole('button', { name: `Archive ${preview.totalRecords} record(s)` })
  await expect(submit).toBeDisabled()
  await dialog.getByLabel('Maintenance reason').fill('Remove verified browser fixtures from active release queues.')
  await expect(submit).toBeDisabled()
  await dialog.getByLabel('Type ARCHIVE QA to confirm').fill('archive qa')
  await expect(submit).toBeDisabled()
  await dialog.getByLabel('Type ARCHIVE QA to confirm').fill('ARCHIVE QA')
  await expect(submit).toBeEnabled()
  await expectNoAxeViolations(page, 'QA archive maintenance dialog')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()

  await opener.click()
  dialog = page.getByRole('dialog', { name: 'Archive QA and demo records' })
  await dialog.getByLabel('Maintenance reason').fill('Remove verified browser fixtures from active release queues.')
  await dialog.getByLabel('Type ARCHIVE QA to confirm').fill('ARCHIVE QA')
  submit = dialog.getByRole('button', { name: `Archive ${preview.totalRecords} record(s)` })
  await submit.click()
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()

  const jobsResponse = await request.get('/api/ledger/jobs?includeArchived=true&limit=100')
  const opportunitiesResponse = await request.get('/api/ledger/opportunities?includeClosed=true&limit=100')
  const workersResponse = await request.get('/api/ledger/workers?limit=100')
  const toolsResponse = await request.get('/api/ledger/tools?limit=100')
  expect((await jobsResponse.json()).jobs.find((record) => record.id === job.id).status).toBe('archived')
  expect((await opportunitiesResponse.json()).opportunities.find((record) => record.id === opportunity.id).stage).toBe('archived')
  expect((await workersResponse.json()).workers.find((record) => record.id === worker.id).status).toBe('retired')
  expect((await toolsResponse.json()).tools.find((record) => record.id === tool.id).status).toBe('retired')

  await page.setViewportSize({ width: 390, height: 844 })
  await opener.click()
  dialog = page.getByRole('dialog', { name: 'Archive QA and demo records' })
  await expect(dialog.getByText('No eligible QA or demo records are currently active.')).toBeVisible()
  await expectNoHorizontalOverflow(page, page.locator('html'))
  await expectNoHorizontalOverflow(page, dialog)
  const cancelButton = await dialog.getByRole('button', { name: 'Cancel' }).boundingBox()
  expect(cancelButton.width).toBeGreaterThan(300)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
})
