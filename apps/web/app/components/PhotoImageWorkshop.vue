<script setup lang="ts">
import {
  Check,
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  Frame,
  Image,
  Lock,
  Maximize2,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Unlock,
  X,
} from '@lucide/vue'
import type { ImageStyleFilter } from '@vereinsfunk/contracts'
import { Cropper } from 'vue-advanced-cropper'
import {
  fetchBrandAssets,
  type BrandLevelOverride,
  type BrandOrganizationState,
  type BrandScopeLevel,
  useBrandAssets,
} from '../composables/useBrandAssets'
import {
  MAX_OUTPUT_DIMENSION,
  outputSizeError,
  readOutputDimension,
  type ImageDimensions,
} from '~/utils/imageOutputDimensions'
import {
  cssFilterForImageStyle,
  IMAGE_STYLE_FILTER_OPTIONS,
} from '~/utils/imageStyleFilterCatalog'
import 'vue-advanced-cropper/dist/style.css'

const props = defineProps<{
  file: File
  organizationId: string
  departmentId: string | null
  frameAssets?: BrandAsset[]
  logoAssets?: BrandAsset[]
}>()
const emit = defineEmits<{ save: [file: File]; cancel: [] }>()

type EditorTool = 'crop' | 'filters' | 'resize' | 'frame' | 'logo'
type CropperController = {
  getResult: () => {
    canvas?: HTMLCanvasElement
    coordinates: { width: number; height: number }
  }
  rotate: (angle: number) => void
  flip: (horizontal: boolean, vertical: boolean) => void
  reset: () => void
  refresh: () => void
}
type BrandAsset = { id: string; name: string; signedUrl: string }
type LogoPosition = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right'

const supabase = useSupabaseClient()
const api = useApiClient()
const cropper = ref<CropperController | null>(null)
const sourceUrl = ref('')
const sourceWidth = ref(0)
const sourceHeight = ref(0)
const croppedWidth = ref(0)
const croppedHeight = ref(0)
const aspectRatio = ref<number | undefined>(undefined)
const activeTool = ref<EditorTool>('crop')
const exporting = ref(false)
const exportError = ref('')
const selectedFilter = ref<ImageStyleFilter>('original')
const outputWidth = ref(0)
const outputHeight = ref(0)
const keepAspectRatio = ref(true)
const loadingAssets = ref(false)
const assetError = ref('')
const selectedFrameId = ref<string | null>(null)
const selectedLogoId = ref<string | null>(null)
const logoPosition = ref<LogoPosition>('bottom_right')
let latestAssetLoadRun = 0
const organizationId = computed(() => props.organizationId || null)
const hasProvidedAssetLibrary = computed(
  () => props.frameAssets !== undefined || props.logoAssets !== undefined,
)
const activeLevel = computed<BrandScopeLevel>(() =>
  props.departmentId ? 'department' : 'organization',
)
const activeDepartmentId = computed(() => props.departmentId)
const activeTeamId = computed(() => null)
const noBrandOverride = computed<BrandLevelOverride | null>(() => null)
const workshopBrand = reactive<BrandOrganizationState>({
  primaryColor: '#163a2c',
  accentColor: '#caff4a',
  backgroundColor: '#f6f4ec',
  textColor: '#122820',
  onPrimaryColor: '#ffffff',
  displayFontKey: 'manrope',
  bodyFontKey: 'dm_sans',
  displayFontAssetId: null,
  bodyFontAssetId: null,
  logoAssetId: null,
  websiteUrl: null,
  allowDepartmentOverrides: false,
  lockedFields: [],
})

