import { describe, expect, it } from 'vitest'
import { BRAND_LOCKABLE_FIELDS, contrastRatio, createIdempotencyKey, curatedFontPairings, curatedFonts, findCuratedFont, isBrandAssetSelectable, meetsMinimumContrast, resolveBrand } from './index.js'

describe('idempotency keys', () => {
  it('creates deterministic scoped keys', () => {
    expect(createIdempotencyKey('submission', 'abc', 2)).toBe('submission:abc:2')
  })
})

describe('curated font pairings', () => {
  it('matches the organization_brand_profiles column defaults', () => {
    expect(curatedFontPairings.length).toBeGreaterThan(0)
    expect(curatedFontPairings[0]).toMatchObject({ displayFontKey: 'manrope', bodyFontKey: 'dm_sans' })
  })

  it('every pairing references two curated fonts that actually exist in the registry', () => {
    for (const pairing of curatedFontPairings) {
      expect(findCuratedFont(pairing.displayFontKey)).toBeDefined()
      expect(findCuratedFont(pairing.bodyFontKey)).toBeDefined()
    }
  })

  it('returns undefined for an unknown font key', () => {
    expect(findCuratedFont('does-not-exist')).toBeUndefined()
  })

  it('every curated font ships at least one weight', () => {
    for (const font of curatedFonts) expect(font.weights.length).toBeGreaterThan(0)
  })
})

describe('contrast', () => {
  it('rates black on white at the maximum ratio of 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('is symmetric regardless of argument order', () => {
    expect(contrastRatio('#163a2c', '#f6f4ec')).toBeCloseTo(contrastRatio('#f6f4ec', '#163a2c'), 5)
  })

  it('flags a known low-contrast pairing as failing AA', () => {
    expect(meetsMinimumContrast('#caff4a', '#f6f4ec').meetsAA).toBe(false)
  })

  it('accepts a known high-contrast pairing', () => {
    expect(meetsMinimumContrast('#122820', '#f6f4ec').meetsAA).toBe(true)
  })
})

describe('resolveBrand', () => {
  const organization = {
    primaryColor: '#163a2c',
    accentColor: '#caff4a',
    allowDepartmentOverrides: true,
    lockedFields: [],
  }

  it('falls back to the organization defaults when no department or team overrides exist', () => {
    const resolved = resolveBrand(organization)
    expect(resolved.primaryColor).toBe('#163a2c')
    expect(resolved.displayFontKey).toBe('manrope')
  })

  it('lets a department override a field the organization has not locked', () => {
    const department = { primaryColor: '#112233', allowTeamOverrides: true, lockedFields: [] }
    expect(resolveBrand(organization, department).primaryColor).toBe('#112233')
  })

  it('a field the organization locks cannot be overridden by the department', () => {
    const locked = { ...organization, lockedFields: ['primaryColor'] }
    const department = { primaryColor: '#112233', allowTeamOverrides: true, lockedFields: [] }
    expect(resolveBrand(locked, department).primaryColor).toBe('#163a2c')
  })

  it('allowDepartmentOverrides=false blocks the department entirely, regardless of lockedFields', () => {
    const noOverrides = { ...organization, allowDepartmentOverrides: false }
    const department = { primaryColor: '#112233', allowTeamOverrides: true, lockedFields: [] }
    expect(resolveBrand(noOverrides, department).primaryColor).toBe('#163a2c')
  })

  it('a team inherits from the department, not directly from the organization, once the department deviates', () => {
    const department = { primaryColor: '#112233', allowTeamOverrides: true, lockedFields: [] }
    const team = {}
    expect(resolveBrand(organization, department, team).primaryColor).toBe('#112233')
  })

  it('a team can override a field the department left untouched', () => {
    const department = { accentColor: '#445566', allowTeamOverrides: true, lockedFields: [] }
    const team = { primaryColor: '#778899' }
    const resolved = resolveBrand(organization, department, team)
    expect(resolved.primaryColor).toBe('#778899')
    expect(resolved.accentColor).toBe('#445566')
  })

  it('an organization-level lock propagates to the team even if the department does not repeat it', () => {
    const locked = { ...organization, lockedFields: ['primaryColor'] }
    const department = { allowTeamOverrides: true, lockedFields: [] }
    const team = { primaryColor: '#000000' }
    expect(resolveBrand(locked, department, team).primaryColor).toBe('#163a2c')
  })

  it('a department that may not deviate cannot open the door for its teams either', () => {
    const noOverrides = { ...organization, allowDepartmentOverrides: false }
    const department = { allowTeamOverrides: true, lockedFields: [] }
    const team = { primaryColor: '#000000' }
    expect(resolveBrand(noOverrides, department, team).primaryColor).toBe('#163a2c')
  })

  it('a department cannot override a color role the organization alone controls', () => {
    // backgroundColor/textColor/onPrimaryColor und die kuratierten Schriftschluessel haben auf
    // den unteren Ebenen keine Spalte -- BRAND_LOCKABLE_FIELDS bildet genau das ab.
    const department = { backgroundColor: '#000000', allowTeamOverrides: true, lockedFields: [] } as never
    expect(resolveBrand(organization, department).backgroundColor).toBe('#f6f4ec')
  })

  it('exposes exactly the fields a department can carry', () => {
    expect([...BRAND_LOCKABLE_FIELDS]).toEqual(['primaryColor', 'accentColor', 'logoAssetId', 'websiteUrl', 'displayFontAssetId', 'bodyFontAssetId'])
  })
})

describe('relativeLuminance input validation', () => {
  it('rejects a short hex form instead of returning NaN', () => {
    expect(() => contrastRatio('#abc', '#ffffff')).toThrow(/invalid hex color/)
  })

  it('rejects a half-typed color instead of returning NaN', () => {
    expect(() => meetsMinimumContrast('#12', '#ffffff')).toThrow(/invalid hex color/)
  })
})

describe('isBrandAssetSelectable', () => {
  it('an organization-wide asset is selectable everywhere', () => {
    expect(isBrandAssetSelectable({ scope: 'organization' }, 'team', 'dept-1', 'team-1')).toBe(true)
  })

  it('a department asset is selectable within its own department and its teams, not a sibling department', () => {
    const asset = { scope: 'department' as const, departmentId: 'dept-1' }
    expect(isBrandAssetSelectable(asset, 'team', 'dept-1', 'team-1')).toBe(true)
    expect(isBrandAssetSelectable(asset, 'department', 'dept-2')).toBe(false)
  })

  it('a team asset is selectable only for that exact team', () => {
    const asset = { scope: 'team' as const, departmentId: 'dept-1', teamId: 'team-1' }
    expect(isBrandAssetSelectable(asset, 'team', 'dept-1', 'team-1')).toBe(true)
    expect(isBrandAssetSelectable(asset, 'team', 'dept-1', 'team-2')).toBe(false)
  })
})
