import type { ScopePlayerboardSettings } from '@vereinsfunk/contracts'
import { describe, expect, it } from 'vitest'
import { replaceableState, restrictionState, settingsPatch, suggestPublicSlug } from './playerboardSettings'

const ID = '10000000-1200-4000-8000-000000000001'

function entry(overrides: { own?: Partial<ScopePlayerboardSettings['own']>; effective?: Partial<ScopePlayerboardSettings['effective']>; locked?: Partial<ScopePlayerboardSettings['locked']> } = {}): ScopePlayerboardSettings {
  return {
    scope: 'team', scopeId: ID, name: 'U13', departmentId: ID, canEdit: true, publicPath: null,
    own: {
      seasonStart: null, statsVisibility: null, overridableFields: [], teamCategoriesAllowed: null, publicSharingAllowed: null,
      publicPointsEnabled: null, publicVeoStatsEnabled: null, publicPhotosEnabled: null, publicSlug: null, ...overrides.own,
    },
    effective: { seasonStart: null, statsVisibility: 'team', teamCategoriesAllowed: true, publicSharingAllowed: true, ...overrides.effective },
    locked: { seasonStart: false, statsVisibility: false, ...overrides.locked },
  }
}

describe('replaceableState', () => {
  it('distinguishes inherited, own and locked', () => {
    expect(replaceableState(entry(), 'seasonStart')).toBe('inherited')
    expect(replaceableState(entry({ own: { seasonStart: '2026-08-01' } }), 'seasonStart')).toBe('own')
    expect(replaceableState(entry({ own: { statsVisibility: 'team' }, locked: { statsVisibility: true } }), 'statsVisibility')).toBe('locked')
  })
})

describe('restrictionState', () => {
  it('shows an own prohibition as restricted and one from above as locked', () => {
    expect(restrictionState(entry(), 'publicSharingAllowed')).toBe('allowed')
    expect(restrictionState(entry({ own: { publicSharingAllowed: false }, effective: { publicSharingAllowed: false } }), 'publicSharingAllowed')).toBe('restricted')
    expect(restrictionState(entry({ effective: { teamCategoriesAllowed: false } }), 'teamCategoriesAllowed')).toBe('locked')
  })
})

describe('settingsPatch', () => {
  it('sends only changed fields and compares releases as sets', () => {
    const own = entry({ own: { overridableFields: ['season_start', 'stats_visibility'] } }).own
    expect(settingsPatch(own, { ...own, overridableFields: ['stats_visibility', 'season_start'] })).toEqual({})
    expect(settingsPatch(own, { ...own, statsVisibility: 'department', publicSlug: 'u13' })).toEqual({ statsVisibility: 'department', publicSlug: 'u13' })
  })
})

describe('suggestPublicSlug', () => {
  it('turns a team name into a valid address part', () => {
    expect(suggestPublicSlug('U13 Mädchen')).toBe('u13-maedchen')
    expect(suggestPublicSlug('  1. Herren (Kreisliga) ')).toBe('1-herren-kreisliga')
  })
})
