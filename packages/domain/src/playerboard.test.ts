import { describe, expect, it } from 'vitest'
import {
  competitionRanks,
  currentSeasonStart,
  isPlayerboardCategoryEffective,
  resolvePlayerboardSettings,
  type PlayerboardSettingsLevel,
} from './playerboard.js'

/** Erstellt eine Einstellungsebene ohne eigene Werte und wendet die gewuenschten Test-Overrides an. */
function level(overrides: Partial<PlayerboardSettingsLevel>): PlayerboardSettingsLevel {
  return { seasonStart: null, statsVisibility: null, overridableFields: [], teamCategoriesAllowed: null, publicSharingAllowed: null, ...overrides }
}

// Dieselben Faelle wie supabase/tests/playerboard_core.test.sql, Abschnitt "Vererbung".
describe('resolvePlayerboardSettings', () => {
  it('falls back to team visibility and no season start', () => {
    const resolved = resolvePlayerboardSettings({}, 'team')
    expect(resolved).toMatchObject({ seasonStart: null, statsVisibility: 'team', teamCategoriesAllowed: true, publicSharingAllowed: true })
    expect(resolved.locked).toEqual({ seasonStart: false, statsVisibility: false })
  })

  it('binds every team to a value the organization set', () => {
    const resolved = resolvePlayerboardSettings({
      organization: level({ seasonStart: '2026-07-01' }),
      team: level({ seasonStart: '2026-08-01' }),
    }, 'team')
    expect(resolved.seasonStart).toBe('2026-07-01')
    expect(resolved.locked.seasonStart).toBe(true)
  })

  it('lets a release reach one level only', () => {
    const path = {
      organization: level({ seasonStart: '2026-07-01', overridableFields: ['season_start'] }),
      department: level({ seasonStart: '2026-09-01' }),
      team: level({ seasonStart: '2026-08-01' }),
    } as const
    expect(resolvePlayerboardSettings(path, 'department')).toMatchObject({ seasonStart: '2026-09-01', locked: { seasonStart: false } })
    expect(resolvePlayerboardSettings(path, 'team')).toMatchObject({ seasonStart: '2026-09-01', locked: { seasonStart: true } })
  })

  it('uses the team value once organization and department release the field', () => {
    const resolved = resolvePlayerboardSettings({
      organization: level({ seasonStart: '2026-07-01', overridableFields: ['season_start'] }),
      department: level({ seasonStart: '2026-09-01', overridableFields: ['season_start'] }),
      team: level({ seasonStart: '2026-08-01' }),
    }, 'team')
    expect(resolved).toMatchObject({ seasonStart: '2026-08-01', locked: { seasonStart: false } })
  })

  it('does not let a department release a field the organization locked', () => {
    const resolved = resolvePlayerboardSettings({
      organization: level({ seasonStart: '2026-07-01' }),
      department: level({ overridableFields: ['season_start'] }),
      team: level({ seasonStart: '2026-08-01' }),
    }, 'team')
    expect(resolved.seasonStart).toBe('2026-07-01')
  })

  it('keeps a binding organization-wide visibility, and narrows again after a release', () => {
    expect(resolvePlayerboardSettings({ organization: level({ statsVisibility: 'organization' }), team: level({ statsVisibility: 'team' }) }, 'team').statsVisibility)
      .toBe('organization')
    expect(resolvePlayerboardSettings({
      organization: level({ statsVisibility: 'organization', overridableFields: ['stats_visibility'] }),
      department: level({ overridableFields: ['stats_visibility'] }),
      team: level({ statsVisibility: 'team' }),
    }, 'team').statsVisibility).toBe('team')
  })

  it('only tightens team_categories_allowed and public_sharing_allowed', () => {
    const resolved = resolvePlayerboardSettings({
      organization: level({ teamCategoriesAllowed: false }),
      department: level({ publicSharingAllowed: false }),
      team: level({ teamCategoriesAllowed: true, publicSharingAllowed: true }),
    }, 'team')
    expect(resolved).toMatchObject({ teamCategoriesAllowed: false, publicSharingAllowed: false })
  })
})

describe('isPlayerboardCategoryEffective', () => {
  const team = { departmentId: 'dept-a', teamId: 'team-a1' }
  it('includes organization and own department categories, never inactive ones', () => {
    expect(isPlayerboardCategoryEffective({ scope: 'organization', departmentId: null, teamId: null, active: true }, team, true)).toBe(true)
    expect(isPlayerboardCategoryEffective({ scope: 'department', departmentId: 'dept-a', teamId: null, active: true }, team, true)).toBe(true)
    expect(isPlayerboardCategoryEffective({ scope: 'department', departmentId: 'dept-b', teamId: null, active: true }, team, true)).toBe(false)
    expect(isPlayerboardCategoryEffective({ scope: 'organization', departmentId: null, teamId: null, active: false }, team, true)).toBe(false)
  })
  it('includes own team categories only while allowed', () => {
    const own = { scope: 'team' as const, departmentId: 'dept-a', teamId: 'team-a1', active: true }
    expect(isPlayerboardCategoryEffective(own, team, true)).toBe(true)
    expect(isPlayerboardCategoryEffective(own, team, false)).toBe(false)
  })
})

describe('competitionRanks', () => {
  it('shares ranks and skips the following ones', () => {
    expect(competitionRanks([10, 8, 8, 3])).toEqual([1, 2, 2, 4])
    expect(competitionRanks([])).toEqual([])
  })
})

describe('currentSeasonStart', () => {
  it('uses the last season start on or before today', () => {
    expect(currentSeasonStart('2026-07-01', '2026-10-08')).toBe('2026-07-01')
    expect(currentSeasonStart('2026-07-01', '2027-03-15')).toBe('2026-07-01')
    expect(currentSeasonStart('2020-08-15', '2026-08-15')).toBe('2026-08-15')
    expect(currentSeasonStart(null, '2026-10-08')).toBeNull()
  })

  it('clamps a February 29 season start in non-leap years', () => {
    expect(currentSeasonStart('2024-02-29', '2025-03-01')).toBe('2025-02-28')
    expect(currentSeasonStart('2024-02-29', '2025-02-27')).toBe('2024-02-29')
  })
})
