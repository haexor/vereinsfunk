import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { ensurePassThroughDerivative } from './passThroughDerivative.js'

const ORGANIZATION_ID = '10000000-1000-4000-8000-000000000001'
const ASSET_ID = '10000000-9000-4000-8000-000000000001'

function fakeClient(options: {
  existingDerivatives?: { id: string; recipe: unknown; status: string }[]
  asset?: { bucket_id: string; object_path: string; mime_type: string; byte_size: number; sha256: string; width: number | null; height: number | null; upload_status: string }
  captured?: { downloaded?: string; uploaded?: { bucket: string; path: string; buffer: Buffer; contentType: string }; inserted?: Record<string, unknown>; filters?: [string, unknown][]; upsertOptions?: Record<string, unknown> }
}): SupabaseClient {
  const captured = options.captured ?? {}
  const asset = options.asset ?? { bucket_id: 'raw-media', object_path: 'organizations/x/departments/y/assets/1/a.jpg', mime_type: 'image/jpeg', byte_size: 10, sha256: 'a'.repeat(64), width: 2, height: 2, upload_status: 'ready' }
  return {
    from: (table: string) => {
      if (table === 'media_derivatives') {
        return {
          select: () => ({
            eq: () => ({ eq: async () => ({ data: options.existingDerivatives ?? [], error: null }) }),
          }),
          upsert: (row: Record<string, unknown>, upsertOptions: Record<string, unknown>) => {
            captured.inserted = row
            captured.upsertOptions = upsertOptions
            return { select: () => ({ single: async () => ({ data: { id: '10000000-8000-4000-8000-000000000001' }, error: null }) }) }
          },
        }
      }
      if (table === 'media_assets') {
        const query = {
          eq: (column: string, value: unknown) => {
            captured.filters ??= []
            captured.filters.push([column, value])
            return query
          },
          single: async () => ({ data: asset, error: null }),
        }
        return { select: () => query }
      }
      throw new Error(`unexpected table in test fake: ${table}`)
    },
    storage: {
      from: (bucket: string) => ({
        download: async () => { captured.downloaded = bucket; return { data: new Blob([new Uint8Array(Buffer.from('original bytes'))]), error: null } },
        upload: async (path: string, buffer: Buffer, opts: { contentType: string }) => { captured.uploaded = { bucket, path, buffer, contentType: opts.contentType }; return { error: null } },
      }),
    },
  } as unknown as SupabaseClient
}

describe('ensurePassThroughDerivative', () => {
  it('reuses an existing ready pass_through_v1 derivative without touching storage', async () => {
    const captured: { downloaded?: string; uploaded?: { bucket: string; path: string; buffer: Buffer; contentType: string } } = {}
    const client = fakeClient({ existingDerivatives: [{ id: '10000000-7000-4000-8000-000000000001', recipe: { kind: 'pass_through_v1' }, status: 'ready' }], captured })
    const result = await ensurePassThroughDerivative(client, ORGANIZATION_ID, ASSET_ID)
    expect(result).toEqual({ id: '10000000-7000-4000-8000-000000000001' })
    expect(captured.downloaded).toBeUndefined()
    expect(captured.uploaded).toBeUndefined()
  })

  it('ignores a derivative of a different recipe kind or non-ready status, and creates a fresh pass-through', async () => {
    const captured: { uploaded?: { bucket: string; path: string; buffer: Buffer; contentType: string }; inserted?: Record<string, unknown>; filters?: [string, unknown][]; upsertOptions?: Record<string, unknown> } = {}
    const client = fakeClient({
      existingDerivatives: [
        { id: '10000000-7000-4000-8000-000000000002', recipe: { kind: 'styled_v1' }, status: 'ready' },
        { id: '10000000-7000-4000-8000-000000000003', recipe: { kind: 'pass_through_v1' }, status: 'processing' },
      ],
      captured,
    })
    const result = await ensurePassThroughDerivative(client, ORGANIZATION_ID, ASSET_ID)
    expect(result).toEqual({ id: '10000000-8000-4000-8000-000000000001' })
    expect(captured.uploaded?.bucket).toBe('rendered-media')
    expect(captured.uploaded?.contentType).toBe('image/jpeg')
    expect(captured.inserted).toMatchObject({
      organization_id: ORGANIZATION_ID, media_asset_id: ASSET_ID, recipe: { kind: 'pass_through_v1' },
      recipe_version: 'pass-through-v1', status: 'ready', sha256: 'a'.repeat(64), width: 2, height: 2,
    })
    expect(captured.filters).toEqual([['id', ASSET_ID], ['organization_id', ORGANIZATION_ID]])
    expect(captured.upsertOptions).toEqual({ onConflict: 'bucket_id,object_path' })
  })

  it('copies the normalized bytes byte-for-byte into rendered-media and records the same sha256', async () => {
    const captured: { uploaded?: { bucket: string; path: string; buffer: Buffer; contentType: string }; inserted?: Record<string, unknown> } = {}
    const client = fakeClient({ captured })
    await ensurePassThroughDerivative(client, ORGANIZATION_ID, ASSET_ID)
    expect(captured.uploaded?.buffer.toString()).toBe('original bytes')
    expect(captured.uploaded?.path).toBe(`organizations/${ORGANIZATION_ID}/derivatives/${ASSET_ID}/pass-through.jpg`)
  })

  it('refuses to create a derivative for an asset that is not ready, without ever touching storage', async () => {
    const captured: { downloaded?: string; uploaded?: { bucket: string; path: string; buffer: Buffer; contentType: string } } = {}
    const client = fakeClient({ asset: { bucket_id: 'raw-media', object_path: 'x', mime_type: 'image/jpeg', byte_size: 10, sha256: 'a'.repeat(64), width: null, height: null, upload_status: 'initiated' }, captured })
    const result = await ensurePassThroughDerivative(client, ORGANIZATION_ID, ASSET_ID)
    expect(result).toEqual({ error: 'media_asset_not_ready' })
    expect(captured.downloaded).toBeUndefined()
    expect(captured.uploaded).toBeUndefined()
  })
})
