import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { SupabaseUploadService } from './mediaUpload.js'

const ORGANIZATION_ID = '10000000-1000-4000-8000-000000000001'
const DEPARTMENT_ID = '10000000-1100-4000-8000-000000000001'
const ASSET_ID = '10000000-9000-4000-8000-000000000001'

function fakeClient(options: {
  existing?: { bucket_id: string; object_path: string; upload_status: string; mime_type?: string | null } | null
  downloadBuffer?: Buffer
  downloadError?: { message: string } | null
  uploadError?: { message: string } | null
  updateErrors?: ({ message: string } | null)[]
  // Simulates a concurrent call that already won the compare-and-set: this call's own update
  // affects zero rows and the fallback read reports the status the winner persisted.
  raceLoserFallbackStatus?: string
  createSignedUploadUrlResult?: { data: { signedUrl: string; token: string; path: string } | null; error: { message: string } | null }
  captured?: { updates: Record<string, unknown>[]; uploaded?: { path: string; buffer: Buffer; contentType: string } }
}): SupabaseClient {
  const captured = options.captured ?? { updates: [] }
  return {
    from: (table: string) => {
      if (table !== 'media_assets') throw new Error(`unexpected table in test fake: ${table}`)
      return {
        select: (columns: string) => ({
          eq: () => ({
            single: async () => {
              if (options.raceLoserFallbackStatus !== undefined && columns === 'upload_status') return { data: { upload_status: options.raceLoserFallbackStatus }, error: null }
              return options.existing === undefined
                ? { data: { bucket_id: 'raw-media', object_path: 'organizations/x/departments/y/assets/z/foto.jpg', upload_status: 'initiated', mime_type: null }, error: null }
                : { data: options.existing, error: null }
            },
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          const builder = {
            eq: () => builder,
            select: async () => {
              captured.updates.push(payload)
              const error = options.updateErrors?.shift() ?? null
              if (error) return { data: null, error }
              if (options.raceLoserFallbackStatus !== undefined) return { data: [], error: null }
              return { data: [{ upload_status: payload.upload_status }], error: null }
            },
          }
          return builder
        },
      }
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async () => options.createSignedUploadUrlResult ?? { data: { signedUrl: `https://signed.example/${bucket}/upload`, token: 'tok', path: 'p' }, error: null },
        download: async () => {
          if (options.downloadError) return { data: null, error: options.downloadError }
          return { data: new Blob([new Uint8Array(options.downloadBuffer ?? Buffer.from(''))]), error: null }
        },
        upload: async (path: string, buffer: Buffer, opts: { contentType: string }) => {
          if (options.uploadError) return { error: options.uploadError }
          captured.uploaded = { path, buffer, contentType: opts.contentType }
          return { error: null }
        },
      }),
    },
  } as unknown as SupabaseClient
}

describe('SupabaseUploadService.create', () => {
  it('issues a signed upload URL under the department-scoped object path', async () => {
    let requestedBucket: string | undefined
    let requestedPath: string | undefined
    const client = {
      storage: {
        from: (bucket: string) => {
          requestedBucket = bucket
          return {
            createSignedUploadUrl: async (path: string) => {
              requestedPath = path
              return { data: { signedUrl: 'https://signed.example/x?token=abc', token: 'abc', path }, error: null }
            },
          }
        },
      },
    } as unknown as SupabaseClient
    const service = new SupabaseUploadService(() => client)
    const result = await service.create({ organizationId: ORGANIZATION_ID, departmentId: DEPARTMENT_ID, assetId: ASSET_ID, filename: 'foto.jpg', mimeType: 'image/jpeg', byteSize: 10 })
    expect(requestedBucket).toBe('raw-media')
    expect(requestedPath).toBe(`organizations/${ORGANIZATION_ID}/departments/${DEPARTMENT_ID}/assets/${ASSET_ID}/foto.jpg`)
    expect(result).toMatchObject({ uploadUrl: 'https://signed.example/x?token=abc', objectPath: requestedPath })
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })
})

describe('SupabaseUploadService.complete', () => {
  it('normalizes a valid JPEG, strips EXIF and marks the asset ready without a separate scanner', async () => {
    const original = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } } }).jpeg().toBuffer()
    const captured: { updates: Record<string, unknown>[]; uploaded?: { path: string; buffer: Buffer; contentType: string } } = { updates: [] }
    const client = fakeClient({ downloadBuffer: original, captured })
    const service = new SupabaseUploadService(() => client)
    const result = await service.complete({ assetId: ASSET_ID, sha256: createHash('sha256').update(original).digest('hex') })
    expect(result).toEqual({ accepted: true, uploadStatus: 'ready', mimeType: 'image/jpeg' })
    expect(captured.uploaded?.contentType).toBe('image/jpeg')
    const update = captured.updates.at(-1)!
    expect(update).toMatchObject({ structural_validation_status: 'valid', scan_status: 'clean', upload_status: 'ready', width: 2, height: 2, mime_type: 'image/jpeg' })
    expect(update.exif_stripped_at).toBeTruthy()
    expect(update.sha256).toBe(createHash('sha256').update(captured.uploaded!.buffer).digest('hex'))
  })

  it('marks the asset failed when the downloaded bytes do not match the announced sha256', async () => {
    const buffer = Buffer.from('not the right bytes')
    const captured: { updates: Record<string, unknown>[] } = { updates: [] }
    const client = fakeClient({ downloadBuffer: buffer, captured })
    const service = new SupabaseUploadService(() => client)
    const result = await service.complete({ assetId: ASSET_ID, sha256: 'f'.repeat(64) })
    expect(result).toEqual({ accepted: true, uploadStatus: 'failed', mimeType: null })
    expect(captured.updates).toEqual([{ structural_validation_status: 'failed', scan_status: 'failed', upload_status: 'failed' }])
  })

  it('marks the asset failed when the byte-sniffed content does not match any allowed media type', async () => {
    const buffer = Buffer.from('this is plainly not an image or a video')
    const captured: { updates: Record<string, unknown>[] } = { updates: [] }
    const client = fakeClient({ downloadBuffer: buffer, captured })
    const service = new SupabaseUploadService(() => client)
    const result = await service.complete({ assetId: ASSET_ID, sha256: createHash('sha256').update(buffer).digest('hex') })
    expect(result).toEqual({ accepted: true, uploadStatus: 'failed', mimeType: null })
    expect(captured.updates).toEqual([{ structural_validation_status: 'failed', scan_status: 'failed', upload_status: 'failed' }])
  })

  it('marks the asset failed when the PNG magic bytes are present but the file cannot actually be decoded', async () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const buffer = Buffer.concat([pngHeader, Buffer.from('garbage instead of real chunks')])
    const captured: { updates: Record<string, unknown>[] } = { updates: [] }
    const client = fakeClient({ downloadBuffer: buffer, captured })
    const service = new SupabaseUploadService(() => client)
    const result = await service.complete({ assetId: ASSET_ID, sha256: createHash('sha256').update(buffer).digest('hex') })
    expect(result).toEqual({ accepted: true, uploadStatus: 'failed', mimeType: null })
    expect(captured.updates).toEqual([{ structural_validation_status: 'failed', scan_status: 'failed', upload_status: 'failed' }])
  })

  it('accepts an mp4 by magic bytes alone, without any sharp re-encode', async () => {
    const buffer = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.from('rest of a fake mp4')])
    const captured: { updates: Record<string, unknown>[]; uploaded?: { path: string; buffer: Buffer; contentType: string } } = { updates: [] }
    const client = fakeClient({ downloadBuffer: buffer, captured })
    const service = new SupabaseUploadService(() => client)
    const result = await service.complete({ assetId: ASSET_ID, sha256: createHash('sha256').update(buffer).digest('hex') })
    expect(result).toEqual({ accepted: true, uploadStatus: 'ready', mimeType: 'video/mp4' })
    const update = captured.updates.at(-1)!
    expect(update).toMatchObject({ structural_validation_status: 'valid', scan_status: 'clean', upload_status: 'ready', mime_type: 'video/mp4', width: null, height: null, exif_stripped_at: null })
    expect(captured.uploaded?.buffer).toEqual(buffer)
  })

  it('is idempotent: a second call after the asset already left "initiated" does not re-download or re-process', async () => {
    let downloadCalled = false
    const client = {
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { bucket_id: 'raw-media', object_path: 'x', upload_status: 'ready', mime_type: 'video/mp4' }, error: null }) }) }) }),
      storage: { from: () => ({ download: async () => { downloadCalled = true; return { data: null, error: null } } }) },
    } as unknown as SupabaseClient
    const service = new SupabaseUploadService(() => client)
    const result = await service.complete({ assetId: ASSET_ID, sha256: 'f'.repeat(64) })
    expect(result).toEqual({ accepted: true, uploadStatus: 'ready', mimeType: 'video/mp4' })
    expect(downloadCalled).toBe(false)
  })

  it('does not let a losing concurrent update overwrite an already-persisted terminal status', async () => {
    const buffer = Buffer.from('not the right bytes')
    const captured: { updates: Record<string, unknown>[] } = { updates: [] }
    const client = fakeClient({ downloadBuffer: buffer, captured, raceLoserFallbackStatus: 'ready' })
    const service = new SupabaseUploadService(() => client)
    const result = await service.complete({ assetId: ASSET_ID, sha256: 'f'.repeat(64) })
    expect(result).toEqual({ accepted: true, uploadStatus: 'ready', mimeType: null })
    expect(captured.updates).toEqual([{ structural_validation_status: 'failed', scan_status: 'failed', upload_status: 'failed' }])
  })

  it('retries successfully after storage has received normalized bytes but the durable update failed', async () => {
    const original = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 255 } } }).jpeg().toBuffer()
    const captured: { updates: Record<string, unknown>[]; uploaded?: { path: string; buffer: Buffer; contentType: string } } = { updates: [] }
    const client = fakeClient({ downloadBuffer: original, updateErrors: [{ message: 'temporary database outage' }, null], captured })
    const service = new SupabaseUploadService(() => client)
    const input = { assetId: ASSET_ID, sha256: createHash('sha256').update(original).digest('hex') }

    await expect(service.complete(input)).rejects.toMatchObject({ message: 'temporary database outage' })
    await expect(service.complete(input)).resolves.toEqual({ accepted: true, uploadStatus: 'ready', mimeType: 'image/jpeg' })

    expect(captured.updates).toHaveLength(2)
    expect(captured.updates[0]).toMatchObject({ object_path: 'organizations/x/departments/y/assets/z/foto.jpg.normalized', upload_status: 'ready' })
    expect(captured.updates[1]).toMatchObject({ object_path: 'organizations/x/departments/y/assets/z/foto.jpg.normalized', upload_status: 'ready' })
  })
})
