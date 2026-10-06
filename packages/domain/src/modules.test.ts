import { describe, expect, it } from 'vitest'
import { appModules, isModuleEnabled, resolveEnabledModules } from './index.js'

describe('resolveEnabledModules', () => {
  it('enables every module when neither the plan nor any level restricts', () => {
    expect(resolveEnabledModules({ planModules: null })).toEqual({ enabled: [...appModules], blockedBy: {} })
  })

  it('limits to the plan when the organization inherits (null)', () => {
    const result = resolveEnabledModules({ planModules: ['social_media'], organization: null })
    expect(result.enabled).toEqual(['social_media'])
    expect(result.blockedBy).toEqual({ playerboard: 'plan' })
  })

  it('lets a department deselect a module and treats [] as "no module"', () => {
    const result = resolveEnabledModules({ planModules: null, organization: null, department: [] })
    expect(result.enabled).toEqual([])
    expect(result.blockedBy).toEqual({ social_media: 'department', playerboard: 'department' })
  })

  it('never lets a lower level add a module that is off above', () => {
    const result = resolveEnabledModules({ planModules: null, organization: ['social_media'], department: null, team: ['social_media', 'playerboard'] })
    expect(result.enabled).toEqual(['social_media'])
    // Die aeusserste Stelle bleibt die Quelle, nicht die Mannschaft, die das Modul nennt.
    expect(result.blockedBy).toEqual({ playerboard: 'organization' })
  })

  it('lets a team without its own setting inherit from its department', () => {
    expect(isModuleEnabled({ planModules: null, department: ['playerboard'] }, 'playerboard')).toBe(true)
    expect(isModuleEnabled({ planModules: null, department: ['playerboard'] }, 'social_media')).toBe(false)
  })

  it('reports the plan, not a lower level, when both exclude a module', () => {
    const result = resolveEnabledModules({ planModules: ['social_media'], organization: ['social_media'], team: [] })
    expect(result.blockedBy).toEqual({ playerboard: 'plan', social_media: 'team' })
  })
})
