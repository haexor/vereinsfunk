import { describe, expect, it } from 'vitest'
import {
  BrandAssetSchema,
  BrandWebsiteUrlSchema,
  BrandWebsiteAnalysisResultSchema,
  ConfirmBrandAssetLicenseRequestSchema,
  CreateBrandAssetRequestSchema,
  OrganizationBrandUpdateSchema,
  UpdateDepartmentBrandRequestSchema,
  UpdateTeamBrandRequestSchema,
} from './index.js'
import { department, org, team } from './testFixtures.js'

describe('brand contracts (Paket 013)', () => {
  it('requires the two configurable color roles', () => {
    expect(
      OrganizationBrandUpdateSchema.safeParse({
        accentColor: '#caff4a',
        displayFontKey: 'manrope',
        bodyFontKey: 'dm_sans',
      }).success,
    ).toBe(false)
    expect(
      OrganizationBrandUpdateSchema.safeParse({
        primaryColor: '#163a2c',
        displayFontKey: 'manrope',
        bodyFontKey: 'dm_sans',
      }).success,
    ).toBe(false)
  })

  it('accepts a complete organization brand update', () => {
    expect(
      OrganizationBrandUpdateSchema.safeParse({
        primaryColor: '#163a2c',
        accentColor: '#caff4a',
        displayFontKey: 'manrope',
        bodyFontKey: 'dm_sans',
      }).success,
    ).toBe(true)
  })

  it('accepts valid HTTPS brand website URLs', () => {
    expect(BrandWebsiteUrlSchema.safeParse('https://verein.example.org/marke').success).toBe(true)
  })

  it.each([
    'http://verein.example.org',
    `https://verein.example.org/${'a'.repeat(2048)}`,
  ])('rejects an invalid brand website URL', (websiteUrl) => {
    expect(BrandWebsiteUrlSchema.safeParse(websiteUrl).success).toBe(false)
  })

  it('rejects a teamId without a departmentId when creating a brand asset', () => {
    expect(
      CreateBrandAssetRequestSchema.safeParse({
        organizationId: org,
        teamId: team,
        kind: 'logo_primary',
      }).success,
    ).toBe(false)
  })

  it('accepts a department-scoped brand asset request', () => {
    expect(
      CreateBrandAssetRequestSchema.safeParse({
        organizationId: org,
        departmentId: department,
        kind: 'logo_primary',
      }).success,
    ).toBe(true)
  })

  it('accepts a frame asset request', () => {
    expect(
      CreateBrandAssetRequestSchema.safeParse({
        organizationId: org,
        kind: 'frame',
      }).success,
    ).toBe(true)
  })

  it('rejects legacy logo kinds for new brand asset uploads', () => {
    expect(
      CreateBrandAssetRequestSchema.safeParse({
        organizationId: org,
        kind: 'wordmark',
      }).success,
    ).toBe(false)
  })

  it('rejects a website URL in a team brand update', () => {
    expect(
      UpdateTeamBrandRequestSchema.safeParse({ websiteUrl: 'https://team.example.org' }).success,
    ).toBe(false)
  })

  it('rejects an unconfirmed license', () => {
    expect(
      ConfirmBrandAssetLicenseRequestSchema.safeParse({ licenseHolder: 'Verein', confirmed: false })
        .success,
    ).toBe(false)
  })

  it('rejects a brand asset kind outside the enum', () => {
    expect(
      BrandAssetSchema.safeParse({
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
      }).success,
    ).toBe(false)
  })

  it('caps lockedFields at the number of overridable brand fields', () => {
    expect(
      UpdateDepartmentBrandRequestSchema.safeParse({
        lockedFields: Array.from({ length: 12 }, (_, i) => `field-${i}`),
      }).success,
    ).toBe(false)
  })

  it('rejects a lockedFields entry that is not an overridable brand field', () => {
    // Ein Tippfehler waere sonst gespeichert worden und haette lautlos nichts gesperrt.
    expect(
      UpdateDepartmentBrandRequestSchema.safeParse({ lockedFields: ['primary_colour'] }).success,
    ).toBe(false)
    // displayFontKey/bodyFontKey fuehrt keine untere Ebene -- eine Sperre darauf waere wirkungslos.
    expect(
      UpdateDepartmentBrandRequestSchema.safeParse({ lockedFields: ['displayFontKey'] }).success,
    ).toBe(false)
  })

  it('accepts the overridable brand fields as lockedFields', () => {
    expect(
      UpdateDepartmentBrandRequestSchema.safeParse({
        lockedFields: [
          'primaryColor',
          'accentColor',
          'logoAssetId',
          'websiteUrl',
          'displayFontAssetId',
          'bodyFontAssetId',
        ],
      }).success,
    ).toBe(true)
  })

  it('accepts the legacy single-logo analysis result and initializes the additive list', () => {
    const parsed = BrandWebsiteAnalysisResultSchema.parse({
      primaryColor: '#163a2c',
      accentColor: '#caff4a',
      backgroundColor: '#f6f4ec',
      textColor: '#122820',
      onPrimaryColor: '#ffffff',
      suggestedFontPairingKey: null,
      detectedFontFamily: null,
      logoCandidate: { signedUrl: 'https://signed.example/logo.png', mimeType: 'image/png' },
    })
    expect(parsed.logoCandidates).toEqual([])
    expect(parsed.logoCandidate).toEqual({
      signedUrl: 'https://signed.example/logo.png',
      mimeType: 'image/png',
    })
  })
})
