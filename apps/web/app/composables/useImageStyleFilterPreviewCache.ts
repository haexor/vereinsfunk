import {
  ImageStyleFilterPreviewsResponseSchema,
  type ImageStyleFilter,
} from '@vereinsfunk/contracts'
import { ref } from 'vue'
import type { useApiClient } from './useApiClient'

export interface CachedFilterPreviews {
  previewByFilter: Partial<Record<ImageStyleFilter, string>>
  unavailableFilters: Set<ImageStyleFilter>
}

type CacheEntry = CachedFilterPreviews & { expiresAt: number }

// Die fertig gerenderten WebP-Kacheln sind klein, aber der vollständige G'MIC-Katalog ist teuer.
// Dieser Cache lebt ausschließlich im Browser (also weder im SSR-Payload noch mandantenübergreifend
// auf dem Server) und dedupliziert außerdem parallele Galerien für denselben Scope.
const CACHE_TTL_MS = 10 * 60_000
const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<CachedFilterPreviews>>()

function cacheKey(input: {
  organizationId: string
  departmentId: string | null
  teamId: string | null
}): string {
  return `${input.organizationId}:${input.departmentId ?? ''}:${input.teamId ?? ''}`
}

function toDataUrl(imageBase64: string): string {
  return `data:image/webp;base64,${imageBase64}`
}

async function fetchFilterPreviews(
  api: ReturnType<typeof useApiClient>,
  input: { organizationId: string; departmentId: string | null; teamId: string | null },
): Promise<CachedFilterPreviews> {
  const result = await api.request(
    '/v1/image-style-presets/filter-previews',
    {
      method: 'POST',
      body: {
        organizationId: input.organizationId,
        ...(input.departmentId ? { departmentId: input.departmentId } : {}),
        ...(input.teamId ? { teamId: input.teamId } : {}),
      },
    },
    ImageStyleFilterPreviewsResponseSchema,
  )
  return {
    previewByFilter: Object.fromEntries(
      result.previews.map((preview) => [preview.filter, toDataUrl(preview.imageBase64)]),
    ),
    unavailableFilters: new Set(result.unavailableFilters),
  }
}

export function clearImageStyleFilterPreviewCache(): void {
  cache.clear()
  inFlight.clear()
}

export function useImageStyleFilterPreviewCache({ api }: { api: ReturnType<typeof useApiClient> }) {
  const loading = ref(false)
  const loadError = ref(false)
  const previewByFilter = ref<Partial<Record<ImageStyleFilter, string>>>({})
  const unavailableFilters = ref<Set<ImageStyleFilter>>(new Set())
  let latestLoad = 0

  async function load(input: {
    organizationId: string
    departmentId: string | null
    teamId: string | null
  }): Promise<void> {
    const load = ++latestLoad
    previewByFilter.value = {}
    unavailableFilters.value = new Set()
    loadError.value = false
    if (!input.organizationId || import.meta.server) {
      loading.value = false
      return
    }

    const key = cacheKey(input)
    const cached = cache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      previewByFilter.value = cached.previewByFilter
      unavailableFilters.value = cached.unavailableFilters
      loading.value = false
      return
    }

    loading.value = true
    try {
      let request = inFlight.get(key)
      if (!request) {
        request = fetchFilterPreviews(api, input)
        inFlight.set(key, request)
      }
      const loaded = await request
      cache.set(key, { ...loaded, expiresAt: Date.now() + CACHE_TTL_MS })
      if (load !== latestLoad) return
      previewByFilter.value = loaded.previewByFilter
      unavailableFilters.value = loaded.unavailableFilters
    } catch {
      if (load !== latestLoad) return
      loadError.value = true
    } finally {
      inFlight.delete(key)
      if (load === latestLoad) loading.value = false
    }
  }

  return { loading, loadError, previewByFilter, unavailableFilters, load }
}
