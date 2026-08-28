import { afterEach, describe, expect, it, vi } from 'vitest'
import type { useApiClient } from './useApiClient'
import {
  clearImageStyleFilterPreviewCache,
  useImageStyleFilterPreviewCache,
} from './useImageStyleFilterPreviewCache'

const SCOPE = {
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  departmentId: null,
  teamId: null,
}

function response() {
  return {
    previews: [
      {
        filter: 'original' as const,
        imageBase64: 'cHJldmlldw==',
        contentType: 'image/webp' as const,
        filterProvider: 'sharp',
      },
    ],
    unavailableFilters: ['gmic_vintage' as const],
  }
}

function setup(request = vi.fn(async () => response())) {
  const api = { request } as unknown as ReturnType<typeof useApiClient>
  return { request, ...useImageStyleFilterPreviewCache({ api }) }
}

afterEach(() => clearImageStyleFilterPreviewCache())

describe('useImageStyleFilterPreviewCache', () => {
  it('stores fully rendered previews per scope in the browser cache', async () => {
    const first = setup()
    await first.load(SCOPE)
    expect(first.previewByFilter.value.original).toBe('data:image/webp;base64,cHJldmlldw==')
    expect(first.unavailableFilters.value.has('gmic_vintage')).toBe(true)

    const second = setup()
    await second.load(SCOPE)
    expect(second.request).not.toHaveBeenCalled()
    expect(second.previewByFilter.value.original).toBe('data:image/webp;base64,cHJldmlldw==')
  })

  it('deduplicates simultaneous gallery requests for the same scope', async () => {
    let resolveRequest: (value: ReturnType<typeof response>) => void = () => {}
    const request = vi.fn(
      () => new Promise<ReturnType<typeof response>>((resolve) => { resolveRequest = resolve }),
    )
    const first = setup(request)
    const second = setup(request)
    const firstLoad = first.load(SCOPE)
    const secondLoad = second.load(SCOPE)
    expect(request).toHaveBeenCalledTimes(1)

    resolveRequest(response())
    await Promise.all([firstLoad, secondLoad])
    expect(first.previewByFilter.value.original).toBeDefined()
    expect(second.previewByFilter.value.original).toBeDefined()
  })
})
