<script setup lang="ts">
import { Check, Crop, Frame, Image, LoaderCircle, Maximize2, SlidersHorizontal, X } from '@lucide/vue'
import type { ImageStyleFilter } from '@vereinsfunk/contracts'
import { Cropper } from 'vue-advanced-cropper'
import type { BrandAssetCard } from '../composables/usePhotoWorkshopAssets'
import type { CropperController } from '../composables/usePhotoWorkshopHistory'
import { outputSizeError, type ImageDimensions } from '../utils/imageOutputDimensions'
import { canvasBlob, composeWorkshopImage, loadBlobImage, type LogoPosition } from '../utils/photoWorkshopCanvas'
import 'vue-advanced-cropper/dist/style.css'

const props = defineProps<{
  file: File
  organizationId: string
  departmentId: string | null
  frameAssets?: BrandAssetCard[]
  logoAssets?: BrandAssetCard[]
}>()
const emit = defineEmits<{ save: [file: File]; cancel: [] }>()

type EditorTool = 'crop' | 'filters' | 'resize' | 'frame' | 'logo'

const cropper = ref<CropperController | null>(null)
const sourceUrl = ref('')
const cropperKey = ref(0)
const skipOrientationCheck = ref(false)
const croppedPreviewUrl = ref('')
const sourceWidth = ref(0)
const sourceHeight = ref(0)
const croppedWidth = ref(0)
const croppedHeight = ref(0)
const aspectRatio = ref<number | undefined>(undefined)
const activeTool = ref<EditorTool>('crop')
const exporting = ref(false)
const exportError = ref('')
const logoPosition = ref<LogoPosition>('bottom_right')
let previewRenderRun = 0

const TOOLS: { id: EditorTool; label: string; icon: typeof Crop }[] = [
  { id: 'crop', label: 'Zuschnitt', icon: Crop },
  { id: 'filters', label: 'Filter', icon: SlidersHorizontal },
  { id: 'resize', label: 'Resize', icon: Maximize2 },
  { id: 'frame', label: 'Rahmen', icon: Frame },
  { id: 'logo', label: 'Logo', icon: Image },
]
const LOGO_POSITION_LABELS: Record<LogoPosition, string> = {
  top_left: 'Oben links', top_right: 'Oben rechts', bottom_left: 'Unten links', bottom_right: 'Unten rechts',
}
const logoPositionClass: Record<LogoPosition, string> = {
  top_left: 'left-[4%] top-[4%]',
  top_right: 'right-[4%] top-[4%]',
  bottom_left: 'bottom-[4%] left-[4%]',
  bottom_right: 'bottom-[4%] right-[4%]',
}

function cropDimensions(): ImageDimensions {
  const result = cropper.value?.getResult()
  return result?.coordinates.width && result.coordinates.height
    ? { width: Math.round(result.coordinates.width), height: Math.round(result.coordinates.height) }
    : croppedWidth.value && croppedHeight.value
      ? { width: croppedWidth.value, height: croppedHeight.value }
    : { width: sourceWidth.value, height: sourceHeight.value }
}
function cropSourceKey() {
  const result = cropper.value?.getResult()
  return result ? JSON.stringify([result.coordinates, result.image.transforms]) : ''
}

const { frames, logos, selectedFrameId, selectedLogoId, selectedFrame, selectedLogo, loadingAssets, assetError } =
  usePhotoWorkshopAssets(props)
const {
  outputWidth, outputHeight, keepAspectRatio, outputDimensionsLabel,
  setOutputDimensions, resetOutputDimensions, followCrop, updateOutputWidth, updateOutputHeight,
} = useOutputDimensions({ cropDimensions, error: exportError })
const restoringHistory = ref(false)
const filters = useGmicFilterPreviews({
  organizationId: () => props.organizationId,
  departmentId: () => props.departmentId,
  croppedCanvas: () => cropper.value?.getResult().canvas,
  cropSourceKey,
  isFilterToolActive: () => activeTool.value === 'filters',
  isCropToolActive: () => activeTool.value === 'crop',
  isRestoringHistory: () => restoringHistory.value,
})
const { selectedFilter, filteredPreviewUrl, filterThumbnailUrls, filterThumbnailStatuses, applyingFilter, filterError, workshopFilters } = filters
const { undoHistory, redoHistory, startHistoryGroup, finishHistoryGroup, recordEdit, clearHistory, undo, redo } =
  usePhotoWorkshopHistory({
    cropper,
    restoring: restoringHistory,
    fields: { aspectRatio, outputWidth, outputHeight, keepAspectRatio, selectedFilter, selectedFrameId, selectedLogoId, logoPosition },
    onGroupFinished: () => filters.scheduleFilterThumbnails(),
    onBeforeRestore: filters.cancelFilterPreview,
    onRestored: (controller, filter) => {
      updateCroppedPreview(controller.getResult().canvas)
      filters.markFilterThumbnailsDirty()
      filters.scheduleFilterThumbnails()
      if (filter === 'original') {
        filters.cancelFilterPreview()
        filters.clearFilteredPreview()
      } else {
        void filters.refreshFilterPreview()
      }
    },
  })

