<script setup lang="ts">
import {
  Check,
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  Frame,
  Image,
  Lock,
  LoaderCircle,
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
    coordinates: { width: number; height: number; left: number; top: number }
    image: { transforms: { rotate: number; flip: { horizontal: boolean; vertical: boolean } } }
  }
  setCoordinates: (coordinates: { width: number; height: number; left: number; top: number }) => void
  rotate: (angle: number) => void
  flip: (horizontal: boolean, vertical: boolean) => void
  reset: () => void
  refresh: () => void
}
type BrandAsset = { id: string; name: string; signedUrl: string }
type LogoPosition = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right'
type CropState = {
  coordinates: { width: number; height: number; left: number; top: number }
  rotate: number
  flipHorizontal: boolean
  flipVertical: boolean
}
type EditorState = {
  crop: CropState | null
  aspectRatio: number | undefined
  outputWidth: number
  outputHeight: number
  keepAspectRatio: boolean
  selectedFilter: ImageStyleFilter
  selectedFrameId: string | null
  selectedLogoId: string | null
  logoPosition: LogoPosition
}

const supabase = useSupabaseClient()
const api = useApiClient()
const runtimeConfig = useRuntimeConfig()
const cropper = ref<CropperController | null>(null)
const sourceUrl = ref('')
const cropperKey = ref(0)
const skipOrientationCheck = ref(false)
const croppedPreviewUrl = ref('')
const filteredPreviewUrl = ref('')
const filterThumbnailUrls = ref<Partial<Record<ImageStyleFilter, string>>>({})
const filterThumbnailStatuses = ref<Partial<Record<ImageStyleFilter, 'loading' | 'unavailable'>>>({})
const sourceWidth = ref(0)
const sourceHeight = ref(0)
const croppedWidth = ref(0)
const croppedHeight = ref(0)
const aspectRatio = ref<number | undefined>(undefined)
const activeTool = ref<EditorTool>('crop')
const exporting = ref(false)
const exportError = ref('')
const selectedFilter = ref<ImageStyleFilter>('original')
const applyingFilter = ref(false)
const filterError = ref('')
const outputWidth = ref(0)
const outputHeight = ref(0)
const keepAspectRatio = ref(true)
const loadingAssets = ref(false)
const assetError = ref('')
const selectedFrameId = ref<string | null>(null)
const selectedLogoId = ref<string | null>(null)
const logoPosition = ref<LogoPosition>('bottom_right')
const undoHistory = ref<EditorState[]>([])
const redoHistory = ref<EditorState[]>([])
const historyGroupOpen = ref(false)
const restoringHistory = ref(false)
let previewRenderRun = 0
let filterPreviewRenderRun = 0
let latestAssetLoadRun = 0
let filterThumbnailRun = 0
const filterRequestController = new AbortController()
let filterThumbnailTimer: ReturnType<typeof setTimeout> | undefined
let filterThumbnailsDirty = true
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
const workshopFilters = computed(() =>
  IMAGE_STYLE_FILTER_OPTIONS.filter((option) => option.value === 'original' || option.group === 'G’MIC'),
)
const displayedPreviewUrl = computed(() =>
  selectedFilter.value !== 'original' && filteredPreviewUrl.value
    ? filteredPreviewUrl.value
    : croppedPreviewUrl.value,
)
const selectedFrame = computed(
  () => frames.value.find((frame) => frame.id === selectedFrameId.value) ?? null,
)
const selectedLogo = computed(
  () => logos.value.find((logo) => logo.id === selectedLogoId.value) ?? null,
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
  filterPreviewRenderRun += 1
  applyingFilter.value = false
  const previousUrl = sourceUrl.value
  sourceUrl.value = URL.createObjectURL(file)
  if (previousUrl) URL.revokeObjectURL(previousUrl)
  if (croppedPreviewUrl.value) URL.revokeObjectURL(croppedPreviewUrl.value)
  croppedPreviewUrl.value = ''
  if (filteredPreviewUrl.value) URL.revokeObjectURL(filteredPreviewUrl.value)
  filteredPreviewUrl.value = ''
  clearFilterThumbnailUrls()
  filterThumbnailsDirty = true
  selectedFilter.value = 'original'
  undoHistory.value = []
  redoHistory.value = []
  historyGroupOpen.value = false
  skipOrientationCheck.value = false
  cropperKey.value += 1
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

function updateCroppedPreview(canvas?: HTMLCanvasElement) {
  if (!canvas) return
  const renderRun = ++previewRenderRun
  const maxPreviewSide = 1600
  const scale = Math.min(1, maxPreviewSide / Math.max(canvas.width, canvas.height))
  const preview = document.createElement('canvas')
  preview.width = Math.max(1, Math.round(canvas.width * scale))
  preview.height = Math.max(1, Math.round(canvas.height * scale))
  preview.getContext('2d')?.drawImage(canvas, 0, 0, preview.width, preview.height)
  preview.toBlob((blob) => {
    if (!blob || renderRun !== previewRenderRun) return
    const previousUrl = croppedPreviewUrl.value
    croppedPreviewUrl.value = URL.createObjectURL(blob)
    if (previousUrl) URL.revokeObjectURL(previousUrl)
  }, 'image/jpeg', 0.9)
}

function canvasBlob(canvas: HTMLCanvasElement, maxSide?: number): Promise<Blob> {
  const scale = maxSide ? Math.min(1, maxSide / Math.max(canvas.width, canvas.height)) : 1
  const target = document.createElement('canvas')
  target.width = Math.max(1, Math.round(canvas.width * scale))
  target.height = Math.max(1, Math.round(canvas.height * scale))
  target.getContext('2d')?.drawImage(canvas, 0, 0, target.width, target.height)
  return new Promise((resolve, reject) => target.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('image_encoding_failed')),
    'image/jpeg',
    0.92,
  ))
}
async function loadBlobImage(blob: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(blob)
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
async function renderGmicFilterBlob(source: Blob, filter: ImageStyleFilter): Promise<Blob> {
  if (filter === 'original') return source
  const body = new FormData()
  body.append('organizationId', props.organizationId)
  if (props.departmentId) body.append('departmentId', props.departmentId)
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
function markFilterThumbnailsDirty() {
  filterThumbnailsDirty = true
  filterThumbnailRun += 1
  if (filterThumbnailTimer) clearTimeout(filterThumbnailTimer)
}
function scheduleFilterThumbnails(delay = 450) {
  if (activeTool.value !== 'filters' || !filterThumbnailsDirty) return
  if (filterThumbnailTimer) clearTimeout(filterThumbnailTimer)
  filterThumbnailTimer = setTimeout(() => {
    filterThumbnailTimer = undefined
    void refreshFilterThumbnails()
  }, delay)
}
async function refreshFilterThumbnails() {
  const canvas = cropper.value?.getResult().canvas
  if (!canvas || !filterThumbnailsDirty) return
  const run = ++filterThumbnailRun
  filterThumbnailsDirty = false
  clearFilterThumbnailUrls()
  const filters = workshopFilters.value.filter((filter) => filter.value !== 'original')
  filterThumbnailStatuses.value = Object.fromEntries(filters.map((filter) => [filter.value, 'loading']))
  let source: Blob
  try {
    source = await canvasBlob(canvas, 360)
  } catch {
    filterError.value = 'Die Filtervorschauen konnten nicht vorbereitet werden.'
    return
  }
  const queue = [...filters]
  const renderNext = async () => {
    while (queue.length) {
      const filter = queue.shift()
      if (!filter) return
      try {
        const url = URL.createObjectURL(await renderGmicFilterBlob(source, filter.value))
        if (run !== filterThumbnailRun) {
          URL.revokeObjectURL(url)
          return
        }
        filterThumbnailUrls.value = { ...filterThumbnailUrls.value, [filter.value]: url }
        const remainingStatuses = { ...filterThumbnailStatuses.value }
        delete remainingStatuses[filter.value]
        filterThumbnailStatuses.value = remainingStatuses
      } catch (error) {
        if (run !== filterThumbnailRun) return
        filterThumbnailStatuses.value = {
          ...filterThumbnailStatuses.value,
          [filter.value]: 'unavailable',
        }
        if (error instanceof Error && error.message === 'gmic_not_enabled')
          filterError.value = 'G’MIC ist auf dem Server nicht verfügbar.'
      }
    }
  }
  // Zwei parallele, kleine G’MIC-Prozesse liefern laufend Kacheln nach, ohne die API oder den
  // Editor während des Öffnens zu blockieren.
  await Promise.all([renderNext(), renderNext()])
}
async function refreshFilterPreview() {
  const canvas = cropper.value?.getResult().canvas
  const filter = selectedFilter.value
  if (!canvas || filter === 'original') return
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
    filterError.value = error instanceof Error && error.message === 'gmic_not_enabled'
      ? 'G’MIC ist auf dem Server nicht verfügbar.'
      : 'Der G’MIC-Filter konnte nicht gerendert werden.'
  } finally {
    if (renderRun === filterPreviewRenderRun) applyingFilter.value = false
  }
}

function onCropChange(result: {
  coordinates?: { width: number; height: number }
  canvas?: HTMLCanvasElement
}) {
  const coordinates = result.coordinates
  if (!coordinates?.width || !coordinates.height) return
  croppedWidth.value = Math.round(coordinates.width)
  croppedHeight.value = Math.round(coordinates.height)
  updateCroppedPreview(result.canvas)
  markFilterThumbnailsDirty()
  scheduleFilterThumbnails()
}

function onCropperReady() {
  // Der Cropper kann das Bild laden, bevor sein Grid-Container nach dem Einblenden seine
  // endgültige Größe hat. Ein Frame später berechnet refresh() Grenzen und Bildposition mit
  // der tatsächlichen Vorschaugröße neu.
  requestAnimationFrame(() => {
    cropper.value?.refresh()
    updateCroppedPreview(cropper.value?.getResult().canvas)
    markFilterThumbnailsDirty()
    scheduleFilterThumbnails()
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

function currentEditorState(): EditorState {
  const result = cropper.value?.getResult()
  return {
    crop: result
      ? {
          coordinates: { ...result.coordinates },
          rotate: result.image.transforms.rotate,
          flipHorizontal: result.image.transforms.flip.horizontal,
          flipVertical: result.image.transforms.flip.vertical,
        }
      : null,
    aspectRatio: aspectRatio.value,
    outputWidth: outputWidth.value,
    outputHeight: outputHeight.value,
    keepAspectRatio: keepAspectRatio.value,
    selectedFilter: selectedFilter.value,
    selectedFrameId: selectedFrameId.value,
    selectedLogoId: selectedLogoId.value,
    logoPosition: logoPosition.value,
  }
}
function startHistoryGroup() {
  if (restoringHistory.value || historyGroupOpen.value) return
  undoHistory.value.push(currentEditorState())
  if (undoHistory.value.length > 30) undoHistory.value.shift()
  redoHistory.value = []
  historyGroupOpen.value = true
}
function finishHistoryGroup() {
  historyGroupOpen.value = false
  if (selectedFilter.value !== 'original') void refreshFilterPreview()
  scheduleFilterThumbnails()
}
function recordEdit() {
  startHistoryGroup()
  finishHistoryGroup()
}
async function restoreEditorState(state: EditorState) {
  restoringHistory.value = true
  historyGroupOpen.value = false
  filterPreviewRenderRun += 1
  applyingFilter.value = false
  try {
    aspectRatio.value = state.aspectRatio
    outputWidth.value = state.outputWidth
    outputHeight.value = state.outputHeight
    keepAspectRatio.value = state.keepAspectRatio
    selectedFilter.value = state.selectedFilter
    selectedFrameId.value = state.selectedFrameId
    selectedLogoId.value = state.selectedLogoId
    logoPosition.value = state.logoPosition
    await nextTick()
    const controller = cropper.value
    if (!controller || !state.crop) return
    controller.reset()
    if (state.crop.rotate) controller.rotate(state.crop.rotate)
    if (state.crop.flipHorizontal || state.crop.flipVertical)
      controller.flip(state.crop.flipHorizontal, state.crop.flipVertical)
    controller.setCoordinates(state.crop.coordinates)
    await nextTick()
    controller.refresh()
    updateCroppedPreview(controller.getResult().canvas)
    markFilterThumbnailsDirty()
    scheduleFilterThumbnails()
    if (state.selectedFilter === 'original') {
      filterPreviewRenderRun += 1
      applyingFilter.value = false
      if (filteredPreviewUrl.value) URL.revokeObjectURL(filteredPreviewUrl.value)
      filteredPreviewUrl.value = ''
    } else {
      void refreshFilterPreview()
    }
  } finally {
    restoringHistory.value = false
  }
}
async function undo() {
  const previousState = undoHistory.value.pop()
  if (!previousState || restoringHistory.value) return
  redoHistory.value.push(currentEditorState())
  await restoreEditorState(previousState)
}
async function redo() {
  const nextState = redoHistory.value.pop()
  if (!nextState || restoringHistory.value) return
  undoHistory.value.push(currentEditorState())
  await restoreEditorState(nextState)
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
  filterPreviewRenderRun += 1
  applyingFilter.value = false
  selectedFilter.value = 'original'
  outputWidth.value = 0
  outputHeight.value = 0
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
  filterPreviewRenderRun += 1
  if (filteredPreviewUrl.value) URL.revokeObjectURL(filteredPreviewUrl.value)
  filteredPreviewUrl.value = ''
  selectedFilter.value = filter
  if (filter === 'original') {
    applyingFilter.value = false
    filterError.value = ''
    return
  }
  await refreshFilterPreview()
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
  if (tool === 'resize' && (!outputWidth.value || !outputHeight.value))
    setOutputDimensions(cropDimensions())
  if (tool === 'filters') scheduleFilterThumbnails(0)
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
    const filteredImage = selectedFilter.value === 'original'
      ? croppedCanvas
      : await loadBlobImage(await renderGmicFilter(croppedCanvas))
    context.drawImage(filteredImage, 0, 0, canvas.width, canvas.height)
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
  filterRequestController.abort()
  previewRenderRun += 1
  filterPreviewRenderRun += 1
  latestAssetLoadRun += 1
  filterThumbnailRun += 1
  if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
  if (croppedPreviewUrl.value) URL.revokeObjectURL(croppedPreviewUrl.value)
  if (filteredPreviewUrl.value) URL.revokeObjectURL(filteredPreviewUrl.value)
  if (filterThumbnailTimer) clearTimeout(filterThumbnailTimer)
  clearFilterThumbnailUrls()
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
              <div class="absolute inset-3 min-h-0 min-w-0 sm:inset-5" @pointerdown.capture="startHistoryGroup" @pointerup.capture="finishHistoryGroup" @pointercancel.capture="finishHistoryGroup">
                <Cropper :key="cropperKey" ref="cropper" class="photo-workshop-cropper h-full w-full" :class="{ 'photo-workshop-cropper--inactive': activeTool !== 'crop' }" :src="sourceUrl" :stencil-props="cropperStencilProps" :default-size="defaultCropSize" :canvas="true" :check-orientation="!skipOrientationCheck" :debounce="100" default-boundaries="fit" image-restriction="fit-area" @ready="onCropperReady" @error="onCropperError" @change="onCropChange" />
              </div>
              <img v-if="selectedFrame" class="pointer-events-none absolute inset-3 h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] object-fill sm:inset-5 sm:h-[calc(100%-2.5rem)] sm:w-[calc(100%-2.5rem)]" :src="selectedFrame.signedUrl" alt="" aria-hidden="true" />
              <img v-if="selectedLogo" class="pointer-events-none absolute z-10 h-auto w-[16%] max-w-32 object-contain drop-shadow-sm" :class="logoPositionClass[logoPosition]" :src="selectedLogo.signedUrl" alt="" aria-hidden="true" />
            </div>
            <p class="absolute bottom-5 left-1/2 hidden -translate-x-1/2 rounded-full bg-[#122820]/70 px-3 py-1.5 text-[10px] font-medium text-white sm:block">Live-Vorschau · {{ outputDimensionsLabel }}</p>
          </main>

          <section class="max-h-64 overflow-y-auto border-t border-[#e9ebe4] bg-white px-4 py-4 sm:px-6" aria-live="polite">
            <div v-if="activeTool === 'crop'" class="space-y-3"><div><h3 class="text-sm font-bold">Zuschnitt</h3><p class="text-[11px] text-[#7a817c]">Ziehe den Bildausschnitt direkt in der Vorschau. Aktueller Ausschnitt: {{ cropDimensionsLabel }}.</p></div><div class="flex flex-wrap items-center gap-2"><button v-for="option in ASPECT_RATIOS" :key="option.label" type="button" class="focus-ring rounded-lg px-3 py-2 text-xs font-semibold" :class="aspectRatio === option.value ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectAspectRatio(option.value)">{{ option.label }}</button><span class="hidden h-7 border-l border-[#dfe0d9] sm:block" /><button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]" aria-label="Nach links drehen" title="Nach links drehen" @click="rotate(-90)"><RotateCcw :size="17" /></button><button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]" aria-label="Nach rechts drehen" title="Nach rechts drehen" @click="rotate(90)"><RotateCw :size="17" /></button><button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]" aria-label="Horizontal spiegeln" title="Horizontal spiegeln" @click="flip(true, false)"><FlipHorizontal2 :size="17" /></button><button type="button" class="focus-ring rounded-lg border border-[#dfe0d9] p-2 text-[#52606d]" aria-label="Vertikal spiegeln" title="Vertikal spiegeln" @click="flip(false, true)"><FlipVertical2 :size="17" /></button></div></div>

            <div v-else-if="activeTool === 'filters'" class="space-y-4"><div><h3 class="text-sm font-bold">G’MIC-Filter</h3><p class="text-[11px] text-[#7a817c]">Die Kacheln werden nach und nach mit G’MIC auf deinen aktuellen Zuschnitt gerendert.</p></div><div class="flex flex-wrap gap-2"><button v-for="filter in workshopFilters" :key="filter.value" type="button" class="focus-ring w-28 shrink-0 overflow-hidden rounded-lg p-1.5 text-left" :class="selectedFilter === filter.value ? 'bg-[#e8efff] text-[#3754c8]' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectFilter(filter.value)"><img v-if="filter.value === 'original'" :src="croppedPreviewUrl || sourceUrl" alt="" aria-hidden="true" class="aspect-[4/3] w-full rounded object-cover" /><img v-else-if="filterThumbnailUrls[filter.value]" :src="filterThumbnailUrls[filter.value]" alt="" aria-hidden="true" class="aspect-[4/3] w-full rounded object-cover" /><span v-else-if="filterThumbnailStatuses[filter.value] === 'unavailable'" class="flex aspect-[4/3] items-center justify-center rounded bg-[#f5e9e7] px-2 text-center text-[10px] font-medium text-red-700">Nicht verfügbar</span><span v-else class="flex aspect-[4/3] items-center justify-center rounded bg-[#eef1ea] text-[10px] text-[#7a817c]">Lädt …</span><span class="mt-1 block truncate text-center text-[10px] font-semibold">{{ filter.label }}</span></button></div><p v-if="applyingFilter" class="text-xs text-[#7a817c]">G’MIC-Filter wird gerendert …</p><p v-if="filterError" class="text-xs text-red-700">{{ filterError }}</p></div>

            <div v-else-if="activeTool === 'resize'" class="flex flex-wrap items-end gap-3"><div class="mr-2"><h3 class="text-sm font-bold">Bildgröße</h3><p class="text-[11px] text-[#7a817c]">Ausgabe: {{ outputDimensionsLabel }}. Das Bild wird beim Speichern skaliert.</p></div><label class="grid gap-1 text-xs font-semibold">Breite<input :value="outputWidth" class="w-28 rounded-lg border border-[#dfe0d9] px-2 py-2 text-sm" type="number" min="1" :max="MAX_OUTPUT_DIMENSION" @focus="startHistoryGroup" @blur="finishHistoryGroup" @input="updateOutputWidth(($event.target as HTMLInputElement).value)" /></label><span class="mb-2 text-[#7a817c]">×</span><label class="grid gap-1 text-xs font-semibold">Höhe<input :value="outputHeight" class="w-28 rounded-lg border border-[#dfe0d9] px-2 py-2 text-sm" type="number" min="1" :max="MAX_OUTPUT_DIMENSION" @focus="startHistoryGroup" @blur="finishHistoryGroup" @input="updateOutputHeight(($event.target as HTMLInputElement).value)" /></label><button type="button" class="focus-ring mb-0.5 inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-[#52606d] hover:bg-[#f4f6f2]" :aria-pressed="keepAspectRatio" @click="toggleAspectRatioLock"><Lock v-if="keepAspectRatio" :size="15" /><Unlock v-else :size="15" /> Verhältnis {{ keepAspectRatio ? 'fix' : 'frei' }}</button><span class="pb-2 text-[11px] text-[#7a817c]">px</span></div>

            <div v-else-if="activeTool === 'frame'" class="space-y-3"><div><h3 class="text-sm font-bold">Rahmen</h3><p class="text-[11px] text-[#7a817c]">Wähle einen Rahmen aus euren hinterlegten Marken-Assets.</p></div><p v-if="loadingAssets" class="text-xs text-[#7a817c]">Rahmen werden geladen …</p><div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6"><button type="button" class="focus-ring rounded-lg p-2 text-left text-xs font-semibold" :class="selectedFrameId === null ? 'bg-[#e8efff] text-[#3754c8]' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectFrame(null)"><span class="flex aspect-[4/3] items-center justify-center rounded border border-dashed border-current">Ohne Rahmen</span><span class="mt-1 block text-center">Keiner</span></button><button v-for="frame in frames" :key="frame.id" type="button" class="focus-ring overflow-hidden rounded-lg p-1.5 text-left text-xs font-semibold" :class="selectedFrameId === frame.id ? 'bg-[#e8efff] text-[#3754c8]' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectFrame(frame.id)"><img :src="frame.signedUrl" :alt="`${frame.name} auswählen`" class="aspect-[4/3] w-full rounded object-fill" /><span class="mt-1 block truncate text-center">{{ frame.name }}</span></button></div><p v-if="!loadingAssets && !frames.length" class="text-xs text-[#7a817c]">Es sind noch keine Rahmen hinterlegt.</p></div>

            <div v-else class="space-y-3"><div><h3 class="text-sm font-bold">Logo</h3><p class="text-[11px] text-[#7a817c]">Logo wählen und an einer Ecke der Vorschau platzieren.</p></div><p v-if="loadingAssets" class="text-xs text-[#7a817c]">Logos werden geladen …</p><div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6"><button type="button" class="focus-ring rounded-lg p-2 text-left text-xs font-semibold" :class="selectedLogoId === null ? 'bg-[#e8efff] text-[#3754c8]' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectLogo(null)"><span class="flex aspect-[4/3] items-center justify-center rounded border border-dashed border-current">Ohne Logo</span><span class="mt-1 block text-center">Keines</span></button><button v-for="logo in logos" :key="logo.id" type="button" class="focus-ring overflow-hidden rounded-lg p-1.5 text-left text-xs font-semibold" :class="selectedLogoId === logo.id ? 'bg-[#e8efff] text-[#3754c8]' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectLogo(logo.id)"><img :src="logo.signedUrl" :alt="`${logo.name} auswählen`" class="aspect-[4/3] w-full rounded bg-[#dfe4dd] object-contain p-1" /><span class="mt-1 block truncate text-center">{{ logo.name }}</span></button></div><div v-if="selectedLogo" class="flex flex-wrap gap-2"><button v-for="position in (['top_left', 'top_right', 'bottom_left', 'bottom_right'] as const)" :key="position" type="button" class="focus-ring rounded-lg px-3 py-2 text-xs font-semibold" :class="logoPosition === position ? 'bg-forest text-white' : 'bg-[#eef1ea] text-[#5b625d]'" @click="selectLogoPosition(position)">{{ { top_left: 'Oben links', top_right: 'Oben rechts', bottom_left: 'Unten links', bottom_right: 'Unten rechts' }[position] }}</button></div><p v-if="!loadingAssets && !logos.length" class="text-xs text-[#7a817c]">Es sind noch keine Logos hinterlegt.</p></div>
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
