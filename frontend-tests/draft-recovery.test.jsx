import { useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DRAFT_STORAGE_PREFIX,
  MAX_DRAFT_BYTES,
  clearSessionDraftScope,
  draftScopeFingerprint,
  draftStorageKey,
  readSessionDraft,
  useSessionDraftRecovery,
  writeSessionDraft,
} from '../draft-recovery'

function DraftHarness({ scope = 'owner:one' }) {
  const [draft, setDraft] = useState({ title: '', description: '' })
  useSessionDraftRecovery({ enabled: true, scope, name: 'intake', value: draft, setValue: setDraft, delayMs: 20 })
  return <label>Title<input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
}

describe('session draft recovery', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('restores a form draft after a component reload', async () => {
    const first = render(<DraftHarness />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Recovered intake')
    await act(() => new Promise(resolve => setTimeout(resolve, 35)))
    first.unmount()

    render(<DraftHarness />)
    expect(await screen.findByDisplayValue('Recovered intake')).toBeTruthy()
  })

  it('keeps drafts separated by authenticated operator scope', () => {
    writeSessionDraft(window.sessionStorage, 'owner:north', 'intake', { title: 'North' }, 1000)
    writeSessionDraft(window.sessionStorage, 'owner:south', 'intake', { title: 'South' }, 1000)

    expect(readSessionDraft(window.sessionStorage, 'owner:north', 'intake', 1001).value.title).toBe('North')
    expect(readSessionDraft(window.sessionStorage, 'owner:south', 'intake', 1001).value.title).toBe('South')
    expect(clearSessionDraftScope(window.sessionStorage, 'owner:north')).toBe(1)
    expect(readSessionDraft(window.sessionStorage, 'owner:north', 'intake', 1001).found).toBe(false)
    expect(readSessionDraft(window.sessionStorage, 'owner:south', 'intake', 1001).found).toBe(true)
  })

  it('drops secret-shaped fields and refuses oversized drafts', () => {
    expect(writeSessionDraft(window.sessionStorage, 'owner:one', 'credentials', {
      title: 'Retain this',
      access_key: 'do-not-retain',
      portalToken: 'do-not-retain',
      nested: { token: 'do-not-retain', apiSecret: 'do-not-retain', note: 'Retain this too' },
    }, 1000)).toBe(true)
    const stored = readSessionDraft(window.sessionStorage, 'owner:one', 'credentials', 1001).value
    expect(stored).toEqual({ title: 'Retain this', nested: { note: 'Retain this too' } })

    expect(writeSessionDraft(window.sessionStorage, 'owner:one', 'oversized', { text: 'x'.repeat(MAX_DRAFT_BYTES) }, 1002)).toBe(false)
    expect(window.sessionStorage.getItem(draftStorageKey('owner:one', 'oversized'))).toBeNull()
  })

  it('uses a deterministic portal fingerprint without exposing the token', () => {
    const token = 'portal-token-that-must-not-appear-in-browser-storage'
    const scope = `client-portal:${draftScopeFingerprint(token)}`
    writeSessionDraft(window.sessionStorage, scope, 'message-body', 'Draft question', 1000)
    const key = window.sessionStorage.key(0)
    expect(key.startsWith(DRAFT_STORAGE_PREFIX)).toBe(true)
    expect(key).not.toContain(token)
    expect(draftScopeFingerprint(token)).toHaveLength(16)
  })
})