const ASPECT_RATIOS: { label: string; value: number | undefined }[] = [
  { label: 'Frei', value: undefined },
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
]
const TOOLS: { id: EditorTool; label: string; icon: typeof Crop }[] = [
  { id: 'crop', label: 'Zuschnitt', icon: Crop },
  { id: 'filters', label: 'Filter', icon: SlidersHorizontal },
  { id: 'resize', label: 'Resize', icon: Maximize2 },
  { id: 'frame', label: 'Rahmen', icon: Frame },
  { id: 'logo', label: 'Logo', icon: Image },
]
async function loadBrandAssets() {
  const loadRun = ++latestAssetLoadRun
  const requestedOrganizationId = organizationId.value
  const requestedDepartmentId = activeDepartmentId.value
  selectedFrameId.value = null
  selectedLogoId.value = null
  assets.value = []
  if (!requestedOrganizationId || import.meta.server) {
    loadingAssets.value = false
    return
  }
  loadingAssets.value = true
  assetError.value = ''
  try {
    const loadedAssets = await fetchBrandAssets({ supabase, organizationId: requestedOrganizationId })
    if (
      loadRun !== latestAssetLoadRun ||
      requestedOrganizationId !== organizationId.value ||
      requestedDepartmentId !== activeDepartmentId.value
    )
      return
    assets.value = loadedAssets
    await signAssets()
  } catch {
    if (loadRun === latestAssetLoadRun)
      assetError.value = 'Rahmen und Logos konnten nicht geladen werden.'
  } finally {
    if (loadRun === latestAssetLoadRun) loadingAssets.value = false
  }
}
const { assets, assetSignedUrls, selectableFrameAssets, selectableLogoAssets, signAssets } =
  useBrandAssets({
    api,
    supabase,
    organizationId,
    org: workshopBrand,
    activeLevel,
    activeDepartmentId,
    activeTeamId,
    activeDepartmentOverride: noBrandOverride,
    activeTeamOverride: noBrandOverride,
    reload: loadBrandAssets,
  })
function selectableAssetsToCards(list: typeof selectableFrameAssets.value): BrandAsset[] {
  return list.flatMap((asset) => {
    const signedUrl = assetSignedUrls.value[asset.id]
    return signedUrl
      ? [{ id: asset.id, name: asset.objectPath.split('/').at(-1) || asset.kind, signedUrl }]
      : []
  })
}
// Die Bildstil-Seite hat die sichtbaren, signierten Brand Assets bereits geladen. Diese Liste
// direkt weiterzugeben vermeidet einen zweiten asynchronen Abruf, durch den die Rahmenkacheln
// beim Oeffnen der Werkstatt bislang leer bleiben konnten. Beim Foto-Anhang ohne diese Props
// bleibt der mandantensichere Fallback ueber useBrandAssets bestehen.
const frames = computed(() => props.frameAssets ?? selectableAssetsToCards(selectableFrameAssets.value))
const logos = computed(() => props.logoAssets ?? selectableAssetsToCards(selectableLogoAssets.value))
const currentFilterCss = computed(() => cssFilterForImageStyle(selectedFilter.value))
const selectedFrame = computed(
  () => frames.value.find((frame) => frame.id === selectedFrameId.value) ?? null,
)
const selectedLogo = computed(
  () => logos.value.find((logo) => logo.id === selectedLogoId.value) ?? null,
)
const sourceDimensions = computed(() =>
  sourceWidth.value && sourceHeight.value
    ? `${sourceWidth.value} × ${sourceHeight.value} px`
    : 'Bild wird geladen …',
)
const logoPositionClass = computed<Record<LogoPosition, string>>(() => ({
  top_left: 'left-[4%] top-[4%]',
  top_right: 'right-[4%] top-[4%]',
  bottom_left: 'bottom-[4%] left-[4%]',
  bottom_right: 'bottom-[4%] right-[4%]',
}))

