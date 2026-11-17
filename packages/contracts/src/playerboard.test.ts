import { describe, expect, it } from 'vitest'
import {
  DepartmentPublicSlugSchema,
  OrganizationPublicSlugSchema,
  PublicTeamAddressSchema,
  TeamPublicSlugSchema,
  UpdatePlayerboardPlayerRequestSchema,
  publicTeamPath,
} from './index.js'

describe('UpdatePlayerboardPlayerRequestSchema', () => {
  it('accepts name and birth year changes and trims the names', () => {
    const parsed = UpdatePlayerboardPlayerRequestSchema.parse({
      firstName: ' Mia ',
      lastName: ' Keller ',
      birthYear: 2014,
    })
    expect(parsed).toEqual({ firstName: 'Mia', lastName: 'Keller', birthYear: 2014 })
  })

  it('accepts clearing the birth year but not blank names or implausible years', () => {
    expect(UpdatePlayerboardPlayerRequestSchema.safeParse({ birthYear: null }).success).toBe(true)
    expect(UpdatePlayerboardPlayerRequestSchema.safeParse({ firstName: '  ' }).success).toBe(false)
    expect(UpdatePlayerboardPlayerRequestSchema.safeParse({ birthYear: 1800 }).success).toBe(false)
  })
})

describe('public team address segments', () => {
  const invalid = ['', 'U13', '..', '-u13', 'u13-', 'u--13', 'u 13', 'u/13', 'u.13']

  it.each([
    ['organization', OrganizationPublicSlugSchema, 200],
    ['department', DepartmentPublicSlugSchema, 200],
    ['team', TeamPublicSlugSchema, 80],
  ])('%s segment accepts its maximum length and rejects one more', (_name, schema, max) => {
    expect(schema.safeParse('a'.repeat(max)).success).toBe(true)
    expect(schema.safeParse('a'.repeat(max + 1)).success).toBe(false)
  })

  it.each([
    ['organization', OrganizationPublicSlugSchema],
    ['department', DepartmentPublicSlugSchema],
    ['team', TeamPublicSlugSchema],
  ])('%s segment rejects uppercase, empty, dots and misplaced hyphens', (_name, schema) => {
    for (const value of invalid) expect(schema.safeParse(value).success, value).toBe(false)
    expect(schema.safeParse('sv-musterstadt-2').success).toBe(true)
  })
})

describe('PublicTeamAddressSchema and publicTeamPath', () => {
  const address = { orgSlug: 'sv-musterstadt', departmentSlug: 'handball', teamSlug: 'u13' }

  it('requires all three segments', () => {
    expect(PublicTeamAddressSchema.safeParse(address).success).toBe(true)
    expect(PublicTeamAddressSchema.safeParse({ orgSlug: 'sv-musterstadt', teamSlug: 'u13' }).success).toBe(false)
    expect(PublicTeamAddressSchema.safeParse({ ...address, departmentSlug: undefined }).success).toBe(false)
  })

  it('builds the three-segment page path', () => {
    expect(publicTeamPath(address)).toBe('/mannschaft/sv-musterstadt/handball/u13')
  })
})
