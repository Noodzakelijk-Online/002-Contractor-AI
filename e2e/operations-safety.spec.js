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
