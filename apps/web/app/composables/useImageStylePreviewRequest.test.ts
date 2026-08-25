import type { PreviewImageStylePresetRequest } from '@vereinsfunk/contracts'
import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../utils/apiClient'
import type { useApiClient } from './useApiClient'
import { useImageStylePreviewRequest } from './useImageStylePreviewRequest'

const PAYLOAD: PreviewImageStylePresetRequest = {
  name: 'Standard',
  organizationId: 'org-1',
  frameType: 'none',
  frameStyle: null,
  frameColor: null,
  frameWidthPx: null,
  frameCornerRadiusPx: null,
  frameBrandAssetId: null,
  logoEnabled: false,
  logoBrandAssetId: null,
  logoPosition: 'bottom_right',
  logoSizePercent: null,
  logoMarginPercent: null,
  filter: 'original',
}

function setup(request: (path: string, options?: unknown) => Promise<unknown>) {
  const requestMock = vi.fn(request)
  const api = { request: requestMock } as unknown as ReturnType<typeof useApiClient>
  return { requestMock, ...useImageStylePreviewRequest({ api }) }
}

describe('useImageStylePreviewRequest', () => {
  it('applies a successful response', async () => {
    const { state, imageDataUrl, fetchNow } = setup(async () => ({
      imageBase64: 'aGVsbG8=',
      contentType: 'image/png',
      width: 4,
      height: 4,
      filterProvider: 'sharp',
    }))
    await fetchNow(PAYLOAD)
    expect(state.value).toBe('ready')
    expect(imageDataUrl.value).toBe('data:image/png;base64,aGVsbG8=')
  })

  it('ignores a stale response that resolves after a newer request was started', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    const first = new Promise((resolve) => { resolveFirst = resolve })
    let call = 0
    const { state, imageDataUrl, fetchNow } = setup(async () => {
      call += 1
      if (call === 1) return first
      return { imageBase64: 'c2Vjb25k', contentType: 'image/png', width: 4, height: 4, filterProvider: 'sharp' }
    })

    const firstCall = fetchNow(PAYLOAD)
    const secondCall = fetchNow(PAYLOAD)
    await secondCall
    expect(state.value).toBe('ready')
    expect(imageDataUrl.value).toBe('data:image/png;base64,c2Vjb25k')

    resolveFirst({ imageBase64: 'c3RhbGU=', contentType: 'image/png', width: 4, height: 4, filterProvider: 'sharp' })
    await firstCall
    // Die spaeter aufgeloeste, aber frueher gestartete Antwort darf das neuere Ergebnis nicht ueberschreiben.
    expect(imageDataUrl.value).toBe('data:image/png;base64,c2Vjb25k')
  })

  it('leaves the last good image untouched on error', async () => {
    let shouldFail = false
    const { state, imageDataUrl, errorCode, fetchNow } = setup(async () => {
      if (shouldFail) throw new ApiRequestError('gmic_not_enabled', 422)
      return { imageBase64: 'Z29vZA==', contentType: 'image/png', width: 4, height: 4, filterProvider: 'sharp' }
    })
    await fetchNow(PAYLOAD)
    expect(imageDataUrl.value).toBe('data:image/png;base64,Z29vZA==')

    shouldFail = true
    await fetchNow(PAYLOAD)
    expect(state.value).toBe('error')
    expect(errorCode.value).toBe('gmic_not_enabled')
    expect(imageDataUrl.value).toBe('data:image/png;base64,Z29vZA==')
  })
})
