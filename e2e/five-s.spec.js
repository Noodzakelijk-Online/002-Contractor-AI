const { test, expect } = require('@playwright/test')

async function postJson(request, route, data) {
  const response = await request.post(route, { data })
  expect(response.ok(), `${route}: ${await response.text()}`).toBeTruthy()
  return response.json()
}

function standardItems(toolId, locationName) {
  return [
    { id: 'sort', stage: 'sort', title: 'Remove unneeded stock', requirement: 'Only planned task stock remains in the vehicle.' },
    { id: 'set', stage: 'set_in_order', itemType: 'tool', toolId, expectedLocation: locationName, title: 'Return saw to marked home', requirement: 'Saw is available, inspection-ready, and in its marked position.' },
    { id: 'shine', stage: 'shine', title: 'Clean vehicle storage', requirement: 'Storage and equipment are clean enough to expose defects.' },
    { id: 'standardize', stage: 'standardize', title: 'Keep labels current', requirement: 'Labels and position markings match the retained standard.' },
    { id: 'sustain', stage: 'sustain', title: 'Retain audit routine', requirement: 'The current standard and cadence are visible to the crew.' },
  ]
}

async function fixture(request, suffix, prefix = 'Browser 5S') {
  const job = (await postJson(request, '/api/ledger/intake', {
    title: `${prefix} job ${suffix}`,
    client: { name: `${prefix} client ${suffix}` },
    status: 'in_progress',
    assignAutomatically: false,
  })).job
  const locationName = `${prefix} service van ${suffix}`
  const tool = (await postJson(request, '/api/ledger/tools', {
    name: `${prefix} track saw ${suffix}`,
    category: 'cutting',
    status: 'available',
    currentLocation: locationName,
  })).tool
  return { job, tool, locationName }
}

test('office 5S workspace governs standard approval, audits, corrective action, and mobile layout', async ({ page, request }) => {
  const suffix = Date.now()
  const { job, tool, locationName } = await fixture(request, suffix)
  const consoleErrors = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', error => consoleErrors.push(error.message))

  await page.goto('/')
  await page.getByRole('button', { name: 'Resources', exact: true }).click()
  const resources = page.getByTestId('resources-workspace')
  await resources.getByRole('tab', { name: '5S', exact: true }).click()
  const workspace = page.getByTestId('five-s-workspace')
  await expect(workspace).toBeVisible()
  await expect(workspace.getByText('Loading retained 5S controls...', { exact: true })).toBeHidden()
  await page.getByRole('combobox', { name: 'Language' }).selectOption('nl-NL')
  await expect(resources.getByRole('heading', { name: '5S-organisatiebeheer' })).toBeVisible()
  await expect(workspace.getByLabel('Samenvatting 5S-gereedheid')).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Middelen', exact: true }).click()
  await resources.getByRole('tab', { name: '5S', exact: true }).click()
  await expect(resources.getByRole('heading', { name: '5S-organisatiebeheer' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Taal' }).selectOption('en-GB')
  await expect(resources.getByRole('heading', { name: '5S organization control' })).toBeVisible()
  await workspace.getByRole('button', { name: 'Add location' }).click()
  const locationForm = page.getByTestId('five-s-location-form')
  await locationForm.getByLabel('Job scope').selectOption(job.id)
  await locationForm.getByLabel('Location type').selectOption('vehicle')
  await locationForm.getByLabel('Name').fill(locationName)
  await locationForm.getByLabel('Identifier').fill(`QA-VAN-${suffix}`)
  await locationForm.getByLabel('Owner').fill('Browser site lead')
  await locationForm.getByLabel('Audit frequency').fill('7')
  await locationForm.getByRole('button', { name: 'Retain location' }).click()
  await expect(workspace.getByText(`${locationName} was retained as a governed 5S location.`)).toBeVisible()

  await workspace.getByRole('button', { name: 'Create standard' }).click()
  const standardForm = page.getByTestId('five-s-standard-form')
  await standardForm.getByLabel('Canonical equipment link').selectOption(tool.id)
  await standardForm.getByRole('button', { name: 'Request approval' }).click()

  const approval = page.locator('.approval-item').filter({ hasText: locationName }).filter({ hasText: '5S standard' })
  await expect(approval).toHaveCount(1)
  await approval.getByRole('button', { name: 'Review and approve' }).click()
  const review = page.getByTestId('approval-review-modal')
  await expect(review).toContainText('Does not change tool status or custody')
  await review.getByLabel('Reviewer reason').fill('Browser QA verified all five stages, location ownership, cadence, and canonical equipment identity.')
  await review.getByRole('button', { name: 'Confirm approval' }).click()
  await expect(page.getByText('Approval approved. The ledger and audit trail were updated.')).toBeVisible()

  await page.getByRole('button', { name: 'Resources', exact: true }).click()
  await resources.getByRole('tab', { name: '5S', exact: true }).click()
  await expect(workspace.getByText(locationName, { exact: true }).first()).toBeVisible()
  await workspace.getByRole('button', { name: 'Start 5S audit' }).click()
  let auditForm = page.getByTestId('five-s-audit-form')
  await auditForm.getByLabel('Audited by').fill('Browser site lead')
  await auditForm.getByLabel('Evidence references').fill(`browser-five-s-photo-set:${suffix}`)
  const shineCheck = auditForm.locator('.five-s-check').filter({ hasText: 'Shine' })
  await shineCheck.getByRole('radio', { name: 'Fail' }).check()
  await shineCheck.getByLabel('Finding').fill('Cutting dust remains on the lower vehicle shelf.')
  await shineCheck.getByLabel('Action owner').fill('Browser site lead')
  await shineCheck.getByLabel('Due date').fill(new Date().toISOString().slice(0, 10))
  await shineCheck.getByLabel('Severity').selectOption('medium')
  await auditForm.getByRole('button', { name: 'Retain audit' }).click()
  await expect(workspace.getByText('Cutting dust remains on the lower vehicle shelf.')).toBeVisible()
  await workspace.getByRole('button', { name: 'Resolve', exact: true }).click()
  await workspace.getByLabel('Evidence reference').fill(`browser-five-s-clean-photo:${suffix}`)
  await workspace.getByLabel('Resolution note').fill('Lower shelf cleaned, photographed, and checked against the approved position standard.')
  await workspace.getByRole('button', { name: 'Retain resolution' }).click()
  await expect(workspace.getByText('Corrective-action resolution evidence was retained.')).toBeVisible()

  await workspace.getByRole('button', { name: 'Start 5S audit' }).click()
  auditForm = page.getByTestId('five-s-audit-form')
  await auditForm.getByLabel('Audited by').fill('Browser site lead')
  await auditForm.getByLabel('Evidence references').fill(`browser-five-s-recheck:${suffix}`)
  await auditForm.getByRole('button', { name: 'Retain audit' }).click()
  await expect(workspace.getByText('Ready', { exact: true }).last()).toBeVisible()

  const board = await (await request.get(`/api/ledger/five-s?jobId=${job.id}&includeGlobal=false`)).json()
  expect(board.board.ready).toBe(true)
  expect(board.board.audits).toHaveLength(2)
  expect(board.board.actions.filter(action => action.status === 'resolved')).toHaveLength(1)

  await page.setViewportSize({ width: 390, height: 844 })
  const geometry = await workspace.evaluate(element => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }))
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth)
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1)
  expect(consoleErrors).toEqual([])
})

