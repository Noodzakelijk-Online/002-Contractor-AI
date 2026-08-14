const { test, expect } = require('@playwright/test')
const { expectNoAxeViolations } = require('./accessibility-helpers')

function organizationSave(page) {
  return page.waitForResponse(response => (
    response.request().method() === 'PUT'
    && new URL(response.url()).pathname === '/api/ledger/organization'
  ))
}

test('Dutch owner setup and administration preserve canonical access and safety evidence', async ({ page, request }) => {
  test.setTimeout(150_000)
  page.setDefaultTimeout(12_000)
  const suffix = Date.now()
  const legalName = `Bestuurde Aannemer ${suffix} B.V.`
  const operatorId = `beheer-noord-${suffix}`
  const operatorName = `Beheerder Noord ${suffix}`
  const suspendReason = `Operationele controle ${suffix} vereist tijdelijke opschorting.`
  const resumeReason = `Operationele controle ${suffix} is afgerond en het register is beoordeeld.`
  const consoleErrors = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  const resetIdentity = await request.put('/api/ledger/organization', {
    data: { country: 'NL', defaultPaymentTermsDays: 30, defaultQuoteValidityDays: 30 },
  })
  expect(resetIdentity.ok()).toBeTruthy()
  const qaJob = await request.post('/api/ledger/intake', {
    data: { title: `Browser QA beheer ${suffix}`, client: { name: 'QA beheerclient' } },
  })
  expect(qaJob.ok()).toBeTruthy()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.locator('header').getByLabel('Language', { exact: true }).selectOption('nl-NL')

  const setupPrompt = page.getByTestId('first-run-setup')
  await expect(setupPrompt.getByRole('heading', { name: 'Bedrijfsidentiteit voltooien' })).toBeVisible()
  await setupPrompt.getByRole('button', { name: 'Instellen voltooien' }).click()
  const onboarding = page.getByTestId('organization-onboarding')
  await expect(onboarding.getByRole('heading', { name: 'Bedrijfsidentiteit' })).toBeVisible()
  await expect(onboarding.getByText('Stap 1 van 4')).toBeVisible()
  await expectNoAxeViolations(page, 'Dutch owner onboarding identity step')
  await onboarding.getByLabel('Juridische naam').fill(legalName)
  await onboarding.getByLabel('Handelsnaam').fill(`Bestuurde Aannemer ${suffix}`)
  await onboarding.getByLabel('Registratienummer').fill('87654321')
  await onboarding.getByLabel('Btw-nummer').fill('NL987654321B01')
  let responsePromise = organizationSave(page)
  await onboarding.getByRole('button', { name: 'Opslaan en doorgaan' }).click()
  expect((await responsePromise).ok()).toBeTruthy()

  await expect(onboarding.getByText('Stap 2 van 4')).toBeVisible()
  await onboarding.getByLabel('Vestigingsadres').fill('Gereedschapstraat 14')
  await onboarding.getByLabel('Postcode').fill('3511 AA')
  await onboarding.getByLabel('Plaats').fill('Utrecht')
  await onboarding.getByLabel('E-mail').fill(`beheer-${suffix}@example.test`)
  responsePromise = organizationSave(page)
  await onboarding.getByRole('button', { name: 'Opslaan en doorgaan' }).click()
  expect((await responsePromise).ok()).toBeTruthy()

  await expect(onboarding.getByText('Stap 3 van 4')).toBeVisible()
  await onboarding.getByLabel('Betalingstermijn (dagen)').fill('21')
  await onboarding.getByLabel('Geldigheid offerte (dagen)').fill('45')
  await onboarding.getByLabel('Offertevoorwaarden').fill('Meerwerk vereist een afzonderlijk vastgelegd akkoord.')
  responsePromise = organizationSave(page)
  await onboarding.getByRole('button', { name: 'Opslaan en doorgaan' }).click()
  expect((await responsePromise).ok()).toBeTruthy()

  await expect(onboarding.getByText('Stap 4 van 4')).toBeVisible()
  await expect(onboarding.getByText('Bedrijfsidentiteit is gereed voor uitgifte')).toBeVisible()
  await expect(onboarding.getByText(legalName)).toBeVisible()
  expect(await onboarding.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await onboarding.getByRole('button', { name: 'Instellen voltooien' }).click()

  const organization = await (await request.get('/api/ledger/organization')).json()
  expect(organization.organization).toMatchObject({
    legalName,
    registrationNumber: '87654321',
    email: `beheer-${suffix}@example.test`,
    defaultPaymentTermsDays: 21,
    defaultQuoteValidityDays: 45,
    readiness: { ready: true },
  })

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: 'Beheer', exact: true }).click()
  const identityPanel = page.getByTestId('organization-profile-panel')
  await expect(identityPanel.getByRole('heading', { name: 'Bedrijfsidentiteit' })).toBeVisible()
  await expect(identityPanel.getByText('gereed voor uitgifte', { exact: true })).toBeVisible()
  await expect(identityPanel.getByLabel('Juridische naam')).toHaveValue(legalName)

  const team = page.getByTestId('team-access-control')
  await expect(team.getByRole('heading', { name: 'Teamtoegang' })).toBeVisible()
  await team.getByRole('button', { name: 'Operator toevoegen' }).click()
  let dialog = page.getByRole('dialog', { name: 'Operator toevoegen' })
  await expectNoAxeViolations(page, 'Dutch managed operator editor')
  await dialog.getByLabel('Operator-ID').fill(operatorId)
  await dialog.getByLabel('Weergavenaam').fill(operatorName)
  await dialog.getByLabel('Rol').selectOption('office_operator')
  await dialog.getByRole('button', { name: 'Toegang maken' }).click()

  const issuedKey = page.getByTestId('issued-operator-access-key')
  await expect(issuedKey).toBeVisible()
  const firstKey = await issuedKey.inputValue()
  expect(firstKey).toMatch(/^cai_[A-Za-z0-9_-]{43}$/)
  await page.getByRole('button', { name: 'Ik heb de sleutel opgeslagen' }).click()
  const accountRow = team.locator('.team-access-row').filter({ hasText: operatorId })
  await expect(accountRow).toContainText('Sleutelversie 1')
  await expect(accountRow.locator('.status')).toHaveText('actief')

  await accountRow.getByRole('button', { name: 'Sleutel roteren' }).click()
  dialog = page.getByRole('dialog', { name: 'Toegangssleutel roteren' })
  await dialog.getByRole('button', { name: 'Sleutel uitgeven' }).click()
  const secondKey = await issuedKey.inputValue()
  expect(secondKey).toMatch(/^cai_[A-Za-z0-9_-]{43}$/)
  expect(secondKey).not.toBe(firstKey)
  await page.getByRole('button', { name: 'Ik heb de sleutel opgeslagen' }).click()
  await expect(accountRow).toContainText('Sleutelversie 2')
  await accountRow.getByRole('button', { name: 'Deactiveren' }).click()
  dialog = page.getByRole('dialog', { name: 'Operator deactiveren' })
  await dialog.getByRole('button', { name: 'Toegang deactiveren' }).click()
  await expect(accountRow.locator('.status')).toHaveText('gedeactiveerd')

  const register = await (await request.get('/api/operations/operators')).json()
  const retainedOperator = register.accounts.find(account => account.id === operatorId)
  expect(retainedOperator).toMatchObject({ role: 'office_operator', status: 'deactivated', keyVersion: 2 })
  expect(JSON.stringify(register)).not.toContain(firstKey)
  expect(JSON.stringify(register)).not.toContain(secondKey)

  const safety = page.getByTestId('automation-safety-control')
  await safety.getByRole('button', { name: 'Autonoom opstellen opschorten' }).click()
  dialog = page.getByRole('dialog', { name: 'Autonoom opstellen opschorten' })
  await expectNoAxeViolations(page, 'Dutch autonomous drafting safety stop')
  await dialog.getByLabel('Reden van besluit').fill(suspendReason)
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Autonoom opstellen opschorten', exact: true }).click()
  await expect(page.getByTestId('automation-safety-stop-banner')).toBeVisible()

  await page.getByTestId('automation-safety-stop-banner').getByRole('button', { name: 'Hervatten' }).click()
  dialog = page.getByRole('dialog', { name: 'Autonoom opstellen hervatten' })
  await expect(dialog.getByText(suspendReason)).toBeVisible()
  await dialog.getByLabel('Reden van besluit').fill(resumeReason)
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Autonoom opstellen hervatten', exact: true }).click()
  const control = await (await request.get('/api/operations/control')).json()
  expect(control.automation).toMatchObject({ suspended: false, reason: resumeReason })

  await page.getByRole('button', { name: 'QA-records archiveren' }).click()
  dialog = page.getByRole('dialog', { name: 'QA- en demorecords archiveren' })
  await expect(dialog.getByText('Herstelpakket vereist')).toBeVisible()
  await expect(dialog.getByText(`Browser QA beheer ${suffix}`)).toBeVisible()
  await expect(dialog.getByLabel('Onderhoudsreden')).toBeVisible()
  await expectNoAxeViolations(page, 'Dutch QA archive preview')
  await dialog.getByRole('button', { name: 'Dialoog voor QA-archief sluiten' }).click()

  await page.locator('header').getByLabel('Taal', { exact: true }).selectOption('en-GB')
  await expect(identityPanel.getByRole('heading', { name: 'Business identity' })).toBeVisible()
  await expect(team.getByRole('heading', { name: 'Team access' })).toBeVisible()
  await expect(identityPanel.getByLabel('Legal name')).toHaveValue(legalName)
  await expect(accountRow).toContainText(operatorName)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(consoleErrors).toEqual([])
})
