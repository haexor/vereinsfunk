import type { ImageStylePreset } from '@vereinsfunk/contracts'
import { describe, expect, it } from 'vitest'
import { selectableImageStylePresets } from './imageStylePresets'

const BASE = {
  id: 'p', organizationId: 'org', isActive: true,
  frameType: 'none' as const, frameColor: null, frameWidthPx: null, frameCornerRadiusPx: null, frameBrandAssetId: null,
  logoEnabled: false, logoBrandAssetId: null, logoPosition: 'bottom_right' as const, logoSizePercent: null, logoMarginPercent: null,
  filter: 'original' as const, createdBy: 'user', createdAt: '2026-08-19T00:00:00.000+00:00', updatedAt: '2026-08-19T00:00:00.000+00:00',
}

const orgWide: ImageStylePreset = { ...BASE, id: 'org-wide', name: 'Vereinsweit', departmentId: null, teamId: null }
const fussball: ImageStylePreset = { ...BASE, id: 'fussball', name: 'Fußball', departmentId: 'dept-fussball', teamId: null }
const handball: ImageStylePreset = { ...BASE, id: 'handball', name: 'Handball', departmentId: 'dept-handball', teamId: null }
const teamA: ImageStylePreset = { ...BASE, id: 'team-a', name: 'Team A', departmentId: 'dept-fussball', teamId: 'team-a' }

describe('selectableImageStylePresets (Plan 045, PR 1)', () => {
  const presets = [orgWide, fussball, handball, teamA]

  it('a department without its own preset still inherits the organization-wide one', () => {
    const selectable = selectableImageStylePresets([orgWide], 'department', 'dept-handball')
    expect(selectable).toEqual([orgWide])
  })

  it('a department sees the organization-wide preset and its own, but not a sibling department\'s', () => {
    const selectable = selectableImageStylePresets(presets, 'department', 'dept-fussball')
    expect(selectable.map((p) => p.id)).toEqual(expect.arrayContaining(['org-wide', 'fussball']))
    expect(selectable.map((p) => p.id)).not.toContain('handball')
  })

  it('a team sees the organization-wide, its department\'s, and its own preset', () => {
    const selectable = selectableImageStylePresets(presets, 'team', 'dept-fussball', 'team-a')
    expect(selectable.map((p) => p.id).sort()).toEqual(['fussball', 'org-wide', 'team-a'])
  })

  it('a sibling team cannot select a team-scoped preset that is not its own', () => {
    const selectable = selectableImageStylePresets(presets, 'team', 'dept-fussball', 'team-b')
    expect(selectable.map((p) => p.id)).not.toContain('team-a')
  })
})