test('offline field 5S audit syncs exactly once from the local outbox', async ({ page, request, context }) => {
  const suffix = Date.now()
  const { job, tool, locationName } = await fixture(request, suffix, 'Offline 5S')
  const location = (await postJson(request, '/api/ledger/five-s/locations', {
    jobId: job.id,
    name: locationName,
    locationType: 'vehicle',
    identifier: `OFFLINE-VAN-${suffix}`,
    owner: 'Offline site lead',
    auditFrequencyDays: 7,
    entryKey: `browser-five-s-location-${suffix}`,
  })).location
  const standard = await postJson(request, `/api/ledger/five-s/locations/${location.id}/standards`, {
    items: standardItems(tool.id, locationName),
    entryKey: `browser-five-s-standard-${suffix}`,
  })
  await postJson(request, `/api/ledger/approvals/${standard.approval.id}/resolve`, {
    status: 'approved',
    resolvedBy: 'Browser 5S approver',
    reason: 'Offline field fixture standard checked.',
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Field updates', exact: true }).click()
  const workspace = page.getByTestId('field-five-s-workspace')
  await workspace.getByLabel('Job').selectOption(job.id)
  await expect(workspace.getByText(locationName, { exact: true }).first()).toBeVisible()
  await workspace.getByRole('button', { name: 'Start 5S audit' }).click()
  const auditForm = workspace.getByTestId('field-five-s-audit-form')
  await auditForm.getByLabel('Audited by').fill('Offline field lead')
  await auditForm.getByLabel('Evidence references').fill(`offline-five-s-photo-set:${suffix}`)

  await context.setOffline(true)
  await auditForm.getByRole('button', { name: /Retain audit|Save audit offline/ }).click()
  await expect(workspace.getByText('The complete 5S audit was saved locally and will sync as an exact retry after reconnection.')).toBeVisible()
  await expect(page.getByText('1 queued').first()).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByText('Outbox clear')).toBeVisible({ timeout: 15_000 })

  await expect.poll(async () => {
    const response = await request.get(`/api/ledger/five-s?jobId=${job.id}&includeGlobal=false`)
    if (!response.ok()) return 0
    const result = await response.json()
    return result.board.audits.filter(audit => audit.locationId === location.id).length
  }, { timeout: 15_000 }).toBe(1)
})
