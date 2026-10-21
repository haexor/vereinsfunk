import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { availabilityHint, comparisonLabel, decodeBase64, eventTypeLabel, formatClock, isPartAvailable, periodOptions, veoVideoLink } from './playerboardVeoAnalysis'

const page = readFileSync(join(import.meta.dirname, '../pages/playerboard/spiele/[fixtureId].vue'), 'utf8')
const section = readFileSync(join(import.meta.dirname, '../components/PlayerboardVeoAnalysisSection.vue'), 'utf8')

describe('playerboardVeoAnalysis', () => {
  it('explains a missing part with its reason and stays silent when it is there', () => {
    const availability = {
      shots: { status: 'available' as const },
      momentum: { status: 'unavailable' as const, reason: 'not_provided' as const },
      heatmaps: { status: 'pending' as const, reason: 'periods_missing' as const },
      tracking: { status: 'pending' as const },
    }
    expect(isPartAvailable(availability, 'shots')).toBe(true)
    expect(availabilityHint(availability, 'shots')).toBeNull()
    expect(availabilityHint(availability, 'momentum')).toBe('Veo liefert diese Ansicht für dieses Spiel nicht.')
    expect(availabilityHint(availability, 'heatmaps')).toContain('Seiten und Halbzeiten')
    expect(availabilityHint(availability, 'tracking')).toContain('noch aus')
    expect(availabilityHint({}, 'events')).toContain('noch keine Veo-Analyse')
    // Keine Werbung, keine Sperrhinweise (FR-066).
    expect(Object.keys(availability).map((part) => availabilityHint(availability, part as 'shots') ?? '').join(' ')).not.toMatch(/Abo|Upgrade|freischalten/i)
  })

  it('links into the Veo video 3 s before the event and keeps minutes past 59', () => {
    expect(veoVideoLink('https://app.veo.co/matches/c1-vs-gegner/', 730_499)).toBe('https://app.veo.co/matches/c1-vs-gegner/#t=12:07')
    expect(veoVideoLink('https://app.veo.co/matches/x/', 6_330_000)).toBe('https://app.veo.co/matches/x/#t=105:27')
    expect(veoVideoLink('https://app.veo.co/matches/x/', 1_000)).toBe('https://app.veo.co/matches/x/#t=0:00')
    expect(veoVideoLink(null, 1_000)).toBeNull()
    expect(formatClock(2725)).toBe('45:25')
  })

  it('names periods, rows and event types in German', () => {
    expect(periodOptions([{ number: 1, startS: 0, endS: 1, ownSide: 'left', confirmed: true }])).toEqual([{ value: null, label: 'Ganzes Spiel' }, { value: 1, label: '1. Halbzeit' }])
    expect(periodOptions([{ number: 2, startS: 0, endS: 1, ownSide: 'left', confirmed: true }], false)).toEqual([{ value: 2, label: '2. Halbzeit' }])
    expect(comparisonLabel('football_shots_total')).toBe('Schüsse ohne Tor')
    expect(comparisonLabel('football_attempts_total')).toBe('Abschlüsse')
    expect(eventTypeLabel('loose')).toBe('Ballgewinn (loser Ball)')
    expect(eventTypeLabel('SomethingNew')).toBe('SomethingNew')
  })

  it('decodes base64 cells to bytes', () => {
    expect(Array.from(decodeBase64('AP8='))).toEqual([0, 255])
  })

  it('renders every view of the page only behind its availability hint', () => {
    for (const part of ['shots', 'passes', 'possession', 'passStrings', 'momentum', 'events']) {
      expect(page).toContain(`:hint="hint('${part}')"`)
    }
    expect(page).toContain(`:hint="heatmapAvailable ? null : hint('tracking')"`)
    // Die Grafik steht im v-else: mit Hinweis wird sie gar nicht erst gerendert.
    expect(section).toMatch(/<p v-if="props\.hint"[^>]*>\{\{ props\.hint \}\}<\/p>\s*<slot v-else \/>/)
  })
})
