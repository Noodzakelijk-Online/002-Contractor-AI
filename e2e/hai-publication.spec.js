const { test, expect } = require('@playwright/test')
const { expectNoAxeViolations } = require('./accessibility-helpers')

test('owner publishes the verified read-only HAI feed and round-trips its status in Dutch', async ({ page, request }) => {
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto('/')
  await page.locator('header').getByLabel(/^(Language|Taal)$/).selectOption('en-GB')
  await page.getByRole('button', { name: 'Operations', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Operations' })).toBeVisible()

  const readiness = page.getByTestId('hai-connector-readiness')
  await expect(readiness).toBeVisible()
  const publish = page.getByRole('button', { name: 'Publish to HAI', exact: true })
  await expect(publish).toBeEnabled()
  await publish.click()

  await expect(page.getByText(/HAI feed published with \d+ read-only action\(s\)\./)).toBeVisible()
  const statusResponse = await request.get('/api/integrations/hai/status')
  expect(statusResponse.ok()).toBeTruthy()
  const status = await statusResponse.json()
  expect(status.publication.status).toBe('published')
  expect(status.publication.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(status.externalCommitments).toBe(0)
  expect(status.canExecute).toBe(false)
  await expect(readiness).toContainText(`${status.publication.itemCount} action(s) published`)

  await page.locator('header').getByLabel('Language', { exact: true }).selectOption('nl-NL')
  await expect(page.getByRole('button', { name: 'Naar HAI publiceren', exact: true })).toBeEnabled()
  await expect(page.getByRole('link', { name: 'HAI-feed downloaden', exact: true })).toBeVisible()
  await expect(readiness).toContainText(`${status.publication.itemCount} actie(s) gepubliceerd`)
  await expectNoAxeViolations(page, 'published HAI local-feed controls')
  expect(consoleErrors).toEqual([])
})
