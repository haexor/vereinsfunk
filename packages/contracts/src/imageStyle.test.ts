import { describe, expect, it } from 'vitest'
import { CreateImageStylePresetRequestSchema, UpdateImageStylePresetRequestSchema } from './imageStyle.js'
import { department, org, team } from './testFixtures.js'

const baseFields = {
  name: 'Standard',
  frameType: 'none' as const,
  frameStyle: null,
  frameColor: null,
  frameWidthPx: null,
  frameCornerRadiusPx: null,
  frameBrandAssetId: null,
  logoEnabled: false,
  logoBrandAssetId: null,
  logoPosition: 'bottom_right' as const,
  logoSizePercent: null,
  logoMarginPercent: null,
  filter: 'original' as const,
}

describe('image style preset contracts (Plan 045, PR 1)', () => {
  it('accepts a minimal, unstyled organization-wide preset', () => {
    expect(CreateImageStylePresetRequestSchema.safeParse({ ...baseFields, organizationId: org }).success).toBe(true)
  })

  it('rejects a teamId without a departmentId', () => {
    expect(CreateImageStylePresetRequestSchema.safeParse({ ...baseFields, organizationId: org, teamId: team }).success).toBe(false)
  })

  it('accepts a department-scoped preset', () => {
    expect(CreateImageStylePresetRequestSchema.safeParse({ ...baseFields, organizationId: org, departmentId: department }).success).toBe(true)
  })

  it('rejects a parametric frame without frameColor and frameWidthPx', () => {
    expect(
      CreateImageStylePresetRequestSchema.safeParse({ ...baseFields, organizationId: org, frameType: 'parametric', frameStyle: 'solid' }).success,
    ).toBe(false)
  })

  it('accepts a parametric frame with frameColor, frameWidthPx and frameStyle', () => {
    expect(
      CreateImageStylePresetRequestSchema.safeParse({
        ...baseFields, organizationId: org, frameType: 'parametric', frameStyle: 'solid', frameColor: '#163a2c', frameWidthPx: 8,
      }).success,
    ).toBe(true)
  })

  it('accepts a role-based frame color', () => {
    expect(
      CreateImageStylePresetRequestSchema.safeParse({
        ...baseFields, organizationId: org, frameType: 'parametric', frameStyle: 'solid', frameColor: 'primary', frameWidthPx: 8,
      }).success,
    ).toBe(true)
  })

  it('rejects a parametric frame without frameStyle', () => {
    expect(
      CreateImageStylePresetRequestSchema.safeParse({
        ...baseFields, organizationId: org, frameType: 'parametric', frameColor: 'primary', frameWidthPx: 8,
      }).success,
    ).toBe(false)
  })

  it('rejects frameStyle set while frameType is not parametric', () => {
    expect(CreateImageStylePresetRequestSchema.safeParse({ ...baseFields, organizationId: org, frameStyle: 'double' }).success).toBe(false)
  })

  it('accepts every frame style with frameColor and frameWidthPx', () => {
    for (const frameStyle of ['solid', 'double', 'corner_marks', 'bottom_bar'] as const) {
      expect(
        CreateImageStylePresetRequestSchema.safeParse({
          ...baseFields, organizationId: org, frameType: 'parametric', frameStyle, frameColor: 'primary', frameWidthPx: 8,
        }).success,
      ).toBe(true)
    }
  })

  it('rejects a custom frame without frameBrandAssetId', () => {
    expect(CreateImageStylePresetRequestSchema.safeParse({ ...baseFields, organizationId: org, frameType: 'custom' }).success).toBe(false)
  })

  it('rejects frameBrandAssetId set while frameType is not custom', () => {
    expect(CreateImageStylePresetRequestSchema.safeParse({ ...baseFields, organizationId: org, frameBrandAssetId: org }).success).toBe(false)
  })

  it('accepts a custom frame with frameBrandAssetId', () => {
    expect(CreateImageStylePresetRequestSchema.safeParse({ ...baseFields, organizationId: org, frameType: 'custom', frameBrandAssetId: org }).success).toBe(
      true,
    )
  })

  it('rejects logoEnabled without the full logo field set', () => {
    expect(CreateImageStylePresetRequestSchema.safeParse({ ...baseFields, organizationId: org, logoEnabled: true }).success).toBe(false)
  })

  it('rejects logo fields set while logoEnabled is false', () => {
    expect(
      CreateImageStylePresetRequestSchema.safeParse({ ...baseFields, organizationId: org, logoBrandAssetId: org, logoSizePercent: 10, logoMarginPercent: 4 })
        .success,
    ).toBe(false)
  })

  it('accepts logoEnabled with the full logo field set', () => {
    expect(
      CreateImageStylePresetRequestSchema.safeParse({
        ...baseFields,
        organizationId: org,
        logoEnabled: true,
        logoBrandAssetId: org,
        logoSizePercent: 10,
        logoMarginPercent: 4,
      }).success,
    ).toBe(true)
  })

  it('rejects a name over 80 characters', () => {
    expect(CreateImageStylePresetRequestSchema.safeParse({ ...baseFields, organizationId: org, name: 'x'.repeat(81) }).success).toBe(false)
  })

  it('applies the same cross-field rules on update', () => {
    expect(UpdateImageStylePresetRequestSchema.safeParse({ ...baseFields, frameType: 'parametric' }).success).toBe(false)
    expect(UpdateImageStylePresetRequestSchema.safeParse({ ...baseFields, isActive: false }).success).toBe(true)
  })
})
