import { describe, expect, it } from 'vitest'
import { appText, normalizeLocale, portalText } from '../locale'
import { operatorText } from '../operator-locale'
import {
  currency,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatStatus,
  formatWeekday,
  roundDisplay,
  setDashboardLocale,
  shortHash,
} from '../dashboard-format'

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
    expect(operatorText('nl-NL', 'Ideal customer and service area')).toBe('Ideale klant en servicegebied')
    expect(operatorText('nl-NL', 'Bid / no-bid scorecard')).toBe('Inschrijven / niet inschrijven-scorekaart')
    expect(operatorText('nl-NL', '{answered} of {total} checklist items complete', { answered: 7, total: 10 })).toBe('7 van 10 checklistpunten voltooid')
    expect(operatorText('nl-NL', 'Crew capacity and two-week plan')).toBe('Ploegcapaciteit en tweewekenplan')
    expect(operatorText('nl-NL', '13-week cash-flow forecast')).toBe('Liquiditeitsprognose voor 13 weken')
    expect(operatorText('nl-NL', '{number} retained for approval. No funds were moved.', { number: 'CF-1' })).toBe('CF-1 vastgelegd ter goedkeuring. Er is geen geld verplaatst.')
    expect(operatorText('nl-NL', 'No retained cash movements fall inside the 13-week horizon.')).toBe('Er vallen geen vastgelegde kasmutaties binnen de periode van 13 weken.')
    expect(operatorText('nl-NL', '{worker} is overloaded on {date}.', { worker: 'Team A', date: '14 aug' })).toBe('Team A is overbelast op 14 aug.')
    expect(operatorText('nl-NL', 'Last Planner weekly control')).toBe('Wekelijkse Last Planner-sturing')
    expect(operatorText('nl-NL', '{count} blocked', { count: 2 })).toBe('2 geblokkeerd')
    expect(operatorText('nl-NL', '5S vehicle and tool control')).toBe('5S-beheer van voertuigen en gereedschap')
    expect(operatorText('nl-NL', 'Audit {location}', { location: 'Servicebus 04' })).toBe('Servicebus 04 inspecteren')
    expect(operatorText('nl-NL', 'Last-minute risk assessment')).toBe('Laatste-minuut-risicoanalyse')
    expect(operatorText('nl-NL', 'LMRA ready until {time}. Reassess when conditions change.', { time: '14:30' })).toBe('LMRA geldig tot 14:30. Beoordeel opnieuw wanneer omstandigheden veranderen.')
    expect(operatorText('nl-NL', 'WBS & quantity takeoff')).toBe('WBS en hoeveelhedenstaat')
    expect(operatorText('nl-NL', '{packages} work package(s) / {measurements} measurement(s) / VAT {vat}%', { packages: 3, measurements: 12, vat: 21 })).toBe('3 werkpakket(ten) / 12 meting(en) / btw 21%')
    expect(operatorText('nl-NL', 'Unit-rate build-up')).toBe('Eenheidsprijsopbouw')
    expect(operatorText('nl-NL', 'Decision v{version} / {score}% fixed-price readiness / source current', { version: 2, score: 85 })).toBe('Besluit v2 / 85% gereed voor vaste prijs / bron actueel')
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
    expect(formatStatus('pending_approval')).toBe('wacht op goedkeuring')
    expect(formatStatus('checked_out')).toBe('uitgegeven')
    expect(formatStatus('worker_created')).toBe('medewerker aangemaakt')
    expect(formatStatus('update_operator_locale')).toBe('operator-taal bijgewerkt')
    expect(formatDate(null)).toBe('Niet ingepland')
    expect(formatDateTime(null)).toBe('Niet vastgelegd')
    expect(shortHash(null)).toBe('Niet vastgelegd')

    setDashboardLocale('en-GB')
    expect(formatStatus('pending_approval')).toBe('pending approval')
    expect(formatDate(null)).toBe('Not scheduled')
  })
})
