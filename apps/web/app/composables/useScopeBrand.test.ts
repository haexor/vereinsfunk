import { readonly, ref, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLatestRequest } from './useLatestRequest'
import { useScopeBrand } from './useScopeBrand'

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001'
const DEPARTMENT_ID = '10000000-0000-4000-8000-000000000002'
const CLUB_LOGO_ID = '10000000-0000-4000-8000-000000000003'
const DEPARTMENT_LOGO_ID = '10000000-0000-4000-8000-000000000004'

function logoRow(id: string, departmentId: string | null) {
  return { id, department_id: departmentId, team_id: null, kind: 'logo_primary', object_path: `logos/${id}.png`, status: 'ready' }
}

describe('useScopeBrand', () => {
  let rows: Record<string, unknown>
  const queriedTables: string[] = []

  beforeEach(() => {
    queriedTables.length = 0
    rows = {
      organization_brand_profiles: { primary_color: '#102030', accent_color: '#a0b0c0', logo_asset_id: CLUB_LOGO_ID },
      department_brand_profiles: { primary_color: '#304050', accent_color: null, logo_asset_id: null },
      brand_assets: [logoRow(DEPARTMENT_LOGO_ID, DEPARTMENT_ID), logoRow(CLUB_LOGO_ID, null)],
    }
    const supabase = {
      from(table: string) {
        queriedTables.push(table)
        const query = {
          select: () => query, eq: () => query, in: () => query,
          maybeSingle: async () => ({ data: rows[table], error: null }),
          order: async () => ({ data: rows[table], error: null }),
        }
        return query
      },
      storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.example/${path}` } }) }) },
    }
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useLatestRequest', useLatestRequest)
    vi.stubGlobal('useBrandRevision', () => ({ revision: readonly(ref(0)) }))
    vi.stubGlobal('useSupabaseClient', () => supabase)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lays the department colours over the club brand and signs the explicitly linked club logo', async () => {
    const { brand, logoUrl } = useScopeBrand(ref({ organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID }))

    await vi.waitFor(() => expect(logoUrl.value).not.toBe(''))

    expect(brand.value).toMatchObject({ primaryColor: '#304050', accentColor: '#a0b0c0' })
    expect(logoUrl.value).toBe(`https://storage.example/logos/${CLUB_LOGO_ID}.png`)
  })

  it('keeps the default brand when the club row fails validation', async () => {
    rows.organization_brand_profiles = { primary_color: 'red', accent_color: '#a0b0c0', logo_asset_id: null }

    const { brand, logoUrl } = useScopeBrand(ref({ organizationId: ORGANIZATION_ID, departmentId: null }))

    await vi.waitFor(() => expect(queriedTables).toContain('organization_brand_profiles'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(brand.value).toEqual({ primaryColor: '#163a2c', accentColor: '#caff4a' })
    expect(logoUrl.value).toBe('')
    expect(queriedTables).not.toContain('brand_assets')
  })
})