function cropDimensions(): ImageDimensions {
  const result = cropper.value?.getResult()
  return result?.coordinates.width && result.coordinates.height
    ? { width: Math.round(result.coordinates.width), height: Math.round(result.coordinates.height) }
    : croppedWidth.value && croppedHeight.value
      ? { width: croppedWidth.value, height: croppedHeight.value }
    : { width: sourceWidth.value, height: sourceHeight.value }
}
const cropDimensionsLabel = computed(() => {
  const dimensions = cropDimensions()
  return dimensions.width && dimensions.height ? `${dimensions.width} × ${dimensions.height} px` : ''
})
const outputDimensionsLabel = computed(() => {
  const dimensions = cropDimensions()
  return `${outputWidth.value || dimensions.width} × ${outputHeight.value || dimensions.height} px`
})
function setOutputDimensions(dimensions: ImageDimensions) {
  const error = outputSizeError(dimensions)
  if (error) {
    exportError.value = error
    return false
  }
  outputWidth.value = dimensions.width
  outputHeight.value = dimensions.height
  exportError.value = ''
  return true
}
function updateSourceUrl(file: File) {
  const previousUrl = sourceUrl.value
  sourceUrl.value = URL.createObjectURL(file)
  if (previousUrl) URL.revokeObjectURL(previousUrl)
  const image = new window.Image()
  image.onload = () => {
    if (image.src !== sourceUrl.value) return
    sourceWidth.value = image.naturalWidth
    sourceHeight.value = image.naturalHeight
    croppedWidth.value = image.naturalWidth
    croppedHeight.value = image.naturalHeight
    outputWidth.value = 0
    outputHeight.value = 0
  }
  image.src = sourceUrl.value
}

function onCropChange(result: { coordinates?: { width: number; height: number } }) {
  const coordinates = result.coordinates
  if (!coordinates?.width || !coordinates.height) return
  croppedWidth.value = Math.round(coordinates.width)
  croppedHeight.value = Math.round(coordinates.height)
}

function rotate(angle: number) {
  cropper.value?.rotate(angle)
}
function flip(horizontal: boolean, vertical: boolean) {
  cropper.value?.flip(horizontal, vertical)
}
function reset() {
  cropper.value?.reset()
  aspectRatio.value = undefined
  selectedFilter.value = 'original'
  outputWidth.value = 0
  outputHeight.value = 0
  selectedFrameId.value = null
  selectedLogoId.value = null
  logoPosition.value = 'bottom_right'
  exportError.value = ''
}
function selectTool(tool: EditorTool) {
  activeTool.value = tool
  if (tool === 'resize' && (!outputWidth.value || !outputHeight.value))
    setOutputDimensions(cropDimensions())
}
function updateOutputWidth(value: string) {
  const width = readOutputDimension(value)
  if (!width) {
    exportError.value = 'Die Breite muss eine positive Zahl sein.'
    return
  }
  const dimensions = cropDimensions()
  const height = keepAspectRatio.value
    ? Math.max(1, Math.round((width * dimensions.height) / dimensions.width))
    : outputHeight.value
  if (height) setOutputDimensions({ width, height })
}
function updateOutputHeight(value: string) {
  const height = readOutputDimension(value)
  if (!height) {
    exportError.value = 'Die Höhe muss eine positive Zahl sein.'
    return
  }
  const dimensions = cropDimensions()
  const width = keepAspectRatio.value
    ? Math.max(1, Math.round((height * dimensions.width) / dimensions.height))
    : outputWidth.value
  if (width) setOutputDimensions({ width, height })
}
async function loadCanvasImage(url: string): Promise<HTMLImageElement> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('asset_download_failed')
  const objectUrl = URL.createObjectURL(await response.blob())
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = objectUrl
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
function drawLogo(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const margin = Math.round(Math.min(width, height) * 0.04)
  const logoWidth = Math.max(1, Math.round(width * 0.16))
  const logoHeight = Math.max(1, Math.round((logoWidth * image.naturalHeight) / image.naturalWidth))
  const x = logoPosition.value.endsWith('right') ? width - margin - logoWidth : margin
  const y = logoPosition.value.startsWith('bottom') ? height - margin - logoHeight : margin
  context.drawImage(image, x, y, logoWidth, logoHeight)
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
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas_unavailable')
    context.filter = currentFilterCss.value || 'none'
    context.drawImage(croppedCanvas, 0, 0, canvas.width, canvas.height)
    context.filter = 'none'
    if (selectedFrame.value) {
      const frame = await loadCanvasImage(selectedFrame.value.signedUrl)
      context.drawImage(frame, 0, 0, canvas.width, canvas.height)
    }
    if (selectedLogo.value) drawLogo(context, await loadCanvasImage(selectedLogo.value.signedUrl), canvas.width, canvas.height)
    const type = props.file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92))
    if (!blob) throw new Error('image_export_failed')
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
  if (!hasProvidedAssetLibrary.value) void loadBrandAssets()
})
watch(() => props.file, updateSourceUrl)
watch([() => props.organizationId, () => props.departmentId], () => {
  if (!hasProvidedAssetLibrary.value) void loadBrandAssets()
})
watch(aspectRatio, async () => {
  await nextTick()
  cropper.value?.refresh()
})
onBeforeUnmount(() => {
  if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
})
</script>

