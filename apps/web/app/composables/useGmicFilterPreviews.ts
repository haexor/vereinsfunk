import { ImageStyleFilterPreviewsResponseSchema, type ImageStyleFilter } from '@vereinsfunk/contracts'
import { ApiRequestError } from '../utils/apiClient'
import { IMAGE_STYLE_FILTER_OPTIONS } from '../utils/imageStyleFilterCatalog'
import { canvasBlob } from '../utils/photoWorkshopCanvas'

/**
 * Serverseitig gerenderte G'MIC-Filter der Bildwerkstatt: die gefilterte grosse Vorschau, die
 * Kacheln der Filterauswahl und der gefilterte Export. Laeufe, Timer und Abbrueche liegen hier,
 * damit eine spaete Antwort nie einen neueren Zuschnitt oder Filter ueberschreibt.
 */
export function useGmicFilterPreviews(options: {
  organizationId: () => string
  departmentId: () => string | null
  // Aktueller Zuschnitt als Canvas und als Schluessel seiner Geometrie.
  croppedCanvas: () => HTMLCanvasElement | undefined
  cropSourceKey: () => string
  isFilterToolActive: () => boolean
  isCropToolActive: () => boolean
  isRestoringHistory: () => boolean
}) {
  const api = useApiClient()
  const runtimeConfig = useRuntimeConfig()
  const selectedFilter = ref<ImageStyleFilter>('original')
  const filteredPreviewUrl = ref('')
  const filterThumbnailUrls = ref<Partial<Record<ImageStyleFilter, string>>>({})
  const filterThumbnailStatuses = ref<Partial<Record<ImageStyleFilter, 'loading' | 'unavailable'>>>({})
  const applyingFilter = ref(false)
  const filterError = ref('')
  let filterPreviewRenderRun = 0
  let filterThumbnailRun = 0
  const filterRequestController = new AbortController()
  let filterThumbnailController: AbortController | undefined
  let filterThumbnailTimer: ReturnType<typeof setTimeout> | undefined
  let filterThumbnailsDirty = true
  const workshopFilters = computed(() =>
    IMAGE_STYLE_FILTER_OPTIONS.filter((option) => option.value === 'original' || option.group === 'G’MIC'),
  )

  async function renderGmicFilterBlob(source: Blob, filter: ImageStyleFilter): Promise<Blob> {
    if (filter === 'original') return source
    const body = new FormData()
    body.append('organizationId', options.organizationId())
    const departmentId = options.departmentId()
    if (departmentId) body.append('departmentId', departmentId)
    body.append('filter', filter)
    body.append('file', new File([source], 'bild.jpg', { type: 'image/jpeg' }))
    const response = await fetch(`${runtimeConfig.public.apiBase}/v1/image-style-workshop/filter`, {
      method: 'POST',
      headers: await useAuthHeader(),
      body,
      signal: filterRequestController.signal,
    })
    if (!response.ok) throw new Error(response.status === 422 ? 'gmic_not_enabled' : 'filter_render_failed')
    return response.blob()
  }
  /** Requests all server-rendered G’MIC thumbnails for the current cropped image. */
  async function renderGmicFilterThumbnails(source: Blob, signal: AbortSignal) {
    const body = new FormData()
    body.append('organizationId', options.organizationId())
    const departmentId = options.departmentId()
    if (departmentId) body.append('departmentId', departmentId)
    body.append('file', new File([source], 'bild.jpg', { type: 'image/jpeg' }))
    return api.request(
      '/v1/image-style-workshop/filter-previews',
      { method: 'POST', body, signal },
      ImageStyleFilterPreviewsResponseSchema,
    )
  }
  async function renderGmicFilter(
    canvas: HTMLCanvasElement,
    maxSide?: number,
    filter = selectedFilter.value,
  ): Promise<Blob> {
    return renderGmicFilterBlob(await canvasBlob(canvas, maxSide), filter)
  }
  function clearFilterThumbnailUrls() {
    for (const url of Object.values(filterThumbnailUrls.value)) URL.revokeObjectURL(url)
    filterThumbnailUrls.value = {}
    filterThumbnailStatuses.value = {}
  }
  function cancelFilterThumbnailRequest() {
    filterThumbnailController?.abort()
    filterThumbnailController = undefined
    filterThumbnailRun += 1
  }
  function markFilterThumbnailsDirty() {
    filterThumbnailsDirty = true
    cancelFilterThumbnailRequest()
    if (filterThumbnailTimer) clearTimeout(filterThumbnailTimer)
  }
  function scheduleFilterThumbnails(delay = 450) {
    if (!options.isFilterToolActive() || !filterThumbnailsDirty) return
    if (filterThumbnailTimer) clearTimeout(filterThumbnailTimer)
    filterThumbnailTimer = setTimeout(() => {
      filterThumbnailTimer = undefined
      void refreshFilterThumbnails()
    }, delay)
  }
  /** Refreshes gallery tiles and keeps transient preparation failures out of the loading state. */
  async function refreshFilterThumbnails() {
    const canvas = options.croppedCanvas()
    if (!canvas || !filterThumbnailsDirty) return
    cancelFilterThumbnailRequest()
    const controller = new AbortController()
    filterThumbnailController = controller
    const run = ++filterThumbnailRun
    const previewRun = filterPreviewRenderRun
    filterThumbnailsDirty = false
    clearFilterThumbnailUrls()
    const filters = workshopFilters.value.filter((filter) => filter.value !== 'original')
    filterThumbnailStatuses.value = Object.fromEntries(filters.map((filter) => [filter.value, 'loading']))
    filterError.value = ''
    let source: Blob
    try {
      source = await canvasBlob(canvas, 360)
    } catch {
      if (
        run !== filterThumbnailRun ||
        previewRun !== filterPreviewRenderRun ||
        controller.signal.aborted
      ) {
        if (filterThumbnailController === controller) filterThumbnailController = undefined
        return
      }
      filterThumbnailStatuses.value = Object.fromEntries(
        filters.map((filter) => [filter.value, 'unavailable']),
      )
      filterError.value = 'Die Filtervorschauen konnten nicht vorbereitet werden.'
      if (filterThumbnailController === controller) filterThumbnailController = undefined
      return
    }
    try {
      const result = await renderGmicFilterThumbnails(source, controller.signal)
      if (
        run !== filterThumbnailRun ||
        previewRun !== filterPreviewRenderRun ||
        controller.signal.aborted
      ) return
      filterThumbnailUrls.value = Object.fromEntries(
        result.previews
          .filter((preview) => preview.filter !== 'original')
          .map((preview) => [preview.filter, `data:image/webp;base64,${preview.imageBase64}`]),
      )
      filterThumbnailStatuses.value = Object.fromEntries(
        result.unavailableFilters.map((filter) => [filter, 'unavailable']),
      )
      if (
        filters.length > 0 &&
        filters.every((filter) => result.unavailableFilters.includes(filter.value))
      )
        filterError.value = 'G’MIC ist auf dem Server nicht verfügbar.'
    } catch (error) {
      if (
        run !== filterThumbnailRun ||
        previewRun !== filterPreviewRenderRun ||
        controller.signal.aborted
      ) return
      filterThumbnailStatuses.value = Object.fromEntries(filters.map((filter) => [filter.value, 'unavailable']))
      filterError.value = error instanceof ApiRequestError && error.code === 'rate_limited'
        ? 'Die Filtervorschauen sind momentan ausgelastet. Bitte kurz warten und erneut öffnen.'
        : 'Die Filtervorschauen konnten nicht geladen werden.'
    } finally {
      if (filterThumbnailController === controller) filterThumbnailController = undefined
    }
  }
  // Ausschnitt (Koordinaten und Transformationen), aus dem die gefilterte Vorschau zuletzt gerendert
  // wurde. Geometrie aendert sich nur im Zuschnitt-Werkzeug, dessen Vorschau ungefiltert ist: neu
  // gerendert wird erst, wenn die gefilterte Vorschau wieder sichtbar ist und sich der Ausschnitt seit
  // dem letzten Render geaendert hat -- nicht je Zwischenschritt und nicht doppelt nach einem Undo.
  let filterPreviewSource = ''
  function refreshChangedFilterPreview() {
    if (options.isCropToolActive() || options.isRestoringHistory() || selectedFilter.value === 'original') return
    if (options.cropSourceKey() !== filterPreviewSource) void refreshFilterPreview()
  }
  async function refreshFilterPreview() {
    const canvas = options.croppedCanvas()
    const filter = selectedFilter.value
    if (!canvas || filter === 'original') return
    filterPreviewSource = options.cropSourceKey()
    const resumeThumbnails = filterThumbnailController !== undefined
    cancelFilterThumbnailRequest()
    const renderRun = ++filterPreviewRenderRun
    applyingFilter.value = true
    filterError.value = ''
    try {
      const nextUrl = URL.createObjectURL(await renderGmicFilter(canvas, 1200, filter))
      if (renderRun !== filterPreviewRenderRun || selectedFilter.value !== filter) {
        URL.revokeObjectURL(nextUrl)
        return
      }
      const previousUrl = filteredPreviewUrl.value
      filteredPreviewUrl.value = nextUrl
      if (previousUrl) URL.revokeObjectURL(previousUrl)
    } catch (error) {
      if (renderRun !== filterPreviewRenderRun || selectedFilter.value !== filter) return
      filterPreviewSource = ''
      filterError.value = error instanceof Error && error.message === 'gmic_not_enabled'
        ? 'G’MIC ist auf dem Server nicht verfügbar.'
        : 'Der G’MIC-Filter konnte nicht gerendert werden.'
    } finally {
      if (renderRun === filterPreviewRenderRun) applyingFilter.value = false
      if (resumeThumbnails) {
        filterThumbnailsDirty = true
        scheduleFilterThumbnails()
      }
    }
  }
  /** Verwirft einen laufenden Render der grossen Vorschau. */
  function cancelFilterPreview() {
    filterPreviewRenderRun += 1
    applyingFilter.value = false
  }
  function clearFilteredPreview() {
    if (filteredPreviewUrl.value) URL.revokeObjectURL(filteredPreviewUrl.value)
    filteredPreviewUrl.value = ''
  }
  async function applyFilter(filter: ImageStyleFilter) {
    filterPreviewRenderRun += 1
    clearFilteredPreview()
    selectedFilter.value = filter
    if (filter === 'original') {
      applyingFilter.value = false
      filterError.value = ''
      return
    }
    await refreshFilterPreview()
  }
  /** Ein neues Ausgangsbild verwirft Vorschau, Kacheln und Filterwahl. */
  function resetForNewSource() {
    cancelFilterPreview()
    clearFilteredPreview()
    clearFilterThumbnailUrls()
    filterThumbnailsDirty = true
    selectedFilter.value = 'original'
  }

  onBeforeUnmount(() => {
    filterRequestController.abort()
    cancelFilterThumbnailRequest()
    filterPreviewRenderRun += 1
    clearFilteredPreview()
    if (filterThumbnailTimer) clearTimeout(filterThumbnailTimer)
    clearFilterThumbnailUrls()
  })

  return {
    selectedFilter, filteredPreviewUrl, filterThumbnailUrls, filterThumbnailStatuses, applyingFilter, filterError,
    workshopFilters, renderGmicFilter, markFilterThumbnailsDirty, scheduleFilterThumbnails, refreshFilterPreview,
    refreshChangedFilterPreview, cancelFilterPreview, clearFilteredPreview, applyFilter, resetForNewSource,
  }
}
