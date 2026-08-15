import { describe, expect, it } from 'vitest'
import { BrandAssetSchema, ConfirmBrandAssetLicenseRequestSchema, CreateBrandAssetRequestSchema, OrganizationBrandUpdateSchema, UpdateDepartmentBrandRequestSchema } from './index.js'
import { department, org, team } from './testFixtures.js'

describe('brand contracts (Paket 013)', () => {
  it('requires the full set of color roles, not just the original two', () => {
    expect(
      OrganizationBrandUpdateSchema.safeParse({ primaryColor: '#163a2c', accentColor: '#caff4a', displayFontKey: 'manrope', bodyFontKey: 'dm_sans' })
        .success,
    ).toBe(false)
  })

  it('accepts a complete organization brand update', () => {
    expect(
      OrganizationBrandUpdateSchema.safeParse({
        primaryColor: '#163a2c',
        accentColor: '#caff4a',
        backgroundColor: '#f6f4ec',
        textColor: '#122820',
        onPrimaryColor: '#ffffff',
        displayFontKey: 'manrope',
        bodyFontKey: 'dm_sans',
      }).success,
    ).toBe(true)
  })

  it('rejects a teamId without a departmentId when creating a brand asset', () => {
    expect(CreateBrandAssetRequestSchema.safeParse({ organizationId: org, teamId: team, kind: 'wordmark' }).success).toBe(false)
  })

  it('accepts a department-scoped brand asset request', () => {
    expect(CreateBrandAssetRequestSchema.safeParse({ organizationId: org, departmentId: department, kind: 'logo_mark' }).success).toBe(true)
  })

  it('rejects an unconfirmed license', () => {
    expect(ConfirmBrandAssetLicenseRequestSchema.safeParse({ licenseHolder: 'Verein', confirmed: false }).success).toBe(false)
  })

  it('rejects a brand asset kind outside the enum', () => {
    expect(BrandAssetSchema.safeParse({
      id: org,
      organizationId: org,
      departmentId: null,
      teamId: null,
      kind: 'banner',
      objectPath: 'organizations/x/brand/y.png',
      mimeType: 'image/png',
      byteSize: 100,
      width: null,
      height: null,
      fontFamily: null,
      fontWeight: null,
      fontStyle: null,
      licenseHolder: null,
      licenseNote: null,
      licenseConfirmedAt: null,
      status: 'ready',
      rejectionReason: null,
      createdAt: '2026-08-07T00:00:00.000+00:00',
    }).success).toBe(false)
  })

  it('caps lockedFields at the number of overridable brand fields', () => {
    expect(UpdateDepartmentBrandRequestSchema.safeParse({ lockedFields: Array.from({ length: 12 }, (_, i) => `field-${i}`) }).success).toBe(false)
  })

  it('rejects a lockedFields entry that is not an overridable brand field', () => {
    // Ein Tippfehler waere sonst gespeichert worden und haette lautlos nichts gesperrt.
    expect(UpdateDepartmentBrandRequestSchema.safeParse({ lockedFields: ['primary_colour'] }).success).toBe(false)
    // displayFontKey/bodyFontKey fuehrt keine untere Ebene -- eine Sperre darauf waere wirkungslos.
    expect(UpdateDepartmentBrandRequestSchema.safeParse({ lockedFields: ['displayFontKey'] }).success).toBe(false)
  })

  it('accepts the overridable brand fields as lockedFields', () => {
    expect(
      UpdateDepartmentBrandRequestSchema.safeParse({
        lockedFields: ['primaryColor', 'accentColor', 'logoAssetId', 'displayFontAssetId', 'bodyFontAssetId'],
      }).success,
    ).toBe(true)
  })
})

