import { describe, expect, it } from 'vitest'
import { isPublicTeamPagePath } from './publicTeamPage'

describe('isPublicTeamPagePath', () => {
  it('lets exactly /mannschaft/{verein}/{mannschaft} through', () => {
    expect(isPublicTeamPagePath('/mannschaft/sv-nordstadt/u13')).toBe(true)
    expect(isPublicTeamPagePath('/mannschaft/sv-nordstadt/u13-maedchen')).toBe(true)
  })

  it('keeps empty, extra or malformed segments behind the login', () => {
    for (const path of [
      '/mannschaft', '/mannschaft/', '/mannschaft/sv-nordstadt', '/mannschaft/sv-nordstadt/', '/mannschaft//u13',
      '/mannschaft/sv-nordstadt/u13/', '/mannschaft/sv-nordstadt/u13/fotos', '/mannschaft/SV/u13', '/mannschaft/sv-/u13',
      '/mannschaftx/sv/u13', '/playerboard/rangliste', '/mannschaft/sv/../playerboard',
    ]) {
      expect(isPublicTeamPagePath(path), path).toBe(false)
    }
  })
})
