import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const component = readFileSync(join(import.meta.dirname, 'PhotoImageWorkshop.vue'), 'utf8')

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
    expect(component).toContain('function renderGmicFilter')
    expect(component).toContain("/v1/image-style-workshop/filter")
    expect(component).toContain('let filterPreviewRenderRun = 0')
    expect(component).toContain('const filter = selectedFilter.value')
    expect(component).toContain('renderRun !== filterPreviewRenderRun || selectedFilter.value !== filter')
    expect(component).toContain('renderGmicFilter(canvas, 1200, filter)')
    expect(component).toContain('v-if="applyingFilter"')
    expect(component).toContain('<LoaderCircle class="animate-spin"')
    expect(component).toContain('Filter wird angewendet …')
    expect(component).toContain('const undoHistory = ref<EditorState[]>')
    expect(component).toContain('const redoHistory = ref<EditorState[]>')
    expect(component).toContain('async function undo()')
    expect(component).toContain('async function redo()')
    expect(component).toContain('Schritt zurück')
    expect(component).toContain('Schritt vor')
  })

  it('keeps filter previews compact instead of stretching them across the panel', () => {
    expect(component).toContain('<div class="flex flex-wrap gap-2"><button v-for="filter')
    expect(component).toContain('focus-ring w-28 shrink-0 overflow-hidden')
    expect(component).toContain('function scheduleFilterThumbnails')
    expect(component).toContain('function refreshFilterThumbnails')
    expect(component).toContain('/v1/image-style-workshop/filter-previews')
    expect(component).toContain('ImageStyleFilterPreviewsResponseSchema')
    expect(component).not.toContain('await Promise.all([renderNext(), renderNext()])')
    expect(component).toContain('filterThumbnailUrls[filter.value]')
    expect(component).not.toContain(':disabled="applyingFilter"')
    expect(component).not.toContain(':src="croppedPreviewUrl || sourceUrl" alt="" aria-hidden="true" class="aspect-[4/3] w-full rounded object-cover" /><span class="mt-1 block truncate text-center text-[10px] font-semibold">{{ filter.label }}</span>')
  })

  it('loads selectable frame assets from the shared brand asset library', () => {
    expect(component).toContain('selectableFrameAssets')
    expect(component).toContain('props.frameAssets ?? selectableAssetsToCards')
    expect(component).toContain('const frames = computed')
  })
})
