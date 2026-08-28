<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'
import type * as Fabric from 'fabric'
import type { PreviewImageStylePresetRequest } from '@vereinsfunk/contracts'
import type { ImageStylePresetDraft } from '../utils/imageStylePresetDraft'
import { logoFieldsToPixelRect, pixelRectToLogoFields } from '../utils/imageStyleLogoHandle'

const props = defineProps<{
  logoUrl: string
  organizationId: string
  departmentId: string | null
  teamId: string | null
}>()

const draft = defineModel<ImageStylePresetDraft>('draft', { required: true })

const api = useApiClient()
const { state, imageDataUrl, errorCode, schedule } = useImageStylePreviewRequest({ api })

const ERROR_MESSAGES: Record<string, string> = {
  gmic_not_enabled:
    "G'MIC ist in dieser Umgebung nicht aktiviert -- dieser Filter zeigt hier keine Vorschau, funktioniert aber in Produktion.",
  rate_limited: 'Zu viele Vorschau-Anfragen, bitte kurz warten.',
  brand_asset_not_ready: 'Die gewählte Datei ist noch nicht bereit.',
  invalid_asset_reference: 'Die gewählte Datei ist noch nicht bereit.',
}
const errorMessage = computed(() =>
  errorCode.value ? (ERROR_MESSAGES[errorCode.value] ?? 'Die Vorschau konnte nicht geladen werden.') : '',
)

// Spiegelt checkImageStylePresetFields (packages/contracts/src/imageStyle.ts) wie
// ImageStylePresetForm.vues isValid -- aber ohne die name-Pflicht, die PreviewImageStylePresetRequestSchema
// bewusst nicht hat (die Vorschau muss schon vor dem ersten Tippen funktionieren).
const canPreview = computed(() => {
  const value = draft.value
  if (
    value.frameType === 'parametric' &&
    (value.frameColor === null || value.frameWidthPx === null || value.frameStyle === null)
  )
    return false
  if ((value.frameType === 'custom') !== (value.frameBrandAssetId !== null)) return false
  const logoFieldsComplete =
    value.logoBrandAssetId !== null &&
    value.logoSizePercent !== null &&
    value.logoMarginPercent !== null
  if (value.logoEnabled !== logoFieldsComplete) return false
  return true
})

// name fliesst absichtlich NICHT mit: renderImageStyle (apps/api/src/imageStyle.ts) liest ihn nie,
// und der Watcher unten haengt an genau diesem Payload -- mit dem Namen darin loeste jeder
// Tastendruck im Namensfeld ein vollstaendiges serverseitiges Rendering aus und zehrte am
// Ratenlimit von 30 Anfragen/Minute.
function buildPreviewPayload(): PreviewImageStylePresetRequest {
  const value = draft.value
  return {
    organizationId: props.organizationId,
    ...(props.departmentId ? { departmentId: props.departmentId } : {}),
    ...(props.teamId ? { teamId: props.teamId } : {}),
    frameType: value.frameType,
    frameStyle: value.frameStyle,
    frameColor: value.frameColor,
    frameWidthPx: value.frameWidthPx,
    frameCornerRadiusPx: value.frameCornerRadiusPx,
    frameBrandAssetId: value.frameBrandAssetId,
    logoEnabled: value.logoEnabled,
    logoBrandAssetId: value.logoBrandAssetId,
    logoPosition: value.logoPosition,
    logoSizePercent: value.logoSizePercent,
    logoMarginPercent: value.logoMarginPercent,
    filter: value.filter,
  }
}

// organizationId ist leer, solange kein Vereins-Scope aufgeloest ist -- ein Abruf damit scheitert
// garantiert an UuidSchema, also gar nicht erst schicken.
const previewPayload = computed<PreviewImageStylePresetRequest | null>(() =>
  canPreview.value && props.organizationId ? buildPreviewPayload() : null,
)

