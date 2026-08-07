import type { ClubEvent, Fixture, Team } from '@vereinsfunk/contracts'
import { describe, expect, it } from 'vitest'
import { getPreset } from './presets.js'
import { factsFromClubEvent, factsFromFixture } from './schedule.js'

const TIMEZONE = 'Europe/Berlin'
const TIME_PATTERN = /\d{1,2}:\d{2}/

function buildFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    organizationId: '11111111-1111-4111-8111-111111111111',
    departmentId: '22222222-2222-4222-8222-222222222222',
    teamId: '33333333-3333-4333-8333-333333333333',
    kind: 'match',
    competition: null,
    isHome: true,
    ownTeamLabel: null,
    opponentName: 'SV Gegner',
    kickoffAt: '2026-08-15T14:30:00Z',
    kickoffTimeConfirmed: true,
    venueName: 'Sportplatz Nord',
    venueAddress: null,
    status: 'scheduled',
    homeScore: null,
    awayScore: null,
    note: null,
    announcementDismissedAt: null,
    resultDismissedAt: null,
    sourceId: null,
    sourceUpdatedAt: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function buildTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    organizationId: '11111111-1111-4111-8111-111111111111',
    departmentId: '22222222-2222-4222-8222-222222222222',
    name: 'Erste Mannschaft',
    ageGroup: null,
    competition: null,
    sourceId: null,
    archivedAt: null,
    createdAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function buildClubEvent(overrides: Partial<ClubEvent> = {}): ClubEvent {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    organizationId: '11111111-1111-4111-8111-111111111111',
    departmentId: '22222222-2222-4222-8222-222222222222',
    teamId: null,
    title: 'Vereinsfest',
    description: null,
    category: 'festival',
    startsAt: '2026-09-01T16:00:00Z',
    endsAt: null,
    allDay: false,
    locationName: 'Vereinsheim',
    locationAddress: null,
    registrationUrl: null,
    status: 'scheduled',
    invitationDismissedAt: null,
    sourceId: null,
    sourceUpdatedAt: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

describe('factsFromFixture', () => {
  it('produces match_announcement facts for a complete upcoming fixture', () => {
    const fixture = buildFixture()
    const result = factsFromFixture(fixture, buildTeam(), TIMEZONE)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.presetSlug).toBe('match_announcement')
    expect(result.facts.opponent).toBeTruthy()
    expect(result.facts.date).toBeTruthy()
    expect(result.facts.location).toBeTruthy()
    expect(Object.keys(result.provenance).sort()).toEqual(['date', 'location', 'opponent'])
    for (const entry of Object.values(result.provenance)) {
      expect(entry.source).toBe('fixture')
      expect(entry.sourceId).toBe(fixture.id)
    }
    // gegen doppelte Pflege der requiredFacts-Liste pruefen (getPreset ist die einzige Quelle)
    for (const key of getPreset('match_announcement').requiredFacts) expect(result.facts[key]).toBeDefined()
  })

  it('still produces facts without a resolved team, using ownTeamLabel as fallback', () => {
    // ownTeamLabel taucht in match_announcement nicht direkt auf (nur opponent/date/location) --
    // dass der Fallback selbst greift, prueft der match_result-Fall weiter unten anhand homeTeam/awayTeam.
    const fixture = buildFixture({ ownTeamLabel: 'Unsere Erste' })
    const result = factsFromFixture(fixture, null, TIMEZONE)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.facts.opponent).toBeTruthy()
    expect(result.facts.date).toBeTruthy()
    expect(result.facts.location).toBeTruthy()
  })

  it('uses team.name as homeTeam for a played fixture (isHome: true)', () => {
    const team = buildTeam({ name: 'Erste Mannschaft' })
    const fixture = buildFixture({ status: 'played', isHome: true, homeScore: 3, awayScore: 1 })
    const result = factsFromFixture(fixture, team, TIMEZONE)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.presetSlug).toBe('match_result')
    expect(result.facts.homeTeam).toBe('Erste Mannschaft')
    expect(result.facts.awayTeam).toBe(fixture.opponentName)
    expect(result.facts.homeScore).toBe(3)
    expect(result.facts.awayScore).toBe(1)
    for (const entry of Object.values(result.provenance)) expect(entry.source).toBe('fixture')
  })

  it('falls back to ownTeamLabel when team is null (played fixture)', () => {
    const fixture = buildFixture({ status: 'played', isHome: true, homeScore: 2, awayScore: 0, ownTeamLabel: 'Unsere Erste' })
    const result = factsFromFixture(fixture, null, TIMEZONE)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.facts.homeTeam).toBe('Unsere Erste')
    expect(result.facts.awayTeam).toBe(fixture.opponentName)
  })

  it('swaps homeTeam/awayTeam when isHome is false', () => {
    const team = buildTeam({ name: 'Erste Mannschaft' })
    const fixture = buildFixture({ status: 'played', isHome: false, homeScore: 0, awayScore: 4 })
    const result = factsFromFixture(fixture, team, TIMEZONE)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.facts.homeTeam).toBe(fixture.opponentName)
    expect(result.facts.awayTeam).toBe('Erste Mannschaft')
    expect(result.facts.homeScore).toBe(0)
    expect(result.facts.awayScore).toBe(4)
  })

  it('blocks on unknown isHome regardless of other facts being present', () => {
    const fixture = buildFixture({ isHome: null })
    const result = factsFromFixture(fixture, buildTeam(), TIMEZONE)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected missing result')
    expect(result.missing).toContain('Heimrecht')
  })

  it('accumulates multiple missing facts', () => {
    const fixture = buildFixture({ opponentName: null, venueName: null })
    const result = factsFromFixture(fixture, buildTeam(), TIMEZONE)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected missing result')
    expect(result.missing).toContain('Gegner')
    expect(result.missing).toContain('Ort')
  })

  it('omits the time of day when kickoffTimeConfirmed is false', () => {
    const unconfirmed = buildFixture({ kickoffTimeConfirmed: false })
    const confirmed = buildFixture({ kickoffTimeConfirmed: true })
    const unconfirmedResult = factsFromFixture(unconfirmed, buildTeam(), TIMEZONE)
    const confirmedResult = factsFromFixture(confirmed, buildTeam(), TIMEZONE)
    expect(unconfirmedResult.ok).toBe(true)
    expect(confirmedResult.ok).toBe(true)
    if (!unconfirmedResult.ok || !confirmedResult.ok) throw new Error('expected ok results')
    expect(String(unconfirmedResult.facts.date)).not.toMatch(TIME_PATTERN)
    expect(String(confirmedResult.facts.date)).toMatch(TIME_PATTERN)
  })
})

describe('factsFromClubEvent', () => {
  it('produces event facts for a complete club event', () => {
    const event = buildClubEvent()
    const result = factsFromClubEvent(event, TIMEZONE)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.presetSlug).toBe('event')
    expect(result.facts.title).toBe(event.title)
    expect(result.facts.date).toBeTruthy()
    expect(result.facts.location).toBe(event.locationName)
    expect(Object.keys(result.provenance).sort()).toEqual(['date', 'location', 'title'])
    for (const entry of Object.values(result.provenance)) {
      expect(entry.source).toBe('club_event')
      expect(entry.sourceId).toBe(event.id)
    }
    for (const key of getPreset('event').requiredFacts) expect(result.facts[key]).toBeDefined()
  })

  it('blocks when locationName is missing', () => {
    const event = buildClubEvent({ locationName: null })
    const result = factsFromClubEvent(event, TIMEZONE)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected missing result')
    expect(result.missing).toContain('Ort')
  })

  it('omits the time of day for an all-day event', () => {
    const event = buildClubEvent({ allDay: true })
    const result = factsFromClubEvent(event, TIMEZONE)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(String(result.facts.date)).not.toMatch(TIME_PATTERN)
  })
})
