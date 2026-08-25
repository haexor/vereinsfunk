<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'
import type { Canvas as FabricCanvas, FabricImage, Rect } from 'fabric'
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

function buildPreviewPayload(): PreviewImageStylePresetRequest {
  const value = draft.value
  return {
    ...(value.name.trim() ? { name: value.name } : {}),
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

watch(
  () => JSON.stringify(draft.value),
  () => {
    if (!canPreview.value) return
    schedule(buildPreviewPayload())
  },
  { immediate: true },
)

const canvasEl = ref<HTMLCanvasElement | null>(null)
let fabricCanvas: FabricCanvas | null = null
let logoHandle: Rect | null = null
let updatingFromCanvas = false
let logoAspectRatio = 1

function refreshLogoHandle() {
  if (!fabricCanvas) return
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
    import('fabric').then(({ Rect: FabricRect }) => {
      if (!fabricCanvas || logoHandle) return
      logoHandle = new FabricRect({
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
      logoHandle.on('modified', onLogoHandleModified)
      fabricCanvas.add(logoHandle)
      fabricCanvas.renderAll()
    })
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
  if (!fabricCanvas) return
  const { FabricImage: FabricImageClass } = await import('fabric')
  const image: FabricImage = await FabricImageClass.fromURL(dataUrl)
  if (!fabricCanvas) return
  const width = image.width ?? fabricCanvas.width
  const height = image.height ?? fabricCanvas.height
  fabricCanvas.setDimensions({ width, height })
  fabricCanvas.backgroundImage = image
  fabricCanvas.renderAll()
  refreshLogoHandle()
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
  const { Canvas } = await import('fabric')
  if (!canvasEl.value) return
  fabricCanvas = new Canvas(canvasEl.value, { selection: false })
  await loadLogoAspectRatio()
  if (imageDataUrl.value) await applyBackgroundImage(imageDataUrl.value)
})

onBeforeUnmount(() => {
  logoHandle = null
  void fabricCanvas?.dispose()
  fabricCanvas = null
})
</script>

<template>
  <section class="card p-6">
    <h2 class="font-display text-base font-bold">Live-Vorschau</h2>
    <p class="mt-1 text-[11px] text-[#9aa096]">Vorschau kann kurz nachladen.</p>
    <div class="relative mt-4">
      <canvas ref="canvasEl" class="max-w-full rounded-2xl border border-[#e9ebe4]" />
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
