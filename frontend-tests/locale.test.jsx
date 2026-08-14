import { describe, expect, it } from 'vitest'
import { appText, normalizeLocale, operatorText, portalText } from '../locale'
import { currency, formatCurrency, formatDate, formatNumber, formatWeekday, roundDisplay, setDashboardLocale } from '../dashboard-format'

describe('locale contract', () => {
  it('normalizes only supported operator and portal locales', () => {
    expect(normalizeLocale('nl')).toBe('nl-NL')
    expect(normalizeLocale('EN_gb')).toBe('en-GB')
    expect(normalizeLocale('de-DE')).toBe('en-GB')
  })

  it('translates shell and client-portal copy without changing retained project text', () => {
    expect(appText('nl-NL', 'nav.jobs')).toBe('Projecten')
    expect(appText('en-GB', 'shell.activeSummary', { jobs: 3, approvals: 2 })).toBe('3 active jobs, 2 decisions awaiting review')
    expect(portalText('en-GB', 'Reageer uiterlijk {date}', { date: '13 Aug 2026' })).toBe('Respond by 13 Aug 2026')
    expect(portalText('nl-NL', 'Werkadres')).toBe('Werkadres')
  })

  it('translates specialist operator controls and interpolates runtime values', () => {
    expect(operatorText('nl-NL', 'Contractor Balanced Scorecard')).toBe('Aannemersscorekaart')
    expect(operatorText('nl-NL', '{count} reviews due', { count: 2 })).toBe('2 beoordelingen vereist')
    expect(operatorText('en-GB', 'Framework')).toBe('Framework')
    expect(operatorText('nl-NL', 'Unmapped retained text')).toBe('Unmapped retained text')
  })

  it('switches dashboard currency, number, and date formatting at runtime', () => {
    setDashboardLocale('en-GB')
    expect(currency.format(1234.5)).toContain('1,234.50')
    expect(formatCurrency(1234.5, 'GBP')).toContain('1,234.50')
    expect(formatNumber(1234.5, { maximumFractionDigits: 1 })).toBe('1,234.5')
    expect(roundDisplay(1234.5)).toBe('1,234.5')
    expect(formatWeekday('2026-08-13T00:00:00Z')).toMatch(/thu/i)

    setDashboardLocale('nl-NL')
    expect(currency.format(1234.5)).toContain('1.234,50')
    expect(roundDisplay(1234.5)).toBe('1.234,5')
    expect(formatWeekday('2026-08-13T00:00:00Z')).toMatch(/do/i)
    expect(formatDate('2026-08-13')).toMatch(/13 aug/i)
  })
})
