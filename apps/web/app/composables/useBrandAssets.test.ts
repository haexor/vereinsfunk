import { describe, expect, it } from 'vitest'
import { BrandAssetRowSchema, SignedBrandAssetUrlSchema } from './useBrandAssets'

const ASSET_ID = '10000000-0000-4000-8000-000000000001'

function validAssetRow() {
  return {
    id: ASSET_ID,
    department_id: null,
    team_id: null,
    kind: 'frame',
    object_path: `organizations/${ASSET_ID}/frames/club-frame.png`,
    status: 'ready',
    font_family: null,
    font_weight: null,
    font_style: null,
    license_holder: null,
    created_at: '2026-08-29T04:24:36.000Z',
  }
}

describe('brand asset Supabase responses', () => {
  it('accepts a complete selectable asset row', () => {
    expect(BrandAssetRowSchema.safeParse(validAssetRow()).success).toBe(true)
  })

  it('rejects an asset row without a usable object path', () => {
    expect(BrandAssetRowSchema.safeParse({ ...validAssetRow(), object_path: '' }).success).toBe(false)
  })

  it('rejects malformed signed URLs before they enter the asset cache', () => {
    expect(SignedBrandAssetUrlSchema.safeParse({ signedUrl: 'not-a-url' }).success).toBe(false)
  })
})
