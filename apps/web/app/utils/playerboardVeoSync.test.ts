import type { PlayerboardVeoSyncProgress } from '@vereinsfunk/contracts'
import { describe, expect, it } from 'vitest'
import { deferredAnalyses, syncFraction, syncSilentMinutes, syncStepText } from './playerboardVeoSync'

const progress = (overrides: Partial<PlayerboardVeoSyncProgress> = {}): PlayerboardVeoSyncProgress => ({
  matchesTotal: 8, matchesDone: 2, analysesDone: 1, analysesDeferred: 0, current: null, updatedAt: '2026-10-22T19:50:00Z', ...overrides,
})

describe('syncFraction', () => {
  it('counts finished matches and the loaded windows of the match in progress', () => {
    expect(syncFraction(progress())).toBe(0.25)
    expect(syncFraction(progress({ current: { opponentName: 'SV Nord', step: 'tracks', tracksDone: 50, tracksTotal: 100 } }))).toBe(2.5 / 8)
    expect(syncFraction(progress({ current: { opponentName: 'SV Nord', step: 'analysis' } }))).toBe(0.25)
  })

  it('has no value before Veo listed the matches or without matches', () => {
    expect(syncFraction(null)).toBeNull()
    expect(syncFraction(progress({ matchesTotal: 0, matchesDone: 0 }))).toBeNull()
  })
})

describe('syncStepText', () => {
  it('names the match in progress and its step', () => {
    expect(syncStepText(null)).toBe('Verbindung zu Veo wird aufgebaut …')
    expect(syncStepText(progress({ current: { opponentName: 'SV Nord', step: 'values' } }))).toBe('Spiel 3 von 8 · gegen SV Nord: Werte werden geladen')
    expect(syncStepText(progress({ current: { opponentName: 'SV Nord', step: 'tracks', tracksDone: 40, tracksTotal: 190 } })))
      .toBe('Spiel 3 von 8 · gegen SV Nord: Positionsdaten 40 von 190')
    expect(syncStepText(progress({ matchesDone: 8 }))).toBe('Abgleich wird abgeschlossen …')
  })
})

describe('syncSilentMinutes', () => {
  const now = Date.parse('2026-10-22T19:55:00Z')

  it('flags a running sync without news for three minutes', () => {
    expect(syncSilentMinutes({ status: 'running', startedAt: '2026-10-22T19:46:00Z', progress: progress() }, now)).toBe(5)
    expect(syncSilentMinutes({ status: 'running', startedAt: '2026-10-22T19:46:00Z', progress: progress({ updatedAt: '2026-10-22T19:54:00Z' }) }, now)).toBeNull()
    expect(syncSilentMinutes({ status: 'running', startedAt: '2026-10-22T19:51:00Z', progress: null }, now)).toBe(4)
  })

  it('ignores finished syncs', () => {
    expect(syncSilentMinutes({ status: 'succeeded', startedAt: '2026-10-22T19:00:00Z', progress: progress() }, now)).toBeNull()
  })
})

describe('deferredAnalyses', () => {
  it('reads the analyses left for the next sync', () => {
    expect(deferredAnalyses({ progress: progress({ analysesDeferred: 2 }) })).toBe(2)
    expect(deferredAnalyses({ progress: null })).toBe(0)
    expect(deferredAnalyses(undefined)).toBe(0)
  })
})