<template>
  <section class="flex min-h-[680px] w-full flex-col overflow-hidden rounded-xl border border-[#e9ebe4] bg-white" aria-labelledby="photo-workshop-title">
      <header class="flex shrink-0 items-center justify-between gap-3 border-b border-[#e9ebe4] px-4 py-3 sm:px-6">
        <div class="min-w-0"><h2 id="photo-workshop-title" class="font-display text-base font-bold sm:text-lg">Bildwerkstatt</h2><p class="hidden text-xs text-[#727a75] sm:block">Zuschnitt, Bildstil, Rahmen und Vereinslogo vor dem privaten Upload.</p></div>
        <span class="hidden text-sm font-medium text-[#84909c] md:block">{{ sourceDimensions }}</span>
        <div class="flex items-center gap-2"><button type="button" class="focus-ring hidden rounded-lg px-3 py-2 text-xs font-semibold text-[#5c655f] hover:bg-[#f4f6f2] sm:block" @click="reset">Alles zurücksetzen</button><button type="button" class="focus-ring rounded-lg p-2 text-[#5c655f] hover:bg-[#f4f6f2]" aria-label="Editor schließen" @click="emit('cancel')"><X :size="19" /></button></div>
      </header>

      <div class="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[112px_minmax(0,1fr)] lg:grid-rows-1">
        <nav class="flex overflow-x-auto border-b border-[#e9ebe4] bg-white px-2 py-2 [scrollbar-width:thin] lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-2 lg:py-4" aria-label="Bildbearbeitung">
          <button v-for="tool in TOOLS" :key="tool.id" type="button" class="focus-ring flex min-w-[5.5rem] shrink-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[10px] font-semibold sm:text-[11px] lg:min-w-0 lg:flex-none lg:py-3" :class="activeTool === tool.id ? 'bg-[#e8efff] text-[#3754c8]' : 'text-[#52606d] hover:bg-[#f4f6f2]'" @click="selectTool(tool.id)"><component :is="tool.icon" :size="21" stroke-width="1.7" /><span>{{ tool.label }}</span></button>
        </nav>

        <div class="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] bg-[#f7f8f6]">
          <main class="relative flex min-h-[360px] items-center justify-center p-3 sm:p-6">
            <div class="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-[#edf0ec] p-3 sm:p-5">
              <Cropper ref="cropper" class="photo-workshop-cropper h-full w-full max-w-full" :style="{ filter: currentFilterCss || undefined }" :src="sourceUrl" :stencil-props="{ ...(aspectRatio ? { aspectRatio } : {}) }" :canvas="true" :check-orientation="true" image-restriction="fit-area" @change="onCropChange" />
              <img v-if="selectedFrame" class="pointer-events-none absolute inset-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] object-fill sm:inset-5 sm:h-[calc(100%-2.5rem)] sm:w-[calc(100%-2.5rem)]" :src="selectedFrame.signedUrl" alt="" aria-hidden="true" />
              <img v-if="selectedLogo" class="pointer-events-none absolute z-10 h-auto w-[16%] max-w-32 object-contain drop-shadow-sm" :class="logoPositionClass[logoPosition]" :src="selectedLogo.signedUrl" alt="" aria-hidden="true" />
            </div>
            <p class="absolute bottom-5 left-1/2 hidden -translate-x-1/2 rounded-full bg-[#122820]/70 px-3 py-1.5 text-[10px] font-medium text-white sm:block">Live-Vorschau · {{ outputDimensionsLabel }}</p>
          </main>

          <section class="max-h-64 overflow-y-auto border-t border-[#e9ebe4] bg-white px-4 py-4 sm:px-6" aria-live="polite">
            <div v-if="activeTool === 'crop'" class="space-y-3"><div><h3 class="text-sm font-bold">Zuschnitt</h3><p class="text-[11px] text-[#7a817c]">Ziehe den Bildausschnitt direkt in der Vorschau. Aktueller Ausschnitt: {{ cropDimensionsLabel }}.</p></div><div class="flex flex-wrap items-center gap-2"><button v-for="option in ASPECT_RATIOS" :key="option.label" type="button" class="focus-ring rounded-lg px-3 py-2 text-xs font-semibold" :class="aspectRatio === option.value ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="aspectRatio = option.value">{{ option.label }}</button><span class="hidden h-7 border-l border-[#dfe0d9] sm:block" /><button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]" aria-label="Nach links drehen" title="Nach links drehen" @click="rotate(-90)"><RotateCcw :size="17" /></button><button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]" aria-label="Nach rechts drehen" title="Nach rechts drehen" @click="rotate(90)"><RotateCw :size="17" /></button><button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]" aria-label="Horizontal spiegeln" title="Horizontal spiegeln" @click="flip(true, false)"><FlipHorizontal2 :size="17" /></button><button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]" aria-label="Vertikal spiegeln" title="Vertikal spiegeln" @click="flip(false, true)"><FlipVertical2 :size="17" /></button></div></div>

            <div v-else-if="activeTool === 'filters'" class="space-y-4"><div><h3 class="text-sm font-bold">Filter</h3><p class="text-[11px] text-[#7a817c]">Alle derzeit verfügbaren Bildfilter; die Auswahl wird in die Datei übernommen.</p></div><div v-for="group in ['Basis', 'G’MIC'] as const" :key="group"><h4 class="mb-2 text-[10px] font-bold uppercase tracking-[.12em] text-[#5b625d]">{{ group }}</h4><div class="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7"><button v-for="filter in IMAGE_STYLE_FILTER_OPTIONS.filter((item) => item.group === group)" :key="filter.value" type="button" class="focus-ring overflow-hidden rounded-lg p-1.5 text-left" :class="selectedFilter === filter.value ? 'bg-[#e8efff] text-[#3754c8]' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectedFilter = filter.value"><img :src="sourceUrl" alt="" aria-hidden="true" class="aspect-[4/3] w-full rounded object-cover" :style="{ filter: filter.cssFilter || undefined }" /><span class="mt-1 block truncate text-center text-[10px] font-semibold">{{ filter.label }}</span></button></div></div></div>

            <div v-else-if="activeTool === 'resize'" class="flex flex-wrap items-end gap-3"><div class="mr-2"><h3 class="text-sm font-bold">Bildgröße</h3><p class="text-[11px] text-[#7a817c]">Ausgabe: {{ outputDimensionsLabel }}. Das Bild wird beim Speichern skaliert.</p></div><label class="grid gap-1 text-xs font-semibold">Breite<input :value="outputWidth" class="w-28 rounded-lg border border-[#dfe0d9] px-2 py-2 text-sm" type="number" min="1" :max="MAX_OUTPUT_DIMENSION" @input="updateOutputWidth(($event.target as HTMLInputElement).value)" /></label><span class="mb-2 text-[#7a817c]">×</span><label class="grid gap-1 text-xs font-semibold">Höhe<input :value="outputHeight" class="w-28 rounded-lg border border-[#dfe0d9] px-2 py-2 text-sm" type="number" min="1" :max="MAX_OUTPUT_DIMENSION" @input="updateOutputHeight(($event.target as HTMLInputElement).value)" /></label><button type="button" class="focus-ring mb-0.5 inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-[#52606d] hover:bg-[#f4f6f2]" :aria-pressed="keepAspectRatio" @click="keepAspectRatio = !keepAspectRatio"><Lock v-if="keepAspectRatio" :size="15" /><Unlock v-else :size="15" /> Verhältnis {{ keepAspectRatio ? 'fix' : 'frei' }}</button><span class="pb-2 text-[11px] text-[#7a817c]">px</span></div>

            <div v-else-if="activeTool === 'frame'" class="space-y-3"><div><h3 class="text-sm font-bold">Rahmen</h3><p class="text-[11px] text-[#7a817c]">Wähle einen Rahmen aus euren hinterlegten Marken-Assets.</p></div><p v-if="loadingAssets" class="text-xs text-[#7a817c]">Rahmen werden geladen …</p><div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6"><button type="button" class="focus-ring rounded-lg p-2 text-left text-xs font-semibold" :class="selectedFrameId === null ? 'bg-[#e8efff] text-[#3754c8]' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectedFrameId = null"><span class="flex aspect-[4/3] items-center justify-center rounded border border-dashed border-current">Ohne Rahmen</span><span class="mt-1 block text-center">Keiner</span></button><button v-for="frame in frames" :key="frame.id" type="button" class="focus-ring overflow-hidden rounded-lg p-1.5 text-left text-xs font-semibold" :class="selectedFrameId === frame.id ? 'bg-[#e8efff] text-[#3754c8]' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectedFrameId = frame.id"><img :src="frame.signedUrl" :alt="`${frame.name} auswählen`" class="aspect-[4/3] w-full rounded object-fill" /><span class="mt-1 block truncate text-center">{{ frame.name }}</span></button></div><p v-if="!loadingAssets && !frames.length" class="text-xs text-[#7a817c]">Es sind noch keine Rahmen hinterlegt.</p></div>

            <div v-else class="space-y-3"><div><h3 class="text-sm font-bold">Logo</h3><p class="text-[11px] text-[#7a817c]">Logo wählen und an einer Ecke der Vorschau platzieren.</p></div><p v-if="loadingAssets" class="text-xs text-[#7a817c]">Logos werden geladen …</p><div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6"><button type="button" class="focus-ring rounded-lg p-2 text-left text-xs font-semibold" :class="selectedLogoId === null ? 'bg-[#e8efff] text-[#3754c8]' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectedLogoId = null"><span class="flex aspect-[4/3] items-center justify-center rounded border border-dashed border-current">Ohne Logo</span><span class="mt-1 block text-center">Keines</span></button><button v-for="logo in logos" :key="logo.id" type="button" class="focus-ring overflow-hidden rounded-lg p-1.5 text-left text-xs font-semibold" :class="selectedLogoId === logo.id ? 'bg-[#e8efff] text-[#3754c8]' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectedLogoId = logo.id"><img :src="logo.signedUrl" :alt="`${logo.name} auswählen`" class="aspect-[4/3] w-full rounded bg-[#dfe4dd] object-contain p-1" /><span class="mt-1 block truncate text-center">{{ logo.name }}</span></button></div><div v-if="selectedLogo" class="flex flex-wrap gap-2"><button v-for="position in (['top_left', 'top_right', 'bottom_left', 'bottom_right'] as const)" :key="position" type="button" class="focus-ring rounded-lg px-3 py-2 text-xs font-semibold" :class="logoPosition === position ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="logoPosition = position">{{ { top_left: 'Oben links', top_right: 'Oben rechts', bottom_left: 'Unten links', bottom_right: 'Unten rechts' }[position] }}</button></div><p v-if="!loadingAssets && !logos.length" class="text-xs text-[#7a817c]">Es sind noch keine Logos hinterlegt.</p></div>
            <p v-if="assetError || exportError" class="mt-3 text-xs text-red-700">{{ assetError || exportError }}</p>
          </section>
        </div>
      </div>
      <footer class="flex shrink-0 items-center justify-between gap-3 border-t border-[#e9ebe4] bg-white px-4 py-3 sm:px-6"><button type="button" class="focus-ring text-xs font-semibold text-[#5c655f] underline" @click="emit('cancel')">Abbrechen</button><button type="button" :disabled="exporting" class="focus-ring inline-flex items-center gap-2 rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60" @click="save"><Check :size="15" />{{ exporting ? 'Wird übernommen …' : 'Foto übernehmen' }}</button></footer>
  </section>
</template>

<style scoped>
.photo-workshop-cropper :deep(.vue-advanced-cropper) { background: transparent; }
</style>
