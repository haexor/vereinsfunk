import { describe, expect, it } from 'vitest'
import { deriveIsMinor, peopleDomainAdapter, PersonExternalSchema } from './person.js'

describe('deriveIsMinor', () => {
  it('treats the whole calendar year of the 18th birthday as still a minor', () => {
    expect(deriveIsMinor(2008, 2026)).toBe(true) // turns 18 in 2026, still minor all year
    expect(deriveIsMinor(2008, 2027)).toBe(false) // adult from the following year on
    expect(deriveIsMinor(2008, 2020)).toBe(true) // clearly still a child
  })
})

describe('peopleDomainAdapter.normalize', () => {
  it('maps external columns to internal fields and ignores unmapped columns entirely', () => {
    const raw = { Vorname: 'Anna', Nachname: 'Beck', IBAN: 'DE00000000000000000000' }
    const mapping = { Vorname: 'firstName', Nachname: 'lastName' }
    const normalized = peopleDomainAdapter.normalize(raw, mapping) as Record<string, unknown>
    expect(normalized).toEqual({ firstName: 'Anna', lastName: 'Beck' })
    expect('IBAN' in normalized).toBe(false)
  })

  it('drops empty string values -- an empty CSV cell must not become an empty required field', () => {
    const normalized = peopleDomainAdapter.normalize({ Geburtsjahr: '' }, { Geburtsjahr: 'birthYear' })
    expect(normalized).toEqual({})
  })

  it('strips a field mapped to a name the schema does not know -- the data minimization boundary in code', () => {
    const raw = { Vorname: 'Anna', Nachname: 'Beck', IBAN: 'DE00000000000000000000' }
    // Eine (fehlerhafte oder boesartige) Zuordnung, die eine IBAN-Spalte auf ein nicht existierendes
    // Feld "iban" zuordnet -- PersonExternalSchema kennt dieses Feld nicht und wirft es beim parse() weg.
    const mapping = { Vorname: 'firstName', Nachname: 'lastName', IBAN: 'iban' }
    const normalized = peopleDomainAdapter.normalize(raw, mapping) as Record<string, unknown>
    expect(normalized).toHaveProperty('iban')
    const parsed = PersonExternalSchema.parse(normalized)
    expect('iban' in parsed).toBe(false)
  })
})

describe('peopleDomainAdapter.identityOf', () => {
  it('prefers the external id when present', () => {
    const entity = PersonExternalSchema.parse({ externalId: 'ext-1', firstName: 'Anna', lastName: 'Beck' })
    expect(peopleDomainAdapter.identityOf(entity)).toEqual({ externalId: 'ext-1' })
  })

  it('falls back to a fuzzy key of name and birth year when there is no external id', () => {
    const entity = PersonExternalSchema.parse({ firstName: 'Anna', lastName: 'Beck', birthYear: 2010 })
    expect(peopleDomainAdapter.identityOf(entity)).toEqual({ fuzzy: ['anna', 'beck', '2010'] })
  })
})
