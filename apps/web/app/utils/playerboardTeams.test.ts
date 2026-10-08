import { describe, expect, it } from 'vitest'
import { resolveTeamSelection, teamsInScope } from './playerboardTeams'

const scopes = [{
  organizationId: 'org',
  departments: [
    { id: 'football', name: 'Fussball', teams: [{ id: 'u13', name: 'U13' }, { id: 'u15', name: 'U15' }] },
    { id: 'handball', name: 'Handball', teams: [{ id: 'h1', name: 'Herren' }] },
  ],
}]

describe('teamsInScope', () => {
  it('lists the teams of the active department only', () => {
    expect(teamsInScope(scopes, { organizationId: 'org', departmentId: 'handball' }).map((team) => team.id)).toEqual(['h1'])
  })

  it('lists every visible team on organization level', () => {
    expect(teamsInScope(scopes, { organizationId: 'org', departmentId: null }).map((team) => `${team.departmentName}/${team.name}`))
      .toEqual(['Fussball/U13', 'Fussball/U15', 'Handball/Herren'])
  })

  it('knows no teams without an active scope', () => {
    expect(teamsInScope(scopes, null)).toEqual([])
  })
})

describe('resolveTeamSelection', () => {
  const teams = teamsInScope(scopes, { organizationId: 'org', departmentId: 'football' })

  it('keeps a remembered team inside the scope', () => {
    expect(resolveTeamSelection(teams, null, 'u15')).toBe('u15')
  })

  it('drops a team outside the scope and asks when several remain', () => {
    expect(resolveTeamSelection(teams, 'h1')).toBeNull()
  })

  it('picks the only team without asking', () => {
    expect(resolveTeamSelection(teamsInScope(scopes, { organizationId: 'org', departmentId: 'handball' }), 'u13')).toBe('h1')
  })
})