const displayedPreviewUrl = computed(() =>
  selectedFilter.value !== 'original' && filteredPreviewUrl.value
    ? filteredPreviewUrl.value
    : croppedPreviewUrl.value,
)
const cropperStencilProps = computed(() => ({
  ...(aspectRatio.value ? { aspectRatio: aspectRatio.value } : {}),
  movable: activeTool.value === 'crop',
  resizable: activeTool.value === 'crop',
}))
function defaultCropSize({ imageSize }: { imageSize: ImageDimensions }) {
  return { width: imageSize.width, height: imageSize.height }
}
const sourceDimensions = computed(() =>
  sourceWidth.value && sourceHeight.value
    ? `${sourceWidth.value} × ${sourceHeight.value} px`
    : 'Bild wird geladen …',
)
const cropDimensionsLabel = computed(() => {
  const dimensions = cropDimensions()
  return dimensions.width && dimensions.height ? `${dimensions.width} × ${dimensions.height} px` : ''
})

function updateSourceUrl(file: File) {
  const previousUrl = sourceUrl.value
  sourceUrl.value = URL.createObjectURL(file)
  if (previousUrl) URL.revokeObjectURL(previousUrl)
  if (croppedPreviewUrl.value) URL.revokeObjectURL(croppedPreviewUrl.value)
  croppedPreviewUrl.value = ''
  filters.resetForNewSource()
  clearHistory()
  skipOrientationCheck.value = false
  cropperKey.value += 1
  const image = new window.Image()
  image.onload = () => {
    if (image.src !== sourceUrl.value) return
    sourceWidth.value = image.naturalWidth
    sourceHeight.value = image.naturalHeight
    croppedWidth.value = image.naturalWidth
    croppedHeight.value = image.naturalHeight
    resetOutputDimensions()
  }
  image.src = sourceUrl.value
}

function updateCroppedPreview(canvas?: HTMLCanvasElement) {
  if (!canvas) return
  const renderRun = ++previewRenderRun
  canvasBlob(canvas, 1600, 0.9).then((blob) => {
    if (renderRun !== previewRenderRun) return
    const previousUrl = croppedPreviewUrl.value
    croppedPreviewUrl.value = URL.createObjectURL(blob)
    if (previousUrl) URL.revokeObjectURL(previousUrl)
  }, () => {})
}

function onCropChange(result: {
  coordinates?: { width: number; height: number }
  canvas?: HTMLCanvasElement
}) {
  const coordinates = result.coordinates
  if (!coordinates?.width || !coordinates.height) return
  croppedWidth.value = Math.round(coordinates.width)
  croppedHeight.value = Math.round(coordinates.height)
  followCrop(croppedWidth.value, croppedHeight.value)
  updateCroppedPreview(result.canvas)
  filters.markFilterThumbnailsDirty()
  filters.scheduleFilterThumbnails()
  filters.refreshChangedFilterPreview()
}

function onCropperReady() {
  // Der Cropper kann das Bild laden, bevor sein Grid-Container nach dem Einblenden seine
  // endgültige Größe hat. Ein Frame später berechnet refresh() Grenzen und Bildposition mit
  // der tatsächlichen Vorschaugröße neu.
  requestAnimationFrame(() => {
    cropper.value?.refresh()
    updateCroppedPreview(cropper.value?.getResult().canvas)
    filters.markFilterThumbnailsDirty()
    filters.scheduleFilterThumbnails()
  })
}

