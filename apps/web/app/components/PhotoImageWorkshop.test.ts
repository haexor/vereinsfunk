import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(join(import.meta.dirname, path), 'utf8')
const component = source('PhotoImageWorkshop.vue')
const filterPanel = source('PhotoWorkshopFilterPanel.vue')
const filterPreviews = source('../composables/useGmicFilterPreviews.ts')
const history = source('../composables/usePhotoWorkshopHistory.ts')
const assets = source('../composables/usePhotoWorkshopAssets.ts')

describe('PhotoImageWorkshop layout', () => {
  it('is embedded in its host instead of rendering as a modal', () => {
    expect(component).toContain('<section class="flex min-h-[680px]')
    expect(component).not.toContain('fixed inset-0')
    expect(component).not.toContain('aria-modal="true"')
  })

  it('keeps every tool reachable on narrow screens', () => {
    expect(component).toContain('overflow-x-auto')
    expect(component).toContain('min-w-0 max-w-full')
    expect(component).toContain('w-max min-w-full')
    expect(component).toContain('min-w-[5.5rem] shrink-0')
  })

  it('uses the cropper result for export dimensions and gives the cropper a bounded preview area', () => {
    expect(component).toContain('result?.coordinates.width')
    expect(component).toContain('h-[min(52vh,34rem)] min-h-72')
    expect(component).toContain('default-boundaries="fit"')
    expect(component).toContain(':debounce="100"')
    expect(component).toContain('absolute inset-3 min-h-0 min-w-0 sm:inset-5')
    expect(component).toContain('photo-workshop-cropper h-full w-full')
    expect(component).toContain('@ready="onCropperReady"')
    expect(component).toContain(':check-orientation="!skipOrientationCheck"')
    expect(component).toContain('@error="onCropperError"')
    expect(component).toContain('image-restriction="fit-area"')
    expect(component).toContain('@change="onCropChange"')
  })

  it('only exposes the crop stencil while the crop tool is active', () => {
    expect(component).toContain("movable: activeTool.value === 'crop'")
    expect(component).toContain("resizable: activeTool.value === 'crop'")
    expect(component).toContain(':stencil-props="cropperStencilProps"')
    expect(component).toContain("'photo-workshop-cropper--inactive': activeTool !== 'crop'")
    expect(component).toContain('.photo-workshop-cropper--inactive.vue-advanced-cropper')
    expect(component).toContain('visibility: hidden')
  })

  it('renders the cropped canvas outside the crop tool and keeps undo/redo histories', () => {
    expect(component).toContain('const croppedPreviewUrl = ref')
    expect(component).toContain("activeTool !== 'crop' && displayedPreviewUrl")
    expect(component).toContain('function updateCroppedPreview')
    expect(component).toContain('function defaultCropSize')
    expect(component).toContain(':default-size="defaultCropSize"')
    expect(filterPreviews).toContain('function renderGmicFilter')
    expect(filterPreviews).toContain("/v1/image-style-workshop/filter")
    expect(filterPreviews).toContain('let filterPreviewRenderRun = 0')
    expect(filterPreviews).toContain('const filter = selectedFilter.value')
    expect(filterPreviews).toContain('renderRun !== filterPreviewRenderRun || selectedFilter.value !== filter')
    expect(filterPreviews).toContain('renderGmicFilter(canvas, 1200, filter)')
    expect(component).toContain('v-if="applyingFilter"')
    expect(component).toContain('<LoaderCircle class="animate-spin"')
    expect(component).toContain('Filter wird angewendet …')
    expect(history).toContain('const undoHistory = ref<EditorState[]>')
    expect(history).toContain('const redoHistory = ref<EditorState[]>')
    expect(history).toContain('async function undo()')
    expect(history).toContain('async function redo()')
    expect(component).toContain('Schritt zurück')
    expect(component).toContain('Schritt vor')
  })

  it('keeps filter previews compact instead of stretching them across the panel', () => {
    expect(filterPanel).toContain('<div class="flex flex-wrap gap-2"><button v-for="filter')
    expect(filterPanel).toContain('focus-ring w-28 shrink-0 overflow-hidden')
    expect(filterPreviews).toContain('function scheduleFilterThumbnails')
    expect(filterPreviews).toContain('function refreshFilterThumbnails')
    expect(filterPreviews).toContain('/v1/image-style-workshop/filter-previews')
    expect(filterPreviews).toContain('ImageStyleFilterPreviewsResponseSchema')
    expect(filterPreviews).not.toContain('await Promise.all([renderNext(), renderNext()])')
    expect(filterPanel).toContain('filterThumbnailUrls[filter.value]')
    expect(filterPreviews).toContain('filterThumbnailStatuses.value = Object.fromEntries')
    expect(filterPreviews).toContain("filters.map((filter) => [filter.value, 'unavailable'])")
    expect(filterPreviews).toContain(
      'filters.every((filter) => result.unavailableFilters.includes(filter.value))',
    )
    expect(filterPreviews).toContain('const resumeThumbnails = filterThumbnailController !== undefined')
    expect(filterPreviews).toContain('{ method: \'POST\', body, signal }')
    expect(filterPreviews).toContain('previewRun !== filterPreviewRenderRun')
    expect(filterPreviews).not.toContain(
      "result.unavailableFilters.some((filter) => filter.startsWith('gmic_'))",
    )
    expect(component).not.toContain(':disabled="applyingFilter"')
    expect(filterPanel).not.toContain(':disabled="applyingFilter"')
    expect(filterPanel).not.toContain(':src="originalPreviewUrl" alt="" aria-hidden="true" class="aspect-[4/3] w-full rounded object-cover" /><span class="mt-1 block truncate text-center text-[10px] font-semibold">{{ filter.label }}</span>')
  })

  it('loads selectable frame assets from the shared brand asset library', () => {
    expect(assets).toContain('selectableFrameAssets')
    expect(assets).toContain('props.frameAssets ?? selectableAssetsToCards')
    expect(assets).toContain('const frames = computed')
  })
})

