import { describe, expect, it } from 'vitest'
import { CreateDirectoryPersonRequestSchema, CreateIntegrationSourceRequestSchema, DirectoryPersonSchema, UpdateDirectoryPersonRequestSchema } from './index.js'
import { team } from './testFixtures.js'

describe('integration and directory contracts (Paket 014)', () => {
  it('rejects http/webhook as a creatable transport -- no adapter in this package', () => {
    expect(
      CreateIntegrationSourceRequestSchema.safeParse({
        transport: 'http',
        providerKey: 'easyverein',
        displayName: 'easyVerein',
        enabledDomains: ['people'],
      }).success,
    ).toBe(false)
  })

  it('requires an endpointUrl for an ical source but not for a file source', () => {
    expect(
      CreateIntegrationSourceRequestSchema.safeParse({
        transport: 'ical',
        providerKey: 'ical',
        displayName: 'Spielplan-Feed',
        enabledDomains: ['fixtures'],
      }).success,
    ).toBe(false)
    expect(
      CreateIntegrationSourceRequestSchema.safeParse({
        transport: 'file',
        providerKey: 'csv',
        displayName: 'Mitgliederliste',
        enabledDomains: ['people'],
      }).success,
    ).toBe(true)
  })

  it('rejects an empty enabledDomains array', () => {
    expect(
      CreateIntegrationSourceRequestSchema.safeParse({
        transport: 'file', providerKey: 'csv', displayName: 'x', enabledDomains: [],
      }).success,
    ).toBe(false)
  })

  it('has no guardian contact fields at all -- removed in plan 054', () => {
    expect(Object.keys(DirectoryPersonSchema.shape)).not.toContain('guardianName')
    expect(Object.keys(DirectoryPersonSchema.shape)).not.toContain('guardianEmail')
    const result = CreateDirectoryPersonRequestSchema.safeParse({
      firstName: 'Mia', lastName: 'Muster', guardianEmail: 'eltern@beispiel.de',
    })
    expect(result.success).toBe(true)
    if (result.success) expect('guardianEmail' in result.data).toBe(false)
  })

  it('rejects fields the plan explicitly excludes from the directory, such as an address', () => {
    const result = CreateDirectoryPersonRequestSchema.safeParse({
      firstName: 'Mia', lastName: 'Muster', address: 'Hauptstrasse 1',
    })
    expect(result.success).toBe(true)
    if (result.success) expect('address' in result.data).toBe(false)
  })

  it('rejects a teamId without a departmentId when creating a directory person', () => {
    expect(CreateDirectoryPersonRequestSchema.safeParse({ firstName: 'Mia', lastName: 'Muster', teamId: team }).success).toBe(false)
  })

  it('rejects an update request with no fields at all', () => {
    expect(UpdateDirectoryPersonRequestSchema.safeParse({}).success).toBe(false)
  })

  it('trims and lowercases the optional person email before validating it', () => {
    const result = CreateDirectoryPersonRequestSchema.safeParse({
      firstName: 'Mia', lastName: 'Muster', email: '  Mia.Muster@Beispiel.de ',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.email).toBe('mia.muster@beispiel.de')
    const update = UpdateDirectoryPersonRequestSchema.safeParse({ email: ' Mia@Beispiel.DE' })
    expect(update.success).toBe(true)
    if (update.success) expect(update.data.email).toBe('mia@beispiel.de')
  })

  it('rejects an invalid person email and allows clearing it with null', () => {
    expect(CreateDirectoryPersonRequestSchema.safeParse({ firstName: 'Mia', lastName: 'Muster', email: 'keine-adresse' }).success).toBe(false)
    expect(UpdateDirectoryPersonRequestSchema.safeParse({ email: 'keine-adresse' }).success).toBe(false)
    expect(UpdateDirectoryPersonRequestSchema.safeParse({ email: null }).success).toBe(true)
  })
})