function onCropperError() {
  // Manche Browser liefern Kamera-EXIF nicht über die Blob-URL an den Orientierungsparser der
  // Bibliothek. Der zweite, bewusst neu gemountete Versuch lädt dann das Browserbild direkt;
  // der Editor bleibt damit auch für solche Fotos bedienbar.
  if (!skipOrientationCheck.value) {
    skipOrientationCheck.value = true
    cropperKey.value += 1
    return
  }
  exportError.value = 'Das ausgewählte Bild konnte nicht geladen werden.'
}

function rotate(angle: number) {
  recordEdit()
  cropper.value?.rotate(angle)
}
function flip(horizontal: boolean, vertical: boolean) {
  recordEdit()
  cropper.value?.flip(horizontal, vertical)
}
function reset() {
  recordEdit()
  cropper.value?.reset()
  aspectRatio.value = undefined
  filters.cancelFilterPreview()
  selectedFilter.value = 'original'
  resetOutputDimensions()
  selectedFrameId.value = null
  selectedLogoId.value = null
  logoPosition.value = 'bottom_right'
  exportError.value = ''
}
function selectAspectRatio(value: number | undefined) {
  if (aspectRatio.value === value) return
  recordEdit()
  aspectRatio.value = value
}
async function selectFilter(filter: ImageStyleFilter) {
  if (selectedFilter.value === filter) return
  recordEdit()
  await filters.applyFilter(filter)
}
function selectFrame(frameId: string | null) {
  if (selectedFrameId.value === frameId) return
  recordEdit()
  selectedFrameId.value = frameId
}
function selectLogo(logoId: string | null) {
  if (selectedLogoId.value === logoId) return
  recordEdit()
  selectedLogoId.value = logoId
}
function selectLogoPosition(position: LogoPosition) {
  if (logoPosition.value === position) return
  recordEdit()
  logoPosition.value = position
}
function toggleAspectRatioLock() {
  recordEdit()
  keepAspectRatio.value = !keepAspectRatio.value
}
function selectTool(tool: EditorTool) {
  activeTool.value = tool
  filters.refreshChangedFilterPreview()
  if (tool === 'resize' && (!outputWidth.value || !outputHeight.value))
    setOutputDimensions(cropDimensions())
  if (tool === 'filters') filters.scheduleFilterThumbnails(0)
}
async function save() {
  const croppedCanvas = cropper.value?.getResult().canvas
  if (!croppedCanvas) {
    exportError.value = 'Der Bildausschnitt ist noch nicht bereit.'
    return
  }
  const dimensions = {
    width: outputWidth.value || croppedCanvas.width,
    height: outputHeight.value || croppedCanvas.height,
  }
  const sizeError = outputSizeError(dimensions)
  if (sizeError) {
    exportError.value = sizeError
    return
  }
  exporting.value = true
  exportError.value = ''
  try {
    const type = props.file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob = await composeWorkshopImage({
      image: selectedFilter.value === 'original'
        ? croppedCanvas
        : await loadBlobImage(await filters.renderGmicFilter(croppedCanvas)),
      ...dimensions,
      frameUrl: selectedFrame.value?.signedUrl ?? null,
      logoUrl: selectedLogo.value?.signedUrl ?? null,
      logoPosition: logoPosition.value,
      type,
    })
    const filename = props.file.name.replace(/\.[^.]+$/, type === 'image/png' ? '.png' : '.jpg')
    emit('save', new File([blob], filename, { type, lastModified: Date.now() }))
  } catch {
    exportError.value = 'Das bearbeitete Bild konnte nicht erstellt werden.'
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  updateSourceUrl(props.file)
})
watch(() => props.file, updateSourceUrl)
watch(aspectRatio, async () => {
  await nextTick()
  cropper.value?.refresh()
})
onBeforeUnmount(() => {
  previewRenderRun += 1
  if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
  if (croppedPreviewUrl.value) URL.revokeObjectURL(croppedPreviewUrl.value)
})
</script>