watch(
  () => JSON.stringify(previewPayload.value),
  () => {
    // Serverseitig nichts anstossen: der Timer aus schedule() feuerte sonst erst nach der
    // SSR-Antwort -- ohne Nuxt-Kontext und mit noch leerem Scope (Muster wie in index.vue).
    if (import.meta.server) return
    const payload = previewPayload.value
    if (payload) schedule(payload)
  },
  { immediate: true },
)

const canvasEl = ref<HTMLCanvasElement | null>(null)
const canvasHost = ref<HTMLDivElement | null>(null)
// Ein einziger dynamischer Import (fabric laeuft nur im Browser), dessen Modul hier gehalten wird:
// vorher legte refreshLogoHandle den Griff erst im .then() eines eigenen Imports an, wodurch eine
// zwischenzeitliche Entwurfsaenderung mit veralteten Massen gewinnen konnte.
let fabricModule: typeof Fabric | null = null
let fabricCanvas: Fabric.Canvas | null = null
let logoHandle: Fabric.Rect | null = null
let updatingFromCanvas = false
let logoAspectRatio = 1
let latestBackgroundUrl = ''
let resizeObserver: ResizeObserver | null = null

// Fabric hält interne Pixelmaße und CSS-Maße getrennt. `height: auto` funktioniert für den von
// Fabric erzeugten Canvas-Wrapper nicht verlässlich und zeigte deshalb nur einen Ausschnitt des
// Fotos. Wir berechnen beide sichtbaren Maße aus dem tatsächlichen Seitenverhältnis.
function syncCanvasCssSize() {
  if (!fabricCanvas || !canvasHost.value || !fabricCanvas.width || !fabricCanvas.height) return
  const availableWidth = canvasHost.value.clientWidth
  if (availableWidth <= 0) return
  const scale = Math.min(1, availableWidth / fabricCanvas.width)
  fabricCanvas.setDimensions(
    {
      width: `${Math.max(1, Math.round(fabricCanvas.width * scale))}px`,
      height: `${Math.max(1, Math.round(fabricCanvas.height * scale))}px`,
    },
    { cssOnly: true },
  )
}

function refreshLogoHandle() {
  if (!fabricCanvas || !fabricModule) return
  if (!draft.value.logoEnabled || draft.value.logoSizePercent === null || draft.value.logoMarginPercent === null) {
    if (logoHandle) {
      fabricCanvas.remove(logoHandle)
      logoHandle = null
    }
    return
  }
  const rect = logoFieldsToPixelRect(
    {
      logoPosition: draft.value.logoPosition,
      logoSizePercent: draft.value.logoSizePercent,
      logoMarginPercent: draft.value.logoMarginPercent,
    },
    fabricCanvas.width,
    fabricCanvas.height,
    logoAspectRatio,
  )
  if (!logoHandle) {
    logoHandle = new fabricModule.Rect({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      fill: 'rgba(22, 58, 44, 0.15)',
      stroke: '#163a2c',
      strokeWidth: 2,
      strokeDashArray: [6, 4],
      lockRotation: true,
    })
    // Nur die Eckgriffe: Drehen ist gesperrt, und eine reine Hoehenaenderung ueber die Seitengriffe
    // waere wirkungslos -- der Server skaliert das Logo seitenverhaeltnis-erhaltend
    // (applyLogoWatermark), pixelRectToLogoFields liest deshalb nur die Breite.
    logoHandle.setControlsVisibility({ mtr: false, mt: false, mb: false, ml: false, mr: false })
    logoHandle.on('modified', onLogoHandleModified)
    fabricCanvas.add(logoHandle)
    fabricCanvas.renderAll()
    return
  }
  updatingFromCanvas = true
  logoHandle.set({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, scaleX: 1, scaleY: 1 })
  logoHandle.setCoords()
  fabricCanvas.renderAll()
  updatingFromCanvas = false
}