describe('PhotoImageWorkshop history and output size', () => {
  it('only records history from pointer gestures while the crop tool is active', () => {
    expect(component).toContain(`@pointerdown.capture="activeTool === 'crop' && startHistoryGroup()"`)
    expect(component).toContain(`@pointerup.capture="activeTool === 'crop' && finishHistoryGroup()"`)
  })

  it('does not render the filter preview from the canvas before an edit is applied', () => {
    const recordEdit = history.match(/function recordEdit\(\) {[\s\S]*?\n {2}}/)?.[0]
    const finishHistoryGroup = history.match(/function finishHistoryGroup\(\) {[\s\S]*?\n {2}}/)?.[0]
    expect(recordEdit).toBeDefined()
    expect(finishHistoryGroup).toBeDefined()
    expect(recordEdit).not.toContain('finishHistoryGroup')
    expect(finishHistoryGroup).not.toContain('refreshFilterPreview')
    expect(component.match(/function onCropChange\([\s\S]*?\n}\) {[\s\S]*?\n}/)?.[0]).toContain('refreshChangedFilterPreview()')
  })

  it('restores rotation, flip and crop without transitions after the reset has finished', () => {
    expect(history).toContain('await controller.reset()')
    expect(history).toContain('controller.rotate(state.crop.rotate, { transitions: false })')
    expect(history).toContain('controller.flip(state.crop.flipHorizontal, state.crop.flipVertical, { transitions: false })')
    expect(history).toContain('controller.setCoordinates(state.crop.coordinates, { transitions: false })')
  })

  it('lets a locked output size follow later crop changes', () => {
    const onCropChange = component.match(/function onCropChange\([\s\S]*?\n}\) {[\s\S]*?\n}/)?.[0]
    expect(onCropChange).toContain('followCrop(croppedWidth.value, croppedHeight.value)')
  })
})