<template>
  <section class="flex min-h-[680px] w-full flex-col overflow-hidden rounded-xl border border-[#e9ebe4] bg-white" aria-labelledby="photo-workshop-title">
      <header class="flex shrink-0 items-center justify-between gap-3 border-b border-[#e9ebe4] px-4 py-3 sm:px-6">
        <div class="min-w-0"><h2 id="photo-workshop-title" class="font-display text-base font-bold sm:text-lg">Bildwerkstatt</h2><p class="hidden text-xs text-[#727a75] sm:block">Zuschnitt, Bildstil, Rahmen und Vereinslogo vor dem privaten Upload.</p></div>
        <span class="hidden text-sm font-medium text-[#84909c] md:block">{{ sourceDimensions }}</span>
        <div class="flex items-center gap-2"><button type="button" :disabled="!undoHistory.length || restoringHistory" class="focus-ring hidden rounded-lg px-3 py-2 text-xs font-semibold text-[#5c655f] hover:bg-[#f4f6f2] disabled:cursor-not-allowed disabled:opacity-45 sm:block" @click="undo">Schritt zurück</button><button type="button" :disabled="!redoHistory.length || restoringHistory" class="focus-ring hidden rounded-lg px-3 py-2 text-xs font-semibold text-[#5c655f] hover:bg-[#f4f6f2] disabled:cursor-not-allowed disabled:opacity-45 sm:block" @click="redo">Schritt vor</button><button type="button" class="focus-ring hidden rounded-lg px-3 py-2 text-xs font-semibold text-[#5c655f] hover:bg-[#f4f6f2] sm:block" @click="reset">Alles zurücksetzen</button><button type="button" class="focus-ring rounded-lg p-2 text-[#5c655f] hover:bg-[#f4f6f2]" aria-label="Editor schließen" @click="emit('cancel')"><X :size="19" /></button></div>
      </header>

      <div class="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[112px_minmax(0,1fr)] lg:grid-rows-1">
        <nav class="min-w-0 max-w-full overflow-x-auto overscroll-x-contain border-b border-[#e9ebe4] bg-white px-2 py-2 [scrollbar-width:thin] lg:max-w-none lg:overflow-x-hidden lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-2 lg:py-4" aria-label="Bildbearbeitung">
          <div class="flex w-max min-w-full lg:w-full lg:min-w-0 lg:flex-col">
            <button v-for="tool in TOOLS" :key="tool.id" type="button" class="focus-ring flex min-w-[5.5rem] shrink-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[10px] font-semibold sm:text-[11px] lg:min-w-0 lg:flex-none lg:py-3" :class="activeTool === tool.id ? 'bg-[#e8efff] text-[#3754c8]' : 'text-[#52606d] hover:bg-[#f4f6f2]'" @click="selectTool(tool.id)"><component :is="tool.icon" :size="21" stroke-width="1.7" /><span>{{ tool.label }}</span></button>
          </div>
        </nav>

        <div class="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] bg-[#f7f8f6]">
          <main class="relative flex h-[min(52vh,34rem)] min-h-72 items-center justify-center p-3 sm:p-6">
            <div class="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-[#edf0ec] p-3 sm:p-5">
              <img v-if="activeTool !== 'crop' && displayedPreviewUrl" class="absolute inset-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] object-contain sm:inset-5 sm:h-[calc(100%-2.5rem)] sm:w-[calc(100%-2.5rem)]" :src="displayedPreviewUrl" alt="Vorschau des zugeschnittenen Bildes" />
              <div v-if="applyingFilter" class="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center gap-2 rounded-xl bg-white/55 text-[#163a2c] backdrop-blur-[1px] sm:inset-5" role="status" aria-live="polite">
                <LoaderCircle class="animate-spin" :size="28" aria-hidden="true" />
                <span class="rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold shadow-sm">Filter wird angewendet …</span>
              </div>
              <div class="absolute inset-3 min-h-0 min-w-0 sm:inset-5" @pointerdown.capture="activeTool === 'crop' && startHistoryGroup()" @pointerup.capture="activeTool === 'crop' && finishHistoryGroup()" @pointercancel.capture="activeTool === 'crop' && finishHistoryGroup()">
                <Cropper :key="cropperKey" ref="cropper" class="photo-workshop-cropper h-full w-full" :class="{ 'photo-workshop-cropper--inactive': activeTool !== 'crop' }" :src="sourceUrl" :stencil-props="cropperStencilProps" :default-size="defaultCropSize" :canvas="true" :check-orientation="!skipOrientationCheck" :debounce="100" default-boundaries="fit" image-restriction="fit-area" @ready="onCropperReady" @error="onCropperError" @change="onCropChange" />
              </div>
              <img v-if="selectedFrame" class="pointer-events-none absolute inset-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] object-fill sm:inset-5 sm:h-[calc(100%-2.5rem)] sm:w-[calc(100%-2.5rem)]" :src="selectedFrame.signedUrl" alt="" aria-hidden="true" />
              <img v-if="selectedLogo" class="pointer-events-none absolute z-10 h-auto w-[16%] max-w-32 object-contain drop-shadow-sm" :class="logoPositionClass[logoPosition]" :src="selectedLogo.signedUrl" alt="" aria-hidden="true" />
            </div>
            <p class="absolute bottom-5 left-1/2 hidden -translate-x-1/2 rounded-full bg-[#122820]/70 px-3 py-1.5 text-[10px] font-medium text-white sm:block">Live-Vorschau · {{ outputDimensionsLabel }}</p>
          </main>

          <section class="max-h-64 overflow-y-auto border-t border-[#e9ebe4] bg-white px-4 py-4 sm:px-6" aria-live="polite">
            <PhotoWorkshopCropPanel v-if="activeTool === 'crop'" :aspect-ratio="aspectRatio" :crop-dimensions-label="cropDimensionsLabel" @select-aspect-ratio="selectAspectRatio" @rotate="rotate" @flip="flip" />
            <PhotoWorkshopFilterPanel v-else-if="activeTool === 'filters'" :filters="workshopFilters" :selected-filter="selectedFilter" :original-preview-url="croppedPreviewUrl || sourceUrl" :filter-thumbnail-urls="filterThumbnailUrls" :filter-thumbnail-statuses="filterThumbnailStatuses" :applying-filter="applyingFilter" :filter-error="filterError" @select="selectFilter" />
            <PhotoWorkshopResizePanel v-else-if="activeTool === 'resize'" :output-width="outputWidth" :output-height="outputHeight" :keep-aspect-ratio="keepAspectRatio" :output-dimensions-label="outputDimensionsLabel" @edit-start="startHistoryGroup" @edit-end="finishHistoryGroup" @update-width="updateOutputWidth" @update-height="updateOutputHeight" @toggle-aspect-ratio-lock="toggleAspectRatioLock" />
            <PhotoWorkshopAssetPanel v-else-if="activeTool === 'frame'" kind="frame" :assets="frames" :selected-id="selectedFrameId" :loading="loadingAssets" @select="selectFrame" />
            <PhotoWorkshopAssetPanel v-else kind="logo" :assets="logos" :selected-id="selectedLogoId" :loading="loadingAssets" @select="selectLogo"><div v-if="selectedLogo" class="flex flex-wrap gap-2"><button v-for="(label, position) in LOGO_POSITION_LABELS" :key="position" type="button" class="focus-ring rounded-lg px-3 py-2 text-xs font-semibold" :class="logoPosition === position ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectLogoPosition(position)">{{ label }}</button></div></PhotoWorkshopAssetPanel>
            <p v-if="assetError || exportError" class="mt-3 text-xs text-red-700">{{ assetError || exportError }}</p>
          </section>
        </div>
      </div>
      <footer class="flex shrink-0 items-center justify-between gap-3 border-t border-[#e9ebe4] bg-white px-4 py-3 sm:px-6"><button type="button" class="focus-ring text-xs font-semibold text-[#5c655f] underline" @click="emit('cancel')">Abbrechen</button><button type="button" :disabled="exporting" class="focus-ring inline-flex items-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60" @click="save"><Check :size="15" />{{ exporting ? 'Wird übernommen …' : 'Foto übernehmen' }}</button></footer>
  </section>
</template>

<style scoped>
:deep(.photo-workshop-cropper.vue-advanced-cropper) { background: transparent; }

/*
 * Der Cropper muss für den Export gemountet bleiben, auch wenn ein anderes Werkzeug
 * aktiv ist. Seine Stencil-Ebene darf dann aber weder die Vorschau abdunkeln noch
 * Eingaben abfangen. Beim Zurückwechseln zu "Zuschnitt" wird sie ohne Neuladen des
 * Bildes wieder eingeblendet.
 */
:deep(.photo-workshop-cropper--inactive.vue-advanced-cropper) {
  pointer-events: none;
  visibility: hidden;
}

/* Außerhalb des Auswahlrahmens bleibt beim Zuschneiden kein Bildinhalt sichtbar. */
:deep(.photo-workshop-cropper.vue-advanced-cropper .vue-advanced-cropper__foreground) {
  opacity: 1;
}
</style>