function onLogoHandleModified() {
  if (!fabricCanvas || !logoHandle || updatingFromCanvas) return
  const fields = pixelRectToLogoFields(
    {
      left: logoHandle.left,
      top: logoHandle.top,
      width: logoHandle.getScaledWidth(),
      height: logoHandle.getScaledHeight(),
    },
    fabricCanvas.width,
    fabricCanvas.height,
    draft.value.logoMarginPercent ?? 4,
  )
  draft.value.logoPosition = fields.logoPosition
  draft.value.logoSizePercent = fields.logoSizePercent
  draft.value.logoMarginPercent = fields.logoMarginPercent
  // Immer nachziehen, nicht nur wenn der Watcher unten anspringt: die Rueckrechnung rastet auf
  // Enum-Zonen und ganze Prozentwerte ein, ein Ziehen innerhalb derselben Ecke laesst also alle
  // drei Felder unveraendert. Ohne diesen Aufruf blieb der Griff dann liegen, wo er losgelassen
  // wurde, und zeigte etwas anderes als der Server rendert.
  refreshLogoHandle()
}

async function loadLogoAspectRatio() {
  if (!props.logoUrl) {
    logoAspectRatio = 1
    return
  }
  await new Promise<void>((resolve) => {
    const image = new Image()
    image.onload = () => {
      logoAspectRatio = image.naturalWidth > 0 ? image.naturalHeight / image.naturalWidth : 1
      resolve()
    }
    image.onerror = () => resolve()
    image.src = props.logoUrl
  })
}

async function applyBackgroundImage(dataUrl: string) {
  if (!fabricCanvas || !fabricModule) return
  latestBackgroundUrl = dataUrl
  const image: Fabric.FabricImage = await fabricModule.FabricImage.fromURL(dataUrl)
  // Dekodieren dauert je Bild unterschiedlich lange: eine frueher gestartete, spaeter fertige
  // Vorschau darf die neuere nicht wieder verdraengen (gleicher Race-Guard wie im Composable).
  if (!fabricCanvas || latestBackgroundUrl !== dataUrl) return
  const width = image.width ?? fabricCanvas.width
  const height = image.height ?? fabricCanvas.height
  fabricCanvas.setDimensions({ width, height })
  fabricCanvas.backgroundImage = image
  fabricCanvas.renderAll()
  refreshLogoHandle()
  await nextTick()
  syncCanvasCssSize()
}

watch(imageDataUrl, (value) => {
  if (value) void applyBackgroundImage(value)
})
watch(() => props.logoUrl, async () => {
  await loadLogoAspectRatio()
  refreshLogoHandle()
})
watch(
  () => [draft.value.logoEnabled, draft.value.logoPosition, draft.value.logoSizePercent, draft.value.logoMarginPercent],
  () => refreshLogoHandle(),
)

onMounted(async () => {
  fabricModule = await import('fabric')
  if (!canvasEl.value) return
  fabricCanvas = new fabricModule.Canvas(canvasEl.value, { selection: false })
  resizeObserver = new ResizeObserver(syncCanvasCssSize)
  if (canvasHost.value) resizeObserver.observe(canvasHost.value)
  await loadLogoAspectRatio()
  if (imageDataUrl.value) await applyBackgroundImage(imageDataUrl.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  logoHandle = null
  void fabricCanvas?.dispose()
  fabricCanvas = null
})
</script>

<template>
  <section class="card p-6">
    <h2 class="font-display text-base font-bold">Live-Vorschau</h2>
    <p class="mt-1 text-[11px] text-[#9aa096]">Vorschau kann kurz nachladen.</p>
    <div ref="canvasHost" class="relative mt-4 min-h-32 w-full overflow-hidden rounded-2xl border border-[#e9ebe4] bg-[#f8f9f6]">
      <canvas ref="canvasEl" class="block" />
      <div
        v-if="state === 'loading'"
        class="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/40"
      >
        <LoaderCircle :size="20" class="animate-spin text-forest" />
      </div>
    </div>
    <p v-if="state === 'error'" class="mt-2 text-[11px] text-amber-800">{{ errorMessage }}</p>
  </section>
</template>
