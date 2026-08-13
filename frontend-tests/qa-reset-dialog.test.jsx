import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import QaResetDialog from '../components/QaResetDialog'

const plan = {
  planHash: 'a'.repeat(64),
  totalRecords: 2,
  sampleLimit: 10,
  counts: { jobs: 1, opportunities: 1 },
  samples: [],
}

describe('QA archive decision dialog', () => {
  it('requires a reason and exact confirmation before submission', async () => {
    const onSubmit = vi.fn()
    render(<QaResetDialog plan={plan} loading={false} busy={false} error="" onClose={() => {}} onReload={() => {}} onSubmit={onSubmit} />)
    const archive = screen.getByRole('button', { name: 'Archive 2 record(s)' })
    expect(archive.disabled).toBe(true)

    await userEvent.type(screen.getByLabelText(/Maintenance reason/), 'Remove browser QA fixtures')
    await userEvent.type(screen.getByLabelText(/Type ARCHIVE QA to confirm/), 'ARCHIVE QA')
    expect(archive.disabled).toBe(false)
    await userEvent.click(archive)
    expect(onSubmit).toHaveBeenCalledWith({ reason: 'Remove browser QA fixtures', planHash: plan.planHash })
  })

  it('closes on Escape while idle', async () => {
    const onClose = vi.fn()
    render(<QaResetDialog plan={plan} loading={false} busy={false} error="" onClose={onClose} onReload={() => {}} onSubmit={() => {}} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
