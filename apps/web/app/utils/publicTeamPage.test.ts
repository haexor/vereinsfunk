import { describe, expect, it } from 'vitest'
import { isLegacyPublicTeamPagePath, isPublicTeamPagePath, PublicTeamRouteParamsSchema } from './publicTeamPage'

describe('isPublicTeamPagePath', () => {
  it('lets exactly /mannschaft/{verein}/{abteilung}/{mannschaft} through', () => {
    expect(isPublicTeamPagePath('/mannschaft/sv-nordstadt/handball/u13')).toBe(true)
    expect(isPublicTeamPagePath('/mannschaft/sv-nordstadt/fu-ball/u13-maedchen')).toBe(true)
  })

  it('accepts the maximum segment lengths of the API', () => {
    expect(isPublicTeamPagePath(`/mannschaft/${'a'.repeat(200)}/${'b'.repeat(200)}/${'c'.repeat(80)}`)).toBe(true)
  })

  it('keeps empty, extra, malformed or over-long segments behind the login', () => {
    for (const path of [
      '/mannschaft',
      '/mannschaft/',
      '/mannschaft/sv-nordstadt',
      '/mannschaft/sv-nordstadt/u13',
      '/mannschaft/sv-nordstadt/handball/',
      '/mannschaft//handball/u13',
      '/mannschaft/sv-nordstadt//u13',
      '/mannschaft/sv-nordstadt/handball/u13/',
      '/mannschaft/sv-nordstadt/handball/u13/fotos',
      '/mannschaft/sv-nordstadt/handball/u13/fotos/1',
      '/mannschaft/SV/handball/u13',
      '/mannschaft/sv-nordstadt/Handball/u13',
      '/mannschaft/sv-nordstadt/handball/U13',
      '/mannschaft/sv-/handball/u13',
      '/mannschaft/sv-nordstadt/hand--ball/u13',
      '/mannschaftx/sv/handball/u13',
      '/playerboard/rangliste',
      '/mannschaft/sv/../playerboard',
      '/mannschaft/sv/handball/..',
      `/mannschaft/${'a'.repeat(201)}/handball/u13`,
      `/mannschaft/sv-nordstadt/${'a'.repeat(201)}/u13`,
      `/mannschaft/sv-nordstadt/handball/${'a'.repeat(81)}`,
      `/mannschaft/${'a'.repeat(200)}/${'b'.repeat(200)}/${'c'.repeat(80)}/`,
      `/mannschaft/sv-nordstadt/handball/u13${'/'.repeat(520)}`,
    ]) {
      expect(isPublicTeamPagePath(path), path.slice(0, 60)).toBe(false)
    }
  })
})

describe('isLegacyPublicTeamPagePath', () => {
  it('detects exactly the earlier two-segment address', () => {
    expect(isLegacyPublicTeamPagePath('/mannschaft/sv-nordstadt/u13')).toBe(true)
    expect(isLegacyPublicTeamPagePath('/mannschaft/sv-nordstadt/fussball-u13-52000000-1200-4000-8000-0000000000a1')).toBe(true)
  })

  it('does not match the new address or any other path', () => {
    for (const path of [
      '/mannschaft',
      '/mannschaft/sv-nordstadt',
      '/mannschaft/sv-nordstadt/handball/u13',
      '/mannschaft/sv-nordstadt/u13/',
      '/mannschaft//u13',
      '/mannschaft/SV/u13',
      '/mannschaftx/sv/u13',
      '/playerboard/rangliste',
      `/mannschaft/sv-nordstadt/${'a'.repeat(81)}`,
    ]) {
      expect(isLegacyPublicTeamPagePath(path), path).toBe(false)
    }
  })
})

describe('PublicTeamRouteParamsSchema', () => {
  const params = { orgSlug: 'sv-nordstadt', departmentSlug: 'handball', teamSlug: 'u13' }

  it('accepts API-compatible slugs and rejects malformed route params', () => {
    expect(PublicTeamRouteParamsSchema.safeParse(params).success).toBe(true)
    expect(PublicTeamRouteParamsSchema.safeParse({ ...params, orgSlug: 'SV' }).success).toBe(false)
    expect(PublicTeamRouteParamsSchema.safeParse({ ...params, departmentSlug: 'Handball' }).success).toBe(false)
    expect(PublicTeamRouteParamsSchema.safeParse({ ...params, orgSlug: ['sv-nordstadt'] }).success).toBe(false)
    expect(PublicTeamRouteParamsSchema.safeParse({ ...params, teamSlug: 'u13/' }).success).toBe(false)
  })

  it('requires the department segment', () => {
    expect(PublicTeamRouteParamsSchema.safeParse({ orgSlug: 'sv-nordstadt', teamSlug: 'u13' }).success).toBe(false)
  })
})
