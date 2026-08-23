import { describe, expect, it } from 'vitest'
import { BrandPageRowsSchema } from './brandPageRows'

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001'

function validRows() {
  return {
    brand: {
      primary_color: '#163a2c',
      accent_color: '#caff4a',
      background_color: '#f6f4ec',
      text_color: '#122820',
      on_primary_color: '#ffffff',
      display_font_key: 'manrope',
      body_font_key: 'dm_sans',
      display_font_asset_id: null,
      body_font_asset_id: null,
      logo_asset_id: null,
      website_url: 'https://verein.example.org',
      allow_department_overrides: true,
      locked_fields: [],
    },
    departments: [],
    teams: [],
    departmentProfiles: [],
    teamProfiles: [],
    assets: [],
  }
}

describe('BrandPageRowsSchema', () => {
  it('accepts validated Supabase brand rows', () => {
    expect(BrandPageRowsSchema.safeParse(validRows()).success).toBe(true)
  })

  it('rejects invalid rows before they reach the brand page state', () => {
    const rows = validRows()
    rows.brand.primary_color = 'not-a-color'

    expect(BrandPageRowsSchema.safeParse(rows).success).toBe(false)
  })

  it('requires nullable override columns to be selected', () => {
    const rows = {
      ...validRows(),
      departmentProfiles: [
        {
          department_id: ORGANIZATION_ID,
          accent_color: null,
          logo_asset_id: null,
          website_url: null,
          display_font_asset_id: null,
          body_font_asset_id: null,
          allow_team_overrides: true,
          locked_fields: [],
        },
      ],
    }

    expect(BrandPageRowsSchema.safeParse(rows).success).toBe(false)
  })
})
