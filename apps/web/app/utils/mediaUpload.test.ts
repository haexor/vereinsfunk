import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadMediaAsset } from './mediaUpload'

const ASSET_ID = '10000000-1000-4000-8000-000000000001'
const FILE = new File(['abc'], 'foto.jpg', { type: 'image/jpeg' })

describe('uploadMediaAsset', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reserves, uploads, completes with the checksum and returns the completion status', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const request = vi.fn(async (path: string, _options?: unknown, schema?: { parse: (value: unknown) => unknown }) =>
      schema!.parse(path === '/v1/media/uploads'
        ? { assetId: ASSET_ID, uploadUrl: 'https://storage.example/upload' }
        : { accepted: true, uploadStatus: 'ready', mimeType: 'image/jpeg' }))

    const result = await uploadMediaAsset({ request } as never, { organizationId: 'org', departmentId: null, file: FILE })

    expect(fetch).toHaveBeenCalledWith('https://storage.example/upload', expect.objectContaining({ method: 'PUT', body: FILE }))
    expect(request).toHaveBeenLastCalledWith(`/v1/media/${ASSET_ID}/complete`, {
      method: 'POST',
      body: { sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
    }, expect.anything())
    expect(result).toEqual({ assetId: ASSET_ID, accepted: true, uploadStatus: 'ready', mimeType: 'image/jpeg' })
  })

  it('fails without completing when the signed upload is rejected', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 403 }))
    const request = vi.fn(async () => ({ assetId: ASSET_ID, uploadUrl: 'https://storage.example/upload' }))

    await expect(uploadMediaAsset({ request } as never, { organizationId: 'org', departmentId: null, file: FILE })).rejects.toThrow('upload_failed')
    expect(request).toHaveBeenCalledTimes(1)
  })
})
