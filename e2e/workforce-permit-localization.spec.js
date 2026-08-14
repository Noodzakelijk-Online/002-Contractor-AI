const { test, expect } = require('@playwright/test')
const { expectNoAxeViolations } = require('./accessibility-helpers')

async function postJson(request, route, data) {
  const response = await request.post(route, { data })
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy()
  return response.json()
}

function localDateTime(offsetMs) {
  const date = new Date(Date.now() + offsetMs)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

async function openDutchResources(page, mode) {
  await page.getByRole('button', { name: 'Middelen', exact: true }).click()
  const workspace = page.getByTestId('resources-workspace')
  await expect(workspace.getByRole('heading', { name: 'Gereedheid middelen', exact: true })).toBeVisible()
  if (mode) await workspace.getByRole('tab', { name: mode, exact: true }).click()
  return workspace
}

async function openDutchPermit(page, jobId, permitId = '') {
  await page.getByRole('button', { name: 'Buitendienst', exact: true }).click()
  const panel = page.getByTestId('work-permit-control')
  await expect(panel.getByRole('heading', { name: 'Werkvergunningen', exact: true })).toBeVisible()
  const selectors = panel.locator('.work-permit-selector select')
  await selectors.nth(0).selectOption(jobId)
  if (permitId) {
    await expect(selectors.nth(1).locator(`option[value="${permitId}"]`)).toHaveCount(1)
    await selectors.nth(1).selectOption(permitId)
  }
  return panel
}

test('Dutch workforce readiness and work permits preserve canonical retained evidence', async ({ page, request }) => {
  test.setTimeout(180_000)
  page.setDefaultTimeout(15_000)
  const suffix = Date.now()
  const workerName = `Vakmedewerker Rivierenland ${suffix}`
  const workerRole = 'Elektromonteur hoofdverdeler'
  const workerNotes = `Alleen planning met werkvergunning ${suffix}`
  const requirementTitle = `Actuele VCA voor hoofdverdeler ${suffix}`
  const credentialReference = `VCA-registerbron-${suffix}`
  const availabilityTitle = `Vaktechnische cursus ${suffix}`
  const availabilityNotes = `Capaciteitsvenster opleiding ${suffix}`
  const permitTitle = `Vrijschakeling hoofdverdeler ${suffix}`
  const permitHazard = `Opgeslagen elektrische energie ${suffix}`
  const permitControl = `Vergrendelen, markeren en spanningsloos aantonen ${suffix}`
  const permitCondition = `Stoppen bij wijziging van de scheidingsgrens ${suffix}`
  const permitSource = `TRA-hoofdverdeler-${suffix}`
  const suspensionReason = `Scheidingsgrens gewijzigd tijdens uitvoering ${suffix}`
  const suspensionEvidence = `Werkstop-observatie-${suffix}`
  const closureNote = `Installatie veilig overgedragen na controle ${suffix}`
  const closureEvidence = `Overdrachtsbewijs-${suffix}`
  const consoleErrors = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  const job = (await postJson(request, '/api/ledger/intake', {
    title: `Hoofdverdeler renovatie ${suffix}`,
    client: { name: `Opdrachtgever Rivierenland ${suffix}` },
    status: 'in_progress',
    assignAutomatically: false,
  })).job

  await page.goto('/')
  await page.locator('header').getByLabel(/^(Language|Taal)$/).selectOption('en-GB')
  await page.locator('header').getByLabel('Language', { exact: true }).selectOption('nl-NL')

  let resources = await openDutchResources(page, 'Ploegenregister')
  await resources.getByRole('button', { name: 'Ploeglid toevoegen' }).click()
  let dialog = page.getByTestId('worker-editor')
  await expect(dialog.getByRole('heading', { name: 'Ploeglid toevoegen' })).toBeVisible()
  await expectNoAxeViolations(page, 'Dutch retained crew editor')
  await dialog.getByLabel('Volledige naam').fill(workerName)
  await dialog.getByLabel('Rol of vak').fill(workerRole)
  await dialog.getByLabel('Beschikbaarheidsstatus').selectOption('available')
  await dialog.getByLabel('E-mail').fill(`vakmedewerker-${suffix}@example.test`)
  await dialog.getByLabel('Thuisregio').fill('Rivierenland')
  await dialog.getByLabel('Uurtarief kosten (EUR)').fill('58.75')
  await dialog.getByLabel('Vaardigheden').fill('NEN 3140, verdeelinrichtingen, renovatie')
  await dialog.getByLabel('Interne notities').fill(workerNotes)
  await dialog.getByRole('button', { name: 'Vastgelegd ploeglid opslaan' }).click()
  await expect(dialog).toBeHidden()

  const workerRegister = await (await request.get('/api/ledger/workers?limit=100')).json()
  const worker = workerRegister.workers.find(item => item.name === workerName)
  expect(worker).toMatchObject({ role: workerRole, status: 'available', homeRegion: 'Rivierenland', data: { notes: workerNotes } })
  expect(worker.skills).toEqual(['NEN 3140', 'verdeelinrichtingen', 'renovatie'])

  const assignment = await postJson(request, `/api/ledger/jobs/${job.id}/assignments`, {
    workerId: worker.id,
    workerName,
    role: workerRole,
    status: 'assigned',
  })
  if (assignment.approval?.id) {
    await postJson(request, `/api/ledger/approvals/${assignment.approval.id}/resolve`, {
      status: 'approved',
      reason: 'Medewerker, rol, capaciteit en opdrachttoewijzing geverifieerd.',
    })
  }

  await page.reload()
  resources = await openDutchResources(page, 'Kwalificaties')
  await resources.getByRole('button', { name: 'Opdrachtvereiste toevoegen' }).click()
  dialog = page.getByTestId('qualification-requirement-editor')
  await expect(dialog.getByRole('heading', { name: 'Kwalificatievereiste toevoegen' })).toBeVisible()
  await dialog.getByLabel('Opdracht').selectOption(job.id)
  await dialog.getByLabel('Type vereiste').selectOption('vca')
  await expect(dialog.getByLabel('Type vereiste').locator('option:checked')).toHaveText('VCA (Basis of VOL)')
  await dialog.getByLabel('Van toepassing op rol').fill(workerRole)
  await dialog.getByLabel('Titel vereiste').fill(requirementTitle)
  await dialog.getByRole('button', { name: 'Vereiste handhaven' }).click()
  await expect(dialog).toBeHidden()
  await expect(resources.getByText(requirementTitle)).toBeVisible()
  await expect(resources.getByText('VCA (Basis of VOL)', { exact: true })).toBeVisible()

  const qualificationRow = resources.locator('.qualification-worker-row').filter({ hasText: workerName })
  await qualificationRow.getByRole('button', { name: 'Onderbouwing toevoegen' }).click()
  dialog = page.getByTestId('credential-editor')
  await expect(dialog.getByRole('heading', { name: `Kwalificatie toevoegen voor ${workerName}` })).toBeVisible()
  await expectNoAxeViolations(page, 'Dutch qualification evidence editor')
  await dialog.getByLabel('Kwalificatietype').selectOption('vca_basic')
  await expect(dialog.getByLabel('Kwalificatietype').locator('option:checked')).toHaveText('VCA Basis')
  await dialog.getByLabel('Uitgevende instantie').fill('SSVV gecontroleerde bron')
  await dialog.getByLabel('Kwalificatienummer').fill(`VCA-${suffix}`)
  await dialog.getByLabel('Verloopt op').fill(new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10))
  await dialog.getByLabel('Onderbouwingsreferentie').fill(credentialReference)
  await dialog.getByRole('button', { name: 'Verificatie onderbouwing aanvragen' }).click()
  await expect(dialog).toBeHidden()

  const pendingApprovals = await (await request.get('/api/ledger/approvals?status=pending&limit=100')).json()
  const credentialApproval = pendingApprovals.approvals.find(item => item.targetType === 'worker_credential' && item.data?.workerId === worker.id)
  expect(credentialApproval).toBeTruthy()
  await postJson(request, `/api/ledger/approvals/${credentialApproval.id}/resolve`, {
    status: 'approved',
    reason: 'Kwalificatie-identiteit, instantie, geldigheid en bron geverifieerd.',
  })

  await page.reload()
  resources = await openDutchResources(page, 'Kwalificaties')
  await expect(resources.locator('.qualification-worker-row').filter({ hasText: workerName }).getByText('geldig', { exact: true })).toBeVisible()
  await expect(resources.getByText('VCA Basic', { exact: true })).toBeVisible()
  const qualificationRegister = await (await request.get('/api/ledger/qualifications')).json()
  expect(JSON.stringify(qualificationRegister)).toContain(credentialReference)

  await resources.getByRole('tab', { name: 'Beschikbaarheid', exact: true }).click()
  await resources.getByRole('button', { name: 'Onbeschikbaarheid toevoegen' }).click()
  dialog = page.getByTestId('availability-editor')
  await expect(dialog.getByRole('heading', { name: 'Onbeschikbaarheid medewerker toevoegen' })).toBeVisible()
  await dialog.getByLabel('Medewerker').selectOption(worker.id)
  await dialog.getByLabel('Operationeel type').selectOption('training')
  await dialog.getByLabel('Weergavetitel').fill(availabilityTitle)
  await dialog.getByLabel('Begint').fill(localDateTime(24 * 60 * 60 * 1000))
  await dialog.getByLabel('Eindigt').fill(localDateTime(26 * 60 * 60 * 1000))
  await dialog.getByLabel('Operationele notitie').fill(availabilityNotes)
  await dialog.getByRole('button', { name: 'Beschikbaarheidsvenster blokkeren' }).click()
  await expect(dialog).toBeHidden()
  const availability = await (await request.get(`/api/ledger/workers/${worker.id}/availability`)).json()
  expect(availability.periods.find(item => item.title === availabilityTitle)).toMatchObject({ periodType: 'training' })
  expect(JSON.stringify(availability)).toContain(availabilityNotes)

  let permitPanel = await openDutchPermit(page, job.id)
  await permitPanel.getByLabel('Type werkvergunning').selectOption('electrical_isolation')
  await expect(permitPanel.getByLabel('Type werkvergunning').locator('option:checked')).toHaveText('Elektrische vrijschakeling')
  await permitPanel.getByLabel('Titel', { exact: true }).fill(permitTitle)
  await permitPanel.getByLabel('Locatie', { exact: true }).fill('Technische ruimte begane grond')
  await permitPanel.getByLabel('Geldig vanaf', { exact: true }).fill(localDateTime(-5 * 60 * 1000))
  await permitPanel.getByLabel('Verloopt', { exact: true }).fill(localDateTime(4 * 60 * 60 * 1000))
  await permitPanel.getByLabel('Brononderbouwing', { exact: true }).fill(permitSource)
  await permitPanel.getByLabel('Gevaren', { exact: true }).fill(permitHazard)
  await permitPanel.getByLabel('Beheersmaatregelen', { exact: true }).fill(permitControl)
  await permitPanel.getByLabel('Voorwaarden', { exact: true }).fill(permitCondition)
  await expectNoAxeViolations(page, 'Dutch governed work permit request')
  await permitPanel.getByRole('button', { name: 'Goedkeuring aanvragen' }).click()
  await expect(page.getByText('De definitie van de werkvergunning en de toegewezen ploeg zijn vastgezet voor goedkeuring.')).toBeVisible()

  const permitRegister = await (await request.get(`/api/ledger/jobs/${job.id}/work-permits`)).json()
  const permit = permitRegister.workPermits.find(item => item.title === permitTitle)
  expect(permit).toMatchObject({ permitType: 'electrical_isolation', evidenceReference: permitSource, status: 'pending_approval' })
  expect(permit.hazards).toEqual([permitHazard])
  expect(permit.controls).toEqual([permitControl])
  expect(permit.conditions).toEqual([permitCondition])
  await postJson(request, `/api/ledger/approvals/${permit.approvalId}/resolve`, {
    status: 'approved',
    reason: 'Gevaren, beheersmaatregelen, geldigheid, bron en toegewezen ploeg geverifieerd.',
  })

  await page.reload()
  permitPanel = await openDutchPermit(page, job.id, permit.id)
  await expect(permitPanel.locator('.work-permit-state .status')).toHaveText('actief')
  await expect(permitPanel.locator('.work-permit-context small')).toContainText('elektrische vrijschakeling')
  await expect(permitPanel.getByText('1 bevestiging door een toegewezen medewerker staat nog open.')).toBeVisible()
  await postJson(request, `/api/ledger/jobs/${job.id}/work-permits/${permit.id}/acknowledgments`, {
    entryKey: `permit-ack-${suffix}`,
    workerId: worker.id,
    workerName,
    acknowledged: true,
    evidenceReference: `Werkvergunning-bevestiging-${suffix}`,
    attestation: 'Canonical retained worker acknowledgement.',
  })

  await page.reload()
  permitPanel = await openDutchPermit(page, job.id, permit.id)
  await expect(permitPanel.getByText('Gereed', { exact: true })).toBeVisible()
  const suspendForm = permitPanel.locator('.work-permit-actions form').filter({ hasText: 'Werkvergunning opschorten' })
  await suspendForm.getByLabel('Reden voor werkstop').fill(suspensionReason)
  await suspendForm.getByLabel('Onderbouwingsreferentie').fill(suspensionEvidence)
  await suspendForm.getByRole('button', { name: 'Opschorten' }).click()
  await expect(page.getByText('Werkvergunning opgeschort. Het werk moet gestopt blijven tot een nieuwe goedgekeurde werkvergunning is afgegeven.')).toBeVisible()
  await expect(permitPanel.locator('.work-permit-state .status')).toHaveText('opgeschort')
  await expect(permitPanel.getByText('Status van de werkvergunning is opgeschort.')).toBeVisible()

  const closeForm = permitPanel.locator('.work-permit-actions form').filter({ hasText: 'Werkvergunning sluiten' })
  await closeForm.getByLabel('Voltooiingsnotitie').fill(closureNote)
  await closeForm.getByLabel('Afsluitende onderbouwing').fill(closureEvidence)
  await closeForm.getByRole('button', { name: 'Werkvergunning sluiten' }).click()
  await expect(page.getByText('Werkvergunning gesloten met vastgelegde afsluitende onderbouwing.')).toBeVisible()
  await expect(permitPanel.locator('.work-permit-state .status')).toHaveText('gesloten')

  const retainedPermit = (await (await request.get(`/api/ledger/jobs/${job.id}/work-permits`)).json()).workPermits.find(item => item.id === permit.id)
  expect(retainedPermit.closureEvidenceReference).toBe(closureEvidence)
  expect(retainedPermit.data.suspension).toMatchObject({ reason: suspensionReason, evidenceReference: suspensionEvidence })
  expect(retainedPermit.data.closure).toMatchObject({ note: closureNote, evidenceReference: closureEvidence })

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await permitPanel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.locator('header').getByLabel('Taal', { exact: true }).selectOption('en-GB')
  await expect(permitPanel.getByRole('heading', { name: 'Work permits' })).toBeVisible()
  await expect(permitPanel.locator('.work-permit-context strong')).toHaveText(permitTitle)
  expect(consoleErrors).toEqual([])
})
